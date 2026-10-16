-- T-ADM.C2 (part 1): public.admin_record_account_create, the audit writer the admin-accounts Edge Function calls
-- (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A3, D-A12, section 4).
-- Proves: it is executable by the SERVICE ROLE ONLY (not anon, not a signed-in caller, not an admin at aal2 with a fresh
-- TOTP: the Edge Function reaches it with the service key, never the browser); it needs no signed-in user (the service
-- role has none: auth.uid() is NULL); it writes exactly one `account.create` row naming the actor and the new account,
-- with an empty detail (no password, no email); it refuses, writing nothing, an actor who is not an ACTIVE platform admin
-- (a plain user, an org owner, a banned admin, a soft-deleted admin, an unknown or null actor), an actor who is the
-- target, a target that does not exist or is deleted, a target that is not NEW (created over five minutes ago, or that
-- has signed in), and a target already recorded; the checks run in that order; the actor check is the SAME predicate as
-- app.is_platform_admin() (the two cannot drift); the audit reader shows the row with emails resolved at read time.
-- Everything below looks only at the fixtures (ids with the 0e prefix), so a row committed by another session cannot
-- change a count.
begin;
select plan(36);

create schema t051;
grant usage on schema t051 to anon, authenticated, service_role;

create function t051.claims(uid uuid, aal text, totp_age int default null, who text default 'authenticated') returns void
language plpgsql as $$
declare c jsonb := jsonb_build_object('role', who);
begin
  if uid is not null then c := c || jsonb_build_object('sub', uid, 'session_id', uid); end if;
  if aal is not null then c := c || jsonb_build_object('aal', aal); end if;
  if totp_age is not null then
    c := c || jsonb_build_object('amr', jsonb_build_array(
      jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - totp_age)));
  end if;
  perform set_config('request.jwt.claims', c::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

-- "SQLSTATE|hint" of a statement, or 'ok'; runs as the caller's current role.
create function t051.outcome(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '');
end $$;

-- calls the writer for (actor, target)
create function t051.rec(actor uuid, target uuid) returns text language sql as
  $$ select t051.outcome(format('select public.admin_record_account_create(%L, %L)', actor, target)) $$;

-- For one account X, as the signed-in user X: the writer's actor check agrees with app.is_platform_admin(). Calling the
-- writer with actor = target = X gets past the actor check only if X is an active admin, and then stops at the
-- self-target rule; anyone else is stopped at the actor check.
create function t051.tie(x uuid) returns boolean language plpgsql as $$
declare is_admin boolean; r text;
begin
  perform t051.claims(x, 'aal2', 10);
  is_admin := app.is_platform_admin();
  r := t051.rec(x, x);
  return r = case when is_admin then '42501|admin_self_target' else '42501|admin_required' end;
end $$;
grant execute on function t051.claims(uuid, text, int, text), t051.outcome(text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-0000000e0001', 't051-admin@test.seduh-next', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000e0002', 't051-admin-two@test.seduh-next', now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000e0003', 't051-owner@test.seduh-next', now() - interval '3 days'),
  -- new logins, never signed in: the targets
  ('00000000-0000-0000-0000-0000000e0006', 't051-new-login@test.seduh-next', now()),
  ('00000000-0000-0000-0000-0000000e0007', 't051-new-login-two@test.seduh-next', now()),
  ('00000000-0000-0000-0000-0000000e0008', 't051-new-login-three@test.seduh-next', now()),
  ('00000000-0000-0000-0000-0000000e0009', 't051-new-login-four@test.seduh-next', now() - interval '4 minutes'),
  ('00000000-0000-0000-0000-0000000e000f', 't051-new-login-five@test.seduh-next', now()),
  -- not new: made six minutes ago; made long ago
  ('00000000-0000-0000-0000-0000000e000a', 't051-six-minutes@test.seduh-next', now() - interval '6 minutes'),
  ('00000000-0000-0000-0000-0000000e000b', 't051-old@test.seduh-next', '2020-01-01 00:00:00+00');
insert into auth.users (id, email, created_at, last_sign_in_at) values
  ('00000000-0000-0000-0000-0000000e000c', 't051-signed-in@test.seduh-next', now(), now());
insert into auth.users (id, email, created_at, deleted_at) values
  ('00000000-0000-0000-0000-0000000e000d', 't051-deleted-target@test.seduh-next', now(), now()),
  ('00000000-0000-0000-0000-0000000e0005', 't051-deleted-admin@test.seduh-next', now() - interval '3 days', now());
insert into auth.users (id, email, created_at, banned_until) values
  ('00000000-0000-0000-0000-0000000e0004', 't051-banned-admin@test.seduh-next', now() - interval '3 days', now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000e000e', 't051-expired-ban-admin@test.seduh-next', now() - interval '3 days', now() - interval '1 day');
insert into app.platform_admins (user_id, note) values
  ('00000000-0000-0000-0000-0000000e0001', 't051 admin'),
  ('00000000-0000-0000-0000-0000000e0002', 't051 admin two'),
  ('00000000-0000-0000-0000-0000000e0004', 't051 banned'),
  ('00000000-0000-0000-0000-0000000e0005', 't051 deleted'),
  ('00000000-0000-0000-0000-0000000e000e', 't051 expired ban');
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-0000000e00a0', 'T051 Org', 't051-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000e00a0', '00000000-0000-0000-0000-0000000e0003', 'owner');

-- a live session for every fixture login (app.require_platform_admin() requires the token's session_id to name a real,
-- unrevoked session of the caller): the session id is the user id, which the claims helper puts in the token
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id::text like '00000000-0000-0000-0000-0000000e%';

create table t051.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;
-- the rows these tests are about: those recorded for a fixture account
create function t051.rows_n() returns int language sql as
  $$ select count(*)::int from app.admin_audit_log
      where id > (select mid from t051.base) and action = 'account.create'
        and target_user_id::text like '00000000-0000-0000-0000-0000000e%' $$;

-- ============ who may execute it ============

select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, 'public.admin_record_account_create(uuid, uuid)'::regprocedure, 'execute')),
  'none', 'neither anon nor a signed-in caller can execute it');
