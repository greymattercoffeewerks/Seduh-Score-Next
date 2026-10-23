-- T-ADM.B5: the platform-tables contract (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A10; CONVENTIONS.md
-- "Platform tables and admin functions").
-- The admin console's tables are NOT tenant tables: they are not scoped to one organisation, so the tenant-table guards
-- (033, 040, 042) deliberately do not apply to them, and they have no exemptions in those guards. What keeps them safe is
-- the `app` schema (not exposed by the API) PLUS the rules below. This file pins those rules for EVERY relation in `app`
-- and for the complete set of functions that touch the platform tables, so the next platform table or admin function
-- cannot forget one:
--   * both known platform tables exist in app; every table (and foreign table) in `app` has row-level security on, no
--     policy, an ACL that names only its owner (table, column and sequence level, PUBLIC included), no privilege for
--     anon, authenticated or service_role at table or column level, an owner that is the schema's own owner and not an API role, and no default
--     privilege is configured for the schema (it would hand a FUTURE table to the API roles);
--   * nothing named platform_* or admin_* (any case, any relation kind) exists in `public`;
--   * the functions outside `app` that are named like admin/platform work OR whose body touches the platform tables are
--     EXACTLY the list below (adding one means adding it here, on purpose), each SECURITY DEFINER with search_path
--     pinned to the empty string, executable by authenticated (the one service-role-only writer excepted) and not by anon;
--   * the `app` functions behind them (admin, platform, attestation) are executable by no API role.
-- Known limits (stated, not hidden): an UNGATED function with an innocuous name that reads tenant tables is outside this
-- file (a pinned list of every public function would be needed; the uuid-taking ones are already pinned by 041, the
-- rest are caught in review); a new `app` helper with an innocuous name is likewise reviewed, not pinned, because about
-- forty app functions (RLS helpers, trigger functions) are legitimately executable today; roles other than anon,
-- authenticated and service_role (authenticator, dashboard_user, supabase_auth_admin) are not checked.
-- If you add an `app` table that is meant to be readable through the API, this file fails on purpose: that is a new
-- decision, not a new exemption.
begin;
select plan(16);

-- the guard sees the two tables it is about (a guard over any two tables, or none, would pass vacuously)
select ok(
  to_regclass('app.platform_admins') is not null and to_regclass('app.admin_audit_log') is not null,
  'app.platform_admins and app.admin_audit_log both exist');

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'f') and not c.relrowsecurity),
  'none', 'every table (and foreign table) in app has row-level security on');

select is(
  (select count(*)::int from pg_policies where schemaname = 'app'),
  0, 'no table in app has a policy (nothing is readable through the API, by anyone)');

select is(
  (select coalesce(string_agg(c.relname || '/' || a.grantee::regrole::text, ', ' order by c.relname), 'none')
     from pg_class c
    cross join lateral aclexplode(c.relacl) a
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'S', 'v', 'm', 'f')
      and a.grantee <> c.relowner),
  'none', 'no relation in app has an ACL entry for anyone but its owner (a NULL ACL means owner-only too)');

select is(
  (select count(*)::int
     from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'app'::regnamespace and a.attnum > 0 and not a.attisdropped and a.attacl is not null),
  0, 'and no COLUMN in app carries its own ACL (a column grant, to PUBLIC or anyone, would live there)');

