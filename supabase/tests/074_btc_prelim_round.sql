-- Build A: btc_matches.prelim_round (docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md, section 3).
-- Proves, as the REAL roles through row-level security:
--   * the column exists, is a nullable smallint, with the check constraint and the partial index;
--   * a preliminary match accepts 1, 2, a larger round (no upper bound) and NULL;
--   * 0, a negative number, and any value on a knockout round are refused with 23514, on insert and on update, and a
--     numbered preliminary match cannot be turned into a knockout match;
--   * a row written without the column reads NULL, and the demo leaves every prelim_round NULL;
--   * btc_standings for an event with matches in both rounds is the sum of both;
--   * changing prelim_round writes a score_change_log row (an unchanged value writes none), and the dispute pack carries it;
--   * a member of ANOTHER organisation and a signed-in stranger update zero rows and read zero rows; anon is refused.
begin;
select plan(39);

create schema t074;
grant usage on schema t074 to anon, authenticated;

create function t074.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000740' || lpad(n::text, 4, '0'))::uuid
$$;

-- "SQLSTATE|message" of a statement run as `role` (a person when uid is given), or 'ok'
create function t074.run_as(rl text, uid uuid, stmt text) returns text language plpgsql as $$
declare res text; m text;
begin
  perform set_config('role', rl, true);
  if uid is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', rl, 'sub', uid)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics m = message_text;
    res := sqlstate || '|' || m;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;

