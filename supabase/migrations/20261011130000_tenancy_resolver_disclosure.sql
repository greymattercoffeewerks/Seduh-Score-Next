-- Seduh Score Next · T-TEN.B6: close the org-id disclosure
--
-- Why now: the five resolvers app.org_id_for_event / _stage / _heat / _heat_entry / _btc_match
-- are SECURITY DEFINER lookups with no membership check, executable by every signed-in user.
-- Any authenticated account could ask "which org owns this event/stage/heat/match?" for ids
-- belonging to another org (T-TEN.A2 inventory §4.1), and delete_test_event answered a wrong
-- org id differently from the right org id for a non-member, which let a caller confirm an
-- event's org. With one org per account that was harmless; with accounts in several orgs and
-- many orgs on one database it is a cross-tenant oracle.
--
-- What changes:
--   1. Five NEW app.org_id_for_*_internal functions with the old, ungated bodies, executable by
--      NO API role (anon, authenticated and service_role all revoked). Only SECURITY DEFINER
--      trigger functions use them.
--   2. The five public resolvers keep their names and grants (row-level-security policies run as
--      the caller and need EXECUTE) but now answer NULL unless the caller is a member of the org
--      they resolve. A member sees exactly what they saw before; a non-member learns nothing.
--      Because every policy reads is_org_member(resolver(...)), a NULL resolves to "no access",
--      which is what a non-member already had.
--   3. THE NULL TRAP. A check written `new.org_id <> app.org_id_for_event(...)` is NULL (not
--      true) when the resolver answers NULL, so it silently PASSES. That would have switched off
--      the org-match triggers for any writer with no signed-in user (auth.uid() is NULL for
--      postgres, the SQL editor, migrations, seeds and SECURITY DEFINER code; the gated resolver
--      answers NULL there). check_live_session_org, check_public_results_org and
--      check_event_entry_person_org now use the _internal resolver (which never depends on who is
--      calling) and `is distinct from`. confirm_heat, the one RPC that still compared with `<>`,
--      now uses `is distinct from` like the other eighteen.
--   3b. THE TRIGGER ORACLE (security-reviewer, blocking). Those three triggers are BEFORE ROW
--      and SECURITY DEFINER, so they run before row-level security and used to answer a
--      non-member differently depending on whether the org they named owned the event (42501
--      when it did, a bespoke P0001 when it did not; for public_results, a test-event message
--      that also revealed is_test; for event_entries, whether a person and an event share an
--      org). When a caller (a signed-in user, or any session running as an API role even if its
--      token carries no user id) is not a member of the org involved, the trigger now
--      raises the standard row-level-security refusal (42501) FIRST, identical for every id.
--      A writer that is neither (postgres, seeds, migrations) keeps the strict org-match check. A member of the org is
--      unaffected.
--   4. A non-member who passes the TRUE org id and one who passes a wrong org id now get the
--      same refusal from delete_test_event, the publish RPCs, start_heat and the rest, because
--      the resolver gives both the same NULL. A NULL p_org_id would also match that NULL, so the
--      RPC guards are tightened in the NEXT migration (20261011140000), which must be applied
--      together with this one.
--
-- Known and accepted (recorded in ROADMAP): a policy scan over a large table now does one more
-- is_org_member lookup per row (measured 1.7x-2.7x on 4000 rows; plan shape unchanged); the
-- gated event resolver is ~15x slower in-database for an existing event than a missing one for a
-- non-member (microseconds; not usable over HTTP); a missing parent id now fails the org-match
-- triggers with P0001 where the foreign key used to report 23503; other BEFORE ROW validation
-- triggers (btc teams/judges/bonuses/bracket, person_merges.kept_id, ct_results.set_id) still
-- answer before RLS and are the same oracle class (pre-existing, not touched here).
--
-- Not in scope: the anonymous reads (B7/D6).
--
-- rollback: (restores the previous definitions, then drops the internal resolvers; every
-- statement below is the exact previous body)
--   CREATE OR REPLACE FUNCTION app.org_id_for_event(p_event_id uuid)
--    RETURNS uuid
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select org_id from public.events where id = p_event_id;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.org_id_for_stage(p_stage_id uuid)
--    RETURNS uuid
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select app.org_id_for_event(event_id) from public.ct_stages where id = p_stage_id;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.org_id_for_heat(p_heat_id uuid)
--    RETURNS uuid
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select app.org_id_for_stage(stage_id) from public.ct_heats where id = p_heat_id;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.org_id_for_heat_entry(p_heat_entry_id uuid)
--    RETURNS uuid
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select app.org_id_for_heat(heat_id) from public.ct_heat_entries where id = p_heat_entry_id;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.org_id_for_btc_match(p_match_id uuid)
--    RETURNS uuid
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select app.org_id_for_event(event_id) from public.btc_matches where id = p_match_id;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_live_session_org()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   begin
--     if new.org_id <> app.org_id_for_event(new.event_id) then
--       raise exception 'live_sessions.org_id must match the owning org of event_id';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_public_results_org()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   begin
--     if new.org_id <> app.org_id_for_event(new.event_id) then
--       raise exception 'public_results.org_id must match the owning org of event_id';
--     end if;
--     if (select is_test from public.events where id = new.event_id) then
--       raise exception 'public_results: refusing to publish a test event (%)', new.event_id
--         using errcode = 'P0001';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_event_entry_person_org()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   begin
--     if new.person_id is not null then
--       if (select org_id from public.people where id = new.person_id) <> app.org_id_for_event(new.event_id) then
--         raise exception 'event_entries.person_id must belong to the same org as event_id';
--       end if;
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.confirm_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_expected_updated_at timestamp with time zone, p_entries jsonb)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
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
--     -- Serialise with correct_heat_time / record_heat_time / auto_max_heat, which all
--     -- lock the heat row first. Without this the updated_at check below is a plain
--     -- read: a correction could commit between that check and the entry writes
--     -- further down, and this confirm would then rewrite the corrected time from
--     -- its (stale) payload. Taking the lock first also gives every writer the same
--     -- lock order (heat, then entries), which removes the deadlock the other order
--     -- allowed.
--     perform 1 from public.ct_heats where id = p_heat_id for update;
--
--     -- A retry of an operation that was still in flight when this call started
--     -- waited on the lock above; it must find the ledger row and stop, not run
--     -- into the updated_at conflict its own earlier success caused.
--     if exists (select 1 from public.processed_operations where id = p_operation_id) then
--       return;
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
--   $function$;
--   drop function if exists app.org_id_for_btc_match_internal(uuid);
--   drop function if exists app.org_id_for_heat_entry_internal(uuid);
--   drop function if exists app.org_id_for_heat_internal(uuid);
--   drop function if exists app.org_id_for_stage_internal(uuid);
--   drop function if exists app.org_id_for_event_internal(uuid);

