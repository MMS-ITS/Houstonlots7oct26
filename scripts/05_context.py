"""Locational context per parcel.

  - Nearest NHD waterbody (name, type, area) and distance from the parcel edge,
    plus whether the parcel itself intersects mapped water  -> items 24-25
  - 30-year climate normals computed from ERA5 daily reanalysis (Open-Meteo)
    reported in degrees C as the brief requires                -> item 46
  - County / tract identifiers from the Census geocoder and ACS 5-year
    demographics                                              -> item 48
"""
import json
import statistics
import sys
import urllib.parse

from common import DATA, fetch, haversine_ft, load, save

NHD = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer"
WB_LAYER = 12          # Waterbody - Large Scale
AREA_LAYER = 9         # Area - Large Scale (includes stream/river areas)


def esri_query(layer, geom, gtype, fields, dist_ft=None, want_geom=True, timeout=180):
    p = {"f": "json", "geometry": json.dumps(geom), "geometryType": gtype, "inSR": "4326",
         "outSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": fields,
         "returnGeometry": "true" if want_geom else "false"}
    if dist_ft:
        p["distance"] = str(dist_ft)
        p["units"] = "esriSRUnit_Foot"
    d = json.loads(fetch(f"{NHD}/{layer}/query", data=urllib.parse.urlencode(p).encode(),
                         timeout=timeout, retries=4,
                         headers={"Content-Type": "application/x-www-form-urlencoded"}))
    if "error" in d:
        raise RuntimeError(str(d["error"])[:180])
    return d.get("features", [])


def attr(a, name):
    """NHD returns UPPERCASE attribute keys; be case-insensitive."""
    if name in a:
        return a[name]
    low = {k.lower(): v for k, v in a.items()}
    return low.get(name.lower())


def min_dist_ft(ring, feature):
    """Smallest distance from any parcel vertex to any waterbody vertex."""
    g = feature.get("geometry") or {}
    best = None
    for key in ("rings", "paths"):
        for part in g.get(key, []) or []:
            for pt in part:
                for v in ring:
                    d = haversine_ft((v[0], v[1]), (pt[0], pt[1]))
                    if best is None or d < best:
                        best = d
    return best


def waterbodies(ring, centroid):
    pt = {"x": centroid["lon"], "y": centroid["lat"], "spatialReference": {"wkid": 4326}}
    poly = {"rings": [ring], "spatialReference": {"wkid": 4326}}
    out = {"intersects_parcel": [], "nearby": []}
    try:
        hits = esri_query(WB_LAYER, poly, "esriGeometryPolygon",
                          "gnis_name,ftype,fcode,areasqkm,permanent_identifier")
        for f in hits:
            a = f["attributes"]
            out["intersects_parcel"].append(
                {"name": attr(a, "gnis_name"), "ftype": attr(a, "ftype"),
                 "area_sqkm": attr(a, "areasqkm"), "distance_ft": 0})
    except Exception as e:  # noqa: BLE001
        out["intersect_error"] = str(e)[:160]
    errors = []
    for radius in (500, 1500, 5280, 15840):
        hits = None
        for attempt in range(3):
            try:
                hits = esri_query(WB_LAYER, pt, "esriGeometryPoint",
                                  "gnis_name,ftype,fcode,areasqkm,permanent_identifier",
                                  dist_ft=radius)
                break
            except Exception as e:  # noqa: BLE001
                errors.append(f"r={radius} try{attempt}: {str(e)[:90]}")
        if hits is None:
            continue          # transient failure: widen rather than give up
        if hits:
            seen = set()
            for f in hits:
                a = f["attributes"]
                d = min_dist_ft(ring, f)
                k = (attr(a, "gnis_name"), attr(a, "ftype"), attr(a, "areasqkm"))
                if k in seen:
                    continue
                seen.add(k)
                out["nearby"].append({"name": attr(a, "gnis_name"), "ftype": attr(a, "ftype"),
                                      "area_sqkm": attr(a, "areasqkm"),
                                      "distance_ft": None if d is None else round(d, 1)})
            out["nearby"].sort(key=lambda r: (r["distance_ft"] is None, r["distance_ft"]))
            out["search_radius_ft"] = radius
            break
    if errors:
        out["query_retries"] = errors
    return out


