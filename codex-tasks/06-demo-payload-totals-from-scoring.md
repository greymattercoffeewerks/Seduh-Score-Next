# 06 — The demo/test payload builder must not re-implement the scoring formula

Read `README.md` in this folder first. Branch: `codex/demo-payload-from-scoring`.

## Why

ROADMAP, "Known open items from T-BTC.projector-screens": _"`demoLivePayload.js`
reimplements the +5/+2 formula and the standings aggregation to build fixtures (demo and
tests only; it runs through the real assembler). If `scoring.js` or the views change,
derive the totals from `scoring.js` or pin them with a test."_

The BTC projector and phone tests are built on payloads from this file. If the real scoring
rule ever changes and this copy does not, the tests keep passing against a rule the product
no longer follows. That is exactly the failure the repo's scoring discipline exists to
prevent ("derive, don't copy").

## Where

- `src/formats/btc/demoLivePayload.js` (~270 lines): builds rows (matches, scores, standings)
  and runs them through the real `assembleBtcLivePayload` in `src/formats/btc/liveSession.js`.
  Find where it computes cup winners, the +5 for taking a cup, the +2 fastest bonus, the +2
  signature-beverage bonus, and the standings sums.
- `src/formats/btc/scoring.js` — the JS source of truth for the formula (pure vote
  aggregation: strict token plurality per cup, +5 per cup won, +2 fastest exclusive, +2
  signature beverage outside the preliminary round). Read its exports and its tests
  (`scoring.test.js`).
- The SQL views (`btc_cup_totals`, `btc_match_totals`, `btc_match_scores`, `btc_standings`)
  are the database's copy; `supabase/tests/014_btc_scoring.sql` and `scoring.test.js` pin
  that JS and SQL agree on fixed fixtures (37/15, 47/24, 32/30, 4/65, 0/50). Do not touch
  them.

## What to do

1. Read `demoLivePayload.js` and list every place it computes a score total or a
   standings aggregate itself.
2. Replace each with a call to the real `scoring.js` function that does the same job
   (feed it the same cup votes the fixture already declares). If `scoring.js` does not
   export what you need, **do not widen its public API for a test helper** — instead keep
   the fixture's totals but add a test (below) that recomputes them via `scoring.js` and
   asserts equality.
3. Standings: `src/formats/btc/standings.js` + `core/ranking.js` already aggregate and rank
   from rows; reuse them if the fixture can supply the same rows, otherwise pin with a test.
4. Add a test in a new `src/formats/btc/demoLivePayload.test.js` (or the existing one if
   there is one) that, for every match in the demo payloads, recomputes the match totals
   from the cup votes via `scoring.js` and asserts they equal what the payload shows. Also
   assert the standings order equals `rank()` of the recomputed totals.

## Acceptance

- No re-implemented `+5`/`+2` arithmetic left in `demoLivePayload.js` (grep for the numeric
  literals 5 and 2 near "bonus"/"cup"), OR a pinning test that fails when `scoring.js`'s
  bonus constants change.
- Mutation check (put in the PR): change a bonus constant in `scoring.js` (e.g. fastest +2
  → +3) and show the new test fails; restore it. Also change a vote in a fixture and show
  the pinning test fails.
- All existing BTC projector/phone/preview tests pass **unedited** (their expected numbers
  must not change — if they would, you changed the demo data, not the derivation; stop and
  fix that).
- `npm test`, `npm run lint`, `npm run format:check`, `npm run build` green.
- CHANGELOG entry; ROADMAP bullet CLOSED (T-BTC.demo-payload-derive).

## Do not

- Change `scoring.js`, the SQL, or the numbers a fixture produces.
- Move this file into the shipped module graph (it is demo/test only and must stay out of
  the production bundle; `npm run build` output should not include it).
