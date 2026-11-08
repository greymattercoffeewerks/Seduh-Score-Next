-- Build E: btc_teams.country_code / represents and btc_judges.country_code (docs/specs/BTC-E-TEAM-JUDGE-COUNTRY-PLAN.md 4.4).
-- Proves, as the REAL roles through row-level security:
--   * the columns exist, are nullable text, and the shape constraints exist;
--   * a member sets, clears and re-sets them; the database refuses a code that is not two capital letters and a
--     represents label that is empty, untrimmed or over 60 characters (23514); a NULL country is allowed;
--   * two teams of one event can share a country (no uniqueness);
--   * a member of ANOTHER organisation and a signed-in stranger update zero rows and read zero rows, and anon is refused;
--   * load_btc_demo still runs and leaves every country NULL (the demo stays country-less).
begin;
select plan(38);

create schema t073;
grant usage on schema t073 to anon, authenticated;

create function t073.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000730' || lpad(n::text, 4, '0'))::uuid
$$;

-- "SQLSTATE|message" of a statement run as `role` (a person when uid is given), or 'ok'
create function t073.run_as(rl text, uid uuid, stmt text) returns text language plpgsql as $$
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

-- rows touched or returned by a statement run as `rl` (a SELECT counts the rows it returns)
create function t073.rows_as(rl text, uid uuid, stmt text) returns int language plpgsql as $$
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
create function t073.visible_as(uid uuid, stmt text) returns int language plpgsql as $$
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

-- user 1 = owner of org 100; user 2 = owner of org 200; user 3 = signed in, in no organisation.
insert into auth.users (id, email) values
  (t073.u(1), 't073-a@test.seduh-next'), (t073.u(2), 't073-b@test.seduh-next'), (t073.u(3), 't073-c@test.seduh-next');
insert into orgs (id, name, slug) values (t073.u(100), 'T073 A', 't073-a'), (t073.u(200), 'T073 B', 't073-b');
insert into org_members (org_id, user_id, role) values
  (t073.u(100), t073.u(1), 'owner'), (t073.u(200), t073.u(2), 'owner');
insert into events (id, org_id, format, name) values (t073.u(110), t073.u(100), 'btc', 'T073 BTC');
insert into events (id, org_id, format, name, is_test) values (t073.u(120), t073.u(100), 'btc', 'T073 BTC test', true);
insert into btc_teams (id, event_id, name) values
  (t073.u(1001), t073.u(110), 'Team Kopi'), (t073.u(1002), t073.u(110), 'Team Teh');
insert into btc_judges (id, event_id, name) values (t073.u(2001), t073.u(110), 'Siti');

-- the columns and constraints
select col_type_is('public', 'btc_teams', 'country_code', 'text', 'btc_teams.country_code is text');
select col_type_is('public', 'btc_teams', 'represents', 'text', 'btc_teams.represents is text');
select col_type_is('public', 'btc_judges', 'country_code', 'text', 'btc_judges.country_code is text');
select col_is_null('public', 'btc_teams', 'country_code', 'btc_teams.country_code is nullable');
select col_is_null('public', 'btc_teams', 'represents', 'btc_teams.represents is nullable');
select col_is_null('public', 'btc_judges', 'country_code', 'btc_judges.country_code is nullable');
select is((select count(*)::int from pg_constraint
            where conname in ('btc_teams_country_code_format', 'btc_teams_represents_length', 'btc_judges_country_code_format')
              and contype = 'c'),
          3, 'the three shape constraints exist');

-- a member sets, clears and re-sets them
select is(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = %L where id = %L', 'BN', t073.u(1001))),
          'ok', 'a member sets BN on a team');
select is((select country_code from btc_teams where id = t073.u(1001)), 'BN', 'the team is BN');
select is(t073.run_as('authenticated', t073.u(1), format('update public.btc_judges set country_code = %L where id = %L', 'BN', t073.u(2001))),
          'ok', 'a member sets BN on a judge');
select is((select country_code from btc_judges where id = t073.u(2001)), 'BN', 'the judge is BN');
select is(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = null where id = %L', t073.u(1001))),
          'ok', 'a member clears the team country');
select is((select country_code from btc_teams where id = t073.u(1001)), null, 'the team has no country again');
select is(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set represents = %L where id = %L', 'Borneo', t073.u(1001))),
          'ok', 'a member sets represents');