def climate(lat, lon):
    u = ("https://archive-api.open-meteo.com/v1/archive"
         f"?latitude={lat:.4f}&longitude={lon:.4f}"
         "&start_date=1994-01-01&end_date=2023-12-31"
         "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
         "&timezone=America%2FChicago&temperature_unit=celsius&precipitation_unit=mm")
    d = json.loads(fetch(u, timeout=240, retries=4))["daily"]
    tmax = [v for v in d["temperature_2m_max"] if v is not None]
    tmin = [v for v in d["temperature_2m_min"] if v is not None]
    pr = [v for v in d["precipitation_sum"] if v is not None]
    times = d["time"]
    years = len({t[:4] for t in times})
    # monthly aggregation
    mon = {}
    for i, t in enumerate(times):
        m = int(t[5:7])
        mx = d["temperature_2m_max"][i]; mn = d["temperature_2m_min"][i]
        p = d["precipitation_sum"][i]
        s = mon.setdefault(m, {"mx": [], "mn": [], "p": []})
        if mx is not None: s["mx"].append(mx)
        if mn is not None: s["mn"].append(mn)
        if p is not None: s["p"].append(p)
    monthly = []
    for m in range(1, 13):
        s = mon.get(m, {"mx": [], "mn": [], "p": []})
        monthly.append({
            "month": m,
            "tmax_c": round(statistics.mean(s["mx"]), 1) if s["mx"] else None,
            "tmin_c": round(statistics.mean(s["mn"]), 1) if s["mn"] else None,
            "precip_mm": round(sum(s["p"]) / years, 1) if s["p"] else None,
        })
    # Growing season, computed PER YEAR then averaged. Averaging daily minima
    # across 30 years first would smooth away real freezes and overstate the season.
    by_year = {}
    for i, t in enumerate(times):
        v = d["temperature_2m_min"][i]
        if v is None:
            continue
        by_year.setdefault(t[:4], []).append((t, v))
    seasons, freeze_days = [], []
    for y, rows in by_year.items():
        rows.sort()
        if len(rows) < 300:
            continue
        freezes = [idx for idx, (t, v) in enumerate(rows) if v <= 0.0]
        freeze_days.append(len(freezes))
        if not freezes:
            seasons.append(len(rows))
            continue
        mid = len(rows) // 2
        spring = [i for i in freezes if i < mid]
        fall = [i for i in freezes if i >= mid]
        last_spring = max(spring) if spring else 0
        first_fall = min(fall) if fall else len(rows) - 1
        seasons.append(max(0, first_fall - last_spring - 1))
    frostfree = round(statistics.mean(seasons)) if seasons else None
    mean_freeze_days = round(statistics.mean(freeze_days), 1) if freeze_days else None
    summer = [v for i, v in enumerate(d["temperature_2m_max"])
              if v is not None and times[i][5:7] in ("06", "07", "08")]
    winter = [v for i, v in enumerate(d["temperature_2m_min"])
              if v is not None and times[i][5:7] in ("12", "01", "02")]
    return {
        "period": "1994-2023 (30 years)",
        "source": "ERA5 daily reanalysis via Open-Meteo archive API",
        "mean_annual_temp_c": round((statistics.mean(tmax) + statistics.mean(tmin)) / 2, 1),
        "mean_summer_high_c": round(statistics.mean(summer), 1) if summer else None,
        "mean_winter_low_c": round(statistics.mean(winter), 1) if winter else None,
        "record_high_c": round(max(tmax), 1),
        "record_low_c": round(min(tmin), 1),
        "mean_annual_precip_mm": round(sum(pr) / years, 1),
        "mean_annual_precip_in": round(sum(pr) / years / 25.4, 1),
        "mean_growing_season_days": frostfree,
        "mean_days_at_or_below_0c_per_year": mean_freeze_days,
        "monthly": monthly,
    }


def census_geo(lat, lon):
    u = ("https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
         f"?x={lon}&y={lat}&benchmark=Public_AR_Current&vintage=Current_Current"
         "&layers=all&format=json")
    d = json.loads(fetch(u, timeout=120, retries=3))
    g = d.get("result", {}).get("geographies", {})
    out = {}
    for k in ("Counties", "Census Tracts", "States",
              "Incorporated Places", "County Subdivisions",
              "Unified School Districts", "2020 Census Blocks"):
        if g.get(k):
            e = g[k][0]
            out[k] = {kk: e.get(kk) for kk in
                      ("NAME", "BASENAME", "GEOID", "STATE", "COUNTY", "TRACT", "LSADC")
                      if e.get(kk) is not None}
    return out


ACS_VARS = {
    "B01003_001E": "total_population",
    "B19013_001E": "median_household_income_usd",
    "B25077_001E": "median_home_value_usd",
    "B01002_001E": "median_age_years",
    "B25003_001E": "occupied_housing_units",
    "B11001_001E": "total_households",
    "B02001_005E": "population_asian_alone",
    "B02001_002E": "population_white_alone",
    "B02001_003E": "population_black_alone",
    "B03003_003E": "population_hispanic_latino",
    "B05006_047E": "foreign_born_india",
}


