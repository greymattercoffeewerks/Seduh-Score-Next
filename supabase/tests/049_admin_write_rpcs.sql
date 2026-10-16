-- T-ADM.B4: the admin console's write RPCs (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A5, D-A6, D-A8, D-A9,
-- D-A11, section 3.4): admin_create_org, admin_add_member, admin_set_role.
-- Proves, for each wrapper:
--   * only a platform admin at aal2 with a fresh TOTP gets in (the exact refusal for anon, a signed-in non-admin,
--     an admin at aal1, with no TOTP proof, or a stale one), the gate runs BEFORE the arguments are looked at, and a
--     refused call changes nothing and logs nothing;
--   * success changes exactly what it should AND writes exactly one audit row with exactly the pinned keys, in the
--     same transaction (a forced failure of the audit insert rolls the change back);
--   * every refusal of the existing service-role function passes through with its own SQLSTATE and hint, and
--     writes no audit row and leaves no org or membership behind;
--   * D-A8: an admin cannot target their own user id (all three);
--   * D-A9: an account that holds any membership, or a team-removal marker, needs p_attest_own_password = true
--     (false or null does not count); a fresh login needs none; the inner function's own refusals win over it;
--     a refused attestation rolls back the org or membership the inner function had made;
--   * admin_set_role: unknown org / non-member / bad role have stable hints, setting the role a member already has
--     does nothing and logs nothing, the last-owner trigger's refusal is re-raised with hint last_owner and the
--     same SQLSTATE and message, and NO OTHER exception is remapped (another P0001, a 40001);
--   * the inner functions are still not executable by any API role.
--
-- Fixtures: orgs X (owner: nonadmin), Y (owner: pw, who has a one-time-password flag), S (owner s1, organisers s2 and
-- s3); a removed-from-team account with a marker in Y; fresh accounts that belong nowhere; a soft-deleted account.
-- Wrappers are called as postgres with admin claims (they are definers; the role matrix switches roles itself).
-- The audit assertions look only at ids above a baseline, so rows left by an earlier run cannot confuse them.
begin;
select plan(136);

create schema t049;
grant usage on schema t049 to anon, authenticated, service_role;

create function t049.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
declare c jsonb := jsonb_build_object('role', 'authenticated');
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

create function t049.admin() returns void language sql as
  $$ select t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal2', 10) $$;

-- "SQLSTATE|hint" of a statement, or 'ok'.
create function t049.outcome(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '');
end $$;

-- "SQLSTATE|hint|message" of a statement, or 'ok'.
create function t049.full(stmt text) returns text language plpgsql as $$
declare h text; m text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint, m = message_text;
  return sqlstate || '|' || coalesce(h, '') || '|' || m;
end $$;

