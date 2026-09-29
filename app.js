let DATA = null;

const team1Select = document.getElementById("team1Select");
const team2Select = document.getElementById("team2Select");
const teamCards = document.getElementById("teamCards");
const lastUpdated = document.getElementById("lastUpdated");
const printBothBtn = document.getElementById("printBothBtn");

init();

async function init() {
  try {
    const res = await fetch("data/data.json", { cache: "no-store" });
    DATA = await res.json();
  } catch (err) {
    teamCards.innerHTML = `<div class="empty-note">Couldn't load data/data.json. Run scripts/build_data.py first.</div>`;
    return;
  }

  populateSelect(team1Select, DATA.teamNames);
  populateSelect(team2Select, DATA.teamNames);

  const saved1 = localStorage.getItem("cfb_team1");
  const saved2 = localStorage.getItem("cfb_team2");
  // default matchup: the two highest-rated teams by SRS
  const bySrs = DATA.teamNames.slice().sort((a, b) => DATA.teams[b].record.srs - DATA.teams[a].record.srs);
  team1Select.value = saved1 && DATA.teams[saved1] ? saved1 : bySrs[0];
  team2Select.value = saved2 && DATA.teams[saved2] ? saved2 : bySrs[1];

  team1Select.addEventListener("change", render);
  team2Select.addEventListener("change", render);
  printBothBtn.addEventListener("click", () => window.print());

  const gen = new Date(DATA.generatedAt);
  lastUpdated.textContent = "Data as of " + gen.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric"
  }) + " " + gen.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
    (DATA.throughWeek ? " · through Week " + DATA.throughWeek : "");
  const src = document.getElementById("sourceNote");
  if (src && DATA.source) src.textContent = "Source: " + DATA.source + ".";

  render();
}

function populateSelect(select, names) {
  const byConf = {};
  names.forEach(n => {
    const c = (DATA.teams[n] && DATA.teams[n].conference) || "Other";
    (byConf[c] = byConf[c] || []).push(n);
  });
  const opt = n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`;
  const confs = Object.keys(byConf).sort().map(c =>
    `<optgroup label="${escapeHtml(c)}">${byConf[c].map(opt).join("")}</optgroup>`).join("");
  select.innerHTML = confs;
}

function render() {
  const t1 = team1Select.value;
  const t2 = team2Select.value;
  localStorage.setItem("cfb_team1", t1);
  localStorage.setItem("cfb_team2", t2);

  teamCards.innerHTML = [t1, t2].map(name => renderTeamCard(DATA.teams[name])).join("");
}

function renderTeamCard(t) {
  if (!t) return "";
  const avg = DATA.leagueAverage;
  const gr = DATA.gaugeRanges;

  return `
  <div class="team-card" data-team="${escapeHtml(t.team)}">
    <div class="team-card-header">
      <div class="team-name-block">
        <h2>${escapeHtml(t.team)}</h2>
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
  const cards = document.querySelectorAll(".team-card");
  cards.forEach(c => {
    if (c.dataset.team !== teamName) c.classList.add("print-hide");
  });
  window.print();
}

window.addEventListener("afterprint", () => {
  document.querySelectorAll(".team-card.print-hide").forEach(c => c.classList.remove("print-hide"));
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
