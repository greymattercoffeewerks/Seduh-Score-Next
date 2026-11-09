-- Build B part 3: redraw_btc_round (migration 20261109110000).
-- Proves: a non-member gets the standard not-found; an unscored round is cleared whole (its matches, their judges and its
-- draw record) and can then be drawn again; a scored round (status, finish time, cup vote, bonus row) is refused and
-- left exactly as it was; a later round blocks it; a round whose matches were removed by hand but whose draw record
-- remains can be cleared; an unnumbered preliminary match counts as round 1; a bracket closes the rounds.
begin;
select plan(30);

create function public.t076_u(n int) returns uuid language sql immutable as $$
  select ('76000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function public.t076_m(t1 int, t2 int, j1 int, j2 int, j3 int) returns jsonb language sql immutable as $$
  select jsonb_build_object('team1_id', public.t076_u(t1), 'team2_id', public.t076_u(t2),
                            'judge_ids', jsonb_build_array(public.t076_u(j1), public.t076_u(j2), public.t076_u(j3)))
$$;
-- redraw_btc_round: the number removed as text, or the refusal's hint (never its wording)
create function public.t076_redraw(p_event int, p_round int, p_org int default 10) returns text language plpgsql as $$
declare h text; n int;
begin
  n := public.redraw_btc_round(public.t076_u(p_org), public.t076_u(p_event), p_round::smallint);
  return n::text;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
-- create_btc_round for the test organisation: 'ok' or the hint
create function public.t076_create(p_event int, p_round int, p_matches jsonb) returns text language plpgsql as $$
declare h text;
begin
  perform * from public.create_btc_round(public.t076_u(10), public.t076_u(p_event), p_round::smallint, 'random', 'seed', p_matches, true);
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function public.t076_u(int), public.t076_m(int, int, int, int, int),
  public.t076_redraw(int, int, int), public.t076_create(int, int, jsonb) to authenticated;

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, email) values
  (public.t076_u(1), 'member76@test.seduh-next'), (public.t076_u(2), 'outsider76@test.seduh-next');
insert into orgs (id, name, slug) values (public.t076_u(10), 'Org 76', 'org-76'), (public.t076_u(20), 'Other 76', 'other-76');
insert into org_members (org_id, user_id, role) values (public.t076_u(10), public.t076_u(1), 'organiser');
-- events: 200 happy path, 300 scored, 400 dead round, 500 unnumbered, 600 bracket, 700 later round
insert into events (id, org_id, format, name)
  select public.t076_u(e), public.t076_u(10), 'btc', 'E' || e from unnest(array[200, 300, 400, 500, 600, 700]) e;
-- each event e has four teams e+1..e+4 and three judges e+11..e+13 (as ids e*1000-free small numbers)
insert into btc_teams (id, event_id, name)
  select public.t076_u(e + k), public.t076_u(e), 'T' || (e + k) from unnest(array[200, 300, 400, 500, 600, 700]) e, generate_series(1, 4) k;
insert into btc_judges (id, event_id, name)
  select public.t076_u(e + 10 + k), public.t076_u(e), 'J' || (e + 10 + k) from unnest(array[200, 300, 400, 500, 600, 700]) e, generate_series(1, 3) k;
insert into btc_bracket_slots (id, event_id, round, slot_label) values (public.t076_u(699), public.t076_u(600), 'final', 'F76');
-- 500: an unnumbered preliminary match (an older or demo event)
insert into btc_matches (id, event_id, round, team1_id, team2_id)
  values (public.t076_u(590), public.t076_u(500), 'preliminary', public.t076_u(501), public.t076_u(502));

-- ---------- the object ----------
select is(has_function_privilege('anon', 'public.redraw_btc_round(uuid,uuid,smallint)', 'execute'), false, 'anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.redraw_btc_round(uuid,uuid,smallint)', 'execute'), true, 'a signed-in caller can');
select is((select prosecdef from pg_proc where proname = 'redraw_btc_round'), false, 'it is SECURITY INVOKER');

-- ---------- a non-member ----------
set local role authenticated;
set local request.jwt.claim.sub = '76000000-0000-0000-0000-000000000002';
select is(public.t076_redraw(200, 1), 'btc_round_event_not_found', 'a non-member gets the standard not-found');
select is(public.t076_redraw(200, 1, 20), 'btc_round_event_not_found', 'naming an organisation that does not own the event gets the same');

-- ---------- a member ----------
set local request.jwt.claim.sub = '76000000-0000-0000-0000-000000000001';
select is(public.t076_redraw(200, 0), 'btc_round_invalid', 'round 0 is refused');
select is(public.t076_redraw(200, 1), 'btc_redraw_nothing', 'a round that was never drawn has nothing to clear');

