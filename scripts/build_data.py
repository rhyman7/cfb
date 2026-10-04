"""Build data/data.json for the CFB Matchup Dashboard.

Source: sportsdataverse/cfbfastR-cfb-data on GitHub (ESPN-derived game box
scores, committed as parquet and refreshed several times a day). Everything is
downloaded from raw.githubusercontent.com — no API key needed.

Scope: all FBS teams, 2026 regular season (season_type 2), completed games.
Everything is rebuilt from scratch from the current season's files each run,
with one exception: `lineOpen` on this week's games (the line at the week's
first build) is carried over from the existing output file when it covers the
same season and week, so the site can show how far the line has moved.

Next to data.json the build also writes the files behind the site's week strip:
    data/season.json      every regular-season week: game count, first/last game day, game ids
    data/weeks/<N>.json   that week's games, in the same shape as data.json's weekGames.
                          Finished weeks carry the final scores, with each team's record
                          and AP rank going into the week; later weeks are the schedule so far.

Usage:
    pip install -r requirements.txt
    python scripts/build_data.py            # writes data/data.json
    python scripts/build_data.py --season 2026 --cache .cache
"""

import argparse
import copy
import io
import json
import math
import re
import os
import sys
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb"
FILES = {
    "schedule": "schedules/parquet/cfb_schedule_{s}.parquet",
    "team_box": "team_box/parquet/team_box_{s}.parquet",
    "player_box": "player_box/parquet/player_box_{s}.parquet",
    "teams": "cfb_teams/parquet/cfb_teams_{s}.parquet",
    "rosters": "cfb_rosters/parquet/cfb_rosters_{s}.parquet",
    # per-game ESPN rosters: position fallback for players missing from cfb_rosters
    "game_rosters": "game_rosters/parquet/game_rosters_{s}.parquet",
    # play-by-play: EPA per play, success rate, and receiver targets
    "pbp": "pbp/parquet/play_by_play_{s}.parquet",
    # betting lines + other pregame context for every FBS-vs-FBS game, incl. upcoming ones
    "matchup_line": "cfb_matchup_line/parquet/cfb_matchup_line_{s}.parquet",
    # full season schedule incl. upcoming games (the data repo's copy only has finals)
    "full_schedule": "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-raw/main/cfb/schedules/csv/cfb_schedule_{s}.csv",
}

# stat_1..stat_5 layout used by some player_box rows that lack named columns
STAT_LAYOUT = {
    "passing": ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt",
                "passingTouchdowns", "interceptions"],
    "rushing": ["rushingAttempts", "rushingYards", "yardsPerRushAttempt",
                "rushingTouchdowns", "longRushing"],
    "receiving": ["receptions", "receivingYards", "yardsPerReception",
                  "receivingTouchdowns", "longReception"],
}

POS_GROUP = {"RB": "RB", "FB": "RB", "TE": "TE", "WR": "WR"}

# ESPN college football position ids (as used in game_rosters' position_href) -> abbreviation,
# taken from cfb_rosters' own position_id / position_abbreviation pairs.
ESPN_POS = {1: "WR", 4: "C", 7: "TE", 8: "QB", 9: "RB", 10: "FB", 12: "NT", 22: "PK", 23: "P",
            29: "CB", 30: "LB", 31: "DE", 32: "DT", 35: "DB", 36: "S", 37: "DL", 45: "OL",
            46: "OT", 73: "G", 76: "PR", 78: "LS", 264: "EDGE"}


def load(name, season, cache):
    rel = FILES[name].format(s=season)
    url = rel if rel.startswith("http") else f"{BASE}/{rel}"
    reader = pd.read_csv if url.endswith(".csv") else pd.read_parquet
    path = os.path.join(cache, os.path.basename(url)) if cache else None
    if path and os.path.exists(path):
        return reader(path)
    with urllib.request.urlopen(url, timeout=120) as r:
        raw = r.read()
    if path:
        os.makedirs(cache, exist_ok=True)
        with open(path, "wb") as f:
            f.write(raw)
    return reader(io.BytesIO(raw))


def load_optional(name, season, cache, notes):
    try:
        return load(name, season, cache)
    except Exception as e:  # noqa: BLE001 - a missing optional file only drops that feature
        notes.append(f"{name}: {e}")
        return None


