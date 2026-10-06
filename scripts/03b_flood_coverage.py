"""Distinguish 'outside the floodplain' from 'not mapped by FEMA'.

An empty Flood Hazard Zones result is ambiguous: it can mean the parcel sits in
unshaded Zone X that was not digitised as a polygon, or that the county has no
effective NFHL data at all. Layer 0 (NFHL Availability) resolves this.
"""
import json
import urllib.parse

from common import DATA, fetch, load, save

BASE = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"


def q(layer, geom, gtype, fields, dist=None):
    p = {"f": "json", "geometry": json.dumps(geom), "geometryType": gtype, "inSR": "4326",
         "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "returnGeometry": "false"}
    if dist:
        p["distance"] = str(dist); p["units"] = "esriSRUnit_Foot"
    d = json.loads(fetch(f"{BASE}/{layer}/query", data=urllib.parse.urlencode(p).encode(),
                         timeout=120, retries=4,
                         headers={"Content-Type": "application/x-www-form-urlencoded"}))
    if "error" in d:
        return {"error": str(d["error"])[:160]}
    return [f.get("attributes", {}) for f in d.get("features", [])]


def main():
    parcels = load("parcels.json", {})
    flood = load("flood.json", {})
    for key, rec in parcels.items():
        best = rec.get("best")
        if not best or not best.get("centroid"):
            continue
        cen = best["centroid"]
        pt = {"x": cen["lon"], "y": cen["lat"], "spatialReference": {"wkid": 4326}}
        fr = flood.get(key, {})
        zones = fr.get("summary", {}).get("zones") or []
        avail = q(0, pt, "esriGeometryPoint", "DFIRM_ID,STATUS,PRELIM,JURISDICTION_NAME,PRODUCT_TYPE")
        near = q(28, pt, "esriGeometryPoint", "FLD_ZONE,ZONE_SUBTY,SFHA_TF", dist=5280)
        print(f"\n=== {key} ({rec['subject']['label']})")
        print(f"    existing zones: {zones}")
        print(f"    NFHL availability: {json.dumps(avail)[:400]}")
        zn = sorted({str(z.get('FLD_ZONE')) + '/' + str(z.get('ZONE_SUBTY')) for z in near}) if isinstance(near, list) else near
        print(f"    zones within 1 mile: {zn}")
        fr.setdefault("coverage", {})
        fr["coverage"]["nfhl_availability"] = avail
        fr["coverage"]["zones_within_1mi"] = near
        if not zones:
            if isinstance(avail, list) and avail:
                fr["coverage"]["interpretation"] = (
                    "County has effective NFHL coverage but no flood-hazard polygon "
                    "intersects this parcel. Consistent with unshaded Zone X (outside the "
                    "0.2%-annual-chance floodplain). Confirm on the effective FIRM panel.")
            else:
                fr["coverage"]["interpretation"] = (
                    "No effective NFHL data returned for this location. Flood zone is "
                    "UNDETERMINED from the national layer; obtain the county FIRM or a "
                    "FEMA flood determination.")
            print("    ->", fr["coverage"]["interpretation"][:120])
        flood[key] = fr
    save("flood.json", flood)
    print("\nsaved ->", DATA + "/flood.json")


if __name__ == "__main__":
    main()
