-- T-GATE.B2: the audited admin functions for grants and the per-key switch (spec: Handoffs and Specs/GATING-SPEC.md, 3.5,
-- D-G11, D-G14, D-G15, D-G25, D-G26): admin_grant_create, admin_grant_extend, admin_grant_revoke, admin_list_grants,
-- admin_gating_preview, admin_set_key_enforced. Proves:
--   * only a platform admin at aal2 with a fresh TOTP gets in (the exact refusal for anon, a signed-in non-admin, aal1, a
--     missing, stale or password-only proof), the gate runs BEFORE the arguments are looked at, and a refused call
--     changes nothing and logs nothing;
--   * admin_grant_create: an organisation grant (from now, open-ended or to a later end); an event grant is EXACTLY five
--     calendar days in Asia/Brunei containing the event date for every offset from -4 to 0 and refuses any other
--     (window_invalid); tier / source / note / organisation / event / date / duplicate refusals each have a stable hint;
--   * admin_grant_extend: the reason is required, an extension is a NEW row linked to the old one, starting where the old
--     one ended (no gap), and a revoked / open-ended / already-extended grant or a not-later end is refused;
--   * admin_grant_revoke: sets revoked_at on that one row, a second revoke does nothing and logs nothing;
--   * admin_list_grants and admin_gating_preview: shapes pinned, the preview matches an independent count;
--   * admin_set_key_enforced: turning ON needs the preview's count (a wrong or missing one is refused and changes nothing),
--     turning OFF is one call, the state it already has is a no-op that logs nothing;
--   * every success writes exactly one audit row with exactly the pinned detail keys, in the same transaction (a forced
--     failure of the audit insert rolls the change back), and nothing a refused call did survives.
-- Callers run as the real roles through t053.run_as; successes are also run that way ('admin_ok').
begin;
select plan(163);

create schema t053;
grant usage on schema t053 to anon, authenticated, service_role;

create function t053.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000530' || lpad(n::text, 4, '0'))::uuid
$$;

create function t053.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

