-- T-ID.A3: the database checks phone SHAPE only, and people.phone is E.164 (PHONE-CHECKER-DESIGN.md sections 3-4, 7).
-- Proves: app.is_e164 is the shape '^\+[1-9][0-9]{7,14}$' (both bounds); app.phone_repair_class never guesses (only an
-- exact 7-digit Brunei number matching ^[2-578][0-9]{6}$ is repairable; 8 digits, a leading 0, a country code without
-- '+', punctuation it does not know and text are 'ambiguous'); the people_phone_e164 CHECK refuses a bad shape with
-- 23514 on insert AND on update, at both length bounds, accepts a valid one, and does not itself reject NULL
-- (people.phone is NOT NULL, so NULL stops at 23502); update_roster_entry stores a CANONICAL phone unchanged (after a
-- trim) and REFUSES everything else (local format, spaces inside, 00 prefix, bare country code, junk) with hint
-- phone_invalid, changing nothing when it does; a duplicate of another person's canonical number is the ordinary
-- CONFLICT; the B6 null-org guard is kept; the helper functions have the right ACLs and there is no SQL normaliser.
-- Fixtures use only valid +673 numbers. That the client pattern and the SQL patterns are the same string is guarded by
-- supabase/phonePattern.test.js, since pgTAP cannot read src/.
begin;
select plan(58);

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
  ('00000000-0000-0000-0000-0000000059f2', '00000000-0000-0000-0000-0000000059e1', '00000000-0000-0000-0000-0000000059d2', 'Budi'),
  ('00000000-0000-0000-0000-0000000059f3', '00000000-0000-0000-0000-0000000059e1', null, 'Walk Up');

-- ============ app.is_e164 ============

select ok(app.is_e164('+6737123456') and app.is_e164('+6581234567'), 'is_e164: accepts a canonical number');
select ok(not app.is_e164('+1234567') and not app.is_e164('+1'), 'is_e164: rejects a number that is too short');
select ok(not app.is_e164('+1234567890123456'), 'is_e164: rejects a number that is too long');
select ok(not app.is_e164('6737123456'), 'is_e164: rejects a value with no leading +');
select ok(not app.is_e164('+0737123456'), 'is_e164: rejects a leading-zero country code');
select ok(not app.is_e164(null) and not app.is_e164(E'+6737123456\n'), 'is_e164: NULL and a trailing newline are not E.164');
select ok(app.is_e164('+12345678') and app.is_e164('+123456789012345'), 'is_e164: accepts exactly 8 and exactly 15 digits (both bounds)');
select ok(not app.is_e164('+673 712 3456') and not app.is_e164('+٦٧٣7123456'), 'is_e164: no spaces, no non-ASCII digits');

-- ============ app.phone_repair_class: reports, never guesses ============

select is(app.phone_repair_class('+6738123456'), 'valid', 'class: an E.164 number is valid');
select is(app.phone_repair_class(null), 'null_phone', 'class: NULL is null_phone');
select is(app.phone_repair_class('8123456'), 'repairable_default_country', 'class: an exact 7-digit Brunei number is repairable');
select is(app.phone_repair_class('812 3456'), 'repairable_default_country', 'class: ... with a space');
select is(app.phone_repair_class('(812) 34-56'), 'repairable_default_country', 'class: ... with brackets and a dash');
select is(app.phone_repair_class('2123456'), 'repairable_default_country', 'class: first digit 2 is a Brunei leading digit');
select is(app.phone_repair_class('7123456'), 'repairable_default_country', 'class: first digit 7 is a Brunei leading digit');
select is(app.phone_repair_class('1123456'), 'ambiguous', 'class: first digit 1 is not Brunei (not repaired)');
select is(app.phone_repair_class('9123456'), 'ambiguous', 'class: first digit 9 is not Brunei (not repaired)');
select is(app.phone_repair_class('0123456'), 'ambiguous', 'class: a leading 0 is not repaired');
select is(app.phone_repair_class('81234567'), 'ambiguous', 'class: 8 digits are NOT repaired (owner decision 6)');
select is(app.phone_repair_class('812345'), 'ambiguous', 'class: 6 digits are not repaired');
select is(app.phone_repair_class('08123456'), 'ambiguous', 'class: 8 digits with a leading 0 are not repaired');
select is(app.phone_repair_class('673 8123456'), 'ambiguous', 'class: a country code typed without + is not repaired');
select is(app.phone_repair_class('+673 812 3456'), 'ambiguous', 'class: punctuation the rule does not know (spaces after +) is reported, not repaired');
select is(app.phone_repair_class('00673 8123456'), 'ambiguous', 'class: a 00 prefix is reported, not repaired');
select is(app.phone_repair_class('n/a'), 'ambiguous', 'class: text is reported, not repaired');

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
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Too short', '+1234567') $$,
  '23514', null, 'CHECK: 7 digits after + is one too few (lower bound)');
