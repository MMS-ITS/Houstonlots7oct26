"""Targeted parcel probes for the addresses that failed automatic matching."""
import json
import re
import sys
import urllib.parse

from common import fetch, save

SVC = ("https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/"
       "stratmap_land_parcels_48_most_recent/MapServer/identify")


def identify(xmin, ymin, xmax, ymax, geom=False):
    p = {"f": "json",
         "geometry": json.dumps({"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
                                 "spatialReference": {"wkid": 4326}}),
         "geometryType": "esriGeometryEnvelope", "sr": "4326", "tolerance": "1",
         "mapExtent": f"{xmin},{ymin},{xmax},{ymax}", "imageDisplay": "1400,1400,96",
         "layers": "all", "returnGeometry": "true" if geom else "false",
         "maxAllowableOffset": "0.0000015"}
    try:
        return json.loads(fetch(SVC + "?" + urllib.parse.urlencode(p), timeout=120)).get("results", [])
    except Exception as e:  # noqa: BLE001
        print("   identify err", str(e)[:80])
        return []


def tiles(lon, lat, half, n):
    """n x n grid of sub-windows covering +/- half degrees."""
    step = (2 * half) / n
    for i in range(n):
        for j in range(n):
            x0 = lon - half + i * step
            y0 = lat - half + j * step
            yield x0, y0, x0 + step, y0 + step


def scan(name, lon, lat, half, n, patterns):
    pats = [re.compile(p, re.I) for p in patterns]
    hits, total, seen = {}, 0, set()
    for (x0, y0, x1, y1) in tiles(lon, lat, half, n):
        res = identify(x0, y0, x1, y1)
        for r in res:
            a = r["attributes"]
            oid = a.get("objectid")
            if oid in seen:
                continue
            seen.add(oid)
            total += 1
            blob = " | ".join(str(a.get(k)) for k in
                              ("SITUS_ADDR", "SITUS_NUM", "SITUS_ST_1", "LEGAL_DESC", "GEO_ID"))
            if any(p.search(blob) for p in pats):
                hits[oid] = a
    print(f"\n#### {name}: scanned {total} unique parcels, {len(hits)} pattern hits")
    for a in list(hits.values())[:60]:
        print(f"   {str(a.get('SITUS_ADDR'))[:46]:48s} | {str(a.get('LEGAL_DESC'))[:70]:72s} | {a.get('GIS_AREA')}")
    return hits


JOBS = {
    # Oak Canyon Estates / Ward Rd area near Lake Alan Henry
    "ward": dict(lon=-101.0414, lat=33.0324, half=0.045, n=4,
                 patterns=[r"OAK CANYON", r"WARD\s*RD"]),
    # Dolly Rd, Hopkins County near Sulphur Springs
    "dolly": dict(lon=-95.5390, lat=33.1234, half=0.035, n=4,
                  patterns=[r"\bDOLLY\b"]),
    # Private Road 52415, Camp County / Leesburg (Lake Bob Sandlin area)
    "pr52415": dict(lon=-95.1281, lat=32.9572, half=0.06, n=5,
                    patterns=[r"52415", r"\bPR\s*524", r"PRIVATE\s*ROAD\s*524"]),
}


def main():
    which = sys.argv[1:] or list(JOBS)
    out = {}
    for k in which:
        j = JOBS[k]
        out[k] = scan(k, **j)
        save(f"probe_{k}.json", out[k])


if __name__ == "__main__":
    main()