def positions(rosters, game_rosters):
    """athlete_id -> position abbreviation. cfb_rosters is used for every player it lists;
    game_rosters (ESPN position ids, most common across the player's games) fills in players
    cfb_rosters is missing. Returns (roster frame for Def vs Position, full position map, count
    of athletes filled from game_rosters)."""
    r = rosters[["athlete_id", "team_id", "position_abbreviation"]].copy()
    r["athlete_id"] = num(r["athlete_id"])
    on_roster = set(r["athlete_id"].dropna())
    extra = pd.DataFrame(columns=["athlete_id", "team_id", "position_abbreviation"])
    if game_rosters is not None and len(game_rosters):
        gr = game_rosters[["athlete_id", "team_id", "position_href"]].copy()
        gr["athlete_id"] = num(gr["athlete_id"])
        pid = num(gr["position_href"].astype("string").str.extract(r"positions/(\d+)")[0])
        # learn any extra ids from the roster file itself, then fall back to the fixed table
        learned = {}
        if "position_id" in rosters.columns:
            for i, a in rosters[["position_id", "position_abbreviation"]].dropna().drop_duplicates().itertuples(index=False):
                try:
                    learned[int(i)] = str(a)
                except (TypeError, ValueError):
                    pass
        idmap = {**ESPN_POS, **learned}
        gr["position_abbreviation"] = pid.map(lambda x: idmap.get(int(x)) if pd.notna(x) else None)
        gr = gr.dropna(subset=["athlete_id", "position_abbreviation"])
        gr = gr[~gr["athlete_id"].isin(on_roster)]
        if len(gr):
            extra = (gr.groupby("athlete_id")
                       .agg(team_id=("team_id", "first"),
                            position_abbreviation=("position_abbreviation", lambda x: x.mode().iat[0]))
                       .reset_index())
    both = pd.concat([r, extra], ignore_index=True).dropna(subset=["athlete_id"])
    both["athlete_id"] = both["athlete_id"].astype("int64")
    pos_all = {}
    for a, p in both[["athlete_id", "position_abbreviation"]].dropna().itertuples(index=False):
        pos_all.setdefault(int(a), str(p))
    return both, pos_all, int(extra["athlete_id"].nunique())


def num(s):
    return pd.to_numeric(s, errors="coerce")


def r1(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 1)


def r2(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 2)


def rank(series, ascending):
    """Competition rank, 1 = best. ascending=True means lower is better."""
    return series.rank(method="min", ascending=ascending).astype(int)


def player_category(pb, cat):
    d = pb[pb["category"] == cat].copy()
    for i, col in enumerate(STAT_LAYOUT[cat], start=1):
        stat = f"stat_{i}"
        if stat in d.columns:
            d[col] = d[col].where(d[col].notna(), d[stat]) if col in d.columns else d[stat]
    if cat == "passing":
        ca = d["completions/passingAttempts"].astype("string").str.split("/", expand=True)
        d["cmp"] = num(ca[0])
        d["att"] = num(ca[1]) if ca.shape[1] > 1 else np.nan
    for col in STAT_LAYOUT[cat]:
        if col != "completions/passingAttempts":
            d[col] = num(d[col])
    # ESPN adds a team-level "Team" line to some box scores; it isn't a player
    d = d[d["athlete_id"].notna() & (d["athlete_name"].astype("string").str.strip().str.lower() != "team")]
    return d


def solve_srs(games, teams):
    """Simple Rating System from FBS-vs-FBS games (points, no home edge).

    Returns SRS, OSRS, DSRS per team. OSRS/DSRS come from
    pts_scored(a vs b) = avg + OSRS_a - DSRS_b, solved by least squares with a
    tiny ridge so early-season, sparsely connected schedules stay stable.
    SRS = OSRS + DSRS.
    """
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    rows, y = [], []
    for g in games.itertuples():
        for off, dfn, pts in ((g.home_id, g.away_id, g.home_score),
                              (g.away_id, g.home_id, g.away_score)):
            row = np.zeros(2 * n)
            row[idx[off]] = 1.0          # offense rating of scorer
            row[n + idx[dfn]] = -1.0     # defense rating of opponent
            rows.append(row)
            y.append(pts)
    A = np.array(rows)
    y = np.array(y, dtype=float)
    y = y - y.mean()
    lam = 0.5
    x = np.linalg.solve(A.T @ A + lam * np.eye(2 * n), A.T @ y)
    osrs, dsrs = x[:n], x[n:]
    return {t: (osrs[i] + dsrs[i], osrs[i], dsrs[i]) for t, i in idx.items()}


def overall_record(records):
    """Pull the overall W-L out of ESPN's records blob (used for FCS opponents)."""
    m = re.search(r"'summary':\s*'(\d+-\d+(?:-\d+)?)'", str(records))
    return m.group(1) if m else ""


def current_poll(full, week=None):
    """team_id -> current AP rank. ESPN tags every unplayed game with each team's
    current poll rank, so each team's next unplayed game gives the latest poll
    (this also covers teams on a bye). Falls back to the latest game played.

    With `week`, the poll going into that week instead: a finished game keeps the rank
    each team had at kickoff, so a team's first game in that week or later gives it."""
    reg = full[full["season_type"] == 2]
    rows = []
    for p in ("home", "away"):
        d = reg[["week", "status_type_completed", f"{p}_id", f"{p}_current_rank"]].copy()
        d.columns = ["week", "done", "team_id", "rank"]
        rows.append(d)
    r = pd.concat(rows)
    r["rank"] = num(r["rank"])
    ahead = ~r["done"].astype(bool) if week is None else r["week"] >= week
    upcoming = r[ahead].sort_values("week").groupby("team_id").first()["rank"]
    if upcoming.empty:
        upcoming = r.sort_values("week").groupby("team_id").last()["rank"]
    return {int(t): int(k) for t, k in upcoming.items() if pd.notna(k) and 1 <= k <= 25}


def half(x):
    """Round a consensus line (e.g. -24.25) to the nearest half point."""
    return None if x is None or pd.isna(x) else round(float(x) * 2) / 2