select is((select represents from btc_teams where id = t073.u(1001)), 'Borneo', 'represents is stored');

-- the shape is refused with 23514 (check violation)
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = %L where id = %L', 'bn', t073.u(1001))), 5),
          '23514', 'team: lower-case bn is refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = %L where id = %L', 'BRN', t073.u(1001))), 5),
          '23514', 'team: three letters are refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = %L where id = %L', 'B1', t073.u(1001))), 5),
          '23514', 'team: a digit is refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = %L where id = %L', '', t073.u(1001))), 5),
          '23514', 'team: an empty code is refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_judges set country_code = %L where id = %L', 'bn', t073.u(2001))), 5),
          '23514', 'judge: lower-case bn is refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_judges set country_code = %L where id = %L', 'BRN', t073.u(2001))), 5),
          '23514', 'judge: three letters are refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_judges set country_code = %L where id = %L', '', t073.u(2001))), 5),
          '23514', 'judge: an empty code is refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set represents = %L where id = %L', '', t073.u(1001))), 5),
          '23514', 'represents: empty is refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set represents = %L where id = %L', '  x', t073.u(1001))), 5),
          '23514', 'represents: leading spaces are refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set represents = %L where id = %L', 'x  ', t073.u(1001))), 5),
          '23514', 'represents: trailing spaces are refused');
select is(left(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set represents = %L where id = %L', repeat('x', 61), t073.u(1001))), 5),
          '23514', 'represents: 61 characters are refused');
select is(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set represents = %L where id = %L', repeat('x', 60), t073.u(1001))),
          'ok', 'represents: 60 characters are accepted');

-- two teams of one event can share a country
select is(t073.run_as('authenticated', t073.u(1), format('update public.btc_teams set country_code = %L where event_id = %L', 'BN', t073.u(110))),
          'ok', 'both teams of the event are set to BN');
select is((select count(*)::int from btc_teams where event_id = t073.u(110) and country_code = 'BN'), 2, 'two teams share BN');

-- a member of another organisation and a stranger update and read nothing; anon is refused
select is(t073.rows_as('authenticated', t073.u(2), format('update public.btc_teams set country_code = %L where event_id = %L', 'SG', t073.u(110))),
          0, 'another organisation updates zero teams');
select is(t073.rows_as('authenticated', t073.u(2), format('update public.btc_judges set country_code = %L where event_id = %L', 'SG', t073.u(110))),
          0, 'another organisation updates zero judges');
select is(t073.rows_as('authenticated', t073.u(3), format('update public.btc_teams set country_code = %L where event_id = %L', 'SG', t073.u(110))),
          0, 'a stranger updates zero teams');
select is(t073.visible_as(t073.u(2), format('select country_code from public.btc_teams where event_id = %L', t073.u(110))) +
          t073.visible_as(t073.u(2), format('select country_code from public.btc_judges where event_id = %L', t073.u(110))) +
          t073.visible_as(t073.u(3), format('select country_code from public.btc_teams where event_id = %L', t073.u(110))) +
          t073.visible_as(t073.u(3), format('select country_code from public.btc_judges where event_id = %L', t073.u(110))),
          0, 'another organisation and a stranger read zero teams and zero judges');
select is(left(t073.run_as('anon', null, format('update public.btc_teams set country_code = %L where event_id = %L', 'SG', t073.u(110))), 5),
          '42501', 'anon is refused on btc_teams');
select is(left(t073.run_as('anon', null, format('update public.btc_judges set country_code = %L where event_id = %L', 'SG', t073.u(110))), 5),
          '42501', 'anon is refused on btc_judges');
select is((select count(*)::int from btc_teams where event_id = t073.u(110) and country_code = 'BN'), 2, 'no refused write changed a team');

-- the demo stays country-less
select is(t073.run_as('authenticated', t073.u(1), format('select public.load_btc_demo(%L, %L, false)', t073.u(100), t073.u(120))),
          'ok', 'load_btc_demo still runs on a test event');
select is((select count(*)::int from btc_teams where event_id = t073.u(120) and (country_code is not null or represents is not null))
        + (select count(*)::int from btc_judges where event_id = t073.u(120) and country_code is not null),
          0, 'the demo leaves every country and represents NULL');

select * from finish();
rollback;
