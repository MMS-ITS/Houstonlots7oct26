"""Inline the CSS, JS and data bundle into a single self-contained report/index.html."""
import datetime
import json
import os

from common import ROOT, load

SRC = os.path.join(ROOT, "report", "src")
OUT = os.path.join(ROOT, "report", "index.html")

TITLE = "Comprehensive Lot Due-Diligence Report"
SUBTITLE = "Texas lot portfolio \u00b7 12 properties"


def cover_html(bundle, dt):
    props = [bundle["properties"][k] for k in bundle["generated_order"]
             if k in bundle["properties"]]
    idd = [p for p in props if p["identification"]["status"] == "IDENTIFIED"]
    sfha = [p for p in idd if (p.get("flood") or {}).get("in_sfha")]
    rows = ""
    for i, p in enumerate(props):
        iden = p["identification"]
        ok = iden["status"] == "IDENTIFIED"
        f = p.get("flood") or {}
        zones = " + ".join(f.get("zones") or []) if ok else ""
        if ok and not zones:
            cv = f.get("coverage_verdict") or ""
            zones = "not mapped" if "unmapped" in cv else "X (likely)"
        conf = iden.get("match_confidence", "")
        badge = ""
        if ok and conf.upper().startswith("LOW"):
            badge = ' <span style="color:#9c2b2b;font-weight:700">[identity unresolved]</span>'
        rows += (
            f'<tr><td style="width:6%">{i + 1}</td>'
            f'<td>{p["label"]}{badge}</td>'
            f'<td style="width:17%">{iden.get("county") or "&mdash;"}</td>'
            f'<td style="width:11%" class="num">'
            f'{"" if not ok else format(iden.get("gis_acres") or 0, ".2f")}</td>'
            f'<td style="width:16%">{zones if ok else "<i>not identified</i>"}</td></tr>')
    return f"""
<div class="cover-inner">
  <div class="cover-band">
    <div class="kicker">Property due diligence</div>
    <h1>Comprehensive Lot<br>Due-Diligence Report</h1>
    <div class="sub">Twelve Texas lots &middot; parcel, terrain, flood, soil and site analysis</div>
  </div>
  <div class="cover-main">
    <table class="tight">
      <thead><tr><th>#</th><th>Property</th><th>County</th><th class="num">Acres</th>
      <th>FEMA zone</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <div class="grid4" style="margin-top:7mm">
      <div class="stat"><div class="lab">Lots submitted</div>
        <div class="val">{len(props)}</div></div>
      <div class="stat"><div class="lab">Parcels identified</div>
        <div class="val">{len(idd)}</div></div>
      <div class="stat"><div class="lab">Inside a FEMA SFHA</div>
        <div class="val" style="color:#9c2b2b">{len(sfha)}</div></div>
      <div class="stat"><div class="lab">Analysis date</div>
        <div class="val sm">{dt}</div></div>
    </div>
    <div class="note bad" style="margin-top:6mm">
      <span class="ttl">Read the method section first</span>
      Findings are labelled <b>Official</b>, <b>Model-derived</b> or <b>Needs confirmation</b>.
      Elevations and contours in this report are derived from a 1&nbsp;m national elevation
      model and are <b>not survey grade</b>. They must not be used to set a finished-floor
      elevation against a Base Flood Elevation &mdash; that requires a surveyor's Elevation
      Certificate. No HOA, zoning, utility or dock document was obtainable from public data;
      every such item is flagged rather than estimated.
    </div>
  </div>
  <div class="cover-foot">
    Compiled from FEMA NFHL, USGS 3DEP and NHD, USDA NRCS SSURGO, Texas StratMap parcels,
    US Census geographies and ERA5 climate reanalysis. No listing data was retrieved.
    Not a survey, appraisal, title opinion or engineering certification.
  </div>
</div>"""


def main():
    bundle = load("report_bundle.json")
    if not bundle:
        raise SystemExit("run 07_bundle.py first")
    css = open(os.path.join(SRC, "app.css")).read()
    js = open(os.path.join(SRC, "app.js")).read()
    shell = open(os.path.join(SRC, "shell.html")).read()

    dt = datetime.date.today().strftime("%d %B %Y")
    bundle["meta"] = {"title": TITLE, "subtitle": SUBTITLE, "date": dt}
    bundle["coverHtml"] = cover_html(bundle, dt)

    data = json.dumps(bundle, separators=(",", ":"), allow_nan=False)
    html = (shell
            .replace("/*__CSS__*/", css)
            .replace("/*__DATA__*/", data)
            .replace("/*__JS__*/", js))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        fh.write(html)
    print(f"wrote {OUT}  ({len(html)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
