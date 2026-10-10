-- T-TEN.B5: never lose the last owner.
-- Proves: the last owner of an org cannot be deleted or demoted by ANY writer (not only
-- through team_remove_member); an org with two owners loses one at a time and refuses the
-- second; promoting a successor first (org_set_role) makes the demotion legal; organisers
-- come and go freely; deleting the org itself (and so its owner rows) still works; deleting
-- the auth account of the only owner is refused; org_set_role is callable by the service
-- role only and validates its input; the existing team_remove_member behaviour is
-- unchanged; the service role cannot TRUNCATE memberships or orgs (a TRUNCATE fires no row
-- trigger, so it would walk past the guard); one statement that removes or demotes ALL of an
-- org's owners is refused, while removing ONE of two owners works. Fixtures: org A (two
-- owners, one organiser), org B (one owner), org C (one owner, one organiser), org D (two
-- owners).
begin;
select plan(34);

-- ============ fixtures (as postgres, bypasses RLS) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner-a1@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'owner-a2@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'organiser-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'owner-b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'owner-c@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'organiser-c@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000007', 'owner-d1@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000008', 'owner-d2@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b'),
  ('00000000-0000-0000-0000-0000000000c0', 'Org C', 'org-c'),
  ('00000000-0000-0000-0000-0000000000d0', 'Org D', 'org-d');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000004', 'owner'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000005', 'owner'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000006', 'organiser'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000007', 'owner'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000008', 'owner');

-- ============ the only owner cannot go ============

select throws_ok(
  $$ delete from org_members
      where org_id = '00000000-0000-0000-0000-0000000000b0'
        and user_id = '00000000-0000-0000-0000-000000000004' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'the only owner of an org cannot be deleted'
);
select throws_ok(
  $$ update org_members set role = 'organiser'
      where org_id = '00000000-0000-0000-0000-0000000000b0'
        and user_id = '00000000-0000-0000-0000-000000000004' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'nor demoted to organiser'
);
select is(
  (select role from org_members
    where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000004'),
  'owner',
  'and is still an owner after both refusals'
);
select throws_ok(
  $$ delete from auth.users where id = '00000000-0000-0000-0000-000000000004' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'deleting the auth account of an org''s only owner is refused (the membership cascade is stopped)'
);

-- ============ two owners: one at a time ============

select lives_ok(
  $$ update org_members set role = 'organiser'
      where org_id = '00000000-0000-0000-0000-0000000000a0'
        and user_id = '00000000-0000-0000-0000-000000000001' $$,
  'with two owners, one can be demoted'
);
select throws_ok(
  $$ update org_members set role = 'organiser'
      where org_id = '00000000-0000-0000-0000-0000000000a0'
        and user_id = '00000000-0000-0000-0000-000000000002' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'but the one left cannot be demoted'
);
select throws_ok(
  $$ delete from org_members
      where org_id = '00000000-0000-0000-0000-0000000000a0'
        and user_id = '00000000-0000-0000-0000-000000000002' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'nor deleted'
);

-- ============ promote a successor first, then it is legal ============

set local role service_role;
select lives_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'owner') $$,
  'the service role can promote a member to owner'
);
reset role;
select lives_ok(
  $$ update org_members set role = 'organiser'
      where org_id = '00000000-0000-0000-0000-0000000000a0'
        and user_id = '00000000-0000-0000-0000-000000000002' $$,
  'with a successor in place, the previous owner can be demoted'
);
select is(
  (select string_agg(user_id::text, ',' order by user_id) from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and role = 'owner'),
  '00000000-0000-0000-0000-000000000003',
  'org A now has exactly the promoted successor as owner'
);

-- ============ organisers are unaffected ============

select lives_ok(
  $$ delete from org_members
      where org_id = '00000000-0000-0000-0000-0000000000c0'
        and user_id = '00000000-0000-0000-0000-000000000006' $$,
  'an organiser can be removed'
);
select lives_ok(
  $$ insert into org_members (org_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000006', 'organiser') $$,
  'and added back'
);

-- ============ the existing team_remove_member behaviour is unchanged ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000005') $$,
  null, 'team_remove_member: you cannot remove yourself',
  'an owner still cannot remove themselves through the team screen''s function'
);
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000006') $$,
  'and can still remove an organiser'
);
reset role;

-- ============ the org itself can be deleted, owner rows and all ============

