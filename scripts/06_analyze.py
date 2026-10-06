"""Derive the engineering conclusions the brief asks for from the collected data.

Every derived value records what it came from and how reliable it is, so a
model-derived contour is never presented as a survey. Three provenance tiers:

  OFFICIAL  - published by the agency of record (FEMA zone, county parcel record)
  MODEL     - computed here from authoritative inputs (3DEP DEM, NRCS polygons)
  REQUIRED  - cannot be established remotely; needs a licensed professional
              or a county/HOA document
"""
import json
import math

from common import DATA, load, save

# --- item 7: terrain classification bands (percent grade) -------------------
TERRAIN_BANDS = [
    (0.5, "Flat", "Essentially level. Positive drainage must be engineered; sheet flow and ponding are the concern, not slope."),
    (2.0, "Nearly flat", "Minimal grading. Establish fall away from the structure."),
    (5.0, "Gentle slope", "Standard residential grading is normally sufficient."),
    (10.0, "Moderate slope", "Expect cut-and-fill balancing and possibly a stepped footing."),
    (20.0, "Steep slope", "Significant site engineering: retaining walls, terracing, erosion control."),
    (1e9, "Very steep slope", "Extensive engineering. Driveway grade, retaining structures and slope stability all govern buildability."),
]

GRADING_BY_BAND = {
    "Flat": ["Minimal grading", "Drainage shaping / swales"],
    "Nearly flat": ["Minimal grading"],
    "Gentle slope": ["Minimal grading", "Routine cut-and-fill"],
    "Moderate slope": ["Significant grading", "Cut-and-fill"],
    "Steep slope": ["Cut-and-fill", "Retaining walls", "Extensive site engineering"],
    "Very steep slope": ["Retaining walls", "Extensive site engineering", "Geotechnical slope review"],
}


def classify_terrain(mean_pct, p90_pct, relief_ft):
    band, note = None, None
    for lim, nm, nt in TERRAIN_BANDS:
        if mean_pct is not None and mean_pct <= lim:
            band, note = nm, nt
            break
    out = {"band": band, "note": note,
           "basis": f"mean DEM grade {mean_pct}% (90th pct {p90_pct}%), relief {relief_ft} ft",
           "grading_expectation": GRADING_BY_BAND.get(band, []),
           "tier": "MODEL"}
    if p90_pct is not None and band and p90_pct > 20 and band in ("Flat", "Nearly flat", "Gentle slope"):
        out["caveat"] = (f"Mean grade is low but the 90th-percentile grade is {p90_pct}%, "
                         f"so steep sub-areas exist within the lot. Siting matters.")
    return out


# --- shrink-swell interpretation from linear extensibility (LEP, %) ---------
def swell_class(lep):
    if lep is None:
        return None, None
    if lep < 3:
        return "Low", "Conventional slab-on-grade is normally viable."
    if lep < 6:
        return "Moderate", "Stiffened/post-tensioned slab or moisture-conditioned subgrade is typical."
    if lep < 9:
        return "High", "Engineered foundation expected: post-tensioned slab or pier-and-beam."
    return "Very high", "Severe movement potential. Deep piers or heavily engineered slab; geotechnical design required."


