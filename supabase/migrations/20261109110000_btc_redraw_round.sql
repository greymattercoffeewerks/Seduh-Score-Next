-- Seduh Score Next · Build B, part 3: redraw a preliminary round
-- (docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md section 4.2; follows 20261109100000_btc_round_draws.sql)
--
-- Why: a round's draw record outlives its matches (removing a match deletes only the match), and create_btc_round refuses a
-- round that has a draw row, so a round whose matches were removed could never be drawn again from the app. The draw
-- panel said so and asked for owner SQL. This is the one door that clears a round properly: its matches AND its draw
-- record, in one transaction, and only while nothing has been scored.
--
-- redraw_btc_round(p_org_id, p_event_id, p_prelim_round) returns int (the number of matches removed)
--   1. a non-member, or an organisation that does not own the event, gets the standard not-found (the same shape as
--      create_btc_round), then the per-event advisory lock (the key create_btc_round and the bracket functions take);
--      a bracket that exists refuses (btc_round_bracket_exists): the preliminary rounds are closed.
--   2. the round must have something to clear: matches (an unnumbered preliminary match counts as round 1) or a draw
--      row, else btc_redraw_nothing.
--   3. no LATER round may exist (matches or a draw row): redrawing round 1 under a drawn round 2 would leave round 2
--      paired against opponents that no longer exist, so the later round is redrawn first (btc_redraw_later_round).
--   4. nothing in the round may be scored (btc_redraw_scored): every match must be 'pending', with no cup votes, no
--      bonus row and no finish time entered. Scored matches are real data; they are never deleted here.
--   5. delete the round's matches (their judges, votes and bonuses cascade) and its draw row.
-- SECURITY INVOKER, search_path pinned empty, like create_btc_round: every delete goes through the caller's own RLS
-- (btc_matches_write covers DELETE; btc_round_draws allows member delete). Refusals carry a machine-readable hint.
-- Score log: btc_matches is a logged table, so on a real event each removed match writes its change-log row (test
-- events are not logged, D9).
--
-- rollback:
--   drop function if exists public.redraw_btc_round(uuid, uuid, smallint);

create or replace function public.redraw_btc_round(
  p_org_id       uuid,
  p_event_id     uuid,
  p_prelim_round smallint
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removed int;
begin
  -- 1. same not-found shape as create_btc_round
  if p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'redraw_btc_round: event not found' using hint = 'btc_round_event_not_found';
  end if;
  if p_prelim_round is null or p_prelim_round < 1 then
    raise exception 'redraw_btc_round: the round number must be 1 or more' using hint = 'btc_round_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'redraw_btc_round: the bracket already exists, so the preliminary rounds are closed'
      using hint = 'btc_round_bracket_exists';
  end if;

  -- 2. something to clear
  if not exists (
       select 1 from public.btc_matches
        where event_id = p_event_id and round = 'preliminary' and coalesce(prelim_round, 1) = p_prelim_round
     )
     and not exists (
       select 1 from public.btc_round_draws where event_id = p_event_id and prelim_round = p_prelim_round
     ) then
    raise exception 'redraw_btc_round: round % has not been drawn', p_prelim_round using hint = 'btc_redraw_nothing';
  end if;

  -- 3. a later round pairs teams on this round's results: it is redrawn first
  if exists (
       select 1 from public.btc_matches
        where event_id = p_event_id and round = 'preliminary' and coalesce(prelim_round, 1) > p_prelim_round
     )
     or exists (
       select 1 from public.btc_round_draws where event_id = p_event_id and prelim_round > p_prelim_round
     ) then
    raise exception 'redraw_btc_round: a later round has been drawn, redraw that one first'
      using hint = 'btc_redraw_later_round';
  end if;

  -- 4. nothing scored: status, cup votes, bonuses and finish times all untouched
  if exists (
       select 1
         from public.btc_matches m
        where m.event_id = p_event_id and m.round = 'preliminary' and coalesce(m.prelim_round, 1) = p_prelim_round
          and (   m.status <> 'pending'
               or nullif(btrim(coalesce(m.team1_time_note, '')), '') is not null
               or nullif(btrim(coalesce(m.team2_time_note, '')), '') is not null
               or exists (select 1 from public.btc_cup_votes v where v.match_id = m.id)
               or exists (select 1 from public.btc_match_bonuses b where b.match_id = m.id))
     ) then
    raise exception 'redraw_btc_round: a match of round % has been scored, so it cannot be redrawn', p_prelim_round
      using hint = 'btc_redraw_scored';
  end if;

  -- 5. clear it
  delete from public.btc_matches
   where event_id = p_event_id and round = 'preliminary' and coalesce(prelim_round, 1) = p_prelim_round;
  get diagnostics v_removed = row_count;
  delete from public.btc_round_draws where event_id = p_event_id and prelim_round = p_prelim_round;

  return v_removed;
end;
$$;

revoke execute on function public.redraw_btc_round(uuid, uuid, smallint) from public, anon;
grant execute on function public.redraw_btc_round(uuid, uuid, smallint) to authenticated;
grant execute on function public.redraw_btc_round(uuid, uuid, smallint) to service_role;
