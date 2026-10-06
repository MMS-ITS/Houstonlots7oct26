# Texas Lot Due-Diligence Report

An interactive HTML report, paginated to A4 portrait with real page numbers, covering the
61-point due-diligence checklist for twelve Texas lots.

**Deliverables**

| File | What it is |
|---|---|
| `report/index.html` | Self-contained interactive report (no network needed). Open it and use **Print / Save PDF**. |
| `report/Lot-Due-Diligence-Report.pdf` | Pre-rendered PDF, 139 pages, A4 portrait (209.9 × 297.0 mm), numbered. |
| `data/*.json` | Raw collected data and the derived analysis payload. |
| `scripts/*.py` | The collection and build pipeline. |

To print from the browser: **A4, portrait, margins = None, Background graphics = on.**
The page frame is drawn in the document, so page numbers come from the report itself rather
than the browser.

## What the data actually says

Eleven of twelve lots were matched to a parcel in the Texas statewide appraisal-roll layer.
The findings that move the decision:

- **All five Angleton lots (Bar X Ranch) are in FEMA Zone AE** — a Special Flood Hazard Area.
  Measured ground across those lots runs 21–28 ft against an indicative BFE of 27–28 ft, so the
  ground is **below** the base flood elevation at its lowest point. That forces an elevated
  finished floor, floodplain permitting, and mandatory flood insurance with a federally backed
  mortgage. This is the single largest cost factor in the portfolio.
- **Three Angleton lots sit on Pledger clay**, a smectitic Vertisol with linear extensibility of
  19% — *very high* shrink-swell. Expansive clay is the usual cause of foundation distress here;
  assume an engineered foundation plus a geotechnical report.
- **80 Ward Rd (Oak Canyon, Lake Alan Henry, Kent County) falls 78 ft across the parcel** and
  reaches 60% grade (31°) over a 50 ft run. About 42% of the lot is mapped as "Rough broken land".
  It adjoins Lake Alan Henry at ~56 ft.
- **15 Harrell Cemetery Rd** adjoins Lake Livingston (~25 ft) and is a split A / X flood zone with
  43 ft of relief and high shrink-swell.
- **141 Ward Rd and 80 Ward Rd have no effective FEMA digital flood mapping** within 15 miles.
  That is *undetermined*, not low risk.
- **Genuine water frontage** (parcel boundary within ~30 ft of mapped water): 274 and 220 Pony Trl,
  15 Harrell Cemetery Rd, 2883 W Arrowhead Dr (Lake Arrowhead). 652 and 543 Pony Trl are interior
  lots roughly 3,400–3,700 ft from water despite being in a lake subdivision.

Two lots need resolving before they mean anything:

- **119 Dolly Rd, Sulphur Springs** — not identified. Hopkins County contributes parcels to the
  state layer with **null situs addresses**, so address matching is impossible. No flood, soil or
  terrain result is attributed to it rather than guessed.
- **0 Saint Lawrence River Rd, Montgomery** — identity unresolved. The address has no house number
  and 37 parcels front that road in Lake Conroe Forest Section 2. The parcel analysed carries
  ~$265k of improvements, so a house already stands on it and it is almost certainly not the
  vacant listing. Its pages are a method demonstration and are labelled as such in the running
  header of every page.

Also worth noting: three lots sit in a different county than their mailing address implies —
2883 W Arrowhead Dr (Wichita Falls address) is in **Clay County**, and 80 Ward Rd (Snyder address)
is in **Kent County**.

## Provenance labelling

Every finding carries one of three labels, because the difference between a published flood zone
and a computed contour matters when money is at stake:

- **Official** — reproduced unchanged from the agency of record (FEMA zone and FIRM panel, county
  appraisal parcel record, recorded legal description).
- **Model-derived** — computed here from authoritative inputs (USGS 3DEP 1 m DEM for elevation,
  contours, slope and cross-sections; NRCS SSURGO for soil). Good engineering estimates, **not
  survey grade**.
- **Needs confirmation** — cannot be established remotely. The report names the question and the
  office that holds the answer instead of guessing.

