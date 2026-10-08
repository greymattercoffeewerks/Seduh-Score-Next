-- Team accounts, part two (2026-10-08): the owner sees who was removed and can restore them.
-- Proves: removing a member leaves a marker ("removed from THIS org by its owner") written only by
-- team_remove_member after its owner checks — a refused removal leaves none, and nobody can write
-- the table directly; only that org's owner can list the removed members or ask whether one can be
-- restored (a non-owner, another org's owner, a non-member and anon all get a refusal / false); the
-- list leaves out anyone who now belongs to an organisation; team_restore_member is callable by the
-- service role only, restores ONLY an account carrying a marker for that org and in no org (never an
-- arbitrary existing account, never into a different org), as an 'organiser' and never an owner,
-- consumes the marker, and the person reads that org's rows again; removing again refreshes the
-- marker; deleting the account or the org takes the marker with it. Runs under real roles with RLS
-- in force.
begin;
select plan(74);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'timekeeper@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'judge@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'community@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'other-owner@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'stranger@test.seduh-next');
-- A community-style account: old, in no org, never removed from anywhere.
update auth.users set created_at = now() - interval '1 hour'
  where id = '00000000-0000-0000-0000-000000000004';

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002', 'organiser'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000005', 'owner');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A');

-- ============ the marker table is closed to the API roles ============

select is(
  (select relrowsecurity from pg_class where oid = 'public.team_removed_members'::regclass),
  true,
  'the marker table has row level security on'
);
select is(
  (select count(*)::int from pg_policies where tablename = 'team_removed_members'),
  0,
  'and no policy at all: only the SECURITY DEFINER functions can reach it'
);
select ok(
  not has_table_privilege('anon', 'team_removed_members', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'team_removed_members', 'select, insert, update, delete'),
  'anon and authenticated hold no table privilege on it'
);

-- ============ function privileges and search_path ============

select ok(
  has_function_privilege('authenticated', 'team_list_removed_members(uuid)', 'execute')
  and has_function_privilege('authenticated', 'team_can_restore(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'team_remove_member(uuid, uuid)', 'execute'),
  'authenticated can execute list-removed, can-restore and remove (each checks ownership itself)'
);
select ok(
  not has_function_privilege('anon', 'team_list_removed_members(uuid)', 'execute')
  and not has_function_privilege('anon', 'team_can_restore(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'team_restore_member(uuid, uuid)', 'execute'),
  'anon can execute none of the new functions'
);
select ok(
  not has_function_privilege('authenticated', 'team_restore_member(uuid, uuid)', 'execute'),
  'authenticated can NOT execute team_restore_member — an owner''s browser cannot attach an account itself'
);
select ok(
  has_function_privilege('service_role', 'team_restore_member(uuid, uuid)', 'execute'),
  'team_restore_member is for the service role (the Edge Function)'
);
select ok(
  not has_function_privilege('service_role', 'team_list_removed_members(uuid)', 'execute')
  and not has_function_privilege('service_role', 'team_can_restore(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'team_remove_member(uuid, uuid)', 'execute'),
  'the service role holds only the restore: the others judge auth.uid(), which it does not have'
);
select ok(
  not has_function_privilege('anon', 'app.team_forget_removed_on_join()', 'execute')
  and not has_function_privilege('authenticated', 'app.team_forget_removed_on_join()', 'execute')
  and not has_function_privilege('service_role', 'app.team_forget_removed_on_join()', 'execute'),
  'the join trigger function is not callable by any API role'
);
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'team_forget_removed_on_join' and n.nspname = 'app'),
  'and is SECURITY DEFINER with search_path pinned to empty'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('team_list_removed_members', 'team_can_restore', 'team_restore_member', 'team_remove_member')
      and n.nspname = 'public'
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  4,
  'the new and replaced team functions are SECURITY DEFINER with search_path pinned to empty'
);

-- ============ nothing removed yet ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from team_list_removed_members('00000000-0000-0000-0000-0000000000a0')),
  0,
  'the removed list starts empty'
);
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002'),
  false,
  'a current member is not restorable'
);

-- ============ a refused removal leaves no marker ============

