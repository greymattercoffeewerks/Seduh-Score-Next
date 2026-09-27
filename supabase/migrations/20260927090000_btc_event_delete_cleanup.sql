-- Seduh Score Next · BTC: clear an event's matches and bracket slots before the event
-- itself is deleted (2026-09-27 production bug: "Something went wrong saving that"
-- deleting a test BTC event).
--
-- Deleting an event cascades to btc_teams, btc_judges, btc_matches and
-- btc_bracket_slots as siblings. The order those cascades run in is an implementation
-- detail (internal FK trigger order), and in practice btc_teams/btc_judges go first —
-- while rows that reference them still exist: btc_matches.team1/2_id,
-- btc_bracket_slots.team1/2_id and btc_match_judges.judge_id are ON DELETE RESTRICT,
-- btc_match_bonuses.fastest_team_id is NO ACTION. Production logged
-- btc_match_bonuses_fastest_team_id_fkey. Cup Taster never hit this: its sideways
-- references (ct_heat_entries.entry_id -> event_entries, ct_results.set_id -> ct_sets)
-- are themselves ON DELETE CASCADE, so cascade order doesn't matter there.
--
-- Those RESTRICT references are deliberate (a team a match still uses must not be
-- deletable on its own), so they stay as they are. Instead, this BEFORE DELETE trigger
-- on events removes the event's bracket slots and then its matches (which cascade to
-- btc_match_judges, btc_cup_votes, btc_match_bonuses) before the event's own cascade
-- reaches btc_teams/btc_judges, which by then nothing references. Slots go first so the
-- match delete doesn't fire btc_bracket_slots.match_id SET NULL updates, and so slot
-- team references can't trip under a different cascade order (the cloud project's FK
-- trigger order may differ from a fresh local reset's). The trigger lives with the BTC
-- tables rather than inside core's delete_test_event, so the core RPC stays
-- format-agnostic (handoff §6).
--
-- SECURITY INVOKER (the default): btc_matches_write and btc_bracket_slots_write gate on
-- the same app.is_org_member(org_id_for_event(event_id)) as events_write, so whoever's
-- events DELETE got through can delete these rows too — no elevated rights needed.
--
-- No `when (old.format = 'btc')` filter: events.format isn't immutable, so a BTC event
-- whose format was later changed would skip the cleanup and hit the original FK error.
-- Both deletes are indexed on event_id and match nothing for a non-BTC event.
--
-- Behaviour change for REAL (non-test) BTC events: a direct `delete from events` used
-- to fail on this same FK error by accident; it now succeeds, the same as a real Cup
-- Taster event already does under events_write. The deliberate guard against deleting
-- real events is delete_test_event's refusal (the only UI path), which is unchanged.
-- Such a delete also logs a score_change_log row per match and bracket slot (confirmed
-- matches as after_confirm) alongside the events row, because they now go while their
-- event still resolves — extra history beyond what 20260924100000's header describes
-- for a cascade, nothing lost. Test events are never logged.
--
-- rollback:
--   drop trigger if exists trg_events_btc_delete_cleanup on events;
--   drop function if exists app.btc_delete_event_children();

create or replace function app.btc_delete_event_children()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.btc_bracket_slots where event_id = old.id;
  delete from public.btc_matches where event_id = old.id;
  return old;
end;
$$;

create trigger trg_events_btc_delete_cleanup
  before delete on events
  for each row
  execute function app.btc_delete_event_children();

revoke execute on function app.btc_delete_event_children() from public, anon;