-- "SQLSTATE|hint" of a statement run as one kind of caller, or 'ok'; always restores the role.
create function t053.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t053.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t053.claims(t053.u(2), 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t053.claims(t053.u(1), 'aal1');
    elsif kind = 'admin_no_totp' then perform t053.claims(t053.u(1), 'aal2');
    elsif kind = 'admin_stale_totp' then perform t053.claims(t053.u(1), 'aal2', 7200);
    elsif kind = 'admin_pw_fresh' then
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', t053.u(1), 'session_id', t053.u(1),
        'aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 10)))::text, true);
      perform set_config('request.jwt.claim.sub', t053.u(1)::text, true);
    elsif kind = 'admin_ok' then perform t053.claims(t053.u(1), 'aal2', 10);
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
grant execute on function t053.claims(uuid, text, int), t053.run_as(text, text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
insert into auth.users (id, email) values
  (t053.u(1), 't053-admin@test.seduh-next'),
  (t053.u(2), 't053-nonadmin@test.seduh-next');
insert into app.platform_admins (user_id, note) values (t053.u(1), 't053 admin');
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id in (t053.u(1), t053.u(2));

insert into orgs (id, name, slug) values
  (t053.u(100), 'T053 Org X', 't053-x'), (t053.u(200), 'T053 Org Y', 't053-y'),
  (t053.u(300), 'T053 Org Z', 't053-z'), (t053.u(400), 'T053 Org W', 't053-w');
insert into events (id, org_id, format, name, event_date) values
  (t053.u(101), t053.u(100), 'cup_taster', 'X ev1', date '2026-12-10'),
  (t053.u(102), t053.u(100), 'cup_taster', 'X ev2 (no date)', null),
  (t053.u(103), t053.u(100), 'cup_taster', 'X ev3', date '2026-12-20'),
  (t053.u(104), t053.u(100), 'cup_taster', 'X ev4', date '2026-12-21'),
  (t053.u(105), t053.u(100), 'cup_taster', 'X ev5', date '2026-12-22'),
  (t053.u(201), t053.u(200), 'cup_taster', 'Y ev1', date '2026-12-10'),
  (t053.u(301), t053.u(300), 'cup_taster', 'Z ev1', date '2026-12-10'),
  (t053.u(302), t053.u(300), 'cup_taster', 'Z ev2', date '2026-10-23'),
  (t053.u(401), t053.u(400), 'cup_taster', 'W ev1', date '2026-12-10');
-- Z has nine active entries on one event (over the Community cap of 8); W has nine, one withdrawn (eight active)
insert into event_entries (id, event_id, display_name, withdrawn)
  select ('00000000-0000-0000-0530-' || lpad((3000 + n)::text, 12, '0'))::uuid, t053.u(301), 'Zc ' || n, false from generate_series(1, 9) n;
insert into event_entries (id, event_id, display_name, withdrawn)
  select ('00000000-0000-0000-0530-' || lpad((4000 + n)::text, 12, '0'))::uuid, t053.u(401), 'Wc ' || n, n = 9 from generate_series(1, 9) n;

create table t053.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;
create function t053.audit_n() returns int language sql as
  $$ select count(*)::int from app.admin_audit_log where id > (select mid from t053.base) and actor_id = t053.u(1) $$;
create function t053.last() returns app.admin_audit_log language sql as
  $$ select * from app.admin_audit_log where id > (select mid from t053.base) and actor_id = t053.u(1) order by id desc limit 1 $$;
create function t053.grants_n() returns int language sql as
  $$ select count(*)::int from entitlement_grants where org_id in (t053.u(100), t053.u(200), t053.u(300), t053.u(400)) $$;
create function t053.admin() returns void language sql as $$ select t053.claims(t053.u(1), 'aal2', 10) $$;

-- ============ who may execute what ============
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_grant_create', 'admin_grant_extend', 'admin_grant_revoke', 'admin_set_key_enforced')
      and not coalesce(p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""'], false)),
  'none', 'the four writers are SECURITY DEFINER, VOLATILE, search_path pinned to empty');
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_list_grants', 'admin_gating_preview')
      and not coalesce(p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""'], false)),
  'none', 'the two readers are SECURITY DEFINER, STABLE, search_path pinned to empty');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_grant_create', 'admin_grant_extend', 'admin_grant_revoke', 'admin_set_key_enforced', 'admin_list_grants', 'admin_gating_preview')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and service_role cannot execute any of the six');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_grant_create', 'admin_grant_extend', 'admin_grant_revoke', 'admin_set_key_enforced', 'admin_list_grants', 'admin_gating_preview')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  6, 'a signed-in caller can execute all six (the gate then decides)');
select is(
  (select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'app.gating_would_lose(text)'::regprocedure, 'execute')),
  'none', 'the preview helper in app is executable by no API role');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'entitlement_grants'
      and indexname in ('entitlement_grants_one_window_per_event', 'entitlement_grants_one_extension_per_grant')),
  2, 'the two unique partial indexes that back "one live window per event" and "one live extension per grant" exist');

-- ============ the refusal matrix: every caller kind x every function, and nothing changes ============
select is(
  t053.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_grant_create', $$select public.admin_grant_create(t053.u(100), 'annual')$$),
  ('admin_grant_extend', $$select public.admin_grant_extend(t053.u(1), now() + interval '9 days', 'why')$$),
  ('admin_grant_revoke', $$select public.admin_grant_revoke(t053.u(1))$$),
  ('admin_list_grants', $$select public.admin_list_grants(t053.u(100))$$),
  ('admin_gating_preview', $$select public.admin_gating_preview('btc_format')$$),
  ('admin_set_key_enforced', $$select public.admin_set_key_enforced('btc_format', true, 0)$$)) r(name, stmt)
