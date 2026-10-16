// How to Read Matchups: one FBS-vs-FBS game from this week, every section of its matchup page
// explained with that game's own numbers. Opens on a random game; the picker and
// "Pick another game" switch to any other game this week. ?game=<id> opens a given game.
// app.js loads the data and calls initLearn() on this page (data-page="learn").
let LEARN_GAMES = [];
let LEARN_CUR = null;
let EDGE_GAP = 26;
const TM = s => (s && s.key ? DATA.teams[s.key] : null);

function initLearn() {
  const root = document.getElementById("learn");
  EDGE_GAP = edgeGap();   // same rule as Head to Head (edgePanel)
  LEARN_GAMES = (DATA.weekGames || []).filter(g => TM(g.away) && TM(g.home))
    .slice().sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!LEARN_GAMES.length) {
    root.innerHTML = `<div class="empty-note">No games this week to walk through yet.</div>`;
    return;
  }
  const pick = document.getElementById("learnPick");
  pick.innerHTML = LEARN_GAMES.map(g => `<option value="${escapeHtml(String(g.id))}">${g.away.rank ? "#" + g.away.rank + " " : ""}${escapeHtml(g.away.name)} ${g.neutral ? "vs" : "at"} ${g.home.rank ? "#" + g.home.rank + " " : ""}${escapeHtml(g.home.name)}</option>`).join("");
  pick.addEventListener("change", () => learnShow(pick.value));
  document.getElementById("learnRandom").addEventListener("click", () => {
    const others = LEARN_GAMES.filter(g => g.id !== (LEARN_CUR && LEARN_CUR.id));
    learnShow((others.length ? others : LEARN_GAMES)[Math.floor(Math.random() * (others.length || LEARN_GAMES.length))].id);
  });
  const want = new URLSearchParams(location.search).get("game");
  const first = LEARN_GAMES.find(g => String(g.id) === want) || LEARN_GAMES[Math.floor(Math.random() * LEARN_GAMES.length)];
  learnShow(first.id);
  if (typeof refreshLines === "function") refreshLines(new Set(LEARN_GAMES.map(g => String(g.id))), () => learnShow(LEARN_CUR.id, true));
}

function learnShow(id, keepScroll) {
  const g = LEARN_GAMES.find(x => String(x.id) === String(id)) || LEARN_GAMES[0];
  LEARN_CUR = g;
  const a = TM(g.away), h = TM(g.home);
  document.getElementById("learnPick").value = String(g.id);
  document.getElementById("learnGame").textContent = `${a.team} ${g.neutral ? "vs." : "at"} ${h.team}`;
  const open = document.getElementById("learnOpen");
  open.href = `matchup.html?game=${encodeURIComponent(String(g.id))}`;
  open.textContent = "Open this matchup";
  const y = window.scrollY;
  const root = document.getElementById("learn");
  root.innerHTML = learnSections(g, a, h);
  learnMarks(root);
  root.querySelectorAll(".print-btn-single").forEach(b => b.remove());
  if (keepScroll) window.scrollTo(0, y);
}

/* ---------- helpers ---------- */
const nm = t => escapeHtml(t.team);
const poss = t => escapeHtml(t.team) + (/s$/i.test(t.team) ? "\u2019" : "\u2019s");
const sgn = v => (v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v);
function teamGames(t) { return t.record.w + t.record.l + t.record.t; }
function plural(n, word) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
function wlpText(r) { return `${r.w}-${r.l}${r.p ? "-" + r.p : ""}`; }

// wide: the excerpt takes the full width and the notes sit underneath in columns
function section(n, title, sub, excerpt, notes, extra, wide) {
  return `<section class="learn-sec" id="learn-${n}">
    <div class="learn-head"><span class="learn-num">${n}</span><h3>${title}</h3><span class="learn-sub">${sub}</span></div>
    <div class="learn-row${wide ? " wide" : ""}">
      <div class="learn-ex">${excerpt}</div>
      <ol class="learn-notes">${notes.filter(Boolean).map((x, i) => `<li><span class="lm">${i + 1}</span><div><b>${x[0]}</b><p>${x[1]}</p></div></li>`).join("")}</ol>
    </div>
    ${extra || ""}
  </section>`;
}

