-- Seduh Score Next · T-BTC.2 sub-step 5: confirm_btc_match auto-advances a bracket slot
--
-- CREATE OR REPLACE on the same signature as 20260922101000 (never edited itself, per
-- repo rule; this is the forward-only fix). Appends bracket advancement to the END of
-- the existing transaction, after the ledger row is written: if the just-confirmed
-- match belongs to a bracket slot (btc_bracket_slots.match_id = p_match_id), compute
-- the winner/loser from btc_match_scores' bonus-inclusive totals — the ONE place this
-- formula lives, read fresh from the view rather than re-derived inline here, so there
-- is never a second, separately-maintained copy of it to drift out of sync — and push
-- the result into every downstream slot this one feeds. Safe to do AFTER the main
-- write: this whole function body is one transaction, so a RAISE at this final step
-- still rolls back the cup-vote/bonus/status/ledger writes made earlier in the same
-- call, exactly like any other failure path already in this function.
--
-- A slot's own totals TYING is left unresolved, deliberately, the same "never default
-- a tie" discipline as the scoring formula itself: the confirm still succeeds (the
-- match IS scored), but no downstream slot gets filled from it, and the bracket screen
-- must show this plainly rather than silently guessing a winner — there is no
-- seeding-tie-break UI yet either, so an organiser resolves this the same way as any
-- other tie the app refuses to auto-break.
--
-- A semifinal slot feeds TWO downstream slots (the final, via its winner, and
-- third_place, via its loser — see 20260922130000's own header for why), so this walks
-- every downstream slot referencing the confirmed match's own slot, not just one.
--
-- Closes the ROADMAP.md gap: "the bracket step must ... guard editing a confirmed
-- match whose winner already advanced." If a downstream slot's own match already
-- exists (its match_id is set) and this confirm's own result would change which team
-- fills that downstream position, the WHOLE confirm is refused — a downstream match
-- already has real judges/scores keyed to a specific team; silently swapping which
-- team that is would corrupt it. Re-confirming with the SAME outcome (no change to any
-- downstream team) is still allowed, since nothing downstream actually moves.
--
-- rollback:
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from service_role;
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from authenticated;
--   then restore the function body verbatim from 20260922101000_btc_confirm_match_rpc_per_cup_tokens.sql
--   (CREATE OR REPLACE onto the same signature — do not drop it), followed by the same
--   revoke-from-public / grant-to-authenticated-and-service_role pair that migration used.
--   (Run and verified live in a transaction against a local database with exactly those
--   steps.)

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

    if v_team1_total <> v_team2_total then
      v_winner_id := case when v_team1_total > v_team2_total then v_slot.team1_id else v_slot.team2_id end;
      v_loser_id := case when v_team1_total > v_team2_total then v_slot.team2_id else v_slot.team1_id end;

      -- Locked (FOR UPDATE): a concurrent create_btc_bracket_match call on one of these
      -- same downstream slots (20260922131000, itself locking the slot row it reads)
      -- now serializes against this loop instead of racing it — without the lock, that
      -- call could read a downstream slot's pre-advancement team id in the window
      -- between this guard check and this same loop's own write, creating a match keyed
      -- to a team the slot no longer holds. v_target is computed once per row here and
      -- reused for both the guard check and the write below, rather than in two
      -- separate loops, so there is no second copy of this derivation to drift and no
      -- window between "checked" and "written" for any one downstream row.
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
          raise exception 'confirm_btc_match: this match''s % has already advanced to a match in progress — that downstream match must be removed before this result can change',
            case when v_downstream.round = 'third_place' then 'loser' else 'winner' end;
        end if;
        if v_downstream.feeder_slot_1 = v_slot.id then
          update public.btc_bracket_slots set team1_id = v_target where id = v_downstream.id;
        else
          update public.btc_bracket_slots set team2_id = v_target where id = v_downstream.id;
        end if;
      end loop;
    end if;
  end if;
end;
$$;

revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from public;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to authenticated;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to service_role;
