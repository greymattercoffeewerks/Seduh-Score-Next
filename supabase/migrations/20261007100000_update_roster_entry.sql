-- Seduh Score Next · update_roster_entry: correct a registered cupper's details
-- Handoff: SEDUH-NEXT-HANDOFF.md §5.1 (people vs per-event entry snapshots), §6 (core/registry).
--
-- Why: first live event (2026-10-04), finding #4. The roster had no Edit. A wrong name
-- could not be fixed from the app at all: registering again with the same phone returns
-- the EXISTING person unchanged (core/registry.registerPerson dedups by phone, then
-- email, and ignores the typed name), and withdraw + re-register changes nothing. The
-- organiser also could not see the phone/email that were entered.
--
-- What one correction touches, atomically:
--   * the person's shared profile (people.display_name / phone / email / cafe), so the typo
--     does not come back the next time they register for any event. Phone and email always
--     come from the form (they live only on the profile); name and cafe reach the profile
--     only when the caller CHANGED them from this entry's snapshot — the form is prefilled
--     from the snapshot, so fixing a bib on an old entry must not revert a profile that was
--     renamed since;
--   * THIS event's entry (event_entries.display_name / cafe / bib) — the per-event snapshot.
--     Other events' entries for the same person are deliberately NOT rewritten (§5.1: a
--     snapshot records what was true then).
-- A walk-up entry with no linked person (D16) has no profile: only its own name / cafe /
-- bib can be edited, and a phone or email for it is refused rather than silently dropped.
--
-- Phone and email stay unique within the org (the existing unique indexes). A clash is
-- reported as a P0002 CONFLICT whose DETAIL names the field and the person who already has
-- it, so the screen can say exactly what to check; a clash that only appears at the UPDATE
-- (a race between two organiser devices) is reported the same way, without the name.
--
-- Last write wins: there is no optimistic-concurrency check, so a form left open on one
-- device can restore a value another device has since changed. Acceptable for a roster edit.
--
-- Not covered: the audience view's published payload and any published results sheet bake
-- names in, and show the new name only the next time they are published. The caller says so.
-- No `score_change_log` row: names are not scored inputs (that log is for those).
--
-- Invoker rights, so RLS (people_write / event_entries_write) still applies; the explicit
-- p_org_id check additionally stops a member of two orgs from attributing one org's entry
-- to the other. Same not-found answer for "no such entry" and "not your org's", so it
-- cannot be used to probe ids.
--
-- rollback:
--   drop function if exists update_roster_entry(uuid, uuid, text, text, text, text, text);

create or replace function update_roster_entry(
  p_org_id uuid,
  p_entry_id uuid,
  p_display_name text,
  p_phone text,
  p_email text,
  p_cafe text,
  p_bib text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_person_id uuid;
  v_snap_name text;
  v_snap_cafe text;
  v_name text := nullif(btrim(p_display_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(btrim(p_email), '');
  v_cafe text := nullif(btrim(p_cafe), '');
  v_bib text := nullif(btrim(p_bib), '');
  v_other_id uuid;
  v_other_name text;
begin
  -- Read under RLS first: a non-member sees no row at all. Locked here so the person_id read is
  -- the one the write uses (a concurrent merge_people re-points it under the same row lock).
  select ee.event_id, ee.person_id, ee.display_name, nullif(btrim(ee.cafe), '')
    into v_event_id, v_person_id, v_snap_name, v_snap_cafe
  from public.event_entries ee
  where ee.id = p_entry_id
  for update;

  if v_event_id is null or p_org_id is distinct from app.org_id_for_event(v_event_id) then
    raise exception 'update_roster_entry: entry % not found', p_entry_id;
  end if;

  if v_name is null then
    raise exception 'update_roster_entry: a name is required';
  end if;
  if char_length(v_name) > 200 or char_length(coalesce(v_cafe, '')) > 200
     or char_length(coalesce(v_bib, '')) > 50 or char_length(coalesce(v_email, '')) > 254
     or char_length(coalesce(v_phone, '')) > 32 then
    raise exception 'update_roster_entry: a value is too long';
  end if;

  if v_person_id is null then
    -- A walk-up entry: no profile to carry a phone or email.
    if v_phone is not null or v_email is not null then
      raise exception 'update_roster_entry: this entry has no profile, so a phone or email cannot be set';
    end if;
  else
    if v_phone is null then
      raise exception 'update_roster_entry: a phone number is required';
    end if;

    -- Serialise two devices editing the same person.
    perform 1 from public.people where id = v_person_id and org_id = p_org_id for update;
    if not found then
      raise exception 'update_roster_entry: entry % not found', p_entry_id;
    end if;

    select p.id, p.display_name into v_other_id, v_other_name
    from public.people p
    where p.org_id = p_org_id and p.phone = v_phone and p.id <> v_person_id;
    if found then
      raise exception 'CONFLICT: that phone number already belongs to another person'
        using detail = json_build_object(
                'field', 'phone',
                'existing_person_id', v_other_id,
                'existing_display_name', v_other_name
              )::text,
              errcode = 'P0002';
    end if;

    if v_email is not null then
      select p.id, p.display_name into v_other_id, v_other_name
      from public.people p
      where p.org_id = p_org_id and lower(p.email) = lower(v_email) and p.id <> v_person_id;
      if found then
        raise exception 'CONFLICT: that email already belongs to another person'
          using detail = json_build_object(
                  'field', 'email',
                  'existing_person_id', v_other_id,
                  'existing_display_name', v_other_name
                )::text,
                errcode = 'P0002';
      end if;
    end if;

    begin
      update public.people
      set display_name = case when v_name is distinct from v_snap_name then v_name else display_name end,
          phone = v_phone,
          email = v_email,
          cafe = case when v_cafe is distinct from v_snap_cafe then v_cafe else cafe end
      where id = v_person_id and org_id = p_org_id;
    exception when unique_violation then
      -- Lost a race with another device between the checks above and this write.
      raise exception 'CONFLICT: that phone number or email already belongs to another person'
        using detail = json_build_object('field', null)::text, errcode = 'P0002';
    end;
  end if;

  update public.event_entries
  set display_name = v_name, cafe = v_cafe, bib = v_bib
  where id = p_entry_id;
  if not found then
    raise exception 'update_roster_entry: entry % not found', p_entry_id;
  end if;
end;
$$;

revoke execute on function update_roster_entry(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function update_roster_entry(uuid, uuid, text, text, text, text, text) to authenticated, service_role;