// Numbered markers on the real components: [section, selector, number]
const MARKS = [
  [1, ".hero-line", 1], [1, ".hero-total", 2], [1, ".hero-implied", 3], [1, ".hero-move", 4],
  [1, ".hero-team .hero-rec", 5], [1, ".hero-facts", 6],
  [2, ".edge-panel .tape-h .num", 1], [2, ".edge-panel .tape:not(.tape-h) .lbl", 2], [2, ".edge-panel .tape-h .num:last-child", 3],
  [2, ".edge-panel + .edge-panel h4", 4],
  [3, ".pace-panel th:nth-child(2)", 1], [3, ".pace-panel th:nth-child(3)", 2], [3, ".pace-sum", 3],
  [4, ".bet-chip:nth-child(1) .lbl", 1], [4, ".bet-chip:nth-child(2) .lbl", 2], [4, ".bet-chip:nth-child(4) .lbl", 3], [4, ".bet-chip:nth-child(6) .lbl", 4],
  [5, ".rating-badges", 1], [5, ".gauges", 2], [5, ".mini-stats", 3],
  [6, ".learn-table th", 1], [6, ".learn-tip .ptip-head", 2], [6, ".learn-prop", 3],
  [7, ".usage-block th:nth-child(2)", 1], [7, ".usage-block th:nth-child(3)", 2], [7, ".usage-carries .lbl", 3],
  [8, ".defpos-block h4", 1], [8, ".defpos-stats .item .lbl", 2],
];
function learnMarks(root) {
  for (const [s, sel, n] of MARKS) {
    const el = root.querySelector(`#learn-${s} .learn-ex ${sel}`);
    if (el) el.insertAdjacentHTML("beforeend", ` <span class="lm lm-in" aria-hidden="true">${n}</span>`);
  }
}

// Every Head to Head row in one direction, with ranks and which side has the edge.
function edgeList(off, def) {
  const out = [];
  for (const row of edgeRows()) {
    if (typeof row === "string") continue;
    const [label, offGet, defGet, offHi, defHi, fmt] = row;
    const o = offGet(off), d = defGet(def);
    if (o == null || d == null) continue;
    const or = leagueRank(offGet, o, offHi), dr = leagueRank(defGet, d, defHi);
    const diff = dr - or;
    out.push({ label, o: fmt ? fmt(o) : o, d: fmt ? fmt(d) : d, or, dr, gap: Math.abs(diff),
               side: diff >= EDGE_GAP ? off : diff <= -EDGE_GAP ? def : null, off, def });
  }
  return out;
}

