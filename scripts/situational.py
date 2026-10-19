"""Finishing drives, big plays, pass rush, pace and usage for the CFB matchup page and Weekly Edges.

Called by build_data.py with the season's play-by-play. Completed regular-season games only; ranks
are among FBS teams.

Per team (data.json -> teams[name]):
    situ.off / situ.def   each value is {"v": number, "rank": 1..N}
        ptsTrip       points per trip inside the 40: drives that reached the opponent's 40, scored as
                      7 for a touchdown and 3 for a field goal
        third         3rd down conversion %: 3rd-down runs and passes that gained the distance
        explosive     explosive play %: passes of 20+ yards and runs of 10+, per run/pass play
        sackRate      sacks per pass play (sacks count as pass plays)
        havoc         havoc rate: plays with a tackle for loss, sack, interception, fumble or pass
                      breakup, per run/pass play
      Offense rank 1 = best for the offense (fewest sacks and havoc plays allowed); defense rank 1 =
      best for the defense (most sacks and havoc plays made).
    pace                  plays per game and early-down pass rate (1st and 2nd down). Rank 1 = most
                          plays, most pass-heavy.
    usage.targets         top 5 by targets: target share and target share over the last three games
    usage.carries         top 3 by carries: carry share
"""
import numpy as np
import pandas as pd


def _pack(series, best_high, teams, digits=1):
    s = series.reindex(sorted(teams))
    r = s.rank(ascending=not best_high, method="min")
    out = {}
    for t in teams:
        v = s.get(t, np.nan)
        out[t] = None if pd.isna(v) else {"v": round(float(v), digits), "rank": int(r[t])}
    return out


def _flag(d, col):
    return d[col].fillna(False).astype(bool) if col in d else pd.Series(False, index=d.index)


