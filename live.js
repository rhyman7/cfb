// Live scores (weekly slate) and live box score (matchup page), fetched in the
// viewer's browser from ESPN's public site API. The feed is unofficial, so every
// read is defensive: if anything fails or looks different, the page simply stays
// as it was built from data.json.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const POLL_LIVE_MS = 30 * 1000;      // while a game is in progress
const POLL_SOON_MS = 60 * 1000;      // shortly before kickoff
const PREGAME_WINDOW_MS = 20 * 60 * 1000;
const MAX_GAME_MS = 6 * 60 * 60 * 1000;

/* ---------------- shared helpers ---------------- */

async function espnJson(path) {
  const res = await fetch(`${ESPN_BASE}/${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error("ESPN HTTP " + res.status);
  return res.json();
}

const num = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// Pull status + both sides out of an ESPN "competition" object.
function parseCompetition(comp, status) {
  status = status || comp.status || {};
  const type = status.type || {};
  const out = {
    state: type.state || null,                       // "pre" | "in" | "post"
    detail: type.shortDetail || type.detail || type.description || "",
    period: status.period || null,
    clock: status.displayClock || "",
  };
  (comp.competitors || []).forEach(c => {
    const side = c.homeAway === "home" ? "home" : c.homeAway === "away" ? "away" : null;
    if (!side) return;
    out[side] = {
      id: String(c.id || (c.team && c.team.id) || ""),
      abbr: (c.team && c.team.abbreviation) || "",
      score: num(c.score && typeof c.score === "object" ? c.score.value : c.score),
      lines: (c.linescores || []).map(l => num(l.value !== undefined ? l.value : l.displayValue)),
    };
    if (c.possession) out.possession = side;
  });
  const sit = comp.situation;
  if (sit) {
    if (sit.possession && out.home && String(sit.possession) === out.home.id) out.possession = "home";
    else if (sit.possession && out.away && String(sit.possession) === out.away.id) out.possession = "away";
    out.downDistance = sit.downDistanceText || sit.shortDownDistanceText || "";
    out.lastPlay = (sit.lastPlay && sit.lastPlay.text) || "";
  }
  return out;
}

// Could this game be live (or have just finished) right now, going by kickoff time?
function inGameWindow(g, now) {
  const start = new Date(g.start).getTime();
  return now >= start - PREGAME_WINDOW_MS && now <= start + MAX_GAME_MS;
}

function whenVisible(fn) {
  if (!document.hidden) return fn();
  const onVis = () => {
    if (!document.hidden) { document.removeEventListener("visibilitychange", onVis); fn(); }
  };
  document.addEventListener("visibilitychange", onVis);
}

function setLiveNote(text) {
  const el = document.getElementById("liveNote");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}

// Once per page load: pull ESPN's current spread and O/U for this week's games.
// If it fails or a game has no odds, the page keeps the line from data.json.
function refreshLines(ids, onChange) {
  espnJson(`scoreboard?groups=80&seasontype=2&week=${DATA.currentWeek}&limit=400`).then(sb => {
    let changed = false;
    (sb.events || []).forEach(ev => {
      const id = String(ev.id);
      if (!ids.has(id)) return;
      const odds = (((ev.competitions || [])[0] || {}).odds || [])[0];
      if (!odds) return;
      const total = typeof odds.overUnder === "number" ? odds.overUnder : parseFloat(odds.overUnder);
      const details = typeof odds.details === "string" ? odds.details.trim() : "";
      if (!details && !Number.isFinite(total)) return;
      LINES[id] = { details: details || null, total: Number.isFinite(total) ? total : null };
      changed = true;
    });
    if (changed) onChange();
  }).catch(() => {});
}

/* ---------------- weekly slate ---------------- */

function startLiveWeek(games, rerender) {
  if (!games.length || !DATA.currentWeek) return;
  const ids = new Set(games.map(g => g.id));
  let timer = null;

  const needsFetch = now => games.some(g => {
    const L = LIVE[g.id];
    if (L && L.state === "post") return false;
    if (g.completed) return false;
    return new Date(g.start).getTime() <= now + PREGAME_WINDOW_MS;   // started, or about to
  });

  const schedule = ms => { clearTimeout(timer); timer = setTimeout(() => whenVisible(tick), ms); };

  refreshLines(ids, rerender);

  async function tick() {
    const now = Date.now();
    if (!needsFetch(now)) {
      // nothing live yet: check back shortly before the next kickoff (if it's today-ish)
      const next = games.map(g => new Date(g.start).getTime()).filter(t => t > now).sort((a, b) => a - b)[0];
      if (next && next - now < 12 * 60 * 60 * 1000) schedule(Math.max(next - PREGAME_WINDOW_MS - now, POLL_SOON_MS));
      return;
    }
    try {
      const sb = await espnJson(`scoreboard?groups=80&seasontype=2&week=${DATA.currentWeek}&limit=400`);
      (sb.events || []).forEach(ev => {
        const id = String(ev.id);
        if (!ids.has(id)) return;
        const comp = (ev.competitions || [])[0];
        if (comp) LIVE[id] = parseCompetition(comp, ev.status || comp.status);
      });
      setLiveNote("");
    } catch (err) {
      const shouldBeLive = games.some(g => !g.completed && inGameWindow(g, now));
      setLiveNote(shouldBeLive ? "Live scores aren't available right now. Showing kickoff times." : "");
    }
    rerender();
    const anyLive = Object.values(LIVE).some(L => L.state === "in");
    const soon = games.some(g => !g.completed && (LIVE[g.id] || {}).state !== "post" && inGameWindow(g, Date.now()));
    if (anyLive) schedule(POLL_LIVE_MS);
    else if (soon) schedule(POLL_SOON_MS);
    else schedule(15 * 60 * 1000);   // quiet stretch between game windows
  }

  whenVisible(tick);
}

/* ---------------- matchup page ---------------- */

const TEAM_STAT_ROWS = [
  ["firstDowns", "First downs"],
  ["totalYards", "Total yards"],
  ["netPassingYards", "Passing yards"],
  ["completionAttempts", "Comp / Att"],
  ["yardsPerPass", "Yards per pass"],
  ["rushingYards", "Rushing yards"],
  ["rushingAttempts", "Rushing attempts"],
  ["yardsPerRushAttempt", "Yards per rush"],
  ["thirdDownEff", "3rd down"],
  ["fourthDownEff", "4th down"],
  ["turnovers", "Turnovers"],
  ["fumblesLost", "Fumbles lost"],
  ["interceptions", "Interceptions thrown"],
  ["totalPenaltiesYards", "Penalties"],
  ["possessionTime", "Possession"],
];

const PLAYER_TABLES = [
  // category, title, max rows, [key, label] columns
  ["passing", "Passing", 3, [["completions/passingAttempts", "C/ATT"], ["passingYards", "YDS"], ["passingTouchdowns", "TD"], ["interceptions", "INT"]]],
  ["rushing", "Rushing", 5, [["rushingAttempts", "CAR"], ["rushingYards", "YDS"], ["rushingTouchdowns", "TD"], ["longRushing", "LONG"]]],
  ["receiving", "Receiving", 6, [["receptions", "REC"], ["receivingYards", "YDS"], ["receivingTouchdowns", "TD"], ["longReception", "LONG"]]],
];

function startLiveMatchup(g) {
  const box = document.getElementById("boxscore");
  if (!box) return;
  let timer = null;
  const schedule = ms => { clearTimeout(timer); timer = setTimeout(() => whenVisible(tick), ms); };

  async function tick() {
    const now = Date.now();
    const start = new Date(g.start).getTime();
    if (!g.completed && now < start - PREGAME_WINDOW_MS) {
      // too early: check again closer to kickoff if it's within half a day
      if (start - now < 12 * 60 * 60 * 1000) schedule(start - PREGAME_WINDOW_MS - now);
      return;
    }
    let state = null;
    try {
      const s = await espnJson(`summary?event=${encodeURIComponent(g.id)}`);
      const comp = s.header && s.header.competitions && s.header.competitions[0];
      if (!comp) throw new Error("no header");
      const L = parseCompetition(comp, comp.status);
      if (!comp.situation && s.situation) {
        // the summary sometimes carries down/distance at the top level
        const sit = parseCompetition({ competitors: comp.competitors, situation: s.situation }, comp.status);
        if (sit.possession) L.possession = sit.possession;
        if (sit.downDistance) L.downDistance = sit.downDistance;
        if (sit.lastPlay) L.lastPlay = sit.lastPlay;
      }
      state = L.state;
      LIVE[g.id] = L;
      updateHeroLive(g, L);
      if (state === "in" || state === "post") {
        box.innerHTML = renderBoxScore(g, L, s);
        box.hidden = false;
      } else {
        box.hidden = true;
      }
    } catch (err) {
      if (!g.completed && inGameWindow(g, now) && box.hidden) {
        box.innerHTML = `<h3 class="section-title">Box Score</h3><div class="empty-note">The live box score isn't available right now.</div>`;
        box.hidden = false;
      }
    }
    if (state === "in") schedule(POLL_LIVE_MS);
    else if (state === "pre" || (state === null && inGameWindow(g, Date.now()))) schedule(POLL_SOON_MS);
  }

  box.hidden = true;
  whenVisible(tick);
}

