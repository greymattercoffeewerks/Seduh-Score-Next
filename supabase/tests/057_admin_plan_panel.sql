-- T-GATE.C: what the admin console's Plan panel reads and writes (spec: Handoffs and Specs/GATING-SPEC.md D-G9, D-G10, D-G14):
-- admin_list_keys, admin_plan_orgs, admin_plan_org (reads) and admin_payment_confirm (the one new write).
-- Proves:
--   * the platform-admin gate is first for all four (anon, a non-admin, aal1, a stale or password-only proof), before the
--     arguments are looked at, and a refused call changes and logs nothing;
--   * the reads return exactly their pinned keys (no entry, person, phone or e-mail anywhere), the values are right for a
--     Community, a Per-event-window and an Annual organisation, and an unknown organisation is refused with a hint;
--   * admin_payment_confirm: a grant with source 'payment' (organisation and event scoped, the same Brunei five-day window
--     as admin_grant_create), the amount note required and bounded, every refusal of the shared grant rules passing through
--     with its own hint, ONE audit row with pinned keys, the grant and its audit row in one transaction, and
--     admin_grant_create still refusing source 'payment';
--   * the refactor behind it (app.grant_insert) left admin_grant_create alone (pgTAP 053 is the proof; this file adds the
--     'payment' refusal).
begin;
select plan(83);

create schema t057;
grant usage on schema t057 to anon, authenticated, service_role;

create function t057.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000570' || lpad(n::text, 4, '0'))::uuid
$$;

create function t057.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

create function t057.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t057.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t057.claims(t057.u(2), 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t057.claims(t057.u(1), 'aal1');
    elsif kind = 'admin_no_totp' then perform t057.claims(t057.u(1), 'aal2');
    elsif kind = 'admin_stale_totp' then perform t057.claims(t057.u(1), 'aal2', 7200);
    elsif kind = 'admin_pw_fresh' then
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', t057.u(1), 'session_id', t057.u(1),
        'aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 10)))::text, true);
      perform set_config('request.jwt.claim.sub', t057.u(1)::text, true);
    elsif kind = 'admin_ok' then perform t057.claims(t057.u(1), 'aal2', 10);
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
grant execute on function t057.claims(uuid, text, int), t057.run_as(text, text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
insert into auth.users (id, email) values (t057.u(1), 't057-admin@test.seduh-next'), (t057.u(2), 't057-nonadmin@test.seduh-next');
insert into app.platform_admins (user_id, note) values (t057.u(1), 't057 admin');
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id in (t057.u(1), t057.u(2));
insert into orgs (id, name, slug) values
  (t057.u(100), 'T057 Community', 't057-c'), (t057.u(200), 'T057 Annual', 't057-a');
insert into entitlement_grants (org_id, tier, source) values (t057.u(200), 'annual', 'manual');
insert into events (id, org_id, format, name, event_date) values
  (t057.u(101), t057.u(100), 'cup_taster', 'C Cup', date '2026-12-10'),
  (t057.u(102), t057.u(100), 'btc', 'C Bracket', date '2026-12-20'),
  (t057.u(103), t057.u(100), 'cup_taster', 'C Past', date '2026-10-10'),
  (t057.u(201), t057.u(200), 'cup_taster', 'A Cup', date '2026-12-10');
-- a participant and an entry that must never appear in any answer
insert into event_entries (id, event_id, display_name, cafe, bib) values (t057.u(901), t057.u(101), 'SECRET-CUPPER-NAME', 'SECRET-CAFE', 'SECRET-BIB');
-- C Past: a Per-event window that has ended, a live session
insert into entitlement_grants (id, org_id, event_id, tier, valid_from, valid_until, source) values
  (t057.u(910), t057.u(100), t057.u(103), 'per_event', now() - interval '9 days', now() - interval '4 days', 'manual');
update events set ended_at = now(), ended_via = 'organiser' where id = t057.u(103);
create table t057.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;
create function t057.audit_n() returns int language sql as
  $$ select count(*)::int from app.admin_audit_log where id > (select mid from t057.base) and actor_id = t057.u(1) $$;
create function t057.last() returns app.admin_audit_log language sql as
  $$ select * from app.admin_audit_log where id > (select mid from t057.base) and actor_id = t057.u(1) order by id desc limit 1 $$;
create function t057.admin() returns void language sql as $$ select t057.claims(t057.u(1), 'aal2', 10) $$;

-- ============ who may execute what ============
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none') from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_list_keys', 'admin_plan_orgs', 'admin_plan_org', 'admin_payment_confirm')
      and not coalesce(p.prosecdef and p.proconfig @> array['search_path=""'], false)),
  'none', 'all four are SECURITY DEFINER with search_path pinned to the empty string');