def build(pbp, game_ids, fbs_ids, pg, results, athlete_names):
    """Returns {team_id: {"situ", "pace", "usage", "shares"}}; usage rows carry "aid" for the caller's game log."""
    res = {int(t): {} for t in fbs_ids}
    teams = set(res)
    d = pbp[pbp["game_id"].isin(game_ids)].copy()
    d["yds"] = pd.to_numeric(d.get("statYardage"), errors="coerce")
    plays = d[(_flag(d, "rush") | _flag(d, "pass")) & ~_flag(d, "kneel_down") & ~_flag(d, "penalty_no_play")
              & d["pos_team_id"].notna() & d["yds"].notna()].copy()
    plays["off"] = plays["pos_team_id"].astype("int64")
    plays["dfn"] = plays["def_pos_team_id"].astype("int64")
    is_pass = _flag(plays, "pass")

    # finishing drives: every drive that reached the opponent's 40
    dr = d[d["drive.id"].notna() & d["start.yardsToEndzone"].notna() & d["pos_team_id"].notna()]
    dr = dr.groupby(["game_id", "drive.id"]).agg(off=("pos_team_id", "first"), dfn=("def_pos_team_id", "first"),
                                                 ytg=("start.yardsToEndzone", "min"), res=("drive.result", "last"))
    trips = dr[dr["ytg"] <= 40].copy()
    r = trips["res"].astype(str).str.upper()
    trips["pts"] = np.where(r.isin(["TD", "TOUCHDOWN"]), 7, np.where(r.isin(["FG", "FIELD GOAL", "FG GOOD"]), 3, 0))
    trips["off"], trips["dfn"] = trips["off"].astype("int64"), trips["dfn"].astype("int64")

    third = plays[plays["down"] == 3].copy()
    third["conv"] = (third["yds"] >= pd.to_numeric(third["start.distance"], errors="coerce")).astype(float)

    plays["exp"] = np.where(is_pass, plays["yds"] >= 20, plays["yds"] >= 10).astype(float)
    plays["sk"] = _flag(plays, "sack").astype(float)
    plays["hav"] = (_flag(plays, "TFL") | _flag(plays, "sack") | _flag(plays, "int") | _flag(plays, "fumble_vec")
                    | _flag(plays, "pass_breakup")).astype(float)
    passes = plays[is_pass]
    early = plays[plays["down"].isin([1, 2])]

    off = {"ptsTrip": (trips.groupby("off")["pts"].mean(), True, 2),
           "third": (third.groupby("off")["conv"].mean() * 100, True, 1),
           "explosive": (plays.groupby("off")["exp"].mean() * 100, True, 1),
           "sackRate": (passes.groupby("off")["sk"].mean() * 100, False, 1),
           "havoc": (plays.groupby("off")["hav"].mean() * 100, False, 1)}
    dfn = {"ptsTrip": (trips.groupby("dfn")["pts"].mean(), False, 2),
           "third": (third.groupby("dfn")["conv"].mean() * 100, False, 1),
           "explosive": (plays.groupby("dfn")["exp"].mean() * 100, False, 1),
           "sackRate": (passes.groupby("dfn")["sk"].mean() * 100, True, 1),
           "havoc": (plays.groupby("dfn")["hav"].mean() * 100, True, 1)}
    fbs_only = lambda s: s[s.index.isin(teams)]  # noqa: E731  (ranks among FBS teams)
    po = {k: _pack(fbs_only(s), hi, teams, dg) for k, (s, hi, dg) in off.items()}
    pdf = {k: _pack(fbs_only(s), hi, teams, dg) for k, (s, hi, dg) in dfn.items()}
    gp = plays.groupby("off")["game_id"].nunique()
    pace = {"ppg": _pack(fbs_only(plays.groupby("off").size() / gp), True, teams),
            "edp": _pack(fbs_only(early.groupby("off").apply(lambda x: _flag(x, "pass").mean() * 100)), True, teams)}
    trip_n = trips.groupby("off").size()
    for t in teams:
        res[t]["situ"] = {"off": {k: v[t] for k, v in po.items()}, "def": {k: v[t] for k, v in pdf.items()},
                          "trips": int(trip_n.get(t, 0))}
        res[t]["pace"] = {k: v[t] for k, v in pace.items()}

    # usage: targets (from play-by-play, already in the game logs) and carries, per player
    if "tgt" in pg.columns:
        u = pg.reset_index()
        u["week"] = [results.get((gid, tid), {}).get("w") for gid, tid in zip(u["game_id"], u["team_id"])]
        for t in teams:
            sub = u[u["team_id"] == t]
            if sub.empty:
                continue
            weeks = sorted(w for w in sub["week"].dropna().unique())[-3:]
            l3 = sub[sub["week"].isin(weeks)]
            tot, tot3, car = sub["tgt"].sum(), l3["tgt"].sum(), sub["car"].sum()
            by = sub.groupby("athlete_id")[["tgt", "car"]].sum()
            by3 = l3.groupby("athlete_id")["tgt"].sum()
            name = lambda a: athlete_names.get(int(a), str(a))  # noqa: E731
            rows = [{"aid": int(a), "player": name(a), "ts": round(x.tgt / tot * 100, 1) if tot else 0.0,
                     "ts3": round(by3.get(a, 0) / tot3 * 100, 1) if tot3 else 0.0}
                    for a, x in by[by["tgt"] > 0].sort_values("tgt", ascending=False).head(5).iterrows()]
            carries = [{"aid": int(a), "player": name(a), "cs": round(x.car / car * 100, 1)}
                       for a, x in by[by["car"] > 0].sort_values("car", ascending=False).head(3).iterrows()] if car else []
            res[t]["usage"] = {"targets": rows, "carries": carries, "weeks": [int(w) for w in weeks]}
            res[t]["shares"] = {int(a): {"ts": round(x.tgt / tot * 100, 1) if tot else 0.0,
                                         "ts3": round(by3.get(a, 0) / tot3 * 100, 1) if tot3 else 0.0,
                                         "cs": round(x.car / car * 100, 1) if car else 0.0}
                                for a, x in by.iterrows()}
    return res
