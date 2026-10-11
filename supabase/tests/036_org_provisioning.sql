-- T-TEN.B4: org provisioning (service role only).
-- Proves: create_org makes an org plus its owner in one step, folds and trims the slug, and refuses
-- (with a stable message) every bad name, bad slug, reserved slug, duplicate slug (also differing only
-- by case) and missing owner, leaving NO org behind; an existing account can be made owner of a second
-- org (the one way a two-org user comes to exist); org_add_existing_member gives an existing account a
-- membership, refuses a duplicate, a bad role, a missing org or account, and clears a stale
-- "removed" marker; both functions are executable by the service role only and are SECURITY DEFINER
-- with a pinned search_path; an org's slug cannot be changed once set; and the Team screen's rules
-- are untouched (team_add_member still refuses an account that belongs to an org; team_can_manage
-- still refuses a target who belongs to another org). Refusals pin the message AND the stable hint
-- (the thing a client switches on), so a refusal for some other reason cannot pass. Accounts that are
-- deleted, banned or anonymous cannot be made owner or member; names and slugs are checked for
-- control, invisible and look-alike characters; the slug format is also a table CHECK.
begin;
select plan(163);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner1@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'owner2@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'plain@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'fresh@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'deleted@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'banned@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000007', 'anonymous@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000008', 'ban-expired@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000009', 'ban-now@test.seduh-next');
update auth.users set deleted_at = now() where id = '00000000-0000-0000-0000-000000000005';
update auth.users set banned_until = now() + interval '100 years' where id = '00000000-0000-0000-0000-000000000006';
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-000000000007';
update auth.users set banned_until = now() - interval '1 day' where id = '00000000-0000-0000-0000-000000000008';
update auth.users set banned_until = now() where id = '00000000-0000-0000-0000-000000000009';

-- reads the stable hint of the error a statement raises (the thing a client switches on)
create function pg_temp.hint_of(q text) returns text language plpgsql as $f$
declare h text;
begin
  execute q;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, '(no hint)');
end
$f$;

create temp table _baseline as select count(*)::int as orgs, (select count(*)::int from org_members) as members from orgs;
create temp table _made (label text, id uuid);

-- ============ create_org: the happy path ============

insert into _made select 'delta', create_org('  Delta Coffee  ', '  Delta-Coffee ', '00000000-0000-0000-0000-000000000001');
select is((select count(*)::int from orgs where slug = 'delta-coffee'), 1, 'the org exists, slug trimmed and folded to lower case');
select is((select name from orgs where slug = 'delta-coffee'), 'Delta Coffee', 'its name is trimmed');
select is((select id from _made where label = 'delta'), (select id from orgs where slug = 'delta-coffee'),
  'create_org returns the new org''s id');
select is(
  (select string_agg(user_id::text || ':' || role, ',') from org_members where org_id = (select id from _made where label = 'delta')),
  '00000000-0000-0000-0000-000000000001:owner',
  'and the given account is its one member, as owner'
);

-- an existing account can own a second org: this is how a two-org user comes to exist
insert into _made select 'echo', create_org('Echo Roasters', 'echo-roasters', '00000000-0000-0000-0000-000000000001');
select is((select count(*)::int from org_members where user_id = '00000000-0000-0000-0000-000000000001' and role = 'owner'), 2,
  'an account that already owns one org can be made owner of a second');

-- ============ create_org: refusals, each pinned ============

select throws_ok(
  format('select create_org(%L, %L, %L)', c.name, 'valid-slug', '00000000-0000-0000-0000-000000000002'),
  '22023', 'create_org: the organisation name must be 1 to 80 characters',
  'a bad name is refused: ' || c.label
)
from (values
  ('null', null::text), ('empty', ''), ('only spaces', '   '), ('81 characters', repeat('n', 81)),
  ('only a no-break space', chr(160)), ('only a zero-width space', chr(8203)),
  ('a control character inside', 'A' || chr(7) || 'B'), ('a newline inside', 'A' || chr(10) || 'B'),
  ('a bidi override U+202E', 'A' || chr(8238) || 'B'),
  ('a bidi embedding U+202A', 'A' || chr(8234) || 'B'), ('a bidi embedding U+202B', 'A' || chr(8235) || 'B'),
  ('a bidi override U+202D', 'A' || chr(8237) || 'B'), ('a bidi pop U+202C', 'A' || chr(8236) || 'B'),
  ('a bidi isolate U+2066', 'A' || chr(8294) || 'B'), ('a bidi isolate U+2067', 'A' || chr(8295) || 'B'),
  ('a bidi isolate U+2068', 'A' || chr(8296) || 'B'), ('a bidi isolate pop U+2069', 'A' || chr(8297) || 'B'),
  ('only a zero-width non-joiner U+200C', chr(8204)), ('only a zero-width joiner U+200D', chr(8205)),
  ('only a word joiner U+2060', chr(8288)), ('only a byte-order mark U+FEFF', chr(65279))
) as c(label, name);