def week_games(full, id_to_name, team_rows, poll, lines, qbs, week=None, records=None):
    """Games for the current week: the first regular-season week that still has
    an unplayed game (or the final week once everything is complete).

    With `week`, that week's games instead; `records` ({team name: "2-1"}) then replaces
    the current records, for a finished week shown as it stood."""
    reg = full[full["season_type"] == 2].copy()
    if reg.empty:
        return None, []
    if week is None:
        open_weeks = reg.loc[~reg["status_type_completed"].astype(bool), "week"]
        week = int(open_weeks.min()) if len(open_weeks) else int(reg["week"].max())
    wk = reg[reg["week"] == week].sort_values(["start_date", "game_id"])

    def side(r, pfx):
        tid = int(r[f"{pfx}_id"])
        key = id_to_name.get(tid)
        rank = poll.get(tid)
        if key:
            rec = team_rows[key]["record"]
            record = f"{rec['w']}-{rec['l']}" + (f"-{rec['t']}" if rec["t"] else "")
            if records is not None:
                record = records.get(key, "0-0")
            conf = team_rows[key]["conference"]
            name = key
        else:
            # ESPN only has a non-FBS team's record as of today, so leave it off a finished week
            record = overall_record(r.get(f"{pfx}_records")) if records is None else ""
            conf = "FCS"
            name = r.get(f"{pfx}_location") or r.get(f"{pfx}_short_display_name") or r.get(f"{pfx}_display_name")
        score = num(pd.Series([r.get(f"{pfx}_score")])).iloc[0]
        return {
            "name": str(name),
            "key": key,  # matches a key in "teams", or null for non-FBS teams
            "rank": rank,
            "record": record,
            "conference": conf,
            "score": int(score) if pd.notna(score) and bool(r["status_type_completed"]) else None,
            "abbr": team_rows[key]["abbr"] if key else str(r.get(f"{pfx}_abbreviation") or name),
            "qb": qbs.get(tid),
        }

    games = []
    for _, r in wk.iterrows():
        tv = r.get("broadcast_name") if isinstance(r.get("broadcast_name"), str) else r.get("broadcast")
        ln = lines.get(int(r["game_id"]), {})
        games.append({
            "id": str(int(r["game_id"])),
            "week": week,
            "start": r["start_date"],
            "timeTbd": not bool(r.get("time_valid", True)),
            "neutral": bool(r.get("neutral_site", False)),
            "conferenceGame": bool(r.get("conference_competition", False)),
            "status": r.get("status_type_name", ""),
            "statusDetail": r.get("status_type_short_detail", "") if isinstance(r.get("status_type_short_detail"), str) else "",
            "completed": bool(r["status_type_completed"]),
            "venue": r.get("venue_full_name") if isinstance(r.get("venue_full_name"), str) else "",
            "city": ", ".join(x for x in [r.get("venue_address_city"), r.get("venue_address_state")] if isinstance(x, str)),
            "tv": tv if isinstance(tv, str) else "",
            "note": r.get("notes_headline") if isinstance(r.get("notes_headline"), str) else "",
            "indoor": bool(r.get("venue_indoor")) if pd.notna(r.get("venue_indoor")) else None,
            # home team's spread: negative = home favored
            "spread": half(ln.get("spread")),
            "total": half(ln.get("over_under")),
            "away": side(r, "away"),
            "home": side(r, "home"),
        })
    # keep games involving at least one FBS team (the FBS schedule already does)
    games = [x for x in games if x["away"]["key"] or x["home"]["key"]]
    return week, games


def betting_trends(g, lines, results, fbs_ids):
    """Record against the spread and over/under per FBS team, from each completed game's
    cfbfastR matchup line (rounded to the half point, as the site shows lines). The
    matchup line is the home team's spread (negative = home favored); a team's own line
    is negative when it was favored. Games without a line are skipped. Neutral-site games
    count toward overall / favorite / underdog but not home / away."""
    def tally():
        return {"w": 0, "l": 0, "p": 0}

    out = {t: {"ats": tally(), "fav": tally(), "dog": tally(), "home": tally(), "away": tally(),
               "ou": {"o": 0, "u": 0, "p": 0}, "games": []} for t in fbs_ids}
    for r in g.sort_values(["week", "game_date", "game_id"]).itertuples():
        ln = lines.get(int(r.game_id), {})
        spread = half(ln.get("spread"))
        if spread is None:
            continue
        total = half(ln.get("over_under"))
        neutral = bool(r.neutral_site)
        for tid, side, us, them in ((r.home_id, "home", r.home_score, r.away_score),
                                    (r.away_id, "away", r.away_score, r.home_score)):
            if tid not in out:
                continue
            line = spread if side == "home" else -spread
            line = 0.0 if line == 0 else line
            margin = us - them + line
            res = "W" if margin > 0 else "L" if margin < 0 else "P"
            key = res.lower()
            b = out[tid]
            b["ats"][key] += 1
            if line < 0:
                b["fav"][key] += 1
            elif line > 0:
                b["dog"][key] += 1
            if not neutral:
                b[side][key] += 1
            info = results[(r.game_id, tid)]
            e = {"w": int(r.week), "opp": info["opp"], "at": bool(info["at"]), "line": line,
                 "score": f"{int(us)}-{int(them)}", "ats": res}
            if total is not None:
                pts = us + them
                ou = "O" if pts > total else "U" if pts < total else "P"
                b["ou"][ou.lower()] += 1
                e.update({"total": total, "ou": ou})
            b["games"].append(e)
    return out