-- rows touched by a statement run as `rl`
create function t074.rows_as(rl text, uid uuid, stmt text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', rl, true);
  if uid is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', rl, 'sub', uid)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  end if;
  execute 'with r as (' || stmt || ' returning 1) select count(*) from r' into n;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
create function t074.visible_as(uid uuid, stmt text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'select count(*) from (' || stmt || ') q' into n;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;
-- the dispute pack as a member
create function t074.pack_as(uid uuid, org uuid, ev uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  j := public.get_dispute_pack(org, ev);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return j;
end $$;

-- user 1 = owner of org 100; user 2 = owner of org 200; user 3 = signed in, in no organisation.
insert into auth.users (id, email) values
  (t074.u(1), 't074-a@test.seduh-next'), (t074.u(2), 't074-b@test.seduh-next'), (t074.u(3), 't074-c@test.seduh-next');
insert into orgs (id, name, slug) values (t074.u(100), 'T074 A', 't074-a'), (t074.u(200), 'T074 B', 't074-b');
insert into org_members (org_id, user_id, role) values
  (t074.u(100), t074.u(1), 'owner'), (t074.u(200), t074.u(2), 'owner');
-- 110 = a real (logged) event, 120 = a test event (the demo loads there), 130 = a real event for the standings sum
insert into events (id, org_id, format, name) values (t074.u(110), t074.u(100), 'btc', 'T074 BTC');
insert into events (id, org_id, format, name, is_test) values (t074.u(120), t074.u(100), 'btc', 'T074 BTC test', true);
insert into events (id, org_id, format, name) values (t074.u(130), t074.u(100), 'btc', 'T074 BTC standings');
insert into btc_teams (id, event_id, name) values
  (t074.u(1001), t074.u(110), 'Team Kopi'), (t074.u(1002), t074.u(110), 'Team Teh'),
  (t074.u(1003), t074.u(110), 'Team Milo'),
  (t074.u(1301), t074.u(130), 'Team A'), (t074.u(1302), t074.u(130), 'Team B'), (t074.u(1303), t074.u(130), 'Team C');
-- one match without the new column (the shape every existing row has), one knockout match
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  (t074.u(3001), t074.u(110), 'preliminary', t074.u(1001), t074.u(1002)),
  (t074.u(3002), t074.u(110), 'quarterfinal', t074.u(1001), t074.u(1003));

-- the column, the constraint, the index
select col_type_is('public', 'btc_matches', 'prelim_round', 'smallint', 'btc_matches.prelim_round is smallint');
select col_is_null('public', 'btc_matches', 'prelim_round', 'btc_matches.prelim_round is nullable');
select is((select count(*)::int from pg_constraint
            where conrelid = 'public.btc_matches'::regclass and conname = 'btc_matches_prelim_round_valid' and contype = 'c'),
          1, 'the check constraint exists');
select ok((select pg_get_indexdef(indexrelid) from pg_index
            where indexrelid = 'public.btc_matches_event_prelim_round_idx'::regclass)
          ~ '\(event_id, prelim_round\) WHERE \(round = ''preliminary''::text\)',
          'the partial index is on (event_id, prelim_round) where round = preliminary');

-- a row written without the column reads NULL
select is((select prelim_round from btc_matches where id = t074.u(3001)), null, 'a match inserted without prelim_round reads NULL');

-- a preliminary match accepts 1, 2, a larger round and NULL
select is(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 1 where id = %L', t074.u(3001))),
          'ok', 'a member sets round 1 on a preliminary match');
select is((select prelim_round from btc_matches where id = t074.u(3001)), 1::smallint, 'the match is round 1');
select is(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 2 where id = %L', t074.u(3001))),
          'ok', 'a member sets round 2');
select is((select prelim_round from btc_matches where id = t074.u(3001)), 2::smallint, 'the match is round 2');
select is(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 3 where id = %L', t074.u(3001))),
          'ok', 'there is no upper bound: round 3 is accepted');
select is(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = null where id = %L', t074.u(3001))),
          'ok', 'a member clears the number');
select is((select prelim_round from btc_matches where id = t074.u(3001)), null, 'the match is un-numbered again');
select is(t074.run_as('authenticated', t074.u(1), format(
            'insert into public.btc_matches (event_id, round, team1_id, team2_id, prelim_round) values (%L, %L, %L, %L, 2)',
            t074.u(110), 'preliminary', t074.u(1002), t074.u(1003))),
          'ok', 'a member inserts a numbered preliminary match');

-- refusals are 23514 (check violation)
select is(left(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 0 where id = %L', t074.u(3001))), 5),
          '23514', 'zero is refused');
select is(left(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = -1 where id = %L', t074.u(3001))), 5),
          '23514', 'a negative number is refused');
select is(left(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 1 where id = %L', t074.u(3002))), 5),
          '23514', 'a number on a knockout match is refused (update)');
select is(left(t074.run_as('authenticated', t074.u(1), format(
            'insert into public.btc_matches (event_id, round, team1_id, team2_id, prelim_round) values (%L, %L, %L, %L, 1)',
            t074.u(110), 'semifinal', t074.u(1002), t074.u(1003))), 5),
          '23514', 'a number on a knockout match is refused (insert)');
select is(left(t074.run_as('authenticated', t074.u(1), format(
            'insert into public.btc_matches (event_id, round, team1_id, team2_id, prelim_round) values (%L, %L, %L, %L, 0)',
            t074.u(110), 'preliminary', t074.u(1002), t074.u(1003))), 5),
          '23514', 'zero is refused (insert)');
select is(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 1 where id = %L', t074.u(3001))),
          'ok', 'setup: the preliminary match is round 1 again');
select is(left(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set round = %L where id = %L', 'final', t074.u(3001))), 5),
          '23514', 'a numbered preliminary match cannot become a knockout match');
select is((select prelim_round from btc_matches where id = t074.u(3001)), 1::smallint, 'no refused write changed the match');
select is((select count(*)::int from btc_matches where id = t074.u(3002) and prelim_round is not null), 0, 'the knockout match carries no number');

-- the score log: a change writes a row, an unchanged value does not, the number reaches the dispute pack
-- match 3001 went null > 1 > 2 > 3 > null > 1 (five logged changes; the setup rows and refused writes add none)
select is((select count(*)::int from score_change_log
            where table_name = 'btc_matches' and row_id = t074.u(3001) and action = 'update'),
          5, 'five number changes were logged and the refused writes none');
select is((select old_value ->> 'prelim_round' from score_change_log
            where table_name = 'btc_matches' and row_id = t074.u(3001) and action = 'update' and new_value ->> 'prelim_round' = '2'),
          '1', 'the log row for 1 to 2 keeps the old number');
select is((select count(*)::int from score_change_log
            where table_name = 'btc_matches' and row_id = t074.u(3001) and action = 'update'
              and new_value -> 'prelim_round' = 'null'::jsonb and old_value ->> 'prelim_round' = '3'),
          1, 'clearing the number is logged (3 to JSON null)');
select is((select count(*)::int from score_change_log
            where table_name = 'btc_matches' and row_id = t074.u(3001) and action = 'insert' and new_value ? 'prelim_round'),
          1, 'the insert row carries the prelim_round key');
select is(t074.run_as('authenticated', t074.u(1), format('update public.btc_matches set prelim_round = 1 where id = %L', t074.u(3001))),
          'ok', 'writing the same number again');
select is((select count(*)::int from score_change_log where table_name = 'btc_matches' and row_id = t074.u(3001) and action = 'update'),
          5, 'an unchanged number writes no log row');
select ok(jsonb_path_exists(t074.pack_as(t074.u(1), t074.u(100), t074.u(110)), '$.btc.matches[*] ? (@.prelim_round == 1)'),
          'the dispute pack carries prelim_round on the match row');

-- standings: a team playing round 1 and round 2 gets the sum
insert into btc_matches (id, event_id, round, team1_id, team2_id, prelim_round, status) values
  (t074.u(3101), t074.u(130), 'preliminary', t074.u(1301), t074.u(1302), 1, 'confirmed'),
  (t074.u(3102), t074.u(130), 'preliminary', t074.u(1303), t074.u(1301), 2, 'confirmed');
insert into btc_cup_votes (match_id, cup_number, team1_tokens)
  select t074.u(3101), n, 2 from generate_series(1, 15) n;
insert into btc_cup_votes (match_id, cup_number, team1_tokens)
  select t074.u(3102), n, 1 from generate_series(1, 15) n;
select is((select total_points::bigint from btc_standings where event_id = t074.u(130) and team_id = t074.u(1301)),
          (select team1_total::bigint from btc_match_scores where match_id = t074.u(3101))
        + (select team2_total::bigint from btc_match_scores where match_id = t074.u(3102)),
          'standings: team A''s points are its round 1 total plus its round 2 total');
select is((select played::int from btc_standings where event_id = t074.u(130) and team_id = t074.u(1301)), 2,
          'standings: team A played both rounds');
select is((select total_points::int from btc_standings where event_id = t074.u(130) and team_id = t074.u(1301)), 70,
          'standings: 35 + 35 = 70 (30 tokens + 5 round-winner each round)');

-- another organisation and a stranger update and read nothing; anon is refused
select is(t074.rows_as('authenticated', t074.u(2), format('update public.btc_matches set prelim_round = 2 where event_id = %L', t074.u(110))),
          0, 'another organisation updates zero matches');
select is(t074.rows_as('authenticated', t074.u(3), format('update public.btc_matches set prelim_round = 2 where event_id = %L', t074.u(110))),
          0, 'a stranger updates zero matches');
select is(t074.visible_as(t074.u(2), format('select prelim_round from public.btc_matches where event_id = %L', t074.u(110))) +
          t074.visible_as(t074.u(3), format('select prelim_round from public.btc_matches where event_id = %L', t074.u(110))),
          0, 'another organisation and a stranger read zero matches');
select is(left(t074.run_as('anon', null, format('update public.btc_matches set prelim_round = 2 where event_id = %L', t074.u(110))), 5),
          '42501', 'anon is refused');
select is((select count(*)::int from btc_matches where event_id = t074.u(110) and prelim_round = 2), 1,
          'no refused write changed a match (only the one inserted as round 2)');

-- the demo leaves every number NULL
select is(t074.run_as('authenticated', t074.u(1), format('select public.load_btc_demo(%L, %L, false)', t074.u(100), t074.u(120))),
          'ok', 'load_btc_demo still runs on a test event');
select is((select count(*)::int from btc_matches where event_id = t074.u(120) and prelim_round is not null), 0,
          'the demo leaves every prelim_round NULL');

select * from finish();
rollback;
