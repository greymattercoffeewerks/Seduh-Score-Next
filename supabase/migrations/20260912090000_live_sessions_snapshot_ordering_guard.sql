-- Closes a ROADMAP.md-tracked gap: "No ordering guard on live_sessions's
-- upsert, SELF-HEALING RACE DEFERRED." publish_session's own transaction
-- already makes ONE call atomic (see 20260827200000's own comment), but
-- across TWO separate calls for the same event — e.g. a heat-start publish
-- and a heat-confirm publish fired moments apart, each independently
-- re-reading current DB state via buildLiveSessionPayload — nothing ever
-- stopped whichever call happened to COMMIT LAST from winning, even if its
-- own data snapshot was taken EARLIER than the other call's. A slow request
-- for an earlier action landing after a fast request for a later one would
-- silently regress the live audience payload back to stale data, with
-- nothing to notice or correct it until the next real heat action published
-- again (the "self-healing" half of the original gap's own name).
--
-- Fixed with a client-supplied logical clock, not a server-side `now()` at
-- RPC-execution time (which only orders by commit time — the exact ordering
-- that's unreliable here) and not the existing `updated_at` column (already
-- owned by app.set_updated_at()'s own BEFORE UPDATE trigger, an audit
-- timestamp, not a caller-controlled ordering key). The real fix is
-- formats/cup-taster/liveSession.js's own follow-up change: it now captures
-- the timestamp at which buildLiveSessionPayload READ its snapshot (not
-- when the RPC call finally executes) and passes it through as
-- `p_snapshot_at`.
--
-- The OLD 6-argument publish_session is explicitly DROPPED, not left
-- alongside a new 7-argument overload — `CREATE OR REPLACE FUNCTION` only
-- replaces a function whose argument list matches exactly; adding a new
-- parameter (even one with a default) creates a SECOND, separate overload
-- instead of replacing the first, silently leaving the old, unguarded
-- 6-arg version callable by anything that still invokes it with exactly 6
-- positional arguments.
--
-- CRITICAL, found in review (self-caught re-reading 20260830130000/
-- 20260830140000 before shipping, then confirmed by security-reviewer): a
-- dropped-and-recreated function starts from Postgres's own defaults again
-- — no `search_path` pin, and EXECUTE granted to PUBLIC — silently
-- regressing BOTH hardening migrations that were applied to the original
-- 6-arg function after its own creation:
--   - 20260830130000_rpc_search_path_pin.sql set `search_path = ''` and
--     fully-qualified every table reference (`public.live_sessions`,
--     `public.processed_operations`) so this function's search_path can
--     never be hijacked by a schema earlier in a caller-controlled path.
--   - 20260830140000_revoke_public_execute_on_write_rpcs.sql revoked the
--     PUBLIC-by-default EXECUTE grant (closing a real, if not-yet-exploited,
--     `anon`-reachable gap — see that migration's own comment) and granted
--     to `service_role` alongside the pre-existing `authenticated` grant.
-- All three of those properties are reproduced below on the new 7-arg
-- signature.
--
-- SECOND CRITICAL finding, from security-reviewer's own review of the first
-- draft of this migration: that draft kept the pre-existing unconditional
-- "deactivate whatever else is active for this org" UPDATE running BEFORE a
-- staleness-guarded `ON CONFLICT DO UPDATE ... WHERE excluded.snapshot_at >=
-- live_sessions.snapshot_at`. When that WHERE guard evaluated false (a
-- stale/out-of-order publish for an event that already has a row), the
-- UPDATE arm was skipped entirely — but the deactivate step above it had
-- ALREADY run unconditionally, leaving the org with ZERO active sessions
-- until the next successful publish, not "the previous session stays
-- active" as intended. `live_sessions_one_active_per_org`'s own partial
-- unique index only ever prevented TWO active rows; it does nothing to
-- prevent ZERO. Fixed by checking staleness UP FRONT, against the target
-- event's own existing row (if any), and returning immediately — before
-- touching the deactivate step or any other row — when the incoming
-- snapshot is genuinely older. The deactivate-then-upsert sequence below is
-- now only ever reached once staleness has already been ruled out, so it
-- runs exactly as unconditionally, and exactly as safely, as it did before
-- this migration.
--
-- The stale-publish path still records the operation as processed (not
-- left to retry forever) — a stale snapshot losing a race is a normal,
-- expected outcome of the guard doing its job, not a failure needing a
-- retry.
--
-- rollback:
--   alter table live_sessions drop column if exists snapshot_at;
--
--   drop function if exists publish_session(uuid, uuid, uuid, text, boolean, jsonb, timestamptz);
--
--   create function publish_session(
--     p_operation_id uuid,
--     p_org_id uuid,
--     p_event_id uuid,
--     p_format text,
--     p_is_test boolean,
--     p_payload jsonb
--   )
--   returns void
--   language plpgsql
--   set search_path = ''
--   as $$
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'publish_session: event % not found', p_event_id;
--     end if;
--
--     update public.live_sessions
--     set active = false
--     where org_id = p_org_id and active;
--
--     insert into public.live_sessions (org_id, event_id, format, active, is_test, payload)
--     values (p_org_id, p_event_id, p_format, true, p_is_test, p_payload)
--     on conflict (event_id) do update
--       set format = excluded.format,
--           active = true,
--           is_test = excluded.is_test,
--           payload = excluded.payload;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
--   end;
--   $$;
--
--   revoke execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) from public;
--   grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) to authenticated;
--   grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) to service_role;