-- Runs a statement as one kind of caller and reports "SQLSTATE|hint" or 'ok'; always restores the role.
create function t049.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t049.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t049.claims('00000000-0000-0000-0000-0000000d0002', 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal1');
    elsif kind = 'admin_no_totp' then perform t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal2');
    elsif kind = 'admin_stale_totp' then perform t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal2', 7200);
    elsif kind = 'admin_aal1_fresh' then perform t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal1', 10);
    elsif kind = 'admin_future_totp' then perform t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal2', -3600);
    elsif kind = 'admin_pw_fresh' then
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', '00000000-0000-0000-0000-0000000d0001'::uuid,
        'aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 10)))::text, true);
      perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000d0001', true);
    elsif kind = 'admin_ok' then perform t049.claims('00000000-0000-0000-0000-0000000d0001', 'aal2', 10);
    else raise exception 'unknown caller kind %', kind;
    end if;
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := sqlstate || '|' || coalesce(h, '');
  end;
  perform set_config('role', 'none', true);
  return res;
end $$;
grant execute on function t049.claims(uuid, text, int), t049.run_as(text, text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0001', 't049-admin@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0002', 't049-nonadmin@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0003', 't049-carol@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0005', 't049-removed@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0006', 't049-fresh2@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0007', 't049-fresh3@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0008', 't049-fresh4@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0010', 't049-s1@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0011', 't049-s2@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d0012', 't049-s3@test.seduh-next');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000d0004', 't049-pw@test.seduh-next', '{"must_change_password": true}'),
  -- the one-time-password flag, but NO membership and NO marker: a brand-new login from the Edge Function looks like this,
  -- and the flag is user-writable, so it must not make an account "need attestation" (D-A3, D-A9)
  ('00000000-0000-0000-0000-0000000d0009', 't049-flag1@test.seduh-next', '{"must_change_password": true}'),
  ('00000000-0000-0000-0000-0000000d000c', 't049-flag2@test.seduh-next', '{"must_change_password": true}');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d000d', 't049-fresh5@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d000e', 't049-fresh6@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000d000f', 't049-fresh7@test.seduh-next');
insert into auth.users (id, email, deleted_at) values
  ('00000000-0000-0000-0000-0000000d000b', 't049-deleted@test.seduh-next', now());
insert into app.platform_admins (user_id, note) values ('00000000-0000-0000-0000-0000000d0001', 't049 admin');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000d00a0', 'T049 Org X', 't049-x'),
  ('00000000-0000-0000-0000-0000000d00b0', 'T049 Org Y', 't049-y'),
  ('00000000-0000-0000-0000-0000000d00c0', 'T049 Org S', 't049-set');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0002', 'owner'),
  ('00000000-0000-0000-0000-0000000d00b0', '00000000-0000-0000-0000-0000000d0004', 'owner'),
  ('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0010', 'owner'),
  ('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0011', 'organiser'),
  ('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'organiser');
insert into team_removed_members (org_id, user_id) values
  ('00000000-0000-0000-0000-0000000d00b0', '00000000-0000-0000-0000-0000000d0005');

-- a live session for every fixture login (app.require_platform_admin() now requires the token's session_id to name a
-- real, unrevoked, aal2 session of the caller): the session id is the user id, which the claims helper below puts in the token
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id::text like '00000000-0000-0000-0000-0000000d%';

create table t049.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;
create function t049.audit_n() returns int language sql as
  $$ select count(*)::int from app.admin_audit_log
      where id > (select mid from t049.base) and actor_id = '00000000-0000-0000-0000-0000000d0001' $$;
-- the newest audit row since the baseline, as text
create function t049.last_audit() returns text language sql as
  $$ select (action, target_org_id, target_user_id, actor_id, detail)::text
       from app.admin_audit_log where id > (select mid from t049.base) and actor_id = '00000000-0000-0000-0000-0000000d0001'
      order by id desc limit 1 $$;
-- (orgs, memberships) of the t049 fixture orgs, and a snapshot to compare with: a write must change exactly what it names
create function t049.counts() returns text language sql as
  $$ select ((select count(*) from orgs where slug like 't049-%'),
             (select count(*) from org_members m join orgs g on g.id = m.org_id where g.slug like 't049-%'))::text $$;
create table t049.snap (o bigint, m bigint);
create function t049.snapshot() returns void language sql as
  $$ truncate t049.snap; insert into t049.snap select (select count(*) from orgs where slug like 't049-%'),
       (select count(*) from org_members m join orgs g on g.id = m.org_id where g.slug like 't049-%') $$;
create function t049.expect_delta(do_ int, dm int) returns text language sql as
  $$ select format('(%s,%s)', o + do_, m + dm) from t049.snap $$;

-- ============ who may execute what ============

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_create_org', 'admin_add_member', 'admin_set_role')
      and not coalesce(p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""'], false)),
  'none', 'all three are SECURITY DEFINER, VOLATILE (they write), with search_path pinned to the empty string (an unpinned one has a NULL proconfig and must still be reported)');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_create_org', 'admin_add_member', 'admin_set_role')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and service_role cannot execute any of them');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_create_org', 'admin_add_member', 'admin_set_role')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  3, 'a signed-in caller can execute all three (the function itself then decides)');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('create_org', 'org_add_existing_member', 'org_set_role')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the inner provisioning functions are still not executable by anon or any signed-in caller');

-- ============ the refusal matrix: every caller kind x every RPC, and nothing changes ============