-- happy path: create round 1, clear it, draw it again
select is(public.t076_create(200, 1, jsonb_build_array(public.t076_m(201, 202, 211, 212, 213), public.t076_m(203, 204, 211, 212, 213))), 'ok', 'round 1 created');
select is((select count(*)::int from btc_match_judges where match_id in (select id from btc_matches where event_id = public.t076_u(200))), 6, '2 matches with 3 judges each');
select is(public.t076_redraw(200, 1), '2', 'redraw removes the round''s 2 matches');
select is((select count(*)::int from btc_matches where event_id = public.t076_u(200)), 0, 'no match is left');
select is((select count(*)::int from btc_match_judges where match_id in (select id from btc_matches where event_id = public.t076_u(200))), 0, 'and no judge assignment');
select is((select count(*)::int from btc_round_draws where event_id = public.t076_u(200)), 0, 'and no draw record');
select is(public.t076_create(200, 1, jsonb_build_array(public.t076_m(201, 203, 211, 212, 213), public.t076_m(202, 204, 211, 212, 213))), 'ok', 'the round can be drawn again');

-- a later round blocks it (round 1 confirmed, round 2 drawn)
update btc_matches set status = 'confirmed' where event_id = public.t076_u(200);
select is(public.t076_create(200, 2, jsonb_build_array(public.t076_m(201, 202, 211, 212, 213), public.t076_m(203, 204, 211, 212, 213))), 'ok', 'round 2 created after round 1 is confirmed');
select is(public.t076_redraw(200, 1), 'btc_redraw_later_round', 'round 1 cannot be redrawn under a drawn round 2');
select is(public.t076_redraw(200, 2), '2', 'round 2 (pending) can');
select is((select count(*)::int from btc_matches where event_id = public.t076_u(200) and prelim_round = 1), 2, 'round 1 is untouched');

-- scored: each kind of score refuses, and nothing is deleted
select is(public.t076_create(300, 1, jsonb_build_array(public.t076_m(301, 302, 311, 312, 313), public.t076_m(303, 304, 311, 312, 313))), 'ok', 'event 300 round 1 created');
update btc_matches set status = 'scoring' where event_id = public.t076_u(300) and team1_id = public.t076_u(301);
select is(public.t076_redraw(300, 1), 'btc_redraw_scored', 'a match in scoring refuses');
update btc_matches set status = 'pending', team2_time_note = '4:12' where event_id = public.t076_u(300) and team1_id = public.t076_u(301);
select is(public.t076_redraw(300, 1), 'btc_redraw_scored', 'an entered finish time refuses');
update btc_matches set team2_time_note = null where event_id = public.t076_u(300);
insert into btc_cup_votes (match_id, cup_number, team1_tokens)
  select id, 1, 2 from btc_matches where event_id = public.t076_u(300) and team1_id = public.t076_u(303);
select is(public.t076_redraw(300, 1), 'btc_redraw_scored', 'a cup vote on the other match refuses');
delete from btc_cup_votes;
insert into btc_match_bonuses (match_id) select id from btc_matches where event_id = public.t076_u(300) and team1_id = public.t076_u(303);
select is(public.t076_redraw(300, 1), 'btc_redraw_scored', 'a bonus row refuses');
select is((select count(*)::int from btc_matches where event_id = public.t076_u(300)), 2, 'a refused redraw deleted nothing');

-- a draw record that outlived its matches (they were removed by hand)
select is(public.t076_create(400, 1, jsonb_build_array(public.t076_m(401, 402, 411, 412, 413), public.t076_m(403, 404, 411, 412, 413))), 'ok', 'event 400 round 1 created');
delete from btc_matches where event_id = public.t076_u(400);
select is(public.t076_create(400, 1, jsonb_build_array(public.t076_m(401, 402, 411, 412, 413), public.t076_m(403, 404, 411, 412, 413))), 'btc_round_exists', 'the leftover record refuses a new draw');
select is(public.t076_redraw(400, 1), '0', 'redraw clears the leftover record (0 matches removed)');
select is((select count(*)::int from btc_round_draws where event_id = public.t076_u(400)), 0, 'and the record is gone, so the round can be drawn');

-- an unnumbered preliminary match counts as round 1; a bracket closes the rounds
select is(public.t076_redraw(500, 1), '1', 'an unnumbered match is cleared as round 1');
select is(public.t076_redraw(600, 1), 'btc_round_bracket_exists', 'a bracket closes the preliminary rounds');

select * from finish();
rollback;