select ok(has_function_privilege('service_role', 'public.admin_record_account_create(uuid, uuid)'::regprocedure, 'execute'),
  'the service role can');
select ok(
  (select p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'public.admin_record_account_create(uuid, uuid)'::regprocedure),
  'it is SECURITY DEFINER, VOLATILE, with search_path pinned to the empty string');

-- ============ as the API roles ============

set local role anon;
select t051.claims(null, null);
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0006'), '42501|', 'anon cannot call it');
reset role;
set local role authenticated;
select t051.claims('00000000-0000-0000-0000-0000000e0001', 'aal2', 10);
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0006'), '42501|',
  'a verified platform admin at aal2 with a live session cannot call it either (only the Edge Function, with the service key, can)');
select is(t051.rec('00000000-0000-0000-0000-0000000e0003', '00000000-0000-0000-0000-0000000e0006'), '42501|', 'nor an organisation owner');
reset role;
select is(t051.rows_n(), 0, 'none of those wrote a row');

-- ============ as the service role: a service token, no signed-in user ============

set local role service_role;
select t051.claims(null, null, null, 'service_role');
select is((select auth.uid()), null::uuid, 'the service role has no signed-in user (auth.uid() is NULL), so the actor has to be a parameter');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0006'), 'ok',
  'it records an account creation for an active platform admin, with no signed-in user');
select t051.claims('00000000-0000-0000-0000-0000000e0003', 'aal1');
select is(t051.rec('00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000e0007'), 'ok',
  'and the actor is the parameter, not whoever the (irrelevant) claims name: a second admin can be the actor');
select t051.claims(null, null, null, 'service_role');
select is(t051.rec('00000000-0000-0000-0000-0000000e000e', '00000000-0000-0000-0000-0000000e0008'), 'ok',
  'an admin whose ban has EXPIRED is an active admin');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0009'), 'ok',
  'a login made four minutes ago is still new');
reset role;

select is(
  (select (action, actor_id, target_user_id, target_org_id, detail)::text
     from app.admin_audit_log where id > (select mid from t051.base) and target_user_id = '00000000-0000-0000-0000-0000000e0006'),
  '(account.create,00000000-0000-0000-0000-0000000e0001,00000000-0000-0000-0000-0000000e0006,,{})',
  'that row is account.create with the actor, the new account, no org, and an empty detail (no password, no email)');
select is(
  (select actor_id from app.admin_audit_log where id > (select mid from t051.base) and target_user_id = '00000000-0000-0000-0000-0000000e0007'),
  '00000000-0000-0000-0000-0000000e0002'::uuid, 'the second row names the second admin as its actor');
select is(t051.rows_n(), 4, 'exactly four rows for the fixture accounts');

-- ============ refusals write nothing, and are checked in this order ============

