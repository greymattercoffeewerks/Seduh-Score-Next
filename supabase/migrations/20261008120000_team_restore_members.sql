-- Seduh Score Next · team accounts, part two: see who was removed, and restore them
-- Handoff: SEDUH-NEXT-HANDOFF.md §4 (permission model — org_members written outside RLS via
-- service_role). Follows 20261007120000_team_accounts.sql, whose "known limits" named this gap.
--
-- Why: the first live use of team accounts (2026-10-08). Removing a member keeps their Auth login
-- (person_merges.merged_by and public_results.published_by reference auth.users without cascade),
-- so adding the same email again always answered 409 "That email already has an account": a member
-- removed by mistake, or a test member with the owner's own address, could never come back.
--
-- Shape: the account is still never deleted. What is new is a MARKER saying "this account was removed
-- from THIS org by its owner", which is the only thing that lets an account that already exists be
-- put back on a team:
--   * team_removed_members(org_id, user_id, removed_at, removed_by) — RLS on, no policy, no grant
--     to anon/authenticated: nothing but the SECURITY DEFINER functions below reads or writes it.
--   * team_remove_member (replaced) now also writes the marker, in the same statement block as the
--     delete, after the same owner checks. So a marker can only exist for a person who really was a
--     member of that org and was removed by that org's owner; there is no other way to create one.
--   * A marker only means something while it is the person's LATEST word. Gaining any membership
--     (an AFTER INSERT trigger on org_members, so manual SQL and team_add_member are covered too)
--     deletes every marker the person has, in every org; and where a person was removed from two
--     orgs, only the most recent removal can be restored. Without both, someone removed from A who
--     then belonged to B and left it would still be restorable by A's owner, who could then reset a
--     login that had since become B's.
--   * team_list_removed_members(org) — owner only; the removed people with their email, newest
--     first, leaving out anyone who now belongs to an organisation or whose marker for this org has
--     been superseded (they are not this owner's to restore, and the list must not offer what the
--     restore would refuse).
--   * team_can_restore(org, user) — the owner-side question the Edge Function asks AS THE CALLER
--     before it touches Auth: caller owns the org, the marker exists and is the latest, the person
--     is in no org.
--   * team_restore_member(org, user) — SERVICE ROLE ONLY. Serialises per person (advisory lock),
--     re-checks the marker (row-locked) and that the person is in no org, then re-attaches them as
--     an 'organiser' and consumes the marker. It can never attach an account that has no marker
--     for that org, so it cannot be used to take an existing account (e.g. a Guess the Bean
--     community user) the way an unrestricted add could. The Edge Function's `restore` action calls
--     this FIRST (it is the one atomic, locked authority) and only then sets the new one-time
--     password, so Auth is never asked to change the password of an account that was not just
--     restored.
--
-- Not covered (accepted, written down so it is not rediscovered):
--   * People removed BEFORE this migration have no marker (the membership row they were removed
--     from is gone, and nothing else records which org an account was removed from), so they do not
--     appear and cannot be restored here. A marker for such a person is inserted by hand, by someone
--     who knows which org they were on.
--   * Restoring does not bring back anything the person did while a member: that history never
--     left (score_change_log.changed_by still names the account).
--   * Markers have no expiry: an owner can restore someone they removed at any time while the person
--     is in no org, which resets that account's password. If the person has meanwhile used the same
--     login elsewhere (the project's Auth also holds Guess the Bean accounts) they are locked out of
--     it until they use the one-time password, and the owner knows it. This is the same power the
--     owner already had through Reset password while the person was a member, and the account was
--     provisioned by that owner; revisit with a TTL if teams grow.
--   * The password change does not revoke sessions the person already has: a device that stayed
--     signed in simply carries on once they are restored.
--   * The one-time password limits of the first migration apply unchanged to a restore.
--
-- rollback:
--   drop trigger if exists trg_org_members_forget_removed on org_members;
--   drop function if exists app.team_forget_removed_on_join();
--   drop function if exists team_restore_member(uuid, uuid);
--   drop function if exists team_can_restore(uuid, uuid);
--   drop function if exists team_list_removed_members(uuid);
--   -- put team_remove_member back as 20261007120000 defined it (without the marker):
--   create or replace function team_remove_member(p_org_id uuid, p_user_id uuid)
--   returns void language plpgsql security definer set search_path = '' as $f$
--   declare v_role text;
--   begin
--     if not app.is_org_owner(p_org_id) then
--       raise exception 'team_remove_member: only an owner can remove a team member' using errcode = '42501';
--     end if;
--     if p_user_id = auth.uid() then raise exception 'team_remove_member: you cannot remove yourself'; end if;
--     select m.role into v_role from public.org_members m
--       where m.org_id = p_org_id and m.user_id = p_user_id for update;
--     if not found then raise exception 'team_remove_member: that person is not on the team'; end if;
--     if v_role = 'owner' then raise exception 'team_remove_member: an owner cannot be removed'; end if;
--     delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
--   end;
--   $f$;
--   drop table if exists team_removed_members;

-- ============ the marker ============

create table team_removed_members (
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  removed_at  timestamptz not null default now(),
  removed_by  uuid references auth.users(id) on delete set null,
  primary key (org_id, user_id)
);
alter table team_removed_members enable row level security;
-- RLS with no policy already refuses every non-bypass role; the revoke makes it explicit and means a
-- later policy added by mistake still has no table privilege behind it.
revoke all on team_removed_members from anon, authenticated;

-- ============ remove (replaced: now leaves the marker) ============

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

  -- The only place a marker is written: someone who really was on this org's team and was removed by
  -- its owner. Removing them again after a restore simply refreshes it.
  insert into public.team_removed_members (org_id, user_id, removed_by)
  values (p_org_id, p_user_id, auth.uid())
  on conflict (org_id, user_id) do update
    set removed_at = now(), removed_by = excluded.removed_by;
end;
$$;
revoke execute on function team_remove_member(uuid, uuid) from public, anon, service_role;
grant execute on function team_remove_member(uuid, uuid) to authenticated;

-- ============ list the removed (owner only) ============

create or replace function team_list_removed_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  removed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_org_owner(p_org_id) then
    raise exception 'team_list_removed_members: only an owner can see the removed members'
      using errcode = '42501';
  end if;

  return query
  select r.user_id, u.email::text, r.removed_at
  from public.team_removed_members r
  join auth.users u on u.id = r.user_id
  where r.org_id = p_org_id
    -- someone who has since joined any organisation is not on offer
    and not exists (select 1 from public.org_members m where m.user_id = r.user_id)
    -- nor is a removal that a later removal from another org has superseded
    and not exists (
      select 1 from public.team_removed_members r2
      where r2.user_id = r.user_id and r2.org_id <> r.org_id and r2.removed_at > r.removed_at
    )
  order by r.removed_at desc, u.email;
end;
$$;
revoke execute on function team_list_removed_members(uuid) from public, anon, service_role;
grant execute on function team_list_removed_members(uuid) to authenticated;

-- ============ may the caller restore this person ============

create or replace function team_can_restore(p_org_id uuid, p_user_id uuid)
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
    );
