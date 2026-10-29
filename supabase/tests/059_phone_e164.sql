-- T-ID.A3: people.phone is E.164, in the database.
-- Proves: app.normalize_phone is a faithful port of normalizePhone() in src/core/phone.js (same vectors as
-- phone.test.js); app.is_e164 matches the client's pattern; app.phone_repair_class never guesses (7-8 bare digits
-- are repairable by +673, 9+ bare digits are ambiguous, short or non-phone values are not_a_phone); the
-- people_phone_e164 CHECK refuses a bad shape with 23514 on insert AND on update, accepts a valid one, and does not
-- itself reject NULL (people.phone is NOT NULL, so NULL stops at 23502, not 23514); update_roster_entry stores the
-- NORMALISED phone, refuses one that cannot be normalised (hint phone_invalid) and changes nothing when it does,
-- reports a collision that only appears after normalising as the same CONFLICT as a literal duplicate (the two
-- people are never merged, both rows are untouched), still refuses a NULL org (the B6 guard kept), and the helper
-- functions have the right ACLs. Fixtures use only valid +673 numbers.
begin;
select plan(54);

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000059', 'organiser@t059.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000059a0', 'T059 Org A', 't059-org-a'),
  ('00000000-0000-0000-0000-0000000059b0', 'T059 Org B', 't059-org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-000000000059', 'organiser');

insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000059e1', '00000000-0000-0000-0000-0000000059a0', 'cup_taster', 'T059 Event');

insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000059d1', '00000000-0000-0000-0000-0000000059a0', 'Ana',  '+6738123456'),
  ('00000000-0000-0000-0000-0000000059d2', '00000000-0000-0000-0000-0000000059a0', 'Budi', '+6739000002'),
  -- the same number as Ana, in ANOTHER org: allowed, uniqueness is per org
  ('00000000-0000-0000-0000-0000000059d9', '00000000-0000-0000-0000-0000000059b0', 'Other Org Ana', '+6738123456');
insert into event_entries (id, event_id, person_id, display_name) values
  ('00000000-0000-0000-0000-0000000059f1', '00000000-0000-0000-0000-0000000059e1', '00000000-0000-0000-0000-0000000059d1', 'Ana'),
  ('00000000-0000-0000-0000-0000000059f2', '00000000-0000-0000-0000-0000000059e1', '00000000-0000-0000-0000-0000000059d2', 'Budi');

-- ============ app.normalize_phone: the same vectors as src/core/phone.test.js ============

select is(app.normalize_phone('7123456'), '+6737123456', 'normalize: prepends the default country code');
select is(app.normalize_phone('712-3456'), '+6737123456', 'normalize: strips dashes');
select is(app.normalize_phone('(712) 3456'), '+6737123456', 'normalize: strips spaces and parentheses');
select is(app.normalize_phone('+65 8123 4567'), '+6581234567', 'normalize: keeps an explicit + and its country code');
select is(app.normalize_phone('0065 8123 4567'), '+6581234567', 'normalize: a leading 00 means a country code was typed');
select is(app.normalize_phone('00673 7123456'), '+6737123456', 'normalize: 00 followed by the default country');
select is(app.normalize_phone(''), '', 'normalize: blank gives the empty string');
select is(app.normalize_phone('   '), '', 'normalize: whitespace gives the empty string');
select is(app.normalize_phone('n/a'), '', 'normalize: no digits gives the empty string');
select is(app.normalize_phone('81234567', '+81'), '+8181234567', 'normalize: a caller-supplied default country code');
select is(app.normalize_phone('  7123456  '), '+6737123456', 'normalize: surrounding whitespace is trimmed');
select is(app.normalize_phone(null), null, 'normalize: NULL in, NULL out');

-- ============ app.is_e164: the client pattern ============

select ok(app.is_e164('+6737123456') and app.is_e164('+6581234567'), 'is_e164: accepts a normalised number');
select ok(not app.is_e164('+1234567') and not app.is_e164('+1'), 'is_e164: rejects a number that is too short');
select ok(not app.is_e164('+1234567890123456'), 'is_e164: rejects a number that is too long');
select ok(not app.is_e164('6737123456'), 'is_e164: rejects a value with no leading +');
select ok(not app.is_e164('+0737123456'), 'is_e164: rejects a leading-zero country code');
select ok(not app.is_e164(null) and not app.is_e164(E'+6737123456\n'), 'is_e164: NULL and a trailing newline are not E.164');

-- ============ app.phone_repair_class: reports, never guesses ============

