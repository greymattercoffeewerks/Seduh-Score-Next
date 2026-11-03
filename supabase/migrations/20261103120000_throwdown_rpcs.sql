-- Seduh Score Next - T-TD.1.3: Throwdown functions (settings, draw, vote, confirm, walkover, advancement)
--
-- The only writers of the td_* tables (the API roles hold SELECT only, see 20261103110000). Each public function:
--   * takes the organisation first, then the resource, and opens with app.td_guard: a caller who is not a member of
--     that organisation, an event that is not that organisation's, an event that is not a Throwdown, or a missing id
--     all answer the same "<function>: event not found" (no id is confirmed or denied);
--   * is SECURITY DEFINER with search_path '' (it writes tables the caller cannot), so the guard IS the authorisation;
--   * serialises on one advisory lock per event, so two devices tapping at once cannot both advance a round;
--   * is idempotent. The write functions take an operation id and record it in processed_operations, so an outbox
--     replay of a vote tap, an undo, a confirm or a walkover does nothing the second time (a vote is not idempotent
--     by nature: a replayed tap would count twice without the ledger).
--
-- Advancement is DERIVED and runs in the same transaction as the result that causes it (app.td_advance): when every
-- match of the latest main round is decided, the next round is created from that round's winners, in match order.
-- Nothing is projected ahead: a round that has not been earned does not exist. An odd number of winners gives the last
-- one a bye (a match with one filled slot, decided at once). When exactly two winners are left, the next main round is
-- the Final, and, if the event has the 3rd place match on and both semi-finals were played out by vote (neither a bye
-- nor a walkover, so both losers are present), a third_place round is created just before it, so both are live at once.
-- Calling td_advance again changes nothing: it creates a round only when the latest main round is complete and has no
-- successor, so a second tap on Continue cannot duplicate a round (the legacy defect, POA-76).
--
-- Winners are computed in td_match_results (the migration before). This file's confirm checks the same rule inline
-- because the view only answers for a match whose result is already recorded.
--
-- rollback:
--   drop function if exists public.td_record_walkover(uuid, uuid, uuid, uuid);
--   drop function if exists public.td_confirm_match(uuid, uuid, uuid);
--   drop function if exists public.td_undo_vote(uuid, uuid, uuid, uuid);
--   drop function if exists public.td_cast_vote(uuid, uuid, uuid, uuid);
--   drop function if exists public.td_start_event(uuid, uuid, uuid, text, text, int, jsonb);
--   drop function if exists public.td_save_settings(uuid, uuid, int, boolean, text, jsonb);
--   drop function if exists app.td_advance(uuid);
--   drop function if exists app.td_add_pair_match(uuid, uuid, int, uuid, uuid, uuid, uuid);
--   drop function if exists app.td_guard_match(text, uuid, uuid);
--   drop function if exists app.td_guard(text, uuid, uuid);

-- ============ guards ============

