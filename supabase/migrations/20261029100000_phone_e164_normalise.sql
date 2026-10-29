-- Seduh Score Next · T-ID.A3 (part 1 of 2): the SQL port of phone normalisation, and update_roster_entry using it
--
-- Why: Seduh ID Layer 1 keys a person on a validated E.164 phone (Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md
-- 3.3, 4.2). src/core/phone.js normalises in the client, but update_roster_entry only trimmed the phone, so any
-- caller that skipped the client wrote whatever it liked to people.phone. This migration:
--   * adds app.normalize_phone(raw, default_country_code): a port of normalizePhone() in src/core/phone.js
--     (digits only; a leading '+' or '00' means "country code typed"; otherwise the default '+673' is prefixed);
--   * adds app.is_e164(text): the E164_PATTERN of the same file, '^\+[1-9][0-9]{7,14}$';
--   * adds app.phone_repair_class(raw): the classification the owner-run audit and repair scripts use (valid /
--     repairable_format / repairable_default_country / ambiguous / not_a_phone / null_phone). One home for the
--     rule, so the dry-run, the repair, update_roster_entry and the tests cannot drift apart;
--   * makes update_roster_entry normalise the phone it is given and refuse one that is not a phone (class
--     not_a_phone: under 7 digits, over 15, or not phone characters) or is still not E.164 (hint 'phone_invalid').
--     The extra not_a_phone test matters: normalizePhone() prefixes +673 to ANY digits, so '12345' would become
--     '+67312345', which has a valid E.164 SHAPE but is junk. It checks the argument as received, so it guards
--     direct callers; a client that normalises first (the roster UI does) sends '+67312345' and is not caught
--     (T-ID.A2 closes that in the client).
--     DELIBERATE, owner to confirm: a bare 9-15 digit input (class 'ambiguous', e.g. '6738123456') is NOT refused
--     here; it is normalised with +673 exactly as the client does. The audit and repair scripts never guess these
--     for LEGACY rows; refusing them for new input would need the client to tell the user to type the '+'. It starts from the CURRENT body (20261011140000, which carries the null-org guard), not
--     20261007100000. The unique(org_id, phone) lookup therefore compares the normalised value: a local-format
--     number that collides with a stored +673 number is reported as the same CONFLICT, never silently merged.
--
-- THIS MIGRATION IS SAFE TO PUSH BEFORE ANY DATA REPAIR: it changes no row and adds no constraint. The only
-- behaviour change is that update_roster_entry now rejects a phone that cannot be normalised to E.164.
-- The people_phone_e164 CHECK is the NEXT migration (20261029110000) and MUST NOT be pushed until the repair
-- (supabase/scripts/people_phone_repair.sql, owner-run) has been done and supabase/scripts/people_phone_audit.sql
-- shows every row valid.
--
-- Known differences from the JS: the port strips with [^0-9], as JS \D does, so non-ASCII digits are dropped in
-- both; leading/trailing whitespace is trimmed with \s, which in Postgres may differ from JS trim() for a few
-- exotic Unicode spaces (the digit strip removes them anyway, except at a leading '+' test).
--
-- rollback: (restores the exact 20261011140000 body of update_roster_entry, then drops the three functions)
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
--   drop function app.normalize_phone(text, text);

-- Mirrors normalizePhone() in src/core/phone.js. Pure. NULL in, NULL out; blank or digit-less input gives ''.
create or replace function app.normalize_phone(p_raw text, p_default_country_code text default '+673')
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_trim text;
  v_digits text;
begin
  if p_raw is null then
    return null;
  end if;
  v_trim := regexp_replace(p_raw, '^\s+|\s+$', '', 'g');
  if v_trim = '' then
    return '';
  end if;
  v_digits := regexp_replace(v_trim, '[^0-9]', '', 'g');
  if v_digits = '' then
    return '';
  end if;
  if left(v_trim, 1) = '+' then
    return '+' || v_digits;
  end if;
  if left(v_digits, 2) = '00' then
    return '+' || substr(v_digits, 3);
  end if;
  return p_default_country_code || v_digits;
end;
$$;

-- E.164's own bounds: '+', a non-zero digit, then 7 to 14 more digits. The same pattern as the client and the
-- people_phone_e164 CHECK. NULL is not E.164.
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
--   repairable_format          carries its own country code ('+' or '00') and is E.164 once punctuation is stripped
--   repairable_default_country a bare 7 or 8 digit local number: '+673' is added (owner decision, repair default +673)
--   ambiguous                  a bare 9 to 15 digit number: it may already carry a country code typed without '+', or
--                              be a mistyped local number; reported to the organiser, never repaired
--   not_a_phone                under 7 digits, too long, or characters a phone does not have
--   null_phone                 no value
-- Bare means no leading '+' and no leading '00'. Characters other than digits, spaces, '(', ')', '-', '.', '/' and a
-- LEADING '+' make a value not_a_phone.
create or replace function app.phone_repair_class(p_raw text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_trim text;
  v_digits text;
  v_len int;
begin
  if p_raw is null then
    return 'null_phone';
  end if;
  if app.is_e164(p_raw) then
    return 'valid';
  end if;
  v_trim := regexp_replace(p_raw, '^\s+|\s+$', '', 'g');
  if v_trim !~ '^\+?[0-9 ()./-]*$' then
    return 'not_a_phone';
  end if;
  v_digits := regexp_replace(v_trim, '[^0-9]', '', 'g');
  v_len := length(v_digits);
  if left(v_trim, 1) = '+' then
    return case when app.is_e164('+' || v_digits) then 'repairable_format' else 'not_a_phone' end;
  end if;
  if left(v_digits, 2) = '00' then
    return case when app.is_e164('+' || substr(v_digits, 3)) then 'repairable_format' else 'not_a_phone' end;
  end if;
  if v_len < 7 or v_len > 15 then
    return 'not_a_phone';
  end if;
  if v_len <= 8 then
    return 'repairable_default_country';
  end if;
  return 'ambiguous';
end;
$$;

-- update_roster_entry calls all three as the signed-in caller (it is SECURITY INVOKER). They are pure: they read no
-- table and return a function of their argument only.
revoke execute on function app.normalize_phone(text, text) from public, anon;
grant execute on function app.normalize_phone(text, text) to authenticated, service_role;
revoke execute on function app.is_e164(text) from public, anon;
grant execute on function app.is_e164(text) to authenticated, service_role;
revoke execute on function app.phone_repair_class(text) from public, anon;
grant execute on function app.phone_repair_class(text) to authenticated, service_role;

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

    -- Normalise (T-ID.A3): the stored phone is always E.164, whatever the caller typed. A value that is still
    -- not E.164 afterwards is refused, never stored. The unique lookup below then compares normalised values.
    if app.phone_repair_class(v_phone) = 'not_a_phone' then
      raise exception 'update_roster_entry: that phone number is not valid'
        using hint = 'phone_invalid';
    end if;
    v_phone := app.normalize_phone(v_phone);
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
