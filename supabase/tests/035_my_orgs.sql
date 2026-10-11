-- T-TEN.B3: my_orgs() returns the caller's own memberships, and only those.
-- Proves: a member of one org gets exactly that org with their role; a member of two orgs gets both,
-- ordered by name, each with the role they hold there; an account in no org gets zero rows (not an
-- error); another org's members and other people's memberships never appear; it answers for the
-- signed-in user only (no parameter, nothing for anon or an API session with no user id); a removed
-- member stops seeing the org immediately; the function is SECURITY DEFINER with a pinned search_path
-- and executable by authenticated only; the org_members(user_id) index exists.
-- Ordering is pinned with extra fixtures: NAME order differs from ID order and from insertion order;
-- Aardvark's slug sorts LAST while its name sorts FIRST, so `order by slug` alone fails; and two orgs
-- share a name with slug order opposite to id order, so `order by name` alone fails too.
-- Fixtures: org Alpha, org Bravo, org Charlie; user_a (Alpha owner), user_b (Bravo organiser),
-- user_ab (Alpha owner + Bravo organiser), user_x (no org), user_c (Charlie organiser), plus a second
-- Alpha member so an org with several members is listed once.
begin;
select plan(22);

-- ============ fixtures (as postgres, bypasses RLS) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'user-b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'user-ab@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'user-x@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'user-c@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'user-ord@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Alpha Coffee', 'alpha-coffee'),
  ('00000000-0000-0000-0000-0000000000b0', 'Bravo Roasters', 'bravo-roasters'),
  ('00000000-0000-0000-0000-0000000000c0', 'Charlie Beans', 'charlie-beans'),
  ('00000000-0000-0000-0000-0000000000d0', 'Aardvark Coffee', 'zz-aardvark-coffee'),
  ('00000000-0000-0000-0000-0000000000e0', 'Zulu Co', 'zulu-b'),
  ('00000000-0000-0000-0000-0000000000f0', 'Zulu Co', 'zulu-a');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002', 'organiser'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000003', 'organiser'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-000000000005', 'organiser'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000006', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000006', 'organiser'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000006', 'organiser'),
  ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-000000000006', 'organiser'),
  ('00000000-0000-0000-0000-0000000000f0', '00000000-0000-0000-0000-000000000006', 'organiser');

-- ============ a member of one org ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select results_eq(
  $$ select org_id, name, slug, role from my_orgs() $$,
  $$ values ('00000000-0000-0000-0000-0000000000a0'::uuid, 'Alpha Coffee', 'alpha-coffee', 'owner') $$,
  'user_a sees exactly their one org, with the role they hold there'
);
select is(
  (select count(*)::int from my_orgs()
    where org_id in ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000c0')),
  0,
  'and nothing of any org they are not in'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select results_eq(
  $$ select org_id, name, slug, role from my_orgs() $$,
  $$ values ('00000000-0000-0000-0000-0000000000b0'::uuid, 'Bravo Roasters', 'bravo-roasters', 'organiser') $$,
  'user_b sees their org with the organiser role'
);

-- ============ a member of two orgs ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select results_eq(
  $$ select org_id, name, slug, role from my_orgs() $$,
  $$ values
       ('00000000-0000-0000-0000-0000000000a0'::uuid, 'Alpha Coffee', 'alpha-coffee', 'owner'),
       ('00000000-0000-0000-0000-0000000000b0'::uuid, 'Bravo Roasters', 'bravo-roasters', 'organiser') $$,
  'a member of two orgs gets both, ordered by name, each with the role held there (owner in one, organiser in the other)'
);
select is(
  (select count(*)::int from my_orgs()), 2,
  'and only those two (the third org, which they are not in, is absent)'
);
select is(
  (select count(*)::int from my_orgs() where org_id = '00000000-0000-0000-0000-0000000000a0'),
  1,
  'an org with several members is listed once for the caller, not once per member'
);

-- ============ ordering: by name, then slug (not by id, not by insertion order) ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select results_eq(
  $$ select slug, role from my_orgs() $$,
  $$ values ('zz-aardvark-coffee', 'organiser'), ('alpha-coffee', 'organiser'),
            ('bravo-roasters', 'organiser'), ('zulu-a', 'organiser'), ('zulu-b', 'organiser') $$,
  'ordered by name, then slug (Aardvark first although its slug sorts last; the two same-named orgs by slug, opposite to their ids), and each role is the CALLER''s own (user_ord is an organiser in Alpha, where the other members are owners)'
);

-- ============ the production way of identifying the caller: request.jwt.claims (JSON) ============
-- PostgREST and GoTrue sessions set the JSON claims, not the legacy request.jwt.claim.sub the rest of
-- this file uses, and auth.uid() falls back to it. Prove the function works on that path too.

set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq(
  $$ select org_id, role from my_orgs() $$,
  $$ values ('00000000-0000-0000-0000-0000000000a0'::uuid, 'owner') $$,
  'identified by the JSON claims alone, user_a sees their org and role'
);
set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*)::int from my_orgs()), 0,
  'JSON claims with no sub (a token with no user) get zero rows');
