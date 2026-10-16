-- Seduh Score Next · T-ADM.B1: platform-admin identity (the admin console's authorisation layer)
--
-- Why: provisioning an org is hand-written service-role SQL today. The admin console (spec:
-- Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, decisions D-A1, D-A5, D-A10, D-A14) needs a way to say
-- "this signed-in person is a platform admin, and this session proves a second factor", decided in
-- the database, never in the page. This migration adds only the identity and the checks; nothing
-- here can change an org, a member or a login (those are later batches), apart from the one
-- protective change to the Team screen's two gates described last.
--
-- What this adds:
--   * app.platform_admins: who is a platform admin. Lives in the `app` schema, NOT `public`: the API
--     does not expose `app`, and the tenant-table guards (033, 040, 042) cover `public` only, so this
--     platform table needs no exemption (D-A10). Non-exposure is not the control, though (the cloud
--     exposed-schema setting is a dashboard value, and anon/authenticated hold USAGE on `app`): RLS is
--     on with NO policies and every API role's privileges are revoked, which is. Rows are inserted
--     only by SQL, by the operator, as postgres; this migration seeds nobody (no user id belongs in a
--     migration). There is no console or API path that makes an admin (D-A1). Same shape as
--     team_removed_members, with the stricter revoke (that table leaves service_role alone).
--   * app.is_platform_admin(): is auth.uid() in the table AND is that login still active (not
--     deleted, not banned), so banning a stolen admin account takes effect on the next call instead
--     of when its access token expires. No second-factor check; for the UI's "am I an admin"
--     question only.
--   * app.require_platform_admin(): called as the FIRST statement of every admin function. Refuses
--     (SQLSTATE 42501) with hint `admin_required` unless the caller is an admin, then with hint
--     `admin_mfa_required` unless the session is aal2 AND a TOTP verification is recent (D-A5, D-A14).
--     It fails closed: a missing JWT, a missing `aal` key, a missing or malformed `amr` all refuse
--     (an `if x <> 'aal2'` on a NULL would not).
--   * public.am_i_platform_admin(): the one door a password-only (aal1) admin session may use. Returns
--     { is_admin, aal } for the caller and nothing else.
--   * public.admin_can_provision(): true or a refusal; the Edge Function asks it with the caller's own
--     JWT so the second factor is enforced by the same code path as every other admin call.
--   * team_can_manage / team_can_restore: a platform admin is never the Team screen's to manage. These
--     two functions gate the team-accounts Edge Function's reset and restore actions, which set a
--     person's password with the service role. Without this, the owner of any organisation could
--     reset the password of a platform admin who is a non-owner member of it (security review). Their
--     bodies are otherwise unchanged; grants are kept by CREATE OR REPLACE.
--
-- D-A14 (fresh second factor): a refresh token keeps `aal2` for the whole session, far past the 3600 s
-- access-token life, and this project's plan has no session time-box. So the TOTP verification itself
-- must be recent: the access token's `amr` array needs an entry { method: 'totp', timestamp: <unix
-- integer> } no older than 60 minutes (admin_totp_window below) and not in the future beyond a few
-- minutes of clock skew. VERIFIED 2026-10-15 against real local GoTrue tokens: after challengeAndVerify
-- the access token is aal2 with amr [{method:'totp',timestamp:N},{method:'password',timestamp:M}]
-- (integers), and a refresh keeps the original totp timestamp, so an admin is asked for a code about
-- hourly. Session `aal` and `amr` are top-level claims signed by GoTrue; a user cannot forge them
-- through user_metadata or app_metadata. A custom access-token hook (none exists) must never copy
-- metadata into `aal` or `amr`.
--
-- The four admin functions are SECURITY DEFINER with search_path pinned. The two `app` functions are
-- not executable by anon, authenticated or service_role (only the definer wrappers and the owner
-- reach them); the two `public` ones are executable by authenticated only. `auth.uid()` and
-- `auth.jwt()` read the request's own GUCs, so a definer does not change who they report.
--
-- Note for the rollback below: it DELETES the platform_admins rows (after a rollback and re-apply
-- the operator must insert their admin row again), and the Team gates go back to their old bodies.
--
-- rollback:
--   create or replace function public.team_can_manage(p_org_id uuid, p_user_id uuid default null)
--   returns boolean language sql stable security definer set search_path = '' as $f$
--     select app.is_org_owner(p_org_id)
--       and (
--         p_user_id is null
--         or (
--           exists (
--             select 1 from public.org_members m
--             where m.org_id = p_org_id and m.user_id = p_user_id and m.role <> 'owner'
--           )
--           and not exists (
--             select 1 from public.org_members x
--             where x.user_id = p_user_id and x.org_id <> p_org_id
--           )
--         )
--       );
--   $f$;
--   create or replace function public.team_can_restore(p_org_id uuid, p_user_id uuid)
--   returns boolean language sql stable security definer set search_path = '' as $f$
--     select app.is_org_owner(p_org_id)
--       and exists (
--         select 1 from public.team_removed_members r
--         where r.org_id = p_org_id and r.user_id = p_user_id
--           and not exists (
--             select 1 from public.team_removed_members r2
--             where r2.user_id = r.user_id and r2.org_id <> r.org_id and r2.removed_at > r.removed_at
--           )
--       )
--       and not exists (
--         select 1 from public.org_members m where m.user_id = p_user_id
--       );
--   $f$;
--   drop function if exists public.admin_can_provision();
--   drop function if exists public.am_i_platform_admin();
--   drop function if exists app.require_platform_admin();
--   drop function if exists app.is_platform_admin();
--   drop table if exists app.platform_admins;