def efficiency(pbp, game_ids, fbs_ids):
    """EPA per play and success rate for each FBS offense and defense, from play-by-play:
    rush and pass plays (sacks count as pass plays) in completed regular-season games,
    leaving out QB kneels and plays wiped out by a penalty. Success = EPA > 0.
    Ranks: offense highest = #1, defense lowest allowed = #1, among FBS teams."""
    d = pbp[pbp["game_id"].isin(game_ids) & (pbp["rush"].astype(bool) | pbp["pass"].astype(bool))
            & ~pbp["kneel_down"].astype(bool) & ~pbp["penalty_no_play"].astype(bool) & pbp["EPA"].notna()]
    d = d.assign(succ=d["EPA_success"].astype(bool).astype(float))

    def side(col):
        gb = d.groupby(col)
        f = pd.DataFrame({"epa": gb["EPA"].mean(), "sr": gb["succ"].mean() * 100, "plays": gb.size(),
                          "passEpa": d[d["pass"].astype(bool)].groupby(col)["EPA"].mean(),
                          "rushEpa": d[d["rush"].astype(bool)].groupby(col)["EPA"].mean()})
        return f[f.index.isin(fbs_ids)]

    o, df_ = side("pos_team_id"), side("def_pos_team_id")
    o["epaRank"], o["srRank"] = rank(o["epa"], False), rank(o["sr"], False)
    df_["epaRank"], df_["srRank"] = rank(df_["epa"], True), rank(df_["sr"], True)
    r3 = lambda x: None if pd.isna(x) else round(float(x), 3)  # noqa: E731
    out = {}
    for t in o.index.intersection(df_.index):
        out[int(t)] = {k: {"epa": r3(f.loc[t, "epa"]), "sr": r1(f.loc[t, "sr"]), "passEpa": r3(f.loc[t, "passEpa"]),
                           "rushEpa": r3(f.loc[t, "rushEpa"]), "plays": int(f.loc[t, "plays"]),
                           "epaRank": int(f.loc[t, "epaRank"]), "srRank": int(f.loc[t, "srRank"])}
                       for k, f in (("off", o), ("def", df_))}
    return out


