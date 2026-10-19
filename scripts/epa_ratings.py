"""Opponent-adjusted EPA ratings for the EPA page (data/epa.json).

Shared by the NFL and CFB dashboards; each build script turns its own play-by-play into
the common shape below and calls build_epa().

plays (one row per run or pass play, kneels and spikes already removed):
    game_id, week, off, def   team keys as the site uses them (the CFB build pools non-FBS
                              teams into one key, see `rate_keys`)
    home      1 if the offense is the home team, 0 if away or at a neutral site
    epa, success (0/1), pass (0/1), rush (0/1), down, wp (offense win chance before the play)
    to_lost   1 if the offense lost the ball on the play (interception or lost fumble)
    passer    passer name on dropbacks, else None
    cpoe      completion % over expected for the play, or NaN (NFL only)
    garbage   optional: True for garbage-time plays. When it's missing, garbage time is
              decided by win probability (see step 1)
games (completed games in scope): game_id, week, home, away, hs, as_, neutral (bool),
    spread (home side, negative = home favored, or NaN), total (or NaN)

Method, in order:
  1. drop garbage time: the `garbage` column when given (the CFB build marks lopsided scores
     by quarter), otherwise plays where the offense's win chance is under 10% or over 90%
  2. ridge regression epa ~ offense + defense + home, one fit for all plays and one each for
     pass and run, so every team gets ratings with its schedule taken out
  3. a game projection is each offense's rating plus the other defense's, times the two
     teams' average plays per game, plus home field, then pulled toward a pick'em and a
     league-average total (k_margin, k_total) because a few weeks of data is a small sample
  4. a walk-forward check: for each week from 3 on, ratings from earlier weeks only project
     that week's games, and the average miss is compared with the closing line's
The page computes this week's projections itself from these ratings and the current lines.
"""
import math

import numpy as np
import pandas as pd

WP_LO, WP_HI = 0.10, 0.90


def _clean(df):
    """The plays that count: garbage time removed."""
    if "garbage" in df:
        return df[~df["garbage"].astype(bool)]
    return df[df["wp"].between(WP_LO, WP_HI)]


def _ridge(df, keys, alpha):
    """Ridge fit of epa on offense, defense and home dummies; intercept unpenalized.
    Returns (intercept, {key: off coef}, {key: def coef}, home coef)."""
    idx = {k: i for i, k in enumerate(keys)}
    n, m = len(keys), len(df)
    X = np.zeros((m, 2 * n + 1))
    rows = np.arange(m)
    X[rows, df["off"].map(idx).to_numpy()] = 1.0
    X[rows, n + df["def"].map(idx).to_numpy()] = 1.0
    X[:, -1] = df["home"].to_numpy(dtype=float)
    y = df["epa"].to_numpy(dtype=float)
    xm, ym = X.mean(axis=0), y.mean()
    Xc = X - xm
    beta = np.linalg.solve(Xc.T @ Xc + alpha * np.eye(2 * n + 1), Xc.T @ (y - ym))
    b0 = ym - xm @ beta
    return b0, dict(zip(keys, beta[:n])), dict(zip(keys, beta[n:2 * n])), beta[-1]


def _project(o, d, ppg, lg_pts, home, away, neutral, hfa, k_margin, k_total):
    pace = (ppg[home] + ppg[away]) / 2
    h_epa, a_epa = o[home] + d[away], o[away] + d[home]
    h_fa = 0.0 if neutral else hfa
    raw_margin = (h_epa - a_epa) * pace + h_fa
    raw_total = 2 * lg_pts + (h_epa + a_epa) * pace
    return (h_fa + k_margin * (raw_margin - h_fa), 2 * lg_pts + k_total * (raw_total - 2 * lg_pts),
            raw_margin, raw_total)


def _rank(s, ascending):
    return s.rank(ascending=ascending, method="min").astype(int)


