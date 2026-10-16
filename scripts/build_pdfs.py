"""Build the EPA page's downloadable PDF with headless Chrome.

Renders epa.html exactly as the browser's print does ("Print all": every game this week
on its own landscape page, then the EPA line board, the ratings and the method) and writes:
  pdf/epa.pdf          the whole thing
  pdf/manifest.json    season, week and build time; epa.html shows the Download PDF link
                       only when the PDF is for the week on the page

Run from the repo root:  python scripts/build_pdfs.py
Needs: pip install playwright && python -m playwright install --with-deps chromium
"""
import functools
import http.server
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pdf"


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def main():
    data = json.loads((ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    if not (ROOT / "data" / "epa.json").exists():
        print("no data/epa.json; nothing to build")
        return
    OUT.mkdir(exist_ok=True)
    srv, base = serve()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.add_init_script("window.print = () => {}")
            page.goto(f"{base}/epa.html", wait_until="networkidle")
            # epa.js enables Print all once every game has been laid out
            page.wait_for_selector("#epaPrintBtn:not([disabled])", timeout=60000)
            page.evaluate("document.fonts.ready")
            page.emulate_media(media="print")
            page.pdf(path=str(OUT / "epa.pdf"), prefer_css_page_size=True, print_background=True)
            browser.close()
    finally:
        srv.shutdown()

    manifest = {
        "season": data.get("season"),
        "week": data.get("currentWeek"),
        "dataGeneratedAt": data.get("generatedAt"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "epa": True,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"built pdf/epa.pdf for week {manifest['week']}")


if __name__ == "__main__":
    main()