def carry_line_open(games, week, season, prev_path):
    """lineOpen = the line at this week's first build. Kept from the existing output file
    when it covers the same season and week (its lineOpen, or, for a file written before
    lineOpen existed, that build's own spread/total); otherwise today's line."""
    prev = {}
    try:
        with open(prev_path, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("season") == season and old.get("currentWeek") == week:
            at = str(old.get("generatedAt", ""))[:10]
            try:
                at = datetime.fromisoformat(old["generatedAt"]).astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
            except (KeyError, ValueError, TypeError):
                pass
            for x in old.get("weekGames", []):
                lo = x.get("lineOpen") or {"spread": x.get("spread"), "total": x.get("total"), "at": at}
                if lo.get("spread") is not None or lo.get("total") is not None:
                    prev[x["id"]] = lo
    except (OSError, ValueError):
        pass
    today = datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    for x in games:
        x["lineOpen"] = prev.get(x["id"]) or {"spread": x["spread"], "total": x["total"], "at": today}
    return sum(1 for x in games if x["id"] in prev)


def gauge_max(series):
    return int(math.ceil(float(series.max()) / 5.0) * 5)


def build(season, cache, prev_path=None):
    sched = load("schedule", season, cache)
    tbox = load("team_box", season, cache)
    pbox = load("player_box", season, cache)
    teams = load("teams", season, cache)
    rosters = load("rosters", season, cache)
    notes = []
    game_rosters = load_optional("game_rosters", season, cache, notes)
    pbp = load_optional("pbp", season, cache, notes)

    # --- games in scope: regular season, final ---
    g = sched[(sched["season_type"] == 2) & (sched["status"] == "STATUS_FINAL")].copy()
    g["home_score"] = num(g["home_score"])
    g["away_score"] = num(g["away_score"])
    g = g.dropna(subset=["home_score", "away_score"])
    game_ids = set(g["game_id"])

    fbs = teams[teams["classification"] == "fbs"].copy()
    fbs_ids = set(fbs["team_id"])

    # --- team-game table (one row per team per game) ---
    tg = pd.concat([
        g.rename(columns={"home_id": "team_id", "away_id": "opp_id",
                          "home_score": "pf", "away_score": "pa"}),
        g.rename(columns={"away_id": "team_id", "home_id": "opp_id",
                          "away_score": "pf", "home_score": "pa"}),
    ])[["game_id", "week", "team_id", "opp_id", "pf", "pa"]]

    tb = tbox[tbox["game_id"].isin(game_ids)].copy()
    tb["rushYds"] = num(tb["rushingYards"])
    tb["passYds"] = num(tb["netPassingYards"])
    tb = tb[["game_id", "team_id", "rushYds", "passYds"]]

    passing = player_category(pbox[pbox["game_id"].isin(game_ids)], "passing")
    rushing = player_category(pbox[pbox["game_id"].isin(game_ids)], "rushing")
    receiving = player_category(pbox[pbox["game_id"].isin(game_ids)], "receiving")

    ptd = passing.groupby(["game_id", "team_id"]).agg(
        passTd=("passingTouchdowns", "sum"), passInt=("interceptions", "sum")).reset_index()
    rtd = rushing.groupby(["game_id", "team_id"]).agg(rushTd=("rushingTouchdowns", "sum")).reset_index()

    tg = (tg.merge(tb, on=["game_id", "team_id"], how="left")
            .merge(ptd, on=["game_id", "team_id"], how="left")
            .merge(rtd, on=["game_id", "team_id"], how="left"))
    # opponent's numbers = what this team's defense allowed
    opp = tg[["game_id", "team_id", "rushYds", "passYds", "passTd", "passInt", "rushTd"]].rename(
        columns={"team_id": "opp_id", "rushYds": "o_rushYds", "passYds": "o_passYds",
                 "passTd": "o_passTd", "passInt": "o_passInt", "rushTd": "o_rushTd"})
    tg = tg.merge(opp, on=["game_id", "opp_id"], how="left")

    tg = tg[tg["team_id"].isin(fbs_ids)]
    per = tg.groupby("team_id").agg(
        gp=("game_id", "nunique"),
        pf=("pf", "mean"), pa=("pa", "mean"),
        rushYdsG=("rushYds", "mean"), passYdsG=("passYds", "mean"),
        rushTdG=("rushTd", "mean"), passTdG=("passTd", "mean"), intG=("passInt", "mean"),
        d_rushYdsG=("o_rushYds", "mean"), d_passYdsG=("o_passYds", "mean"),
        d_rushTdG=("o_rushTd", "mean"), d_passTdG=("o_passTd", "mean"), d_intG=("o_passInt", "mean"),
    )
    wl = tg.assign(win=tg["pf"] > tg["pa"], loss=tg["pf"] < tg["pa"], tie=tg["pf"] == tg["pa"]) \
           .groupby("team_id")[["win", "loss", "tie"]].sum()
    per["w"], per["l"], per["t"] = wl["win"], wl["loss"], wl["tie"]
    per = per.fillna(0)

    per["offRushRk"] = rank(per["rushYdsG"], ascending=False)
    per["offPassRk"] = rank(per["passYdsG"], ascending=False)
    per["defRushRk"] = rank(per["d_rushYdsG"], ascending=True)
    per["defPassRk"] = rank(per["d_passYdsG"], ascending=True)

    # --- SRS (FBS vs FBS only) ---
    fbs_games = g[g["home_id"].isin(fbs_ids) & g["away_id"].isin(fbs_ids)]
    srs = solve_srs(fbs_games, sorted(per.index))
    sos = {}
    for t in per.index:
        opps = tg[(tg["team_id"] == t) & tg["opp_id"].isin(fbs_ids)]["opp_id"]
        sos[t] = float(np.mean([srs[o][0] for o in opps])) if len(opps) else 0.0

    # --- positions for Def vs Position ---
    roster_pos, pos_all, filled = positions(rosters, game_rosters)
    if filled:
        notes.append(f"positions for {filled} players filled from game_rosters "
                     f"(cfb_rosters lists {int(rosters['team_id'].nunique())} teams)")
    pos = roster_pos.copy()
    pos["grp"] = pos["position_abbreviation"].map(POS_GROUP)
    pos = pos.dropna(subset=["grp"]).drop_duplicates("athlete_id")[["athlete_id", "grp"]]

    game_opp = tg[["game_id", "team_id", "opp_id"]]  # rows keyed by FBS team (defense)

    def allowed(df, yds_col, td_col, grp):
        d = df.merge(pos, on="athlete_id", how="inner")
        d = d[d["grp"] == grp]
        agg = d.groupby(["game_id", "team_id"]).agg(yds=(yds_col, "sum"), td=(td_col, "sum")).reset_index()
        agg = agg.rename(columns={"team_id": "opp_id"})
        m = game_opp.merge(agg, on=["game_id", "opp_id"], how="left").fillna({"yds": 0, "td": 0})
        out = m.groupby("team_id").agg(yds=("yds", "mean"), td=("td", "mean"))
        out["rank"] = rank(out["yds"], ascending=True)
        return out

    dvp = {
        "rb": allowed(rushing, "rushingYards", "rushingTouchdowns", "RB"),
        "recRb": allowed(receiving, "receivingYards", "receivingTouchdowns", "RB"),
        "te": allowed(receiving, "receivingYards", "receivingTouchdowns", "TE"),
        "wr": allowed(receiving, "receivingYards", "receivingTouchdowns", "WR"),
    }

    # --- player tables ---
    def top(df, n, team_gp):
        """Sort by yards/game; regulars (>= half the team's games) first."""
        df = df.assign(ypg=df["yds"] / df["gp"], reg=df["gp"] >= team_gp / 2.0)
        return df.sort_values(["reg", "ypg"], ascending=[False, False]).head(n)

    # --- per-game logs for every player shown in a table (keyed "ABBR|athlete_id") ---
    # Only games the player played for this team, so the log matches the table averages.
    meta = fbs.set_index("team_id")
    results = {}  # (game_id, team_id) -> week, opponent, home/away, result
    for r in g.itertuples():
        for tid, oid, us, them, away in ((r.home_id, r.away_id, r.home_score, r.away_score, False),
                                         (r.away_id, r.home_id, r.away_score, r.home_score, True)):
            opp_abbr = getattr(r, "home_abbreviation" if away else "away_abbreviation")
            res = "W" if us > them else "L" if us < them else "T"
            results[(r.game_id, tid)] = {
                "w": int(r.week), "opp": str(opp_abbr) if isinstance(opp_abbr, str) else "?",
                "at": away and not bool(r.neutral_site), "res": f"{res} {int(us)}-{int(them)}"}

    def per_game(df, cols):
        return df.groupby(["team_id", "athlete_id", "game_id"])[list(cols)].sum().rename(columns=cols)

    pg = pd.concat([
        per_game(passing, {"cmp": "cmp", "att": "att", "passingYards": "pYds",
                           "passingTouchdowns": "pTd", "interceptions": "int"}),
        per_game(rushing, {"rushingAttempts": "car", "rushingYards": "rYds", "rushingTouchdowns": "rTd"}),
        per_game(receiving, {"receptions": "rec", "receivingYards": "recYds", "receivingTouchdowns": "recTd"}),
    ], axis=1).fillna(0)
    if pbp is not None:
        # targets aren't in the ESPN box scores; count them from play-by-play (receiver on a
        # targeted pass). Only added to games the player already has a box-score line in.
        tp = pbp[pbp["target"].astype(bool) & pbp["receiver_player_id"].notna() & pbp["game_id"].isin(game_ids)]
        tgt = (tp.assign(athlete_id=tp["receiver_player_id"].astype("int64"))
                 .groupby(["pos_team_id", "athlete_id", "game_id"]).size())
        tgt.index = tgt.index.set_names(["team_id", "athlete_id", "game_id"])
        pg["tgt"] = tgt.reindex(pg.index).fillna(0)
    pg_by_player = {k: d.droplevel([0, 1]) for k, d in pg.groupby(level=[0, 1])}
    game_logs = {}

    def add_log(team_id, athlete_id):
        key = f"{meta.loc[team_id, 'abbreviation']}|{int(athlete_id)}"
        if key not in game_logs:
            log = []
            for gid, s in pg_by_player.get((team_id, athlete_id), pd.DataFrame()).iterrows():
                e = {k: v for k, v in results[(gid, team_id)].items() if v or k != "at"}  # "at" only when away
                # stat fields that are 0 are left out to keep the file small; the site reads them as 0
                e.update({k: int(v) for k, v in s.items() if v})
                log.append(e)
            game_logs[key] = sorted(log, key=lambda e: e["w"])
        return key

    team_rows = {}
    id_to_name = {}
    for t in per.index:
        m = meta.loc[t]
        name = m["school"] if isinstance(m["school"], str) and m["school"] else m["short_display_name"]
        p = per.loc[t]

        # passing
        pdx = passing[passing["team_id"] == t].groupby("athlete_id").agg(
            player=("athlete_name", "last"), gp=("game_id", "nunique"),
            yds=("passingYards", "sum"), td=("passingTouchdowns", "sum"), it=("interceptions", "sum"),
            att=("att", "sum"), cmp=("cmp", "sum")).reset_index()
        pdx = top(pdx[pdx["att"] > 0], 6, p.gp)
        pass_rows = [{"player": r.player, "ydsG": r1(r.yds / r.gp), "td": r2(r.td / r.gp),
                      "int": r2(r.it / r.gp), "cmp": r1(r.cmp / r.gp), "pos": pos_all.get(int(r.athlete_id), ""), "log": add_log(t, r.athlete_id)} for r in pdx.itertuples()]

        rdx = rushing[rushing["team_id"] == t].groupby("athlete_id").agg(
            player=("athlete_name", "last"), gp=("game_id", "nunique"),
            yds=("rushingYards", "sum"), td=("rushingTouchdowns", "sum"),
            att=("rushingAttempts", "sum")).reset_index()
        rdx = top(rdx[rdx["att"] > 0], 6, p.gp)
        rush_rows = [{"player": r.player, "ydsG": r1(r.yds / r.gp), "td": r2(r.td / r.gp),
                      "ya": r1(r.yds / r.att), "ag": r1(r.att / r.gp), "pos": pos_all.get(int(r.athlete_id), ""), "log": add_log(t, r.athlete_id)} for r in rdx.itertuples()]

        cdx = receiving[receiving["team_id"] == t].groupby("athlete_id").agg(
            player=("athlete_name", "last"), gp=("game_id", "nunique"),
            yds=("receivingYards", "sum"), td=("receivingTouchdowns", "sum"),
            rec=("receptions", "sum")).reset_index()
        cdx = top(cdx[cdx["rec"] > 0], 7, p.gp)
        rec_rows = [{"player": r.player, "ydsG": r1(r.yds / r.gp), "td": r2(r.td / r.gp),
                     "yr": r1(r.yds / r.rec), "rec": r2(r.rec / r.gp), "pos": pos_all.get(int(r.athlete_id), ""), "log": add_log(t, r.athlete_id)} for r in cdx.itertuples()]

        s, o, d = srs[t]
        id_to_name[int(t)] = name
        team_rows[name] = {
            "team": name,
            "conference": m["conference_short_name"] if isinstance(m["conference_short_name"], str) else "",
            "abbr": m["abbreviation"] if isinstance(m["abbreviation"], str) else name,
            "record": {"w": int(p.w), "l": int(p.l), "t": int(p.t), "sos": r1(sos[t]),
                       "srs": r1(s), "osrs": r1(o), "dsrs": r1(d)},
            "offense": {"ppg": r1(p.pf), "rushYdsG": r1(p.rushYdsG), "rushYdsGRank": int(p.offRushRk),
                        "rushTdG": r2(p.rushTdG), "passYdsG": r1(p.passYdsG),
                        "passYdsGRank": int(p.offPassRk), "passTdG": r2(p.passTdG), "int": r2(p.intG)},
            "defense": {"papg": r1(p.pa), "rushYdsG": r1(p.d_rushYdsG), "rushYdsGRank": int(p.defRushRk),
                        "rushTdG": r2(p.d_rushTdG), "passYdsG": r1(p.d_passYdsG),
                        "passYdsGRank": int(p.defPassRk), "passTdG": r2(p.d_passTdG), "int": r2(p.d_intG)},
            "passing": pass_rows,
            "rushing": rush_rows,
            "receiving": rec_rows,
            "defVsPosition": {k: ({"rank": int(v.loc[t, "rank"]), "yds": r1(v.loc[t, "yds"]),
                                   "td": r2(v.loc[t, "td"])} if t in v.index else None)
                              for k, v in dvp.items()},
        }

    last_week = int(g["week"].max())
    full = load("full_schedule", season, cache)
    poll = current_poll(full)
    for tid, name in id_to_name.items():
        team_rows[name]["apRank"] = poll.get(tid)
    # QB = the team's leading passer (most attempts) in its most recent game
    qb_src = passing.merge(g[["game_id", "week"]], on="game_id").sort_values(["team_id", "week", "att"])
    qbs = {int(t): str(d.iloc[-1]["athlete_name"]) for t, d in qb_src.groupby("team_id") if len(d)}
    ml = load("matchup_line", season, cache)
    lines = {int(r.game_id): {"spread": r.spread, "over_under": r.over_under}
             for r in ml[ml["season_type"].astype(str).isin(["2", "regular"])].itertuples()}
    cur_week, games = week_games(full, id_to_name, team_rows, poll, lines, qbs)
    kept = carry_line_open(games, cur_week, season, prev_path) if prev_path else 0
    if kept:
        notes.append(f"lineOpen kept for {kept} of {len(games)} Week {cur_week} games from the week's first build")

    # each team's games so far with the game's top passer, rusher and receiver
    athlete_names = {int(i): str(n) for i, n in pd.concat([passing, rushing, receiving])
                     .dropna(subset=["athlete_id"]).groupby("athlete_id")["athlete_name"].last().items()}
    team_games = team_game_list(results, pg, athlete_names, id_to_name)

    bet = betting_trends(g, lines, results, set(per.index))
    eff = efficiency(pbp, game_ids, set(per.index)) if pbp is not None else {}
    if pbp is None:
        notes.append("no play-by-play: EPA and success rate left out")
    for tid, name in id_to_name.items():
        team_rows[name]["betting"] = bet.get(tid)
        if eff:
            team_rows[name]["eff"] = eff.get(tid)
    # --- every regular-season week's games, for the week strip (written by write_weeks) ---
    reg_weeks = sorted(int(w) for w in full.loc[full["season_type"] == 2, "week"].unique())
    weeks = {}
    for w in reg_weeks:
        if w == cur_week:
            weeks[w] = copy.deepcopy(games)
        elif w > cur_week:
            weeks[w] = week_games(full, id_to_name, team_rows, poll, lines, qbs, week=w)[1]
        else:
            # a finished week as it stood: records and AP ranks going into it, no "at QB"
            before = tg[tg["week"] < w]
            wl = before.assign(w=before["pf"] > before["pa"], l=before["pf"] < before["pa"], t=before["pf"] == before["pa"]) \
                       .groupby("team_id")[["w", "l", "t"]].sum()
            records = {id_to_name[int(t)]: f"{int(r.w)}-{int(r.l)}" + (f"-{int(r.t)}" if r.t else "")
                       for t, r in wl.iterrows() if int(t) in id_to_name}
            weeks[w] = week_games(full, id_to_name, team_rows, current_poll(full, w), lines, {}, week=w, records=records)[1]
        if w != cur_week:
            for x in weeks[w]:
                x["lineOpen"] = None  # only tracked for the current week

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "season": season,
        "throughWeek": last_week,
        "gamesCounted": int(len(g)),
        "source": "sportsdataverse/cfbfastR-cfb-data (ESPN box scores)",
        "teamNames": sorted(team_rows, key=str.lower),
        "teams": team_rows,
        "currentWeek": cur_week,
        "pollName": "AP Top 25",
        "weekGames": games,
        "gameLogs": game_logs,
        "teamGames": team_games,
        "hasTargets": pbp is not None,
        "notes": notes,
        "leagueAverage": {"rushTdG": r1(per["rushTdG"].mean()), "passTdG": r1(per["passTdG"].mean()),
                          "ppg": r1(per["pf"].mean())},
        "gaugeRanges": {
            "offRushYdsG": {"min": 0, "max": gauge_max(per["rushYdsG"])},
            "offPassYdsG": {"min": 0, "max": gauge_max(per["passYdsG"])},
            "defRushYdsG": {"min": 0, "max": gauge_max(per["d_rushYdsG"])},
            "defPassYdsG": {"min": 0, "max": gauge_max(per["d_passYdsG"])},
        },
    }
    return out, weeks


