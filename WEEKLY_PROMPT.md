Daily update for my CFB Matchup Dashboard — https://rhyman7.github.io/cfb/ (repo: github.com/rhyman7/cfb, branch main, served by GitHub Pages from the repo root).

**This is the daily run (every day at 9:47 AM ET, August–December).** It replaced the old Monday-only task. Each run: (a) rebuilds the data and publishes it if anything changed (new final scores from weeknight or weekend games, the week rolling over, line moves, AP poll); (b) reads injury designations for this week's games and publishes them as the site's injury tags; (c) checks who is starting at quarterback this week for every team playing, regardless of who started before; (d) checks the weather for upcoming outdoor games; then (e) tells me what's worth knowing. On quiet days with nothing to report, stay silent.

**Web addresses (read this before any WebFetch).** WebFetch only opens an address that appears word for word in this conversation: in this prompt or in a WebSearch/WebFetch result. An address you build from a pattern (filling in a slug, a city or coordinates), or that a subagent reads from a file, is refused with PROVENANCE_REQUIRED, and nobody is around to approve it. That's why on Oct 23, 2026 every subagent Covers fetch and every Open-Meteo fetch failed. So: copy addresses exactly as written in this prompt (the Covers list at the end, the weather pages in step 8), or get them from a search result first. Don't hand addresses to subagents to fetch.

## Goal
Refresh `data/data.json` with current 2026 FBS regular-season stats, `data/injuries.json` with current injury designations and `overrides/qb_starters.json` with this week's starting QBs, and push them to main so the live site updates. The site has these pages: `index.html` (this week's games), `edges.html` (Weekly Edges: game board and prop matchups), `matchup.html` (one game), `print.html` (prints every matchup), `dashboard.html` (compare any two teams), `ratings.html` (ratings explained), plus `epa.html`, `epa-explained.html` and `how-to-read.html`. Do not change the HTML files, any JS, `style.css` or the scripts unless a step below says to. (Live scores, box scores, the current ESPN line and the kickoff forecast are fetched by the viewer's browser at page load; this task never touches them. Weather goes only into my message; the site's forecast is live already.) The pages read `data/data.json`, so its shape must stay the same (see "data.json shape"). The week strip in the top bar also reads `data/season.json` and `data/weeks/<N>.json`; the build script writes those (and `data/epa.json`) on every run, so don't edit them by hand. The injury tags (an O/D/Q/P superscript after each listed player's name, and an Injury report on each team card) come from `data/injuries.json`, which `scripts/injuries.py` writes in step 7; don't edit it by hand either. The QB in each game header and on the EPA page comes from `overrides/qb_starters.json` (step 7e) while its `week` matches the coming week; without it the build falls back to each team's leading passer in its most recent game. The College Value Board (rhyman7/fb-value-board) reads the same file for its game model and player projections.

**Redesign (October 2026).** The site's look was redesigned (week board, scorebug game header, team-color blocks from `teamcolors.js`, Head to Head rank bars, Archivo type). It's merged into main and intentional, so never treat it as broken or restore older files over it. Newer features (the week strip, including its note when a week's matchups aren't set yet, the EPA pages, the injury tags and the weekly starting-QB list) are intentional too.

**Scope:** all FBS teams, 2026 regular season only (ESPN season_type 2 — includes conference championship games and Army–Navy; excludes bowls and the CFP), completed games only. The build script enforces this and builds everything from scratch each run. The one deliberate exception, handled by the script: each week game's `lineOpen` (the line at the week's first build) is kept from the published file when it's the same season and week, so the site can show line movement.

