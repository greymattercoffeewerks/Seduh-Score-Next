-- T-ADM.B3: the admin console's read RPCs (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A4, D-A5, 3.3).
-- Proves: each of admin_list_orgs, admin_org_detail, admin_find_user and admin_list_audit refuses every caller
-- but a platform admin at aal2 with a fresh TOTP, with the exact SQLSTATE and hint, and does so BEFORE it looks
-- at its arguments (an unknown org id or a blank email gives a non-admin the same refusal as a real one: no
-- existence oracle); every public.admin_* function starts with the gate and nothing before it; and for the
-- verified admin they return the right values and nothing more:
--   * the result column lists, the exact JSON of an org's detail, and the set of relations the four function
--     bodies may mention are pinned (a new column, key or table, such as an event name or a person, fails here),
--   * whole rows are compared, not just counts: org_id, name, created_at and every audit column,
--   * the detail document names no event, venue, entrant, person or phone number,
--   * the last-event date is taken in UTC, whatever the session time zone,
--   * admin_find_user is an EXACT, case- and whitespace-insensitive email match (a prefix, a wildcard, null,
--     blank, and a blank-email account all return nothing; two live accounts differing only by case are
--     email_ambiguous), with the flags the console needs; needs_attestation always equals
--     app.account_needs_attestation (the predicate the write RPCs will enforce),
--   * admin_list_audit pages by id, filters by org, clamps the limit to 1..200, and resolves emails and the
--     org slug at read time (null once the user or org is gone).
-- The audit assertions do not assume the table is empty (a later run may leave rows): they use the fixture ids.
--
-- Fixtures: orgs A (alpha: 2 members, 3 events with a venue and a config, one test event, one with no date, an
-- entrant, a person), B (bravo: 1 member, no events), C (charlie: one event with only a UTC created_at near
-- midnight), E (empty). Users: admin, an organiser (non-admin), carol (in no org), banned, an expired ban,
-- soft-deleted, removed-from-team, pw (in A and B, with a one-time-password flag), a blank-email account, and two
-- live accounts differing only in case. Claims are set as JSON in request.jwt.claims; the sub is also set.
begin;
select plan(95);

create schema t048;
grant usage on schema t048 to anon, authenticated, service_role;

create function t048.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

