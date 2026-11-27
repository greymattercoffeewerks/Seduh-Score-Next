-- load_demo_roster: one call puts 8 demo people (reserved fictional phones) on a Cup Taster or Throwdown TEST event's
-- roster, additively and repeatably. See 20261130100000_load_demo_roster.sql.
-- Proves: it loads 8 on each format; it is idempotent (no second set, no duplicate people); it never deletes (a typed
-- entry survives); a withdrawn demo entry is reinstated; a real event, a BTC event, another org's event and a
-- non-member are refused with a hint; a demo person has no Seduh ID link; the phones are valid E.164 and the names
-- say Demo; anon cannot execute it.
begin;
select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@t094.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@t094.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'other-org@t094.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'T094 Org', 't094-org'),
  ('00000000-0000-0000-0000-000000000020', 'T094 Other', 't094-other');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000006', 'organiser');
-- e1 Cup Taster test, e2 Throwdown test, e3 REAL Cup Taster, e4 BTC test, e5 another org's test Cup Taster
insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'T094 Cup', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'throwdown', 'T094 Throwdown', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'T094 Real', false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000010', 'btc', 'T094 BTC', true),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000020', 'cup_taster', 'T094 Foreign', true);
-- a hand-typed entry on e1 that a load must leave alone
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'Typed By Hand');

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $f$
declare h text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, '(no hint)');
end $f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- loading ----------
select lives_ok($$ select set_config('test.reply', public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')::text, false) $$, 'loading into a Cup Taster test event works');
select is(current_setting('test.reply')::jsonb ->> 'added', '8', 'it reports 8 added');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1' and not withdrawn), 9, '8 demo entries plus the typed one are on the roster');
select is((select count(*)::int from event_entries where id = '00000000-0000-0000-0000-0000000000f1'), 1, 'the hand-typed entry survives (a load never deletes)');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010'), 8, '8 demo people were made');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010' and display_name like 'Demo %' and notes like 'Demo data%'), 8, 'every one is named Demo and carries the demo note');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010' and phone ~ '^\+[1-9][0-9]{7,14}$'), 8, 'every phone is canonical E.164');
select is((select count(distinct phone)::int from people where org_id = '00000000-0000-0000-0000-000000000010'), 8, 'and they are all different');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010' and phone like '+447700900%'), 8, 'all in the reserved drama range (never a real subscriber)');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010' and global_person_id is not null), 0, 'no demo person has a Seduh ID link');

-- ---------- idempotent ----------
select lives_ok($$ select set_config('test.reply', public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')::text, false) $$, 'loading a second time works');
select is(current_setting('test.reply')::jsonb ->> 'added', '0', 'and adds nothing');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1'), 9, 'still 8 demo plus the typed one');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010'), 8, 'and still 8 people');

-- ---------- a withdrawn demo entry comes back ----------
update event_entries set withdrawn = true
 where event_id = '00000000-0000-0000-0000-0000000000e1' and display_name = 'Demo Bella';
select lives_ok($$ select set_config('test.reply', public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')::text, false) $$, 'a load after a withdrawal works');
select is(current_setting('test.reply')::jsonb ->> 'reinstated', '1', 'it reinstates the withdrawn one');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1' and not withdrawn), 9, 'back to 9 active');

-- ---------- Throwdown shares the same people ----------
select lives_ok($$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$, 'loading into a Throwdown test event works');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e2'), 8, '8 competitors');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010'), 8, 'reusing the same 8 people, none duplicated');

-- ---------- refusals ----------
select is(pg_temp.hint_of($q$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') $q$), 'demo_not_test', 'a REAL event is refused');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e3'), 0, 'and gets no entries');
select is(pg_temp.hint_of($q$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e4') $q$), 'demo_roster_format', 'a BTC event is refused (it has its own demo)');
select is(pg_temp.hint_of($q$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e5') $q$), 'demo_event_not_found', 'another org''s event, named with my org id, is not found');
select is(pg_temp.hint_of($q$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000dead') $q$), 'demo_event_not_found', 'an unknown event is not found');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is(pg_temp.hint_of($q$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $q$), 'demo_event_not_found', 'a member of ANOTHER org gets the same answer');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is(pg_temp.hint_of($q$ select public.load_demo_roster('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $q$), 'demo_event_not_found', 'and a user in no org');
reset role;

select is(has_function_privilege('anon', 'public.load_demo_roster(uuid, uuid)', 'execute'), false, 'anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.load_demo_roster(uuid, uuid)', 'execute'), true, 'authenticated can');
select * from finish();
rollback;
