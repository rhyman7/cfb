"""Write data/injuries.json: injury designations for the site's players.

College football has no official injury report, so the daily update reads each team's
Covers.com injury page (WebFetch, see WEEKLY_PROMPT.md step 7) and saves the rows as JSON.
This script matches those rows to the players in data/data.json and writes the file the
pages read for the injury tags next to player names.

    python scripts/injuries.py RAW.json [RAW2.json ...] [--out data/injuries.json]

Each RAW file maps a team name (as in data.json) to {"read": bool, "rows": [...]}, one row per
Covers line: {"player": "R. Coleman-Williams", "pos": "WR", "status": "Out",
"injury": "Knee", "date": "Sat, Oct 17", "note": ""}. An optional "_news" list adds or
overrides players from news reports: {"team", "player", "pos", "status", "injury",
"date": "YYYY-MM-DD", "source", "note"}. A news entry beats the Covers row for the same player;
status "Active" removes the player's tag (confirmed back although Covers still lists him).

Covers keeps old entries, so a player who has recorded stats in a game played after his
Covers date is kept but marked "stale" (the tag shows dimmed, with a note that he has
played since). Teams not in the RAW files keep their entries from the published file
when it's the same season, so a team whose page couldn't be read isn't wiped out.

Official reports beat Covers. data/availability.json (scripts/fetch_availability.py, the
Fetch availability Action) holds each power-conference team's newest availability report for a
conference game it hasn't played yet. For every team with a live report, this script drops that
team's Covers and news rows (except Covers rows that say out for the season, for a player the
report doesn't list) and tags the report's players instead: Out -> O, Doubtful -> D,
Questionable -> Q, Probable -> P, Game Time Decision -> Q, Out (1st Half) -> P (a targeting
suspension; he plays the second half). Players the report doesn't list are available, so a Covers
tag they still carry comes off. `checked[team]` becomes the report's date and `reports[team]`
records which report it was. Pass --no-availability to skip this (or point --availability at
another file). A file fetched more than MAX_AVAIL_AGE days ago is ignored.
"""
import argparse
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUS = {"out": "O", "out for season": "O", "ir": "O", "injured reserve": "O", "doubtful": "D",
          "questionable": "Q", "day-to-day": "Q", "game-time decision": "Q", "probable": "P"}
LABEL = {"O": "Out", "D": "Doubtful", "Q": "Questionable", "P": "Probable"}
# the conferences' own designations -> (tag, label shown on hover)
CONF_STATUS = {"out": ("O", "Out"), "doubtful": ("D", "Doubtful"), "questionable": ("Q", "Questionable"),
               "probable": ("P", "Probable"), "game time decision": ("Q", "Game-time decision"),
               "out (1st half)": ("P", "Out 1st half (targeting)")}
MAX_AVAIL_AGE = 5   # days; an availability.json older than this is ignored
SUFFIX = {"jr", "sr", "ii", "iii", "iv", "v"}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]", "", s.replace("-", " ").replace("'", "").replace(".", " "))


def name_parts(name):
    """(first initial, last name) with suffixes dropped; 'T.Y. Harding' -> ('t', 'harding')."""
    tokens = (name or "").split()
    if not tokens:
        return "", ""
    first = norm(tokens[0]).replace(" ", "")
    rest = [w for w in norm(" ".join(tokens[1:])).split() if w not in SUFFIX]
    return first[:1], " ".join(rest) or first


def parse_date(text, today):
    """'Sat, Oct 17' (no year) or '2026-10-17' -> date; Covers dates are this season."""
    text = (text or "").strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        pass
    m = re.search(r"([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})", text)
    if not m or m.group(1).lower() not in MONTHS:
        return None
    d = date(today.year, MONTHS[m.group(1).lower()], int(m.group(2)))
    return d if d <= today else date(today.year - 1, d.month, d.day)


def short_note(note):
    n = (note or "").lower()
    if "season" in n and ("out" in n or "miss" in n or "shut" in n):
        return "out for the season"
    if "timetable" in n:
        return "no timetable for return"
    if "extended" in n:
        return "will miss an extended period"
    if "undetermined" in n or "unclear how long" in n:
        return "out for an undetermined time"
    return ""