select is(
  t049.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_create_org', $$select public.admin_create_org('T049 Matrix', 't049-matrix', '00000000-0000-0000-0000-0000000d0003')$$),
  ('admin_add_member', $$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0003', 'organiser')$$),
  ('admin_set_role', $$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0011', 'owner')$$)) r(name, stmt)
cross join (values
  ('anon', '42501|'),
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_no_totp', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required'),
  ('admin_aal1_fresh', '42501|admin_mfa_required'),
  ('admin_pw_fresh', '42501|admin_mfa_required'),
  ('admin_future_totp', '42501|admin_mfa_required')) c(kind, expected)
order by r.name, c.kind;

-- the gate comes BEFORE the arguments are looked at: garbage arguments give a refused caller the refusal
select is(
  t049.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' with garbage arguments as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_create_org', $$select public.admin_create_org('', '', null)$$),
  ('admin_add_member', 'select public.admin_add_member(null, null, null)'),
  ('admin_set_role', 'select public.admin_set_role(null, null, null)')) r(name, stmt)
cross join (values
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required')) c(kind, expected)
order by r.name, c.kind;

-- ... and the self-target check comes AFTER the gate: naming your own id must not tell a refused caller anything
select is(
  t049.run_as(c.kind, replace(r.stmt, '@', c.own)),
  c.expected,
  r.name || ' targeting the caller''s own id as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_create_org', $$select public.admin_create_org('T049 SelfGate', 't049-selfgate', '@')$$),
  ('admin_add_member', $$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '@', 'organiser')$$),
  ('admin_set_role', $$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '@', 'owner')$$)) r(name, stmt)
cross join (values
  ('nonadmin', '00000000-0000-0000-0000-0000000d0002', '42501|admin_required'),
  ('admin_aal1', '00000000-0000-0000-0000-0000000d0001', '42501|admin_mfa_required')) c(kind, own, expected)
order by r.name, c.kind;

select is(
  (select (t049.audit_n(),
           (select count(*) from orgs where slug = 't049-matrix'),
           (select count(*) from org_members where user_id = '00000000-0000-0000-0000-0000000d0003'),
           (select role from org_members where org_id = '00000000-0000-0000-0000-0000000d00c0' and user_id = '00000000-0000-0000-0000-0000000d0011'))::text),
  '(0,0,0,organiser)', 'after all those refused calls: no audit row, no org, no membership, and the role is unchanged');

-- ============ admin_create_org ============

select t049.admin();
create table t049.made (k text primary key, id uuid);
select t049.snapshot();
insert into t049.made select 'alpha', public.admin_create_org('  T049 Alpha  ', '  T049-Alpha ', '00000000-0000-0000-0000-0000000d0006');

select is((select name || '|' || slug from orgs where id = (select id from t049.made where k = 'alpha')), 'T049 Alpha|t049-alpha',
  'create: the name is trimmed and the slug trimmed and folded to lower case (by the existing function)');
select is((select role from org_members where org_id = (select id from t049.made where k = 'alpha') and user_id = '00000000-0000-0000-0000-0000000d0006'),
  'owner', 'and the named account is its owner');
select is(t049.last_audit(),
  format('(org.create,%s,00000000-0000-0000-0000-0000000d0006,00000000-0000-0000-0000-0000000d0001,"{""name"": ""T049 Alpha"", ""slug"": ""t049-alpha"", ""attested"": false}")',
         (select id from t049.made where k = 'alpha')),
  'and one org.create audit row names the actor, the new org and the owner, with exactly slug, name (as stored) and attested');
select is(t049.audit_n(), 1, 'exactly one audit row');
select is(t049.counts(), t049.expect_delta(1, 1), 'and nothing else changed: exactly one new org and one new membership (the owner''s), not one more');

select is(t049.outcome($$select public.admin_create_org('', 't049-bad', '00000000-0000-0000-0000-0000000d0007')$$), '22023|org_name_invalid', 'create: an empty name keeps the function''s own hint');
select is(t049.outcome($$select public.admin_create_org('T049 Bad', 'a', '00000000-0000-0000-0000-0000000d0007')$$), '22023|org_slug_invalid', 'a bad slug');
select is(t049.outcome($$select public.admin_create_org('T049 Bad', 'admin', '00000000-0000-0000-0000-0000000d0007')$$), '22023|org_slug_reserved', 'a reserved slug');
select is(t049.full($$select public.admin_create_org('T049 Bad', 'T049-X', '00000000-0000-0000-0000-0000000d0007')$$),
  '23505|org_slug_taken|create_org: that slug is already taken', 'a taken slug (case-insensitively), with the function''s own message');