cross join (values
  ('anon', '42501|'),
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_no_totp', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required'),
  ('admin_pw_fresh', '42501|admin_mfa_required')) c(kind, expected)
order by r.name, c.kind;

-- the gate comes BEFORE the arguments are looked at
select is(
  t053.run_as(c.kind, r.stmt),
  c.expected,
  r.name || ' with garbage arguments as ' || c.kind || ' -> ' || c.expected)
from (values
  ('admin_grant_create', 'select public.admin_grant_create(null, null)'),
  ('admin_grant_extend', 'select public.admin_grant_extend(null, null, null)'),
  ('admin_grant_revoke', 'select public.admin_grant_revoke(null)'),
  ('admin_list_grants', 'select public.admin_list_grants(null)'),
  ('admin_gating_preview', 'select public.admin_gating_preview(null)'),
  ('admin_set_key_enforced', 'select public.admin_set_key_enforced(null, null, null)')) r(name, stmt)
cross join (values
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required')) c(kind, expected)
order by r.name, c.kind;

select is(
  (select (t053.audit_n(), t053.grants_n(), (select count(*) from app.entitlement_keys where enforced))::text),
  '(0,0,0)', 'after all those refused calls: no audit row, no grant, no key enforced');

-- ============ admin_grant_create ============
-- an organisation grant: open-ended annual for X
select t053.admin();
create table t053.made (k text primary key, id uuid);
insert into t053.made select 'x_annual', public.admin_grant_create(t053.u(100), 'annual', null, null, null, 'manual', 'granted at the pitch');
select is(
  (select (g.org_id, g.event_id, g.tier, g.valid_until, g.source, g.granted_by, g.note, g.revoked_at, g.extends_grant_id)::text
     from entitlement_grants g where g.id = (select id from t053.made where k = 'x_annual')),
  format('(%s,,annual,,manual,%s,"granted at the pitch",,)', t053.u(100), t053.u(1)),
  'create (organisation grant): open-ended, manual, granted_by is the admin, no event, not revoked');
select ok((select g.valid_from between now() - interval '1 minute' and now() + interval '1 minute'
             from entitlement_grants g where g.id = (select id from t053.made where k = 'x_annual')), 'and it starts now');
select is((select action || '|' || target_org_id from t053.last()), 'grant.create|' || t053.u(100), 'one audit row: grant.create about the organisation');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t053.last()).detail) k),
  'event_id,grant_id,source,tier,valid_from,valid_until', 'with exactly the pinned detail keys');
select is(app.effective_tier(t053.u(100), null), 'annual', 'and the organisation now resolves to annual');
select is(t053.audit_n(), 1, 'exactly one audit row so far');

