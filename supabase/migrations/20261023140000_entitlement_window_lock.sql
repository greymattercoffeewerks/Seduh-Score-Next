-- Seduh Score Next · T-GATE.B5: the Per-event window lock (G-B5, D-G15), shipped DARK
--
-- Why: a Per-event purchase gives an event a 5-day window (5 Brunei calendar days containing the event date; stored as
-- timestamps by admin_grant_create). The owner's rule (spec: Handoffs and Specs/GATING-SPEC.md 6b "The Per-event window",
-- 6d/6e, 2026-10-23): once that window has ended, the event's WORKSPACE (setup, roster, heats, timing, scoring, standings,
-- report) and its LIVE DISPLAYS (projector, phone, splash) are gone; only the public archive page still shows results. An
-- admin extension re-opens it. This deliberately overrides "a lapse never bricks a live competition" for Per-event only.
-- Like every key it is seeded unenforced (key event_window_lock), so nothing changes until an operator flips it (D-G11).
-- Nothing is pushed to the cloud before the BTC pitch.
--
-- WHEN IS AN EVENT LOCKED (app.event_window_ended, and app.event_window_locked = the key is enforced AND ended):
--   all of: (1) the organisation's OWN tier is the lowest (no organisation-level plan: an Annual or organisation-level
--   per_event organisation is never locked); (2) the event has at least one non-revoked event grant whose window has ended;
--   (3) the event has NO non-revoked event grant that is current now. So a Community-only event (never granted) is not
--   locked, a revoked grant does not lock (an event with only revoked grants is a Community event again; only an EXPIRED
--   window locks), a grant that has not started yet does not lock, and a grant on a DIFFERENT event never counts.
--   An extension (admin_grant_extend) is a new row that starts where the old one ended, so it is current and the event opens
--   again at once. Keys with window_bound = false (registration_page) are not affected: they never consult this.
--
-- HOW IT IS ENFORCED (the database is the boundary): a RESTRICTIVE row-level-security policy on every event-scoped table,
-- applying to reads AND writes, ANDed with the existing policies. Every workspace RPC is SECURITY INVOKER, so the same
-- policies bind them: a locked event reads as empty and refuses writes (a write is refused 42501 by row-level security).
--   locked tables: event_entries, ct_stages, ct_sets, ct_stage_entries, ct_heats, ct_heat_entries, ct_results, btc_teams,
--   btc_judges, btc_matches, btc_match_judges, btc_cup_votes, btc_match_bonuses, btc_bracket_slots,
--   btc_seeding_tiebreaks (all commands, signed-in), live_sessions (all commands signed-in, and SELECT for anon, so the
--   projector, phone and splash stop serving the event), score_change_log (SELECT).
--   DELIBERATELY NOT LOCKED: the events row (the organiser still sees the event, its state and can delete it), people and
--   person_merges (organisation-level), public_results (the archive: publishing and unpublishing stay fail-open, per the
--   plan), org-level ledgers, the entitlement tables. get_scoring_record stays: it exists only for a published result, so it
--   is part of the archive. The views (btc_standings and friends) are security_invoker, so they follow their tables.
--   The anonymous door public_event_summary no longer offers a locked event as "the live event".
-- Each policy is `not coalesce(<the row's event> in (select app.window_locked_events()), false)`: the set of locked events is
-- an uncorrelated subquery (computed once per statement, then a hash probe per row), and it is EMPTY while the key is
-- unenforced, so the dark phase is behaviour-neutral. The event of a chain table (ct_results, btc_cup_votes ...) is found by
-- the event_id_for_* resolvers.
--
-- ALSO: app.gating_would_lose (REPLACED) lists, for event_window_lock, the organisations that have a locked event now
-- (detail locked_events); public.my_entitlements (REPLACED) adds {window: {ends_at, locked}} for a named event so the UI can
-- warn before the end and show the locked state; public.public_event_summary (REPLACED) skips locked events.
--
-- NOT HERE: the automatic CSV email at window end (G-F1), the 24-hour podium publish (D-G22).
--
-- rollback: (drops the policies, functions and key; restores the previous bodies of the three replaced functions)
--   drop policy if exists btc_bracket_slots_window_lock on public.btc_bracket_slots;
--   drop policy if exists btc_cup_votes_window_lock on public.btc_cup_votes;
--   drop policy if exists btc_judges_window_lock on public.btc_judges;
--   drop policy if exists btc_match_bonuses_window_lock on public.btc_match_bonuses;
--   drop policy if exists btc_match_judges_window_lock on public.btc_match_judges;
--   drop policy if exists btc_matches_window_lock on public.btc_matches;
--   drop policy if exists btc_seeding_tiebreaks_window_lock on public.btc_seeding_tiebreaks;
--   drop policy if exists btc_teams_window_lock on public.btc_teams;
--   drop policy if exists ct_heat_entries_window_lock on public.ct_heat_entries;
--   drop policy if exists ct_heats_window_lock on public.ct_heats;
--   drop policy if exists ct_results_window_lock on public.ct_results;
--   drop policy if exists ct_sets_window_lock on public.ct_sets;
--   drop policy if exists ct_stage_entries_window_lock on public.ct_stage_entries;
--   drop policy if exists ct_stages_window_lock on public.ct_stages;
--   drop policy if exists event_entries_window_lock on public.event_entries;
--   drop policy if exists live_sessions_window_lock on public.live_sessions;
--   drop policy if exists live_sessions_window_lock_anon on public.live_sessions;
--   drop policy if exists score_change_log_window_lock on public.score_change_log;
--   CREATE OR REPLACE FUNCTION public.public_event_summary(p_org_id uuid)
--    RETURNS TABLE(id uuid, name text, event_date date, is_test boolean)
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select e.id, e.name, e.event_date, e.is_test
--     from public.events e
--     left join public.live_sessions ls on ls.event_id = e.id and ls.active
--     where e.org_id = p_org_id
--     order by (ls.id is not null) desc, e.is_test asc, e.created_at desc, e.id desc
--     limit 1;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.my_entitlements(p_org uuid, p_event uuid DEFAULT NULL::uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_keys jsonb := '{}'::jsonb;
--     k      record;
--   begin
--     -- One refusal for "not your organisation" and "not that organisation's event": no oracle on other tenants.
--     if not app.is_org_member(p_org)
--        or (p_event is not null and app.org_id_for_event_internal(p_event) is distinct from p_org) then
--       raise exception 'my_entitlements: organisation not found' using errcode = '42501';
--     end if;
--     for k in select * from app.entitlement_keys order by key loop
--       v_keys := v_keys || jsonb_build_object(
--         k.key,
--         case when k.kind = 'cap'
--           then jsonb_build_object(
--             'allowed', app.has_entitlement(p_org, k.key, p_event),
--             'limit', app.entitlement_limit(p_org, k.key, p_event))
--           else jsonb_build_object('allowed', app.has_entitlement(p_org, k.key, p_event)) end);
--     end loop;
--     return jsonb_build_object('tier', app.resolved_tier(p_org, p_event), 'keys', v_keys);
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION app.gating_would_lose(p_key text)
--    RETURNS TABLE(org_id uuid, org_name text, tier text, detail jsonb)
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
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
--                    else null end,
--                  'open_events', case when p_key = 'events_open' then (
--                    select count(*)::int from public.events ev where ev.org_id = o.id and ev.ended_at is null)
--                    else null end)
--           from public.orgs o
--           cross join lateral (select app.effective_tier(o.id, null, now(), not v_key.window_bound) as tier) e
--           join app.entitlement_caps c on c.key = p_key and c.tier = e.tier
--          where c.cap_limit is not null
--            -- events_open: the organisations that could not start another event now (open events at or over the limit)
--            and (p_key <> 'events_open' or (
--                  select count(*) from public.events ev where ev.org_id = o.id and ev.ended_at is null) >= c.cap_limit)
--            and (p_key <> 'cup_taster_participants' or exists (
--                  select 1 from public.events ev
--                   where ev.org_id = o.id and ev.format = 'cup_taster'
--                     and (select count(*) from public.event_entries x where x.event_id = ev.id and not x.withdrawn) > c.cap_limit))
--          order by o.name, o.id;
--     end if;
--   end;
--   $function$;
--   create or replace function app.btc_delete_event_children()
--   returns trigger
--   language plpgsql
--   set search_path = ''
--   as $$
--   begin
--     delete from public.btc_bracket_slots where event_id = old.id;
--     delete from public.btc_matches where event_id = old.id;
--     return old;
--   end;
--   $$;
--   drop function if exists app.window_locked_events();
--   drop function if exists app.event_window_locked(uuid, timestamptz);
--   drop function if exists app.event_window_ended(uuid, timestamptz);
--   drop function if exists app.window_lock_on();
--   drop function if exists app.event_id_for_btc_match_internal(uuid);
--   drop function if exists app.event_id_for_heat_entry_internal(uuid);
--   drop function if exists app.event_id_for_heat_internal(uuid);
--   drop function if exists app.event_id_for_stage_internal(uuid);
--   delete from app.entitlement_keys where key = 'event_window_lock';