select is(
  (select coalesce(string_agg(p.proname || '/' || r, ', '), 'none') from pg_proc p, unnest(array['anon', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_list_keys', 'admin_plan_orgs', 'admin_plan_org', 'admin_payment_confirm')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and service_role cannot execute any of them');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_list_keys', 'admin_plan_orgs', 'admin_plan_org', 'admin_payment_confirm')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  4, 'a signed-in caller can execute all four (the gate then decides)');
select is(
  (select p.provolatile::text from pg_proc p where p.proname = 'admin_payment_confirm' and p.pronamespace = 'public'::regnamespace),
  'v', 'the write is VOLATILE');
select is(
  (select coalesce(string_agg(p.proname, ', '), 'none') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_list_keys', 'admin_plan_orgs', 'admin_plan_org') and p.provolatile <> 's'),
  'none', 'and the three reads are STABLE');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'grant_insert'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  0, 'the shared inner insert is executable by no API role');

-- ============ the gate, for each function and caller ============
select is(
  t057.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_list_keys', $$select public.admin_list_keys()$$),
  ('admin_plan_orgs', $$select public.admin_plan_orgs()$$),
  ('admin_plan_org', $$select public.admin_plan_org(t057.u(100))$$),
  ('admin_payment_confirm', $$select public.admin_payment_confirm(t057.u(100), 'annual', null, null, null, 'BND 350')$$)) r(name, stmt)
cross join (values
  ('anon', '42501|'),
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required'),
  ('admin_pw_fresh', '42501|admin_mfa_required')) c(kind, expected)
order by r.name, c.kind;
select is(t057.run_as('nonadmin', 'select public.admin_plan_org(null)'), '42501|admin_required', 'the gate comes before the arguments (plan_org)');
select is(t057.run_as('admin_aal1', 'select public.admin_payment_confirm(null, null, null, null, null, null)'), '42501|admin_mfa_required', 'and for the payment confirmation');
select is((select (t057.audit_n(), (select count(*) from entitlement_grants where source = 'payment'))::text), '(0,0)', 'refused calls changed and logged nothing');

-- ============ admin_list_keys ============
select t057.admin();
select is(jsonb_typeof(public.admin_list_keys()), 'array', 'list_keys: an array');
select is(jsonb_array_length(public.admin_list_keys()), (select count(*)::int from app.entitlement_keys), 'one element per key');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_list_keys() -> 0) k), 'caps,enforced,key,kind,min_tier,note,window_bound', 'each element has exactly the pinned keys');
select is((select e -> 'caps' from jsonb_array_elements(public.admin_list_keys()) e where e ->> 'key' = 'cup_taster_participants'),
  '{"annual": null, "community": 8, "per_event": null}'::jsonb, 'a cap key carries its limits by tier (null = unlimited)');
select is((select e -> 'caps' from jsonb_array_elements(public.admin_list_keys()) e where e ->> 'key' = 'btc_format'), 'null'::jsonb, 'a flag key carries no caps');
select is((select bool_and(not (e ->> 'enforced')::boolean) from jsonb_array_elements(public.admin_list_keys()) e), true, 'every key is dark in this database');
select is((select string_agg(e ->> 'key', ',' order by e ->> 'key') from jsonb_array_elements(public.admin_list_keys()) e), (select string_agg(key, ',' order by key) from app.entitlement_keys), 'ordered by key name');

-- ============ admin_plan_orgs ============
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_plan_orgs() -> 0) k), 'event_grants,locked_events,name,org_id,slug,tier', 'plan_orgs: exactly the pinned keys');
select is(
  (select string_agg(e ->> 'name' || ':' || (e ->> 'tier') || ':' || (e ->> 'event_grants') || ':' || (e ->> 'locked_events'), ',' order by e ->> 'name')
     from jsonb_array_elements(public.admin_plan_orgs()) e where e ->> 'name' like 'T057%'),
  'T057 Annual:annual:0:0,T057 Community:community:1:1',
  'the Community organisation has one event grant and one event whose window ended; the Annual one is annual');