-- an organisation grant with an end
insert into t053.made select 'w_timed', public.admin_grant_create(t053.u(400), 'per_event', null, null, now() + interval '3 days');
select is((select (valid_until between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour')::text from entitlement_grants where id = (select id from t053.made where k = 'w_timed')),
  'true', 'create: an organisation grant with an end keeps it');

-- event grants: five Brunei days around 2026-12-10, every legal offset
insert into t053.made select 'ev1', public.admin_grant_create(t053.u(100), 'per_event', t053.u(101), -2, null, 'manual', 'T-2 to T+2');
select is(
  (select (g.valid_from = timestamptz '2026-12-08 00:00:00+08' and g.valid_until = timestamptz '2026-12-13 00:00:00+08')::text
     from entitlement_grants g where g.id = (select id from t053.made where k = 'ev1')),
  'true', 'create (event grant, offset -2): 08 Dec 00:00 to 13 Dec 00:00 Brunei time (T-2 to T+2)');
select is(
  (select ((g.valid_until - g.valid_from) = interval '5 days'
           and g.valid_from <= timestamptz '2026-12-10 00:00:00+08' and g.valid_until > timestamptz '2026-12-10 23:59:59+08')::text
     from entitlement_grants g where g.id = (select id from t053.made where k = 'ev1')),
  'true', 'it is five days long and contains the whole of the event date in Brunei time');
select is(
  (select ((g.valid_from at time zone 'UTC'))::text from entitlement_grants g where g.id = (select id from t053.made where k = 'ev1')),
  '2026-12-07 16:00:00', 'stored as an instant (UTC), so the 8 hour offset is applied exactly once');
insert into t053.made select 'ev3', public.admin_grant_create(t053.u(100), 'per_event', t053.u(103), -4);
insert into t053.made select 'ev4', public.admin_grant_create(t053.u(100), 'per_event', t053.u(104), 0);
select is(
  (select string_agg((g.valid_from = x.f and g.valid_until = x.u)::text, ',' order by x.k)
     from (values ('ev3', timestamptz '2026-12-16 00:00:00+08', timestamptz '2026-12-21 00:00:00+08'),
                  ('ev4', timestamptz '2026-12-21 00:00:00+08', timestamptz '2026-12-26 00:00:00+08')) x(k, f, u)
     join t053.made m on m.k = x.k join entitlement_grants g on g.id = m.id),
  'true,true', 'the extremes: offset -4 (T-4 to T) and offset 0 (T to T+4) are both exactly five days containing T');
select is((select detail ->> 'event_id' from t053.last()), t053.u(104)::text, 'the audit row names the event');
select is(t053.audit_n(), 5, 'five audit rows for the five successful creates');
select is(app.effective_tier(t053.u(100), t053.u(101), timestamptz '2026-12-09 12:00:00+08'), 'annual', 'inside the window the event resolves to its tier (here the organisation''s annual is higher)');

-- refusals: stable hints, and nothing written
create function t053.snap_counts() returns text language sql as $$ select (t053.grants_n(), t053.audit_n())::text $$;
create table t053.before_ (v text);
insert into t053.before_ values (t053.snap_counts());
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'community')$$), '22023|tier_invalid', 'create: the default tier is refused (no grant needed)');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'gold')$$), '22023|tier_invalid', 'create: an unknown tier is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), null)$$), '22023|tier_invalid', 'create: a null tier is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'annual', null, null, null, 'payment')$$), '22023|source_invalid', 'create: source payment is reserved and refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'annual', null, null, null, 'free')$$), '22023|source_invalid', 'create: an unknown source is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_create(t053.u(100), 'annual', null, null, null, 'manual', %L)$$, repeat('n', 501))), '22023|note_invalid', 'create: a 501 character note is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(gen_random_uuid(), 'annual')$$), '22023|org_not_found', 'create: an unknown organisation is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(null, 'annual')$$), '22023|org_not_found', 'create: a null organisation is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'annual', null, -2)$$), '22023|window_invalid', 'create: an offset on an organisation grant is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'annual', null, null, now() - interval '1 day')$$), '22023|window_invalid', 'create: an end in the past is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'annual', t053.u(105), -2)$$), '22023|event_grant_tier_invalid', 'create: an event grant must be per_event');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(201), -2)$$), '22023|event_not_found', 'create: another organisation''s event is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', gen_random_uuid(), -2)$$), '22023|event_not_found', 'create: an unknown event is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(102), -2)$$), '22023|event_date_required', 'create: an event with no date is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(105), 1)$$), '22023|window_invalid', 'create: offset +1 (the date would fall before the window) is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(105), -5)$$), '22023|window_invalid', 'create: offset -5 (the date would fall after the window) is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(105), null)$$), '22023|window_invalid', 'create: no offset on an event grant is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(105), -2, now() + interval '9 days')$$), '22023|window_invalid', 'create: an event grant takes no end of its own');
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(101), -2)$$), '22023|grant_exists', 'create: a second live window for the same event is refused');
select is((select t053.snap_counts() = v from t053.before_), true, 'none of those refusals wrote a grant or an audit row');