create table app.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  note        text
);

-- RLS on and no policy at all: the "enabled, no policies" advisor note is the intent. The owner role
-- bypasses RLS, which is how the definer functions read it.
alter table app.platform_admins enable row level security;
revoke all on app.platform_admins from public, anon, authenticated, service_role;

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app.platform_admins a
    join auth.users u on u.id = a.user_id
    where a.user_id = auth.uid()
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

create or replace function app.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- D-A14: how recent the TOTP verification must be, and how far into the future a timestamp may
  -- claim to be (clock skew). Constants here, not settings, so they cannot change without a
  -- migration (and so a test pins them).
  admin_totp_window constant interval := interval '60 minutes';
  admin_totp_skew constant interval := interval '5 minutes';
  v_jwt jsonb := auth.jwt();
  v_amr jsonb;
  v_fresh boolean;
begin
  if not app.is_platform_admin() then
    raise exception 'platform admin required'
      using errcode = '42501', hint = 'admin_required';
  end if;

  -- coalesce, never a bare <>: a missing JWT or a missing `aal` is NULL, and a NULL condition does
  -- not raise.
  if coalesce(v_jwt ->> 'aal', '') <> 'aal2' then
    raise exception 'a second factor is required'
      using errcode = '42501', hint = 'admin_mfa_required';
  end if;

  -- (A non-object entry needs no guard of its own: ->> and -> on a scalar give NULL, so it cannot match
  -- method = 'totp' or produce a timestamp.)
  v_amr := v_jwt -> 'amr';
  select coalesce(bool_or(
           e.entry ->> 'method' = 'totp'
           and coalesce(t.ts >= now() - admin_totp_window and t.ts <= now() + admin_totp_skew, false)
         ), false)
    into v_fresh
    from jsonb_array_elements(
           case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end
         ) as e(entry)
    cross join lateral (
      -- The timestamp is a JSON integer in a token GoTrue signed, but never trust the shape: anything
      -- that is not a plain integer number (a string, a float, a huge value) yields NULL, which counts
      -- as "not fresh" instead of raising a cast error. The CASE is load-bearing: SQL does not
      -- promise `and` short-circuits, so a bare cast could still run.
      select case
               when jsonb_typeof(e.entry -> 'timestamp') = 'number'
                and (e.entry ->> 'timestamp') ~ '^[0-9]{1,12}$'
               then to_timestamp((e.entry ->> 'timestamp')::bigint)
             end as ts
    ) t;

  if not v_fresh then
    raise exception 'a recent second-factor verification is required'
      using errcode = '42501', hint = 'admin_mfa_required';
  end if;
end;
$$;

create or replace function public.am_i_platform_admin()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_admin', app.is_platform_admin(),
    'aal', auth.jwt() ->> 'aal'
  );
$$;

create or replace function public.admin_can_provision()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return true;
end;
$$;

revoke all on function app.is_platform_admin() from public, anon, authenticated, service_role;
revoke all on function app.require_platform_admin() from public, anon, authenticated, service_role;
revoke all on function public.am_i_platform_admin() from public, anon, authenticated, service_role;
revoke all on function public.admin_can_provision() from public, anon, authenticated, service_role;
grant execute on function public.am_i_platform_admin() to authenticated;
grant execute on function public.admin_can_provision() to authenticated;

-- ============ the Team screen never manages a platform admin ============
-- Bodies are the existing ones (20261007120000 / 20261008120000) plus one condition each. CREATE OR
-- REPLACE keeps the existing grants (execute: authenticated only).

create or replace function public.team_can_manage(p_org_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_owner(p_org_id)
    and (
      p_user_id is null
      or (
        exists (
          select 1 from public.org_members m
          where m.org_id = p_org_id and m.user_id = p_user_id and m.role <> 'owner'
        )
        -- someone who also belongs to another org is not this org's to reset
        and not exists (
          select 1 from public.org_members x
          where x.user_id = p_user_id and x.org_id <> p_org_id
        )
        -- a platform admin's password is never an organisation owner's to reset (T-ADM.B1)
        and not exists (
          select 1 from app.platform_admins pa where pa.user_id = p_user_id
        )
      )
    );
$$;

create or replace function public.team_can_restore(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_org_owner(p_org_id)
    and exists (
      select 1 from public.team_removed_members r
      where r.org_id = p_org_id and r.user_id = p_user_id
        and not exists (
          select 1 from public.team_removed_members r2
          where r2.user_id = r.user_id and r2.org_id <> r.org_id and r2.removed_at > r.removed_at
        )
    )
    and not exists (
      select 1 from public.org_members m where m.user_id = p_user_id
    )
    -- a platform admin's password is never an organisation owner's to reset (T-ADM.B1)
    and not exists (
      select 1 from app.platform_admins pa where pa.user_id = p_user_id
    );
$$;