select is(t049.outcome($$select public.admin_create_org('T049 Bad', 't049-bad', '00000000-0000-0000-0000-00000000dead')$$), '22023|org_owner_not_found', 'an owner that does not exist');
select is(t049.outcome($$select public.admin_create_org('T049 Bad', 't049-bad', null)$$), '22023|org_owner_not_found', 'a null owner');
select is(t049.outcome($$select public.admin_create_org('T049 Bad', 't049-bad', '00000000-0000-0000-0000-0000000d000b')$$), '22023|org_owner_not_found', 'a soft-deleted owner');
select is(t049.outcome($$select public.admin_create_org('T049 Bad', 'a', '00000000-0000-0000-0000-0000000d0004')$$), '22023|org_slug_invalid',
  'the function''s own refusal wins over the attestation gate (an owner who needs attestation, with a bad slug)');
select is((select (t049.audit_n(), (select count(*) from orgs where slug like 't049-%'))::text), '(1,4)',
  'after those refusals: still one audit row, and no org was left behind (alpha plus the three fixtures)');

select is(t049.outcome($$select public.admin_create_org('T049 Self', 't049-self', '00000000-0000-0000-0000-0000000d0001')$$), '42501|admin_self_target',
  'D-A8: an admin cannot make themselves an owner');
select is(t049.outcome($$select public.admin_create_org('', '', '00000000-0000-0000-0000-0000000d0001')$$), '42501|admin_self_target',
  'and the self-target check comes before the function''s own validation (own id with a bad name and slug)');

select is(t049.outcome($$select public.admin_create_org('T049 Pw', 't049-pwtry', '00000000-0000-0000-0000-0000000d0004')$$), '22023|member_password_unset',
  'D-A9: an owner who already belongs to an org needs attestation');
select is(t049.outcome($$select public.admin_create_org('T049 Pw', 't049-pwtry', '00000000-0000-0000-0000-0000000d0004', false)$$)
       || t049.outcome($$select public.admin_create_org('T049 Pw', 't049-pwtry', '00000000-0000-0000-0000-0000000d0004', null)$$),
  '22023|member_password_unset22023|member_password_unset', 'an explicit false or a null attestation does not count');
select is((select (t049.audit_n(), (select count(*) from orgs where slug = 't049-pwtry'))::text), '(1,0)',
  'and the refused attestation rolled the org back and logged nothing');
select is(t049.outcome($$select public.admin_create_org('T049 Pw', 't049-removed-try', '00000000-0000-0000-0000-0000000d0005')$$), '22023|member_password_unset',
  'an account removed from a team (no membership, but a marker) needs attestation too');
insert into t049.made select 'pwok', public.admin_create_org('T049 Pw Ok', 't049-pwok', '00000000-0000-0000-0000-0000000d0004', true);
select is(t049.last_audit(),
  format('(org.create,%s,00000000-0000-0000-0000-0000000d0004,00000000-0000-0000-0000-0000000d0001,"{""name"": ""T049 Pw Ok"", ""slug"": ""t049-pwok"", ""attested"": true}")',
         (select id from t049.made where k = 'pwok')),
  'with attestation it succeeds, and the audit row records attested: true');
select is(t049.outcome($$select public.admin_create_org('T049 Rm Ok', 't049-rmok', '00000000-0000-0000-0000-0000000d0005', true)$$), 'ok',
  'attestation also lets a removed-from-team account own an org');
select is(t049.outcome($$select public.admin_create_org('T049 Flag', 't049-flag', '00000000-0000-0000-0000-0000000d0009')$$), 'ok',
  'the one-time-password FLAG alone does not need attestation: a brand-new login (flag set, no membership, no marker) owns an org with none');
