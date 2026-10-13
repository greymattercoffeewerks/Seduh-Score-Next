-- Seduh Score Next · public_event_summary picks the event the audience should see
--
-- Why: the splash screen (and the "no live session yet" holding state of the projector and phone) shows ONE
-- event for an organisation, chosen by public_event_summary (T-TEN.B7). It picked the newest event by creation,
-- test events included, so an organisation that had just created a rehearsal event showed "TEST DATA, NOT A LIVE
-- EVENT" on its splash even while a real event was live (seen on the production splash, 2026-10-13).
--
-- Now, in this order:
--   1. the event that is LIVE (the one active live session of the organisation), whatever its age or kind:
--      what the projector and phone are showing is what the splash names;
--   2. otherwise the newest event that is NOT a test event;
--   3. otherwise the newest event (which is then a test event, and the splash marks it as such).
-- Ties are broken by creation time, then id, as before.
--
-- Same name, same arguments, same returned columns (id, name, event_date, is_test), same SECURITY DEFINER with a
-- pinned search_path, same grants (CREATE OR REPLACE keeps them): a client or a cached screen that already calls
-- it needs no change, and it can be applied at any time (there is no quiet-window requirement).
--
-- rollback: (restores the previous body exactly)
--   CREATE OR REPLACE FUNCTION public.public_event_summary(p_org_id uuid)
--    RETURNS TABLE(id uuid, name text, event_date date, is_test boolean)
--    LANGUAGE sql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--     select e.id, e.name, e.event_date, e.is_test
--     from public.events e
--     where e.org_id = p_org_id
--     order by e.created_at desc, e.id desc
--     limit 1;
--   $function$;

create or replace function public.public_event_summary(p_org_id uuid)
returns table(id uuid, name text, event_date date, is_test boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  select e.id, e.name, e.event_date, e.is_test
  from public.events e
  left join public.live_sessions ls on ls.event_id = e.id and ls.active
  where e.org_id = p_org_id
  order by (ls.id is not null) desc, e.is_test asc, e.created_at desc, e.id desc
  limit 1;
$function$;
