-- Seduh Score Next · T-BTC.1 BTC RLS
-- Policies on every btc_* table, following T1.3's chokepoint pattern
-- (app.is_org_member + one org_id resolver per FK-chain hop).
-- Plan: BTC Next Migration — Plan of Action §5/§9.
--
-- rollback:
--   drop policy if exists btc_bracket_slots_write on btc_bracket_slots;
--   drop policy if exists btc_bracket_slots_read on btc_bracket_slots;
--   drop policy if exists btc_match_bonuses_write on btc_match_bonuses;
--   drop policy if exists btc_match_bonuses_read on btc_match_bonuses;
--   drop policy if exists btc_cup_votes_write on btc_cup_votes;
--   drop policy if exists btc_cup_votes_read on btc_cup_votes;
--   drop policy if exists btc_match_judges_write on btc_match_judges;
--   drop policy if exists btc_match_judges_read on btc_match_judges;
--   drop policy if exists btc_matches_write on btc_matches;
--   drop policy if exists btc_matches_read on btc_matches;
--   drop policy if exists btc_judges_write on btc_judges;
--   drop policy if exists btc_judges_read on btc_judges;
--   drop policy if exists btc_teams_write on btc_teams;
--   drop policy if exists btc_teams_read on btc_teams;
--   drop function if exists app.org_id_for_btc_match(uuid);

-- ============ org_id resolver ============
-- btc_teams/btc_judges/btc_matches/btc_bracket_slots carry event_id directly,
-- so they reuse app.org_id_for_event (T1.1) unedited. Only the tables that
-- hang off match_id instead need a new hop.
create or replace function app.org_id_for_btc_match(p_match_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_event(event_id) from public.btc_matches where id = p_match_id;
$$;

-- ============ org-scoped read + write ============

create policy btc_teams_read on btc_teams
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_teams_write on btc_teams
  for all
  using (app.is_org_member(app.org_id_for_event(event_id)))
  with check (app.is_org_member(app.org_id_for_event(event_id)));

create policy btc_judges_read on btc_judges
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_judges_write on btc_judges
  for all
  using (app.is_org_member(app.org_id_for_event(event_id)))
  with check (app.is_org_member(app.org_id_for_event(event_id)));

create policy btc_matches_read on btc_matches
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_matches_write on btc_matches
  for all
  using (app.is_org_member(app.org_id_for_event(event_id)))
  with check (app.is_org_member(app.org_id_for_event(event_id)));

create policy btc_match_judges_read on btc_match_judges
  for select
  using (app.is_org_member(app.org_id_for_btc_match(match_id)));
create policy btc_match_judges_write on btc_match_judges
  for all
  using (app.is_org_member(app.org_id_for_btc_match(match_id)))
  with check (app.is_org_member(app.org_id_for_btc_match(match_id)));

create policy btc_cup_votes_read on btc_cup_votes
  for select
  using (app.is_org_member(app.org_id_for_btc_match(match_id)));
create policy btc_cup_votes_write on btc_cup_votes
  for all
  using (app.is_org_member(app.org_id_for_btc_match(match_id)))
  with check (app.is_org_member(app.org_id_for_btc_match(match_id)));

create policy btc_match_bonuses_read on btc_match_bonuses
  for select
  using (app.is_org_member(app.org_id_for_btc_match(match_id)));
create policy btc_match_bonuses_write on btc_match_bonuses
  for all
  using (app.is_org_member(app.org_id_for_btc_match(match_id)))
  with check (app.is_org_member(app.org_id_for_btc_match(match_id)));

create policy btc_bracket_slots_read on btc_bracket_slots
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_bracket_slots_write on btc_bracket_slots
  for all
  using (app.is_org_member(app.org_id_for_event(event_id)))
  with check (app.is_org_member(app.org_id_for_event(event_id)));
