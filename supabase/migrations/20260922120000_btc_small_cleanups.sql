-- Seduh Score Next · four small, deliberately-deferred cleanups from BTC Phase T-BTC.2
-- scoring (ROADMAP.md "Known open items", 2026-09-22)
--
-- rollback:
--   drop index if exists btc_match_bonuses_fastest_team_id_idx;
--   drop index if exists btc_bracket_slots_team1_id_idx;
--   drop index if exists btc_bracket_slots_team2_id_idx;
--   drop view if exists btc_cup_totals;
--   create view btc_cup_totals with (security_invoker = true) as
--     select cv.match_id, cv.cup_number, cv.team1_tokens, (3 - cv.team1_tokens) as team2_tokens
--     from btc_cup_votes cv;
--   revoke all on btc_cup_totals from anon, authenticated;
--   grant select on btc_cup_totals to authenticated;
--   revoke execute on function app.org_id_for_btc_match(uuid) from authenticated, service_role;
--   grant execute on function app.org_id_for_btc_match(uuid) to public;
--   revoke execute on function app.is_org_member(uuid) from authenticated, service_role;
--   grant execute on function app.is_org_member(uuid) to public;
--   revoke execute on function app.org_id_for_event(uuid) from authenticated, service_role;
--   grant execute on function app.org_id_for_event(uuid) to public;
--   revoke execute on function app.org_id_for_heat(uuid) from authenticated, service_role;
--   grant execute on function app.org_id_for_heat(uuid) to public;
--   revoke execute on function app.org_id_for_heat_entry(uuid) from authenticated, service_role;
--   grant execute on function app.org_id_for_heat_entry(uuid) to public;
--   revoke execute on function app.org_id_for_stage(uuid) from authenticated, service_role;
--   grant execute on function app.org_id_for_stage(uuid) to public;
--   revoke execute on function app.session_is_revealed(uuid) from authenticated, service_role;
--   grant execute on function app.session_is_revealed(uuid) to public;
--   -- (the remaining trigger functions only ever needed PUBLIC restored, never having
--   -- had an authenticated-specific grant added forward)
--   grant execute on function app.check_bean_count_immutable() to anon;
--   grant execute on function app.check_ct_results_set_stage() to anon;
--   grant execute on function app.check_event_entry_person_org() to anon;
--   grant execute on function app.check_live_session_org() to anon;
--   grant execute on function app.check_person_merge_kept_org() to anon;
--   grant execute on function app.check_public_results_org() to anon;
--   grant execute on function app.check_btc_match_bonus_teams() to anon;
--   grant execute on function app.set_updated_at() to anon;
--   (Run and verified live in a transaction against a local database with exactly
--   those steps; the schema returned to its pre-this-migration shape.)

-- ============ 1. app.org_id_for_btc_match, and every other app.* helper/trigger
-- function that was never explicitly revoked from anon, EXCEPT the ones anon
-- genuinely needs ============
--
-- All defense-in-depth, not closing a live gap: `app` is not in PostgREST's exposed
-- schemas (supabase/config.toml), so none of these were ever reachable as a direct
-- RPC call regardless of grants. The real question was whether anon could reach one of
-- them INDIRECTLY, through an RLS policy on a table anon can actually query — checked
-- against every `{public}`/`{anon,...}`-scoped policy calling an app.* function
-- (pg_policies) cross-referenced against anon's real table grants
-- (information_schema.role_table_grants): anon holds no SELECT/INSERT/UPDATE/DELETE
-- on any btc_*/ct_*/events/org_members/orgs/people/person_merges/processed_operations
-- table (only the harmless REFERENCES/TRIGGER/TRUNCATE default noise), so a policy on
-- those tables calling app.is_org_member / app.org_id_for_event / app.org_id_for_heat /
-- app.org_id_for_heat_entry / app.org_id_for_stage / app.org_id_for_btc_match is never
-- actually evaluated for anon. Trigger functions (app.check_*, app.set_updated_at) are
-- never callable directly regardless (Postgres refuses a non-trigger-context call).
--
-- NOT touched, because anon genuinely needs them: app.session_is_open and
-- app.session_id_for_guess (contacts_insert / guesses_insert policies, both scoped to
-- {anon, authenticated}), app.session_is_creator (contacts_select — anon holds a real
-- SELECT grant on contacts), app.session_display_guesses and app.session_bean_count
-- (both called directly as anon-facing RPCs by the public guess-the-bean display
-- screen, src/community/guess-the-bean/displayScreen.js/sessions.js).
--
-- Non-trigger helper functions: these are genuinely called during RLS policy
-- evaluation for `authenticated` (that's the entire point of is_org_member and the
-- org_id_for_* family), and NONE of them had ever been given an explicit
-- `grant ... to authenticated` — they relied solely on PUBLIC's default grant, which
-- also covers anon. Revoking from PUBLIC without re-granting to authenticated would
-- have broken every authenticated read/write in the app (caught live: the first version
-- of this migration did exactly that, verified by the full pgTAP suite going from 360
-- passing to 13 broken files before this fix).
revoke execute on function app.org_id_for_btc_match(uuid) from public, anon;
grant execute on function app.org_id_for_btc_match(uuid) to authenticated, service_role;
revoke execute on function app.is_org_member(uuid) from public, anon;
grant execute on function app.is_org_member(uuid) to authenticated, service_role;
revoke execute on function app.org_id_for_event(uuid) from public, anon;
grant execute on function app.org_id_for_event(uuid) to authenticated, service_role;
revoke execute on function app.org_id_for_heat(uuid) from public, anon;
grant execute on function app.org_id_for_heat(uuid) to authenticated, service_role;
revoke execute on function app.org_id_for_heat_entry(uuid) from public, anon;
grant execute on function app.org_id_for_heat_entry(uuid) to authenticated, service_role;
revoke execute on function app.org_id_for_stage(uuid) from public, anon;
grant execute on function app.org_id_for_stage(uuid) to authenticated, service_role;
revoke execute on function app.session_is_revealed(uuid) from public, anon;
grant execute on function app.session_is_revealed(uuid) to authenticated, service_role;