-- Runs a statement as one kind of caller and reports "SQLSTATE|hint" or 'ok'; always restores the role.
create function t048.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t048.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t048.claims('00000000-0000-0000-0000-0000000c0002', 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal1');
    elsif kind = 'admin_no_totp' then perform t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2');
    elsif kind = 'admin_stale_totp' then perform t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2', 7200);
    elsif kind = 'admin_ok' then perform t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2', 10);
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
grant execute on function t048.claims(uuid, text, int), t048.run_as(text, text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0001', 't048-admin@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000c0002', 't048-organiser@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000c0003', 't048-carol@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000c0006', 't048-removed@test.seduh-next'),
  -- an account whose email column is the empty string (phone-style logins can look like this)
  ('00000000-0000-0000-0000-0000000c0008', ''),
  -- two live accounts that differ only in letter case (the unique index is case-sensitive)
  ('00000000-0000-0000-0000-0000000c0010', 't048-dup@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000c0011', 'T048-DUP@test.seduh-next'),
  -- an email stored with capitals (found by a lower-case search)
  ('00000000-0000-0000-0000-0000000c0012', 'T048-Mixed@test.seduh-next'),
  -- a live account that shares an email, apart from case, with a soft-deleted one (not ambiguous)
  ('00000000-0000-0000-0000-0000000c0013', 't048-ghost@test.seduh-next');
insert into auth.users (id, email, deleted_at) values
  ('00000000-0000-0000-0000-0000000c0014', 'T048-GHOST@test.seduh-next', now());
insert into auth.users (id, email, banned_until) values
  ('00000000-0000-0000-0000-0000000c0004', 't048-banned@test.seduh-next', now() + interval '1 day'),
  ('00000000-0000-0000-0000-0000000c0009', 't048-expired-ban@test.seduh-next', now() - interval '1 day');
insert into auth.users (id, email, deleted_at) values
  ('00000000-0000-0000-0000-0000000c0005', 't048-deleted@test.seduh-next', now());
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000c0007', 't048-pw-user@test.seduh-next', '{"must_change_password": true}');
insert into app.platform_admins (user_id, note) values ('00000000-0000-0000-0000-0000000c0001', 't048 admin');

insert into orgs (id, name, slug, created_at) values
  ('00000000-0000-0000-0000-0000000c00a0', 'T048 Alpha Coffee', 't048-alpha', '2026-01-02 09:00:00+00'),
  ('00000000-0000-0000-0000-0000000c00b0', 'T048 Bravo Roasters', 't048-bravo', '2026-03-04 09:00:00+00'),
  ('00000000-0000-0000-0000-0000000c00c0', 'T048 Charlie Beans', 't048-charlie', '2026-06-01 09:00:00+00'),
  ('00000000-0000-0000-0000-0000000c00e0', 'T048 Empty Org', 't048-empty', '2025-12-01 09:00:00+00');
insert into org_members (org_id, user_id, role, created_at) values
  ('00000000-0000-0000-0000-0000000c00a0', '00000000-0000-0000-0000-0000000c0002', 'owner', '2026-01-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000c00a0', '00000000-0000-0000-0000-0000000c0007', 'organiser', '2026-01-03 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000c00b0', '00000000-0000-0000-0000-0000000c0007', 'owner', '2026-03-04 10:00:00+00');
insert into team_removed_members (org_id, user_id) values
  ('00000000-0000-0000-0000-0000000c00a0', '00000000-0000-0000-0000-0000000c0006');

insert into events (id, org_id, format, name, event_date, created_at, is_test, venue, config, status) values
  ('00000000-0000-0000-0000-0000000c0e01', '00000000-0000-0000-0000-0000000c00a0', 'cup_taster', 'Secret Cup Final', '2026-05-10', '2026-02-01 12:00:00+00', false, 'Secret Venue', '{"note":"secret-config"}', 'running'),
  ('00000000-0000-0000-0000-0000000c0e02', '00000000-0000-0000-0000-0000000c00a0', 'cup_taster', 'Hidden Open', null, '2026-02-01 12:00:00+00', false, null, '{}', 'draft'),
  ('00000000-0000-0000-0000-0000000c0e03', '00000000-0000-0000-0000-0000000c00a0', 'cup_taster', 'Throwaway Test', '2026-04-01', '2026-02-02 12:00:00+00', true, null, '{}', 'draft'),
  -- no event_date, created 23:30 UTC on 15 June: the UTC date is the 15th, but 16 June in Auckland
  ('00000000-0000-0000-0000-0000000c0e04', '00000000-0000-0000-0000-0000000c00c0', 'cup_taster', 'Midnight Cup', null, '2026-06-15 23:30:00+00', false, null, '{}', 'draft');
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000c0e11', '00000000-0000-0000-0000-0000000c0e01', 'Secret Entrant');
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000c0f01', '00000000-0000-0000-0000-0000000c00a0', 'Private Person', '+6731234567');

-- the audit trail (as the owner: the append-only triggers refuse only change and removal), with fixed times
insert into app.admin_audit_log (at, actor_id, action, target_org_id, target_user_id, detail) values
  ('2026-07-01 08:00:00+00', '00000000-0000-0000-0000-0000000c0001', 'org.create', '00000000-0000-0000-0000-0000000c00a0', '00000000-0000-0000-0000-0000000c0002', '{"slug":"t048-alpha","name":"T048 Alpha Coffee"}'),
  ('2026-07-01 09:00:00+00', '00000000-0000-0000-0000-0000000c0001', 'member.add', '00000000-0000-0000-0000-0000000c00a0', '00000000-0000-0000-0000-0000000c0007', '{"role":"organiser","attested":true}'),
  ('2026-07-01 10:00:00+00', '00000000-0000-0000-0000-0000000c0001', 'member.role_set', '00000000-0000-0000-0000-0000000c00b0', '00000000-0000-0000-0000-0000000c0007', '{"from":"organiser","to":"owner"}'),
  -- an actor and a target user that no longer exist
  ('2026-07-01 11:00:00+00', '00000000-0000-0000-0000-0000000c0aaa', 'account.create', null, '00000000-0000-0000-0000-0000000c0bbb', '{}'),
  -- an org that no longer exists
  ('2026-07-01 12:00:00+00', '00000000-0000-0000-0000-0000000c0001', 'org.create', '00000000-0000-0000-0000-0000000c0ccc', null, '{"slug":"gone"}');
create table t048.aid as select row_number() over (order by id)::int as n, id from app.admin_audit_log where id > (select coalesce(max(id), 0) - 5 from app.admin_audit_log);
create table t048.base as select count(*)::int as total from app.admin_audit_log;
grant select on t048.aid, t048.base to authenticated;

-- ============ who may execute what ============

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_list_orgs', 'admin_org_detail', 'admin_find_user', 'admin_list_audit')
      and not (p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'])),
  'none', 'all four are SECURITY DEFINER, STABLE, with search_path pinned to the empty string');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_list_orgs', 'admin_org_detail', 'admin_find_user', 'admin_list_audit')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and service_role cannot execute any of them');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_list_orgs', 'admin_org_detail', 'admin_find_user', 'admin_list_audit')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  4, 'a signed-in caller can execute all four (the function itself then decides)');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid = 'app.account_needs_attestation(uuid)'::regprocedure and has_function_privilege(r, p.oid, 'execute')),
  'none', 'no API role can execute app.account_needs_attestation');

