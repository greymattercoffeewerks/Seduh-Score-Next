-- Seduh Score Next · T-ADM.C1 (part 2): an admin call needs a LIVE session, not just a valid token
--
-- Why (security review of Batch 7, finding 2): app.require_platform_admin() judged the token's claims (admin,
-- aal2, a TOTP verification in the last hour) but never asked whether the SESSION behind the token still exists.
-- Verified on the real local stack: after `POST /auth/v1/logout?scope=global` the auth.sessions row is gone, yet
-- the same access token still returned `true` from admin_can_provision and 200 from admin_list_orgs, because
-- PostgREST checks only the signature. The Edge Function was already stricter (auth.getUser checks the session).
-- So spec D-A15's "Sign out everywhere" and section 7 item 1's "a stolen session can be revoked" were only true
-- within the access token's lifetime (jwt_expiry, up to an hour). This closes that: every admin call, read or
-- write, now also requires that the token's `session_id` names a row in auth.sessions that belongs to the caller,
-- has not passed its not_after, and is still at aal2 in the database. Revoking a session (sign out everywhere, the
-- dashboard, banning the user) cuts the admin RPCs off on the NEXT call (admin_session_ended / admin_required); REMOVING
-- THE ADMIN'S FACTOR downgrades their sessions' rows to aal1 (GoTrue does not delete them), which now refuses an old
-- aal2 token with admin_mfa_required: they must verify a factor again.
--
-- New refusal: 42501, hint `admin_session_ended` (checked LAST, after admin_required and admin_mfa_required, so a
-- caller who is not an admin still learns nothing). Fails closed: no `session_id`, one that is not a uuid (guarded
-- before the cast, so it cannot raise a cast error), one that names another user's session, or a deleted session,
-- all refuse. The check reads auth.sessions as the function's owner.
--
-- The rest of the function is unchanged (CREATE OR REPLACE keeps the grants: nobody but the definer wrappers can
-- execute it). Tests 046 to 049 and 051 now build their claims with a session_id and insert the matching
-- auth.sessions row; 046 pins the new rule.
--
-- rollback: (restores the version from 20261014100000)
--   create or replace function app.require_platform_admin()
--   returns void
--   language plpgsql
--   stable
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     -- D-A14: how recent the TOTP verification must be, and how far into the future a timestamp may
--     -- claim to be (clock skew). Constants here, not settings, so they cannot change without a
--     -- migration (and so a test pins them).
--     admin_totp_window constant interval := interval '60 minutes';
--     admin_totp_skew constant interval := interval '5 minutes';
--     v_jwt jsonb := auth.jwt();
--     v_amr jsonb;
--     v_fresh boolean;
--   begin
--     if not app.is_platform_admin() then
--       raise exception 'platform admin required'
--         using errcode = '42501', hint = 'admin_required';
--     end if;
--
--     -- coalesce, never a bare <>: a missing JWT or a missing `aal` is NULL, and a NULL condition does
--     -- not raise.
--     if coalesce(v_jwt ->> 'aal', '') <> 'aal2' then
--       raise exception 'a second factor is required'
--         using errcode = '42501', hint = 'admin_mfa_required';
--     end if;
--
--     -- (A non-object entry needs no guard of its own: ->> and -> on a scalar give NULL, so it cannot match
--     -- method = 'totp' or produce a timestamp.)
--     v_amr := v_jwt -> 'amr';
--     select coalesce(bool_or(
--              e.entry ->> 'method' = 'totp'
--              and coalesce(t.ts >= now() - admin_totp_window and t.ts <= now() + admin_totp_skew, false)
--            ), false)
--       into v_fresh
--       from jsonb_array_elements(
--              case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end
--            ) as e(entry)
--       cross join lateral (
--         -- The timestamp is a JSON integer in a token GoTrue signed, but never trust the shape: anything
--         -- that is not a plain integer number (a string, a float, a huge value) yields NULL, which counts
--         -- as "not fresh" instead of raising a cast error. The CASE is load-bearing: SQL does not
--         -- promise `and` short-circuits, so a bare cast could still run.
--         select case
--                  when jsonb_typeof(e.entry -> 'timestamp') = 'number'
--                   and (e.entry ->> 'timestamp') ~ '^[0-9]{1,12}$'
--                  then to_timestamp((e.entry ->> 'timestamp')::bigint)
--                end as ts
--       ) t;
--
--     if not v_fresh then
--       raise exception 'a recent second-factor verification is required'
--         using errcode = '42501', hint = 'admin_mfa_required';
--     end if;
--   end;
--   $$;

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
  v_sid text;
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

  -- The session must still EXIST. An access token stays valid until it expires (up to jwt_expiry) even after the
  -- session behind it was signed out, revoked or deleted, and PostgREST checks only the signature, so without this
  -- "sign out everywhere" would not cut off an admin RPC for up to an hour. GoTrue puts the session's id in the
  -- token as `session_id`; a refresh keeps it. Fails closed: a missing, malformed or foreign id is refused.
  v_sid := v_jwt ->> 'session_id';
  if v_sid is null or v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'the session has ended'
      using errcode = '42501', hint = 'admin_session_ended';
  end if;
  if not exists (
    select 1 from auth.sessions s
     where s.id = v_sid::uuid and s.user_id = auth.uid()
       and (s.not_after is null or s.not_after > now())
  ) then
    raise exception 'the session has ended'
      using errcode = '42501', hint = 'admin_session_ended';
  end if;
  -- ... and still at aal2 IN THE DATABASE. Verified on the real stack: when a factor is removed (from ANY session of
  -- that user) GoTrue does not delete the other sessions, it DOWNGRADES their rows to aal1, while a token minted
  -- earlier keeps claiming aal2 until it expires. Without this, deleting the admin's authenticator would not cut
  -- off a stolen session's old token for up to an hour. The caller must verify a factor again.
  if not exists (
    select 1 from auth.sessions s where s.id = v_sid::uuid and s.aal = 'aal2'
  ) then
    raise exception 'a second factor is required'
      using errcode = '42501', hint = 'admin_mfa_required';
  end if;
end;
$$;