Per the brief, every cross-section is drawn **twice**: a true 1:1 geometric panel beside the
vertically exaggerated one, so an exaggerated curve can never be mistaken for real slope. Site
plans use equal horizontal and vertical scale; the scale bar was verified against known parcel
dimensions to within 0.5% on all eleven maps.

## What could not be retrieved, and why

| Item | Reason |
|---|---|
| Zillow photos, price, listing history | Zillow returns HTTP 403 to automated requests. Request from the listing agent. |
| HOA dues, CC&Rs, architectural rules | Not open data. Obtain from the HOA or title company. |
| Zoning, ADU rules, STR rules, permits | County/city documents, not geospatial data. |
| Utility availability (water, sewer, power, gas, broadband) | Requires a serviceability letter from each utility. |
| Dock permits, lake bathymetry, fishing rules | Lake authority and TPWD documents. |
| Elevation Certificate, survey, soil boring, perc test | Site-specific professional work. |
| County demographics | The Census API now rejects keyless requests. Set `CENSUS_API_KEY` and re-run `05_context.py`. |
| Build cost estimate | Deliberately omitted. It depends on HOA minimum size, the finished-floor elevation forced by the flood zone, the foundation the soil requires, and whether water/sewer must be created on site. Three of those four are unconfirmed, so any figure would be arbitrary. Price it from a builder bid once the plat, CC&Rs, floodplain requirement and soil report are in hand. |

## Data sources

| Dataset | Publisher | Used for |
|---|---|---|
| StratMap statewide land parcels | Texas Geographic Information Office (county appraisal rollup) | Boundary, legal description, acreage, APN, owner, appraised value |
| National Flood Hazard Layer | FEMA | Flood zone, SFHA status, FIRM panel and effective date, BFE lines |
| 3DEP bare-earth DEM (1 m) | USGS | Elevation, relief, slope, contours, cross-sections, 3D terrain |
| SSURGO via Soil Data Access | USDA NRCS | Soil series, texture, drainage, shrink-swell, pH, septic and dwelling ratings |
| National Hydrography Dataset | USGS | Waterbody position and distance from the parcel boundary |
| ERA5 daily reanalysis | ECMWF, via Open-Meteo archive | 30-year climate normals, growing season, freeze frequency |
| Geocoder and geographies | US Census Bureau | County and tract identification |

## Rebuilding

```bash
cd scripts
python3 01_parcels.py           # match addresses to parcels (merges into data/parcels.json)
python3 01b_probe.py            # targeted scans for addresses that fail to match
python3 01c_resolve_point.py    # pin the parcels found manually by 01b
python3 02_elevation.py         # 3DEP grid, slope stats, contours, transects
python3 03_flood.py             # FEMA zone, FIRM panel, BFE lines
python3 03b_flood_coverage.py   # mapped-vs-unmapped diagnosis
python3 03c_flood_interpret.py  # final flood verdict per lot
python3 04_soil.py              # NRCS components, horizons, interpretations
python3 05_context.py           # waterbodies, climate normals, census geography
python3 06_analyze.py           # derived engineering conclusions
python3 07_bundle.py            # trim to a compact report payload
python3 08_build_report.py      # inline CSS/JS/data -> report/index.html
```

Verification (requires `pip install playwright && python3 -m playwright install chromium`):

```bash
python3 09_verify.py     # render check: console errors, page numbering, overflow, PDF export
python3 11_integrity.py  # confirm rendered figures still match the collected source data
python3 10_shoot.py "Longitudinal cross-section" 3   # screenshot pages matching a phrase
```

Report sources live in `report/src/` (`app.css`, `app.js`, `shell.html`); `08_build_report.py`
inlines them with the data into the single-file `report/index.html`.

## Limitations

Not a survey, appraisal, title opinion, flood determination or engineering certification.
Parcel polygons come from appraisal GIS maintained for taxation and routinely differ from the
recorded plat by several feet. DEM elevations carry roughly a foot of vertical uncertainty, worse
under canopy. Where a flood polygon published no static BFE, the nearest BFE line value was used
and is labelled indicative — the governing BFE must be read at the structure location from the
FIRM and Flood Insurance Study profile. **Do not use any elevation in this report to set a
finished floor; that requires a surveyor's Elevation Certificate.** NRCS values describe map units
generalised at about 1:24,000, not the individual lot.
