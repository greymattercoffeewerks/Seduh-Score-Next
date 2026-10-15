-- T-ADM.B1: platform-admin identity (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A1, D-A5, D-A10,
-- D-A14).
-- Proves: app.platform_admins is outside `public`, has RLS on and no policy, and no API role holds any
-- privilege on it (anon, a signed-in non-admin and an admin alike read, insert, update and delete
-- nothing); the app.* functions are not executable by any API role and the public.* ones only by
-- authenticated; every function is SECURITY DEFINER with a pinned search_path; am_i_platform_admin()
-- answers only { is_admin, aal } for the caller; require_platform_admin() (reached through
-- admin_can_provision()) refuses a non-admin with admin_required whatever the session proves, refuses an
-- admin without a second factor with admin_mfa_required, and FAILS CLOSED on every NULL / malformed
-- shape (no JWT, no `aal`, no `amr`, `amr` not an array, a non-numeric or missing timestamp, a totp entry
-- older than 60 minutes, one in the future, a string or float timestamp, a password entry instead of a totp
-- one) instead of passing or raising a cast error; a banned or soft-deleted admin is refused at once; the
-- Team screen's two gates (team_can_manage / team_can_restore) never let an organisation owner reset a
-- platform admin; and a platform admin's login cannot be deleted out from under the table.
-- Definition-of-done note: non-member access is proved by the table-privilege refusal (SQLSTATE 42501) and
-- an empty ACL, which is stronger than the 'zero rows' form used for tenant tables (this is not one).
--
-- Fixtures: admin (a platform admin), organiser (an org member, not an admin), plain (an account in no
-- org). Claims are set the production way, as JSON in request.jwt.claims (auth.jwt() reads that, not
-- the legacy per-claim settings); the sub is also set so auth.uid() agrees on either path.
begin;
select plan(66);

create schema t046;
grant usage on schema t046 to anon, authenticated, service_role;

-- Sets the caller's JWT claims for the rest of the transaction (or until set again).
-- totp_age: seconds since the TOTP verification (null = no amr claim at all).
create function t046.claims(uid uuid, aal text, totp_age int default null) returns void
language plpgsql as $$
declare c jsonb := jsonb_build_object('role', 'authenticated');
begin
  if uid is not null then c := c || jsonb_build_object('sub', uid); end if;
  if aal is not null then c := c || jsonb_build_object('aal', aal); end if;
  if totp_age is not null then
    c := c || jsonb_build_object('amr', jsonb_build_array(
      jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - totp_age - 5),
      jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - totp_age)));
  end if;
  perform set_config('request.jwt.claims', c::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

-- Sets claims with a caller-built amr array (for the shapes claims() cannot express).
create function t046.claims_amr(uid uuid, aal text, amr jsonb) returns void
language plpgsql as $$
declare c jsonb := jsonb_build_object('role', 'authenticated');
begin
  if uid is not null then c := c || jsonb_build_object('sub', uid); end if;
  if aal is not null then c := c || jsonb_build_object('aal', aal); end if;
  if amr is not null then c := c || jsonb_build_object('amr', amr); end if;
  perform set_config('request.jwt.claims', c::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

-- Sets claims from raw JSON, for the malformed shapes.
create function t046.raw_claims(j text, sub text default '') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', j, true);
  perform set_config('request.jwt.claim.sub', sub, true);
end $$;

-- "SQLSTATE|hint" of a statement, or 'ok'; always runs as the caller's current role.
create function t046.outcome(stmt text) returns text
language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '');
end $$;
-- SQLSTATE only: this Postgres adds its own hint to table-privilege refusals, which is not ours to pin.
create function t046.state(stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
grant execute on function t046.claims(uuid, text, int), t046.raw_claims(text, text), t046.outcome(text), t046.state(text), t046.claims_amr(uuid, text, jsonb)
  to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0001', 'admin@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000a0002', 'organiser@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000a0003', 'plain@test.seduh-next');
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-0000000a00f0', 'T046 Org', 't046-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0002', 'owner');
insert into app.platform_admins (user_id, note) values ('00000000-0000-0000-0000-0000000a0001', 'test admin');
-- a banned admin, a soft-deleted admin, an admin and a plain account who were removed from the org's team
insert into auth.users (id, email, banned_until) values
  ('00000000-0000-0000-0000-0000000a0004', 'banned-admin@test.seduh-next', now() + interval '1 day');
insert into auth.users (id, email, deleted_at) values
  ('00000000-0000-0000-0000-0000000a0005', 'deleted-admin@test.seduh-next', now());
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a0006', 'removed-admin@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000a0007', 'removed-plain@test.seduh-next');
insert into app.platform_admins (user_id, note) values
  ('00000000-0000-0000-0000-0000000a0004', 'banned'),
  ('00000000-0000-0000-0000-0000000a0005', 'deleted'),
  ('00000000-0000-0000-0000-0000000a0006', 'removed from a team');
-- the admin and the plain account are both non-owner members of the org whose owner is organiser@
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0001', 'organiser'),
  ('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0003', 'organiser');
insert into team_removed_members (org_id, user_id) values
  ('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0006'),
  ('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0007');

-- ============ where the table lives and how it is locked ============

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'platform_admins' and n.nspname = 'public'),
  0, 'platform_admins is not in the public schema (so the tenant-table guards do not apply to it, and the API does not expose it)');
