-- Seduh Score Next · T-TEN.E3 follow-up: the membership gate on the remaining cross-reference triggers
--
-- Why: T-TEN.B6 (3b) put an early membership gate on the three org-match triggers (live_sessions,
-- public_results, event_entries): a BEFORE ROW SECURITY DEFINER trigger runs BEFORE row-level security,
-- so without a gate it answers a non-member differently depending on whether the ids they guessed fit
-- together (a bespoke P0001 when they do not, the standard 42501 refusal when they do). That is a yes/no
-- oracle about one id relationship. The security review of T-TEN.E3 found six more triggers of the same
-- class that B6 recorded as "pre-existing, not touched":
--   person_merges     (check_person_merge_kept_org)   btc_matches        (check_btc_match_teams_event)
--   btc_match_judges  (check_btc_match_judge_event)   btc_bracket_slots   (check_btc_bracket_slot_event)
--   btc_match_bonuses (check_btc_match_bonus_teams)   ct_results          (check_ct_results_set_stage)
-- (check_ct_stage_entry_event and check_ct_heat_entry_event already refuse every mismatch with 42501, the
-- same answer row-level security gives, so they carry no oracle.)
--
-- What changes: each of the six first refuses a caller who is not a member of the org the row belongs to
-- with the standard row-level-security refusal (42501), whatever ids they named. "A caller" is a signed-in
-- user OR a session running as an API role (authenticated / anon) even if its token carries no user id;
-- a writer with neither (postgres, seeds, migrations, the service role's own SECURITY DEFINER code) skips
-- the gate and is checked strictly, as in B6. A member of the org is unaffected. The org is read with the
-- _internal resolvers (they never depend on who is calling). One shared helper, app.refuse_non_member,
-- holds the gate so the six triggers cannot drift apart; it is executable by no API role.
-- Also `is distinct from` in place of `<>` in the two triggers that still used `<>` (a missing parent
-- resolves to NULL, and `NULL <> x` is NULL, which would pass): a missing parent now fails these two with
-- the trigger's own P0001 where the foreign key used to report 23503 (the same trade B6 accepted).
--
-- rollback: (restores the previous bodies, then drops the helper)
--   CREATE OR REPLACE FUNCTION app.check_person_merge_kept_org() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   begin
--     if (select org_id from public.people where id = new.kept_id) <> new.org_id then
--       raise exception 'person_merges.kept_id must belong to the same org as org_id';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_ct_results_set_stage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   begin
--     if (select stage_id from public.ct_sets where id = new.set_id)
--        <> (select h.stage_id from public.ct_heat_entries he join public.ct_heats h on h.id = he.heat_id where he.id = new.heat_entry_id)
--     then
--       raise exception 'ct_results.set_id must belong to the same stage as heat_entry_id''s heat';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_btc_match_teams_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   begin
--     if new.team1_id = new.team2_id then
--       return new;
--     end if;
--     if (select count(*) from public.btc_teams t where t.id in (new.team1_id, new.team2_id) and t.event_id = new.event_id) <> 2 then
--       raise exception 'btc_matches: both teams must belong to the match''s event';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_btc_match_judge_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   begin
--     if not exists (select 1 from public.btc_matches m join public.btc_judges j on j.event_id = m.event_id where m.id = new.match_id and j.id = new.judge_id) then
--       raise exception 'btc_match_judges: the judge must belong to the match''s event';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_btc_match_bonus_teams() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   declare
--     v_team1 uuid;
--     v_team2 uuid;
--   begin
--     select team1_id, team2_id into v_team1, v_team2 from public.btc_matches where id = new.match_id;
--     if new.fastest_team_id is not null and new.fastest_team_id not in (v_team1, v_team2) then
--       raise exception 'btc_match_bonuses.fastest_team_id must be a participant of the match';
--     end if;
--     return new;
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.check_btc_bracket_slot_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
--   begin
--     if new.team1_id is not null and not exists (select 1 from public.btc_teams where id = new.team1_id and event_id = new.event_id) then
--       raise exception 'btc_bracket_slots: team1 must belong to the slot''s event';
--     end if;
--     if new.team2_id is not null and not exists (select 1 from public.btc_teams where id = new.team2_id and event_id = new.event_id) then
--       raise exception 'btc_bracket_slots: team2 must belong to the slot''s event';
--     end if;
--     if new.match_id is not null and not exists (select 1 from public.btc_matches where id = new.match_id and event_id = new.event_id) then
--       raise exception 'btc_bracket_slots: the resolved match must belong to the slot''s event';
--     end if;
--     if new.feeder_slot_1 is not null and not exists (select 1 from public.btc_bracket_slots where id = new.feeder_slot_1 and event_id = new.event_id) then
--       raise exception 'btc_bracket_slots: feeder slot 1 must belong to the slot''s event';
--     end if;
--     if new.feeder_slot_2 is not null and not exists (select 1 from public.btc_bracket_slots where id = new.feeder_slot_2 and event_id = new.event_id) then
--       raise exception 'btc_bracket_slots: feeder slot 2 must belong to the slot''s event';
--     end if;
--     return new;
--   end;
--   $function$;
--   drop function if exists app.refuse_non_member(uuid, text);

-- ============ the shared gate: executable by no API role ============

create or replace function app.refuse_non_member(p_org_id uuid, p_table text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- A NULL org (the ids name nothing) is a non-member too: is_org_member(NULL) is false, so the caller
  -- gets the same refusal as for an org that is not theirs.
  if (auth.uid() is not null or current_setting('role', true) in ('authenticated', 'anon'))
     and not app.is_org_member(p_org_id) then
    raise exception 'new row violates row-level security policy for table "%"', p_table
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app.refuse_non_member(uuid, text) from public, anon, authenticated, service_role;

-- ============ the six triggers: gate first, then the checks they always did ============

create or replace function app.check_person_merge_kept_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(new.org_id, 'person_merges');
  if (select org_id from public.people where id = new.kept_id) is distinct from new.org_id then
    raise exception 'person_merges.kept_id must belong to the same org as org_id';
  end if;
  return new;
end;
$$;

create or replace function app.check_ct_results_set_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(app.org_id_for_heat_entry_internal(new.heat_entry_id), 'ct_results');
  if (select stage_id from public.ct_sets where id = new.set_id)
     is distinct from (
       select h.stage_id
       from public.ct_heat_entries he
       join public.ct_heats h on h.id = he.heat_id
       where he.id = new.heat_entry_id
     )
  then
    raise exception 'ct_results.set_id must belong to the same stage as heat_entry_id''s heat';
  end if;
  return new;
end;
$$;

create or replace function app.check_btc_match_teams_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'btc_matches');
  -- A team playing itself is btc_matches_distinct_teams' job (a CHECK, which reports
  -- the more specific error); BEFORE triggers run first, so step aside and let it.
  if new.team1_id = new.team2_id then
    return new;
  end if;
  -- Otherwise both (distinct) teams must resolve inside this match's own event.
  if (
    select count(*) from public.btc_teams t
    where t.id in (new.team1_id, new.team2_id) and t.event_id = new.event_id
  ) <> 2 then
    raise exception 'btc_matches: both teams must belong to the match''s event';
  end if;
  return new;
