-- Seduh Score Next · T-BTC bracket correctness: re-confirming a knockout match as a TIE
-- no longer leaves its old winner sitting in the next round
--
-- CREATE OR REPLACE on the same signature as 20260922132000 (never edited itself, per repo
-- rule; this is the forward-only fix).
--
-- The bug: 20260922132000 advanced a team only when the match's bonus-inclusive totals
-- differed, and did nothing at all when they tied. That is right for a FIRST confirm that
-- ties (the downstream slots are already empty), but wrong for a RE-confirm: an organiser
-- who corrects a recorded win into a tie left the previous winner (and, for a semifinal,
-- the previous loser in third place) silently in the next round's slot, so the bracket
-- kept showing a winner the scores no longer support.
--
-- The fix: the downstream loop now always runs. On a tie the target for every downstream
-- slot is NULL ("nobody advances"), through the very same per-row guard and write the
-- decisive case already used:
--   * downstream slot's match does not exist yet  -> the position is cleared to NULL;
--   * downstream slot's match already exists and its position holds a team -> the whole
--     confirm is refused (that match already has judges and scores keyed to the team;
--     silently emptying the seat would corrupt it), with a message that says the result
--     is now a tie;
--   * position already NULL -> nothing to change (a first-confirm tie, a repeat tie): the
--     UPDATE is skipped, so no row is touched and no updated_at is bumped.
-- A semifinal tie therefore empties BOTH of its downstream seats (final and third place).
-- A missing score row is refused outright rather than read as a tie: now that a tie is
-- destructive, "no data" must never look like one.
-- Everything above the advancement block is identical to the previous body (diffed).
--
-- rollback:
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from service_role;
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from authenticated;
--   then restore the function body verbatim from 20260922132000_btc_confirm_match_bracket_advancement.sql
--   (CREATE OR REPLACE onto the same signature — do not drop it), followed by the same
--   revoke-from-public / grant-to-authenticated-and-service_role set that migration used.
--   (Run and verified in a transaction against the local database: the restored function
--   body and its ACL matched the previous version's exactly.)

create or replace function confirm_btc_match(
  p_operation_id uuid,
  p_org_id uuid,
  p_match_id uuid,
  p_expected_updated_at timestamptz,
  p_votes jsonb,
  p_fastest_team_id uuid,
  p_team1_signature boolean,
  p_team2_signature boolean,
  p_team1_time_note text,
  p_team2_time_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round text;
  v_updated_at timestamptz;
  v_cups int;
  v_judge_count int;
  v_vote_count int;
  v_slot public.btc_bracket_slots;
  v_team1_total int;
  v_team2_total int;
  v_winner_id uuid;
  v_loser_id uuid;
  v_target uuid;
  v_downstream public.btc_bracket_slots;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
    raise exception 'confirm_btc_match: match not found';
  end if;

  select round, updated_at into v_round, v_updated_at
  from public.btc_matches where id = p_match_id
  for update;

  if v_round is null then
    raise exception 'confirm_btc_match: match not found';
  end if;

  -- Re-check the ledger now that the row is locked (see 20260922091000's own comment
  -- on this exact re-check for why it must happen after the lock, not just before it).
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'CONFLICT: match % has been modified since it was read', p_match_id
      using detail = json_build_object(
              'match_id', p_match_id,
              'current_updated_at', v_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  if v_round = 'preliminary' and (p_team1_signature or p_team2_signature) then
    raise exception 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round';
  end if;

  v_cups := app.btc_cups_for_round(v_round);

  -- Judges are on record for transparency, not tied to individual votes — but the
  -- match must still carry exactly 3 of them before it can be confirmed.
  select count(*) into v_judge_count
  from public.btc_match_judges where match_id = p_match_id;
  if v_judge_count <> 3 then
    raise exception 'confirm_btc_match: match must have exactly 3 judges (has %)', v_judge_count;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where (v->>'cup_number')::int < 1 or (v->>'cup_number')::int > v_cups
  ) then
    raise exception 'confirm_btc_match: cup numbers must be between 1 and % for a % match', v_cups, v_round;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where (v->>'team1_tokens')::int < 0 or (v->>'team1_tokens')::int > 3
  ) then
    raise exception 'confirm_btc_match: each cup''s tokens must be between 0 and 3';
  end if;

  delete from public.btc_cup_votes where match_id = p_match_id;

  insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
  select p_match_id,
         (v->>'cup_number')::smallint,
         (v->>'team1_tokens')::smallint
  from jsonb_array_elements(p_votes) v;

  -- Strict confirm, same shape as before: the unique (match_id, cup_number) constraint
  -- plus the cup-range check above make "count = cups" equivalent to "every cup 1..cups
  -- scored exactly once", so a short payload fails with the friendly message, not a
  -- raw constraint error.
  select count(*) into v_vote_count from public.btc_cup_votes where match_id = p_match_id;
  if v_vote_count <> v_cups then
    raise exception 'confirm_btc_match: % of % cups are missing a score', v_cups - v_vote_count, v_cups;
  end if;

  insert into public.btc_match_bonuses
    (match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage)
  values
    (p_match_id, p_fastest_team_id, coalesce(p_team1_signature, false), coalesce(p_team2_signature, false))
  on conflict (match_id) do update
    set fastest_team_id = excluded.fastest_team_id,
        team1_signature_beverage = excluded.team1_signature_beverage,
        team2_signature_beverage = excluded.team2_signature_beverage;

  update public.btc_matches
  set status = 'confirmed',
      team1_time_note = nullif(btrim(p_team1_time_note), ''),
      team2_time_note = nullif(btrim(p_team2_time_note), '')
  where id = p_match_id;

  insert into public.processed_operations (id, org_id, kind)
  values (p_operation_id, p_org_id, 'confirm_btc_match');

  -- Bracket advancement. A no-op for a preliminary (or any non-bracket) match: no slot
  -- references it, so v_slot.id stays null.
  select * into v_slot from public.btc_bracket_slots where match_id = p_match_id;
  if v_slot.id is not null then
    select team1_total, team2_total into v_team1_total, v_team2_total
    from public.btc_match_scores where match_id = p_match_id;

    -- Unreachable today (btc_match_scores left-joins and coalesces, so every match has a
    -- row), but a tie clears seats, so the absence of a row must not be mistaken for one.
    if v_team1_total is null or v_team2_total is null then
      raise exception 'confirm_btc_match: no score found for match %', p_match_id;
    end if;

    -- A tie names no winner and no loser: both stay NULL, which the loop below turns
    -- into "clear (or leave empty) every seat this match feeds".
    if v_team1_total <> v_team2_total then
      v_winner_id := case when v_team1_total > v_team2_total then v_slot.team1_id else v_slot.team2_id end;
      v_loser_id := case when v_team1_total > v_team2_total then v_slot.team2_id else v_slot.team1_id end;
    end if;

    -- Locked (FOR UPDATE): a concurrent create_btc_bracket_match call on one of these
    -- same downstream slots (20260922131000, itself locking the slot row it reads)
    -- serializes against this loop instead of racing it — without the lock, that call
    -- could read a downstream slot's pre-advancement team id in the window between this
    -- guard check and this same loop's own write, creating a match keyed to a team the
    -- slot no longer holds. v_target is computed once per row and reused for both the
    -- guard check and the write, so there is no second copy of the derivation to drift.
    for v_downstream in
      select * from public.btc_bracket_slots
      where feeder_slot_1 = v_slot.id or feeder_slot_2 = v_slot.id
      for update
    loop
      v_target := case when v_downstream.round = 'third_place' then v_loser_id else v_winner_id end;
      if v_downstream.match_id is not null and (
        (v_downstream.feeder_slot_1 = v_slot.id and v_downstream.team1_id is distinct from v_target) or
        (v_downstream.feeder_slot_2 = v_slot.id and v_downstream.team2_id is distinct from v_target)
      ) then
        raise exception 'confirm_btc_match: this match% % has already advanced to a match in progress — that downstream match must be removed before this result can change',
          case when v_target is null then ' is now tied, but its' else '''s' end,
          case when v_downstream.round = 'third_place' then 'loser' else 'winner' end;
      end if;
      if v_downstream.feeder_slot_1 = v_slot.id then
        update public.btc_bracket_slots set team1_id = v_target
        where id = v_downstream.id and team1_id is distinct from v_target;
      else
        update public.btc_bracket_slots set team2_id = v_target
        where id = v_downstream.id and team2_id is distinct from v_target;
      end if;
    end loop;
  end if;
end;
$$;

revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from public;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to authenticated;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to service_role;
