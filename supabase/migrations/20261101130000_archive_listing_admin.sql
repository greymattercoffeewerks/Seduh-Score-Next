-- Seduh Score Next · T-ARC.3: the archive listing choice, the soft unpublish record, and the operator's counts
--
-- Spec: Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md (local, gitignored) sections 2.6 to 2.8 and the
-- T-ARC.3 row, with the owner's answers in HANDOFF-CORRECTION-005.md: decision 7 (a Community organiser MAY unpublish; it is
-- recorded and counted, and the tick does not publish it again), decision 10 (the paid-tier tick box is unticked by default).
-- It extends the T-ARC.1 ledger (20261101100000_archive_tick.sql) ADDITIVELY: two nullable columns and two constraints; nothing
-- that migration made is rewritten.
--
--   1. public.set_archive_listing(p_org_id, p_event_id, p_list)   the D-G21 tick box, a member's RPC.
--        * One refusal (42501 "event not found") for a NULL organisation, an event of another organisation, a missing event and a
--          non-member: nothing to learn about other tenants (the finish_event shape; test 041 attacks it six ways).
--        * A test event is refused (P0001, hint archive_event_is_test): the archive never carries one.
--        * Only an organisation that holds results_archive_optional (Per-event and Annual) has a choice: another gets 42501,
--          hint entitlement_required, detail results_archive_optional (the same shape the other entitlement refusals use).
--          While the key is unenforced app.has_entitlement answers true, so the choice is stored but the tick is dark anyway.
--        * The choice lives in app.archive_events.listing_choice, NOT in a new client-writable table or a column on events (the
--          row-id existence oracle class cannot arise: the caller never names a row id, only an event the RPC authorised).
--          p_list true writes 'list' (the podium is published, T-ARC.1 rule 4); false writes 'named_only' (a named-only
--          entry). Decision 10: nothing is stored until the organiser acts, and a missing choice behaves as 'named_only'.
--          A false with no ledger row yet writes NOTHING (the same outcome as the default, and it must not make a row for an
--          event that ended before the floor, which the tick would then publish as a stub the organiser never asked for).
--        * Once the ledger row has left 'pending' (published, stubbed, skipped, failed, removed) the choice can no longer
--          change what the tick does: P0001, hint archive_listing_closed. The organiser publishes by hand from then on.
--        * It keeps working after the Per-event window locks (it writes an `app` table, not a locked tenant table) and before or
--          after the event ends. Lock order is archive_events then events, as T-ARC.1 requires: the events row is only READ,
--          never locked, so there is no cycle with the tick.
--
--   2. app.archive_note_removal() on public.public_results AFTER DELETE (decision 7). Every way a result goes away (the
--      unpublish_event_results RPC and a member's direct DELETE, which authenticated holds) ends in this one trigger, so the
--      record cannot be bypassed. It writes ONE ledger row to state 'removed' (made if absent), remembering what it was
--      (removed_from) and when (removed_at), and clears the staged snapshot. 'removed' is terminal, so a tick that finds it
--      does nothing: a result the organiser took down is never put back. It records nothing:
--        - while results_archive_optional is unenforced (the pipeline is dark): the trigger makes no row (set_archive_listing may);
--        - for a test event, or when the event is gone (a delete_test_event or an event/organisation delete cascades here).
--      It is SECURITY DEFINER, search_path '', an AFTER trigger that reads nothing from the caller, and FAIL-OPEN: every
--      error but a cancel or statement timeout is swallowed, so an unpublish does not fail because of the ledger. (It may briefly WAIT for a tick that holds
--      the same ledger row: the same caveat T-ARC.1 states.) Test 045's guard covers BEFORE ROW definer triggers; this is AFTER.
--      Accepted: a result published and unpublished while the pipeline is dark is not recorded, so if its event ends at or after
--      the floor the first live tick publishes it again (T-ARC.7: set the floor at the flip moment, flip after such unpublishes).
--
--   3. public.admin_archive_status()  ONE row of counts for the platform operator, gate app.require_platform_admin() first (the
--      shape of admin_seduh_id_counts: STABLE, SECURITY DEFINER, search_path '', granted to authenticated only, the gate
--      decides, no argument, no audit row for a read). D-A4: no event name, no organisation, no id, no per-organisation figure
--      (a per-organisation count could identify who is in the archive), no participant data. It reads only the ledger, the key
--      flag and the EXISTENCE of public_results rows (for removed_unpublished).
--
-- Known limits, stated: the choice is stored without the event having ended, so a ledger row can exist before due_at is known
-- (the tick learns it, T-ARC.1); a removed row stays 'removed' if the organiser publishes again by hand (removed_unpublished tells
-- the two apart); removed_at is the FIRST removal (a second removal of a re-published result is not counted again);
-- while the key is dark a member may tick 'list' for an old ended event, which makes a ledger row the tick works whatever the
-- floor (own event, own choice); a manual publish, a delete and the tick all landing in the same milliseconds can deadlock,
-- and if the trigger is the victim its error is swallowed (the unpublish succeeds, unrecorded, and the tick may then publish
-- the stub again): accepted, the organiser can unpublish again.
--
-- rollback:
--   drop function if exists public.admin_archive_status();
--   drop trigger if exists trg_public_results_archive_note on public.public_results;
--   drop function if exists app.archive_note_removal();
--   drop function if exists public.set_archive_listing(uuid, uuid, boolean);
--   alter table app.archive_events drop constraint if exists archive_events_removed_shape;
--   alter table app.archive_events drop constraint if exists archive_events_removed_from_valid;
--   alter table app.archive_events drop column if exists removed_from;
--   alter table app.archive_events drop column if exists removed_at;
-- (Rolling back a populated ledger loses when and from what state each result was removed; the 'removed' state itself stays
-- allowed by T-ARC.1's own constraint.)

alter table app.archive_events
  add column removed_at   timestamptz,
  add column removed_from text;

alter table app.archive_events
  add constraint archive_events_removed_from_valid
    check (removed_from is null or removed_from in ('none', 'pending', 'published', 'stubbed', 'skipped', 'failed')),
  add constraint archive_events_removed_shape
    check (((state = 'removed') = (removed_at is not null)) and ((removed_at is null) = (removed_from is null)));

-- ============ 1. the tick box ============

create or replace function public.set_archive_listing(p_org_id uuid, p_event_id uuid, p_list boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ended  timestamptz;
  v_test   boolean;
  v_state  text;
  v_choice text;
  v_due    timestamptz;
begin
  -- one refusal for "not your organisation" and "not that organisation's event"
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event_internal(p_event_id)
     or not app.is_org_member(p_org_id) then
    raise exception 'set_archive_listing: event not found' using errcode = '42501';
  end if;
  if p_list is null then
    raise exception 'set_archive_listing: p_list must be true or false' using errcode = '22023', hint = 'archive_listing_invalid';
  end if;

  select e.ended_at, e.is_test into v_ended, v_test from public.events e where e.id = p_event_id and e.org_id = p_org_id;
  if not found then
    raise exception 'set_archive_listing: event not found' using errcode = '42501';
  end if;
  if v_test then
    raise exception 'set_archive_listing: a test event is never archived' using errcode = 'P0001', hint = 'archive_event_is_test';
  end if;

  -- D-G21: only Per-event and Annual choose. Community's listing is compulsory (the tick publishes the podium regardless).
  if not app.has_entitlement(p_org_id, 'results_archive_optional', p_event_id) then
    raise exception 'set_archive_listing: this plan does not offer a choice' using errcode = '42501',
      hint = 'entitlement_required', detail = 'results_archive_optional';
  end if;

  v_choice := case when p_list then 'list' else 'named_only' end;

  if p_list then
    insert into app.archive_events (event_id, org_id, due_at)
    values (p_event_id, p_org_id, case when v_ended is not null then v_ended + interval '24 hours' end)
    on conflict (event_id) do nothing;
  end if;

  -- the row lock is taken here, before anything touches events (lock order archive_events, then events)
  select a.state, a.due_at into v_state, v_due from app.archive_events a where a.event_id = p_event_id for update;
  if not found then
    -- a "named only" choice with no row: the default already is a named-only entry, so there is nothing to record
    return jsonb_build_object('listing', 'named_only', 'recorded', false);
  end if;
  if v_state <> 'pending' then
    raise exception 'set_archive_listing: this event''s archive entry is already decided' using errcode = 'P0001', hint = 'archive_listing_closed';
  end if;

  update app.archive_events set listing_choice = v_choice where event_id = p_event_id;
  return jsonb_build_object('listing', v_choice, 'recorded', true, 'due_at', v_due);
end;
$$;

revoke all on function public.set_archive_listing(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_archive_listing(uuid, uuid, boolean) to authenticated;

-- ============ 2. the soft unpublish record ============

create or replace function app.archive_note_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ended timestamptz;
begin
  begin
    -- dark: the pipeline does not exist yet, so a removal is not its business
    if not coalesce((select k.enforced from app.entitlement_keys k where k.key = 'results_archive_optional'), false) then
      return old;
    end if;
    -- a gone event (a cascade) or a test event is no archive matter
    select e.ended_at into v_ended from public.events e where e.id = old.event_id and not e.is_test;
    if not found then
      return old;
    end if;

    insert into app.archive_events (event_id, org_id, due_at, state, removed_at, removed_from)
    values (old.event_id, old.org_id, case when v_ended is not null then v_ended + interval '24 hours' end, 'removed', now(), 'none')
    on conflict (event_id) do update
       set removed_from = app.archive_events.state, state = 'removed', removed_at = now(),
           staged_payload = null, staged_at = null, next_try_at = null
     where app.archive_events.state <> 'removed';
  exception when others then
    null;  -- fail open: an unpublish never fails because of the ledger
  end;
  return old;
end;
$$;

revoke all on function app.archive_note_removal() from public, anon, authenticated, service_role;

create trigger trg_public_results_archive_note
  after delete on public.public_results
  for each row execute function app.archive_note_removal();

-- ============ 3. the operator's counts ============

create or replace function public.admin_archive_status()
returns table (
  pipeline_live             boolean,
  events_total              integer,
  events_pending            integer,
  events_pending_overdue    integer,
  events_published          integer,
  events_stubbed            integer,
  events_skipped            integer,
  events_failed             integer,
  events_removed            integer,
  published_by_pipeline     integer,
  stubbed_by_pipeline       integer,
  published_by_organiser    integer,
  stubbed_no_snapshot       integer,
  stubbed_invalid_snapshot  integer,
  stubbed_stale_snapshot    integer,
  listing_list              integer,
  listing_named_only        integer,
  removed_after_pipeline    integer,
  removed_unpublished       integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_platform_admin();
  return query
  select coalesce((select k.enforced from app.entitlement_keys k where k.key = 'results_archive_optional'), false),
         count(*)::integer,
         (count(*) filter (where a.state = 'pending'))::integer,
         -- the tick runs every 5 minutes: a pending row an hour past its due time means the schedule is not running
         (count(*) filter (where a.state = 'pending' and a.due_at < now() - interval '1 hour'))::integer,
         (count(*) filter (where a.state = 'published'))::integer,
         (count(*) filter (where a.state = 'stubbed'))::integer,
         (count(*) filter (where a.state = 'skipped'))::integer,
         (count(*) filter (where a.state = 'failed'))::integer,
         (count(*) filter (where a.state = 'removed'))::integer,
         (count(*) filter (where a.state = 'published' and a.outcome_via = 'auto'))::integer,
         (count(*) filter (where a.state = 'stubbed' and a.outcome_via = 'auto'))::integer,
         (count(*) filter (where a.outcome_via in ('organiser_early', 'organiser_late')))::integer,
         (count(*) filter (where a.state = 'stubbed' and a.last_error = 'no_snapshot'))::integer,
         (count(*) filter (where a.state = 'stubbed' and a.last_error = 'invalid_snapshot'))::integer,
         (count(*) filter (where a.state = 'stubbed' and a.last_error = 'stale_snapshot'))::integer,
         (count(*) filter (where a.listing_choice = 'list'))::integer,
         (count(*) filter (where a.listing_choice = 'named_only'))::integer,
         (count(*) filter (where a.state = 'removed' and a.removed_from in ('published', 'stubbed') and a.outcome_via = 'auto'))::integer,
         (count(*) filter (where a.state = 'removed'
                             and not exists (select 1 from public.public_results pr where pr.event_id = a.event_id)))::integer
    from app.archive_events a;
end;
$$;

revoke all on function public.admin_archive_status() from public, anon, authenticated, service_role;
grant execute on function public.admin_archive_status() to authenticated;
