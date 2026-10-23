-- Seduh Score Next · T-GATE.C: what the admin console's Plan panel needs from the database
--
-- Why: the Plan panel (step 3 of the gating plan; spec: Handoffs and Specs/GATING-SPEC.md D-G9, D-G10, D-G14, 6b to 6e)
-- drives the existing audited functions (grant create / extend / revoke, key preview and flip, event re-snapshot and
-- release). It needs a few READ functions to draw itself and ONE new write: the manual payment confirmation. Billing
-- stays manual and there is no billing code: a confirmation is the operator saying "this was paid", recorded as a grant
-- whose source is 'payment' (reserved since D-G10) plus an audit row that names the amount note.
--
--   * public.admin_list_keys() -> jsonb: every key (kind, minimum tier, enforced, window_bound, note, caps by tier).
--   * public.admin_plan_orgs() -> jsonb: every organisation with its current organisation-level tier and counts.
--   * public.admin_plan_org(p_org_id) -> jsonb: one organisation's plan: its tier now, every grant (organisation and event
--     scoped), its events as METADATA (name, date, format, state: open / ended / released, the tier its go-live snapshot
--     froze, when its Per-event window ends and whether that window has ended) and, per key, whether the organisation would
--     pass the key if it were enforced (and its limit). OPEN DECISION recorded in the PR: D-A4 says the console shows "no
--     event"; choosing the event for a Per-event grant needs the event's name, date and format, so they are returned HERE
--     and only here (admin_org_detail and the audit views are unchanged). No score, entry, person, phone or e-mail.
--   * public.admin_payment_confirm(p_org_id, p_tier, p_event_id, p_start_offset_days, p_valid_until, p_amount_note) -> uuid:
--     creates the grant with source 'payment' (the same rules as admin_grant_create: an event grant is a per_event
--     five-Brunei-day window containing the event date; an organisation grant is per_event or annual) and requires a
--     non-blank amount note (at most 200 characters; hints amount_required, amount_too_long). Audit action payment.confirm.
--
-- REFACTOR (no behaviour change; pgTAP 053 still passes untouched): the grant validation and insert move out of
-- admin_grant_create into app.grant_insert, so the payment confirmation cannot drift from it. admin_grant_create still
-- opens with the platform-admin gate, still refuses source 'payment' (source_invalid: a payment is recorded only through
-- admin_payment_confirm), and still writes grant.create with the same keys, in the same order of refusals.
--
-- Audit rows added (keys pinned by pgTAP 057):
--   payment.confirm   org   {grant_id, tier, event_id, valid_from, valid_until, payment_note}
--
-- rollback: (drops the new functions and restores the previous admin_grant_create)
--   drop function if exists public.admin_payment_confirm(uuid, text, uuid, integer, timestamptz, text);
--   drop function if exists public.admin_plan_org(uuid);
--   drop function if exists public.admin_plan_orgs();
--   drop function if exists public.admin_list_keys();
--   CREATE OR REPLACE FUNCTION public.admin_grant_create(p_org_id uuid, p_tier text, p_event_id uuid DEFAULT NULL::uuid, p_start_offset_days integer DEFAULT NULL::integer, p_valid_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT 'manual'::text, p_note text DEFAULT NULL::text)
--    RETURNS uuid
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_date  date;
--     v_from  timestamptz;
--     v_until timestamptz;
--     v_id    uuid;
--   begin
--     perform app.require_platform_admin();
--
--     if p_tier is null or not exists (select 1 from app.entitlement_tiers t where t.tier = p_tier)
--        or p_tier = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1) then
--       raise exception 'admin_grant_create: unknown tier, or the default tier (no grant needed)'
--         using errcode = '22023', hint = 'tier_invalid';
--     end if;
--     if p_source is null or p_source not in ('manual', 'default') then
--       raise exception 'admin_grant_create: source must be manual or default'
--         using errcode = '22023', hint = 'source_invalid';
--     end if;
--     if p_note is not null and char_length(p_note) > 500 then
--       raise exception 'admin_grant_create: note is too long'
--         using errcode = '22023', hint = 'note_invalid';
--     end if;
--
--     perform 1 from public.orgs o where o.id = p_org_id for share;
--     if not found then
--       raise exception 'admin_grant_create: no such organisation'
--         using errcode = '22023', hint = 'org_not_found';
--     end if;
--
--     if p_event_id is null then
--       -- organisation grant: from now, open-ended or until a later instant; no window offset
--       if p_start_offset_days is not null then
--         raise exception 'admin_grant_create: a window offset only applies to an event grant'
--           using errcode = '22023', hint = 'window_invalid';
--       end if;
--       v_from := now();
--       v_until := p_valid_until;
--       if v_until is not null and v_until <= v_from then
--         raise exception 'admin_grant_create: the end must be in the future'
--           using errcode = '22023', hint = 'window_invalid';
--       end if;
--     else
--       -- event grant (Per-event): exactly five Brunei calendar days containing the event date
--       if p_tier <> 'per_event' then
--         raise exception 'admin_grant_create: an event grant is per_event'
--           using errcode = '22023', hint = 'event_grant_tier_invalid';
--       end if;
--       select e.event_date into v_date
--         from public.events e where e.id = p_event_id and e.org_id = p_org_id
--          for update;   -- serialises two creates for one event: the loser gets grant_exists, not a raw 23505
--       if not found then
--         raise exception 'admin_grant_create: no such event in that organisation'
--           using errcode = '22023', hint = 'event_not_found';
--       end if;
--       if v_date is null then
--         raise exception 'admin_grant_create: the event has no date'
--           using errcode = '22023', hint = 'event_date_required';
--       end if;
--       if p_start_offset_days is null or p_start_offset_days not between -4 and 0 or p_valid_until is not null then
--         raise exception 'admin_grant_create: the window is five days containing the event date (offset -4 to 0, no end given)'
--           using errcode = '22023', hint = 'window_invalid';
--       end if;
--       -- any live row for the event counts, an extension included (revoking a base window leaves its extension live)
--       if exists (select 1 from public.entitlement_grants g
--                   where g.event_id = p_event_id and g.revoked_at is null) then
--         raise exception 'admin_grant_create: that event already has a live window'
--           using errcode = '22023', hint = 'grant_exists';
--       end if;
--       v_from := ((v_date + p_start_offset_days)::timestamp at time zone 'Asia/Brunei');
--       v_until := ((v_date + p_start_offset_days + 5)::timestamp at time zone 'Asia/Brunei');
--     end if;
--
--     insert into public.entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source, granted_by, note)
--     values (p_org_id, p_event_id, p_tier, v_from, v_until, p_source, auth.uid(), p_note)
--     returning id into v_id;
--
--     perform app.admin_audit(
--       'grant.create', p_org_id, null,
--       jsonb_build_object('grant_id', v_id, 'tier', p_tier, 'event_id', p_event_id,
--                          'valid_from', v_from, 'valid_until', v_until, 'source', p_source));
--     return v_id;
--   end;
--   $function$;
--   drop function if exists app.grant_insert(uuid, text, uuid, integer, timestamptz, text, text, boolean);

