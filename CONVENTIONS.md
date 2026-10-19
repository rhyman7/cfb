# Conventions: CFB Matchup Dashboard

Read this before changing anything in this repo, and update it in the same pull request
whenever a convention changes. The sister site, [rhyman7/nfl](https://github.com/rhyman7/nfl),
has its own CONVENTIONS.md; the shared rules below are the same in both files.

- Live site: https://rhyman7.github.io/cfb/ (GitHub Pages, branch `main`, repo root).
  This repo, `rhyman7/cfb`, is what serves `/cfb/`. `rhyman7/cfb.github.io` is an empty
  placeholder and is not the site.
- Landing page: https://rhyman7.github.io/ (the Weekly Gridiron Board, repo
  [rhyman7/rhyman7.github.io](https://github.com/rhyman7/rhyman7.github.io)), which links to both dashboards
- README.md describes every page and feature in detail; WEEKLY_PROMPT.md is the weekly
  data-update task's instructions; this file is the rules.

## How changes get made

- **Pull requests only.** Never push or merge to `main` yourself: `main` is the live site.
  Open a pull request and wait for Ryan's approval. One topic per PR.
- **Both dashboards.** Design and feature changes go to both this site and the NFL site
  unless Ryan says otherwise. Open the matching PR in `rhyman7/nfl`, and don't call the
  change finished until both are done.
- **Ask first** if anything is unclear or a change could break the live site.
- **Keep the landing page in step.** If the look or the page names change, check that
  rhyman7.github.io still matches (same graphite palette, Archivo, same page names and order).
- **Out of scope here:** prediction and betting-model work belongs in the separate CFB/NFL
  Model project, not in this repo.
- **What does commit straight to `main`** (automated, not hand edits): the weekly data
  update (`data/`, see WEEKLY_PROMPT.md) and the **Build EPA PDF** Action (`pdf/`).
  Everything else goes through a PR.

## Site structure

- Static site, no build step for the pages. Plain HTML, CSS and JavaScript; no framework,
  no bundler. Every page fetches `data/data.json` in the browser.
- Unlike the NFL site, almost all page logic is in **one file, `app.js`** (data loading,
  slate, matchup, Head to Head, team cards, game logs, search, week strip, Weekly Edges,
  Compare, Print all). It decides what to render from `<body data-page="…">`. Only the EPA
  page and How to Read have their own scripts, loaded after `app.js`.
- Pages:

  | Page | File | Scripts after `app.js` | `data-page` |
  |---|---|---|---|
  | This Week's Matchups | `index.html` | `live.js`, `weather.js` | `week` |
  | How to Read Matchups | `how-to-read.html` | `live.js`, `weather.js`, `how-to-read.js` | `learn` |
  | EPA | `epa.html` | `live.js`, `epa.js` | `epa` |
  | EPA Explained | `epa-explained.html` | (inline script only) | `epaexplained` |
  | Weekly Edges | `edges.html` | `live.js` | `edges` |
  | Compare Any Two Teams | `dashboard.html` (`?team1=…&team2=…`) | `live.js` | `dashboard` |
  | Ratings Explained | `ratings.html` | (plus an inline script) | `ratings` |
  | Matchup (one game) | `matchup.html?game=<ESPN game id>` | `live.js`, `weather.js` | `matchup` |
  | Print all | `print.html` | `live.js` | `printall` |

- Every page loads `style.css` and `teamcolors.js` first, then `app.js`. Put shared logic in
  `app.js` rather than copying it into a page script.
- Teams are keyed by **name** (as in `data.json` and `TEAM_COLORS`), not abbreviation.
  Game ids are ESPN ids.
- Escape anything from data before putting it in HTML (`escapeHtml()` in `app.js`).
- Wrap `localStorage` reads and writes in try/catch; the page has to work without it.
- Live scores, current lines (ESPN) and forecasts (Open-Meteo, with venue cities geocoded
  and cached in the browser) are fetched in the viewer's browser. If either service fails,
  the page leaves that part out or shows a short note and falls back to the weekly data.
  Never let a failed fetch break a page.
- Non-FBS opponents have no stats: show a short note instead of a team card.

## Nav and page names

- Same nav on every page, in this order:
  This Week's Matchups | How to Read Matchups | **EPA | EPA Explained | Weekly Edges** |
  Compare Any Two Teams | Ratings Explained.
  EPA sits left of Weekly Edges and EPA Explained sits right of EPA.
- Each link has a full and a short label (`nav-full` / `nav-short`); the short ones show when
  the bar is narrow. The current page's link gets `class="active"`.
- The top bar's right side links to the other dashboard (`league-link`, `/nfl/`).
- The NFL site uses the same order and labels. Change both together.

## Look

- Graphite dark theme. Colors are CSS custom properties on `:root` in `style.css`
  (`--bg`, `--panel`, `--text`, …); use them rather than new hex values. `style.css` is kept
  close to the NFL site's; make the same visual change in both.
- Type is Archivo from Google Fonts, falling back to Helvetica Neue / Arial.
- Team colors carry the color. `TEAM_COLORS[team name] = [primary, secondary]` in
  `teamcolors.js` covers every FBS and FCS team, from ESPN's team list (`cfb_teams`: `color`
  and `alternate_color`). A few teams have no secondary listed; a team missing from the table
  gets a neutral block. `teamColors()` / `teamVars()` derive the readable versions and set
  `--tc`, `--tc-on`, `--tc-on2`, `--tc-ink`, `--tc-inkp` on the team's element. The color math
  is the same as the NFL site's; change it in both.
- **Team-color blocks** (the matchup header scorebug, the team stats header, the week
  board's abbreviation blocks) are the primary color lettered in the team's **secondary**
  color (`--tc-on2`), **never black**. Don't swap in `--tc-on` or a fixed color.
- Team color as text, bars and dials on the dark page uses `--tc-ink`; in print, `--tc-inkp`.
- Pages must work from phone width up: nothing cut off or overlapping, wide tables scroll
  sideways inside their container.

## Matchup page

- Game header is a scorebug: each team's name on its block (with AP rank), the current line
  between them.
- **Info bar under the header:** kickoff, venue, then one slot (`heroWxText()` in `app.js`):
  - indoor games show only `Dome`;
  - outdoor games show the forecast itself (conditions, temperature at kickoff, or the day's
    high when there's no kickoff time yet, rain chance, wind), with **no "Forecast" label**.
- Head to Head: FBS rank bars, and the edge goes to the side that ranks enough spots better
  to match the NFL site's 6 of 32: `edgeGap()` = team count × 6 ÷ 32, rounded (26 with 138
  FBS teams). Don't hard-code the number. The side with the edge shows in its team color.
- Betting trends and the live box score are screen-only (left out of print).

## Printing and PDFs

- Anything screen-only gets `class="no-print"`; print rules live in `@media print` in
  `style.css`.
- A matchup prints on **two landscape pages** (header, Head to Head and pace; then both team
  cards with usage). Print all (`print.html`) is every game currently shown on the slate,
  respecting the conference / Top 25 / search filters, two pages each.
- The **EPA page always has both "Print all" and "Download PDF"** buttons (`epaPrintBtn`,
  `epaPdfBtn`). Print all is every game (one landscape page each), then the board, the
  ratings and the method; Download PDF is `pdf/epa.pdf`.
- `pdf/epa.pdf` is the only PDF on this site (no per-game PDFs; there are 50+ games a week).
  It's built by `scripts/build_pdfs.py` (headless Chromium via Playwright) in the **Build EPA
  PDF** Action, which runs when the data or the EPA page change. `pdf/manifest.json` says
  which week it's for; the link only shows when it matches the week on the page. Don't
  hand-edit anything in `pdf/`.
- If you change the print layout, check the page count still comes out right.

## Cache busting

- After changing a CSS or JS file, bump its `?v=` value on the `<link>` / `<script>` tag in
  **every** HTML page that loads it. The value is the change time, `YYYYMMDDHHMM`
  (e.g. `app.js?v=202610162100`). Only bump the files you changed. `app.js` is on every page.

## Data

- **Source:** [sportsdataverse/cfbfastR-cfb-data](https://github.com/sportsdataverse/cfbfastR-cfb-data)
  (ESPN-derived parquet files, downloaded from raw.githubusercontent.com, no API key) and
  the season schedule CSV from `cfbfastR-cfb-raw` (upcoming games, AP ranks). The file list is
  `FILES` at the top of `scripts/build_data.py`. Lines: ESPN in the browser, the cfbfastR
  consensus line (rounded to the half point) in the weekly data.
- **Scope:** every FBS team, the current season's **regular season only** (ESPN season type 2,
  which includes conference championships and Army–Navy, excludes bowls and the CFP), completed
  games only. Stats are built from scratch each run.
- **Build:** `python scripts/build_data.py` from the repo root writes `data/data.json`,
  `data/epa.json` (via `scripts/epa_ratings.py`, when play-by-play downloads),
  `data/season.json` and the `data/weeks/<N>.json` that changed. `scripts/situational.py`
  is called from it. Run with the default `--out` so it can keep this week's `lineOpen`.
- **The weekly update is manual and done together**, not fully automated: a scheduled task
  runs Mondays at 7:47 AM ET following **WEEKLY_PROMPT.md**, which lists the steps and the
  checks before publishing.
- **WEEKLY_PROMPT.md must match the site.** When a change adds, renames or removes a page, a
  data file or a `data.json` key, update WEEKLY_PROMPT.md in the same PR (its page list,
  "data.json shape" and checks), and check the scheduled task's wording still matches.
- `data.json` keys are read by the pages. Adding a key is fine; renaming or removing one
  needs `app.js` (and WEEKLY_PROMPT.md) updated in the same PR.
- `currentWeek` is the first regular-season week that still has an unplayed game.
- `scripts/epa_ratings.py` is **identical in both repos**. Change it in both, or not at all.
- **Not available for college:** injury tags (cfbfastR has no injury report), referee
  tendencies and fantasy points. Don't add NFL features that depend on them without a source.

## Player props (later)

- Player prop odds are being tested on the NFL site first (The Odds API, free plan). This
  site has none yet. When they come here, follow the NFL repo's setup (an Action with the key
  as a repository secret, credit budget checked first) and update this section.

## Testing a change

- Serve the repo root locally (`python -m http.server 8000`) and load the pages you touched at
  desktop and phone widths with no console errors. ESPN and Open-Meteo may be unreachable in a
  sandbox; the pages should still load. WEEKLY_PROMPT.md step 5 has a fuller page checklist.
- For anything touching print: print a matchup and the EPA page to PDF and check the page count.
- Do the same check on the NFL site for the matching change.
