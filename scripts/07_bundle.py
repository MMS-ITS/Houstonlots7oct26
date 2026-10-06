"""Assemble a compact payload for the HTML report.

Trims the raw collection output to what the report actually draws: parcel rings,
the elevation grid, contour polylines, the longitudinal transect and the monthly
climate normals. Coordinates are rounded to ~1 cm precision to keep the embedded
payload small.
"""
import json

from common import DATA, load, save

ORDER = [
    "pony652", "pony543", "pony274", "pony220", "oldhenry1601",
    "pr52415", "dolly119", "harrell15", "stlawrence0",
    "ward141", "ward80", "arrowhead2883",
]


def r6(v):
    return None if v is None else round(float(v), 6)


def downsample(seq, target):
    if not seq or len(seq) <= target:
        return seq
    step = len(seq) / target
    return [seq[min(len(seq) - 1, int(i * step))] for i in range(target)]


def main():
    payload = load("report_payload.json", {})
    parcels = load("parcels.json", {})
    elev = load("elevation.json", {})
    ctx = load("context.json", {})

    out = {"generated_order": ORDER, "properties": {},
           "missing_documents": payload.get("missing_documents", [])}

    for key in ORDER:
        p = dict(payload.get("properties", {}).get(key) or {})
        if not p:
            continue
        best = (parcels.get(key) or {}).get("best") or {}
        geo = {}
        if best.get("ring"):
            geo["ring"] = [[r6(x), r6(y)] for x, y in best["ring"]]
            geo["rings"] = [[[r6(x), r6(y)] for x, y in rg]
                            for rg in (best.get("rings") or [])]
            geo["centroid"] = best.get("centroid")
            geo["bbox"] = best.get("bbox")
            geo["extent"] = best.get("extent")
        e = elev.get(key) or {}
        g = e.get("grid") or {}
        terr = {}
        if g:
            terr["grid"] = {
                "gx": [r6(v) for v in g.get("gx", [])],
                "gy": [r6(v) for v in g.get("gy", [])],
                "z": [[None if v is None else round(v, 2) for v in row]
                      for row in g.get("z_ft", [])],
                "cell_ft": g.get("cell_ft"), "n": g.get("n"),
            }
        cs = e.get("contours") or {}
        if cs.get("levels"):
            terr["contours"] = {
                "interval_ft": cs.get("interval_ft"),
                "levels": [{"level_ft": L["level_ft"],
                            "segments": [[[r6(a[0]), r6(a[1])], [r6(b[0]), r6(b[1])]]
                                         for a, b in L["segments"]]}
                           for L in cs["levels"]],
            }
        t = e.get("transect") or {}
        if t.get("profile"):
            prof = [{"d": round(q["d_ft"], 2), "z": q["z_ft"]} for q in t["profile"]]
            terr["transect"] = {
                "length_ft": t.get("length_ft"), "z_min": t.get("z_min"),
                "z_max": t.get("z_max"), "relief_ft": t.get("relief_ft"),
                "avg_slope_pct": t.get("avg_slope_pct"),
                "steepest_50ft": t.get("steepest_50ft"),
                "start": {"lon": r6(t["start"]["lon"]), "lat": r6(t["start"]["lat"])},
                "end": {"lon": r6(t["end"]["lon"]), "lat": r6(t["end"]["lat"])},
                "profile": downsample(prof, 200),
                "profile_full_n": len(prof),
            }
        p["geometry"] = geo
        p["terrain_data"] = terr
        cc = (ctx.get(key) or {})
        p["water_detail"] = (cc.get("water") or {})
        out["properties"][key] = p

    save("report_bundle.json", out)
    n = len(json.dumps(out))
    print(f"bundle: {len(out['properties'])} properties, {n/1024:.0f} KB")
    for k in ORDER:
        p = out["properties"].get(k)
        if not p:
            print(f"  {k}: MISSING"); continue
        td = p.get("terrain_data", {})
        print(f"  {k:14s} ring={len(p.get('geometry', {}).get('ring') or [])} "
              f"grid={'y' if td.get('grid') else 'n'} "
              f"contours={len((td.get('contours') or {}).get('levels') or [])} "
              f"transect={len((td.get('transect') or {}).get('profile') or [])}")
    print("\nsaved ->", DATA + "/report_bundle.json")


if __name__ == "__main__":
    main()
