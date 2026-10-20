"""Build the files behind the game packets: for every game, four reports back to back.

  1. Weekly Matchup Report page   (scripts/build_report.py)        -> pdf/report.pdf
  2. Printed matchup              (print.html, as Print all prints) -> pdf/matchups.pdf
  3. EPA matchup page             (epa.html's Print all)            -> pdf/epa.pdf (from build_pdfs.py)
  4. Value board matchup          (fb-value-board's Matchups view)  -> pdf/value-board.pdf

and pdf/packets.json, which says which pages of each file belong to each game. The site's
packets.js reads it and assembles a packet in the browser (one game, or every game) to print
or save, so the repo stores each week's pages once instead of a copy per packet.

The same file runs in both dashboards (rhyman7/cfb and rhyman7/nfl). A part with no page for
a game (say, a game the value board does not model) is left out of that packet and listed
under "missing" in packets.json.

Run from the repo root, after build_pdfs.py:
  python scripts/build_packets.py --value-board ../fb-value-board
Needs: pip install playwright pypdf && python -m playwright install --with-deps chromium
"""
import argparse
import functools
import http.server
import io
import json
import re
import shutil
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "pdf"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_report  # noqa: E402

DASHES = dict.fromkeys(map(ord, "‐‑‒–−"), "-")


def serve(directory):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def render(page, url, ready, dest=None):
    page.goto(url, wait_until="networkidle", timeout=90000)
    if ready:
        page.wait_for_selector(ready, timeout=60000, state="attached")
    page.evaluate("document.fonts.ready")
    page.emulate_media(media="print")
    data = page.pdf(prefer_css_page_size=True, print_background=True)
    page.emulate_media(media="screen")
    if dest:
        Path(dest).write_bytes(data)
    return PdfReader(io.BytesIO(data))


def texts(reader):
    out = []
    for p in reader.pages:
        try:
            out.append((p.extract_text() or "").translate(DASHES))
        except Exception:
            out.append("")
    return out


