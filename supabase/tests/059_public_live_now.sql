-- The homepage "live now" bar: events.list_on_homepage (opt-in, default off) and the anonymous door
-- public_live_now() (migration 20261029100000).
-- Proves: the flag defaults to off; anon cannot read or write it (events is closed to anon); the door lists a
-- live event only when ALL of these hold: the organiser opted in, the event and its session are not test,
-- the event has not ended, the session is ACTIVE and changed within 12 hours; each missing condition is shown
-- to hide an otherwise-qualifying event; the door returns typed rows with exactly the public columns (no ids,
-- no payload); it is capped at 3 rows with the true count alongside; a member can set the flag on their own
-- organisation's event and a non-member cannot (zero rows touched); and the door's privileges and search_path.
-- Every slug is prefixed 'live59-' and every assertion filters on it. The door caps itself at 3 rows BEFORE that
-- filter, so the file assumes a database with no other opted-in live events (CI and `db:reset` start empty).
-- Fixtures (all sessions active unless stated; all events listed unless stated):
--   good1  Cup Taster, fresh         good2  BTC, fresh
--   noopt  not opted in              testev events.is_test                 testss live_sessions.is_test
--   stale  session 13 h old          ended  events.ended_at set            inact  session not active
--   fresh12 session 11 h old (still listed: the boundary is 12 h)
begin;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000591', 'm@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000592', 'outsider@test.seduh-next');

create schema t59;
grant usage on schema t59 to anon, authenticated;
-- how many rows an UPDATE of the flag touched, as the calling role (a data-modifying CTE is not allowed in a subquery)
create function t59.setflag(p_event uuid, p_value boolean) returns int language plpgsql as $$
declare n int;
begin
  update events set list_on_homepage = p_value where id = p_event;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function t59.setflag(uuid, boolean) to anon, authenticated;

create function pg_temp.fx(tag text, n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-' || tag || '-' || lpad(n::text, 12, '0'))::uuid
$$;

do $fixture$
declare
  r record;
begin
  for r in select * from (values
    -- tag, slug, event name, event format, list, is_test, ended, ls active, ls is_test, ls age
    ('5901', 'good1',   'Good One',     'cup_taster', true,  false, false, true,  false, interval '1 minute'),
    ('5902', 'good2',   'Good Two',     'btc',        true,  false, false, true,  false, interval '2 minutes'),
    ('5903', 'noopt',   'Not Opted In', 'cup_taster', false, false, false, true,  false, interval '1 minute'),
    ('5904', 'testev',  'Test Event',   'cup_taster', true,  true,  false, true,  false, interval '1 minute'),
    ('5905', 'testss',  'Test Session', 'cup_taster', true,  false, false, true,  true,  interval '1 minute'),
    ('5906', 'stale',   'Stale Event',  'cup_taster', true,  false, false, true,  false, interval '13 hours'),
    ('5907', 'ended',   'Ended Event',  'cup_taster', true,  false, true,  true,  false, interval '1 minute'),
    ('5908', 'inact',   'Inactive',     'cup_taster', true,  false, false, false, false, interval '1 minute'),
    ('5909', 'fresh12', 'Eleven Hours', 'cup_taster', true,  false, false, true,  false, interval '11 hours')
  ) as v(tag, slug, ename, fmt, listed, is_test, ended, ls_active, ls_test, age)
  loop
    insert into orgs (id, name, slug) values (pg_temp.fx(r.tag, 1), 'Org ' || r.slug, 'live59-' || r.slug);
    insert into events (id, org_id, format, name, is_test, list_on_homepage)
      values (pg_temp.fx(r.tag, 2), pg_temp.fx(r.tag, 1), r.fmt, r.ename, r.is_test, r.listed);
    if r.ended then
      update events set ended_at = now(), ended_via = 'organiser' where id = pg_temp.fx(r.tag, 2);
    end if;
    insert into live_sessions (org_id, event_id, format, active, is_test, payload, updated_at)
      values (pg_temp.fx(r.tag, 1), pg_temp.fx(r.tag, 2), r.fmt, r.ls_active, r.ls_test,
              '{"secret":"participant data"}', now() - r.age);
  end loop;
end
$fixture$;

insert into org_members (org_id, user_id, role) values
  (pg_temp.fx('5901', 1), '00000000-0000-0000-0000-000000000591', 'owner');

-- ============ the default ============

select is(
  (select list_on_homepage from events where id = pg_temp.fx('5903', 2)),
  false,
  'an event is NOT listed unless the organiser opted in: the column is false for the fixture that never ticked it');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'list_on_homepage'),
  'false',
  'and false is the column default, so every existing and future event starts unlisted');

