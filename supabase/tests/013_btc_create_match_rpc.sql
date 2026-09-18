-- T-BTC.2 create_btc_match RPC — plan doc §6 AC.
-- Proves: atomic creation (match + exactly 3 judge assignments), every
-- validation branch rejects, and a non-member is blocked by ordinary RLS
-- (this RPC deliberately has no membership check of its own).
begin;
select plan(11);

-- ---------- fixtures (as postgres, bypasses RLS) ----------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org');

insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'btc', 'Test BTC Event');

-- A second event/org, for the "team/judge belongs to a DIFFERENT event"
-- rejection tests below.
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000020',
   'btc', 'Other Org Event');

insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Team A'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Team B'),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e2', 'Other Team');

insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'Judge One'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 'Judge Two'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1', 'Judge Three'),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000e2', 'Other Judge');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- validation branches ----------

select throws_ok(
  $$ select create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1',
       array['00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c2'::uuid,
             '00000000-0000-0000-0000-0000000000c3'::uuid]) $$,
  'P0001',
  'create_btc_match: a team cannot play itself',
  'rejects a team playing itself'
);

select throws_ok(
  $$ select create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       array['00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c2'::uuid]) $$,
  'P0001',
  'create_btc_match: exactly 3 distinct judges are required',
  'rejects fewer than 3 judges'
);

select throws_ok(
  $$ select create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       array['00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c2'::uuid]) $$,
  'P0001',
  'create_btc_match: exactly 3 distinct judges are required',
  'rejects 3 judges with a duplicate (only 2 distinct)'
);

select throws_ok(
  $$ select create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b9',
       array['00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c2'::uuid,
             '00000000-0000-0000-0000-0000000000c3'::uuid]) $$,
  'P0001',
  'create_btc_match: team2 does not belong to this event',
  'rejects a team from a different event'
);

select throws_ok(
  $$ select create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       array['00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c2'::uuid,
             '00000000-0000-0000-0000-0000000000c9'::uuid]) $$,
  'P0001',
  'create_btc_match: all judges must belong to this event',
  'rejects a judge from a different event'
);

-- ---------- successful, atomic creation ----------

select is(
  (select round from create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
     '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
     array['00000000-0000-0000-0000-0000000000c1'::uuid,
           '00000000-0000-0000-0000-0000000000c2'::uuid,
           '00000000-0000-0000-0000-0000000000c3'::uuid])),
  'preliminary',
  'creates a match and returns its round'
);

select is(
  (select count(*)::int from btc_matches
     where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'exactly one match row exists after the successful call'
);

select is(
  (select count(*)::int from btc_match_judges mj
     join btc_matches m on m.id = mj.match_id
     where m.event_id = '00000000-0000-0000-0000-0000000000e1'),
  3,
  'all 3 judge assignments were written atomically alongside the match'
);

select is(
  (select array_agg(judge_id order by judge_id)::text from btc_match_judges mj
     join btc_matches m on m.id = mj.match_id
     where m.event_id = '00000000-0000-0000-0000-0000000000e1'),
  (select array_agg(id order by id)::text from btc_judges
     where id in ('00000000-0000-0000-0000-0000000000c1',
                  '00000000-0000-0000-0000-0000000000c2',
                  '00000000-0000-0000-0000-0000000000c3')),
  'the exact 3 judges passed in were assigned, no more no less'
);

reset role;
reset request.jwt.claim.sub;

-- ---------- non-member is blocked by ordinary RLS, not a bespoke check ----------
-- Since this function is SECURITY INVOKER, its own team/judge "belongs to
-- this event" validation SELECTs run under the CALLER's RLS too — for a
-- non-member, btc_teams_read already hides every row in this event, so the
-- validation raises its own "does not belong to this event" error before
-- ever reaching the insert. This is a real, useful property (a non-member
-- can't distinguish "this team doesn't exist" from "you can't see it" —
-- the same enumeration-oracle concern this project's own Guess the Bean
-- port already documented closing elsewhere), not a gap: no path reaches
-- the actual write.

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select create_btc_match('00000000-0000-0000-0000-0000000000e1', 'preliminary',
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
       array['00000000-0000-0000-0000-0000000000c1'::uuid,
             '00000000-0000-0000-0000-0000000000c2'::uuid,
             '00000000-0000-0000-0000-0000000000c3'::uuid]) $$,
  'P0001',
  'create_btc_match: team1 does not belong to this event',
  'a non-member is rejected before the insert — RLS on btc_teams hides the row entirely, so the function''s own validation fails first'
);

reset role;
reset request.jwt.claim.sub;

-- Read as postgres (bypasses RLS) — the count check itself must not run
-- under the outsider's own role, or RLS would hide the real, pre-existing
-- match row regardless of whether the rejected call above left anything
-- behind, making the assertion meaningless either way.
select is(
  (select count(*)::int from btc_matches
     where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'the rejected non-member call left no partial match behind — still exactly one'
);

select * from finish();
rollback;
