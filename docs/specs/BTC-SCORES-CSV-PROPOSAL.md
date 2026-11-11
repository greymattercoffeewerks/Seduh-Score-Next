# BTC scores CSV: proposal for the committee

_Draft, 2026-11-11. Organiser UX spec Q10 and section 6. Instead of waiting for the committee's paper scoresheet,
we propose a layout from what Seduh Score records. The owner shows it to the committee; their changes are made before
or after the first rehearsal. Samples (fictional data): [`samples/btc-scores-matches-SAMPLE.csv`](samples/btc-scores-matches-SAMPLE.csv)
and [`samples/btc-scores-cups-SAMPLE.csv`](samples/btc-scores-cups-SAMPLE.csv)._

## What it is for

After the shadow run, the committee's paper result and Seduh Score's result are compared match by match (Board plan
gate G1). Two files, both from the dashboard's Records card, open in Excel or Google Sheets:

1. **Matches**: one row per match. The totals and the winner, which is what the committee checks first.
2. **Cups**: one row per cup. Used only where a match total disagrees, to find the cup that differs.

## How a BTC match is scored (what the columns show)

Per cup, the judges give 3 tokens split between the two teams (3–0, 2–1, 1–2 or 0–3). A team's total is its tokens
over all cups (15 in a preliminary round, 20 in a knockout), plus 5 if it has more tokens than the other team, plus 2
for the faster finish, plus 2 for the signature beverage (knockout only). Level totals in a knockout are decided by
the organiser as a recorded tie-break.

## Matches file: columns

| Column                                         | Notes                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Event, Round, Match                            | Round is Round 1, Round 2, Quarterfinal, Semifinal, Third place, Final; Match is its number within the round |
| Status                                         | Scheduled, Scoring or Confirmed (only Confirmed rows count)                                                  |
| Team 1, Team 1 country, Team 2, Team 2 country | Country as a two-letter code                                                                                 |
| Judge 1 to 3                                   | Who judged; no score is attributed to a judge                                                                |
| Team 1 cups won, Team 2 cups won               | Cups where the team got 2 or 3 tokens. For checking against paper only, not part of the score                |
| Team 1 tokens, Team 2 tokens                   | Sum over all cups; the two add up to 45 (round 1 and 2) or 60 (knockout)                                     |
| More tokens (+5)                               | The team that got the 5; empty when tokens are level                                                         |
| Fastest (+2)                                   | The team that got the 2                                                                                      |
| Team 1 / Team 2 signature beverage (+2)        | Yes or No in a knockout, n/a in rounds 1 and 2                                                               |
| Team 1 / Team 2 finish time                    | M:SS as recorded; a team that did not finish shows the round's limit (10:00 or 15:00)                        |
| Team 1 total, Team 2 total                     | The match score                                                                                              |
| Winner                                         | A team name, or Level                                                                                        |
| Tie-break winner, Tie-break reason             | Only for a level knockout, as the organiser recorded it                                                      |
| Confirmed at                                   | Local date and time the score was confirmed                                                                  |

## Cups file: columns

Event, Round, Match, Team 1, Team 2, Cup (1 to 15 or 1 to 20), Team 1 tokens, Team 2 tokens, Cup won by.

## Questions to ask the committee

1. Does your paper sheet keep the same order: cups, then +5, +2 fastest, +2 signature, total? Anything we record that
   you do not, or the reverse?
2. Do you write a score per judge? (Seduh Score records one token count per cup, not per judge.)
3. Is "cups won" useful, or should it go?
4. Do you want a third file with the standings after round 2 (the sign-off sheet already has them)?
5. Which tie-break rule do you use in a level knockout, so the reason column can name it?
6. Time limits: 10:00 in rounds 1 and 2 and 15:00 in the knockout, as we assume?

## Rules for the build

- Built from the same reads as the dashboard (`btc_matches`, `btc_cup_votes`, `btc_match_bonuses`, the
  `btc_match_scores` view, judges, teams); totals come from the view, **never recomputed** in the browser.
- Uses `core/export.js` (`buildCsv`, `downloadCsv`) and the Records card from the S1 kit; organiser-only, like the
  dispute pack.
- File names: `<event-slug>-matches-<YYYY-MM-DD>.csv` and `<event-slug>-cups-<YYYY-MM-DD>.csv`.
- On a shadow or test event the first column's value carries the band word ("BETA TEST" / "TEST") so a file can
  never be mistaken for an official result.
- Reviewers: `scoring-auditor` (it states totals and winners), `test-auditor`, `code-reviewer`,
  `module-boundary-checker`.
