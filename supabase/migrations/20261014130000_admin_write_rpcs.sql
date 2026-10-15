-- Seduh Score Next · T-ADM.B4: the admin console's write RPCs (org, member, role), audited
--
-- Why: until now an organisation, and a person's membership of it, were created by hand-written
-- service-role SQL. The console does exactly these three things through wrappers (spec:
-- Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A5, D-A6, D-A8, D-A9, D-A11, section 3.4). Each wrapper
-- calls the EXISTING function unchanged (create_org, org_add_existing_member, org_set_role: still
-- service-role only), so their validation and their stable hints stay the single source of truth, and
-- adds only: the platform-admin gate, the self-target refusal, the D-A9 attestation gate and the audit row.
--
--   * admin_create_org(p_name, p_slug, p_owner_user_id, p_attest_own_password default false) -> uuid
--   * admin_add_member(p_org_id, p_user_id, p_role, p_attest_own_password default false) -> void
--   * admin_set_role(p_org_id, p_user_id, p_role) -> void
--
-- Order inside every wrapper (the first two are the same as every admin function):
--   1. perform app.require_platform_admin()   a platform admin at aal2 with a fresh TOTP, else 42501
--                                             admin_required / admin_mfa_required. Nothing runs before it.
--   2. D-A8: an admin cannot target THEIR OWN user id: 42501, hint admin_self_target. (An accident
--      guard, not a boundary: an admin could still create a login and attach that; SQL is the escape
--      hatch.)
--   3. the existing function runs; every refusal it raises passes through with its own SQLSTATE,
--      message and hint (org_name_invalid, org_slug_invalid, org_slug_reserved, org_slug_taken,
--      org_owner_not_found, org_not_found, member_user_not_found, member_exists, member_role_invalid).
--      Its validation therefore wins over the attestation gate below: re-adding an existing member says
--      member_exists, not "password unset".
--   4. D-A9, evaluated on the account's state BEFORE step 3 changed it (a membership created in step 3
--      would otherwise always trip it): when app.account_needs_attestation(target) was true (the account
--      holds any membership, or any team_removed_members row: its one-time password is known to another
--      org's owner) and p_attest_own_password is not true, raise 22023 hint member_password_unset. The
--      raise aborts the whole call, so the org or membership step 3 made is rolled back. A fresh login
--      (no membership, no marker) needs no attestation.
--   5. the audit row, via app.admin_audit, IN THE SAME TRANSACTION: it succeeds with the change or neither
--      happens. A refused call writes nothing (the raise rolls back any insert), and nothing is logged
--      for a refusal at all (probing shows only in Auth/PostgREST logs: accepted, spec D-A6).
--
-- admin_set_role in particular: the role is validated up front (member_role_invalid); an unknown org is
-- org_not_found and a person who is not a member is member_not_found (the old function's hint-less
-- 22023 / P0002 cases get stable hints here); the ORG row is locked FOR NO KEY UPDATE first and then the
-- member row, and its current role read, so the audit "from" cannot race a concurrent change. That is the
-- order app.protect_last_owner uses (org, then members) and that `delete from orgs` uses: taking the
-- member row first would make two admins demoting the last two owners at once deadlock (40P01) instead of
-- one of them getting last_owner. Setting the role a member already has does
-- NOTHING and logs NOTHING (an unpurgeable log should not fill with no-ops); and the last-owner refusal
-- (trigger app.protect_last_owner, SQLSTATE P0001 with prose in its hint) is re-raised with the same
-- SQLSTATE and message but the stable hint `last_owner` (D-A11). That is the ONLY remapped exception:
-- P0001 alone is plpgsql's default for any `raise exception`, so the match is the SQLSTATE AND the
-- trigger's exact message; everything else (including 40001, 40P01, 23001 and any other P0001) is a bare
-- re-raise, untouched. The audit insert sits outside the exception block, so it can never be remapped.
--
-- app.admin_audit_detail_ok (T-ADM.B2's deny-list check on an audit row's `detail`) is REPLACED here, in
-- the same forward migration, by a version that walks the JSON and tests only KEY NAMES. The first
-- version matched a regular expression against the whole text, so an organisation name such as
--   Phone Shop": 2
-- (a valid name: create_org only forbids control and bidi characters) looked like a key once jsonb escaped
-- its quote, and admin_create_org failed with an unhinted check violation. The rule is unchanged: no key,
-- at any depth and in any case, may contain pass, token, secret, e-mail, api key, jwt, otp, credential
-- or phone; values are not inspected.
--
-- Audit rows (action, target org, target user, detail; keys are pinned by test 049):
--   org.create       new org, owner      {slug, name, attested}      slug and name as STORED (trimmed, folded)
--   member.add       org, member         {role, attested}
--   member.role_set  org, member         {from, to}
-- `attested` is true only when attestation was REQUIRED and given.
--
-- All three are SECURITY DEFINER, VOLATILE (they write), search_path pinned, revoked from public, anon,
-- authenticated and service_role, then granted to authenticated only. They take uuid arguments, so guard
-- 041 needs them on its exemption list (each covered by test 049). The inner functions stay executable by
-- the service role alone (041 pins that).
--
-- rollback:
--   create or replace function app.admin_audit_detail_ok(p_detail jsonb)
--   returns boolean language sql immutable parallel safe set search_path = '' as $f$
--     select jsonb_typeof(p_detail) = 'object'
--        and p_detail::text !~* '"[^"]*(pass|token|secret|e-?mail|api_?key|jwt|otp|credential|phone)[^"]*"\s*:';
--   $f$;
--   drop function if exists public.admin_set_role(uuid, uuid, text);
--   drop function if exists public.admin_add_member(uuid, uuid, text, boolean);
--   drop function if exists public.admin_create_org(text, text, uuid, boolean);

create or replace function app.admin_audit_detail_ok(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  with recursive walk(v) as (
    select p_detail
    union all
    select c.value
      from walk w
     cross join lateral (
       select e.value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
       union all
       select a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
     ) c
  )
  select jsonb_typeof(p_detail) = 'object'
     and not exists (
       select 1
         from walk w
        cross join lateral jsonb_object_keys(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k
        where k ~* '(pass|token|secret|e-?mail|api_?key|jwt|otp|credential|phone)'
     );
$$;

create or replace function public.admin_create_org(
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_attest_own_password boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_needs  boolean;
  v_org_id uuid;
  v_slug   text;
  v_name   text;
begin
  perform app.require_platform_admin();

  if p_owner_user_id = auth.uid() then
    raise exception 'admin_create_org: you cannot make yourself an owner here'
      using errcode = '42501', hint = 'admin_self_target';
  end if;

  v_needs := app.account_needs_attestation(p_owner_user_id);

  v_org_id := public.create_org(p_name, p_slug, p_owner_user_id);

  if v_needs and coalesce(p_attest_own_password, false) is not true then
    raise exception 'admin_create_org: that account may have a password someone else knows'
      using errcode = '22023', hint = 'member_password_unset';
  end if;

  select o.slug, o.name into v_slug, v_name from public.orgs o where o.id = v_org_id;
  perform app.admin_audit(
    'org.create', v_org_id, p_owner_user_id,
    jsonb_build_object('slug', v_slug, 'name', v_name, 'attested', v_needs));
  return v_org_id;
end;
$$;

create or replace function public.admin_add_member(
  p_org_id uuid,
  p_user_id uuid,
  p_role text,
  p_attest_own_password boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_needs boolean;
begin
  perform app.require_platform_admin();

  if p_user_id = auth.uid() then
    raise exception 'admin_add_member: you cannot add yourself here'
      using errcode = '42501', hint = 'admin_self_target';
  end if;

  v_needs := app.account_needs_attestation(p_user_id);

  perform public.org_add_existing_member(p_org_id, p_user_id, p_role);

  if v_needs and coalesce(p_attest_own_password, false) is not true then
    raise exception 'admin_add_member: that account may have a password someone else knows'
      using errcode = '22023', hint = 'member_password_unset';
  end if;

  perform app.admin_audit(
    'member.add', p_org_id, p_user_id,
    jsonb_build_object('role', p_role, 'attested', v_needs));
end;
$$;

create or replace function public.admin_set_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_from  text;
  v_state text;
  v_msg   text;
begin
  perform app.require_platform_admin();

  if p_user_id = auth.uid() then
    raise exception 'admin_set_role: you cannot change your own role here'
      using errcode = '42501', hint = 'admin_self_target';
  end if;

  if p_role is null or p_role not in ('owner', 'organiser') then
    raise exception 'admin_set_role: role must be owner or organiser'
      using errcode = '22023', hint = 'member_role_invalid';
  end if;

  -- lock the org first (the order protect_last_owner and `delete from orgs` use), then the member row
  perform 1 from public.orgs o where o.id = p_org_id for no key update;
  if not found then
    raise exception 'admin_set_role: no such organisation'
      using errcode = '22023', hint = 'org_not_found';
  end if;

  -- lock the member row, so the "from" in the audit row is the role the update really replaces
  select m.role into v_from
    from public.org_members m
   where m.org_id = p_org_id and m.user_id = p_user_id
     for no key update;
  if not found then
    raise exception 'admin_set_role: that person is not a member of the organisation'
      using errcode = '22023', hint = 'member_not_found';
  end if;

  -- setting the role a member already has changes nothing and logs nothing
  if v_from = p_role then
    return;
  end if;

  begin
    perform public.org_set_role(p_org_id, p_user_id, p_role);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state = 'P0001' and v_msg = 'org_members: an org must keep at least one owner' then
      raise exception '%', v_msg using errcode = 'P0001', hint = 'last_owner';
    end if;
    raise;
  end;

  perform app.admin_audit(
    'member.role_set', p_org_id, p_user_id,
    jsonb_build_object('from', v_from, 'to', p_role));
end;
$$;

revoke all on function public.admin_create_org(text, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.admin_add_member(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_org(text, text, uuid, boolean) to authenticated;
grant execute on function public.admin_add_member(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.admin_set_role(uuid, uuid, text) to authenticated;