end;
$$;

create or replace function app.check_btc_match_judge_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(app.org_id_for_btc_match_internal(new.match_id), 'btc_match_judges');
  if not exists (
    select 1
    from public.btc_matches m
    join public.btc_judges j on j.event_id = m.event_id
    where m.id = new.match_id and j.id = new.judge_id
  ) then
    raise exception 'btc_match_judges: the judge must belong to the match''s event';
  end if;
  return new;
end;
$$;

create or replace function app.check_btc_match_bonus_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team1 uuid;
  v_team2 uuid;
begin
  perform app.refuse_non_member(app.org_id_for_btc_match_internal(new.match_id), 'btc_match_bonuses');
  select team1_id, team2_id into v_team1, v_team2
  from public.btc_matches where id = new.match_id;

  if new.fastest_team_id is not null
     and new.fastest_team_id not in (v_team1, v_team2) then
    raise exception 'btc_match_bonuses.fastest_team_id must be a participant of the match';
  end if;

  return new;
end;
$$;

create or replace function app.check_btc_bracket_slot_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'btc_bracket_slots');
  if new.team1_id is not null
     and not exists (select 1 from public.btc_teams where id = new.team1_id and event_id = new.event_id) then
    raise exception 'btc_bracket_slots: team1 must belong to the slot''s event';
  end if;
  if new.team2_id is not null
     and not exists (select 1 from public.btc_teams where id = new.team2_id and event_id = new.event_id) then
    raise exception 'btc_bracket_slots: team2 must belong to the slot''s event';
  end if;
  if new.match_id is not null
     and not exists (select 1 from public.btc_matches where id = new.match_id and event_id = new.event_id) then
    raise exception 'btc_bracket_slots: the resolved match must belong to the slot''s event';
  end if;
  if new.feeder_slot_1 is not null
     and not exists (select 1 from public.btc_bracket_slots where id = new.feeder_slot_1 and event_id = new.event_id) then
    raise exception 'btc_bracket_slots: feeder slot 1 must belong to the slot''s event';
  end if;
  if new.feeder_slot_2 is not null
     and not exists (select 1 from public.btc_bracket_slots where id = new.feeder_slot_2 and event_id = new.event_id) then
    raise exception 'btc_bracket_slots: feeder slot 2 must belong to the slot''s event';
  end if;
  return new;
end;
$$;