select throws_ok(
  format('select create_org(%L, %L, %L)', 'A Name', c.slug, '00000000-0000-0000-0000-000000000002'),
  '22023', 'create_org: the slug must be 3 to 40 lower-case letters and digits, with single hyphens between them',
  'a bad slug is refused: ' || c.label
)
from (values
  ('null', null::text), ('empty', ''), ('2 characters', 'ab'), ('41 characters', repeat('a', 41)),
  ('leading hyphen', '-abc'), ('trailing hyphen', 'abc-'), ('doubled hyphen', 'a--b'),
  ('underscore', 'ab_cd'), ('inner space', 'ab cd'), ('accented letter', 'caf' || chr(233)),
  ('non-latin', chr(26085) || chr(26412) || chr(35486)), ('dot', 'a.bc'), ('slash', 'a/bc'),
  ('the Kelvin sign, a look-alike that lower-cases to k', chr(8490) || 'elvin-co'), ('a tab inside', 'ab' || chr(9) || 'cd')
) as c(label, slug);

select lives_ok(format('select create_org(%L, %L, %L)', 'Edge Case', repeat('a', 40), '00000000-0000-0000-0000-000000000002'),
  'a 40-character slug is accepted (the limit is inclusive)');
select lives_ok(format('select create_org(%L, %L, %L)', 'Edge Case 3', 'a1b', '00000000-0000-0000-0000-000000000002'),
  'and a 3-character slug with a digit');
select lives_ok(format('select create_org(%L, %L, %L)', repeat('n', 80), 'name-80-co', '00000000-0000-0000-0000-000000000002'),
  'an 80-character name is accepted (the limit is inclusive)');
select lives_ok(format('select create_org(%L, %L, %L)', 'N', 'name-1-co', '00000000-0000-0000-0000-000000000002'),
  'and a 1-character name');
select lives_ok(format('select create_org(%L, %L, %L)', 'Ban Expired Co', 'ban-expired-co', '00000000-0000-0000-0000-000000000008'),
  'an account whose ban has expired is eligible');

select throws_ok(
  format('select create_org(%L, %L, %L)', 'Inactive Owner', 'inactive-owner-co', c.usr),
  '22023', 'create_org: the owner must be an existing, active account',
  'an owner who is ' || c.label || ' is refused'
)
from (values
  ('deleted', '00000000-0000-0000-0000-000000000005'),
  ('banned', '00000000-0000-0000-0000-000000000006'),
  ('anonymous', '00000000-0000-0000-0000-000000000007')
) as c(label, usr);

-- the slug format is a table CHECK too, so a direct insert cannot slip past create_org
select throws_ok($$ insert into orgs (name, slug) values ('Legacy', 'Legacy-Co') $$,
  '23514', null, 'the table itself refuses a slug with upper-case letters');
select throws_ok($$ insert into orgs (name, slug) values ('Short', 'ab') $$,
  '23514', null, 'and one that is too short');

select throws_ok(
  format('select create_org(%L, %L, %L)', 'Reserved Co', c.slug, '00000000-0000-0000-0000-000000000002'),
  '22023', 'create_org: that slug is reserved',
  'a reserved slug is refused: ' || c.slug
)
from (values
  ('app'), ('admin'), ('api'), ('www'), ('live'), ('results'), ('tour'), ('community'), ('tools'),
  ('guess-the-bean'), ('about'), ('contact'), ('privacy'), ('terms'), ('neutrality'),
  ('login'), ('signup'), ('auth'), ('ADMIN'), (' Live '),
  ('assets'), ('bts'), ('marketing'), ('events'), ('team'), ('projector'), ('phone'), ('splash'),
  ('help'), ('docs'), ('support'), ('pricing'), ('status'), ('static'), ('settings'), ('dashboard')
) as c(slug);

select throws_ok(
  format('select create_org(%L, %L, %L)', 'Duplicate', c.slug, '00000000-0000-0000-0000-000000000002'),
  '23505', 'create_org: that slug is already taken',
  'a duplicate slug is refused: ' || c.label
)
from (values ('same case', 'delta-coffee'), ('different case', 'DELTA-COFFEE')) as c(label, slug);

