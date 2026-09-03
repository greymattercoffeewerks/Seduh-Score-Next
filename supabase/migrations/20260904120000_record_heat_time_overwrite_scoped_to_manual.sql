-- Seduh Score Next · record_heat_time: scope 'overwrite' to a prior manual
-- entry only, not any already-recorded time
-- Handoff: SEDUH-NEXT-HANDOFF.md §7.1 ("a heat may mix tapped and hand-
-- entered times if a stopwatch fails mid-heat"), §6 (clampElapsed is the
-- sole elapsed_secs writer).
--
-- rollback:
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
--   begin
--     if p_conflict_policy not in ('reject', 'overwrite') then
--       raise exception 'record_heat_time: invalid p_conflict_policy %', p_conflict_policy;
--     end if;
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
--     end if;
--     if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
--       raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--     select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;
--     if v_heat_id is null then
--       raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
--     end if;
--     perform 1 from public.ct_heats where id = v_heat_id for update;
--     select h.status, (he.elapsed_secs is not null)
--       into v_heat_status, v_already_set
--     from public.ct_heat_entries he
--     join public.ct_heats h on h.id = he.heat_id
--     where he.id = p_heat_entry_id;
--     if v_heat_status <> p_expected_heat_status then
--       raise exception 'CONFLICT: heat % is % now, expected %', v_heat_id, v_heat_status, p_expected_heat_status
--         using detail = json_build_object(
--                 'heat_id', v_heat_id,
--                 'current_status', v_heat_status,
--                 'expected_status', p_expected_heat_status
--               )::text,
--               errcode = 'P0002';
--     end if;
--     if p_conflict_policy = 'reject' and v_already_set then
--       raise exception 'CONFLICT: heat entry % already has a recorded time', p_heat_entry_id
--         using errcode = 'P0002';
--     end if;
--     update public.ct_heat_entries
--     set elapsed_secs = p_elapsed_secs,
--         elapsed_secs_raw = p_elapsed_secs_raw,
--         maxed = p_maxed,
--         time_source = p_time_source,
--         time_edited_at = p_time_edited_at
--     where id = p_heat_entry_id;
--     if not exists (
--       select 1 from public.ct_heat_entries where heat_id = v_heat_id and elapsed_secs is null
--     ) then
--       update public.ct_heats set status = 'scoring' where id = v_heat_id and status in ('pending', 'timing');
--     end if;
--     insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'record_heat_time');
--   end;
--   $$;

-- `scoring-auditor` found a real, live data-corruption path in the
-- app-mode timing screen's new mid-heat manual-entry fallback
-- (formats/cup-taster/timingScreen.js, 2026-09-04): 'overwrite' was
-- designed for exactly one caller — timingManualScreen.js's own judge-
-- fixing-a-typo workflow, where NOTHING else can ever write that row, so
-- "already set" always means "my own earlier manual entry." That
-- assumption broke the moment 'overwrite' became reachable from an
-- app-mode heat too: a real tap and a manual guess for the SAME cupper can
-- both get queued offline (this app's own outbox model) and flush in
-- either order. Tap-then-manual is the dangerous order — the manual
-- write's 'overwrite' policy clobbers the accurate, already-committed
-- tapped time with a hand-typed guess, raises no conflict, and the
-- client's own ground-truth check (comparing the fresh reload against the
-- exact value it wrote) reports success, since the overwrite genuinely
-- did "succeed." Manual-then-tap is already safe today (the tap's
-- 'reject' policy correctly refuses to clobber an already-set entry
-- regardless of its time_source), so only this one direction needed
-- closing.
--
-- Fix: 'overwrite' now only succeeds when the entry is either not yet set
-- OR its CURRENT time_source is already 'manual' — i.e., a judge
-- correcting their own earlier hand-typed number still works exactly as
-- before, but overwriting a 'tapped' (or 'maxed') entry via this path now
-- raises the SAME conflict shape 'reject' already used ('CONFLICT: heat
-- entry % already has a recorded time', errcode P0002) — reusing that
-- exact message means timing.js's own describeTimingConflict() already
-- classifies it correctly ("This cupper's time was already recorded —
-- refresh this page to see the current value.") with zero client-side
-- code changes needed.
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

  select h.status, (he.elapsed_secs is not null), he.time_source
    into v_heat_status, v_already_set, v_current_time_source
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

-- create or replace preserves the function's existing grants (PUBLIC
-- revoked, authenticated + service_role granted, migration 20260830140000)
-- as long as the signature is unchanged, which it is here — no grant/
-- revoke statements needed in this migration.
