"""USDA NRCS soil characterisation per parcel via Soil Data Access (SDA).

Collects, for every map unit intersecting the parcel polygon:
  - map unit name/symbol and which units occur inside the lot (sampled grid)
  - component taxonomy, drainage class, hydrologic group, slope range,
    flooding/ponding frequency, depth to water table and to bedrock
  - horizon data: depth, texture, pH, clay/sand/silt, organic matter,
    saturated conductivity and linear extensibility (shrink-swell)
  - NRCS engineering interpretations relevant to this brief: dwellings,
    septic absorption fields / leaching chambers / drip, shallow excavations,
    lawns & landscaping, local roads, and GPR penetration.
"""
import json
import sys
import urllib.parse

from common import DATA, fetch, load, point_in_ring, save

SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"

INTERP_RULES = [
    "ENG - Dwellings Without Basements",
    "ENG - Dwellings With Basements",
    "ENG - Septic Tank Absorption Fields",
    "ENG - Septic Tank Leaching Chamber (TX)",
    "ENG - Septic Tank, Subsurface Drip Irrigation (TX)",
    "ENG - Shallow Excavations",
    "ENG - Lawn, Landscape, Golf Fairway",
    "ENG - Unpaved Local Roads and Streets",
    "URB - Commercial Metal Bldg; w/Reinforced Concrete Slab (TX)",
    "Ground Penetrating Radar Penetration",
]


def sql(query, tries=3):
    body = urllib.parse.urlencode({"query": query, "format": "JSON+COLUMNNAME"}).encode()
    txt = fetch(SDA, data=body, timeout=200, retries=tries,
                headers={"Content-Type": "application/x-www-form-urlencoded"})
    d = json.loads(txt)
    t = d.get("Table") or []
    if not t:
        return []
    hdr = t[0]
    return [dict(zip(hdr, row)) for row in t[1:]]


def wkt_poly(ring):
    pts = ", ".join(f"{x:.7f} {y:.7f}" for x, y in ring)
    if ring[0] != ring[-1]:
        pts += f", {ring[0][0]:.7f} {ring[0][1]:.7f}"
    return f"polygon(({pts}))"


def grid_points_inside(ring, n=6):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    out = []
    for i in range(n):
        for j in range(n):
            x = x0 + (x1 - x0) * (i + 0.5) / n
            y = y0 + (y1 - y0) * (j + 0.5) / n
            if point_in_ring((x, y), ring):
                out.append((x, y))
    return out