select is(t049.last_audit(),
  format('(org.create,%s,00000000-0000-0000-0000-0000000d0009,00000000-0000-0000-0000-0000000d0001,"{""name"": ""T049 Flag"", ""slug"": ""t049-flag"", ""attested"": false}")',
         (select id from orgs where slug = 't049-flag')),
  'and its audit row says attested: false');
select is(t049.outcome($$select public.admin_create_org('T049 Fresh', 't049-fresh', '00000000-0000-0000-0000-0000000d000d', true)$$), 'ok',
  'attest = true on a fresh login is accepted');
select is(t049.last_audit(),
  format('(org.create,%s,00000000-0000-0000-0000-0000000d000d,00000000-0000-0000-0000-0000000d0001,"{""name"": ""T049 Fresh"", ""slug"": ""t049-fresh"", ""attested"": false}")',
         (select id from orgs where slug = 't049-fresh')),
  'and the audit row says attested: false (it was not needed, so it is not claimed)');

-- atomicity: the audit insert fails, so the whole call is undone
create function t049.boom() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure' using errcode = '55000'; end $$;
create trigger t049_boom before insert on app.admin_audit_log for each row execute function t049.boom();
select is(t049.full($$select public.admin_create_org('T049 Atomic', 't049-atomic', '00000000-0000-0000-0000-0000000d0007')$$), '55000||forced audit failure',
  'atomicity: when the audit insert fails the call fails, with that failure');
select is((select ((select count(*) from orgs where slug = 't049-atomic'), (select count(*) from org_members where user_id = '00000000-0000-0000-0000-0000000d0007'))::text),
  '(0,0)', 'and no org and no membership was left behind');
drop trigger t049_boom on app.admin_audit_log;

-- ============ admin_add_member ============

select t049.snapshot();
select lives_ok($$ select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0003', 'organiser') $$,
  'add: a fresh login joins an org as an organiser with no attestation');
select is(t049.counts(), t049.expect_delta(0, 1), 'and exactly one membership was added, nothing else');
select is((select role from org_members where org_id = '00000000-0000-0000-0000-0000000d00a0' and user_id = '00000000-0000-0000-0000-0000000d0003'),
  'organiser', 'and holds that role');
select is(t049.last_audit(),
  '(member.add,00000000-0000-0000-0000-0000000d00a0,00000000-0000-0000-0000-0000000d0003,00000000-0000-0000-0000-0000000d0001,"{""role"": ""organiser"", ""attested"": false}")',
  'one member.add audit row with exactly role and attested');

select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0007', 'boss')$$), '22023|member_role_invalid', 'add: a bad role');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0007', null)$$), '22023|member_role_invalid', 'a null role');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000d0007', 'organiser')$$), '22023|org_not_found', 'an unknown org');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-00000000dead', 'organiser')$$), '22023|member_user_not_found', 'an unknown user');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', null, 'organiser')$$), '22023|member_user_not_found', 'a null user');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d000b', 'organiser')$$), '22023|member_user_not_found', 'a soft-deleted user');
select is(t049.full($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0003', 'organiser')$$),
  '23505|member_exists|org_add_existing_member: that account is already a member of this organisation',
  'an account already in the org: member_exists with the function''s own message, not "password unset" (its refusal wins), though that account now needs attestation');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0001', 'organiser')$$), '42501|admin_self_target',
  'D-A8: an admin cannot add themselves');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000d0001', 'boss')$$), '42501|admin_self_target',
  'and the self-target check comes before the function''s own validation (own id, unknown org, bad role)');
-- carol is now an ORGANISER of X and nothing else: any membership counts, not only an owner's
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00b0', '00000000-0000-0000-0000-0000000d0003', 'organiser')$$), '22023|member_password_unset',
  'D-A9: an account that is only an ORGANISER somewhere needs attestation too (any membership counts)');
select is((select count(*) from org_members where org_id = '00000000-0000-0000-0000-0000000d00b0' and user_id = '00000000-0000-0000-0000-0000000d0003')::int, 0,
  'and was not added');
select is(t049.outcome($$select public.admin_create_org('T049 Org Carol', 't049-carol-try', '00000000-0000-0000-0000-0000000d0003')$$), '22023|member_password_unset',
  'and the same account cannot be made an owner of a new org without attestation');