def acs(state_fips, county_fips):
    """Attempt ACS 5-year county demographics.

    The Census API began rejecting keyless requests ('Missing Key'), so this
    usually returns a not_retrieved marker rather than data. It is left in place
    so the report can be refreshed by setting CENSUS_API_KEY.
    """
    import os
    var = ",".join(ACS_VARS)
    key = os.environ.get("CENSUS_API_KEY", "").strip()
    u = (f"https://api.census.gov/data/2023/acs/acs5?get=NAME,{var}"
         f"&for=county:{county_fips}&in=state:{state_fips}")
    if key:
        u += f"&key={key}"
    try:
        txt = fetch(u, timeout=120, retries=2)
        if txt.lstrip().startswith("<"):
            raise RuntimeError("Census API requires an API key (keyless request rejected)")
        d = json.loads(txt)
    except Exception as e:  # noqa: BLE001
        return {"status": "not_retrieved",
                "reason": str(e)[:160],
                "how_to_obtain": ("Free key from https://api.census.gov/data/key_signup.html, "
                                  "then set CENSUS_API_KEY and re-run 05_context.py. "
                                  "Or read the figures directly from data.census.gov."),
                "source": "US Census Bureau ACS 5-year"}
    hdr, row = d[0], d[1]
    rec = dict(zip(hdr, row))
    out = {"status": "ok", "name": rec.get("NAME"), "vintage": "ACS 5-year 2019-2023",
           "source": "US Census Bureau API"}
    for code, label in ACS_VARS.items():
        v = rec.get(code)
        try:
            v = None if v is None else float(v)
            if v is not None and v < -1e6:
                v = None
        except (TypeError, ValueError):
            pass
        out[label] = v
    return out


def main():
    parcels = load("parcels.json", {})
    only = sys.argv[1:] or None
    out = load("context.json", {}) or {}
    for key, rec in parcels.items():
        if only and key not in only:
            continue
        best = rec.get("best")
        if not best or not best.get("ring"):
            print(f"-- {key}: no geometry, skipped")
            continue
        ring = best["ring"]; cen = best["centroid"]
        print(f"\n=== {key} ({rec['subject']['label']})")
        r = out.get(key, {})
        try:
            r["water"] = waterbodies(ring, cen)
            ip = r["water"]["intersects_parcel"]
            nb = r["water"]["nearby"][:4]
            print(f"    water on parcel: {[(x['name'], x['ftype']) for x in ip]}")
            print(f"    nearest water: {[(x['name'], x['ftype'], x['distance_ft']) for x in nb]}")
        except Exception as e:  # noqa: BLE001
            r["water_error"] = str(e)[:200]; print("    water ERR", str(e)[:140])
        try:
            r["climate"] = climate(cen["lat"], cen["lon"])
            c = r["climate"]
            print(f"    climate: mean {c['mean_annual_temp_c']}C, summer high "
                  f"{c['mean_summer_high_c']}C, winter low {c['mean_winter_low_c']}C, "
                  f"precip {c['mean_annual_precip_mm']}mm, growing season "
                  f"~{c['mean_growing_season_days']}d, freeze days "
                  f"{c['mean_days_at_or_below_0c_per_year']}/yr")
        except Exception as e:  # noqa: BLE001
            r["climate_error"] = str(e)[:200]; print("    climate ERR", str(e)[:140])
        try:
            geo = census_geo(cen["lat"], cen["lon"])
            r["census_geo"] = geo
            co = geo.get("Counties", {})
            print(f"    county: {co.get('NAME')} (FIPS {co.get('STATE')}{co.get('COUNTY')})")
            if co.get("STATE") and co.get("COUNTY"):
                r["acs"] = acs(co["STATE"], co["COUNTY"])
                a = r["acs"]
                if a.get("status") == "ok":
                    print(f"    ACS: pop={a.get('total_population')} "
                          f"MHI=${a.get('median_household_income_usd')} "
                          f"medhome=${a.get('median_home_value_usd')}")
                else:
                    print(f"    ACS: NOT RETRIEVED ({a.get('reason', '')[:70]})")
        except Exception as e:  # noqa: BLE001
            r["census_error"] = str(e)[:200]; print("    census ERR", str(e)[:140])
        out[key] = r
        save("context.json", out)
    print("\nsaved ->", DATA + "/context.json")


if __name__ == "__main__":
    main()
