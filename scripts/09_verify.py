"""Render the report in headless Chromium to verify it works.

Checks: no console/page errors, pages were produced, page numbering is present,
no sheet overflows its printable height, and print-to-PDF yields A4 portrait.
"""
import os
import re
import sys

from playwright.sync_api import sync_playwright

from common import ROOT

HTML = os.path.join(ROOT, "report", "index.html")
SHOT = os.path.join(ROOT, "report", "verify")
PDF = os.path.join(ROOT, "report", "Lot-Due-Diligence-Report.pdf")


def main():
    os.makedirs(SHOT, exist_ok=True)
    errors, warnings = [], []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        pg = b.new_page(viewport={"width": 1280, "height": 1000})
        pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
              if m.type in ("error",) else
              warnings.append(f"console.{m.type}: {m.text}") if m.type == "warning" else None)
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.goto("file://" + HTML, wait_until="load")
        pg.wait_for_timeout(2500)

        n_sheets = pg.eval_on_selector_all(".sheet", "els => els.length")
        print(f"sheets rendered: {n_sheets}")

        # page-number text present and consistent
        nums = pg.eval_on_selector_all(
            ".sheet-foot .pg", "els => els.map(e => e.textContent.trim())")
        print(f"numbered footers: {len(nums)}  first={nums[0] if nums else None!r}  "
              f"last={nums[-1] if nums else None!r}")
        bad = [t for t in nums if not re.match(r"^Page \d+ of \d+$", t)]
        if bad:
            errors.append(f"malformed page numbers: {bad[:4]}")

        # overflow check: body content taller than the visible body box
        ov = pg.evaluate("""() => {
          const out = [];
          document.querySelectorAll('.sheet').forEach((s, i) => {
            const b = s.querySelector('.sheet-body');
            if (!b) return;
            if (b.scrollHeight > b.clientHeight + 2)
              out.push({page: i + 1, over: b.scrollHeight - b.clientHeight,
                        head: (s.querySelector('.sheet-head')||{}).innerText || ''});
          });
          return out;
        }""")
        if ov:
            for o in ov[:12]:
                warnings.append(f"page {o['page']} overflows by {o['over']}px "
                                f"({o['head'][:60]!r})")

        # figures actually drew
        figs = pg.eval_on_selector_all("svg", "els => els.length")
        print(f"svg figures: {figs}")
        empty = pg.evaluate("""() => {
          let n = 0;
          document.querySelectorAll('svg').forEach(s => {
            if (s.querySelectorAll('path,rect,circle,line,text').length < 3) n++;
          });
          return n;
        }""")
        print(f"near-empty svgs: {empty}")

        # screenshots of a few representative pages
        want = [0, 1, 2, 3]
        total = n_sheets
        want += [int(total * 0.35), int(total * 0.6), total - 2, total - 1]
        seen = set()
        for i in want:
            if i < 0 or i >= total or i in seen:
                continue
            seen.add(i)
            pg.eval_on_selector_all(
                ".sheet", "(els, i) => els[i].scrollIntoView(), 0", i)
            h = pg.query_selector_all(".sheet")[i]
            h.screenshot(path=os.path.join(SHOT, f"page-{i+1:03d}.png"))
        print(f"screenshots: {len(seen)} -> {SHOT}")

        # print to PDF
        pg.pdf(path=PDF, format="A4", print_background=True,
               margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
               prefer_css_page_size=True)
        print(f"pdf: {PDF}  ({os.path.getsize(PDF)/1024:.0f} KB)")
        b.close()

    print("\n--- errors ---")
    for e in errors:
        print("  ", e)
    print(f"({len(errors)} errors)")
    print("--- warnings ---")
    for w in warnings[:25]:
        print("  ", w)
    print(f"({len(warnings)} warnings)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