def build_epa(plays, games, rate_keys, *, hfa, alpha, k_margin, k_total, close_margin=8, min_week=3):
    """rate_keys: the teams to publish (ratings are fit for every key in plays)."""
    plays = plays[plays["epa"].notna()].copy()
    keys = sorted(set(plays["off"]) | set(plays["def"]))
    clean = _clean(plays)

    lg = {"all": float(clean["epa"].mean()), "pass": float(clean.loc[clean["pass"] == 1, "epa"].mean()),
          "rush": float(clean.loc[clean["rush"] == 1, "epa"].mean())}
    fit = {"all": _ridge(clean, keys, alpha),
           "pass": _ridge(clean[clean["pass"] == 1], keys, alpha),
           "rush": _ridge(clean[clean["rush"] == 1], keys, alpha)}

    off_raw = plays.groupby("off")["epa"].mean()
    def_raw = plays.groupby("def")["epa"].mean()
    ed = clean[(clean["pass"] == 1) & clean["down"].isin([1, 2])]
    ed_off, ed_def = ed.groupby("off")["epa"].mean(), ed.groupby("def")["epa"].mean()
    sr_off, sr_def = clean.groupby("off")["success"].mean() * 100, clean.groupby("def")["success"].mean() * 100
    neutral = clean[clean["down"].isin([1, 2]) & clean["wp"].between(0.2, 0.8)]
    npr = neutral.groupby("off")["pass"].mean() * 100
    ppg = plays.groupby("off").size() / plays.groupby("off")["game_id"].nunique()
    to_margin = plays.groupby("def")["to_lost"].sum().sub(plays.groupby("off")["to_lost"].sum(), fill_value=0)

    pub = [k for k in rate_keys if k in off_raw.index and k in def_raw.index]
    S = lambda d: pd.Series({k: d[k] for k in pub})
    o_all, d_all = S(fit["all"][1]), S(fit["all"][2])
    series = {
        "o_adj": (o_all, False), "d_adj": (d_all, True), "net": (o_all - d_all, False),
        "o_raw": (off_raw[pub], False), "d_raw": (def_raw[pub], True),
        "o_pass": (S(fit["pass"][1]), False), "d_pass": (S(fit["pass"][2]), True),
        "o_rush": (S(fit["rush"][1]), False), "d_rush": (S(fit["rush"][2]), True),
        "o_ed": (ed_off.reindex(pub), False), "d_ed": (ed_def.reindex(pub), True),
        "o_sr": (sr_off.reindex(pub), False), "d_sr": (sr_def.reindex(pub), True),
    }
    ranks = {k: _rank(s.fillna(s.mean()), asc) for k, (s, asc) in series.items()}

    # records, one-score games and points-based expected wins, from final scores
    rec = {}
    for g in games.itertuples():
        for t, pf, pa in ((g.home, g.hs, g.as_), (g.away, g.as_, g.hs)):
            r = rec.setdefault(t, {"w": 0, "l": 0, "t": 0, "cw": 0, "cl": 0, "pf": 0.0, "pa": 0.0})
            r["pf"] += pf
            r["pa"] += pa
            r["w" if pf > pa else "l" if pf < pa else "t"] += 1
            if pf != pa and abs(pf - pa) <= close_margin:
                r["cw" if pf > pa else "cl"] += 1

    qb = {}
    db = clean[clean["passer"].notna()]
    for t, sub in db.groupby("off"):
        name = sub["passer"].value_counts().idxmax()
        s = sub[sub["passer"] == name]
        qb[t] = {"name": str(name), "epa": round(float(s["epa"].mean()), 3), "db": int(len(s))}
        c = s["cpoe"].mean() if "cpoe" in s else float("nan")
        if not math.isnan(c):
            qb[t]["cpoe"] = round(float(c), 1)

    def rnd(x, d):
        """Rounded, or None for a missing value (JSON has no NaN)."""
        try:
            x = float(x)
        except (TypeError, ValueError):
            return None
        return None if math.isnan(x) else round(x, d)
    r3 = lambda x: rnd(x, 3)
    teams = {}
    for t in pub:
        r = rec.get(t, {"w": 0, "l": 0, "t": 0, "cw": 0, "cl": 0, "pf": 0.0, "pa": 0.0})
        gp = r["w"] + r["l"] + r["t"]
        pyth = r["pf"] ** 2.37 / (r["pf"] ** 2.37 + r["pa"] ** 2.37) if r["pf"] + r["pa"] else 0.5
        flags = []
        tm = int(to_margin.get(t, 0))
        if tm >= 5:
            flags.append(f"Turnover margin +{tm}, likely to cool off")
        elif tm <= -5:
            flags.append(f"Turnover margin {tm}, likely to improve")
        if abs(r["cw"] - r["cl"]) >= 2:
            flags.append(f"{r['cw']}-{r['cl']} in one-score games")
        exp_w = pyth * gp
        if abs(r["w"] - exp_w) >= 1.0:
            flags.append(f"{r['w']} win{'' if r['w'] == 1 else 's'} vs {exp_w:.1f} expected from points")
        teams[t] = {
            "rec": f"{r['w']}-{r['l']}" + (f"-{r['t']}" if r["t"] else ""),
            "o": r3(fit["all"][1][t]), "d": r3(fit["all"][2][t]),
            "off": {"raw": r3(off_raw[t]), "adj": r3(lg["all"] + fit["all"][1][t]),
                    "pass": r3(lg["pass"] + fit["pass"][1][t]), "rush": r3(lg["rush"] + fit["rush"][1][t]),
                    "ed": r3(ed_off.get(t)), "sr": rnd(sr_off.get(t), 1)},
            "def": {"raw": r3(def_raw[t]), "adj": r3(lg["all"] + fit["all"][2][t]),
                    "pass": r3(lg["pass"] + fit["pass"][2][t]), "rush": r3(lg["rush"] + fit["rush"][2][t]),
                    "ed": r3(ed_def.get(t)), "sr": rnd(sr_def.get(t), 1)},
            "net": r3(fit["all"][1][t] - fit["all"][2][t]),
            "rk": {k: int(v[t]) for k, v in ranks.items()},
            "npr": rnd(npr.get(t), 1), "ppg": round(float(ppg[t]), 1),
            "to": tm, "flags": flags, "qb": qb.get(t),
        }

    lg_pts = float((games["hs"].sum() + games["as_"].sum()) / (2 * len(games))) if len(games) else 0.0
    return {
        "teamCount": len(teams),
        "playsUsed": int(len(clean)), "playsAll": int(len(plays)), "gamesUsed": int(plays["game_id"].nunique()),
        "league": {"epa": r3(lg["all"]), "pass": r3(lg["pass"]), "rush": r3(lg["rush"]), "pts": round(lg_pts, 1),
                   "ppg": round(float(ppg[pub].mean()), 1)},
        "model": {"hfa": hfa, "kMargin": k_margin, "kTotal": k_total, "alpha": alpha,
                  "garbage": "score" if "garbage" in plays else "wp"},
        "backtest": backtest(plays, games, keys, hfa=hfa, alpha=alpha, k_margin=k_margin, k_total=k_total,
                             min_week=min_week),
        "teams": teams,
    }