-- every public.admin_* function that a signed-in caller can run starts with the gate, with nothing evaluated
-- before it (an optional #variable_conflict line, then declarations WITHOUT initialisers, then begin + perform)
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%' and p.prokind = 'f'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.prosrc !~ '^\s*(#variable_conflict[^\n]*\n)?\s*(declare\s+([a-z_0-9]+\s+[a-z_0-9.]+;\s*)+)?begin\s+perform\s+app\.require_platform_admin\(\);'),
  'none', 'every admin_* function a signed-in caller can run begins with app.require_platform_admin(), and nothing runs before it');
select is(
  (select array(select distinct m[1] from pg_proc p, regexp_matches(p.prosrc, '\m((?:public|auth|app)\.[a-z_]+)', 'g') m
                 where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('admin_list_orgs', 'admin_org_detail', 'admin_find_user', 'admin_list_audit') order by 1)),
  array['app.account_needs_attestation', 'app.admin_audit_log', 'app.require_platform_admin', 'auth.users', 'public.events',
        'public.org_members', 'public.orgs'],
  'the four bodies mention exactly these relations and functions: no people, entries, results or scores, ever');
select is(
  (select array(select distinct m[1] from pg_proc p, regexp_matches(p.prosrc, '\m((?:public|auth|app)\.[a-z_]+)', 'g') m
                 where p.oid = 'app.account_needs_attestation(uuid)'::regprocedure order by 1)),
  array['public.org_members', 'public.team_removed_members'],
  'and the shared attestation predicate reads only org_members and team_removed_members');

-- ============ the result shapes are pinned: metadata only ============

select is((select proargnames from pg_proc where oid = 'public.admin_list_orgs()'::regprocedure),
  array['org_id', 'name', 'slug', 'created_at', 'member_count', 'event_count', 'last_event_date'],
  'admin_list_orgs returns exactly: org_id, name, slug, created_at, member_count, event_count, last_event_date');
select is((select proargnames from pg_proc where oid = 'public.admin_find_user(text)'::regprocedure),
  array['p_email', 'user_id', 'email', 'banned', 'deleted', 'org_count', 'must_change_password', 'needs_attestation'],
  'admin_find_user returns exactly: user_id, email, banned, deleted, org_count, must_change_password, needs_attestation');
select is((select proargnames from pg_proc where oid = 'public.admin_list_audit(integer, bigint, uuid)'::regprocedure),
  array['p_limit', 'p_before', 'p_org_id', 'id', 'at', 'actor_id', 'actor_email', 'action', 'target_org_id', 'target_org_slug',
        'target_user_id', 'target_user_email', 'detail'],
  'admin_list_audit returns exactly: id, at, actor_id, actor_email, action, target_org_id, target_org_slug, target_user_id, target_user_email, detail');
select is((select pg_get_function_result('public.admin_org_detail(uuid)'::regprocedure)), 'jsonb',
  'admin_org_detail returns one jsonb document (its keys and values are pinned below)');

-- ============ the refusal matrix: every caller kind x every RPC ============

select is(
  t048.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_list_orgs', 'select * from public.admin_list_orgs()'),
  ('admin_org_detail', $$select public.admin_org_detail('00000000-0000-0000-0000-0000000c00a0')$$),
  ('admin_find_user', $$select * from public.admin_find_user('t048-carol@test.seduh-next')$$),
  ('admin_list_audit', 'select * from public.admin_list_audit()')) r(name, stmt)
cross join (values
  ('anon', '42501|'),
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_no_totp', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required'),
  ('admin_ok', 'ok')) c(kind, expected)