select throws_ok(
  format('select create_org(%L, %L, %L)', 'Nobody Owns Me', 'nobody-owns-me', c.owner),
  '22023', 'create_org: the owner must be an existing, active account',
  'a missing owner is refused: ' || c.label
)
from (values ('null', null::text), ('no such account', '00000000-0000-0000-0000-0000000000ee')) as c(label, owner);

select is(
  (select count(*)::int from orgs where slug in ('nobody-owns-me', 'valid-slug', 'duplicate', 'reserved-co', 'inactive-owner-co')),
  0,
  'a refused call leaves no org behind'
);
select is(
  (select count(*)::int from orgs) - (select orgs from _baseline), 7,
  'only the seven orgs created on purpose exist (delta, echo, the 40- and 3-character slugs, the 80- and 1-character names, the expired-ban owner)'
);

-- the table CHECK refuses every way a slug can be malformed, and pins the constraint by name
select throws_ok(
  format('insert into orgs (name, slug) values (%L, %L)', 'Bad Slug', c.slug),
  '23514', 'new row for relation "orgs" violates check constraint "orgs_slug_format"',
  'the table itself refuses a slug that is ' || c.label
)
from (values
  ('with a trailing hyphen', 'abc-'), ('with a leading hyphen', '-abc'), ('with a doubled hyphen', 'a--b'),
  ('with an underscore', 'ab_cd'), ('with a dot', 'a.bc'), ('with a space', 'ab cd'),
  ('41 characters long', repeat('a', 41))
) as c(label, slug);
select lives_ok($$ insert into orgs (name, slug) values ('Digits Co', '1a2') $$,
  'and accepts a slug that starts with a digit');
select lives_ok(format('select create_org(%L, %L, %L)', 'Digit Start', '1ab', '00000000-0000-0000-0000-000000000002'),
  'create_org accepts a slug that starts with a digit');
select lives_ok(format('select create_org(%L, %L, %L)', 'All Digits', '123', '00000000-0000-0000-0000-000000000002'),
  'and one made only of digits');

-- trimming covers tabs, carriage returns and newlines, not only spaces, and the length rules apply AFTER it
select lives_ok(format('select create_org(%L, %L, %L)', E'\t Tab Name \r\n', E'\tabc-def\n', '00000000-0000-0000-0000-000000000002'),
  'a name and slug padded with tabs, a carriage return and a newline are accepted');
select is((select name || '|' || slug from orgs where slug = 'abc-def'), 'Tab Name|abc-def',
  '…and stored trimmed');
select throws_ok(
  format('select create_org(%L, %L, %L)', 'Padded Slug', ' ab ', '00000000-0000-0000-0000-000000000002'),
  '22023', 'create_org: the slug must be 3 to 40 lower-case letters and digits, with single hyphens between them',
  'a 2-character slug padded to look longer is still refused (the length is checked after trimming)'
);
select lives_ok(format('select create_org(%L, %L, %L)', 'Padded Forty', ' ' || repeat('a', 39) || 'b ', '00000000-0000-0000-0000-000000000002'),
  'a 40-character slug with padding around it is accepted');
select lives_ok(format('select create_org(%L, %L, %L)', repeat('m', 80) || '  ', 'padded-eighty', '00000000-0000-0000-0000-000000000002'),
  'an 80-character name with padding after it is accepted');

-- the boundary orgs are stored whole (not truncated)
select is((select char_length(name) from orgs where slug = 'name-80-co'), 80, 'the 80-character name is stored in full');
select is((select char_length(slug) from orgs where name = 'Edge Case' and slug like 'aaaa%'), 40, 'and the 40-character slug');
select lives_ok(format('select create_org(%L, %L, %L)', 'Ban Now Co', 'ban-now-co', '00000000-0000-0000-0000-000000000009'),
  'an account whose ban ends exactly now is eligible (the boundary is inclusive)');

-- ============ privileges ============

