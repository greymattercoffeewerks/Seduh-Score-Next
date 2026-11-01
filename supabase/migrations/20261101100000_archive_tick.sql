-- Seduh Score Next · T-ARC.1: the archive pipeline's state and its tick
--
-- Spec: Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md (local, gitignored), sections 2 and 3, with the
-- owner's answers in HANDOFF-CORRECTION-005.md (decisions 1 to 11, 2026-11-01). D-G22, D-G23, D-G21 of GATING-SPEC.
--
-- What this is: the database-owned job that publishes a Community event's podium about 24 hours after events.ended_at,
-- failing open. It adds state and one function; it adds NO trigger on events, ct_* or public_results, no policy, no grant
-- and no API surface, so nothing in it can fail or block creating, scoring, finishing or manually publishing an event. One honest caveat: the per-event `for share` on the events row lasts until the tick's transaction ends (up to 50 events, seconds), so a member's UPDATE of a just-processed event may briefly WAIT. Lock order is archive_events then events; T-ARC.3's definer RPCs must take them in the same order (a reverse order could deadlock).
--
--   * app.archive_events         one row per event the pipeline knows about (owner-only, the platform-table pattern of
--                                CONVENTIONS "Platform tables and admin functions": row-level security on, no policy, an
--                                ACL that names only the owner, nothing for anon, authenticated or service_role).
--                                event_id and org_id are bare uuids with NO foreign key (like person_merges), so the
--                                ledger survives an event delete; an event that is gone is skipped by the tick.
--   * app.archive_tick(floor)    the scheduler's one entry point. SECURITY DEFINER, search_path '', executable by no API
--                                role AND refusing an API session by name (as app.seduh_identity_backfill does).
--   * app.archive_process_one    one event, called by the tick inside its own sub-transaction (internal).
--   * app.archive_snapshot_payload / app.archive_stub_payload   the key whitelist and the named-only stub (internal).
--
-- DARK. The tick does nothing at all (returns {"dark": true}) while the key results_archive_optional is unenforced. The
-- spec reads "has_entitlement is false = compulsory", but app.has_entitlement answers TRUE for an unenforced key, which
-- would put every organisation on the paid-tier "organiser's choice" path and stub every event. So the tick checks
-- app.entitlement_keys.enforced itself: the owner's audited flip (admin_set_key_enforced) is the switch, no new flag.
--
-- THE FLOOR. Migration 20261023130000 backfilled ended_at for every already-concluded event, so an unbounded finder would
-- publish the whole history the day the key is flipped. The tick therefore creates rows for ended events only at or after
-- the `p_enqueue_from` it is given (null = create none; it still works rows that exist). The cron job carries the value:
-- select cron.schedule('archive-tick', '*/5 * * * *', $$select app.archive_tick('<flip moment>')$$). Rows made by an
-- organiser RPC (T-ARC.3) are worked whatever the floor.
--
-- THE RULES, per event, under `for update skip locked` (state machine: pending -> published | stubbed | skipped | failed;
-- `removed` is reserved for T-ARC.3's soft unpublish; every state but pending is terminal and never revisited, so a result
-- an organiser unpublished is not republished):
--   1. due when state = 'pending', due_at (ended_at + 24 hours, stored once) has passed and next_try_at has;
--   2. is_test is re-read at the moment of publish, under `for share` on the events row (is_test is member-writable): a
--      test event is skipped. (check_public_results_org refuses it again at the write.)
--   3. a public_results row that already exists is NEVER overwritten (insert ... on conflict do nothing): the organiser
--      published first, the row is skipped with outcome_via organiser_early (published at or before due_at) or
--      organiser_late.
--   4. listing: compulsory when the organisation does NOT hold results_archive_optional (evaluated at due_at, so a
--      Per-event window that closed afterwards does not change what was promised); otherwise the organiser's
--      listing_choice decides: 'list' publishes the podium, 'named_only' or null publishes a named-only stub (D-G21).
--   5. podium path: the staged browser snapshot (T-ARC.2 writes it) is published only if it is valid (a JSON object with a
--      podium of 1 to 8 rows, the first with a name, at most 64 KB) and FRESH (no score_change_log row for the event after
--      staged_at). Otherwise a stub is published and last_error says why (no_snapshot, invalid_snapshot, stale_snapshot).
--      A wrong public podium is worse than a stub. Only whitelisted keys are copied (spec 3.4): no standings, no notListed.
--   6. one event per sub-transaction: an error rolls that event back, records ONLY the SQLSTATE in last_error (never message
--      text, which can carry values), backs off exponentially (5 min x 2^attempts, at most one day) and moves the event to
--      'failed' after 5 attempts. The tick never lets one event stop the others.
--   7. retention (decision 9): the staged snapshot is cleared when published and 30 days after due_at.
--
-- outcome_via: the spec's list was auto, organiser_early, organiser_before_due, admin. "organiser_before_due" and
-- "organiser_early" would mean the same thing, so the set is auto, organiser_early, organiser_late, admin.
--
-- Known limits, stated: the tick publishes about 24 h to 24 h 5 min after the end (the 5-minute schedule); a forged
-- "concluded" (status is member-writable) starts the clock and ends in a stub or the member's own staged podium (spec 2.5);
-- the owner can still edit or drop these rows; the migration does not create pg_cron (a separate, owner-approved rollout
-- step, T-ARC.7), so until the job exists nothing calls the tick.
--
-- rollback:
--   drop function if exists app.archive_tick(timestamptz);
--   drop function if exists app.archive_process_one(uuid);
--   drop function if exists app.archive_stub_payload(uuid);
--   drop function if exists app.archive_snapshot_payload(jsonb);
--   drop table if exists app.archive_events;
-- (Rolling back a populated ledger loses the history of what was published automatically and why.)

