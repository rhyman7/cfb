// EPA page: opponent-adjusted EPA for this week's games, an EPA line against the market,
// and ratings for every team. Ratings come from data/epa.json (scripts/epa_ratings.py);
// the projections are worked out here from those ratings and the current lines.
// The NFL and CFB sites share this file except for the SITE block. app.js loads the data
// and calls initEpa() on epa.html.

/* ---------------- site adapter (CFB) ---------------- */
const SITE = {
  league: "CFB",
  pickerButtons: false,          // 50+ games a week: a dropdown instead of buttons
  load: async () => {},          // app.js has already loaded data.json
  week: () => DATA.currentWeek,
  games: () => (DATA.weekGames || []).filter(g => g.away.key && g.home.key && DATA.teams[g.away.key] && DATA.teams[g.home.key])
    .slice().sort((a, b) => new Date(a.start) - new Date(b.start))
    .map(g => ({ id: g.id, away: g.away.key, home: g.home.key, start: new Date(g.start), neutral: !!g.neutral, final: !!g.completed, raw: g })),
  line: x => {
    const ln = lineFor(x.raw);
    if (!ln) return null;
    const margin = ln.pick ? 0 : ln.fav === "home" ? ln.spread : ln.fav === "away" ? -ln.spread : null;
    return { margin, total: ln.total == null ? null : ln.total };
  },
  refreshLines: (games, redraw) => { if (typeof refreshLines === "function" && DATA.currentWeek) refreshLines(new Set(games.map(x => x.id)), redraw); },
  name: k => DATA.teams[k] ? DATA.teams[k].team : k,
  abbr: k => DATA.teams[k] && DATA.teams[k].abbr ? DATA.teams[k].abbr : k,
  slab: k => slabHtml(DATA.teams[k] && DATA.teams[k].abbr ? DATA.teams[k].abbr : k, k),
  vars: k => teamVars(k),
  matchupUrl: x => `matchup.html?game=${encodeURIComponent(x.id)}`,
  pdfName: m => `CFB_${m.season}_week_${m.week}_EPA.pdf`,
  esc: s => escapeHtml(String(s)),
};

/* ---------------- shared from here down ---------------- */
let EPA = null, GAMES = [], CUR = 0;
const sg = (v, d = 2) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const half = v => Math.round(v * 2) / 2;