function updateHeroLive(g, L) {
  const line = document.getElementById("heroLive");
  if (L.state === "in" || L.state === "post") {
    ["away", "home"].forEach(side => {
      const el = document.querySelector(`.hero-team[data-side="${side}"] .hero-score`);
      if (!el || !L[side] || L[side].score == null) return;
      const other = L[side === "away" ? "home" : "away"];
      const lead = L.state === "post" && other && other.score != null && L[side].score > other.score;
      el.innerHTML = `${L[side].score}${L.state === "in" && L.possession === side ? ' <span class="poss" title="Has the ball">●</span>' : ""}`;
      el.classList.toggle("won", lead);
      el.hidden = false;
    });
  }
  if (!line) return;
  if (L.state === "in") {
    line.innerHTML = `<span class="live-badge">Live</span> ${escapeHtml(L.detail)}` +
      (L.downDistance ? ` · ${escapeHtml(L.downDistance)}` : "");
    line.hidden = false;
  } else if (L.state === "post") {
    line.innerHTML = `<span class="final-badge">${escapeHtml(L.detail || "Final")}</span>`;
    line.hidden = false;
  } else {
    line.hidden = true;
  }
}

function renderBoxScore(g, L, s) {
  const awayAbbr = g.away.abbr || g.away.name, homeAbbr = g.home.abbr || g.home.name;
  const idToSide = {};
  if (L.away && L.away.id) idToSide[L.away.id] = "away";
  if (L.home && L.home.id) idToSide[L.home.id] = "home";
  const abbrOf = side => side === "away" ? awayAbbr : side === "home" ? homeAbbr : "";

  const status = L.state === "in"
    ? `<span class="live-badge">Live</span> <span class="box-status">${escapeHtml(L.detail)}</span>`
    : `<span class="final-badge">${escapeHtml(L.detail || "Final")}</span>`;

  const parts = [lineScore(g, L, awayAbbr, homeAbbr), teamStats(s, idToSide, awayAbbr, homeAbbr)].filter(Boolean);
  const players = playerStats(s, idToSide, abbrOf);
  const scoring = scoringPlays(s, idToSide, abbrOf);

  return `
    <h3 class="section-title">Box Score ${status}</h3>
    <div class="box-grid">${parts.join("")}</div>
    ${players}
    ${scoring}
    <p class="edge-key">Live data from ESPN${L.state === "in" ? " · updates every 30 seconds" : ""}. Season stats below are as of Week ${DATA.throughWeek}.</p>`;
}

