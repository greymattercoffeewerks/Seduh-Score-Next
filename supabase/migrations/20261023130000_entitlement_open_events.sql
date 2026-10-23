-- Seduh Score Next · T-GATE.B4: the Community "one open event at a time" rule (D-G20, D-G23), shipped DARK
--
-- Why: the owner decided (2026-10-23) that a Community organisation runs ONE open event at a time, and that "ended" is an
-- explicit, database-owned fact (spec: Handoffs and Specs/GATING-SPEC.md 6d D-G20/D-G22/D-G23). The rule is a new cap key,
-- events_open (community 1, per_event and annual unlimited), checked at event creation; like every key it is seeded
-- unenforced, so nothing changes until an operator flips it (D-G11). Nothing is pushed to the cloud before the BTC pitch.
--
--   * events gains ended_at / ended_by / ended_via ("open" = ended_at is null). They are the database's to write: a
--     member's UPDATE of them is refused 23001, and a client cannot insert them (nulled). Two ways an event ends:
--       - the organiser calls public.finish_event(p_org_id, p_event_id) (a member of that organisation only; the
--         standard refusal for anyone else, whatever ids they guess). One-way: nobody can reopen. It records who and when;
--       - an event whose status becomes 'concluded' (resolve_stage writes it, as an INVOKER function, so the write
--         cannot be told apart from a member's own PATCH) is stamped ended by a trigger. That is safe because the
--         organiser can finish an event at any moment anyway: forging "concluded" gains nothing the Finish action does
--         not already give, and an event in another organisation is out of reach (row-level security).
--     Existing events with status 'concluded' are backfilled as ended (ended_via 'concluded').
--   * app.check_event_create (REPLACED) also applies the rule: for an API caller, if the organisation's events_open limit
--     is not null and it already has that many open events, the insert is refused 42501, hint entitlement_cap_reached,
--     detail events_open. Decided under one advisory lock per organisation. Test events count: events.is_test is
--     member-writable, so exempting them would be bypassable (7a risk 2); a rehearsal is ended with Finish.
--   * public.admin_event_release(p_event_id, p_reason) (audited, event.release): a platform admin ends a stuck event.
--     Reason required; an event that is already ended is a quiet no-op that logs nothing.
--   * app.gating_would_lose (REPLACED) reports, for events_open, the organisations that could not start another event now.
--   * the key itself is added to the catalog (supabase/entitlements.catalog.json) and seeded here from a second embedded
--     block (tagged catalog_add); the contract test checks base seed + additions == the catalog file.
--
-- NOT HERE: the automatic podium publish 24 hours after an event ends (D-G22), the Per-event window lock (G-B5), and the
-- Per-event BTC creation-gate question (owner deciding).
--
-- rollback: (drops the key and the columns; restores the B3 body of check_event_create and the B2 body of gating_would_lose)
--   drop function if exists public.admin_event_release(uuid, text);
--   drop function if exists public.finish_event(uuid, uuid);
--   drop trigger if exists trg_events_ended_guard on public.events;
--   drop function if exists app.guard_event_ended();
--   create or replace function app.gating_would_lose(p_key text)
--   returns table (org_id uuid, org_name text, tier text, detail jsonb)
--   language plpgsql
--   stable
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_key     app.entitlement_keys;
--     v_min     int;
--   begin
--     select * into v_key from app.entitlement_keys where key = p_key;
--     if not found then
--       raise exception 'entitlements: unknown key "%"', p_key
--         using errcode = '22023', hint = 'entitlement_key_unknown';
--     end if;
--
--     if v_key.kind = 'flag' then
--       if v_key.min_tier is null then
--         return;
--       end if;
--       select r.rank into v_min from app.entitlement_tiers r where r.tier = v_key.min_tier;
--       return query
--         select o.id, o.name, e.tier,
--                jsonb_build_object('event_grants', (
--                  select count(*)::int from public.entitlement_grants g
--                   where g.org_id = o.id and g.event_id is not null and g.revoked_at is null
--                     and (not v_key.window_bound or (g.valid_from <= now() and (g.valid_until is null or g.valid_until > now())))))
--           from public.orgs o
--           cross join lateral (select app.effective_tier(o.id, null, now(), not v_key.window_bound) as tier) e
--           join app.entitlement_tiers t on t.tier = e.tier
--          where t.rank < v_min
--          order by o.name, o.id;
--     else
--       return query
--         select o.id, o.name, e.tier,
--                jsonb_build_object(
--                  'limit', c.cap_limit,
--                  'over_limit_events', case when p_key = 'cup_taster_participants' then (
--                    select count(*)::int from public.events ev
--                     where ev.org_id = o.id and ev.format = 'cup_taster'
--                       and (select count(*) from public.event_entries x where x.event_id = ev.id and not x.withdrawn) > c.cap_limit)
--                    else null end)
--           from public.orgs o
--           cross join lateral (select app.effective_tier(o.id, null, now(), not v_key.window_bound) as tier) e
--           join app.entitlement_caps c on c.key = p_key and c.tier = e.tier
--          where c.cap_limit is not null
--            and (p_key <> 'cup_taster_participants' or exists (
--                  select 1 from public.events ev
--                   where ev.org_id = o.id and ev.format = 'cup_taster'
--                     and (select count(*) from public.event_entries x where x.event_id = ev.id and not x.withdrawn) > c.cap_limit))
--          order by o.name, o.id;
--     end if;
--   end;
--   $$;
--   create or replace function app.check_event_create()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   begin
--     perform app.refuse_non_member(new.org_id, 'events');
--     if app.entitlement_api_caller() then
--       -- the snapshot is the database's to write, never the client's
--       new.entitlements_snapshot := null;
--       new.entitlements_snapshot_at := null;
--       if new.format = 'btc' and not app.has_entitlement(new.org_id, 'btc_format') then
--         raise exception 'entitlement_required'
--           using errcode = '42501', hint = 'entitlement_required', detail = 'btc_format';
--       end if;
--     end if;
--     return new;
--   end;
--   $$;
--   delete from app.entitlement_caps where key = 'events_open';
--   delete from app.entitlement_keys where key = 'events_open';
--   alter table public.events drop constraint if exists events_ended_consistent;
--   alter table public.events drop column if exists ended_via;
--   alter table public.events drop column if exists ended_by;
--   alter table public.events drop column if exists ended_at;

alter table public.events add column ended_at timestamptz;
alter table public.events add column ended_by uuid;
alter table public.events add column ended_via text;
alter table public.events add constraint events_ended_consistent
  check ((ended_at is null) = (ended_via is null) and (ended_via is null or ended_via in ('organiser', 'concluded', 'admin_release')));

-- backfill: an event that already concluded is ended (the touch of updated_at is suppressed for these historic rows)
alter table public.events disable trigger trg_events_set_updated_at;
update public.events set ended_at = updated_at, ended_via = 'concluded' where status = 'concluded';
alter table public.events enable trigger trg_events_set_updated_at;

-- ============ the key (a second embedded catalog block; test: src/core/entitlements.contract.test.js) ============

do $seed$
declare
  v_add jsonb := $catalog_add$
{
  "keys": [
    {
      "key": "events_open",
      "kind": "cap",
      "min_tier": null,
      "window_bound": true,
      "note": "Open (not yet ended) events per organisation at a time. Community 1; Per-event and Annual unlimited (D-G20, D-G23). Checked at event creation.",
      "caps": {
        "community": 1,
        "per_event": null,
        "annual": null
      }
    }
  ]
}
$catalog_add$::jsonb;
  k jsonb;
  t record;
begin
  for k in select * from jsonb_array_elements(v_add -> 'keys') loop
    insert into app.entitlement_keys (key, kind, min_tier, enforced, window_bound, note)
    values (k ->> 'key', k ->> 'kind', k ->> 'min_tier', false, coalesce((k ->> 'window_bound')::boolean, true), k ->> 'note');
    if k ->> 'kind' = 'cap' then
      for t in select tier from app.entitlement_tiers loop
        if not ((k -> 'caps') ? t.tier) then
          raise exception 'catalog: cap key % has no entry for tier %', k ->> 'key', t.tier;
        end if;
        insert into app.entitlement_caps (key, tier, cap_limit)
        values (k ->> 'key', t.tier, (k -> 'caps' ->> t.tier)::int);
      end loop;
    end if;
  end loop;
end
$seed$;

-- ============ only the database writes the ended columns ============

create or replace function app.guard_event_ended()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'authenticator', 'service_role') then
    if new.status = 'concluded' and old.status is distinct from 'concluded' and old.ended_at is null then
      -- the automatic end: whatever the client wrote in the ended columns is overwritten
      new.ended_at := now();
      new.ended_by := auth.uid();
      new.ended_via := 'concluded';
    elsif new.ended_at is distinct from old.ended_at
          or new.ended_by is distinct from old.ended_by
          or new.ended_via is distinct from old.ended_via then
      raise exception 'events.ended_at is written by the database only' using errcode = '23001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.guard_event_ended() from public, anon, authenticated, service_role;

