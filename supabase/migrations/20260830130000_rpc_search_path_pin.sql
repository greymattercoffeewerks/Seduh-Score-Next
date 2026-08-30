-- Seduh Score Next · pin search_path on the six top-level write RPCs
-- Handoff: SEDUH-NEXT-HANDOFF.md §9 (offline model — these are the RPCs the
-- outbox flushes through).
--
-- rollback:
--   Each function is restored to its own last-known-good body (its own
--   original migration), search_path GUC removed. Since `create or replace
--   function` can't "unset" a config parameter back to none via the body
--   alone, the rollback is an explicit `alter function ... reset search_path`
--   per function, run BEFORE re-creating the pre-this-migration body:
--     alter function auto_max_heat(uuid, uuid, uuid, timestamptz) reset search_path;
--     alter function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) reset search_path;
--     alter function start_heat(uuid, uuid, uuid, timestamptz) reset search_path;
--     alter function publish_session(uuid, uuid, uuid, text, boolean, jsonb) reset search_path;
--     alter function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) reset search_path;
--     alter function merge_people(uuid, uuid, uuid) reset search_path;
--   (then re-apply each function's original CREATE OR REPLACE from its own
--   source migration, unchanged, if reverting the qualification too.)
--
-- Found by `get_advisors` (security lint) after linking the cloud project,
-- 2026-08-30: merge_people, confirm_heat, publish_session, start_heat,
-- record_heat_time, and auto_max_heat all lacked an explicit `search_path`
-- pin — every `app.*` helper function this schema already has (org_id_for_*,
-- is_org_member, the trigger functions) has carried `set search_path = ''`
-- since T1.3, this is the same hygiene closing the gap on the six functions
-- that never got it.
--
-- Lower risk than the lint's own generic wording implies: all six run as
-- SECURITY INVOKER (the default — none declare `security definer`), and
-- neither `anon` nor `authenticated` has CREATE on the `public` schema in
-- this project's standard grants (20260821240000_grants.sql never grants
-- it), so there is no live schema-shadowing path today. Still worth closing
-- for the same reason app.is_org_member's own comment gives: a mutable
-- search_path is exactly the kind of thing whose safety depends on an
-- invariant (no untrusted CREATE on public) staying true forever, not on
-- being verified once.
--
-- `set search_path = ''` on a function with previously-UNQUALIFIED table
-- references is not a no-op GUC addition — with an empty search_path,
-- nothing but pg_catalog resolves implicitly, so every one of these six
-- functions' own `from people`/`from ct_heats`/`from event_entries`/etc.
-- would silently start failing to resolve at all. Each function body is
-- therefore reproduced here in full (`create or replace function`, not a
-- bare `alter function ... set search_path`), with every previously-bare
-- table reference now `public.`-qualified — the same discipline the
-- existing `app.*` helper functions already use. No other change to any
-- function's logic; verified locally against the full pgTAP suite
-- (113/113) before this migration was written up.

