-- Seduh Score Next · BTC demo data: load_btc_demo(org, event, scored)
--
-- Why: rehearsing or presenting BTC meant typing every team and judge name again for each run
-- (and creating then scoring 28 round-robin matches by hand to reach the bracket). This loads a
-- ready-made field into a TEST event in one call, and can be run again to start over.
--
-- What it does, in one transaction, as the CALLER (security invoker: every write is checked by
-- the caller's own RLS, so a non-member can do nothing):
--   1. Refuses unless the event belongs to p_org_id, is a BTC event, and is a TEST event
--      (events.is_test). The event row is locked for the rest of the call, so the flag cannot flip
--      under it and two overlapping loads of one event run one after the other. This is an
--      accident-prevention rail, NOT an authorisation boundary: any member of the org can already
--      change events.is_test (every flip is logged) or write the BTC tables directly, which is the
--      permission model the other BTC RPCs share.
--   2. Wipes the event's BTC data: bracket slots, matches (their judges, cup votes and bonuses
--      cascade), judges, teams. So loading twice gives one field of 8 teams, not 16.
--   3. Inserts 8 teams and 5 judges.
--   4. When p_scored (the default; NULL counts as true), also inserts all 28 round-robin PRELIMINARY matches, each
--      confirmed, with 3 judges (rotating through the 5) and a full set of 15 cups. The results
--      are deterministic — computed from a fixed formula, no randomness — so every load gives
--      the same standings and a rehearsal can be repeated exactly. Team 1 is the strongest and team 8
--      the weakest, with enough variation that results look real, not a clean ladder.
--      After loading, "Generate bracket" works immediately (8 teams, all with results).
--      With p_scored = false only the roster is loaded (the "roster only" mode).
--
-- The numbers 8, 5 and 28 are derived below from the team-name array and the judge count, and the
-- client (src/formats/btc/demo.js: DEMO_TEAM_COUNT / DEMO_JUDGE_COUNT) mirrors them for the card's
-- copy: change one side, change the other (supabase/tests/028 and demo.test.js each pin their side).
--
-- Rows are written directly (not through confirm_btc_match): this is demo data for a test
-- event, so there is no ledger to keep and nothing for the change log to record (test events
-- are not logged by design, handoff D9).
--
-- Returns the counts it loaded, as jsonb, for the screen's confirmation message.
-- Refusals carry a machine-readable `hint` so the client never depends on message wording:
-- demo_event_not_found, demo_not_btc, demo_not_test.
--
-- rollback:
--   drop function if exists load_btc_demo(uuid, uuid, boolean);
--   (data already loaded stays; delete it from the event like any other test data)