-- ============ admin_grant_extend ============
select t053.admin();
insert into t053.made select 'ev1_ext', public.admin_grant_extend((select id from t053.made where k = 'ev1'), timestamptz '2026-12-15 00:00:00+08', '  postponed by the venue  ');
select is(
  (select (g.org_id, g.event_id, g.tier, g.valid_from = timestamptz '2026-12-13 00:00:00+08', g.valid_until = timestamptz '2026-12-15 00:00:00+08',
           g.source, g.granted_by, g.note, g.extends_grant_id = (select id from t053.made where k = 'ev1'))::text
     from entitlement_grants g where g.id = (select id from t053.made where k = 'ev1_ext')),
  format('(%s,%s,per_event,t,t,manual,%s,"postponed by the venue",t)', t053.u(100), t053.u(101), t053.u(1)),
  'extend: a NEW row, same organisation, event and tier, starting where the old one ended, linked to it, with the trimmed reason as its note');
select is((select (valid_until = timestamptz '2026-12-13 00:00:00+08' and revoked_at is null)::text from entitlement_grants where id = (select id from t053.made where k = 'ev1')),
  'true', 'and the old row is untouched');
select is((select action || '|' || target_org_id from t053.last()), 'grant.extend|' || t053.u(100), 'one audit row: grant.extend');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t053.last()).detail) k),
  'event_id,from_grant_id,grant_id,new_valid_until,old_valid_until,reason,tier', 'with exactly the pinned detail keys');
select is((select detail ->> 'reason' from t053.last()), 'postponed by the venue', 'the audit row carries the reason');
select is(
  (select (app.effective_tier(t053.u(400), null, now()) , 1)::text), '(per_event,1)', 'sanity: the timed organisation grant of W resolves to per_event now');
-- the window is continuous across the join, with the higher organisation tier removed so the event grant alone decides
select is(app.effective_tier(t053.u(100), t053.u(101), timestamptz '2026-12-13 00:00:00+08'), 'annual', 'X still has its annual organisation grant (so the join is checked on a bare event below)');
insert into t053.made select 'zev', public.admin_grant_create(t053.u(300), 'per_event', t053.u(301), -2);
insert into t053.made select 'zev_ext', public.admin_grant_extend((select id from t053.made where k = 'zev'), timestamptz '2026-12-16 00:00:00+08', 'extra day');
select is(
  (select string_agg(app.effective_tier(t053.u(300), t053.u(301), t.at), ',' order by t.at)
     from (values (timestamptz '2026-12-12 23:59:59+08'), (timestamptz '2026-12-13 00:00:00+08'), (timestamptz '2026-12-15 23:59:59+08'),
                  (timestamptz '2026-12-16 00:00:00+08')) t(at)),
  'per_event,per_event,per_event,community', 'extension: the event stays per_event across the old end with no gap, and drops to community at the new end');

select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-30 00:00:00+08', '   ')$$, (select id from t053.made where k = 'ev3'))), '22023|reason_required', 'extend: a blank reason is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-30 00:00:00+08', null)$$, (select id from t053.made where k = 'ev3'))), '22023|reason_required', 'extend: a null reason is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-30 00:00:00+08', %L)$$, (select id from t053.made where k = 'ev3'), repeat('r', 501))), '22023|reason_too_long', 'extend: a 501 character reason is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_extend(gen_random_uuid(), timestamptz '2026-12-30 00:00:00+08', 'why')$$), '22023|grant_not_found', 'extend: an unknown grant is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-30 00:00:00+08', 'why')$$, (select id from t053.made where k = 'x_annual'))), '22023|grant_open_ended', 'extend: an open-ended grant is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-30 00:00:00+08', 'why')$$, (select id from t053.made where k = 'ev1'))), '22023|already_extended', 'extend: an already-extended grant is refused (extend the latest)');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-21 00:00:00+08', 'why')$$, (select id from t053.made where k = 'ev3'))), '22023|window_invalid', 'extend: a new end equal to the current end is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-20 00:00:00+08', 'why')$$, (select id from t053.made where k = 'ev3'))), '22023|window_invalid', 'extend: an earlier end is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, null, 'why')$$, (select id from t053.made where k = 'ev3'))), '22023|window_invalid', 'extend: a null end is refused');
select t053.admin();
select public.admin_grant_revoke((select id from t053.made where k = 'ev3'), 'cancelled');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2026-12-30 00:00:00+08', 'why')$$, (select id from t053.made where k = 'ev3'))), '22023|grant_revoked', 'extend: a revoked grant is refused');
select is((select count(*)::int from entitlement_grants where extends_grant_id = (select id from t053.made where k = 'ev3')), 0, 'and none of those refusals wrote a row');

