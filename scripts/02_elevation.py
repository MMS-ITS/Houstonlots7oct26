"""Sample the USGS 3DEP bare-earth DEM over each parcel and derive terrain metrics.

Produces, per property:
  - a regular elevation grid (metres, converted to feet) covering the parcel bbox
  - min / max / mean elevation inside the true parcel polygon
  - slope statistics computed from the grid
  - a road->rear longitudinal transect along the lot's long axis
  - contour polylines (marching squares) for mapping

Source: USGS 3DEP ImageServer getSamples (1 m lidar-derived DEM where available).
Elevations are DEM-derived MODEL ESTIMATES, not survey-grade.
"""
import json
import math
import sys
import urllib.parse

from common import (DATA, fetch, haversine_ft, load, point_in_ring, save)

SVC = ("https://elevation.nationalmap.gov/arcgis/rest/services/"
       "3DEPElevation/ImageServer/getSamples")
M2FT = 3.280839895
BATCH = 200
GRID_N = 36          # grid resolution per axis
PAD = 0.30           # expand bbox by this fraction of its span


def sample(points):
    """points: list of [lon,lat]. Returns list of elevation in metres (or None)."""
    out = [None] * len(points)
    for i in range(0, len(points), BATCH):
        chunk = points[i:i + BATCH]
        p = {"f": "json",
             "geometry": json.dumps({"points": chunk, "spatialReference": {"wkid": 4326}}),
             "geometryType": "esriGeometryMultipoint",
             "returnFirstValueOnly": "true",
             "interpolation": "RSP_BilinearInterpolation"}
        d = json.loads(fetch(SVC, data=urllib.parse.urlencode(p).encode(),
                             timeout=180, retries=4,
                             headers={"Content-Type": "application/x-www-form-urlencoded"}))
        for s in d.get("samples", []):
            lid = s.get("locationId")
            try:
                v = float(s.get("value"))
            except (TypeError, ValueError):
                v = None
            if lid is not None and 0 <= lid < len(chunk):
                out[i + lid] = v
        print(f"      sampled {min(i+BATCH, len(points))}/{len(points)}")
    return out


