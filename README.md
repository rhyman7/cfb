# CFB Matchup Dashboard

**Live site: https://rhyman7.github.io/cfb/**

College football version of the [NFL Matchup Dashboard](https://github.com/rhyman7/nfl-dashboard):
a static GitHub Pages site showing a side-by-side offense/defense breakdown for
any two **FBS** teams — record, SoS/SRS/OSRS/DSRS, rush/pass yards-per-game
gauges with FBS rank, TD and points per game, top passers/rushers/receivers,
and how each defense performs against RBs, receiving RBs, TEs and WRs.

## Pages

- **`index.html` — This week's games.** The current week's slate grouped by
  day, with kickoff time, TV, venue, records and AP Top 25 ranks. Filter
  by conference, Top 25, or team name. Click a game to open its matchup.
  The slate is a board with one row per game: both teams (a block in the
  team's color, record and conference), the spread, the total, implied team
  totals and the venue, in fixed columns so the lines read straight down. A
  spread or total that has moved shows what it opened at underneath, and the
  venue line carries the game-time forecast (see below). Once a game starts,
  scores join the teams and the implied column shows the game's status.
  Team colors come from `teamcolors.js` (every FBS and FCS team's primary and
  secondary color, from ESPN's team list); the type is Archivo, loaded from
  Google Fonts.
- **`matchup.html?game=<ESPN game id>` — One game.** A game header (records,
  AP rank, QB, SRS, kickoff, venue, indoors/outdoors, spread, O/U), a Head to
  Head section comparing each offense with the other defense (FBS ranks, with
  an edge called when one side ranks 26+ spots better — the same share of the
  field as the NFL site's 6 of 32), then both teams' full stat cards. The header shows the kickoff forecast
  (outdoor games) between the venue and the spread/O-U, and uses the same
  current ESPN line as the slate. Prints
  on one landscape page.
  Non-FBS opponents show a short note instead of stats.
- **`print.html` — Print all.** The slate's "Print all" button opens every
  game currently shown (respecting the conference / Top 25 / search
  filters), one matchup per landscape page, and brings up the print dialog.
  Each matchup page still has its own Print Matchup button.
- **`edges.html` — Weekly Edges.** A game board for the week's games sorted
  by kickoff (current spread and O/U, implied team totals, line move since the
  week's first update, and the net EPA edge: which team's offense EPA/play minus
  defense EPA/play allowed is better, and by how much), with conference and
  Top 25 filters. Below it, prop matchup tables (QB pass yds, RB rush yds, WR
  rec yds, TE rec yds) list players in FBS-vs-FBS games whose opponent allows
  more than the FBS average for that stat: the player's average, what the
  opponent allows (and its rank), **Matchup** = opponent allowed ÷ FBS average,
  and **Adj** = average × Matchup. Top 10 each by Adj, regulars only (at least
  half the team's games). Names open the game log.
- **`dashboard.html` — Compare any two teams.** The original dashboard
  (same layout as the NFL site). Also accepts `?team1=Alabama&team2=Georgia`.
- **`ratings.html` — Ratings explained.** Plain-language definitions of SoS,
  OSRS, DSRS and SRS, how to use them in a matchup, and how this site
  calculates them. Its example uses the current top-SRS team from
  `data/data.json`; the rest of the page is static. Linked from the main
  page's top nav.

**Player game logs.** On every team card, each player name in the Passing,
Rushing and Receiving tables is clickable. Hovering (on a computer) shows a
tooltip with that player's week-by-week stats for that table and the opponent;
clicking or tapping opens a panel with the full game log (result, then the
passing, rushing and receiving columns the player has stats in). Close it with
Esc, the ✕ button or a click outside. On phones a tap opens the panel directly
and wide tables scroll sideways inside it. Neither shows up when printing. A log
only includes games played for the team on that card, so it matches the table
averages. The logs live in `gameLogs` in `data/data.json`, keyed
`ABBR|athlete_id`; each player row carries a `log` key pointing to its entry,
and zero-value stats are left out of each game. The ESPN box scores have no
targets, so the log table shows receptions, yards, TDs and Y/R; targets from
play-by-play are in the log data for the prop check.

**Team games and box scores.** FBS team names in the matchup header and on every
team card are clickable. Hovering (on a computer) shows the team's games this
season: week, opponent, result, and the team's high passer, rusher and receiver by
yards. Clicking or tapping opens a panel with the same list; pick a game to see
its box score (scoring by quarter, team stats, every passer, rusher and receiver,
scoring plays), which the browser fetches from ESPN using the game's id. If ESPN
can't be reached the panel says so and links to the game on ESPN. The lists live
in `teamGames` in `data/data.json`, keyed by team name, one compact line per team.

**Player search.** Every page's top bar has a search box: type two letters,
pick a player (name, position, team; arrow keys and Enter work) and his game
log opens.

**Prop check.** The game log panel has a prop tool: pick a stat (pass yds,
pass TD, completions, pass attempts, INTs, rush yds, carries, rush TD, rec
yds, receptions, targets, rush + rec yds, pass + rush yds, any TD), type a
line, and it shows "Over X: N of M games (P%)", pushes, the average, the last
3 results and each game marked O/U. The line starts just under his season
average. Only stats that fit the player's position and stats are offered.
Under it is what this week's opponent allows for that stat, from its defense
and Def vs Position numbers. Each player row carries `pos` (from
`cfb_rosters`, or `game_rosters` for players it's missing). Targets come
from play-by-play (`tgt` in the logs), since the box scores don't have them;
play-by-play receptions match the box score in about 97% of player-games.

**Betting Trends.** The matchup and Compare pages show each team's record
against the spread (overall, as favorite, as underdog, home, away) and
over/under, plus a game-by-game list, from each completed game's cfbfastR
consensus line rounded to the half point (the same lines the site shows).
Percentages leave out pushes; neutral-site games count toward overall, Fav
and Dog but not Home or Away. Games without a line (all FBS-vs-FCS games) are
skipped. The data is `betting` on each team. It's left out of printouts.

**Implied totals and line movement.** The matchup header, the week
board and Weekly Edges show implied team totals from the current spread and
O/U: favorite = (total + spread) ÷ 2. Each week game carries `lineOpen`, the
consensus line from the week's first build; the build keeps it when it reruns
for the same week, and the pages show "Line move since <day>: spread A → B ·
O/U X → Y" by comparing it with the latest build's consensus line (same
source at both ends, so a difference between ESPN and the consensus never
shows up as a move).

**EPA and success rate.** Head to Head adds EPA per play and success rate
(share of plays with positive EPA) for each offense and defense, from
cfbfastR play-by-play: run and pass plays (sacks count as pass plays) in
completed regular-season games, leaving out QB kneels and plays wiped out by
a penalty. Offense rank 1 = highest; defense rank 1 = lowest allowed. The
data is `eff` on each team. These rows print with the rest of Head to Head.

**Not available for college.** The NFL site's injury tags have no college
equivalent: cfbfastR has no injury or availability report for any
conference (only an Active/Inactive flag on past game rosters), so there are
no injury tags. Referee tendencies and fantasy points aren't on this site.

**Live scores.** On game days the slate and matchup pages fetch live
scores straight from ESPN's public site API in the viewer's browser
(`live.js`): the slate shows scores, quarter/clock, possession and a "Live
now" group; the matchup page adds a box score (line score, team stats,
player stats, scoring plays) under the game header. Both refresh every 30
seconds while a game is live and do nothing before the pre-game window. The
box score is left out of the printout. The feed is unofficial, so if it fails
the pages fall back to the weekly data and show a short note.

**Lines and forecast on the slate.** On page load the slate asks ESPN's
scoreboard for each game's current spread and O/U; games without ESPN odds
keep the weekly consensus line from `data/data.json`. The forecast comes from
[Open-Meteo](https://open-meteo.com/) (free, no key) in the viewer's browser
(`weather.js`): each venue city is geocoded once and cached in the browser,
then the hour nearest kickoff is shown (temperature, chance of rain, wind), or
the day's high for games with no kickoff time yet. Indoor stadiums show
"Indoors". Forecasts only reach 16 days out, and if either service is down
the card simply leaves that part out.

The "current week" is the first regular-season week that still has an
unplayed game, so after Monday's rebuild the slate shows the coming week.
AP ranks come from ESPN's schedule (each team's current poll rank on its
next game, so teams on a bye are covered).

## Scope

- All FBS teams (138 in 2026)
- 2026 **regular season** only (bowls/CFP excluded), completed games only

## Data source

[`sportsdataverse/cfbfastR-cfb-data`](https://github.com/sportsdataverse/cfbfastR-cfb-data)
— ESPN-derived game box scores committed as parquet files and refreshed several
times a day. The build script downloads them straight from
`raw.githubusercontent.com`, so no API key is needed.

Files used (`cfb/…/<name>_2026.parquet`): `cfb_schedule`, `team_box`,
`player_box`, `cfb_teams`, `cfb_rosters`, `cfb_matchup_line` (consensus
spread and O/U, rounded to the half point), `play_by_play` (EPA, success
rate, targets) and `game_rosters` (positions for players `cfb_rosters` is
missing; on 2026-09-29 the source's `cfb_rosters` briefly covered only 4
teams). `play_by_play` and `game_rosters` are optional: if either can't be
downloaded, the build prints a note and leaves out EPA / targets, or uses
`cfb_rosters` alone. The upcoming schedule and AP ranks
come from the sibling repo
[`sportsdataverse/cfbfastR-cfb-raw`](https://github.com/sportsdataverse/cfbfastR-cfb-raw)
(`cfb/schedules/csv/cfb_schedule_2026.csv`).

## Weekly update

A weekly scheduled task (Mondays 7:47 AM ET, after the new AP poll and the weekend's final stats reach the data source) runs:

```bash
pip install -r requirements.txt
python scripts/build_data.py
git add data/data.json && git commit -m "Weekly data update" && git push
```

Run the build with the default `--out` (the repo's `data/data.json`) so it can
keep this week's `lineOpen`. Because `lineOpen` is set at the week's first
build, line moves only show up after a later rebuild in the same week.

GitHub Pages redeploys within a minute or two of the push.

Run the same commands yourself any time to refresh manually, and preview with
`python -m http.server 8000` → http://localhost:8000.

## How the numbers are derived

- **Record / PPG / PA/G** — from final scores of regular-season games,
  including games against FCS opponents.
- **Offense/Defense Yds/G & ranks** — team box score rushing yards and net
  passing yards per game (defense = what opponents gained). Rank 1 = most
  yards on offense, fewest allowed on defense, among all FBS teams.
- **Rush/Pass TD/G** — summed from player box scores.
- **SRS / OSRS / DSRS** — least-squares Simple Rating System on points, using
  FBS-vs-FBS games only (no home-field term, light regularization so early
  weeks stay stable). SRS = OSRS + DSRS. **SoS** = average SRS of FBS opponents.
  Expect these to be noisy for the first several weeks.
- **Player tables** — top 6 passers/rushers and 7 receivers per team, sorted
  by yards per game played; players who have appeared in fewer than half the
  team's games are listed after the regulars.
- **Def vs position** — per game, yards and TDs the defense allowed to
  opposing RBs (rushing), RBs (receiving), TEs and WRs, using roster positions
  (FB counted as RB). Rank 1 = fewest yards allowed.
- **Game logs** — one entry per regular-season game the player appears in
  for that team (any of passing, rushing or receiving), with week, opponent
  abbreviation (`@` for road games; neutral sites show `vs`) and final score.
- **Betting, EPA, lineOpen** — see the feature notes above. Everything is built
  from scratch from the current season's files each run except `lineOpen`,
  which is carried over from the existing `data/data.json` for the same week.
- **League averages** — mean across FBS teams of Rush TD/G, Pass TD/G and PPG.
