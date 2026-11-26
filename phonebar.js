// Phone top bar (760px and under; style.css shows it only there). The page links fold into
// a menu button and the player search opens from a search button; the week strip stays on
// screen. On This Week's Matchups the menu also carries Print Packets / Save Packets.
// The links are only hidden once this has run (`.has-phone-bar`), so a page where it
// fails keeps its links.
function initPhoneBar() {
  const bar = document.querySelector(".topbar");
  const nav = bar && bar.querySelector(".topnav");
  if (!bar || !nav || bar.querySelector(".phone-tools")) return;
  const icon = d => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${d}</svg>`;
  if (!nav.id) nav.id = "pageNav";
  const tools = document.createElement("div");
  tools.className = "phone-tools no-print";
  tools.innerHTML =
    `<button type="button" class="pt-btn pt-search" aria-label="Search players" aria-expanded="false" hidden>${icon('<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path>')}</button>` +
    `<button type="button" class="pt-btn pt-menu" aria-label="Menu" aria-expanded="false" aria-controls="${nav.id}">${icon('<path d="M4 7h16M4 12h16M4 17h16"></path>')}</button>`;
  bar.insertBefore(tools, nav);
  const extra = document.createElement("div");
  extra.className = "phone-extra no-print";
  nav.appendChild(extra);
  const searchBtn = tools.querySelector(".pt-search"), menuBtn = tools.querySelector(".pt-menu");
  // With the one-site bar on the page (html.wgb-shell-on) its menu holds the page links, so this
  // button is only kept where it also opens the packets (This Week's Matchups), as a print button.
  if (document.documentElement.classList.contains("wgb-shell-on") && document.body.dataset.page === "week") {
    menuBtn.classList.add("pt-packets");
    menuBtn.setAttribute("aria-label", "Print or save packets");
    menuBtn.innerHTML = icon('<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z"></path>');
  }
  const set = (menu, search) => {
    bar.classList.toggle("menu-open", menu);
    bar.classList.toggle("search-open", search);
    menuBtn.setAttribute("aria-expanded", menu ? "true" : "false");
    searchBtn.setAttribute("aria-expanded", search ? "true" : "false");
  };
  // the packet buttons exist only on this week's board, and only once packets.js enables them
  const fillExtra = () => {
    const src = document.getElementById("packetAll");
    const btns = src && !src.hidden ? [...src.querySelectorAll("button[data-pick]")] : [];
    extra.innerHTML = "";
    btns.forEach(b => {
      const m = document.createElement("button");
      m.type = "button";
      m.className = "print-btn";
      m.textContent = b.textContent;
      m.addEventListener("click", () => {
        set(false, false);
        b.click();
        const list = document.getElementById("gameList");
        if (list) list.scrollIntoView({ block: "start" });
      });
      extra.appendChild(m);
    });
  };
  menuBtn.addEventListener("click", () => {
    const open = !bar.classList.contains("menu-open");
    if (open) fillExtra();
    set(open, false);
  });
  searchBtn.addEventListener("click", () => {
    const open = !bar.classList.contains("search-open");
    set(false, open);
    const input = bar.querySelector(".psearch input");
    if (open && input) input.focus();
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") set(false, false); });
  bar.classList.add("has-phone-bar");
}
// the search button appears once the player search exists (it is built after the data loads)
function phoneBarSearchReady() {
  const b = document.querySelector(".topbar .pt-search");
  if (b && document.querySelector(".topbar .psearch")) b.hidden = false;
}
try { initPhoneBar(); } catch (e) { /* the plain top bar still works */ }

// Phone-only helpers for any page (760px and under). They label what the page already drew;
// style.css lays it out. Wider screens are left alone.
// A player's game log: one block per game with no sideways
// scrolling. The log is drawn when a name is tapped, so this watches for it and labels each
// stat cell from the log's own two header rows (group, then column); style.css lays the
// labelled cells out. Wider screens are left alone.
(function () {
  if (!window.MutationObserver || !window.matchMedia) return;
  const mq = window.matchMedia("(max-width: 760px)");
  const text = el => (el ? el.textContent.trim() : "");
  const label = card => {
    const tb = card.querySelector(".plog-scroll > table");
    if (!tb || tb.classList.contains("m-log") || card.classList.contains("tg-card")) return;
    const rows = tb.querySelectorAll("thead tr");
    if (rows.length !== 2) return;
    const groups = [];   // the group name over each column
    [...rows[0].children].forEach(th => { for (let i = 0; i < (th.colSpan || 1); i++) groups.push(text(th)); });
    const named = new Set(groups.filter(g => g && g !== "Prop"));
    const short = { Passing: "Pass", Rushing: "Rush", Receiving: "Rec" };
    const labels = [...rows[1].children].map((th, i) => {
      const g = groups[i];
      return named.size > 1 && g && short[g] ? `${short[g]} ${text(th)}` : text(th);
    });
    tb.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (i > 2 && labels[i] && !td.classList.contains("prop-cell")) td.dataset.label = labels[i]; }));
    tb.classList.add("m-log");
  };
  // Wide tables as cards (Weekly Edges' game board and prop tables, EPA's line-vs-market
  // table and its all-teams table): each cell is labelled from the table's header and style.css stacks every row as a
  // card (table.m-cards). The first column is the card's title and takes no label.
  const CARD_TABLES = "#gameBoard > table, #propBoards .table-block > table, #epaBoard, #epaLeague";
  const cardify = tb => {
    if (tb.classList.contains("m-cards") && tb.querySelector("tbody tr:first-child td[data-label]")) return;
    const ths = [...tb.querySelectorAll("thead tr:last-child th")].map(text);
    // EPA's table has two "Market" columns: the line's and the total's
    const labels = ths.map((l, i) => (l === "Market" ? (/total/i.test(ths[i - 1] || "") ? "Market total" : "Market line") : l));
    if (!labels.length) return;
    tb.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (i > 0 && labels[i] && !td.querySelector(".board-link")) td.dataset.label = labels[i]; }));
    tb.classList.add("m-cards");
    // a long list (college has 60+ games a week) shows its first dozen cards, then a button for the rest
    const n = tb.querySelectorAll("tbody tr").length;
    const next = tb.nextElementSibling;
    if (next && next.classList.contains("m-more-rows")) next.remove();
    tb.classList.toggle("m-fold", n > 20);
    if (n > 20 && !tb.classList.contains("m-open")) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "print-btn m-more-rows no-print";
      more.textContent = `Show all ${n}`;
      more.addEventListener("click", () => { tb.classList.add("m-open"); more.remove(); });
      tb.insertAdjacentElement("afterend", more);
    }
  };
  // Weekly Edges' prop tables: one position's table at a time, picked from a row of chips.
  let propShown = 0;
  const propChips = box => {
    const blocks = [...box.querySelectorAll(":scope > .table-block")];
    let chips = box.previousElementSibling && box.previousElementSibling.classList.contains("m-prop-chips") ? box.previousElementSibling : null;
    if (blocks.length < 2) { if (chips) chips.remove(); return; }
    const names = blocks.map(b => text(b.querySelector("h4")));
    if (!chips || chips.dataset.names !== names.join("|")) {
      if (chips) chips.remove();
      chips = document.createElement("div");
      chips.className = "m-cats m-prop-chips no-print";
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Prop table");
      chips.dataset.names = names.join("|");
      names.forEach((n, i) => { const b = document.createElement("button"); b.type = "button"; b.dataset.v = i; b.textContent = n; chips.appendChild(b); });
      chips.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { propShown = +b.dataset.v; scan(); } });
      box.insertAdjacentElement("beforebegin", chips);
    }
    if (propShown >= blocks.length) propShown = 0;
    blocks.forEach((b, i) => b.classList.toggle("m-off", i !== propShown));
    [...chips.children].forEach((b, i) => b.setAttribute("aria-pressed", i === propShown ? "true" : "false"));
  };
  // EPA's two offense-vs-defense panels: one at a time, with a switch (as on the matchup page).
  // The page redraws them when another game is picked; the chosen side carries over.
  let epaSide = 0;
  const epaSwitch = grid => {
    const panels = [...grid.querySelectorAll(":scope > .edge-panel")];
    if (panels.length !== 2 || (grid.previousElementSibling && grid.previousElementSibling.classList.contains("m-epa-switch"))) return;
    const sw = document.createElement("div");
    sw.className = "m-switch m-side m-epa-switch no-print";
    sw.setAttribute("role", "group");
    sw.setAttribute("aria-label", "Which offense");
    panels.forEach((p, i) => {
      const parts = text(p.querySelector("h4")).split(/\s+against\s+/);
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.v = i;
      b.innerHTML = "<b></b><span></span>";
      b.firstChild.textContent = parts[0];
      b.lastChild.textContent = parts[1] ? "vs " + parts[1] : "";
      sw.appendChild(b);
    });
    const show = i => { epaSide = i; grid.dataset.show = i; [...sw.children].forEach((b, j) => b.setAttribute("aria-pressed", j === i ? "true" : "false")); };
    sw.addEventListener("click", e => { const b = e.target.closest("button"); if (b) show(+b.dataset.v); });
    grid.insertAdjacentElement("beforebegin", sw);
    show(epaSide);
  };
  let queued = false;
  const run = () => {
    queued = false;
    if (!mq.matches) return;
    const each = (sel, fn) => document.querySelectorAll(sel).forEach(el => { try { fn(el); } catch (e) { /* the plain page still shows */ } });
    each(".plog-card", label);
    each(CARD_TABLES, cardify);
    each("#epaGame > .edge-grid", epaSwitch);
    each("#propBoards", propChips);
  };
  const scan = () => { if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(run); } };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  mq.addEventListener("change", scan);
  scan();
})();
