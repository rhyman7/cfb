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