set local request.jwt.claims = '';

-- ============ no organisation ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select is((select count(*)::int from my_orgs()), 0, 'an account in no org gets zero rows');
select lives_ok($$ select * from my_orgs() $$, '…and no error (a Guess the Bean account signs in with no organisation)');

-- ============ a session with no user id ============

set local request.jwt.claim.sub = '';
select is((select auth.uid()), null::uuid, 'this section has no user id (auth.uid() is NULL)');
select is((select count(*)::int from my_orgs()), 0,
  'an authenticated session with no user id gets zero rows, not everyone''s');

-- ============ anon ============

reset role;
set local role anon;
select throws_ok(
  $$ select * from my_orgs() $$,
  '42501', 'permission denied for function my_orgs',
  'anon cannot call it'
);
reset role;

-- ============ a removed member stops seeing the org at once; a role change shows at once ============

delete from org_members
  where org_id = '00000000-0000-0000-0000-0000000000b0' and user_id = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select results_eq(
  $$ select org_id from my_orgs() $$,
  $$ values ('00000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'after being removed from Bravo, user_ab sees only Alpha'
);
reset role;
update org_members set role = 'organiser'
  where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
select is(
  (select role from my_orgs() where org_id = '00000000-0000-0000-0000-0000000000a0'),
  'organiser',
  'a role change is visible straight away (the function reads the live row)'
);
reset role;

-- ============ the function and the index ============

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'my_orgs'
      and pg_get_function_identity_arguments(p.oid) = ''),
  1,
  'my_orgs() takes no arguments, so there is nothing to ask about another user'
);
select is(
  (select string_agg(x.argname, ',' order by x.ord)
     from pg_proc p,
          unnest(p.proargnames) with ordinality as x(argname, ord)
    where p.pronamespace = 'public'::regnamespace and p.proname = 'my_orgs'),
  'org_id,name,slug,role',
  'and it returns exactly org_id, name, slug and role (no member lists, no user ids)'
);
select ok(
  (select p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'my_orgs'),
  'it is SECURITY DEFINER with search_path pinned'
);
select ok(
  has_function_privilege('authenticated', 'my_orgs()', 'execute')
  and not has_function_privilege('anon', 'my_orgs()', 'execute'),
  'executable by authenticated and not by anon'
);
select ok(
  not has_function_privilege('service_role', 'my_orgs()', 'execute'),
  'and not by the service role (it has no caller identity to answer for)'
);
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'org_members'
      and indexname = 'org_members_user_id_idx'
      and indexdef like '% USING btree (user_id)'
      and indexdef not like '% WHERE %'
      and indexdef not like 'CREATE UNIQUE%'),
  1,
  'the org_members(user_id) index exists and is a plain, non-unique, non-partial btree on user_id'
);

select * from finish();
rollback;
