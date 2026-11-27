-- Seduh Score Next · demo roster for Cup Taster and Throwdown: load_demo_roster(org, event)
--
-- Why: since Seduh ID, registering a cupper or a Throwdown competitor needs a unique phone number, so a
-- rehearsal or a first look at the app meant typing eight made-up numbers by hand. BTC already has its own demo
-- loader (load_btc_demo, 20261009120000); this is the same idea for the two formats that register people.
--
-- What it does, in one transaction, as the CALLER (security invoker: every write is checked by the caller's own RLS
-- and triggers, the entitlement cap included, so a non-member can do nothing and an event already near the
-- Community cap of 8 is refused like any other registration):
--   1. Refuses unless the event belongs to p_org_id, is a Cup Taster or Throwdown event, and is a TEST event
--      (events.is_test). The event row is locked for the rest of the call. As with load_btc_demo this is an
--      accident-prevention rail, not an authorisation boundary.
--   2. Makes sure 8 fixed demo people exist in the organisation, then puts each on the event's roster. The phones are
--      +44 7700 900101 to 900108: Ofcom's range reserved for drama, which is never assigned to a real subscriber, so a
--      demo phone cannot be a real person's. The names all start with "Demo" and the person's notes say so.
--   3. ADDITIVE and idempotent: no row is deleted. A demo person already on the roster is left alone, a withdrawn one
--      is brought back, and loading twice gives the same 8, not 16. (A Cup Taster entry carries results through
--      cascading keys, so unlike load_btc_demo this never wipes.)
--
-- What it deliberately does NOT do (Seduh ID): it never calls link_person_identity and never sets global_person_id
-- (the guard trigger would refuse an API caller anyway), so a demo person has no Seduh ID. A demo phone cannot be
-- claimed either (claiming needs a code sent to the phone). Results of a test event never reach the archive feed,
-- discovery, a person page or a country page (every one of those doors reads `events.is_test is not true`).
--
-- People rows are per organisation and outlive the event. They are reused by phone on the next load, so a repeat load
-- adds no clutter; a person with the demo notes can be deleted like any other person.
--
-- Returns jsonb { people: 8, added: n, reinstated: n } for the screen's confirmation. Refusals carry a hint, never
-- depended on by wording: demo_event_not_found, demo_not_test, demo_roster_format. A registration cap refusal is the
-- standard 42501 entitlement_cap_reached from app.check_event_entry_cap.
--
-- The names, cafes, phones and the count 8 are mirrored by src/core/demoRoster.js (DEMO_ROSTER_SIZE): change both.
--
-- rollback:
--   drop function if exists public.load_demo_roster(uuid, uuid);
--   (data already loaded stays; withdraw or delete the demo people like any other)

create or replace function public.load_demo_roster(p_org_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_format text;
  v_is_test boolean;
  v_names constant text[] := array[
    'Demo Aiman', 'Demo Bella', 'Demo Chandra', 'Demo Dewi',
    'Demo Eka', 'Demo Farid', 'Demo Gita', 'Demo Hadi'
  ];
  v_cafes constant text[] := array[
    'Demo Cafe A', 'Demo Cafe B', 'Demo Cafe C', 'Demo Cafe D',
    'Demo Cafe E', 'Demo Cafe F', 'Demo Cafe G', 'Demo Cafe H'
  ];
  v_count constant int := array_length(v_names, 1);
  v_phone text;
  v_person uuid;
  v_person_ids uuid[] := '{}';
  v_added int := 0;
  v_reinstated int := 0;
  v_n int;
begin
  -- Same org check and not-found shape as the other demo and event RPCs: for a non-member RLS hides the events
  -- row, so "not found" and "not yours" are indistinguishable.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'load_demo_roster: event not found' using hint = 'demo_event_not_found';
  end if;

  select format, is_test into v_format, v_is_test
  from public.events where id = p_event_id
  for update;

  if v_format is null then
    raise exception 'load_demo_roster: event not found' using hint = 'demo_event_not_found';
  end if;
  if v_format not in ('cup_taster', 'throwdown') then
    raise exception 'load_demo_roster: demo roster is only available for Cup Taster and Throwdown events'
      using hint = 'demo_roster_format';
  end if;
  if v_is_test is not true then
    raise exception 'load_demo_roster: demo data can only be loaded into a test event' using hint = 'demo_not_test';
  end if;

  for i in 1..v_count loop
    v_phone := '+4477009001' || lpad(i::text, 2, '0');

    insert into public.people (org_id, display_name, phone, cafe, notes)
    values (p_org_id, v_names[i], v_phone, v_cafes[i], 'Demo data (test events only)')
    on conflict (org_id, phone) do nothing;

    select id into v_person from public.people where org_id = p_org_id and phone = v_phone;
    v_person_ids := v_person_ids || v_person;

    -- A person already on the roster (active or withdrawn) is not inserted again. The `not exists` matters: the entry
    -- cap trigger runs BEFORE the conflict check, so merely attempting a duplicate row would count the existing 8 and
    -- refuse a repeat load once the Community cap is enforced. The conflict clause stays as a backstop.
    insert into public.event_entries (event_id, person_id, display_name, cafe)
    select p_event_id, p.id, p.display_name, p.cafe
    from public.people p
    where p.id = v_person
      and not exists (
        select 1 from public.event_entries x where x.event_id = p_event_id and x.person_id = p.id
      )
    on conflict (event_id, person_id) where person_id is not null do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  update public.event_entries
     set withdrawn = false
   where event_id = p_event_id and person_id = any (v_person_ids) and withdrawn;
  get diagnostics v_reinstated = row_count;

  return jsonb_build_object('people', v_count, 'added', v_added, 'reinstated', v_reinstated);
end;
$$;

-- Explicit anon revoke, not just from public (see 20260922130000's own comment).
revoke execute on function public.load_demo_roster(uuid, uuid) from public, anon;
grant execute on function public.load_demo_roster(uuid, uuid) to authenticated;
grant execute on function public.load_demo_roster(uuid, uuid) to service_role;
