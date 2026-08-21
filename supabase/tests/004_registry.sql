-- T3.1 registry: org-consistency check + merge_people RPC — handoff §6.
begin;
select plan(10);

-- ============ event_entries.person_id must match event.org_id ============

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-000000000020', 'Org B', 'org-b');

insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010',
   'Person in Org A', '+6738001111'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000020',
   'Person in Org B', '+6738002222');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Org A Event');

select throws_ok(
  $$ insert into event_entries (event_id, person_id, display_name) values
       ('00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000b1', 'Cross-org attempt') $$,
  'P0001',
  'event_entries.person_id must belong to the same org as event_id',
  'an entry cannot link to a person from a different org than its event'
);

select lives_ok(
  $$ insert into event_entries (event_id, person_id, display_name) values
       ('00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000a1', 'Same-org entry') $$,
  'a same-org person_id is accepted'
);

select lives_ok(
  $$ insert into event_entries (event_id, display_name) values
       ('00000000-0000-0000-0000-0000000000e1', 'Unregistered walk-up') $$,
  'a null person_id (unregistered walk-up, D16) is unaffected by the check'
);

-- ============ merge_people: reassign when no collision ============

insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010',
   'Duplicate of Person A', '+6738003333');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Second Event, A2 only');

insert into event_entries (id, event_id, person_id, display_name) values
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-0000000000e2',
   '00000000-0000-0000-0000-0000000000a2', 'A2''s entry, no collision');

select merge_people(
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2'
);

select is(
  (select person_id from event_entries where id = '00000000-0000-0000-0000-00000000ee02'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'merge_people reassigns an entry to the kept person when there is no collision'
);

select is(
  (select count(*)::int from people where id = '00000000-0000-0000-0000-0000000000a2'),
  0,
  'merge_people deletes the merged-away person'
);

select is(
  (select merged_name from person_merges
     where kept_id = '00000000-0000-0000-0000-0000000000a1'
       and merged_id = '00000000-0000-0000-0000-0000000000a2'),
  'Duplicate of Person A',
  'merge_people logs the merge ledger row with the merged person''s name'
);

-- ============ merge_people: unlink when the kept person already has an entry ============

insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000010',
   'Another duplicate of Person A', '+6738004444');

-- Person A (kept) already has entry ee01 in event e1 (inserted above). A3 also
-- registers, separately, for the SAME event.
insert into event_entries (id, event_id, person_id, display_name) values
  ('00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000a3', 'A3''s entry, collides with A1''s');

select merge_people(
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a3'
);

select is(
  (select person_id from event_entries where id = '00000000-0000-0000-0000-00000000ee03'),
  null,
  'merge_people unlinks (not reassigns) an entry that would collide with the kept
   person''s existing entry in the same event'
);

-- ============ merge_people: cross-org p_kept_id rejected ============
-- security-reviewer's live-exploited finding: a merged-away person with ZERO
-- event entries never touches event_entries at all, so its org-check trigger
-- never fires — without an explicit check, this path let a caller merge in a
-- p_kept_id from an org they aren't even a member of.

insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000010',
   'Org A person with zero entries', '+6738005555');

select throws_ok(
  $$ select merge_people(
       '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-0000000000a4'
     ) $$,
  'P0001',
  'merge_people: kept person 00000000-0000-0000-0000-0000000000b1 not found in org 00000000-0000-0000-0000-000000000010',
  'merge_people rejects a p_kept_id belonging to a different org than p_org_id,
   even when the merged-away person has zero event entries'
);

-- ============ merge_people: self-merge rejected ============

select throws_ok(
  $$ select merge_people(
       '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000a4',
       '00000000-0000-0000-0000-0000000000a4'
     ) $$,
  'P0001',
  'merge_people: cannot merge a person into themselves',
  'merge_people rejects p_kept_id = p_merged_id rather than silently unlinking
   and deleting the person'
);

-- ============ person_merges: cross-org kept_id rejected directly, not just via the RPC ============
-- security-reviewer found the same hole reachable by a plain client-side
-- insert, bypassing merge_people entirely.

select throws_ok(
  $$ insert into person_merges (org_id, kept_id, merged_id, merged_name) values
       ('00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-0000000000b1',
        gen_random_uuid(), 'fabricated') $$,
  'P0001',
  'person_merges.kept_id must belong to the same org as org_id',
  'a direct insert with a cross-org kept_id is rejected, independent of merge_people'
);

select * from finish();
rollback;