def backtest(plays, games, keys, *, hfa, alpha, k_margin, k_total, min_week=3):
    """Walk-forward: ratings from weeks before W project week W's games that have a line."""
    rows = []
    weeks = sorted(int(w) for w in games["week"].unique())
    for w in weeks:
        if w < min_week:
            continue
        prior = plays[plays["week"] < w]
        target = games[(games["week"] == w) & games["spread"].notna()]
        if prior.empty or target.empty:
            continue
        clean = _clean(prior)
        ks = sorted(set(prior["off"]) | set(prior["def"]))
        _, o, d, _ = _ridge(clean, ks, alpha)
        ppg = prior.groupby("off").size() / prior.groupby("off")["game_id"].nunique()
        pg = games[games["week"] < w]
        lg_pts = float((pg["hs"].sum() + pg["as_"].sum()) / (2 * len(pg)))
        for g in target.itertuples():
            if g.home not in o or g.away not in o or g.home not in ppg or g.away not in ppg:
                continue
            m, t, rm, rt = _project(o, d, ppg, lg_pts, g.home, g.away, bool(g.neutral), hfa, k_margin, k_total)
            rows.append({"am": g.hs - g.as_, "at": g.hs + g.as_, "m": m, "t": t, "rm": rm, "rt": rt,
                         "line": -g.spread, "tl": g.total})
    if not rows:
        return None
    r = pd.DataFrame(rows)
    err = lambda a, b: round(float(np.sqrt(((a - b) ** 2).mean())), 2)
    rt_ = r.dropna(subset=["tl"])
    return {
        "games": int(len(r)), "fromWeek": min_week, "toWeek": int(weeks[-1]),
        "lineM": err(r["am"], r["line"]), "modelM": err(r["am"], r["m"]), "rawM": err(r["am"], r["rm"]),
        "lineT": err(rt_["at"], rt_["tl"]) if len(rt_) else None,
        "modelT": err(rt_["at"], rt_["t"]) if len(rt_) else None,
        "rawT": err(rt_["at"], rt_["rt"]) if len(rt_) else None,
    }