-- ============ admin_plan_org ============
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_plan_org(t057.u(100))) k), 'events,grants,keys,org,tier', 'plan_org: exactly the pinned top-level keys');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_plan_org(t057.u(100)) -> 'org') k), 'id,name,slug', 'org: id, name, slug');
select is(public.admin_plan_org(t057.u(100)) ->> 'tier', 'community', 'tier: community');
select is(public.admin_plan_org(t057.u(200)) ->> 'tier', 'annual', 'tier: annual');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_plan_org(t057.u(100)) -> 'events' -> 0) k),
  'ended_at,ended_via,event_date,format,has_window,id,is_test,name,snapshot_tier,window_ended,window_ends_at',
  'events: event metadata only (name, date, format, state): no entry, person, score, phone or e-mail');
select is(position('SECRET' in public.admin_plan_org(t057.u(100))::text), 0, 'no participant text anywhere in the answer (the seeded cupper, cafe and bib)');
select is(position('SECRET' in public.admin_plan_orgs()::text), 0, 'nor in the organisation list');
select is(
  (select e ->> 'name' || ':' || (e ->> 'has_window') || ':' || (e ->> 'window_ended') || ':' || coalesce(e ->> 'ended_via', '-')
     from jsonb_array_elements(public.admin_plan_org(t057.u(100)) -> 'events') e where e ->> 'id' = t057.u(103)::text),
  'C Past:true:true:organiser', 'the event whose window ended says so, and that it was finished by the organiser');
select is(
  (select e ->> 'has_window' || ':' || (e ->> 'window_ended') from jsonb_array_elements(public.admin_plan_org(t057.u(100)) -> 'events') e where e ->> 'id' = t057.u(101)::text),
  'false:false', 'an event with no grant has no window');
select is(jsonb_array_length(public.admin_plan_org(t057.u(100)) -> 'grants'), 1, 'grants: the event grant');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_plan_org(t057.u(100)) -> 'grants' -> 0) k),
  'created_at,event_id,extends_grant_id,granted_by,id,note,revoked_at,source,tier,valid_from,valid_until', 'with the same pinned keys as admin_list_grants');
select is(
  (select string_agg(e ->> 'key' || '=' || (e ->> 'allowed_if_enforced'), ',' order by e ->> 'key')
     from jsonb_array_elements(public.admin_plan_org(t057.u(100)) -> 'keys') e
    where e ->> 'key' in ('btc_format', 'cup_taster_report', 'cup_taster_analytics', 'guess_the_bean_create', 'cup_taster_participants', 'events_open', 'registration_page')),
  'btc_format=false,cup_taster_analytics=false,cup_taster_participants=true,cup_taster_report=false,events_open=true,guess_the_bean_create=true,registration_page=false',
  'Community: would fail btc, report, analytics and the registration page if enforced, pass the free ones and the (limited) caps');
select is(
  (select string_agg(e ->> 'key' || '=' || coalesce(e ->> 'limit', 'null'), ',' order by e ->> 'key')
     from jsonb_array_elements(public.admin_plan_org(t057.u(100)) -> 'keys') e where e ->> 'kind' = 'cap'),
  'cup_taster_participants=8,events_open=1', 'and the caps say their limits (8 participants, 1 open event)');
select is(
  (select bool_and((e ->> 'allowed_if_enforced')::boolean) from jsonb_array_elements(public.admin_plan_org(t057.u(200)) -> 'keys') e),
  true, 'Annual: would pass every key');
select is(
  (select string_agg(e ->> 'key', ',' order by e ->> 'key') from jsonb_array_elements(public.admin_plan_org(t057.u(200)) -> 'keys') e where e ->> 'limit' is not null),
  null, 'and has no limits');
select is(t057.run_as('admin_ok', 'select public.admin_plan_org(gen_random_uuid())'), '22023|org_not_found', 'an unknown organisation is refused with a hint');
select is(t057.run_as('admin_ok', 'select public.admin_plan_org(null)'), '22023|org_not_found', 'and so is null');
select is(t057.audit_n(), 0, 'reading logged nothing');

-- ============ admin_payment_confirm ============
select t057.admin();
create table t057.made (k text primary key, id uuid);
insert into t057.made select 'annual', public.admin_payment_confirm(t057.u(100), 'annual', null, null, null, '  BND 350 received 2026-11-02, transfer ref 4471  ');
select is(
  (select (g.org_id, g.event_id, g.tier, g.valid_until, g.source, g.granted_by, g.note, g.revoked_at)::text
     from entitlement_grants g where g.id = (select id from t057.made where k = 'annual')),
  format('(%s,,annual,,payment,%s,"BND 350 received 2026-11-02, transfer ref 4471",)', t057.u(100), t057.u(1)),
  'an organisation grant: source payment, who granted it, the trimmed amount note, open-ended');
