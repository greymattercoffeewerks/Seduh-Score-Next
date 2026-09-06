-- Fixes a real, HIGH-severity bug found during a Phase 6 dry run (2026-09-06,
-- against a real local Postgres instance — no mocked-client unit test could
-- ever have caught this, since it's a SQL join-semantics defect):
--
-- ct_standings's original definition (20260821210000_cup_taster_tables.sql)
-- computed `total_elapsed_secs` as `sum(he.elapsed_secs)` over a query that
-- LEFT JOINs ct_results (one row per scored set) directly onto
-- ct_heat_entries (one row per cupper per heat). `he.elapsed_secs` is a
-- single value per heat_entry, not per set — but the join fans each
-- heat_entry row out to N rows (one per scored set), and `sum(he.elapsed_secs)`
-- then sums that SAME value once per fanned-out row: elapsed_secs × sets_scored.
-- Confirmed live: every displayed/ranked time in a real 3-set stage was
-- inflated by exactly 3x (a cupper who ran a 12s heat showed as 0:36). At
-- this project's own default of 5 sets per stage, this would show 5x. Beyond
-- the wrong displayed number, this can also corrupt the ranking itself
-- (core/ranking.js's tiebreaker reads total_elapsed_secs directly) whenever
-- two cuppers being compared don't have identically-fanned-out result counts
-- at read time (partial scoring, or a stage-plan set_count that changed
-- mid-event) — not merely cosmetic.
--
-- `count(r.id)` (correct_count/sets_scored) was never wrong — counting rows
-- across a fan-out is exactly what a fan-out is FOR. Only summing a
-- "one" side value (elapsed_secs, which lives on the "one" side of the
-- heat_entries-to-results relationship) across that same fan-out was the
-- defect.
--
-- Fixed by pre-aggregating ct_results per heat_entry_id in a subquery BEFORE
-- joining to ct_heat_entries, so that join is 1:1 (or 1:0 via left join),
-- never 1:many — sum(he.elapsed_secs) then sums exactly once per
-- heat_entry, regardless of how many sets were scored.
--
-- `correct_count`/`sets_scored` are explicitly cast to ::bigint — found by
-- running the pgTAP suite against this fix (not by reading the SQL): the
-- original view's `count(r.id) filter (...)` was bigint, but this fix's
-- `coalesce(sum(rc.correct_count), 0)` sums bigint over bigint, which
-- Postgres promotes to numeric, not bigint (sum(smallint|int) stays
-- bigint; sum(bigint) does not). A silent type change on a widely-read
-- view column, with no functional symptom in the app (JS doesn't
-- distinguish), was exactly the kind of regression a live dry run's own
-- manual verification would never have caught — only the pre-existing
-- pgTAP fixture's `is(..., 2::bigint, ...)` assertion, unchanged from
-- before this migration, surfaced it immediately.
--
-- rollback:
--   drop view if exists ct_standings;
--   create view ct_standings
--     with (security_invoker = true) as
--   select
--     he.entry_id,
--     h.stage_id,
--     count(r.id) filter (where r.correct) as correct_count,
--     count(r.id) as sets_scored,
--     sum(he.elapsed_secs) as total_elapsed_secs
--   from ct_heat_entries he
--   join ct_heats h on h.id = he.heat_id
--   left join ct_results r on r.heat_entry_id = he.id
--   where h.kind = 'normal'
--   group by he.entry_id, h.stage_id;
--   grant select on ct_standings to authenticated;

drop view if exists ct_standings;

create view ct_standings
  with (security_invoker = true) as
select
  he.entry_id,
  h.stage_id,
  coalesce(sum(rc.correct_count), 0)::bigint as correct_count,
  coalesce(sum(rc.sets_scored), 0)::bigint as sets_scored,
  sum(he.elapsed_secs) as total_elapsed_secs
from ct_heat_entries he
join ct_heats h on h.id = he.heat_id
left join (
  select
    heat_entry_id,
    count(*) filter (where correct) as correct_count,
    count(*) as sets_scored
  from ct_results
  group by heat_entry_id
) rc on rc.heat_entry_id = he.id
where h.kind = 'normal'
group by he.entry_id, h.stage_id;

grant select on ct_standings to authenticated;
