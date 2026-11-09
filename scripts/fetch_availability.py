"""Write data/availability.json: the official conference availability reports for this week's games.

Since 2025 all four power conferences publish NFL-style availability reports for conference games
(Big Ten 2023, SEC 2024, ACC and Big 12 2025): daily from three days out (Wednesday, Thursday,
Friday by 8 pm ET for a Saturday game) and a final Game Day report 90 minutes to two hours before
kickoff. The MAC reports every game (one Game Day report, three hours before kickoff) and the
American its conference games. Players not listed are available. One vendor app serves all six
leagues' reports (app.hdintelligence.com, embedded on secsports.com, theacc.com, big12sports.com,
bigten.org and getsomemaction.com) as public JSON, so this script needs no browser and no key.
The Mountain West publishes its own on themw.com and is not read yet. Run by the **Fetch availability** Action
(fetch-availability.yml); the Claude workspace can't reach the app.

    python scripts/fetch_availability.py [--out data/availability.json] [--dry-run]

Output: {"season", "fetched" (UTC), "source", "conferences": {conf: {"reports": n, "teams": n}},
"teams": {<site team name>: {"conf", "report" (Initial | Update | Game Day), "published" (date),
"posted" (time, in the conference's own zone: Central for the SEC, Big 12 and Big Ten, Eastern for the ACC), "game_date", "game_time", "location", "opponent", "players": [{"name", "pos",
"number", "status", "season_out"}]}}}.

Only each team's newest report is kept, and only while its game hasn't been played (game_date on
or after today, Eastern): after Saturday the file empties for that team until Wednesday's Initial
report, and the Covers.com tags carry those days. Statuses are the conferences' own words: Out,
Doubtful, Questionable, Probable, Game Time Decision, Out (1st Half). "Exempt" rows (deep-roster
players exempt from reporting, no availability information) are dropped. `season_out` is the
report's own out-for-season flag.

Standard library only. Team names come out of the app as the site already spells them (all 67
reporting teams matched data.json on Nov 9, 2026); anything that doesn't match is reported and
kept under its own name.
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HDI = "https://app.hdintelligence.com/api/"
CONFERENCES = {"SEC": "SEC", "ACC": "ACC", "B12": "Big 12", "B10": "Big Ten", "MAC": "MAC", "American": "American"}
# the vendor's team names where they differ from the site's (the MAC's "Miami" is the RedHawks)
RENAME = {("MAC", "Miami"): "Miami (OH)"}
NAME_RE = re.compile(r"^\s*([A-Z/]{1,4})\s*#(\d+)\s+(.*?)\s*$")
REPORT_ORDER = {"Initial": 0, "Update": 1, "Game Day": 2}
KEEP = {"Out", "Doubtful", "Questionable", "Probable", "Game Time Decision", "Out (1st Half)"}
UTC = timezone.utc


def eastern_today():
    """Today's date in the Eastern time zone (reports and game dates are Eastern)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # noqa: BLE001
        return (datetime.now(UTC) - timedelta(hours=5)).date()


def hdi(path, org, tries=3):
    body = json.dumps({"sport": "Football", "organization": org, "conference": org}).encode()
    req = urllib.request.Request(HDI + path, data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "Referer": f"https://app.hdintelligence.com/?source={org}&sport=Football&conf={org}&type=report",
        "User-Agent": "Mozilla/5.0 (cfb-dashboard availability)"})
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001
            last = exc
    raise RuntimeError(f"{org} {path}: {type(last).__name__}: {str(last)[:100]}")


def hms(t):
    """'9:30:00' -> '09:30:00', so posted times sort as text."""
    t = str(t or "")[:8]
    return ("0" + t) if len(t) == 7 and t[1] == ":" else t


