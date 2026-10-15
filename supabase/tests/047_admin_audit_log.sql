-- T-ADM.B2: the admin audit log (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A6, D-A13, section 3.2).
-- Proves: app.admin_audit_log is outside `public`, has RLS on, no policy and no foreign key, and no API role
-- (anon, authenticated, service_role) holds any privilege on it, its sequence or its functions; the writer,
-- app.admin_audit(), records the CALLER as the actor (never a parameter), records the org and user it was
-- given in the right columns, defaults detail to {}, and REFUSES anyone who is not a platform admin at aal2
-- with a fresh TOTP (so a wrapper that forgets its own check cannot write); the log is append-only for
-- EVERYONE, the table owner included, and also under session_replication_role = replica: UPDATE, DELETE and
-- TRUNCATE are all refused with 42501 and leave the rows untouched, and the guarding triggers exist, are
-- ENABLE ALWAYS and are the right kind; the CHECK constraints reject a malformed or over-long action, a
-- non-object, null or oversized detail (4000 accepted, 4001 refused), and a detail whose KEY NAMES hold a
-- password, token, secret, email ... in any case, at any depth; exactly one function writes to the table.
--
-- Not claimed (documented in the migration): the table OWNER can still disable or drop the triggers,
-- replace the trigger function or rewrite rows by DDL; values inside detail are not inspected.
--
-- Claims are set the production way, as JSON in request.jwt.claims; the sub is also set so auth.uid() agrees.
begin;
select plan(74);

create schema t047;
grant usage on schema t047 to anon, authenticated, service_role;

-- A session: uid, aal, and seconds since the TOTP verification (null = no amr claim).
create function t047.session(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
declare c jsonb := jsonb_build_object('role', 'authenticated');
begin
  if uid is not null then c := c || jsonb_build_object('sub', uid); end if;
  if aal is not null then c := c || jsonb_build_object('aal', aal); end if;
  if totp_age is not null then
    c := c || jsonb_build_object('amr', jsonb_build_array(
      jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - totp_age)));
  end if;
  perform set_config('request.jwt.claims', c::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

-- A fully verified admin session.
create function t047.admin(uid uuid) returns void language sql as $$ select t047.session(uid, 'aal2', 10) $$;

-- "SQLSTATE|hint" of a statement, or 'ok'; runs as the caller's current role.
create function t047.outcome(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '');
end $$;

-- SQLSTATE only (this Postgres adds its own hint to table-privilege refusals).
create function t047.state(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
grant execute on function t047.session(uuid, text, int), t047.admin(uuid), t047.outcome(text), t047.state(text)
  to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b0001', 'audit-admin@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000b0002', 'audit-admin-two@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000b0003', 'audit-nobody@test.seduh-next');
insert into app.platform_admins (user_id, note) values
  ('00000000-0000-0000-0000-0000000b0001', 'test admin'),
  ('00000000-0000-0000-0000-0000000b0002', 'test admin two');

-- ============ where the table lives and how it is locked ============

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'admin_audit_log' and n.nspname = 'public'),
  0, 'admin_audit_log is not in the public schema (the API does not expose it; the tenant-table guards do not apply)');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'app.admin_audit_log'::regclass), 'row-level security is on');
select is(
  (select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'admin_audit_log'),
  0, 'and it has no policy at all');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'app.admin_audit_log'::regclass and contype = 'f'),
  0, 'it has no foreign key (the history must survive an org or a login being deleted)');
select is(
  (select count(*)::int from aclexplode((select relacl from pg_class where oid = 'app.admin_audit_log'::regclass)) a
    where a.grantee <> (select relowner from pg_class where oid = 'app.admin_audit_log'::regclass)),
  0, 'the table ACL names no grantee but its owner');
select is(
  (select count(*)::int from aclexplode((select relacl from pg_class where oid = 'app.admin_audit_log_id_seq'::regclass)) a
    where a.grantee <> (select relowner from pg_class where oid = 'app.admin_audit_log_id_seq'::regclass)),
  0, 'and so does its id sequence');
select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_table_privilege(r, 'app.admin_audit_log', 'select,insert,update,delete,truncate,references,trigger')
       or has_sequence_privilege(r, 'app.admin_audit_log_id_seq', 'usage,select,update')
       or exists (select 1 from information_schema.column_privileges cp
                   where cp.table_schema = 'app' and cp.table_name = 'admin_audit_log' and cp.grantee = r)),
  'none', 'no API role holds any table, column or sequence privilege on it');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid in ('app.admin_audit(text, uuid, uuid, jsonb)'::regprocedure, 'app.forbid_admin_audit_mutation()'::regprocedure,
                    'app.admin_audit_detail_ok(jsonb)'::regprocedure)
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'no API role can execute the writer, the trigger function or the detail check');
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'app.admin_audit(text, uuid, uuid, jsonb)'::regprocedure),
  'the writer is SECURITY DEFINER with search_path pinned to the empty string');
