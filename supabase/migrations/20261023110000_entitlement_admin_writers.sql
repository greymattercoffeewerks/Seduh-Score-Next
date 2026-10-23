-- Seduh Score Next · T-GATE.B2: the audited admin functions for grants and the per-key switch (UI-less)
--
-- Why: the entitlement tables (20261023100000) can be read but, by design, not written through the API. The only
-- writers are these platform-admin functions (spec: Handoffs and Specs/GATING-SPEC.md, 3.5, D-G11, D-G14, D-G15, 6b,
-- 6d/6e), until a Plan panel exists the operator calls them like the admin console's own RPCs. Same shape as
-- 20261014130000: SECURITY DEFINER, search_path pinned, `perform app.require_platform_admin()` FIRST (no declare
-- initialiser, no argument default that calls a function), stable hints, a change and its audit row in one
-- transaction, a no-op writes nothing, revoked from public / anon / authenticated / service_role then granted to
-- authenticated only (the gate refuses everyone but a platform admin at aal2 with a fresh TOTP).
--
--   * admin_grant_create(p_org_id, p_tier, p_event_id default null, p_start_offset_days default null,
--                        p_valid_until default null, p_source default 'manual', p_note default null) -> uuid
--       Organisation grant (p_event_id null): valid from now until p_valid_until (null = open-ended); no offset.
--       Event grant (Per-event, D-G15, D-G25): tier must be per_event, the event must be the organisation's and
--       have a date, and p_start_offset_days (-4 to 0, the applicant's choice: T-2 means two days before the
--       competition) positions a window of EXACTLY five calendar days in Asia/Brunei (UTC+8, D-G26) that contains
--       the event date: valid_from is 00:00 Brunei on the first day, valid_until is 00:00 on the day after the fifth
--       (so the window ends at 23:59:59 on its fifth day). The timestamps are stored, not the offset, so editing the
--       event's date afterwards does not move the window. One live window per event (a second purchase is a second
--       event, D-G25; a postponement is grant_extend). Source is manual or default ('payment' is reserved, D-G10).
--   * admin_grant_extend(p_grant_id, p_new_valid_until, p_reason) -> uuid
--       A grant is never edited: an extension is a NEW row (valid from the old end, until the new end) linked by
--       extends_grant_id. The reason is required (non-blank, at most 500 characters). Refused for a revoked grant, an
--       open-ended one, one already extended (extend the latest), or a new end that is not later than the old.
--   * admin_grant_revoke(p_grant_id, p_note default null)
--       Sets revoked_at on that one row (an extension row is revoked on its own). Revoking a revoked grant does
--       nothing and logs nothing.
--   * admin_list_grants(p_org_id) -> jsonb       an organisation's grants, newest first (metadata only).
--   * admin_gating_preview(p_key) -> jsonb       who would be refused if the key were enforced now.
--   * admin_set_key_enforced(p_key, p_enforced, p_confirm)
--       Turning a key ON requires p_confirm to equal the preview's would_lose count (so it cannot be flipped blind);
--       turning it OFF (one call, always allowed) ignores p_confirm. Setting the state it already has does nothing.
--
-- The preview judges an organisation by its ORGANISATION-level tier (event grants are reported as a count, not
-- credited): a conservative over-count, never an under-count. For a cap key it lists organisations whose tier has a
-- limit; for cup_taster_participants only those with an event already over the limit (non-withdrawn entries).
--
-- Audit rows (action, target org, detail keys pinned by test 053):
--   grant.create          org   {grant_id, tier, event_id, valid_from, valid_until, source}
--   grant.extend          org   {grant_id, from_grant_id, tier, event_id, old_valid_until, new_valid_until, reason}
--   grant.revoke          org   {grant_id, tier, event_id, note}
--   gating.key_enforced   -     {key, would_lose}
--   gating.key_relaxed    -     {key}
--
-- Also here: two unique partial indexes that make "one live window per event" and "one live extension per grant"
-- true under concurrency (the functions check first; the indexes are the backstop).
--
-- rollback:
--   drop function if exists public.admin_set_key_enforced(text, boolean, integer);
--   drop function if exists public.admin_gating_preview(text);
--   drop function if exists public.admin_list_grants(uuid);
--   drop function if exists public.admin_grant_revoke(uuid, text);
--   drop function if exists public.admin_grant_extend(uuid, timestamptz, text);
--   drop function if exists public.admin_grant_create(uuid, text, uuid, integer, timestamptz, text, text);
--   drop function if exists app.gating_would_lose(text);
--   drop index if exists public.entitlement_grants_one_extension_per_grant;
--   drop index if exists public.entitlement_grants_one_window_per_event;

