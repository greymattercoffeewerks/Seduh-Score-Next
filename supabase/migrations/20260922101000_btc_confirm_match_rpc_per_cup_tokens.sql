-- Seduh Score Next · T-BTC.2 scoring, part 5: confirm_btc_match on per-cup tokens
--
-- Follows 20260922100000: p_votes is now [{cup_number, team1_tokens}, ...], one entry
-- per cup, team1_tokens 0-3 (team2's share is always 3 - team1_tokens). The RPC's
-- signature is unchanged (still 10 positional args; only p_votes's element shape
-- changed) — CREATE OR REPLACE on the same signature, not a new function, per the
-- same reasoning 20260830140000 already established: PUBLIC's default EXECUTE grant
-- resets on CREATE FUNCTION but not on CREATE OR REPLACE of an existing one, so the
-- revoke/grant pair below is re-asserted defensively rather than assumed to still hold
-- (CI caught anon regaining EXECUTE on the previous shape once, see CHANGELOG).
--
-- Still requires the match to have exactly 3 assigned judges before it can confirm —
-- that's an on-the-record fact about who scored the match (20260922100000's own
-- header), not a per-vote attribution, so it is untouched by this migration.
--
-- rollback (roll back BEFORE 20260922100000: this RPC calls app.btc_cups_for_round,
-- owned by 20260922090000, unaffected by this migration; the ordering constraint
-- from 20260922091000's own rollback still applies unchanged):
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from service_role;
--   revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from authenticated;
--   then restore the function body verbatim from 20260922091000_btc_confirm_match_rpc.sql
--   (CREATE OR REPLACE onto the same signature — do not drop it, or every earlier
--   rollback step of 20260922091000/090000 that still expects it present would break),
--   followed by the same revoke-from-public / grant-to-authenticated-and-service_role
--   pair that migration used. (Run and verified live in a transaction against a local
--   database with exactly those steps.)

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
end;
$$;

revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from public;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to authenticated;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to service_role;