select lives_ok(
  $$ delete from orgs where id = '00000000-0000-0000-0000-0000000000c0' $$,
  'deleting an org works even though it removes its last owner row (the cascade)'
);
select is(
  (select count(*)::int from org_members where org_id = '00000000-0000-0000-0000-0000000000c0'),
  0,
  'and every membership of that org went with it'
);

-- ============ org_set_role: who may call it, and what it accepts ============

select ok(
  has_function_privilege('service_role', 'org_set_role(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'org_set_role(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'org_set_role(uuid, uuid, text)', 'execute'),
  'org_set_role is executable by the service role only'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select throws_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'owner') $$,
  '42501', null,
  'an owner cannot call it from their own session'
);
reset role;
set local role service_role;
select throws_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'boss') $$,
  '22023', 'org_set_role: role must be owner or organiser',
  'a role other than owner or organiser is refused'
);
select throws_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004', 'owner') $$,
  'P0002', 'org_set_role: that person is not a member of the org',
  'a person who is not a member of that org is refused (it does not add members)'
);
select lives_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'owner') $$,
  'setting the role a member already has is a harmless no-op'
);
select throws_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'organiser') $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'demoting the last owner through org_set_role is refused by the same guard'
);
reset role;

-- ============ one statement that takes ALL of an org's owners is refused ============

select throws_ok(
  $$ update org_members set role = 'organiser' where org_id = '00000000-0000-0000-0000-0000000000d0' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'one statement demoting every owner of an org is refused (the guard sees the earlier rows)'
);
select throws_ok(
  $$ delete from org_members where org_id = '00000000-0000-0000-0000-0000000000d0' and role = 'owner' $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'one statement deleting every owner of an org is refused'
);
select throws_ok(
  $$ delete from auth.users
      where id in ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000008') $$,
  'P0001', 'org_members: an org must keep at least one owner',
  'deleting the auth accounts of BOTH owners at once is refused'
);
select lives_ok(
  $$ delete from org_members
      where org_id = '00000000-0000-0000-0000-0000000000d0'
        and user_id = '00000000-0000-0000-0000-000000000007' $$,
  'but deleting ONE of two owners works (the guard does not refuse every owner delete)'
);
select is(
  (select string_agg(user_id::text, ',') from org_members
    where org_id = '00000000-0000-0000-0000-0000000000d0' and role = 'owner'),
  '00000000-0000-0000-0000-000000000008',
  'and the other owner is the one left'
);

-- ============ the service role cannot TRUNCATE its way past the guard ============

set local role service_role;
select throws_ok(
  $$ truncate org_members $$,
  '42501', 'permission denied for table org_members',
  'the service role cannot truncate memberships'
);
select throws_ok(
  $$ truncate orgs cascade $$,
  '42501', 'permission denied for table orgs',
  'nor truncate orgs (which would cascade to every membership)'
);
select throws_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', null) $$,
  '22023', 'org_set_role: role must be owner or organiser',
  'a null role is refused'
);
select throws_ok(
  $$ select org_set_role('00000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000003', 'owner') $$,
  'P0002', 'org_set_role: that person is not a member of the org',
  'an org that does not exist is refused the same way as a non-member'
);
reset role;

-- ============ the guard function ============

select ok(
  not has_function_privilege('authenticated', 'app.protect_last_owner()', 'execute')
  and not has_function_privilege('anon', 'app.protect_last_owner()', 'execute'),
  'the guard function is executable by no API role'
);
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'protect_last_owner'),
  'and is SECURITY DEFINER with search_path pinned'
);
-- Not proven here: two SESSIONS demoting the last two owners at the same moment. The guard
-- takes `for no key update` on the org row first so the second waits and then sees the first's
-- result, and `for update` on the other owner rows so a REPEATABLE READ session fails instead
-- of passing on a stale snapshot. pgTAP runs in one session inside an uncommitted
-- transaction, so this can only pin the intent by source (ROADMAP). The comparison strips
-- comments first, so a commented-out lock cannot satisfy it, and checks the order.
create function pg_temp.guard_source() returns text language sql as $f$
  select regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
    from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'protect_last_owner'
$f$;
select ok(
  strpos(pg_temp.guard_source(), 'from public.orgs o where o.id = old.org_id for no key update') > 0
  and strpos(pg_temp.guard_source(), 'where m.org_id = old.org_id and m.role = ''owner'' and m.user_id <> old.user_id for update') > 0
  and strpos(pg_temp.guard_source(), 'for no key update') < strpos(pg_temp.guard_source(), 'for update'),
  'the guard locks the org row, then the other owner rows, in code (source pin; no two-session test)'
);

select * from finish();
rollback;
