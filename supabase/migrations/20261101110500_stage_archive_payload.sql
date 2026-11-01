-- Seduh Score Next · T-ARC.2: the organiser's browser stages the podium snapshot the archive tick will publish
--
-- Spec: Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md (local, gitignored), section 3 (the payload, option B)
-- with the owner's answers in HANDOFF-CORRECTION-005.md (decision 2: the automatic podium comes from the organiser's browser,
-- a stub of names with no result when there is no fresh snapshot). Extends T-ARC.1 (20261101100000_archive_tick.sql): the tick,
-- the key whitelist (app.archive_snapshot_payload), the stub (app.archive_stub_payload) and the freshness rule are NOT edited.
--
-- What this adds:
--   * public.stage_archive_payload(p_operation_id, p_org_id, p_event_id, p_payload, p_built_at)   the one new API door. A
--     member of the event's organisation stores the browser-built snapshot (the payload buildResultsPayload already
--     produces, podium scope) in app.archive_events.staged_payload, WHITELISTED AT STAGE TIME: only the keys
--     app.archive_snapshot_payload copies are stored (no standings, no notListed, no unknown key, no phone or email in a
--     podium row). The tick applies the same whitelist again at publish time (belt and braces; the tick is not edited).
--   * app.archive_events.staged_built_at   an ADDITIVE column (nullable): the client's clock when it built the snapshot,
--     clamped to the server's. It exists only to order two stagings (see "Ordering").
--
-- Authorisation and what a caller can learn. The door opens with ONE refusal for a missing event, an event of another
-- organisation, a NULL id and a caller who is not a member (42501, 'event not found', as finish_event does), so a stranger
-- learns nothing about which event ids exist. After that, everything is the caller's own organisation's business and the
-- answer is a small JSON status, never a row.
--
-- Returns jsonb {"staged": true|false, "reason": null|text}. A benign non-write is a RETURN, never a raise, because the
-- offline outbox treats a raise as a permanent failure and drops the operation (and reports it in the sync panel):
--   dark        results_archive_optional is unenforced: the pipeline is off, nothing is written (zero footprint; the owner's
--               audited flip is the switch, as for the tick). The client stages again at the next report open.
--   test_event  the event is a test event (the archive refuses them; is_test is re-read by the tick at publish time too).
--   closed      the event's ledger row is no longer pending (published, stubbed, skipped, failed or removed): terminal.
--   superseded  a snapshot built LATER is already staged (a replayed older operation must not overwrite a newer one).
--   duplicate   this operation id has already staged (the idempotency key).
-- Raises only for a snapshot that can never be valid, which the client never builds (hint archive_payload_invalid: not a JSON
-- object, no podium of 1 to 8 rows with a named first row, or no operation id; hint archive_payload_too_large: over 64 KB).
--
-- IDEMPOTENCY. p_operation_id is recorded in public.processed_operations (kind 'stage_archive_payload'), the project's
-- operation ledger, in the SAME transaction as the write; a replay with the same id changes nothing and answers
-- 'duplicate'. The insert is `on conflict do nothing`, so naming another organisation's operation id raises nothing and
-- answers the same 'duplicate': no row-id existence oracle.
--
-- ORDERING. p_built_at (default now(), never later than now()) is stored in staged_built_at; a snapshot built EARLIER than
-- the one already staged is 'superseded'. staged_at, the column the tick's freshness rule reads, is always the SERVER's now()
-- at the moment of staging, never the client's clock: a client clock cannot make a stale snapshot look fresh, nor an old
-- offline one look newer than a score change that happened after it was built. Residual (stated): a snapshot built on a
-- device before another device changed a score, and delivered after that change, is stamped fresh; the next report open
-- re-stages, and the organiser's own champion resolve stages from the same device that wrote the scores.
--
-- LOCK ORDER (T-ARC.1's header): app.archive_events then public.events. This function takes the ledger row lock and never
-- locks an events row (it only reads is_test and ended_at, unlocked, before taking the ledger lock).
--
-- Fail-open: no trigger anywhere; nothing here can block creating, scoring, finishing or publishing manually.
--
-- rollback:
--   drop function if exists public.stage_archive_payload(uuid, uuid, uuid, jsonb, timestamptz);
--   alter table app.archive_events drop column if exists staged_built_at;
--   delete from public.processed_operations where kind = 'stage_archive_payload';
-- (Rolling back loses any snapshot staged so far, which only means the next tick publishes stubs; the ledger rows stay.)

alter table app.archive_events add column staged_built_at timestamptz;

create or replace function public.stage_archive_payload(
  p_operation_id uuid,
  p_org_id       uuid,
  p_event_id     uuid,
  p_payload      jsonb,
  p_built_at     timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_e     record;
  v_a     app.archive_events;
  v_clean jsonb;
  v_built timestamptz;
  v_rows  integer;
begin
  -- one refusal for "not your organisation" and "not that organisation's event" and "no such event"
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event_internal(p_event_id)
     or not app.is_org_member(p_org_id) then
    raise exception 'stage_archive_payload: event not found' using errcode = '42501';
  end if;

  if p_operation_id is null then
    raise exception 'stage_archive_payload: an operation id is required' using errcode = 'P0001', hint = 'archive_payload_invalid';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'stage_archive_payload: the snapshot must be a JSON object' using errcode = 'P0001', hint = 'archive_payload_invalid';
  end if;
  if octet_length(p_payload::text) > 65536 then
    raise exception 'stage_archive_payload: the snapshot is too large' using errcode = 'P0001', hint = 'archive_payload_too_large';
  end if;
  -- the key whitelist (T-ARC.1's own function): the ONLY thing that is stored. Null = not a usable podium.
  v_clean := app.archive_snapshot_payload(p_payload);
  if v_clean is null then
    raise exception 'stage_archive_payload: the snapshot has no usable podium' using errcode = 'P0001', hint = 'archive_payload_invalid';
  end if;

  -- DARK until the owner flips the key (the same switch the tick reads): not even a ledger row is created
  if not coalesce((select k.enforced from app.entitlement_keys k where k.key = 'results_archive_optional'), false) then
    return jsonb_build_object('staged', false, 'reason', 'dark');
  end if;

  select e.is_test, e.ended_at into v_e from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'stage_archive_payload: event not found' using errcode = '42501';
  end if;
  if v_e.is_test then
    return jsonb_build_object('staged', false, 'reason', 'test_event');
  end if;

  v_built := least(coalesce(p_built_at, now()), now());

  -- the ledger row, made here when the tick has not made it yet (due_at is learned by the tick if the event has not ended)
  insert into app.archive_events (event_id, org_id, due_at)
  values (p_event_id, p_org_id, case when v_e.ended_at is null then null else v_e.ended_at + interval '24 hours' end)
  on conflict (event_id) do nothing;

  select * into v_a from app.archive_events a where a.event_id = p_event_id for update;

  if v_a.state <> 'pending' then
    return jsonb_build_object('staged', false, 'reason', 'closed');
  end if;
  if v_a.staged_built_at is not null and v_built < v_a.staged_built_at then
    return jsonb_build_object('staged', false, 'reason', 'superseded');
  end if;

  insert into public.processed_operations (id, org_id, kind)
  values (p_operation_id, p_org_id, 'stage_archive_payload')
  on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('staged', false, 'reason', 'duplicate');
  end if;

  update app.archive_events
     set staged_payload = v_clean, staged_at = now(), staged_built_at = v_built
   where event_id = p_event_id;
  return jsonb_build_object('staged', true, 'reason', null);
end;
$$;

revoke all on function public.stage_archive_payload(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.stage_archive_payload(uuid, uuid, uuid, jsonb, timestamptz) to authenticated;
