-- Seduh Score Next · T-ID.B3: the staff/affiliate roster (public.org_person_affiliations)
--
-- Why: an organisation records that one of ITS OWN people is staff or affiliated with it (Seduh ID Layer 1, spec 3.4,
-- owner decisions 8 and 9 of HANDOFF-CORRECTION-004). A TENANT table: the row names the organisation and the
-- organisation's own `people` row, never the cross-organisation identity, so nothing on it points outside one
-- organisation and Layer 1 shows it to nobody else. No view, no anonymous door, no new RPC (plain table access).
--
-- Shape: id; org_id (cascade); person_id (cascade); relationship (free text with a format check, not an enum:
-- starting UI vocabulary `staff`, `affiliate`); started_on / ended_at (leaving staff ends a row, it does not delete
-- history); created_at, created_by. One OPEN row per (org, person, relationship): a partial unique index, so the same
-- relationship can be re-added once the earlier one has ended.
--
-- Tenant-table checklist (CONVENTIONS "How to add a tenant table"):
--   1 scope       org_id column.
--   2 RLS         on; `_read` and `_write` policies on app.is_org_member(org_id), WITH CHECK on the write one.
--                 Any member may edit the roster (decision 8), as with `people`.
--   3 freeze      before update trigger app.forbid_parent_change('org_id', 'person_id') (SQLSTATE 23001).
--   4 grants      explicit, `authenticated` only, in this migration; nothing for anon. service_role is revoked too
--                 (this also removes the TRUNCATE it holds on new tables).
--   5 two ids     app.check_affiliation_person_org(): BEFORE ROW SECURITY DEFINER; opens with app.refuse_non_member
--                 and compares with `is distinct from` (B6 lesson, 20261013160000), so a stranger gets the standard
--                 42501 whatever ids they guess, and a missing person and another organisation's person are
--                 indistinguishable to a member (one P0001).
--   6 views       none.   7 matrices: 040 (the table), 041 (no RPC added).
--
-- The trigger is ordered after the freeze trigger on purpose (trigger names fire alphabetically: ..._parent_immutable
-- before ..._person_org_check), so a two-organisation member moving a row gets 23001, not the trigger's own error.
--
-- merge_people (spec 3.6). merge_people deletes the merged `people` row; the on-delete-cascade on person_id would then
-- silently drop that person's roster rows with no ledger entry. It is replaced here, starting from its CURRENT
-- definition (20260830130000_rpc_search_path_pin.sql: no later migration redefines it; grants are unchanged by
-- `create or replace`), still SECURITY INVOKER with search_path = '', and now moves the merged person's affiliations to
-- the kept person BEFORE the delete. Because person_id is frozen (an UPDATE would be refused 23001), rows move by
-- insert-then-delete, keeping relationship, started_on, ended_at, created_at and created_by. Defined collision rule,
-- for the partial unique index (one OPEN row per relationship):
--   * merged open row, kept person already has an OPEN row of the same relationship: the kept person's row survives
--     (the earlier row by creation); the merged duplicate is dropped. If the merged row's started_on is earlier
--     (non-null, and the kept row's is null or later), that earlier date is copied onto the surviving row, so the
--     history keeps its true start. The merged row's created_at/created_by are not carried over.
--   * every other row moves unchanged: an open row with no open twin, and every ended row (the index ignores them,
--     so ended history is never dropped or merged, and a person may carry several ended rows of one relationship).
-- Runs as the caller (INVOKER), so RLS applies: a non-member of the organisation finds no kept/merged person and is
-- refused by the function's own check, exactly as before.
--
-- rollback: (drops the roster; restores merge_people to the 20260830130000 body. Data loss once rows exist.)
--   drop trigger if exists trg_org_person_affiliations_person_org_check on public.org_person_affiliations;
--   drop trigger if exists trg_org_person_affiliations_parent_immutable on public.org_person_affiliations;
--   drop table if exists public.org_person_affiliations;
--   drop function if exists app.check_affiliation_person_org();
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
--     select display_name into v_merged_name from public.people where id = p_merged_id and org_id = p_org_id;
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
--     update public.event_entries set person_id = null where person_id = p_merged_id;
--     insert into public.person_merges (org_id, kept_id, merged_id, merged_name, merged_by)
--     values (p_org_id, p_kept_id, p_merged_id, v_merged_name, auth.uid());
--     delete from public.people where id = p_merged_id and org_id = p_org_id;
--   end;
--   $$;

create table public.org_person_affiliations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  relationship text not null check (relationship ~ '^[a-z][a-z_]{1,39}$'),
  started_on date,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid()
);

-- one OPEN row per (organisation, person, relationship); an ended row frees the slot
create unique index org_person_affiliations_open_uq
  on public.org_person_affiliations (org_id, person_id, relationship)
  where ended_at is null;
create index org_person_affiliations_org_idx on public.org_person_affiliations (org_id);
create index org_person_affiliations_person_idx on public.org_person_affiliations (person_id);   -- serves the cascade from people

alter table public.org_person_affiliations enable row level security;

create policy org_person_affiliations_read on public.org_person_affiliations
  for select using (app.is_org_member(org_id));
create policy org_person_affiliations_write on public.org_person_affiliations
  for all using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));

create trigger trg_org_person_affiliations_parent_immutable
  before update on public.org_person_affiliations
  for each row execute function app.forbid_parent_change('org_id', 'person_id');

-- ============ the cross-reference check: the person belongs to the row's organisation ============

create or replace function app.check_affiliation_person_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(new.org_id, 'org_person_affiliations');
  if (select org_id from public.people where id = new.person_id) is distinct from new.org_id then
    raise exception 'org_person_affiliations.person_id must belong to the same org as org_id';
  end if;
  return new;
end;
$$;

revoke all on function app.check_affiliation_person_org() from public, anon, authenticated, service_role;

create trigger trg_org_person_affiliations_person_org_check
  before insert or update of org_id, person_id on public.org_person_affiliations
  for each row execute function app.check_affiliation_person_org();

-- ============ grants: members only (revoke first: a fresh build hands every API role ALL privileges) ============

revoke all on public.org_person_affiliations from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.org_person_affiliations to authenticated;

-- ============ merge_people: carry the roster over before the merged person is deleted ============

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

  -- Roster rows (see the header for the collision rule). First, an open duplicate hands its earlier start date to the
  -- surviving open row of the kept person.
  update public.org_person_affiliations k
  set started_on = m.started_on
  from public.org_person_affiliations m
  where k.org_id = p_org_id and k.person_id = p_kept_id and k.ended_at is null
    and m.org_id = p_org_id and m.person_id = p_merged_id and m.ended_at is null
    and m.relationship = k.relationship
    and m.started_on is not null
    and (k.started_on is null or m.started_on < k.started_on);

  -- Then every row that does not collide moves to the kept person (insert, because person_id is frozen).
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

  insert into public.person_merges (org_id, kept_id, merged_id, merged_name, merged_by)
  values (p_org_id, p_kept_id, p_merged_id, v_merged_name, auth.uid());

  delete from public.people where id = p_merged_id and org_id = p_org_id;
end;
$$;