## Steps
1. Get the repo with push access. Scheduled runs usually start with rhyman7/cfb already cloned at /home/claude/cfb with push access (on Oct 23, 2026 the clone was there and `add_repo` wasn't available). If that clone exists: `cd /home/claude/cfb && git checkout main && git pull origin main` (it may start on a detached HEAD). If it doesn't, attach the repo with `add_repo` from the Claude Code Remote connector (full name `mcp__claude-code-remote__add_repo`; if it isn't in your tool list, load it with ToolSearch query `select:mcp__claude-code-remote__add_repo`) with owner `rhyman7`, repo `cfb`, access `push`, then clone exactly as its result says; if add_repo returns an error, wait 30 seconds and try once more. Before building, confirm you can push: run `git push --dry-run origin HEAD:main` in the clone. If you still can't attach or push, do the whole update anyway and then follow "If you can't push" below. Never end the run with only a note that the push failed. The **Build PDFs** Action commits to main after each of your pushes, so a later push can be rejected as non-fast-forward: then `git fetch origin && git rebase origin/main` (your own commits only) and push again.
2. Note what's published: `generatedAt`, `throughWeek`, `gamesCounted`, `currentWeek`, and each `weekGames` entry's `spread`, `total`, `lineOpen` and each side's `qb` in `data/data.json`. Keep a copy of the published file for comparison (step 6).
3. Build: `pip install --break-system-packages -r requirements.txt`, then `python scripts/build_data.py` from the repo root. Keep the default `--out` (the repo's `data/data.json`) so the script can read the published file for `lineOpen`. It downloads parquet files from `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-data/main/cfb/` for 2026 (cfb_schedule, team_box, player_box, cfb_teams, cfb_rosters, cfb_matchup_line, play_by_play, game_rosters), plus the season schedule CSV from `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-cfb-raw/main/cfb/schedules/csv/cfb_schedule_2026.csv` (upcoming games and AP ranks). No API key is needed. The shell can't reach collegefootballdata.com, ESPN or Sports-Reference, so don't try them from the shell. The script prints `note:` lines; pass on anything unusual in step 9. Normal notes: positions "filled from game_rosters" (cfb_rosters was cut to 4 teams on 2026-09-29); "starting QBs for N teams applied from overrides/qb_starters.json"; "lineOpen kept for N of M Week W games" (games with no line yet get a fresh `lineOpen` date each run; that's expected); and, on the first run of a new week, "overrides/qb_starters.json is for Week N, not Week M: not applied" (step 7e writes the new week's list). A note that play-by-play or game_rosters failed to download means EPA/targets or the position fallback are missing: retry once, and if it's still missing publish anyway and tell me.
4. Decide whether to publish:
   - Compare the new `data/` files with what's published (`git diff --stat data` plus a check of `data/data.json` ignoring `generatedAt`). If nothing changed except `generatedAt`, don't commit or push: `git checkout -- data` and go on to step 7 (injuries and QBs) — there's no need to verify pages.
   - **Freshness (only on the first run after a Saturday slate — Sunday and Monday):** if the schedule has fewer than ~40 final games dated that Thursday–Saturday (in-season weeks usually have 60+), the source hasn't caught up. On Sunday, publish what's there (it'll fill in Monday). On Monday, wait about 2 hours and rebuild once; if it's still short, publish what's there and tell me which week it runs through.
   - If a download fails (404 or file missing), check the repo's file list with `git clone --depth 1 --filter=blob:none --no-checkout https://github.com/sportsdataverse/cfbfastR-cfb-data` (or `cfbfastR-cfb-raw` for the schedule CSV) and `git ls-tree -r --name-only HEAD | grep 2026`. If files were renamed or moved, update the paths in `FILES` at the top of `scripts/build_data.py`, rebuild, commit the script too, and tell me what changed. If the core data is gone entirely, stop and tell me.
   - If it's after December 15 and nothing new has come in, tell me the regular season looks finished so I can turn this scheduled task off.
5. Verify before pushing (write a short Python check; report any failure):
   - 130+ FBS teams; every team has at least one passer, rusher and receiver, and no player named "Team".
   - `currentWeek` is the coming week (the first regular-season week with unplayed games) and `weekGames` lists its games (normally 40–70; bye-heavy weeks and conference championship week are smaller; on Thursday–Saturday some may already be final). Every game has both teams, a start time, an id and a `lineOpen` object; FBS teams have a `key` that exists in `teams`. Most FBS-vs-FBS games have a `spread` and `total` and each FBS side has a `qb`. If `currentWeek` moved since the published file, `lineOpen` should equal each game's `spread`/`total` with today's date; if it's the same week, `lineOpen` must be unchanged from the published file for every game that has a line.
   - Exactly 25 teams have an `apRank` (1–25, no duplicates), unless the poll isn't out yet; say so if not.
   - Ranks run from 1 up to about the team count; values sane (team rush yds/G 30–400, pass yds/G 50–450, PPG 3–70).
   - `gameLogs`: every row in every team's `passing`, `rushing` and `receiving` table has a `log` key that exists in `gameLogs` and a non-empty `pos`; `hasTargets` is true and log entries carry `tgt` for receivers.
   - `betting`: every team has it; league-wide ATS wins equal ATS losses; team-games in all `betting.games` lists = 2 × completed games that have a matchup line; for each team, fav+dog ≤ ats total and home+away ≤ ats total.
   - `eff`: every team has offense and defense `epa`, `sr` and ranks; EPA/play between −0.6 and 0.6, success rate 25–70.
   - Week strip files: `data/season.json` lists weeks 1–15 and every `data/weeks/<N>.json` exists (each holds a `weekGames` list); the file for the last finished week has every game `completed` with scores, and the file for `currentWeek` has the same games as `weekGames`.
   - When `throughWeek` or `currentWeek` changed (a new week), also do the full page check: run `python -m http.server 8000` and load the pages headlessly with Playwright (Chromium, at /opt/pw-browsers) at 1280 and 390 wide with no page errors (failed requests to ESPN and Open-Meteo are expected): `index.html` lists the week's games; one `matchup.html?game=<id>` for an FBS-vs-FBS game shows the game header (implied-totals line starting "Implied" and a line-move line), Head to Head with "EPA / play" and "Success %" rows, Betting Trends for both teams and two team cards (hover a player name — scroll it into view first, then move the mouse onto it — for the game-log tooltip; click it for the game-log panel); `dashboard.html`, `edges.html` (game board + QB/RB/WR/TE prop tables), `ratings.html` and `print.html?auto=0` load; `index.html?week=<finished week>` shows final scores linking to games. Top-bar search: two letters of a player's name, ArrowDown, Enter opens the game-log panel. On other days, just load `index.html` and one `matchup.html?game=<id>` to confirm no page errors.
6. Commit the `data` folder (`git add data`), plus the script if step 4 changed it, to main and push. Commit message: on a new week `Week N data update (through Week M, 2026)`; otherwise `Week N daily refresh (YYYY-MM-DD)` (N = currentWeek). Pages redeploys within a couple of minutes. Confirm it went live: WebFetch `https://rhyman7.github.io/cfb/data/data.json` and check the new `generatedAt`; if that isn't reachable, check the "pages build and deployment" run for your commit succeeded (`gh api "repos/rhyman7/cfb/actions/runs?per_page=4"`) and say that's how you confirmed it. Also note, for step 9: games that went final since the published file; and line moves since the published file (spread 1+ point or total 1.5+ points), plus any game whose spread crossed 3, 7 or 10 or flipped favorite since `lineOpen`.
7. **Injuries and starting QBs — the site's tags, the QB list and my message.** College football has no official injury report, so Covers.com is the source of record for the tags, with news checks on top. Look for starting QBs above all (out, doubtful, a new starter named, benched, or status in doubt), then RB1/WR1/TE1 and multiple offensive-line or secondary starters. Web searches are capped at about 200 per run across you and all subagents: step 7e uses about 120, so keep step 7a's unlock searches to about 20 and step 7b to about 40.
   **Order:** first write the step 7e QB lists and launch the 4 QB subagents (all in one message), then read Covers yourself (step 7a) while they run.
   a. **Covers.com — every FBS team in `weekGames` that hasn't kicked off, every run** (the whole week, so every matchup page has current tags). Read each team's own Covers injuries page, using the full addresses in "Covers injury pages" at the end of this prompt (all 138 teams were checked on Oct 21, 2026; the same list is in the project doc `claude/covers-injury-urls.md`). Don't use the league page (https://www.covers.com/sport/football/ncaaf/injuries): WebFetch only loads Air Force through about Colorado on it. Use WebFetch only; never curl, Python or other tools for Covers.
      - **Read Covers yourself, in this session — not with subagents** (see "Web addresses" at the top). Copy each team's address exactly from the list. Send about 10–12 WebFetch calls per message, in parallel, each with this prompt: "Output every NCAAF injury table row, one per line, as: player|pos|status|injury|date|note. Status only the first word (Out/Doubtful/Questionable/Probable). Note only Covers' own words such as 'out for the season' or 'no timetable'. No other text. If no injuries, output NONE." Write the rows to a text file in your scratchpad as you go (`## <site team name>` then one row per line), then convert it to `covers.json` shaped `{"<site team name>": {"read": true, "rows": [{"player": "R. Coleman-Williams", "pos": "WR", "status": "Out", "injury": "Knee", "date": "Sat, Oct 17", "note": ""}]}}` (team names exactly as in the list; an empty `rows` list for NONE). A page that comes back as prose instead of rows (Stanford's did on Oct 23) is fine: take the rows from it and leave a missing date empty.
      - **If a fetch is refused with PROVENANCE_REQUIRED**, don't repeat it unchanged. Run a WebSearch restricted to Covers (`allowed_domains: ["covers.com"]`) naming 5–7 of the refused teams with their nicknames plus "injury report", for example "Indiana Hoosiers TCU Horned Frogs West Virginia Mountaineers BYU Cougars UCF Knights injury report". Each search returns about 4–6 team injury pages, and an address that came back in a search result can then be fetched. On Oct 23, 2026, ten such searches unlocked 44 teams. Keep to about 20 searches, starting with games in the next 4 days that have an AP-ranked team or a spread of 10 or less.
      - If a page comes back as the team's overview page instead of the injury table, re-read it once; an overview page links to the right injuries address, so use that and tell me the corrected slug.
      - Any team still not read keeps its previous tags (`scripts/injuries.py` does that) and gets covered by step 7b. Tell me how many teams were read.
   b. **News search (every run).** Use WebSearch (and WebFetch on the articles it returns) for injury news from the last ~48 hours that Covers may not have yet, and for any team Covers couldn't be read for, prioritizing games in the next 4 days with an AP-ranked team, then games with a spread of 10 or less: team beat writers, school releases, the conference availability reports (SEC, ACC, Big Ten and Big 12 publish them from Wednesday on), ESPN, The Athletic, On3, 247Sports, RotoWire, Action Network and similar. Search by team ("<team> injury report <opponent>"), not by conference: generic "availability report Week N" searches came back empty on Oct 23, 2026. Check each article's date and ignore anything from a previous season (old articles often show up in results).
   c. **Publish the tags.** Put news items that change a player's status on the site into their own JSON file as `{"_news": [{"team": "<site team name>", "player": "<site player name>", "pos", "status" ("Out", "Doubtful", "Questionable", "Probable", or "Active" when he's confirmed back although Covers still lists him), "injury", "date": "YYYY-MM-DD", "source": "<outlet>", "note": "<a few words>"}]}`. Only use an item that is from this season and either confirmed (school, coach, two outlets) or a clearly reported status; a news entry replaces the Covers tag for that player and shows its source. Include QBs that step 7e found out, doubtful or questionable with an injury. News tags from earlier runs this week are in `data/injuries.json` (`players` entries whose `src` isn't "Covers"): carry over the ones that are still this week's news into the file, or they'll drop for teams read today. Then run `python scripts/injuries.py <your covers.json> [<the news file>]` from the repo root. It matches Covers names (first initial and last name) to the site's players by team, writes `data/injuries.json`, keeps the previous tags for teams not read this time, and marks a tag "stale" (shown dimmed) when the player has recorded stats in a game after his Covers date. Check: the printed counts look sane (usually 100+ players tagged), `checked` has today's date for every team you read, every key in `players` exists in `gameLogs`, and a QB listed Out/Doubtful who is the site's `qb` in `weekGames` shows in `players`. Load one `matchup.html?game=<id>` headlessly to confirm the `sup.inj` tags and the "Injury report" block render with no page errors. If `data/injuries.json` changed in more than `generatedAt`, commit just that file to main (`Injury tags (YYYY-MM-DD, Covers.com)`) and push; otherwise `git checkout -- data/injuries.json`.
   d. For my message: report Covers rows updated in the last ~7 days, plus any starting QB or RB1/WR1/TE1 listed Out or Doubtful whatever the date, for games in the next 4 days; and the news items with source and date. Flag any stale tag on a starting QB (Covers listed him out but he has played since). Don't report rumors as facts: label anything unconfirmed as "questionable / unconfirmed" with its source. Keep it to the items that matter (roughly 10 at most).
   e. **Starting QB for every team, every run.** Don't assume last week's starter: on every run, check who is expected to start at QB this week for every FBS team in `weekGames` that hasn't kicked off. Hand the teams to about 4 general-purpose subagents (Agent tool), all launched in one message before you start step 7a. Give each a text file in your scratchpad with one line per team: `<team> | vs <opponent> <home/at> <date> | site QB: <the build's default qb> | other QBs: <the other QB rows in the team's passing table> | injury tags: <any QB tags in data/injuries.json> | yesterday's check: <qb (status; note) from overrides/qb_starters.json>`. Tell it: today's date and week; use WebSearch (and WebFetch only on article addresses its own searches returned; load them with ToolSearch "select:WebSearch,WebFetch" if needed) for reporting from this season after the team's last game — the site QB injured, out or doubtful, benched, a different starter named by the coach or clearly reported, or a QB who left last week's game hurt; pay special attention to teams whose check yesterday was "uncertain" or "reported"; check dates (old seasons show up); about one search per team and at most ~30 in total, more per team only where something turned up; write JSON with the Write tool to `qb_<n>.json`: `{"<team>": {"qb": "<expected starter, spelled as in the list>", "changed": true|false, "status": "confirmed" | "reported" | "uncertain" | "no change", "source": "<outlet, date>", "note": "<a few words>"}}` with an entry for EVERY team; for a genuine open question (game-time decision, no starter named) keep the site QB, mark it "uncertain" and name the alternative in `note`; if a QB is out, doubtful or questionable with an injury, say so in `note`; no rumors. Then rewrite `overrides/qb_starters.json` as `{"_about": …, "season": 2026, "week": <currentWeek>, "checked": "<today>", "starters": {"<team>": {"qb", "status", "source"?, "note"?}}}` with every team checked (keep `_about`). Carry over the previous file's entry for a team you couldn't check this run only if it's for the same week. Rebuild (step 3), check that each team's `qb` in `weekGames` equals its entry, that `lineOpen` is unchanged, and that the build printed no "has no passing row" note (if it did, fix the spelling to match the passing table, or keep the name if he has never thrown a pass), then commit `overrides/qb_starters.json` with the `data` folder to main (`Week N starting QBs (YYYY-MM-DD)`) and push; if nothing changed except `checked`, `git checkout -- overrides data`. The College Value Board (rhyman7/fb-value-board) reads this same file on each build; when you pushed a changed list, start its rebuild so it picks the list up today: `gh api -X POST repos/rhyman7/fb-value-board/actions/workflows/update-cfb.yml/dispatches -f ref=main` (no output means it started). If that's refused, say so in my message; the board's next scheduled run picks the list up.