select ok(
  (select not p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'app.forbid_admin_audit_mutation()'::regprocedure),
  'the trigger function is NOT security definer (a plain refusal) and has search_path pinned');
select is(
  (select string_agg(indexname, ', ' order by indexname) from pg_indexes where schemaname = 'app' and tablename = 'admin_audit_log'),
  'admin_audit_log_org_id_idx, admin_audit_log_pkey',
  'the table has exactly its primary key and the per-org index');
select ok(
  (select indexdef like '%(target_org_id, id DESC)' from pg_indexes
    where schemaname = 'app' and indexname = 'admin_audit_log_org_id_idx'),
  'the per-org index is (target_org_id, id desc): it serves the planned page query, newest id first');
select is(
  (select string_agg(conname, ', ' order by conname) from pg_constraint
    where conrelid = 'app.admin_audit_log'::regclass and contype = 'c'),
  'admin_audit_log_action_format, admin_audit_log_detail_no_secrets, admin_audit_log_detail_object, admin_audit_log_detail_size',
  'the four CHECK constraints exist under the names the UI error mapping may rely on');
select is(
  (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
    where d.adrelid = 'app.admin_audit_log'::regclass
      and d.adnum = (select attnum from pg_attribute where attrelid = 'app.admin_audit_log'::regclass and attname = 'at')),
  'now()', 'the time column defaults to now() (the database stamps it)');

-- ============ the append-only triggers exist, are ENABLE ALWAYS, and are the right kind ============

select ok(
  exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'app.admin_audit_log'::regclass and not t.tgisinternal
       and t.tgenabled = 'A' and p.proname = 'forbid_admin_audit_mutation'
       and (t.tgtype & 1) > 0 and (t.tgtype & 2) > 0       -- FOR EACH ROW, BEFORE
       and (t.tgtype & 16) > 0 and (t.tgtype & 8) > 0      -- UPDATE and DELETE
       and t.tgqual is null),                              -- no WHEN condition that could skip it
  'an ENABLE ALWAYS, unconditional BEFORE UPDATE OR DELETE row trigger refuses changes');
select ok(
  exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'app.admin_audit_log'::regclass and not t.tgisinternal
       and t.tgenabled = 'A' and p.proname = 'forbid_admin_audit_mutation'
       and (t.tgtype & 1) = 0 and (t.tgtype & 2) > 0       -- FOR EACH STATEMENT, BEFORE
       and (t.tgtype & 32) > 0 and t.tgqual is null),      -- TRUNCATE
  'and an ENABLE ALWAYS BEFORE TRUNCATE statement trigger refuses a truncate (TRUNCATE fires no row trigger)');

-- ============ the writer: who may call it, and what it records ============

-- a non-admin, an admin at aal1, an admin with no TOTP proof, and no user at all: none can write
select t047.admin('00000000-0000-0000-0000-0000000b0003');
select is(t047.outcome($$select app.admin_audit('org.create')$$), '42501|admin_required',
  'a signed-in non-admin cannot write, even with an aal2 session and a fresh TOTP (the writer checks for itself)');
select t047.session('00000000-0000-0000-0000-0000000b0001', 'aal1');
select is(t047.outcome($$select app.admin_audit('org.create')$$), '42501|admin_mfa_required', 'an admin at aal1 cannot write');
select t047.session('00000000-0000-0000-0000-0000000b0001', 'aal2');
select is(t047.outcome($$select app.admin_audit('org.create')$$), '42501|admin_mfa_required', 'an admin with no TOTP proof cannot write');
select t047.session(null, null);
select is(t047.outcome($$select app.admin_audit('org.create')$$), '42501|admin_required', 'a session with no user cannot write');
select is((select count(*)::int from app.admin_audit_log), 0, 'and none of those attempts left a row');

select t047.admin('00000000-0000-0000-0000-0000000b0001');
select lives_ok(
  $$ select app.admin_audit('org.create', '00000000-0000-0000-0000-0000000b00f1', '00000000-0000-0000-0000-0000000b0002',
                            '{"slug":"audit-test","name":"Audit Test"}') $$,
  'an admin at aal2 with a fresh TOTP can write an action');