-- ============ admin_grant_revoke ============
select is((select action || '|' || target_org_id from t053.last()), 'grant.revoke|' || t053.u(100), 'revoke: one audit row, grant.revoke');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t053.last()).detail) k), 'event_id,grant_id,note,tier', 'with exactly the pinned detail keys');
select is((select detail ->> 'note' from t053.last()), 'cancelled', 'carrying the note');
select ok((select revoked_at between now() - interval '1 minute' and now() + interval '1 minute' from entitlement_grants where id = (select id from t053.made where k = 'ev3')), 'revoke: revoked_at is set');
select is((select (revoked_at is null)::text from entitlement_grants where id = (select id from t053.made where k = 'ev4')), 'true', 'and no other grant is touched');
create table t053.n1 (n int);
insert into t053.n1 values (t053.audit_n());
select public.admin_grant_revoke((select id from t053.made where k = 'ev3'), 'again');
select is(t053.audit_n(), (select n from t053.n1), 'revoking a revoked grant does nothing and logs nothing');
select is(t053.run_as('admin_ok', $$select public.admin_grant_revoke(gen_random_uuid())$$), '22023|grant_not_found', 'revoke: an unknown grant is refused');
select is(t053.run_as('admin_ok', $$select public.admin_grant_revoke(null)$$), '22023|grant_not_found', 'revoke: a null id is refused');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_revoke(%L, %L)$$, (select id from t053.made where k = 'ev4'), repeat('n', 501))), '22023|note_invalid', 'revoke: a 501 character note is refused');
select is(t053.audit_n(), (select n from t053.n1), 'and those refusals logged nothing');
-- a revoked event window frees the event for a new one (the unique index is partial on live roots)
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(100), 'per_event', t053.u(103), -1)$$), 'ok', 'a revoked window does not block a new one for the same event');

-- ============ admin_list_grants ============
select t053.admin();
select is(jsonb_typeof(public.admin_list_grants(t053.u(100))), 'array', 'list: an array');
select is(jsonb_array_length(public.admin_list_grants(t053.u(100))), (select count(*)::int from entitlement_grants where org_id = t053.u(100)), 'with one element per grant of the organisation');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_list_grants(t053.u(100)) -> 0) k),
  'created_at,event_id,extends_grant_id,granted_by,id,note,revoked_at,source,tier,valid_from,valid_until',
  'each element has exactly the pinned keys (no event or participant data)');
select is(public.admin_list_grants(t053.u(100)) -> 0 ->> 'id', (select id::text from entitlement_grants where org_id = t053.u(100) order by created_at desc, id limit 1), 'newest first');
select is(public.admin_list_grants(t053.u(200)), '[]'::jsonb, 'an organisation with no grants: an empty array');
select is(t053.run_as('admin_ok', $$select public.admin_list_grants(gen_random_uuid())$$), '22023|org_not_found', 'list: an unknown organisation is refused');
select is(t053.audit_n(), (select n + 1 from t053.n1), 'reading logs nothing (only the one create after the baseline)');

