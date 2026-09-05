-- Seduh Score Next · delete_test_event RPC (2026-09-05, user-requested "Delete
-- event" feature, closing the growing pile of test events left over from
-- verification runs — production's events table currently holds a dozen-plus
-- of these with no way to remove them).
--
-- rollback:
--   revoke execute on function delete_test_event(uuid, uuid) from authenticated;
--   revoke execute on function delete_test_event(uuid, uuid) from service_role;
--   drop function if exists delete_test_event(uuid, uuid);

-- Every table hanging off events already declares `on delete cascade` all
-- the way down (event_entries, ct_stages -> ct_sets/ct_stage_entries ->
-- ct_heats -> ct_heat_entries -> ct_results, live_sessions — see
-- 20260821200000_core_tables.sql / 20260821210000_cup_taster_tables.sql /
-- 20260821220000_live_sessions_table.sql), so a bare `delete from events`
-- already removes everything correctly and atomically. This RPC's entire
-- job is the one thing a plain client-side `.delete()` can't enforce: never
-- deleting anything that isn't is_test. D9's whole discipline throughout
-- this project is "is_test must render unmistakably, from the first
-- commit" — this is that same discipline applied to deletion, since
-- `events_write`'s own RLS policy (`for all`, 20260821230000_rls_policies.sql)
-- would otherwise happily let an org member delete a REAL event (the actual
-- Oct 4 competition) with the same one client call as a test one, with no
-- undo. SECURITY INVOKER (the default — no `security definer`), matching
-- every other write RPC's own established security posture
-- (20260830130000_rpc_search_path_pin.sql's own comment: "none declare
-- security definer") — running as the caller means events_write's RLS
-- policy still gates the actual DELETE statement below as genuine
-- defense-in-depth, not just this function's own org_id check.
--
-- p_org_id is validated against the row's actual org via app.org_id_for_event
-- + `is distinct from` (null-safe) — mirrors publish_session's own, more
-- recent precedent exactly: ONE unified "not found" error covers both a
-- genuinely nonexistent event_id (org_id_for_event returns null) and a
-- wrong-org one, deliberately indistinguishable so a caller can never learn
-- "this id exists but isn't yours" versus "this id doesn't exist" — the
-- same reasoning that migration's own test file states explicitly. A
-- correctly-owned event that just isn't test data gets a SEPARATE, distinct
-- error (there's no information-leak concern once ownership is already
-- confirmed). Unlike confirm_heat/publish_session, this isn't routed through
-- the outbox (event deletion is a low-frequency, organiser-only setup-time
-- action, not a live-heat-time-pressure write — same reasoning setup.js's
-- own module comment already gives for stage/set creation), so it has no
-- client-generated operation id and no idempotent-replay contract to honor;
-- a second call for an event the first call already deleted correctly
-- raises the same "not found" error as any other nonexistent event_id would
-- (org_id_for_event returns null either way) — the UI guards against a
-- double-click causing this itself, an explicit re-entrancy check in
-- handleConfirmDelete (eventsScreen.js), found missing in review
-- (code-reviewer) and added there rather than left to the accident of
-- full-DOM-rebuild-per-render removing the clickable node in time.
--
-- The final DELETE also repeats `and is_test`, not just the guard clause
-- above — found in review (security-reviewer): the guard's own SELECT and
-- this DELETE are two separate statements under READ COMMITTED, so without
-- this the guard is only PROCEDURALLY safe (true today only because nothing
-- in this codebase ever updates events.is_test after creation — confirmed by
-- that same review's own grep — not because the function structurally
-- enforces it). Repeating the condition on the statement that actually
-- deletes makes this self-enforcing regardless of any future write path,
-- rather than depending on that fact staying true forever.
create or replace function delete_test_event(p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'delete_test_event: event % not found', p_event_id;
  end if;

  if not (select is_test from public.events where id = p_event_id) then
    raise exception 'delete_test_event: refusing to delete a non-test event (%)', p_event_id
      using errcode = 'P0001';
  end if;

  delete from public.events where id = p_event_id and is_test;
end;
$$;

-- Matches every other write RPC's final grant state
-- (20260830140000_revoke_public_execute_on_write_rpcs.sql): PostgreSQL grants
-- EXECUTE to PUBLIC (which includes anon) by default on function creation —
-- explicit revoke closes that immediately, in this same migration, rather
-- than needing a later follow-up the way the original six RPCs did.
revoke execute on function delete_test_event(uuid, uuid) from public;
grant execute on function delete_test_event(uuid, uuid) to authenticated;
grant execute on function delete_test_event(uuid, uuid) to service_role;
