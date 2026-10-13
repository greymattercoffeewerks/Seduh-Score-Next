-- T-TEN.D6: anonymous surfaces, contract step.
-- Proves: anon holds no privilege at all on `events` (table or column, read or write) and no policy gives
-- it a row, so an organisation's events cannot be listed anonymously; anon and signed-in callers see
-- live sessions that are ACTIVE only (a superseded session's payload is no longer public); an organisation's
-- own members still read every session of their own organisation and write them, and still read their
-- events, while a signed-in non-member sees none of either; and the doors that replaced the old reads
-- (public_org_by_slug, public_event_summary), the public results archive and the live session write path
-- all still work afterwards.
-- (Every read of live_sessions below is limited to the fixture organisations, so the file also passes on a
-- local database that already holds other rows.)
-- Fixtures: org Alpha (member user_a): an active session on event 1 and a finished one on event 2;
-- org Bravo (member user_b): one active session. user_c belongs to nobody.
begin;
select plan(31);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'c@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Alpha Coffee', 'alpha-coffee'),
  ('00000000-0000-0000-0000-0000000000b0', 'Bravo Roasters', 'bravo-roasters');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002', 'owner');
insert into events (id, org_id, format, name, event_date, is_test, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Alpha Live Night', '2026-10-04', false, '2026-10-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Alpha Last Month',  '2026-09-04', false, '2026-09-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000b0', 'btc',        'Bravo Cup',         '2026-11-05', false, '2026-10-03 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000b0', 'btc',        'Bravo Old Cup',     '2026-06-05', false, '2026-06-03 10:00:00+00');
insert into live_sessions (id, org_id, event_id, format, active, payload) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster', true,  '{"tag":"alpha-live"}'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', 'cup_taster', false, '{"tag":"alpha-finished"}'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000e3', 'btc',        true,  '{"tag":"bravo-live"}'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000e4', 'btc',        false, '{"tag":"bravo-finished"}');
insert into public_results (org_id, event_id, payload) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', '{"format":"cup_taster","eventName":"Alpha Last Month"}');

-- ============ the mechanism (as postgres: what is granted and which policies exist) ============

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'events' and 'anon' = any (roles)),
  0,
  'no policy on events names anon'
);
select is(
  (select count(*)::int from pg_policies where policyname = 'events_read_public'),
  0,
  'events_read_public is gone'
);
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'events' and grantee = 'anon'),
  0,
  'anon holds no table-level privilege on events'
);
select is(
  (select count(*)::int
     from pg_attribute a
    where a.attrelid = 'public.events'::regclass and a.attnum > 0 and not a.attisdropped
      and (has_column_privilege('anon', a.attrelid, a.attnum, 'select')
        or has_column_privilege('anon', a.attrelid, a.attnum, 'insert')
        or has_column_privilege('anon', a.attrelid, a.attnum, 'update')
        or has_column_privilege('anon', a.attrelid, a.attnum, 'references'))),
  0,
  'and no column-level privilege either, on any column'
);
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'live_sessions' and grantee = 'anon'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0,
  'anon holds no write privilege on live_sessions (RLS is not the only barrier)'
);
select is(
  (select qual from pg_policies where tablename = 'live_sessions' and policyname = 'live_sessions_read'),
  'active',
  'live_sessions_read shows active rows only'
);
select is(
  (select roles::text from pg_policies where tablename = 'live_sessions' and policyname = 'live_sessions_read'),
  '{anon,authenticated}',
  'to anon and authenticated, as roles'
);
select is(
  (select roles::text from pg_policies where tablename = 'live_sessions' and policyname = 'live_sessions_write'),
  '{authenticated}',
  'live_sessions_write applies to signed-in callers only (a role-less FOR ALL policy would run is_org_member for anon)'
);
select is(
  (select cmd from pg_policies where tablename = 'live_sessions' and policyname = 'live_sessions_read'),
  'SELECT',
  'for reads only'
);

-- ============ anon: events ============

set local role anon;

select throws_ok($$ select name from events $$, '42501', null, 'anon cannot read events.name');
select throws_ok($$ select id from events $$, '42501', null, 'anon cannot read events.id');
select throws_ok($$ select count(*) from events $$, '42501', null, 'anon cannot even count events');
select throws_ok($$ select * from events $$, '42501', null, 'and select * is refused');
select throws_ok(
  $$ insert into events (org_id, format, name) values
       ('00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Anon Attempt') $$,
  '42501', null,
  'anon cannot write events'
);

