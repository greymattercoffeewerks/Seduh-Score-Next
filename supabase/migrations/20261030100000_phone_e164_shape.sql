-- Seduh Score Next · T-ID.A3 (part 1 of 2): the database checks phone SHAPE only; update_roster_entry requires E.164
--
-- Why: Seduh ID Layer 1 keys a person on a validated E.164 phone (Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md
-- 3.3, 4.2; Handoffs and Specs/PHONE-CHECKER-DESIGN.md sections 3, 4 and 7, owner decisions of 2026-10-29). All
-- INTERPRETATION of what a person typed (country, formatting, trunk digits) lives in the client (src/core/phone.js).
-- The database never guesses: it checks that what it is given is canonical, and refuses otherwise.
--   * adds app.is_e164(text): the shape '^\+[1-9][0-9]{7,14}$', textually the same string as E164_PATTERN in
--     src/core/phone.js and as the people_phone_e164 CHECK (a vitest guard compares the three);
--   * adds app.phone_repair_class(raw): the classification the owner-run audit and repair scripts use. It is
--     deliberately narrow (valid / repairable_default_country / null_phone / ambiguous): only an exact 7-digit
--     Brunei number ('^[2-578][0-9]{6}$' once spaces, dashes, dots and brackets are removed) is repairable, with
--     +673. An 8-digit value, a leading-0 value and everything else is 'ambiguous': reported, never repaired;
--   * makes update_roster_entry trim the phone and REQUIRE canonical E.164 (hint 'phone_invalid' otherwise). No
--     normalisation, no default country. It starts from the CURRENT body (20261011140000, which carries the null-org
--     guard), not 20261007100000. A walk-up entry still cannot carry a phone and a linked entry still requires one.
--
-- THIS MIGRATION IS SAFE TO PUSH BEFORE ANY DATA REPAIR: it changes no row and adds no constraint. The only
-- behaviour change is that update_roster_entry now rejects a phone that is not canonical E.164. The client must send
-- canonical values (it does today: rosterScreen.js normalises first).
-- The people_phone_e164 CHECK is the NEXT migration (20261030110000) and MUST NOT be pushed until the stored phones
-- are all valid (supabase/scripts/people_phone_audit.sql shows only 'valid').
--
-- rollback: (restores the exact 20261011140000 body of update_roster_entry, then drops the two functions)
--   CREATE OR REPLACE FUNCTION public.update_roster_entry(p_org_id uuid, p_entry_id uuid, p_display_name text, p_phone text, p_email text, p_cafe text, p_bib text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_event_id uuid;
--     v_person_id uuid;
--     v_snap_name text;
--     v_snap_cafe text;
--     v_name text := nullif(btrim(p_display_name), '');
--     v_phone text := nullif(btrim(p_phone), '');
--     v_email text := nullif(btrim(p_email), '');
--     v_cafe text := nullif(btrim(p_cafe), '');
--     v_bib text := nullif(btrim(p_bib), '');
--     v_other_id uuid;
--     v_other_name text;
--   begin
--     -- Read under RLS first: a non-member sees no row at all. Locked here so the person_id read is
--     -- the one the write uses (a concurrent merge_people re-points it under the same row lock).
--     select ee.event_id, ee.person_id, ee.display_name, nullif(btrim(ee.cafe), '')
--       into v_event_id, v_person_id, v_snap_name, v_snap_cafe
--     from public.event_entries ee
--     where ee.id = p_entry_id
--     for update;
--
--     if v_event_id is null or p_org_id is null or p_org_id is distinct from app.org_id_for_event(v_event_id) then
--       raise exception 'update_roster_entry: entry % not found', p_entry_id;
--     end if;
--
--     if v_name is null then
--       raise exception 'update_roster_entry: a name is required';
--     end if;
--     if char_length(v_name) > 200 or char_length(coalesce(v_cafe, '')) > 200
--        or char_length(coalesce(v_bib, '')) > 50 or char_length(coalesce(v_email, '')) > 254
--        or char_length(coalesce(v_phone, '')) > 32 then
--       raise exception 'update_roster_entry: a value is too long';
--     end if;
--
--     if v_person_id is null then
--       -- A walk-up entry: no profile to carry a phone or email.
--       if v_phone is not null or v_email is not null then
--         raise exception 'update_roster_entry: this entry has no profile, so a phone or email cannot be set';
--       end if;
--     else
--       if v_phone is null then
--         raise exception 'update_roster_entry: a phone number is required';
--       end if;
--
--       -- Serialise two devices editing the same person.
--       perform 1 from public.people where id = v_person_id and org_id = p_org_id for update;
--       if not found then
--         raise exception 'update_roster_entry: entry % not found', p_entry_id;
--       end if;
--
--       select p.id, p.display_name into v_other_id, v_other_name
--       from public.people p
--       where p.org_id = p_org_id and p.phone = v_phone and p.id <> v_person_id;
--       if found then
--         raise exception 'CONFLICT: that phone number already belongs to another person'
--           using detail = json_build_object(
--                   'field', 'phone',
--                   'existing_person_id', v_other_id,
--                   'existing_display_name', v_other_name
--                 )::text,
--                 errcode = 'P0002';
--       end if;
--
--       if v_email is not null then
--         select p.id, p.display_name into v_other_id, v_other_name
--         from public.people p
--         where p.org_id = p_org_id and lower(p.email) = lower(v_email) and p.id <> v_person_id;
--         if found then
--           raise exception 'CONFLICT: that email already belongs to another person'
--             using detail = json_build_object(
--                     'field', 'email',
--                     'existing_person_id', v_other_id,
--                     'existing_display_name', v_other_name
--                   )::text,
--                   errcode = 'P0002';
--         end if;
--       end if;
--
--       begin
--         update public.people
--         set display_name = case when v_name is distinct from v_snap_name then v_name else display_name end,
--             phone = v_phone,
--             email = v_email,
--             cafe = case when v_cafe is distinct from v_snap_cafe then v_cafe else cafe end
--         where id = v_person_id and org_id = p_org_id;
--       exception when unique_violation then
--         -- Lost a race with another device between the checks above and this write.
--         raise exception 'CONFLICT: that phone number or email already belongs to another person'
--           using detail = json_build_object('field', null)::text, errcode = 'P0002';
--       end;
--     end if;
--
--     update public.event_entries
--     set display_name = v_name, cafe = v_cafe, bib = v_bib
--     where id = p_entry_id;
--     if not found then
--       raise exception 'update_roster_entry: entry % not found', p_entry_id;
--     end if;
--   end;
--   $function$;
--   drop function app.phone_repair_class(text);
--   drop function app.is_e164(text);

-- E.164 shape: '+', a non-zero digit, then 7 to 14 more digits. NULL is not E.164.
create or replace function app.is_e164(p_phone text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_phone ~ '^\+[1-9][0-9]{7,14}$', false);
$$;

-- The audit/repair classification of one stored value. It never guesses:
--   valid                      already E.164
--   repairable_default_country exactly a 7-digit Brunei number once spaces, dashes, dots and brackets are removed
--                              ('^[2-578][0-9]{6}$'); '+673' would be added
--   null_phone                 no value
--   ambiguous                  everything else (8 digits, a leading 0, a country code without '+', punctuation the
--                              rule does not know, text): reported to the organiser, never repaired
create or replace function app.phone_repair_class(p_raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_raw is null then 'null_phone'
    when app.is_e164(p_raw) then 'valid'
    when regexp_replace(p_raw, '[ ()./-]', '', 'g') ~ '^[2-578][0-9]{6}$' then 'repairable_default_country'
    else 'ambiguous'
  end;
$$;

-- is_e164 is called by update_roster_entry as the signed-in caller (it is SECURITY INVOKER). The classifier is for the
-- owner's scripts only. Both are pure: they read no table.
revoke execute on function app.is_e164(text) from public, anon;
grant execute on function app.is_e164(text) to authenticated, service_role;
revoke execute on function app.phone_repair_class(text) from public, anon, authenticated;
grant execute on function app.phone_repair_class(text) to service_role;

CREATE OR REPLACE FUNCTION public.update_roster_entry(p_org_id uuid, p_entry_id uuid, p_display_name text, p_phone text, p_email text, p_cafe text, p_bib text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  if v_event_id is null or p_org_id is null or p_org_id is distinct from app.org_id_for_event(v_event_id) then
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

    -- T-ID.A3: the database checks shape only. Interpreting what a person typed (country, formatting) is the
    -- client's job (src/core/phone.js); anything that is not canonical E.164 is refused, never guessed at.
    if not app.is_e164(v_phone) then
      raise exception 'update_roster_entry: that phone number is not valid'
        using hint = 'phone_invalid';
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
$function$;
