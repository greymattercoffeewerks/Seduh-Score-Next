-- Seduh Score Next · demo data for Cup Taster and Throwdown test events, with a clear for each
--
-- Why: BTC has load_btc_demo (20261009120000): one click loads a pre-arranged field into a TEST event. Cup Taster and
-- Throwdown had nothing, and since Seduh ID every cupper or competitor needs a unique phone, so a rehearsal meant typing
-- eight numbers and then every score by hand. This adds the same thing for both formats, plus a "clear" for each.
--
--   load_ct_demo(org, event)   Cup Taster: 8 demo cuppers, a Prelims stage (4 sets) with both heats scored and confirmed,
--                              the top 4 advanced, and a Finals stage whose one heat is ready to run (pending).
--   clear_ct_demo(org, event)  empties a Cup Taster test event (its stages, heats, scores and roster).
--   load_td_demo(org, event)   Throwdown: 8 demo competitors, the bracket started, all four quarter-finals decided by
--                              3-judge votes, one semi-final decided, the other open with one vote in.
--   clear_td_demo(org, event)  empties a Throwdown test event (its bracket, votes, settings and roster).
--
-- Every function refuses unless the event belongs to p_org_id, is of the right format and is a TEST event (events.is_test),
-- with a hint for each refusal (demo_event_not_found, demo_wrong_format, demo_not_test). Like load_btc_demo this is an
-- accident-prevention rail, not an authorisation boundary: any member of the org can already flip events.is_test (every flip
-- is logged) or write these tables directly. A load first clears, so it can be pressed again and always ends the same.
--
-- Security shape:
--   * load_ct_demo, clear_ct_demo and load_td_demo are SECURITY INVOKER: every write is checked by the caller's own RLS and
--     triggers (the entitlement cap included). A non-member can do nothing.
--   * Throwdown's tables take no API write (the API roles hold SELECT only), so load_td_demo makes its writes by calling the
--     existing SECURITY DEFINER functions (td_save_settings, td_start_event, td_cast_vote, td_confirm_match), which keep
--     every rule (setup lock, the vote cap, "every judge has voted", the draw). It never writes a td_* table itself.
--   * clear_td_demo is the one new SECURITY DEFINER function, because deleting a bracket is a write nothing else offers.
--     It opens with its own org check (a non-member, a NULL organisation, a wrong organisation and an unknown event are one
--     answer), then refuses a non-Throwdown or non-test event before it deletes anything, and honours the closed-workspace
--     window lock the other Throwdown writers honour.
--   * Test events are not written to the change log (handoff D9), so a load or clear leaves no audit noise.
--
-- Seduh ID: the 8 people come from load_demo_roster (20261130100000): names "Demo ...", phones +44 7700 900101 to 900108
-- (Ofcom's drama range, never a real subscriber), never linked to a Seduh ID, and a test event never reaches the archive
-- feed, discovery, a person page or a country page.
--
-- The results are deterministic (no randomness), so a rehearsal repeats exactly.
--
-- rollback:
--   drop function if exists public.load_td_demo(uuid, uuid);
--   drop function if exists public.clear_td_demo(uuid, uuid);
--   drop function if exists public.load_ct_demo(uuid, uuid);
--   drop function if exists public.clear_ct_demo(uuid, uuid);
--   (data already loaded stays; clear it from the event, or delete the test event, like any other test data)

-- ============ Cup Taster: clear ============

create or replace function public.clear_ct_demo(p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_format text;
  v_is_test boolean;
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'clear_ct_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  select format, is_test into v_format, v_is_test from public.events where id = p_event_id for update;
  if v_format is null then
    raise exception 'clear_ct_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  if v_format <> 'cup_taster' then
    raise exception 'clear_ct_demo: this demo is only available for Cup Taster events' using hint = 'demo_wrong_format';
  end if;
  if v_is_test is not true then
    raise exception 'clear_ct_demo: demo data can only be cleared from a test event' using hint = 'demo_not_test';
  end if;

  -- Stages cascade to their sets, stage entries, heats, heat entries and results; the roster entries cascade to the same.
  delete from public.ct_stages where event_id = p_event_id;
  delete from public.event_entries where event_id = p_event_id;
end;
$$;

-- ============ Cup Taster: load ============

create or replace function public.load_ct_demo(p_org_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_format text;
  v_is_test boolean;
  v_prelims uuid := gen_random_uuid();
  v_finals uuid := gen_random_uuid();
  v_entries uuid[];
  -- sets answered correctly by demo cupper 1..8, then the first n sets (of 4) are the correct ones; the finish time is
  -- 300 + (i * 37 mod 100) seconds. Four cuppers finish with 3 or 4 correct and four with 2 or fewer, so the cut at 4 has
  -- no tie on the border and needs no tiebreak.
  v_correct constant int[] := array[4, 3, 4, 2, 3, 1, 2, 0];
  v_count constant int := 8;
  v_sets constant int := 4;
  v_cut constant int := 4;
  v_heats int;
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'load_ct_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  select format, is_test into v_format, v_is_test from public.events where id = p_event_id for update;
  if v_format is null then
    raise exception 'load_ct_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  if v_format <> 'cup_taster' then
    raise exception 'load_ct_demo: this demo is only available for Cup Taster events' using hint = 'demo_wrong_format';
  end if;
  if v_is_test is not true then
    raise exception 'load_ct_demo: demo data can only be loaded into a test event' using hint = 'demo_not_test';
  end if;

  perform public.clear_ct_demo(p_org_id, p_event_id);
  perform public.load_demo_roster(p_org_id, p_event_id);

  -- the 8 demo cuppers, in demo order (their phones run 101 to 108)
  v_entries := array(
    select ee.id
      from public.event_entries ee join public.people p on p.id = ee.person_id
     where ee.event_id = p_event_id and p.phone like '+4477009001%'
     order by p.phone);
  if coalesce(array_length(v_entries, 1), 0) <> v_count then
    raise exception 'load_ct_demo: the demo roster did not load' using hint = 'demo_roster_failed';
  end if;

  insert into public.ct_stages (id, event_id, kind, ordinal, set_count, duration_secs, cutoff, status) values
    (v_prelims, p_event_id, 'prelims', 1, v_sets, 480, v_cut, 'complete'),
    (v_finals, p_event_id, 'finals', 2, v_sets, 480, null, 'pending');

  insert into public.ct_sets (stage_id, position, label)
  select s.id, g, 'Set ' || g
    from (values (v_prelims), (v_finals)) s(id), generate_series(1, v_sets) g;

  insert into public.ct_stage_entries (stage_id, entry_id, source)
  select v_prelims, e, 'seed' from unnest(v_entries) e;

  -- Prelims: two confirmed heats of four, the odd cuppers in heat 1 and the even in heat 2, hand-timed.
  insert into public.ct_heats (stage_id, heat_number, kind, timing_mode, status, duration_secs, started_at)
  select v_prelims, h, 'normal', 'manual', 'confirmed', 480, now() - interval '1 hour'
    from generate_series(1, 2) h;

  insert into public.ct_heat_entries (heat_id, entry_id, station, elapsed_secs, elapsed_secs_raw, maxed, time_source)
  select ht.id, v_entries[i], 'Table ' || chr(64 + ((i + 1) / 2)::int),
         300 + ((i * 37) % 100), 300 + ((i * 37) % 100), false, 'manual'
    from generate_series(1, v_count) i
    join public.ct_heats ht on ht.stage_id = v_prelims and ht.heat_number = case when i % 2 = 1 then 1 else 2 end;

  insert into public.ct_results (heat_entry_id, set_id, correct)
  select he.id, st.id, st.position <= v_correct[array_position(v_entries, he.entry_id)]
    from public.ct_heat_entries he
    join public.ct_heats ht on ht.id = he.heat_id and ht.stage_id = v_prelims
    join public.ct_sets st on st.stage_id = v_prelims;

  -- Advancement, as resolve_stage records it: the top 4 (most correct, then fastest) go to the Finals as "advanced", the
  -- rest take their final position in the Prelims.
  insert into public.ct_stage_entries (stage_id, entry_id, source)
  select v_finals, r.entry_id, 'advanced'
    from (select v_entries[i] as entry_id,
                 row_number() over (order by v_correct[i] desc, 300 + ((i * 37) % 100) asc) as rk
            from generate_series(1, v_count) i) r
   where r.rk <= v_cut;

  update public.ct_stage_entries se
     set final_position = r.rk
    from (select v_entries[i] as entry_id,
                 row_number() over (order by v_correct[i] desc, 300 + ((i * 37) % 100) asc) as rk
            from generate_series(1, v_count) i) r
   where se.stage_id = v_prelims and se.entry_id = r.entry_id and r.rk > v_cut;

  -- Finals: one heat, generated and waiting (not started), the four finalists at Tables A to D in standings order.
  insert into public.ct_heats (stage_id, heat_number, kind, timing_mode, status, duration_secs)
  values (v_finals, 1, 'normal', 'app', 'pending', 480);

  insert into public.ct_heat_entries (heat_id, entry_id, station)
  select (select id from public.ct_heats where stage_id = v_finals and heat_number = 1 and kind = 'normal'),
         r.entry_id, 'Table ' || chr(64 + r.rk::int)
    from (select v_entries[i] as entry_id,
                 row_number() over (order by v_correct[i] desc, 300 + ((i * 37) % 100) asc) as rk
            from generate_series(1, v_count) i) r
   where r.rk <= v_cut;

  select count(*) into v_heats from public.ct_heats where stage_id in (v_prelims, v_finals);
  return jsonb_build_object('cuppers', v_count, 'stages', 2, 'heats', v_heats, 'scored_heats', 2);
end;
$$;

-- ============ Throwdown: clear ============

create or replace function public.clear_td_demo(p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_format text;
  v_is_test boolean;
begin
  -- One answer for a NULL organisation, a non-member, another organisation's event and an unknown event.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event_internal(p_event_id)
     or not app.is_org_member(p_org_id) then
    raise exception 'clear_td_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  select e.format, e.is_test into v_format, v_is_test from public.events e where e.id = p_event_id for update;
  if v_format is distinct from 'throwdown' then
    raise exception 'clear_td_demo: this demo is only available for Throwdown events' using hint = 'demo_wrong_format';
  end if;
  if v_is_test is not true then
    raise exception 'clear_td_demo: demo data can only be cleared from a test event' using hint = 'demo_not_test';
  end if;
  -- this writes as the definer, so it would walk past the closed-workspace window lock: honour it here
  if app.event_window_locked(p_event_id) then
    raise exception 'clear_td_demo: this event is closed' using errcode = '42501', hint = 'event_window_locked';
  end if;
  perform pg_advisory_xact_lock(hashtext('td:' || p_event_id::text));

  -- Rounds cascade to matches, slots, votes, score sheets and decisions. The roster goes after them: a slot keeps a
  -- competitor from being deleted while a bracket names it.
  -- Slots first: deleting matches first would fire the feeder-link SET NULL on slots whose match is already gone.
  delete from public.td_slots where event_id = p_event_id;
  delete from public.td_rounds where event_id = p_event_id;
  delete from public.td_draws where event_id = p_event_id;
  delete from public.td_settings where event_id = p_event_id;
  delete from public.event_entries where event_id = p_event_id;
end;
$$;

-- ============ Throwdown: load ============

create or replace function public.load_td_demo(p_org_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_format text;
  v_is_test boolean;
  v_entries uuid[];
  v_m record;
  v_win uuid;
  v_lose uuid;
  -- the slot (1 or 2) that wins each quarter-final, in match order: the third is an upset
  v_qf_winner constant int[] := array[1, 2, 1, 1];
  v_decided int := 0;
  v_open int := 0;
begin
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'load_td_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  select format, is_test into v_format, v_is_test from public.events where id = p_event_id for update;
  if v_format is null then
    raise exception 'load_td_demo: event not found' using hint = 'demo_event_not_found';
  end if;
  if v_format <> 'throwdown' then
    raise exception 'load_td_demo: this demo is only available for Throwdown events' using hint = 'demo_wrong_format';
  end if;
  if v_is_test is not true then
    raise exception 'load_td_demo: demo data can only be loaded into a test event' using hint = 'demo_not_test';
  end if;

  perform public.clear_td_demo(p_org_id, p_event_id);
  perform public.load_demo_roster(p_org_id, p_event_id);

  v_entries := array(
    select ee.id
      from public.event_entries ee join public.people p on p.id = ee.person_id
     where ee.event_id = p_event_id and p.phone like '+4477009001%'
     order by p.phone);
  if coalesce(array_length(v_entries, 1), 0) <> 8 then
    raise exception 'load_td_demo: the demo roster did not load' using hint = 'demo_roster_failed';
  end if;

  -- Three judges, a 3rd place match, a recorded random draw (the seed is a fixed word, so the draw repeats).
  perform public.td_save_settings(p_org_id, p_event_id, 3, true, 'random', '{}'::jsonb);
  perform public.td_start_event(
    gen_random_uuid(), p_org_id, p_event_id, 'random', 'demo', 8,
    jsonb_build_array(
      jsonb_build_array(v_entries[1], v_entries[8]),
      jsonb_build_array(v_entries[4], v_entries[5]),
      jsonb_build_array(v_entries[2], v_entries[7]),
      jsonb_build_array(v_entries[3], v_entries[6])));

  -- Quarter-finals: 2 votes to the winner, 1 to the other, then confirmed (which draws the semi-finals).
  for v_m in
    select m.id, m.position
      from public.td_matches m join public.td_rounds r on r.id = m.round_id
     where m.event_id = p_event_id and r.position = 1
     order by m.position
  loop
    select s.id into v_win from public.td_slots s where s.match_id = v_m.id and s.position = v_qf_winner[v_m.position];
    select s.id into v_lose from public.td_slots s where s.match_id = v_m.id and s.position = 3 - v_qf_winner[v_m.position];
    perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_win);
    perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_lose);
    perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_win);
    perform public.td_confirm_match(gen_random_uuid(), p_org_id, v_m.id, v_win);
    v_decided := v_decided + 1;
  end loop;

  -- Semi-finals: the first decided 2 to 1 for its first slot, the second left open with a single vote in.
  for v_m in
    select m.id, m.position
      from public.td_matches m join public.td_rounds r on r.id = m.round_id
     where m.event_id = p_event_id and r.position = 2
     order by m.position
  loop
    select s.id into v_win from public.td_slots s where s.match_id = v_m.id and s.position = 1;
    select s.id into v_lose from public.td_slots s where s.match_id = v_m.id and s.position = 2;
    if v_m.position = 1 then
      perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_win);
      perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_lose);
      perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_win);
      perform public.td_confirm_match(gen_random_uuid(), p_org_id, v_m.id, v_win);
      v_decided := v_decided + 1;
    else
      perform public.td_cast_vote(gen_random_uuid(), p_org_id, v_m.id, v_lose);
      v_open := v_open + 1;
    end if;
  end loop;

  return jsonb_build_object('competitors', 8, 'decided', v_decided, 'open', v_open);
end;
$$;

-- Explicit anon revoke, not just from public (see 20260922130000's own comment).
revoke execute on function public.clear_ct_demo(uuid, uuid) from public, anon;
revoke execute on function public.load_ct_demo(uuid, uuid) from public, anon;
revoke execute on function public.clear_td_demo(uuid, uuid) from public, anon;
revoke execute on function public.load_td_demo(uuid, uuid) from public, anon;
grant execute on function public.clear_ct_demo(uuid, uuid) to authenticated, service_role;
grant execute on function public.load_ct_demo(uuid, uuid) to authenticated, service_role;
grant execute on function public.clear_td_demo(uuid, uuid) to authenticated, service_role;
grant execute on function public.load_td_demo(uuid, uuid) to authenticated, service_role;
