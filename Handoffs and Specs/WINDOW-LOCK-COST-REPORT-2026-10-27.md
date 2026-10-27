# BTC window-lock read-cost report — 2026-10-27

## Scope and baseline

This is the narrowed follow-up measurement requested after the original Task 5 handoff became stale. It measures only the eight `btc_*` tables through their real authenticated RLS paths; it does not repeat the completed `ct_results` work.

It builds on `ROADMAP.md`, “Known open items from T-GATE.B5”, item 1a, and `20261027100000_window_lock_set_based.sql`. The earlier synthetic local measurement found that the original locked-event lookup cost roughly 0.2–0.35 ms per ended Per-event grant, then replaced it with the set-based `app.window_locked_events()` implementation. The recorded corrected cost at 1,000 ended grants was 3–16 ms per statement, rather than roughly 170–700 ms. This report measures the previously unmeasured BTC paths against that corrected implementation.

## Local setup

Local only. `npm.cmd run db:reset` ran before the measurement and again afterwards. The fixture was one disposable organisation and one authenticated owner, with 500 BTC events, 2,000 teams, 1,500 judges, 2,500 matches, 7,500 match-judge links, 37,500 cup votes, 2,500 bonus rows, 2,000 seeding-tiebreak rows and 2,000 bracket slots. Every event had an ended Per-event grant; the measured target event also had a current extension, so its normal organiser reads remained visible while the policy computed the 499 other ended events.

The database was analysed after seeding. Each query was run as the authenticated fixture owner with a parent-event predicate, first with `event_window_lock` off and then on. The capture used `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` and records the top-level actual rows, execution time and shared buffers (hits plus reads).

## Exact measurement SQL

```sql
update app.entitlement_keys
set enforced = :lock_state
where key = 'event_window_lock';

set local role authenticated;
select set_config('request.jwt.claim.sub',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated","aal":"aal1"}', true);

explain (analyze, buffers, format json)
select * from public.btc_teams
where event_id = '10000000-0000-0000-0000-000000000001';
```

The same statement shape was used for the direct-event tables (`btc_judges`, `btc_matches`, `btc_bracket_slots`, `btc_seeding_tiebreaks`). The three match-child reads used the app’s normal parent chain:

```sql
explain (analyze, buffers, format json)
select * from public.btc_cup_votes
where match_id in (
  select id from public.btc_matches
  where event_id = '10000000-0000-0000-0000-000000000001'
);
```

`btc_match_judges` and `btc_match_bonuses` used the identical query with their table names substituted.

## Results

| Query | Rows | Lock off ms / buffers | Lock on ms / buffers | Delta | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `btc_teams` | 4 | 4.558 / 244 | 10.743 / 2,232 | +6.185 ms | Over 10 ms total |
| `btc_judges` | 3 | 0.971 / 21 | 2.258 / 1,550 | +1.287 ms | |
| `btc_matches` | 5 | 1.373 / 33 | 2.579 / 1,562 | +1.206 ms | |
| `btc_bracket_slots` | 4 | 1.247 / 27 | 4.475 / 1,556 | +3.228 ms | |
| `btc_seeding_tiebreaks` | 4 | 1.099 / 27 | 3.368 / 1,556 | +2.269 ms | |
| `btc_match_judges` | 15 | 3.215 / 166 | 10.403 / 3,270 | +7.188 ms | Over 10 ms total |
| `btc_cup_votes` | 75 | 14.840 / 650 | 20.590 / 3,934 | +5.750 ms | Already over 10 ms before lock |
| `btc_match_bonuses` | 5 | 1.699 / 90 | 8.817 / 3,164 | +7.118 ms | |

The plan shape adds the lock policy’s uncorrelated `window_locked_events()` set lookup once per statement; it is not a per-returned-row function call. The extra buffers scale with the ended-grant set, consistent with the set-based fix, rather than with the table’s returned-row count.

## Verdict

**Needs follow-up before enforcing `event_window_lock` for BTC.** The set-based fix prevents the former per-grant catastrophe and most BTC paths stayed below 10 ms at this local scale. However, `btc_teams` and `btc_match_judges` crossed the handoff’s 10 ms flag threshold, and `btc_cup_votes` rose from an already-slow 14.840 ms to 20.590 ms. Do not add an index or rewrite from this report alone: repeat these exact authenticated organiser queries against a representative real ended-grant count, then inspect the two flagged plans for a targeted index or policy rewrite if they remain over the threshold.

## Not measured

- The cloud measurement at the owner’s real ended-grant count. `ROADMAP.md` records zero ended grants on 2026-10-27, so it requires the owner’s approval and suitable real data before it is meaningful. It was not attempted.
- Realtime subscriber behaviour, which remains separately unmeasured in the B5 open items.
- Writes, anonymous live-display queries, views, unfiltered leaf-table reads and physical-device behaviour.
- The already-completed `ct_results` measurement; this report deliberately does not duplicate or contradict it.
