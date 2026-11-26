// Matchup page on a phone (760px and under; style.css shows these controls only there).
// The page's sections sit behind four tabs: Head to head (one offense-vs-defense panel at a
// time), Players (one team, one of Passing / Rushing / Receiving, a card per player), Team
// stats (one team, dials shown as rank bars) and
// Trends (pace, betting trends), plus a Box score tab once the game is on or over. Print matchup, Download PDF and the packet
// buttons fold behind one button. Nothing is re-rendered: this only tags the sections the
// page already drew and sets which ones show (`data-m*` on <body>). The sections are hidden
// only once this has run (`body.m-phone-tabs`), so a page where it fails shows everything.
// Called by the matchup page after it draws this week's matchup; shared with the CFB site.
function initPhoneMatchup() {
  // built only at phone width (or when the window first narrows to it), so the desktop page is left exactly as drawn
  const mq = window.matchMedia("(max-width: 760px)");
  if (mq.matches) { buildPhoneMatchup(); return; }
  if (initPhoneMatchup.waiting) return;   // Compare calls this on every redraw
  initPhoneMatchup.waiting = true;
  const once = () => { if (mq.matches) { mq.removeEventListener("change", once); initPhoneMatchup.waiting = false; try { buildPhoneMatchup(); } catch (e) { /* the full page still shows */ } } };
  mq.addEventListener("change", once);
}
function buildPhoneMatchup() {
  const body = document.body;
  // Compare Any Two Teams has the two team cards and betting trends but no header or head to
  // head, and redraws its cards on every pick: there the tabs are Team stats, Players and
  // Trends, they sit under the team pickers, and this runs again after each redraw.
  const head = document.querySelector(".m-head") || document.querySelector(".matchup-picker");
  const edges = document.getElementById("edges"), cards = document.getElementById("teamCards");
  if (!head || !cards) return;
  const panels = edges ? [...edges.querySelectorAll(":scope > .edge-grid > .edge-panel")] : [];
  const tcards = [...cards.querySelectorAll(":scope > .team-card")];
  const compare = !edges;
  if (tcards.length !== 2 || (!compare && panels.length !== 2)) return;
  if (!compare && document.querySelector(".m-tabs")) return;
  document.querySelectorAll(".m-tabs, .m-switch, .m-cats").forEach(el => el.remove());
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const text = el => (el ? el.textContent.trim() : "");

  panels.forEach((p, i) => { p.dataset.mside = i; });
  const cats = [];
  tcards.forEach((c, i) => {
    c.dataset.mteam = i;
    c.querySelectorAll(":scope > .tables-row > .table-block").forEach(b => {
      const name = text(b.querySelector("h4"));
      b.dataset.mcat = name.toLowerCase();
      if (name && !cats.includes(name)) cats.push(name);
    });
  });

  // Players tab: each table row becomes a card. The cells are labelled from the table's own
  // header so the card can name each number; the first two cells (player, yards per game)
  // make the card's top line.
  const headLabel = th => { const c = th.cloneNode(true); c.querySelectorAll(".capd-h").forEach(x => x.remove()); return text(c); };
  tcards.forEach(c => c.querySelectorAll(":scope > .tables-row > .table-block > table").forEach(tb => {
    const labels = [...tb.querySelectorAll("thead th")].map(headLabel);
    tb.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (labels[i]) td.dataset.label = labels[i]; }));
    tb.classList.add("m-ptable");
  }));
  // ...and each table opens with what the other team's defense allows to that position,
  // read from the other team's card (its Defense vs position blocks and passing dial).
  const note = lines => { const el = document.createElement("p"); el.className = "m-defnote no-print"; el.innerHTML = lines.map(esc).join("<br>"); return el; };
  tcards.forEach((c, i) => {
    const opp = tcards[1 - i], who = text(opp.querySelector(".team-card-header .slab")) || "Opponent";
    const dvp = [...opp.querySelectorAll(":scope > .defpos-row > .defpos-block")].map(b => ({
      title: text(b.querySelector("h4")).replace(/^Defense\s+/i, ""),
      stats: [...b.querySelectorAll(".defpos-stats .item")].map(it => [...it.children].map(text).join(" ")),
    }));
    const line = d => `${who} defense ${d.title}: ${d.stats.join(" · ")}`;
    const passDial = [...opp.querySelectorAll(".stat-col.defense .gauge-block")].find(g => /^pass/i.test(text(g.querySelector(".gauge-label"))));
    const lines = {
      passing: passDial ? [`${who} defense allows ${text(passDial.querySelector(".gauge-value"))} pass yds/G (${text(passDial.querySelector(".gauge-rank"))})`] : [],
      rushing: dvp.filter(d => /^vs RB$/i.test(d.title)).map(line),
      receiving: dvp.filter(d => !/^vs RB$/i.test(d.title)).map(line),
    };
    c.querySelectorAll(":scope > .tables-row > .table-block").forEach(b => {
      const ls = lines[b.dataset.mcat];
      const h = b.querySelector("h4");
      if (ls && ls.length && h && !b.querySelector(".m-defnote")) h.insertAdjacentElement("afterend", note(ls));
    });
  });
  // Team stats tab: each dial also gets a rank bar (the dial itself is hidden on a phone),
  // and the Usage table drops its Pos column so it fits without scrolling sideways.
  const nTeams = typeof DATA !== "undefined" && DATA && DATA.teams ? Object.keys(DATA.teams).length : 32;
  tcards.forEach(c => {
    c.querySelectorAll(".gauge-block").forEach(g => {
      const m = /#(\d+)/.exec(text(g.querySelector(".gauge-rank")));
      if (!m || g.querySelector(".m-rankbar")) return;
      const el = document.createElement("span");
      el.className = "m-rankbar no-print";
      el.innerHTML = `<i style="width:${Math.max(4, Math.round((nTeams + 1 - +m[1]) / nTeams * 100))}%"></i>`;
      g.appendChild(el);
    });
    c.querySelectorAll(":scope > .usage-block table").forEach(tb => {
      const i = [...tb.querySelectorAll("thead th")].findIndex(th => text(th) === "Pos");
      if (i < 0) return;
      tb.querySelectorAll("tr").forEach(tr => { if (tr.children[i]) tr.children[i].classList.add("m-hide"); });
    });
  });

  const bar = (cls, label, key, items) => {
    const el = document.createElement("div");
    el.className = `${cls} no-print`;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", label);
    el.innerHTML = items.map(it => `<button type="button" data-k="${key}" data-v="${esc(it.v)}"${it.style ? ` style="${esc(it.style)}"` : ""}>${it.html}</button>`).join("");
    return el;
  };
  const tabList = compare
    ? [{ v: "team", html: "Team stats" }, { v: "players", html: "Players" }].concat(cards.querySelector(":scope > .bet-section") ? [{ v: "trends", html: "Trends" }] : [])
    : [{ v: "box", html: "Box score" }, { v: "h2h", html: "Head to head" }, { v: "players", html: "Players" }, { v: "team", html: "Team stats" }, { v: "trends", html: "Trends" }];
  const tabs = bar("m-tabs", "Sections", "mtab", tabList);
  head.insertAdjacentElement("afterend", tabs);
  // "GB offense against LA defense" reads as two lines on the switch
  const sides = bar("m-switch m-side", "Which offense", "mside", panels.map((p, i) => {
    const parts = text(p.querySelector("h4")).split(/\s+against\s+/);
    return { v: i, html: `<b>${esc(parts[0])}</b>${parts[1] ? `<span>vs ${esc(parts[1])}</span>` : ""}` };
  }));
  if (!compare) panels[0].parentElement.insertAdjacentElement("beforebegin", sides);
  // each team's button carries its colors (the vars sit on the card's abbreviation block)
  const teams = bar("m-switch m-team", "Team", "mteam", tcards.map((c, i) => {
    const slab = c.querySelector(".team-card-header .slab");
    return { v: i, html: `<b>${esc((text(c.querySelector(".team-card-header h2")) || text(slab)).replace(/^(#\d+)(?=\S)/, "$1 "))}</b>`, style: slab ? slab.getAttribute("style") || "" : "" };
  }));
  const chips = bar("m-cats", "Player table", "mcat", cats.map(n => ({ v: n.toLowerCase(), html: esc(n) })));
  cards.insertAdjacentElement("afterbegin", chips);
  cards.insertAdjacentElement("afterbegin", teams);

  const mbar = document.querySelector(".matchup-bar"), acts = mbar && mbar.querySelector(".bar-actions");
  if (acts && !acts.hidden && !mbar.querySelector(".m-more")) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "m-more no-print";
    more.setAttribute("aria-label", "Print, PDF and packets");
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>`;
    more.addEventListener("click", () => more.setAttribute("aria-expanded", mbar.classList.toggle("more-open") ? "true" : "false"));
    acts.insertAdjacentElement("beforebegin", more);
  }

  let picked = false;
  const set = (k, v) => {
    body.dataset[k] = v;
    document.querySelectorAll(`button[data-k="${k}"]`).forEach(b => b.setAttribute("aria-pressed", b.dataset.v === String(v) ? "true" : "false"));
    if (k === "mcat") cards.querySelectorAll(".table-block[data-mcat]").forEach(b => b.classList.toggle("m-cat-off", b.dataset.mcat !== v));
  };
  [tabs, sides, teams, chips].forEach(el => el.addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    if (b.dataset.k === "mtab") picked = true;
    set(b.dataset.k, b.dataset.v);
    // a new tab starts at its top when the reader had scrolled down the old one
    if (b.dataset.k === "mtab" && head.getBoundingClientRect().bottom < 0) window.scrollTo(0, window.scrollY + head.getBoundingClientRect().bottom);
  }));
  // a redraw (Compare) keeps the tab, team and table the reader was on
  const was = (k, ok, d) => (ok(body.dataset[k]) ? body.dataset[k] : d);
  set("mtab", was("mtab", v => tabList.some(t => t.v === v && v !== "box"), compare ? "team" : "h2h"));
  set("mside", was("mside", v => v === "0" || v === "1", 0));
  set("mteam", was("mteam", v => v === "0" || v === "1", 0));
  if (cats.length) set("mcat", was("mcat", v => cats.some(c => c.toLowerCase() === v), cats[0].toLowerCase()));
  body.classList.toggle("m-compare", compare);
  // The box score gets a tab of its own, first in the row, only while the page is showing one
  // (live.js un-hides #boxscore once the game is on or over). The page opens on it then,
  // unless the reader has already picked a tab.
  const box = document.getElementById("boxscore"), boxBtn = tabs.querySelector('button[data-v="box"]');
  const syncBox = () => {
    if (!boxBtn) return;
    const on = !!box && !box.hidden;
    boxBtn.hidden = !on;
    tabs.classList.toggle("has-box", on);
    if (on && !picked) set("mtab", "box");
    else if (!on && body.dataset.mtab === "box") set("mtab", "h2h");
  };
  syncBox();
  if (box) new MutationObserver(syncBox).observe(box, { attributes: true, attributeFilter: ["hidden"] });
  body.classList.add("m-phone-tabs");
}
