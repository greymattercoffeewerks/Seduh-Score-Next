-- Seduh Score Next · T-BTC.2 scoring, part 3: cross-event integrity for BTC rows
--
-- Found by security-reviewer's live probes while reviewing the scoring RPC: RLS on
-- btc_matches, btc_match_judges and btc_bracket_slots checks only the ROW's own event,
-- and nothing tied the teams, judges or matches a row REFERENCES back to that same
-- event. A member of org A could therefore insert a match in A's event whose teams
-- belong to org B, or assign one of B's judges to A's match. Row-level security did not
-- stop it (foreign-key existence checks bypass RLS), it leaked a UUID-existence oracle,
-- and it let A hold ON DELETE RESTRICT references against B's rows. create_btc_match
-- already validated this in its own body; these triggers make the database itself
-- enforce it for EVERY writer, the same class of gap closed before for
-- live_sessions.org_id/event_id (T1.3) and ct_results.set_id/heat_entry_id (T3.2).
--
-- rollback:
--   drop trigger if exists trg_btc_judges_event_immutable on btc_judges;
--   drop trigger if exists trg_btc_teams_event_immutable on btc_teams;
--   drop function if exists app.forbid_btc_event_change();
--   drop trigger if exists trg_btc_bracket_slots_check_event on btc_bracket_slots;
--   drop trigger if exists trg_btc_match_judges_check_event on btc_match_judges;
--   drop trigger if exists trg_btc_matches_check_teams_event on btc_matches;
--   drop function if exists app.check_btc_bracket_slot_event();
--   drop function if exists app.check_btc_match_judge_event();
--   drop function if exists app.check_btc_match_teams_event();

create or replace function app.check_btc_match_teams_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger trg_btc_matches_check_teams_event
  before insert or update of event_id, team1_id, team2_id on btc_matches
  for each row execute function app.check_btc_match_teams_event();

create or replace function app.check_btc_match_judge_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger trg_btc_match_judges_check_event
  before insert or update of match_id, judge_id on btc_match_judges
  for each row execute function app.check_btc_match_judge_event();

-- A bracket slot's teams, its resolved match and its two feeder slots must sit in the
-- slot's own event.
create or replace function app.check_btc_bracket_slot_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger trg_btc_bracket_slots_check_event
  before insert or update of event_id, team1_id, team2_id, match_id, feeder_slot_1, feeder_slot_2 on btc_bracket_slots
  for each row execute function app.check_btc_bracket_slot_event();

-- The triggers above guard the REFERENCING side. Moving a team or judge to another event
-- afterwards would silently break what they enforce, and nothing legitimate ever moves
-- one (a roster row belongs to the event it was created for), so it is simply refused.
create or replace function app.forbid_btc_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_id is distinct from old.event_id then
    raise exception '%: a row cannot be moved to another event', tg_table_name;
  end if;
  return new;
end;
$$;

create trigger trg_btc_teams_event_immutable
  before update of event_id on btc_teams
  for each row execute function app.forbid_btc_event_change();

create trigger trg_btc_judges_event_immutable
  before update of event_id on btc_judges
  for each row execute function app.forbid_btc_event_change();

-- Trigger functions are never called directly and firing a trigger does not check
-- EXECUTE, so nothing should hold it (an environment default may grant PUBLIC/anon).
revoke execute on function app.check_btc_match_teams_event() from public, anon;
revoke execute on function app.check_btc_match_judge_event() from public, anon;
revoke execute on function app.check_btc_bracket_slot_event() from public, anon;
revoke execute on function app.forbid_btc_event_change() from public, anon;
