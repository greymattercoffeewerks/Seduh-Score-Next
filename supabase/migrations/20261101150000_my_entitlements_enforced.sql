-- Seduh Score Next · T-ARC.4b: my_entitlements tells the client whether the archive key is ENFORCED
--
-- Why: `allowed` in the snapshot is app.has_entitlement(), which answers true for every key that is not enforced. So a
-- client reading `allowed: true` for results_archive_optional cannot tell "the key is off, nothing changes" from "the key
-- is on and this organisation's plan includes the choice". The archive UI (T-ARC.4) must stay inert in the first case and
-- show the compulsory-listing notice in the second, so it needs the flag itself. Every other gated surface needs only
-- `allowed` (the database refuses with a hint), and the window already carries its own `enforced`.
--
-- What changes: public.my_entitlements (REPLACED, same signature, same member gate, same 42501) adds `enforced` (boolean)
-- to the entry of the keys in the whitelist below, and to no other key. Today the whitelist is one key,
-- results_archive_optional; a future key that needs it is a new migration. Nothing else in the result changes. No table,
-- grant, policy or other function is touched; `enforced` of other keys, caps rows, notes, grants and prices stay in `app`.
--
-- Must be pushed to the cloud WITH the three archive migrations (T-ARC.7) and before the key is flipped.
--
-- rollback: (restores the body from 20261023140000_entitlement_window_lock.sql)
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
--     return jsonb_build_object(
--       'tier', app.resolved_tier(p_org, p_event),
--       'keys', v_keys,
--       'window', case when p_event is null then null else (
--         select jsonb_build_object('ends_at', max(g.valid_until), 'locked', app.event_window_locked(p_event), 'enforced', app.window_lock_on())
--           from public.entitlement_grants g
--          where g.event_id = p_event and g.revoked_at is null and g.valid_until is not null
--            and app.effective_tier(p_org, null) = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1)
--         having count(*) > 0) end);
--   end;
--   $function$;

CREATE OR REPLACE FUNCTION public.my_entitlements(p_org uuid, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_keys jsonb := '{}'::jsonb;
  k      record;
  -- the keys whose `enforced` flag the client may see (see the header)
  v_report_enforced constant text[] := array['results_archive_optional'];
  v_entry jsonb;
begin
  -- One refusal for "not your organisation" and "not that organisation's event": no oracle on other tenants.
  if not app.is_org_member(p_org)
     or (p_event is not null and app.org_id_for_event_internal(p_event) is distinct from p_org) then
    raise exception 'my_entitlements: organisation not found' using errcode = '42501';
  end if;
  for k in select * from app.entitlement_keys order by key loop
    v_entry := case when k.kind = 'cap'
      then jsonb_build_object(
        'allowed', app.has_entitlement(p_org, k.key, p_event),
        'limit', app.entitlement_limit(p_org, k.key, p_event))
      else jsonb_build_object('allowed', app.has_entitlement(p_org, k.key, p_event)) end;
    if k.key = any (v_report_enforced) then
      v_entry := v_entry || jsonb_build_object('enforced', k.enforced);
    end if;
    v_keys := v_keys || jsonb_build_object(k.key, v_entry);
  end loop;
  return jsonb_build_object(
    'tier', app.resolved_tier(p_org, p_event),
    'keys', v_keys,
    -- the Per-event window of the named event (null when it has none): when it ends, and whether the lock is in force now
    'window', case when p_event is null then null else (
      select jsonb_build_object('ends_at', max(g.valid_until), 'locked', app.event_window_locked(p_event), 'enforced', app.window_lock_on())
        from public.entitlement_grants g
       where g.event_id = p_event and g.revoked_at is null and g.valid_until is not null
         and app.effective_tier(p_org, null) = (select t.tier from app.entitlement_tiers t order by t.rank asc limit 1)
      having count(*) > 0) end);
end;
$function$;
