-- Seduh Score Next · T-BTC.2 scoring, part 2: confirm_btc_match RPC
--
-- Confirming a BTC match writes every judge's vote for every cup, the bonus flags,
-- the two free-text finish times and the status flip in ONE transaction, queued
-- through core/outbox.js. This is the BTC analogue of confirm_heat
-- (20260822100000): a client-side sequence of separate writes is exactly the
-- half-scored-match failure mode handoff §9's offline model exists to prevent.
-- Unlike create_btc_match (a setup-time write, deliberately not outbox-routed),
-- scoring happens live, at the venue, on the unreliable connection, so it carries
-- an idempotency key (processed_operations) and optimistic concurrency.
--
-- rollback (roll back BEFORE 20260922090000: this RPC calls app.btc_cups_for_round, which
-- that migration owns, and plpgsql resolves the call late, so the reverse order would
-- succeed and leave the RPC broken at call time):
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from service_role;
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from authenticated;
--   drop function if exists confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text);

-- p_votes shape: [{cup_number, judge_id, team_id}, ...]. The whole set is REPLACED
-- (delete then insert) so re-confirming an already-confirmed match edits it,
-- matching legacy's "Edit a finished match"; optimistic concurrency on
-- btc_matches.updated_at stops two devices silently overwriting each other.
--
-- Strict confirm (the §7.4 analogue): every assigned judge must have voted on every
-- cup of the round. Checked AFTER the inserts, by counting, like confirm_heat: the
-- unique (match_id, cup_number, judge_id) constraint plus the participant trigger
-- (judge assigned to THIS match, team is one of its two teams) plus the cup range
-- check in the body make "count = cups x 3" equivalent to "every (cup, judge) pair
-- exactly once". A short payload therefore fails with the friendly message, not a
-- raw constraint error.
--
-- SECURITY INVOKER (explicit), pinned search_path: ordinary RLS gates every read
-- and write to an org member of the match's event, exactly as create_btc_match.
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

  -- Re-check the ledger now that the row is locked: a retry of the SAME operation id
  -- that arrives while the original is still running passes the check at the top, then
  -- waits here; once the original commits it has bumped updated_at, so without this
  -- the retry would be reported as a false CONFLICT instead of the no-op it is.
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  -- IS DISTINCT FROM, not <>: a NULL expected timestamp must be a conflict, never a
  -- silent skip of the guard (<> against NULL is NULL, so the branch would not fire).
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'CONFLICT: match % has been modified since it was read', p_match_id
      using detail = json_build_object(
              'match_id', p_match_id,
              'current_updated_at', v_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  -- The signature-beverage bonus does not exist in the preliminary round.
  if v_round = 'preliminary' and (p_team1_signature or p_team2_signature) then
    raise exception 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round';
  end if;

  v_cups := app.btc_cups_for_round(v_round);

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

  delete from public.btc_cup_votes where match_id = p_match_id;

  insert into public.btc_cup_votes (match_id, cup_number, judge_id, team_id)
  select p_match_id,
         (v->>'cup_number')::smallint,
         (v->>'judge_id')::uuid,
         (v->>'team_id')::uuid
  from jsonb_array_elements(p_votes) v;

  select count(*) into v_vote_count from public.btc_cup_votes where match_id = p_match_id;
  if v_vote_count <> v_cups * 3 then
    raise exception 'confirm_btc_match: % of % judge votes are missing', v_cups * 3 - v_vote_count, v_cups * 3;
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
end;
$$;

-- PUBLIC gets EXECUTE on a new function by default; revoked in the function's own
-- first migration (see 20260830140000 for the months-long miss this avoids).
revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from public;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to authenticated;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to service_role;