8. **Weather.** For the `weekGames` that haven't kicked off, start within the next 3 days and are outdoors (`indoor` false), get the kickoff-time forecast:
   - First, WebFetch https://cleatz.com/college-football/weather/ and ask for every game's date, kickoff, temperature, wind speed and gusts, and precipitation chance, one line per game (on Oct 23, 2026 it listed all 52 games of the week). If that address is refused, WebSearch "cleatz college football weather" and fetch the cleatz.com/college-football/weather/ address the search returns.
   - If cleatz doesn't load or is missing games, try WebFetch on https://www.oddstrader.com/ncaa-college-football/weather/ (it had every game on Oct 22, 2026, but was refused on Oct 23), then WebSearch for the specific games' forecasts.
   - Don't build Open-Meteo addresses: they're refused (see "Web addresses"), and a multi-city address is too long for WebFetch.
   - Cleatz shows no update time, so say the forecasts come from cleatz. Flag only games where it matters for totals: sustained wind 15+ mph or gusts 25+, rain or snow likely (60%+ chance) at kickoff, or temperatures below 32°F or above 95°F. Say which games you couldn't check.
9. Send me a short message (SendUserMessage; load it with ToolSearch if hidden) only if there's something to report — something was published, there's injury or QB news or a weather flag, or anything failed or looked off. Include: whether data was published (new week or daily refresh) and which week the stats run through; on a new week, which week's games the landing page shows (and how many) and the ATS balance (W = L); new finals; notable line moves; starting QBs: every team whose starter changed from its last game's starter (source, date) and the "uncertain" ones playing in the next 4 days, plus one line on how many teams were checked, whether `overrides/qb_starters.json` was published and whether the College Value Board rebuild was started; injury items (source and date, marking which came from Covers), plus one line on the injury tags (players tagged, how many stale, teams read out of teams playing this week, any not read or corrected slugs, and whether `data/injuries.json` was published); weather flags; any `note:` lines that look unusual and anything that fell back (including any address refused with PROVENANCE_REQUIRED that the search workaround couldn't unlock). Nothing else. If none of that applies (nothing changed, no injury or QB news, no weather flags), send no message and no notification; just end the run. A routine tag or QB-list refresh on its own isn't news.

## data.json shape (keys the pages read; the script writes all of them)
- Top level: `generatedAt`, `season`, `throughWeek`, `gamesCounted`, `source`, `teamNames`, `teams`, `currentWeek`, `pollName`, `weekGames`, `gameLogs`, `hasTargets`, `notes`, `leagueAverage`, `gaugeRanges`.
- `teams[name]`: `team`, `conference`, `abbr`, `record` {w, l, t, sos, srs, osrs, dsrs}, `offense`, `defense`, `passing`/`rushing`/`receiving` rows (each with `player`, the table stats, `pos`, `log`), `defVsPosition` {rb, recRb, te, wr}, `apRank`, `betting` {ats, fav, dog, home, away: {w,l,p}, ou: {o,u,p}, games: [{w, opp, at, line, score, ats, total?, ou?}]} and `eff` {off, def: {epa, sr, passEpa, rushEpa, plays, epaRank, srRank}}.
- `weekGames[]`: `id`, `week`, `start`, `timeTbd`, `neutral`, `conferenceGame`, `status`, `statusDetail`, `completed`, `venue`, `city`, `tv`, `note`, `indoor`, `spread` (home side, negative = home favored), `total`, `away`/`home` {name, key, rank, record, conference, score, abbr, qb}, `lineOpen` {spread, total, at}.
- `gameLogs["ABBR|athlete_id"]`: one entry per game {w, opp, at?, res, cmp, att, pYds, pTd, int, car, rYds, rTd, rec, recYds, recTd, tgt}; zero stats are left out.
The build script is the source of truth for the shape; don't remove keys it writes.

## data/injuries.json shape (written by scripts/injuries.py)
`season`, `generatedAt`, `source`, `teamsRead`, `checked` {team name: date its Covers page was last read}, `players` {gameLogs key: {s (O/D/Q/P), status, injury, date, src ("Covers" or the news outlet), note ("Knee · Covers, Oct 17 · …"), name (as listed), player (site name), team, pos, stale?, playedSince?}}, `unmatched` [the same fields, for listed players who aren't in the site's stat tables]. The pages read `players`, `unmatched` and `checked`; the script is the source of truth.

## If the site files are missing
Restore them from this repo's git history (`git log -- index.html` and check out the last good version) rather than rebuilding by hand. Then run the update above.

## If you can't push
If the repo can't be attached with push access or the push is refused (and the build had changes to publish), the update still has to reach me:
1. Send me a message right away (SendUserMessage; load it with ToolSearch if it's hidden) saying the update was built but not published, with the exact error text, plus the step 9 summary.
2. Zip the built `data/` folder (`data/data.json`, `data/season.json`, `data/epa.json`, `data/injuries.json`, `data/weeks/`) and `overrides/qb_starters.json`, and send it to me with SendUserFile.
The next run rebuilds from scratch, so nothing is lost beyond the delay.

## Covers injury pages (site team name: full address; verified Oct 21, 2026)
Copy these addresses exactly when you call WebFetch.
- Air Force: https://www.covers.com/sport/football/ncaaf/teams/main/air-force-falcons/injuries
- Akron: https://www.covers.com/sport/football/ncaaf/teams/main/akron-zips/injuries
- Alabama: https://www.covers.com/sport/football/ncaaf/teams/main/alabama-crimson-tide/injuries
- App State: https://www.covers.com/sport/football/ncaaf/teams/main/appalachian-state-mountaineers/injuries
- Arizona: https://www.covers.com/sport/football/ncaaf/teams/main/arizona-wildcats/injuries
- Arizona State: https://www.covers.com/sport/football/ncaaf/teams/main/arizona-state-sun-devils/injuries
- Arkansas: https://www.covers.com/sport/football/ncaaf/teams/main/arkansas-razorbacks/injuries
- Arkansas State: https://www.covers.com/sport/football/ncaaf/teams/main/arkansas-state-red-wolves/injuries
- Army: https://www.covers.com/sport/football/ncaaf/teams/main/army-black-knights/injuries
- Auburn: https://www.covers.com/sport/football/ncaaf/teams/main/auburn-tigers/injuries
- BYU: https://www.covers.com/sport/football/ncaaf/teams/main/byu-cougars/injuries
- Ball State: https://www.covers.com/sport/football/ncaaf/teams/main/ball-state-cardinals/injuries
- Baylor: https://www.covers.com/sport/football/ncaaf/teams/main/baylor-bears/injuries
- Boise State: https://www.covers.com/sport/football/ncaaf/teams/main/boise-state-broncos/injuries
- Boston College: https://www.covers.com/sport/football/ncaaf/teams/main/boston-college-eagles/injuries
- Bowling Green: https://www.covers.com/sport/football/ncaaf/teams/main/bowling-green-falcons/injuries
- Buffalo: https://www.covers.com/sport/football/ncaaf/teams/main/buffalo-bulls/injuries
- California: https://www.covers.com/sport/football/ncaaf/teams/main/california-golden-bears/injuries
- Central Michigan: https://www.covers.com/sport/football/ncaaf/teams/main/central-michigan-chippewas/injuries
- Charlotte: https://www.covers.com/sport/football/ncaaf/teams/main/charlotte-49ers/injuries
- Cincinnati: https://www.covers.com/sport/football/ncaaf/teams/main/cincinnati-bearcats/injuries
- Clemson: https://www.covers.com/sport/football/ncaaf/teams/main/clemson-tigers/injuries
- Coastal Carolina: https://www.covers.com/sport/football/ncaaf/teams/main/coastal-carolina-chanticleers/injuries
- Colorado: https://www.covers.com/sport/football/ncaaf/teams/main/colorado-buffaloes/injuries
- Colorado State: https://www.covers.com/sport/football/ncaaf/teams/main/colorado-state-rams/injuries
- Delaware: https://www.covers.com/sport/football/ncaaf/teams/main/delaware-fightin-blue-hens/injuries
- Duke: https://www.covers.com/sport/football/ncaaf/teams/main/duke-blue-devils/injuries
- East Carolina: https://www.covers.com/sport/football/ncaaf/teams/main/east-carolina-pirates/injuries
- Eastern Michigan: https://www.covers.com/sport/football/ncaaf/teams/main/eastern-michigan-eagles/injuries
- Florida: https://www.covers.com/sport/football/ncaaf/teams/main/florida-gators/injuries
- Florida Atlantic: https://www.covers.com/sport/football/ncaaf/teams/main/florida-atlantic-owls/injuries
- Florida International: https://www.covers.com/sport/football/ncaaf/teams/main/florida-international-panthers/injuries
- Florida State: https://www.covers.com/sport/football/ncaaf/teams/main/florida-state-seminoles/injuries
- Fresno State: https://www.covers.com/sport/football/ncaaf/teams/main/fresno-state-bulldogs/injuries
- Georgia: https://www.covers.com/sport/football/ncaaf/teams/main/georgia-bulldogs/injuries
- Georgia Southern: https://www.covers.com/sport/football/ncaaf/teams/main/georgia-southern-eagles/injuries
- Georgia State: https://www.covers.com/sport/football/ncaaf/teams/main/georgia-state-panthers/injuries
- Georgia Tech: https://www.covers.com/sport/football/ncaaf/teams/main/georgia-tech-yellow-jackets/injuries
- Hawai'i: https://www.covers.com/sport/football/ncaaf/teams/main/hawai-i-rainbow-warriors/injuries
- Houston: https://www.covers.com/sport/football/ncaaf/teams/main/houston-cougars/injuries
- Illinois: https://www.covers.com/sport/football/ncaaf/teams/main/illinois-fighting-illini/injuries
- Indiana: https://www.covers.com/sport/football/ncaaf/teams/main/indiana-hoosiers/injuries
- Iowa: https://www.covers.com/sport/football/ncaaf/teams/main/iowa-hawkeyes/injuries
- Iowa State: https://www.covers.com/sport/football/ncaaf/teams/main/iowa-state-cyclones/injuries
- Jacksonville State: https://www.covers.com/sport/football/ncaaf/teams/main/jacksonville-state-gamecocks/injuries
- James Madison: https://www.covers.com/sport/football/ncaaf/teams/main/james-madison-dukes/injuries
- Kansas: https://www.covers.com/sport/football/ncaaf/teams/main/kansas-jayhawks/injuries
- Kansas State: https://www.covers.com/sport/football/ncaaf/teams/main/kansas-state-wildcats/injuries
- Kennesaw State: https://www.covers.com/sport/football/ncaaf/teams/main/kennesaw-state-owls/injuries
- Kent State: https://www.covers.com/sport/football/ncaaf/teams/main/kent-state-golden-flashes/injuries
- Kentucky: https://www.covers.com/sport/football/ncaaf/teams/main/kentucky-wildcats/injuries
- LSU: https://www.covers.com/sport/football/ncaaf/teams/main/lsu-tigers/injuries
- Liberty: https://www.covers.com/sport/football/ncaaf/teams/main/liberty-flames/injuries
- Louisiana: https://www.covers.com/sport/football/ncaaf/teams/main/louisiana-ragin-cajuns/injuries
- Louisiana Tech: https://www.covers.com/sport/football/ncaaf/teams/main/louisiana-tech-bulldogs/injuries
- Louisville: https://www.covers.com/sport/football/ncaaf/teams/main/louisville-cardinals/injuries
- Marshall: https://www.covers.com/sport/football/ncaaf/teams/main/marshall-thundering-herd/injuries
- Maryland: https://www.covers.com/sport/football/ncaaf/teams/main/maryland-terrapins/injuries
- Massachusetts: https://www.covers.com/sport/football/ncaaf/teams/main/umass-minutemen/injuries
- Memphis: https://www.covers.com/sport/football/ncaaf/teams/main/memphis-tigers/injuries
- Miami: https://www.covers.com/sport/football/ncaaf/teams/main/miami-fl-hurricanes/injuries
- Miami (OH): https://www.covers.com/sport/football/ncaaf/teams/main/miami-oh-redhawks/injuries
- Michigan: https://www.covers.com/sport/football/ncaaf/teams/main/michigan-wolverines/injuries
- Michigan State: https://www.covers.com/sport/football/ncaaf/teams/main/michigan-state-spartans/injuries
- Middle Tennessee: https://www.covers.com/sport/football/ncaaf/teams/main/middle-tennessee-blue-raiders/injuries
- Minnesota: https://www.covers.com/sport/football/ncaaf/teams/main/minnesota-golden-gophers/injuries
- Mississippi State: https://www.covers.com/sport/football/ncaaf/teams/main/mississippi-state-bulldogs/injuries
- Missouri: https://www.covers.com/sport/football/ncaaf/teams/main/missouri-tigers/injuries
- Missouri State: https://www.covers.com/sport/football/ncaaf/teams/main/missouri-state-bears/injuries
- NC State: https://www.covers.com/sport/football/ncaaf/teams/main/north-carolina-state-wolfpack/injuries
- Navy: https://www.covers.com/sport/football/ncaaf/teams/main/navy-midshipmen/injuries
- Nebraska: https://www.covers.com/sport/football/ncaaf/teams/main/nebraska-cornhuskers/injuries
- Nevada: https://www.covers.com/sport/football/ncaaf/teams/main/nevada-wolf-pack/injuries
- New Mexico: https://www.covers.com/sport/football/ncaaf/teams/main/new-mexico-lobos/injuries
- New Mexico State: https://www.covers.com/sport/football/ncaaf/teams/main/new-mexico-state-aggies/injuries
- North Carolina: https://www.covers.com/sport/football/ncaaf/teams/main/north-carolina-tar-heels/injuries
- North Dakota State: https://www.covers.com/sport/football/ncaaf/teams/main/north-dakota-state-bison/injuries
- North Texas: https://www.covers.com/sport/football/ncaaf/teams/main/north-texas-mean-green/injuries
- Northern Illinois: https://www.covers.com/sport/football/ncaaf/teams/main/northern-illinois-huskies/injuries
- Northwestern: https://www.covers.com/sport/football/ncaaf/teams/main/northwestern-wildcats/injuries
- Notre Dame: https://www.covers.com/sport/football/ncaaf/teams/main/notre-dame-fighting-irish/injuries
- Ohio: https://www.covers.com/sport/football/ncaaf/teams/main/ohio-bobcats/injuries
- Ohio State: https://www.covers.com/sport/football/ncaaf/teams/main/ohio-state-buckeyes/injuries
- Oklahoma: https://www.covers.com/sport/football/ncaaf/teams/main/oklahoma-sooners/injuries
- Oklahoma State: https://www.covers.com/sport/football/ncaaf/teams/main/oklahoma-state-cowboys/injuries
- Old Dominion: https://www.covers.com/sport/football/ncaaf/teams/main/old-dominion-monarchs/injuries
- Ole Miss: https://www.covers.com/sport/football/ncaaf/teams/main/mississippi-rebels/injuries
- Oregon: https://www.covers.com/sport/football/ncaaf/teams/main/oregon-ducks/injuries
- Oregon State: https://www.covers.com/sport/football/ncaaf/teams/main/oregon-state-beavers/injuries
- Penn State: https://www.covers.com/sport/football/ncaaf/teams/main/penn-state-nittany-lions/injuries
- Pittsburgh: https://www.covers.com/sport/football/ncaaf/teams/main/pittsburgh-panthers/injuries
- Purdue: https://www.covers.com/sport/football/ncaaf/teams/main/purdue-boilermakers/injuries
- Rice: https://www.covers.com/sport/football/ncaaf/teams/main/rice-owls/injuries
- Rutgers: https://www.covers.com/sport/football/ncaaf/teams/main/rutgers-scarlet-knights/injuries
- SMU: https://www.covers.com/sport/football/ncaaf/teams/main/smu-mustangs/injuries
- Sacramento State: https://www.covers.com/sport/football/ncaaf/teams/main/sacramento-state-hornets/injuries
- Sam Houston: https://www.covers.com/sport/football/ncaaf/teams/main/sam-houston-bearkats/injuries
- San Diego State: https://www.covers.com/sport/football/ncaaf/teams/main/san-diego-state-aztecs/injuries
- San José State: https://www.covers.com/sport/football/ncaaf/teams/main/san-jose-state-spartans/injuries
- South Alabama: https://www.covers.com/sport/football/ncaaf/teams/main/south-alabama-jaguars/injuries
- South Carolina: https://www.covers.com/sport/football/ncaaf/teams/main/south-carolina-gamecocks/injuries
- South Florida: https://www.covers.com/sport/football/ncaaf/teams/main/south-florida-bulls/injuries
- Southern Miss: https://www.covers.com/sport/football/ncaaf/teams/main/southern-miss-golden-eagles/injuries
- Stanford: https://www.covers.com/sport/football/ncaaf/teams/main/stanford-cardinal/injuries
- Syracuse: https://www.covers.com/sport/football/ncaaf/teams/main/syracuse-orange/injuries
- TCU: https://www.covers.com/sport/football/ncaaf/teams/main/tcu-horned-frogs/injuries
- Temple: https://www.covers.com/sport/football/ncaaf/teams/main/temple-owls/injuries
- Tennessee: https://www.covers.com/sport/football/ncaaf/teams/main/tennessee-volunteers/injuries
- Texas: https://www.covers.com/sport/football/ncaaf/teams/main/texas-longhorns/injuries
- Texas A&M: https://www.covers.com/sport/football/ncaaf/teams/main/texas-a-m-aggies/injuries
- Texas State: https://www.covers.com/sport/football/ncaaf/teams/main/texas-state-bobcats/injuries
- Texas Tech: https://www.covers.com/sport/football/ncaaf/teams/main/texas-tech-red-raiders/injuries
- Toledo: https://www.covers.com/sport/football/ncaaf/teams/main/toledo-rockets/injuries
- Troy: https://www.covers.com/sport/football/ncaaf/teams/main/troy-trojans/injuries
- Tulane: https://www.covers.com/sport/football/ncaaf/teams/main/tulane-green-wave/injuries
- Tulsa: https://www.covers.com/sport/football/ncaaf/teams/main/tulsa-golden-hurricane/injuries
- UAB: https://www.covers.com/sport/football/ncaaf/teams/main/uab-blazers/injuries
- UCF: https://www.covers.com/sport/football/ncaaf/teams/main/ucf-knights/injuries
- UCLA: https://www.covers.com/sport/football/ncaaf/teams/main/ucla-bruins/injuries
- UConn: https://www.covers.com/sport/football/ncaaf/teams/main/uconn-huskies/injuries
- UL Monroe: https://www.covers.com/sport/football/ncaaf/teams/main/louisiana-monroe-warhawks/injuries
- UNLV: https://www.covers.com/sport/football/ncaaf/teams/main/unlv-rebels/injuries
- USC: https://www.covers.com/sport/football/ncaaf/teams/main/usc-trojans/injuries
- UTEP: https://www.covers.com/sport/football/ncaaf/teams/main/utep-miners/injuries
- UTSA: https://www.covers.com/sport/football/ncaaf/teams/main/utsa-roadrunners/injuries
- Utah: https://www.covers.com/sport/football/ncaaf/teams/main/utah-utes/injuries
- Utah State: https://www.covers.com/sport/football/ncaaf/teams/main/utah-state-aggies/injuries
- Vanderbilt: https://www.covers.com/sport/football/ncaaf/teams/main/vanderbilt-commodores/injuries
- Virginia: https://www.covers.com/sport/football/ncaaf/teams/main/virginia-cavaliers/injuries
- Virginia Tech: https://www.covers.com/sport/football/ncaaf/teams/main/virginia-tech-hokies/injuries
- Wake Forest: https://www.covers.com/sport/football/ncaaf/teams/main/wake-forest-demon-deacons/injuries
- Washington: https://www.covers.com/sport/football/ncaaf/teams/main/washington-huskies/injuries
- Washington State: https://www.covers.com/sport/football/ncaaf/teams/main/washington-state-cougars/injuries
- West Virginia: https://www.covers.com/sport/football/ncaaf/teams/main/west-virginia-mountaineers/injuries
- Western Kentucky: https://www.covers.com/sport/football/ncaaf/teams/main/western-kentucky-hilltoppers/injuries
- Western Michigan: https://www.covers.com/sport/football/ncaaf/teams/main/western-michigan-broncos/injuries
- Wisconsin: https://www.covers.com/sport/football/ncaaf/teams/main/wisconsin-badgers/injuries
- Wyoming: https://www.covers.com/sport/football/ncaaf/teams/main/wyoming-cowboys/injuries