def team_game_list(results, pg, names, team_names):
    """Each FBS team's completed games in order: opponent, result, the ESPN game id (for the
    box score the site fetches) and that team's top passer, rusher and receiver by yards.

    results: (game_id, team_id) -> {w, opp, at, res}. pg: per-player game stats indexed by
    (team_id, athlete_id, game_id). Returns {team name: [{w, opp, at?, res, espnId, pass,
    rush, rec}]}; pass = {n, yds, td, cmp, att}, rush = {n, yds, td, car}, rec = {n, yds,
    td, rec}. A leader is left out when the box score has nobody with an attempt, carry
    or catch for that team."""
    LEADERS = (("pass", "att", "pYds", "pTd", {"cmp": "cmp", "att": "att"}),
               ("rush", "car", "rYds", "rTd", {"car": "car"}),
               ("rec", "rec", "recYds", "recTd", {"rec": "rec"}))
    by_team_game = {k: d for k, d in pg.groupby(level=[0, 2])}
    out = {}
    for (gid, tid), res in sorted(results.items(), key=lambda kv: (kv[1]["w"], kv[0][0])):
        name = team_names.get(int(tid))
        if not name:
            continue
        entry = {k: v for k, v in res.items() if v or k != "at"}  # "at" only when away
        entry["espnId"] = str(int(gid))
        rows = by_team_game.get((tid, gid))
        if rows is not None:
            for key, need, yds, td, extra in LEADERS:
                d = rows[rows[need] > 0]
                if d.empty:
                    continue
                top = d.sort_values([yds, td], ascending=False).iloc[0]
                entry[key] = {"n": names.get(int(top.name[1]), "?"), "yds": int(top[yds]), "td": int(top[td]),
                              **{k: int(top[col]) for k, col in extra.items()}}
        out.setdefault(name, []).append(entry)
    return out