select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Too long', '+1234567890123456') $$,
  '23514', null, 'CHECK: 16 digits is one too many (upper bound)');
select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Newline', E'+6739000098\n') $$,
  '23514', null, 'CHECK: a trailing newline is refused');
select lives_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Min', '+12345678') $$,
  'CHECK: exactly 8 digits is accepted (lower bound)');
select lives_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'Max', '+123456789012345') $$,
  'CHECK: exactly 15 digits is accepted (upper bound)');
select throws_ok(
  $$ insert into people (org_id, display_name, phone) values ('00000000-0000-0000-0000-0000000059a0', 'No phone', null) $$,
  '23502', null, 'CHECK: NULL is stopped by NOT NULL (23502), not by the shape check');
select throws_ok(
  $$ update people set phone = '8123456' where id = '00000000-0000-0000-0000-0000000059d2' $$,
  '23514', null, 'CHECK: it also guards UPDATE of an existing row (23514)');
select lives_ok(
  $$ update people set display_name = 'Budi B' where id = '00000000-0000-0000-0000-0000000059d2' $$,
  'CHECK: an unrelated edit of a valid row still works');

-- ============ ACLs ============

select ok(has_function_privilege('authenticated', 'app.is_e164(text)', 'execute'),
  'a signed-in user can execute app.is_e164 (update_roster_entry calls it as them)');
select ok(
  not has_function_privilege('anon', 'app.is_e164(text)', 'execute')
    and not has_function_privilege('anon', 'app.phone_repair_class(text)', 'execute'),
  'anon cannot execute either function');
select ok(
  not has_function_privilege('authenticated', 'app.phone_repair_class(text)', 'execute'),
  'the classifier is not executable by a signed-in user (owner scripts only)');
select ok(
  to_regprocedure('app.normalize_phone(text, text)') is null,
  'the database has no normaliser: it does not interpret input (owner decision 4)');

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
       'Budi', '  +6739000003  ', null, null, null) $$,
  'a canonical phone (padded with spaces) is accepted by update_roster_entry');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6739000003',
  'and it is stored unchanged, after a trim');

select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', '+6581234567', null, null, null) $$,
  'a canonical foreign number is accepted');

-- Everything that is not canonical is refused, with the same hint, and changes nothing.
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', '900 0003', null, null, null) $$), 'phone_invalid', 'a local-format phone with a space is refused (phone_invalid)');
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', '8123456', null, null, null) $$), 'phone_invalid', 'a bare 7-digit Brunei number is refused: the database does not add +673');
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', '00 65 8123 4567', null, null, null) $$), 'phone_invalid', 'a 00-prefixed number is refused');
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', '+65 8123 4567', null, null, null) $$), 'phone_invalid', 'a + number with spaces inside is refused (the client sends it canonical)');
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', '6738123456', null, null, null) $$), 'phone_invalid', 'a country code typed without + is refused, never guessed at');
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', '12345', null, null, null) $$), 'phone_invalid', 'a short number is refused');
select is(pg_temp.hint_of($$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi X', 'call me', null, null, null) $$), 'phone_invalid', 'text is refused');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6581234567',
  'refused phones change nothing on the person');
select is(
  (select display_name from event_entries where id = '00000000-0000-0000-0000-0000000059f2'),
  'Budi',
  'and nothing on the entry (the refused calls carried the name Budi X)');

-- A duplicate of another person's canonical number in the same org is the ordinary CONFLICT.
select throws_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f2',
       'Budi', '+6738123456', null, null, null) $$,
  'P0002',
  'CONFLICT: that phone number already belongs to another person',
  'a canonical number that another person in the org holds is reported as a CONFLICT, the two are not merged');
select is(
  (select phone from people where id = '00000000-0000-0000-0000-0000000059d2'),
  '+6581234567',
  'and the person who tried keeps their own number');

-- Resubmitting your own number is not a collision with yourself.
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f1',
       'Ana', '+6738123456', null, null, null) $$,
  'resubmitting one''s own canonical number is not a collision');

-- The null-org guard (T-TEN.B6) is still there.
select throws_ok(
  $$ select update_roster_entry(null, '00000000-0000-0000-0000-0000000059f1', 'Ana', '+6738123456', null, null, null) $$,
  null,
  'update_roster_entry: entry 00000000-0000-0000-0000-0000000059f1 not found',
  'a NULL org id is still refused like any wrong org id');

-- A walk-up entry (no profile) has no phone and may stay without one.
select lives_ok(
  $$ select update_roster_entry('00000000-0000-0000-0000-0000000059a0', '00000000-0000-0000-0000-0000000059f3',
       'Walk Up', null, null, null, null) $$,
  'a walk-up entry with no phone is still accepted');

select * from finish();
rollback;