-- ============ anon: live sessions ============

select is(
  (select array_agg(payload ->> 'tag' order by payload ->> 'tag') from live_sessions where org_id in ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0')),
  array['alpha-live', 'bravo-live'],
  'anon sees the two active sessions and nothing else'
);
select is(
  (select count(*)::int from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e2'),
  0,
  'a superseded session is invisible to anon, even when asked for by its event'
);
select is(
  (select count(*)::int from live_sessions where org_id = '00000000-0000-0000-0000-0000000000a0' and active),
  1,
  'the audience''s own query (this org, active) still finds the live session'
);
select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format, active) values
       ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', 'cup_taster', true) $$,
  '42501', null,
  'anon cannot write live_sessions'
);

-- ============ anon: the doors that replaced the reads still answer ============

select results_eq(
  $$ select id from public_org_by_slug('alpha-coffee') $$,
  $$ values ('00000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'public_org_by_slug still turns a slug into an organisation'
);
select is(
  (select name from public_event_summary('00000000-0000-0000-0000-0000000000a0')),
  'Alpha Live Night',
  'public_event_summary still gives the newest event, without anon being able to read events'
);
select is(
  (select count(*)::int from (select event_id, payload, published_at from public_results where org_id = '00000000-0000-0000-0000-0000000000a0') r),
  1,
  'and the public results archive is unchanged'
);

reset role;

-- ============ signed in, not a member ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select is(
  (select array_agg(payload ->> 'tag' order by payload ->> 'tag') from live_sessions where org_id in ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0')),
  array['alpha-live', 'bravo-live'],
  'a signed-in non-member sees the active sessions only, like anon'
);
select is((select count(*)::int from events), 0, 'and no events of anyone');

reset role;

-- ============ a member: their own organisation, every state ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select is(
  (select array_agg(payload ->> 'tag' order by payload ->> 'tag') from live_sessions where org_id in ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0')),
  array['alpha-finished', 'alpha-live', 'bravo-live'],
  'a member sees their own organisation''s superseded session as well, the other organisation''s active one, and not that organisation''s superseded one'
);
select is(
  (select array_agg(name order by name) from events),
  array['Alpha Last Month', 'Alpha Live Night'],
  'a member still reads their own events, and only theirs'
);
select is(
  (select count(*)::int from live_sessions where org_id = '00000000-0000-0000-0000-0000000000a0' and active),
  1,
  'findActiveLiveEventId''s query (own organisation, active) still finds the live session'
);

-- writes still work for the member, in their own organisation only
update live_sessions set payload = '{"tag":"alpha-live-2"}' where id = '00000000-0000-0000-0000-0000000000a1';
select is(
  (select payload ->> 'tag' from live_sessions where id = '00000000-0000-0000-0000-0000000000a1'),
  'alpha-live-2',
  'a member can still update their own live session'
);
update live_sessions set payload = '{"tag":"hijacked"}' where id = '00000000-0000-0000-0000-0000000000a3';
select is(
  (select payload ->> 'tag' from live_sessions where id = '00000000-0000-0000-0000-0000000000a3'),
  'bravo-live',
  'and cannot touch another organisation''s'
);
select lives_ok(
  $$ select publish_session(gen_random_uuid(), '00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', 'cup_taster', false, '{"tag":"alpha-republished"}'::jsonb, now()) $$,
  'publish_session (the real write path) still runs for a member after the contract'
);
select is(
  (select array_agg(payload ->> 'tag' order by payload ->> 'tag') from live_sessions where org_id = '00000000-0000-0000-0000-0000000000a0'),
  array['alpha-live-2', 'alpha-republished'],
  'and it switches which of the organisation''s sessions is live, as before (the older one is kept, inactive)'
);

reset role;

-- the same swap, seen by an anonymous audience: only the newly active session is visible
set local role anon;
select is(
  (select array_agg(payload ->> 'tag' order by payload ->> 'tag') from live_sessions where org_id = '00000000-0000-0000-0000-0000000000a0'),
  array['alpha-republished'],
  'after the swap, anon sees the new live session and not the one it replaced'
);
reset role;

select * from finish();
rollback;