def soil_summary(soil):
    if not soil or soil.get("error") or not soil.get("components"):
        return {"status": "unavailable", "tier": "REQUIRED"}
    comps = soil["components"]
    hz = soil.get("horizons") or []
    by_co = {}
    for h in hz:
        by_co.setdefault(h["cokey"], []).append(h)
    cov = soil.get("coverage_pct_by_mukey") or {}
    # dominant component = highest comppct within the most-covering mapunit
    dom_mu = max(cov, key=cov.get) if cov else (comps[0]["mukey"] if comps else None)
    dom = None
    for c in comps:
        if str(c["mukey"]) == str(dom_mu):
            if dom is None or _num(c.get("comppct_r")) > _num(dom.get("comppct_r")):
                dom = c
    dom = dom or comps[0]

    out = {"status": "ok", "tier": "MODEL",
           "dominant_component": dom.get("compname"),
           "dominant_mukey": dom.get("mukey"),
           "coverage_pct_by_mukey": cov,
           "mapunits": [{"mukey": m["mukey"], "muname": m["muname"],
                         "pct_of_lot": cov.get(str(m["mukey"]))}
                        for m in soil.get("mapunits", [])],
           "components": []}

    for c in comps:
        rows = sorted(by_co.get(c["cokey"], []), key=lambda r: _num(r.get("hzdept_r")))
        lep_vals = [_num(r.get("lep_r")) for r in rows if r.get("lep_r") is not None]
        lep_max = max(lep_vals) if lep_vals else None
        sc, sn = swell_class(lep_max)
        ph = [_num(r.get("ph1to1h2o_r")) for r in rows if r.get("ph1to1h2o_r") is not None]
        clay = [_num(r.get("claytotal_r")) for r in rows if r.get("claytotal_r") is not None]
        sand = [_num(r.get("sandtotal_r")) for r in rows if r.get("sandtotal_r") is not None]
        silt = [_num(r.get("silttotal_r")) for r in rows if r.get("silttotal_r") is not None]
        om = [_num(r.get("om_r")) for r in rows if r.get("om_r") is not None]
        ksat = [_num(r.get("ksat_r")) for r in rows if r.get("ksat_r") is not None]
        interp = {i["mrulename"]: i["interphrc"]
                  for i in (soil.get("interpretations") or []) if i["cokey"] == c["cokey"]}
        restr = [r for r in (soil.get("restrictions") or []) if r["cokey"] == c["cokey"]]
        agg = next((m for m in (soil.get("muaggatt") or [])
                    if str(m["mukey"]) == str(c["mukey"])), {})
        out["components"].append({
            "name": c.get("compname"), "pct": _num(c.get("comppct_r")),
            "mukey": c.get("mukey"),
            "drainage": c.get("drainagecl"), "hydgroup": c.get("hydgrp"),
            "taxonomy": c.get("taxclname"), "taxorder": c.get("taxorder"),
            "slope_range_pct": [_num(c.get("slope_l")), _num(c.get("slope_h"))],
            "runoff": c.get("runoff"), "hydric": c.get("hydricrating"),
            "surface_texture": rows[0].get("hzname") if rows else None,
            "lep_max_pct": lep_max, "shrink_swell": sc, "shrink_swell_note": sn,
            "ph_surface": ph[0] if ph else None,
            "ph_range": [min(ph), max(ph)] if ph else None,
            "clay_pct_surface": clay[0] if clay else None,
            "sand_pct_surface": sand[0] if sand else None,
            "silt_pct_surface": silt[0] if silt else None,
            "om_pct_surface": om[0] if om else None,
            "ksat_max_um_s": max(ksat) if ksat else None,
            "flooding_frequency": agg.get("flodfreqdcd"),
            "ponding": agg.get("pondfreqprs"),
            "water_table_min_cm": _num(agg.get("wtdepannmin")),
            "bedrock_min_cm": _num(agg.get("brockdepmin")),
            "restrictive_layers": [{"kind": r["reskind"], "depth_cm": _num(r["resdept_r"]),
                                    "hardness": r["reshard"]} for r in restr],
            "interpretations": interp,
            "horizons": [{"hzname": r.get("hzname"), "top_cm": _num(r.get("hzdept_r")),
                          "bottom_cm": _num(r.get("hzdepb_r")),
                          "clay": _num(r.get("claytotal_r")), "sand": _num(r.get("sandtotal_r")),
                          "silt": _num(r.get("silttotal_r")), "om": _num(r.get("om_r")),
                          "ph": _num(r.get("ph1to1h2o_r")), "ksat": _num(r.get("ksat_r")),
                          "lep": _num(r.get("lep_r")), "awc": _num(r.get("awc_r"))}
                         for r in rows],
        })
    d = out["components"][0] if out["components"] else {}
    out["headline"] = {
        "shrink_swell": d.get("shrink_swell"),
        "drainage": d.get("drainage"),
        "hydgroup": d.get("hydgroup"),
        "septic_absorption": d.get("interpretations", {}).get("ENG - Septic Tank Absorption Fields"),
        "dwellings_no_basement": d.get("interpretations", {}).get("ENG - Dwellings Without Basements"),
        "gpr_penetration": d.get("interpretations", {}).get("Ground Penetrating Radar Penetration"),
    }
    return out


