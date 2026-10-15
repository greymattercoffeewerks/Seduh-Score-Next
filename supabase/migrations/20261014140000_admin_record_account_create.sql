-- Seduh Score Next · T-ADM.C2 (part 1): the audit writer for `account.create`, service role only
--
-- Why: the console can create a brand-new owner login through the `admin-accounts` Edge Function (spec:
-- Handoffs and Specs/ADMIN-CONSOLE-SPEC.md, D-A3, D-A12, section 4). Only the Auth admin API can create a
-- login, and that needs the service-role key, which lives in the Edge Function and never in a browser. The
-- function reaches the database over PostgREST, which exposes `public` and not `app`, and as the service role
-- there is no signed-in user, so app.admin_audit (whose actor is auth.uid() and which re-checks the caller)
-- cannot be used. This is the one writer that takes the actor as a PARAMETER.
--
--   public.admin_record_account_create(p_actor_id uuid, p_user_id uuid) -> void
--
-- Executable by the SERVICE ROLE ONLY (revoked from public, anon, authenticated). It cannot authenticate its
-- caller, so it trusts the Edge Function to have verified the actor (the function checks the caller's own JWT
-- with auth.getUser and then asks admin_can_provision(), which demands aal2, a TOTP verification in the last
-- hour and a live session, BEFORE it ever creates a login). What it checks itself, in this order:
--   1. the actor is a platform admin whose login is still active (not deleted, not banned): 42501, hint
--      admin_required (a null or unknown actor matches no row, so it is refused too). The same predicate as
--      app.is_platform_admin(); test 051 ties the two together so they cannot drift;
--   2. the actor is not the target: 42501, hint admin_self_target (D-A8's spirit: a console login is never
--      made for the admin who is making it);
--   3. the target account exists and is not deleted: 22023, hint member_user_not_found;
--   4. the target is BRAND NEW: created in the last 5 minutes and never signed in: 22023, hint
--      account_not_new. The Edge Function calls this within seconds of createUser;
--   5. no account.create row exists for that target yet: 23505, hint already_recorded (and a partial unique
--      index makes that true even under a race).
-- It writes one `account.create` row (actor, target user, empty detail: the password is never recorded, and
-- the email is resolved at read time, D-A13), nothing else.
--
-- HONEST LIMIT (security and schema review): this function WIDENS who can write the audit log. Before it, the
-- service role could not touch the log at all (no privilege on schema `app`, none on the table, `app` not
-- exposed over PostgREST). Now anyone holding the service-role key can append an `account.create` row naming
-- any CURRENT, ACTIVE platform admin as the actor and any brand-new, never-used login as the target, once per
-- login. The checks above bound each row to "a false 'admin X created a login for Y' about a login made in the last
-- five minutes", not arbitrary history, but NOT the NUMBER of them: logins are free for a key holder (create one,
-- record it, delete it, repeat) and the target has no foreign key, so the false rows can be unlimited. The log
-- stays append-only for everyone, and the key already allows far worse through the Auth admin API (delete a
-- factor, reset the admin's password). It is a record of the Edge Function's own action, not proof against its
-- key being stolen. The Edge Function MUST write the row, so this is the accepted cost.
--
-- Also: `account.create` is written in a SEPARATE transaction from the createUser call (Auth and the database
-- are different services). The Edge Function deletes the new login when this call fails; a failed delete is
-- reported to the admin (hint account_stranded) and logged (spec section 7, item 9).
--
-- This is the THIRD function that mentions app.admin_audit_log (with app.admin_audit and admin_list_audit);
-- test 047 pins that set, and 041's service-role-only pin list and 050's exact function list name it.
--
-- rollback:
--   drop function if exists public.admin_record_account_create(uuid, uuid);
--   drop index if exists app.admin_audit_log_account_create_once_idx;

-- One account.create row per login, enforced by the database and not only by the check below (two concurrent
-- calls could both pass a check-then-insert). A partial unique index does not touch the append-only triggers.
create unique index admin_audit_log_account_create_once_idx
  on app.admin_audit_log (target_user_id) where action = 'account.create';

create or replace function public.admin_record_account_create(p_actor_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from app.platform_admins a
      join auth.users u on u.id = a.user_id
     where a.user_id = p_actor_id
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'admin_record_account_create: the actor is not an active platform admin'
      using errcode = '42501', hint = 'admin_required';
  end if;

  if p_user_id = p_actor_id then
    raise exception 'admin_record_account_create: the actor cannot be the new account'
      using errcode = '42501', hint = 'admin_self_target';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null) then
    raise exception 'admin_record_account_create: no such account'
      using errcode = '22023', hint = 'member_user_not_found';
  end if;

  if not exists (
    select 1 from auth.users u
     where u.id = p_user_id
       and u.created_at > now() - interval '5 minutes'
       and u.last_sign_in_at is null
  ) then
    raise exception 'admin_record_account_create: that account is not new'
      using errcode = '22023', hint = 'account_not_new';
  end if;

  if exists (
    select 1 from app.admin_audit_log l
     where l.action = 'account.create' and l.target_user_id = p_user_id
  ) then
    raise exception 'admin_record_account_create: that account creation is already recorded'
      using errcode = '23505', hint = 'already_recorded';
  end if;

  begin
    insert into app.admin_audit_log (actor_id, action, target_user_id, detail)
    values (p_actor_id, 'account.create', p_user_id, '{}'::jsonb);
  exception when unique_violation then
    -- lost a race with a concurrent call for the same login: the same answer as the check above
    raise exception 'admin_record_account_create: that account creation is already recorded'
      using errcode = '23505', hint = 'already_recorded';
  end;
end;
$$;

revoke all on function public.admin_record_account_create(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_record_account_create(uuid, uuid) to service_role;
