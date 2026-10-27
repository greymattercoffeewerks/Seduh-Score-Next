-- Seduh Score Next · T-GATE.B5 follow-up: the Per-event window lock's read cost (set-based locked events), still DARK
--
-- Why: the owner's flip precondition (ROADMAP, "Known open items from T-GATE.B5", item 1a) asked for the read cost of the
-- window lock to be MEASURED before event_window_lock is enforced. It was measured on a local copy (2026-10-27, synthetic data,
-- the real roles through row-level security, the key flipped only inside a rolled-back transaction):
--   * with the key OFF the lock costs nothing (the restrictive policies short-circuit after one check per statement);
--   * with the key ON every statement paid a fixed cost proportional to the number of ENDED Per-event grants on the whole
--     platform, whoever asked and whatever they read: about 0.2 to 0.35 ms per ended grant, so 3 ms at 10 grants, 17 ms at 100
--     and roughly 170 to 700 ms at 1000, on audience reads of live_sessions, score writes and every workspace read alike. It did NOT
--     depend on how many rows the tables held (170 to 24,000 results made no difference);
--   * cause: app.window_locked_events() (20261023140000) called app.event_window_ended() once per ended grant, and each call
--     walks the grants again (16 to 22 buffer reads per grant, EXPLAIN ANALYZE). The policies evaluate that set once per
--     statement, so the whole bill is paid on every statement.
--
-- What this changes (behaviour is IDENTICAL; only the way the set is computed):
--   * app.window_locked_events() is REPLACED by one set-based query: the events that have a non-revoked event grant whose window
--     has ended, whose organisation has no organisation-level plan, and that have no current event grant. These are exactly the
--     three conditions of app.event_window_ended() (kept as it is: my_entitlements and the Plan panel still ask it about one
--     event). An organisation-level grant counts as a plan only when its tier ranks above the lowest tier, exactly as
--     app.effective_tier() = lowest tier decides in the per-event function. On 1000 ended grants the set-based version cost 3 to
--     16 ms per statement with the key on, against roughly 170 to 700 ms before (about 3 buffer reads per grant).
--   * public.public_event_summary(p_org_id) is REPLACED: it asked app.event_window_locked() once per event row (about 0.05 ms
--     each, even with the key OFF, so an organisation with a thousand events paid 50 ms on every audience page load); it now asks
--     the locked set once. Same columns, same ordering, same security (SECURITY DEFINER, search_path pinned, anon may call it).
--   * Nothing else: no table, policy, trigger, grant or key changes, and every key stays unenforced. Function privileges are kept
--     (CREATE OR REPLACE keeps them); pgTAP 056 (the behaviour) is untouched and still passes, pgTAP 058 pins the equivalence with
--     the previous definition on a deliberately messy set of grants and guards the cost (buffer reads per grant).
--
-- rollback: (restores the bodies from 20261023140000)
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
--       and not app.event_window_locked(e.id)
--     order by (ls.id is not null) desc, e.is_test asc, e.created_at desc, e.id desc
--     limit 1;
--   $function$;
--   create or replace function app.window_locked_events()
--   returns setof uuid
--   language sql
--   stable
--   security definer
--   set search_path = ''
--   as $$
--     select g.event_id
--       from public.entitlement_grants g
--      where app.window_lock_on()
--        and g.event_id is not null and g.valid_until is not null and g.valid_until <= now()
--        and (g.revoked_at is null or g.revoked_at > now())
--        and app.event_window_ended(g.event_id, now())
--      group by g.event_id;
--   $$;

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
     -- (2) an event grant (not revoked) whose window has ended
     and g.event_id is not null and g.valid_until is not null and g.valid_until <= now()
     and (g.revoked_at is null or g.revoked_at > now())
     -- (1) no organisation-level plan: the organisation's own tier is the lowest, i.e. no current organisation-level grant of a
     --     tier above the lowest (app.effective_tier(org) = the lowest tier)
     and not exists (select 1
                       from public.entitlement_grants o
                       join app.entitlement_tiers ot on ot.tier = o.tier
                      where o.org_id = g.org_id and o.event_id is null
                        and (o.revoked_at is null or o.revoked_at > now())
                        and o.valid_from <= now() and (o.valid_until is null or o.valid_until > now())
                        and ot.rank > (select min(t.rank) from app.entitlement_tiers t))
     -- (3) and no event grant of this event that is current
     and not exists (select 1
                       from public.entitlement_grants c
                      where c.event_id = g.event_id
                        and (c.revoked_at is null or c.revoked_at > now())
                        and c.valid_from <= now() and (c.valid_until is null or c.valid_until > now()))
   group by g.event_id;
$$;

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
    -- the locked set is computed once (an uncorrelated subquery), not asked per event row; while the key is off it is empty
    and not coalesce(e.id in (select app.window_locked_events()), false)
  order by (ls.id is not null) desc, e.is_test asc, e.created_at desc, e.id desc
  limit 1;
$function$;
