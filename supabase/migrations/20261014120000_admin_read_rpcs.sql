-- Seduh Score Next · T-ADM.B3: the admin console's read RPCs (metadata only)
--
-- Why: the console needs to list organisations, show one, look up a login by email and read the audit
-- trail, without any page ever reading a tenant table (spec: Handoffs and Specs/ADMIN-CONSOLE-SPEC.md,
-- D-A4, D-A5, section 3.3). Every read is an RPC that returns AGGREGATES and identity metadata, gated by
-- app.require_platform_admin() as its FIRST statement (a platform admin at aal2 with a fresh TOTP, else
-- 42501 admin_required / admin_mfa_required). Nothing is evaluated before that gate: the declare blocks
-- hold no initialisers, and test 048 pins that shape for every public.admin_* function. None of them
-- returns a score, an entry, a person, a result or an event name. What they read from tenant tables is:
-- COUNTS and one DATE of events per org, and org MEMBER IDENTITY (user id, email, role, joined: D-A4) from
-- org_members; plus two existence flags from org_members / team_removed_members. Test 048 pins the result
-- column lists, the exact JSON of an org's detail, and the set of relations the four bodies may mention.
--
--   * admin_list_orgs()                            every org: name, slug, created, member and event counts,
--                                                  last event date. Newest org first.
--   * admin_org_detail(p_org_id)                   one org (jsonb): the org, the same two aggregates, and
--                                                  its members (user id, email, role, joined). An unknown
--                                                  or null id is 22023 with hint org_not_found.
--   * admin_find_user(p_email)                     at most ONE row, by EXACT case-insensitive match of the
--                                                  email trimmed of spaces, tabs and line breaks (never a
--                                                  search, never a prefix): the flags the console needs
--                                                  before attaching an account, including
--                                                  needs_attestation (D-A9, from
--                                                  app.account_needs_attestation, the SAME predicate the
--                                                  write RPCs will enforce, so the display and the gate
--                                                  cannot drift). Two live accounts that differ only in
--                                                  letter case (possible only through SSO or hand-made
--                                                  SQL) are 22023 with hint email_ambiguous: the console
--                                                  never silently picks one.
--   * admin_list_audit(p_limit, p_before, p_org_id) the audit log, newest id first, paged by id
--                                                  (id < p_before), optionally for one org; the limit is
--                                                  clamped to 1..200 (default 50). Emails and the org slug
--                                                  are resolved HERE, at read time, never stored (D-A13);
--                                                  they are NULL once the user is deleted from auth.users
--                                                  or the org is gone. A SOFT-deleted login (deleted_at
--                                                  set, row still present) still shows its email.
--
-- Semantics worth knowing: "last event date" is max(coalesce(event_date, created_at in UTC)) over ALL the
-- org's events, so test events, drafts and FUTURE-dated events count (a planned event next year is the
-- "last event date"); member lists carry no banned/deleted flag.
--
-- Console convention: call these with POST (supabase-js .rpc does by default), never GET: they are STABLE,
-- so PostgREST also allows GET, which would put an email into URLs and edge logs.
--
-- app.account_needs_attestation(uuid): true when the account holds ANY org membership or ANY row in
-- team_removed_members (a removed team login keeps its one-time password but holds no membership, and
-- app.team_forget_removed_on_join erases that marker on join). Not executable by any API role: only the
-- definer functions reach it. T-ADM.B4's write RPCs call it for the D-A9 gate.
--
-- All four public functions are SECURITY DEFINER with search_path pinned, STABLE, revoked from public,
-- anon, authenticated and service_role, then granted to authenticated only. admin_org_detail and
-- admin_list_audit take a uuid argument, so guard 041 needs them on its exemption list (each is covered by
-- test 048).
--
-- rollback:
--   drop function if exists public.admin_list_audit(integer, bigint, uuid);
--   drop function if exists public.admin_find_user(text);
--   drop function if exists public.admin_org_detail(uuid);
--   drop function if exists public.admin_list_orgs();
--   drop function if exists app.account_needs_attestation(uuid);

create or replace function app.account_needs_attestation(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.org_members m where m.user_id = p_user_id)
      or exists (select 1 from public.team_removed_members r where r.user_id = p_user_id);
$$;