alter table live_sessions add column if not exists snapshot_at timestamptz not null default now();

drop function if exists publish_session(uuid, uuid, uuid, text, boolean, jsonb);

create function publish_session(
  p_operation_id uuid,
  p_org_id uuid,
  p_event_id uuid,
  p_format text,
  p_is_test boolean,
  p_payload jsonb,
  p_snapshot_at timestamptz default now()
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_existing_snapshot_at timestamptz;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_session: event % not found', p_event_id;
  end if;

  -- Checked BEFORE any mutation, including the deactivate-others step below
  -- — see this migration's own top comment for the exact regression this
  -- ordering prevents. `< `, not `<=` — a same-instant snapshot (a genuine
  -- idempotent retry, or two reads landing in the same millisecond) is
  -- still allowed through to the normal path below.
  select snapshot_at into v_existing_snapshot_at
  from public.live_sessions
  where event_id = p_event_id;

  if v_existing_snapshot_at is not null and p_snapshot_at < v_existing_snapshot_at then
    insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
    return;
  end if;

  -- Deactivate whatever else is currently active for this org FIRST, THEN
  -- activate/upsert this event's row — the reverse order (upsert first,
  -- deactivate others after) would momentarily hold two active rows for the
  -- same org, tripping live_sessions_one_active_per_org mid-transaction even
  -- though the FINAL state has none. Includes this same event_id in the
  -- deactivate sweep (a harmless no-op if it wasn't already active) rather
  -- than special-casing it, so this one statement is correct whether this
  -- event is being published for the first time, republished, or is already
  -- the active one. Safe to run unconditionally here — the staleness check
  -- above already guarantees the upsert below will actually apply.
  update public.live_sessions
  set active = false
  where org_id = p_org_id and active;

  insert into public.live_sessions (org_id, event_id, format, active, is_test, payload, snapshot_at)
  values (p_org_id, p_event_id, p_format, true, p_is_test, p_payload, p_snapshot_at)
  on conflict (event_id) do update
    set format = excluded.format,
        active = true,
        is_test = excluded.is_test,
        payload = excluded.payload,
        snapshot_at = excluded.snapshot_at;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
end;
$$;

revoke execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb, timestamptz) from public;
grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb, timestamptz) to authenticated;
grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb, timestamptz) to service_role;
