# CFB Matchup Dashboard

College football version of the [NFL Matchup Dashboard](https://github.com/rhyman7/nfl-dashboard):
a static GitHub Pages site showing a side-by-side offense/defense breakdown for
any two **FBS** teams — record, SoS/SRS/OSRS/DSRS, rush/pass yards-per-game
gauges with FBS rank, TD and points per game, top passers/rushers/receivers,
and how each defense performs against RBs, receiving RBs, TEs and WRs.

## Pages

- **`index.html` — This week's games.** The current week's slate grouped by
  day, with kickoff time, TV, venue, records, SRS and AP Top 25 ranks. Filter
  by conference, Top 25, or team name. Click a game to open its matchup.
- **`matchup.html?game=<ESPN game id>` — One game.** A game header (records,
  AP rank, QB, SRS, kickoff, venue, indoors/outdoors, spread, O/U), a Head to
  Head section comparing each offense with the other defense (FBS ranks, with
  an edge called when one side ranks 26+ spots better — the same share of the
  field as the NFL site's 6 of 32), then both teams' full stat cards. Prints
  on one landscape page.
  Non-FBS opponents show a short note instead of stats.
- **`dashboard.html` — Compare any two teams.** The original dashboard
  (same layout as the NFL site). Also accepts `?team1=Alabama&team2=Georgia`.

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
