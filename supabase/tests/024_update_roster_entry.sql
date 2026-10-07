-- Live-event finding #4 (2026-10-04): the roster needs an Edit.
-- Proves: update_roster_entry is org-scoped (a non-member, another org's entry, and a member of two
-- orgs naming the wrong one all get the same not-found); it updates the person's shared profile AND
-- this event's entry atomically, and leaves other events' entries for the same person alone; blank
-- optional fields become null; a name is required, and a phone for a linked entry; a walk-up entry
-- (no profile) can only change its own name / cafe / bib, and a phone or email for it is refused;
-- phone and email stay unique within the org (case-insensitively for email) with a DETAIL naming
-- the field and the person who has it — but the same phone in ANOTHER org is fine; a refused call
-- changes nothing; resubmitting a person's own values is not a collision; withdrawal is preserved;
-- anon cannot execute it. Runs under a real `authenticated` role with RLS in force.
begin;
select plan(54);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b'),
  ('00000000-0000-0000-0000-0000000000c0', 'Org C', 'org-c');
-- The caller is a member of A and C, NOT of B.
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'organiser'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000001', 'organiser');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event One'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event Two'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Other Org Event');

insert into people (id, org_id, display_name, phone, email, cafe) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a0', 'Alice Tan',  '+6737000001', 'Alice@Example.com', 'Old Cafe'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a0', 'Bob Lim',    '+6737000002', 'bob@example.com',   'Bob Beans'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a0', 'Cara Wong',  '+6737000003', null,                null),
  -- Touched by no other test: its mixed-case email and phone are the targets of the conflict probes.
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a0', 'Dee Four',   '+6737000004', 'MixedCase@Example.com', null),
  -- Same phone as Alice, but in ANOTHER org: allowed (uniqueness is per org).
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b0', 'Other Org Person', '+6737000001', 'other@example.com', 'Other Cafe'),
  -- Held only by Org B: proves the phone-uniqueness lookup is scoped to the caller's org even
  -- for a caller RLS does not filter (below, as the table owner).
  ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000b0', 'Org B Second', '+6737000077', 'org-b-only@example.com', null);

insert into event_entries (id, event_id, person_id, display_name, cafe, bib, withdrawn) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'Alice Tan', 'Old Cafe', '1', false),
  -- Alice's entry in ANOTHER event (a snapshot that must not be rewritten):
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'Alice Tan', 'Old Cafe', '2', false),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d2', 'Bob Lim', 'Bob Beans', '3', false),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d3', 'Cara Wong', null, null, true),
  -- A walk-up with no linked person (D16), withdrawn:
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000e1', null, 'Walk Up', 'Walk Cafe', 'W1', true),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d9', 'Other Org Person', 'Other Cafe', '9', false);

-- Reads the DETAIL a refused call attaches (the client reads its JSON keys). A temp function so it
-- can run under the `authenticated` role below.
create function pg_temp.detail_of(q text) returns text
language plpgsql as $f$
declare d text;
begin
  execute q;
  return 'no error';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ grants ============

select ok(
  has_function_privilege('authenticated', 'update_roster_entry(uuid, uuid, text, text, text, text, text)', 'execute'),
  'a signed-in user can execute update_roster_entry'
);
select ok(
  not has_function_privilege('anon', 'update_roster_entry(uuid, uuid, text, text, text, text, text)', 'execute'),
  'anon cannot execute update_roster_entry'
);
select ok(
  (select array_to_string(proconfig, ',') from pg_proc where proname = 'update_roster_entry') like '%search_path%',
  'the function pins its search_path'
);

-- ============ org scoping ============

select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000f9',
       'Hijacked', '+6737000099', null, null, null) $$,
  null,
  'update_roster_entry: entry 00000000-0000-0000-0000-0000000000f9 not found',
  'a caller who is not a member of the entry''s org sees it as not found'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f9',
       'Hijacked', '+6737000099', null, null, null) $$,
  null,
  'update_roster_entry: entry 00000000-0000-0000-0000-0000000000f9 not found',
  'naming the caller''s own org does not unlock another org''s entry'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000f1',
       'Wrong Org', '+6737000001', null, null, null) $$,
  null,
  'update_roster_entry: entry 00000000-0000-0000-0000-0000000000f1 not found',
  'a member of two orgs cannot attribute one org''s entry to the other'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000f5',
       'Wrong Org Walk-Up', null, null, null, null) $$,
  null,
  'update_roster_entry: entry 00000000-0000-0000-0000-0000000000f5 not found',
  'the explicit org check also guards a walk-up entry (no profile to fail on instead)'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', gen_random_uuid(),
       'Nobody', '+6737000099', null, null, null) $$,
  null,
  null,
  'an entry id that does not exist is refused'
);

-- ============ validation ============

