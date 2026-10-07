-- Seduh Score Next · serialise confirm_heat with time corrections, and keep a
-- correction from being silently overwritten
-- Handoff: SEDUH-NEXT-HANDOFF.md §7.1, §9.
--
-- Found reviewing correct_heat_time (20261006100000), and reproduced against two
-- real database sessions (scoring-auditor, 2026-10-06):
--
-- 1. confirm_heat took no lock on the heat. Its updated_at check is a plain read,
--    and it then rewrites every entry's time from the payload its screen loaded.
--    A correction that committed between the check and those writes was undone:
--    the heat ended 'confirmed' carrying the OLD tapped time, with no conflict
--    raised. That is the live-event case "the organiser corrects a time from the
--    manual timekeeper while the scorer taps Confirm on another device". The
--    updated_at bump in correct_heat_time only defends against a confirm that
--    CHECKS after the correction commits. Fix: confirm_heat now locks the heat
--    row first, like record_heat_time/auto_max_heat/correct_heat_time, so the two
--    run one after the other. (The opposite lock order also allowed a deadlock —
--    confirm held entry-row locks and wanted the heat row, the correction held
--    the heat row and wanted the entry rows — which is gone too.) It also
--    re-checks the ledger once it holds the lock, so a retry that waited behind
--    its own first delivery returns as a no-op instead of a conflict.
--
-- 2. record_heat_time's 'overwrite' policy allows replacing any time whose source
--    is 'manual'. A correction makes the source 'manual', so a stale manual entry
--    from a second device (the mid-heat manual fallback on an app-mode heat) could
--    replace the correction without a conflict, and leave its time_note beside a
--    time it no longer explained. Fix: 'overwrite' now also refuses a row that
--    has a time_note — i.e. one changed by correct_heat_time — with the same
--    P0002 'already has a recorded time' conflict. A manual entry that was never
--    corrected is unaffected. record_heat_time also re-checks the ledger once it
--    holds the heat lock (as confirm_heat does), so a retry that waited behind its
--    own first delivery is a no-op.
--
-- Only these two statements change in each function; both are create or replace,
-- so existing grants are preserved (signatures unchanged).
--
-- rollback: restore the previous definitions —
--
-- confirm_heat (as in 20260830130000):
--   create or replace function confirm_heat(
--     p_operation_id uuid,
--     p_org_id uuid,
--     p_heat_id uuid,
--     p_expected_updated_at timestamptz,
--     p_entries jsonb
--   )
--   returns void
--   language plpgsql
--   set search_path = ''
--   as $$
--   declare
--     v_current_updated_at timestamptz;
--     v_entry jsonb;
--     v_result jsonb;
--     v_entry_id uuid;
--     v_expected_set_count int;
--     v_incomplete_count int;
--   begin
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id <> app.org_id_for_heat(p_heat_id) then
--       raise exception 'confirm_heat: heat % does not belong to org %', p_heat_id, p_org_id;
--     end if;
--
--     select updated_at into v_current_updated_at from public.ct_heats where id = p_heat_id;
--     if v_current_updated_at is null then
--       raise exception 'confirm_heat: heat % not found', p_heat_id;
--     end if;
--
--     if v_current_updated_at <> p_expected_updated_at then
--       raise exception 'CONFLICT: heat % has been modified since it was read', p_heat_id
--         using detail = json_build_object(
--                 'heat_id', p_heat_id,
--                 'current_updated_at', v_current_updated_at,
--                 'expected_updated_at', p_expected_updated_at
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     for v_entry in select * from jsonb_array_elements(p_entries)
--     loop
--       v_entry_id := (v_entry->>'entry_id')::uuid;
--
--       update public.ct_heat_entries
--       set elapsed_secs = (v_entry->>'elapsed_secs')::int,
--           elapsed_secs_raw = (v_entry->>'elapsed_secs_raw')::int,
--           maxed = coalesce((v_entry->>'maxed')::boolean, false),
--           time_source = coalesce(v_entry->>'time_source', 'tapped')
--       where id = v_entry_id and heat_id = p_heat_id;
--
--       if not found then
--         raise exception 'confirm_heat: heat_entry % not found in heat %', v_entry_id, p_heat_id;
--       end if;
--
--       for v_result in select * from jsonb_array_elements(coalesce(v_entry->'results', '[]'::jsonb))
--       loop
--         insert into public.ct_results (heat_entry_id, set_id, correct)
--         values (v_entry_id, (v_result->>'set_id')::uuid, (v_result->>'correct')::boolean)
--         on conflict (heat_entry_id, set_id) do update set correct = excluded.correct;
--       end loop;
--     end loop;
--
--     select set_count into v_expected_set_count
--     from public.ct_stages
--     join public.ct_heats on ct_heats.stage_id = ct_stages.id
--     where ct_heats.id = p_heat_id;
--
--     select count(*) into v_incomplete_count
--     from public.ct_heat_entries he
--     where he.heat_id = p_heat_id
--       and (select count(*) from public.ct_results r where r.heat_entry_id = he.id) <> v_expected_set_count;
--
--     if v_incomplete_count > 0 then
--       raise exception 'confirm_heat: % cupper(s) do not have every set scored', v_incomplete_count;
--     end if;
--
--     update public.ct_heats set status = 'confirmed' where id = p_heat_id;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'confirm_heat');
--   end;
--   $$;
--
-- record_heat_time (as in 20260904120000):
--   create or replace function record_heat_time(
--     p_operation_id uuid,
--     p_org_id uuid,
--     p_heat_entry_id uuid,
--     p_expected_heat_status text,
--     p_elapsed_secs int,
--     p_elapsed_secs_raw int,
--     p_maxed boolean,
--     p_time_source text,
--     p_time_edited_at timestamptz,
--     p_conflict_policy text
--   )
--   returns void
--   language plpgsql
--   set search_path = ''
--   as $$
--   declare
--     v_heat_id uuid;
--     v_heat_status text;
--     v_already_set boolean;
--     v_current_time_source text;
--   begin
--     if p_conflict_policy not in ('reject', 'overwrite') then
--       raise exception 'record_heat_time: invalid p_conflict_policy %', p_conflict_policy;
--     end if;
--
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--
--     if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
--       raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;
--
--     if v_heat_id is null then
--       raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--
--     perform 1 from public.ct_heats where id = v_heat_id for update;
--
--     select h.status, (he.elapsed_secs is not null), he.time_source
--       into v_heat_status, v_already_set, v_current_time_source
--     from public.ct_heat_entries he
--     join public.ct_heats h on h.id = he.heat_id
--     where he.id = p_heat_entry_id;
--
--     if v_heat_status <> p_expected_heat_status then
--       raise exception 'CONFLICT: heat % is % now, expected %', v_heat_id, v_heat_status, p_expected_heat_status
--         using detail = json_build_object(
--                 'heat_id', v_heat_id,
--                 'current_status', v_heat_status,
--                 'expected_status', p_expected_heat_status
--               )::text,
--               errcode = 'P0002';
--     end if;
--
--     -- 'reject' refuses any already-set entry, unchanged. 'overwrite' now
--     -- refuses too, UNLESS the existing value is itself a prior manual entry
--     -- — the only case 'overwrite' was ever meant to cover. This is what
--     -- closes the tap-then-manual clobber above: a manual save arriving
--     -- after a real tap sees v_current_time_source = 'tapped' and is
--     -- refused, exactly like a genuine double-tap already was.
--     if v_already_set and (
--       p_conflict_policy = 'reject'
--       or (p_conflict_policy = 'overwrite' and v_current_time_source is distinct from 'manual')
--     ) then
--       raise exception 'CONFLICT: heat entry % already has a recorded time', p_heat_entry_id
--         using errcode = 'P0002';
--     end if;
--
--     update public.ct_heat_entries
--     set elapsed_secs = p_elapsed_secs,
--         elapsed_secs_raw = p_elapsed_secs_raw,
--         maxed = p_maxed,
--         time_source = p_time_source,
--         time_edited_at = p_time_edited_at
--     where id = p_heat_entry_id;
--
--     if not exists (
--       select 1 from public.ct_heat_entries where heat_id = v_heat_id and elapsed_secs is null
--     ) then
--       update public.ct_heats set status = 'scoring' where id = v_heat_id and status in ('pending', 'timing');
--     end if;
--
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'record_heat_time');
--   end;
--   $$;

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

  -- Serialise with correct_heat_time / record_heat_time / auto_max_heat, which all
  -- lock the heat row first. Without this the updated_at check below is a plain
  -- read: a correction could commit between that check and the entry writes
  -- further down, and this confirm would then rewrite the corrected time from
  -- its (stale) payload. Taking the lock first also gives every writer the same
  -- lock order (heat, then entries), which removes the deadlock the other order
  -- allowed.
  perform 1 from public.ct_heats where id = p_heat_id for update;

  -- A retry of an operation that was still in flight when this call started
  -- waited on the lock above; it must find the ledger row and stop, not run
  -- into the updated_at conflict its own earlier success caused.
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
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
  v_current_time_source text;
  v_current_time_note text;
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

  -- A retry of an operation that was still in flight when this call started waited on
  -- the lock above; it must find the ledger row and stop, not re-apply (an 'overwrite'
  -- would rewrite the row and then fail on the ledger's primary key; a 'reject' would
  -- report a conflict its own earlier success caused).
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  select h.status, (he.elapsed_secs is not null), he.time_source, he.time_note
    into v_heat_status, v_already_set, v_current_time_source, v_current_time_note
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

  -- 'reject' refuses any already-set entry, unchanged. 'overwrite' now
  -- refuses too, UNLESS the existing value is itself a prior manual entry
  -- — the only case 'overwrite' was ever meant to cover. This is what
  -- closes the tap-then-manual clobber above: a manual save arriving
  -- after a real tap sees v_current_time_source = 'tapped' and is
  -- refused, exactly like a genuine double-tap already was.
  if v_already_set and (
    p_conflict_policy = 'reject'
    or (p_conflict_policy = 'overwrite' and v_current_time_source is distinct from 'manual')
    -- A time with a note was changed by correct_heat_time (20261006100000), which
    -- sets time_source = 'manual' and records why. Only another correction may
    -- change it: otherwise a stale manual entry from a second device would
    -- silently replace the correction, leaving its reason on a time it no longer
    -- explains.
    or (p_conflict_policy = 'overwrite' and v_current_time_note is not null)
  ) then
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