function lineScore(g, L, awayAbbr, homeAbbr) {
  if (!L.away || !L.home) return "";
  const n = Math.max(4, L.away.lines.length, L.home.lines.length);
  const head = Array.from({ length: n }, (_, i) => `<th class="num">${i < 4 ? i + 1 : n > 5 ? "OT" + (i - 3) : "OT"}</th>`).join("");
  const row = (abbr, side) => {
    const cells = Array.from({ length: n }, (_, i) => {
      const v = L[side].lines[i];
      return `<td class="num">${v == null ? "" : v}</td>`;
    }).join("");
    return `<tr><td class="lbl"><b>${escapeHtml(abbr)}</b>${L.state === "in" && L.possession === side ? ' <span class="poss">●</span>' : ""}</td>${cells}<td class="num tot"><b>${L[side].score == null ? "" : L[side].score}</b></td></tr>`;
  };
  return `<div class="edge-panel box-panel">
    <h4>Scoring by quarter</h4>
    <table class="edge-table box-table">
      <thead><tr><th></th>${head}<th class="num">T</th></tr></thead>
      <tbody>${row(awayAbbr, "away")}${row(homeAbbr, "home")}</tbody>
    </table>
    ${L.state === "in" && L.lastPlay ? `<div class="box-lastplay"><span>Last play:</span> ${escapeHtml(L.lastPlay)}</div>` : ""}
  </div>`;
}