create table app.archive_events (
  event_id        uuid primary key,
  org_id          uuid not null,
  due_at          timestamptz,
  listing_choice  text,
  staged_payload  jsonb,
  staged_at       timestamptz,
  state           text not null default 'pending',
  attempts        integer not null default 0,
  last_error      text,
  next_try_at     timestamptz,
  outcome_via     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint archive_events_state_valid check (state in ('pending', 'published', 'stubbed', 'skipped', 'failed', 'removed')),
  constraint archive_events_listing_valid check (listing_choice is null or listing_choice in ('list', 'named_only')),
  constraint archive_events_outcome_valid check (outcome_via is null or outcome_via in ('auto', 'organiser_early', 'organiser_late', 'admin')),
  constraint archive_events_attempts_valid check (attempts between 0 and 5),
  -- a SQLSTATE or a short reason code, never free text (a message can carry a name or a phone)
  constraint archive_events_last_error_shape check (last_error is null or last_error ~ '^[A-Za-z0-9_]{1,40}$'),
  constraint archive_events_staged_pair check ((staged_payload is null) = (staged_at is null)),
  constraint archive_events_staged_shape check (
    staged_payload is null
    or (jsonb_typeof(staged_payload) = 'object' and octet_length(staged_payload::text) <= 65536)),
  constraint archive_events_published_has_outcome check (state not in ('published', 'stubbed') or outcome_via is not null)
);

-- the due-finder reads only the pending rows
create index archive_events_pending_due on app.archive_events (due_at) where state = 'pending';

alter table app.archive_events enable row level security;
revoke all on app.archive_events from public, anon, authenticated, service_role;

create trigger trg_archive_events_set_updated_at
  before update on app.archive_events
  for each row execute function app.set_updated_at();

-- a row never moves to another event or organisation
create trigger trg_archive_events_parent_immutable
  before update of event_id, org_id on app.archive_events
  for each row execute function app.forbid_parent_change('event_id', 'org_id');

-- ============ the key whitelist (spec 3.4) ============