select lives_ok($$ select app.admin_audit('member.add') $$, 'and with only an action (org, user and detail are optional)');
select t047.admin('00000000-0000-0000-0000-0000000b0002');
select lives_ok($$ select app.admin_audit('member.role_set', null, null, null) $$, 'and a null detail is stored as {}');
select t047.session(null, null);

select is(
  (select actor_id from app.admin_audit_log where action = 'org.create'),
  '00000000-0000-0000-0000-0000000b0001'::uuid, 'the actor is the caller (auth.uid()), not something the caller chose');
select is(
  (select actor_id from app.admin_audit_log where action = 'member.role_set'),
  '00000000-0000-0000-0000-0000000b0002'::uuid, 'and it follows the caller: a second admin''s row names the second admin');
select is(
  (select target_org_id from app.admin_audit_log where action = 'org.create'),
  '00000000-0000-0000-0000-0000000b00f1'::uuid, 'the org id lands in target_org_id (not swapped with the user)');
select is(
  (select target_user_id from app.admin_audit_log where action = 'org.create'),
  '00000000-0000-0000-0000-0000000b0002'::uuid, 'and the user id lands in target_user_id');
select is(
  (select detail from app.admin_audit_log where action = 'member.add'), '{}'::jsonb, 'detail defaults to {}');
select is(
  (select detail from app.admin_audit_log where action = 'member.role_set'), '{}'::jsonb, 'a null detail becomes {}');
select is(
  (select detail from app.admin_audit_log where action = 'org.create'),
  '{"slug":"audit-test","name":"Audit Test"}'::jsonb, 'a real detail is stored as given');
select is((select count(*)::int from app.admin_audit_log), 3, 'three rows so far');
select is((select count(distinct id)::int from app.admin_audit_log), 3, 'each with its own id');

-- exactly one function writes to the table (a later batch adds the service-role account.create writer and
-- must add it here, deliberately)
select is(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and p.prokind in ('f', 'p')
      and p.prorettype <> 'trigger'::regtype      -- the refusal trigger names the table in its message; it writes nothing
      and p.prosrc ~* 'admin_audit_log'),
  'app.admin_audit', 'exactly one function in app or public mentions the table: the writer');

-- ============ append-only, even for the owner (the role this test runs as) ============

select throws_ok($$ update app.admin_audit_log set action = 'org.delete' $$, '42501', 'admin_audit_log is append-only',
  'UPDATE is refused, even for the table owner');
select throws_ok($$ update app.admin_audit_log set detail = '{}' where action = 'org.create' $$, '42501', 'admin_audit_log is append-only',
  'a targeted UPDATE is refused too (rewriting history one row at a time)');
select throws_ok($$ delete from app.admin_audit_log where action = 'org.create' $$, '42501', 'admin_audit_log is append-only',
  'DELETE of one row is refused');
select throws_ok($$ delete from app.admin_audit_log $$, '42501', 'admin_audit_log is append-only', 'DELETE of every row is refused');
select throws_ok($$ truncate app.admin_audit_log $$, '42501', 'admin_audit_log is append-only', 'TRUNCATE is refused');
select throws_ok($$ truncate app.admin_audit_log restart identity cascade $$, '42501', 'admin_audit_log is append-only',
  'and so is TRUNCATE ... RESTART IDENTITY CASCADE');

-- the cheapest bypass: switching the session to replica mode, which skips ordinary triggers
set local session_replication_role = replica;
select throws_ok($$ update app.admin_audit_log set action = 'org.delete' $$, '42501', 'admin_audit_log is append-only',
  'UPDATE is still refused under session_replication_role = replica (the triggers are ENABLE ALWAYS)');
select throws_ok($$ delete from app.admin_audit_log $$, '42501', 'admin_audit_log is append-only',
  'DELETE is still refused under replica mode');
select throws_ok($$ truncate app.admin_audit_log $$, '42501', 'admin_audit_log is append-only', 'and so is TRUNCATE');
set local session_replication_role = origin;

select is((select count(*)::int from app.admin_audit_log), 3, 'after all those attempts the three rows are still there');
select is(
  (select detail from app.admin_audit_log where action = 'org.create'),
  '{"slug":"audit-test","name":"Audit Test"}'::jsonb, 'and unchanged');

-- ============ what a row may hold ============