-- ============ the shared grant insert (moved out of admin_grant_create) ============

create or replace function app.grant_insert(
  p_org_id uuid,
  p_tier text,
  p_event_id uuid,
  p_start_offset_days integer,
  p_valid_until timestamptz,
  p_source text,
  p_note text,
  p_allow_payment boolean
)
returns public.entitlement_grants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_date  date;
  v_from  timestamptz;
  v_until timestamptz;
  v_row   public.entitlement_grants;
begin
  if p_tier is null or not exists (select 1 from app.entitlement_tiers t where t.tier = p_tier)
     or p_tier = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1) then
    raise exception 'admin_grant_create: unknown tier, or the default tier (no grant needed)'
      using errcode = '22023', hint = 'tier_invalid';
  end if;
  if p_source is null or not (p_source in ('manual', 'default') or (p_allow_payment and p_source = 'payment')) then
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
      from public.events e where e.id = p_event_id and e.org_id = p_org_id
       for update;   -- serialises two creates for one event: the loser gets grant_exists, not a raw 23505
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
    -- any live row for the event counts, an extension included (revoking a base window leaves its extension live)
    if exists (select 1 from public.entitlement_grants g
                where g.event_id = p_event_id and g.revoked_at is null) then
      raise exception 'admin_grant_create: that event already has a live window'
        using errcode = '22023', hint = 'grant_exists';
    end if;
    v_from := ((v_date + p_start_offset_days)::timestamp at time zone 'Asia/Brunei');
    v_until := ((v_date + p_start_offset_days + 5)::timestamp at time zone 'Asia/Brunei');
  end if;

  insert into public.entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source, granted_by, note)
  values (p_org_id, p_event_id, p_tier, v_from, v_until, p_source, auth.uid(), p_note)
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function app.grant_insert(uuid, text, uuid, integer, timestamptz, text, text, boolean)
  from public, anon, authenticated, service_role;

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
  v_row public.entitlement_grants;
begin
  perform app.require_platform_admin();

  v_row := app.grant_insert(p_org_id, p_tier, p_event_id, p_start_offset_days, p_valid_until, p_source, p_note, false);

  perform app.admin_audit(
    'grant.create', p_org_id, null,
    jsonb_build_object('grant_id', v_row.id, 'tier', p_tier, 'event_id', p_event_id,
                       'valid_from', v_row.valid_from, 'valid_until', v_row.valid_until, 'source', p_source));
  return v_row.id;
end;
$$;

-- ============ the manual payment confirmation ============