set local role service_role;
select t051.claims(null, null, null, 'service_role');
select is(t051.rec('00000000-0000-0000-0000-0000000e0003', '00000000-0000-0000-0000-0000000e000c'), '42501|admin_required',
  '1. an actor who is not a platform admin (an org owner) is refused');
select is(t051.rec('00000000-0000-0000-0000-0000000e0004', '00000000-0000-0000-0000-0000000e000c'), '42501|admin_required', 'a BANNED admin is refused');
select is(t051.rec('00000000-0000-0000-0000-0000000e0005', '00000000-0000-0000-0000-0000000e000c'), '42501|admin_required', 'a soft-deleted admin is refused');
select is(t051.rec('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000e000c'), '42501|admin_required', 'an actor that does not exist is refused');
select is(t051.rec(null, '00000000-0000-0000-0000-0000000e000c'), '42501|admin_required', 'a null actor is refused');
select is(t051.rec('00000000-0000-0000-0000-0000000e0003', '00000000-0000-0000-0000-00000000dead'), '42501|admin_required',
  'the actor check comes before the target check: a non-admin naming a missing account learns only admin_required');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0001'), '42501|admin_self_target',
  '2. the actor cannot be the new account');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-00000000dead'), '22023|member_user_not_found',
  '3. a target that does not exist is refused');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', null), '22023|member_user_not_found', 'and so is a null one');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e000d'), '22023|member_user_not_found', 'and a soft-deleted one');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e000b'), '22023|account_not_new',
  '4. an account made years ago is not new (a stolen service key cannot dress up an old account as console-made)');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e000a'), '22023|account_not_new', 'nor one made six minutes ago');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e000c'), '22023|account_not_new', 'nor one that has already signed in');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0006'), '23505|already_recorded',
  '5. the same account cannot be recorded twice');
reset role;
select is(t051.rows_n(), 4, 'after every refusal there are still exactly four rows');

-- the actor check IS app.is_platform_admin(): for each of these accounts, as that signed-in user, they agree
select is(
  (select coalesce(string_agg(x::text, ', ' order by x), 'none')
     from unnest(array[
       '00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0002', '00000000-0000-0000-0000-0000000e0003',
       '00000000-0000-0000-0000-0000000e0004', '00000000-0000-0000-0000-0000000e0005', '00000000-0000-0000-0000-0000000e000e',
       '00000000-0000-0000-0000-0000000e0006']::uuid[]) x
    where not t051.tie(x)),
  'none', 'for an active admin, a non-admin, a banned, a deleted and an expired-ban admin, the writer''s actor check agrees with app.is_platform_admin()');

-- the "already recorded" rule is about THIS action: an earlier row of another kind for the same login does not block it
insert into app.admin_audit_log (actor_id, action, target_user_id)
  values ('00000000-0000-0000-0000-0000000e0001', 'member.add', '00000000-0000-0000-0000-0000000e000f');
set local role service_role;
select t051.claims(null, null, null, 'service_role');
select is(t051.rec('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e000f'), 'ok',
  'a login that already has a row of ANOTHER action can still be recorded (the duplicate rule is specific to account.create)');
reset role;
select is(t051.rows_n(), 5, 'and that makes five account.create rows for the fixtures');

-- "already recorded" is also enforced by a partial unique index, so two concurrent calls cannot both insert
select throws_ok(
  $$ insert into app.admin_audit_log (actor_id, action, target_user_id)
       values ('00000000-0000-0000-0000-0000000e0001', 'account.create', '00000000-0000-0000-0000-0000000e0006') $$,
  '23505', null, 'the database itself refuses a second account.create row for the same login (a race cannot slip past the check)');
select lives_ok(
  $$ insert into app.admin_audit_log (actor_id, action, target_user_id)
       values ('00000000-0000-0000-0000-0000000e0001', 'member.add', '00000000-0000-0000-0000-0000000e0006') $$,
  'but the index is specific to account.create: other actions for the same login are fine');

-- ============ the console reads it back ============

select t051.claims('00000000-0000-0000-0000-0000000e0001', 'aal2', 10);
set local role authenticated;
select results_eq(
  $$ select action, actor_email, target_user_email, target_org_slug
       from public.admin_list_audit(50) where target_user_email = 't051-new-login-two@test.seduh-next' $$,
  $$ values ('account.create', 't051-admin-two@test.seduh-next', 't051-new-login-two@test.seduh-next', null::text) $$,
  'admin_list_audit shows it, with the emails resolved at read time (the log itself stores no email)');
reset role;

select * from finish();
rollback;