order by r.name, c.kind;

-- the gate comes BEFORE the arguments are looked at: an unknown org id, a null one, a null email and a blank
-- one must give a refused caller the refusal, never org_not_found or a quiet empty answer (no oracle)
select is(
  t048.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_org_detail(unknown id)', $$select public.admin_org_detail('00000000-0000-0000-0000-00000000dead')$$),
  ('admin_org_detail(null)', 'select public.admin_org_detail(null)'),
  ('admin_find_user(null)', 'select * from public.admin_find_user(null)'),
  ('admin_find_user(blank)', $$select * from public.admin_find_user('')$$)) r(name, stmt)
cross join (values
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_no_totp', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required')) c(kind, expected)
order by r.name, c.kind;

-- ============ app.account_needs_attestation, and that admin_find_user's flag IS that predicate ============

select is(app.account_needs_attestation('00000000-0000-0000-0000-0000000c0007'), true, 'an account with memberships needs attestation');
select is(app.account_needs_attestation('00000000-0000-0000-0000-0000000c0006'), true, 'an account removed from a team (no membership) needs it');
select is(app.account_needs_attestation('00000000-0000-0000-0000-0000000c0003'), false, 'an account in no org and never removed does not');
select is(app.account_needs_attestation(null), false, 'null is false, not an error');
select t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2', 10);
select is(
  (select coalesce(string_agg(u.email, ', ' order by u.email), 'none')
     from auth.users u
    cross join lateral public.admin_find_user(u.email) f
    where u.email like 't048-%@test.seduh-next' and u.email not like 't048-dup%' and u.deleted_at is null
      and f.needs_attestation is distinct from app.account_needs_attestation(u.id)),
  'none', 'for every fixture login, admin_find_user''s needs_attestation equals the shared predicate (they cannot drift)');

-- ============ what a verified admin gets (all the following run as that admin) ============

set local timezone to 'Pacific/Auckland';
set local role authenticated;
select t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2', 10);

