-- Seduh Score Next · T3.1 registry: org-consistency check + merge_people RPC
-- Handoff: SEDUH-NEXT-HANDOFF.md §6 (registry: people, entries, snapshotting,
-- dedup lookup, merge).
--
-- rollback:
--   revoke execute on function merge_people(uuid, uuid, uuid) from authenticated;
--   drop function if exists merge_people(uuid, uuid, uuid);
--   drop trigger if exists trg_person_merges_kept_org_check on person_merges;
--   drop function if exists app.check_person_merge_kept_org();
--   drop trigger if exists trg_event_entries_person_org_check on event_entries;
--   drop function if exists app.check_event_entry_person_org();

-- event_entries.person_id and event_entries.event_id are independent FKs with
-- nothing tying them to the same org — the same class of gap security-reviewer
-- caught in live_sessions (T1.3): a client that's a legitimate member of the
-- event's own org could otherwise set person_id to a person row belonging to a
-- DIFFERENT org (RLS's event_entries_write policy only checks org membership on
-- the event side, never that person_id's org matches). Closing it here, ahead
-- of T3.1's merge logic, which depends on person_id/event.org_id actually
-- agreeing.
create or replace function app.check_event_entry_person_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.person_id is not null then
    if (select org_id from public.people where id = new.person_id) <> app.org_id_for_event(new.event_id) then
      raise exception 'event_entries.person_id must belong to the same org as event_id';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_event_entries_person_org_check
  before insert or update on event_entries
  for each row execute function app.check_event_entry_person_org();

-- person_merges.kept_id has an unscoped FK to people(id) — any org — with
-- nothing tying it to the ledger row's own org_id. security-reviewer found
-- this exploitable directly (a plain client-side insert, no RPC involved):
-- person_merges_write's WITH CHECK only verifies org_id itself, never that
-- kept_id's person actually belongs to that org. Same fix shape as the
-- event_entries check above.
create or replace function app.check_person_merge_kept_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select org_id from public.people where id = new.kept_id) <> new.org_id then
    raise exception 'person_merges.kept_id must belong to the same org as org_id';
  end if;
  return new;
end;
$$;

create trigger trg_person_merges_kept_org_check
  before insert or update on person_merges
  for each row execute function app.check_person_merge_kept_org();

-- The merge algorithm, atomic. A client-side sequence of separate calls
-- (reassign entries, log the ledger, delete the person) risks the exact
-- partial-failure class §9's offline model is built to avoid — a crash or
-- dropped connection between steps could leave entries reassigned with no
-- ledger row, or a person deleted with entries still pointing at it. One RPC,
-- one transaction.
--
-- Per event where the merged-away person holds an entry: if the kept person
-- has NO entry in that same event, reassign it (no collision). If the kept
-- person already has an entry there, unlink the merged-away entry instead
-- (person_id = null) rather than colliding — the exact scenario T1.1's
-- partial-unique-index test proved the schema supports (handoff §5.1).
-- SECURITY INVOKER (the default) — runs as the calling user, so T1.3's RLS
-- policies apply exactly as they would to the equivalent direct writes; no
-- privilege escalation needed since an org member already has full CRUD on
-- people/event_entries/person_merges within their own org.
create or replace function merge_people(p_org_id uuid, p_kept_id uuid, p_merged_id uuid)
returns void
language plpgsql
as $$
declare
  v_merged_name text;
begin
  if p_kept_id = p_merged_id then
    raise exception 'merge_people: cannot merge a person into themselves';
  end if;

  if not exists (select 1 from people where id = p_kept_id and org_id = p_org_id) then
    raise exception 'merge_people: kept person % not found in org %', p_kept_id, p_org_id;
  end if;

  select display_name into v_merged_name
  from people
  where id = p_merged_id and org_id = p_org_id;

  if v_merged_name is null then
    raise exception 'merge_people: merged person % not found in org %', p_merged_id, p_org_id;
  end if;

  update event_entries ee
  set person_id = p_kept_id
  where ee.person_id = p_merged_id
    and not exists (
      select 1 from event_entries ee2
      where ee2.event_id = ee.event_id and ee2.person_id = p_kept_id
    );

  update event_entries
  set person_id = null
  where person_id = p_merged_id;

  insert into person_merges (org_id, kept_id, merged_id, merged_name, merged_by)
  values (p_org_id, p_kept_id, p_merged_id, v_merged_name, auth.uid());

  delete from people where id = p_merged_id and org_id = p_org_id;
end;
$$;

grant execute on function merge_people(uuid, uuid, uuid) to authenticated;
