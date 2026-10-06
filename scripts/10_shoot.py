"""Screenshot pages matching a text query, to eyeball specific figures."""
import os
import sys

from playwright.sync_api import sync_playwright

from common import ROOT

HTML = os.path.join(ROOT, "report", "index.html")
SHOT = os.path.join(ROOT, "report", "verify")


def main():
    needle = sys.argv[1] if len(sys.argv) > 1 else "cross-section"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    os.makedirs(SHOT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        pg = b.new_page(viewport={"width": 1280, "height": 1000})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("file://" + HTML, wait_until="load")
        pg.wait_for_timeout(2500)
        idxs = pg.evaluate("""(q) => {
          const out = [];
          document.querySelectorAll('.sheet').forEach((s, i) => {
            if ((s.innerText || '').toLowerCase().includes(q.toLowerCase())) out.push(i);
          });
          return out;
        }""", needle)
        print(f"pages containing {needle!r}: {[i+1 for i in idxs][:30]}")
        sheets = pg.query_selector_all(".sheet")
        tag = "".join(ch for ch in needle if ch.isalnum())[:18] or "q"
        for i in idxs[:limit]:
            sheets[i].screenshot(path=os.path.join(SHOT, f"{tag}-p{i+1:03d}.png"))
            print("  shot page", i + 1)
        if errs:
            print("ERRORS:", errs[:3])
        b.close()


if __name__ == "__main__":
    main()