select ok(
  (select c.relrowsecurity from pg_class c where c.oid = 'app.platform_admins'::regclass),
  'row-level security is on');
select is(
  (select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'platform_admins'),
  0, 'and it has no policy at all (so no API role can ever read a row)');
select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_table_privilege(r, 'app.platform_admins', 'select,insert,update,delete,truncate,references,trigger')
       or exists (select 1 from information_schema.column_privileges cp
                   where cp.table_schema = 'app' and cp.table_name = 'platform_admins' and cp.grantee = r)),
  'none', 'no API role holds any table or column privilege on it');

-- ============ who may execute what ============

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid in ('app.is_platform_admin()'::regprocedure, 'app.require_platform_admin()'::regprocedure)
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'no API role can execute the app.* helpers directly');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'service_role']) r
    where p.oid in ('public.am_i_platform_admin()'::regprocedure, 'public.admin_can_provision()'::regprocedure)
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and service_role cannot execute the public admin doors');
select ok(
  has_function_privilege('authenticated', 'public.am_i_platform_admin()', 'execute')
  and has_function_privilege('authenticated', 'public.admin_can_provision()', 'execute'),
  'a signed-in caller can execute both public admin doors');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), 'none')
     from pg_proc p
    where p.oid in ('app.is_platform_admin()'::regprocedure, 'app.require_platform_admin()'::regprocedure,
                    'public.am_i_platform_admin()'::regprocedure, 'public.admin_can_provision()'::regprocedure)
      and not (p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
  'none', 'every one is SECURITY DEFINER with a pinned search_path');

select is(
  (select count(*)::int from aclexplode((select relacl from pg_class where oid = 'app.platform_admins'::regclass)) a
    where a.grantee <> (select relowner from pg_class where oid = 'app.platform_admins'::regclass)),
  0, 'the table ACL names no grantee but its owner (covers every privilege there is, including ones newer Postgres versions add)');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'app'::regnamespace
      and (p.proname ~ 'admin' or p.proname = 'require_platform_admin')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'catch-all: no function in schema app that has "admin" in its name is executable by any API role (a later batch that forgets a revoke fails here)');