create or replace function app.td_guard(p_fn text, p_org_id uuid, p_event_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_event_id is null
     or not app.is_org_member(p_org_id)
     or app.org_id_for_event_internal(p_event_id) is distinct from p_org_id
     or (select e.format from public.events e where e.id = p_event_id) is distinct from 'throwdown' then
    raise exception '%: event not found', p_fn;
  end if;
  -- these functions write as the definer, so they would walk past the Per-event window lock's row-level policies:
  -- the closed workspace is closed to them too (the lock key is off until an operator flips it)
  if app.event_window_locked(p_event_id) then
    raise exception '%: this event is closed', p_fn using errcode = '42501', hint = 'event_window_locked';
  end if;
end;
$$;
revoke all on function app.td_guard(text, uuid, uuid) from public, anon, authenticated, service_role;

-- A match id names its event; the guard then asks the same question. Returns the event id.
create or replace function app.td_guard_match(p_fn text, p_org_id uuid, p_match_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  select m.event_id into v_event from public.td_matches m where m.id = p_match_id;
  perform app.td_guard(p_fn, p_org_id, v_event);
  return v_event;
end;
$$;
revoke all on function app.td_guard_match(text, uuid, uuid) from public, anon, authenticated, service_role;

-- ============ one match of a pair round (a second slot of null is a bye, decided at once) ============

create or replace function app.td_add_pair_match(
  p_event_id uuid, p_round_id uuid, p_position int,
  p_entry_1 uuid, p_entry_2 uuid, p_feeder_1 uuid, p_feeder_2 uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
begin
  insert into public.td_matches (event_id, round_id, position, result_kind, confirmed_at)
  values (p_event_id, p_round_id, p_position,
          case when p_entry_2 is null then 'bye' end,
          case when p_entry_2 is null then now() end)
  returning id into v_match;
  insert into public.td_slots (event_id, match_id, position, entry_id, feeder_match_id) values
    (p_event_id, v_match, 1, p_entry_1, p_feeder_1),
    (p_event_id, v_match, 2, p_entry_2, p_feeder_2);
  return v_match;
end;
$$;
revoke all on function app.td_add_pair_match(uuid, uuid, int, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ============ advancement (derived; idempotent) ============

create or replace function app.td_advance(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round     public.td_rounds;
  v_winners   uuid[];
  v_feeders   uuid[];
  v_losers    uuid[];
  v_n         int;
  v_pos       int;
  v_new_round uuid;
  v_third     boolean;
  i           int;
begin
  loop
    select * into v_round from public.td_rounds
     where event_id = p_event_id and phase = 'main'
     order by position desc limit 1;
    exit when not found;
    -- the latest main round must be fully decided before anything follows it
    exit when exists (select 1 from public.td_matches m where m.round_id = v_round.id and m.result_kind is null);

    select array_agg(w.entry_id order by m.position), array_agg(m.id order by m.position),
           array_agg(l.entry_id order by m.position)
      into v_winners, v_feeders, v_losers
      from public.td_matches m
      join public.td_match_results r on r.match_id = m.id
      join public.td_slots w on w.id = r.winner_slot_id
      left join public.td_slots l on l.match_id = m.id and l.id <> w.id
     where m.round_id = v_round.id;

    v_n := coalesce(array_length(v_winners, 1), 0);
    if v_n <> (select count(*) from public.td_matches m where m.round_id = v_round.id) then
      raise exception 'td_advance: a decided match has no winner';
    end if;
    -- one winner left: the champion. Nothing follows.
    exit when v_n <= 1;

    v_pos := v_round.position + 1;
    v_third := coalesce((select s.third_place from public.td_settings s where s.event_id = p_event_id), true)
               and v_n = 2
               and not exists (select 1 from public.td_matches m
                                where m.round_id = v_round.id and m.result_kind in ('bye', 'walkover'));
    if v_third then
      insert into public.td_rounds (event_id, position, kind, phase)
        values (p_event_id, v_pos, 'pair', 'third_place') returning id into v_new_round;
      perform app.td_add_pair_match(p_event_id, v_new_round, 1, v_losers[1], v_losers[2], v_feeders[1], v_feeders[2]);
      v_pos := v_pos + 1;
    end if;

    insert into public.td_rounds (event_id, position, kind, phase)
      values (p_event_id, v_pos, 'pair', 'main') returning id into v_new_round;
    i := 1;
    while i <= v_n loop
      perform app.td_add_pair_match(
        p_event_id, v_new_round, (i + 1) / 2,
        v_winners[i], case when i + 1 <= v_n then v_winners[i + 1] end,
        v_feeders[i], case when i + 1 <= v_n then v_feeders[i + 1] end);
      i := i + 2;
    end loop;
    -- a new round can only hold byes plus real matches (v_n >= 2), so it is never complete: the loop ends next pass
  end loop;
end;
$$;
revoke all on function app.td_advance(uuid) from public, anon, authenticated, service_role;

-- ============ setup ============

create or replace function public.td_save_settings(
  p_org_id uuid, p_event_id uuid, p_judge_count int, p_third_place boolean, p_seeding_mode text, p_modules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules jsonb := coalesce(p_modules, '{}'::jsonb);
  k         text;
  req       text;
  reg       record;
begin
  perform app.td_guard('td_save_settings', p_org_id, p_event_id);
  perform pg_advisory_xact_lock(hashtext('td:' || p_event_id::text));

  if exists (select 1 from public.td_rounds r where r.event_id = p_event_id) then
    raise exception 'td_save_settings: setup is locked, Round 1 has started'
      using errcode = '23001', hint = 'td_setup_locked';
  end if;
  if p_judge_count is null or p_judge_count not between 1 and 15 then
    raise exception 'td_save_settings: the judge count must be between 1 and 15' using hint = 'td_judge_count_invalid';
  end if;
  if p_seeding_mode is null or p_seeding_mode not in ('random', 'manual') then
    raise exception 'td_save_settings: the seeding mode must be random or manual' using hint = 'td_seeding_invalid';
  end if;
  if jsonb_typeof(v_modules) <> 'object' then
    raise exception 'td_save_settings: modules must be an object' using hint = 'td_module_invalid';
  end if;

  -- the module toggle mechanism: every enabled key must be a known module, its declared dependencies must be enabled
  -- too (a refusal with the reason, never a silent no-op), and its entitlement key slot must allow it.
  for k in select jsonb_object_keys(v_modules) loop
    if v_modules -> k in ('false'::jsonb, 'null'::jsonb) then
      continue;
    end if;
    select * into reg from app.td_module_registry() r where r.module = k;
    if not found then
      raise exception 'td_save_settings: unknown module %', k using hint = 'td_module_unknown';
    end if;
    foreach req in array coalesce(reg.requires, '{}'::text[]) loop
      if coalesce(v_modules -> req, 'false'::jsonb) in ('false'::jsonb, 'null'::jsonb) then
        raise exception 'td_save_settings: module % needs module % to be on', k, req
          using hint = 'td_module_dependency', detail = req;
      end if;
    end loop;
    if reg.entitlement_key is not null and not app.has_entitlement(p_org_id, reg.entitlement_key, p_event_id) then
      raise exception 'entitlement_required'
        using errcode = '42501', hint = 'entitlement_required', detail = reg.entitlement_key;
    end if;
  end loop;
  -- stored with the switched-off toggles removed, so a module that is off leaves no trace
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_modules
    from jsonb_each(v_modules) where value not in ('false'::jsonb, 'null'::jsonb);

  insert into public.td_settings (event_id, judge_count, third_place, seeding_mode, modules)
  values (p_event_id, p_judge_count, coalesce(p_third_place, true), p_seeding_mode, v_modules)
  on conflict (event_id) do update
    set judge_count = excluded.judge_count, third_place = excluded.third_place,
        seeding_mode = excluded.seeding_mode, modules = excluded.modules;
end;
$$;
revoke all on function public.td_save_settings(uuid, uuid, int, boolean, text, jsonb) from public, anon;
grant execute on function public.td_save_settings(uuid, uuid, int, boolean, text, jsonb) to authenticated;

-- ============ the draw: starts Round 1 (and locks setup) ============
-- p_pairs: [[entry_id | null, entry_id | null], ...] in Round 1 order. The browser shuffles (a recorded seed, so the draw
-- can be explained afterwards; the database cannot replay a browser PRNG, so it stores the seed and checks the SHAPE).
-- Normalised exactly as a manual draw is read (spec section 6): a pair with one name becomes a bye (an opponent-only
-- slot moves to the first position), a fully empty pair is dropped, and a draw with no real pair is refused. A
-- competitor can fill at most one slot. A random draw must place every active competitor; a manual draw may leave some
-- out (the organiser's physical draw decides who is in).
create or replace function public.td_start_event(
  p_operation_id uuid, p_org_id uuid, p_event_id uuid, p_mode text, p_seed text, p_slot_count int, p_pairs jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.td_settings;
  v_round    uuid;
  v_a        uuid;
  v_b        uuid;
  v_seen     uuid[] := '{}';
  v_pos      int := 0;
  v_real     int := 0;
  v_len      int;
  i          int;
begin
  perform app.td_guard('td_start_event', p_org_id, p_event_id);
  perform pg_advisory_xact_lock(hashtext('td:' || p_event_id::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if exists (select 1 from public.td_rounds r where r.event_id = p_event_id) then
    raise exception 'td_start_event: this event has already started' using hint = 'td_already_started';
  end if;
  if p_mode is null or p_mode not in ('random', 'manual') then
    raise exception 'td_start_event: the mode must be random or manual' using hint = 'td_seeding_invalid';
  end if;
  if (p_mode = 'random') <> (p_seed is not null and length(p_seed) > 0) then
    raise exception 'td_start_event: a random draw records its seed, a manual one has none' using hint = 'td_seed_invalid';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) = 0
     or p_slot_count is distinct from 2 * jsonb_array_length(p_pairs) then
    raise exception 'td_start_event: the draw has no pairs' using hint = 'td_draw_empty';
  end if;

  select * into v_settings from public.td_settings s where s.event_id = p_event_id;
  if not found then
    insert into public.td_settings (event_id, seeding_mode) values (p_event_id, p_mode) returning * into v_settings;
  end if;
  if v_settings.seeding_mode <> p_mode then
    raise exception 'td_start_event: the draw mode does not match the setup' using hint = 'td_seeding_mismatch';
  end if;

  -- validate every named competitor before writing anything
  v_len := jsonb_array_length(p_pairs);
  for i in 0 .. v_len - 1 loop
    if jsonb_typeof(p_pairs -> i) <> 'array' or jsonb_array_length(p_pairs -> i) <> 2 then
      raise exception 'td_start_event: every pair has two slots' using hint = 'td_draw_shape';
    end if;
    for v_pos in 0 .. 1 loop
      v_a := nullif(p_pairs -> i ->> v_pos, '')::uuid;
      if v_a is not null then
        if v_a = any (v_seen) then
          raise exception 'td_start_event: a competitor can fill only one slot' using hint = 'td_draw_duplicate';
        end if;
        if not exists (select 1 from public.event_entries e
                        where e.id = v_a and e.event_id = p_event_id and not e.withdrawn) then
          raise exception 'td_start_event: a competitor is not on this event''s active roster' using hint = 'td_draw_entry';
        end if;
        v_seen := v_seen || v_a;
      end if;
    end loop;
  end loop;
  if p_mode = 'random' and exists (
       select 1 from public.event_entries e
        where e.event_id = p_event_id and not e.withdrawn and e.id <> all (v_seen)) then
    raise exception 'td_start_event: a random draw must include every active competitor' using hint = 'td_draw_incomplete';
  end if;

  insert into public.td_draws (event_id, mode, seed, slot_count)
    values (p_event_id, p_mode, case when p_mode = 'random' then p_seed end, p_slot_count);
  insert into public.td_rounds (event_id, position, kind, phase)
    values (p_event_id, 1, 'pair', 'main') returning id into v_round;

  v_pos := 0;
  for i in 0 .. v_len - 1 loop
    v_a := nullif(p_pairs -> i ->> 0, '')::uuid;
    v_b := nullif(p_pairs -> i ->> 1, '')::uuid;
    if v_a is null and v_b is not null then
      v_a := v_b;
      v_b := null;
    end if;
    continue when v_a is null;          -- a fully empty pair is dropped
    v_pos := v_pos + 1;
    if v_b is not null then
      v_real := v_real + 1;
    end if;
    perform app.td_add_pair_match(p_event_id, v_round, v_pos, v_a, v_b, null, null);
  end loop;
  if v_real = 0 then
    raise exception 'td_start_event: at least one pair of two competitors is needed' using hint = 'td_draw_empty';
  end if;

  perform app.td_advance(p_event_id);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_start_event');
end;
$$;
revoke all on function public.td_start_event(uuid, uuid, uuid, text, text, int, jsonb) from public, anon;
grant execute on function public.td_start_event(uuid, uuid, uuid, text, text, int, jsonb) to authenticated;

-- ============ a judge's tap, and taking it back ============

create or replace function public.td_cast_vote(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  v_event := app.td_guard_match('td_cast_vote', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    raise exception 'td_cast_vote: the match is already decided' using hint = 'td_match_decided';
  end if;
  if not exists (select 1 from public.td_slots s
                  where s.id = p_slot_id and s.match_id = p_match_id and s.entry_id is not null) then
    raise exception 'td_cast_vote: slot not found' using hint = 'td_slot_invalid';
  end if;
  insert into public.td_votes (event_id, match_id, slot_id) values (v_event, p_match_id, p_slot_id);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_cast_vote');
end;
$$;
revoke all on function public.td_cast_vote(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_cast_vote(uuid, uuid, uuid, uuid) to authenticated;

-- Takes back the newest tap for a slot. Nothing to take back is a quiet no-op (the operation is still recorded).
create or replace function public.td_undo_vote(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  v_event := app.td_guard_match('td_undo_vote', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    raise exception 'td_undo_vote: the match is already decided' using hint = 'td_match_decided';
  end if;
  if not exists (select 1 from public.td_slots s where s.id = p_slot_id and s.match_id = p_match_id) then
    raise exception 'td_undo_vote: slot not found' using hint = 'td_slot_invalid';
  end if;
  delete from public.td_votes
   where id = (select v.id from public.td_votes v
                where v.slot_id = p_slot_id order by v.created_at desc, v.id desc limit 1);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_undo_vote');
end;
$$;
revoke all on function public.td_undo_vote(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_undo_vote(uuid, uuid, uuid, uuid) to authenticated;

-- ============ confirm: the majority wins; level votes cannot be committed ============

create or replace function public.td_confirm_match(p_operation_id uuid, p_org_id uuid, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   uuid;
  v_leaders int;
  v_top     bigint;
begin
  v_event := app.td_guard_match('td_confirm_match', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  -- already decided (a double tap with a fresh operation id): nothing to do
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    return;
  end if;
  if (select count(*) from public.td_slots s where s.match_id = p_match_id and s.entry_id is not null) < 2 then
    raise exception 'td_confirm_match: the match does not have two competitors' using hint = 'td_match_not_ready';
  end if;

  select count(*) filter (where t.n = t.mx), max(t.n) into v_leaders, v_top
    from (select s.id, count(v.id) as n, max(count(v.id)) over () as mx
            from public.td_slots s left join public.td_votes v on v.slot_id = s.id
           where s.match_id = p_match_id and s.entry_id is not null
           group by s.id) t;
  if v_top = 0 or v_leaders <> 1 then
    raise exception 'td_confirm_match: the votes are level' using hint = 'td_votes_level';
  end if;

  update public.td_matches set result_kind = 'votes', confirmed_at = now() where id = p_match_id;
  perform app.td_advance(v_event);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_confirm_match');
end;
$$;
revoke all on function public.td_confirm_match(uuid, uuid, uuid) from public, anon;
grant execute on function public.td_confirm_match(uuid, uuid, uuid) to authenticated;

-- ============ walkover: its own result kind, never a tally ============

create or replace function public.td_record_walkover(
  p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_winner_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_pos   smallint;
begin
  v_event := app.td_guard_match('td_record_walkover', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    raise exception 'td_record_walkover: the match is already decided' using hint = 'td_match_decided';
  end if;
  if (select count(*) from public.td_slots s where s.match_id = p_match_id and s.entry_id is not null) < 2 then
    raise exception 'td_record_walkover: the match does not have two competitors' using hint = 'td_match_not_ready';
  end if;
  select s.position into v_pos from public.td_slots s
   where s.id = p_winner_slot_id and s.match_id = p_match_id and s.entry_id is not null;
  if v_pos is null then
    raise exception 'td_record_walkover: slot not found' using hint = 'td_slot_invalid';
  end if;

  update public.td_matches
     set result_kind = 'walkover', walkover_winner_position = v_pos, confirmed_at = now()
   where id = p_match_id;
  perform app.td_advance(v_event);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_record_walkover');
end;
$$;
revoke all on function public.td_record_walkover(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_record_walkover(uuid, uuid, uuid, uuid) to authenticated;