def abbr_re(a):
    return re.compile(rf"(?<![A-Za-z&]){re.escape(a.translate(DASHES))}(?![A-Za-z&])")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--value-board", default=str(ROOT.parent / "fb-value-board"), help="checkout of rhyman7/fb-value-board")
    ap.add_argument("--font-css", default=None, help="replacement font tag for offline builds of the report")
    a = ap.parse_args()

    data = json.loads((ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    league = "cfb" if "weekGames" in data else "nfl"
    D = build_report.Data(data)
    week = D.week
    games = {g["id"]: g for g in D.games}
    OUT.mkdir(exist_ok=True)

    tmp = OUT / "_work"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    report_html, ids, title = build_report.build(ROOT, tmp, a.font_css)
    pages = {gid: {} for gid in ids}

    vb = Path(a.value_board)
    vb_page = vb / ("docs/cfb/index.html" if league == "cfb" else "docs/index.html")
    srv, base = serve(ROOT)
    vsrv, vbase = serve(vb) if vb_page.exists() else (None, None)
    files = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.add_init_script("window.print = () => {}")

            # 1. Weekly Matchup Report, split by its "Game n of N" eyebrow
            build_report.render_pdf(report_html, OUT / "report.pdf", title, browser)
            files["report"] = "report.pdf"
            n = len(ids)
            for i, t in enumerate(texts(PdfReader(str(OUT / "report.pdf")))):
                m = re.search(rf"game\s+(\d+)\s+of\s+{n}(?!\d)", t, re.I)
                if m and 1 <= int(m.group(1)) <= n:
                    pages[ids[int(m.group(1)) - 1]].setdefault("report", [i])
            print("report:", sum("report" in v for v in pages.values()), "of", n)

            # 2. Printed matchups: count each game's pages, then print them all in one file
            ready = "#printAllBtn:not([disabled])"
            if league == "cfb":
                counts = {gid: len(render(page, f"{base}/print.html?auto=0&games={gid}", ready).pages) for gid in ids}
                order = ids
                allp = render(page, f"{base}/print.html?auto=0&games={','.join(ids)}", ready, OUT / "matchups.pdf")
            else:
                # print.html prints every game with stats on both sides, by kickoff; build_pdfs.py
                # already wrote that as pdf/matchups.pdf, and one file per game in pdf/games/
                sched = [g for g in data["schedule"]["games"] if g["away"] in data["teams"] and g["home"] in data["teams"]]
                order = [g["id"] for g in sorted(sched, key=lambda g: g["start"])]
                counts = {}
                for gid in order:
                    f = OUT / "games" / f"{gid}.pdf"
                    counts[gid] = len(PdfReader(str(f)).pages) if f.exists() else len(
                        render(page, f"{base}/print.html?auto=0&game={gid}", ready).pages)
                if (OUT / "matchups.pdf").exists():
                    allp = PdfReader(str(OUT / "matchups.pdf"))
                else:
                    allp = render(page, f"{base}/print.html?auto=0", ready, OUT / "matchups.pdf")
            files["matchup"] = "matchups.pdf"
            if sum(counts.values()) != len(allp.pages):
                raise SystemExit(f"matchups.pdf has {len(allp.pages)} pages but the games add up to {sum(counts.values())}")
            at = 0
            for gid in order:
                if gid in pages:
                    pages[gid]["matchup"] = list(range(at, at + counts[gid]))
                at += counts[gid]
            print("matchup:", sum("matchup" in v for v in pages.values()))

            # 3. EPA: build_pdfs.py's epa.pdf, one page per game, matched by both abbreviations
            epa_path = OUT / "epa.pdf"
            if not epa_path.exists() and (ROOT / "data" / "epa.json").exists():
                render(page, f"{base}/epa.html", "#epaPrintBtn:not([disabled])", epa_path)
            if epa_path.exists():
                files["epa"] = "epa.pdf"
                et, used = texts(PdfReader(str(epa_path))), set()
                for gid in ids:
                    g = games[gid]
                    pat = [abbr_re(g[s]["abbr"]) for s in ("away", "home")]
                    for i, t in enumerate(et):
                        if i not in used and "EPA matchup" in t and all(x.search(t) for x in pat):
                            pages[gid]["epa"] = [i]; used.add(i); break
            print("epa:", sum("epa" in v for v in pages.values()))

            # 4. Value board: its Print all (one landscape page per game), matched by its own team codes
            if vbase:
                rel = vb_page.relative_to(vb).as_posix()
                vgames = [x for x in json.loads((vb_page.parent / "data.json").read_text(encoding="utf-8"))["slate"]["games"]
                          if x.get("week") == week]
                vt, row_ids, n_blocks = None, [], 0
                if vgames:
                    page.goto(f"{vbase}/{rel}#matchups", wait_until="networkidle", timeout=90000)
                    page.wait_for_selector("#mx-print-all-btn:not([disabled])", timeout=60000)
                    # the board's rows, in the order Print all prints them
                    row_ids = page.evaluate("""() => [...document.querySelectorAll('#mx-board a.game-row[href^="#matchups/"]')]
                        .map(a => decodeURIComponent(a.getAttribute('href').slice('#matchups/'.length)))""")
                    page.click("#mx-print-all-btn")   # builds every game into the print view; window.print is stubbed
                    page.wait_for_selector("#mx-print-all .mx-game", timeout=60000, state="attached")
                    n_blocks = page.evaluate("() => document.querySelectorAll('#mx-print-all .mx-game').length")
                    page.evaluate("document.fonts.ready")
                    page.emulate_media(media="print")
                    (OUT / "value-board.pdf").write_bytes(page.pdf(prefer_css_page_size=True, print_background=True))
                    page.emulate_media(media="screen")
                    files["value"] = "value-board.pdf"
                    vt = texts(PdfReader(str(OUT / "value-board.pdf")))
                # the college board carries the ESPN id as game_id; the NFL board uses the dashboard's ids
                byid = {}
                for x in vgames:
                    byid[str(x.get("game_id") or x["id"])] = x
                    byid[x["id"]] = x
                if vt and len(vt) == n_blocks == len(row_ids):
                    # one landscape page per game, in board order
                    at_page = {vid: i for i, vid in enumerate(row_ids)}
                    for gid in ids:
                        x = byid.get(gid)
                        if x and x["id"] in at_page:
                            pages[gid]["value"] = [at_page[x["id"]]]
                elif vt:
                    print(f"value-board.pdf has {len(vt)} pages for {n_blocks} games; matching pages by team codes")
                    used = set()
                    for gid in ids:
                        x = byid.get(gid)
                        if not x:
                            continue
                        pat = [abbr_re(x["away"]), abbr_re(x["home"])]
                        for i, t in enumerate(vt):
                            if i not in used and all(r.search(t) for r in pat):
                                pages[gid]["value"] = [i]; used.add(i); break
            print("value board:", sum("value" in v for v in pages.values()))
            browser.close()
    finally:
        srv.shutdown()
        if vsrv:
            vsrv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)

    names = {"report": "Matchup Report", "matchup": "Printed matchup", "epa": "EPA", "value": "Value board"}
    order4 = ["report", "matchup", "epa", "value"]
    summary = []
    for gid in ids:
        g = games[gid]
        summary.append({
            "id": gid,
            "label": f'{g["away"]["abbr"]} {"vs" if g["neutral"] else "@"} {g["home"]["abbr"]}',
            "file": re.sub(r"[^A-Za-z0-9_-]", "", f'{league.upper()}_Week{week}_{g["away"]["abbr"]}-{g["home"]["abbr"]}_packet'),
            "pages": {k: pages[gid][k] for k in order4 if k in pages[gid]},
            "missing": [names[k] for k in order4 if k not in pages[gid]],
        })
    manifest = {
        "season": data.get("season"),
        "week": week,
        "league": league,
        "title": title,
        "dataGeneratedAt": data.get("generatedAt"),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": files,
        "parts": [names[k] for k in order4],
        "games": summary,
    }
    (OUT / "packets.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    full = sum(not s["missing"] for s in summary)
    print(f"packets.json: {len(summary)} games, {full} with all four parts, week {week}")
    for s in summary:
        if s["missing"]:
            print("  missing", s["id"], s["label"], s["missing"])


if __name__ == "__main__":
    main()