select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f1',
       '   ', '+6737000001', null, null, null) $$,
  null,
  'update_roster_entry: a name is required',
  'a blank name is refused'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f1',
       'Alice Tan', '', null, null, null) $$,
  null,
  'update_roster_entry: a phone number is required',
  'a blank phone is refused for an entry that has a profile'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f1',
       repeat('x', 201), '+6737000001', null, null, null) $$,
  null,
  'update_roster_entry: a value is too long',
  'a name over 200 characters is refused'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f5',
       'Walk Up', '+6737000050', null, null, null) $$,
  null,
  'update_roster_entry: this entry has no profile, so a phone or email cannot be set',
  'a phone for a walk-up entry with no profile is refused, not silently dropped'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f5',
       'Walk Up', null, 'walk@example.com', null, null) $$,
  null,
  'update_roster_entry: this entry has no profile, so a phone or email cannot be set',
  'and so is an email'
);
select is(
  (select display_name from event_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  'Alice Tan',
  'none of the refused edits changed anything'
);

-- ============ the happy path: profile AND this event's entry, atomically ============

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f1',
       '  Alicia Tan  ', ' +6737000009 ', ' alicia@example.com ', ' New Cafe ', ' 7 ') $$,
  'a linked entry can be corrected'
);
select is(
  (select display_name from people where id = '00000000-0000-0000-0000-0000000000d1'),
  'Alicia Tan',
  'the person''s shared name is corrected, trimmed'
);
select is(
  (select phone || '|' || email || '|' || cafe from people where id = '00000000-0000-0000-0000-0000000000d1'),
  '+6737000009|alicia@example.com|New Cafe',
  'phone, email and cafe on the person are corrected, trimmed'
);
select is(
  (select display_name || '|' || cafe || '|' || bib from event_entries where id = '00000000-0000-0000-0000-0000000000f1'),
  'Alicia Tan|New Cafe|7',
  'this event''s entry carries the corrected name, cafe and bib'
);
select is(
  (select display_name || '|' || cafe || '|' || bib from event_entries where id = '00000000-0000-0000-0000-0000000000f2'),
  'Alice Tan|Old Cafe|2',
  'the same person''s entry in ANOTHER event is a snapshot and is left alone'
);
select is(
  (select display_name from people where id = '00000000-0000-0000-0000-0000000000d2'),
  'Bob Lim',
  'other people are untouched'
);
select is(
  (select display_name from event_entries where id = '00000000-0000-0000-0000-0000000000f3'),
  'Bob Lim',
  'other entries in the same event are untouched'
);

-- ============ blanks become null; the walk-up path; withdrawal is kept ============

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000002', '   ', '', '') $$,
  'blank optional fields are accepted'
);
select is(
  (select coalesce(email, 'NULL') || '|' || coalesce(cafe, 'NULL') from people where id = '00000000-0000-0000-0000-0000000000d2'),
  'NULL|NULL',
  'and become null on the person, not empty strings'
);
select is(
  (select coalesce(cafe, 'NULL') || '|' || coalesce(bib, 'NULL') from event_entries where id = '00000000-0000-0000-0000-0000000000f3'),
  'NULL|NULL',
  '…and on the entry'
);
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f5',
       'Walk-Up Winner', null, null, 'Fixed Cafe', 'W2') $$,
  'a walk-up entry can change its own name, cafe and bib'
);
select is(
  (select display_name || '|' || cafe || '|' || bib || '|' || withdrawn::text from event_entries where id = '00000000-0000-0000-0000-0000000000f5'),
  'Walk-Up Winner|Fixed Cafe|W2|true',
  '…and an edit never changes whether the entry is withdrawn'
);
select is(
  (select withdrawn from event_entries where id = '00000000-0000-0000-0000-0000000000f4'),
  true,
  'a withdrawn linked entry is still withdrawn after an edit elsewhere'
);
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong-Lee', '+6737000003', null, null, null) $$,
  'a withdrawn linked entry can be corrected too'
);
select is(
  (select withdrawn::text || '|' || display_name from event_entries where id = '00000000-0000-0000-0000-0000000000f4'),
  'true|Cara Wong-Lee',
  '…and stays withdrawn'
);

-- ============ uniqueness within the org ============

