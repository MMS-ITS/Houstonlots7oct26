"""Resolve specific parcels that could not be matched by situs address.

Each entry below was located manually by scanning the StratMap parcel layer
(see 01b_probe.py) and is pinned by a point inside the parcel. The `expect`
string is asserted against the returned legal description so a silent mismatch
cannot slip through.
"""
import json
import urllib.parse

from common import fetch, load, save
from importlib import import_module

_p = import_module("01_parcels")

PINS = {
    # Private Road 52415, Leesburg -> Lot 05 Paradise Shores (Camp Co, Lake Bob Sandlin)
    "pr52415": dict(lon=-95.11432, lat=33.02356, expect="LOT 05 PARADISE SHORES"),
    # 141 Ward Rd, Justiceburg -> Lot 141 Oak Canyon (Garza Co, Lake Alan Henry)
    "ward141": dict(lon=None, lat=None, expect="LOT 141 OAK CANYON",
                    search=dict(lon=-101.0414, lat=33.0324, half=0.045, n=4)),
}


def point_identify(lon, lat):
    d = 0.0004
    p = {"f": "json",
         "geometry": json.dumps({"x": lon, "y": lat, "spatialReference": {"wkid": 4326}}),
         "geometryType": "esriGeometryPoint", "sr": "4326", "tolerance": "1",
         "mapExtent": f"{lon-d},{lat-d},{lon+d},{lat+d}",
         "imageDisplay": "1200,1200,96", "layers": "all",
         "returnGeometry": "true", "maxAllowableOffset": "0.0000015"}
    u = _p.SVC + "?" + urllib.parse.urlencode(p)
    return json.loads(fetch(u, timeout=120)).get("results", [])


def main():
    results = load("parcels.json", {}) or {}
    subj = {s["key"]: s for s in _p.SUBJECTS}

    for key, cfg in PINS.items():
        print(f"\n=== {key}: expecting {cfg['expect']!r}")
        found = None
        if cfg.get("lon") is not None:
            for r in point_identify(cfg["lon"], cfg["lat"]):
                if cfg["expect"].upper() in str(r["attributes"].get("LEGAL_DESC", "")).upper():
                    found = r
                    break
        if found is None and cfg.get("search"):
            s = cfg["search"]
            print("    pin miss -> harvesting area")
            for r in _p.harvest((s["lon"], s["lat"]), rings_deg=(0.02, 0.045)):
                if cfg["expect"].upper() in str(r["attributes"].get("LEGAL_DESC", "")).upper():
                    found = r
                    break
        if not found:
            print("    !! NOT RESOLVED")
            continue
        a = found["attributes"]
        print(f"    -> {a.get('SITUS_ADDR')!r} | {str(a.get('LEGAL_DESC'))[:85]} | {a.get('GIS_AREA')}")
        rec = {"subject": subj[key], "resolved_by": "manual pin / legal-desc match",
               "best": _p.summarise(found)}
        results[key] = rec
        save("parcels.json", results)
    print("\nkeys now:", sorted(results))


if __name__ == "__main__":
    main()