select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0004', 'organiser')$$), '22023|member_password_unset',
  'D-A9: an account in another org needs attestation');
select is((select count(*) from org_members where org_id = '00000000-0000-0000-0000-0000000d00a0' and user_id = '00000000-0000-0000-0000-0000000d0004')::int, 0,
  'and the refused attestation rolled the membership back');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0004', 'organiser', false)$$)
       || t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0004', 'organiser', null)$$),
  '22023|member_password_unset22023|member_password_unset', 'an explicit false or a null attestation does not count here either');
select lives_ok($$ select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0004', 'organiser', true) $$,
  'with attestation it is added');
select is(t049.last_audit(),
  '(member.add,00000000-0000-0000-0000-0000000d00a0,00000000-0000-0000-0000-0000000d0004,00000000-0000-0000-0000-0000000d0001,"{""role"": ""organiser"", ""attested"": true}")',
  'and the audit row says attested: true');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0005', 'organiser')$$), '22023|member_password_unset',
  'an account removed from a team needs attestation (a marker, no membership)');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0005', 'organiser', true)$$), 'ok',
  'and with attestation it is added');
select is(t049.last_audit(),
  '(member.add,00000000-0000-0000-0000-0000000d00c0,00000000-0000-0000-0000-0000000d0005,00000000-0000-0000-0000-0000000d0001,"{""role"": ""organiser"", ""attested"": true}")',
  'and its audit row says attested: true');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00b0', '00000000-0000-0000-0000-0000000d000c', 'organiser')$$), 'ok',
  'the one-time-password flag alone does not need attestation when adding either (no membership, no marker)');
select is(t049.last_audit(),
  '(member.add,00000000-0000-0000-0000-0000000d00b0,00000000-0000-0000-0000-0000000d000c,00000000-0000-0000-0000-0000000d0001,"{""role"": ""organiser"", ""attested"": false}")',
  'and its audit row says attested: false');
select is(t049.outcome($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0007', 'owner', true)$$), 'ok',
  'a fresh login with attestation true is simply added (attested is only true when it was needed)');
select is(t049.last_audit(),
  '(member.add,00000000-0000-0000-0000-0000000d00a0,00000000-0000-0000-0000-0000000d0007,00000000-0000-0000-0000-0000000d0001,"{""role"": ""owner"", ""attested"": false}")',
  'and the audit row says attested: false for it');

create trigger t049_boom before insert on app.admin_audit_log for each row execute function t049.boom();
select is(t049.full($$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d0008', 'organiser')$$), '55000||forced audit failure',
  'atomicity: when the audit insert fails the add fails, with that failure');
select is((select count(*) from org_members where user_id = '00000000-0000-0000-0000-0000000d0008')::int, 0, 'and no membership was left behind');
drop trigger t049_boom on app.admin_audit_log;

-- ============ the writes as the API role (definer + grants, the path PostgREST uses) ============

create table t049.mark2 as select t049.audit_n() as n;
select is(t049.run_as('admin_ok', $$select public.admin_create_org('T049 Auth', 't049-auth', '00000000-0000-0000-0000-0000000d000e')$$), 'ok',
  'as role authenticated, a verified admin can create an org');
select is(t049.run_as('admin_ok', $$select public.admin_add_member('00000000-0000-0000-0000-0000000d00a0', '00000000-0000-0000-0000-0000000d000f', 'organiser')$$), 'ok',
  'and add a member');
select is(t049.run_as('admin_ok', $$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0010', 'owner')$$), 'ok',
  'and set a role (here the no-op: s1 is already an owner)');
select is((t049.audit_n() - (select n from t049.mark2), (select count(*) from orgs where slug = 't049-auth'),
           (select count(*) from org_members where org_id = '00000000-0000-0000-0000-0000000d00a0' and user_id = '00000000-0000-0000-0000-0000000d000f'))::text,
  '(2,1,1)', 'exactly two audit rows came from those three calls (the no-op logged none), and the org and membership exist');

-- ============ admin_set_role (org S: s1 owner, s2 and s3 organisers) ============

select t049.snapshot();
select lives_ok($$ select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0011', 'owner') $$,
  'role: an organiser is promoted to owner');
select is(t049.counts(), t049.expect_delta(0, 0), 'and no org or membership was added or removed');
select is((select role from org_members where org_id = '00000000-0000-0000-0000-0000000d00c0' and user_id = '00000000-0000-0000-0000-0000000d0011'), 'owner', 'and is now an owner');
select is(t049.last_audit(),
  '(member.role_set,00000000-0000-0000-0000-0000000d00c0,00000000-0000-0000-0000-0000000d0011,00000000-0000-0000-0000-0000000d0001,"{""to"": ""owner"", ""from"": ""organiser""}")',
  'one member.role_set audit row with exactly from and to');

create table t049.mark as select t049.audit_n() as n, t049.last_audit() as last;
-- count the UPDATEs on org_members: a no-op must not even touch the row
create table t049.upd (n int not null);
insert into t049.upd values (0);
create function t049.count_upd() returns trigger language plpgsql set search_path = '' as $$ begin update t049.upd set n = n + 1; return new; end $$;
create trigger t049_count before update on org_members for each row execute function t049.count_upd();
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0011', 'owner')$$), 'ok',
  'setting the role a member already has does not fail ...');
select is((select n from t049.upd), 0, '... does not update the row at all ...');
select is((t049.audit_n(), t049.last_audit())::text, (select (n, last)::text from t049.mark),
  '... and logs nothing: the audit trail is exactly as it was (a no-op is not an event)');

select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'boss')$$), '22023|member_role_invalid', 'role: a bad role');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0008', 'boss')$$), '22023|member_role_invalid',
  'role validation comes first: a bad role for a non-member is member_role_invalid, not member_not_found');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000d0012', 'boss')$$), '22023|member_role_invalid',
  'and a bad role for an unknown org is member_role_invalid, not org_not_found');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000d0008', 'owner')$$), '22023|org_not_found',
  'and an unknown org comes before a non-member');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', null)$$), '22023|member_role_invalid', 'a null role');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000d0012', 'owner')$$), '22023|org_not_found', 'an unknown org');
