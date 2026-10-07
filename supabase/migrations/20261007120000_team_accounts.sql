-- Seduh Score Next · team accounts: an owner manages who is on the org's team
-- Handoff: SEDUH-NEXT-HANDOFF.md §4 (permission model — "one organiser, one org, for October";
-- org_members written outside RLS via service_role), §6 (core/).
--
-- Why: live-event finding #2 (2026-10-04). A team member needed to sign in on an iPad and the only
-- way was the owner's own login. Sharing one login also loses who-did-what (score_change_log
-- .changed_by is auth.uid()). Each timekeeper should have their own account.
--
-- Shape (the account itself is created by the `team-accounts` Edge Function, because only the
-- Auth admin API can create a login; everything about WHO may do it, and the membership row,
-- lives here in SQL where it can be tested):
--   * org_members.role becomes 'owner' | 'organiser'. Existing members stay full organisers (RLS
--     does not distinguish them — every member can write anywhere in the org, as before). 'owner'
--     adds exactly one thing: managing the team. Each org's earliest member is promoted, once.
--   * team_can_manage(org, user?) — is the caller an owner of the org (and, if a user is named, is
--     that user a non-owner member of it). The Edge Function asks this, as the caller, before it
--     touches Auth.
--   * team_list_members(org) — owner only; the members with their email (which lives in
--     auth.users, unreadable to the app) and whether they still have to choose a password.
--   * team_remove_member(org, user) — owner only. Removes the membership; the Auth account stays
--     (person_merges.merged_by and public_results.published_by reference auth.users without
--     cascade, so deleting an account that ever merged or published would fail). With no
--     membership the account reads nothing: every policy asks app.is_org_member live.
--   * team_add_member(org, user) — SERVICE ROLE ONLY. Attaches a freshly created account to the
--     org as an 'organiser'. Deliberately not callable by an owner's browser: with an arbitrary
--     user id it could attach an existing account (e.g. a Guess the Bean community user) and the
--     reset-password path would then hand the owner that account. It also refuses any account
--     older than ten minutes or already in an org, whoever calls it.
--
-- An owner can never be removed or have their password reset through this path, and nobody can
-- remove themselves, so an org always keeps its owner. A reset is also refused for anyone who
-- belongs to a second org: nothing here creates multi-org members, but cloud provisioning is
-- manual, and without this an owner of one org could take over a person who owns another.
--
-- Known limits (accepted for October, written down so they are not rediscovered):
--   * A removed member's login is kept, so the same email cannot be added again (the Edge Function
--     answers 409). Use a different address, or have it done in SQL; a "restore" path would need a marker
--     on the account that only the Edge Function can set.
--   * The one-time password has no server-side expiry or enforcement: must_change_password is
--     plain user_metadata (the person can clear it themselves), and the owner who issued the
--     password can sign in as that person until they change it. Fine for a team of trusted
--     timekeepers; revisit with a TTL if teams grow.
--   * An owner can create a confirmed account for any address they type (no proof of ownership), and
--     the 409 for an address that already has an account tells them it exists.
--   * An org whose only owner's account is deleted has no owner and nobody to promote one.
--
-- (Rolling back leaves the role values on existing rows as they are.)
-- rollback:
--   drop function if exists team_add_member(uuid, uuid);
--   drop function if exists team_remove_member(uuid, uuid);
--   drop function if exists team_list_members(uuid);
--   drop function if exists team_can_manage(uuid, uuid);
--   drop function if exists app.is_org_owner(uuid);
--   alter table org_members drop constraint if exists org_members_role_check;

-- ============ roles ============

-- Nothing is known to hold any other value (the column was free text with one default), but the
-- constraint below would refuse the whole migration if something did: tidy such rows up first.
update org_members set role = 'organiser' where role not in ('owner', 'organiser');

-- Promote each org's earliest member to owner, but only where the org has no owner yet — so a
-- re-run (or a fresh database that already has one) changes nothing.
update org_members m
set role = 'owner'
where (m.org_id, m.user_id) in (
  select distinct on (o.org_id) o.org_id, o.user_id
  from org_members o
  where not exists (select 1 from org_members x where x.org_id = o.org_id and x.role = 'owner')
  order by o.org_id, o.created_at, o.user_id
);

alter table org_members
  add constraint org_members_role_check check (role in ('owner', 'organiser'));

-- ============ the owner chokepoint ============
-- Same shape as app.is_org_member: SECURITY DEFINER so it can read org_members without recursing
-- through its own policy, search_path pinned. Used only by the functions below, so no one else
-- needs to be able to call it.
create or replace function app.is_org_owner(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;
revoke execute on function app.is_org_owner(uuid) from public, anon, authenticated;

-- ============ may the caller manage the team ============

create or replace function team_can_manage(p_org_id uuid, p_user_id uuid default null)
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
      )
    );
$$;
revoke execute on function team_can_manage(uuid, uuid) from public, anon, service_role;
grant execute on function team_can_manage(uuid, uuid) to authenticated;

-- ============ list ============

create or replace function team_list_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  added_at timestamptz,
  last_sign_in_at timestamptz,
  must_change_password boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_org_owner(p_org_id) then
    raise exception 'team_list_members: only an owner can see the team' using errcode = '42501';
  end if;

  return query
  select m.user_id,
         u.email::text,
         m.role,
         m.created_at,
         u.last_sign_in_at,
         coalesce((u.raw_user_meta_data ->> 'must_change_password') = 'true', false)
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
  order by (m.role = 'owner') desc, m.created_at, u.email;
end;
$$;
revoke execute on function team_list_members(uuid) from public, anon, service_role;
grant execute on function team_list_members(uuid) to authenticated;

-- ============ remove ============

create or replace function team_remove_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  -- Owner check first: a non-owner learns nothing about who is on the team.
  if not app.is_org_owner(p_org_id) then
    raise exception 'team_remove_member: only an owner can remove a team member'
      using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'team_remove_member: you cannot remove yourself';
  end if;

  select m.role into v_role
  from public.org_members m
  where m.org_id = p_org_id and m.user_id = p_user_id
  for update;
  if not found then
    raise exception 'team_remove_member: that person is not on the team';
  end if;
  if v_role = 'owner' then
    raise exception 'team_remove_member: an owner cannot be removed';
  end if;

  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
end;
$$;
revoke execute on function team_remove_member(uuid, uuid) from public, anon, service_role;
grant execute on function team_remove_member(uuid, uuid) to authenticated;

-- ============ add (service role only) ============

create or replace function team_add_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created timestamptz;
begin
  select u.created_at into v_created from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'team_add_member: no such account';
  end if;
  if v_created < now() - interval '10 minutes' then
    raise exception 'team_add_member: only a newly created account can be added';
  end if;
  if exists (select 1 from public.org_members m where m.user_id = p_user_id) then
    raise exception 'team_add_member: that account already belongs to an organisation';
  end if;

  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_user_id, 'organiser');
end;
$$;
revoke execute on function team_add_member(uuid, uuid) from public, anon, authenticated;
grant execute on function team_add_member(uuid, uuid) to service_role;
