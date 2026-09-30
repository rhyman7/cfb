let DATA = null;

// Which page this is: "week" (index.html), "matchup" (matchup.html) or "dashboard"
const PAGE = document.body.dataset.page || "dashboard";
const teamCards = document.getElementById("teamCards");

init();

async function init() {
  try {
    const res = await fetch("data/data.json", { cache: "no-store" });
    DATA = await res.json();
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<div class="empty-note">Couldn't load data/data.json. Run scripts/build_data.py first.</div>`;
    return;
  }
  setMeta();
  if (PAGE === "week") initWeek();
  else if (PAGE === "matchup") initMatchup();
  else if (PAGE === "printall") initPrintAll();
  else initDashboard();
}

function setMeta() {
  const lastUpdated = document.getElementById("lastUpdated");
  const gen = new Date(DATA.generatedAt);
  if (lastUpdated) {
    lastUpdated.textContent = "Data as of " + gen.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric"
    }) + " " + gen.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
      (DATA.throughWeek ? " · stats through Week " + DATA.throughWeek : "");
  }
  const src = document.getElementById("sourceNote");
  if (src && DATA.source) {
    src.textContent = "Source: " + DATA.source + "." +
      (DATA.pollName ? " Rankings: " + DATA.pollName + "." : "");
  }
}

// Live game state from ESPN, filled in by live.js: { [gameId]: {state, detail, away, home, ...} }
const LIVE = {};
function liveFor(g) { return LIVE[g.id] || null; }

function rankTag(rank) {
  return rank ? `<span class="ap-rank" title="${escapeHtml(DATA.pollName || "AP Top 25")}">#${rank}</span>` : "";
}

/* ---------------- Week slate (index.html) ---------------- */

function initWeek() {
  const games = DATA.weekGames || [];
  document.getElementById("weekTitle").textContent =
    DATA.currentWeek ? `Week ${DATA.currentWeek} Matchups` : "This Week's Matchups";
  document.getElementById("weekSub").textContent =
    `${games.length} game${games.length === 1 ? "" : "s"} · team stats through Week ${DATA.throughWeek}` +
    " · tap a game for the full matchup";

  const confSel = document.getElementById("confFilter");
  const confs = new Set();
  games.forEach(g => [g.away, g.home].forEach(s => s.conference && confs.add(s.conference)));
  confSel.innerHTML = `<option value="">All conferences</option>` +
    [...confs].sort().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  const rankedOnly = document.getElementById("rankedOnly");
  const search = document.getElementById("teamSearch");
  [confSel, rankedOnly, search].forEach(el => el.addEventListener("input", () => renderWeek(games)));
  renderWeek(games);
  if (typeof startLiveWeek === "function") startLiveWeek(games, () => renderWeek(games));
}

function renderWeek(games) {
  const conf = document.getElementById("confFilter").value;
  const ranked = document.getElementById("rankedOnly").checked;
  const q = document.getElementById("teamSearch").value.trim().toLowerCase();
  const list = document.getElementById("gameList");

  const shown = games.filter(g => {
    const sides = [g.away, g.home];
    if (conf && !sides.some(s => s.conference === conf)) return false;
    if (ranked && !sides.some(s => s.rank)) return false;
    if (q && !sides.some(s => s.name.toLowerCase().includes(q))) return false;
    return true;
  });

  updatePrintAll(shown, games.length);
  if (!shown.length) {
    list.innerHTML = `<div class="empty-note">No games match those filters.</div>`;
    return;
  }

  // live games get their own group at the top
  const groups = [];
  const live = shown.filter(g => (liveFor(g) || {}).state === "in");
  if (live.length) groups.push({ label: "Live now", live: true, games: live });
  shown.filter(g => !live.includes(g)).forEach(g => {
    const d = new Date(g.start);
    const label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    let grp = groups[groups.length - 1];
    if (!grp || grp.live || grp.label !== label) groups.push(grp = { label, games: [] });
    grp.games.push(g);
  });

  list.innerHTML = groups.map(grp => `
    <section class="day-group">
      <h2 class="day-label${grp.live ? " live" : ""}">${grp.live ? '<span class="live-dot"></span>' : ""}${escapeHtml(grp.label)} <span class="day-count">${grp.games.length}</span></h2>
      <div class="game-grid">${grp.games.map(gameCard).join("")}</div>
    </section>`).join("");
}

