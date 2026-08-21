-- T1.1 Core tables — handoff §5.1, §14 T1.1 AC.
-- Proves: a duplicate phone in one org is rejected, and a merge succeeds when one
-- human holds two entries in one event. The merge's own mechanism (unlink the
-- losing entry to person_id = null, then delete the merged-away person) is what
-- this test demonstrates — NOT a distinguishing behavior between a partial index
-- and a plain table-level UNIQUE(event_id, person_id): schema-guardian review
-- confirmed Postgres treats NULL as distinct under either constraint shape, so
-- both would tolerate this sequence equally. The partial index is still the right
-- choice (smaller index, and names the "linked entries only" intent explicitly for
-- ON CONFLICT), just not for the reason originally stated in the handoff's own
-- schema comment — corrected there and in the migration alongside this file.
begin;
select plan(6);

-- ============ fixtures ============
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org');

-- ============ duplicate phone rejected ============
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
   'Person A', '+6738001111');

select throws_ok(
  $$ insert into people (org_id, display_name, phone) values
       ('00000000-0000-0000-0000-000000000001', 'Person A duplicate', '+6738001111') $$,
  '23505',
  null,
  'duplicate phone within the same org is rejected'
);

-- the same phone in a DIFFERENT org is allowed — the uniqueness is org-scoped, not global
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000002', 'Other Org', 'other-org');

select lives_ok(
  $$ insert into people (org_id, display_name, phone) values
       ('00000000-0000-0000-0000-000000000002', 'Person A elsewhere', '+6738001111') $$,
  'the same phone is allowed in a different org — uniqueness is (org_id, phone)'
);

-- ============ merge: one human holds two entries in one event ============

-- Person B is a duplicate registration of Person A under a different phone number
-- (the accidental-duplicate-registration case D16 accepts as a real scenario).
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001',
   'Person B', '+6738002222');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001',
   'cup_taster', 'Test Event');

-- Both A and B separately hold an entry in the SAME event before the merge.
insert into event_entries (id, event_id, person_id, display_name) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000e001',
   '00000000-0000-0000-0000-0000000000a1', 'Person A'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-00000000e001',
   '00000000-0000-0000-0000-0000000000b1', 'Person B');

-- Multiple entries in the SAME event may hold a null person_id simultaneously —
-- this is what makes the merge's unlink step (below) safe, and is also what lets
-- several unregistered walk-ups (D16: phone required, so a same-day walk-up has no
-- people row yet) coexist in one event before being linked.
select lives_ok(
  $$ update event_entries set person_id = null
       where id = '00000000-0000-0000-0000-00000000ee02' $$,
  'unlinking one entry (setting person_id to null) succeeds even though another
   entry in the same event already holds a null-eligible slot'
);

-- The merge ledger row and the actual merge: keep A, merge away B. B's entry stays
-- in the event as an orphaned historical record (display_name preserved, person_id
-- null) rather than colliding with A's own entry in the same event.
select lives_ok(
  $$ insert into person_merges (org_id, kept_id, merged_id, merged_name)
       values ('00000000-0000-0000-0000-000000000001',
               '00000000-0000-0000-0000-0000000000a1',
               '00000000-0000-0000-0000-0000000000b1',
               'Person B') $$,
  'merge ledger row insertable — merged_id is not a foreign key, the row can be gone'
);

select lives_ok(
  $$ delete from people where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'deleting the merged-away person succeeds; ON DELETE SET NULL is a no-op here
   since the entry was already unlinked'
);

-- Final state: one human (A) is the only live link in the event; the second entry
-- (formerly B's) survives as an orphaned historical row rather than being lost.
select is(
  (select count(*) from event_entries where event_id = '00000000-0000-0000-0000-00000000e001'),
  2::bigint,
  'both entries survive the merge — one linked to the kept person, one orphaned'
);

select * from finish();
rollback;
