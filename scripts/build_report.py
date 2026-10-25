"""Build the Weekly Matchup Report: who is set up for a good game, and who is not, in every
game of the current week, plus two rankings across the slate (Best Overall Matchups and
Most Likely to Score a TD). Every number comes from data/data.json.

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
class Report:
    def __init__(self, D):
        self.D = D
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
            return [], []
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
                        or (c["pos"] == "TE" and c["rk"] >= NT - max(2, NT // 10) and c.get("yds", 0) >= 20 and c.get("rec", 0) >= 2)],
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
            c["text"] = c["tough"] + (" Volume keeps him in play." if c["prod"] >= 1.3 and c["pos"] != "QB" else "")
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
                split = f'{p["rtd"]} rush, {p["ctd"]} rec' if p["rtd"] and p["ctd"] else ("rushing" if p["rtd"] else "receiving")
                rows.append(dict(lam=lam, name=p["name"], team=me["abbr"], pos=pos, tds=tds, gp=p["gp"], split=split,
                                 oab=opp["abbr"], allowed=allowed, pts=pts, est=imp is None, gid=g["id"],
                                 inj=p["inj"]["s"] if p["inj"] else None))
        return sorted(rows, key=lambda r: -r["lam"])

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
        if a and h:
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


def build(root=ROOT, out=None, font_css=None):
    """Write report.html and report-games.json into `out`; return (path, game ids, title)."""
    out = Path(out or root / "pdf")
    out.mkdir(parents=True, exist_ok=True)
    d = json.loads((root / "data" / "data.json").read_text(encoding="utf-8"))
    D = Data(d)
    D.load_injuries(root / "data" / "injuries.json")
    R = Report(D)
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

    def bullets(items, empty):
        if not items:
            return f'<li class="none"><div class="why">{empty}</div></li>'
        return "".join(f'<li><span class="pl">{E(c["name"])}</span>{itag(c)} <span class="tag">{E(c["team"])} {c["pos"]}</span><div class="why">{E(c["text"])}</div></li>' for c in items)

    G = []
    for i, g in enumerate(games, 1):
        good, tough, skipped, hurt, quest = R.pick(g)
        G.append(dict(g=g, n=i, good=good, tough=tough, read=R.game_read(g, skipped, hurt, quest), td=R.td_rows(g)))

    cards = []
    for x in G:
        g = x["g"]
        _, day, tm = when(g)
        tv = f' · {g["tv"]}' if g["tv"] else ""
        tdw = "; ".join(f'<b>{E(r["name"])}</b>{itag(r)} <span class="tag">{E(r["team"])} {r["pos"]}</span> {r["tds"]} TD{"s" if r["tds"] != 1 else ""} in {r["gp"]} games' for r in x["td"][:3]) or "No one qualifies."
        cards.append(f'''<section class="game" id="g{E(g["id"])}" data-game="{E(g["id"])}">
  <div class="eyebrow"><span class="gno">Game {x["n"]} of {NG}</span><h2 class="gtitle">{E(gtitle(g))}</h2><span class="gwhen">{day} · {tm}{tv}</span></div>
  {strip(g)}
  <div class="body">
    <p class="read"><b>Game read.</b> {E(x["read"])} <span class="qbs">Listed QBs: {E(g["away"]["qb"] or "n/a")} ({E(g["away"]["abbr"])}), {E(g["home"]["qb"] or "n/a")} ({E(g["home"]["abbr"])}).</span></p>
    <div class="cols">
      <div class="col good"><h3>Good spots</h3><ul>{bullets(x["good"], "No soft matchups here.")}</ul></div>
      <div class="col tough"><h3>Tough spots</h3><ul>{bullets(x["tough"], "None stand out. No main producer here faces a top defense against his position.")}</ul></div>
    </div>
    <p class="tdw"><span class="tdl">Touchdown watch</span> {tdw}</p>
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
        f'<td><a href="#g{E(x["g"]["id"])}">{E(gtitle(x["g"]))}</a></td><td>{E(c["good"].split("; ", 1)[0])}</td><td>{E(c["good"].split("; ", 1)[1])}</td></tr>'
        for i, (c, x) in enumerate(top, 1))

    alltd = sorted([dict(r, x=x) for x in G for r in x["td"]], key=lambda r: -r["lam"])
    TDN = 40 if L == "CFB" else 20

    def td_table(rows, start):
        body = "".join(
            f'<tr><td class="n">{i}</td><td><b>{E(r["name"])}</b>{itag(r)} <span class="tag">{E(r["team"])} {r["pos"]}</span></td>'
            f'<td><a href="#g{E(r["gid"])}">{E(gtitle(r["x"]["g"]))}</a></td><td>{r["tds"]} in {r["gp"]} ({r["split"]})</td>'
            f'<td>{E(r["oab"])} allows {E(r["allowed"])}</td><td class="r">{half_up(r["pts"])}{" est." if r["est"] else ""}</td></tr>'
            for i, r in enumerate(rows, start))
        return f'<table class="tdt"><thead><tr><th></th><th>Player</th><th>Game</th><th>TDs so far</th><th>Opponent</th><th class="r">Team pts</th></tr></thead><tbody>{body}</tbody></table>'

    league_name = "College football" if L == "CFB" else "NFL"
    half = TDN // 2 if L == "CFB" else TDN
    td_html = f'''<section class="tdsec" id="td">
  <div class="kicker">{league_name} Week {D.week} · {d.get("season", "")}</div>
  <h1 class="h1s">Most Likely to Score a TD</h1>
  <p class="lede">The {TDN} players with the best chance of a rushing or receiving touchdown, ranked across all {NG} games. Passing TDs do not count for quarterbacks. Each game page lists its own top three under "Touchdown watch".</p>
  {td_table(alltd[:half], 1)}
</section>''' + (f'''
<section class="tdsec">
  <h2 class="h2s">Most Likely to Score a TD, continued</h2>
  {td_table(alltd[half:TDN], half + 1)}
</section>''' if half < TDN else "")
    best_html = f'''<section class="tdsec" id="best">
  <div class="kicker">{league_name} Week {D.week} · {d.get("season", "")}</div>
  <h1 class="h1s">Best Overall Matchups</h1>
  <p class="lede">The strongest good spots across all {NG} games, ranked by production times how soft the opposing defense is at his position. One player per team, and only players who have played nearly every game.</p>
  <table class="tdt"><thead><tr><th></th><th>Player</th><th>Game</th><th>Production</th><th>Matchup</th></tr></thead><tbody>{top_rows}</tbody></table>
</section>'''

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
  <p class="lede">Who is set up for a good game, and who is not, in all {NG} games of Week {D.week}{", from " + rng if rng else ""}. After the game pages come two rankings across the whole slate: the best overall matchups and the players most likely to score a touchdown.</p>
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