select ok(
  has_function_privilege('service_role', 'create_org(text, text, uuid)', 'execute')
  and has_function_privilege('service_role', 'org_add_existing_member(uuid, uuid, text)', 'execute'),
  'the service role can execute both functions'
);
select ok(
  not has_function_privilege('authenticated', 'create_org(text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'create_org(text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'org_add_existing_member(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'org_add_existing_member(uuid, uuid, text)', 'execute'),
  'authenticated and anon can execute neither'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('create_org', 'org_add_existing_member')
      and p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)),
  2,
  'both are SECURITY DEFINER with search_path pinned'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select create_org('Self Serve', 'self-serve', '00000000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function create_org',
  'a signed-in owner cannot create an org (invite-only: there is no self-serve path)'
);
select throws_ok(
  $$ select org_add_existing_member((select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000003', 'owner') $$,
  '42501', 'permission denied for function org_add_existing_member',
  'nor add a member to an org, even their own'
);
reset role;
set local role anon;
select throws_ok(
  $$ select create_org('Anon Org', 'anon-org', '00000000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function create_org',
  'anon cannot create an org'
);
reset role;
set local role service_role;
select lives_ok(
  $$ select create_org('Foxtrot Beans', 'foxtrot-beans', '00000000-0000-0000-0000-000000000002') $$,
  'the service role can'
);
reset role;

-- ============ the slug is immutable ============

select throws_ok(
  $$ update orgs set slug = 'changed-slug' where slug = 'delta-coffee' $$,
  '23001', 'orgs.slug is immutable',
  'an org''s slug cannot be changed (it appears in printed and QR audience links)'
);
select lives_ok($$ update orgs set slug = slug where slug = 'delta-coffee' $$,
  'writing the same slug back is not a change');
select lives_ok($$ update orgs set name = 'Delta Coffee Co' where slug = 'delta-coffee' $$,
  'but the name can be edited');
select is((select name from orgs where slug = 'delta-coffee'), 'Delta Coffee Co', '…and was');

-- ============ org_add_existing_member ============

select lives_ok(
  $$ select org_add_existing_member((select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000003', 'organiser') $$,
  'an existing account is added to an org as an organiser'
);
select is(
  (select role from org_members where org_id = (select id from orgs where slug = 'delta-coffee') and user_id = '00000000-0000-0000-0000-000000000003'),
  'organiser', '…with that role'
);
select lives_ok(
  $$ select org_add_existing_member((select id from orgs where slug = 'echo-roasters'), '00000000-0000-0000-0000-000000000003', 'owner') $$,
  'and to a SECOND org (as an owner there): a two-org member'
);
select is((select count(*)::int from org_members where user_id = '00000000-0000-0000-0000-000000000003'), 2,
  'the account now has two memberships');
select is(
  (select role from org_members where org_id = (select id from orgs where slug = 'echo-roasters') and user_id = '00000000-0000-0000-0000-000000000003'),
  'owner', '…and the role in the second org is the owner role that was asked for (not silently an organiser)'
);

select throws_ok(
  format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000003', 'owner'),
  '23505', 'org_add_existing_member: that account is already a member of this organisation',
  'a duplicate is refused (even with a different role)'
);
select is(
  (select role from org_members where org_id = (select id from orgs where slug = 'delta-coffee') and user_id = '00000000-0000-0000-0000-000000000003'),
  'organiser', '…and the existing role was not overwritten'
);

select throws_ok(
  format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000004', c.role),
  '22023', 'org_add_existing_member: role must be owner or organiser',
  'a bad role is refused: ' || c.label
)
from (values ('null', null::text), ('boss', 'boss'), ('wrong case', 'Owner'), ('empty', ''),
             ('member', 'member'), ('admin', 'admin'), ('leading space', ' owner')) as c(label, role);

select throws_ok(
  format('select org_add_existing_member(%L, %L, %L)', c.org, '00000000-0000-0000-0000-000000000004', 'organiser'),
  '22023', 'org_add_existing_member: no such organisation',
  'a missing org is refused: ' || c.label
)
from (values ('null', null::text), ('no such org', '00000000-0000-0000-0000-0000000000dd')) as c(label, org);

select throws_ok(
  format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), c.usr, 'organiser'),
  '22023', 'org_add_existing_member: no such active account',
  'a missing account is refused: ' || c.label
)
from (values ('null', null::text), ('no such account', '00000000-0000-0000-0000-0000000000ee')) as c(label, usr);

select is((select count(*)::int from org_members where user_id = '00000000-0000-0000-0000-000000000004'), 0,
  'none of the refused calls added the fresh account anywhere');

select throws_ok(
  format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), c.usr, 'organiser'),
  '22023', 'org_add_existing_member: no such active account',
  'a member who is ' || c.label || ' is refused'
)
from (values
  ('deleted', '00000000-0000-0000-0000-000000000005'),
  ('banned', '00000000-0000-0000-0000-000000000006'),
  ('anonymous', '00000000-0000-0000-0000-000000000007')
) as c(label, usr);

select set_config('test.delta_id', (select id::text from orgs where slug = 'delta-coffee'), true);
set local role service_role;
select lives_ok(
  format('select org_add_existing_member(%L, %L, %L)', current_setting('test.delta_id'), '00000000-0000-0000-0000-000000000008', 'organiser'),
  'the service role can add an existing account to an org (org_add_existing_member run as service_role)'
);
reset role;

-- the stable hint of every refusal (what a client switches on)
select is(pg_temp.hint_of(c.q), c.hint, 'hint ' || c.hint)
from (values
  (format('select create_org(null, %L, %L)', 'hint-co-1', '00000000-0000-0000-0000-000000000002'), 'org_name_invalid'),
  (format('select create_org(%L, %L, %L)', 'N', 'ab', '00000000-0000-0000-0000-000000000002'), 'org_slug_invalid'),
  (format('select create_org(%L, %L, %L)', repeat('n', 401), 'hint-co-3', '00000000-0000-0000-0000-000000000002'), 'org_name_invalid'),
  (format('select create_org(%L, %L, %L)', 'N', repeat('a', 401), '00000000-0000-0000-0000-000000000002'), 'org_slug_invalid'),
  (format('select create_org(%L, %L, %L)', 'N', 'admin', '00000000-0000-0000-0000-000000000002'), 'org_slug_reserved'),
  (format('select create_org(%L, %L, %L)', 'N', 'delta-coffee', '00000000-0000-0000-0000-000000000002'), 'org_slug_taken'),
  (format('select create_org(%L, %L, null)', 'N', 'hint-co-2'), 'org_owner_not_found'),
  (format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000004', 'boss'), 'member_role_invalid'),
  (format('select org_add_existing_member(%L, %L, %L)', '00000000-0000-0000-0000-0000000000dd', '00000000-0000-0000-0000-000000000004', 'organiser'), 'org_not_found'),
  (format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-0000000000ee', 'organiser'), 'member_user_not_found'),
  (format('select org_add_existing_member(%L, %L, %L)', (select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000003', 'organiser'), 'member_exists')
) as c(q, hint);

-- adding someone back clears a stale "removed" marker (the existing trigger still runs on this path)
insert into team_removed_members (org_id, user_id)
  values ((select id from orgs where slug = 'echo-roasters'), '00000000-0000-0000-0000-000000000004');
select org_add_existing_member((select id from orgs where slug = 'echo-roasters'), '00000000-0000-0000-0000-000000000004', 'organiser');
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000004'),
  0,
  'adding an account that had been removed from that org clears the removal marker'
);
delete from org_members where org_id = (select id from orgs where slug = 'echo-roasters') and user_id = '00000000-0000-0000-0000-000000000004';

-- ============ the Team screen's rules are untouched ============

select throws_ok(
  format('select team_add_member(%L, %L)', (select id from orgs where slug = 'foxtrot-beans'), '00000000-0000-0000-0000-000000000003'),
  null, 'team_add_member: that account already belongs to an organisation',
  'team_add_member still refuses an account that belongs to an org (here, one with two memberships)'
);
select lives_ok(
  format('select team_add_member(%L, %L)', (select id from orgs where slug = 'foxtrot-beans'), '00000000-0000-0000-0000-000000000004'),
  'and still accepts a brand-new account (so the refusal above is for the right reason)'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_manage((select id from orgs where slug = 'delta-coffee'), '00000000-0000-0000-0000-000000000003'),
  false,
  'team_can_manage still refuses a target who belongs to another org (a two-org member is not the Team screen''s to manage)'
);
select is(
  team_can_manage((select id from orgs where slug = 'foxtrot-beans'), '00000000-0000-0000-0000-000000000004'),
  false,
  'and someone who is not an owner of that org (user 1 owns Delta and Echo, not Foxtrot) cannot manage its accounts'
);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  team_can_manage((select id from orgs where slug = 'foxtrot-beans'), '00000000-0000-0000-0000-000000000004'),
  true,
  'positive control: Foxtrot''s own owner CAN manage an account that lives only in Foxtrot (so the refusals above are for the right reason)'
);
reset role;

-- ============ the handlers relabel only their own constraint ============
-- A unique violation from some OTHER index must reach the caller as itself, not be dressed up as
-- "slug taken". A temporary unique index on the lower-cased name stands in for any future one.

create unique index orgs_name_lower_test_idx on orgs (lower(name));
select throws_ok(
  format('select create_org(%L, %L, %L)', 'echo ROASTERS', 'name-clash-co', '00000000-0000-0000-0000-000000000002'),
  '23505', 'duplicate key value violates unique constraint "orgs_name_lower_test_idx"',
  'a unique violation from another index passes through unchanged (it is not relabelled "slug taken")'
);
drop index orgs_name_lower_test_idx;

select * from finish();
rollback;