-- ============ admin_gating_preview and admin_set_key_enforced ============
-- a CURRENT event grant for Z (the ones made above sit in the future relative to the real clock)
set local role postgres;
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (t053.u(300), t053.u(302), 'per_event', now() - interval '1 day', now() + interval '1 day', 'manual');
select t053.admin();
select is(jsonb_typeof(public.admin_gating_preview('btc_format')), 'object', 'preview: an object');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.admin_gating_preview('btc_format')) k),
  'enforced,key,kind,min_tier,organisations,would_lose', 'with exactly the pinned keys');
select is((public.admin_gating_preview('btc_format') ->> 'would_lose')::int,
  (select count(*)::int from orgs o where app.effective_tier(o.id) = 'community'),
  'btc_format: would_lose equals an independent count of organisations that are on community');
select is(
  (select string_agg(e ->> 'name' || ':' || (e ->> 'tier'), ',' order by e ->> 'name')
     from jsonb_array_elements(public.admin_gating_preview('btc_format') -> 'organisations') e where e ->> 'name' like 'T053%'),
  'T053 Org Y:community,T053 Org Z:community',
  'btc_format: Y and Z (no grant on the organisation) would lose it; X (annual) and W (per_event) would not');
select is(
  (select e -> 'detail' ->> 'event_grants' from jsonb_array_elements(public.admin_gating_preview('btc_format') -> 'organisations') e where e ->> 'name' = 'T053 Org Z'),
  '1', 'and Z''s own event grant is reported as a count (not credited)');
select is((public.admin_gating_preview('guess_the_bean_create') ->> 'would_lose')::int, 0, 'a key open to every tier would lose nobody');
select is(
  (select string_agg(e ->> 'name' || ':' || (e -> 'detail' ->> 'over_limit_events') || ':' || (e -> 'detail' ->> 'limit'), ',' order by e ->> 'name')
     from jsonb_array_elements(public.admin_gating_preview('cup_taster_participants') -> 'organisations') e where e ->> 'name' like 'T053%'),
  'T053 Org Z:1:8',
  'cup_taster_participants: only Z (nine active entries, cap 8) is listed; W has eight active plus one withdrawn, X is annual, Y has no event over the cap');
select is(t053.run_as('admin_ok', $$select public.admin_gating_preview('nope')$$), '22023|entitlement_key_unknown', 'preview: an unknown key is refused');

create table t053.n2 (n int);
insert into t053.n2 values (t053.audit_n());
select is(t053.run_as('admin_ok', $$select public.admin_set_key_enforced('btc_format', true, 0)$$), '22023|confirm_mismatch', 'enforce: a wrong count is refused');
select is(t053.run_as('admin_ok', $$select public.admin_set_key_enforced('btc_format', true, null)$$), '22023|confirm_mismatch', 'enforce: a missing count is refused');
select is(t053.run_as('admin_ok', $$select public.admin_set_key_enforced('nope', true, 0)$$), '22023|entitlement_key_unknown', 'enforce: an unknown key is refused');
select is(t053.run_as('admin_ok', $$select public.admin_set_key_enforced('btc_format', null, 0)$$), '22023|enforced_invalid', 'enforce: null on/off is refused');
select is((select enforced from app.entitlement_keys where key = 'btc_format'), false, 'and the key is still not enforced');
select is(t053.audit_n(), (select n from t053.n2), 'and nothing was logged');