create trigger trg_events_ended_guard
  before update of status, ended_at, ended_by, ended_via on public.events
  for each row execute function app.guard_event_ended();

-- ============ the creation rule ============

create or replace function app.check_event_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
begin
  perform app.refuse_non_member(new.org_id, 'events');
  if app.entitlement_api_caller() then
    -- the snapshot is the database's to write, never the client's
    new.entitlements_snapshot := null;
    new.entitlements_snapshot_at := null;
    new.ended_at := null;
    new.ended_by := null;
    new.ended_via := null;
    if new.format = 'btc' and not app.has_entitlement(new.org_id, 'btc_format') then
      raise exception 'entitlement_required'
        using errcode = '42501', hint = 'entitlement_required', detail = 'btc_format';
    end if;
    -- Community runs one open event at a time (D-G20): decided under one lock per organisation, so two devices
    -- creating at once cannot both pass. Test events count (events.is_test is member-writable, 7a risk 2).
    v_limit := app.entitlement_limit(new.org_id, 'events_open');
    if v_limit is not null then
      perform pg_advisory_xact_lock(hashtext('events_open:' || new.org_id::text));
      if (select count(*) from public.events x where x.org_id = new.org_id and x.ended_at is null) >= v_limit then
        raise exception 'entitlement_cap_reached'
          using errcode = '42501', hint = 'entitlement_cap_reached', detail = 'events_open';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ============ the preview ============

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
                 else null end,
               'open_events', case when p_key = 'events_open' then (
                 select count(*)::int from public.events ev where ev.org_id = o.id and ev.ended_at is null)
                 else null end)
        from public.orgs o
        cross join lateral (select app.effective_tier(o.id, null, now(), not v_key.window_bound) as tier) e
        join app.entitlement_caps c on c.key = p_key and c.tier = e.tier
       where c.cap_limit is not null
         -- events_open: the organisations that could not start another event now (open events at or over the limit)
         and (p_key <> 'events_open' or (
               select count(*) from public.events ev where ev.org_id = o.id and ev.ended_at is null) >= c.cap_limit)
         and (p_key <> 'cup_taster_participants' or exists (
               select 1 from public.events ev
                where ev.org_id = o.id and ev.format = 'cup_taster'
                  and (select count(*) from public.event_entries x where x.event_id = ev.id and not x.withdrawn) > c.cap_limit))
       order by o.name, o.id;
  end if;