select is(app.phone_repair_class('+6738123456'), 'valid', 'class: an E.164 number is valid');
select is(app.phone_repair_class('8123456'), 'repairable_default_country', 'class: 7 bare digits are repairable by +673');
select is(app.phone_repair_class('812 3456'), 'repairable_default_country', 'class: ... with punctuation');
select is(app.phone_repair_class('81234567'), 'repairable_default_country', 'class: 8 bare digits are repairable by +673 (owner''s audit counted 7-8)');
select is(app.phone_repair_class('+673 812 3456'), 'repairable_format', 'class: a typed + country code only needs punctuation stripped');
select is(app.phone_repair_class('00673 8123456'), 'repairable_format', 'class: a typed 00 country code only needs punctuation stripped');
select is(app.phone_repair_class('812345678'), 'ambiguous', 'class: 9 bare digits are ambiguous (never guessed)');
select is(app.phone_repair_class('6738123456'), 'ambiguous', 'class: a bare number that may already carry its country code is ambiguous');
select is(app.phone_repair_class('12345'), 'not_a_phone', 'class: under 7 digits is not a phone');
select is(app.phone_repair_class('n/a'), 'not_a_phone', 'class: letters are not a phone');
select is(app.phone_repair_class('+1234'), 'not_a_phone', 'class: a short number with + is not a phone');

-- ============ the people_phone_e164 CHECK ============

select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Bad local', '81234567') $$,
  '23514', null, 'CHECK: a local-format phone is refused on insert (23514)');
select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Bad short', '+1234') $$,
  '23514', null, 'CHECK: a too-short +number is refused on insert (23514)');
select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Bad text', 'n/a') $$,
  '23514', null, 'CHECK: text is refused on insert (23514)');
select lives_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Good', '+6739000099') $$,
  'CHECK: a valid E.164 phone is accepted');
select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'No phone', null) $$,
  '23502', null, 'CHECK: NULL is stopped by NOT NULL (23502), not by the shape check (the CHECK does not reject NULL itself)');
select throws_ok(
  $$ update people set phone = '8123456' where id = '00000000-0000-0000-0000-0000000059d2' $$,
  '23514', null, 'CHECK: it also guards UPDATE of an existing row (23514)');
select lives_ok(
  $$ update people set display_name = 'Budi B' where id = '00000000-0000-0000-0000-0000000059d2' $$,
  'CHECK: an unrelated edit of a valid row still works');

-- ============ ACLs ============

select ok(
  has_function_privilege('authenticated', 'app.normalize_phone(text, text)', 'execute')
    and has_function_privilege('authenticated', 'app.is_e164(text)', 'execute'),
  'a signed-in user can execute the two helpers update_roster_entry calls as them');
select ok(
  has_function_privilege('authenticated', 'app.phone_repair_class(text)', 'execute'),
  'and the classifier update_roster_entry also calls');
select ok(
  not has_function_privilege('anon', 'app.normalize_phone(text, text)', 'execute')
    and not has_function_privilege('anon', 'app.is_e164(text)', 'execute')
    and not has_function_privilege('anon', 'app.phone_repair_class(text)', 'execute'),
  'anon cannot execute any of the three');

-- ============ update_roster_entry, as a signed-in member of org A ============

-- The hint a refused call attaches (the client reads it).
create function pg_temp.hint_of(q text) returns text language plpgsql as $f$
declare h text;
begin
  execute q;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end $f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000059';

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', '900 0003', null, null, null) $$,
  'a local-format phone is accepted by update_roster_entry');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6739000003',
  'and it is stored NORMALISED (+673 added, punctuation stripped)');

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', '00 65 8123 4567', null, null, null) $$,
  'a 00-prefixed international number is accepted');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6581234567',
  'and keeps the country code it carried');

select is(
  pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', '12345', null, null, null) $$),
  'phone_invalid',
  'a phone that cannot be normalised to E.164 is refused with the hint phone_invalid');
select is(
  pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', 'call me', null, null, null) $$),
  'phone_invalid',
  'text is refused too');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6581234567',
  'a refused phone changes nothing on the person');
select is(
  (select display_name from event_entries where id = '00000000-0000-0000-0000-0000000059f2'),
  'Budi',
  'and nothing on the entry');

-- A collision that only exists after normalising: Budi types Ana's number in local form.
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', '812 3456', null, null, null) $$,
  'P0002',
  'CONFLICT: that phone number already belongs to another person',
  'a local-format number that equals another person''s stored +673 number is reported as a CONFLICT after normalising');
select is(
  (select count(*)::int from people where org_id = '00000000-0000-0000-0000-0000000059a0' and phone = '+6738123456'),
  1,
  'the two people were not merged: exactly one person still holds Ana''s number');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6581234567',
  'and the person who tried keeps their own number');

-- Resubmitting your own number in local form is not a collision with yourself.
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f1',
       'Ana', '8123456', null, null, null) $$,
  'resubmitting one''s own number in local format is not a collision');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d1'),
  '+6738123456',
  'and it stays the normalised value');

-- The same number in another org (held only by Org B's person) is no collision.
reset role;
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d9'),
  '+6738123456',
  'the other org''s identical number was never touched');

-- The null-org guard (T-TEN.B6) is still there.
set local role authenticated;
select throws_ok(
  $$ select update_roster_entry(null, '00000000-0000-0000-0000-0000000059f1', 'Ana', '+6738123456', null, null, null) $$,
  null,
  'update_roster_entry: entry 00000000-0000-0000-0000-0000000059f1 not found',
  'a NULL org id is still refused like any wrong org id');

select * from finish();
rollback;
