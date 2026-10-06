"""FEMA National Flood Hazard Layer lookup per parcel.

Queries the parcel POLYGON (not just a centroid) so that split-zone lots are
detected, plus the governing FIRM panel and any nearby Base Flood Elevation
lines. Source: FEMA NFHL MapServer (hazards.fema.gov).
"""
import json
import sys
import urllib.parse

from common import DATA, fetch, load, save

BASE = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
LAYER_ZONE = 28     # Flood Hazard Zones  (S_FLD_HAZ_AR)
LAYER_PANEL = 3     # FIRM Panels
LAYER_BFE = 16      # Base Flood Elevations


def q(layer, geometry, gtype, out_fields, dist=None, timeout=120):
    p = {"f": "json", "geometry": json.dumps(geometry), "geometryType": gtype,
         "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
         "outFields": out_fields, "returnGeometry": "false"}
    if dist:
        p["distance"] = str(dist)
        p["units"] = "esriSRUnit_Foot"
    url = f"{BASE}/{layer}/query"
    body = urllib.parse.urlencode(p).encode()
    d = json.loads(fetch(url, data=body, timeout=timeout, retries=4,
                         headers={"Content-Type": "application/x-www-form-urlencoded"}))
    if "error" in d:
        raise RuntimeError(str(d["error"])[:200])
    return [f.get("attributes", {}) for f in d.get("features", [])]


SFHA_NOTE = {
    "A": "Special Flood Hazard Area. 1%-annual-chance floodplain, no detailed study; no published BFE.",
    "AE": "Special Flood Hazard Area. 1%-annual-chance floodplain with a published Base Flood Elevation.",
    "AO": "Special Flood Hazard Area. Shallow sheet-flow flooding with a published depth.",
    "AH": "Special Flood Hazard Area. Shallow ponding, 1-3 ft, with a published BFE.",
    "VE": "Coastal Special Flood Hazard Area subject to wave action (V zone).",
    "X": "Outside the 1%-annual-chance floodplain.",
    "OPEN WATER": "Mapped as open water.",
    "AREA NOT INCLUDED": "Area not included in the FEMA study.",
    "D": "Possible but undetermined flood hazard; no analysis performed.",
}


def main():
    parcels = load("parcels.json", {})
    only = sys.argv[1:] or None
    out = load("flood.json", {}) or {}
    for key, rec in parcels.items():
        if only and key not in only:
            continue
        best = rec.get("best")
        if not best or not best.get("rings"):
            print(f"-- {key}: no geometry, skipped")
            continue
        label = rec["subject"]["label"]
        print(f"\n=== {key} ({label})")
        poly = {"rings": best["rings"], "spatialReference": {"wkid": 4326}}
        cen = best["centroid"]
        pt = {"x": cen["lon"], "y": cen["lat"], "spatialReference": {"wkid": 4326}}
        r = {"queried": {"parcel_polygon": True, "centroid": cen}}
        try:
            zones = q(LAYER_ZONE, poly, "esriGeometryPolygon",
                      "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,VELOCITY,V_DATUM,LEN_UNIT,DFIRM_ID,FLD_AR_ID")
            r["zones_intersecting_parcel"] = zones
            print(f"    zones intersecting parcel: {len(zones)}")
            for z in zones:
                bfe = z.get("STATIC_BFE")
                bfe = None if bfe in (None, -9999, "-9999") else bfe
                print(f"      {z.get('FLD_ZONE')!r} subty={z.get('ZONE_SUBTY')!r} "
                      f"SFHA={z.get('SFHA_TF')} staticBFE={bfe} depth={z.get('DEPTH')}")
        except Exception as e:  # noqa: BLE001
            r["zones_error"] = str(e)[:200]
            print("    zone query failed:", str(e)[:140])
        try:
            zc = q(LAYER_ZONE, pt, "esriGeometryPoint",
                   "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DEPTH,DFIRM_ID")
            r["zone_at_centroid"] = zc
            print(f"    zone at centroid: {[z.get('FLD_ZONE') for z in zc]}")
        except Exception as e:  # noqa: BLE001
            r["zone_at_centroid_error"] = str(e)[:200]
        try:
            panels = q(LAYER_PANEL, pt, "esriGeometryPoint",
                       "FIRM_PAN,PANEL,SUFFIX,EFF_DATE,DFIRM_ID,PRE_DATE,SCALE,PANEL_TYP")
            r["firm_panels"] = panels
            for p_ in panels:
                print(f"    FIRM panel {p_.get('FIRM_PAN')} eff={p_.get('EFF_DATE')} type={p_.get('PANEL_TYP')}")
        except Exception as e:  # noqa: BLE001
            r["firm_panel_error"] = str(e)[:200]
        try:
            bfes = q(LAYER_BFE, pt, "esriGeometryPoint", "ELEV,LEN_UNIT,V_DATUM,DFIRM_ID", dist=2000)
            r["bfe_lines_within_2000ft"] = bfes
            if bfes:
                els = [b.get("ELEV") for b in bfes if b.get("ELEV") not in (None, -9999)]
                print(f"    BFE lines within 2000 ft: {len(bfes)} elevations={sorted(set(els))[:12]}")
            else:
                print("    BFE lines within 2000 ft: none")
        except Exception as e:  # noqa: BLE001
            r["bfe_error"] = str(e)[:200]
        # summarise
        zl = r.get("zones_intersecting_parcel") or r.get("zone_at_centroid") or []
        zset = sorted({str(z.get("FLD_ZONE")) for z in zl if z.get("FLD_ZONE")})
        sfha = any(str(z.get("SFHA_TF")).upper() in ("T", "TRUE", "Y") for z in zl)
        statics = [z.get("STATIC_BFE") for z in zl
                   if z.get("STATIC_BFE") not in (None, -9999, "-9999", 0)]
        r["summary"] = {
            "zones": zset,
            "split_zone": len(zset) > 1,
            "in_sfha": sfha,
            "static_bfe_ft": statics or None,
            "notes": [SFHA_NOTE.get(z.upper(), "") for z in zset],
            "source": "FEMA NFHL (hazards.fema.gov), queried against the parcel polygon",
        }
        print(f"    => zones={zset} SFHA={sfha} split={len(zset) > 1}")
        out[key] = r
        save("flood.json", out)
    print("\nsaved ->", DATA + "/flood.json")


if __name__ == "__main__":
    main()