select is(t049.outcome($$select public.admin_set_role(null, '00000000-0000-0000-0000-0000000d0012', 'owner')$$), '22023|org_not_found', 'a null org');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0008', 'owner')$$), '22023|member_not_found', 'a person who is not a member');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', null, 'owner')$$), '22023|member_not_found', 'a null person');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0001', 'owner')$$), '42501|admin_self_target',
  'D-A8: an admin cannot change their own role');
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-00000000dead', '00000000-0000-0000-0000-0000000d0001', 'boss')$$), '42501|admin_self_target',
  'and the self-target check comes before role validation and the org lookup');

-- two owners now (s1, s2): one may be demoted, the last may not
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0011', 'organiser')$$), 'ok',
  'with two owners, one can be demoted');
select is((select n from t049.upd), 1, 'and a real change updates the row exactly once (the counting trigger does see updates)');
drop trigger t049_count on org_members;
select is(t049.full($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0010', 'organiser')$$),
  'P0001|last_owner|org_members: an org must keep at least one owner',
  'D-A11: the last owner cannot be demoted: the same SQLSTATE and message, with the stable hint last_owner');
select is((select role from org_members where org_id = '00000000-0000-0000-0000-0000000d00c0' and user_id = '00000000-0000-0000-0000-0000000d0010'), 'owner', 'and they are still the owner');
select is(t049.last_audit(),
  '(member.role_set,00000000-0000-0000-0000-0000000d00c0,00000000-0000-0000-0000-0000000d0011,00000000-0000-0000-0000-0000000d0001,"{""to"": ""organiser"", ""from"": ""owner""}")',
  'and the refused demotion wrote no audit row (the newest is the successful demotion before it)');

-- only the last-owner refusal is remapped: another P0001, and other SQLSTATEs, pass through untouched
create function t049.other_rule() returns trigger language plpgsql as $$ begin raise exception 'some other rule'; end $$;
create trigger t049_other before update on org_members for each row
  when (new.user_id = '00000000-0000-0000-0000-0000000d0012') execute function t049.other_rule();
select is(t049.full($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'owner')$$),
  'P0001||some other rule', 'a DIFFERENT P0001 is not remapped: no hint is invented');