create or replace function load_btc_demo(
  p_org_id uuid,
  p_event_id uuid,
  p_scored boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_format text;
  v_is_test boolean;
  v_team_ids uuid[];
  v_judge_ids uuid[];
  v_team_names constant text[] := array[
    'Bean Scene', 'Pour Decisions', 'Crema Crew', 'Drip Society',
    'Roast Republic', 'Grind House', 'Latte Lab', 'Steam Team'
  ];
  v_team_count constant int := array_length(v_team_names, 1);
  v_judge_count constant int := 5;
  v_matches int := 0;
begin
  -- Same org check and not-found shape as the other BTC RPCs: for a non-member RLS hides the
  -- events row below, so "not found" and "not yours" are indistinguishable.
  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'load_btc_demo: event not found' using hint = 'demo_event_not_found';
  end if;

  -- `for update`: held to the end of the transaction, so is_test cannot flip between this check and
  -- the wipe below, and a second concurrent load of the same event waits instead of colliding on the
  -- teams' unique (event_id, name). RLS still filters the row first, so a non-member sees nothing.
  select format, is_test into v_format, v_is_test
  from public.events where id = p_event_id
  for update;

  if v_format is null then
    raise exception 'load_btc_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  if v_format <> 'btc' then
    raise exception 'load_btc_demo: demo data is only available for BTC events' using hint = 'demo_not_btc';
  end if;
  if v_is_test is not true then
    raise exception 'load_btc_demo: demo data can only be loaded into a test event' using hint = 'demo_not_test';
  end if;

  -- Wipe, children first (the RESTRICT foreign keys: slots -> matches -> teams/judges).
  delete from public.btc_bracket_slots where event_id = p_event_id;
  delete from public.btc_matches where event_id = p_event_id;
  delete from public.btc_judges where event_id = p_event_id;
  delete from public.btc_teams where event_id = p_event_id;

  v_team_ids := array(select gen_random_uuid() from generate_series(1, v_team_count));
  v_judge_ids := array(select gen_random_uuid() from generate_series(1, v_judge_count));

  insert into public.btc_teams (id, event_id, name)
  select v_team_ids[i], p_event_id, v_team_names[i] from generate_series(1, v_team_count) i;

  insert into public.btc_judges (id, event_id, name)
  select v_judge_ids[i], p_event_id, 'Judge ' || i from generate_series(1, v_judge_count) i;

  if coalesce(p_scored, true) then
    -- Every pair once, team 1 vs team 2 in roster order.
    insert into public.btc_matches (event_id, round, team1_id, team2_id, status)
    select p_event_id, 'preliminary', v_team_ids[a], v_team_ids[b], 'confirmed'
    from generate_series(1, v_team_count) a, generate_series(1, v_team_count) b
    where a < b
    order by a, b;

    -- Three judges per match, rotating through the five by pairing (deterministic, like the rest).
    insert into public.btc_match_judges (match_id, judge_id)
    select m.id, v_judge_ids[((ab.a + ab.b + k) % v_judge_count) + 1]
    from public.btc_matches m
    cross join lateral (
      select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
    ) ab
    cross join generate_series(0, 2) k
    where m.event_id = p_event_id;

    -- 15 cups per match. Team 1's tokens (0-3) lean towards the stronger side (lower index =
    -- stronger): a strength gap of 0.14 tokens per place, a fixed per-match "form on the day"
    -- offset (so close teams can upset each other: about 3 matches in 28 do), and a per-cup
    -- wobble (so a stronger team does not take every cup). All three are plain arithmetic on the
    -- team positions, so the numbers are the same on every load. NB the per-cup term must not
    -- repeat with a period that divides 15 (5 or 3): 15 cups would be identical blocks and every
    -- margin a multiple of 3 (an earlier version did exactly that). c * c + 3 * c mod 7 has
    -- period 7, which does not divide 15, and both team positions feed into it.
    insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
    select m.id, c,
           greatest(0, least(3, round(
             1.5
             + (b - a) * 0.14
             + (((a * 5 + b * 11) % 7) - 3) * 0.12
             + (((a * 2 + b * 3 + c * c + 3 * c) % 7) - 3) * 0.3
           )::int))
    from public.btc_matches m
    cross join generate_series(1, 15) c
    cross join lateral (
      select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
    ) ab
    where m.event_id = p_event_id;

    -- One fastest-team bonus per match, alternating by pairing so it is spread across teams.
    insert into public.btc_match_bonuses (match_id, fastest_team_id)
    select m.id, case when (a + b) % 2 = 0 then m.team1_id else m.team2_id end
    from public.btc_matches m
    cross join lateral (
      select array_position(v_team_ids, m.team1_id) as a, array_position(v_team_ids, m.team2_id) as b
    ) ab
    where m.event_id = p_event_id;

    select count(*) into v_matches from public.btc_matches where event_id = p_event_id;
  end if;

  return jsonb_build_object('teams', v_team_count, 'judges', v_judge_count, 'matches', v_matches);
end;
$$;

-- Explicit anon revoke, not just from public (see 20260922130000's own comment).
revoke execute on function load_btc_demo(uuid, uuid, boolean) from public, anon;
grant execute on function load_btc_demo(uuid, uuid, boolean) to authenticated;
grant execute on function load_btc_demo(uuid, uuid, boolean) to service_role;
