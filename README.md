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
  Before kickoff, the favored team's row shows the spread (e.g. -6), the
  other team's row shows the O/U (PK on the first row for a pick'em), and a
  game-time forecast sits under the teams (see below). Once a game starts,
  the scores take that spot.
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
- **`dashboard.html` — Compare any two teams.** The original dashboard
  (same layout as the NFL site). Also accepts `?team1=Alabama&team2=Georgia`.
- **`ratings.html` — Ratings explained.** Plain-language definitions of SoS,
  OSRS, DSRS and SRS, how to use them in a matchup, and how this site
  calculates them. Its example uses the current top-SRS team from
  `data/data.json`; the rest of the page is static. Linked from the main
  page's top nav.

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
`player_box`, `cfb_teams`, `cfb_rosters`, and `cfb_matchup_line` (consensus
spread and O/U, rounded to the half point). The upcoming schedule and AP ranks
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
- **League averages** — mean across FBS teams of Rush TD/G, Pass TD/G and PPG.