function teamStats(s, idToSide, awayAbbr, homeAbbr) {
  const teams = (s.boxscore && s.boxscore.teams) || [];
  const bySide = {};
  teams.forEach((t, i) => {
    const side = idToSide[String(t.team && t.team.id)] || (t.homeAway === "home" ? "home" : t.homeAway === "away" ? "away" : (i === 0 ? "away" : "home"));
    bySide[side] = {};
    (t.statistics || []).forEach(st => { bySide[side][st.name] = st; });
  });
  if (!bySide.away || !bySide.home) return "";
  let rows = TEAM_STAT_ROWS.filter(([k]) => bySide.away[k] || bySide.home[k])
    .map(([k, label]) => [label, bySide.away[k], bySide.home[k]]);
  if (!rows.length) {
    // unfamiliar stat names: show whatever ESPN sent, with its own labels
    rows = Object.keys(bySide.away).map(k => [bySide.away[k].label || k, bySide.away[k], bySide.home[k]]);
  }
  if (!rows.length) return "";
  const val = st => escapeHtml(st ? (st.displayValue !== undefined ? st.displayValue : st.value) : "–");
  return `<div class="edge-panel box-panel">
    <h4>Team stats</h4>
    <table class="edge-table box-table">
      <thead><tr><th></th><th class="num">${escapeHtml(awayAbbr)}</th><th class="num">${escapeHtml(homeAbbr)}</th></tr></thead>
      <tbody>${rows.map(([label, a, h]) => `<tr><td class="lbl">${escapeHtml(label)}</td><td class="num"><b>${val(a)}</b></td><td class="num"><b>${val(h)}</b></td></tr>`).join("")}</tbody>
    </table>
  </div>`;
}

function playerStats(s, idToSide, abbrOf) {
  const groups = (s.boxscore && s.boxscore.players) || [];
  const bySide = {};
  groups.forEach((p, i) => {
    const side = idToSide[String(p.team && p.team.id)] || (i === 0 ? "away" : "home");
    bySide[side] = p.statistics || [];
  });
  const panels = ["away", "home"].filter(side => bySide[side]).map(side => {
    const tables = PLAYER_TABLES.map(([cat, title, max, cols]) => {
      const st = bySide[side].find(x => x.name === cat);
      if (!st || !(st.athletes || []).length) return "";
      const keys = st.keys || [], labels = st.labels || [];
      const idx = cols.map(([k, lab]) => {
        const i = keys.indexOf(k);
        return i >= 0 ? i : labels.indexOf(lab);
      });
      const body = st.athletes.slice(0, max).map(a => {
        const name = (a.athlete && (a.athlete.displayName || a.athlete.shortName)) || "";
        const cells = idx.map(i => `<td class="num">${i >= 0 && a.stats && a.stats[i] !== undefined ? escapeHtml(a.stats[i]) : "–"}</td>`).join("");
        return `<tr><td>${escapeHtml(name)}</td>${cells}</tr>`;
      }).join("");
      return `<div class="box-sub">
        <div class="box-sub-title">${title}</div>
        <table class="edge-table box-table box-players-table">
          <thead><tr><th></th>${cols.map(([, lab]) => `<th class="num">${lab}</th>`).join("")}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
    }).join("");
    if (!tables) return "";
    return `<div class="edge-panel box-panel"><h4>${escapeHtml(abbrOf(side))} players</h4>${tables}</div>`;
  }).filter(Boolean);
  return panels.length ? `<div class="box-grid">${panels.join("")}</div>` : "";
}

function scoringPlays(s, idToSide, abbrOf) {
  const plays = s.scoringPlays || [];
  if (!plays.length) return "";
  const rows = plays.map(p => {
    const side = idToSide[String(p.team && p.team.id)];
    const q = p.period && p.period.number ? (p.period.number > 4 ? "OT" : "Q" + p.period.number) : "";
    const clock = (p.clock && p.clock.displayValue) || "";
    const type = (p.type && (p.type.abbreviation || p.type.text)) || p.scoringType && p.scoringType.abbreviation || "";
    const score = p.awayScore !== undefined && p.homeScore !== undefined ? `${p.awayScore}–${p.homeScore}` : "";
    return `<tr>
      <td class="lbl">${escapeHtml(q)} ${escapeHtml(clock)}</td>
      <td><b>${escapeHtml(abbrOf(side) || (p.team && p.team.abbreviation) || "")}</b></td>
      <td class="lbl">${escapeHtml(type)}</td>
      <td class="play-text">${escapeHtml(p.text || "")}</td>
      <td class="num"><b>${escapeHtml(score)}</b></td>
    </tr>`;
  }).join("");
  return `<div class="edge-panel box-panel box-scoring">
    <h4>Scoring plays</h4>
    <table class="edge-table box-table">
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
