-- Live-event finding #2 (2026-10-04): team members need their own logins, managed by the owner.
-- Proves: only an owner of THIS org can see, remove or ask about the team (an organiser, a member
-- of another org, a non-member and anon all get nothing / a refusal, and a non-owner learns
-- nothing about who is on the team); an owner can never be removed or reset, and nobody can remove
-- themselves; a removed member immediately reads zero rows; team_add_member is callable by the
-- service role only, accepts only a freshly created account that belongs to no org, and makes that
-- account a working organiser; the role column only holds 'owner' or 'organiser'; the one-off
-- promotion of an org's earliest member picks exactly one and is idempotent. Runs under a real
-- `authenticated` role with RLS in force.
begin;
select plan(69);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'timekeeper@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'brandnew@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'old-account@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'other-owner@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'stranger@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000007', 'second-new@test.seduh-next');
-- An account that has existed for a while (e.g. a community user), and one still to choose a password.
update auth.users set created_at = now() - interval '1 hour'
  where id = '00000000-0000-0000-0000-000000000004';
update auth.users set raw_user_meta_data = '{"must_change_password": true}'::jsonb
  where id = '00000000-0000-0000-0000-000000000002';

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000005', 'owner');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Event B');

-- ============ roles and the promotion ============

select throws_ok(
  $$ insert into org_members (org_id, user_id, role)
     values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', 'boss') $$,
  '23514',
  null,
  'a role other than owner / organiser is refused'
);

-- NOTE: the two one-off statements below (the tidy-up and the promotion) are COPIES of the ones in the
-- migration — a migration's own statements cannot be re-run from a test — so they prove the logic, not
-- that the migration still contains it. A change to the migration's version needs this one changed too.
-- The tidy-up statement from the migration: a stray role value becomes 'organiser' so the constraint
-- can be added, and the two real values are left alone. (The constraint is dropped and re-added
-- around it, as it is in the migration's own order.)
alter table org_members drop constraint org_members_role_check;
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', 'admin');
update org_members set role = 'organiser' where role not in ('owner', 'organiser');
alter table org_members add constraint org_members_role_check check (role in ('owner', 'organiser'));
select is(
  (select role from org_members
    where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000006'),
  'organiser',
  'a stray role value is turned into organiser before the constraint goes on'
);
select is(
  (select string_agg(role, ',' order by user_id) from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0'),
  'owner,organiser',
  'and the real owner / organiser values are left alone'
);
delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000006';

-- The promotion statement from the migration, on an org with two members and no owner.
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-0000000000c0', 'Org C', 'org-c');
insert into org_members (org_id, user_id, role, created_at) values
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000006', 'organiser', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000007', 'organiser', now() - interval '1 day');
create function pg_temp.promote() returns void language sql as $f$
  update org_members m
  set role = 'owner'
  where (m.org_id, m.user_id) in (
    select distinct on (o.org_id) o.org_id, o.user_id
    from org_members o
    where not exists (select 1 from org_members x where x.org_id = o.org_id and x.role = 'owner')
    order by o.org_id, o.created_at, o.user_id
  );
$f$;
select pg_temp.promote();
select is(
  (select string_agg(role, ',' order by created_at) from org_members
    where org_id = '00000000-0000-0000-0000-0000000000c0'),
  'owner,organiser',
  'the promotion makes an org''s EARLIEST member its owner, and only that one'
);
select pg_temp.promote();
select is(
  (select count(*)::int from org_members
    where org_id = '00000000-0000-0000-0000-0000000000c0' and role = 'owner'),
  1,
  'and running it again changes nothing'
);
select is(
  (select count(*)::int from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and role = 'owner'),
  1,
  'an org that already has an owner is left alone'
);

-- ============ privileges and search_path ============

select ok(
  not has_function_privilege('anon', 'team_list_members(uuid)', 'execute')
  and not has_function_privilege('anon', 'team_remove_member(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'team_can_manage(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'team_add_member(uuid, uuid)', 'execute'),
  'anon can execute none of the team functions'
);
select ok(
  has_function_privilege('authenticated', 'team_list_members(uuid)', 'execute')
  and has_function_privilege('authenticated', 'team_remove_member(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'team_can_manage(uuid, uuid)', 'execute'),
  'authenticated can execute list, remove and can-manage (each checks ownership itself)'
);
select ok(
  not has_function_privilege('authenticated', 'team_add_member(uuid, uuid)', 'execute'),
  'but authenticated can NOT execute team_add_member — an owner''s browser cannot attach an arbitrary account'
);
select ok(
  has_function_privilege('service_role', 'team_add_member(uuid, uuid)', 'execute'),
  'team_add_member is for the service role (the Edge Function)'
);
select ok(
  not has_function_privilege('service_role', 'team_can_manage(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'team_list_members(uuid)', 'execute')
  and not has_function_privilege('service_role', 'team_remove_member(uuid, uuid)', 'execute'),
  'the service role holds only team_add_member: the others judge auth.uid(), which it does not have'
);
select ok(
  not has_function_privilege('authenticated', 'app.is_org_owner(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.is_org_owner(uuid)', 'execute'),
  'the internal owner check is not callable by the API roles'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('team_can_manage', 'team_list_members', 'team_remove_member', 'team_add_member', 'is_org_owner')
      and n.nspname in ('public', 'app')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  5,
  'every team function is SECURITY DEFINER with search_path pinned to empty'
);

-- ============ team_can_manage ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select is(team_can_manage('00000000-0000-0000-0000-0000000000a0'), true, 'the owner may manage their own org');
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002'),
  true,
  '…and an organiser on its team'
);
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001'),
  false,
  'but not an owner (not even themselves)'
);
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006'),
  false,
  'nor someone who is not on the team'
);
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000b0'),
  false,
  'the owner of A may not manage org B'
);
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000005'),
  false,
  'nor B''s owner'
);