-- ============ anon: the door, and nothing else ============

set local role anon;

select is(
  (select string_agg(org_slug, ', ' order by org_slug) from public_live_now() where org_slug like 'live59-%'),
  'live59-fresh12, live59-good1, live59-good2',
  'anon sees exactly the opted-in, non-test, not-ended, active, fresh events (11 hours old still counts)');
select is(
  (select count(*)::int from public_live_now() where org_slug in
     ('live59-noopt', 'live59-testev', 'live59-testss', 'live59-stale', 'live59-ended', 'live59-inact')),
  0,
  'and none of: not opted in, test event, test session, 13-hour-old session, ended event, inactive session');
select is(
  (select count(*)::int from public_live_now() where org_slug like 'live59-%' and kind <> 'live'),
  0,
  'every row is typed kind = live (so a later row type can be added without changing the page)');
select is(
  (select event_name || ' / ' || org_name || ' / ' || format from public_live_now() where org_slug = 'live59-good2'),
  'Good Two / Org good2 / btc',
  'a row carries the event name, the organiser name and the format');

reset role;
select is(
  pg_get_function_result('public.public_live_now()'::regprocedure),
  'TABLE(kind text, event_name text, org_name text, org_slug text, format text, last_activity_at timestamp with time zone, listed_count bigint)',
  'the door returns exactly these public columns: no event or organisation id, no payload, no person');
set local role anon;

select throws_ok(
  $$ select list_on_homepage from events $$,
  '42501', null,
  'anon cannot read the flag: events is closed to anon');
select throws_ok(
  $$ update events set list_on_homepage = true $$,
  '42501', null,
  'anon cannot set the flag');
select throws_ok(
  $$ select * from live_sessions where false and list_on_homepage $$,
  '42703', null,
  'the flag is not a column of live_sessions (the anon-readable table)');

reset role;

-- ============ the freshness window follows the session's last change ============

-- the stale session is touched by a publish (any update advances updated_at): it qualifies again
update live_sessions set payload = '{}'::jsonb where event_id = pg_temp.fx('5906', 2);
set local role anon;
select is(
  (select count(*)::int from public_live_now() where org_slug = 'live59-stale'),
  1,
  'a session that was stale becomes listed again the moment it changes (publish_session advances updated_at)');
reset role;
-- ...and the window is 12 hours
-- set_updated_at fires on every update and rewrites updated_at, so make it old with the trigger off
alter table live_sessions disable trigger trg_live_sessions_set_updated_at;
update live_sessions set updated_at = now() - interval '12 hours 1 minute' where event_id = pg_temp.fx('5906', 2);
alter table live_sessions enable trigger trg_live_sessions_set_updated_at;
set local role anon;
select is(
  (select count(*)::int from public_live_now() where org_slug = 'live59-stale'),
  0,
  'a session 12 hours and 1 minute old is not listed');
reset role;

-- ============ who may set the flag ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000592';
select is(
  t59.setflag(pg_temp.fx('5903', 2), true),
  0,
  'a signed-in non-member touches zero rows when they try to list another organisation''s event');
