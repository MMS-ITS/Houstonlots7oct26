"""Refine the flood interpretation for parcels with no intersecting zone polygon.

Layer 0 (NFHL Availability) rejects point queries, so mapping coverage is
inferred from whether ANY flood-hazard polygon exists within 1 / 5 / 15 miles.
If the surrounding area is clearly mapped, an empty result at the parcel means
unshaded Zone X. If nothing is mapped for miles, the zone is undetermined.
"""
import json
import urllib.parse

from common import DATA, fetch, load, save

BASE = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"


def near(pt, miles):
    p = {"f": "json", "geometry": json.dumps(pt), "geometryType": "esriGeometryPoint",
         "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
         "outFields": "FLD_ZONE,ZONE_SUBTY", "returnGeometry": "false",
         "distance": str(miles * 5280), "units": "esriSRUnit_Foot",
         "returnCountOnly": "false", "resultRecordCount": "50"}
    try:
        d = json.loads(fetch(f"{BASE}/28/query", data=urllib.parse.urlencode(p).encode(),
                             timeout=180, retries=4,
                             headers={"Content-Type": "application/x-www-form-urlencoded"}))
        if "error" in d:
            return None
        return [f.get("attributes", {}) for f in d.get("features", [])]
    except Exception:  # noqa: BLE001
        return None


def main():
    parcels = load("parcels.json", {})
    flood = load("flood.json", {})
    for key, rec in parcels.items():
        best = rec.get("best")
        if not best:
            continue
        fr = flood.get(key)
        if not fr:
            continue
        zones = fr.get("summary", {}).get("zones") or []
        if zones:
            fr.setdefault("coverage", {})["interpretation"] = (
                "Parcel intersects mapped FEMA flood-hazard polygon(s); see zones above.")
            flood[key] = fr
            continue
        cen = best["centroid"]
        pt = {"x": cen["lon"], "y": cen["lat"], "spatialReference": {"wkid": 4326}}
        found = {}
        for mi in (1, 5, 15):
            r = near(pt, mi)
            found[mi] = None if r is None else sorted({str(z.get("FLD_ZONE")) for z in r})
            print(f"  {key}: within {mi} mi -> {found[mi]}")
            if found[mi]:
                break
        fr.setdefault("coverage", {})
        fr["coverage"]["zones_within_radius"] = found
        mapped_at = next((mi for mi in (1, 5, 15) if found.get(mi)), None)
        if mapped_at is not None and mapped_at <= 5:
            fr["coverage"]["interpretation"] = (
                f"No FEMA flood-hazard polygon intersects this parcel, but mapped flood "
                f"zones exist within {mapped_at} mile(s), so the area carries effective NFHL "
                f"coverage. This is consistent with unshaded Zone X - outside the 0.2%-"
                f"annual-chance floodplain. Confirm against the effective FIRM panel.")
            fr["coverage"]["verdict"] = "likely Zone X (unshaded) - area is mapped"
        elif mapped_at is not None:
            fr["coverage"]["interpretation"] = (
                f"No flood-hazard polygon on or near this parcel; nearest mapped zone is "
                f"{mapped_at} miles away. Treat the flood zone as NOT ESTABLISHED from the "
                f"national layer and obtain a county FIRM / FEMA determination.")
            fr["coverage"]["verdict"] = "undetermined - sparse mapping"
        else:
            fr["coverage"]["interpretation"] = (
                "No effective NFHL flood-hazard polygons were returned within 15 miles. "
                "This location appears to lie outside FEMA's digital mapping. The flood "
                "zone is UNDETERMINED (functionally Zone D); obtain a county floodplain "
                "determination before relying on any flood conclusion.")
            fr["coverage"]["verdict"] = "unmapped / Zone D - undetermined"
        print(f"  {key}: => {fr['coverage']['verdict']}")
        flood[key] = fr
    save("flood.json", flood)
    print("\nsaved ->", DATA + "/flood.json")


if __name__ == "__main__":
    main()
