-- Seduh Score Next · T-TEN.E1 finding: freeze the parent columns of the last two tenant tables
--
-- Why: every other tenant table refuses to be re-pointed at a different parent (T-TEN.B1/B2, 20260924100000), so a
-- person who belongs to TWO organisations cannot move a row from one to the other. Two tables had no such trigger:
--   * btc_seeding_tiebreaks (event_id, team_id): its write policy only asks that the NEW event belongs to an
--     organisation the caller is a member of, so a member of both could re-point a row at the other organisation's
--     event. Production is protected only because `authenticated` has UPDATE on just (reason, tiebreak_rank); a
--     database that grants every table privilege by default (what a new Supabase CLI builds, and so CI) is not.
--   * score_change_counts (event_id, table_name): written only by definer functions and unreachable to members, so
--     no exposure today; frozen for the same reason as the rest, so a future grant cannot open it.
-- Found by the cross-organisation matrix (supabase/tests/040) when it was run against a database built with default
-- privileges. No application code updates either column: the app edits only `reason` and `tiebreak_rank`, and the
-- counters are bumped with ON CONFLICT DO UPDATE SET n = ..., which does not list the frozen columns.
--
-- Same function and style as the other triggers (app.forbid_parent_change, SQLSTATE 23001). Safe to apply at any
-- time: it adds a refusal for statements the application never issues.
--
-- rollback:
--   drop trigger if exists trg_btc_seeding_tiebreaks_parent_immutable on btc_seeding_tiebreaks;
--   drop trigger if exists trg_score_change_counts_parent_immutable on score_change_counts;

create trigger trg_btc_seeding_tiebreaks_parent_immutable
  before update of event_id, team_id on btc_seeding_tiebreaks
  for each row execute function app.forbid_parent_change('event_id', 'team_id');

create trigger trg_score_change_counts_parent_immutable
  before update of event_id, table_name on score_change_counts
  for each row execute function app.forbid_parent_change('event_id', 'table_name');
