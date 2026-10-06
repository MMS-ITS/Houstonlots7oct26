"""Locate the authoritative parcel polygon for each subject property.

Source: Texas StratMap statewide land parcels (TxGIO), rolled up from county
appraisal district records. The service exposes only `identify` (attribute
`query` is disabled), so parcels are harvested by map-extent identify calls and
then matched on situs house-number + street name.
"""
import json
import re
import sys
import urllib.parse

from common import (DATA, bbox, fetch, oriented_extent, point_in_ring,
                    ring_area_acres, ring_centroid, save)

SVC = ("https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/"
       "stratmap_land_parcels_48_most_recent/MapServer/identify")

# Subject properties. seed = approximate lon/lat used only to aim the harvest.
SUBJECTS = [
    dict(key="pony652", label="652 Pony Trl, Angleton, TX 77515",
         num="652", street="PONY", seed=(-95.5657, 29.1139), county="Brazoria"),
    dict(key="pony543", label="543 Pony Trl, Angleton, TX 77515",
         num="543", street="PONY", seed=(-95.5699, 29.1145), county="Brazoria"),
    dict(key="pony274", label="274 Pony Trl, Angleton, TX 77515",
         num="274", street="PONY", seed=(-95.5749, 29.1234), county="Brazoria"),
    dict(key="pony220", label="220 Pony Trl, Angleton, TX 77515",
         num="220", street="PONY", seed=(-95.5749, 29.1245), county="Brazoria"),
    dict(key="oldhenry1601", label="1601 Old Henry Ct, Angleton, TX 77515",
         num="1601", street="OLD HENRY", seed=(-95.5722, 29.1251), county="Brazoria"),
    dict(key="dolly119", label="119 Dolly Rd, Sulphur Springs, TX 75482",
         num="119", street="DOLLY", seed=(-95.5390, 33.1234), county="Hopkins"),
    dict(key="harrell15", label="15 Harrell Cemetery Rd, Coldspring, TX 77331",
         num="15", street="HARRELL", seed=(-95.1799, 30.6992), county="San Jacinto"),
    dict(key="arrowhead2883", label="2883 W Arrowhead Dr, Wichita Falls, TX 76310",
         num="2883", street="ARROWHEAD", seed=(-98.3805, 33.7464), county="Wichita"),
    dict(key="stlawrence0", label="0 Saint Lawrence River Rd, Montgomery, TX 77316",
         num=None, street="SAINT LAWRENCE", seed=(-95.6054, 30.3531), county="Montgomery"),
    dict(key="pr52415", label="Private Road 52415, Leesburg, TX 75451",
         num=None, street="52415", seed=(-95.1281, 32.9572), county="Camp"),
    dict(key="ward141", label="141 Ward Rd, Justiceburg, TX 79330",
         num="141", street="WARD", seed=(-101.0461, 33.0269), county="Garza"),
    dict(key="ward80", label="80 Ward Rd, Snyder, TX 79549",
         num="80", street="WARD", seed=(-101.0367, 33.0379), county="Scurry"),
]


def identify(xmin, ymin, xmax, ymax, geom=True):
    p = {
        "f": "json",
        "geometry": json.dumps({"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
                                "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryEnvelope",
        "sr": "4326",
        "tolerance": "1",
        "mapExtent": f"{xmin},{ymin},{xmax},{ymax}",
        "imageDisplay": "1400,1400,96",
        "layers": "all",
        "returnGeometry": "true" if geom else "false",
        "maxAllowableOffset": "0.0000015",
    }
    try:
        d = json.loads(fetch(SVC + "?" + urllib.parse.urlencode(p), timeout=120))
        return d.get("results", [])
    except Exception as e:  # noqa: BLE001
        print(f"    identify failed: {str(e)[:90]}")
        return []


def harvest(seed, rings_deg=(0.012, 0.03, 0.06)):
    """Progressively widen the search window around the seed point."""
    out, seen = [], set()
    lon, lat = seed
    for d in rings_deg:
        res = identify(lon - d, lat - d, lon + d, lat + d)
        for r in res:
            a = r["attributes"]
            oid = a.get("objectid")
            if oid in seen:
                continue
            seen.add(oid)
            out.append(r)
        print(f"    window +/-{d:.3f}deg -> {len(res)} results, {len(out)} unique")
        if len(res) >= 1 and len(out) > 2500:
            break
    return out


def norm(s):
    return re.sub(r"\s+", " ", (s or "").upper()).strip()


def pick(subject, parcels):
    """Match harvested parcels to the subject address."""
    num, street = subject["num"], norm(subject["street"])
    cands = []
    for r in parcels:
        a = r["attributes"]
        st = norm(a.get("SITUS_ST_1"))
        addr = norm(a.get("SITUS_ADDR"))
        legal = norm(a.get("LEGAL_DESC"))
        if street not in st and street not in addr and street not in legal:
            continue
        snum = norm(a.get("SITUS_NUM"))
        score = 0
        if num:
            if snum == num:
                score = 100
            elif re.search(rf"\b{num}\b", addr):
                score = 90
            else:
                continue
        else:
            score = 50
        cands.append((score, r))
    cands.sort(key=lambda t: -t[0])
    return cands


def summarise(r):
    a = dict(r["attributes"])
    g = r.get("geometry") or {}
    rings = g.get("rings") or []
    out = {"attributes": a, "has_geometry": bool(rings)}
    if rings:
        ring = max(rings, key=len)
        ring = [[float(p[0]), float(p[1])] for p in ring]
        cen = ring_centroid(ring)
        out.update(
            rings=rings,
            ring=ring,
            centroid={"lon": round(cen[0], 7), "lat": round(cen[1], 7)},
            computed_acres=round(ring_area_acres(ring), 4),
            bbox=[round(v, 7) for v in bbox(ring)],
            extent=oriented_extent(ring),
            centroid_inside=point_in_ring(cen, ring),
        )
    return out


def main():
    only = sys.argv[1:] or None
    from common import load
    results = load("parcels.json", {}) or {}   # merge, never clobber prior runs
    for s in SUBJECTS:
        if only and s["key"] not in only:
            continue
        print(f"\n=== {s['label']}")
        parcels = harvest(s["seed"])
        cands = pick(s, parcels)
        print(f"    candidates: {len(cands)}")
        for sc, r in cands[:6]:
            a = r["attributes"]
            print(f"      [{sc}] {a.get('SITUS_ADDR')!r} :: {str(a.get('LEGAL_DESC'))[:95]}")
        rec = {"subject": s, "n_harvested": len(parcels), "n_candidates": len(cands)}
        if cands:
            rec["best"] = summarise(cands[0][1])
            rec["alternates"] = [
                {"score": sc, "SITUS_ADDR": r["attributes"].get("SITUS_ADDR"),
                 "LEGAL_DESC": r["attributes"].get("LEGAL_DESC"),
                 "GEO_ID": r["attributes"].get("GEO_ID")}
                for sc, r in cands[1:8]
            ]
        else:
            # keep nearby parcels for context even when no address match
            rec["nearby"] = [
                {"SITUS_ADDR": r["attributes"].get("SITUS_ADDR"),
                 "LEGAL_DESC": r["attributes"].get("LEGAL_DESC")}
                for r in parcels[:25]
            ]
        results[s["key"]] = rec
        save("parcels.json", results)
    print("\nsaved ->", DATA + "/parcels.json")


if __name__ == "__main__":
    main()