$$;
revoke execute on function team_can_restore(uuid, uuid) from public, anon, service_role;
grant execute on function team_can_restore(uuid, uuid) to authenticated;

-- ============ restore (service role only) ============

create or replace function team_restore_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed_at timestamptz;
begin
  -- One restore per person at a time, whichever org's owner asks: the "in no org" check below is not
  -- backed by a unique constraint (org_members' key is (org_id, user_id)), so two owners restoring
  -- the same doubly-removed account at once could otherwise both pass it.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Locked so two restores of the same person into the same org cannot both pass the check.
  select r.removed_at into v_removed_at
  from public.team_removed_members r
  where r.org_id = p_org_id and r.user_id = p_user_id
  for update;
  if not found then
    raise exception 'team_restore_member: that person was not removed from this team';
  end if;
  if exists (
    select 1 from public.team_removed_members r2
    where r2.user_id = p_user_id and r2.org_id <> p_org_id and r2.removed_at > v_removed_at
  ) then
    -- removed from another org since: that removal is the latest word
    raise exception 'team_restore_member: that person was not removed from this team';
  end if;
  if exists (select 1 from public.org_members m where m.user_id = p_user_id) then
    raise exception 'team_restore_member: that account already belongs to an organisation';
  end if;

  -- The insert below fires the trigger that clears every marker the person has; the explicit delete
  -- is kept so this function is correct on its own.
  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_user_id, 'organiser');
  delete from public.team_removed_members where user_id = p_user_id;
end;
$$;
revoke execute on function team_restore_member(uuid, uuid) from public, anon, authenticated;
grant execute on function team_restore_member(uuid, uuid) to service_role;

-- ============ a marker dies when its person joins any org ============
-- SECURITY DEFINER: the trigger runs as whoever inserted the membership (the service role, a
-- migration, someone with psql), none of whom is guaranteed a privilege on the marker table.
create or replace function app.team_forget_removed_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.team_removed_members where user_id = new.user_id;
  return null;
end;
$$;
revoke execute on function app.team_forget_removed_on_join() from public, anon, authenticated, service_role;

create trigger trg_org_members_forget_removed
  after insert on org_members
  for each row execute function app.team_forget_removed_on_join();
