-- T-TEN.B2: no row may reference a parent in another org (or event).
-- Proves, for a user who belongs to BOTH orgs (the case row-level security alone cannot
-- tell apart): a stage cannot be given another org's roster entry; a heat cannot be given
-- another org's entry; the same holds for an entry from a different event of the SAME org;
-- a set cannot be re-pointed at another org's stage; an entry with no person cannot be
-- moved to another org's event; a BTC match's judge assignment cannot be re-pointed at
-- another org's match and judge; the ordinary same-event writes still work; an anonymous
-- caller can write none of it. Every refusal pins its error text. The two same-event checks
-- raise the standard row-level-security refusal (42501) on purpose, so a non-member cannot
-- tell them apart from any other refused write; the valid same-event inserts in this file
-- pass row-level security, which is what shows the refusals come from the new triggers.
--   org A (events A1, A2), org B (event B1); user_a (A only), user_ab (both).
begin;
select plan(20);

-- ============ fixtures (as postgres, bypasses RLS) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'user-ab@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000003', 'organiser');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A2'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Event B1');
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Cupper A1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', 'Cupper A2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1', 'Cupper B1');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'prelims', 1, 1, 480),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'prelims', 1, 1, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 1);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 1, 480);
-- BTC rows (btc tables do not check the event's format): one match with one judge in each org.
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a1', 'A-one'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000a1', 'A-two'),
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000b1', 'B-one'),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000000b1', 'B-two');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000ac1', '00000000-0000-0000-0000-0000000000a1', 'Judge A'),
  ('00000000-0000-0000-0000-000000000bc1', '00000000-0000-0000-0000-0000000000b1', 'Judge B');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-000000000ad1', '00000000-0000-0000-0000-0000000000a1', 'preliminary',
   '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a02'),
  ('00000000-0000-0000-0000-000000000bd1', '00000000-0000-0000-0000-0000000000b1', 'preliminary',
   '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000b02');
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-000000000ad1', '00000000-0000-0000-0000-000000000ac1'),
  ('00000000-0000-0000-0000-000000000bd1', '00000000-0000-0000-0000-000000000bc1');

-- ============ user_ab: stage entries ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ insert into ct_stage_entries (stage_id, entry_id)
     values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3') $$,
  '42501',
  'new row violates row-level security policy for table "ct_stage_entries"',
  'org A''s stage cannot be given org B''s roster entry'
);
select throws_ok(
  $$ insert into ct_stage_entries (stage_id, entry_id)
     values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c2') $$,
  '42501',
  'new row violates row-level security policy for table "ct_stage_entries"',
  'nor an entry from a different event of the same org'
);
select lives_ok(
  $$ insert into ct_stage_entries (stage_id, entry_id)
     values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1') $$,
  'a stage can still be given an entry from its own event'
);

-- ============ user_ab: heat entries ============

select throws_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, station)
     values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c3', 'Table A') $$,
  '42501',
  'new row violates row-level security policy for table "ct_heat_entries"',
  'org A''s heat cannot be given org B''s roster entry'
);
select throws_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, station)
     values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c2', 'Table A') $$,
  '42501',
  'new row violates row-level security policy for table "ct_heat_entries"',
  'nor an entry from a different event of the same org'
);
select lives_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, station)
     values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'Table A') $$,
  'a heat can still be given an entry from its own event'
);

-- ============ user_ab: a set cannot be re-pointed at another org's stage ============

select throws_ok(
  $$ update ct_sets set stage_id = '00000000-0000-0000-0000-0000000000d2'
      where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23001',
  'ct_sets.stage_id is immutable',
  'a set cannot be moved to another org''s stage'
);
select lives_ok(
  $$ update ct_sets set label = 'Set one' where id = '00000000-0000-0000-0000-0000000000e1' $$,
  'but a set''s label can still be edited'
);

-- ============ user_ab: a roster entry with no person cannot change event ============

select throws_ok(
  $$ update event_entries set event_id = '00000000-0000-0000-0000-0000000000b1'
      where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23001',
  'event_entries.event_id is immutable',
  'a roster entry with no person cannot be moved to another org''s event'
);
select throws_ok(
  $$ update event_entries set event_id = '00000000-0000-0000-0000-0000000000a2'
      where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23001',
  'event_entries.event_id is immutable',
  'nor to another event of the same org'
);
select lives_ok(
  $$ update event_entries set display_name = 'Cupper A1 (renamed)' where id = '00000000-0000-0000-0000-0000000000c1' $$,
  'but its name can still be edited'
);

-- ============ the id columns are frozen too ============

select throws_ok(
  $$ update ct_sets set id = gen_random_uuid() where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23001', 'ct_sets.id is immutable',
  'a set''s id cannot be changed'
);
select throws_ok(
  $$ update event_entries set id = gen_random_uuid() where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23001', 'event_entries.id is immutable',
  'nor a roster entry''s id'
);

-- ============ a BTC judge assignment cannot be walked into another org ============

select throws_ok(
  $$ update btc_match_judges
        set match_id = '00000000-0000-0000-0000-000000000bd1',
            judge_id = '00000000-0000-0000-0000-000000000bc1'
      where match_id = '00000000-0000-0000-0000-000000000ad1' $$,
  '23001', 'btc_match_judges.match_id is immutable',
  'a two-org member cannot re-point a judge assignment at the other org''s match AND judge together'
);

-- ============ user_a (A only): refused the same way, and nothing leaks ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ insert into ct_stage_entries (stage_id, entry_id)
     values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3') $$,
  '42501',
  'new row violates row-level security policy for table "ct_stage_entries"',
  'a single-org member is refused the same way'
);
select is(
  (select count(*)::int from ct_stage_entries where entry_id = '00000000-0000-0000-0000-0000000000c3'),
  0,
  'and nothing of org B''s entry was attached'
);

-- ============ anon can write none of it ============

reset role;
set local role anon;
select throws_ok(
  $$ insert into ct_stage_entries (stage_id, entry_id)
     values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1') $$,
  '42501', null, 'anon cannot insert a stage entry'
);
select throws_ok(
  $$ update ct_sets set stage_id = '00000000-0000-0000-0000-0000000000d2' $$,
  '42501', null, 'anon cannot update a set'
);

-- ============ the new functions are not callable by an API role ============

reset role;
select ok(
  not has_function_privilege('authenticated', 'app.check_ct_stage_entry_event()', 'execute')
  and not has_function_privilege('anon', 'app.check_ct_stage_entry_event()', 'execute')
  and not has_function_privilege('authenticated', 'app.check_ct_heat_entry_event()', 'execute')
  and not has_function_privilege('anon', 'app.check_ct_heat_entry_event()', 'execute'),
  'the two check functions are executable by no API role'
);
select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname in ('check_ct_stage_entry_event', 'check_ct_heat_entry_event')
      and p.prosecdef
      and coalesce(p.proconfig @> array['search_path=""'], false)),
  2,
  'and BOTH exist, are SECURITY DEFINER and have search_path pinned (a missing or unpinned one fails)'
);

select * from finish();
rollback;