def game_dates(data):
    """(team name, week) -> game date, from data/weeks/<N>.json."""
    out = {}
    for f in sorted((ROOT / "data" / "weeks").glob("*.json")):
        wk = json.loads(f.read_text())
        for g in wk.get("weekGames", []):
            if not g.get("start"):
                continue
            d = date.fromisoformat(g["start"][:10])
            for side in ("away", "home"):
                name = g[side].get("key") or g[side].get("name")
                out[(name, wk["week"])] = d
    return out


def load_availability(path, today, notes):
    """data/availability.json's live reports, or None if the file is missing, old or empty.
    A report whose game date has passed is dropped here too (the fetch does the same)."""
    if not path.exists():
        return None
    try:
        a = json.loads(path.read_text())
        fetched = datetime.fromisoformat(a["fetched"].replace("Z", "+00:00")).date()
    except (ValueError, KeyError, TypeError):
        notes.append(f"availability: {path.name} unreadable, ignored")
        return None
    if (today - fetched).days > MAX_AVAIL_AGE:
        notes.append(f"availability: fetched {fetched}, more than {MAX_AVAIL_AGE} days ago, ignored")
        return None
    teams = {}
    for team, rep in (a.get("teams") or {}).items():
        gd = parse_date(rep.get("game_date"), today)
        if gd and gd < today:
            continue
        teams[team] = rep
    return {"fetched": a["fetched"], "teams": teams} if teams else None


def team_players(t):
    seen = {}
    for kind in ("passing", "rushing", "receiving"):
        for r in t.get(kind) or []:
            if r.get("log") and r["log"] not in seen:
                seen[r["log"]] = r
    return list(seen.values())


