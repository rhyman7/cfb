"""Build the Weekly Matchup Report: who is set up for a good game, and who is not, in every
game of the current week, plus two rankings across the slate (Best Overall Matchups and
Most Likely to Score a TD). The stats come from data/data.json and data/epa.json; the player
projections, matchup lifts and touchdown chances come from the value board's feed
(rhyman7/fb-value-board, docs/feed/<league>.json) when a checkout of it is next to this repo or
passed in (build_packets.py --value-board). Without the feed the report falls back to ranking each
player's matchup by the raw yards his opponent allows at his position.

The same file runs in both dashboards (rhyman7/cfb and rhyman7/nfl); it detects the league
from the shape of data.json.

Writes (into --out, default pdf/):
  report.html          the report, ready for headless Chrome (landscape letter)
  report-games.json    the game ids in report order, for build_packets.py
With --pdf it also renders report.pdf (needs playwright + chromium).

Run from the repo root:  python scripts/build_report.py [--pdf] [--out DIR]
"""
import argparse
import html
import json
import math
import re
import statistics as st
import subprocess
import sys
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ET = ZoneInfo("America/New_York")
E = html.escape
MINUS = "−"
# injury designations that keep a player out of the picks (Q stays in, tagged)
INJ_OUT = {"O": "out", "D": "doubtful", "IR": "on IR", "PUP": "on PUP", "SUSP": "suspended"}
INJ_CODE = {"out": "O", "doubtful": "D", "questionable": "Q", "injured reserve": "IR", "physically unable to perform": "PUP",
            "pup": "PUP", "suspension": "SUSP", "suspended": "SUSP"}
FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap">'