-- Returns the payload the archive may carry, or NULL when the snapshot is not usable. Copies only: the scalar event fields
-- below and podium[].{rank,name,cafe,correct,total}. Everything else (standings, notListed, any other key) is dropped.
create or replace function app.archive_snapshot_payload(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_top    jsonb;
  v_podium jsonb;
  v_n      integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 65536 then
    return null;
  end if;
  if coalesce(jsonb_typeof(p -> 'podium'), '') <> 'array' then
    return null;
  end if;
  v_n := jsonb_array_length(p -> 'podium');
  if v_n < 1 or v_n > 8 then
    return null;
  end if;
  -- every row an object with a non-blank text name (the champion is row 1)
  if exists (
       select 1 from jsonb_array_elements(p -> 'podium') r
        where jsonb_typeof(r) <> 'object' or coalesce(jsonb_typeof(r -> 'name'), '') <> 'string' or nullif(btrim(r ->> 'name'), '') is null) then
    return null;
  end if;

  select coalesce(jsonb_object_agg(e.key,
                    case when jsonb_typeof(e.value) = 'string' then to_jsonb(left(e.value #>> '{}', 200)) else e.value end), '{}'::jsonb)
    into v_top
    from jsonb_each(p) e
   where e.key in ('format', 'eventName', 'city', 'venue', 'eventDate', 'competitors', 'rounds', 'winningTimeSecs')
     and jsonb_typeof(e.value) = case when e.key in ('competitors', 'rounds', 'winningTimeSecs') then 'number' else 'string' end;

  select jsonb_agg(jsonb_build_object(
           'rank',    case when jsonb_typeof(r.v -> 'rank')    = 'number' then r.v -> 'rank'    end,
           'name',    to_jsonb(left(r.v ->> 'name', 120)),
           'cafe',    case when jsonb_typeof(r.v -> 'cafe')    = 'string' then to_jsonb(left(r.v ->> 'cafe', 120)) end,
           'correct', case when jsonb_typeof(r.v -> 'correct') = 'number' then r.v -> 'correct' end,
           'total',   case when jsonb_typeof(r.v -> 'total')   = 'number' then r.v -> 'total'   end)
         order by r.ord)
    into v_podium
    from jsonb_array_elements(p -> 'podium') with ordinality as r(v, ord);

  return v_top || jsonb_build_object('podium', v_podium);
end;
$$;

-- The named-only entry (D-G21; also the fallback when there is no usable snapshot): the facts the database already holds,
-- no podium, no person. Null when the event does not exist.
create or replace function app.archive_stub_payload(p_event_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'format', e.format, 'eventName', e.name, 'eventDate', e.event_date,
           'city', e.city, 'venue', e.venue, 'listing', 'named_only'))
    from public.events e
   where e.id = p_event_id;
$$;

-- ============ one event ============

-- Called by the tick inside a sub-transaction, so any error rolls this event back and nothing else. Returns the outcome:
-- 'published', 'stubbed' or 'skipped'. Raises on a database error (the tick records the SQLSTATE and backs off).
create or replace function app.archive_process_one(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a        app.archive_events;
  v_e        record;
  v_pr       record;
  v_optional boolean;
  v_podium   boolean;
  v_snap     jsonb;
  v_payload  jsonb;
  v_reason   text;
  v_rows     integer;
begin
  select * into v_a from app.archive_events a where a.event_id = p_event_id and a.state = 'pending';
  if not found then
    return 'skipped';
  end if;

  -- `for share` holds the event row for the rest of this transaction, so a member cannot flip is_test between this read
  -- and the write below (is_test is member-writable): the re-check at publish time is not a stale read.
  select e.id, e.org_id, e.is_test, e.ended_at into v_e from public.events e where e.id = p_event_id for share;
  if not found then
    update app.archive_events set state = 'skipped', last_error = 'event_gone', next_try_at = null where event_id = p_event_id;
    return 'skipped';
  end if;
  -- defensive: ended_at is one-way for every API caller, so only the owner could reach this
  if v_e.ended_at is null then
    update app.archive_events set state = 'skipped', last_error = 'not_ended', next_try_at = null where event_id = p_event_id;
    return 'skipped';
  end if;
  if v_e.is_test then
    update app.archive_events set state = 'skipped', last_error = 'is_test', staged_payload = null, staged_at = null, next_try_at = null
     where event_id = p_event_id;
    return 'skipped';
  end if;

  -- an organiser's own publish always wins; this is also the idempotency check (the insert below repeats it atomically)
  select pr.published_at into v_pr from public.public_results pr where pr.event_id = p_event_id;
  if found then
    update app.archive_events
       set state = 'skipped', last_error = null, staged_payload = null, staged_at = null, next_try_at = null,
           outcome_via = case when v_pr.published_at <= v_a.due_at then 'organiser_early' else 'organiser_late' end
     where event_id = p_event_id;
    return 'skipped';
  end if;

  v_optional := app.has_entitlement(v_e.org_id, 'results_archive_optional', p_event_id, v_a.due_at);
  v_podium := (not v_optional) or coalesce(v_a.listing_choice = 'list', false);

  v_reason := null;
  if v_podium then
    if v_a.staged_payload is null then
      v_reason := 'no_snapshot';
    else
      v_snap := app.archive_snapshot_payload(v_a.staged_payload);
      if v_snap is null then
        v_reason := 'invalid_snapshot';
      elsif exists (select 1 from public.score_change_log l where l.event_id = p_event_id and l.changed_at > v_a.staged_at) then
        v_reason := 'stale_snapshot';
      end if;
    end if;
  end if;

  if v_podium and v_reason is null then
    v_payload := v_snap;
  else
    v_payload := app.archive_stub_payload(p_event_id);
  end if;

  -- published_by stays null: nobody signed in did this. The org name/slug stamp, the size limit, the org match and the
  -- is_test refusal are the table's own triggers and run as for any other writer.
  insert into public.public_results (org_id, event_id, payload, published_by)
  values (v_e.org_id, p_event_id, v_payload, null)
  on conflict (event_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    -- lost a race with an organiser's publish between the check above and the insert: theirs stays
    update app.archive_events
       set state = 'skipped', last_error = null, staged_payload = null, staged_at = null, next_try_at = null, outcome_via = 'organiser_late'
     where event_id = p_event_id;
    return 'skipped';
  end if;

  update app.archive_events
     set state = case when v_podium and v_reason is null then 'published' else 'stubbed' end,
         outcome_via = 'auto', last_error = v_reason, staged_payload = null, staged_at = null, next_try_at = null
   where event_id = p_event_id;
  return case when v_podium and v_reason is null then 'published' else 'stubbed' end;
end;
$$;

-- ============ the tick ============

create or replace function app.archive_tick(p_enqueue_from timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api       text[] := array['anon', 'authenticated', 'service_role', 'authenticator'];
  r           record;
  v_outcome   text;
  v_enqueued  integer := 0;
  v_published integer := 0;
  v_stubbed   integer := 0;
  v_skipped   integer := 0;
  v_errored   integer := 0;
begin
  -- the scheduler runs as the database owner. The ACL already names no API role; this refuses one by name as well (a
  -- definer function cannot see the caller through current_user, so the session role and the SET ROLE value are read).
  if session_user = any (v_api) or current_user = any (v_api)
     or coalesce(current_setting('role', true), '') = any (v_api) then
    raise exception 'archive_tick is run by the database owner only'
      using errcode = '42501', hint = 'archive_tick_owner_only';
  end if;

  -- DARK until the owner flips the key (see the header): not even a row is created.
  if not coalesce((select k.enforced from app.entitlement_keys k where k.key = 'results_archive_optional'), false) then
    return jsonb_build_object('dark', true);
  end if;

  -- 1. rows for events that ended at or after the floor (none when the floor is null); a row stores its due time once
  insert into app.archive_events (event_id, org_id, due_at)
  select e.id, e.org_id, e.ended_at + interval '24 hours'
    from public.events e
   where p_enqueue_from is not null and e.ended_at >= p_enqueue_from and not e.is_test
  on conflict (event_id) do nothing;
  get diagnostics v_enqueued = row_count;

  -- a row an organiser RPC made before the event ended learns its due time now
  update app.archive_events a
     set due_at = e.ended_at + interval '24 hours'
    from public.events e
   where a.event_id = e.id and a.state = 'pending' and a.due_at is null and e.ended_at is not null;

  -- retention (decision 9): a snapshot nobody used is cleared 30 days after it was due
  update app.archive_events
     set staged_payload = null, staged_at = null
   where staged_payload is not null and due_at < now() - interval '30 days';

  -- 2. the due ones. `skip locked`: a second tick running at the same moment passes over what this one holds.
  for r in
    select a.event_id
      from app.archive_events a
     where a.state = 'pending' and a.due_at <= now() and (a.next_try_at is null or a.next_try_at <= now())
     order by a.due_at
     limit 50
       for update skip locked
  loop
    begin
      v_outcome := app.archive_process_one(r.event_id);
      if v_outcome = 'published' then v_published := v_published + 1;
      elsif v_outcome = 'stubbed' then v_stubbed := v_stubbed + 1;
      else v_skipped := v_skipped + 1;
      end if;
    exception when others then
      -- the sub-transaction rolled this event back; keep the class of the failure only (never the message)
      v_errored := v_errored + 1;
      update app.archive_events a
         set attempts = a.attempts + 1,
             last_error = sqlstate,
             state = case when a.attempts + 1 >= 5 then 'failed' else a.state end,
             next_try_at = now() + least(interval '1 day', interval '5 minutes' * power(2, a.attempts))
       where a.event_id = r.event_id;
    end;
  end loop;

  return jsonb_build_object('dark', false, 'enqueued', v_enqueued, 'published', v_published,
                            'stubbed', v_stubbed, 'skipped', v_skipped, 'errored', v_errored);
end;
$$;

revoke all on function app.archive_snapshot_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.archive_stub_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function app.archive_process_one(uuid) from public, anon, authenticated, service_role;
revoke all on function app.archive_tick(timestamptz) from public, anon, authenticated, service_role;