def _num(v):
    try:
        if v in (None, "", "None"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


FOUNDATION_MATRIX = {
    "Low": {"Slab-on-grade": "Suitable", "Crawlspace": "Suitable", "Pier and beam": "Suitable",
            "Basement": "Site-specific", "Stepped footing": "Only if sloped"},
    "Moderate": {"Slab-on-grade": "Stiffened / post-tensioned", "Crawlspace": "Suitable",
                 "Pier and beam": "Suitable", "Basement": "Not advised",
                 "Stepped footing": "Only if sloped"},
    "High": {"Slab-on-grade": "Engineered post-tensioned only", "Crawlspace": "Suitable with piers",
             "Pier and beam": "Preferred", "Basement": "Not advised",
             "Stepped footing": "Only if sloped"},
    "Very high": {"Slab-on-grade": "Engineered design mandatory",
                  "Crawlspace": "Deep piers required", "Pier and beam": "Preferred, deep piers",
                  "Basement": "Not advised", "Stepped footing": "Only if sloped"},
}


def flood_analysis(flood, elev):
    """Compare DEM ground elevations with FEMA BFE and derive FFE scenarios."""
    out = {"tier": "OFFICIAL+MODEL"}
    summ = (flood or {}).get("summary", {}) or {}
    cov = (flood or {}).get("coverage", {}) or {}
    zones = summ.get("zones") or []
    out["zones"] = zones
    out["in_sfha"] = summ.get("in_sfha")
    out["split_zone"] = summ.get("split_zone")
    out["coverage_verdict"] = cov.get("verdict")
    out["coverage_note"] = cov.get("interpretation")
    panels = (flood or {}).get("firm_panels") or []
    if panels:
        p = panels[0]
        eff = p.get("EFF_DATE")
        try:
            import datetime
            eff_s = datetime.datetime.utcfromtimestamp(int(eff) / 1000).strftime("%Y-%m-%d") if eff else None
        except Exception:  # noqa: BLE001
            eff_s = str(eff)
        out["firm_panel"] = {"panel": p.get("FIRM_PAN"), "effective_date": eff_s,
                             "type": p.get("PANEL_TYP")}
    # BFE candidates
    statics = summ.get("static_bfe_ft") or []
    lines = [b.get("ELEV") for b in ((flood or {}).get("bfe_lines_within_2000ft") or [])
             if b.get("ELEV") not in (None, -9999)]
    bfe = None
    bfe_src = None
    if statics:
        bfe = max(_num(s) for s in statics if _num(s) is not None)
        bfe_src = "STATIC_BFE attribute on the flood-hazard polygon"
    elif lines:
        bfe = max(_num(x) for x in lines if _num(x) is not None)
        bfe_src = (f"highest of {len(set(lines))} FEMA BFE line value(s) within 2,000 ft "
                   f"({sorted(set(lines))}) - indicative only, the governing BFE must be "
                   f"read at the site from the FIRM/FIS profile")
    out["bfe_ft"] = bfe
    out["bfe_source"] = bfe_src
    out["bfe_lines_nearby_ft"] = sorted(set(lines)) or None

    p = (elev or {}).get("parcel") or {}
    out["ground"] = {"min_ft": p.get("min_ft"), "max_ft": p.get("max_ft"),
                     "mean_ft": p.get("mean_ft"), "relief_ft": p.get("relief_ft"),
                     "source": "USGS 3DEP 1 m DEM, sampled inside the parcel polygon"}
    if bfe is not None and p.get("min_ft") is not None:
        out["lowest_vs_bfe_ft"] = round(p["min_ft"] - bfe, 2)
        out["highest_vs_bfe_ft"] = round(p["max_ft"] - bfe, 2)
        out["ffe_scenarios"] = [
            {"freeboard_ft": fb, "min_ffe_ft": round(bfe + fb, 2),
             "fill_or_elevation_above_lowest_ground_ft": round(bfe + fb - p["min_ft"], 2),
             "fill_or_elevation_above_highest_ground_ft": round(bfe + fb - p["max_ft"], 2)}
            for fb in (0, 1, 2, 3)
        ]
        out["interpretation"] = (
            f"DEM ground across the lot runs {p['min_ft']}-{p['max_ft']} ft against an indicative "
            f"BFE of {bfe} ft. The lot therefore sits {abs(out['lowest_vs_bfe_ft']):.1f} ft "
            f"{'below' if out['lowest_vs_bfe_ft'] < 0 else 'above'} BFE at its lowest point. "
            f"Any habitable floor must be set above BFE plus the freeboard the county actually "
            f"enforces - that freeboard figure is NOT established here.")
    return out


def water_analysis(ctx):
    w = (ctx or {}).get("water") or {}
    near = w.get("nearby") or []
    onp = w.get("intersects_parcel") or []
    out = {"tier": "MODEL", "source": "USGS NHD waterbody polygons vs parcel boundary"}
    if onp:
        out["status"] = "Mapped water inside the parcel boundary"
        out["nearest"] = onp[0]
        out["distance_ft"] = 0
    elif near:
        n = near[0]
        out["nearest"] = n
        out["distance_ft"] = n.get("distance_ft")
        d = n.get("distance_ft")
        if d is None:
            out["status"] = "Water mapped nearby, distance not computed"
        elif d <= 50:
            out["status"] = "Abuts mapped water - consistent with direct water frontage"
        elif d <= 300:
            out["status"] = "Very close to mapped water (not necessarily frontage)"
        elif d <= 1500:
            out["status"] = "Near water - frontage unlikely; access likely via easement or common area"
        else:
            out["status"] = "Interior lot - no adjacent mapped water"
    else:
        out["status"] = "No mapped waterbody found within the search radius"
    out["caveat"] = ("NHD polygons are hydrographic mapping, not a boundary survey. Whether the "
                     "lot carries riparian frontage, deeded access or only common-area access is "
                     "a title/plat question and is NOT established here.")
    return out


def garden_analysis(soilsum):
    if soilsum.get("status") != "ok":
        return {"status": "unavailable", "tier": "REQUIRED"}
    c = (soilsum.get("components") or [{}])[0]
    ph = c.get("ph_surface")
    clay = c.get("clay_pct_surface")
    om = c.get("om_pct_surface")
    drain = (c.get("drainage") or "")
    amend = []
    if ph is not None:
        if ph < 6.0:
            amend.append("Lime, to raise pH toward 6.2-6.8 for most vegetables")
        elif ph > 7.6:
            amend.append("Elemental sulphur or acidifying organic matter to lower pH")
    if om is not None and om < 2.0:
        amend.append("Compost / organic matter, surface organic matter is low")
    if clay is not None and clay >= 35:
        amend.append("Coarse organic matter and gypsum-style conditioning to improve tilth in heavy clay")
    amend.append("Mulch, to buffer soil temperature and moisture")
    raised = bool((clay is not None and clay >= 35)
                  or "poorly" in drain.lower()
                  or (c.get("shrink_swell") in ("High", "Very high")))
    return {
        "status": "ok", "tier": "MODEL",
        "surface_ph": ph, "ph_range": c.get("ph_range"),
        "clay_pct": clay, "sand_pct": c.get("sand_pct_surface"),
        "silt_pct": c.get("silt_pct_surface"), "om_pct": om,
        "drainage": c.get("drainage"),
        "lawn_landscape_rating": c.get("interpretations", {}).get("ENG - Lawn, Landscape, Golf Fairway"),
        "raised_beds_advised": raised,
        "raised_beds_reason": ("Heavy clay / restricted drainage / high shrink-swell in the surface "
                               "horizon makes raised beds with imported loam the lower-risk option."
                               if raised else
                               "Surface horizon is workable; in-ground beds are reasonable with "
                               "normal organic amendment."),
        "likely_amendments": amend,
        "caveat": "Based on NRCS map-unit averages. A lab soil test is required before committing "
                  "to any amendment programme.",
    }


def septic_analysis(soilsum, elev, water):
    if soilsum.get("status") != "ok":
        return {"status": "unavailable", "tier": "REQUIRED"}
    c = (soilsum.get("components") or [{}])[0]
    interp = c.get("interpretations", {})
    ratings = {k: v for k, v in interp.items() if "Septic" in k}
    worst = "Not rated"
    for v in ratings.values():
        if v == "Very limited":
            worst = "Very limited"; break
        if v == "Somewhat limited":
            worst = "Somewhat limited"
    slope = (elev or {}).get("slope", {}) or {}
    flags = []
    if c.get("hydgroup") in ("C", "D", "C/D", "B/D", "A/D"):
        flags.append(f"Hydrologic group {c['hydgroup']} indicates slow infiltration, "
                     f"which constrains conventional drainfields.")
    if c.get("water_table_min_cm") is not None and c["water_table_min_cm"] <= 100:
        flags.append(f"Seasonal water table within {c['water_table_min_cm']} cm of the surface.")
    if c.get("bedrock_min_cm") is not None and c["bedrock_min_cm"] <= 150:
        flags.append(f"Bedrock within {c['bedrock_min_cm']} cm limits trench depth.")
    if (slope.get("p90_pct") or 0) > 15:
        flags.append(f"90th-percentile grade of {slope['p90_pct']}% complicates drainfield layout.")
    if (c.get("flooding_frequency") or "None") not in ("None", None):
        flags.append(f"Mapped flooding frequency '{c['flooding_frequency']}' is a direct "
                     f"constraint on on-site sewage facilities.")
    d = (water or {}).get("distance_ft")
    if d is not None and d <= 300:
        flags.append(f"Mapped water about {d} ft away; TCEQ/county setbacks from water will "
                     f"restrict drainfield placement.")
    return {
        "status": "ok", "tier": "MODEL",
        "ratings": ratings, "overall": worst,
        "constraints": flags,
        "bedroom_capacity": {
            "status": "NOT ESTABLISHED",
            "why": ("Permitted bedroom count follows from a site-specific soil evaluation "
                    "(TCEQ Ch. 285 class, loading rate, usable drainfield area and setbacks). "
                    "It cannot be derived from map-unit data. A licensed site evaluator must "
                    "run the percolation/soil profile test."),
        },
        "caveat": "NRCS ratings describe the map unit, not the lot. A TCEQ-compliant site "
                  "evaluation and percolation test is required for any permit.",
    }


# Identification confidence. Anything below "high" must not be read as a
# confirmed match to the advertised listing.
ID_CONFIDENCE = {
    "pony652": ("high", "Situs house number and street matched exactly in the county parcel roll."),
    "pony543": ("high", "Situs house number and street matched exactly in the county parcel roll."),
    "pony274": ("high", "Situs house number and street matched exactly in the county parcel roll."),
    "pony220": ("high", "Situs house number and street matched exactly in the county parcel roll."),
    "oldhenry1601": ("high", "Situs house number and street matched exactly in the county parcel roll."),
    "harrell15": ("high", "Situs address matched exactly, including city and ZIP."),
    "arrowhead2883": ("high", "Situs address matched exactly. Note the parcel falls in Clay County "
                              "even though the mailing address reads Wichita Falls."),
    "ward80": ("medium", "Situs reads '80 WARD RD' and the parcel is Oak Canyon Estates Lot 80. In "
                         "this subdivision the number in the address is the LOT number, and the "
                         "appraisal roll records the city inconsistently as Snyder or Justiceburg. "
                         "The parcel is in Kent County. Confirm against the listing's parcel ID."),
    "ward141": ("medium", "No situs address is recorded. Matched to Oak Canyon Subdivision Lot 141 "
                          "by applying the same lot-number-as-address convention seen on "
                          "neighbouring parcels. Two records exist for Lot 141, which suggests a "
                          "split interest. Confirm against the listing's parcel ID."),
    "pr52415": ("medium-high", "Exactly one parcel in the county roll carries situs 'PR 52415': "
                               "Lot 05, Paradise Shores, 5.77 acres. The listing gives no lot "
                               "number, so confirm the acreage against the listing."),
    "stlawrence0": ("LOW - DO NOT RELY", "The address '0 Saint Lawrence River Rd' carries no house "
                    "number, and 37 parcels front that road inside Lake Conroe Forest Section 2. "
                    "The parcel analysed here (Block 41, Lot 10) could not be tied to the listing "
                    "and is almost certainly NOT it: the appraisal record carries an improvement "
                    "value of about $265,000, meaning a house already stands on it, whereas the "
                    "listing is offered as a vacant lot. Its GIS acreage is also recorded as 0. "
                    "These pages should be read as a demonstration of the method over a "
                    "neighbouring parcel in the same subdivision, not as findings for the lot you "
                    "are buying. Obtain the parcel ID from the listing agent and re-run before "
                    "relying on a single figure here."),
}

MISSING_DOCS = [
    ("Recorded subdivision plat", "County Clerk / Plat records", "Confirms lot dimensions, easements, setbacks, and any lake or drainage reserve."),
    ("Boundary survey (and topographic survey)", "Licensed Texas surveyor (RPLS)", "Only a survey establishes boundaries, acreage and corner coordinates. DEM-derived contours in this report are not survey grade."),
    ("FEMA Elevation Certificate", "Surveyor / prior owner / county floodplain office", "Required to establish lowest adjacent grade and finished-floor elevation against BFE; governs flood insurance rating."),
    ("County floodplain development requirements", "County floodplain administrator", "Establishes the enforced freeboard above BFE, fill restrictions and permitting path."),
    ("Geotechnical / soil report", "Geotechnical engineer", "Needed for foundation design where shrink-swell is moderate or higher."),
    ("On-site sewage facility site evaluation and percolation test", "Licensed site evaluator / county OSSF office", "Determines whether septic is permittable and the bedroom count it supports."),
    ("Water service confirmation or well log", "Water supply corporation / TX Water Development Board", "Confirms whether a tap is available at the road, or the depth and yield of a well."),
    ("Utility availability letters (electric, gas, broadband)", "Serving utilities", "Confirms service at the lot line and connection cost."),
    ("HOA governing documents: Declaration/CC&Rs, architectural guidelines, rules, budget, dues and transfer fees", "HOA / management company / title company", "Controls buildability, minimum house size, outbuildings, livestock, rentals and dock rights."),
    ("Zoning / land-use confirmation and whether an ADU or second dwelling is permitted", "County or city development services", "Determines whether a second in-law suite is lawful."),
    ("Dock / shoreline permit requirements", "Lake authority or river authority with jurisdiction, plus HOA", "Dock feasibility is a permitting question, not a terrain question."),
    ("Short-term-rental rules", "County/city ordinance plus HOA", "Determines whether Airbnb/VRBO use is lawful."),
    ("Title commitment and recorded easements", "Title company", "Reveals access easements, utility easements, mineral reservations and restrictions."),
    ("Tax certificate / current assessment", "County appraisal district / tax office", "Confirms assessed value, exemptions and any special assessment."),
]


def main():
    parcels = load("parcels.json", {})
    elev = load("elevation.json", {})
    flood = load("flood.json", {})
    soil = load("soil.json", {})
    ctx = load("context.json", {})

    report = {"properties": {}, "missing_documents": [
        {"document": d, "source": s, "why": w} for d, s, w in MISSING_DOCS]}

    for key, rec in parcels.items():
        subj = rec["subject"]
        best = rec.get("best")
        p = {"key": key, "label": subj["label"], "county_guess": subj.get("county")}
        if not best:
            p["identification"] = {
                "status": "NOT IDENTIFIED",
                "tier": "REQUIRED",
                "note": ("No parcel in the Texas StratMap statewide layer could be matched to this "
                         "address. For this county the layer carries no situs address values, so "
                         "address matching is impossible. The parcel must be identified from the "
                         "county appraisal district record or the recorded plat before any "
                         "site-specific analysis is meaningful."),
            }
            report["properties"][key] = p
            continue

        a = best["attributes"]
        e = elev.get(key, {})
        s = soil.get(key, {})
        c = ctx.get(key, {})
        co = (c.get("census_geo") or {}).get("Counties", {})

        ss = soil_summary(s)
        wa = water_analysis(c)
        fa = flood_analysis(flood.get(key), e)
        slope = e.get("slope", {}) or {}
        par = e.get("parcel", {}) or {}
        tc = classify_terrain(slope.get("mean_pct"), slope.get("p90_pct"), par.get("relief_ft"))

        p["identification"] = {
            "status": "IDENTIFIED",
            "tier": "OFFICIAL",
            "situs_address": a.get("SITUS_ADDR"),
            "legal_description": a.get("LEGAL_DESC"),
            "parcel_id": a.get("PROP_ID"),
            "geo_id_apn": a.get("GEO_ID"),
            "owner_of_record": a.get("OWNER_NAME"),
            "legal_acres": _num(a.get("LEGAL_AREA")),
            "gis_acres": _num(a.get("GIS_AREA")),
            "computed_acres": best.get("computed_acres"),
            "land_value_usd": _num(a.get("LAND_VALUE")),
            "improvement_value_usd": _num(a.get("IMP_VALUE")),
            "market_value_usd": _num(a.get("MKT_VALUE")),
            "county": co.get("NAME") or subj.get("county"),
            "county_fips": (co.get("STATE") or "") + (co.get("COUNTY") or ""),
            "centroid": best.get("centroid"),
            "bbox": best.get("bbox"),
            "extent": best.get("extent"),
            "source": "Texas StratMap statewide land parcels (county appraisal roll)",
            "resolved_by": rec.get("resolved_by", "situs address match"),
        }
        conf, conf_note = ID_CONFIDENCE.get(key, ("unknown", "Confidence not assessed."))
        p["identification"]["match_confidence"] = conf
        p["identification"]["match_confidence_note"] = conf_note

        subdivision = None
        ld = (a.get("LEGAL_DESC") or "").upper()
        for nm in ("BAR X RANCH", "CREEK WOOD BEND", "LAKE CONROE FOREST", "PARADISE SHORES",
                   "OAK CANYON", "WEST BLK"):
            if nm in ld:
                subdivision = nm.title()
                break
        p["identification"]["subdivision"] = subdivision

        p["terrain"] = {
            "tier": "MODEL",
            "classification": tc,
            "parcel_elevation_ft": par,
            "window_min_ft": e.get("window_min_ft"),
            "window_max_ft": e.get("window_max_ft"),
            "slope": slope,
            "transect": e.get("transect"),
            "contour_interval_ft": (e.get("contours") or {}).get("interval_ft"),
            "dem": e.get("dem"),
        }
        p["flood"] = fa
        p["soil"] = ss
        p["foundation"] = {
            "tier": "MODEL",
            "shrink_swell": ss.get("headline", {}).get("shrink_swell"),
            "matrix": FOUNDATION_MATRIX.get(ss.get("headline", {}).get("shrink_swell"), {}),
            "dwellings_rating": ss.get("headline", {}).get("dwellings_no_basement"),
            "geotech_advised": ss.get("headline", {}).get("shrink_swell") in ("Moderate", "High", "Very high"),
            "note": (next((cc.get("shrink_swell_note") for cc in ss.get("components", [])), None)),
            "caveat": "Foundation selection is an engineering decision. NRCS map-unit shrink-swell "
                      "indicates risk; it does not substitute for a geotechnical investigation.",
        }
        p["septic"] = septic_analysis(ss, e, wa)
        p["garden"] = garden_analysis(ss)
        p["water"] = wa
        p["climate"] = c.get("climate")
        p["demographics"] = c.get("acs")
        p["census_geo"] = c.get("census_geo")
        report["properties"][key] = p

    save("report_payload.json", report)
    print("properties:", len(report["properties"]))
    for k, v in report["properties"].items():
        i = v["identification"]
        if i["status"] != "IDENTIFIED":
            print(f"  {k:14s} NOT IDENTIFIED")
            continue
        print(f"  {k:14s} {i.get('subdivision')} | {i.get('gis_acres')} ac | "
              f"{i.get('county')} | zones={v['flood'].get('zones')} "
              f"| terrain={v['terrain']['classification']['band']} "
              f"| swell={v['foundation'].get('shrink_swell')} "
              f"| water={v['water'].get('distance_ft')}ft")
    print("\nsaved ->", DATA + "/report_payload.json")


if __name__ == "__main__":
    main()