# ---------------------------------------------------------------- formatting
def num(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def half_up(x):
    return num(float(Decimal(str(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)))


def norm_name(n):  # same as normName() in the NFL site's common.js
    return re.sub(r"[^a-z]", "", re.sub(r"\b(jr|sr|ii|iii|iv|v)\b\.?", "", str(n or "").lower()))


def vb_norm(n):  # same as vbNorm() in the sites' JS and nflmodel/dashfeed.norm on the value board
    s = re.sub(r"[^a-z ]", "", str(n or "").lower().replace("-", " "))
    return " ".join(w for w in s.split() if w not in {"jr", "sr", "ii", "iii", "iv", "v"})


def load_feed(vb, league, season, week):
    """The value board's feed for this league and week, or None."""
    try:
        f = json.loads((Path(vb) / "docs" / "feed" / f"{league}.json").read_text(encoding="utf-8"))
    except Exception:
        return None
    return f if f.get("season") == season and f.get("week") == week and f.get("players") else None


def load_tracker(vb, league, season):
    """The value board's TD scorer tracker (docs/feed/td_tracker_<league>.json), or None."""
    try:
        t = json.loads((Path(vb) / "docs" / "feed" / f"td_tracker_{league}.json").read_text(encoding="utf-8"))
    except Exception:
        return None
    return t if t.get("season") == season and t.get("weeks") else None


# Highest Floors: each list is (position, the value board's floor key, heading)
FLOOR_LISTS = [("QB", "pass", "QB passing yards"), ("QB", "rush", "QB rushing yards"),
               ("RB", "rush", "RB rushing yards"), ("RB", "rr", "RB rushing + receiving yards"),
               ("WR", "rec", "WR receiving yards"), ("TE", "rec", "TE receiving yards")]
FLOOR_N = 15


def load_floors(vb, league, season, week, teams):
    """The value board's every-game floors (players[].floor in docs/data.json, docs/cfb/data.json)
    for this week's players, as {(pos, key): [rows]} with the FLOOR_N highest first, or None.
    Players the board has ruled out (its teams' out lists, or an Out/Doubtful/IR status) are left out."""
    try:
        d = json.loads((Path(vb) / "docs" / ("cfb/data.json" if league == "cfb" else "data.json")).read_text(encoding="utf-8"))
    except Exception:
        return None
    if (d.get("meta") or {}).get("season") != season:
        return None
    P = (d.get("players") or {}).get("players") or []
    pre = f"{season}_{int(week):02d}_"
    outs = {(t.get("team"), vb_norm(o.get("name"))) for t in (d["players"].get("teams") or []) for o in (t.get("out") or [])}

    def ruled_out(p):
        if str(p.get("status") or "").lower().startswith(("out", "doubtful", "injured reserve", "ir", "suspend")):
            return True
        w = str(p.get("name") or "").split()
        short = vb_norm(w[0][:1] + " " + " ".join(w[1:])) if len(w) > 1 else None   # the college out lists say "H. Hendrix"
        return (p.get("team"), vb_norm(p.get("name"))) in outs or (p.get("team"), short) in outs

    week_ps = [p for p in P if str(p.get("game") or "").startswith(pre) and p.get("floor")]
    mine = [p for p in week_ps if p.get("team") in teams]
    week_ps = mine or week_ps   # the board's team codes should match the report's; if none do, use the whole week
    # quarterbacks: only each team's projected starter (most projected pass attempts), as the report's listed QB
    qb1 = {}
    for p in week_ps:
        if p.get("pos") == "QB" and not ruled_out(p):
            att = (p.get("proj") or {}).get("pass_att") or 0
            if att > 0 and att > qb1.get(p["team"], (None, 0))[1]:
                qb1[p["team"]] = (p["name"], att)
    out, dropped = {}, 0
    for pos, key, _ in FLOOR_LISTS:
        rows = []
        for p in week_ps:
            f = (p.get("floor") or {}).get(key)
            if p.get("pos") != pos or not f or f.get("floor") is None:
                continue
            if ruled_out(p):
                dropped += 1
                continue
            if pos == "QB" and qb1.get(p["team"], (None,))[0] != p["name"]:
                continue
            rows.append(dict(name=p["name"], team=p["team"], floor=f["floor"], g=f.get("g"), avg=f.get("avg") or 0))
        rows.sort(key=lambda r: (-r["floor"], -r["avg"], r["name"]))
        out[(pos, key)] = rows[:FLOOR_N]
    print(f"  report: floors for {len(week_ps)} players; {dropped} ruled-out entries left out")
    return out if any(out.values()) else None


def american(x):
    return "—" if x is None else (f"+{x:.0f}" if x > 0 else f"{x:.0f}")


def money(x):
    return f"+${x:,.2f}" if x > 0 else (f"−${-x:,.2f}" if x < 0 else "$0.00")


def tracker_html(T, league_name, week):
    """The Touchdown tracker page: last finished week's top 10 as cards (board chance, DraftKings and
    FanDuel prices, the result) and the season as rows of dots."""
    done = [w for w in T["weeks"] if w["complete"] and w["week"] < week]
    if not done:
        return ""
    last, top = done[-1], T.get("top", 10)
    cards = []
    for p in last["players"]:
        hit = bool(p["scored"])
        def bk(b, lab):
            v = p.get(b)
            return f'<span class="{"tk-best" if p.get("best") == {"dk": "draftkings", "fd": "fanduel"}[b] else ""}">{lab} {american(v)}</span>' if v is not None else ""
        odds = " ".join(x for x in (bk("dk", "DK"), bk("fd", "FD")) if x) or '<span class="dimc">no price</span>'
        ret = f'<div class="tk-ret {"w" if (p.get("ret10") or 0) > 0 else ""}">$10 → {money(p["ret10"])}</div>' if p.get("ret10") is not None else ""
        cards.append(f'<div class="tk-card{" hit" if hit else ""}"><div class="tk-rank">{p["rank"]}</div>'
                     f'<div class="tk-main"><div class="tk-name">{E(p["name"])}</div><div class="tk-meta">{E(p["team"])} {E(p["pos"])} vs {E(p["opp"])}</div>'
                     f'<div class="tk-odds">{odds}</div></div>'
                     f'<div class="tk-side"><div class="tk-pct">{p["chance"] * 100:.0f}%</div><div class="tk-res">{"✓ TD" if hit else "No TD"}</div>{ret}</div></div>')
    order = [c for i in range(5) for c in (cards[i:i + 1] + cards[i + 5:i + 6])]   # 1-5 down the left, 6-10 down the right
    rows = "".join(
        f'<div class="tk-row"><div class="tk-wk">Week {w["week"]}</div><div class="tk-dots">'
        + "".join(f'<i class="{"on" if q["scored"] else ""}"></i>' for q in w["players"])
        + f'</div><div class="tk-sum"><b>{w["scored"]}</b> of {len(w["players"])} <span>exp {w["expected"]:.1f}</span></div></div>'
        for w in done)
    S, a, b = T["season_total"], T["spots_1_5"], T["spots_6_10"]
    pct = lambda x: f'{100 * x["scored"] / x["players"]:.0f}%' if x["players"] else "—"
    epct = lambda x: f'{100 * x["expected"] / x["players"]:.0f}%' if x["players"] else "—"
    bets = (f'<div class="tk-chip"><b>{money(S["net10"])}</b><div>$10 on each priced pick, at the better of DraftKings and FanDuel ({S["bets"]} bets)</div></div>'
            if S.get("bets") else "")
    rebuilt = [w["week"] for w in done if w.get("source") == "rebuilt"]
    note = ("Each dot is one spot on that week's list, left to right from #1 to #10; green means he scored a rushing or receiving touchdown. "
            "\"Expected\" adds up the board's chances. Prices are each book's anytime-TD odds before kickoff; the better one is bold. "
            + (f"Weeks {rebuilt[0]}–{rebuilt[-1]} are rebuilt from the board's projections (the chances weren't saved then)." if rebuilt else ""))
    return f'''<section class="tdsec tk" id="tdtracker">
  <div class="kicker">{league_name} · Touchdown tracker</div>
  <h1 class="h1s">Last week's top {top}: {last["scored"]} scored</h1>
  <p class="lede">How the {top} likeliest scorers on the Week {last["week"]} list did, and every week this season.</p>
  <div class="tk-grid">
    <div><div class="tk-sec">Week {last["week"]} · ranked by the board's TD chance</div><div class="tk-cards">{"".join(order)}</div></div>
    <div><div class="tk-sec">Season</div>
      <div class="tk-score"><div class="tk-big">{S["scored"]}<small> / {S["players"]}</small></div><div class="tk-exp">scored<br>expected {S["expected"]:.1f}</div></div>
      {rows}
      <div class="tk-chips"><div class="tk-chip"><b>{pct(a)}</b><div>Spots 1–5 scored (expected {epct(a)})</div></div>
      <div class="tk-chip"><b>{pct(b)}</b><div>Spots 6–10 scored (expected {epct(b)})</div></div>{bets}</div>
      <p class="tk-note">{note}</p>
    </div>
  </div>
</section>'''


def clip(x, a, b):
    return max(a, min(b, x))


def tg(x):
    return "no TDs" if float(num(x)) == 0 else f"{num(x)} TD{'' if float(num(x)) == 1 else 's'}/G"


def art(x):
    return "an" if num(x).startswith(("8", "11", "18")) else "a"


# ---------------------------------------------------------------- data, normalized for both leagues
class Data:
    def __init__(self, d):
        self.d = d
        self.T = d["teams"]
        self.GL = d.get("gameLogs", {})
        self.LA = d["leagueAverage"]
        self.NT = len(self.T)
        self.league = "cfb" if "weekGames" in d else "nfl"
        self.week = d["currentWeek"] if self.league == "cfb" else d["schedule"]["week"]
        self.through = d.get("throughWeek")
        self.by_abbr = {t["abbr"]: n for n, t in self.T.items()}
        self.games = self._games()
        self.POS_AVG = {k: st.mean(t["defVsPosition"][k]["td"] for t in self.T.values()) for k in ("rb", "recRb", "te", "wr")}
        self.inj, self.inj_src, self.inj_at = {}, None, None

    def load_injuries(self, path):
        """Injury designations from data/injuries.json, as {log key: {"s", "what"}}.
        CFB: players keyed by log key (scripts/injuries.py; stale entries and Probable are skipped).
        NFL: ESPN's shape, teams with injured players by name (scripts/fetch_espn_injuries.py)."""
        try:
            j = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception:
            return
        out = {}
        if isinstance(j.get("players"), dict):
            for k, e in j["players"].items():
                if e.get("s") in ("O", "D", "Q") and not e.get("stale"):
                    out[k] = dict(s=e["s"], what=e.get("injury") or "")
        elif isinstance(j.get("injuries"), list):
            by = {}
            for grp in j["injuries"]:
                for it in grp.get("injuries") or []:
                    s = INJ_CODE.get(str(it.get("status") or "").strip().lower())
                    nm = norm_name((it.get("athlete") or {}).get("displayName"))
                    det = it.get("details") or {}
                    if s and nm and grp.get("displayName"):
                        by[(grp["displayName"], nm)] = dict(s=s, what=det.get("type") if isinstance(det.get("type"), str) else "")
            for name, t in self.T.items():
                for sec in ("passing", "rushing", "receiving"):
                    for r in t[sec]:
                        e = by.get((name, norm_name(r["player"])))
                        if e:
                            out[r["log"]] = e
        else:
            return
        self.inj, self.inj_src, self.inj_at = out, j.get("source") or "injury report", j.get("generatedAt")

    def team_games(self, key):
        if self.league == "cfb":
            return self.d["teamGames"].get(key, [])
        return self.T[key].get("games", [])

    def _side(self, g, s):
        if self.league == "cfb":
            x = g[s]
            return dict(key=x.get("key") if x.get("key") in self.T else None, name=x["name"], abbr=x.get("abbr") or x["name"][:4].upper(),
                        rank=x.get("rank"), record=x.get("record") or "", qb=x.get("qb") or "")
        name = g[s]
        t = self.T.get(name)
        r = t["record"] if t else {}
        rec = f'{r.get("w", 0)}-{r.get("l", 0)}' + (f'-{r["t"]}' if r.get("t") else "") if t else ""
        return dict(key=name if t else None, name=name, abbr=t["abbr"] if t else name[:3].upper(), rank=None, record=rec,
                    qb=g.get(f"{s}Qb") or "")

    def _games(self):
        out = []
        if self.league == "cfb":
            src = [g for g in self.d["weekGames"] if not g.get("completed")]
            for g in src:
                out.append(dict(id=g["id"], start=g["start"], away=self._side(g, "away"), home=self._side(g, "home"),
                                spread=g.get("spread"), total=g.get("total"), lineOpen=g.get("lineOpen") or {},
                                venue=g.get("venue") or "", city=g.get("city") or "", indoor=bool(g.get("indoor")),
                                neutral=bool(g.get("neutral")), flag="Conference game" if g.get("conferenceGame") else "",
                                tv=g.get("tv") or ""))
        else:
            for g in self.d["schedule"]["games"]:
                if g.get("awayScore") is not None:
                    continue
                sp = g.get("spread")
                lo = g.get("lineOpen") or {}
                out.append(dict(id=g["id"], start=g["start"], away=self._side(g, "away"), home=self._side(g, "home"),
                                # the NFL file stores the spread with home favored positive; flip to the CFB convention
                                spread=None if sp is None else -sp, total=g.get("total"),
                                lineOpen=dict(spread=None if lo.get("spread") is None else -lo["spread"], total=lo.get("total")),
                                venue=g.get("stadium") or "", city=g.get("city") or "",
                                indoor=bool(g.get("indoor")) or g.get("roof") in ("dome", "closed"),
                                neutral=bool(g.get("neutral")), flag="Division game" if g.get("divisional") else "", tv=""))
        return out


# ---------------------------------------------------------------- analysis
# A player is a good spot when the board projects his main stat this much above his season average
# (LIFT_FULL = the most it counts for); the old rank-based thresholds on m (+0.25 good, -0.35/-0.40
# tough) then read as about +6% and -9% to -10%.
LIFT_FULL = 0.25
CAP_KIND = {"QB": "pass", "RB": "rush", "WR": "rec", "TE": "rec"}


class Report:
    def __init__(self, D, feed=None, epa=None, capped=None):
        self.D = D
        self.CAP = capped["players"] if capped and capped.get("players") else None
        self.AMBER = (capped or {}).get("amber") or {}
        self.F = feed["players"] if feed else None
        self.EPA = epa["teams"] if epa and epa.get("teams") else None
        self.T, self.GL, self.LA, self.NT, self.POS_AVG = D.T, D.GL, D.LA, D.NT, D.POS_AVG
        self._fit()

    def _fit(self):
        X, Y = [], []
        for g in self.D.games:
            a, h = g["away"]["key"], g["home"]["key"]
            if g["spread"] is None or g["total"] is None or not a or not h:
                continue
            ta, th = self.T[a], self.T[h]
            X += [(ta["offense"]["ppg"] + th["defense"]["papg"]) / 2, (th["offense"]["ppg"] + ta["defense"]["papg"]) / 2]
            Y += [g["total"] / 2 + g["spread"] / 2, g["total"] / 2 - g["spread"] / 2]
        self.est_a, self.est_b = 6.4, 0.70
        if len(X) >= 10:
            mx, my = sum(X) / len(X), sum(Y) / len(Y)
            sxx = sum((x - mx) ** 2 for x in X)
            if sxx > 0:
                self.est_b = sum((x - mx) * (y - my) for x, y in zip(X, Y)) / sxx
                self.est_a = my - self.est_b * mx

    def est_pts(self, t, o):
        return self.est_a + self.est_b * (t["offense"]["ppg"] + o["defense"]["papg"]) / 2

    @staticmethod
    def implied(g):
        if g["spread"] is None or g["total"] is None:
            return None
        return g["total"] / 2 + g["spread"] / 2, g["total"] / 2 - g["spread"] / 2  # away, home

    def m_of(self, rank):  # -1 (stingiest) .. +1 (softest)
        return (rank - (self.NT + 1) / 2) / ((self.NT - 1) / 2)

    def roster(self, key):
        t = self.T[key]
        tg_ = self.D.team_games(key)
        last_w = max((x["w"] for x in tg_), default=None)
        P = {}
        for sec in ("passing", "rushing", "receiving"):
            for row in t[sec]:
                p = P.setdefault(row["log"], dict(name=row["player"], pos=row["pos"], log=row["log"]))
                p[sec] = row
                if sec == "rushing" and row["pos"] == "QB":
                    p["pos"] = "QB"
        for p in P.values():
            logs = self.GL.get(p["log"], [])
            p["gp"] = len(logs)
            p["inj"] = self.D.inj.get(p["log"])
            p["active"] = bool(logs) and logs[-1]["w"] == last_w
            p["rtd"] = sum(x.get("rTd", 0) for x in logs)
            p["ctd"] = sum(x.get("recTd", 0) for x in logs)
            p["car"] = sum(x.get("car", 0) for x in logs) / max(1, len(logs))
            p["recg"] = sum(x.get("rec", 0) for x in logs) / max(1, len(logs))
        return P, len(tg_)

    def candidates(self, g, side):
        me, opp = g[side], g["home" if side == "away" else "away"]
        if not me["key"]:
            return [], [], [], []
        t = self.T[me["key"]]
        o = self.T[opp["key"]] if opp["key"] else None
        on, ab = opp["abbr"], me["abbr"]
        out, skipped, hurt, quest = [], [], [], []
        P, tgp = self.roster(me["key"])
        for p in P.values():
            pos, c = p["pos"], None
            if pos == "QB":
                if p["name"] != me["qb"] or "passing" not in p:
                    continue
                r, ru = p["passing"], p.get("rushing")
                legs = bool(ru) and ru["ydsG"] >= 30
                prod = (r["ydsG"] / 230 + r["td"] / 1.8) / 2 + (ru["ydsG"] / 150 if legs else 0)
                base = f'{num(r["ydsG"])} pass yds, {tg(r["td"])}' + (f' (+{num(ru["ydsG"])} rush)' if legs else "")
                if p["gp"] <= 2:
                    base += f' in {p["gp"]} gm'
                if o:
                    od = o["defense"]; rk = od["passYdsGRank"]
                    good = f'{base}; {on} is #{rk} vs the pass ({num(od["passYdsG"])} yds, {tg(od["passTdG"])} allowed).'
                    tough = f'{base}; {on} is #{rk} vs the pass ({num(od["passYdsG"])} yds/G, {num(od["int"])} INT/G).'
                c = dict(prod=prod, grp="pass", base=base)
            elif pos in ("RB", "FB"):
                r, rc = p.get("rushing"), p.get("receiving")
                if not r:
                    continue
                catches = bool(rc) and rc["rec"] >= 2.5
                prod = (r["ydsG"] / 60 + r["ag"] / 13) / 2 + (rc["rec"] / 12 if catches else 0)
                base = f'{num(r["ag"])} car, {num(r["ydsG"])} yds/G' + (f' + {num(rc["rec"])} rec' if catches else "")
                if o:
                    dv = o["defVsPosition"]; rk = dv["rb"]["rank"]
                    good = f'{base}; {on} is #{rk} vs backs ({num(dv["rb"]["yds"])} rush yds, {tg(dv["rb"]["td"])} allowed).'
                    tough = f'{base}; {on} is #{rk} vs backs ({num(dv["rb"]["yds"])} rush yds/G).'
                c = dict(prod=prod, grp="run", base=base)
            elif pos in ("WR", "TE"):
                r = p.get("receiving")
                if not r:
                    continue
                key = "wr" if pos == "WR" else "te"
                what = "WRs" if pos == "WR" else "TEs"
                prod = (r["ydsG"] / 60 + r["rec"] / 4.5) / 2 if pos == "WR" else (r["ydsG"] / 35 + r["rec"] / 3) / 2
                base = f'{num(r["rec"])} rec, {num(r["ydsG"])} yds/G' + (f', {tg(r["td"])}' if r["td"] >= 0.6 else "")
                if o:
                    dv = o["defVsPosition"]; rk = dv[key]["rank"]
                    good = f'{base}; {on} is #{rk} vs {what} ({num(dv[key]["yds"])} yds, {tg(dv[key]["td"])} allowed).'
                    tough = f'{base}; {on} is #{rk} vs {what} ({num(dv[key]["yds"])} yds/G).'
                c = dict(prod=prod, grp=key, base=base, yds=r["ydsG"], rec=r["rec"])
            if not c:
                continue
            inj = p["inj"]
            if inj and inj["s"] in INJ_OUT:  # won't play (or very unlikely): named in the game read instead
                if c["prod"] >= 0.6 and (p["active"] or c["prod"] >= 0.9):
                    hurt.append(f'{p["name"]} ({ab}, {INJ_OUT[inj["s"]]}' + (f', {inj["what"].lower()}' if inj["what"] else "") + ")")
                continue
            if inj and p["active"] and c["prod"] >= 0.6:
                quest.append(f'{p["name"]} ({ab}' + (f', {inj["what"].lower()}' if inj["what"] else "") + ")")
            c["inj"] = inj["s"] if inj else None
            if pos != "QB" and p["gp"] <= tgp - 2:
                c["base"] += f' ({p["gp"]} of {tgp} gms)'
            if o:
                c.update(m=self.m_of(rk), rk=rk,
                         good=good.replace("; ", f' ({p["gp"]} of {tgp} gms); ', 1) if pos != "QB" and p["gp"] <= tgp - 2 else good,
                         tough=tough.replace("; ", f' ({p["gp"]} of {tgp} gms); ', 1) if pos != "QB" and p["gp"] <= tgp - 2 else tough)
            else:  # opponent without stats on the dashboard (FCS): volume only
                c.update(m=0.0, rk=None, good=f'{c["base"]}; {on} has no stats on the dashboard.', tough="")
            if self.F is not None:   # the value board's projection against his season average
                bp = self.F.get(f"{ab}|{vb_norm(p['name'])}")
                stat = {"QB": ("pass_yds",), "RB": ("rush_yds", "rec_yds"), "FB": ("rush_yds", "rec_yds")}.get(pos, ("rec_yds",))
                avg = sum((p.get(sec) or {}).get("ydsG", 0) for sec, st_ in (("passing", "pass_yds"), ("rushing", "rush_yds"), ("receiving", "rec_yds")) if st_ in stat)
                proj = sum((bp or {}).get("p", {}).get(x, 0) for x in stat)
                if not bp or proj <= 0 or avg <= 0:
                    continue   # the board doesn't project him (not playing, or not this role)
                lift = proj / avg - 1
                why_ = self.drivers(pos, self.GL.get(p["log"], []), bp, on, p["log"])
                what_ = "pass" if pos == "QB" else "scrimmage" if pos in ("RB", "FB") else "rec"
                bt0 = f'board {num(round(proj))} ({"+" if lift >= 0 else MINUS}{abs(lift) * 100:.0f}%)'
                bt = bt0 + (f": {'; '.join(why_)}" if why_ else "")
                c["mx"] = bt0 + (f": {why_[0]}" if why_ and why_[0][0].isdigit() or why_ and why_[0].startswith("rushing") else "")   # Best Overall's shorter cell
                head_ = f"{num(avg)} {what_} yds/G" + (f' ({p["gp"]} of {tgp} gms)' if pos != "QB" and p["gp"] <= tgp - 2 else "")
                c.update(m=clip(lift / LIFT_FULL, -1, 1), lift=lift, proj=proj, board=True,
                         good=f"{head_}; {bt}.", tough=f"{head_}; {bt}.")
                if not o:
                    c["rk"] = None
            c.update(name=p["name"], team=ab, pos=pos, gp=p["gp"], tgp=tgp)
            if not p["active"] or p["gp"] < 2:
                if c["prod"] >= 0.9 and not p["active"]:
                    skipped.append(f'{p["name"]} ({ab})')
                continue
            out.append(c)
        return out, skipped, hurt, quest

    @staticmethod
    def take(pool, n, cap):
        res, per = [], {}
        for c in pool:
            if per.get(c["team"], 0) >= cap:
                continue
            res.append(c)
            per[c["team"]] = per.get(c["team"], 0) + 1
            if len(res) == n:
                break
        return res

    def pick(self, g):
        cands, skipped, hurt, quest = [], [], [], []
        for side in ("away", "home"):
            c, s, h, q = self.candidates(g, side)
            cands += c
            skipped += s
            hurt += h
            quest += q
        NT = self.NT
        stats = [c for c in cands if c["rk"] is not None]
        nostat = [c for c in cands if c["rk"] is None]
        gpool = sorted([c for c in stats if (c["m"] >= 0.25 and c["prod"] >= 0.6)
                        or (self.F is None and c["pos"] == "TE" and c["rk"] >= NT - max(2, NT // 10) and c.get("yds", 0) >= 20 and c.get("rec", 0) >= 2)],
                       key=lambda c: -c["prod"] * (0.5 + c["m"]))
        for c in gpool:
            c["gs"] = c["prod"] * (0.5 + c["m"])
        good = self.take(gpool, 5, 3)
        for c in good:
            c["text"] = ("Sleeper: " if c["pos"] == "TE" and c["prod"] < 0.6 else "") + c["good"]
        if nostat:  # FCS opponent: the FBS side's top producers
            for c in self.take(sorted(nostat, key=lambda c: -c["prod"]), 5 - len(good), 3):
                c["text"] = c["good"]; c["gs"] = 0; good.append(c)
        if len(good) < 3:
            vol = sorted([c for c in stats if c not in good and c["m"] >= -0.25 and c["prod"] >= 1.0], key=lambda c: -c["prod"])
            for c in self.take(vol, 3 - len(good), 2):
                c["text"] = "Volume: " + c["good"]; c["gs"] = 0; good.append(c)
        if len(good) < 2:
            rest = sorted([c for c in stats if c not in good and c["prod"] >= 0.9], key=lambda c: -c["prod"] * (1.2 + c["m"]))
            for c in self.take(rest, 2 - len(good), 1):
                c["text"] = "Best bet: " + c["good"]; c["gs"] = 0; good.append(c)
        tough_cut = -0.4 if NT > 60 else -0.35
        tpool = sorted([c for c in stats if c["m"] <= tough_cut and c["prod"] >= (1.0 if c["pos"] == "TE" else 0.8) and c not in good],
                       key=lambda c: -c["prod"] * (0.5 - c["m"]))
        extra_te = [c for c in tpool if c["pos"] == "TE"][1:]
        tough = self.take([c for c in tpool if c not in extra_te], 4, 3)
        for c in tough:
            c["text"] = c["tough"] + (" Volume keeps him in play." if c["prod"] >= 1.3 and c["pos"] != "QB" and not c.get("board") else "")
        seen = {}
        for c in good:
            k = (c["team"], c["grp"])
            if k in seen and not c["text"].startswith(("Sleeper", "Volume", "Best")) and c["rk"] is not None:
                c["text"] = f'{c["base"]}; same matchup as {seen[k]}.'
            else:
                seen.setdefault(k, c["name"])
        return good, tough, skipped, hurt, quest

    def td_rows(self, g):
        rows = []
        imp = self.implied(g)
        for i, side in enumerate(("away", "home")):
            me, opp = g[side], g["home" if side == "away" else "away"]
            if not me["key"]:
                continue
            t = self.T[me["key"]]
            o = self.T[opp["key"]] if opp["key"] else None
            pts = imp[i] if imp else (self.est_pts(t, o) if o else t["offense"]["ppg"])
            script = clip(pts / self.LA["ppg"], 0.6, 1.5)
            P, _ = self.roster(me["key"])
            for p in P.values():
                pos = p["pos"]
                if not p["active"] or p["gp"] < 2 or (p["inj"] and p["inj"]["s"] in INJ_OUT):
                    continue
                if pos == "QB":
                    if p["name"] != me["qb"]:
                        continue
                    tds, share = p["rtd"], 1.0
                    mr = o["defense"]["rushTdG"] / self.LA["rushTdG"] if o else 1.0
                    mc = 1.0
                    allowed = f'{tg(o["defense"]["rushTdG"]).replace("/G", "/G (all rushers)")}' if o else "no stats"
                    usage = True
                elif pos in ("RB", "FB"):
                    tds = p["rtd"] + p["ctd"]; share = (p["rtd"] + 0.5) / (tds + 1)
                    if o:
                        dv = o["defVsPosition"]
                        mr, mc = dv["rb"]["td"] / self.POS_AVG["rb"], dv["recRb"]["td"] / max(self.POS_AVG["recRb"], 0.01)
                        allowed = f'{tg(dv["rb"]["td"])} rushing to backs'
                    else:
                        mr = mc = 1.0; allowed = "no stats"
                    usage = p["car"] + p["recg"] >= (9 if self.D.league == "cfb" else 10)
                elif pos in ("WR", "TE"):
                    key = "wr" if pos == "WR" else "te"
                    tds = p["rtd"] + p["ctd"]; share = (p["rtd"] + 0.05) / (tds + 1)
                    mr = 1.0
                    if o:
                        mc = o["defVsPosition"][key]["td"] / self.POS_AVG[key]
                        allowed = f'{tg(o["defVsPosition"][key]["td"])} to {"WRs" if pos == "WR" else "TEs"}'
                    else:
                        mc = 1.0; allowed = "no stats"
                    usage = p["recg"] >= ((3 if pos == "WR" else 2) if self.D.league == "cfb" else (3.5 if pos == "WR" else 3))
                else:
                    continue
                if not usage or tds == 0:
                    continue
                lam = (tds + 0.6) / (p["gp"] + 2) * (share * clip(mr, 0.6, 1.6) + (1 - share) * clip(mc, 0.6, 1.6)) * script
                ptd = None
                if self.F is not None:   # the value board's chance of a rushing or receiving TD
                    bp = self.F.get(f"{me['abbr']}|{vb_norm(p['name'])}")
                    if not bp:
                        continue   # the board doesn't project him
                    ptd = bp.get("td")
                    if ptd is not None:   # a feed from before Nov 2026 has no TD chances: keep the estimate
                        lam = ptd
                split = f'{p["rtd"]} rush, {p["ctd"]} rec' if p["rtd"] and p["ctd"] else ("rushing" if p["rtd"] else "receiving")
                rows.append(dict(lam=lam, name=p["name"], team=me["abbr"], pos=pos, tds=tds, gp=p["gp"], split=split,
                                 oab=opp["abbr"], allowed=allowed, pts=pts, est=imp is None, gid=g["id"],
                                 inj=p["inj"]["s"] if p["inj"] else None, ptd=ptd))
        return sorted(rows, key=lambda r: -r["lam"])

    # volume and yards-per-play behind a projection: (board volume key, log volume key, log yards key,
    # volume unit, per-play unit, board yards stat, defense factor key, defense text)
    DRIVERS = {
        "QB": ("pass_att", "att", "pYds", "att", "yds/att", "pass_yds", "ypa", "per attempt"),
        "RB": ("carries", "car", "rYds", "carries", "yds/carry", "rush_yds", "ypc", "per carry"),
        "WR": ("targets", "tgt", "recYds", "tgt", "yds/tgt", "rec_yds", "ypt", "per target to WRs"),
        "TE": ("targets", "tgt", "recYds", "tgt", "yds/tgt", "rec_yds", "ypt", "per target to TEs"),
    }

    def drivers(self, pos, logs, bp, opp, log_key=None):
        """Why the board's number differs from his average: projected volume and yards per play
        against his own so far (and capped at the league's 97.5th percentile per play, when long plays carry 5% or more of it), the
        books' line, and the opponent when the board's defense factor moves him 5% or more."""
        key = "RB" if pos == "FB" else pos
        if key not in self.DRIVERS or not logs:
            return []
        bv, lv, ly, vu, eu, stat, fk, ftxt = self.DRIVERS[key]
        if self.D.league == "cfb" and key in ("WR", "TE"):   # college: catches and yards per catch, no position factor
            bv, lv, vu, eu, fk = "receptions", "rec", "rec", "yds/catch", None
        vol = [(g.get(lv) or 0, g.get(ly) or 0) for g in logs]
        tv, ty = sum(v for v, _ in vol), sum(y for _, y in vol)
        bvol, byds = bp["p"].get(bv), bp["p"].get(stat)
        out = []
        if tv > 0 and bvol and byds:
            his_v, his_e, b_e = tv / len(logs), ty / tv, byds / bvol
            wo = ""
            share = self.CAP.get(log_key, {}).get(CAP_KIND[key]) if self.CAP else None
            if share is not None and share <= 0.95:   # long plays capped at the league's 97.5th percentile (data/capped.json)
                wo = f"; {his_e * share:.1f} capped"
            out.append(("rushing " if key == "RB" else "") + f"{bvol:.1f} {vu} (his {his_v:.1f}), {b_e:.1f} {eu} (his {his_e:.1f}{wo})")
        ln = (bp.get("L") or {}).get(stat)
        if ln:
            out.append(f'line {num(ln["L"])}')
        f = (bp.get("f") or {}).get(fk) if fk else None
        if f is not None and abs(f - 1) >= 0.05:
            out.append(f'{opp} allows {abs(f - 1) * 100:.0f}% {"more" if f > 1 else "fewer"} {ftxt}')
        return out

    def amber_rows(self, g):
        """The players the matchup pages color amber (common.js cappedCell): in the team card's
        Passing, Rushing or Receiving table, 4+ games, and a capped drop at or above the league's
        90th-percentile line for that table (data/capped.json). [(name, team, kind, yds/G, capped)]."""
        if not self.CAP or not self.AMBER:
            return []
        out = []
        for side in ("away", "home"):
            k = g[side]["key"]
            if not k:
                continue
            for sec, kind, word in (("passing", "pass", "pass"), ("rushing", "rush", "rush"), ("receiving", "rec", "rec")):
                for r in self.T[k].get(sec) or []:
                    inj = self.D.inj.get(r.get("log"))
                    if inj and inj["s"] in INJ_OUT:   # out/doubtful: not playing, so not a play this week
                        continue
                    if sec == "passing" and g[side].get("qb") and r["player"] != g[side]["qb"]:
                        continue   # only the listed starter's passing
                    share = (self.CAP.get(r.get("log")) or {}).get(kind)
                    cut = self.AMBER.get(kind)
                    if share is None or cut is None or len(self.GL.get(r.get("log"), [])) < 4:
                        continue
                    drop = 1 - share
                    if drop > 0 and drop >= cut:
                        out.append((r["player"], g[side]["abbr"], word, r["ydsG"], round(r["ydsG"] * share, 1)))
        return sorted(out, key=lambda a: -(a[3] - a[4]))

    def _z(self, side, key, v):
        vals = [t[side][key] for t in self.EPA.values() if t.get(side, {}).get(key) is not None]
        m = st.mean(vals)
        return (v - m) / (st.stdev(vals) or 1)

    def _epa_read(self, s, a, h):
        """Biggest edge and hardest going from adjusted pass and run EPA: the gap between an offense
        and the other defense in league standard deviations, called at 1 (the sites' Head to Head rule)."""
        units = []
        for x, y in ((a, h), (h, a)):
            X, Y = self.EPA[x], self.EPA[y]
            for key, word in (("pass", "passing"), ("rush", "running")):
                gap = self._z("off", key, X["off"][key]) + self._z("def", key, Y["def"][key])   # a defense: higher allowed is worse
                units.append((gap, x, y, key, word))
        units.sort(key=lambda u: -u[0])
        dw = lambda w: "run" if w == "running" else "pass"
        rk = lambda t, k: self.EPA[t]["rk"].get(k)
        best, worst = units[0], units[-1]
        if best[0] >= 1:
            s.append(f'Biggest edge: {best[1]}\'s {best[4]} game (#{rk(best[1], "o_" + best[3])} in adjusted EPA) against the #{rk(best[2], "d_" + best[3])} {dw(best[4])} defense.')
        else:
            s.append("Neither offense has a clear edge in adjusted EPA.")
        if worst[0] <= -1:
            s.append(f'Hardest going: {worst[1]}\'s {worst[4]} game (#{rk(worst[1], "o_" + worst[3])}) against the #{rk(worst[2], "d_" + worst[3])} {dw(worst[4])} defense.')

    def game_read(self, g, skipped, hurt=(), quest=()):
        s = []
        if g["spread"] is not None and g["total"] is not None:
            if g["spread"] == 0:
                s.append(f'Pick\'em with a total of {num(g["total"])}.')
            else:
                fav = (g["home"] if g["spread"] < 0 else g["away"])["name"]
                s.append(f'{fav} is {art(abs(g["spread"]))} {num(abs(g["spread"]))}-point favorite and the total is {num(g["total"])}.')
        else:
            s.append("No betting line in the data yet.")
        a, h = g["away"]["key"], g["home"]["key"]
        if a and h and self.EPA and a in self.EPA and h in self.EPA:
            self._epa_read(s, a, h)
        elif a and h:
            A, H = self.T[a], self.T[h]
            units = []
            for t, o in ((A, H), (H, A)):
                for kind, ok, word in (("rushYdsG", "rushYdsGRank", "running"), ("passYdsG", "passYdsGRank", "passing")):
                    units.append((o["defense"][ok] - t["offense"][ok], t, o, kind, ok, word))
            units.sort(key=lambda u: -u[0])
            best, worst = units[0], units[-1]
            dw = lambda w: "run" if w == "running" else "pass"
            edge_min, hard_min = (20, -30) if self.NT > 60 else (6, -10)
            if best[0] >= edge_min:
                s.append(f'Biggest edge: {best[1]["team"]}\'s {best[5]} game (#{best[1]["offense"][best[4]]}, {num(best[1]["offense"][best[3]])} yds/G) against the #{best[2]["defense"][best[4]]} {dw(best[5])} defense.')
            else:
                s.append("Neither offense has a clear edge on paper.")
            if worst[0] < hard_min:
                s.append(f'Hardest going: {worst[1]["team"]}\'s {worst[5]} game (#{worst[1]["offense"][worst[4]]}) against the #{worst[2]["defense"][worst[4]]} {dw(worst[5])} defense.')
        else:
            missing = g["away"] if not a else g["home"]
            s.append(f'{missing["name"]} has no stats on the dashboard, so only the other side\'s producers are listed.')
        for side in ("away", "home"):
            k = g[side]["key"]
            if not k or not g[side]["qb"]:
                continue
            t = self.T[k]
            top = max(t["passing"], key=lambda p: p["ydsG"] * len(self.GL.get(p["log"], [])))
            if top["player"] != g[side]["qb"]:
                s.append(f'{t.get("team", k)} has {g[side]["qb"]} listed at QB; {top["player"]} has thrown for most of its yards.')
        if hurt:
            s.append("Left out with injuries: " + ", ".join(hurt) + ".")
        if quest:
            s.append("Questionable: " + ", ".join(quest) + ".")
        if skipped:
            s.append("Left out because they missed their team's last game: " + ", ".join(skipped) + ".")
        return " ".join(s)


# ---------------------------------------------------------------- html
def team_colors(root, league):
    js = (root / "teamcolors.js").read_text(encoding="utf-8") + (
        "\nconst o={};for(const k of Object.keys(TEAM_COLORS)){const c=teamColors(k);o[k]={bg:c.bg,on2:c.on2}};console.log(JSON.stringify(o));")
    try:
        return json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    except Exception:
        return {}


def build(root=ROOT, out=None, font_css=None, vb=None):
    """Write report.html and report-games.json into `out`; return (path, game ids, title)."""
    out = Path(out or root / "pdf")
    out.mkdir(parents=True, exist_ok=True)
    d = json.loads((root / "data" / "data.json").read_text(encoding="utf-8"))
    D = Data(d)
    D.load_injuries(root / "data" / "injuries.json")
    feed = load_feed(vb or Path(root).parent / "fb-value-board", D.league, d.get("season"), D.week)
    tracker = load_tracker(vb or Path(root).parent / "fb-value-board", D.league, d.get("season"))
    try:
        epa = json.loads((root / "data" / "epa.json").read_text(encoding="utf-8"))
        epa = epa if epa.get("season") == d.get("season") else None
    except Exception:
        epa = None
    try:
        cap = json.loads((root / "data" / "capped.json").read_text(encoding="utf-8"))
        cap = cap if cap.get("season") == d.get("season") else None
    except Exception:
        cap = None
    if feed:   # the value board's projected starter beats the schedule's listed QB (stale when a starter goes on IR)
        by_team = {}
        for k, v in feed["players"].items():
            if v.get("pos") == "QB" and (v.get("p") or {}).get("pass_att", 0) > 0:
                t = k.split("|", 1)[0]
                if t not in by_team or v["p"]["pass_att"] > by_team[t]["p"]["pass_att"]:
                    by_team[t] = v
        for g in D.games:
            for side in ("away", "home"):
                b = by_team.get(g[side]["abbr"])
                if b and b["n"] != g[side]["qb"]:
                    print(f"  report: {g[side]['abbr']} QB {g[side]['qb'] or 'n/a'} -> {b['n']} (value board's projected starter)")
                    g[side]["qb"] = b["n"]
    R = Report(D, feed, epa, cap)
    floors = load_floors(vb or Path(root).parent / "fb-value-board", D.league, d.get("season"), D.week,
                         {g[s]["abbr"] for g in D.games for s in ("away", "home")})
    print(f"  report: value board feed {'used' if feed else 'not found, raw matchups'}; adjusted EPA {'used' if epa else 'not found'}")
    COL = team_colors(root, D.league)
    L = D.league.upper()
    games = D.games
    NG = len(games)
    title_txt = f"{L} Week {D.week} Matchup Report"

    def vs(g):
        return "vs" if g["neutral"] else "@"

    def label(x):
        return (f'#{x["rank"]} ' if x["rank"] else "") + x["abbr"]

    def gtitle(g):
        return f'{label(g["away"])} {vs(g)} {label(g["home"])}'

    def when(g):
        dt = datetime.fromisoformat(g["start"].replace("Z", "+00:00")).astimezone(ET)
        return dt, f'{dt.strftime("%A")}, {dt.strftime("%b")} {dt.day}', f'{dt.strftime("%I:%M %p").lstrip("0")} ET'

    def spread_txt(g, sp=None):
        sp = g["spread"] if sp is None else sp
        if sp == 0:
            return "Pick'em"
        return f'{(g["home"] if sp < 0 else g["away"])["abbr"]} {MINUS}{num(abs(sp))}'

    def slab(x):
        c = COL.get(x["abbr"]) or COL.get(x["key"] or "") or COL.get(x["name"]) or {"bg": "#3A3F47", "on2": "#F2F1EE"}
        return f'<span class="slab" style="background:{c["bg"]};color:{c["on2"]}">{E(x["abbr"])}</span>'

    def team_html(x):
        rk = f'<span class="rk">#{x["rank"]}</span> ' if x["rank"] else ""
        if x["key"]:
            t = D.T[x["key"]]
            sub = f'{x["record"]}, {num(t["offense"]["ppg"])} PPG, {num(t["defense"]["papg"])} PA/G'
        else:
            sub = f'{x["record"]}{", " if x["record"] else ""}no stats on the dashboard'
        return f'<div class="team">{slab(x)}<div><div class="tname">{rk}{E(x["name"])}</div><div class="sub">{E(sub)}</div></div></div>'

    def strip(g):
        imp = R.implied(g)
        lo = g["lineOpen"] or {}
        if imp:
            mv_s = f'<div class="sub move">opened {spread_txt(g, lo["spread"])}</div>' if lo.get("spread") not in (None, g["spread"]) else ""
            mv_t = f'<div class="sub move">opened {num(lo["total"])}</div>' if lo.get("total") not in (None, g["total"]) else ""
            cells = (f'<div class="cell"><div class="lbl">Spread</div><div class="big">{spread_txt(g)}</div>{mv_s}</div>'
                     f'<div class="cell"><div class="lbl">Total</div><div class="big">{num(g["total"])}</div>{mv_t}</div>'
                     f'<div class="cell"><div class="lbl">Implied score</div><div class="imp">{g["away"]["abbr"]} {half_up(imp[0])}, {g["home"]["abbr"]} {half_up(imp[1])}</div></div>')
        else:
            cells = ('<div class="cell"><div class="lbl">Spread</div><div class="big dim">—</div></div>'
                     '<div class="cell"><div class="lbl">Total</div><div class="big dim">—</div></div>'
                     '<div class="cell"><div class="lbl">Implied score</div><div class="imp dim">No line yet</div></div>')
        bits = [g["city"]] + (["Indoors"] if g["indoor"] else []) + (["Neutral site"] if g["neutral"] else []) + ([g["flag"]] if g["flag"] else [])
        return (f'<div class="strip">{team_html(g["away"])}<div class="at">{vs(g)}</div>{team_html(g["home"])}{cells}'
                f'<div class="cell where"><div class="stad">{E(g["venue"])}</div><div class="sub">{E(". ".join(b for b in bits if b))}</div></div></div>')

    def itag(c):
        return f' <span class="inj">{E(c["inj"])}</span>' if c.get("inj") else ""

    def bullets(items, empty, amb=frozenset()):
        if not items:
            return f'<li class="none"><div class="why">{empty}</div></li>'
        mark = lambda c: ' <span class="amb" title="Long plays carry more of his average than for 90% of regulars">▲</span>' if (c["name"], c["team"]) in amb else ""
        return "".join(f'<li><span class="pl">{E(c["name"])}</span>{mark(c)}{itag(c)} <span class="tag">{E(c["team"])} {c["pos"]}</span><div class="why">{E(c["text"])}</div></li>' for c in items)

    G = []
    for i, g in enumerate(games, 1):
        good, tough, skipped, hurt, quest = R.pick(g)
        read = R.game_read(g, skipped, hurt, quest)
        if len(read) > 350 and len(good) + len(tough) > 5:   # keep a long game read on one page
            good = good[:4] if len(good) >= len(tough) else good
            tough = tough[:3] if len(good) + len(tough) > 7 else tough
        G.append(dict(g=g, n=i, good=good, tough=tough, read=read, td=R.td_rows(g), amb=R.amber_rows(g)))

    cards = []
    for x in G:
        g = x["g"]
        ambset = frozenset((a[0], a[1]) for a in x["amb"])
        amb = ("; ".join(f'<b>{E(a[0])}</b> <span class="tag">{E(a[1])}</span> {a[2]} {num(a[3])} → {num(a[4])}' for a in x["amb"][:6])
               + (f"; and {len(x['amb']) - 6} more" if len(x["amb"]) > 6 else ""))
        _, day, tm = when(g)
        tv = f' · {g["tv"]}' if g["tv"] else ""
        tdw = "; ".join(f'<b>{E(r["name"])}</b>{itag(r)} <span class="tag">{E(r["team"])} {r["pos"]}</span> '
                        + (f'{r["ptd"] * 100:.0f}% chance, ' if r.get("ptd") is not None else "")
                        + f'{r["tds"]} TD{"s" if r["tds"] != 1 else ""} in {r["gp"]} games' for r in x["td"][:3]) or "No one qualifies."
        cards.append(f'''<section class="game" id="g{E(g["id"])}" data-game="{E(g["id"])}">
  <div class="eyebrow"><span class="gno">Game {x["n"]} of {NG}</span><h2 class="gtitle">{E(gtitle(g))}</h2><span class="gwhen">{day} · {tm}{tv}</span></div>
  {strip(g)}
  <div class="body">
    <p class="read"><b>Game read.</b> {E(x["read"])} <span class="qbs">Listed QBs: {E(g["away"]["qb"] or "n/a")} ({E(g["away"]["abbr"])}), {E(g["home"]["qb"] or "n/a")} ({E(g["home"]["abbr"])}).</span></p>
    <div class="cols">
      <div class="col good"><h3>Good spots</h3><ul>{bullets(x["good"], "No soft matchups here.", ambset)}</ul></div>
      <div class="col tough"><h3>Tough spots</h3><ul>{bullets(x["tough"], "None stand out. The value board has no main producer here well under his average." if R.F is not None else "None stand out. No main producer here faces a top defense against his position.", ambset)}</ul></div>
    </div>
    <p class="tdw"><span class="tdl">Touchdown watch</span> {tdw}</p>{f"""
    <p class="tdw ambw"><span class="tdl ambl">▲ Long plays</span> {amb} <span class="dim">(yds/G, then capped: every long play counted at the league's 97.5th percentile)</span></p>""" if amb else ""}
  </div></section>''')

    # Best Overall Matchups: one per team, players who have played nearly every game
    allgood = sorted([(c, x) for x in G for c in x["good"] if c.get("gs", 0) > 0 and c["gp"] >= c["tgp"] - 1], key=lambda cx: -cx[0]["gs"])
    TOPN = 22 if L == "CFB" else 15
    top, seen = [], set()
    for c, x in allgood:
        if c["team"] in seen:
            continue
        seen.add(c["team"]); top.append((c, x))
        if len(top) == TOPN:
            break
    top_rows = "".join(
        f'<tr><td class="n">{i}</td><td><b>{E(c["name"])}</b>{itag(c)} <span class="tag">{E(c["team"])} {c["pos"]}</span></td>'
        f'<td><a href="#g{E(x["g"]["id"])}">{E(gtitle(x["g"]))}</a></td><td>{E(c["good"].split("; ", 1)[0])}</td><td>{E(c.get("mx") or c["good"].split("; ", 1)[1])}</td></tr>'
        for i, (c, x) in enumerate(top, 1))

    alltd = sorted([dict(r, x=x) for x in G for r in x["td"]], key=lambda r: -r["lam"])
    TDN = 40 if L == "CFB" else 20

    def td_table(rows, start):
        body = "".join(
            f'<tr><td class="n">{i}</td><td><b>{E(r["name"])}</b>{itag(r)} <span class="tag">{E(r["team"])} {r["pos"]}</span></td>'
            f'<td><a href="#g{E(r["gid"])}">{E(gtitle(r["x"]["g"]))}</a></td><td>{r["tds"]} in {r["gp"]} ({r["split"]})</td>'
            f'<td>{E(r["oab"])} allows {E(r["allowed"] if r.get("ptd") is None else r["allowed"].replace(" rushing to backs", " to RBs").replace(" (all rushers)", ""))}</td>'
            + (f'<td class="r"><b>{r["ptd"] * 100:.0f}%</b></td>' if r.get("ptd") is not None   # the board's chance already counts team points
               else f'<td class="r">{half_up(r["pts"])}{" est." if r["est"] else ""}</td>') + '</tr>'
            for i, r in enumerate(rows, start))
        last = '<th class="r">TD chance</th>' if any(r.get("ptd") is not None for r in rows) else '<th class="r">Team pts</th>'
        return f'<table class="tdt"><thead><tr><th></th><th>Player</th><th>Game</th><th>TDs so far</th><th>Opponent</th>{last}</tr></thead><tbody>{body}</tbody></table>'

    league_name = "College football" if L == "CFB" else "NFL"
    half = TDN // 2 if L == "CFB" else TDN
    td_html = f'''<section class="tdsec" id="td">
  <div class="kicker">{league_name} Week {D.week} · {d.get("season", "")}</div>
  <h1 class="h1s">Most Likely to Score a TD</h1>
  <p class="lede">{f"The {TDN} likeliest rushing or receiving TD scorers across all {NG} games, by the value board's anytime-TD chance (passing TDs don't count). Each game page lists its top three under Touchdown watch." if R.F is not None else f'The {TDN} players with the best chance of a rushing or receiving touchdown, ranked across all {NG} games. Passing TDs do not count for quarterbacks. Each game page lists its own top three under "Touchdown watch".'}</p>
  {td_table(alltd[:half], 1)}
</section>''' + (f'''
<section class="tdsec">
  <h2 class="h2s">Most Likely to Score a TD, continued</h2>
  {td_table(alltd[half:TDN], half + 1)}
</section>''' if half < TDN else "")
    best_html = f'''<section class="tdsec" id="best">
  <div class="kicker">{league_name} Week {D.week} · {d.get("season", "")}</div>
  <h1 class="h1s">Best Overall Matchups</h1>
  <p class="lede">The strongest good spots across all {NG} games, ranked by production times {"how far the value board projects him above his season average" if R.F is not None else "how soft the opposing defense is at his position"}. One player per team, and only players who have played nearly every game.</p>
  <table class="tdt"><thead><tr><th></th><th>Player</th><th>Game</th><th>Production</th><th>Matchup</th></tr></thead><tbody>{top_rows}</tbody></table>
</section>'''

    # Highest Floors: two pages, three lists side by side on each
    def floor_table(pos, key, head):
        rows = floors.get((pos, key)) or []
        body = "".join(f'<tr><td class="n">{i}</td><td><b>{E(r["name"])}</b></td><td>{E(r["team"])}</td>'
                       f'<td class="r"><b>{r["floor"]}</b></td><td class="r dimc">{r["g"]}</td></tr>' for i, r in enumerate(rows, 1)) \
            or '<tr><td></td><td colspan="4" class="dimc">No one qualifies.</td></tr>'
        return (f'<div class="flcol"><h3 class="flh">{E(head)}</h3><table class="tdt flt"><thead><tr><th></th><th>Player</th><th>Team</th>'
                f'<th class="r">Floor</th><th class="r">Games</th></tr></thead><tbody>{body}</tbody></table></div>')
    floors_html = (f'''<section class="tdsec flsec" id="floors">
  <div class="kicker">{league_name} Week {D.week} · {d.get("season", "")}</div>
  <h1 class="h1s">Highest Floors</h1>
  <p class="lede">The {FLOOR_N} highest every-game floors at each position across this week's games, from the value board: the yards he has reached in every game he has played this season (current team only, a quarterback's starts only, injury-shortened games left out; 3+ games). Players the board has ruled out are left out. Games: how many games the floor covers. Information, not a bet.</p>
  <div class="flgrid">{"".join(floor_table(*x) for x in FLOOR_LISTS[:3])}</div>
</section>
<section class="tdsec flsec">
  <h2 class="h2s">Highest Floors, continued</h2>
  <div class="flgrid">{"".join(floor_table(*x) for x in FLOOR_LISTS[3:])}</div>
</section>''') if floors else ""
    print(f"  report: Highest Floors {'added' if floors else 'left out (no value board floors for this week)'}")

    third = math.ceil(NG / 3) if NG > 20 else NG
    def idx_table(rows):
        body = "".join(
            f'<tr><td class="n">{x["n"]}</td><td><a href="#g{E(x["g"]["id"])}"><b>{E(gtitle(x["g"]))}</b></a></td><td>{when(x["g"])[1][:3]} {when(x["g"])[2].replace(" ET", "")}</td>'
            f'<td>{spread_txt(x["g"]) if x["g"]["spread"] is not None else "<span class=dimc>no line</span>"}</td><td class="r">{num(x["g"]["total"]) if x["g"]["total"] is not None else ""}</td></tr>'
            for x in rows)
        return f'<table class="toc"><thead><tr><th></th><th>Game</th><th>Kickoff (ET)</th><th>Spread</th><th class="r">Total</th></tr></thead><tbody>{body}</tbody></table>'
    chunks = [G[i:i + third] for i in range(0, NG, third)] if NG else []
    index_html = f'<section class="idx" id="index"><h2 class="h2s">Games covered</h2><div class="idxgrid">{"".join(idx_table(c) for c in chunks)}</div></section>'

    nlines = sum(g["spread"] is not None for g in games)
    gen = datetime.fromisoformat(d["generatedAt"]).astimezone(ET) if d.get("generatedAt") else None
    if D.inj_src:
        try:
            ia = datetime.fromisoformat(D.inj_at.replace("Z", "+00:00")).astimezone(ET)
            ia = f', as of {ia.strftime("%b")} {ia.day}, {ia.strftime("%I:%M %p").lstrip("0")} ET'
        except Exception:
            ia = ""
        inj_note = (f'<li><b>Injuries.</b> Source: {E(D.inj_src)}{ia}. '
                    "Players listed out, doubtful, on IR or suspended are left out of the picks and named in the game read; "
                    "questionable players stay in, tagged Q. Players who missed their team's last game are also left out. "
                    "Schedule strength is not adjusted for.</li>")
    else:
        inj_note = ("<li><b>No injury data.</b> Players who missed their team's last game are left out and named in the game read. "
                    "Schedule strength is not adjusted for.</li>")
    def _d(g):
        dt = when(g)[0]; return f'{dt.strftime("%A")}, {dt.strftime("%b")} {dt.day}'
    rng = f"{_d(games[0])} through {_d(games[-1])}" if games else ""
    site = "rhyman7.github.io/cfb" if L == "CFB" else "rhyman7.github.io/nfl"
    css = (root / "scripts" / "report.css").read_text(encoding="utf-8")
    doc = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{E(title_txt)}</title>
{font_css or FONT_LINK}
<style>{css}</style></head><body>
<header class="cover">
  <div class="kicker">{league_name} Week {D.week} · {d.get("season", "")}</div>
  <h1>{E(title_txt)}</h1>
  <p class="lede">Who is set up for a good game, and who is not, in all {NG} games of Week {D.week}{", from " + rng if rng else ""}. After the game pages come {"three rankings" if floors else "two rankings"} across the whole slate: the best overall matchups, the players most likely to score a touchdown{" and the highest every-game floors at each position" if floors else ""}.</p>
  <div class="notes"><h2>How to read this</h2><ul>
    <li><b>Method.</b> Each player's per-game production is compared with how the opposing defense ranks against his position (backs, receivers, tight ends) and against the pass. Ranks are out of {D.NT}; #1 is the stingiest defense.</li>
    <li><b>Source.</b> Every number comes from the {L} dashboard ({site}), with stats through Week {D.through}{f" and lines as of {gen.strftime('%b')} {gen.day}" if gen else ""}. The report is built automatically after each data update.</li>
    <li><b>Lines.</b> {"Every game has a spread and total in the data." if nlines == NG else f"{nlines} of the {NG} games have a spread and total so far; the rest show No line yet, and their team points in the TD ranking are estimates (est.)."}</li>
    {inj_note}
  </ul></div>
</header>
{index_html}
{"".join(cards)}
{best_html}
{td_html}
{tracker_html(tracker, league_name, D.week) if tracker else ""}
{floors_html}
</body></html>'''
    (out / "report.html").write_text(doc, encoding="utf-8")
    ids = [g["id"] for g in games]
    (out / "report-games.json").write_text(json.dumps({"league": D.league, "week": D.week, "season": d.get("season"), "games": ids, "title": title_txt}, indent=1), encoding="utf-8")
    return out / "report.html", ids, title_txt


def render_pdf(html_path, pdf_path, footer, browser=None):
    """Render report.html to a landscape-letter PDF. Pass an open Playwright browser to reuse it."""
    def go(b):
        pg = b.new_page()
        pg.goto(Path(html_path).resolve().as_uri(), wait_until="networkidle", timeout=60000)
        pg.evaluate("document.fonts.ready")
        pg.pdf(path=str(pdf_path), width="11in", height="8.5in", print_background=True, prefer_css_page_size=True, outline=True, tagged=True,
               display_header_footer=True, header_template="<span></span>",
               footer_template=f'<div style="font-size:7px;color:#777;width:100%;padding:0 0.55in;display:flex;justify-content:space-between;font-family:sans-serif"><span>{E(footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>')
        pg.close()
    if browser is not None:
        return go(browser)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        go(b)
        b.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "pdf"))
    ap.add_argument("--pdf", action="store_true")
    ap.add_argument("--font-css", default=None, help="replacement <link>/<style> for the Archivo font (offline builds)")
    a = ap.parse_args()
    path, ids, title = build(ROOT, a.out, a.font_css)
    print(f"wrote {path} ({len(ids)} games)")
    if a.pdf:
        render_pdf(path, Path(a.out) / "report.pdf", title)
        print("wrote", Path(a.out) / "report.pdf")
