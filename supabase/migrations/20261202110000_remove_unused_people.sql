-- Seduh Score Next · remove_unused_people(org, person ids): clear leftover names out of an organisation's people list
--
-- Why: deleting a TEST event removes its entries, but a person row belongs to the ORGANISATION, not to the event, so the
-- throwaway names stay (found 2026-11-28 on a real organisation). Until now a person could only be removed by SQL.
--
-- What it does, in one transaction: for the people the caller names, deletes each one that is SAFE to forget:
--   * no entry on any event (event_entries.person_id), withdrawn entries included: a withdrawn person is still part of
--     that event's history, and deleting the person would null the link on the entry;
--   * no Seduh ID link (global_person_id is null) and no claim: a person who has an identity is never deleted here;
--   * no staff or affiliate role, past or present (org_person_affiliations).
-- Anything else the caller named is left alone and not counted. Returns how many were deleted.
--
-- Same shape as link_person_identity: SECURITY DEFINER, search_path pinned; membership checked FIRST through
-- app.refuse_non_member (a non-member, or a NULL organisation, gets the one standard 42501 whatever ids they name); then
-- every named person must belong to p_org_id, else the SAME 42501 (a person of another organisation and a person that does
-- not exist look alike). At most 200 people per call. The people list is the organisation's own: nothing here reads another
-- organisation's rows, and the delete re-states org_id.
--
-- A second function, list_unused_people(org), lists who would be safe to remove (name, cafe, id; at most 200) so the screen
-- can show the organiser what it is about to offer. Same membership refusal; it reads the organisation's own people only.
-- Both functions read the one rule from app.unused_person_ids(org), so the list and the delete can never disagree.
--
-- rollback:
--   drop function if exists public.list_unused_people(uuid);
--   drop function if exists public.remove_unused_people(uuid, uuid[]);
--   drop function if exists app.unused_person_ids(uuid);

create or replace function app.unused_person_ids(p_org_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.people p
   where p.org_id = p_org_id
     and p.global_person_id is null
     and not exists (select 1 from public.event_entries e where e.person_id = p.id)
     and not exists (select 1 from public.org_person_affiliations a where a.person_id = p.id)
     and not exists (select 1 from public.person_merges m where m.kept_id = p.id);
$$;
revoke all on function app.unused_person_ids(uuid) from public, anon, authenticated, service_role;

create or replace function public.remove_unused_people(p_org_id uuid, p_person_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  v_count integer;
begin
  perform app.refuse_non_member(p_org_id, 'people');
  if p_org_id is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_person_ids, '{}')) as t(x) where x is not null;
  if cardinality(v_ids) > 200 then
    raise exception 'remove_unused_people: at most 200 people at a time' using hint = 'too_many_people';
  end if;

  foreach v_id in array v_ids loop
    if app.org_id_for_person_internal(v_id) is distinct from p_org_id then
      raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
    end if;
  end loop;

  delete from public.people p
   where p.org_id = p_org_id
     and p.id = any (v_ids)
     and p.id in (select app.unused_person_ids(p_org_id));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.remove_unused_people(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.remove_unused_people(uuid, uuid[]) to authenticated;

create or replace function public.list_unused_people(p_org_id uuid)
returns table (person_id uuid, display_name text, cafe text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(p_org_id, 'people');
  if p_org_id is null then
    raise exception 'new row violates row-level security policy for table "people"' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, p.cafe
      from public.people p
     where p.org_id = p_org_id and p.id in (select app.unused_person_ids(p_org_id))
     order by p.display_name, p.id
     limit 200;
end;
$$;

revoke all on function public.list_unused_people(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_unused_people(uuid) to authenticated;