create unique index entitlement_grants_one_window_per_event
  on public.entitlement_grants (event_id)
  where event_id is not null and extends_grant_id is null and revoked_at is null;
create unique index entitlement_grants_one_extension_per_grant
  on public.entitlement_grants (extends_grant_id)
  where extends_grant_id is not null and revoked_at is null;

-- ============ the preview rows (shared by the preview and the flip) ============

create or replace function app.gating_would_lose(p_key text)
returns table (org_id uuid, org_name text, tier text, detail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key     app.entitlement_keys;
  v_min     int;
begin
  select * into v_key from app.entitlement_keys where key = p_key;
  if not found then
    raise exception 'entitlements: unknown key "%"', p_key
      using errcode = '22023', hint = 'entitlement_key_unknown';
  end if;

  if v_key.kind = 'flag' then
    if v_key.min_tier is null then
      return;
    end if;
    select r.rank into v_min from app.entitlement_tiers r where r.tier = v_key.min_tier;
    return query
      select o.id, o.name, e.tier,
             jsonb_build_object('event_grants', (
               select count(*)::int from public.entitlement_grants g
                where g.org_id = o.id and g.event_id is not null and g.revoked_at is null
                  and (not v_key.window_bound or (g.valid_from <= now() and (g.valid_until is null or g.valid_until > now())))))
        from public.orgs o
        cross join lateral (select app.effective_tier(o.id, null, now(), not v_key.window_bound) as tier) e
        join app.entitlement_tiers t on t.tier = e.tier
       where t.rank < v_min
       order by o.name, o.id;
  else
    return query
      select o.id, o.name, e.tier,
             jsonb_build_object(
               'limit', c.cap_limit,
               'over_limit_events', case when p_key = 'cup_taster_participants' then (
                 select count(*)::int from public.events ev
                  where ev.org_id = o.id and ev.format = 'cup_taster'
                    and (select count(*) from public.event_entries x where x.event_id = ev.id and not x.withdrawn) > c.cap_limit)
                 else null end)
        from public.orgs o
        cross join lateral (select app.effective_tier(o.id, null, now(), not v_key.window_bound) as tier) e
        join app.entitlement_caps c on c.key = p_key and c.tier = e.tier
       where c.cap_limit is not null
         and (p_key <> 'cup_taster_participants' or exists (
               select 1 from public.events ev
                where ev.org_id = o.id and ev.format = 'cup_taster'
                  and (select count(*) from public.event_entries x where x.event_id = ev.id and not x.withdrawn) > c.cap_limit))
       order by o.name, o.id;
  end if;
end;
$$;

revoke all on function app.gating_would_lose(text) from public, anon, authenticated, service_role;

-- ============ grants ============

create or replace function public.admin_grant_create(
  p_org_id uuid,
  p_tier text,
  p_event_id uuid default null,
  p_start_offset_days integer default null,
  p_valid_until timestamptz default null,
  p_source text default 'manual',
  p_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_date  date;
  v_from  timestamptz;
  v_until timestamptz;
  v_id    uuid;
begin
  perform app.require_platform_admin();

  if p_tier is null or not exists (select 1 from app.entitlement_tiers t where t.tier = p_tier)
     or p_tier = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1) then
    raise exception 'admin_grant_create: unknown tier, or the default tier (no grant needed)'
      using errcode = '22023', hint = 'tier_invalid';
  end if;
  if p_source is null or p_source not in ('manual', 'default') then
    raise exception 'admin_grant_create: source must be manual or default'
      using errcode = '22023', hint = 'source_invalid';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'admin_grant_create: note is too long'
      using errcode = '22023', hint = 'note_invalid';
  end if;

  perform 1 from public.orgs o where o.id = p_org_id for share;
  if not found then
    raise exception 'admin_grant_create: no such organisation'
      using errcode = '22023', hint = 'org_not_found';
  end if;

  if p_event_id is null then
    -- organisation grant: from now, open-ended or until a later instant; no window offset
    if p_start_offset_days is not null then
      raise exception 'admin_grant_create: a window offset only applies to an event grant'
        using errcode = '22023', hint = 'window_invalid';
    end if;
    v_from := now();
    v_until := p_valid_until;
    if v_until is not null and v_until <= v_from then
      raise exception 'admin_grant_create: the end must be in the future'
        using errcode = '22023', hint = 'window_invalid';
    end if;
  else
    -- event grant (Per-event): exactly five Brunei calendar days containing the event date
    if p_tier <> 'per_event' then
      raise exception 'admin_grant_create: an event grant is per_event'
        using errcode = '22023', hint = 'event_grant_tier_invalid';
    end if;
    select e.event_date into v_date
      from public.events e where e.id = p_event_id and e.org_id = p_org_id for share;
    if not found then
      raise exception 'admin_grant_create: no such event in that organisation'
        using errcode = '22023', hint = 'event_not_found';
    end if;
    if v_date is null then
      raise exception 'admin_grant_create: the event has no date'
        using errcode = '22023', hint = 'event_date_required';
    end if;
    if p_start_offset_days is null or p_start_offset_days not between -4 and 0 or p_valid_until is not null then
      raise exception 'admin_grant_create: the window is five days containing the event date (offset -4 to 0, no end given)'
        using errcode = '22023', hint = 'window_invalid';
    end if;
    if exists (select 1 from public.entitlement_grants g
                where g.event_id = p_event_id and g.extends_grant_id is null and g.revoked_at is null) then
      raise exception 'admin_grant_create: that event already has a live window'
        using errcode = '22023', hint = 'grant_exists';
    end if;
    v_from := ((v_date + p_start_offset_days)::timestamp at time zone 'Asia/Brunei');
    v_until := ((v_date + p_start_offset_days + 5)::timestamp at time zone 'Asia/Brunei');
  end if;

  insert into public.entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source, granted_by, note)
  values (p_org_id, p_event_id, p_tier, v_from, v_until, p_source, auth.uid(), p_note)
  returning id into v_id;

  perform app.admin_audit(
    'grant.create', p_org_id, null,
    jsonb_build_object('grant_id', v_id, 'tier', p_tier, 'event_id', p_event_id,
                       'valid_from', v_from, 'valid_until', v_until, 'source', p_source));
  return v_id;