create or replace function public.admin_list_orgs()
returns table (
  org_id          uuid,
  name            text,
  slug            text,
  created_at      timestamptz,
  member_count    integer,
  event_count     integer,
  last_event_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_platform_admin();
  return query
  select o.id,
         o.name,
         o.slug,
         o.created_at,
         (select count(*)::integer from public.org_members m where m.org_id = o.id),
         (select count(*)::integer from public.events e where e.org_id = o.id),
         (select max(coalesce(e.event_date, (e.created_at at time zone 'utc')::date))
            from public.events e where e.org_id = o.id)
  from public.orgs o
  order by o.created_at desc, o.id;
end;
$$;

create or replace function public.admin_org_detail(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org public.orgs;
begin
  perform app.require_platform_admin();

  select * into v_org from public.orgs o where o.id = p_org_id;
  if not found then
    raise exception 'admin_org_detail: no such organisation'
      using errcode = '22023', hint = 'org_not_found';
  end if;

  return jsonb_build_object(
    'org', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'slug', v_org.slug, 'created_at', v_org.created_at),
    'event_count', (select count(*)::integer from public.events e where e.org_id = v_org.id),
    'last_event_date', (select max(coalesce(e.event_date, (e.created_at at time zone 'utc')::date))
                          from public.events e where e.org_id = v_org.id),
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role, 'joined_at', m.created_at)
               order by m.created_at, u.email)
        from public.org_members m
        join auth.users u on u.id = m.user_id
       where m.org_id = v_org.id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_find_user(p_email text)
returns table (
  user_id              uuid,
  email                text,
  banned               boolean,
  deleted              boolean,
  org_count            integer,
  must_change_password boolean,
  needs_attestation    boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email   text;
  v_matches integer;
begin
  perform app.require_platform_admin();

  -- trimmed of spaces, tabs and line breaks (a pasted address often carries one)
  v_email := lower(btrim(p_email, E' \t\r\n'));

  -- no email, no answer: this is a lookup, never a listing (an account whose email column is the empty
  -- string, which phone-style logins can have, must not be found by a blank search)
  if v_email is null or v_email = '' then
    return;
  end if;

  select count(*)::integer into v_matches
    from auth.users u
   where lower(u.email) = v_email and u.deleted_at is null;
  if v_matches > 1 then
    raise exception 'admin_find_user: more than one live account matches that email'
      using errcode = '22023', hint = 'email_ambiguous';
  end if;

  return query
  select u.id,
         u.email::text,
         coalesce(u.banned_until > now(), false),
         u.deleted_at is not null,
         (select count(*)::integer from public.org_members m where m.user_id = u.id),
         coalesce((u.raw_user_meta_data ->> 'must_change_password') = 'true', false),
         app.account_needs_attestation(u.id)
  from auth.users u
  where lower(u.email) = v_email
  order by (u.deleted_at is not null), u.created_at desc nulls last, u.id
  limit 1;
end;
$$;

create or replace function public.admin_list_audit(
  p_limit  integer default 50,
  p_before bigint default null,
  p_org_id uuid default null
)
returns table (
  id                bigint,
  at                timestamptz,
  actor_id          uuid,
  actor_email       text,
  action            text,
  target_org_id     uuid,
  target_org_slug   text,
  target_user_id    uuid,
  target_user_email text,
  detail            jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer;
begin
  perform app.require_platform_admin();
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  -- Two shapes on purpose: with `(p_org_id is null or ...)` plpgsql's cached generic plan cannot use the
  -- per-org index, and a rare org on a large log would scan the whole primary key backwards.
  if p_org_id is null then
    return query
    select l.id,
           l.at,
           l.actor_id,
           au.email::text,
           l.action,
           l.target_org_id,
           o.slug,
           l.target_user_id,
           tu.email::text,
           l.detail
    from app.admin_audit_log l
    left join auth.users au on au.id = l.actor_id
    left join public.orgs o on o.id = l.target_org_id
    left join auth.users tu on tu.id = l.target_user_id
    where (p_before is null or l.id < p_before)
    order by l.id desc
    limit v_limit;
  else
    return query
    select l.id,
           l.at,
           l.actor_id,
           au.email::text,
           l.action,
           l.target_org_id,
           o.slug,
           l.target_user_id,
           tu.email::text,
           l.detail
    from app.admin_audit_log l
    left join auth.users au on au.id = l.actor_id
    left join public.orgs o on o.id = l.target_org_id
    left join auth.users tu on tu.id = l.target_user_id
    where l.target_org_id = p_org_id
      and (p_before is null or l.id < p_before)
    order by l.id desc
    limit v_limit;
  end if;
end;
$$;

revoke all on function app.account_needs_attestation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_orgs() from public, anon, authenticated, service_role;
revoke all on function public.admin_org_detail(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_find_user(text) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_audit(integer, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_orgs() to authenticated;
grant execute on function public.admin_org_detail(uuid) to authenticated;
grant execute on function public.admin_find_user(text) to authenticated;
grant execute on function public.admin_list_audit(integer, bigint, uuid) to authenticated;