def mukey_distribution(ring, limit=18):
    pts = grid_points_inside(ring)
    if not pts:
        return {}
    step = max(1, len(pts) // limit)
    pts = pts[::step][:limit]
    parts = [f"SELECT {i} AS idx, * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84"
             f"('point({x:.7f} {y:.7f})')" for i, (x, y) in enumerate(pts)]
    rows = sql(" UNION ALL ".join(parts))
    counts = {}
    for r in rows:
        mk = str(r.get("mukey"))
        counts[mk] = counts.get(mk, 0) + 1
    tot = sum(counts.values()) or 1
    return {k: round(100.0 * v / tot, 1) for k, v in
            sorted(counts.items(), key=lambda kv: -kv[1])}


def main():
    parcels = load("parcels.json", {})
    only = sys.argv[1:] or None
    out = load("soil.json", {}) or {}
    for key, rec in parcels.items():
        if only and key not in only:
            continue
        best = rec.get("best")
        if not best or not best.get("ring"):
            print(f"-- {key}: no geometry, skipped")
            continue
        ring = best["ring"]
        print(f"\n=== {key} ({rec['subject']['label']})")
        r = {}
        try:
            wkt = wkt_poly(ring)
            mus = sql(f"""SELECT mu.mukey, mu.muname, mu.musym, l.areasymbol, l.areaname
FROM mapunit mu JOIN legend l ON l.lkey = mu.lkey
WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('{wkt}'))""")
            r["mapunits"] = mus
            print(f"    map units intersecting parcel: {len(mus)}")
            for m in mus:
                print(f"      [{m['mukey']}] {m['muname']}")
            if not mus:
                out[key] = r; save("soil.json", out); continue

            r["coverage_pct_by_mukey"] = mukey_distribution(ring)
            print(f"    sampled coverage: {r['coverage_pct_by_mukey']}")

            mklist = ",".join(f"'{m['mukey']}'" for m in mus)
            # map-unit level aggregates (flooding, ponding, water table, bedrock)
            r["muaggatt"] = sql(f"""SELECT mukey, muname, drclassdcd, drclasswettest, hydgrpdcd,
 flodfreqdcd, flodfreqmax, pondfreqprs, wtdepannmin, wtdepaprjunmin,
 brockdepmin, aws025wta, aws0100wta, slopegraddcp, slopegradwta
FROM muaggatt WHERE mukey IN ({mklist})""")
            for m in r["muaggatt"]:
                print(f"      AGG [{m['mukey']}] flood={m['flodfreqdcd']} pond={m['pondfreqprs']} "
                      f"wt_min={m['wtdepannmin']}cm bedrock={m['brockdepmin']}cm drain={m['drclassdcd']}")

            comps = sql(f"""SELECT c.mukey, c.cokey, c.compname, c.comppct_r, c.compkind,
 c.drainagecl, c.hydgrp, c.taxclname, c.taxorder, c.taxsubgrp,
 c.slope_l, c.slope_r, c.slope_h, c.runoff, c.erocl, c.hydricrating,
 c.tfact, c.nirrcapcl, c.nirrcapscl, c.frostact, c.corcon, c.corsteel
FROM component c WHERE c.mukey IN ({mklist}) AND c.majcompflag='Yes'
ORDER BY c.mukey, c.comppct_r DESC""")
            r["components"] = comps
            print(f"    major components: {len(comps)}")
            for c in comps:
                print(f"      {c['compname']:16s} {c['comppct_r']}% drain={c['drainagecl']} "
                      f"hyd={c['hydgrp']} slope={c['slope_l']}-{c['slope_h']}%")
                print(f"         taxonomy: {c.get('taxclname')}")

            if comps:
                cokeys = ",".join(f"'{c['cokey']}'" for c in comps)
                r["horizons"] = sql(f"""SELECT ch.cokey, ch.chkey, ch.hzname, ch.hzdept_r, ch.hzdepb_r,
 ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r, ch.om_r,
 ch.ph1to1h2o_r, ch.ksat_r, ch.lep_r, ch.awc_r, ch.dbthirdbar_r,
 ch.caco3_r, ch.cec7_r, ch.sar_r, ch.ec_r
FROM chorizon ch WHERE ch.cokey IN ({cokeys}) ORDER BY ch.cokey, ch.hzdept_r""")
                print(f"    horizons: {len(r['horizons'])}")
                r["restrictions"] = sql(f"""SELECT cr.cokey, cr.reskind, cr.reshard, cr.resdept_r, cr.resdepb_r
FROM corestrictions cr WHERE cr.cokey IN ({cokeys}) ORDER BY cr.cokey, cr.resdept_r""")
                print(f"    restrictive layers: {len(r['restrictions'])}")
                for x in r["restrictions"]:
                    print(f"      {x['reskind']} at {x['resdept_r']} cm ({x['reshard']})")
                rules = ",".join(f"'{x}'" for x in INTERP_RULES)
                r["interpretations"] = sql(f"""SELECT ci.cokey, ci.mrulename, ci.interphr, ci.interphrc
FROM cointerp ci WHERE ci.cokey IN ({cokeys}) AND ci.ruledepth=0
 AND ci.mrulename IN ({rules}) ORDER BY ci.cokey, ci.mrulename""")
                print(f"    interpretations: {len(r['interpretations'])}")
                dom = comps[0]["cokey"]
                for x in r["interpretations"]:
                    if x["cokey"] == dom:
                        print(f"      {x['mrulename'][:52]:54s} -> {x['interphrc']}")
        except Exception as e:  # noqa: BLE001
            r["error"] = str(e)[:300]
            print("    ERROR:", str(e)[:200])
        out[key] = r
        save("soil.json", out)
    print("\nsaved ->", DATA + "/soil.json")


if __name__ == "__main__":
    main()