create or replace function merge_people(p_org_id uuid, p_kept_id uuid, p_merged_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_merged_name text;
begin
  if p_kept_id = p_merged_id then
    raise exception 'merge_people: cannot merge a person into themselves';
  end if;

  if not exists (select 1 from public.people where id = p_kept_id and org_id = p_org_id) then
    raise exception 'merge_people: kept person % not found in org %', p_kept_id, p_org_id;
  end if;

  select display_name into v_merged_name
  from public.people
  where id = p_merged_id and org_id = p_org_id;

  if v_merged_name is null then
    raise exception 'merge_people: merged person % not found in org %', p_merged_id, p_org_id;
  end if;

  update public.event_entries ee
  set person_id = p_kept_id
  where ee.person_id = p_merged_id
    and not exists (
      select 1 from public.event_entries ee2
      where ee2.event_id = ee.event_id and ee2.person_id = p_kept_id
    );

  update public.event_entries
  set person_id = null
  where person_id = p_merged_id;

  insert into public.person_merges (org_id, kept_id, merged_id, merged_name, merged_by)
  values (p_org_id, p_kept_id, p_merged_id, v_merged_name, auth.uid());

  delete from public.people where id = p_merged_id and org_id = p_org_id;
end;
$$;

create or replace function confirm_heat(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_id uuid,
  p_expected_updated_at timestamptz,
  p_entries jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_current_updated_at timestamptz;
  v_entry jsonb;
  v_result jsonb;
  v_entry_id uuid;
  v_expected_set_count int;
  v_incomplete_count int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id <> app.org_id_for_heat(p_heat_id) then
    raise exception 'confirm_heat: heat % does not belong to org %', p_heat_id, p_org_id;
  end if;

  select updated_at into v_current_updated_at from public.ct_heats where id = p_heat_id;
  if v_current_updated_at is null then
    raise exception 'confirm_heat: heat % not found', p_heat_id;
  end if;

  if v_current_updated_at <> p_expected_updated_at then
    raise exception 'CONFLICT: heat % has been modified since it was read', p_heat_id
      using detail = json_build_object(
              'heat_id', p_heat_id,
              'current_updated_at', v_current_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_entry_id := (v_entry->>'entry_id')::uuid;

    update public.ct_heat_entries
    set elapsed_secs = (v_entry->>'elapsed_secs')::int,
        elapsed_secs_raw = (v_entry->>'elapsed_secs_raw')::int,
        maxed = coalesce((v_entry->>'maxed')::boolean, false),
        time_source = coalesce(v_entry->>'time_source', 'tapped')
    where id = v_entry_id and heat_id = p_heat_id;

    if not found then
      raise exception 'confirm_heat: heat_entry % not found in heat %', v_entry_id, p_heat_id;
    end if;

    for v_result in select * from jsonb_array_elements(coalesce(v_entry->'results', '[]'::jsonb))
    loop
      insert into public.ct_results (heat_entry_id, set_id, correct)
      values (v_entry_id, (v_result->>'set_id')::uuid, (v_result->>'correct')::boolean)
      on conflict (heat_entry_id, set_id) do update set correct = excluded.correct;
    end loop;
  end loop;

  select set_count into v_expected_set_count
  from public.ct_stages
  join public.ct_heats on ct_heats.stage_id = ct_stages.id
  where ct_heats.id = p_heat_id;

  select count(*) into v_incomplete_count
  from public.ct_heat_entries he
  where he.heat_id = p_heat_id
    and (select count(*) from public.ct_results r where r.heat_entry_id = he.id) <> v_expected_set_count;

  if v_incomplete_count > 0 then
    raise exception 'confirm_heat: % cupper(s) do not have every set scored', v_incomplete_count;
  end if;

  update public.ct_heats set status = 'confirmed' where id = p_heat_id;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'confirm_heat');
end;
$$;

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
set search_path = ''
as $$
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_session: event % not found', p_event_id;
  end if;

  update public.live_sessions
  set active = false
  where org_id = p_org_id and active;

  insert into public.live_sessions (org_id, event_id, format, active, is_test, payload)
  values (p_org_id, p_event_id, p_format, true, p_is_test, p_payload)
  on conflict (event_id) do update
    set format = excluded.format,
        active = true,
        is_test = excluded.is_test,
        payload = excluded.payload;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'publish_session');
end;
$$;

create or replace function start_heat(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_id uuid,
  p_started_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_timing_mode text;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'start_heat: heat % not found', p_heat_id;
  end if;

  select status, timing_mode into v_status, v_timing_mode
  from public.ct_heats where id = p_heat_id;
  if v_status is null then
    raise exception 'start_heat: heat % not found', p_heat_id;
  end if;

  if v_timing_mode <> 'app' then
    raise exception 'start_heat: heat % is not an app-mode heat', p_heat_id;
  end if;

  update public.ct_heats
  set status = 'timing', started_at = p_started_at
  where id = p_heat_id and status = 'pending';

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'start_heat');
end;
$$;

create or replace function record_heat_time(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_entry_id uuid,
  p_expected_heat_status text,
  p_elapsed_secs int,
  p_elapsed_secs_raw int,
  p_maxed boolean,
  p_time_source text,
  p_time_edited_at timestamptz,
  p_conflict_policy text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_heat_id uuid;
  v_heat_status text;
  v_already_set boolean;
begin
  if p_conflict_policy not in ('reject', 'overwrite') then
    raise exception 'record_heat_time: invalid p_conflict_policy %', p_conflict_policy;
  end if;

  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
    raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;

  if v_heat_id is null then
    raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  perform 1 from public.ct_heats where id = v_heat_id for update;

  select h.status, (he.elapsed_secs is not null)
    into v_heat_status, v_already_set
  from public.ct_heat_entries he
  join public.ct_heats h on h.id = he.heat_id
  where he.id = p_heat_entry_id;

  if v_heat_status <> p_expected_heat_status then
    raise exception 'CONFLICT: heat % is % now, expected %', v_heat_id, v_heat_status, p_expected_heat_status
      using detail = json_build_object(
              'heat_id', v_heat_id,
              'current_status', v_heat_status,
              'expected_status', p_expected_heat_status
            )::text,
            errcode = 'P0002';
  end if;

  if p_conflict_policy = 'reject' and v_already_set then
    raise exception 'CONFLICT: heat entry % already has a recorded time', p_heat_entry_id
      using errcode = 'P0002';
  end if;

  update public.ct_heat_entries
  set elapsed_secs = p_elapsed_secs,
      elapsed_secs_raw = p_elapsed_secs_raw,
      maxed = p_maxed,
      time_source = p_time_source,
      time_edited_at = p_time_edited_at
  where id = p_heat_entry_id;

  if not exists (
    select 1 from public.ct_heat_entries where heat_id = v_heat_id and elapsed_secs is null
  ) then
    update public.ct_heats set status = 'scoring' where id = v_heat_id and status in ('pending', 'timing');
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'record_heat_time');
end;
$$;

create or replace function auto_max_heat(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_id uuid,
  p_time_edited_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_duration_secs int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'auto_max_heat: heat % not found', p_heat_id;
  end if;

  if not exists (select 1 from public.ct_heats where id = p_heat_id) then
    raise exception 'auto_max_heat: heat % not found', p_heat_id;
  end if;

  perform 1 from public.ct_heats where id = p_heat_id for update;

  select duration_secs into v_duration_secs from public.ct_heats where id = p_heat_id and status = 'timing';

  if v_duration_secs is not null then
    update public.ct_heat_entries
    set elapsed_secs = v_duration_secs,
        elapsed_secs_raw = v_duration_secs,
        maxed = true,
        time_source = 'maxed',
        time_edited_at = p_time_edited_at
    where heat_id = p_heat_id and elapsed_secs is null;

    update public.ct_heats set status = 'scoring' where id = p_heat_id and status = 'timing';
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'auto_max_heat');
end;
$$;