end;
$$;

create or replace function public.admin_grant_extend(
  p_grant_id uuid,
  p_new_valid_until timestamptz,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old public.entitlement_grants;
  v_id  uuid;
  v_reason text;
begin
  perform app.require_platform_admin();

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'admin_grant_extend: a reason is required'
      using errcode = '22023', hint = 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'admin_grant_extend: the reason is too long'
      using errcode = '22023', hint = 'reason_too_long';
  end if;

  select * into v_old from public.entitlement_grants g where g.id = p_grant_id for no key update;
  if not found then
    raise exception 'admin_grant_extend: no such grant'
      using errcode = '22023', hint = 'grant_not_found';
  end if;
  if v_old.revoked_at is not null then
    raise exception 'admin_grant_extend: that grant is revoked'
      using errcode = '22023', hint = 'grant_revoked';
  end if;
  if v_old.valid_until is null then
    raise exception 'admin_grant_extend: that grant is open-ended already'
      using errcode = '22023', hint = 'grant_open_ended';
  end if;
  if exists (select 1 from public.entitlement_grants c where c.extends_grant_id = v_old.id and c.revoked_at is null) then
    raise exception 'admin_grant_extend: that grant was already extended (extend the latest one)'
      using errcode = '22023', hint = 'already_extended';
  end if;
  if p_new_valid_until is null or p_new_valid_until <= v_old.valid_until then
    raise exception 'admin_grant_extend: the new end must be later than the current end'
      using errcode = '22023', hint = 'window_invalid';
  end if;

  insert into public.entitlement_grants
    (org_id, event_id, tier, valid_from, valid_until, source, granted_by, note, extends_grant_id)
  values
    (v_old.org_id, v_old.event_id, v_old.tier, v_old.valid_until, p_new_valid_until, 'manual', auth.uid(), v_reason, v_old.id)
  returning id into v_id;

  perform app.admin_audit(
    'grant.extend', v_old.org_id, null,
    jsonb_build_object('grant_id', v_id, 'from_grant_id', v_old.id, 'tier', v_old.tier, 'event_id', v_old.event_id,
                       'old_valid_until', v_old.valid_until, 'new_valid_until', p_new_valid_until, 'reason', v_reason));
  return v_id;
end;
$$;

create or replace function public.admin_grant_revoke(p_grant_id uuid, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_g public.entitlement_grants;
begin
  perform app.require_platform_admin();

  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'admin_grant_revoke: note is too long'
      using errcode = '22023', hint = 'note_invalid';
  end if;

  select * into v_g from public.entitlement_grants g where g.id = p_grant_id for no key update;
  if not found then
    raise exception 'admin_grant_revoke: no such grant'
      using errcode = '22023', hint = 'grant_not_found';
  end if;
  -- revoking a revoked grant changes nothing and logs nothing
  if v_g.revoked_at is not null then
    return;
  end if;

  update public.entitlement_grants set revoked_at = now() where id = v_g.id;

  perform app.admin_audit(
    'grant.revoke', v_g.org_id, null,
    jsonb_build_object('grant_id', v_g.id, 'tier', v_g.tier, 'event_id', v_g.event_id, 'note', p_note));
end;
$$;

create or replace function public.admin_list_grants(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();

  perform 1 from public.orgs o where o.id = p_org_id;
  if not found then
    raise exception 'admin_list_grants: no such organisation'
      using errcode = '22023', hint = 'org_not_found';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'event_id', g.event_id, 'tier', g.tier, 'valid_from', g.valid_from,
             'valid_until', g.valid_until, 'source', g.source, 'granted_by', g.granted_by, 'note', g.note,
             'extends_grant_id', g.extends_grant_id, 'revoked_at', g.revoked_at, 'created_at', g.created_at)
           order by g.created_at desc, g.id)
      from public.entitlement_grants g
     where g.org_id = p_org_id), '[]'::jsonb);
