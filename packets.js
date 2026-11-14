// Game packets: for each game, the Weekly Matchup Report page, the printed matchup, the EPA
// matchup page and the value board matchup, back to back, to print or save as one PDF.
//
// scripts/build_packets.py (run by the Build PDFs Action after each data update) writes the
// source PDFs and pdf/packets.json, which says which pages of each file belong to each game.
// This file assembles a packet in the browser with pdf-lib (vendor/pdf-lib.min.js, loaded only
// when a button is pressed), so the repo stores each week's pages once.
//
// Same file in both dashboards (rhyman7/cfb and rhyman7/nfl). It wires whichever of these is on
// the page and leaves them hidden until packets.json is for the week the page shows:
//   #packetAll  (This Week's Matchups)  Print Packets / Save Packets (data-pick="print" | "save").
//               Pressing one puts a checkbox beside each game in #gameList, with Select all
//               above the list and a Print/Save button below it. That button opens a dialog
//               for choosing which of the eight reports go in: the four per-game parts, plus the
//               report's four whole-slate pages (packets.json "slate"), added once at the end.
//   #packetOne  (one matchup)           buttons with data-packet="game" and data-act="print" | "save"
//               (that game's four parts).
(function () {
  const PART_ORDER = ["report", "matchup", "epa", "value"];
  const SLATE_ORDER = ["best", "td", "floors", "bye"];
  // the eight reports offered in the packet dialog, in the order they print
  const REPORTS = [
    { key: "report", label: "Matchup Report", note: "One page per game: the edges, key numbers and touchdown watch" },
    { key: "matchup", label: "Printed matchup", note: "The full matchup, two pages per game" },
    { key: "epa", label: "EPA", note: "The game's EPA matchup page" },
    { key: "value", label: "Value board", note: "The game's value board matchup" },
    { key: "best", slate: true, label: "Best Overall Matchups", note: "Ranked across the whole week; one copy, at the end" },
    { key: "td", slate: true, label: "Likeliest TD Scorers", note: "Ranked across the whole week; one copy, at the end" },
    { key: "floors", slate: true, label: "Highest Floors", note: "Top 15 every-game floors at each position; one copy, at the end" },
    // NFL only (Ryan, Nov 13, 2026): the row shows only on a site whose data.json has byeTrends
    { key: "bye", slate: true, needs: "byeTrends", label: "Coming Off a Bye", note: "Post-bye records, straight up and against the spread; one copy, at the end",
      off: "No team is coming off a bye this week, or this week's files don't have the page yet." },
  ];
  let MAN = null, LIB = null, HAS = {};
  const FILES = {};

  function weekOf(data) {
    return data.currentWeek != null ? data.currentWeek : (data.schedule || {}).week;
  }

  function gameIdFromUrl() {
    return new URLSearchParams(location.search).get("game");
  }

  async function loadJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + ": HTTP " + r.status);
    return r.json();
  }

  function loadLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (LIB) return LIB;
    LIB = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/pdf-lib.min.js";
      s.onload = () => resolve(window.PDFLib);
      s.onerror = () => { LIB = null; reject(new Error("couldn't load pdf-lib")); };
      document.head.appendChild(s);
    });
    return LIB;
  }

  async function source(PDFLib, key) {
    const name = MAN.files[key];
    if (!name) return null;
    if (!FILES[name]) {
      FILES[name] = fetch("pdf/" + name + "?v=" + encodeURIComponent(MAN.generatedAt), { cache: "no-cache" })
        .then(r => { if (!r.ok) throw new Error(name + ": HTTP " + r.status); return r.arrayBuffer(); })
        .then(buf => PDFLib.PDFDocument.load(buf));
    }
    return FILES[name];
  }

  // One PDF: each game's chosen parts in order (report page, printed matchup, EPA, value board),
  // then the chosen whole-slate rankings from the report, once each.
  async function assemble(games, parts, slateKeys, status) {
    const PDFLib = await loadLib();
    const out = await PDFLib.PDFDocument.create();
    out.setTitle(games.length === 1 && !slateKeys.length ? `${games[0].label} · ${MAN.title} packet` : `${MAN.title}: game packets`);
    const keys = PART_ORDER.filter(k => parts.includes(k));
    if (keys.length) {
      for (let i = 0; i < games.length; i++) {
        const g = games[i];
        if (status && games.length > 1) status(`Building ${i + 1} of ${games.length}…`);
        for (const key of keys) {
          const idx = g.pages[key];
          if (!idx || !idx.length) continue;
          const src = await source(PDFLib, key);
          if (!src) continue;
          const copied = await out.copyPages(src, idx);
          copied.forEach(p => out.addPage(p));
        }
      }
    }
    for (const key of SLATE_ORDER) {
      const idx = slateKeys.includes(key) && MAN.slate && MAN.slate[key];
      if (!idx || !idx.length) continue;
      const src = await source(PDFLib, "report");
      if (!src) continue;
      const copied = await out.copyPages(src, idx);
      copied.forEach(p => out.addPage(p));
    }
    if (!out.getPageCount()) throw new Error("nothing to print");
    return out.save();
  }

  function save(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Print the PDF from a hidden frame; browsers that can't print a PDF that way get it in a new tab.
  function print(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const old = document.getElementById("packetFrame");
    if (old) old.remove();
    const f = document.createElement("iframe");
    f.id = "packetFrame";
    f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;";
    f.src = url;
    f.onload = () => {
      setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); }
        catch (e) { window.open(url, "_blank"); }
      }, 300);
    };
    document.body.appendChild(f);
  }

  function packetName(games, parts, slateKeys) {
    const L = MAN.league.toUpperCase();
    if (!parts.length) return `${L}_Week${MAN.week}_Rankings.pdf`;
    if (games.length === 1 && !slateKeys.length) return `${games[0].file}.pdf`;
    return `${L}_Week${MAN.week}_Game_Packets.pdf`;
  }

  async function run(act, games, parts, slateKeys, say) {
    const bytes = await assemble(games, parts, slateKeys, say);
    if (act === "print") print(bytes); else save(bytes, packetName(games, parts, slateKeys));
  }

  // A matchup page's Print packet / Save packet: that game's four parts.
  function wire(box, pick) {
    const status = box.querySelector(".packet-status");
    const say = t => { if (status) status.textContent = t || ""; };
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        const buttons = box.querySelectorAll("button[data-act]");
        buttons.forEach(b => { b.disabled = true; });
        say(act === "print" ? "Preparing to print…" : "Preparing the PDF…");
        try {
          await run(act, pick(), PART_ORDER, [], say);
          say("");
        } catch (err) {
          console.error(err);
          say("Couldn't build the PDF. Try again in a minute.");
        } finally {
          buttons.forEach(b => { b.disabled = false; });
        }
      });
    });
  }

  /* ---------- This Week's Matchups: pick games, then pick reports ---------- */

  let PICK = null;            // "print" | "save" while choosing games
  const SEL = new Set();      // chosen game ids
  let BOX = null, LIST = null, DLG = null;
  const verb = act => act === "print" ? "Print" : "Save";
  const plural = n => `${n} game${n === 1 ? "" : "s"}`;

  function rowId(row) {
    const href = row.getAttribute("href") || "";
    const q = href.indexOf("?");
    return q < 0 ? null : new URLSearchParams(href.slice(q + 1)).get("game");
  }

  // Wraps each game row with its checkbox; runs again whenever the list is redrawn
  // (filters, live scores, forecasts), keeping what was ticked.
  function decorate() {
    if (!PICK || !LIST) return;
    const ok = new Set(MAN.games.map(g => g.id));
    LIST.classList.add("picking");
    LIST.querySelectorAll(".game-row").forEach(row => {
      if (row.parentElement.classList.contains("pk-row")) return;
      const id = rowId(row);
      const wrap = document.createElement("div");
      wrap.className = "pk-row";
      row.replaceWith(wrap);
      if (id && ok.has(id)) {
        const label = row.querySelector(".gr-name") ? [...row.querySelectorAll(".gr-name")].map(n => n.textContent).join(" at ") : id;
        wrap.innerHTML = `<label class="pk-cb"><input type="checkbox" data-id="${id}" aria-label="${label.replace(/"/g, "&quot;")}"></label>`;
        const cb = wrap.querySelector("input");
        cb.checked = SEL.has(id);
        wrap.classList.toggle("on", cb.checked);
        cb.addEventListener("change", () => {
          if (cb.checked) SEL.add(id); else SEL.delete(id);
          wrap.classList.toggle("on", cb.checked);
          counts();
        });
      } else {
        wrap.innerHTML = `<span class="pk-cb pk-none" title="No packet for this game"></span>`;
      }
      wrap.appendChild(row);
    });
    counts();
  }

  function shownBoxes() {
    return LIST ? [...LIST.querySelectorAll(".pk-cb input")] : [];
  }

  function counts() {
    const top = document.getElementById("pkTop"), bar = document.getElementById("pkBar");
    if (!top || !bar) return;
    const boxes = shownBoxes(), on = boxes.filter(b => b.checked).length;
    const all = top.querySelector("input");
    all.checked = boxes.length > 0 && on === boxes.length;
    all.indeterminate = on > 0 && on < boxes.length;
    all.disabled = !boxes.length;
    const hidden = SEL.size - on;
    top.querySelector(".pk-n").textContent = `${SEL.size} selected` + (hidden > 0 ? ` (${hidden} not shown by the filters)` : "");
    const go = bar.querySelector(".pk-go");
    go.disabled = !SEL.size;
    go.textContent = SEL.size ? `${verb(PICK)} ${plural(SEL.size)}` : verb(PICK);
  }

  function startPick(act) {
    if (PICK === act) { stopPick(); return; }
    if (PICK) stopPick(true);
    PICK = act;
    BOX.querySelectorAll("button[data-pick]").forEach(b => {
      const on = b.dataset.pick === act;
      b.classList.toggle("pk-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const head = document.querySelector(".week-head > div");
    if (head) head.insertAdjacentHTML("beforeend",
      `<p id="pkHint" class="pk-hint">Tick the games you want, then press ${verb(act)} at the bottom.</p>`);
    LIST.insertAdjacentHTML("beforebegin",
      `<label id="pkTop" class="pk-top no-print"><input type="checkbox"> Select all <span class="pk-n"></span></label>`);
    LIST.insertAdjacentHTML("afterend",
      `<div id="pkBar" class="pk-bar no-print"><button class="print-btn pk-go" type="button" disabled>${verb(act)}</button><button class="print-btn pk-cancel" type="button">Cancel</button></div>`);
    document.querySelector("#pkTop input").addEventListener("change", e => {
      shownBoxes().forEach(cb => {
        cb.checked = e.target.checked;
        if (cb.checked) SEL.add(cb.dataset.id); else SEL.delete(cb.dataset.id);
        cb.closest(".pk-row").classList.toggle("on", cb.checked);
      });
      counts();
    });
    document.querySelector("#pkBar .pk-go").addEventListener("click", openDialog);
    document.querySelector("#pkBar .pk-cancel").addEventListener("click", () => stopPick());
    decorate();
  }

  // keepSel: switching straight from Print to Save keeps the ticked games
  function stopPick(keepSel) {
    PICK = null;
    if (!keepSel) SEL.clear();
    ["pkHint", "pkTop", "pkBar"].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
    BOX.querySelectorAll("button[data-pick]").forEach(b => { b.classList.remove("pk-active"); b.setAttribute("aria-pressed", "false"); });
    if (LIST) {
      LIST.classList.remove("picking");
      LIST.querySelectorAll(".pk-row").forEach(w => { const row = w.querySelector(".game-row"); if (row) w.replaceWith(row); else w.remove(); });
    }
  }

  function openDialog() {
    if (!SEL.size) return;
    const act = PICK;
    if (DLG) DLG.remove();
    const hasSlate = k => !!(MAN.slate && MAN.slate[k] && MAN.slate[k].length);
    const row = r => {
      const off = r.slate && !hasSlate(r.key);
      return `<label class="pk-rep${off ? " off" : ""}"><input type="checkbox" value="${r.key}"${off ? " disabled" : ""}>`
        + `<span><b>${r.label}</b><small>${off ? (r.off || "Not in this week's files yet. It's added at the next PDF build.") : r.note}</small></span></label>`;
    };
    DLG = document.createElement("dialog");
    DLG.className = "pk-dialog";
    DLG.innerHTML = `<form method="dialog">
      <h3>${verb(act)} packets for ${plural(SEL.size)}</h3>
      <p class="pk-sub">Choose which reports to include.</p>
      <div class="pk-grp">For each game</div>${REPORTS.filter(r => !r.slate).map(row).join("")}
      <div class="pk-grp">Whole week</div>${REPORTS.filter(r => r.slate && (!r.needs || HAS[r.needs])).map(row).join("")}
      <p class="pk-status" aria-live="polite"></p>
      <div class="pk-dbar">
        <button class="print-btn pk-go" type="button" data-all="0" disabled>${verb(act)}</button>
        <button class="print-btn" type="button" data-all="1">${verb(act)} All</button>
        <button class="print-btn pk-x" value="cancel">Cancel</button>
      </div></form>`;
    document.body.appendChild(DLG);
    const reps = [...DLG.querySelectorAll(".pk-rep input:not([disabled])")];
    const go = DLG.querySelector('[data-all="0"]');
    const sync = () => { go.disabled = !reps.some(b => b.checked); };
    reps.forEach(b => b.addEventListener("change", sync));
    const status = DLG.querySelector(".pk-status");
    const say = t => { status.textContent = t || ""; };
    DLG.querySelectorAll("button[data-all]").forEach(btn => btn.addEventListener("click", async () => {
      const keys = btn.dataset.all === "1" ? REPORTS.filter(r => !r.needs || HAS[r.needs]).map(r => r.key) : reps.filter(b => b.checked).map(b => b.value);
      const parts = keys.filter(k => PART_ORDER.includes(k)), slateKeys = keys.filter(k => SLATE_ORDER.includes(k));
      const games = MAN.games.filter(g => SEL.has(g.id));   // kickoff order, as in the report
      const buttons = DLG.querySelectorAll("button");
      buttons.forEach(b => { b.disabled = true; });
      say(act === "print" ? "Preparing to print…" : "Preparing the PDF…");
      try {
        await run(act, games, parts, slateKeys, say);
        DLG.close();
        stopPick();
      } catch (err) {
        console.error(err);
        say("Couldn't build the PDF. Try again in a minute.");
        buttons.forEach(b => { b.disabled = false; });
        sync();
      }
    }));
    DLG.addEventListener("close", () => { DLG.remove(); DLG = null; });
    DLG.showModal();
  }

  function wirePick(box) {
    BOX = box;
    LIST = document.getElementById("gameList");
    if (!LIST) return;
    new MutationObserver(decorate).observe(LIST, { childList: true });
    box.querySelectorAll("button[data-pick]").forEach(btn =>
      btn.addEventListener("click", () => startPick(btn.dataset.pick)));
  }

  async function init() {
    const all = document.getElementById("packetAll"), one = document.getElementById("packetOne");
    if (!all && !one) return;
    let data;
    try {
      [MAN, data] = await Promise.all([loadJson("pdf/packets.json"), loadJson("data/data.json")]);
    } catch (e) {
      return;   // no packets yet: the buttons stay hidden
    }
    if (!MAN || MAN.week !== weekOf(data) || !MAN.games || !MAN.games.length) return;
    HAS = { byeTrends: !!(data && data.byeTrends) };
    if (all) {
      all.hidden = false;
      const full = MAN.games.filter(g => !g.missing.length).length;
      all.title = `${MAN.games.length} games, ${full} with all four parts (${MAN.parts.join(", ")})`;
      wirePick(all);
    }
    if (one) {
      const g = MAN.games.find(x => x.id === gameIdFromUrl());
      if (!g) return;
      one.hidden = false;
      one.title = g.missing.length
        ? `${MAN.parts.filter(p => !g.missing.includes(p)).join(", ")}. Not available for this game: ${g.missing.join(", ")}`
        : MAN.parts.join(", ");
      wire(one, () => [g]);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
