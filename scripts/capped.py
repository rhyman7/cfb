"""Big-play-capped yards for the team cards' Passing, Rushing and Receiving tables.

Every completion, catch and run is counted at no more than the league's 97.5th percentile for
that kind of play this season (NFL 2026 through Week 7: 37 yards on a completion, 18 on a run).
A player's capped share is his capped yards / his actual yards on the same plays; the site shows
Yds/G times that share under Yds/G, so a big drop means a few long plays carry his average.

Why a cap and not something else (tested on NFL play-by-play 2023-2025: rate each player on
weeks 1-9, predict his weeks 10-18 yards per play): capping at the 97.5th percentile predicted
about as well as the plain average for receivers (0.396 vs 0.393 correlation) and a little better
for runners (0.365 vs 0.342); the median did much worse (0.19 and 0.24), and so would dropping
plays 2-3 standard deviations above a player's own mean, on samples this small and this skewed.
So the capped number is context (how much of an average rests on long plays), most useful for
running backs; it isn't a replacement for the average.

The same file runs in both dashboards (rhyman7/nfl and rhyman7/cfb). Each build hands it one
row per play: key (the site's game-log key, "TEAM|player id"), kind ("pass", "rush" or "rec"),
game and yards. Writes data/capped.json:
    {season, throughWeek, cut: {catch, rush}, amber: {pass, rush, rec},
     players: {key: {pass: share, rush: share, rec: share}}}
amber is the drop (1 - share) at the 90th percentile among regulars (4+ games and at least
150 passing / 30 rushing / 30 receiving yards a game); the site colors drops at or above it.
"""
import json
from datetime import datetime, timezone

CUT_Q = 0.975
AMBER_Q = 0.90
REG_MIN = {"pass": 150.0, "rush": 30.0, "rec": 30.0}
REG_GAMES = 4


def summarize(plays, season, through_week):
    """plays: DataFrame with key, kind, game, yds (one row per completion, catch or run)."""
    plays = plays.dropna(subset=["key", "yds"])
    catch = plays.loc[plays.kind == "rec", "yds"]
    rush = plays.loc[plays.kind == "rush", "yds"]
    cut = {"catch": float(catch.quantile(CUT_Q)) if len(catch) else None,
           "rush": float(rush.quantile(CUT_Q)) if len(rush) else None}
    cap = plays.kind.map({"pass": cut["catch"], "rec": cut["catch"], "rush": cut["rush"]})
    plays = plays.assign(capped=plays.yds.where(plays.yds <= cap, cap))
    g = plays.groupby(["key", "kind"]).agg(raw=("yds", "sum"), capped=("capped", "sum"), games=("game", "nunique"))
    g = g[g.raw > 0]
    g["share"] = (g.capped / g.raw).clip(upper=1.0)
    amber = {}
    for kind, d in g.groupby(level="kind"):
        reg = d[(d.games >= REG_GAMES) & (d.raw / d.games >= REG_MIN[kind])]
        amber[kind] = round(float((1 - reg.share).quantile(AMBER_Q)), 3) if len(reg) >= 10 else None
    players = {}
    for (key, kind), r in g.iterrows():
        players.setdefault(str(key), {})[kind] = round(float(r.share), 3)
    return {"generatedAt": datetime.now(timezone.utc).isoformat(), "season": season, "throughWeek": through_week,
            "cut": {k: (round(v) if v is not None else None) for k, v in cut.items()}, "amber": amber, "players": players}


def write(plays, season, through_week, path):
    out = summarize(plays, season, through_week)
    path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"Wrote data/capped.json: cuts {out['cut']} yards, amber at drops of {out['amber']}, {len(out['players'])} players")
    return out