select is(
  (select coalesce(string_agg(c.relname || '/' || r, ', ' order by c.relname, r), 'none')
     from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and (c.relname ~ 'admin')
      and has_table_privilege(r, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'catch-all: no table in schema app with "admin" in its name is reachable by any API role');

-- ============ anon ============

reset role;
set local role anon;
select t046.claims(null, null);
select is(t046.state('select * from app.platform_admins'), '42501', 'anon cannot read the table');
select is(t046.state($$insert into app.platform_admins (user_id) values (gen_random_uuid())$$), '42501', 'anon cannot insert');
select is(t046.outcome('select public.am_i_platform_admin()'), '42501|', 'anon cannot call am_i_platform_admin()');
select is(t046.outcome('select public.admin_can_provision()'), '42501|', 'anon cannot call admin_can_provision()');

-- ============ a signed-in non-admin (an organiser, even at aal2 with a fresh TOTP) ============

reset role;
set local role authenticated;
select t046.claims('00000000-0000-0000-0000-0000000a0002', 'aal2', 10);
select is(t046.state('select * from app.platform_admins'), '42501', 'a non-admin cannot read the table');
select is(t046.state($$insert into app.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000a0002')$$), '42501',
  'a non-admin cannot promote themselves');
select is(t046.state($$update app.platform_admins set note = 'x'$$), '42501', 'a non-admin cannot update');
select is(t046.state('delete from app.platform_admins'), '42501', 'a non-admin cannot delete');
select is(t046.outcome('select app.require_platform_admin()'), '42501|', 'a non-admin cannot call the app.* helper directly');
select is(
  (select public.am_i_platform_admin()),
  '{"is_admin": false, "aal": "aal2"}'::jsonb,
  'am_i_platform_admin() says false, and echoes only the caller''s own aal');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required',
  'a non-admin at aal2 with a fresh TOTP is still refused: admin_required (the second factor never promotes anyone)');

-- an account in no org at all, and a session with no user
select t046.claims('00000000-0000-0000-0000-0000000a0003', 'aal2', 10);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required', 'a signed-in account in no org is refused too');
select t046.claims(null, 'aal2', 10);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required', 'a token with no user is refused: admin_required');
select is((select public.am_i_platform_admin()), '{"is_admin": false, "aal": "aal2"}'::jsonb, 'and am_i_platform_admin() is false for it');
select t046.raw_claims('');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required', 'no claims at all: admin_required, not a pass and not an error');
select is((select public.am_i_platform_admin()), '{"is_admin": false, "aal": null}'::jsonb, 'and am_i_platform_admin() is false with a null aal');

-- ============ the admin ============

select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal1');
select is((select public.am_i_platform_admin()), '{"is_admin": true, "aal": "aal1"}'::jsonb,
  'a password-only admin session can learn it is an admin, and that it is aal1');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'an admin at aal1 is refused: admin_mfa_required');
select is(t046.state('select * from app.platform_admins'), '42501', 'and even an admin cannot read the table through the API');

select t046.claims('00000000-0000-0000-0000-0000000a0001', null);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'an admin whose token has no aal claim is refused (a NULL must not pass)');

select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required',
  'an admin at aal2 whose token has no amr claim is refused (D-A14: no proof of a recent TOTP)');

select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2', 60);
select is(t046.outcome('select public.admin_can_provision()'), 'ok', 'an admin at aal2 with a TOTP verified a minute ago passes');
select is((select public.admin_can_provision()), true, 'and admin_can_provision() returns true');
select is((select public.am_i_platform_admin()), '{"is_admin": true, "aal": "aal2"}'::jsonb, 'am_i_platform_admin() reports aal2');

select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2', 3500);
select is(t046.outcome('select public.admin_can_provision()'), 'ok', 'a TOTP verified 3500 s ago is still inside the 60-minute window');
select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2', 3700);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a TOTP verified 3700 s ago is outside it: admin_mfa_required');

-- malformed amr shapes must refuse with the hint, never pass and never raise a cast error
select t046.raw_claims('{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000a0001","aal":"aal2","amr":[{"method":"password","timestamp":1}]}',
  '00000000-0000-0000-0000-0000000a0001');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'amr with no totp entry is refused');
select t046.raw_claims('{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000a0001","aal":"aal2","amr":"totp"}',
  '00000000-0000-0000-0000-0000000a0001');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'amr that is not an array is refused');
select t046.raw_claims('{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000a0001","aal":"aal2","amr":[{"method":"totp"}]}',
  '00000000-0000-0000-0000-0000000a0001');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a totp entry with no timestamp is refused');
select t046.raw_claims('{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000a0001","aal":"aal2","amr":[{"method":"totp","timestamp":"soon"},"totp",7,null]}',
  '00000000-0000-0000-0000-0000000a0001');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required',
  'a non-numeric timestamp and non-object entries are refused with the hint, not a cast error');

-- ============ the mutation-killers: shapes that must refuse, each isolating ONE rule ============
-- (a mutant that drops one rule must fail one of these, not be masked by another rule refusing too)

-- a fresh PASSWORD entry at aal2 is not a TOTP verification
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 5)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required',
  'aal2 with only a FRESH password amr entry is refused (the method must be totp)');
-- no aal claim at all, but a perfectly fresh totp entry
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', null,
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 5)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required',
  'a fresh totp entry but NO aal claim is refused (a NULL aal must not pass)');
-- a fresh-looking non-object entry next to a stale totp entry
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array('totp', jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 7200)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required',
  'a non-object amr entry does not rescue a stale totp one');