select is(
  (select coalesce(string_agg(c.relname || '/' || r, ', ' order by c.relname, r), 'none')
     from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(r, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'the API roles hold no table privilege on any relation in app (PUBLIC grants count: has_*_privilege sees them)');

select is(
  (select coalesce(string_agg(c.relname || '.' || a.attname || '/' || r, ', ' order by c.relname, a.attname, r), 'none')
     from pg_attribute a join pg_class c on c.oid = a.attrelid, unnest(array['anon', 'authenticated', 'service_role']) r
    where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(r, c.oid, a.attnum, 'select,insert,update,references')),
  'none', 'nor any column privilege on any column (this sees a column grant to PUBLIC, which information_schema attributes to nobody)');

select is(
  (select coalesce(string_agg(c.relname || '/' || pg_get_userbyid(c.relowner), ', ' order by c.relname), 'none')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relkind in ('r', 'p', 'S', 'v', 'm', 'f')
      and (c.relowner <> n.nspowner
           or pg_get_userbyid(c.relowner) in ('anon', 'authenticated', 'service_role', 'authenticator'))),
  'none', 'every relation in app is owned by the schema''s own owner, and that owner is not an API role (an owner can grant itself anything)');

select is(
  (select count(*)::int from pg_default_acl where defaclnamespace = 'app'::regnamespace),
  0, 'no default privilege is configured for schema app (it would hand every FUTURE table to the API roles, invisibly until one is created)');

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and lower(c.relname) ~ '^(platform|admin)_'),
  'none', 'nothing named platform_* or admin_* (any case, any relation kind) exists in public: platform tables live in app');

select is(
  (select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C")
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'app') and p.prokind in ('f', 'p')
      and (lower(p.proname) ~ '(admin|platform)'
           or p.prosrc ~* '(require_platform_admin|is_platform_admin|admin_audit|platform_admins)')),
  'admin_add_member(uuid,uuid,text,boolean), admin_can_provision(), admin_create_org(text,text,uuid,boolean), admin_event_resnapshot(uuid,text), admin_find_user(text), '
  || 'admin_gating_preview(text), admin_grant_create(uuid,text,uuid,integer,timestamp with time zone,text,text), '
  || 'admin_grant_extend(uuid,timestamp with time zone,text), admin_grant_revoke(uuid,text), '
  || 'admin_list_audit(integer,bigint,uuid), admin_list_grants(uuid), admin_list_orgs(), admin_org_detail(uuid), admin_record_account_create(uuid,uuid), '
  || 'admin_set_key_enforced(text,boolean,integer), admin_set_role(uuid,uuid,text), '
  || 'am_i_platform_admin(), team_can_manage(uuid,uuid), team_can_restore(uuid,uuid)',
  'the functions outside app that are named like admin/platform work, or whose body touches the platform tables, are exactly this list (the sixteen admin doors, the service-role-only account.create writer, and the two Team gates that must refuse a platform admin); a new one must be added here, with its tests, on purpose');

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'app') and p.prokind in ('f', 'p')
      and (lower(p.proname) ~ '(admin|platform)'
           or p.prosrc ~* '(require_platform_admin|is_platform_admin|admin_audit|platform_admins)')
      and not coalesce(p.prosecdef and p.proconfig @> array['search_path=""'], false)),
  'none', 'every one is SECURITY DEFINER with search_path pinned to the empty string (an unpinned one has a NULL proconfig and is still reported)');

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'app') and p.prokind in ('f', 'p')
      and (lower(p.proname) ~ '(admin|platform)'
           or p.prosrc ~* '(require_platform_admin|is_platform_admin|admin_audit|platform_admins)')
      and has_function_privilege('anon', p.oid, 'execute')),
  'none', 'none is executable by anon');

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'app') and p.prokind in ('f', 'p')
      and (lower(p.proname) ~ '(admin|platform)'
           or p.prosrc ~* '(require_platform_admin|is_platform_admin|admin_audit|platform_admins)')
      and has_function_privilege('service_role', p.oid, 'execute')),
  'admin_record_account_create(uuid,uuid)',
  'the service role may execute exactly one of them: the account.create audit writer the Edge Function calls');

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'app') and p.prokind in ('f', 'p')
      and (lower(p.proname) ~ '(admin|platform)'
           or p.prosrc ~* '(require_platform_admin|is_platform_admin|admin_audit|platform_admins)')
      and not has_function_privilege('authenticated', p.oid, 'execute')),
  'admin_record_account_create(uuid,uuid)',
  'and every one but that service-role-only writer is executable by a signed-in caller (each then decides for itself)');

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text collate "C", r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'app'::regnamespace and lower(p.proname) ~ '(admin|platform|attestation)'
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the app functions behind the console (admin, platform, attestation; any case) are executable by no API role');

select * from finish();
rollback;