-- ---- admin_list_orgs: whole rows ----
select results_eq(
  $$ select org_id, name, slug, created_at, member_count, event_count, last_event_date from public.admin_list_orgs() where slug like 't048-%' $$,
  $$ values ('00000000-0000-0000-0000-0000000c00c0'::uuid, 'T048 Charlie Beans', 't048-charlie', '2026-06-01 09:00:00+00'::timestamptz, 0, 1, '2026-06-15'::date),
            ('00000000-0000-0000-0000-0000000c00b0'::uuid, 'T048 Bravo Roasters', 't048-bravo', '2026-03-04 09:00:00+00'::timestamptz, 1, 0, null::date),
            ('00000000-0000-0000-0000-0000000c00a0'::uuid, 'T048 Alpha Coffee', 't048-alpha', '2026-01-02 09:00:00+00'::timestamptz, 2, 3, '2026-05-10'::date),
            ('00000000-0000-0000-0000-0000000c00e0'::uuid, 'T048 Empty Org', 't048-empty', '2025-12-01 09:00:00+00'::timestamptz, 0, 0, null::date) $$,
  'every column, newest org first: counts include test events, event_date wins, a missing one falls back to created_at in UTC (the 15th, though it is the 16th in Auckland)');

-- ---- admin_org_detail: the whole document ----
select is(
  (select public.admin_org_detail('00000000-0000-0000-0000-0000000c00a0')),
  jsonb_build_object(
    'org', jsonb_build_object('id', '00000000-0000-0000-0000-0000000c00a0'::uuid, 'name', 'T048 Alpha Coffee', 'slug', 't048-alpha',
                              'created_at', '2026-01-02 09:00:00+00'::timestamptz),
    'event_count', 3,
    'last_event_date', '2026-05-10'::date,
    'members', jsonb_build_array(
      jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000c0002'::uuid, 'email', 't048-organiser@test.seduh-next', 'role', 'owner',
                         'joined_at', '2026-01-02 10:00:00+00'::timestamptz),
      jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000c0007'::uuid, 'email', 't048-pw-user@test.seduh-next', 'role', 'organiser',
                         'joined_at', '2026-01-03 10:00:00+00'::timestamptz))),
  'the detail document is exactly: the org, the event count (test events included), the last event date, and the members in the order they joined');
select is(
  (select public.admin_org_detail('00000000-0000-0000-0000-0000000c00a0')::text ~ '(Secret Cup Final|Hidden Open|Throwaway Test|Secret Venue|secret-config|Secret Entrant)'), false,
  'it names no event, venue, config or entrant');
select is(
  (select public.admin_org_detail('00000000-0000-0000-0000-0000000c00a0')::text ~ '(Private Person|6731234567)'), false,
  'and no person or phone number');
select is(
  (select public.admin_org_detail('00000000-0000-0000-0000-0000000c00c0') ->> 'last_event_date'), '2026-06-15',
  'the detail''s last event date is also taken in UTC (the 15th, though it is the 16th in the session''s Auckland time zone)');
select is(
  (select public.admin_org_detail('00000000-0000-0000-0000-0000000c00e0')),
  jsonb_build_object('org', jsonb_build_object('id', '00000000-0000-0000-0000-0000000c00e0'::uuid, 'name', 'T048 Empty Org', 'slug', 't048-empty',
                                               'created_at', '2025-12-01 09:00:00+00'::timestamptz),
                     'event_count', 0, 'last_event_date', null, 'members', '[]'::jsonb),
  'an org with no members and no events gives zero, null and an empty member list (not an error)');
reset role;
select is(t048.run_as('admin_ok', $$select public.admin_org_detail('00000000-0000-0000-0000-00000000dead')$$), '22023|org_not_found',
  'for the admin, an unknown org id is org_not_found');
select is(t048.run_as('admin_ok', $$select public.admin_org_detail(null)$$), '22023|org_not_found', 'and so is a null one');
select is(t048.run_as('admin_ok', $$select * from public.admin_find_user('t048-dup@test.seduh-next')$$), '22023|email_ambiguous',
  'two live accounts differing only by letter case are email_ambiguous, never a silent pick');
set local role authenticated;
select t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2', 10);

-- ---- admin_find_user ----
select results_eq(
  $$ select user_id, email, banned, deleted, org_count, must_change_password, needs_attestation
       from public.admin_find_user('t048-pw-user@test.seduh-next') $$,
  $$ values ('00000000-0000-0000-0000-0000000c0007'::uuid, 't048-pw-user@test.seduh-next', false, false, 2, true, true) $$,
  'an account in two orgs with a one-time-password flag: both flags, org_count 2, needs attestation');
