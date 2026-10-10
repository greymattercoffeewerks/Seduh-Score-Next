-- Seduh Score Next · T-TEN.B5: never lose the last owner
--
-- Why now: team accounts (20261007120000) guarantee an owner can never be removed through
-- team_remove_member, but that is a rule in ONE function. Nothing stopped the last owner of
-- an org being deleted or demoted by any other path (a service-role statement, a future
-- RPC, deleting the owner's auth account), and an org with no owner can no longer manage
-- its team: team_can_manage needs an owner, and there was NO way to promote a successor
-- (ROADMAP "last owner can be deleted with no way to promote a successor"). The database
-- now enforces it for every writer, and a service-role function can promote or demote.
--
-- Behaviour:
--   * DELETE of an owner row, or UPDATE of role away from 'owner', is refused when that
--     leaves the org with no owner. Two owners may demote/remove each other one at a time;
--     the second is refused. The org row is locked first so two concurrent demotions
--     cannot both pass the check.
--   * Deleting the ORG (or the cascade from it) is allowed: the cascade runs after the orgs
--     row is gone, which the trigger detects.
--   * Consequence worth knowing: deleting the auth account of an org's only owner is now
--     refused until a successor is promoted with org_set_role. That is the point.
--   * TRUNCATE is closed too: service_role held TRUNCATE on org_members and orgs (left over
--     from 20260925090000, which only stripped it from anon/authenticated), and a TRUNCATE
--     fires no row trigger, so it would have skipped the guard. It is revoked here for those
--     two tables. (Other tenant tables still grant service_role TRUNCATE; recorded in
--     ROADMAP as a follow-up, since revoking it everywhere is a wider privilege change.)
--   * org_set_role(org, user, role) is service-role only (no UI, matching decision D-T1:
--     invite-only provisioning). It changes the role of an EXISTING member; adding people
--     stays with team_add_member / the provisioning path.
--
-- rollback:
--   drop trigger if exists trg_org_members_protect_last_owner on org_members;
--   drop function if exists app.protect_last_owner();
--   drop function if exists org_set_role(uuid, uuid, text);
--   grant truncate on org_members, orgs to service_role;

create or replace function app.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.org_members;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;

  -- Only an owner row going away or being demoted matters.
  if old.role is distinct from 'owner' then
    return v_row;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return v_row;
  end if;

  -- Lock the org first so two concurrent demotions of the last two owners serialise
  -- (the second then sees the first's committed state). If the org row is already gone,
  -- this is the cascade from deleting the org itself: let it through.
  --
  -- FOR NO KEY UPDATE, not FOR UPDATE: it still conflicts with itself (so two demotions
  -- serialise) but not with the FOR KEY SHARE lock every foreign-key insert into an
  -- org-referencing table takes, so a demotion no longer stalls every other write for the
  -- org until it commits (schema-guardian measured an insert into people blocking).
  -- One remaining, rare hazard, accepted: this trigger holds the member row before it takes
  -- the orgs lock, while `delete from orgs` takes the orgs row first and then the member
  -- rows, so a demotion racing an org deletion can deadlock; Postgres aborts one of them.
  perform 1 from public.orgs o where o.id = old.org_id for no key update;
  if not found then
    return v_row;
  end if;

  -- The other owners are locked FOR UPDATE rather than merely counted: under REPEATABLE
  -- READ or SERIALIZABLE a plain read uses the transaction's snapshot and would not see a
  -- concurrent demotion that committed after it, so both owners could be demoted with no
  -- error. Locking the row makes that case fail with a serialization error instead
  -- (security-reviewer N2). At READ COMMITTED the org lock above already serialises.
  perform 1
    from public.org_members m
   where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id
     for update;
  if not found then
    raise exception 'org_members: an org must keep at least one owner'
      using errcode = 'P0001',
            hint = 'Promote another member with org_set_role first.';
  end if;

  return v_row;
end;
$$;

create trigger trg_org_members_protect_last_owner
  before delete or update of role on org_members
  for each row execute function app.protect_last_owner();

revoke all on function app.protect_last_owner() from public, anon, authenticated;

-- TRUNCATE fires no row trigger, so it would walk straight past the guard.
revoke truncate on org_members, orgs from service_role;

-- ============ org_set_role: promote or demote an existing member (service role only) ============

create or replace function org_set_role(p_org_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('owner', 'organiser') then
    raise exception 'org_set_role: role must be owner or organiser'
      using errcode = '22023';
  end if;

  update public.org_members
  set role = p_role
  where org_id = p_org_id and user_id = p_user_id;
  if not found then
    raise exception 'org_set_role: that person is not a member of the org'
      using errcode = 'P0002';
  end if;
  -- Demoting the last owner is refused by trg_org_members_protect_last_owner.
end;
$$;

revoke all on function org_set_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function org_set_role(uuid, uuid, text) to service_role;