select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001') $$,
  'P0001',
  'team_remove_member: you cannot remove yourself',
  'an owner cannot remove themselves'
);
reset role;
insert into org_members (org_id, user_id, role) values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006', 'owner');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006') $$,
  'P0001',
  'team_remove_member: an owner cannot be removed',
  'nor can one owner remove another (a second owner is added for this check only)'
);
reset role;
delete from org_members where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006') $$,
  'P0001',
  null,
  'someone who is not on the team cannot be removed'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003') $$,
  '42501',
  null,
  'an organiser cannot remove a colleague'
);
reset role;
select is(
  (select count(*)::int from team_removed_members where org_id in ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0')),
  0,
  'and none of those left a marker (the raise rolls any write back; the real guard is that the marker is written only after the owner checks)'
);

-- ============ removing leaves the marker ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'the owner removes the timekeeper'
);
reset role;
select is(
  (select removed_by from team_removed_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'a marker now records who was removed from which org, and by whom'
);
select is(
  (select count(*)::int from org_members where user_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'and the membership itself is gone, as before'
);

-- ============ the list ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003') $$,
  'the owner removes the judge too'
);
select is(
  (select count(*)::int from team_list_removed_members('00000000-0000-0000-0000-0000000000a0')),
  2,
  'both of them'
);
select is(
  (select email from team_list_removed_members('00000000-0000-0000-0000-0000000000a0')
    where user_id = '00000000-0000-0000-0000-000000000002'),
  'timekeeper@test.seduh-next',
  'with the email (which only auth.users holds)'
);
-- Newest first. Updated in this order so that physical order (judge, timekeeper), alphabetical order
-- (judge, timekeeper) and the expected newest-first order (timekeeper, judge) cannot all coincide:
-- a missing ORDER BY would show.
reset role;
update team_removed_members set removed_at = now() - interval '2 days'
  where user_id = '00000000-0000-0000-0000-000000000003';
update team_removed_members set removed_at = now()
  where user_id = '00000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (select array_agg(email) from team_list_removed_members('00000000-0000-0000-0000-0000000000a0')),
  array['timekeeper@test.seduh-next', 'judge@test.seduh-next'],
  'newest first'
);
select throws_ok(
  $$ select * from team_list_removed_members('00000000-0000-0000-0000-0000000000b0') $$,
  '42501',
  null,
  'the owner of A cannot list org B''s removed members'
);
reset role;
-- B has a removed member of its own (the stranger), and B's owner lists B
insert into team_removed_members (org_id, user_id, removed_by) values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is(
  (select array_agg(email) from team_list_removed_members('00000000-0000-0000-0000-0000000000b0')),
  array['stranger@test.seduh-next'],
  'B''s owner sees B''s own removed member and none of A''s (the list is filtered by org)'
);
reset role;
delete from team_removed_members where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select * from team_list_removed_members('00000000-0000-0000-0000-0000000000ff') $$,
  '42501',
  null,
  'nor an org that does not exist (same refusal — no probing)'
);

-- someone who has since joined an organisation is not on offer
reset role;
insert into org_members (org_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000003', 'organiser');
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000003'),
  0,
  'joining an org cleared the judge''s marker (the trigger)'
);
-- a marker put back by hand (as an old row, or manual SQL, could) must still not be offered while they belong to an org
insert into team_removed_members (org_id, user_id, removed_by) values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  (select array_agg(email) from team_list_removed_members('00000000-0000-0000-0000-0000000000a0')),
  array['timekeeper@test.seduh-next'],
  'a removed person who now belongs to another org drops off the list'
);
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003'),
  false,
  'and is not restorable'
);
reset role;
delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000003';

-- ============ an organiser, another org's owner, a stranger and anon get nothing ============

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select * from team_list_removed_members('00000000-0000-0000-0000-0000000000a0') $$,
  '42501',
  null,
  'someone who is not an owner cannot list the removed members (not even themselves)'
);
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002'),
  false,
  'and cannot restore themselves'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select throws_ok(
  $$ select * from team_list_removed_members('00000000-0000-0000-0000-0000000000a0') $$,
  '42501',
  null,
  'another org''s owner cannot list A''s removed members'
);
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002'),
  false,
  'another org''s owner cannot restore A''s removed member into A'
);
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002'),
  false,
  'nor into their own org: the marker is for A, not B'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002'),
  false,
  'a non-member cannot restore anyone'
);

reset role;
set local role anon;
select throws_ok(
  $$ select * from team_list_removed_members('00000000-0000-0000-0000-0000000000a0') $$,
  '42501',
  null,
  'anon cannot list the removed members'
);
select throws_ok(
  $$ select team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'nor ask whether anyone can be restored'
);
select throws_ok(
  $$ insert into team_removed_members (org_id, user_id)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'anon cannot write a marker directly'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ insert into team_removed_members (org_id, user_id)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004') $$,
  '42501',
  null,
  'nor can the owner: a marker for an arbitrary account cannot be written from the browser'
);
reset role;

-- ============ team_can_restore for the owner ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002'),
  true,
  'the owner may restore someone they removed'
);
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004'),
  false,
  'but not an account that was never on the team (a community user, in no org, with no marker)'
);
reset role;

-- ============ team_restore_member (service role only) ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'the owner''s own session cannot call team_restore_member'
);
reset role;

