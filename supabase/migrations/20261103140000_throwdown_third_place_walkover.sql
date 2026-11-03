-- Seduh Score Next - T-TD.1.9: the 3rd place match after a walkover (owner decision, 2026-11-03)
--
-- app.td_advance (20261103120000) made no 3rd place round when any semi-final was a bye or a walkover. New rule: make it
-- whenever the event has it on and BOTH semi-final losers exist and are ACTIVE (event_entries.withdrawn is false).
--   * a walkover no longer blocks it: the loser is the other slot's competitor (the one who did not show), if present and
--     not withdrawn. (A competitor who did not show is normally withdrawn on the roster, which still blocks it: the owner's
--     rule is "exist AND active". The organiser who records a walkover without withdrawing the no-show gets the match.)
--   * a bye still blocks it: a bye match has no loser.
--   * a withdrawn loser blocks it.
-- Unchanged: the round is only created when the latest main round is fully decided and has no successor (so a second call
-- creates nothing, idempotent), and the 3rd place round and the Final are created together, both live at once.
-- Only the function body changes (create or replace); no table, grant or policy. Migrations already in the cloud are not
-- edited: this is a new one.
--
-- rollback: restores the 20261103120000 body of app.td_advance (the old rule: no 3rd place after a bye or a walkover)
--   create or replace function app.td_advance(p_event_id uuid)
--   returns void
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_round     public.td_rounds;
--     v_winners   uuid[];
--     v_feeders   uuid[];
--     v_losers    uuid[];
--     v_n         int;
--     v_pos       int;
--     v_new_round uuid;
--     v_third     boolean;
--     i           int;
--   begin
--     loop
--       select * into v_round from public.td_rounds
--        where event_id = p_event_id and phase = 'main'
--        order by position desc limit 1;
--       exit when not found;
--       -- the latest main round must be fully decided before anything follows it
--       exit when exists (select 1 from public.td_matches m where m.round_id = v_round.id and m.result_kind is null);
--
--       select array_agg(w.entry_id order by m.position), array_agg(m.id order by m.position),
--              array_agg(l.entry_id order by m.position)
--         into v_winners, v_feeders, v_losers
--         from public.td_matches m
--         join public.td_match_results r on r.match_id = m.id
--         join public.td_slots w on w.id = r.winner_slot_id
--         left join public.td_slots l on l.match_id = m.id and l.id <> w.id
--        where m.round_id = v_round.id;
--
--       v_n := coalesce(array_length(v_winners, 1), 0);
--       if v_n <> (select count(*) from public.td_matches m where m.round_id = v_round.id) then
--         raise exception 'td_advance: a decided match has no winner';
--       end if;
--       -- one winner left: the champion. Nothing follows.
--       exit when v_n <= 1;
--
--       v_pos := v_round.position + 1;
--       v_third := coalesce((select s.third_place from public.td_settings s where s.event_id = p_event_id), true)
--                  and v_n = 2
--                  and not exists (select 1 from public.td_matches m
--                                   where m.round_id = v_round.id and m.result_kind in ('bye', 'walkover'));
--       if v_third then
--         insert into public.td_rounds (event_id, position, kind, phase)
--           values (p_event_id, v_pos, 'pair', 'third_place') returning id into v_new_round;
--         perform app.td_add_pair_match(p_event_id, v_new_round, 1, v_losers[1], v_losers[2], v_feeders[1], v_feeders[2]);
--         v_pos := v_pos + 1;
--       end if;
--
--       insert into public.td_rounds (event_id, position, kind, phase)
--         values (p_event_id, v_pos, 'pair', 'main') returning id into v_new_round;
--       i := 1;
--       while i <= v_n loop
--         perform app.td_add_pair_match(
--           p_event_id, v_new_round, (i + 1) / 2,
--           v_winners[i], case when i + 1 <= v_n then v_winners[i + 1] end,
--           v_feeders[i], case when i + 1 <= v_n then v_feeders[i + 1] end);
--         i := i + 2;
--       end loop;
--       -- a new round can only hold byes plus real matches (v_n >= 2), so it is never complete: the loop ends next pass
--     end loop;
--   end;
--   $$;

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
    -- The 3rd place match is made when the event has it on and BOTH semi-final losers exist and are still active
    -- (owner decision 2026-11-03). A walkover no longer blocks it: its loser is the other slot's competitor. A bye still
    -- does: a bye match has no loser, so v_losers holds a null. A loser who has withdrawn blocks it, too.
    v_third := coalesce((select s.third_place from public.td_settings s where s.event_id = p_event_id), true)
               and v_n = 2
               and v_losers[1] is not null and v_losers[2] is not null
               and not exists (select 1 from public.event_entries e
                                where e.id in (v_losers[1], v_losers[2]) and e.withdrawn);
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