drop trigger t049_other on org_members;
-- ... not even one that shares the trigger's message prefix, and its own hint survives the re-raise
create function t049.other_rule2() returns trigger language plpgsql as $$ begin raise exception 'org_members: a different rule' using hint = 'another hint'; end $$;
create trigger t049_other2 before update on org_members for each row
  when (new.user_id = '00000000-0000-0000-0000-0000000d0012') execute function t049.other_rule2();
select is(t049.full($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'owner')$$),
  'P0001|another hint|org_members: a different rule',
  'a P0001 with a similar message prefix is not remapped either, and the original hint survives the re-raise');
drop trigger t049_other2 on org_members;
create function t049.serialization() returns trigger language plpgsql as $$ begin raise exception 'forced' using errcode = '40001'; end $$;
create trigger t049_ser before update on org_members for each row
  when (new.user_id = '00000000-0000-0000-0000-0000000d0012') execute function t049.serialization();
select is(t049.outcome($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'owner')$$), '40001|',
  'a serialization failure (40001) is re-raised untouched');
drop trigger t049_ser on org_members;

create trigger t049_boom before insert on app.admin_audit_log for each row execute function t049.boom();
select is(t049.full($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'owner')$$), '55000||forced audit failure',
  'atomicity: when the audit insert fails the role change fails, with that failure');
select is((select role from org_members where org_id = '00000000-0000-0000-0000-0000000d00c0' and user_id = '00000000-0000-0000-0000-0000000d0012'), 'organiser',
  'and the role is unchanged');
drop trigger t049_boom on app.admin_audit_log;

-- the audit insert is outside the exception block: a failure there that LOOKS like the last-owner trigger's is not remapped
create function t049.boom_lo() returns trigger language plpgsql as $$ begin raise exception 'org_members: an org must keep at least one owner'; end $$;
create trigger t049_boom_lo before insert on app.admin_audit_log for each row execute function t049.boom_lo();
select is(t049.full($$select public.admin_set_role('00000000-0000-0000-0000-0000000d00c0', '00000000-0000-0000-0000-0000000d0012', 'owner')$$),
  'P0001||org_members: an org must keep at least one owner',
  'a failure of the AUDIT insert is never remapped to last_owner (the audit is outside the handler)');
drop trigger t049_boom_lo on app.admin_audit_log;

-- the member row is read FOR UPDATE (a concurrent change cannot slip between the read of "from" and the update;
-- one session cannot observe a lock, so the intent is pinned in the source)
select ok(
  (select p.prosrc ~ 'from public\.orgs o where o\.id = p_org_id for no key update;[\s\S]*from public\.org_members m\s+where m\.org_id = p_org_id and m\.user_id = p_user_id\s+for no key update;'
     from pg_proc p where p.oid = 'public.admin_set_role(uuid, uuid, text)'::regprocedure),
  'admin_set_role locks the org row, THEN the member row, both FOR NO KEY UPDATE (source text: one session cannot observe a lock; this is the order protect_last_owner uses, so two admins cannot deadlock each other)');

-- ============ the whole trail ============

select is((select count(*)::int from app.admin_audit_log where id > (select mid from t049.base) and actor_id = '00000000-0000-0000-0000-0000000d0001'), 14,
  'in total fourteen audit rows: six org.create, six member.add, two member.role_set (no refusal and no no-op wrote one)');
select is(
  (select string_agg(a || ':' || k, ' | ' order by a)
     from (select distinct action as a, (select string_agg(x, ',' order by x) from jsonb_object_keys(detail) x) as k
             from app.admin_audit_log where id > (select mid from t049.base) and actor_id = '00000000-0000-0000-0000-0000000d0001') q),
  'member.add:attested,role | member.role_set:from,to | org.create:attested,name,slug',
  'each action carries exactly its pinned detail keys');
select is((select string_agg(distinct actor_id::text, ',') from app.admin_audit_log where id > (select mid from t049.base) and target_org_id in (select id from orgs where slug like 't049-%')),
  '00000000-0000-0000-0000-0000000d0001', 'and every row about the fixture orgs names the admin, and only the admin, as the actor');

select * from finish();
rollback;