-- Trigger functions: never callable in a normal SQL context (Postgres refuses a
-- non-trigger-context call regardless of EXECUTE), so revoking from PUBLIC/anon here
-- needs no matching authenticated grant — nothing legitimate ever called them as a
-- plain function to begin with.
revoke execute on function app.check_bean_count_immutable() from public, anon;
revoke execute on function app.check_ct_results_set_stage() from public, anon;
revoke execute on function app.check_event_entry_person_org() from public, anon;
revoke execute on function app.check_live_session_org() from public, anon;
revoke execute on function app.check_person_merge_kept_org() from public, anon;
revoke execute on function app.check_public_results_org() from public, anon;
revoke execute on function app.check_btc_match_bonus_teams() from public, anon;
revoke execute on function app.set_updated_at() from public, anon;

-- ============ 2. btc_cup_totals: only count a cup the RPC could have written ============
--
-- btc_match_totals/btc_match_scores/btc_standings already filter to
-- cup_number <= app.btc_cups_for_round(round) (20260922100000); this per-cup view never
-- got the same filter, so a stray direct-written cup past the round's last cup shows up
-- here even though it is excluded everywhere else — inconsistent, not currently harmful
-- (nothing reads btc_cup_totals for a completeness decision), but worth closing so the
-- view can never disagree with the match-level totals about which cups are real.
drop view if exists btc_cup_totals;

create view btc_cup_totals
  with (security_invoker = true) as
select
  cv.match_id,
  cv.cup_number,
  cv.team1_tokens,
  (3 - cv.team1_tokens) as team2_tokens
from btc_cup_votes cv
join btc_matches m on m.id = cv.match_id
where cv.cup_number <= app.btc_cups_for_round(m.round);

-- Dropping a view drops its grants.
revoke all on btc_cup_totals from anon, authenticated;
grant select on btc_cup_totals to authenticated;

-- ============ 3. missing indexes on foreign-key columns ============
--
-- Every other FK on these two tables already has one (btc_match_bonuses.match_id is
-- the primary key; btc_bracket_slots.match_id/feeder_slot_1/feeder_slot_2/event_id are
-- all indexed). These three were missed. ON DELETE RESTRICT on team1_id/team2_id/
-- fastest_team_id means a team deletion has to scan these tables regardless of a
-- matching row existing; a sequential scan on an unindexed FK is the specific cost this
-- closes, not a query-plan issue this project has hit yet, but cheap to fix proactively.
create index if not exists btc_match_bonuses_fastest_team_id_idx
  on btc_match_bonuses (fastest_team_id);
create index if not exists btc_bracket_slots_team1_id_idx
  on btc_bracket_slots (team1_id);
create index if not exists btc_bracket_slots_team2_id_idx
  on btc_bracket_slots (team2_id);