end;
$$;

-- ============ the per-key switch ============

create or replace function public.admin_gating_preview(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key app.entitlement_keys;
  v_n   int;
  v_orgs jsonb;
begin
  perform app.require_platform_admin();

  select * into v_key from app.entitlement_keys where key = p_key;
  if not found then
    raise exception 'admin_gating_preview: unknown key'
      using errcode = '22023', hint = 'entitlement_key_unknown';
  end if;

  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object('org_id', w.org_id, 'name', w.org_name, 'tier', w.tier, 'detail', w.detail)
                            order by w.org_name, w.org_id) filter (where w.rn <= 200), '[]'::jsonb)
    into v_n, v_orgs
    from (select x.*, row_number() over (order by x.org_name, x.org_id) as rn from app.gating_would_lose(p_key) x) w;

  return jsonb_build_object('key', v_key.key, 'kind', v_key.kind, 'min_tier', v_key.min_tier,
                            'enforced', v_key.enforced, 'would_lose', v_n, 'organisations', v_orgs);
end;
$$;

create or replace function public.admin_set_key_enforced(p_key text, p_enforced boolean, p_confirm integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key app.entitlement_keys;
  v_n   int;
begin
  perform app.require_platform_admin();

  if p_enforced is null then
    raise exception 'admin_set_key_enforced: say on or off'
      using errcode = '22023', hint = 'enforced_invalid';
  end if;

  select * into v_key from app.entitlement_keys k where k.key = p_key for update;
  if not found then
    raise exception 'admin_set_key_enforced: unknown key'
      using errcode = '22023', hint = 'entitlement_key_unknown';
  end if;

  -- the state it already has: nothing to do, nothing to log
  if v_key.enforced = p_enforced then
    return;
  end if;

  if p_enforced then
    select count(*)::int into v_n from app.gating_would_lose(p_key);
    if p_confirm is distinct from v_n then
      raise exception 'admin_set_key_enforced: confirm must equal the preview count (%)', v_n
        using errcode = '22023', hint = 'confirm_mismatch';
    end if;
  end if;

  update app.entitlement_keys set enforced = p_enforced where key = p_key;

  if p_enforced then
    perform app.admin_audit('gating.key_enforced', null, null, jsonb_build_object('key', p_key, 'would_lose', v_n));
  else
    perform app.admin_audit('gating.key_relaxed', null, null, jsonb_build_object('key', p_key));
  end if;
end;
$$;

revoke all on function public.admin_grant_create(uuid, text, uuid, integer, timestamptz, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_extend(uuid, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_revoke(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_grants(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_gating_preview(text) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_key_enforced(text, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_grant_create(uuid, text, uuid, integer, timestamptz, text, text) to authenticated;
grant execute on function public.admin_grant_extend(uuid, timestamptz, text) to authenticated;
grant execute on function public.admin_grant_revoke(uuid, text) to authenticated;
grant execute on function public.admin_list_grants(uuid) to authenticated;
grant execute on function public.admin_gating_preview(text) to authenticated;
grant execute on function public.admin_set_key_enforced(text, boolean, integer) to authenticated;