-- ============ a person who belongs to a second org is not this org's to reset ============

reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000008', 'two-orgs@test.seduh-next');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000008', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000008', 'owner');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000008'),
  false,
  'a member of A who OWNS org B cannot be reset by A''s owner (that would take over B)'
);
reset role;
update org_members set role = 'organiser'
  where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000008';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000008'),
  false,
  'nor one who is merely an organiser in B — any second org is enough'
);
reset role;
delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000008';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_manage('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000008'),
  true,
  'once they belong only to A, A''s owner may manage them again'
);
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000005') $$,
  '42501',
  null,
  'and the owner of A still cannot touch B''s team'
);
reset role;
delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000008';
delete from auth.users where id = '00000000-0000-0000-0000-000000000008';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ team_list_members ============

select is(
  (select count(*)::int from team_list_members('00000000-0000-0000-0000-0000000000a0')),
  2,
  'the owner sees the two members of their team'
);
select is(
  (select string_agg(email || ':' || role, ',' order by (role = 'owner') desc)
     from team_list_members('00000000-0000-0000-0000-0000000000a0')),
  'owner@test.seduh-next:owner,timekeeper@test.seduh-next:organiser',
  'with their emails (which only auth.users holds) and roles, the owner first'
);
select is(
  (select must_change_password from team_list_members('00000000-0000-0000-0000-0000000000a0')
    where email = 'timekeeper@test.seduh-next'),
  true,
  'an account that still has to choose its password says so'
);
select is(
  (select must_change_password from team_list_members('00000000-0000-0000-0000-0000000000a0')
    where email = 'owner@test.seduh-next'),
  false,
  'one that has not, does not'
);
select throws_ok(
  $$ select * from team_list_members('00000000-0000-0000-0000-0000000000b0') $$,
  '42501',
  null,
  'the owner of A cannot list org B''s team'
);
select throws_ok(
  $$ select * from team_list_members('00000000-0000-0000-0000-0000000000ff') $$,
  '42501',
  null,
  'nor an org that does not exist (same refusal — no probing)'
);

-- ============ an organiser, a stranger and anon get nothing ============

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(team_can_manage('00000000-0000-0000-0000-0000000000a0'), false, 'an organiser may not manage the team');
select throws_ok(
  $$ select * from team_list_members('00000000-0000-0000-0000-0000000000a0') $$,
  '42501',
  null,
  'an organiser cannot list the team'
);
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'an organiser cannot remove anyone (the owner check comes before the self check)'
);
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'an organiser cannot remove the owner'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is(team_can_manage('00000000-0000-0000-0000-0000000000a0'), false, 'a non-member may not manage the team');
select throws_ok(
  $$ select * from team_list_members('00000000-0000-0000-0000-0000000000a0') $$,
  '42501',
  null,
  'a non-member cannot list the team'
);

reset role;
set local role anon;
select throws_ok(
  $$ select * from team_list_members('00000000-0000-0000-0000-0000000000a0') $$,
  '42501',
  null,
  'anon cannot list the team'
);
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'anon cannot remove a member'
);

-- ============ team_remove_member ============

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001') $$,
  null,
  'team_remove_member: you cannot remove yourself',
  'the owner cannot remove themselves'
);
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000005') $$,
  '42501',
  null,
  'the owner of A cannot remove B''s owner'
);
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006') $$,
  null,
  'team_remove_member: that person is not on the team',
  'removing someone who is not on the team is refused'
);
select is(
  (select count(*)::int from org_members where org_id = '00000000-0000-0000-0000-0000000000a0'),
  2,
  'none of the refused removals changed anything'
);