def match(row, players):
    ini, last = name_parts(row["player"])
    pos = (row.get("pos") or "").upper()
    full = norm(row["player"])
    exact = [p for p in players if norm(p["player"]) == full]
    if len(exact) == 1:
        return exact[0]
    cands = [p for p in players if name_parts(p["player"])[1] == last]
    if len(cands) > 1:
        cands = [p for p in cands if name_parts(p["player"])[0] == ini] or cands
    if len(cands) > 1:
        cands = [p for p in cands if (p.get("pos") or "").upper() == pos]
    if len(cands) == 1 and name_parts(cands[0]["player"])[0] == ini:
        return cands[0]
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("raw", nargs="*", help="JSON files of Covers rows by team (none: keep the published Covers tags)")
    ap.add_argument("--data", default=str(ROOT / "data" / "data.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "injuries.json"))
    ap.add_argument("--availability", default=str(ROOT / "data" / "availability.json"),
                    help="conference availability reports (scripts/fetch_availability.py)")
    ap.add_argument("--no-availability", action="store_true", help="tag from Covers and news only")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text())
    today = datetime.now(timezone.utc).date()
    dates = game_dates(data)
    raw, news = {}, []
    for f in args.raw:
        d = json.loads(Path(f).read_text())
        news += d.pop("_news", [])
        raw.update(d)

    out_path = Path(args.out)
    old = json.loads(out_path.read_text()) if out_path.exists() else {}
    if old.get("season") != data["season"]:
        old = {}

    players, unmatched, teams_read, notes = {}, [], [], []
    # teams not read this time keep their published entries
    for key, e in (old.get("players") or {}).items():
        if e.get("team") not in raw or not raw[e["team"]].get("read", True):
            players[key] = e
    for e in old.get("unmatched") or []:
        if e.get("team") not in raw or not raw[e["team"]].get("read", True):
            unmatched.append(e)

    def add(team, row, src, d):
        t = data["teams"].get(team)
        if t is None:
            notes.append(f"unknown team {team!r}")
            return
        status = (row.get("status") or "").strip().lower()
        if status in ("active", "available", "cleared"):  # news: back, so drop the Covers tag
            p = match(row, team_players(t))
            if p:
                players.pop(p["log"], None)
            return
        s = STATUS.get(status)
        if not s:
            notes.append(f"{team}: unknown status {row.get('status')!r} for {row.get('player')}")
            return
        injury = (row.get("injury") or "").strip()
        when = d.strftime("%b %-d") if d else ""
        extra = short_note(row.get("note")) if src == "Covers" else (row.get("note") or "").strip()
        entry = {
            "s": s, "status": LABEL[s], "injury": injury if injury.lower() != "undisclosed" else "",
            "date": d.isoformat() if d else None, "src": src, "name": row["player"], "team": team,
            "pos": row.get("pos") or "",
            "note": " · ".join(x for x in [injury or "Undisclosed", f"{src}, {when}".strip(", "), extra] if x),
        }
        p = match(row, team_players(t))
        if p is None:
            unmatched.append(entry)
            return
        log = data["gameLogs"].get(p["log"], [])
        later = [e["w"] for e in log if d and dates.get((team, e["w"])) and dates[(team, e["w"])] > d]
        if later:
            entry["stale"] = True
            entry["playedSince"] = max(later)
        entry["player"] = p["player"]
        players[p["log"]] = entry  # news runs after Covers, so it replaces the Covers row

    for team, v in raw.items():
        if not v.get("read", True):
            continue
        teams_read.append(team)
        for row in v.get("rows") or []:
            add(team, row, "Covers", parse_date(row.get("date"), today))
    for n in news:
        add(n["team"], n, n.get("source") or "news", parse_date(n.get("date"), today))

    checked = {**(old.get("checked") or {}), **{t: today.isoformat() for t in teams_read}}

    # the conferences' official reports: for every team with a live one, the report replaces
    # the team's Covers and news tags (season-long Covers outs stay unless the report lists him)
    reports, avail_teams = {}, []
    avail = load_availability(Path(args.availability), today, notes) if not args.no_availability else None
    if avail:
        for team, rep in avail["teams"].items():
            t = data["teams"].get(team)
            if t is None:
                notes.append(f"availability: unknown team {team!r}")
                continue
            avail_teams.append(team)
            roster = team_players(t)
            on_report = {norm(p["name"]) for p in rep["players"]}
            keep_season = lambda e: e.get("src") == "Covers" and "season" in (e.get("note") or "").lower() and norm(e.get("name")) not in on_report
            for key in [k for k, e in players.items() if e.get("team") == team and not keep_season(e)]:
                players.pop(key)
            unmatched[:] = [e for e in unmatched if e.get("team") != team or keep_season(e)]
            when = parse_date(rep.get("published"), today)
            label_when = when.strftime("%b %-d") if when else rep.get("published", "")
            for p in rep["players"]:
                s, label = CONF_STATUS.get(p["status"].lower(), (None, None))
                if s is None:
                    notes.append(f"{team}: unknown report status {p['status']!r} for {p['name']}")
                    continue
                if p.get("season_out"):
                    label = "Out for season"
                src = f"{rep['conf']} report"
                entry = {
                    "s": s, "status": label, "injury": "", "date": when.isoformat() if when else None, "src": src,
                    "name": p["name"], "team": team, "pos": p.get("pos") or "",
                    "note": f"{rep['conf']} availability report, {rep['report']} ({label_when})"
                            + (" · out for the season" if p.get("season_out") else ""),
                }
                m = match({"player": p["name"], "pos": p.get("pos")}, roster)
                if m is None:
                    unmatched.append(entry)
                    continue
                log = data["gameLogs"].get(m["log"], [])
                later = [e["w"] for e in log if when and dates.get((team, e["w"])) and dates[(team, e["w"])] > when]
                if later:
                    entry["stale"] = True
                    entry["playedSince"] = max(later)
                entry["player"] = m["player"]
                players[m["log"]] = entry
            checked[team] = when.isoformat() if when else today.isoformat()
            reports[team] = {k: rep.get(k) for k in ("conf", "report", "published", "posted", "game_date", "opponent")}
            reports[team]["listed"] = len(rep["players"])

    out = {
        "season": data["season"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Conference availability reports where a team has one; otherwise Covers.com team injury pages, plus news reports where noted",
        "teamsRead": sorted(teams_read),
        # when each team's page was last read (kept from earlier runs for teams not read now),
        # or the date of its availability report
        "checked": dict(sorted(checked.items())),
        # teams whose tags come from an official conference report (and which report)
        "reports": dict(sorted(reports.items())),
        "players": dict(sorted(players.items())),
        "unmatched": unmatched,
    }
    out_path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    stale = sum(1 for e in players.values() if e.get("stale"))
    from_reports = sum(1 for e in players.values() if str(e.get("src", "")).endswith(" report"))
    print(f"Wrote {out_path}: {len(players)} players tagged ({from_reports} from conference reports, {stale} marked stale: played since), "
          f"{len(unmatched)} rows not matched to a site player, {len(teams_read)} Covers teams read, "
          f"{len(avail_teams)} teams on a live conference report")
    for n in notes:
        print("  note:", n)


if __name__ == "__main__":
    sys.exit(main())
