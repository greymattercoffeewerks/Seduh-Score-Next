-- Seduh Score Next · T-ID.B3 follow-up: close the row-id existence oracle on public.org_person_affiliations, and stop
-- clients choosing the audit columns (Seduh ID Layer 1; found by the T-ID.C2 live proof, PR #380).
--
-- The defect (BUG CLASS: "a tenant table lets a client choose its primary key, and the conflict answer distinguishes
-- another tenant's row"). The B3 table grants `authenticated` INSERT and UPDATE on every column, `id` included. A member
-- of organisation B can POST `?on_conflict=id` naming a row id that belongs to organisation A: Postgres finds the
-- conflicting row, the row-level-security USING check on A's row fails, and the answer is 403 "(USING expression)"; for
-- an unused id the same request answers 201. So any member could test whether a random uuid is a row id in some other
-- organisation. A's row is never read or changed and ids are random (low impact), but the answer must not differ.
-- Second, smaller defect: `created_at` and `created_by` could be sent by the client on insert and on update (an audit
-- stamp a member could forge inside their own organisation).
--
-- The fix is a COLUMN-LEVEL GRANT. The table-level INSERT and UPDATE privileges are revoked from `authenticated` and
-- re-granted on the columns a client legitimately writes. `id`, `created_at` and `created_by` are in neither list, so a
-- request that NAMES one of them is refused by the privilege check (42501 "permission denied for table org_person_affiliations") before
-- any row is looked at: the answer is the same for an id that exists elsewhere and one that does not. A request that
-- does not name them is unaffected (the column defaults `gen_random_uuid()`, `now()` and `auth.uid()` still fill them;
-- a column default needs no privilege on the column).
--   * INSERT: org_id, person_id, relationship, started_on, ended_at.
--   * UPDATE: the same five. org_id and person_id stay in the UPDATE list on purpose: they are frozen by
--     trg_org_person_affiliations_parent_immutable, and keeping them grantable keeps that trigger (SQLSTATE 23001) the
--     observable, tested answer for a two-organisation member who tries to move a row, instead of hiding it behind a
--     privilege error. A client still cannot move a row.
--   * SELECT and DELETE are untouched (table level); DELETE and PATCH BY id of another organisation's row stay "zero
--     rows" through row-level security, the same answer as for a missing id.
-- Nothing else changes: the policies, both triggers and the grants for every other role are as B3 left them.
--
-- merge_people. B3's merge_people is SECURITY INVOKER and carried the merged person's roster rows by INSERTing them
-- with created_at and created_by copied across, which the new grant refuses to the caller. Options weighed:
--   (a) carry the rows with the column defaults: loses the true creation stamp and author, which B3 deliberately keeps
--       (the history is the point of the roster) and its test 063 pins;
--   (b) a transaction-local flag plus a trigger that forces the stamps for API roles: the flag is settable by the same
--       caller, so it only moves the forgery, and it adds a trigger to the table;
--   (c) a narrowly scoped SECURITY DEFINER helper, app.move_person_affiliations, that does the carry-over (the three
--       statements B3 had inline) as the table owner. CHOSEN: it opens with app.refuse_non_member, checks that both
--       people are distinct people of the organisation, takes no row ids, and can only copy stamps that already exist on
--       rows of that same organisation. merge_people stays INVOKER and keeps every check it had; only the carry-over
--       statements moved. The helper lives in `app` (not exposed over the API), is executable by `authenticated` only
--       because merge_people runs as the caller, and is revoked from every other role.
--
-- Not changed here: other tenant tables with an unrestricted INSERT grant share the same class (reported with the PR
-- for the owner to decide; this migration touches nothing but this table).
--
-- rollback: (restores the table-level grants and B3's merge_people, then drops the helper. No data is touched.)
--   revoke insert (org_id, person_id, relationship, started_on, ended_at) on public.org_person_affiliations from authenticated;
--   revoke update (org_id, person_id, relationship, started_on, ended_at) on public.org_person_affiliations from authenticated;
--   grant insert, update on public.org_person_affiliations to authenticated;
--   create or replace function merge_people(p_org_id uuid, p_kept_id uuid, p_merged_id uuid)
--   returns void
--   language plpgsql
--   set search_path = ''
--   as $$
--   declare
--     v_merged_name text;
--   begin
--     if p_kept_id = p_merged_id then
--       raise exception 'merge_people: cannot merge a person into themselves';
--     end if;
--     if not exists (select 1 from public.people where id = p_kept_id and org_id = p_org_id) then
--       raise exception 'merge_people: kept person % not found in org %', p_kept_id, p_org_id;
--     end if;
--     select display_name into v_merged_name
--     from public.people
--     where id = p_merged_id and org_id = p_org_id
--     for update;
--     if v_merged_name is null then
--       raise exception 'merge_people: merged person % not found in org %', p_merged_id, p_org_id;
--     end if;
--     update public.event_entries ee
--     set person_id = p_kept_id
--     where ee.person_id = p_merged_id
--       and not exists (
--         select 1 from public.event_entries ee2
--         where ee2.event_id = ee.event_id and ee2.person_id = p_kept_id
--       );
--     update public.event_entries
--     set person_id = null
--     where person_id = p_merged_id;
--     update public.org_person_affiliations k
--     set started_on = m.started_on
--     from public.org_person_affiliations m
--     where k.org_id = p_org_id and k.person_id = p_kept_id and k.ended_at is null
--       and m.org_id = p_org_id and m.person_id = p_merged_id and m.ended_at is null
--       and m.relationship = k.relationship
--       and m.started_on is not null
--       and (k.started_on is null or m.started_on < k.started_on);
--     insert into public.org_person_affiliations
--       (org_id, person_id, relationship, started_on, ended_at, created_at, created_by)
--     select m.org_id, p_kept_id, m.relationship, m.started_on, m.ended_at, m.created_at, m.created_by
--     from public.org_person_affiliations m
--     where m.org_id = p_org_id and m.person_id = p_merged_id
--       and not (
--         m.ended_at is null
--         and exists (
--           select 1 from public.org_person_affiliations k
--           where k.org_id = p_org_id and k.person_id = p_kept_id
--             and k.relationship = m.relationship and k.ended_at is null
--         )
--       );
--     delete from public.org_person_affiliations
--     where org_id = p_org_id and person_id = p_merged_id;
--     insert into public.person_merges (org_id, kept_id, merged_id, merged_name, merged_by)
--     values (p_org_id, p_kept_id, p_merged_id, v_merged_name, auth.uid());
--     delete from public.people where id = p_merged_id and org_id = p_org_id;
--   end;
--   $$;
--   drop function if exists app.move_person_affiliations(uuid, uuid, uuid);

-- ============ grants: no client chooses id, created_at or created_by ============

revoke insert, update on public.org_person_affiliations from authenticated;
grant insert (org_id, person_id, relationship, started_on, ended_at) on public.org_person_affiliations to authenticated;
grant update (org_id, person_id, relationship, started_on, ended_at) on public.org_person_affiliations to authenticated;

-- ============ the carry-over helper (the roster part of merge_people, as the table owner) ============

create or replace function app.move_person_affiliations(p_org_id uuid, p_kept_id uuid, p_merged_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(p_org_id, 'org_person_affiliations');

  if p_kept_id = p_merged_id
     or (select count(*) from public.people where org_id = p_org_id and id in (p_kept_id, p_merged_id)) <> 2 then
    raise exception 'app.move_person_affiliations: both people must be distinct people of the organisation';
  end if;

  -- First, an open duplicate hands its earlier start date to the surviving open row of the kept person.
  update public.org_person_affiliations k
  set started_on = m.started_on
  from public.org_person_affiliations m
  where k.org_id = p_org_id and k.person_id = p_kept_id and k.ended_at is null
    and m.org_id = p_org_id and m.person_id = p_merged_id and m.ended_at is null
    and m.relationship = k.relationship
    and m.started_on is not null
    and (k.started_on is null or m.started_on < k.started_on);

  -- Then every row that does not collide moves to the kept person (insert, because person_id is frozen), keeping the
  -- creation stamp and author of the original.
  insert into public.org_person_affiliations
    (org_id, person_id, relationship, started_on, ended_at, created_at, created_by)
  select m.org_id, p_kept_id, m.relationship, m.started_on, m.ended_at, m.created_at, m.created_by
  from public.org_person_affiliations m
  where m.org_id = p_org_id and m.person_id = p_merged_id
    and not (
      m.ended_at is null
      and exists (
        select 1 from public.org_person_affiliations k
        where k.org_id = p_org_id and k.person_id = p_kept_id
          and k.relationship = m.relationship and k.ended_at is null
      )
    );

  delete from public.org_person_affiliations
  where org_id = p_org_id and person_id = p_merged_id;
end;
$$;

revoke all on function app.move_person_affiliations(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app.move_person_affiliations(uuid, uuid, uuid) to authenticated;

-- ============ merge_people: the roster carry-over now goes through the helper ============

create or replace function merge_people(p_org_id uuid, p_kept_id uuid, p_merged_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_merged_name text;
begin
  if p_kept_id = p_merged_id then
    raise exception 'merge_people: cannot merge a person into themselves';
  end if;

  if not exists (select 1 from public.people where id = p_kept_id and org_id = p_org_id) then
    raise exception 'merge_people: kept person % not found in org %', p_kept_id, p_org_id;
  end if;

  -- Locked, so a roster row added to the merged person by another device cannot commit between the copy below and
  -- the delete (it would be dropped by the cascade with no ledger entry).
  select display_name into v_merged_name
  from public.people
  where id = p_merged_id and org_id = p_org_id
  for update;

  if v_merged_name is null then
    raise exception 'merge_people: merged person % not found in org %', p_merged_id, p_org_id;
  end if;

  update public.event_entries ee
  set person_id = p_kept_id
  where ee.person_id = p_merged_id
    and not exists (
      select 1 from public.event_entries ee2
      where ee2.event_id = ee.event_id and ee2.person_id = p_kept_id
    );

  update public.event_entries
  set person_id = null
  where person_id = p_merged_id;

  -- Roster rows: the collision rule (B3 header, unchanged) now lives in app.move_person_affiliations.
  perform app.move_person_affiliations(p_org_id, p_kept_id, p_merged_id);

  insert into public.person_merges (org_id, kept_id, merged_id, merged_name, merged_by)
  values (p_org_id, p_kept_id, p_merged_id, v_merged_name, auth.uid());

  delete from public.people where id = p_merged_id and org_id = p_org_id;
end;
$$;
