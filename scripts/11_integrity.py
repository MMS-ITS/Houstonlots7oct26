"""End-to-end integrity check.

Confirms that figures visible in the rendered report still match the raw values
collected from the source APIs, so a rendering bug cannot silently alter a
flood zone, an elevation or an acreage.
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

from common import ROOT, load

HTML = os.path.join(ROOT, "report", "index.html")


def norm(s):
    return re.sub(r"\s+", " ", s or "").replace("\u2014", "-").replace("\u00b7", "·")


def main():
    parcels = load("parcels.json", {})
    elev = load("elevation.json", {})
    flood = load("flood.json", {})
    soil = load("soil.json", {})
    order = load("report_bundle.json", {}).get("generated_order", [])

    checks, fails = 0, []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        pg = b.new_page(viewport={"width": 1280, "height": 1000})
        pg.goto("file://" + HTML, wait_until="load")
        pg.wait_for_timeout(3000)

        # text of all sheets belonging to each lot chapter
        texts = pg.evaluate("""() => {
          const out = [];
          document.querySelectorAll('.sheet').forEach(s => {
            const h = s.querySelector('.sheet-head');
            out.push({head: h ? h.innerText : '', txt: s.innerText || ''});
          });
          return out;
        }""")
        b.close()

    for i, key in enumerate(order):
        rec = parcels.get(key) or {}
        best = rec.get("best")
        label = (rec.get("subject") or {}).get("label", key)
        short = label.split(",")[0]
        pages = [t["txt"] for t in texts if short in norm(t["head"])]
        blob = norm(" ".join(pages))
        if not best:
            checks += 1
            if "PARCEL NOT IDENTIFIED" not in norm(" ".join(t["head"] for t in texts)):
                fails.append(f"{key}: expected a NOT IDENTIFIED header")
            continue
        if not pages:
            fails.append(f"{key}: no pages found for {short!r}")
            continue

        # 1. legal description present verbatim
        legal = (best["attributes"].get("LEGAL_DESC") or "").strip()
        if legal:
            checks += 1
            if norm(legal)[:40] not in blob:
                fails.append(f"{key}: legal description not found on its pages")

        # 2. FEMA zones all rendered
        zones = ((flood.get(key) or {}).get("summary") or {}).get("zones") or []
        for z in zones:
            checks += 1
            if z not in blob:
                fails.append(f"{key}: FEMA zone {z!r} missing from rendered text")

        # 3. parcel min/max elevation rendered to 2dp
        par = (elev.get(key) or {}).get("parcel") or {}
        for fld in ("min_ft", "max_ft"):
            v = par.get(fld)
            if v is None:
                continue
            checks += 1
            if f"{v:,.2f}" not in blob and f"{v:.2f}" not in blob:
                fails.append(f"{key}: elevation {fld}={v} not rendered")

        # 4. dominant soil component rendered
        comps = (soil.get(key) or {}).get("components") or []
        if comps:
            checks += 1
            names = {c.get("compname") for c in comps if c.get("compname")}
            if not any(n in blob for n in names):
                fails.append(f"{key}: no soil component name rendered (expected one of {names})")

        # 5. GIS acreage rendered at 3dp or 2dp
        ga = best["attributes"].get("GIS_AREA")
        try:
            ga = float(ga)
        except (TypeError, ValueError):
            ga = None
        if ga:
            checks += 1
            if f"{ga:,.3f}" not in blob and f"{ga:,.2f}" not in blob:
                fails.append(f"{key}: GIS acreage {ga} not rendered")

    print(f"checks run: {checks}")
    if fails:
        print(f"FAILURES ({len(fails)}):")
        for f in fails:
            print("  -", f)
        return 1
    print("all rendered values match the collected source data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
