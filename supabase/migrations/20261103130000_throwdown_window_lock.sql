-- Seduh Score Next - T-TD.1.2b: the Per-event window lock covers the Throwdown tables
--
-- 20261023140000 closes an event's workspace once a Per-event grant's 5-day window has ended (key event_window_lock,
-- seeded off) by a restrictive policy on every table that carries an event's data; test 056 fails for any later table with an
-- event_id column that has no such policy. The six Throwdown tables carry event_id directly, so they take the same policy:
-- not (lock is on) or the row's event is not in the set of locked events. Same text as the original loop, same behaviour
-- while the key is off (nothing changes until an operator flips it, D-G11).
--
-- rollback:
--   drop policy if exists td_votes_window_lock on public.td_votes;
--   drop policy if exists td_slots_window_lock on public.td_slots;
--   drop policy if exists td_matches_window_lock on public.td_matches;
--   drop policy if exists td_rounds_window_lock on public.td_rounds;
--   drop policy if exists td_draws_window_lock on public.td_draws;
--   drop policy if exists td_settings_window_lock on public.td_settings;

do $pol$
declare
  s record;
begin
  for s in select * from (values
    ('td_settings', 'event_id'),
    ('td_draws',    'event_id'),
    ('td_rounds',   'event_id'),
    ('td_matches',  'event_id'),
    ('td_slots',    'event_id'),
    ('td_votes',    'event_id')
  ) as v(tbl, ev) loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not (select app.window_lock_on()) or not coalesce((%s) in (select app.window_locked_events()), false)) with check (not (select app.window_lock_on()) or not coalesce((%s) in (select app.window_locked_events()), false))',
      s.tbl || '_window_lock', s.tbl, s.ev, s.ev);
  end loop;
end
$pol$;
