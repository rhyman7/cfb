"""Build data/data.json for the CFB Matchup Dashboard.

Source: sportsdataverse/cfbfastR-cfb-data on GitHub (ESPN-derived game box
scores, committed as parquet and refreshed several times a day). Everything is
downloaded from raw.githubusercontent.com — no API key needed.

Scope: all FBS teams, 2026 regular season (season_type 2), completed games.

Usage:
    pip install -r requirements.txt
    python scripts/build_data.py            # writes data/data.json
    python scripts/build_data.py --season 2026 --cache .cache
"""

import argparse
import io
import json
import math
import re
import os
import sys
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb"
FILES = {
    "schedule": "schedules/parquet/cfb_schedule_{s}.parquet",
    "team_box": "team_box/parquet/team_box_{s}.parquet",
    "player_box": "player_box/parquet/player_box_{s}.parquet",
    "teams": "cfb_teams/parquet/cfb_teams_{s}.parquet",
    "rosters": "cfb_rosters/parquet/cfb_rosters_{s}.parquet",
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


def current_poll(full):
    """team_id -> current AP rank. ESPN tags every unplayed game with each team's
    current poll rank, so each team's next unplayed game gives the latest poll
    (this also covers teams on a bye). Falls back to the latest game played."""
    reg = full[full["season_type"] == 2]
    rows = []
    for p in ("home", "away"):
        d = reg[["week", "status_type_completed", f"{p}_id", f"{p}_current_rank"]].copy()
        d.columns = ["week", "done", "team_id", "rank"]
        rows.append(d)
    r = pd.concat(rows)
    r["rank"] = num(r["rank"])
    upcoming = r[~r["done"].astype(bool)].sort_values("week").groupby("team_id").first()["rank"]
    if upcoming.empty:
        upcoming = r.sort_values("week").groupby("team_id").last()["rank"]
    return {int(t): int(k) for t, k in upcoming.items() if pd.notna(k) and 1 <= k <= 25}


def week_games(full, id_to_name, team_rows, poll):
    """Games for the current week: the first regular-season week that still has
    an unplayed game (or the final week once everything is complete)."""
    reg = full[full["season_type"] == 2].copy()
    if reg.empty:
        return None, []
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
            conf = team_rows[key]["conference"]
            name = key
        else:
            record = overall_record(r.get(f"{pfx}_records"))
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
        }

    games = []
    for _, r in wk.iterrows():
        tv = r.get("broadcast_name") if isinstance(r.get("broadcast_name"), str) else r.get("broadcast")
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
            "away": side(r, "away"),
            "home": side(r, "home"),
        })
    # keep games involving at least one FBS team (the FBS schedule already does)
    games = [x for x in games if x["away"]["key"] or x["home"]["key"]]
    return week, games


def gauge_max(series):
    return int(math.ceil(float(series.max()) / 5.0) * 5)


def build(season, cache):
    sched = load("schedule", season, cache)
    tbox = load("team_box", season, cache)
    pbox = load("player_box", season, cache)
    teams = load("teams", season, cache)
    rosters = load("rosters", season, cache)

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
    pos = rosters[["athlete_id", "team_id", "position_abbreviation"]].copy()
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

    team_rows = {}
    id_to_name = {}
    meta = fbs.set_index("team_id")
    for t in per.index:
        m = meta.loc[t]
        name = m["school"] if isinstance(m["school"], str) and m["school"] else m["short_display_name"]
        p = per.loc[t]

        # passing
        pdx = passing[passing["team_id"] == t].groupby("athlete_id").agg(
            player=("athlete_name", "last"), gp=("game_id", "nunique"),
            yds=("passingYards", "sum"), td=("passingTouchdowns", "sum"), it=("interceptions", "sum"),
            att=("att", "sum")).reset_index()
        pdx = top(pdx[pdx["att"] > 0], 6, p.gp)
        pass_rows = [{"player": r.player, "ydsG": r1(r.yds / r.gp), "td": r2(r.td / r.gp),
                      "int": r2(r.it / r.gp)} for r in pdx.itertuples()]

        rdx = rushing[rushing["team_id"] == t].groupby("athlete_id").agg(
            player=("athlete_name", "last"), gp=("game_id", "nunique"),
            yds=("rushingYards", "sum"), td=("rushingTouchdowns", "sum"),
            att=("rushingAttempts", "sum")).reset_index()
        rdx = top(rdx[rdx["att"] > 0], 6, p.gp)
        rush_rows = [{"player": r.player, "ydsG": r1(r.yds / r.gp), "td": r2(r.td / r.gp),
                      "ya": r1(r.yds / r.att), "ag": r1(r.att / r.gp)} for r in rdx.itertuples()]

        cdx = receiving[receiving["team_id"] == t].groupby("athlete_id").agg(
            player=("athlete_name", "last"), gp=("game_id", "nunique"),
            yds=("receivingYards", "sum"), td=("receivingTouchdowns", "sum"),
            rec=("receptions", "sum")).reset_index()
        cdx = top(cdx[cdx["rec"] > 0], 7, p.gp)
        rec_rows = [{"player": r.player, "ydsG": r1(r.yds / r.gp), "td": r2(r.td / r.gp),
                     "yr": r1(r.yds / r.rec), "rec": r2(r.rec / r.gp)} for r in cdx.itertuples()]

        s, o, d = srs[t]
        id_to_name[int(t)] = name
        team_rows[name] = {
            "team": name,
            "conference": m["conference_short_name"] if isinstance(m["conference_short_name"], str) else "",
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
    cur_week, games = week_games(full, id_to_name, team_rows, poll)
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
        "leagueAverage": {"rushTdG": r1(per["rushTdG"].mean()), "passTdG": r1(per["passTdG"].mean()),
                          "ppg": r1(per["pf"].mean())},
        "gaugeRanges": {
            "offRushYdsG": {"min": 0, "max": gauge_max(per["rushYdsG"])},
            "offPassYdsG": {"min": 0, "max": gauge_max(per["passYdsG"])},
            "defRushYdsG": {"min": 0, "max": gauge_max(per["d_rushYdsG"])},
            "defPassYdsG": {"min": 0, "max": gauge_max(per["d_passYdsG"])},
        },
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--cache", default=None, help="optional folder to cache downloads")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "data.json"))
    a = ap.parse_args()
    data = build(a.season, a.cache)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print(f"Wrote {a.out}: {len(data['teams'])} teams, {data['gamesCounted']} games, "
          f"through week {data['throughWeek']}")


if __name__ == "__main__":
    sys.exit(main())