select is(
  (select user_id from public.admin_find_user('   T048-PW-User@Test.Seduh-Next  ')),
  '00000000-0000-0000-0000-0000000c0007'::uuid, 'the match ignores case and surrounding spaces');
select is(
  (select user_id from public.admin_find_user(E'\t t048-carol@test.seduh-next\r\n')),
  '00000000-0000-0000-0000-0000000c0003'::uuid, 'and surrounding tabs and line breaks (a pasted address)');
select is(
  (select user_id from public.admin_find_user('t048-mixed@test.seduh-next')),
  '00000000-0000-0000-0000-0000000c0012'::uuid, 'an email stored with capitals is found by a lower-case search');
select results_eq(
  $$ select user_id, deleted from public.admin_find_user('t048-ghost@test.seduh-next') $$,
  $$ values ('00000000-0000-0000-0000-0000000c0013'::uuid, false) $$,
  'a live account and a soft-deleted one sharing an email are NOT ambiguous: the live one is returned');
select is(
  (select count(*)::int from public.admin_find_user('t048-pw-user')), 0, 'a prefix matches nothing (it is a lookup, never a search)');
select is(
  (select count(*)::int from public.admin_find_user('t048-%') ) + (select count(*)::int from public.admin_find_user('%'))
    + (select count(*)::int from public.admin_find_user('t048-pw-user@test.seduh-nex_')), 0, 'LIKE wildcards are literal characters, not patterns');
select is(
  (select count(*)::int from public.admin_find_user(null)) + (select count(*)::int from public.admin_find_user(''))
    + (select count(*)::int from public.admin_find_user('   ')) + (select count(*)::int from public.admin_find_user(E'\t\n')),
  0, 'null, empty and blank return nothing (even though an account with an empty email exists)');
select results_eq(
  $$ select org_count, must_change_password, needs_attestation, banned, deleted from public.admin_find_user('t048-carol@test.seduh-next') $$,
  $$ values (0, false, false, false, false) $$, 'an account in no org, never removed: nothing flagged, no attestation needed');
select results_eq(
  $$ select org_count, needs_attestation from public.admin_find_user('t048-removed@test.seduh-next') $$,
  $$ values (0, true) $$, 'an account removed from a team holds no membership but still needs attestation (its one-time password is known)');
select is((select banned from public.admin_find_user('t048-banned@test.seduh-next')), true, 'a banned account is flagged banned');
select is((select banned from public.admin_find_user('t048-expired-ban@test.seduh-next')), false, 'an EXPIRED ban is not banned');
select is((select deleted from public.admin_find_user('t048-deleted@test.seduh-next')), true, 'a soft-deleted account is flagged deleted');

-- ---- admin_list_audit (the fixture rows are the five newest; ids come from t048.aid) ----
select results_eq(
  $$ select action from public.admin_list_audit(5) $$,
  $$ values ('org.create'), ('account.create'), ('member.role_set'), ('member.add'), ('org.create') $$,
  'the log comes newest id first');
select results_eq(
  $$ select id from public.admin_list_audit(2) $$,
  $$ select id from t048.aid where n in (5, 4) order by n desc $$,
  'p_limit limits');
select is((select count(*)::int from public.admin_list_audit(0)), 1, 'a limit of 0 is clamped up to 1');
select is((select count(*)::int from public.admin_list_audit(-5)), 1, 'a negative limit is clamped up to 1');
select is((select count(*)::int from public.admin_list_audit(null)), (select least(50, total) from t048.base),
  'a null limit means the default (50) or all rows if fewer');
select results_eq(
  $$ select id from public.admin_list_audit(3, (select id from t048.aid where n = 4)) $$,
  $$ select id from t048.aid where n in (3, 2, 1) order by n desc $$,
  'p_before pages: only ids below the one given, newest first');
