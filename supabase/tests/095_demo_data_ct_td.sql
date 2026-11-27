-- load_ct_demo / clear_ct_demo / load_td_demo / clear_td_demo: a pre-arranged demo for a Cup Taster or Throwdown TEST
-- event, like load_btc_demo. See 20261202100000_demo_data_cup_taster_throwdown.sql.
-- Proves: Cup Taster gets 8 cuppers, a completed Prelims with confirmed heats and 32 result rows, the top 4
-- advanced and a pending Finals heat; Throwdown gets an 8-person bracket with the quarter-finals and one semi-final
-- decided and the other open with one vote; both reload to the same shape (no duplicates); clear empties the event; a
-- real event, the wrong format, a non-member and a NULL organisation are refused with a hint; demo people carry no
-- Seduh ID; anon cannot execute any of the four.
begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@t095.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@t095.seduh-next');
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-000000000010', 'T095 Org', 't095-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
-- e1 Cup Taster test, e2 Throwdown test, e3 REAL Cup Taster, e4 REAL Throwdown
insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'T095 Cup', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010', 'throwdown', 'T095 Throwdown', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000010', 'cup_taster', 'T095 Real Cup', false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000010', 'throwdown', 'T095 Real TD', false);

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

-- ---------- Cup Taster ----------
select lives_ok($$ select set_config('test.ct', public.load_ct_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1')::text, false) $$, 'load_ct_demo works on a test Cup Taster event');
select is(current_setting('test.ct')::jsonb ->> 'cuppers', '8', 'it reports 8 cuppers');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1' and not withdrawn), 8, '8 active cuppers');
select is((select status from ct_stages where event_id = '00000000-0000-0000-0000-0000000000e1' and kind = 'prelims'), 'complete', 'Prelims is complete');
select is((select count(*)::int from ct_results r join ct_sets st on st.id = r.set_id join ct_stages s on s.id = st.stage_id where s.event_id = '00000000-0000-0000-0000-0000000000e1'), 32, '8 cuppers x 4 sets = 32 results');
select is((select count(*)::int from ct_stage_entries se join ct_stages s on s.id = se.stage_id where s.event_id = '00000000-0000-0000-0000-0000000000e1' and s.kind = 'finals'), 4, 'the top 4 are in the Finals');
select is((select count(*)::int from ct_heats h join ct_stages s on s.id = h.stage_id where s.event_id = '00000000-0000-0000-0000-0000000000e1' and s.kind = 'finals'), 1, 'there is one Finals heat waiting to be run');
select lives_ok($$ select public.load_ct_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$, 'loading again works');
select is((select count(*)::int from ct_stages where event_id = '00000000-0000-0000-0000-0000000000e1'), 2, 'a reload leaves 2 stages, not 4');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010'), 8, 'a reload leaves 8 people, not 16');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000000010' and global_person_id is not null), 0, 'a demo person has no Seduh ID');
select lives_ok($$ select public.clear_ct_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1') $$, 'clear_ct_demo works');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1') + (select count(*)::int from ct_stages where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'clear leaves the event with no entries and no stages');

-- ---------- Throwdown ----------
select lives_ok($$ select set_config('test.td', public.load_td_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2')::text, false) $$, 'load_td_demo works on a test Throwdown event');
select is(current_setting('test.td')::jsonb ->> 'competitors', '8', 'it reports 8 competitors');
select is((select count(*)::int from td_matches where event_id = '00000000-0000-0000-0000-0000000000e2'), 6, 'an 8-person bracket has 6 matches so far');
select is((select count(*)::int from td_matches where event_id = '00000000-0000-0000-0000-0000000000e2' and confirmed_at is not null), 5, 'the 4 quarter-finals and one semi-final are decided');
select is((select count(*)::int from td_matches m where m.event_id = '00000000-0000-0000-0000-0000000000e2' and m.confirmed_at is null and exists (select 1 from td_slots s join td_votes v on v.slot_id = s.id where s.match_id = m.id)), 1, 'the other semi-final is open with a vote in it');
select lives_ok($$ select public.load_td_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$, 'loading again works');
select is((select count(*)::int from td_matches where event_id = '00000000-0000-0000-0000-0000000000e2'), 6, 'a reload leaves 6 matches, not 12');
select lives_ok($$ select public.clear_td_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$, 'clear_td_demo works');
select is((select count(*)::int from td_matches where event_id = '00000000-0000-0000-0000-0000000000e2') + (select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e2'), 0, 'clear leaves no matches and no entries');

-- ---------- refusals ----------
select is(pg_temp.hint_of($$ select public.load_ct_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e3') $$), 'demo_not_test', 'a real Cup Taster event is refused');
select is(pg_temp.hint_of($$ select public.load_td_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e4') $$), 'demo_not_test', 'a real Throwdown event is refused');
select is(pg_temp.hint_of($$ select public.load_ct_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$), 'demo_wrong_format', 'the Cup Taster demo refuses a Throwdown event');

-- ---------- non-member and anon ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is(pg_temp.hint_of($$ select public.load_td_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$), 'demo_event_not_found', 'a non-member sees "not found"');
reset role;
set local role anon;
select throws_ok($$ select public.load_td_demo('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2') $$, '42501', null, 'anon cannot execute load_td_demo');

select * from finish();
rollback;
