-- Seduh Score Next · T-ARC.4c: a member-readable archive status for the organiser's panel
--
-- Why: the archive ledger (app.archive_events) is owner-only and admin_archive_status is counts for the platform operator, so the
-- T-ARC.4 panel could not read what the pipeline decided about an event. It guessed per device (the saved tick box and the
-- take-down lived in localStorage; "failed" and "removed" could not be told from "overdue"). This is the one door that tells a
-- member, for events of their own organisation, exactly what the panel needs and no more.
--
--   public.archive_event_status(p_org_id uuid, p_event_ids uuid[])
--     One round trip for the events the panel lists. STABLE, SECURITY DEFINER, search_path '', granted to `authenticated` only,
--     READ ONLY: no write path, no new column, no new table.
--     Refusals (all 42501 unless noted, nothing about other tenants):
--       * a non-member, an unknown organisation and a NULL organisation get app.refuse_non_member's standard refusal (first
--         statement, so whatever ids are guessed the answer is the same: test 045's guard, matrix entry in 041);
--       * a NULL, unknown or other-organisation event id in the list: "event not found" (one refusal for all three, so the
--         caller cannot tell a missing event from another organisation's);
--       * a NULL list, or more than 200 ids: 22023, hint archive_status_invalid / archive_status_too_many.
--     One row per DISTINCT requested event (an empty list answers no rows), in no promised order:
--       event_id        uuid
--       state           'none' (the pipeline has no row for it yet) | 'pending' | 'published' | 'stubbed' | 'skipped' |
--                       'failed' | 'removed'   (the ledger state, T-ARC.1)
--       due_at          the stored due time, else ended_at + 24 hours, else null (not finished)
--       published       a public_results row exists for the event NOW (the organiser's own, or the pipeline's)
--       listing_choice  'list' | 'named_only' | null (the saved tick box, T-ARC.3)
--       removed         the result was taken down (state 'removed'); with published=true it was then published again by hand
--       retrying        a pending event whose last attempt failed and will be tried again
--       reason          a SAFE code or null: 'no_snapshot' | 'invalid_snapshot' | 'stale_snapshot' (why a stub was published
--                       instead of a podium) | 'processing_error' (a pending or failed event whose last attempt hit a database
--                       error). It is a whitelist: the raw last_error (a SQLSTATE or an internal code) is never returned, nor
--                       is any payload, staged snapshot, attempt count, error text, organisation or other tenant's id.
--     The tick being DARK changes nothing here: the rows are the caller's own organisation's, and the panel stays inert on its own
--     (my_entitlements reports `enforced`, T-ARC.4b).
--
-- Not in the cloud. Like the three archive migrations it waits for T-ARC.7's owner-approved rollout.
--
-- rollback:
--   drop function if exists public.archive_event_status(uuid, uuid[]);

create or replace function public.archive_event_status(p_org_id uuid, p_event_ids uuid[])
returns table (
  event_id        uuid,
  state           text,
  due_at          timestamptz,
  published       boolean,
  listing_choice  text,
  removed         boolean,
  retrying        boolean,
  reason          text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.refuse_non_member(p_org_id, 'archive_events');

  if p_event_ids is null then
    raise exception 'archive_event_status: the event list is required' using errcode = '22023', hint = 'archive_status_invalid';
  end if;
  if cardinality(p_event_ids) > 200 then
    raise exception 'archive_event_status: too many events at once' using errcode = '22023', hint = 'archive_status_too_many';
  end if;
  -- every id must be an event of THIS organisation; one refusal for a NULL, a missing and another organisation's event
  if exists (
       select 1 from unnest(p_event_ids) i(id)
        where i.id is null
           or not exists (select 1 from public.events e where e.id = i.id and e.org_id = p_org_id)) then
    raise exception 'archive_event_status: event not found' using errcode = '42501';
  end if;

  return query
  select e.id,
         coalesce(a.state, 'none'),
         coalesce(a.due_at, e.ended_at + interval '24 hours'),
         exists (select 1 from public.public_results pr where pr.event_id = e.id and pr.org_id = p_org_id),
         a.listing_choice,
         coalesce(a.state = 'removed', false),
         coalesce(a.state = 'pending' and a.attempts > 0 and a.last_error is not null, false),
         case
           when a.last_error in ('no_snapshot', 'invalid_snapshot', 'stale_snapshot') then a.last_error
           when a.state in ('pending', 'failed') and a.last_error is not null then 'processing_error'
         end
    from (select distinct u.id from unnest(p_event_ids) u(id)) i
    join public.events e on e.id = i.id and e.org_id = p_org_id
    left join app.archive_events a on a.event_id = e.id and a.org_id = p_org_id;
end;
$$;

revoke all on function public.archive_event_status(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.archive_event_status(uuid, uuid[]) to authenticated;