// "Print all" prints whatever the filters are showing, in kickoff order.
let PRINT_IDS = [];
function updatePrintAll(shown, total) {
  const btn = document.getElementById("printAllBtn");
  if (!btn) return;
  PRINT_IDS = shown.map(g => g.id);
  btn.disabled = !shown.length;
  btn.textContent = shown.length === total ? `🖨 Print all (${total})` : `🖨 Print ${shown.length} shown`;
  if (!btn.dataset.wired) {
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      const all = (DATA.weekGames || []).length === PRINT_IDS.length;
      window.open("print.html" + (all ? "" : "?games=" + PRINT_IDS.join(",")), "_blank");
    });
  }
}

function kickoff(g) {
  const L = liveFor(g);
  if (L && L.state === "in") return L.detail || "Live";
  if (L && L.state === "post") return L.detail || "Final";
  if (g.completed) return "Final";
  if (g.timeTbd) return "TBD";
  return new Date(g.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function gameSide(s, g, other, sideKey) {
  const t = s.key && DATA.teams[s.key];
  const srs = t ? `<span class="gs-srs" title="SRS">SRS ${t.record.srs > 0 ? "+" : ""}${t.record.srs}</span>` : "";
  const L = liveFor(g);
  const otherKey = sideKey === "away" ? "home" : "away";
  let score = g.completed ? s.score : null, otherScore = g.completed ? other.score : null, done = g.completed;
  if (L && (L.state === "in" || L.state === "post") && L[sideKey]) {
    score = L[sideKey].score; otherScore = L[otherKey] ? L[otherKey].score : null; done = L.state === "post";
  }
  const won = done && score != null && otherScore != null && score > otherScore;
  const poss = L && L.state === "in" && L.possession === sideKey ? `<span class="poss" title="Has the ball">●</span>` : "";
  return `<div class="gs-row${won ? " won" : ""}">
    <span class="gs-name">${rankTag(s.rank)}${escapeHtml(s.name)}${poss}</span>
    <span class="gs-rec">${escapeHtml(s.record)}${s.conference ? " · " + escapeHtml(s.conference) : ""}</span>
    ${score != null ? `<span class="gs-score">${score}</span>` : srs}
  </div>`;
}

function gameCard(g) {
  const note = g.note ? `<div class="game-note">${escapeHtml(g.note)}</div>` : "";
  const L = liveFor(g);
  const isLive = L && L.state === "in";
  const sit = isLive && L.downDistance ? `<div class="game-sit">${escapeHtml(L.downDistance)}</div>` : "";
  return `<a class="game-card${isLive ? " live" : ""}" href="matchup.html?game=${encodeURIComponent(g.id)}">
    <div class="game-meta">
      <span class="game-time">${isLive ? '<span class="live-badge">Live</span> ' : ""}${escapeHtml(kickoff(g))}</span>
      ${g.tv ? `<span class="game-tv">${escapeHtml(g.tv)}</span>` : ""}
    </div>
    ${gameSide(g.away, g, g.home, "away")}
    <div class="gs-at">${g.neutral ? "vs" : "@"}</div>
    ${gameSide(g.home, g, g.away, "home")}
    ${sit}
    <div class="game-venue">${escapeHtml([g.venue, g.city].filter(Boolean).join(" · "))}${g.neutral ? " (neutral)" : ""}</div>
    ${note}
  </a>`;
}

/* ---------------- Single matchup (matchup.html) ---------------- */

function initMatchup() {
  const params = new URLSearchParams(location.search);
  const id = params.get("game");
  const g = (DATA.weekGames || []).find(x => x.id === id);
  const head = document.getElementById("matchupHeader");
  document.getElementById("printBothBtn").addEventListener("click", () => window.print());

  if (!g) {
    head.innerHTML = `<div class="empty-note">That game isn't on this week's schedule anymore. <a href="index.html">See this week's matchups</a> or <a href="dashboard.html">compare any two teams</a>.</div>`;
    teamCards.innerHTML = "";
    return;
  }

  const tag = s => `${s.rank ? "#" + s.rank + " " : ""}${s.abbr || s.name}`;
  document.title = `${tag(g.away)} ${g.neutral ? "vs" : "@"} ${tag(g.home)} · CFB Matchup Dashboard`;

  const parts = renderMatchupParts(g);
  head.innerHTML = parts.head;
  if (typeof startLiveMatchup === "function") startLiveMatchup(g);
  document.getElementById("edges").innerHTML = parts.edges;
  teamCards.innerHTML = parts.cards;
}

// Header, Head to Head and team cards for one game (used by the matchup page and Print all).
function renderMatchupParts(g) {
  const away = g.away.key ? DATA.teams[g.away.key] : null;
  const home = g.home.key ? DATA.teams[g.home.key] : null;
  let edges;
  if (away && home) {
    const n = Object.keys(DATA.teams).length;
    const gap = edgeGap();
    edges = `
      <h3 class="section-title">Head to Head</h3>
      <div class="edge-grid">
        ${edgePanel(away, home)}
        ${edgePanel(home, away)}
      </div>
      <p class="edge-key">Ranks are out of ${n} FBS teams. The edge goes to whichever side ranks at least ${gap} spots better; INT compares interceptions thrown by the offense with interceptions made by the defense.</p>`;
  } else {
    const other = away ? g.home : g.away;
    edges = `<h3 class="section-title">Head to Head</h3>
      <div class="empty-note">No head-to-head comparison: ${escapeHtml(other.name)} isn't an FBS team, so its stats aren't tracked.</div>`;
  }
  const cards = `<h3 class="section-title">Full Team Stats</h3>` + [g.away, g.home]
    .map(s => s.key && DATA.teams[s.key] ? renderTeamCard(DATA.teams[s.key]) : nonFbsCard(s)).join("");
  return { head: renderHero(g, away, home), edges, cards };
}

/* ---------------- Print all (print.html) ---------------- */

function initPrintAll() {
  const all = DATA.weekGames || [];
  const ids = (new URLSearchParams(location.search).get("games") || "").split(",").filter(Boolean);
  const games = ids.length ? ids.map(id => all.find(g => g.id === id)).filter(Boolean) : all;
  const wrap = document.getElementById("printAll");
  const status = document.getElementById("printStatus");
  document.title = `Week ${DATA.currentWeek} matchups (${games.length}) · CFB Matchup Dashboard`;

  if (!games.length) {
    status.textContent = "No games to print.";
    return;
  }
  wrap.innerHTML = games.map(g => {
    const p = renderMatchupParts(g);
    return `<section class="print-matchup">
      <div class="matchup-header m-head">${p.head}</div>
      <div class="m-edges">${p.edges}</div>
      <div class="m-cards">${p.cards}</div>
    </section>`;
  }).join("");
  // per-team Print buttons don't belong on this page
  wrap.querySelectorAll(".print-btn-single").forEach(b => b.remove());

  const n = games.length;
  status.textContent = `${n} matchup${n === 1 ? "" : "s"} ready · ${n} landscape page${n === 1 ? "" : "s"}`;
  const btn = document.getElementById("printAllBtn");
  btn.disabled = false;
  btn.addEventListener("click", () => window.print());
  // open the print dialog automatically once everything has laid out
  if (new URLSearchParams(location.search).get("auto") !== "0") {
    requestAnimationFrame(() => setTimeout(() => window.print(), 400));
  }
}

// Spread is from the home team's side: negative = home favored.
function fmtSpread(g) {
  if (g.spread === null || g.spread === undefined) return null;
  if (g.spread === 0) return "Pick'em";
  const fav = g.spread < 0 ? g.home : g.away;
  return `${fav.abbr || fav.name} -${Math.abs(g.spread)}`;
}

function renderHero(g, away, home) {
  const final = g.completed && g.away.score != null && g.home.score != null;
  const d = new Date(g.start);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = final ? "Final" : g.timeTbd ? "Time TBD"
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const roof = g.indoor === true ? "Indoors" : g.indoor === false ? "Outdoors" : null;
  const info = [
    `${day} · ${time}`,
    [g.venue, g.city, roof].filter(Boolean).join(" · "),
    g.neutral ? "Neutral site" : null,
  ].filter(Boolean);
  const line = [
    fmtSpread(g) ? `Spread: ${fmtSpread(g)}` : null,
    g.total ? `O/U ${g.total}` : null,
    g.conferenceGame ? "Conference game" : null,
  ].filter(Boolean);

  return `
  <div class="mh-week">Week ${g.week}${g.note ? " · " + escapeHtml(g.note) : ""}</div>
  <div class="game-hero">
    ${heroTeam(g.away, away, g.neutral ? "Team 1" : "Away", final ? g.away.score : null, "away")}
    <div class="hero-mid">
      <div class="hero-live" id="heroLive" hidden></div>
      <div class="hero-at">${g.neutral ? "vs" : "@"}</div>
      ${info.map(i => `<div class="hero-info">${escapeHtml(i)}</div>`).join("")}
      ${line.length ? `<div class="hero-line">${escapeHtml(line.join(" · "))}</div>` : ""}
      ${g.tv ? `<div class="hero-info">TV: ${escapeHtml(g.tv)}</div>` : ""}
    </div>
    ${heroTeam(g.home, home, g.neutral ? "Team 2" : "Home", final ? g.home.score : null, "home")}
  </div>`;
}

function heroTeam(s, t, side, score, sideKey) {
  const srs = t ? `<div class="hero-srs">SRS <span class="${t.record.srs > 0 ? "pos" : t.record.srs < 0 ? "neg" : ""}">${t.record.srs}</span></div>` : "";
  return `
    <div class="hero-team" data-side="${sideKey}">
      <div class="hero-side">${side}</div>
      <div class="hero-score" hidden></div>
      <div class="hero-name">${rankTag(s.rank)}${escapeHtml(s.name)}</div>
      <div class="hero-rec">${escapeHtml(s.record || "")}${s.conference ? " · " + escapeHtml(s.conference) : ""}${score !== null ? ` · <b>${score}</b>` : ""}</div>
      ${s.qb ? `<div class="hero-qb">QB: ${escapeHtml(s.qb)}</div>` : ""}
      ${srs}
    </div>`;
}

// The NFL site calls an edge at 6 of 32 spots; keep the same share of the FBS field.
function edgeGap() {
  return Math.max(1, Math.round(Object.keys(DATA.teams).length * 6 / 32));
}

// Rank a value among all FBS teams. higherIsBetter decides direction; ties share the lower rank.
function leagueRank(getter, value, higherIsBetter) {
  const all = Object.values(DATA.teams).map(getter);
  return 1 + all.filter(v => (higherIsBetter ? v > value : v < value)).length;
}

const EDGE_ROWS = [
  // label, offense getter, defense getter, offense higher-better, defense higher-better
  ["Points / G", t => t.offense.ppg, t => t.defense.papg, true, false],
  ["Rush Yds / G", t => t.offense.rushYdsG, t => t.defense.rushYdsG, true, false],
  ["Rush TD / G", t => t.offense.rushTdG, t => t.defense.rushTdG, true, false],
  ["Pass Yds / G", t => t.offense.passYdsG, t => t.defense.passYdsG, true, false],
  ["Pass TD / G", t => t.offense.passTdG, t => t.defense.passTdG, true, false],
  ["INT / G", t => t.offense.int, t => t.defense.int, false, true],
];

function edgePanel(offTeam, defTeam) {
  const gap = edgeGap();
  const rows = EDGE_ROWS.map(([label, offGet, defGet, offHi, defHi]) => {
    const ov = offGet(offTeam), dv = defGet(defTeam);
    const or = leagueRank(offGet, ov, offHi), dr = leagueRank(defGet, dv, defHi);
    const diff = dr - or;
    const edge = diff >= gap ? `<span class="edge-chip off">Offense</span>`
      : diff <= -gap ? `<span class="edge-chip def">Defense</span>`
      : `<span class="edge-chip even">Even</span>`;
    return `<tr>
      <td class="lbl">${label}</td>
      <td class="num"><b>${ov}</b> <span class="rk">#${or}</span></td>
      <td class="num"><b>${dv}</b> <span class="rk">#${dr}</span></td>
      <td class="edge">${edge}</td>
    </tr>`;
  }).join("");

  return `
  <div class="edge-panel">
    <h4><span class="off-txt">${escapeHtml(offTeam.abbr)} offense</span> vs <span class="def-txt">${escapeHtml(defTeam.abbr)} defense</span></h4>
    <table class="edge-table">
      <thead><tr><th></th><th class="num">${escapeHtml(offTeam.abbr)} O</th><th class="num">${escapeHtml(defTeam.abbr)} D</th><th class="num">Edge</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function nonFbsCard(s) {
  return `<div class="team-card" data-team="${escapeHtml(s.name)}">
    <div class="team-card-header">
      <div class="team-name-block">
        <h2>${escapeHtml(s.name)}</h2>
        <div class="record"><b>${escapeHtml(s.record || "")}</b> <span class="conf">${escapeHtml(s.conference || "FCS")}</span></div>
      </div>
    </div>
    <div class="empty-note">Stats are only tracked for FBS teams, so there's no breakdown for ${escapeHtml(s.name)}.</div>
  </div>`;
}

/* ---------------- Compare any two teams (dashboard.html) ---------------- */

function initDashboard() {
  const team1Select = document.getElementById("team1Select");
  const team2Select = document.getElementById("team2Select");
  populateSelect(team1Select, DATA.teamNames);
  populateSelect(team2Select, DATA.teamNames);

  const params = new URLSearchParams(location.search);
  const saved1 = params.get("team1") || localStorage.getItem("cfb_team1");
  const saved2 = params.get("team2") || localStorage.getItem("cfb_team2");
  // default matchup: the two highest-rated teams by SRS
  const bySrs = DATA.teamNames.slice().sort((a, b) => DATA.teams[b].record.srs - DATA.teams[a].record.srs);
  team1Select.value = saved1 && DATA.teams[saved1] ? saved1 : bySrs[0];
  team2Select.value = saved2 && DATA.teams[saved2] ? saved2 : bySrs[1];

  const render = () => {
    const t1 = team1Select.value, t2 = team2Select.value;
    try { localStorage.setItem("cfb_team1", t1); localStorage.setItem("cfb_team2", t2); } catch (e) {}
    teamCards.innerHTML = [t1, t2].map(name => renderTeamCard(DATA.teams[name])).join("");
  };
  team1Select.addEventListener("change", render);
  team2Select.addEventListener("change", render);
  document.getElementById("printBothBtn").addEventListener("click", () => window.print());
  render();
}

function populateSelect(select, names) {
  const byConf = {};
  names.forEach(n => {
    const c = (DATA.teams[n] && DATA.teams[n].conference) || "Other";
    (byConf[c] = byConf[c] || []).push(n);
  });
  const opt = n => {
    const r = DATA.teams[n] && DATA.teams[n].apRank;
    return `<option value="${escapeHtml(n)}">${r ? "#" + r + " " : ""}${escapeHtml(n)}</option>`;
  };
  const confs = Object.keys(byConf).sort().map(c =>
    `<optgroup label="${escapeHtml(c)}">${byConf[c].map(opt).join("")}</optgroup>`).join("");
  select.innerHTML = confs;
}

function renderTeamCard(t) {
  if (!t) return "";
  const avg = DATA.leagueAverage;
  const gr = DATA.gaugeRanges;

  return `
  <div class="team-card" data-team="${escapeHtml(t.team)}">
    <div class="team-card-header">
      <div class="team-name-block">
        <h2>${rankTag(t.apRank)}${escapeHtml(t.team)}</h2>
        <div class="record"><b>${t.record.w}-${t.record.l}${t.record.t ? "-" + t.record.t : ""}</b>${t.conference ? ` <span class="conf">${escapeHtml(t.conference)}</span>` : ""}</div>
      </div>
      <div class="rating-badges">
        ${badge("SoS", t.record.sos)}
        ${badge("OSRS", t.record.osrs)}
        ${badge("DSRS", t.record.dsrs)}
        ${badge("SRS", t.record.srs)}
      </div>
      <button class="print-btn print-btn-single no-print" type="button" onclick="printOneTeam('${escapeHtml(t.team).replace(/'/g, "\\'")}')">🖨 Print</button>
    </div>

    <div class="stat-columns">
      <div class="stat-col offense">
        <h3>Offense</h3>
        <div class="gauges">
          ${gaugeBlock("Rush Yds/G", t.offense.rushYdsG, gr.offRushYdsG, t.offense.rushYdsGRank, "var(--off)")}
          ${gaugeBlock("Pass Yds/G", t.offense.passYdsG, gr.offPassYdsG, t.offense.passYdsGRank, "var(--off)")}
        </div>
        <div class="mini-stats">
          ${miniStat("Rush TD/G", t.offense.rushTdG, avg.rushTdG)}
          ${miniStat("Pass TD/G", t.offense.passTdG, avg.passTdG)}
          ${miniStat("PPG", t.offense.ppg, avg.ppg)}
        </div>
      </div>

      <div class="center-col">
        <div class="rank-compare">
          <div class="rank-pill off">
            <span class="lbl">Off Rush Rk</span>
            <span class="val">${fmtRank(t.offense.rushYdsGRank)}</span>
          </div>
          <span class="rank-arrow">vs</span>
          <div class="rank-pill def">
            <span class="lbl">Def Rush Rk</span>
            <span class="val">${fmtRank(t.defense.rushYdsGRank)}</span>
          </div>
        </div>
        <div class="rank-compare">
          <div class="rank-pill off">
            <span class="lbl">Off Pass Rk</span>
            <span class="val">${fmtRank(t.offense.passYdsGRank)}</span>
          </div>
          <span class="rank-arrow">vs</span>
          <div class="rank-pill def">
            <span class="lbl">Def Pass Rk</span>
            <span class="val">${fmtRank(t.defense.passYdsGRank)}</span>
          </div>
        </div>
        <div class="pass-rank-block">
          <div class="lbl">League Avg (Rush TD/G · Pass TD/G · PPG)</div>
          <div class="pass-rank-row">${avg.rushTdG} · ${avg.passTdG} · ${avg.ppg}</div>
        </div>
      </div>

      <div class="stat-col defense">
        <h3>Defense</h3>
        <div class="gauges">
          ${gaugeBlock("Rush Yds/G", t.defense.rushYdsG, gr.defRushYdsG, t.defense.rushYdsGRank, "var(--def)")}
          ${gaugeBlock("Pass Yds/G", t.defense.passYdsG, gr.defPassYdsG, t.defense.passYdsGRank, "var(--def)")}
        </div>
        <div class="mini-stats">
          ${miniStat("Rush TD/G", t.defense.rushTdG, avg.rushTdG)}
          ${miniStat("Pass TD/G", t.defense.passTdG, avg.passTdG)}
          ${miniStat("PA/G", t.defense.papg, avg.ppg)}
        </div>
      </div>
    </div>

    <div class="tables-row">
      ${playerTable("Passing", t.passing, [
        ["Player", "player", "text"],
        ["Yds/G", "ydsG", "num"],
        ["TD", "td", "num"],
        ["Int", "int", "num"],
      ])}
      ${playerTable("Rushing", t.rushing, [
        ["Player", "player", "text"],
        ["Yds/G", "ydsG", "num"],
        ["TD", "td", "num"],
        ["Y/A", "ya", "num"],
        ["A/G", "ag", "num"],
      ])}
      ${playerTable("Receiving", t.receiving, [
        ["Player", "player", "text"],
        ["Yds/G", "ydsG", "num"],
        ["TD", "td", "num"],
        ["Y/R", "yr", "num"],
        ["Rec/G", "rec", "num"],
      ])}
    </div>

    <div class="defpos-row">
      ${defPosBlock("Def vs RB", t.defVsPosition.rb)}
      ${defPosBlock("Def vs Rec-RB", t.defVsPosition.recRb)}
      ${defPosBlock("Def vs TE", t.defVsPosition.te)}
      ${defPosBlock("Def vs WR", t.defVsPosition.wr)}
    </div>
  </div>`;
}

function badge(label, value) {
  const cls = value > 0 ? "pos" : value < 0 ? "neg" : "";
  return `<div class="badge"><span class="label">${label}</span><span class="value ${cls}">${value}</span></div>`;
}

function miniStat(label, value, avg) {
  return `<div class="mini-stat">
    <div class="val">${value}</div>
    <div class="lbl">${label}</div>
    <div class="avg">avg ${avg}</div>
  </div>`;
}

function fmtRank(r) {
  if (r === null || r === undefined) return "—";
  return "#" + r;
}

function defPosBlock(title, d) {
  if (!d) return `<div class="defpos-block"><h4>${title}</h4><div class="empty-note">No data</div></div>`;
  return `<div class="defpos-block">
    <h4>${title}</h4>
    <div class="defpos-stats">
      <div class="item"><div class="val">${fmtRank(d.rank)}</div><div class="lbl">Rank</div></div>
      <div class="item"><div class="val">${d.yds}</div><div class="lbl">Yds/G</div></div>
      <div class="item"><div class="val">${d.td}</div><div class="lbl">TD/G</div></div>
    </div>
  </div>`;
}

function playerTable(title, rows, cols) {
  if (!rows || rows.length === 0) {
    return `<div class="table-block"><h4>${title}</h4><div class="empty-note">No data</div></div>`;
  }
  const head = cols.map(([label, , type]) => `<th class="${type === "num" ? "num" : ""}">${label}</th>`).join("");
  const body = rows.map(r => {
    const cells = cols.map(([, key, type]) => `<td class="${type === "num" ? "num" : ""}">${escapeHtml(String(r[key]))}</td>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div class="table-block">
    <h4>${title}</h4>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div>`;
}

// --- Gauge (SVG semicircle) ---
function gaugeBlock(label, value, range, rank, color) {
  const svg = gaugeSvg(value, range.min, range.max, color);
  return `<div class="gauge-block">
    ${svg}
    <div class="gauge-value">${value}</div>
    <div class="gauge-label">${label}</div>
    <div class="gauge-rank">${fmtRank(rank)} in FBS</div>
  </div>`;
}

function gaugeSvg(value, min, max, color) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min || 1);
  const angle = 180 * pct; // 0 = left (min), 180 = right (max)

  const cx = 60, cy = 58, r = 46;
  const startAngle = 180; // left
  const endAngle = 180 - angle; // sweep toward right as pct increases

  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };

  const [sx, sy] = toXY(180);
  const [ex, ey] = toXY(180 - angle);
  const largeArc = angle > 180 ? 1 : 0;

  const arcPath = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;

  // needle
  const needleAngleDeg = 180 - angle;
  const needleRad = (needleAngleDeg * Math.PI) / 180;
  const nx = cx + (r - 6) * Math.cos(needleRad);
  const ny = cy - (r - 6) * Math.sin(needleRad);

  return `
  <svg viewBox="0 0 120 66" width="120" height="66">
    <path d="M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}" fill="none" stroke="var(--track)" stroke-width="9" stroke-linecap="round"/>
    <path d="${arcPath}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke="var(--text)" stroke-width="2" class="gauge-needle-tip"/>
    <circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--text)"/>
  </svg>`;
}

function printOneTeam(teamName) {
  document.body.classList.add("print-single");
  const cards = document.querySelectorAll(".team-card");
  cards.forEach(c => {
    if (c.dataset.team !== teamName) c.classList.add("print-hide");
  });
  window.print();
}

window.addEventListener("afterprint", () => {
  document.querySelectorAll(".team-card.print-hide").forEach(c => c.classList.remove("print-hide"));
  document.body.classList.remove("print-single");
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