select is((select action || '|' || target_org_id from t057.last()), 'payment.confirm|' || t057.u(100), 'one audit row: payment.confirm about the organisation');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t057.last()).detail) k), 'event_id,grant_id,payment_note,tier,valid_from,valid_until', 'with exactly the pinned detail keys');
select is((select detail ->> 'payment_note' from t057.last()), 'BND 350 received 2026-11-02, transfer ref 4471', 'carrying the amount note');
select is(t057.audit_n(), 1, 'and only that one row (no second grant.create row)');
select is(app.effective_tier(t057.u(100), null), 'annual', 'the organisation now resolves to annual');
insert into t057.made select 'event', public.admin_payment_confirm(t057.u(100), 'per_event', t057.u(102), -2, null, 'BND 18 cash');
select is(
  (select (g.valid_from = timestamptz '2026-12-18 00:00:00+08' and g.valid_until = timestamptz '2026-12-23 00:00:00+08' and g.source = 'payment' and g.event_id = t057.u(102))::text
     from entitlement_grants g where g.id = (select id from t057.made where k = 'event')),
  'true', 'an event grant: the same five Brunei days around the event date as admin_grant_create (offset -2), source payment');
select is(t057.audit_n(), 2, 'a second row for the second confirmation');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'annual', null, null, null, null)$$), '22023|amount_required', 'a missing amount note is refused');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'annual', null, null, null, '   ')$$), '22023|amount_required', 'and a blank one');
select is(t057.run_as('admin_ok', format($$select public.admin_payment_confirm(t057.u(100), 'annual', null, null, null, %L)$$, repeat('n', 201))), '22023|amount_too_long', 'a 201 character note is refused');
select is(t057.run_as('admin_ok', format($$select public.admin_payment_confirm(t057.u(200), 'annual', null, null, null, %L)$$, repeat('n', 200))), 'ok', 'exactly 200 characters is accepted');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'community', null, null, null, 'x')$$), '22023|tier_invalid', 'the default tier is refused, as for admin_grant_create');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'gold', null, null, null, 'x')$$), '22023|tier_invalid', 'an unknown tier too');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(gen_random_uuid(), 'annual', null, null, null, 'x')$$), '22023|org_not_found', 'an unknown organisation too');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'annual', t057.u(101), -2, null, 'x')$$), '22023|event_grant_tier_invalid', 'an event grant must be per_event');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'per_event', t057.u(201), -2, null, 'x')$$), '22023|event_not_found', 'another organisation''s event is refused');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'per_event', t057.u(101), 1, null, 'x')$$), '22023|window_invalid', 'an offset outside -4..0 is refused');
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(100), 'per_event', t057.u(102), -2, null, 'x')$$), '22023|grant_exists', 'a second live window for the same event is refused');
select is(t057.run_as('admin_ok', $$select public.admin_grant_create(t057.u(100), 'annual', null, null, null, 'payment', 'x')$$), '22023|source_invalid',
  'admin_grant_create still refuses source payment: a payment is recorded only through the confirmation');
select is((select count(*)::int from entitlement_grants where source = 'payment'), 3, 'three payment grants exist (the two above and the 200 character one)');
select is(t057.audit_n(), 3, 'and the refusals logged nothing');

-- the grant and its audit row are one transaction
create function t057.boom() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure' using errcode = 'P0001'; end $$;
create trigger t057_boom before insert on app.admin_audit_log for each row execute function t057.boom();
create table t057.n as select count(*)::int as g from entitlement_grants;
select is(t057.run_as('admin_ok', $$select public.admin_payment_confirm(t057.u(200), 'annual', null, null, null, 'x')$$), 'P0001|', 'a forced failure of the audit insert fails the confirmation');
drop trigger t057_boom on app.admin_audit_log;
select is((select count(*)::int from entitlement_grants), (select g from t057.n), 'and the grant it had made is rolled back');

-- the new grants show on the plan
select t057.admin();
select is((select count(*)::int from jsonb_array_elements(public.admin_plan_org(t057.u(100)) -> 'grants') g where g ->> 'source' = 'payment'), 2, 'plan_org lists the payment grants with their source');
select is(public.admin_plan_org(t057.u(100)) ->> 'tier', 'annual', 'and the organisation''s tier is now annual');
select is(
  (select e ->> 'allowed_if_enforced' from jsonb_array_elements(public.admin_plan_org(t057.u(100)) -> 'keys') e where e ->> 'key' = 'btc_format'),
  'true', 'so btc_format would pass if enforced');

select * from finish();
rollback;
