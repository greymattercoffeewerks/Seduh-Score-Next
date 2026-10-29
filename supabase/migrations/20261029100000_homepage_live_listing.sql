-- Seduh Score Next · the homepage "live now" bar: an opt-in flag on events and one narrow anonymous door
--
-- Why: the public landing page gets an info bar that appears ONLY while a competition is live and its
-- organiser has chosen to be listed there. Many organisations share this database, so one organiser's event
-- appearing on the platform's homepage needs that organiser's explicit say-so, per event.
--
-- What this adds:
--   * events.list_on_homepage boolean NOT NULL DEFAULT false. It lives on `events`, not on `live_sessions`:
--     `events` is closed to anon (T-TEN.D6) while `live_sessions` is anon-readable (active rows), so a flag on
--     live_sessions would be readable by anyone with the table's whole row. It is a plain setting, not a
--     parent reference, so the parent-freeze rule has nothing to freeze. Who may set it: whoever may already
--     edit the event (events_write, app.is_org_member), through the existing UPDATE grant and policies; a
--     non-member's update touches zero rows.
--   * public.public_live_now() -> (kind, event_name, org_name, org_slug, format, last_activity_at, listed_count):
--     the ONLY anonymous way to learn that something is live. `kind` is the row's type ('live' today), so a
--     later row type (registration) can be added without changing the page. No participant data, no ids.
--     A row is returned only when ALL of these hold:
--       - the event's organiser ticked list_on_homepage;
--       - the event is not a test event (events.is_test) and its session is not a test session (live_sessions.is_test);
--       - the event has not ended (events.ended_at is null) and is not window-locked (app.event_window_locked);
--       - its live session is ACTIVE and last changed within the last 12 hours. publish_session (the only writer)
--         rewrites the row on every heat start/confirm, which advances updated_at; an organisation's most recent
--         session otherwise stays active forever (see 20261013100000), so without this window an event left open
--         for days would keep the bar up.
--     At most 3 rows, newest activity first; `listed_count` is the number of qualifying events (same on every
--     row), so the page can say "+N more". Executable by anon and authenticated only.
--
-- A freshness window is the only liveness signal that exists: there is no heartbeat and no "ended" signal for a
-- session other than events.ended_at. A quiet gap longer than 12 hours in a real event takes the bar down until
-- the next heat activity; that is the safe direction.
--
-- rollback: (drops the door first, then the column; nothing else depends on either)
--   drop function if exists public.public_live_now();
--   alter table public.events drop column if exists list_on_homepage;

alter table public.events
  add column list_on_homepage boolean not null default false;

create or replace function public.public_live_now()
returns table (
  kind text,
  event_name text,
  org_name text,
  org_slug text,
  format text,
  last_activity_at timestamptz,
  listed_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'live'::text,
         left(e.name, 200),
         left(o.name, 200),
         o.slug,
         ls.format,
         ls.updated_at,
         count(*) over ()
  from public.live_sessions ls
  join public.events e on e.id = ls.event_id
  join public.orgs o on o.id = e.org_id
  where ls.active
    and not ls.is_test
    and ls.updated_at > now() - interval '12 hours'
    and e.list_on_homepage
    and not e.is_test
    and e.ended_at is null
    and not app.event_window_locked(e.id)
  order by ls.updated_at desc, ls.id
  limit 3;
$$;

revoke all on function public.public_live_now() from public, anon, authenticated, service_role;
grant execute on function public.public_live_now() to anon, authenticated;