-- A second owner (inserted directly, as the table owner) to prove an owner cannot be removed.
reset role;
insert into org_members (org_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004', 'owner');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004') $$,
  null,
  'team_remove_member: an owner cannot be removed',
  'an owner cannot be removed, even by another owner'
);
reset role;
delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000004';

-- Before the removal, the organiser reads the org's event.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'before removal the organiser reads Org A''s event'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'the owner can remove an organiser'
);
select is(
  (select count(*)::int from org_members where org_id = '00000000-0000-0000-0000-0000000000a0'),
  1,
  'the membership row is gone'
);
reset role;
select is(
  (select count(*)::int from auth.users where id = '00000000-0000-0000-0000-000000000002'),
  1,
  'the Auth account is kept (merged_by / published_by reference it without cascade)'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'a removed member reads zero rows at once (RLS asks membership live)'
);
select is(
  (select count(*)::int from org_members),
  0,
  'and sees no memberships either'
);

-- ============ team_add_member: service role only, fresh accounts only ============

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an owner calling team_add_member from the API is refused'
);
reset role;
set local role anon;
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'anon is refused too'
);

reset role;
set local role service_role;
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004') $$,
  null,
  'team_add_member: only a newly created account can be added',
  'even the service role cannot attach an account that has existed for a while'
);
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000099') $$,
  null,
  'team_add_member: no such account',
  'or one that does not exist'
);
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000005') $$,
  null,
  'team_add_member: that account already belongs to an organisation',
  'another org''s owner is not attachable either, whatever its age'
);
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006') $$,
  null,
  'team_add_member: that account already belongs to an organisation',
  'a fresh account that already belongs to an org is refused'
);
select lives_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003') $$,
  'the service role attaches a freshly created account'
);
reset role;
select is(
  (select role from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000003'),
  'organiser',
  'as an organiser, never an owner'
);
set local role service_role;
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003') $$,
  null,
  'team_add_member: that account already belongs to an organisation',
  'adding the same account twice is refused'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'the newly added account reads Org A''s event'
);
select is(
  (select count(*)::int from events where id = '00000000-0000-0000-0000-0000000000e9'),
  0,
  'and not Org B''s'
);
select is(team_can_manage('00000000-0000-0000-0000-0000000000a0'), false, 'it cannot manage the team');

-- ============ the org keeps exactly its owner ============

reset role;
select is(
  (select count(*)::int from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and role = 'owner'),
  1,
  'after all of that, Org A still has exactly its one owner'
);
select is(
  (select count(*)::int from org_members
    where org_id = '00000000-0000-0000-0000-0000000000b0' and role = 'owner'),
  1,
  'and Org B is untouched'
);
select is(
  (select count(*)::int from org_members where org_id = '00000000-0000-0000-0000-0000000000b0'),
  1,
  'Org B''s team is untouched'
);

-- ============ the rest of what the first pass left unproven ============

-- A person in both A and B, removed from A: B is untouched (the delete is scoped to the org).
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000009', 'in-a-and-b@test.seduh-next');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000009', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000009', 'organiser');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000009') $$,
  'A''s owner removes someone who is in both A and B'
);
reset role;
select is(
  (select string_agg(org_id::text, ',') from org_members where user_id = '00000000-0000-0000-0000-000000000009'),
  '00000000-0000-0000-0000-0000000000b0',
  'and that person is still in B — the removal was scoped to A'
);

-- The list: a flag that is present but false reads false (what the choose-a-password screen writes),
-- and the function itself puts the owner first (not the caller re-sorting).
update auth.users set raw_user_meta_data = '{"must_change_password": false}'::jsonb
  where id = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (select must_change_password from team_list_members('00000000-0000-0000-0000-0000000000a0')
    where email = 'brandnew@test.seduh-next'),
  false,
  'a must_change_password flag that is present but false reads false'
);
select is(
  (select t.email
     from team_list_members('00000000-0000-0000-0000-0000000000a0')
       with ordinality as t(user_id, email, role, added_at, last_sign_in_at, must_change_password, n)
    order by n limit 1),
  'owner@test.seduh-next',
  'the owner is listed first by the function itself, even though another member sorts first by email'
);

-- Freshness boundary: 20 minutes old is refused, 5 minutes old is accepted.
reset role;
insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-000000000010', 'twenty@test.seduh-next', now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000011', 'five@test.seduh-next', now() - interval '5 minutes');
set local role service_role;
select throws_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000010') $$,
  null,
  'team_add_member: only a newly created account can be added',
  'an account 20 minutes old is refused'
);
select lives_ok(
  $$ select team_add_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000011') $$,
  'one 5 minutes old is accepted'
);
reset role;

select * from finish();
rollback;
