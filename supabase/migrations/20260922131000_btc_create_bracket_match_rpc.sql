-- Seduh Score Next · T-BTC.2 sub-step 5: create_btc_bracket_match RPC
--
-- The bracket equivalent of create_btc_match (20260918100000): atomically creates the
-- btc_matches row for a bracket slot whose two teams are already known, its exactly-3-
-- judges assignment, AND links the slot back to the new match (btc_bracket_slots.match_id)
-- — all three in one transaction, closing the same half-created-state risk
-- create_btc_match's own header already explains, plus a fourth failure mode unique to
-- the bracket: without the same transaction, a slot could end up with a match created
-- but never linked back (match_id still null), silently invisible to the bracket screen
-- and to confirm_btc_match's own advancement step, which only ever looks for a slot BY
-- its match_id.
--
-- rollback:
--   revoke execute on function create_btc_bracket_match(uuid, uuid, uuid[]) from service_role;
--   revoke execute on function create_btc_bracket_match(uuid, uuid, uuid[]) from authenticated;
--   revoke execute on function create_btc_bracket_match(uuid, uuid, uuid[]) from anon;
--   drop function if exists create_btc_bracket_match(uuid, uuid, uuid[]);

create or replace function create_btc_bracket_match(
  p_org_id uuid,
  p_slot_id uuid,
  p_judge_ids uuid[]
)
returns btc_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot public.btc_bracket_slots;
  v_match public.btc_matches;
  v_judge_id uuid;
  v_distinct_judge_count int;
begin
  -- Locked: confirm_btc_match's own bracket-advancement step locks this same slot row
  -- before writing team1_id/team2_id (20260922132000), so the two RPCs serialize
  -- against each other here rather than racing a check-then-act read against a
  -- concurrent advancement write.
  select * into v_slot from public.btc_bracket_slots where id = p_slot_id for update;
  if v_slot.id is null or p_org_id is distinct from app.org_id_for_event(v_slot.event_id) then
    raise exception 'create_btc_bracket_match: bracket slot not found';
  end if;

  if v_slot.team1_id is null or v_slot.team2_id is null then
    raise exception 'create_btc_bracket_match: both of this slot''s teams must be known first';
  end if;

  if v_slot.match_id is not null then
    raise exception 'create_btc_bracket_match: this slot already has a match';
  end if;

  select count(distinct j) into v_distinct_judge_count from unnest(p_judge_ids) as j;
  if coalesce(array_length(p_judge_ids, 1), 0) <> 3 or v_distinct_judge_count <> 3 then
    raise exception 'create_btc_bracket_match: exactly 3 distinct judges are required';
  end if;
  if exists (
    select 1 from unnest(p_judge_ids) as jid
    where not exists (
      select 1 from public.btc_judges j where j.id = jid and j.event_id = v_slot.event_id
    )
  ) then
    raise exception 'create_btc_bracket_match: all judges must belong to this event';
  end if;

  insert into public.btc_matches (event_id, round, team1_id, team2_id)
  values (v_slot.event_id, v_slot.round, v_slot.team1_id, v_slot.team2_id)
  returning * into v_match;

  foreach v_judge_id in array p_judge_ids loop
    insert into public.btc_match_judges (match_id, judge_id) values (v_match.id, v_judge_id);
  end loop;

  update public.btc_bracket_slots set match_id = v_match.id where id = p_slot_id;

  return v_match;
end;
$$;

-- Explicit anon revoke, not just from public: a newer Postgres/Supabase-CLI bootstrap
-- grants EXECUTE to anon/authenticated directly via pg_default_acl, not via PUBLIC, so
-- "revoke ... from public" alone is a no-op against it (the exact gap closed for every
-- other write RPC in 20260922110000 — these two RPCs didn't exist yet when that ran).
revoke execute on function create_btc_bracket_match(uuid, uuid, uuid[]) from public, anon;
grant execute on function create_btc_bracket_match(uuid, uuid, uuid[]) to authenticated;
grant execute on function create_btc_bracket_match(uuid, uuid, uuid[]) to service_role;