select t047.admin('00000000-0000-0000-0000-0000000b0001');
select is(t047.state($$select app.admin_audit('Org.Create')$$), '23514', 'an action in the wrong case is refused');
select is(t047.state($$select app.admin_audit('create')$$), '23514', 'an action with no dot is refused');
select is(t047.state($$select app.admin_audit('org.create; drop table x')$$), '23514', 'an action with punctuation is refused');
select is(t047.state(format($$select app.admin_audit(%L)$$, repeat('a', 29) || '.' || repeat('b', 30))), 'ok', 'an action of exactly 60 characters is accepted');
select is(t047.state(format($$select app.admin_audit(%L)$$, repeat('a', 30) || '.' || repeat('b', 30))), '23514', 'an action of 61 characters is refused');

select is(t047.state($$select app.admin_audit('org.create', null, null, '[1,2]'::jsonb)$$), '23514', 'a detail that is not an object is refused');
select is(t047.state($$select app.admin_audit('org.create', null, null, 'null'::jsonb)$$), '23514', 'a JSON null detail is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"password":"x"}'::jsonb)$$), '23514', 'a detail with a password key is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"email":"a@b.c"}'::jsonb)$$), '23514', 'a detail with an email key is refused (D-A13)');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"token":"x"}'::jsonb)$$), '23514', 'a detail with a token key is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"access_token":"x"}'::jsonb)$$), '23514', 'a detail with an access_token key is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"refresh_token":"x"}'::jsonb)$$), '23514', 'a detail with a refresh_token key is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"secret":"x"}'::jsonb)$$), '23514', 'a detail with a secret key is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"Password":"x"}'::jsonb)$$), '23514', 'a capitalised Password key is refused (case-insensitive)');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"USER_EMAIL":"x"}'::jsonb)$$), '23514', 'a USER_EMAIL key is refused (prefix and case)');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"e-mail":"x"}'::jsonb)$$), '23514', 'an e-mail key is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"a":{"b":{"new_password":"x"}}}'::jsonb)$$), '23514', 'a secret key nested two levels deep is refused');
select is(t047.state($$select app.admin_audit('account.create', null, null, '{"a":[{"jwt":"x"}]}'::jsonb)$$), '23514', 'a secret key inside an array of objects is refused');

-- every remaining word on the deny-list: none of these key spellings may be accepted
select is(
  (select coalesce(string_agg(k, ', ' order by k), 'none')
     from unnest(array['api_key', 'apiKey', 'apikey', 'otp', 'credentials', 'phone', 'phone_number', 'passcode', 'Token']) k
    where t047.state(format($q$select app.admin_audit('account.create', null, null, jsonb_build_object(%L, 1))$q$, k)) = 'ok'),
  'none', 'api_key, apikey, otp, credentials, phone and passcode style keys are all refused, in any case');

-- the size boundary: build details whose text is exactly 4000 and 4001 characters
select is(char_length(jsonb_build_object('n', repeat('x', 3991))::text), 4000, 'fixture check: this detail is exactly 4000 characters');
select is(t047.state($$select app.admin_audit('account.create', null, null, jsonb_build_object('n', repeat('x', 3991)))$$), 'ok', 'a detail of exactly 4000 characters is accepted');
select is(t047.state($$select app.admin_audit('account.create', null, null, jsonb_build_object('n', repeat('x', 3992)))$$), '23514', 'a detail of 4001 characters is refused');
select is(t047.state($$select app.admin_audit('member.role_set', null, null, '{"from":"owner","to":"organiser","slug":"x","name":"Pass The Beans","role":"owner","attested":true}'::jsonb)$$), 'ok',
  'the real detail keys (slug, name, role, attested, from, to) are accepted, even with a value that contains a word like pass (values are not inspected)');

-- ============ the API roles reach nothing ============

reset role;
set local role anon;
select is(t047.state('select * from app.admin_audit_log'), '42501', 'anon cannot read the log');
select is(t047.state($$select app.admin_audit('org.create')$$), '42501', 'anon cannot call the writer');
reset role;
set local role authenticated;
select t047.admin('00000000-0000-0000-0000-0000000b0001');
select is(t047.state('select * from app.admin_audit_log'), '42501', 'a signed-in caller (even a verified admin) cannot read the log directly');
select is(t047.state($$insert into app.admin_audit_log (actor_id, action) values (gen_random_uuid(), 'org.create')$$), '42501',
  'cannot insert a row of their own');
select is(t047.state($$select app.admin_audit('org.create')$$), '42501', 'cannot call the writer directly (only the definer wrappers can)');
reset role;
set local role service_role;
select is(t047.state('select * from app.admin_audit_log'), '42501', 'the service role cannot read the log directly either');
reset role;

select * from finish();
rollback;