select is(
  t59.setflag(pg_temp.fx('5901', 2), false),
  0,
  '...and cannot unlist one either');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000591';
select is(
  t59.setflag(pg_temp.fx('5901', 2), false),
  1,
  'a member of the organisation can unlist their own event');
reset role;
select is(
  (select list_on_homepage from events where id = pg_temp.fx('5901', 2)),
  false,
  'and it is now unlisted');
set local role anon;
select is(
  (select count(*)::int from public_live_now() where org_slug = 'live59-good1'),
  0,
  'the bar drops it at once');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000591';
select is(
  t59.setflag(pg_temp.fx('5901', 2), true),
  1,
  'and can list it again');
-- a member cannot list the event of an organisation they do not belong to
select is(
  t59.setflag(pg_temp.fx('5902', 2), true),
  0,
  'a member of one organisation cannot list another organisation''s event');
reset role;
reset request.jwt.claim.sub;

-- ============ the cap ============

insert into orgs (id, name, slug)
select pg_temp.fx('5950', n), 'Org cap' || n, 'live59-cap' || n from generate_series(1, 4) n;
insert into events (id, org_id, format, name, list_on_homepage)
select pg_temp.fx('5951', n), pg_temp.fx('5950', n), 'cup_taster', 'Cap ' || n, true from generate_series(1, 4) n;
insert into live_sessions (org_id, event_id, format, active)
select pg_temp.fx('5950', n), pg_temp.fx('5951', n), 'cup_taster', true from generate_series(1, 4) n;

set local role anon;
select is((select count(*)::int from public_live_now()), 3, 'the door returns at most 3 rows');
select ok(
  (select min(listed_count) >= 7 from public_live_now()),
  'and tells the page how many events are listed in all (at least our 7), so it can say "+N more"');
reset role;

-- ============ a window-locked event (entitlements) ============

-- an organisation on the lowest plan whose event grant has ended: locked once the key is enforced
insert into orgs (id, name, slug) values (pg_temp.fx('5960', 1), 'Org locked', 'live59-locked');
insert into events (id, org_id, format, name, list_on_homepage)
  values (pg_temp.fx('5960', 2), pg_temp.fx('5960', 1), 'cup_taster', 'Locked Event', true);
-- updated_at is set explicitly and strictly newer than every other row: now() is frozen inside this transaction, so a
-- default would tie with the four cap sessions above, and the door's `limit 3` would then keep or cut this row by the
-- random live_sessions.id (the test failed about 4 runs in 10)
insert into live_sessions (org_id, event_id, format, active, updated_at)
  values (pg_temp.fx('5960', 1), pg_temp.fx('5960', 2), 'cup_taster', true, now() + interval '1 second');
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (pg_temp.fx('5960', 1), pg_temp.fx('5960', 2), 'per_event', now() - interval '10 days', now() - interval '1 day', 'manual');

set local role anon;
select is((select count(*)::int from public_live_now() where org_slug = 'live59-locked'), 1,
  'before the window lock is enforced an event whose grant ended is still listed (nothing changed for it)');
reset role;
update app.entitlement_keys set enforced = true where key = 'event_window_lock';
set local role anon;
select is((select count(*)::int from public_live_now() where org_slug = 'live59-locked'), 0,
  'once the window lock is enforced, a locked event is NOT listed');
reset role;

-- ============ privileges ============

select ok(
  has_function_privilege('anon', 'public.public_live_now()', 'execute')
  and has_function_privilege('authenticated', 'public.public_live_now()', 'execute')
  and not has_function_privilege('service_role', 'public.public_live_now()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                   where p.oid = 'public.public_live_now()'::regprocedure and a.grantee = 0),
  'executable by anon and signed-in callers only: not public, not service_role');
select ok(
  (select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.public_live_now()'::regprocedure),
  'a stable SECURITY DEFINER function with an empty search_path');

select * from finish();
rollback;