-- ============ (1) internal resolvers: the old bodies, callable by no API role ============

create or replace function app.org_id_for_event_internal(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.events where id = p_event_id;
$$;

create or replace function app.org_id_for_stage_internal(p_stage_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_event_internal(event_id) from public.ct_stages where id = p_stage_id;
$$;

create or replace function app.org_id_for_heat_internal(p_heat_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_stage_internal(stage_id) from public.ct_heats where id = p_heat_id;
$$;

create or replace function app.org_id_for_heat_entry_internal(p_heat_entry_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_heat_internal(heat_id) from public.ct_heat_entries where id = p_heat_entry_id;
$$;

create or replace function app.org_id_for_btc_match_internal(p_match_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_event_internal(event_id) from public.btc_matches where id = p_match_id;
$$;

revoke all on function app.org_id_for_event_internal(uuid) from public, anon, authenticated, service_role;
revoke all on function app.org_id_for_stage_internal(uuid) from public, anon, authenticated, service_role;
revoke all on function app.org_id_for_heat_internal(uuid) from public, anon, authenticated, service_role;
revoke all on function app.org_id_for_heat_entry_internal(uuid) from public, anon, authenticated, service_role;
revoke all on function app.org_id_for_btc_match_internal(uuid) from public, anon, authenticated, service_role;

-- ============ (2) public resolvers: NULL unless the caller is a member of that org ============

create or replace function app.org_id_for_event(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.org_id
  from public.events e
  where e.id = p_event_id and app.is_org_member(e.org_id);
$$;

-- The chained ones stay thin: the event resolver at the bottom is the one that gates, so a
-- stage, heat, heat entry or match in someone else's org resolves to NULL the same way.
-- (Their bodies are unchanged.)

-- ============ (3) the NULL trap: triggers use the internal resolver and `is distinct from` ============

create or replace function app.check_live_session_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A signed-in non-member gets the standard RLS refusal before anything about the event or its
  -- org is compared (this trigger runs BEFORE row-level security and is SECURITY DEFINER, so
  -- without this it answered "does that org own this event?" for anyone). "A caller" means a
  -- signed-in user OR a session running as an API role (authenticated / anon) even if its token
  -- carries no resolvable user id; the session role is still `authenticated` inside this
  -- SECURITY DEFINER function. Only a writer with neither (postgres, seeds, migrations) skips the
  -- gate and is checked strictly below.
  if (auth.uid() is not null or current_setting('role', true) in ('authenticated', 'anon'))
     and not app.is_org_member(new.org_id) then
    raise exception 'new row violates row-level security policy for table "live_sessions"'
      using errcode = '42501';
  end if;
  if new.org_id is distinct from app.org_id_for_event_internal(new.event_id) then
    raise exception 'live_sessions.org_id must match the owning org of event_id';
  end if;
  return new;
end;
$$;

create or replace function app.check_public_results_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same gate as check_live_session_org: also stops the test-event message below from
  -- confirming to a non-member that an event exists, belongs to the org they named, and is a test.
  if (auth.uid() is not null or current_setting('role', true) in ('authenticated', 'anon'))
     and not app.is_org_member(new.org_id) then
    raise exception 'new row violates row-level security policy for table "public_results"'
      using errcode = '42501';
  end if;
  if new.org_id is distinct from app.org_id_for_event_internal(new.event_id) then
    raise exception 'public_results.org_id must match the owning org of event_id';
  end if;
  if (select is_test from public.events where id = new.event_id) then
    raise exception 'public_results: refusing to publish a test event (%)', new.event_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function app.check_event_entry_person_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Gate on the EVENT's org: a signed-in non-member of it gets the standard RLS refusal whatever
  -- person they name, so this cannot be used to ask "do this person and this event share an org?".
  if (auth.uid() is not null or current_setting('role', true) in ('authenticated', 'anon'))
     and not app.is_org_member(app.org_id_for_event_internal(new.event_id)) then
    raise exception 'new row violates row-level security policy for table "event_entries"'
      using errcode = '42501';
  end if;
  if new.person_id is not null then
    if (select org_id from public.people where id = new.person_id)
       is distinct from app.org_id_for_event_internal(new.event_id) then
      raise exception 'event_entries.person_id must belong to the same org as event_id';
    end if;
  end if;
  return new;
end;
$$;

-- ============ confirm_heat: the one RPC that compared with `<>` ============

CREATE OR REPLACE FUNCTION public.confirm_heat(p_operation_id uuid, p_org_id uuid, p_heat_id uuid, p_expected_updated_at timestamp with time zone, p_entries jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- `is distinct from`, not `<>`: since T-TEN.B6 org_id_for_heat answers NULL for a caller who is
  -- not a member of the heat's org, and `p_org_id <> NULL` is NULL (not true), which would have let
  -- a non-member straight past this check. With it, a non-member is refused exactly like a wrong org.
  if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
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
$function$;