def build_grid(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    dx, dy = x1 - x0, y1 - y0
    # keep the window squarish in ground distance
    x0 -= dx * PAD; x1 += dx * PAD
    y0 -= dy * PAD; y1 += dy * PAD
    gx = [x0 + (x1 - x0) * i / (GRID_N - 1) for i in range(GRID_N)]
    gy = [y0 + (y1 - y0) * j / (GRID_N - 1) for j in range(GRID_N)]
    pts = [[x, y] for y in gy for x in gx]
    return gx, gy, pts


def slope_stats(gx, gy, Z):
    """Central-difference slope magnitude over the grid, in percent and degrees."""
    # Z is in FEET, so horizontal spacing must also be in feet.
    lat0 = sum(gy) / len(gy)
    sx = (gx[1] - gx[0]) * 111320.0 * math.cos(math.radians(lat0)) * M2FT
    sy = (gy[1] - gy[0]) * 110540.0 * M2FT
    vals = []
    n = len(gy)
    m = len(gx)
    for j in range(1, n - 1):
        for i in range(1, m - 1):
            a, b = Z[j][i - 1], Z[j][i + 1]
            c, d = Z[j - 1][i], Z[j + 1][i]
            if None in (a, b, c, d):
                continue
            dzdx = (b - a) / (2 * sx)
            dzdy = (d - c) / (2 * sy)
            g = math.hypot(dzdx, dzdy)
            vals.append(g)
    if not vals:
        return {}
    vals.sort()
    def pct(q):
        return vals[min(len(vals) - 1, int(q * len(vals)))]
    return {
        "mean_pct": round(sum(vals) / len(vals) * 100, 2),
        "median_pct": round(pct(0.5) * 100, 2),
        "p90_pct": round(pct(0.90) * 100, 2),
        "max_pct": round(vals[-1] * 100, 2),
        "mean_deg": round(math.degrees(math.atan(sum(vals) / len(vals))), 2),
        "p90_deg": round(math.degrees(math.atan(pct(0.90))), 2),
        "max_deg": round(math.degrees(math.atan(vals[-1])), 2),
        "n_cells": len(vals),
    }


def contours(gx, gy, Z, interval_ft):
    """Marching-squares contour segments at multiples of interval_ft."""
    zs = [v for row in Z for v in row if v is not None]
    if not zs:
        return []
    lo, hi = min(zs), max(zs)
    start = math.floor(lo / interval_ft) * interval_ft
    levels = []
    v = start
    while v <= hi + interval_ft:
        if lo < v < hi:
            levels.append(round(v, 3))
        v += interval_ft
    out = []
    for lv in levels:
        segs = []
        for j in range(len(gy) - 1):
            for i in range(len(gx) - 1):
                cell = [(gx[i], gy[j], Z[j][i]), (gx[i + 1], gy[j], Z[j][i + 1]),
                        (gx[i + 1], gy[j + 1], Z[j + 1][i + 1]), (gx[i], gy[j + 1], Z[j + 1][i])]
                if any(c[2] is None for c in cell):
                    continue
                pts = []
                for k in range(4):
                    x1, y1, z1 = cell[k]
                    x2, y2, z2 = cell[(k + 1) % 4]
                    if (z1 - lv) * (z2 - lv) < 0:
                        t = (lv - z1) / (z2 - z1)
                        pts.append([round(x1 + t * (x2 - x1), 7), round(y1 + t * (y2 - y1), 7)])
                if len(pts) == 2:
                    segs.append(pts)
                elif len(pts) == 4:
                    segs.append(pts[0:2]); segs.append(pts[2:4])
        if segs:
            out.append({"level_ft": round(lv, 2), "segments": segs})
    return out


def bilinear(gx, gy, Z, x, y):
    if not (gx[0] <= x <= gx[-1] and gy[0] <= y <= gy[-1]):
        return None
    i = min(len(gx) - 2, max(0, int((x - gx[0]) / (gx[1] - gx[0]))))
    j = min(len(gy) - 2, max(0, int((y - gy[0]) / (gy[1] - gy[0]))))
    tx = (x - gx[i]) / (gx[i + 1] - gx[i])
    ty = (y - gy[j]) / (gy[j + 1] - gy[j])
    z = [Z[j][i], Z[j][i + 1], Z[j + 1][i], Z[j + 1][i + 1]]
    if any(v is None for v in z):
        return None
    return (z[0] * (1 - tx) * (1 - ty) + z[1] * tx * (1 - ty)
            + z[2] * (1 - tx) * ty + z[3] * tx * ty)


def transect(gx, gy, Z, ring, n=None):
    """Profile along the parcel's longest axis (proxy for road->rear/lake run)."""
    best = (0, None, None)
    for i in range(len(ring)):
        for j in range(i + 1, len(ring)):
            d = haversine_ft(ring[i], ring[j])
            if d > best[0]:
                best = (d, ring[i], ring[j])
    total, a, b = best
    if a is None:
        return None
    # sample at <= 2.5 ft spacing so a true 50 ft window always exists
    if n is None:
        n = int(min(480, max(100, total / 2.5)))
    prof = []
    for k in range(n + 1):
        t = k / n
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        z = bilinear(gx, gy, Z, x, y)
        prof.append({"d_ft": round(total * t, 1),
                     "z_ft": None if z is None else round(z, 2),
                     "lon": round(x, 7), "lat": round(y, 7)})
    zz = [p["z_ft"] for p in prof if p["z_ft"] is not None]
    out = {"length_ft": round(total, 1), "profile": prof,
           "start": {"lon": a[0], "lat": a[1]}, "end": {"lon": b[0], "lat": b[1]}}
    if zz:
        out.update(z_min=round(min(zz), 2), z_max=round(max(zz), 2),
                   relief_ft=round(max(zz) - min(zz), 2),
                   avg_slope_pct=round((max(zz) - min(zz)) / total * 100, 2) if total else None)
        # steepest 50 ft window, as the brief requires
        # steepest grade over any ~50 ft run along the profile
        worst = None
        step = total / n if n else 0
        if step > 0:
            w = max(1, int(round(50.0 / step)))
            for i in range(0, len(prof) - w):
                zi, zj = prof[i]["z_ft"], prof[i + w]["z_ft"]
                if zi is None or zj is None:
                    continue
                dd = prof[i + w]["d_ft"] - prof[i]["d_ft"]
                if dd <= 0:
                    continue
                dz = abs(zj - zi)
                cand = (dz / dd, dd, dz, prof[i]["d_ft"])
                if worst is None or cand[0] > worst[0]:
                    worst = cand
        if worst:
            out["steepest_50ft"] = {"grade_pct": round(worst[0] * 100, 2),
                                    "angle_deg": round(math.degrees(math.atan(worst[0])), 2),
                                    "run_ft": round(worst[1], 1), "rise_ft": round(worst[2], 2),
                                    "at_d_ft": round(worst[3], 1)}
    return out


def main():
    parcels = load("parcels.json", {})
    only = sys.argv[1:] or None
    out = load("elevation.json", {}) or {}
    for key, rec in parcels.items():
        if only and key not in only:
            continue
        best = rec.get("best")
        if not best or not best.get("ring"):
            print(f"-- {key}: no geometry, skipped")
            continue
        ring = best["ring"]
        print(f"\n=== {key} ({rec['subject']['label']})")
        gx, gy, pts = build_grid(ring)
        vals = sample(pts)
        n_ok = sum(1 for v in vals if v is not None)
        print(f"    grid {GRID_N}x{GRID_N}, {n_ok}/{len(pts)} returned")
        Z = [[None] * GRID_N for _ in range(GRID_N)]
        for idx, v in enumerate(vals):
            j, i = divmod(idx, GRID_N)
            Z[j][i] = None if v is None else v * M2FT
        inside = []
        for j in range(GRID_N):
            for i in range(GRID_N):
                if Z[j][i] is None:
                    continue
                if point_in_ring((gx[i], gy[j]), ring):
                    inside.append(Z[j][i])
        lat0 = sum(gy) / len(gy)
        cell_ft = (gx[1] - gx[0]) * 111320.0 * math.cos(math.radians(lat0)) * 3.280839895
        rec_out = {
            "grid": {"gx": [round(v, 7) for v in gx], "gy": [round(v, 7) for v in gy],
                     "z_ft": [[None if v is None else round(v, 3) for v in row] for row in Z],
                     "cell_ft": round(cell_ft, 2), "n": GRID_N},
            "dem": {"source": "USGS 3DEP bare-earth DEM via ImageServer getSamples",
                    "native_res_m": 1, "vertical_units": "feet (converted from metres)",
                    "nominal_datum": "NAVD88 (as published by 3DEP)"},
            "window_relief_ft": None,
            "slope": slope_stats(gx, gy, Z),
            "transect": transect(gx, gy, Z, ring),
        }
        allz = [v for row in Z for v in row if v is not None]
        if allz:
            rec_out["window_relief_ft"] = round(max(allz) - min(allz), 2)
            rec_out["window_min_ft"] = round(min(allz), 2)
            rec_out["window_max_ft"] = round(max(allz), 2)
        if inside:
            rec_out["parcel"] = {
                "n_samples": len(inside),
                "min_ft": round(min(inside), 2), "max_ft": round(max(inside), 2),
                "mean_ft": round(sum(inside) / len(inside), 2),
                "relief_ft": round(max(inside) - min(inside), 2),
            }
        # contour interval scaled to relief
        relief = (rec_out.get("parcel") or {}).get("relief_ft") or rec_out["window_relief_ft"] or 5
        iv = 1.0 if relief <= 12 else (2.0 if relief <= 30 else (5.0 if relief <= 80 else 10.0))
        rec_out["contours"] = {"interval_ft": iv, "levels": contours(gx, gy, Z, iv)}
        p = rec_out.get("parcel", {})
        print(f"    parcel elev {p.get('min_ft')}-{p.get('max_ft')} ft, relief {p.get('relief_ft')} ft")
        print(f"    slope mean {rec_out['slope'].get('mean_pct')}%  p90 {rec_out['slope'].get('p90_pct')}%")
        t = rec_out.get("transect") or {}
        print(f"    transect {t.get('length_ft')} ft, relief {t.get('relief_ft')} ft, "
              f"steepest50 {(t.get('steepest_50ft') or {}).get('grade_pct')}%")
        out[key] = rec_out
        save("elevation.json", out)
    print("\nsaved ->", DATA + "/elevation.json")


if __name__ == "__main__":
    main()