create or replace function public.admin_payment_confirm(
  p_org_id uuid,
  p_tier text,
  p_event_id uuid default null,
  p_start_offset_days integer default null,
  p_valid_until timestamptz default null,
  p_amount_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text;
  v_row  public.entitlement_grants;
begin
  perform app.require_platform_admin();

  v_note := btrim(coalesce(p_amount_note, ''));
  if v_note = '' then
    raise exception 'admin_payment_confirm: an amount note is required'
      using errcode = '22023', hint = 'amount_required';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'admin_payment_confirm: the amount note is too long'
      using errcode = '22023', hint = 'amount_too_long';
  end if;

  v_row := app.grant_insert(p_org_id, p_tier, p_event_id, p_start_offset_days, p_valid_until, 'payment', v_note, true);

  perform app.admin_audit(
    'payment.confirm', p_org_id, null,
    jsonb_build_object('grant_id', v_row.id, 'tier', p_tier, 'event_id', p_event_id,
                       'valid_from', v_row.valid_from, 'valid_until', v_row.valid_until, 'payment_note', v_note));
  return v_row.id;
end;
$$;

-- ============ reads ============

create or replace function public.admin_list_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', k.key, 'kind', k.kind, 'min_tier', k.min_tier, 'enforced', k.enforced,
             'window_bound', k.window_bound, 'note', k.note,
             'caps', case when k.kind = 'cap' then (
                       select jsonb_object_agg(c.tier, c.cap_limit) from app.entitlement_caps c where c.key = k.key)
                     else null end)
           order by k.key)
      from app.entitlement_keys k), '[]'::jsonb);
end;
$$;

create or replace function public.admin_plan_orgs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'org_id', o.id, 'name', o.name, 'slug', o.slug,
             'tier', app.effective_tier(o.id, null, now()),
             'event_grants', (select count(*)::int from public.entitlement_grants g
                               where g.org_id = o.id and g.event_id is not null and g.revoked_at is null),
             'locked_events', (select count(*)::int from public.events e
                                where e.org_id = o.id and app.event_window_ended(e.id, now())))
           order by o.name, o.id)
      from public.orgs o), '[]'::jsonb);
end;
$$;

create or replace function public.admin_plan_org(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org  public.orgs;
  v_tier text;
  v_rank int;
begin
  perform app.require_platform_admin();

  select * into v_org from public.orgs o where o.id = p_org_id;
  if not found then
    raise exception 'admin_plan_org: no such organisation'
      using errcode = '22023', hint = 'org_not_found';
  end if;
  v_tier := app.effective_tier(v_org.id, null, now());
  select t.rank into v_rank from app.entitlement_tiers t where t.tier = v_tier;

  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'slug', v_org.slug),
    'tier', v_tier,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'event_id', g.event_id, 'tier', g.tier, 'valid_from', g.valid_from,
               'valid_until', g.valid_until, 'source', g.source, 'granted_by', g.granted_by, 'note', g.note,
               'extends_grant_id', g.extends_grant_id, 'revoked_at', g.revoked_at, 'created_at', g.created_at)
             order by g.created_at desc, g.id)
        from public.entitlement_grants g where g.org_id = v_org.id), '[]'::jsonb),
    -- the organisation's events as metadata only, newest first, at most 200
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'name', e.name, 'format', e.format, 'event_date', e.event_date, 'is_test', e.is_test,
               'ended_via', e.ended_via, 'ended_at', e.ended_at,
               'snapshot_tier', e.entitlements_snapshot ->> 'tier',
               'window_ends_at', (select max(g.valid_until) from public.entitlement_grants g
                                   where g.event_id = e.id and g.revoked_at is null and g.valid_until is not null),
               'window_ended', app.event_window_ended(e.id, now()),
               'has_window', exists (select 1 from public.entitlement_grants g where g.event_id = e.id and g.revoked_at is null))
             order by e.created_at desc, e.id)
        from (select * from public.events x where x.org_id = v_org.id order by x.created_at desc, x.id limit 200) e), '[]'::jsonb),
    -- per key: would this organisation (at its organisation-level tier) pass the key if it were enforced?
    'keys', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', k.key, 'kind', k.kind, 'enforced', k.enforced,
               'allowed_if_enforced', case
                  when k.kind = 'cap' then coalesce((select c.cap_limit is null or c.cap_limit > 0 from app.entitlement_caps c
                                                       where c.key = k.key and c.tier = v_tier), true)
                  when k.min_tier is null then true
                  else v_rank >= (select m.rank from app.entitlement_tiers m where m.tier = k.min_tier) end,
               'limit', case when k.kind = 'cap' then (select c.cap_limit from app.entitlement_caps c
                                                         where c.key = k.key and c.tier = v_tier) else null end)
             order by k.key)
        from app.entitlement_keys k), '[]'::jsonb));
end;
$$;

revoke all on function public.admin_payment_confirm(uuid, text, uuid, integer, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_plan_org(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_plan_orgs() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_keys() from public, anon, authenticated, service_role;
grant execute on function public.admin_payment_confirm(uuid, text, uuid, integer, timestamptz, text) to authenticated;
grant execute on function public.admin_plan_org(uuid) to authenticated;
grant execute on function public.admin_plan_orgs() to authenticated;
grant execute on function public.admin_list_keys() to authenticated;