select t053.admin();
select public.admin_set_key_enforced('btc_format', true, (public.admin_gating_preview('btc_format') ->> 'would_lose')::int);
select is((select enforced from app.entitlement_keys where key = 'btc_format'), true, 'enforce: the right count flips the key');
select is((select action from t053.last()), 'gating.key_enforced', 'one audit row: gating.key_enforced');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t053.last()).detail) k), 'key,would_lose', 'with exactly the pinned keys');
select is(((t053.last()).detail ->> 'would_lose')::int, (public.admin_gating_preview('btc_format') ->> 'would_lose')::int, 'carrying the count that was confirmed');
select is((select target_org_id from t053.last()), null, 'and no organisation target');
select is(app.has_entitlement(t053.u(300), 'btc_format'), false, 'the flip is real: a community organisation is refused btc_format');
select is(app.has_entitlement(t053.u(100), 'btc_format'), true, 'while the annual one is allowed');
update t053.n2 set n = t053.audit_n();
select public.admin_set_key_enforced('btc_format', true, 12345);
select is(t053.audit_n(), (select n from t053.n2), 'enforcing an enforced key does nothing, whatever the count, and logs nothing');
select public.admin_set_key_enforced('btc_format', false, null);
select is((select enforced from app.entitlement_keys where key = 'btc_format'), false, 'relax: one call, no count needed');
select is((select action from t053.last()), 'gating.key_relaxed', 'one audit row: gating.key_relaxed');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t053.last()).detail) k), 'key', 'with only the key');
update t053.n2 set n = t053.audit_n();
select public.admin_set_key_enforced('btc_format', false, null);
select is(t053.audit_n(), (select n from t053.n2), 'relaxing a relaxed key does nothing and logs nothing');
select is(app.has_entitlement(t053.u(300), 'btc_format'), true, 'and the dark guarantee is back');

-- a cap key: the confirm count is the preview's
select public.admin_set_key_enforced('cup_taster_participants', true, (public.admin_gating_preview('cup_taster_participants') ->> 'would_lose')::int);
select is(app.entitlement_limit(t053.u(300), 'cup_taster_participants'), 8, 'a capped key flips too, and a community organisation then has its limit of 8');
select public.admin_set_key_enforced('cup_taster_participants', false, null);

-- ============ one transaction with the audit row ============
create function t053.boom() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure' using errcode = 'P0001'; end $$;
create trigger t053_boom before insert on app.admin_audit_log for each row execute function t053.boom();
create table t053.n3 as select t053.grants_n() as g;
select is(t053.run_as('admin_ok', $$select public.admin_grant_create(t053.u(200), 'annual')$$), 'P0001|', 'create: a forced failure of the audit insert fails the call');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_revoke(%L)$$, (select id from t053.made where k = 'ev4'))), 'P0001|', 'revoke: likewise');
select is(t053.run_as('admin_ok', format($$select public.admin_grant_extend(%L, timestamptz '2027-01-30 00:00:00+08', 'why')$$, (select id from t053.made where k = 'zev_ext'))), 'P0001|', 'extend: likewise');
select is(t053.run_as('admin_ok', $$select public.admin_set_key_enforced('season_history', true, (select (public.admin_gating_preview('season_history') ->> 'would_lose')::int))$$), 'P0001|', 'enforce: likewise');
drop trigger t053_boom on app.admin_audit_log;
select is(t053.grants_n(), (select g from t053.n3), 'and each rolled back its own change: no grant was added');
select is((select revoked_at is null from entitlement_grants where id = (select id from t053.made where k = 'ev4')), true, 'no grant was revoked');
select is((select enforced from app.entitlement_keys where key = 'season_history'), false, 'no key was flipped');

-- ============ the whole trail ============
select is(
  (select string_agg(a || ':' || k, ' | ' order by a)
     from (select distinct action as a, (select string_agg(x, ',' order by x) from jsonb_object_keys(detail) x) as k
             from app.admin_audit_log where id > (select mid from t053.base) and actor_id = t053.u(1)) q),
  'gating.key_enforced:key,would_lose | gating.key_relaxed:key | grant.create:event_id,grant_id,source,tier,valid_from,valid_until | grant.extend:event_id,from_grant_id,grant_id,new_valid_until,old_valid_until,reason,tier | grant.revoke:event_id,grant_id,note,tier',
  'each action carries exactly its pinned detail keys');
select is((select string_agg(distinct actor_id::text, ',') from app.admin_audit_log where id > (select mid from t053.base)), t053.u(1)::text,
  'and every row since the baseline names the admin as the actor');

select * from finish();
rollback;
