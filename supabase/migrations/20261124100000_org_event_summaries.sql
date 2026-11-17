-- Seduh Score Next · Organiser home: one read for what each event of an organisation has so far.
--
-- The organiser's Events screen shows, for every event, a short state line ("16 cuppers · 4 heats drawn"), a progress bar
-- for the live one and a list of what needs attention across events. That needs a few counts per event from the
-- format tables. Asking for them one event at a time would be N table reads on the landing page, so this is ONE door:
--
--   public.org_event_summaries(p_org_id uuid)
--     returns one row per event of the organisation: event_id, is_live (the event has the organisation's one active
--     live_sessions row) and `facts`, a flat jsonb object of plain counts, every key always present (0 when the format
--     does not use it):
--       entries, entries_active          roster entries (all, and not withdrawn)
--       stages, stages_complete          Cup Taster stages
--       heats, heats_confirmed, heats_active   Cup Taster heats (active = timing or scoring)
--       teams, judges                    BTC teams and judges
--       matches, matches_confirmed, matches_active   BTC matches (active = scoring)
--       td_matches, td_confirmed         Throwdown matches (confirmed = has a confirmed result)
--
-- The facts are raw counts on purpose: what a count MEANS ("heats drawn", "no judges yet") is the format's wording, kept in
-- the composition root (src/main.js), never here or in src/core/. Nothing the page does not show is returned: no names, no
-- people, no scores, no payloads.
--
-- Security: SECURITY DEFINER with an empty search_path, and it opens with app.is_org_member(p_org_id); a caller who is not a
-- member of THAT organisation gets one 42501 and learns nothing about whether the organisation has events. anon and
-- service_role cannot execute it. Every event row is selected by `events.org_id = p_org_id`, so another organisation's
-- events can never be reached through a guessed id (the function takes no event id at all).
--
-- rollback:
--   drop function if exists public.org_event_summaries(uuid);

create or replace function public.org_event_summaries(p_org_id uuid)
returns table (event_id uuid, is_live boolean, facts jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'org_event_summaries: organisation not found' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    exists (
      select 1 from public.live_sessions s
      where s.event_id = e.id and s.org_id = p_org_id and s.active
    ),
    jsonb_build_object(
      'entries', (select count(*) from public.event_entries x where x.event_id = e.id),
      'entries_active', (select count(*) from public.event_entries x where x.event_id = e.id and not x.withdrawn),
      'stages', (select count(*) from public.ct_stages x where x.event_id = e.id),
      'stages_complete', (select count(*) from public.ct_stages x where x.event_id = e.id and x.status = 'complete'),
      'heats', (select count(*) from public.ct_heats h join public.ct_stages x on x.id = h.stage_id where x.event_id = e.id),
      'heats_confirmed', (select count(*) from public.ct_heats h join public.ct_stages x on x.id = h.stage_id
                           where x.event_id = e.id and h.status = 'confirmed'),
      'heats_active', (select count(*) from public.ct_heats h join public.ct_stages x on x.id = h.stage_id
                        where x.event_id = e.id and h.status in ('timing', 'scoring')),
      'teams', (select count(*) from public.btc_teams x where x.event_id = e.id),
      'judges', (select count(*) from public.btc_judges x where x.event_id = e.id),
      'matches', (select count(*) from public.btc_matches x where x.event_id = e.id),
      'matches_confirmed', (select count(*) from public.btc_matches x where x.event_id = e.id and x.status = 'confirmed'),
      'matches_active', (select count(*) from public.btc_matches x where x.event_id = e.id and x.status = 'scoring'),
      'td_matches', (select count(*) from public.td_matches x where x.event_id = e.id),
      'td_confirmed', (select count(*) from public.td_matches x where x.event_id = e.id and x.confirmed_at is not null)
    )
  from public.events e
  where e.org_id = p_org_id
  order by e.created_at desc;
end;
$$;

revoke execute on function public.org_event_summaries(uuid) from public, anon, service_role;
grant execute on function public.org_event_summaries(uuid) to authenticated;
