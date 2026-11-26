// Matchup page on a phone (760px and under; style.css shows these controls only there).
// The page's sections sit behind four tabs: Head to head (one offense-vs-defense panel at a
// time), Players (one team, one of Passing / Rushing / Receiving), Team stats (one team) and
// Trends (pace, betting trends, box score). Print matchup, Download PDF and the packet
// buttons fold behind one button. Nothing is re-rendered: this only tags the sections the
// page already drew and sets which ones show (`data-m*` on <body>). The sections are hidden
// only once this has run (`body.m-phone-tabs`), so a page where it fails shows everything.
// Called by the matchup page after it draws this week's matchup; shared with the CFB site.
function initPhoneMatchup() {
  // built only at phone width (or when the window first narrows to it), so the desktop page is left exactly as drawn
  const mq = window.matchMedia("(max-width: 760px)");
  if (mq.matches) { buildPhoneMatchup(); return; }
  const once = () => { if (mq.matches) { mq.removeEventListener("change", once); try { buildPhoneMatchup(); } catch (e) { /* the full page still shows */ } } };
  mq.addEventListener("change", once);
}
function buildPhoneMatchup() {
  const body = document.body;
  const head = document.querySelector(".m-head"), edges = document.getElementById("edges"), cards = document.getElementById("teamCards");
  if (!head || !edges || !cards || document.querySelector(".m-tabs")) return;
  const panels = [...edges.querySelectorAll(":scope > .edge-grid > .edge-panel")];
  const tcards = [...cards.querySelectorAll(":scope > .team-card")];
  if (panels.length !== 2 || tcards.length !== 2) return;
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

  const bar = (cls, label, key, items) => {
    const el = document.createElement("div");
    el.className = `${cls} no-print`;
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", label);
    el.innerHTML = items.map(it => `<button type="button" data-k="${key}" data-v="${esc(it.v)}"${it.style ? ` style="${esc(it.style)}"` : ""}>${it.html}</button>`).join("");
    return el;
  };
  const tabs = bar("m-tabs", "Sections", "mtab", [
    { v: "h2h", html: "Head to head" }, { v: "players", html: "Players" }, { v: "team", html: "Team stats" }, { v: "trends", html: "Trends" }]);
  head.insertAdjacentElement("afterend", tabs);
  // "GB offense against LA defense" reads as two lines on the switch
  const sides = bar("m-switch m-side", "Which offense", "mside", panels.map((p, i) => {
    const parts = text(p.querySelector("h4")).split(/\s+against\s+/);
    return { v: i, html: `<b>${esc(parts[0])}</b>${parts[1] ? `<span>vs ${esc(parts[1])}</span>` : ""}` };
  }));
  panels[0].parentElement.insertAdjacentElement("beforebegin", sides);
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

  const set = (k, v) => {
    body.dataset[k] = v;
    document.querySelectorAll(`button[data-k="${k}"]`).forEach(b => b.setAttribute("aria-pressed", b.dataset.v === String(v) ? "true" : "false"));
    if (k === "mcat") cards.querySelectorAll(".table-block[data-mcat]").forEach(b => b.classList.toggle("m-cat-off", b.dataset.mcat !== v));
  };
  [tabs, sides, teams, chips].forEach(el => el.addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    set(b.dataset.k, b.dataset.v);
    // a new tab starts at its top when the reader had scrolled down the old one
    if (b.dataset.k === "mtab" && head.getBoundingClientRect().bottom < 0) window.scrollTo(0, window.scrollY + head.getBoundingClientRect().bottom);
  }));
  set("mtab", "h2h");
  set("mside", 0);
  set("mteam", 0);
  if (cats.length) set("mcat", cats[0].toLowerCase());
  body.classList.add("m-phone-tabs");
}
