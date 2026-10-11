-- Seduh Score Next · T-TEN.B7: anonymous surfaces, EXPAND step
--
-- Why: the audience screens (projector, phone, splash) and the public results archive are anonymous.
-- Today they find "their" org by a build-time id and read `events` directly as anon, and anon can read
-- `events`, `live_sessions` and `public_results` for EVERY org (T-TEN.A2 inventory §6). With many orgs
-- that has to narrow, but the venue displays that are already open run cached JavaScript that still
-- reads those tables, so it is done in two steps (decision D-T3): THIS migration only ADDS the
-- narrow, slug-addressed doors (expand); the client switches to them (T-TEN D1/D2); a LATER migration
-- (D6, a separate gated PR, no live event) closes the old doors (contract). Nothing that exists is
-- removed here, with the deliberate tightening noted below.
--
-- What this adds:
--   * public_org_by_slug(p_slug) -> (id, name, slug) for the ONE org with that slug, or no rows.
--     The slug is trimmed and case-folded like create_org does, and must look like a slug BEFORE it is
--     folded (so a look-alike such as the Kelvin sign cannot alias a real org). There is no listing,
--     no pattern matching, and nothing else about the org. This is what turns a printed audience link
--     (#/live/<slug>/...) into the org id the surfaces already use. Executable by anon and
--     authenticated.
--   * public_event_summary(p_org_id) -> (id, name, event_date, is_test) for that org's newest event,
--     or no rows. It replaces the anonymous table read in findLatestEventForOrg; the columns are the
--     ones the audience surfaces use, without org_id or created_at. Executable by anon and
--     authenticated.
--   * A trigger on public_results (trg_public_results_stamp_org) that, on EVERY insert or update,
--     stamps the org's real name and slug into the payload as org_name / org_slug, replacing anything
--     the writer put under those keys (decision D-T4: the public archive stays global, so each row must
--     say whose it is, and a member must not be able to publish under another org's name). It also
--     refuses a payload that is not a JSON object, and one larger than 256 KB (a real payload is about
--     3 KB; the results page reads every row, so one huge row would slow it for every org). It is a
--     TRIGGER, not RPC logic, because members can also write the table directly; the security review
--     reproduced that bypass. Rows published earlier lack the two keys: readers must tolerate that.
--   * publish_event_results gets one friendly extra: a payload that is not a JSON object is refused with
--     its own message before anything else about the event is revealed.
--   * TIGHTENING: anon loses SELECT on public_results.published_by (the auth user id of whoever
--     published). Nothing reads it (the results screens select event_id, payload, published_at only).
--     anon held SELECT on the WHOLE table, and a column-level revoke cannot remove one column from a
--     table-level grant, so the table grant is replaced by an explicit column list (id, event_id,
--     org_id, payload, published_at). A new column therefore stays hidden from anon until it is
--     granted on purpose.
--
-- Not here, on purpose (D6): dropping events_read_public and the anon column grants on events, and
-- narrowing live_sessions_read to active rows. The old surfaces keep working until then.
--
-- rollback: (the previous publish_event_results body is restored exactly)
--   drop trigger if exists trg_public_results_stamp_org on public_results;
--   drop function if exists app.stamp_public_results_org();
--   revoke select (id, event_id, org_id, payload, published_at) on public_results from anon;
--   grant select on public_results to anon;
--   drop function if exists public_event_summary(uuid);
--   drop function if exists public_org_by_slug(text);
--   CREATE OR REPLACE FUNCTION public.publish_event_results(p_org_id uuid, p_event_id uuid, p_payload jsonb)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   begin
--     if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
--       raise exception 'publish_event_results: event % not found', p_event_id;
--     end if;
--     if (select is_test from public.events where id = p_event_id) then
--       raise exception 'publish_event_results: refusing to publish a test event (%)', p_event_id
--         using errcode = 'P0001';
--     end if;
--     insert into public.public_results (org_id, event_id, payload, published_by)
--     select p_org_id, p_event_id, p_payload, auth.uid()
--     from public.events e
--     where e.id = p_event_id and not e.is_test
--     on conflict (event_id) do update
--       set payload = excluded.payload,
--           published_at = now(),
--           published_by = excluded.published_by;
--   end;
--   $function$;

create or replace function public_org_by_slug(p_slug text)
returns table (id uuid, name text, slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug
  from public.orgs o
  where length(p_slug) <= 100
    and btrim(p_slug, E' \t\r\n') ~ '^[A-Za-z0-9](-?[A-Za-z0-9])*$'
    and o.slug = lower(btrim(p_slug, E' \t\r\n'))
  limit 1;
$$;

create or replace function public_event_summary(p_org_id uuid)
returns table (id uuid, name text, event_date date, is_test boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.event_date, e.is_test
  from public.events e
  where e.org_id = p_org_id
  order by e.created_at desc, e.id desc
  limit 1;
$$;

revoke all on function public_org_by_slug(text) from public, anon, authenticated, service_role;
revoke all on function public_event_summary(uuid) from public, anon, authenticated, service_role;
grant execute on function public_org_by_slug(text) to anon, authenticated;
grant execute on function public_event_summary(uuid) to anon, authenticated;

-- The stamp and the shape checks live in a trigger so they hold for every writer, not only the RPC.
-- It sorts after trg_public_results_org_check, so the org / event / test-event checks run first.
create or replace function app.stamp_public_results_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_slug text;
begin
  if new.payload is null or jsonb_typeof(new.payload) <> 'object' then
    raise exception 'public_results: the payload must be a JSON object'
      using errcode = '22023';
  end if;

  -- Measured WITHOUT the stamp keys, so a payload that fit the first time still fits when the row is
  -- written again (the stored copy already carries the stamp).
  if octet_length((new.payload - 'org_name' - 'org_slug')::text) > 262144 then
    raise exception 'public_results: the payload is too large (256 KB at most)'
      using errcode = '22023', hint = 'payload_too_large';
  end if;

  select o.name, o.slug into v_name, v_slug from public.orgs o where o.id = new.org_id;

  new.payload := (new.payload - 'org_name' - 'org_slug')
                 || jsonb_build_object('org_name', v_name, 'org_slug', v_slug);
  return new;
end;
$$;

create trigger trg_public_results_stamp_org
  before insert or update on public_results
  for each row execute function app.stamp_public_results_org();

revoke all on function app.stamp_public_results_org() from public, anon, authenticated, service_role;

create or replace function publish_event_results(p_org_id uuid, p_event_id uuid, p_payload jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_event_results: event % not found', p_event_id;
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'publish_event_results: the payload must be a JSON object'
      using errcode = '22023';
  end if;

  if (select is_test from public.events where id = p_event_id) then
    raise exception 'publish_event_results: refusing to publish a test event (%)', p_event_id
      using errcode = 'P0001';
  end if;

  -- The is_test condition is repeated on the actual write, as its own `where` on the insert
  -- SOURCE (not just an `on conflict ... where` guard, which would only protect the update
  -- branch): the guard above and this statement can observe different rows if something updates
  -- events.is_test in between. The org stamp is added by trg_public_results_stamp_org.
  insert into public.public_results (org_id, event_id, payload, published_by)
  select p_org_id, p_event_id, p_payload, auth.uid()
  from public.events e
  where e.id = p_event_id and not e.is_test
  on conflict (event_id) do update
    set payload = excluded.payload,
        published_at = now(),
        published_by = excluded.published_by;
end;
$$;

revoke select on public_results from anon;
grant select (id, event_id, org_id, payload, published_at) on public_results to anon;