def parse_reports(org, payload):
    """One dict per (report, team): the report's metadata plus that team's player rows."""
    out = []
    if not isinstance(payload, dict):
        return out
    for rid, rep in payload.items():
        if not isinstance(rep, dict):
            continue
        rtype = str(rep.get("ReportType") or "")
        if rtype not in REPORT_ORDER:          # "Report Pending" and anything new: nothing to use yet
            continue
        foot = rep.get("footer") or {}
        games = rep.get("games") or []
        names = [RENAME.get((org, g.get("teamDisplayName") or g.get("teamName") or ""), g.get("teamDisplayName") or g.get("teamName") or "") for g in games]
        for g, team in zip(games, names):
            rows = []
            for r in g.get("rows") or []:
                status = str(r.get("status") or "").strip()
                if status not in KEEP:
                    continue
                m = NAME_RE.match(str(r.get("name") or ""))
                pos, num, player = (m.group(1), m.group(2), m.group(3)) if m else ("", "", str(r.get("name") or "").strip())
                rows.append({"name": player, "pos": pos, "number": num, "status": status,
                             "season_out": str(r.get("exemptStatus") or "") == "Out"})
            others = [n for n in names if n != team]
            out.append({"conf": CONFERENCES[org], "report_id": str(rid), "report": rtype,
                        "published": str(rep.get("publishDate") or "")[:10], "posted": hms(rep.get("postedTime")),
                        "game_date": str(foot.get("date") or "")[:10], "game_time": str(foot.get("time") or "")[:8],
                        "location": str(foot.get("location") or ""), "team": team,
                        "opponent": others[0] if len(others) == 1 else "", "players": rows})
    return out


def newest_per_team(reports, today):
    """The newest live report for each team: the highest (published, posted, report order) whose
    game is on or after today."""
    best = {}
    for r in reports:
        try:
            gd = date.fromisoformat(r["game_date"])
        except ValueError:
            continue
        if gd < today:
            continue
        key = (r["published"], r["posted"], REPORT_ORDER[r["report"]])
        cur = best.get(r["team"])
        if cur is None or key > cur[0]:
            best[r["team"]] = (key, r)
    return {t: v[1] for t, v in best.items()}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", default=str(ROOT / "data" / "data.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "availability.json"))
    ap.add_argument("--dry-run", action="store_true", help="print the summary, write nothing")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text())
    site_teams = set(data.get("teams") or {})
    today = eastern_today()
    reports, summary, failed = [], {}, []
    for org, conf in CONFERENCES.items():
        try:
            pub = hdi("get-publish-public", org)
        except RuntimeError as exc:
            print(f"  {conf}: {exc}", file=sys.stderr)
            failed.append(conf)
            continue
        rows = parse_reports(org, pub)
        summary[conf] = {"reports": len({r["report_id"] for r in rows}), "teams": len({r["team"] for r in rows})}
        reports += rows
    if len(failed) == len(CONFERENCES):
        sys.exit("every conference failed; nothing written")

    teams = newest_per_team(reports, today)
    unknown = sorted(t for t in teams if t not in site_teams)
    if unknown:
        print(f"  note: team names not in data.json: {unknown}")
    for conf in summary:
        summary[conf]["live"] = sum(1 for v in teams.values() if v["conf"] == conf)
    out = {
        "season": data.get("season"),
        "fetched": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Conference availability reports (SEC, ACC, Big 12, Big Ten) via app.hdintelligence.com",
        "today": today.isoformat(),
        "failed": failed,
        "conferences": summary,
        "teams": {t: {k: v for k, v in r.items() if k != "team"} for t, r in sorted(teams.items())},
    }
    n_players = sum(len(r["players"]) for r in teams.values())
    print(f"{out['fetched']}: {len(teams)} teams with a live report ({n_players} designations); "
          + "; ".join(f"{c}: {s['reports']} reports, {s['live']} teams live" for c, s in summary.items())
          + (f"; failed: {', '.join(failed)}" if failed else ""))
    if args.dry_run:
        for t, r in list(teams.items())[:6]:
            print(f"  {t} ({r['conf']} {r['report']} {r['published']} {r['posted']}, game {r['game_date']}): "
                  + ", ".join(f"{p['pos']} {p['name']} {p['status']}" for p in r["players"][:6]))
        return
    Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