set local role service_role;
select throws_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000004') $$,
  'P0001',
  'team_restore_member: that person was not removed from this team',
  'even the service role cannot attach an account that has no marker (a community user)'
);
select throws_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002') $$,
  'P0001',
  'team_restore_member: that person was not removed from this team',
  'nor put a person into a different org than the one they were removed from'
);
reset role;
select is(
  (select count(*)::int from org_members where user_id in
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002')),
  0,
  'and neither attempt attached anyone'
);

-- an account that has joined an org since cannot be restored on top of that
insert into org_members (org_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002', 'organiser');
-- (joining cleared the marker; put it back by hand so the restore's own check is what refuses)
insert into team_removed_members (org_id, user_id, removed_by) values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');
set local role service_role;
select throws_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'P0001',
  'team_restore_member: that account already belongs to an organisation',
  'a removed person who now belongs to an org cannot be restored'
);
reset role;
delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000002';

-- the person has no access while removed
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from events),
  0,
  'while removed, the person reads no events'
);
reset role;

set local role service_role;
select lives_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'the service role restores someone carrying a marker for that org'
);
reset role;
select is(
  (select role from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000002'),
  'organiser',
  'as an organiser — never an owner'
);
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000002'),
  0,
  'and the marker is consumed'
);
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000003'),
  1,
  'while the other removed person''s marker is untouched'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  (select count(*)::int from events),
  1,
  'the restored person reads the org''s events again'
);
reset role;

set local role service_role;
select throws_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'P0001',
  null,
  'restoring the same person twice is refused (the marker is gone)'
);
reset role;

-- ============ removing again refreshes the marker ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'a restored person can be removed again'
);
reset role;
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000002'),
  1,
  'with exactly one marker'
);
update team_removed_members set removed_at = now() - interval '5 days'
  where user_id = '00000000-0000-0000-0000-000000000002';
-- put them back on the team and remove once more through the real function: the marker is upserted
insert into org_members (org_id, user_id, role)
  values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002', 'organiser');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002') $$,
  'removing someone who still has an old marker (re-added by hand) does not collide with it'
);
reset role;
select ok(
  (select removed_at > now() - interval '1 minute' from team_removed_members
    where user_id = '00000000-0000-0000-0000-000000000002'),
  'it refreshes the marker instead'
);

-- ============ a marker dies when its person joins any org ============

reset role;
insert into team_removed_members (org_id, user_id, removed_by) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000005');
insert into org_members (org_id, user_id, role) values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', 'organiser');
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000006'),
  0,
  'joining any org clears every marker the person has, in every org'
);
delete from org_members where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000006';

-- removed from A, then joined B and left it again: no longer A's to restore
insert into team_removed_members (org_id, user_id, removed_by) values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001');
insert into org_members (org_id, user_id, role) values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', 'organiser');
delete from org_members where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006'),
  false,
  'someone removed from A who then joined B and left it is not A''s to restore'
);
select is(
  (select count(*)::int from team_list_removed_members('00000000-0000-0000-0000-0000000000a0') where user_id = '00000000-0000-0000-0000-000000000006'),
  0,
  'nor offered on A''s list'
);
reset role;

-- removed from BOTH of two orgs they belonged to at once: only the latest removal counts
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', 'organiser');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006') $$,
  'A''s owner removes the shared person from A'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select lives_ok(
  $$ select team_remove_member('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006') $$,
  'then B''s owner removes them from B'
);
reset role;
update team_removed_members set removed_at = now() - interval '1 hour'
  where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006'),
  false,
  'A''s removal has been superseded by B''s, so A''s owner can no longer restore them'
);
select is(
  (select count(*)::int from team_list_removed_members('00000000-0000-0000-0000-0000000000a0') where user_id = '00000000-0000-0000-0000-000000000006'),
  0,
  'and does not see them listed'
);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select is(
  team_can_restore('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006'),
  true,
  'while B''s owner (the latest removal) can'
);
select is(
  (select count(*)::int from team_list_removed_members('00000000-0000-0000-0000-0000000000b0') where user_id = '00000000-0000-0000-0000-000000000006'),
  1,
  'and sees them listed'
);
reset role;
set local role service_role;
select throws_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006') $$,
  'P0001',
  'team_restore_member: that person was not removed from this team',
  'the service role refuses A''s superseded marker as well'
);
select lives_ok(
  $$ select team_restore_member('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006') $$,
  'and restores into B'
);
reset role;
select is(
  (select string_agg(org_id::text, ',') from org_members where user_id = '00000000-0000-0000-0000-000000000006'),
  '00000000-0000-0000-0000-0000000000b0',
  'the person is back in B only'
);
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000006'),
  0,
  'and the older marker for A went with the restore'
);
delete from org_members where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000006';

-- ============ the marker goes with the account or the org ============

delete from auth.users where id = '00000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from team_removed_members where user_id = '00000000-0000-0000-0000-000000000003'),
  0,
  'deleting an account removes its marker'
);
delete from orgs where id = '00000000-0000-0000-0000-0000000000a0';
select is(
  (select count(*)::int from team_removed_members where org_id in ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0')),
  0,
  'deleting an org removes its markers'
);

select * from finish();
rollback;
