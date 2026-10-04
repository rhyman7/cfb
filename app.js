let DATA = null;

// The week strip. data.json is always this week (stats and games). The slate and the
// matchup page can show another week: its games come from data/weeks/<N>.json and replace
// DATA.weekGames / DATA.currentWeek, while the teams stay as they are in data.json.
let SEASON = null;      // data/season.json: { season, weeks: [{ week, games, from, to, ids }] }
let LIVE_WEEK = null;   // the week data.json is for
let VIEW_WEEK = null;   // the week this page is showing

// "current", "past" (finished: scores and box scores) or "upcoming" (schedule only).
function weekMode() {
  return VIEW_WEEK == null || VIEW_WEEK === LIVE_WEEK ? "current" : VIEW_WEEK < LIVE_WEEK ? "past" : "upcoming";
}
function weekHref(week) {
  return week === LIVE_WEEK ? "index.html" : `index.html?week=${week}`;
}
// The week a link asks for: ?week=N on the slate, or the week a matchup's game id belongs to.
function wantedWeek() {
  const params = new URLSearchParams(location.search);
  let w = null;
  if (PAGE === "week") w = parseInt(params.get("week"), 10);
  else if (PAGE === "matchup" && SEASON) {
    const id = params.get("game");
    const hit = !(DATA.weekGames || []).some(g => g.id === id) && SEASON.weeks.find(x => (x.ids || []).includes(id));
    w = hit ? hit.week : null;
  }
  return Number.isFinite(w) ? w : null;
}

// Which page this is: "week" (index.html), "matchup" (matchup.html), "edges" (edges.html),
// "printall" (print.html), "ratings" (ratings.html) or "dashboard"
const PAGE = document.body.dataset.page || "dashboard";
const teamCards = document.getElementById("teamCards");

init();