/* ---------- the sections ---------- */
function learnSections(g, a, h) {
  const ln = lineFor(g), it = impliedTotals(g);
  const fav = ln && ln.fav ? TM(g[ln.fav]) : null, dog = fav ? (fav === a ? h : a) : null;
  const parts = [];

  // 1 Game header
  let spreadNote, totalNote, impNote;
  if (!ln) {
    spreadNote = ["The spread", "No line is posted for this game yet. Once it is, the favorite and the number of points it gives show here."];
  } else if (ln.pick) {
    spreadNote = ["The spread: pick'em", "Neither team is favored, so a bet on either side just needs that team to win."];
  } else if (fav) {
    const s = ln.spread, whole = Number.isInteger(s);
    spreadNote = [`The spread: ${escapeHtml(fav.abbr)} ${MINUS}${s}`, whole
      ? `${nm(fav)} is favored by ${s}. A bet on it wins if it wins by ${s + 1} or more; a ${s}-point win is a push (the bet is refunded). ${nm(dog)} covers by losing by ${s - 1} or fewer, or by winning.`
      : `${nm(fav)} is favored by ${s}. A bet on it wins if it wins by ${Math.ceil(s)} or more. ${nm(dog)} covers by losing by ${Math.floor(s)} or fewer, or by winning. The half point means there can't be a push.`];
  }
  if (ln && ln.total != null) {
    const T = ln.total, whole = Number.isInteger(T);
    totalNote = [`The total: ${T}`, whole
      ? `The over/under on combined points. ${T + 1} or more is over, ${T - 1} or fewer is under, and exactly ${T} is a push.`
      : `The over/under on combined points. ${Math.ceil(T)} or more is over, ${Math.floor(T)} or fewer is under.`];
  }
  if (it && fav && ln.total != null) {
    const fi = fav === a ? it.away : it.home, di = fav === a ? it.home : it.away;
    impNote = ["Implied team totals", `What the spread and total add up to for each team: (${ln.total} + ${ln.spread}) ÷ 2 = ${fi} for ${nm(fav)}, and ${ln.total} ${MINUS} ${fi} = ${di} for ${nm(dog)}.`];
  } else if (it) {
    impNote = ["Implied team totals", `With no favorite, each team's share of the total is half: ${it.away} apiece.`];
  }
  const o = g.lineOpen;
  let moveNote = ["Line move", "How far the spread and total have moved since this week's first update. It appears once the line has moved at least half a point, until kickoff."];
  if (o && !g.completed && (g.spread != null || g.total != null)) {
    const cur = g.spread;   // the weekly consensus, home side: negative = home favored (same as lineOpen)
    const bits = [];
    if (cur != null && o.spread != null && Math.abs(cur - o.spread) >= 0.5) {
      const toward = cur < o.spread ? h : a;
      bits.push(`the spread has moved ${Math.abs(cur - o.spread)} point${Math.abs(cur - o.spread) === 1 ? "" : "s"} toward ${nm(toward)} (it opened ${escapeHtml(spreadLabel(g, o.spread))})`);
    }
    if (g.total != null && o.total != null && Math.abs(g.total - o.total) >= 0.5) {
      bits.push(`the total has gone ${g.total > o.total ? "up" : "down"} ${Math.abs(g.total - o.total)} from ${o.total}`);
    }
    moveNote = ["Line move", bits.length
      ? `Comparing the weekly consensus line now with this week's first update, ${bits.join(", and ")}. Moves usually follow injury news or heavy betting on one side.`
      : "The line hasn't moved since this week's first update, so the market's view of this game has held steady."];
  }
  const srsNote = ["Record, SRS and quarterback", `SRS is how many points per game better (+) or worse (${MINUS}) a team is than an average team, adjusted for its schedule. ${nm(a)} is at ${dispNum(String(a.record.srs))} and ${nm(h)} at ${dispNum(String(h.record.srs))}. The quarterback is each team's most recent starter, and a number before a team's name is its AP rank.`];
  const factNote = ["Game facts", `Kickoff in your time zone, the stadium, the forecast for outdoor games and the TV channel${g.conferenceGame ? ", plus a tag because it's a conference game" : ""}. Neutral-site games say so here too.`];
  parts.push(section(1, "Game header", "Who's playing, where, and what the betting market expects",
    renderHero(g, a, h), [spreadNote, totalNote, impNote, moveNote, srsNote, factNote], "", true));

  // 2 Head to head
  const both = edgeList(a, h).concat(edgeList(h, a));
  const best = both.filter(r => r.side).sort((x, y) => y.gap - x.gap)[0];
  const edges = t => both.filter(r => r.side === t).length;
  const ea = edges(a), eh = edges(h);
  const exNote = best
    ? ["The edge", `The edge goes to whichever side ranks at least ${EDGE_GAP} spots better, and its bar turns that team's color. The biggest gap here: ${escapeHtml(best.label)}, where ${poss(best.off)} offense ranks #${best.or} and ${poss(best.def)} defense #${best.dr}, a ${best.gap}-spot gap, so the edge is ${escapeHtml(best.side.abbr)}.`]
    : ["The edge", `The edge goes to whichever side ranks at least ${EDGE_GAP} spots better, and its bar turns that team's color. Every row in this game is within ${EDGE_GAP - 1} spots, so it's Even across the board.`];
  const glossary = [
    ["EPA / play", "Expected points added: how much each play changed a team's expected score, averaged. Above 0 is good for an offense."],
    ["Success %", "Share of plays with positive EPA. Steadier than EPA, which a few big plays can swing."],
    ["Rush Yds / Att", "Yards per carry gained by the offense, or allowed by the defense. College box scores count sacks as runs."],
    ["Pts / trip (40)", "Points per drive that reached the opponent's 40, at 7 for a touchdown and 3 for a field goal. The college measure of finishing drives."],
    ["3rd down %", "Share of third downs converted by the offense, or allowed by the defense."],
    ["Explosive %", "Passes of 20+ yards and runs of 10+, per play."],
    ["Sack and havoc rate", "Sacks per pass play, and havoc plays (tackles for loss, sacks, interceptions, fumbles, pass breakups) per play. For an offense lower is better; for a defense higher."],
    ["INT / G", "Interceptions thrown by the offense against interceptions made by the defense."],
  ];
  parts.push(section(2, "Head to head", "Each offense against the defense it faces, stat by stat",
    `<div class="edge-grid learn-edge">${edgePanel(a, h)}${edgePanel(h, a)}</div>`,
    [["Number and rank", `Each cell is the season value and its rank among all ${Object.keys(DATA.teams).length} FBS teams. For an offense #1 is best; for a defense #1 is the stingiest, or for sacks and havoc plays the most disruptive.`],
     ["The bars", "Each side's bar grows from the middle line with its rank: longer means better. Grey bars mean neither side has a clear edge on that row."],
     exNote,
     ["Read both panels", `The second panel turns the matchup around. Across both, ${nm(a)} holds ${plural(ea, "edge")} and ${nm(h)} holds ${eh}${ea === eh ? ", so neither side has a clear statistical advantage" : `; the team that wins more rows in both panels is the stronger side of the matchup on paper`}.`]],
    `<div class="learn-gloss">${glossary.map(([t, d]) => `<div><b>${t}</b><span>${d}</span></div>`).join("")}</div>`, true));

  // 3 Pace
  if (a.pace && h.pace && a.pace.ppg && h.pace.ppg) {
    const teams = Object.values(DATA.teams).filter(t => t.pace && t.pace.ppg);
    const lg = 2 * teams.reduce((s, t) => s + t.pace.ppg.v, 0) / teams.length;
    const comb = a.pace.ppg.v + h.pace.ppg.v, diff = comb - lg;
    const fast = [a, h].map(t => t.pace.ppg.rank <= 15 ? `${nm(t)} runs one of the most plays in the country (#${t.pace.ppg.rank})` : t.pace.ppg.rank >= teams.length - 15 ? `${nm(t)} runs one of the fewest (#${t.pace.ppg.rank})` : null).filter(Boolean);
    const passy = [a, h].filter(t => t.pace.edp).sort((x, y) => y.pace.edp.v - x.pace.edp.v)[0];
    parts.push(section(3, "Pace and tendency", "How many plays to expect, and how pass-happy each team is",
      pacePanel(a, h),
      [["Plays per game", `Runs and passes per game. More plays means more chances for yards and points.${fast.length ? " " + fast.join("; ") + "." : ""}`],
       ["Early-down pass rate", `Share of first- and second-down plays that were passes. Higher means pass-first.${passy ? ` ${nm(passy)} throws more on early downs (${passy.pace.edp.v.toFixed(1)}%).` : ""}`],
       ["Combined plays", `Both teams' plays per game added together: ${comb.toFixed(1)} against an FBS average of ${lg.toFixed(1)}. ${Math.abs(diff) < 2 ? "That's about average, so pace doesn't tilt this game either way." : diff > 0 ? `About ${Math.round(diff)} more plays than average, a lean toward a higher-scoring game and more volume for props.` : `About ${Math.round(-diff)} fewer plays than average, a lean toward a lower-scoring game.`}`]]));
  }

  // 4 Betting trends
  if (a.betting && h.betting) {
    const b = a.betting.ats, n = b.w + b.l + b.p;
    parts.push(section(4, "Betting trends", "How each team has done against the line this season",
      `<div class="edge-grid">${bettingPanel(a)}${bettingPanel(h)}</div>`,
      [["Against the spread (ATS)", `Wins, losses and pushes against each game's closing spread. ${nm(a)} is ${wlpText(b)}: it covered ${plural(b.w, "time")}, failed to ${b.l}${b.p ? `, and landed exactly on the number ${plural(b.p, "time")}` : ""}.`],
       ["As favorite or underdog", "The same record split by whether the team was giving points or getting them."],
       ["Home and away", "Split by where the game was played; neutral-site games are left out."],
       ["Over/under", `How often the team's games went over the closing total. ${n} games is a small sample, so treat these as context rather than a system.`]], "", true));
  }

  // 5 to 8: pieces of the away team's card
  const tmp = document.createElement("div");
  tmp.innerHTML = renderTeamCard(a);
  const card = tmp.firstElementChild;
  const style = card.getAttribute("style") || "";
  const piece = sel => { const el = card.querySelector(sel); return el ? el.outerHTML : ""; };
  const sos = a.record.sos;
  parts.push(section(5, "Team card", `Ratings and season averages, shown here for ${nm(a)}`,
    `<div class="team-card learn-card" style="${style}">${piece(".team-card-header")}${piece(".stat-columns")}</div>`,
    [["Ratings badges", `SRS rates a team by scoring margin adjusted for its opponents; OSRS and DSRS split that into offense and defense. SoS is how good the opponents were. ${poss(a)} SoS of ${dispNum(String(sos))} means ${sos < -1 ? "an easier schedule than average, so its numbers may run a little high" : sos > 1 ? "a tougher schedule than average, so its numbers may undersell it" : "a roughly average schedule"}.`],
     ["Gauges and ranks", "Yards per game with the league rank: offense #1 gains the most, defense #1 allows the fewest. Run game and Pass game in the middle show both ranks side by side."],
     ["Against the league average", "Touchdowns and points per game, with the league average under each, so you can see at a glance whether a team is above or below the norm."]]));

  // 6 Player tables and game logs
  const r = (a.receiving || []).find(x => x.log && DATA.gameLogs[x.log]);
  if (r) {
    const log = DATA.gameLogs[r.log], missed = teamGames(a) - log.length;
    const line = Math.max(0.5, Math.floor(r.ydsG) - 0.5);
    const over = log.filter(e => (e.recYds || 0) > line).length;
    parts.push(section(6, "Player tables and game logs", "Per-game averages and every game a player has played",
      `<div class="learn-split">
        <div class="team-card learn-card" style="${style}">${playerTable("Receiving", a.receiving.slice(0, 3), [["Player", "player", "text"], ["Yds/G", "ydsG", "num"], ["TD", "td", "num"], ["Y/R", "yr", "num"], ["Rec/G", "rec", "num"]]).replace('class="table-block"', 'class="table-block learn-table"')}</div>
        <div class="learn-tip">${tooltipHtml(escapeHtml(r.player), "receiving", log)}
          <p class="learn-prop">Rec yds line ${line}: <b>over in ${over} of ${log.length} games</b></p></div>
      </div>`,
      [["Per-game averages", `Yards, touchdowns and catches per game the player actually played for this team. Regulars (half the team's games or more) are listed first.${missed > 0 ? ` ${escapeHtml(r.player)} has missed ${plural(missed, "game")}, so his averages cover ${log.length}.` : ""}`],
       ["Game log", "Hover a player's name for his game-by-game line (shown here); click it to open the full log. Try it on the names in this table."],
       ["Prop check", `In the full log you can type any line and it counts the games he went over it, and shows what his next opponent allows. At ${line} receiving yards, ${escapeHtml(r.player)} went over in ${over} of ${log.length} games.`]]));
  }

  // 7 Usage
  const u = a.usage;
  if (u && u.targets && u.targets.length) {
    const up = u.targets.filter(x => x.ts3 - x.ts >= 2).map(x => escapeHtml(x.player));
    const down = u.targets.filter(x => x.ts3 - x.ts <= -2).map(x => escapeHtml(x.player));
    const top = u.targets[0];
    parts.push(section(7, "Usage", "Who gets the ball, and whether that's changing",
      `<div class="team-card learn-card" style="${style}">${usageBlock(a)}</div>`,
      [["Target share", `His share of the team's targets, counted from play-by-play. Volume drives receiving props more than talent alone: ${escapeHtml(top.player)} gets ${top.ts.toFixed(1)}% of ${poss(a)} targets.`],
       ["Last 3", `Target share over the last three games, with an arrow when it moved 2 points or more.${up.length ? ` Trending up: ${up.join(", ")}.` : ""}${down.length ? ` Trending down: ${down.join(", ")}.` : ""}${!up.length && !down.length ? " No one's role has shifted much lately." : ""}`],
       ["Carry share", "Each back's share of the team's carries, quarterback runs included. College data has no snap counts, so there's no Snap % column."]]));
  }

  // 8 Defense vs position
  const dv = a.defVsPosition, names = { rb: "running backs", recRb: "pass-catching backs", te: "tight ends", wr: "wide receivers" };
  const ks = Object.keys(names).filter(k => dv[k]);
  if (ks.length) {
    const bestK = ks.slice().sort((x, y) => dv[x].rank - dv[y].rank)[0], worstK = ks.slice().sort((x, y) => dv[y].rank - dv[x].rank)[0];
    parts.push(section(8, "Defense vs position", "What this defense gives up to each kind of player",
      `<div class="team-card learn-card" style="${style}">${piece(".defpos-row")}</div>`,
      [["What it measures", "Yards and touchdowns per game that opposing players at each position gained against this defense."],
       ["Rank", `#1 allows the fewest. ${nm(a)} ranks #${dv[bestK].rank} against ${names[bestK]} but #${dv[worstK].rank} against ${names[worstK]}.`],
       ["Where it's used", "Weekly Edges compares these with each player's average to find favorable prop matchups."]], "", true));
  }

  // Put it together
  const sum = [];
  const lead = ea > eh ? a : eh > ea ? h : null, hi = Math.max(ea, eh), lo = Math.min(ea, eh);
  if (fav) {
    sum.push(`${nm(fav)} is favored by ${ln.spread}.`);
    if (lead) sum.push(lead === fav ? `It also holds more of the Head to Head edges, ${hi} to ${lo}.` : `${nm(lead)} holds more of the Head to Head edges, though, ${hi} to ${lo}.`);
    else sum.push(`The Head to Head edges are split ${ea} to ${eh}.`);
  } else if (ln && ln.pick) {
    sum.push("The market sees this game as a coin flip.");
  }
  const under = fav ? dog : null;
  if (under) {
    const ub = both.filter(x => x.side === under).sort((x, y) => y.gap - x.gap)[0];
    if (ub) sum.push(`${poss(under)} best edge is ${escapeHtml(ub.label)} (#${under === ub.off ? ub.or : ub.dr} against #${under === ub.off ? ub.dr : ub.or}).`);
  }
  const m = lineMove(g);
  if (m && m.spread && o && g.spread != null) {
    const cur = g.spread;
    sum.push(`The line has moved ${Math.abs(cur - o.spread)} point${Math.abs(cur - o.spread) === 1 ? "" : "s"} toward ${nm(cur < o.spread ? h : a)} since the week's first update.`);
  }
  const hurt = [];
  for (const t of [a, h]) for (const tab of ["passing", "rushing", "receiving"]) for (const p of t[tab] || []) {
    if (p.inj && (["O", "D", "Q"].includes(p.inj.s) || (p.pos === "QB" && p.inj.s === "DNP")) && !hurt.some(x => x.p === p.player))
      hurt.push({ p: p.player, t, s: p.inj.s, what: (p.inj.note || "").split(" · ")[0].toLowerCase() });
  }
  if (hurt.length) sum.push("On the injury report: " + hurt.slice(0, 3).map(x => `${escapeHtml(x.p)} (${escapeHtml(x.t.abbr)}, ${x.s === "DNP" ? "missed practice" : { O: "out", D: "doubtful", Q: "questionable" }[x.s]}${x.what ? ", " + escapeHtml(x.what) : ""})`).join("; ") + ".");
  parts.push(`<section class="learn-sum">
    <div><b>Put it together</b><p>${sum.join(" ") || "Open the matchup to see every number for this game."}</p></div>
    <a class="learn-btn" href="matchup.html?game=${encodeURIComponent(String(g.id))}">Open ${escapeHtml(a.abbr)} ${g.neutral ? "vs" : "at"} ${escapeHtml(h.abbr)}</a>
  </section>`);
  return parts.join("");
}
