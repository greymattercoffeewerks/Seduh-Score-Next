-- T1.3 RLS — handoff §4, §14 T1.3 AC.
-- Proves: a non-member reads zero rows from every table except live_sessions, and
-- an unauthenticated client can read live_sessions and cannot write it.
begin;
select plan(15);

-- ---------- fixtures (as postgres, bypasses RLS) ----------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org');

insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- ...005 (outsider) is deliberately not a member of this org

insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010',
   'Cupper One', '+6738001111');

insert into person_merges (org_id, kept_id, merged_id, merged_name) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a2', 'Merged Away Person');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Test Event');

insert into event_entries (id, event_id, person_id, display_name) values
  ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000a1', 'Cupper One');

insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 3, 480);

insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1);

insert into ct_stage_entries (stage_id, entry_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000ee');

insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1, 480);

insert into ct_heat_entries (id, heat_id, entry_id, elapsed_secs) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000ee', 240);

insert into ct_results (heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', true);

insert into live_sessions (id, org_id, event_id, format, active) values
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-0000000000e1', 'cup_taster', true);

-- A second org with its own event, for the cross-org live_sessions check below.
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000020',
   'cup_taster', 'Other Org Event');

-- A live_sessions row claiming org 0010's slot but pointing at org 0020's event
-- is rejected — the org-consistency trigger closes a real, live-proven exploit
-- where org_id and event_id had no relationship enforced between them.
select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format, active) values
       ('00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-0000000000e2', 'cup_taster', false) $$,
  'P0001',
  'live_sessions.org_id must match the owning org of event_id',
  'live_sessions rejects an org_id that does not match event_id''s actual owning org'
);

-- ---------- non-member reads zero rows from every table ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';

select is((select count(*)::int from orgs), 0, 'non-member reads zero rows: orgs');
select is((select count(*)::int from org_members), 0, 'non-member reads zero rows: org_members');
select is((select count(*)::int from people), 0, 'non-member reads zero rows: people');
select is((select count(*)::int from person_merges), 0, 'non-member reads zero rows: person_merges');
select is((select count(*)::int from events), 0, 'non-member reads zero rows: events');
select is((select count(*)::int from event_entries), 0, 'non-member reads zero rows: event_entries');
select is((select count(*)::int from ct_stages), 0, 'non-member reads zero rows: ct_stages');
select is((select count(*)::int from ct_sets), 0, 'non-member reads zero rows: ct_sets');
select is((select count(*)::int from ct_stage_entries), 0, 'non-member reads zero rows: ct_stage_entries');
select is((select count(*)::int from ct_heats), 0, 'non-member reads zero rows: ct_heats');
select is((select count(*)::int from ct_heat_entries), 0, 'non-member reads zero rows: ct_heat_entries');
select is((select count(*)::int from ct_results), 0, 'non-member reads zero rows: ct_results');

reset role;
reset request.jwt.claim.sub;

-- ---------- live_sessions: the deliberate exception ----------

set local role anon;

select is(
  (select count(*)::int from live_sessions),
  1,
  'an unauthenticated (anon) client CAN read live_sessions'
);

select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format) values
       ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1',
        'cup_taster') $$,
  '42501',
  null,
  'an unauthenticated (anon) client cannot WRITE live_sessions'
);

reset role;

select * from finish();
rollback;