select is(
  (select count(*)::int from public.admin_list_audit(200, (select id from t048.aid where n = 1)) where id in (select id from t048.aid)), 0,
  'paging past the oldest fixture row returns none of the fixture rows');
select results_eq(
  $$ select id from public.admin_list_audit(50, null, '00000000-0000-0000-0000-0000000c00a0') $$,
  $$ select id from t048.aid where n in (2, 1) order by n desc $$,
  'p_org_id keeps only that org''s rows');
select is(
  (select count(*)::int from public.admin_list_audit(50, null, '00000000-0000-0000-0000-00000000dead')), 0, 'an org with no rows gives nothing');
select results_eq(
  $$ select id from public.admin_list_audit(50, (select id from t048.aid where n = 2), '00000000-0000-0000-0000-0000000c00a0') $$,
  $$ select id from t048.aid where n = 1 $$, 'p_before and p_org_id combine');
select results_eq(
  $$ select id, at, actor_id, actor_email, action, target_org_id, target_org_slug, target_user_id, target_user_email, detail
       from public.admin_list_audit(50, null, '00000000-0000-0000-0000-0000000c00a0') $$,
  $$ select a.id, '2026-07-01 09:00:00+00'::timestamptz, '00000000-0000-0000-0000-0000000c0001'::uuid, 't048-admin@test.seduh-next', 'member.add',
            '00000000-0000-0000-0000-0000000c00a0'::uuid, 't048-alpha', '00000000-0000-0000-0000-0000000c0007'::uuid, 't048-pw-user@test.seduh-next',
            '{"role":"organiser","attested":true}'::jsonb
       from t048.aid a where a.n = 2
     union all
     select a.id, '2026-07-01 08:00:00+00'::timestamptz, '00000000-0000-0000-0000-0000000c0001'::uuid, 't048-admin@test.seduh-next', 'org.create',
            '00000000-0000-0000-0000-0000000c00a0'::uuid, 't048-alpha', '00000000-0000-0000-0000-0000000c0002'::uuid, 't048-organiser@test.seduh-next',
            '{"slug":"t048-alpha","name":"T048 Alpha Coffee"}'::jsonb
       from t048.aid a where a.n = 1 $$,
  'every column of an audit row is right: ids, time, actor and target ids, emails and slug resolved at read time, detail passed through');
select results_eq(
  $$ select actor_email, target_org_slug, target_user_email from public.admin_list_audit(1) $$,
  $$ values ('t048-admin@test.seduh-next', null::text, null::text) $$,
  'an org that no longer exists resolves to a null slug (the id stays)');
select results_eq(
  $$ select actor_id, actor_email, target_org_id, target_org_slug, target_user_id, target_user_email from public.admin_list_audit(1, (select id from t048.aid where n = 5)) $$,
  $$ values ('00000000-0000-0000-0000-0000000c0aaa'::uuid, null::text, null::uuid, null::text, '00000000-0000-0000-0000-0000000c0bbb'::uuid, null::text) $$,
  'a deleted actor and a deleted target user resolve to null emails (the ids stay)');

-- the upper clamp: more than 200 rows
reset role;
insert into app.admin_audit_log (actor_id, action, target_org_id)
  select '00000000-0000-0000-0000-0000000c0001', 'member.add', '00000000-0000-0000-0000-0000000c00a0' from generate_series(1, 205);
set local role authenticated;
select t048.claims('00000000-0000-0000-0000-0000000c0001', 'aal2', 10);
select is((select count(*)::int from public.admin_list_audit(100000)), 200, 'a huge limit is clamped down to 200');
select is((select count(*)::int from public.admin_list_audit()), 50, 'and the default is 50');
select is((select count(*)::int from public.admin_list_audit(null)), 50, 'and an explicit null limit means the same default of 50');
select is((select count(*)::int from public.admin_list_audit(100000, null, '00000000-0000-0000-0000-0000000c00a0')), 200,
  'the clamp holds with an org filter too (and that branch is the one that uses the per-org index)');
reset role;

select * from finish();
rollback;