end;
$$;

-- ============ finish an event (the organiser) ============

create or replace function public.finish_event(p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- one refusal for "not your organisation" and "not that organisation's event": nothing to learn about other tenants
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event_internal(p_event_id)
     or not app.is_org_member(p_org_id) then
    raise exception 'finish_event: event not found' using errcode = '42501';
  end if;

  -- an event that is already ended stays as it is (who and when are the first answer)
  update public.events
     set ended_at = now(), ended_by = auth.uid(), ended_via = 'organiser'
   where id = p_event_id and org_id = p_org_id and ended_at is null;
end;
$$;

revoke all on function public.finish_event(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_event(uuid, uuid) to authenticated;

-- ============ release a stuck event (the platform admin) ============

create or replace function public.admin_event_release(p_event_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ev     public.events;
  v_reason text;
begin
  perform app.require_platform_admin();

  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'admin_event_release: a reason is required'
      using errcode = '22023', hint = 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'admin_event_release: the reason is too long'
      using errcode = '22023', hint = 'reason_too_long';
  end if;

  select * into v_ev from public.events e where e.id = p_event_id for no key update;
  if not found then
    raise exception 'admin_event_release: no such event'
      using errcode = '22023', hint = 'event_not_found';
  end if;
  -- already ended: nothing to do, nothing to log
  if v_ev.ended_at is not null then
    return;
  end if;

  update public.events set ended_at = now(), ended_by = auth.uid(), ended_via = 'admin_release' where id = v_ev.id;

  perform app.admin_audit(
    'event.release', v_ev.org_id, null,
    jsonb_build_object('event_id', v_ev.id, 'from', 'open', 'to', 'released', 'reason', v_reason));
end;
$$;

revoke all on function public.admin_event_release(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_event_release(uuid, text) to authenticated;