async function initEpa() {
  const status = document.getElementById("epaStatus");
  try {
    await SITE.load();
    const r = await fetch("data/epa.json", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    EPA = await r.json();
  } catch (err) {
    document.getElementById("epaMain").innerHTML = `<div class="empty-note">Couldn't load the EPA ratings. Try refreshing in a minute.</div>`;
    status.textContent = "";
    return;
  }
  GAMES = SITE.games().filter(x => EPA.teams[x.home] && EPA.teams[x.away]);
  const want = new URLSearchParams(location.search).get("game");
  CUR = Math.max(0, GAMES.findIndex(x => x.id === want));

  document.getElementById("epaWeek").textContent =
    `Week ${SITE.week()} · ratings through Week ${EPA.throughWeek}` + (EPA.week !== SITE.week() ? ` (built for Week ${EPA.week})` : "");
  document.getElementById("epaFacts").innerHTML = [
    `<span><b>${EPA.playsUsed.toLocaleString()}</b> plays used of ${EPA.playsAll.toLocaleString()}</span>`,
    `<span><b>${EPA.gamesUsed}</b> games</span>`,
    `<span>League EPA / play <b>${sg(EPA.league.epa, 3)}</b>: pass <b>${sg(EPA.league.pass, 3)}</b>, run <b>${sg(EPA.league.rush, 3)}</b></span>`,
  ].join("");

  drawAll();
  SITE.refreshLines(GAMES, drawLines);

  const n = GAMES.length;
  status.textContent = `${n} game${n === 1 ? "" : "s"}`;
  const btn = document.getElementById("epaPrintBtn");
  btn.disabled = false;
  btn.addEventListener("click", () => window.print());
  showEpaPdf(document.getElementById("epaPdfBtn"));
}

function drawAll() {
  drawGame();
  drawPrintGames();
  drawBoard();
  drawLeague();
  drawBacktest();
}
// a line update from ESPN changes the header, the board and the printed games
function drawLines() {
  drawGame();
  drawPrintGames();
  drawBoard();
}

/* ---------- projections ---------- */
function project(x) {
  const T = EPA.teams, M = EPA.model, lg = EPA.league;
  const h = T[x.home], a = T[x.away];
  const pace = (h.ppg + a.ppg) / 2;
  const hEpa = h.o + a.d, aEpa = a.o + h.d;
  const hfa = x.neutral ? 0 : M.hfa;
  // same formula as _project() in scripts/epa_ratings.py
  const margin = hfa + M.kMargin * (hEpa - aEpa) * pace;
  const total = 2 * lg.pts + M.kTotal * (hEpa + aEpa) * pace;
  const ln = SITE.line(x);
  const out = { margin, total, line: ln && ln.margin != null ? ln.margin : null, totalLine: ln ? ln.total : null };
  out.gap = out.line == null ? null : margin - out.line;
  out.totalGap = out.totalLine == null ? null : total - out.totalLine;
  return out;
}
function favText(x, homeMargin) {
  const m = half(homeMargin);
  if (m === 0) return "Pick'em";
  return m > 0 ? `${SITE.abbr(x.home)} −${m}` : `${SITE.abbr(x.away)} −${-m}`;
}
function gapPill(gap) {
  const a = Math.abs(gap);
  return `<span class="ep-gap${a >= 3 ? " big" : ""}">${a.toFixed(1)}</span>`;
}

/* ---------- one game ---------- */
const ROWS = [
  ["Adj. EPA / play", "adj", "o_adj", "d_adj", v => sg(v)],
  ["Pass EPA / play", "pass", "o_pass", "d_pass", v => sg(v)],
  ["Rush EPA / play", "rush", "o_rush", "d_rush", v => sg(v)],
  ["Early-down pass", "ed", "o_ed", "d_ed", v => sg(v)],
  ["Success %", "sr", "o_sr", "d_sr", v => v == null ? "—" : v.toFixed(1)],
];
function edgePanelEpa(o, d) {
  const T = EPA.teams, n = EPA.teamCount, edgeAt = Math.max(6, Math.round(n * 0.19));
  const ov = SITE.vars(o), dv = SITE.vars(d), oa = SITE.esc(SITE.abbr(o)), da = SITE.esc(SITE.abbr(d));
  const rows = ROWS.map(([lbl, key, ok, dk, fmt]) => {
    const or = T[o].rk[ok], dr = T[d].rk[dk], diff = dr - or;
    const side = diff >= edgeAt ? "off" : diff <= -edgeAt ? "def" : "";
    const w = r => Math.round(((n + 1 - r) / n) * 100);
    const edge = side === "off" ? `<b class="tc" style="${ov}">${oa}</b>` : side === "def" ? `<b class="tc" style="${dv}">${da}</b>` : `<span class="even">Even</span>`;
    return `<div class="tape"><span class="lbl">${lbl}</span>
      <span class="num"><b>${fmt(T[o].off[key])}</b> <span class="rk">#${or}</span></span>
      <span class="tl"><i class="tb${side === "off" ? " on" : ""}" style="width:${w(or)}%;${ov}"></i></span>
      <span class="tr"><i class="tb${side === "def" ? " on" : ""}" style="width:${w(dr)}%;${dv}"></i></span>
      <span><b>${fmt(T[d].def[key])}</b> <span class="rk">#${dr}</span></span>
      <span class="num edge">${edge}</span></div>`;
  }).join("");
  return `<div class="edge-panel"><h4><span class="tc" style="${ov}">${oa} offense</span> against <span class="tc" style="${dv}">${da} defense</span></h4>
    <div class="tape tape-h"><span></span><span class="num">${oa} offense</span><span></span><span></span><span>${da} defense</span><span class="num">Edge</span></div>${rows}</div>`;
}
function rankShift(raw, adj) {
  const s = raw - adj;   // positive = moves up the rankings
  if (Math.abs(s) < 3) return `<span class="ep-shift">#${raw} → #${adj}</span>`;
  return `<span class="ep-shift ${s > 0 ? "up" : "down"}">#${raw} → #${adj} ${s > 0 ? "▲" : "▼"}${Math.abs(s)}</span>`;
}
function teamCardEpa(k) {
  const x = EPA.teams[k], q = x.qb;
  const flags = x.flags.length ? x.flags.map(f => `<li>${SITE.esc(f)}</li>`).join("")
    : `<li class="none">Nothing unusual: record, turnovers and close games are in line with the efficiency.</li>`;
  return `<div class="ep-card" style="${SITE.vars(k)}"><h4><span class="tc">${SITE.esc(SITE.name(k))}</span> <span class="ep-dim">${x.rec}</span></h4>
    <div class="ep-kv">
      <span>Offense rank, raw → adjusted</span><span>${rankShift(x.rk.o_raw, x.rk.o_adj)}</span>
      <span>Defense rank, raw → adjusted</span><span>${rankShift(x.rk.d_raw, x.rk.d_adj)}</span>
      ${q ? `<span>${SITE.esc(q.name)}, EPA / dropback</span><span>${sg(q.epa)}${q.cpoe != null ? ` <span class="rk">CPOE ${sg(q.cpoe, 1)}</span>` : ""}</span>` : ""}
      <span>Plays per game</span><span>${x.ppg}</span>
      <span>Neutral early-down pass rate</span><span>${x.npr == null ? "—" : x.npr + "%"}</span>
      <span>Turnover margin</span><span>${x.to > 0 ? "+" : ""}${x.to}</span>
    </div>
    <ul class="ep-flags">${flags}</ul></div>`;
}
function gameHeadEpa(x) {
  const p = project(x), T = EPA.teams;
  const side = (k, home) => `<div class="ep-team${home ? " home" : ""}">${home ? "" : SITE.slab(k)}
      <div><div class="nm">${SITE.esc(SITE.name(k))}</div><div class="sub">${x.neutral ? "Neutral" : home ? "Home" : "Away"} · ${T[k].rec} · Net EPA #${T[k].rk.net}</div></div>${home ? SITE.slab(k) : ""}</div>`;
  return `<div class="ep-head">${side(x.away, false)}
    <div class="ep-mid">
      <div class="ep-lines">
        <span class="k">EPA line</span><span class="k">Market</span>
        <span class="v">${favText(x, p.margin)}</span><span class="v">${p.line == null ? "—" : favText(x, p.line)}</span>
        <span class="k">EPA total</span><span class="k">Market</span>
        <span class="v">${half(p.total).toFixed(1)}</span><span class="v">${p.totalLine == null ? "—" : p.totalLine}</span>
      </div>
      <div class="ep-gaps">Gap: side ${p.gap == null ? "—" : gapPill(p.gap)} · total ${p.totalGap == null ? "—" : gapPill(p.totalGap)}</div>
    </div>
    ${side(x.home, true)}</div>`;
}
function gameBlock(x) {
  return `${gameHeadEpa(x)}
    <div class="edge-grid ep-edges">${edgePanelEpa(x.away, x.home)}${edgePanelEpa(x.home, x.away)}</div>
    <div class="ep-cards">${teamCardEpa(x.away)}${teamCardEpa(x.home)}</div>`;
}
function pickLabel(x) { return `${SITE.esc(SITE.abbr(x.away))} @ ${SITE.esc(SITE.abbr(x.home))}`; }
function drawGame() {
  const box = document.getElementById("epaGame"), pick = document.getElementById("epaPicker");
  if (!GAMES.length) {
    pick.innerHTML = "";
    box.innerHTML = `<div class="empty-note">No games with ratings for both teams this week.</div>`;
    return;
  }
  if (!pick.dataset.built) {
    pick.innerHTML = SITE.pickerButtons
      ? GAMES.map((x, i) => `<button type="button" data-i="${i}">${pickLabel(x)}</button>`).join("")
      : `<label for="epaGameSel">Game</label><select id="epaGameSel">${GAMES.map((x, i) =>
          `<option value="${i}">${SITE.esc(SITE.name(x.away))} at ${SITE.esc(SITE.name(x.home))}</option>`).join("")}</select>`;
    pick.dataset.built = "1";
    pick.addEventListener("click", e => {
      const b = e.target.closest("button[data-i]");
      if (b) choose(+b.dataset.i);
    });
    pick.addEventListener("change", e => { if (e.target.id === "epaGameSel") choose(+e.target.value); });
  }
  pick.querySelectorAll("button[data-i]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === CUR)));
  const sel = document.getElementById("epaGameSel");
  if (sel) sel.value = String(CUR);
  box.innerHTML = gameBlock(GAMES[CUR]);
}
function choose(i) {
  CUR = i;
  const u = new URL(location.href);
  u.searchParams.set("game", GAMES[i].id);
  history.replaceState(null, "", u);
  drawGame();
}
// Print all: every game, one per landscape page, before the board and the ratings
function drawPrintGames() {
  document.getElementById("epaPrintGames").innerHTML = GAMES.map(x =>
    `<section class="ep-print-game"><div class="mh-week">Week ${SITE.week()} · EPA matchup</div>${gameBlock(x)}</section>`).join("");
}

/* ---------- weekly board ---------- */
function drawBoard() {
  const day = d => d.toLocaleDateString(undefined, { weekday: "short" });
  const rows = GAMES.map(x => {
    const p = project(x);
    const side = p.gap == null ? "" : SITE.abbr(p.gap > 0 ? x.home : x.away);
    return `<tr>
      <td class="l"><a class="ep-game" href="${SITE.matchupUrl(x)}">${SITE.slab(x.away)}<span class="at">${x.neutral ? "vs" : "at"}</span>${SITE.slab(x.home)}</a></td>
      <td class="l ep-dim">${x.final ? "Final" : day(x.start)}</td>
      <td>${favText(x, p.margin)}</td>
      <td class="ep-dim">${p.line == null ? "—" : favText(x, p.line)}</td>
      <td>${p.gap == null ? "—" : `${gapPill(p.gap)} <span class="rk">${SITE.esc(side)}</span>`}</td>
      <td>${half(p.total).toFixed(1)}</td>
      <td class="ep-dim">${p.totalLine == null ? "—" : p.totalLine}</td>
      <td>${p.totalGap == null ? "—" : `${gapPill(p.totalGap)} <span class="rk">${p.totalGap > 0 ? "Over" : "Under"}</span>`}</td>
    </tr>`;
  }).join("");
  document.getElementById("epaBoard").innerHTML = GAMES.length
    ? `<thead><tr><th class="l">Game</th><th class="l">Day</th><th>EPA line</th><th>Market</th><th>Side gap</th><th>EPA total</th><th>Market</th><th>Total gap</th></tr></thead><tbody>${rows}</tbody>`
    : `<tbody><tr><td class="l ep-dim">No games this week.</td></tr></tbody>`;
}

/* ---------- ratings table ---------- */
const COLS = [
  { k: "rank", h: "#", v: t => EPA.teams[t].rk.net, asc: true },
  { k: "team", h: "Team", l: true, v: t => SITE.name(t).toLowerCase(), asc: true },
  { k: "rec", h: "Record", l: true, v: t => +EPA.teams[t].rec.split("-")[0], asc: false },
  { k: "net", h: "Net", v: t => EPA.teams[t].net, asc: false },
  { k: "off", h: "Offense", v: t => EPA.teams[t].off.adj, asc: false },
  { k: "def", h: "Defense", v: t => EPA.teams[t].def.adj, asc: true },
  { k: "pass", h: "Pass off.", v: t => EPA.teams[t].off.pass, asc: false },
  { k: "rush", h: "Rush off.", v: t => EPA.teams[t].off.rush, asc: false },
  { k: "oshift", h: "Off. shift", v: t => EPA.teams[t].rk.o_raw - EPA.teams[t].rk.o_adj, asc: false },
  { k: "dshift", h: "Def. shift", v: t => EPA.teams[t].rk.d_raw - EPA.teams[t].rk.d_adj, asc: false },
  { k: "flags", h: "Regression flags", l: true, v: t => EPA.teams[t].flags.length, asc: false },
];
let SORT = { k: "rank", asc: true };
function shiftCell(s) {
  if (Math.abs(s) < 3) return `<span class="ep-dim">${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(s)}</span>`;
  return `<span class="${s > 0 ? "pos" : "neg"}">${s > 0 ? "▲" : "▼"}${Math.abs(s)}</span>`;
}
function drawLeague() {
  const T = EPA.teams, keys = Object.keys(T);
  const netMax = Math.max(...keys.map(k => Math.abs(T[k].net))) || 1;
  const bar = v => {
    const w = Math.abs(v) / netMax * 50;
    return `<span class="ep-bar"><i class="${v >= 0 ? "p" : "n"}" style="${v >= 0 ? "left" : "right"}:50%;width:${w}%"></i></span>`;
  };
  const c = COLS.find(x => x.k === SORT.k);
  keys.sort((a, b) => {
    const va = c.v(a), vb = c.v(b), d = va < vb ? -1 : va > vb ? 1 : 0;
    return (SORT.asc ? d : -d) || T[a].rk.net - T[b].rk.net;
  });
  const head = COLS.map(x => `<th class="${x.l ? "l" : ""}"${x.k === SORT.k ? ` aria-sort="${SORT.asc ? "ascending" : "descending"}"` : ""}><button type="button" data-k="${x.k}">${x.h}${x.k === SORT.k ? (SORT.asc ? " ↑" : " ↓") : ""}</button></th>`).join("");
  const rows = keys.map(k => { const x = T[k]; return `<tr>
    <td class="ep-dim">${x.rk.net}</td>
    <td class="l"><span class="ep-tm">${SITE.slab(k)}<span class="nm">${SITE.esc(SITE.name(k))}</span></span></td>
    <td class="l ep-dim">${x.rec}</td>
    <td><b>${sg(x.net)}</b>${bar(x.net)}</td>
    <td>${sg(x.off.adj)} <span class="rk">#${x.rk.o_adj}</span></td>
    <td>${sg(x.def.adj)} <span class="rk">#${x.rk.d_adj}</span></td>
    <td>${sg(x.off.pass)} <span class="rk">#${x.rk.o_pass}</span></td>
    <td>${sg(x.off.rush)} <span class="rk">#${x.rk.o_rush}</span></td>
    <td>${shiftCell(x.rk.o_raw - x.rk.o_adj)}</td>
    <td>${shiftCell(x.rk.d_raw - x.rk.d_adj)}</td>
    <td class="ep-flagtxt">${x.flags.length ? x.flags.map(SITE.esc).join("; ") : "—"}</td></tr>`; }).join("");
  const tbl = document.getElementById("epaLeague");
  tbl.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody>`;
  if (!tbl.dataset.wired) {
    tbl.dataset.wired = "1";
    tbl.addEventListener("click", e => {
      const b = e.target.closest("th button");
      if (!b) return;
      const col = COLS.find(x => x.k === b.dataset.k);
      SORT = SORT.k === col.k ? { k: col.k, asc: !SORT.asc } : { k: col.k, asc: col.asc };
      drawLeague();
    });
  }
}

/* ---------- walk-forward check ---------- */
function drawBacktest() {
  const bt = EPA.backtest, box = document.getElementById("epaBacktest");
  if (!bt) {
    box.innerHTML = `<p>Not enough weeks yet to check the ratings against results.</p>`;
    return;
  }
  const bars = rows => {
    const vals = rows.map(r => r[1]).filter(v => v != null);
    const max = Math.max(...vals) * 1.05;
    return rows.filter(r => r[1] != null).map(([lbl, v, mkt]) =>
      `<div class="ep-err${mkt ? " mkt" : ""}"><span>${lbl}</span><span class="t"><i style="width:${v / max * 100}%"></i></span><span class="n">${v.toFixed(1)}</span></div>`).join("");
  };
  const beat = bt.modelM < bt.lineM;
  box.innerHTML = `<p class="ep-small">Each week from ${bt.fromWeek} to ${bt.toWeek}, ratings were built from earlier weeks only and used to project that week's ${bt.games} games. Average miss on the final margin, in points (lower is better):</p>
    <div class="ep-errs">${bars(bt.rawM === bt.modelM ? [["Closing line", bt.lineM, true], ["EPA", bt.modelM]]
      : [["Closing line", bt.lineM, true], ["EPA, regressed", bt.modelM], ["EPA, unregressed", bt.rawM]])}</div>
    ${bt.lineT != null ? `<div class="ep-errcap">Totals</div><div class="ep-errs">${bars([["Closing total", bt.lineT, true], ["EPA, regressed", bt.modelT], ["EPA, unregressed", bt.rawT]])}</div>` : ""}
    <p class="ep-small">${beat
      ? "The EPA projection has missed by less than the closing line so far. Over a small sample that can be luck, so treat it as a reason to keep tracking, not as proof of an edge."
      : "The closing line still beats the ratings. For now they work best as context and as a way to flag games for a closer look, not as picks."}</p>`;
}

/* ---------- PDF link ---------- */
// pdf/epa.pdf is built with the matchup PDFs; pdf/manifest.json says which week it is for.
async function showEpaPdf(el) {
  let m = null;
  try {
    const r = await fetch("pdf/manifest.json", { cache: "no-cache" });
    m = r.ok ? await r.json() : null;
  } catch (e) { m = null; }
  if (!m || !m.epa || m.week !== SITE.week() || m.season !== DATA.season) return;
  el.href = `pdf/epa.pdf?v=${encodeURIComponent(m.generatedAt)}`;
  el.setAttribute("download", SITE.pdfName(m));
  el.title = `PDF built ${new Date(m.generatedAt).toLocaleString()}`;
  el.hidden = false;
}