-- timestamps in the future, a string, a float
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint + 86400)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a totp timestamp a day in the FUTURE is refused');
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint + 60)));
select is(t046.outcome('select public.admin_can_provision()'), 'ok', 'a totp timestamp a minute ahead (clock skew) is tolerated');
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', (extract(epoch from now())::bigint - 5)::text)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a fresh timestamp written as a STRING is refused');
select t046.raw_claims(format('{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000a0001","aal":"aal2","amr":[{"method":"totp","timestamp":%s.5}]}',
  extract(epoch from now())::bigint - 5), '00000000-0000-0000-0000-0000000a0001');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a fresh timestamp written as a FLOAT is refused (GoTrue writes integers)');
-- widths: 12 digits (year 33658) and 13 digits (milliseconds) are both nonsense
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', 999999999999)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a 12-digit timestamp is refused');
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint * 1000)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a millisecond (13-digit) timestamp is refused');
select t046.claims_amr('00000000-0000-0000-0000-0000000a0001', 'aal2',
  jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', 99999999999999999999::numeric)));
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required',
  'a 20-digit timestamp is refused with the hint (it would overflow bigint and raise 22003 without the width guard)');
-- the window edges (the claims() helper floors now() to whole seconds, so these are within a second of 3600)
select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2', 3590);
select is(t046.outcome('select public.admin_can_provision()'), 'ok', 'a TOTP verified 3590 s ago passes');
select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2', 3610);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_mfa_required', 'a TOTP verified 3610 s ago is refused: the window is 60 minutes, not more');

-- the order of the two checks: a non-admin at aal1 is refused for being a non-admin
select t046.claims('00000000-0000-0000-0000-0000000a0002', 'aal1');
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required', 'a non-admin at aal1 gets admin_required (the admin check comes first)');

-- a banned admin and a soft-deleted admin are no longer admins, whatever their token proves
select t046.claims('00000000-0000-0000-0000-0000000a0004', 'aal2', 10);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required', 'a BANNED admin is refused at once: admin_required');
select is((select public.am_i_platform_admin()), '{"is_admin": false, "aal": "aal2"}'::jsonb, 'and am_i_platform_admin() is false for them');
select t046.claims('00000000-0000-0000-0000-0000000a0005', 'aal2', 10);
select is(t046.outcome('select public.admin_can_provision()'), '42501|admin_required', 'a soft-deleted admin is refused too');

-- ============ the Team screen never manages a platform admin (owner = organiser@, org T046) ============

select t046.claims('00000000-0000-0000-0000-0000000a0002', 'aal2', 10);
select is(
  (select public.team_can_manage('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0003')),
  true, 'control: the org owner may manage a plain non-owner member');
select is(
  (select public.team_can_manage('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0001')),
  false, 'but not a platform admin who is a non-owner member (their password is not an org owner''s to reset)');
select is(
  (select public.team_can_restore('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0007')),
  true, 'control: the owner may restore a plain removed member');
select is(
  (select public.team_can_restore('00000000-0000-0000-0000-0000000a00f0', '00000000-0000-0000-0000-0000000a0006')),
  false, 'but not a platform admin who was removed from the team');

-- ============ the app.* helper directly (as the owner, with the same claims) ============

reset role;
select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal2', 60);
select is(t046.outcome('select app.require_platform_admin()'), 'ok', 'require_platform_admin() passes an admin at aal2 with a fresh TOTP');
select t046.claims('00000000-0000-0000-0000-0000000a0001', 'aal1', 60);
select is(t046.outcome('select app.require_platform_admin()'), '42501|admin_mfa_required', 'and refuses aal1 even with a fresh amr entry');
select t046.claims('00000000-0000-0000-0000-0000000a0002', 'aal2', 60);
select is(t046.outcome('select app.require_platform_admin()'), '42501|admin_required', 'and refuses a non-admin');

-- ============ service role and the foreign key ============

set local role service_role;
select is(t046.state('select * from app.platform_admins'), '42501', 'the service role cannot read the table either (SQL as postgres is the only way in)');
reset role;
select is(t046.state($$delete from auth.users where id = '00000000-0000-0000-0000-0000000a0001'$$), '23503',
  'deleting the login of a platform admin is refused (on delete restrict): remove the admin row first');

select * from finish();
rollback;