def write_json(data, path):
    """Write data.json indented, except gameLogs and teamGames: one compact line per
    player log / per team, which keeps the file a fraction of the size of indenting
    every game entry."""
    compact = {k: data[k] for k in ("gameLogs", "teamGames") if k in data}
    text = json.dumps({**data, **{k: f"__{k}__" for k in compact}}, indent=1, ensure_ascii=False)
    for name, rows in compact.items():
        body = ",\n".join(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False, separators=(',', ':'))}"
                          for k, v in rows.items())
        text = text.replace(json.dumps(f"__{name}__"), "{\n" + body + "\n }" if rows else "{}", 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def write_if_changed(path, data):
    """Write compact JSON unless the file already holds the same thing (ignoring
    generatedAt), so a rerun only touches the weeks that changed."""
    def strip(x):
        return {k: v for k, v in x.items() if k != "generatedAt"}
    try:
        with open(path, encoding="utf-8") as f:
            if strip(json.load(f)) == strip(json.loads(json.dumps(data))):
                return False
    except (OSError, ValueError):
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace('{"week"', '\n{"week"').replace('{"id"', '\n{"id"') + "\n")
    return True


def write_weeks(weeks, data, out_dir):
    """data/season.json and data/weeks/<N>.json for the site's week strip."""
    eastern = ZoneInfo("America/New_York")
    index, wrote = [], []
    for week, games in sorted(weeks.items()):
        days = sorted(datetime.fromisoformat(x["start"].replace("Z", "+00:00")).astimezone(eastern).strftime("%Y-%m-%d")
                      for x in games)
        index.append({"week": week, "games": len(games), "from": days[0] if days else None,
                      "to": days[-1] if days else None, "ids": [x["id"] for x in games]})
        doc = {"season": data["season"], "week": week, "generatedAt": data["generatedAt"], "weekGames": games}
        if write_if_changed(os.path.join(out_dir, "weeks", f"{week}.json"), doc):
            wrote.append(week)
    write_if_changed(os.path.join(out_dir, "season.json"), {"season": data["season"], "weeks": index})
    return wrote


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--cache", default=None, help="optional folder to cache downloads")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "data.json"))
    a = ap.parse_args()
    data, weeks = build(a.season, a.cache, prev_path=a.out)
    out_dir = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(out_dir, exist_ok=True)
    write_json(data, a.out)
    print(f"Wrote {a.out}: {len(data['teams'])} teams, {data['gamesCounted']} games, "
          f"through week {data['throughWeek']}")
    wrote = write_weeks(weeks, data, out_dir)
    print("Week files (data/season.json, data/weeks/): "
          + ("updated " + ", ".join(f"Week {w}" for w in wrote) if wrote else "no changes"))
    for n in data.get("notes", []):
        print("  note:", n)


if __name__ == "__main__":
    sys.exit(main())
