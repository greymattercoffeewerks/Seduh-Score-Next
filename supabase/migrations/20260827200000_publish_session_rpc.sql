-- Seduh Score Next · T5.1 publish_session RPC
-- Handoff: SEDUH-NEXT-HANDOFF.md §5.3 (live_sessions), §8 (live surfaces), §9
-- (offline model — outbox holds operations, client-generated UUIDs as
-- idempotency keys).
--
-- rollback:
--   revoke execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) from authenticated;
--   drop function if exists publish_session(uuid, uuid, uuid, text, boolean, jsonb);

-- live_sessions carries two invariants that a plain client-side upsert can't
-- satisfy atomically: `unique(event_id)` (one row per event, history
-- retained — D19) and the partial `live_sessions_one_active_per_org` index
-- (only one row per org may have active = true at once). Publishing event A
-- while event B is already active means deactivating B and activating A —
-- two rows, one transaction. Two SEPARATE client-side statements can't
-- guarantee that: a genuinely concurrent second publish for the same org
-- (found in review: not a "reads a half-applied state" risk — Postgres MVCC
-- means an uncommitted intermediate state is never visible to another
-- transaction in the first place — but a real commit-time race) would hit
-- live_sessions_one_active_per_org's own unique-violation the moment two
-- inserts both try to land active=true for the same org, which a plain
-- two-statement client sequence has no way to recover from cleanly. One
-- transaction closes that the same way confirm_heat and merge_people
-- already close the equivalent problem for their own tables.
--
-- Idempotent via the same processed_operations ledger confirm_heat uses
-- (migration 20260822100000) — a retry after a dropped response replays the
-- same p_operation_id and is a safe no-op, not a second (redundant, but
-- harmless either way here) write.
create or replace function publish_session(
  p_operation_id uuid,
  p_org_id uuid,
  p_event_id uuid,
  p_format text,
  p_is_test boolean,
  p_payload jsonb
)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from processed_operations where id = p_operation_id) then
    return;
  end if;

  -- `is distinct from`, not `<>` — app.org_id_for_event returns null for a
  -- nonexistent event, and `p_org_id <> null` is null (not true) in
  -- plpgsql's `if`, so a plain `<>` would silently fall through to a raw
  -- foreign-key-violation on the insert below instead of a clear message
  -- (found in review). One message for both "doesn't exist" and "exists but
  -- belongs to a different org" — deliberately not distinguished, matching
  -- confirm_heat's own established convention (its wrong-org case reads
  -- "not found" too): a caller who isn't a member of the true owning org
  -- can't see that org's rows under RLS anyway, so a distinct "belongs to a
  -- different org" message here would leak that the event exists at all,
  -- information this caller has no right to.
  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_session: event % not found', p_event_id;
  end if;

  -- Deactivate whatever else is currently active for this org FIRST, THEN
  -- activate/upsert this event's row — the reverse order (upsert first,
  -- deactivate others after) would momentarily hold two active rows for the
  -- same org, tripping live_sessions_one_active_per_org mid-transaction even
  -- though the FINAL state has none. Includes this same event_id in the
  -- deactivate sweep (a harmless no-op if it wasn't already active) rather
  -- than special-casing it, so this one statement is correct whether this
  -- event is being published for the first time, republished, or is already
  -- the active one.
  update live_sessions
  set active = false
  where org_id = p_org_id and active;

  insert into live_sessions (org_id, event_id, format, active, is_test, payload)
  values (p_org_id, p_event_id, p_format, true, p_is_test, p_payload)
  on conflict (event_id) do update
    set format = excluded.format,
        active = true,
        is_test = excluded.is_test,
        payload = excluded.payload;

  insert into processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
end;
$$;

grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) to authenticated;
