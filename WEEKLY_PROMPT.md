Weekly update for my CFB Matchup Dashboard — https://rhyman7.github.io/cfb/ (repo: github.com/rhyman7/cfb, branch main, served by GitHub Pages from the repo root).

## Goal
Refresh `data/data.json` with current 2026 FBS regular-season stats and push it to main so the live site updates. The site has three pages: `index.html` (this week's games), `matchup.html` (one game) and `dashboard.html` (compare any two teams). Do not change the HTML files, `app.js`, `live.js`, `style.css` or `scripts/build_data.py` unless a step below says to. (Live scores and box scores are fetched by the browser from ESPN at game time; this task never touches them.) The page reads only `data/data.json`, so its shape must stay the same.

**Scope:** all FBS teams, 2026 regular season only (ESPN season_type 2 — includes conference championship games and Army–Navy; excludes bowls and the CFP), completed games only. The build script already enforces this; build from scratch each run and never carry over anything from a previous run or season.

## Steps
1. Attach the repo with push access (add_repo: owner `rhyman7`, repo `cfb`, access `push`) and clone it.
2. Note what's published: `generatedAt`, `throughWeek` and `gamesCounted` in `data/data.json`.
3. Build: `pip install --break-system-packages -r requirements.txt`, then `python scripts/build_data.py`. It downloads six parquet files from `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/` (cfb_schedule, team_box, player_box, cfb_teams, cfb_rosters and cfb_matchup_line — spreads and O/U — for 2026), plus the full season schedule CSV from `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-raw/main/cfb/schedules/csv/cfb_schedule_2026.csv` (upcoming games and AP ranks). No API key is needed. The workspace can't reach collegefootballdata.com, ESPN or Sports-Reference, so don't try them.
4. Decide whether to publish:
   - If the new `gamesCounted` equals the published one, no games have been added: stop and send me one line saying so. If it's after December 15 and nothing new has come in, also tell me the regular season looks finished so I can turn this scheduled task off.
   - Check freshness: find the most recent Saturday before today. If the schedule has fewer than ~40 final games dated that Thursday–Saturday (in-season weeks usually have 60+), the source probably hasn't caught up. Wait about 2 hours and rebuild once; if it's still short, publish what's there and tell me which week it runs through.
   - If the download fails (404 or file missing), check the repo's file list with `git clone --depth 1 --filter=blob:none --no-checkout https://github.com/sportsdataverse/cfbfastR-cfb-data` and `git ls-tree -r --name-only HEAD | grep 2026`. If files were renamed or moved, update the paths in `FILES` at the top of `scripts/build_data.py`, rebuild, commit the script too, and tell me what changed. If the data is gone entirely, stop and tell me.
5. Verify before pushing:
   - 130+ FBS teams; every team has at least one passer, rusher and receiver, and no player named "Team".
   - `currentWeek` is the coming week (the first regular-season week with unplayed games) and `weekGames` lists its games (normally 40–70; bye-heavy weeks and conference championship week are smaller). Every game has both teams, a start time and a clickable id, and FBS teams have a `key` that exists in `teams`. Most FBS-vs-FBS games have a `spread` and `total` and each FBS side has a `qb`; if spreads are missing for the whole week, say so but still publish.
   - Exactly 25 teams have an `apRank` (1–25, no duplicates), unless the poll isn't out yet; say so if not.
   - Ranks run from 1 up to about the team count; values sane (team rush yds/G 30–400, pass yds/G 50–450, PPG 3–70).
   - W+L+T for two teams matches their final regular-season games in the schedule; spot-check one known starting QB's yards/G against the player box.
   - Run `python -m http.server 8000` and load the pages headlessly (Playwright if available): `index.html` shows the week's game cards, one `matchup.html?game=<id>` link shows the game header, the Head to Head tables and two team cards, and `dashboard.html` shows two team cards, all with no console errors.
6. Commit only `data/data.json` (plus the script if step 4 changed it) to main with a message like `Week N data update (through Week N, 2026)` and push. Pages redeploys within a couple of minutes.
7. Send me a short message: which week the stats now run through, which week's games the landing page shows (and how many), and anything that fell back or looked off. Nothing else.

## If the site files are missing
Restore them from this repo's git history (`git log -- index.html` and check out the last good version) rather than rebuilding by hand. Then run the update above.
