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
//   #packetAll  (This Week's Matchups)  buttons with data-packet="all" | "report"
//   #packetOne  (one matchup)           buttons with data-packet="game"
// and data-act="print" | "save".
(function () {
  const PART_ORDER = ["report", "matchup", "epa", "value"];
  let MAN = null, LIB = null;
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

  // One PDF from the given games' parts, in order: report, matchup, EPA, value board.
  async function assemble(games, status) {
    const PDFLib = await loadLib();
    const out = await PDFLib.PDFDocument.create();
    out.setTitle(games.length === 1 ? `${games[0].label} · ${MAN.title} packet` : `${MAN.title}: game packets`);
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (status && games.length > 1) status(`Building ${i + 1} of ${games.length}…`);
      for (const key of PART_ORDER) {
        const idx = g.pages[key];
        if (!idx || !idx.length) continue;
        const src = await source(PDFLib, key);
        if (!src) continue;
        const copied = await out.copyPages(src, idx);
        copied.forEach(p => out.addPage(p));
      }
    }
    return out.save();
  }

  async function wholeFile(key) {
    const name = MAN.files[key];
    const r = await fetch("pdf/" + name + "?v=" + encodeURIComponent(MAN.generatedAt), { cache: "no-cache" });
    if (!r.ok) throw new Error(name + ": HTTP " + r.status);
    return r.arrayBuffer();
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

  function wire(box, pick) {
    const status = box.querySelector(".packet-status");
    const say = t => { if (status) status.textContent = t || ""; };
    box.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const kind = btn.dataset.packet, act = btn.dataset.act;
        const buttons = box.querySelectorAll("button[data-act]");
        buttons.forEach(b => { b.disabled = true; });
        say(act === "print" ? "Preparing to print…" : "Preparing the PDF…");
        try {
          let bytes, name;
          if (kind === "report") {
            bytes = await wholeFile("report");
            name = `${MAN.league.toUpperCase()}_Week${MAN.week}_Matchup_Report.pdf`;
          } else {
            const games = pick();
            bytes = await assemble(games, say);
            name = games.length === 1 ? `${games[0].file}.pdf` : `${MAN.league.toUpperCase()}_Week${MAN.week}_Game_Packets.pdf`;
          }
          if (act === "print") print(bytes); else save(bytes, name);
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
    if (all) {
      all.hidden = false;
      const full = MAN.games.filter(g => !g.missing.length).length;
      all.title = `${MAN.games.length} games, ${full} with all four parts (${MAN.parts.join(", ")})`;
      wire(all, () => MAN.games);
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