async function init() {
  try {
    const [res, season] = await Promise.all([
      fetch("data/data.json", { cache: "no-store" }),
      fetch("data/season.json", { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    DATA = await res.json();
    SEASON = season && season.season === DATA.season && Array.isArray(season.weeks) ? season : null;
  } catch (err) {
    document.getElementById("app").innerHTML =
      `<div class="empty-note">Couldn't load data/data.json. Run scripts/build_data.py first.</div>`;
    return;
  }
  LIVE_WEEK = VIEW_WEEK = DATA.currentWeek || null;
  DATA.liveGames = DATA.weekGames || [];
  const want = wantedWeek();
  if (want != null && LIVE_WEEK != null && want !== LIVE_WEEK && SEASON && SEASON.weeks.some(w => w.week === want)) {
    VIEW_WEEK = DATA.currentWeek = want;
    try {
      const r = await fetch(`data/weeks/${want}.json`, { cache: "no-cache" });
      const wk = r.ok ? await r.json() : null;
      if (!wk || wk.season !== DATA.season || !Array.isArray(wk.weekGames)) throw new Error("no week file");
      DATA.weekGames = wk.weekGames;
    } catch (e) {
      DATA.weekGames = [];
    }
  }
  setMeta();
  try { initPlayerSearch(); } catch (e) { /* search is optional */ }
  try { initWeekNav(); } catch (e) { /* so is the week strip */ }
  if (PAGE === "week") initWeek();
  else if (PAGE === "matchup") initMatchup();
  else if (PAGE === "printall") initPrintAll();
  else if (PAGE === "edges") initEdges();
  else if (PAGE === "ratings") { /* static page: only the player search */ }
  else initDashboard();
}

// The week strip in the top bar, just left of the player search: one link per week,
// ending at the season's last week. Finished weeks open their scores, later weeks their schedule.
function initWeekNav() {
  const nav = document.querySelector(".topbar .topnav");
  if (!nav || !SEASON || LIVE_WEEK == null || nav.querySelector(".weeknav")) return;
  const page = document.body.dataset.page;
  const shown = page === "week" || page === "matchup" ? VIEW_WEEK : null;
  const day = d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const el = document.createElement("div");
  el.className = "weeknav no-print";
  el.setAttribute("role", "navigation");
  el.setAttribute("aria-label", "Weeks");
  el.innerHTML = `<span class="wk-label">Week</span>` + SEASON.weeks.map(w => {
    const state = w.week === LIVE_WEEK ? "now" : w.week < LIVE_WEEK ? "past" : "next";
    const what = state === "now" ? "this week" : state === "past" ? "final scores" : "schedule";
    const dates = w.from && w.to ? `, ${w.from === w.to ? day(w.from) : day(w.from) + " to " + day(w.to)}` : "";
    return `<a href="${weekHref(w.week)}" class="wk ${state}${w.week === shown ? " sel" : ""}"${w.week === shown ? ' aria-current="page"' : ""} title="${escapeHtml(`Week ${w.week}${dates}: ${what}`)}"><span class="wk-pre">Week </span>${w.week}</a>`;
  }).join("");
  // the strip and the search box travel together, so the last week stays beside the search
  const tools = document.createElement("div");
  tools.className = "navtools";
  tools.appendChild(el);
  const search = nav.querySelector(".psearch");
  if (search) tools.appendChild(search);
  nav.appendChild(tools);
  // "This Week's Games" is only the page on screen when the board shows this week
  if (page === "week" && VIEW_WEEK !== LIVE_WEEK) nav.querySelectorAll(":scope > a.active").forEach(a => a.classList.remove("active"));

  // Keep everything on one row when it can be: if the strip had to drop to a second row,
  // try the short page names. On phones the strip scrolls sideways, starting on the week in view.
  const first = nav.querySelector(":scope > a");
  const dropped = () => !!first && tools.offsetTop > first.offsetTop + 8;
  const focus = el.querySelector(".sel") || el.querySelector(".now");
  const fit = () => {
    nav.classList.remove("nav-tight");
    if (dropped()) {
      nav.classList.add("nav-tight");
      if (dropped()) nav.classList.remove("nav-tight");
    }
    if (focus) el.scrollLeft = focus.offsetLeft - (el.clientWidth - focus.offsetWidth) / 2;
  };
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  window.addEventListener("resize", fit);
  el.addEventListener("wheel", e => {
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
}

function setMeta() {
  const lastUpdated = document.getElementById("lastUpdated");
  const gen = new Date(DATA.generatedAt);
  if (lastUpdated) {
    lastUpdated.textContent = "Data as of " + gen.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric"
    }) + " " + gen.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
      (DATA.throughWeek ? ", stats through Week " + DATA.throughWeek : "");
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

// Latest betting line from ESPN (live.js) and kickoff forecast (weather.js), filled in after load.
const LINES = {};   // { [gameId]: { details: "UGA -7.5", total: 52.5 } }
const WX = {};      // { [gameId]: { icon, text, temp, pop, wind, daily } } or { indoor: true }

const MINUS = "\u2212";   // a real minus sign for the numbers on the page
function dispNum(v) { return String(v).replace("-", MINUS); }

function rankTag(rank) {
  return rank ? `<span class="ap-rank" title="${escapeHtml(DATA.pollName || "AP Top 25")}">#${rank}</span>` : "";
}

/* ---------------- Week slate (index.html) ---------------- */

function initWeek() {
  const games = DATA.weekGames || [];
  const mode = weekMode(), count = `${games.length} game${games.length === 1 ? "" : "s"}`;
  document.getElementById("weekTitle").textContent =
    DATA.currentWeek ? `Week ${DATA.currentWeek}` : "This week";
  // index.html?week=N (week strip): a finished week's final scores, where each row opens
  // that game's box score, or a later week's schedule as plain rows
  document.getElementById("weekSub").textContent =
    mode === "past" ? `${count}, final scores. Pick a game for its box score.`
    : mode === "upcoming" ? `${count} on the schedule. Full matchups open when Week ${DATA.currentWeek} is the current week.`
    : `${count}. Team stats through Week ${DATA.throughWeek}. Pick a game for the full matchup.`;
  if (mode !== "current") {
    document.getElementById("printAllBtn").hidden = true;   // Print all is this week's matchups
    document.title = `Week ${DATA.currentWeek} · CFB Matchups`;
  }
  if (!games.length) {
    document.getElementById("gameList").innerHTML = mode === "current" ? `<div class="empty-note">No games this week.</div>`
      : `<div class="empty-note">Week ${DATA.currentWeek} isn't available right now. <a href="index.html">See this week's games</a>.</div>`;
    return;
  }

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
  if (typeof startWeather === "function") startWeather(games, () => renderWeek(games));
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
  // Thursday/Friday games are grouped by day; every other day is split by kickoff hour.
  const byLabel = new Map();
  shown.filter(g => !live.includes(g)).forEach(g => {
    const d = new Date(g.start);
    let label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    const dow = d.getDay();
    if (dow !== 4 && dow !== 5) {
      if (g.timeTbd) {
        label += ", time TBD";
      } else {
        const hour = new Date(d);
        hour.setMinutes(0, 0, 0);
        label += ", " + hour.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      }
    }
    let grp = byLabel.get(label);
    if (!grp) { byLabel.set(label, grp = { label, timed: dow !== 4 && dow !== 5 && !g.timeTbd, games: [] }); groups.push(grp); }
    grp.games.push(g);
  });
  // exact: every game in the group kicks off at the time in its label, so rows needn't repeat it
  groups.forEach(grp => {
    const starts = grp.games.map(g => new Date(g.start).getTime());
    grp.exact = !!grp.timed && starts.every(t => t === starts[0]) && new Date(starts[0]).getMinutes() === 0;
  });

  list.innerHTML = `
    <div class="board-cols" aria-hidden="true"><span>Away</span><span></span><span>Home</span><span>Spread</span><span>Total</span><span>Implied score</span><span>Where</span></div>`
    + groups.map(grp => `
    <section class="day-group">
      <h2 class="day-label">${grp.live ? '<span class="live-dot"></span>' : ""}${escapeHtml(grp.label)}${grp.games.length > 1 ? ` <span class="day-count">${grp.games.length} games</span>` : ""}</h2>
      ${grp.games.map(g => gameRow(g, grp)).join("")}
    </section>`).join("");
}

// "Print all" prints whatever the filters are showing, in kickoff order.
let PRINT_IDS = [];
function updatePrintAll(shown, total) {
  const btn = document.getElementById("printAllBtn");
  if (!btn) return;
  PRINT_IDS = shown.map(g => g.id);
  btn.disabled = !shown.length;
  btn.textContent = shown.length === total ? `Print all ${total}` : `Print ${shown.length} shown`;
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

// One team in a board row: its block, name and record, and its score once the game is on.
function rowTeam(g, sideKey) {
  const s = g[sideKey], otherKey = sideKey === "away" ? "home" : "away", other = g[otherKey];
  const L = liveFor(g);
  let score = g.completed ? s.score : null, otherScore = g.completed ? other.score : null, done = g.completed;
  if (L && (L.state === "in" || L.state === "post") && L[sideKey]) {
    score = L[sideKey].score; otherScore = L[otherKey] ? L[otherKey].score : null; done = L.state === "post";
  }
  const lost = done && score != null && otherScore != null && score < otherScore;
  const poss = L && L.state === "in" && L.possession === sideKey ? `<span class="poss" title="Has the ball">●</span>` : "";
  const sub = [s.record, s.conference].filter(Boolean).join(", ");
  return `<div class="gr-team ${sideKey}${lost ? " lost" : ""}">
    ${slabHtml(s.abbr || s.name, s.name)}
    <div class="gr-tx"><div class="gr-name">${rankTag(s.rank)}${escapeHtml(s.name)}${poss}</div><div class="gr-sub">${escapeHtml(sub)}</div></div>
    ${score != null ? `<span class="gr-score">${score}</span>` : ""}
  </div>`;
}

// One game on the board: both teams, the current spread and total (with what they opened
// at when they have moved), implied team totals, and when and where it is played. Once the
// game starts, scores join the teams and the implied column shows the game's status.
function gameRow(g, grp) {
  const L = liveFor(g);
  const isLive = !!L && L.state === "in";
  const done = !!g.completed || (!!L && L.state === "post");
  const started = isLive || done;
  const mode = weekMode();
  const ln = lineFor(g), it = impliedTotals(g), mv = started || mode !== "current" ? null : lineMove(g);
  const spread = spreadText(g) || "—";
  const total = ln && ln.total != null ? ln.total : "—";

  let status;
  if (isLive) {
    status = `<div class="gr-big"><span class="live-badge">Live</span> ${escapeHtml(L.detail || "")}</div>` +
      (L.downDistance ? `<div class="gr-sub game-sit">${escapeHtml(L.downDistance)}</div>` : "");
  } else if (done) {
    status = `<div class="gr-big">${escapeHtml((L && L.state === "post" && L.detail) || "Final")}</div>`;
  } else {
    status = it ? `<span class="imp-pre">Implied </span>${escapeHtml(g.away.abbr)} ${it.away}, ${escapeHtml(g.home.abbr)} ${it.home}` : "";
  }
  // a later week's games are just listed; this week's and finished ones open the game
  const open = mode === "upcoming" && !started ? `<div class="game-row upcoming">`
    : `<a class="game-row${isLive ? " live" : ""}${done ? " done" : ""}" href="matchup.html?game=${encodeURIComponent(g.id)}">`;

  // second line under the stadium: the city, kickoff time (when the group's label doesn't
  // give it) and TV, then the forecast (outdoor games, before kickoff) or "Indoors"
  const bits = [[g.city, g.neutral ? "neutral site" : null].filter(Boolean).join(", ")];
  const time = !started && !(grp && grp.exact) ? kickoff(g) : "";
  bits.push(time && g.tv ? `${time} on ${g.tv}` : time || g.tv || "");
  if (g.indoor === true) bits.push("Indoors");
  else if (!started && WX[g.id]) {
    const w = WX[g.id];
    bits.push([w.daily ? `${w.temp}° high` : `${w.temp}°`, w.pop != null ? `${w.pop}% rain` : null, w.wind != null ? `${w.wind} mph wind` : null].filter(Boolean).join(", "));
  }

  return `${open}
    ${rowTeam(g, "away")}
    <div class="gr-at">${g.neutral ? "vs" : "at"}</div>
    ${rowTeam(g, "home")}
    <div class="gr-spread"><div class="gr-big">${escapeHtml(spread)}</div>${mv && mv.spread ? `<div class="gr-sub gr-move">opened ${escapeHtml(mv.spread)}</div>` : ""}</div>
    <div class="gr-total"><div class="gr-big"><span class="ou-pre">O/U </span>${total}</div>${mv && mv.total != null ? `<div class="gr-sub gr-move">opened ${mv.total}</div>` : ""}</div>
    <div class="gr-implied">${status}</div>
    <div class="gr-where"><div>${escapeHtml(g.venue || "")}</div><div class="gr-sub">${escapeHtml(bits.filter(Boolean).join(". "))}</div>${g.note ? `<div class="gr-sub gr-note">${escapeHtml(g.note)}</div>` : ""}</div>
  </${open.startsWith("<a") ? "a" : "div"}>`;
}

// Current line for a card: ESPN's (live.js) when it names one of the two teams,
// otherwise the weekly line from data.json. Spread is a positive number of points
// the favorite gives; fav is "away" or "home".
function lineFor(g) {
  let fav = null, spread = null, pick = false;
  const cur = LINES[g.id];
  if (cur && cur.details) {
    if (/^(even|pk|pick)/i.test(cur.details)) pick = true;
    else {
      const m = cur.details.match(/^(.+?)\s+-(\d+(?:\.\d+)?)$/);
      if (m) {
        const ab = m[1].trim().toUpperCase();
        if (ab === String(g.away.abbr || "").toUpperCase()) fav = "away";
        else if (ab === String(g.home.abbr || "").toUpperCase()) fav = "home";
        if (fav) spread = parseFloat(m[2]);
      }
    }
  }
  if (!pick && !fav && g.spread != null) {
    if (g.spread === 0) pick = true;
    else { fav = g.spread < 0 ? "home" : "away"; spread = Math.abs(g.spread); }
  }
  const total = cur && cur.total != null ? cur.total : (g.total || null);
  if (!pick && !fav && total == null) return null;
  return { fav, spread, pick, total };
}

/* ---------------- Single matchup (matchup.html) ---------------- */

function initMatchup() {
  const params = new URLSearchParams(location.search);
  const id = params.get("game");
  const g = (DATA.weekGames || []).find(x => x.id === id);
  const head = document.getElementById("matchupHeader");
  document.getElementById("printBothBtn").addEventListener("click", () => window.print());
  const mode = weekMode();
  if (mode !== "current") {
    const back = document.querySelector(".back-link");
    back.href = weekHref(VIEW_WEEK);
    back.textContent = `Week ${VIEW_WEEK} games`;
    document.getElementById("printBothBtn").hidden = true;   // printing is for this week's matchups
    document.body.classList.remove("mprint");
  }

  if (!g) {
    head.innerHTML = `<div class="empty-note">That game isn't on ${mode === "current" ? "this week's schedule anymore" : "the Week " + VIEW_WEEK + " schedule"}. <a href="index.html">See this week's matchups</a> or <a href="dashboard.html">compare any two teams</a>.</div>`;
    teamCards.innerHTML = "";
    return;
  }

  const tag = s => `${s.rank ? "#" + s.rank + " " : ""}${s.abbr || s.name}`;
  document.title = `${tag(g.away)} ${g.neutral ? "vs" : "@"} ${tag(g.home)}${mode === "current" ? "" : ", Week " + VIEW_WEEK} · CFB Matchups`;

  if (mode !== "current") {
    // another week (week strip): the game header, then the box score (finished) or a pointer
    // back (not played yet). The stats live on this week's matchups.
    const team = s => (s.key ? DATA.teams[s.key] : null) || null;
    head.innerHTML = renderHero(g, team(g.away), team(g.home));
    const both = g.away.key && g.home.key && DATA.teams[g.away.key] && DATA.teams[g.home.key];
    document.getElementById("edges").innerHTML = mode === "past" ? ""
      : `<div class="empty-note">The full matchup opens when Week ${VIEW_WEEK} is the current week.${both ? ` <a href="dashboard.html?team1=${encodeURIComponent(g.away.key)}&team2=${encodeURIComponent(g.home.key)}">Compare these two teams now</a>.` : ""}</div>`;
    teamCards.innerHTML = "";
    if (mode === "past" && typeof startLiveMatchup === "function") startLiveMatchup(g);
    return;
  }

  const parts = renderMatchupParts(g);
  head.innerHTML = parts.head;
  if (typeof startLiveMatchup === "function") startLiveMatchup(g);
  // Fill the forecast and the current line into the header in place (live.js may be updating it too).
  const refreshExtras = () => refreshHero(g);
  if (typeof refreshLines === "function" && DATA.currentWeek) refreshLines(new Set([g.id]), refreshExtras);
  if (typeof startWeather === "function") startWeather([g], refreshExtras);
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
      <h3 class="section-title">Head to head</h3>
      <div class="edge-grid">
        ${edgePanel(away, home)}
        ${edgePanel(home, away)}
      </div>
      <p class="edge-key">Longer bar, better rank. Ranks are out of ${n} FBS teams. The edge goes to whichever side ranks at least ${gap} spots better; INT compares interceptions thrown by the offense with interceptions made by the defense.${hasEff() ? " EPA / play (expected points added per play) and Success % (share of plays with positive EPA) use every run and pass play from cfbfastR play-by-play; for a defense they're what it allowed, so lower is better." : ""}</p>`;
  } else {
    const other = away ? g.home : g.away;
    edges = `<h3 class="section-title">Head to head</h3>
      <div class="empty-note">No head-to-head comparison: ${escapeHtml(other.name)} isn't an FBS team, so its stats aren't tracked.</div>`;
  }
  const cards = `<h3 class="section-title">Full team stats</h3>` + [g.away, g.home]
    .map(s => s.key && DATA.teams[s.key] ? renderTeamCard(DATA.teams[s.key]) : nonFbsCard(s)).join("");
  return { head: renderHero(g, away, home), edges: edges + renderBetting(away, home), cards };
}

/* ---------------- Print all (print.html) ---------------- */

function initPrintAll() {
  const all = DATA.weekGames || [];
  const ids = (new URLSearchParams(location.search).get("games") || "").split(",").filter(Boolean);
  const games = ids.length ? ids.map(id => all.find(g => g.id === id)).filter(Boolean) : all;
  const wrap = document.getElementById("printAll");
  const status = document.getElementById("printStatus");
  document.title = `Week ${DATA.currentWeek} matchups (${games.length}) · CFB Matchups`;

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
  status.textContent = `${n} matchup${n === 1 ? "" : "s"} ready, ${n} landscape page${n === 1 ? "" : "s"}`;
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
  return `${fav.abbr || fav.name} ${MINUS}${Math.abs(g.spread)}`;
}

function renderHero(g, away, home) {
  const final = g.completed && g.away.score != null && g.home.score != null;
  const d = new Date(g.start);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = final ? "Final" : g.timeTbd ? "Time TBD"
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const facts = [
    `${day}, ${time}`,
    [g.venue, g.city].filter(Boolean).join(", "),
  ].filter(Boolean).map(f => `<span>${escapeHtml(f)}</span>`);
  facts.push(`<span class="hero-wx" id="heroWx">${escapeHtml(heroWxText(g))}</span>`);
  if (g.neutral) facts.push(`<span>Neutral site</span>`);
  if (g.conferenceGame) facts.push(`<span>Conference game</span>`);
  if (g.tv) facts.push(`<span>TV: ${escapeHtml(g.tv)}</span>`);
  const line = spreadText(g), total = heroTotalText(g), imp = impliedText(g), move = lineMoveText(g);

  return `
  <div class="mh-week">Week ${g.week}${g.note ? ", " + escapeHtml(g.note) : ""}</div>
  <div class="game-hero">
    ${heroTeam(g.away, away, g.neutral ? "Team 1" : "Away", final ? g.away.score : null, final ? g.home.score : null, "away")}
    <div class="hero-mid">
      <div class="hero-live" id="heroLive" hidden></div>
      <div class="hero-line" id="heroLine"${line ? "" : " hidden"}>${escapeHtml(line)}</div>
      <div class="hero-total" id="heroTotal"${total ? "" : " hidden"}>${escapeHtml(total)}</div>
      <div class="hero-info hero-implied" id="heroImplied"${imp ? "" : " hidden"}>${escapeHtml(imp)}</div>
      <div class="hero-info hero-move" id="heroMove"${move ? "" : " hidden"}>${escapeHtml(move)}</div>
    </div>
    ${heroTeam(g.home, home, g.neutral ? "Team 2" : "Home", final ? g.home.score : null, final ? g.away.score : null, "home")}
  </div>
  <div class="hero-facts">${facts.join("")}</div>`;
}

// Fill the current line and the forecast into a header that is already on the page.
function refreshHero(g) {
  for (const [id, fn] of [["heroLine", spreadText], ["heroTotal", heroTotalText], ["heroImplied", impliedText], ["heroMove", lineMoveText]]) {
    const el = document.getElementById(id);
    if (el) { const t = fn(g); el.textContent = t || ""; el.hidden = !t; }
  }
  const wx = document.getElementById("heroWx");
  if (wx) wx.textContent = heroWxText(g);
}

// The current spread as "UGA −7.5" / "Pick'em" and the current total as "Total 52.5" (see lineFor).
function spreadText(g) {
  const ln = lineFor(g);
  if (!ln) return "";
  const favSide = ln.fav ? g[ln.fav] : null;
  return ln.pick ? "Pick'em" : favSide ? `${favSide.abbr || favSide.name} ${MINUS}${ln.spread}` : "";
}
function heroTotalText(g) {
  const ln = lineFor(g);
  return ln && ln.total != null ? `Total ${ln.total}` : "";
}

// The roof-or-forecast slot under the game header: an indoor game just says so; an
// outdoor game shows the forecast once it has loaded.
function heroWxText(g) {
  if (g.indoor === true) return "Indoors";
  const w = g.completed ? null : WX[g.id];
  if (!w) return g.indoor === false ? "Outdoors" : "";
  return [w.text, w.daily ? `high ${w.temp}°` : `${w.temp}° at kickoff`,
    w.pop != null ? `${w.pop}% chance of rain` : null, w.wind != null ? `wind ${w.wind} mph` : null]
    .filter(Boolean).join(", ");
}

function heroTeam(s, t, side, score, otherScore, sideKey) {
  // the rating is this week's, so another week's header (week strip) leaves it out
  const rec = [[s.record, s.conference].filter(Boolean).join(", "), t && weekMode() === "current" ? `SRS ${dispNum(t.record.srs)}` : null].filter(Boolean).join(", ")
    + (s.qb ? `. ${s.qb} at QB` : "");
  const lost = score !== null && otherScore !== null && score < otherScore;
  return `
    <div class="hero-team" data-side="${sideKey}" style="${teamVars(s.name)}">
      <div class="hero-side">${side}</div>
      <div class="hero-name">${rankTag(s.rank)}${t ? teamLink(t) : escapeHtml(s.name)}</div>
      <div class="hero-score${lost ? " lost" : ""}"${score === null ? " hidden" : ""}>${score === null ? "" : score}</div>
      <div class="hero-rec">${escapeHtml(rec)}</div>
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

// EPA / play and success rate, from play-by-play (t.eff); shown when every team has them.
const EFF_ROWS = [
  ["EPA / play", t => t.eff.off.epa, t => t.eff.def.epa, true, false, v => v.toFixed(3)],
  ["Success %", t => t.eff.off.sr, t => t.eff.def.sr, true, false, v => v.toFixed(1)],
];
function hasEff() { return Object.values(DATA.teams).every(t => t.eff); }
function edgeRows() { return hasEff() ? EDGE_ROWS.slice(0, 1).concat(EFF_ROWS, EDGE_ROWS.slice(1)) : EDGE_ROWS; }

// One offense against the other defense, stat by stat. Each side's bar grows from the
// middle with its FBS rank (longer = better); the side with the edge shows in its color.
function edgePanel(offTeam, defTeam) {
  const gap = edgeGap(), n = Object.keys(DATA.teams).length;
  const ov = teamVars(offTeam.team), dv = teamVars(defTeam.team);
  const oa = escapeHtml(offTeam.abbr), da = escapeHtml(defTeam.abbr);
  const rows = edgeRows().map(([label, offGet, defGet, offHi, defHi, fmt]) => {
    const o = offGet(offTeam), d = defGet(defTeam);
    const or = leagueRank(offGet, o, offHi), dr = leagueRank(defGet, d, defHi);
    const diff = dr - or;
    const side = diff >= gap ? "off" : diff <= -gap ? "def" : "";
    const w = r => Math.round(((n + 1 - r) / n) * 100);
    const edge = side === "off" ? `<b class="tc" style="${ov}">${oa}</b>`
      : side === "def" ? `<b class="tc" style="${dv}">${da}</b>` : `<span class="even">Even</span>`;
    return `<div class="tape">
      <span class="lbl">${label}</span>
      <span class="num"><b>${dispNum(fmt ? fmt(o) : o)}</b> <span class="rk">#${or}</span></span>
      <span class="tl"><i class="tb${side === "off" ? " on" : ""}" style="width:${w(or)}%;${ov}"></i></span>
      <span class="tr"><i class="tb${side === "def" ? " on" : ""}" style="width:${w(dr)}%;${dv}"></i></span>
      <span><b>${dispNum(fmt ? fmt(d) : d)}</b> <span class="rk">#${dr}</span></span>
      <span class="num edge">${edge}</span>
    </div>`;
  }).join("");

  return `
  <div class="edge-panel">
    <h4><span class="tc" style="${ov}">${oa} offense</span> against <span class="tc" style="${dv}">${da} defense</span></h4>
    <div class="tape tape-h"><span></span><span class="num">${oa} offense</span><span></span><span></span><span>${da} defense</span><span class="num">Edge</span></div>
    ${rows}
  </div>`;
}

function nonFbsCard(s) {
  return `<div class="team-card" data-team="${escapeHtml(s.name)}" style="${teamVars(s.name)}">
    <div class="team-card-header">
      <div class="team-name-block">
        ${slabHtml(s.abbr || s.name, s.name)}
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
    teamCards.innerHTML = [t1, t2].map(name => renderTeamCard(DATA.teams[name])).join("")
      + renderBetting(DATA.teams[t1], DATA.teams[t2]);
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
  <div class="team-card" data-team="${escapeHtml(t.team)}" style="${teamVars(t.team)}">
    <div class="team-card-header">
      <div class="team-name-block">
        ${slabHtml(t.abbr, t.team)}
        <h2>${rankTag(t.apRank)}${teamLink(t)}</h2>
        <div class="record"><b>${t.record.w}-${t.record.l}${t.record.t ? "-" + t.record.t : ""}</b>${t.conference ? ` <span class="conf">${escapeHtml(t.conference)}</span>` : ""}</div>
      </div>
      <div class="rating-badges">
        ${badge("SoS", t.record.sos)}
        ${badge("OSRS", t.record.osrs)}
        ${badge("DSRS", t.record.dsrs)}
        ${badge("SRS", t.record.srs)}
      </div>
      <button class="print-btn print-btn-single no-print" type="button" onclick="printOneTeam('${escapeHtml(t.team).replace(/'/g, "\\'")}')">Print</button>
    </div>

    <div class="stat-columns">
      <div class="stat-col offense">
        <h3>Offense</h3>
        <div class="gauges">
          ${gaugeBlock("Rush Yds/G", t.offense.rushYdsG, gr.offRushYdsG, t.offense.rushYdsGRank)}
          ${gaugeBlock("Pass Yds/G", t.offense.passYdsG, gr.offPassYdsG, t.offense.passYdsGRank)}
        </div>
        <div class="mini-stats">
          ${miniStat("Rush TD/G", t.offense.rushTdG, avg.rushTdG)}
          ${miniStat("Pass TD/G", t.offense.passTdG, avg.passTdG)}
          ${miniStat("PPG", t.offense.ppg, avg.ppg)}
        </div>
      </div>

      <div class="center-col">
        <div class="rank-line">
          <div class="lbl">Run game</div>
          <div class="val">${fmtRank(t.offense.rushYdsGRank)} <span>off</span> / ${fmtRank(t.defense.rushYdsGRank)} <span>def</span></div>
        </div>
        <div class="rank-line">
          <div class="lbl">Pass game</div>
          <div class="val">${fmtRank(t.offense.passYdsGRank)} <span>off</span> / ${fmtRank(t.defense.passYdsGRank)} <span>def</span></div>
        </div>
      </div>

      <div class="stat-col defense">
        <h3>Defense</h3>
        <div class="gauges">
          ${gaugeBlock("Rush Yds/G", t.defense.rushYdsG, gr.defRushYdsG, t.defense.rushYdsGRank)}
          ${gaugeBlock("Pass Yds/G", t.defense.passYdsG, gr.defPassYdsG, t.defense.passYdsGRank)}
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
        ["Cmp/G", "cmp", "num"],
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
      ${defPosBlock("Defense vs RB", t.defVsPosition.rb)}
      ${defPosBlock("Defense vs receiving RB", t.defVsPosition.recRb)}
      ${defPosBlock("Defense vs TE", t.defVsPosition.te)}
      ${defPosBlock("Defense vs WR", t.defVsPosition.wr)}
    </div>
  </div>`;
}

function badge(label, value) {
  const cls = value > 0 ? "pos" : value < 0 ? "neg" : "";
  return `<div class="badge"><span class="label">${label}</span><span class="value ${cls}">${dispNum(value)}</span></div>`;
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
      <div class="item"><div class="val">${fmtRank(d.rank)}</div><div class="lbl">rank</div></div>
      <div class="item"><div class="val">${d.yds}</div><div class="lbl">yds/G</div></div>
      <div class="item"><div class="val">${d.td}</div><div class="lbl">TD/G</div></div>
    </div>
  </div>`;
}

function playerTable(title, rows, cols) {
  if (!rows || rows.length === 0) {
    return `<div class="table-block"><h4>${title}</h4><div class="empty-note">No data</div></div>`;
  }
  const head = cols.map(([label, , type]) => `<th class="${type === "num" ? "num" : ""}">${label}</th>`).join("");
  const kind = title.toLowerCase();
  const body = rows.map(r => {
    const cells = cols.map(([, key, type]) => {
      const txt = escapeHtml(type === "num" ? dispNum(r[key] ?? "—") : String(r[key] ?? "—"));
      const val = key === "player" && r.log && DATA.gameLogs && DATA.gameLogs[r.log]
        ? `<button type="button" class="plink" data-log="${escapeHtml(r.log)}" data-kind="${kind}" data-pos="${escapeHtml(r.pos || "")}" data-name="${txt}">${txt}</button>`
        : txt;
      return `<td class="${type === "num" ? "num" : ""}">${val}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div class="table-block">
    <h4>${title}</h4>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </div>`;
}

// --- Gauge (SVG semicircle) ---
function gaugeBlock(label, value, range, rank) {
  const svg = gaugeSvg(value, range.min, range.max);
  return `<div class="gauge-block">
    ${svg}
    <div class="gauge-value">${value}</div>
    <div class="gauge-label">${label}</div>
    <div class="gauge-rank">${fmtRank(rank)} in FBS</div>
  </div>`;
}

function gaugeSvg(value, min, max) {
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
  <svg viewBox="0 0 120 66" width="120" height="66" aria-hidden="true">
    <path class="g-track" d="M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}" fill="none" stroke-width="8"/>
    <path class="g-arc" d="${arcPath}" fill="none" stroke-width="8"/>
    <line class="g-needle" x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" stroke-width="2"/>
    <circle class="g-hub" cx="${cx}" cy="${cy}" r="3.5"/>
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

/* ---------------- Player game logs: hover tooltip + click panel ---------------- */
// DATA.gameLogs["ABBR|athlete_id"] = [{ w, opp, at, res, cmp, att, pYds, pTd, int, car, rYds,
// rTd, rec, recYds, recTd }], one entry per game played for that team; stats left out are 0,
// and "at" is only present (true) for road games.

const LOG_GROUPS = {
  passing: [["C/Att", e => `${e.cmp || 0}/${e.att || 0}`], ["Yds", e => e.pYds || 0], ["TD", e => e.pTd || 0], ["Int", e => e.int || 0]],
  rushing: [["Att", e => e.car || 0], ["Yds", e => e.rYds || 0], ["TD", e => e.rTd || 0],
    ["Y/A", e => e.car ? ((e.rYds || 0) / e.car).toFixed(1) : "—"]],
  receiving: [["Rec", e => e.rec || 0], ["Yds", e => e.recYds || 0], ["TD", e => e.recTd || 0],
    ["Y/R", e => e.rec ? ((e.recYds || 0) / e.rec).toFixed(1) : "—"]],
};
const GROUP_LABEL = { passing: "Passing", rushing: "Rushing", receiving: "Receiving" };
const hasGroup = {
  passing: e => e.att > 0,
  rushing: e => e.car > 0 || !!e.rYds || !!e.rTd,
  receiving: e => e.rec > 0 || !!e.recYds || !!e.recTd,
};

function oppText(e) { return `${e.at ? "@" : "vs"} ${e.opp}`; }
function teamOfLog(key) {
  const abbr = key.split("|")[0];
  return Object.values(DATA.teams).find(t => t.abbr === abbr) || null;
}
function gamesText(n) { return `${n} game${n === 1 ? "" : "s"}`; }

function tooltipHtml(name, kind, log) {
  const cols = LOG_GROUPS[kind] || [];
  const head = `<th>Wk</th><th>Opp</th>${cols.map(([l]) => `<th class="num">${l}</th>`).join("")}`;
  const body = log.map(e => `<tr><td>${e.w}</td><td>${escapeHtml(oppText(e))}</td>${cols.map(([, f]) => `<td class="num">${f(e)}</td>`).join("")}</tr>`).join("");
  return `<div class="ptip-head"><b>${name}</b><span>${GROUP_LABEL[kind] || ""}, ${gamesText(log.length)}</span></div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <div class="ptip-foot">Click for full game log and prop check</div>`;
}

function panelHtml(name, key, log, kind, pos) {
  const t = teamOfLog(key);
  const groups = ["passing", "rushing", "receiving"].filter(g => log.some(hasGroup[g]));
  if (kind && LOG_GROUPS[kind] && !groups.includes(kind)) groups.push(kind);
  const gh = groups.map(g => `<th colspan="${LOG_GROUPS[g].length}" class="grp gstart">${GROUP_LABEL[g]}</th>`).join("");
  const sub = groups.map(g => LOG_GROUPS[g].map(([l], i) => `<th class="num${i === 0 ? " gstart" : ""}">${l}</th>`).join("")).join("");
  const body = log.map(e => {
    const rc = e.res && e.res[0] === "W" ? "pos" : e.res && e.res[0] === "L" ? "neg" : "";
    return `<tr>
    <td>${e.w}</td><td>${escapeHtml(oppText(e))}</td><td class="res ${rc}">${escapeHtml(e.res || "")}</td>
    ${groups.map(g => LOG_GROUPS[g].map(([, f], i) => `<td class="num${i === 0 ? " gstart" : ""}">${f(e)}</td>`).join("")).join("")}<td class="num prop-cell gstart"></td></tr>`;
  }).join("");
  return `<div class="plog-card" role="dialog" aria-modal="true" aria-labelledby="plogTitle">
    <div class="plog-top">
      <div>
        <h3 id="plogTitle">${name}</h3>
        <div class="plog-sub">${pos ? escapeHtml(pos) + ", " : ""}${t ? escapeHtml(t.team) + ", " : ""}${gamesText(log.length)}</div>
      </div>
      <button type="button" class="plog-close" aria-label="Close">✕</button>
    </div>
    <div class="plog-scroll">
      <table>
        <thead>
          <tr><th colspan="3"></th>${gh}<th class="grp gstart">Prop</th></tr>
          <tr><th>Wk</th><th>Opp</th><th>Result</th>${sub}<th class="num gstart prop-head"></th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${propToolHtml(groups, kind, pos)}
    <div class="plog-note">Regular-season games played for ${t ? escapeHtml(t.team) : "this team"} only.</div>
  </div>`;
}

(function setupPlayerLogs() {
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let tip = null, panel = null, lastFocus = null, quiet = false;

  function hideTip() { if (tip) tip.hidden = true; }
  function showTip(btn) {
    const log = DATA && DATA.gameLogs && DATA.gameLogs[btn.dataset.log];
    if (!log || (panel && !panel.hidden)) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "ptip no-print"; document.body.appendChild(tip); }
    tip.innerHTML = tooltipHtml(escapeHtml(btn.dataset.name), btn.dataset.kind, log);
    tip.hidden = false;
    // next to the name: to its right if it fits, otherwise below (or above near the bottom)
    const r = btn.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (r.right + 10 + w <= vw - 8) {
      left = r.right + 10;
      top = Math.min(r.top - 8, vh - h - 8);
    } else {
      left = Math.min(r.left, vw - w - 8);
      top = r.bottom + 6 + h > vh - 8 ? r.top - h - 6 : r.bottom + 6;
    }
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    document.body.classList.remove("plog-open");
    if (lastFocus) { quiet = true; lastFocus.focus(); quiet = false; }
  }
  function openPanel(btn) {
    const log = DATA && DATA.gameLogs && DATA.gameLogs[btn.dataset.log];
    if (!log) return;
    hideTip();
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "plog no-print";
      panel.addEventListener("click", e => { if (e.target === panel || e.target.closest(".plog-close")) closePanel(); });
      document.body.appendChild(panel);
    }
    lastFocus = btn;
    const pos = btn.dataset.pos || "";
    panel.innerHTML = panelHtml(escapeHtml(btn.dataset.name), btn.dataset.log, log, btn.dataset.kind, pos);
    const card = panel.querySelector(".plog-card");
    const statSel = card.querySelector(".prop-stat"), ctx = card.querySelector(".prop-ctx");
    const refresh = () => { updateProp(card, log); ctx.innerHTML = oppContext(btn.dataset.log, statSel.value, pos); };
    statSel.addEventListener("change", refresh);
    card.querySelector(".prop-line").addEventListener("input", () => updateProp(card, log));
    refresh();
    panel.hidden = false;
    document.body.classList.add("plog-open");
    panel.querySelector(".plog-close").focus();
  }

  // Used by the player search: open a player's log without a table button.
  window.openPlayerLog = (p, returnFocus) => openPanel({
    dataset: { log: p.key, name: p.name, kind: p.kind, pos: p.pos },
    focus: () => returnFocus && returnFocus.focus(),
  });

  document.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest(".plink");
    if (btn) openPanel(btn);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closePanel(); hideTip(); } });
  if (canHover) {
    document.addEventListener("mouseover", e => {
      const btn = e.target.closest && e.target.closest(".plink");
      if (btn) showTip(btn);
    });
    document.addEventListener("mouseout", e => {
      const btn = e.target.closest && e.target.closest(".plink");
      if (btn && !btn.contains(e.relatedTarget)) hideTip();
    });
    document.addEventListener("focusin", e => { const b = e.target.closest && e.target.closest(".plink"); if (b && !quiet) showTip(b); });
    document.addEventListener("focusout", e => { if (e.target.closest && e.target.closest(".plink")) hideTip(); });
  }
  window.addEventListener("scroll", hideTip, { passive: true });
  window.addEventListener("beforeprint", () => { hideTip(); closePanel(); });
})();

/* ---------------- Implied team totals and line movement ---------------- */

// Implied totals from the current spread and O/U (see lineFor): favorite = (total + spread) / 2.
function impliedTotals(g) {
  const ln = lineFor(g);
  if (!ln || ln.total == null || (!ln.pick && !ln.fav)) return null;
  const half = ln.pick ? 0 : ln.spread / 2;
  const fav = ln.total / 2 + half, dog = ln.total / 2 - half;
  const away = ln.fav === "away" ? fav : ln.fav === "home" ? dog : fav;
  const home = ln.fav === "home" ? fav : ln.fav === "away" ? dog : fav;
  return { away: +away.toFixed(1), home: +home.toFixed(1) };
}
function impliedText(g) {
  if (g.completed) return "";
  const it = impliedTotals(g);
  return it ? `Implied ${g.away.abbr} ${it.away}, ${g.home.abbr} ${it.home}` : "";
}

// Weekly consensus spread (home side, negative = home favored) as "ABBR −7" / "PK".
function spreadLabel(g, homeSpread) {
  if (homeSpread == null) return "—";
  if (homeSpread === 0) return "PK";
  return homeSpread < 0 ? `${g.home.abbr} ${MINUS}${-homeSpread}` : `${g.away.abbr} ${MINUS}${homeSpread}`;
}
// Line movement: the consensus line at this week's first build (g.lineOpen) against the
// consensus line at the latest build (g.spread / g.total), so both ends come from the same source.
// { when: "Tue", spread: what the spread opened at if it has moved (else null), total: likewise }.
function lineMove(g) {
  const o = g.lineOpen;
  if (!o || g.completed) return null;
  const hasSpread = o.spread != null && g.spread != null, hasTotal = o.total != null && g.total != null;
  if (!hasSpread && !hasTotal) return null;  // no line to compare
  const when = o.at ? new Date(o.at + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }) : "earlier";
  return {
    when,
    spread: hasSpread && Math.abs(o.spread - g.spread) >= 0.5 ? spreadLabel(g, o.spread) : null,
    total: hasTotal && Math.abs(o.total - g.total) >= 0.5 ? o.total : null,
  };
}
function lineMoveBits(m) {
  return [m.spread ? `spread opened ${m.spread}` : null, m.total != null ? `total opened ${m.total}` : null].filter(Boolean);
}
function lineMoveText(g) {
  const m = lineMove(g);
  if (!m) return "";
  const bits = lineMoveBits(m);
  return bits.length ? `Since ${m.when}: ${bits.join(", ")}` : `No line move since ${m.when}`;
}

/* ---------------- Betting trends (ATS and over/under) ---------------- */
// t.betting = { ats, fav, dog, home, away: {w,l,p}, ou: {o,u,p}, games: [{ w, opp, at, line, score, ats, total, ou }] }
// line is the team's own line from the cfbfastR matchup line (negative = favored).

function renderBetting(a, b) {
  const teams = [a, b].filter(t => t && t.betting);
  if (!teams.length) return "";
  return `<div class="bet-section no-print">
    <h3 class="section-title">Betting trends</h3>
    <div class="edge-grid">${teams.map(bettingPanel).join("")}</div>
    <p class="edge-key">Against the spread (ATS) and over/under records use each completed game's consensus line from the cfbfastR matchup lines, rounded to the half point. W-L-P = wins, losses and pushes; percentages leave out pushes. Neutral-site games count in ATS, Fav and Dog but not Home or Away. Games against FCS teams have no line and are left out. Small samples early in the season can mislead.</p>
  </div>`;
}

function fmtLine(x) {
  if (x === null || x === undefined) return "—";
  return x === 0 ? "PK" : x > 0 ? `+${x}` : `${x}`;
}
function wlp(r) { return `${r.w}-${r.l}${r.p ? "-" + r.p : ""}`; }
function pctOf(n, d, what) { return `<span class="rk">${d ? Math.round((100 * n) / d) + "%" + (what || "") : ""}</span>`; }
function resTag(r) { return `<span class="tag ${r === "O" ? "W" : r === "U" ? "L" : r}">${r}</span>`; }

function bettingPanel(t) {
  const b = t.betting;
  const chip = (label, r) => `<div class="bet-chip"><span class="lbl">${label}</span><b>${wlp(r)}</b>${pctOf(r.w, r.w + r.l)}</div>`;
  const ouChip = `<div class="bet-chip"><span class="lbl">Over/under</span><b>${b.ou.o}-${b.ou.u}${b.ou.p ? "-" + b.ou.p : ""}</b>${pctOf(b.ou.o, b.ou.o + b.ou.u, " over")}</div>`;
  const rows = b.games.slice().reverse().map(g => `<tr>
    <td>${g.w}</td><td>${g.at ? "@" : "vs"} ${escapeHtml(g.opp)}</td><td class="num">${dispNum(fmtLine(g.line))}</td>
    <td class="num">${escapeHtml(g.score)}</td><td class="num">${resTag(g.ats)}</td>
    <td class="num">${g.total != null ? g.total : "—"}</td><td class="num">${g.ou ? resTag(g.ou) : "—"}</td></tr>`).join("");
  return `<div class="edge-panel bet-panel" style="${teamVars(t.team)}">
    <h4>${rankTag(t.apRank)}${escapeHtml(t.team)}</h4>
    <div class="bet-chips">${chip("ATS", b.ats)}${chip("Favorite", b.fav)}${chip("Underdog", b.dog)}${chip("Home", b.home)}${chip("Away", b.away)}${ouChip}</div>
    ${b.games.length ? `<table class="edge-table bet-table">
      <thead><tr><th>Wk</th><th>Opp</th><th class="num">Line</th><th class="num">Score</th><th class="num">ATS</th><th class="num">Total</th><th class="num">O/U</th></tr></thead>
      <tbody>${rows}</tbody></table>` : `<div class="empty-note">No games with a line yet.</div>`}
  </div>`;
}

/* ---------------- Prop check (inside the game log panel) ---------------- */

// [key, label, group, value in one game]. group decides which players get the option.
const PROP_STATS = [
  ["pYds", "Pass Yds", "passing", e => e.pYds || 0],
  ["pTd", "Pass TD", "passing", e => e.pTd || 0],
  ["cmp", "Completions", "passing", e => e.cmp || 0],
  ["att", "Pass Attempts", "passing", e => e.att || 0],
  ["int", "Interceptions", "passing", e => e.int || 0],
  ["rYds", "Rush Yds", "rushing", e => e.rYds || 0],
  ["car", "Carries", "rushing", e => e.car || 0],
  ["rTd", "Rush TD", "rushing", e => e.rTd || 0],
  ["recYds", "Rec Yds", "receiving", e => e.recYds || 0],
  ["rec", "Receptions", "receiving", e => e.rec || 0],
  ["tgt", "Targets", "targets", e => e.tgt || 0],
  ["rrYds", "Rush + Rec Yds", "rushrec", e => (e.rYds || 0) + (e.recYds || 0)],
  ["prYds", "Pass + Rush Yds", "passrush", e => (e.pYds || 0) + (e.rYds || 0)],
  ["tds", "Any TD (rush/rec)", "anytd", e => (e.rTd || 0) + (e.recTd || 0)],
];
const DEFAULT_PROP = { passing: "pYds", rushing: "rYds", receiving: "recYds" };

function propOptions(groups) {
  const has = g => groups.includes(g);
  return PROP_STATS.filter(([, , grp]) => has(grp)
    || (grp === "targets" && has("receiving") && DATA.hasTargets)
    || (grp === "rushrec" && has("rushing") && has("receiving"))
    || (grp === "passrush" && has("passing") && has("rushing"))
    || (grp === "anytd" && (has("rushing") || has("receiving"))));
}

// Stat groups a prop can use for this position (plus the table the player was opened from),
// so a QB's one trick-play catch doesn't add receiving props.
const PROP_GROUPS_BY_POS = { QB: ["passing", "rushing"], RB: ["rushing", "receiving"], FB: ["rushing", "receiving"],
  WR: ["receiving", "rushing"], TE: ["receiving", "rushing"] };
function propGroups(groups, pos, kind) {
  const ok = PROP_GROUPS_BY_POS[(pos || "").toUpperCase()];
  return ok ? groups.filter(g => ok.includes(g) || g === kind) : groups;
}

function propToolHtml(groups, kind, pos) {
  const opts = propOptions(propGroups(groups, pos, kind));
  if (!opts.length) return "";
  const def = DEFAULT_PROP[kind] && opts.some(o => o[0] === DEFAULT_PROP[kind]) ? DEFAULT_PROP[kind] : opts[0][0];
  return `<div class="prop-tool">
    <div class="prop-inputs">
      <label>Prop <select class="prop-stat">${opts.map(([k, l]) => `<option value="${k}"${k === def ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Line <input class="prop-line" type="number" inputmode="decimal" step="0.5" min="0"></label>
    </div>
    <div class="prop-result" aria-live="polite"></div>
    <div class="prop-ctx"></div>
  </div>`;
}

// A line just under the season average: the highest x.5 below it.
function suggestLine(avg) {
  let x = Math.floor(avg - 0.5) + 0.5;
  if (x >= avg) x -= 1;
  return Math.max(0.5, x);
}

function updateProp(card, log) {
  const sel = card.querySelector(".prop-stat");
  if (!sel) return;
  const key = sel.value;
  const stat = PROP_STATS.find(s => s[0] === key);
  const lineEl = card.querySelector(".prop-line");
  const vals = log.map(stat[3]);
  const avg = vals.reduce((a, v) => a + v, 0) / (vals.length || 1);
  if (lineEl.dataset.stat !== key) {  // new stat: suggest a line just under the season average
    lineEl.value = suggestLine(avg);
    lineEl.dataset.stat = key;
  }
  const line = parseFloat(lineEl.value);
  const rows = card.querySelectorAll(".plog-scroll tbody tr");
  let over = 0, under = 0, push = 0;
  vals.forEach((v, i) => {
    const r = isNaN(line) ? "" : v > line ? "O" : v < line ? "U" : "P";
    if (r === "O") over++; else if (r === "U") under++; else if (r === "P") push++;
    const cell = rows[i] && rows[i].querySelector(".prop-cell");
    if (cell) cell.innerHTML = `${v}${r ? " " + resTag(r) : ""}`;
    if (rows[i]) { rows[i].classList.toggle("prop-over", r === "O"); rows[i].classList.toggle("prop-under", r === "U"); }
  });
  card.querySelector(".prop-head").textContent = stat[1];
  const res = card.querySelector(".prop-result");
  if (isNaN(line)) { res.textContent = "Enter a line to see how often he's cleared it."; return; }
  const n = over + under;
  const last = vals.slice(-3).map(v => (v > line ? "O" : v < line ? "U" : "P"));
  res.innerHTML = `Over ${line}: <b>${over} of ${vals.length} game${vals.length === 1 ? "" : "s"}</b>${n ? ` (${Math.round((100 * over) / n)}%)` : ""}`
    + `${push ? `, ${push} push${push === 1 ? "" : "es"}` : ""}. Avg ${avg.toFixed(1)}.`
    + ` Last ${last.length}: ${last.map(resTag).join(" ")}`;
}

// This week's game for an FBS team (by team name), or null.
function weekGameFor(teamName) {
  return (DATA.liveGames || DATA.weekGames || []).find(g => g.away.key === teamName || g.home.key === teamName) || null;
}

// What this week's opponent allows for the chosen stat, from its defense and Def vs Position numbers.
function oppContext(logKey, statKey, pos) {
  const team = teamOfLog(logKey);
  if (!team) return "";
  const g = weekGameFor(team.team);
  if (!g) return `${escapeHtml(team.abbr)} has no game in Week ${LIVE_WEEK || DATA.currentWeek}.`;
  const isAway = g.away.key === team.team;
  const oppSide = isAway ? g.home : g.away;
  const where = `${isAway && !g.neutral ? "@" : "vs"} ${escapeHtml(oppSide.abbr)}`;
  const opp = oppSide.key ? DATA.teams[oppSide.key] : null;
  if (!opp) return `Next: ${where}. ${escapeHtml(oppSide.name)} isn't FBS, so there are no defensive numbers for it.`;
  const n = Object.keys(DATA.teams).length;
  const d = opp.defense, dv = opp.defVsPosition;
  const P = (pos || "").toUpperCase();
  const isRb = P === "RB" || P === "FB";
  const rk = (getter, v, hi) => leagueRank(getter, v, !!hi);
  const dvp = k => dv && dv[k];
  const recKey = P === "TE" ? "te" : isRb ? "recRb" : P === "WR" ? "wr" : null;
  const recLbl = { te: "TEs", recRb: "RBs", wr: "WRs" }[recKey];
  let what, note = `Ranks out of ${n} FBS teams; #1 = allows the fewest.`;
  switch (statKey) {
    case "pYds": case "cmp": case "att":
      what = `${d.passYdsG} pass yds/G (#${d.passYdsGRank})`; break;
    case "pTd":
      what = `${d.passTdG} pass TD/G (#${rk(t => t.defense.passTdG, d.passTdG)})`; break;
    case "int":
      what = `${d.int} INT/G made (#${rk(t => t.defense.int, d.int, true)})`;
      note = `Rank out of ${n} FBS teams; #1 = most interceptions.`; break;
    case "prYds":
      what = `${d.passYdsG} pass yds/G (#${d.passYdsGRank}) and ${d.rushYdsG} rush yds/G (#${d.rushYdsGRank})`; break;
    case "rYds": case "car":
      what = isRb && dvp("rb") ? `${dv.rb.yds} rush yds/G to RBs (#${dv.rb.rank})` : `${d.rushYdsG} rush yds/G (#${d.rushYdsGRank})`; break;
    case "rTd":
      what = isRb && dvp("rb") ? `${dv.rb.td} rush TD/G to RBs (#${rk(t => t.defVsPosition.rb ? t.defVsPosition.rb.td : 0, dv.rb.td)})`
        : `${d.rushTdG} rush TD/G (#${rk(t => t.defense.rushTdG, d.rushTdG)})`; break;
    case "rrYds":
      what = isRb && dvp("rb") && dvp("recRb") ? `${dv.rb.yds} rush + ${dv.recRb.yds} rec yds/G to RBs (#${dv.rb.rank} / #${dv.recRb.rank})`
        : `${d.rushYdsG} rush yds/G (#${d.rushYdsGRank}) and ${d.passYdsG} pass yds/G (#${d.passYdsGRank})`; break;
    case "tds": {
      const ks = isRb ? ["rb", "recRb"] : recKey ? [recKey] : [];
      if (ks.length && ks.every(dvp)) {
        const v = +ks.reduce((a, k) => a + dv[k].td, 0).toFixed(2);
        const get = t => ks.reduce((a, k) => a + (t.defVsPosition[k] ? t.defVsPosition[k].td : 0), 0);
        what = `${v} ${isRb ? "rush + rec" : "rec"} TD/G to ${isRb ? "RBs" : recLbl} (#${rk(get, get(opp))})`;
      } else what = `${d.rushTdG} rush TD/G and ${d.passTdG} pass TD/G`;
      break;
    }
    default:  // recYds, rec, tgt
      what = recKey && dvp(recKey) ? `${dv[recKey].yds} rec yds/G to ${recLbl} (#${dv[recKey].rank})` : `${d.passYdsG} pass yds/G (#${d.passYdsGRank})`;
  }
  return `Next: ${where}. ${escapeHtml(opp.abbr)} allows ${what}. <span class="rk">${note}</span>`;
}

/* ---------------- Player search (top bar, every page) ---------------- */

let PLAYER_INDEX = null;  // log key -> { key, name, pos, team, abbr, kind }
const PRIMARY_KIND = { QB: "passing", RB: "rushing", FB: "rushing", WR: "receiving", TE: "receiving" };
function playerIndex() {
  if (PLAYER_INDEX) return PLAYER_INDEX;
  PLAYER_INDEX = {};
  for (const t of Object.values(DATA.teams)) {
    for (const kind of ["passing", "rushing", "receiving"]) {
      for (const r of t[kind] || []) {
        if (!r.log || !DATA.gameLogs[r.log]) continue;
        const p = PLAYER_INDEX[r.log];
        if (!p) PLAYER_INDEX[r.log] = { key: r.log, name: r.player, pos: r.pos || "", team: t.team, abbr: t.abbr, kind };
        else if (PRIMARY_KIND[p.pos] === kind) p.kind = kind;
      }
    }
  }
  return PLAYER_INDEX;
}

function initPlayerSearch() {
  const bar = document.querySelector(".topbar");
  if (!bar || bar.querySelector(".psearch") || !DATA.gameLogs) return;
  const wrap = document.createElement("div");
  wrap.className = "psearch no-print";
  wrap.innerHTML = `<input type="search" placeholder="Search players" aria-label="Search players" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="psearchList">
    <ul class="psearch-list" id="psearchList" role="listbox" hidden></ul>`;
  (bar.querySelector(".topnav") || bar).appendChild(wrap);
  const input = wrap.querySelector("input"), list = wrap.querySelector("ul");
  let hits = [], active = -1;
  const norm = x => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’-]/g, "");
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const render = () => {
    list.innerHTML = hits.map((p, i) => `<li role="option" id="ps-opt-${i}" data-i="${i}" class="${i === active ? "active" : ""}" aria-selected="${i === active}">
      <span class="ps-name">${escapeHtml(p.name)}</span><span class="ps-meta">${escapeHtml([p.pos, p.abbr].filter(Boolean).join(", "))}</span></li>`).join("")
      || `<li class="ps-empty">No players found</li>`;
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", `ps-opt-${active}`);
      const li = list.querySelector(`[data-i="${active}"]`);
      if (li) li.scrollIntoView({ block: "nearest" });
    }
  };
  const pick = i => {
    const p = hits[i];
    if (!p) return;
    close(); input.value = "";
    if (window.openPlayerLog) window.openPlayerLog(p, input);
  };
  input.addEventListener("input", () => {
    const q = norm(input.value.trim());
    if (q.length < 2) { close(); return; }
    const score = p => { const n = norm(p.name); return n.startsWith(q) ? 0 : n.split(" ").some(w => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : 9; };
    hits = Object.values(playerIndex()).map(p => [score(p), p]).filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 10).map(([, p]) => p);
    active = hits.length ? 0 : -1;
    render();
  });
  input.addEventListener("keydown", e => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter") { pick(active); e.preventDefault(); }
    else if (e.key === "Escape") { close(); e.stopPropagation(); }
  });
  list.addEventListener("mousedown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

/* ---------------- Weekly Edges (edges.html) ---------------- */

function initEdges() {
  const all = (DATA.weekGames || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start) || a.id.localeCompare(b.id));
  document.getElementById("edgesTitle").textContent = DATA.currentWeek ? `Week ${DATA.currentWeek} Edges` : "Weekly Edges";
  document.getElementById("edgesSub").textContent =
    `${all.length} game${all.length === 1 ? "" : "s"}. Team stats through Week ${DATA.throughWeek}.`;
  const confSel = document.getElementById("confFilter"), ranked = document.getElementById("rankedOnly");
  const confs = new Set();
  all.forEach(g => [g.away, g.home].forEach(s => s.conference && confs.add(s.conference)));
  confSel.innerHTML = `<option value="">All conferences</option>` +
    [...confs].sort().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  const draw = () => {
    const conf = confSel.value, top = ranked.checked;
    const shown = all.filter(g => (!conf || [g.away, g.home].some(s => s.conference === conf)) && (!top || [g.away, g.home].some(s => s.rank)));
    document.getElementById("gameBoard").innerHTML = gameBoard(shown);
    document.getElementById("propBoards").innerHTML = propBoards(shown);
    document.getElementById("boardCount").textContent = shown.length === all.length ? "" : `${shown.length} of ${all.length} games shown`;
  };
  [confSel, ranked].forEach(el => el.addEventListener("input", draw));
  draw();
  if (typeof refreshLines === "function" && DATA.currentWeek) refreshLines(new Set(all.map(g => g.id)), draw);
}

function netEpa(t) { return t && t.eff ? t.eff.off.epa - t.eff.def.epa : null; }

function gameBoard(games) {
  if (!games.length) return `<div class="empty-note">No games match those filters.</div>`;
  const rows = games.map(g => {
    const a = g.away.key ? DATA.teams[g.away.key] : null, h = g.home.key ? DATA.teams[g.home.key] : null;
    const ln = lineFor(g), it = impliedTotals(g);
    const spread = !ln ? "—" : ln.pick ? "PK" : ln.fav ? `${g[ln.fav].abbr} ${MINUS}${ln.spread}` : "—";
    const m = lineMove(g);
    const move = !m ? "—" : lineMoveBits(m).join(", ") || `None since ${m.when}`;
    const na = netEpa(a), nh = netEpa(h);
    let epa = `<span class="rk">—</span>`;
    if (na != null && nh != null) {
      const better = na >= nh ? g.away : g.home;
      epa = `${escapeHtml(better.abbr)} <b>+${Math.abs(na - nh).toFixed(2)}</b>`;
    }
    const d = new Date(g.start);
    const when = g.completed ? "Final" : d.toLocaleDateString(undefined, { weekday: "short" }) + " " +
      (g.timeTbd ? "TBD" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    const side = s => `${rankTag(s.rank)}${slabHtml(s.abbr || s.name, s.name)}`;
    return `<tr>
      <td>${escapeHtml(when)}</td>
      <td><a class="board-link" href="matchup.html?game=${encodeURIComponent(g.id)}">${side(g.away)} <span class="board-at">${g.neutral ? "vs" : "at"}</span> ${side(g.home)}</a></td>
      <td class="num">${escapeHtml(spread)}</td>
      <td class="num">${ln && ln.total != null ? ln.total : "—"}</td>
      <td class="num">${it && !g.completed ? `${escapeHtml(g.away.abbr)} ${it.away}, ${escapeHtml(g.home.abbr)} ${it.home}` : "—"}</td>
      <td class="move">${escapeHtml(move)}</td>
      <td class="num">${epa}</td>
    </tr>`;
  }).join("");
  return `<table class="board-table">
    <thead><tr><th>Kickoff</th><th>Game</th><th class="num">Spread</th><th class="num">O/U</th><th class="num">Implied</th><th>Line move</th><th class="num" title="Offense EPA/play minus defense EPA/play allowed; the better team and the gap between them">Net EPA edge</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// [title, player table, positions, stat group in the log, opponent-allowed getter, rank getter, what]
const PROP_BOARDS = [
  ["QB pass yds", "passing", ["QB"], "passing", t => t.defense.passYdsG, t => t.defense.passYdsGRank, "pass yds/G"],
  ["RB rush yds", "rushing", ["RB", "FB"], "rushing", t => t.defVsPosition.rb && t.defVsPosition.rb.yds, t => t.defVsPosition.rb && t.defVsPosition.rb.rank, "rush yds/G to RBs"],
  ["WR rec yds", "receiving", ["WR"], "receiving", t => t.defVsPosition.wr && t.defVsPosition.wr.yds, t => t.defVsPosition.wr && t.defVsPosition.wr.rank, "rec yds/G to WRs"],
  ["TE rec yds", "receiving", ["TE"], "receiving", t => t.defVsPosition.te && t.defVsPosition.te.yds, t => t.defVsPosition.te && t.defVsPosition.te.rank, "rec yds/G to TEs"],
];

function propBoards(games) {
  const opp = {};  // team name -> { t: opponent team, at }
  for (const g of games) {
    if (g.completed || !g.away.key || !g.home.key || !DATA.teams[g.away.key] || !DATA.teams[g.home.key]) continue;  // FBS vs FBS, not played yet
    opp[g.away.key] = { t: DATA.teams[g.home.key], at: !g.neutral };
    opp[g.home.key] = { t: DATA.teams[g.away.key], at: false };
  }
  const teams = Object.values(DATA.teams);
  const n = teams.length;
  return PROP_BOARDS.map(([title, table, positions, grp, allowed, allowedRank, what]) => {
    const vals = teams.map(allowed).filter(v => v != null);
    const lg = vals.reduce((a, v) => a + v, 0) / (vals.length || 1);
    const rows = [];
    for (const t of teams) {
      const o = opp[t.team];
      if (!o || allowed(o.t) == null) continue;
      const f = lg ? allowed(o.t) / lg : 1;
      if (f <= 1) continue;
      const teamGames = t.record.w + t.record.l + t.record.t;
      for (const r of t[table] || []) {
        if (!positions.includes((r.pos || "").toUpperCase())) continue;
        const log = DATA.gameLogs[r.log] || [];
        if (log.filter(hasGroup[grp]).length < teamGames / 2) continue;  // regulars only
        rows.push({ r, t, o, f, adj: r.ydsG * f });
      }
    }
    rows.sort((x, y) => y.adj - x.adj);
    const body = rows.slice(0, 10).map(({ r, t, o, f, adj }) => `<tr>
      <td><button type="button" class="plink" data-log="${escapeHtml(r.log)}" data-kind="${table}" data-pos="${escapeHtml(r.pos || "")}" data-name="${escapeHtml(r.player)}">${escapeHtml(r.player)}</button></td>
      <td>${escapeHtml(t.abbr)} ${o.at ? "@" : "vs"} ${escapeHtml(o.t.abbr)}</td>
      <td class="num">${r.ydsG}</td>
      <td class="num">${allowed(o.t)} <span class="rk">#${allowedRank(o.t)}</span></td>
      <td class="num"><span class="tag W">×${f.toFixed(2)}</span></td>
      <td class="num"><b>${adj.toFixed(1)}</b></td>
    </tr>`).join("");
    return `<div class="table-block">
      <h4>${escapeHtml(title)}</h4>
      ${body ? `<table><thead><tr><th>Player</th><th>Game</th><th class="num">Avg</th><th class="num" title="${escapeHtml(`Opponent allows ${what}; rank out of ${n}, #1 = fewest`)}">Opp allows</th><th class="num">Matchup</th><th class="num">Adj</th></tr></thead><tbody>${body}</tbody></table>`
        : `<div class="empty-note">No favorable matchups in the games shown.</div>`}
      <p class="bet-note">FBS average allowed: ${lg.toFixed(1)} ${escapeHtml(what)}.</p>
    </div>`;
  }).join("");
}

/* ---------------- Team games: hover tooltip + click panel with box scores ---------------- */
// DATA.teamGames[team name] = [{ w, opp, at, res, espnId, pass: { n, yds, td, cmp, att }, rush: { n, yds, td, car },
// rec: { n, yds, td, rec } }], one entry per completed game. pass / rush / rec are that
// team's leaders by yards in the game. The box score comes from ESPN (pastBoxScore in live.js).

// A team name that opens the team's game list. Plain text when the data has no games.
function teamGamesOf(t) { return (t && DATA.teamGames && DATA.teamGames[t.team]) || []; }
function recordText(t) { return `${t.record.w}-${t.record.l}${t.record.t ? "-" + t.record.t : ""}`; }
function teamLink(t) {
  const name = escapeHtml(t.team);
  return teamGamesOf(t).length ? `<button type="button" class="tlink" data-team="${name}">${name}</button>` : name;
}

function shortName(n) {
  const p = String(n).trim().split(/\s+/);
  return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : String(n);
}
const TG_LEADERS = [
  ["pass", "High passer", "Pass", l => `${l.cmp}/${l.att}`],
  ["rush", "High rusher", "Rush", l => `${l.car} car`],
  ["rec", "High receiver", "Rec", l => `${l.rec} rec`],
];
function resClass(res) { return res && res[0] === "W" ? "pos" : res && res[0] === "L" ? "neg" : ""; }

function teamTipHtml(t) {
  const body = teamGamesOf(t).map(e => `<tr><td>${e.w}</td><td>${escapeHtml(oppText(e))}</td>
    <td class="res ${resClass(e.res)}">${escapeHtml(e.res || "")}</td>
    ${TG_LEADERS.map(([k]) => `<td>${e[k] ? `${escapeHtml(shortName(e[k].n))} <b>${e[k].yds}</b>` : "—"}</td>`).join("")}</tr>`).join("");
  return `<div class="ptip-head"><b>${escapeHtml(t.team)}</b><span>${recordText(t)}</span></div>
    <table><thead><tr><th>Wk</th><th>Opp</th><th>Result</th>${TG_LEADERS.map(([, , l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
    <div class="ptip-foot">Click for all games and box scores</div>`;
}

function teamGamesHtml(t) {
  const cell = (e, [k, label, , extra]) => {
    const l = e[k];
    if (!l) return `<td class="gstart tg-lead" data-label="${label}">—</td>`;
    return `<td class="gstart tg-lead" data-label="${label}"><div class="tg-name">${escapeHtml(l.n)}</div>
      <div class="tg-line">${extra(l)}, <b>${l.yds}</b> yds${l.td ? `, ${l.td} TD` : ""}</div></td>`;
  };
  const body = teamGamesOf(t).map((e, i) => `<tr class="tg-row" data-i="${i}">
    <td>${e.w}</td><td>${escapeHtml(oppText(e))}</td><td class="res ${resClass(e.res)}">${escapeHtml(e.res || "")}</td>
    ${TG_LEADERS.map(c => cell(e, c)).join("")}
    <td class="gstart tg-go"><button type="button" class="tg-open" data-i="${i}" aria-label="Box score, week ${e.w} ${escapeHtml(oppText(e))}">Box score</button></td></tr>`).join("");
  return `<table class="tg-table">
    <thead><tr><th>Wk</th><th>Opp</th><th>Result</th>${TG_LEADERS.map(([, l]) => `<th class="gstart">${l}</th>`).join("")}<th class="gstart"></th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

(function setupTeamGames() {
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let tip = null, panel = null, lastFocus = null, quiet = false, team = null, showing = 0;

  const teamOf = btn => (DATA && DATA.teams && DATA.teams[btn.dataset.team]) || null;
  function hideTip() { if (tip) tip.hidden = true; }
  function showTip(btn) {
    const t = teamOf(btn);
    if (!t || !teamGamesOf(t).length || (panel && !panel.hidden)) return;
    if (!tip) { tip = document.createElement("div"); tip.className = "ptip ttip no-print"; document.body.appendChild(tip); }
    tip.innerHTML = teamTipHtml(t);
    tip.hidden = false;
    const r = btn.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2, top = r.bottom + 6;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = r.top - h - 6;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    showing++;
    document.body.classList.remove("plog-open");
    if (lastFocus) { quiet = true; lastFocus.focus(); quiet = false; }
  }
  function frame(title, sub, back, body, note) {
    panel.innerHTML = `<div class="plog-card tg-card" role="dialog" aria-modal="true" aria-labelledby="tgTitle">
      <div class="plog-top">
        <div>
          ${back ? `<button type="button" class="tg-back">All ${escapeHtml(team.team)} games</button>` : ""}
          <h3 id="tgTitle">${title}</h3>
          <div class="plog-sub">${sub}</div>
        </div>
        <button type="button" class="plog-close" aria-label="Close">✕</button>
      </div>
      <div class="plog-scroll tg-body">${body}</div>
      <div class="plog-note">${note}</div>
    </div>`;
    panel.querySelector(".tg-body").scrollTop = 0;
  }
  function showList(focusRow) {
    showing++;
    const n = teamGamesOf(team).length;
    frame(escapeHtml(team.team), `${recordText(team)}, ${n} game${n === 1 ? "" : "s"}. Pick a game to see its box score`, false,
      teamGamesHtml(team),
      `High passer, rusher and receiver are ${escapeHtml(team.abbr)}'s leaders by yards in each game. Completed games through Week ${DATA.throughWeek}.`);
    const target = focusRow != null && panel.querySelector(`.tg-open[data-i="${focusRow}"]`);
    (target || panel.querySelector(".plog-close")).focus();
  }
  function showBox(i) {
    const e = teamGamesOf(team)[i];
    if (!e) return;
    const mine = ++showing;
    const espn = e.espnId && typeof espnGameUrl === "function"
      ? ` <a href="${espnGameUrl(e.espnId)}" target="_blank" rel="noopener">Open this game on ESPN</a>` : "";
    frame(`Week ${e.w}, ${escapeHtml(team.abbr)} ${escapeHtml(oppText(e))}`,
      `<span class="res ${resClass(e.res)}">${escapeHtml(e.res || "")}</span>, ${escapeHtml(team.team)}`, true,
      `<div class="empty-note tg-wait">Loading the box score…</div>`, `Box score from ESPN.${espn}`);
    panel.querySelector(".tg-back").dataset.i = i;
    panel.querySelector(".tg-back").focus();
    const body = panel.querySelector(".tg-body");
    const fail = () => {
      if (mine !== showing) return;
      const leaders = TG_LEADERS.filter(([k]) => e[k]).map(([k, label, , extra]) =>
        `<li>${label}: <b>${escapeHtml(e[k].n)}</b>, ${extra(e[k])}, ${e[k].yds} yds${e[k].td ? `, ${e[k].td} TD` : ""}</li>`).join("");
      body.innerHTML = `<div class="empty-note">The box score for this game isn't available right now.${espn}</div>
        ${leaders ? `<ul class="tg-fallback">${leaders}</ul>` : ""}`;
    };
    if (!e.espnId || typeof pastBoxScore !== "function") { fail(); return; }
    pastBoxScore(e.espnId).then(html => { if (mine === showing) body.innerHTML = html; }, fail);
  }
  function openPanel(btn) {
    const t = teamOf(btn);
    if (!t || !teamGamesOf(t).length) return;
    hideTip();
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "plog tgames no-print";
      panel.addEventListener("click", e => {
        if (e.target === panel || e.target.closest(".plog-close")) { closePanel(); return; }
        const back = e.target.closest(".tg-back");
        if (back) { showList(back.dataset.i); return; }
        const row = e.target.closest(".tg-row");
        if (row) showBox(+row.dataset.i);
      });
      document.body.appendChild(panel);
    }
    lastFocus = btn;
    team = t;
    panel.hidden = false;
    document.body.classList.add("plog-open");
    showList();
  }

  document.addEventListener("click", e => {
    const btn = e.target.closest(".tlink");
    if (btn) openPanel(btn);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closePanel(); hideTip(); } });
  if (canHover) {
    document.addEventListener("mouseover", e => {
      const btn = e.target.closest(".tlink");
      if (btn) showTip(btn);
    });
    document.addEventListener("mouseout", e => {
      const btn = e.target.closest(".tlink");
      if (btn && !btn.contains(e.relatedTarget)) hideTip();
    });
    document.addEventListener("focusin", e => { const b = e.target.closest && e.target.closest(".tlink"); if (b && !quiet) showTip(b); });
    document.addEventListener("focusout", e => { if (e.target.closest && e.target.closest(".tlink")) hideTip(); });
  }
  window.addEventListener("scroll", hideTip, { passive: true });
})();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