select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000009', null, null, null) $$,
  'P0002',
  null,
  'a phone number another person already has is a conflict'
);
select is(
  (pg_temp.detail_of($q$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000009', null, null, null) $q$)::jsonb) ->> 'field',
  'phone',
  'the conflict names the field…'
);
select is(
  (pg_temp.detail_of($q$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000009', null, null, null) $q$)::jsonb) ->> 'existing_display_name',
  'Alicia Tan',
  '…and the person who already has it'
);
select is(
  (pg_temp.detail_of($q$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000002', 'ALICIA@EXAMPLE.COM', null, null) $q$)::jsonb) ->> 'field',
  'email',
  'an email another person has is a conflict even in a different case'
);
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000000d2'),
  '+6737000002',
  'a refused edit changes nothing: the person keeps their phone…'
);
select is(
  (select display_name from event_entries where id = '00000000-0000-0000-0000-0000000000f3'),
  'Bob Lim',
  '…and the entry keeps its name (the whole edit is atomic)'
);
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f1',
       'Alicia Tan', '+6737000009', 'alicia@example.com', 'New Cafe', '7') $$,
  'resubmitting a person''s own phone and email is not a collision'
);
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000001', 'bob@example.com', null, null) $$,
  'the same phone in ANOTHER org (Alice''s old number, still held there) is not a collision — uniqueness is per org'
);

-- Fixtures of their own (Dee Four, untouched by any other test): the email is stored in MIXED case
-- and probed in another, so this proves lower() on the stored side, not just on the probe.
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000002', 'mixedcase@example.com', null, null) $$,
  'P0002',
  null,
  'an email held in a different case is a conflict, with the P0002 the screen reads'
);
select is(
  (pg_temp.detail_of($q$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000002', 'mixedcase@example.com', null, null) $q$)::jsonb),
  '{"field": "email", "existing_person_id": "00000000-0000-0000-0000-0000000000d4", "existing_display_name": "Dee Four"}'::jsonb,
  'the email conflict names the field, the other person''s id and their name — nothing else'
);
select is(
  (pg_temp.detail_of($q$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f3',
       'Bob Lim', '+6737000004', null, null, null) $q$)::jsonb),
  '{"field": "phone", "existing_person_id": "00000000-0000-0000-0000-0000000000d4", "existing_display_name": "Dee Four"}'::jsonb,
  'and so does the phone conflict'
);

-- ============ every length cap, at the cap and one past it ============

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       repeat('n', 200), '+' || repeat('2', 31), repeat('y', 242) || '@example.com', repeat('c', 200), repeat('b', 50)) $$,
  'values exactly at every cap (name 200, phone 32, email 254, cafe 200, bib 50) are accepted'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong', '+6737000003', null, repeat('c', 201), null) $$,
  null,
  'update_roster_entry: a value is too long',
  'a cafe over 200 characters is refused'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong', '+6737000003', null, null, repeat('b', 51)) $$,
  null,
  'update_roster_entry: a value is too long',
  'a bib over 50 characters is refused'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong', '+6737000003', repeat('y', 243) || '@example.com', null, null) $$,
  null,
  'update_roster_entry: a value is too long',
  'an email over 254 characters is refused'
);
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong', '+' || repeat('2', 32), null, null, null) $$,
  null,
  'update_roster_entry: a value is too long',
  'a phone over 32 characters is refused'
);

-- ============ an older entry's snapshot must not revert the person's current profile ============
-- Alice was corrected above (now Alicia Tan / New Cafe), but her entry in event two still holds the
-- snapshot 'Alice Tan' / 'Old Cafe', and the edit form is prefilled from that snapshot. Fixing only
-- that entry's bib sends the old name and cafe back; they must not overwrite the profile.

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f2',
       'Alice Tan', '+6737000009', 'alicia@example.com', 'Old Cafe', '22') $$,
  'fixing only the bib of an older entry succeeds'
);
select is(
  (select display_name || '|' || cafe from people where id = '00000000-0000-0000-0000-0000000000d1'),
  'Alicia Tan|New Cafe',
  'and the person''s current name and cafe are NOT reverted to that entry''s stale snapshot'
);
select is(
  (select display_name || '|' || cafe || '|' || bib from event_entries where id = '00000000-0000-0000-0000-0000000000f2'),
  'Alice Tan|Old Cafe|22',
  'while that entry itself takes the bib it was given'
);
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f2',
       'Alisha Tan', '+6737000009', 'alicia@example.com', 'Old Cafe', '22') $$,
  'renaming from an older entry succeeds'
);
select is(
  (select display_name || '|' || cafe from people where id = '00000000-0000-0000-0000-0000000000d1'),
  'Alisha Tan|New Cafe',
  'a name the caller DID change reaches the profile, while the unchanged cafe still does not revert it'
);

-- ============ the other org is never touched ============

reset role;
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong', '+6737000003', 'ORG-B-ONLY@example.com', null, null) $$,
  'run WITHOUT RLS, an email held only by an Org B person is no collision either — the email lookup is scoped to the org too'
);
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000f4',
       'Cara Wong-Lee', '+6737000077', null, null, null) $$,
  'run WITHOUT RLS filtering the people it can see, a phone held only in another org is still no collision'
);
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000000d9'),
  '+6737000001',
  'and the other org''s person is unchanged'
);
select is(
  (select display_name from event_entries where id = '00000000-0000-0000-0000-0000000000f9'),
  'Other Org Person',
  'the other org''s entry was never changed by any refused attempt'
);

select * from finish();
rollback;