-- ============ the key (a third embedded catalog block; test: src/core/entitlements.contract.test.js) ============

do $seed$
declare
  v_add jsonb := $catalog_add$
{
  "keys": [
    {
      "key": "event_window_lock",
      "kind": "flag",
      "min_tier": null,
      "window_bound": true,
      "note": "The Per-event window lock: after a Per-event event grant's 5-day window ends, the event workspace and live displays are closed until an admin extends it (G-B5, D-G15). Community and Annual are unaffected."
    }
  ]
}
$catalog_add$::jsonb;
  k jsonb;
begin
  for k in select * from jsonb_array_elements(v_add -> 'keys') loop
    insert into app.entitlement_keys (key, kind, min_tier, enforced, window_bound, note)
    values (k ->> 'key', k ->> 'kind', k ->> 'min_tier', false, coalesce((k ->> 'window_bound')::boolean, true), k ->> 'note');
  end loop;
end
$seed$;

-- ============ resolvers: which event does a row belong to (no caller context, like the org_id_for_*_internal ones) ============

create or replace function app.event_id_for_stage_internal(p_stage_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select event_id from public.ct_stages where id = p_stage_id; $$;

create or replace function app.event_id_for_heat_internal(p_heat_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select app.event_id_for_stage_internal(stage_id) from public.ct_heats where id = p_heat_id; $$;

create or replace function app.event_id_for_heat_entry_internal(p_heat_entry_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select app.event_id_for_heat_internal(heat_id) from public.ct_heat_entries where id = p_heat_entry_id; $$;

create or replace function app.event_id_for_btc_match_internal(p_match_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select event_id from public.btc_matches where id = p_match_id; $$;

revoke all on function app.event_id_for_stage_internal(uuid), app.event_id_for_heat_internal(uuid),
  app.event_id_for_heat_entry_internal(uuid), app.event_id_for_btc_match_internal(uuid)
  from public, anon, authenticated, service_role;
-- the policies below call these as the signed-in role
grant execute on function app.event_id_for_stage_internal(uuid), app.event_id_for_heat_internal(uuid),
  app.event_id_for_heat_entry_internal(uuid), app.event_id_for_btc_match_internal(uuid) to authenticated;

-- ============ the lock ============

create or replace function app.window_lock_on()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce((select k.enforced from app.entitlement_keys k where k.key = 'event_window_lock'), false); $$;

create or replace function app.event_window_ended(p_event uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.events e
     where e.id = p_event
       -- (1) no organisation-level plan: the organisation's own tier is the lowest
       and app.effective_tier(e.org_id, null, p_at) = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1)
       -- (2) an event grant (not revoked) whose window has ended
       and exists (select 1 from public.entitlement_grants g
                    where g.event_id = e.id and (g.revoked_at is null or g.revoked_at > p_at)
                      and g.valid_until is not null and g.valid_until <= p_at)
       -- (3) and none that is current
       and not exists (select 1 from public.entitlement_grants g
                        where g.event_id = e.id and (g.revoked_at is null or g.revoked_at > p_at)
                          and g.valid_from <= p_at and (g.valid_until is null or g.valid_until > p_at)));
$$;

create or replace function app.event_window_locked(p_event uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.window_lock_on() and app.event_window_ended(p_event, p_at); $$;

revoke all on function app.window_lock_on(), app.event_window_ended(uuid, timestamptz), app.event_window_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- The set of locked events, as ONE uncorrelated subquery per statement (a hashed lookup), so a policy costs a hash probe per row
-- rather than a full evaluation per row. Narrowed to events that carry an ended event grant (the grants table is small).
create or replace function app.window_locked_events()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.event_id
    from public.entitlement_grants g
   where app.window_lock_on()
     and g.event_id is not null and g.valid_until is not null and g.valid_until <= now()
     and (g.revoked_at is null or g.revoked_at > now())
     and app.event_window_ended(g.event_id, now())
   group by g.event_id;
$$;
revoke all on function app.window_locked_events() from public, anon, authenticated, service_role;
-- the policies call it as the signed-in AND the anonymous role (live_sessions is read by the audience); it takes no argument,
-- so it answers only "which events are locked now"
grant execute on function app.window_locked_events() to anon, authenticated;

-- ============ the restrictive policies ============

do $pol$
declare
  s record;
begin
  for s in select * from (values
    ('event_entries',        'event_id'),
    ('ct_stages',            'event_id'),
    ('ct_sets',              'app.event_id_for_stage_internal(stage_id)'),
    ('ct_stage_entries',     'app.event_id_for_stage_internal(stage_id)'),
    ('ct_heats',             'app.event_id_for_stage_internal(stage_id)'),
    ('ct_heat_entries',      'app.event_id_for_heat_internal(heat_id)'),
    ('ct_results',           'app.event_id_for_heat_entry_internal(heat_entry_id)'),
    ('btc_teams',            'event_id'),
    ('btc_judges',           'event_id'),
    ('btc_matches',          'event_id'),
    ('btc_match_judges',     'app.event_id_for_btc_match_internal(match_id)'),
    ('btc_cup_votes',        'app.event_id_for_btc_match_internal(match_id)'),
    ('btc_match_bonuses',    'app.event_id_for_btc_match_internal(match_id)'),
    ('btc_bracket_slots',    'event_id'),
    ('btc_seeding_tiebreaks','event_id'),
    ('live_sessions',        'event_id')
  ) as v(tbl, ev) loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not coalesce((%s) in (select app.window_locked_events()), false)) with check (not coalesce((%s) in (select app.window_locked_events()), false))',
      s.tbl || '_window_lock', s.tbl, s.ev, s.ev);
  end loop;
end
$pol$;

-- the audience (anon) reads live sessions: a locked event stops being served
create policy live_sessions_window_lock_anon on public.live_sessions as restrictive for select to anon
  using (not coalesce(event_id in (select app.window_locked_events()), false));

-- the score change log is read-only to members; the trail of a locked event is part of the closed workspace
create policy score_change_log_window_lock on public.score_change_log as restrictive for select to authenticated
  using (not coalesce(event_id in (select app.window_locked_events()), false));

-- ============ the anonymous door ============

CREATE OR REPLACE FUNCTION public.public_event_summary(p_org_id uuid)
 RETURNS TABLE(id uuid, name text, event_date date, is_test boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select e.id, e.name, e.event_date, e.is_test
  from public.events e
  left join public.live_sessions ls on ls.event_id = e.id and ls.active
  where e.org_id = p_org_id
    and not app.event_window_locked(e.id)
  order by (ls.id is not null) desc, e.is_test asc, e.created_at desc, e.id desc
  limit 1;
$function$;

-- ============ deleting a locked event ============
-- The BTC delete cleanup (20260927090000) ran as the caller, so on a locked event its deletes of matches and bracket slots
-- were filtered to nothing by the new policies and the event's own cascade then hit the fastest-team foreign key. It is now a
-- definer function: it is reachable only after the caller's DELETE of the events row has passed row-level security (or as the
-- cascade of an organisation's deletion), and it refuses to run as anything but that delete trigger (which also satisfies the
-- trigger-gate guard, test 045).

create or replace function app.btc_delete_event_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only ever a BEFORE DELETE row trigger on events (anything else is refused). It deletes the children of the event that is
  -- being deleted, and is reached only after that delete has passed row-level security (or as the cascade of an organisation's
  -- deletion by its owner), so it discloses and reaches nothing the caller could not already delete.
  if tg_op <> 'DELETE' or tg_table_name <> 'events' then
    raise exception 'btc_delete_event_children: only for deleting an event' using errcode = '42501';
  end if;
  delete from public.btc_bracket_slots where event_id = old.id;
  delete from public.btc_matches where event_id = old.id;
  return old;
end;
$$;

-- ============ the preview ============

CREATE OR REPLACE FUNCTION app.gating_would_lose(p_key text)
 RETURNS TABLE(org_id uuid, org_name text, tier text, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key     app.entitlement_keys;
  v_min     int;
begin
  select * into v_key from app.entitlement_keys where key = p_key;
  if not found then
    raise exception 'entitlements: unknown key "%"', p_key
      using errcode = '22023', hint = 'entitlement_key_unknown';
  end if;

  if p_key = 'event_window_lock' then
    -- the organisations that have an event whose Per-event window has ended (they would lose it once enforced)
    return query
      select o.id, o.name, app.effective_tier(o.id),
             jsonb_build_object('locked_events', (select count(*)::int from public.events ev
                                                   where ev.org_id = o.id and app.event_window_ended(ev.id, now())))
        from public.orgs o
       where exists (select 1 from public.events ev where ev.org_id = o.id and app.event_window_ended(ev.id, now()))
       order by o.name, o.id;
    return;
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
$function$;

-- ============ the snapshot the UI reads ============

CREATE OR REPLACE FUNCTION public.my_entitlements(p_org uuid, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_keys jsonb := '{}'::jsonb;
  k      record;
begin
  -- One refusal for "not your organisation" and "not that organisation's event": no oracle on other tenants.
  if not app.is_org_member(p_org)
     or (p_event is not null and app.org_id_for_event_internal(p_event) is distinct from p_org) then
    raise exception 'my_entitlements: organisation not found' using errcode = '42501';
  end if;
  for k in select * from app.entitlement_keys order by key loop
    v_keys := v_keys || jsonb_build_object(
      k.key,
      case when k.kind = 'cap'
        then jsonb_build_object(
          'allowed', app.has_entitlement(p_org, k.key, p_event),
          'limit', app.entitlement_limit(p_org, k.key, p_event))
        else jsonb_build_object('allowed', app.has_entitlement(p_org, k.key, p_event)) end);
  end loop;
  return jsonb_build_object(
    'tier', app.resolved_tier(p_org, p_event),
    'keys', v_keys,
    -- the Per-event window of the named event (null when it has none): when it ends, and whether the lock is in force now
    'window', case when p_event is null then null else (
      select jsonb_build_object('ends_at', max(g.valid_until), 'locked', app.event_window_locked(p_event))
        from public.entitlement_grants g
       where g.event_id = p_event and g.revoked_at is null and g.valid_until is not null
         and app.effective_tier(p_org, null) = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1)
      having count(*) > 0) end);
end;
$function$;

