-- Seduh Score Next - T-TD.3: Throwdown redemption rounds (owner decisions 2026-11-03 and 2026-11-27)
--
-- Redemption is a module: after a main round the organiser chose as a FEEDING round, the competitors who lost in it are
-- drawn at random into groups (2 to 4 a group, owner-set, default 3), each group is a POOL match (2 to 4 slots, the shape
-- TD.1 reserved), the judges vote for one brewer per group, and the group winners go back into the bracket beside the
-- feeding round's own winners. Nothing in td_rounds, td_matches, td_slots or td_votes changes shape: a redemption round is
-- a round with kind 'pool' and phase 'redemption' (already allowed), a group is a match with up to four slots.
--
-- Owner decisions built here:
--   * groups are drawn randomly (the pool is shuffled in the database; the groups are written as rows, so the draw is
--     recorded by the rows themselves, and whether to also store a seed is still spec Q4);
--   * several redemption rounds are allowed (one after each feeding round the organiser ticked) and a brewer can be
--     revived more than once: each redemption round draws from the losers of ITS feeding round, nothing blocks a
--     returning brewer, so no "one redemption per competitor" rule exists (spec Q3b, superseded);
--   * the cap limits the winners that go back, not the entrants (0 = no limit). When there are more group winners than
--     the cap, the winners with the most votes return, ties by group order (an assumption, to confirm with the owner);
--   * a round exists only once the one before it is fully decided (nothing is projected): the redemption round is created
--     in the same transaction as the feeding round's last result, and the next main round is created when the last
--     group is decided. Both steps are idempotent (td_advance creates a round only from the latest decided round).
--
-- Rules of the pool vote (the same table, view and functions as a pair; only the shape differs):
--   * a group's winner is the brewer with strictly the most votes (td_match_results, unchanged);
--   * when the judges are all in and the top is shared, ONE tie-break vote opens, and it can go only to a brewer who is
--     in that tie (td_cast_vote, hint td_tiebreak_slot; for a pair both sides are always in it, so a pair is unchanged).
--
-- Also fixes the pair assumption in app.td_advance (ROADMAP "Pool matches (TD.3): the loser join in app.td_advance assumes
-- pair matches"): the loser of a match is now taken from the match's decided winner for any number of slots, the latest
-- round is the latest main OR redemption round, and a redemption round feeds the next main round exactly as a main round
-- does. td_reopen_match treats a redemption match like a main one (it removes the rounds after it while none has started).
--
-- The registry gains the module { redemption, requires none, key throwdown_redemption (Per-event and up) }. The stored
-- setup is exactly { group_size 2..4, cap 0.., feed [main round numbers 1..4] }; a module that is off stores nothing.
--
-- rollback: re-run the create-or-replace statements of the functions this file replaces, from the migrations that last
-- defined them, then drop what this file adds:
--   alter table td_settings drop constraint if exists td_settings_redemption_valid;
--   -- td_module_registry, td_save_settings: 20261127100000_td_scoresheet_registry.sql
--   -- td_advance:                           20261103140000_throwdown_third_place_walkover.sql
--   -- td_cast_vote:                         20261128100000_td_vote_cap.sql
--   -- td_reopen_match:                      20261129100000_td_reopen_match.sql
--   drop function if exists app.td_modules_redemption_ok(jsonb);
--   drop function if exists app.td_redemption_config_valid(jsonb);
--   drop function if exists app.td_add_pool_match(uuid, uuid, int, uuid[], uuid[]);
--   drop function if exists app.td_group_sizes(int, int);
--   (any td_settings row that stored a redemption module must be edited out first, or the registry check refuses)

-- ============ pure helpers ============

-- How many brewers sit in each group: ceil(pool / group size) groups, as even as possible, never a group of one (a
-- singleton has nobody to be voted against). With groups of 2 and an odd pool, one group is a three. Mirrored by
-- src/formats/throwdown/redemption.js (groupSizes); both are checked against the same cases.
create or replace function app.td_group_sizes(p_pool int, p_group_size int)
returns int[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  g    int;
  base int;
  extra int;
  out  int[] := '{}';
  i    int;
begin
  if p_pool is null or p_group_size is null or p_pool < 2 or p_group_size not between 2 and 4 then
    return '{}';
  end if;
  g := greatest(1, least(ceil(p_pool::numeric / p_group_size)::int, p_pool / 2));
  base := p_pool / g;
  extra := p_pool % g;
  for i in 1 .. g loop
    out := out || (base + case when i <= extra then 1 else 0 end);
  end loop;
  return out;
end;
$$;
revoke all on function app.td_group_sizes(int, int) from public, anon, authenticated, service_role;

-- The stored shape: exactly { group_size, cap, feed }, nothing else.
create or replace function app.td_redemption_config_valid(p_cfg jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_cfg) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_cfg)) <> 3
     or not (p_cfg ? 'group_size' and p_cfg ? 'cap' and p_cfg ? 'feed') then
    return false;
  end if;
  if jsonb_typeof(p_cfg -> 'group_size') is distinct from 'number'
     or (p_cfg ->> 'group_size') not in ('2', '3', '4') then
    return false;
  end if;
  if jsonb_typeof(p_cfg -> 'cap') is distinct from 'number'
     or (p_cfg ->> 'cap') !~ '^[0-9]{1,2}$' then
    return false;
  end if;
  if jsonb_typeof(p_cfg -> 'feed') is distinct from 'array'
     or jsonb_array_length(p_cfg -> 'feed') not between 1 and 4 then
    return false;
  end if;
  return not exists (
    select 1 from jsonb_array_elements(p_cfg -> 'feed') f
     where jsonb_typeof(f) is distinct from 'number' or (f #>> '{}') not in ('1', '2', '3', '4'));
end;
$$;
revoke all on function app.td_redemption_config_valid(jsonb) from public, anon, authenticated, service_role;

create or replace function app.td_modules_redemption_ok(p_modules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (p_modules ? 'redemption') or app.td_redemption_config_valid(p_modules -> 'redemption')
$$;
revoke all on function app.td_modules_redemption_ok(jsonb) from public, anon, authenticated, service_role;

-- ============ the registry: two modules ============
create or replace function app.td_module_registry()
returns table (module text, requires text[], entitlement_key text)
language sql
immutable
set search_path = ''
as $$
  select 'scoresheet'::text, '{}'::text[], 'throwdown_scoresheet'::text
  union all
  select 'redemption'::text, '{}'::text[], 'throwdown_redemption'::text;
$$;
revoke all on function app.td_module_registry() from public, anon, authenticated, service_role;

alter table td_settings
  add constraint td_settings_redemption_valid check (app.td_modules_redemption_ok(modules));

-- ============ setup: td_save_settings also reads the redemption module ============
-- Same signature and behaviour as 20261127100000's, plus: a switched-on `redemption` is rebuilt as
-- { group_size (default 3), cap (default 0), feed (sorted, distinct) } and checked as a whole.
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
  v_preset  text;
  v_red     jsonb;
  v_feed    jsonb;
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

  -- the scoresheet module: a preset and the cups per round role; the preset's lines are copied in here
  if v_modules ? 'scoresheet' and v_modules -> 'scoresheet' not in ('false'::jsonb, 'null'::jsonb) then
    if jsonb_typeof(v_modules -> 'scoresheet') <> 'object'
       or jsonb_typeof(v_modules -> 'scoresheet' -> 'preset') is distinct from 'string'
       or jsonb_typeof(v_modules -> 'scoresheet' -> 'cups') is distinct from 'object' then
      raise exception 'td_save_settings: the scoresheet module needs a preset and the cups per round'
        using hint = 'td_scoresheet_invalid';
    end if;
    v_preset := v_modules -> 'scoresheet' ->> 'preset';
    if app.td_scoresheet_preset_lines(v_preset) is null then
      raise exception 'td_save_settings: unknown scoresheet preset' using hint = 'td_scoresheet_invalid';
    end if;
    v_modules := jsonb_set(v_modules, '{scoresheet}', jsonb_build_object(
      'preset', v_preset,
      'lines', app.td_scoresheet_preset_lines(v_preset),
      'cups', v_modules -> 'scoresheet' -> 'cups'));
    if not app.td_scoresheet_config_valid(v_modules -> 'scoresheet') then
      raise exception 'td_save_settings: the scoresheet needs 1 to 3 cups for at least one of final, third_place, semi_final, quarter_final'
        using hint = 'td_scoresheet_invalid';
    end if;
  end if;

  -- the redemption module: group size, the cap on winners that return (0 = no limit) and the feeding rounds
  if v_modules ? 'redemption' and v_modules -> 'redemption' not in ('false'::jsonb, 'null'::jsonb) then
    v_red := v_modules -> 'redemption';
    if jsonb_typeof(v_red) <> 'object' or jsonb_typeof(v_red -> 'feed') is distinct from 'array' then
      raise exception 'td_save_settings: redemption needs a group size, a cap and the rounds that feed it'
        using hint = 'td_redemption_invalid';
    end if;
    -- sorted and distinct, so the same choice is stored one way
    select coalesce(jsonb_agg(f order by f), '[]'::jsonb) into v_feed
      from (select distinct x as f from jsonb_array_elements(v_red -> 'feed') x) d;
    v_modules := jsonb_set(v_modules, '{redemption}', jsonb_build_object(
      'group_size', coalesce(v_red -> 'group_size', '3'::jsonb),
      'cap', coalesce(v_red -> 'cap', '0'::jsonb),
      'feed', v_feed));
    if not app.td_redemption_config_valid(v_modules -> 'redemption') then
      raise exception 'td_save_settings: redemption needs groups of 2 to 4, a cap of 0 or more, and 1 to 4 feeding rounds'
        using hint = 'td_redemption_invalid';
    end if;
  end if;

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

-- ============ one group of a redemption round (2 to 4 slots, all filled) ============
create or replace function app.td_add_pool_match(
  p_event_id uuid, p_round_id uuid, p_position int, p_entries uuid[], p_feeders uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match uuid;
  i       int;
begin
  if coalesce(array_length(p_entries, 1), 0) not between 2 and 4 then
    raise exception 'td_add_pool_match: a group has 2 to 4 brewers';
  end if;
  insert into public.td_matches (event_id, round_id, position) values (p_event_id, p_round_id, p_position)
    returning id into v_match;
  for i in 1 .. array_length(p_entries, 1) loop
    insert into public.td_slots (event_id, match_id, position, entry_id, feeder_match_id)
      values (p_event_id, v_match, i, p_entries[i], p_feeders[i]);
  end loop;
  return v_match;
end;
$$;
revoke all on function app.td_add_pool_match(uuid, uuid, int, uuid[], uuid[]) from public, anon, authenticated, service_role;

-- ============ advancement: main rounds, redemption rounds, and the way back ============
create or replace function app.td_advance(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round       public.td_rounds;
  v_winners     uuid[];
  v_feeders     uuid[];
  v_losers      uuid[];
  v_n           int;
  v_pos         int;
  v_new_round   uuid;
  v_third       boolean;
  v_cfg         jsonb;
  v_main_index  int;
  v_pool        uuid[];
  v_pool_from   uuid[];
  v_sizes       int[];
  v_revived     uuid[];
  v_rev_from    uuid[];
  v_cap         int;
  v_at          int;
  v_group       int;
  i             int;
begin
  loop
    -- the latest round that decides who goes on: a main round or a redemption round (the 3rd place round never does)
    select * into v_round from public.td_rounds
     where event_id = p_event_id and phase in ('main', 'redemption')
     order by position desc limit 1;
    exit when not found;
    -- it must be fully decided before anything follows it
    exit when exists (select 1 from public.td_matches m where m.round_id = v_round.id and m.result_kind is null);

    if v_round.phase = 'main' then
      -- every winner (the decided winner's slot, whatever the number of slots) and, for a pair, the one loser
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

      -- A redemption round follows this main round when the organiser chose it as a feeding round and it still leaves
      -- more than four winners (so the brewers who come back rejoin at the quarter-finals at the latest). Its entrants
      -- are the ACTIVE losers, drawn at random into groups. Fewer than two losers: no round, the bracket goes on.
      v_cfg := (select s.modules -> 'redemption' from public.td_settings s where s.event_id = p_event_id);
      if v_cfg is not null and v_n > 4 then
        v_main_index := (select count(*) from public.td_rounds r
                          where r.event_id = p_event_id and r.phase = 'main' and r.position <= v_round.position);
        if (v_cfg -> 'feed') @> to_jsonb(v_main_index) then
          select array_agg(t.entry_id order by t.rnd), array_agg(t.match_id order by t.rnd)
            into v_pool, v_pool_from
            from (select l.entry_id, m.id as match_id, random() as rnd
                    from public.td_matches m
                    join public.td_match_results r on r.match_id = m.id
                    join public.td_slots l on l.match_id = m.id and l.id <> r.winner_slot_id and l.entry_id is not null
                    join public.event_entries e on e.id = l.entry_id and not e.withdrawn
                   where m.round_id = v_round.id) t;
          if coalesce(array_length(v_pool, 1), 0) >= 2 then
            v_sizes := app.td_group_sizes(array_length(v_pool, 1), (v_cfg ->> 'group_size')::int);
            insert into public.td_rounds (event_id, position, kind, phase)
              values (p_event_id, v_round.position + 1, 'pool', 'redemption') returning id into v_new_round;
            v_at := 1;
            for v_group in 1 .. array_length(v_sizes, 1) loop
              perform app.td_add_pool_match(
                p_event_id, v_new_round, v_group,
                v_pool[v_at : v_at + v_sizes[v_group] - 1], v_pool_from[v_at : v_at + v_sizes[v_group] - 1]);
              v_at := v_at + v_sizes[v_group];
            end loop;
            -- the redemption round is now the latest round and undecided: the loop ends on the next pass
            continue;
          end if;
        end if;
      end if;
    else
      -- a decided redemption round: its group winners (cap-limited) rejoin the winners of the main round before it
      v_cap := coalesce(((select s.modules -> 'redemption' ->> 'cap' from public.td_settings s
                           where s.event_id = p_event_id))::int, 0);
      select array_agg(w.entry_id order by m.position), array_agg(m.id order by m.position)
        into v_winners, v_feeders
        from public.td_matches m
        join public.td_match_results r on r.match_id = m.id
        join public.td_slots w on w.id = r.winner_slot_id
       where m.round_id = (select fr.id from public.td_rounds fr
                            where fr.event_id = p_event_id and fr.phase = 'main' and fr.position < v_round.position
                            order by fr.position desc limit 1);
      -- the group winners that return: all of them, or (with a cap) the ones with the most votes, ties by group order
      select array_agg(t.entry_id order by t.gpos), array_agg(t.match_id order by t.gpos)
        into v_revived, v_rev_from
        from (select w.entry_id, m.id as match_id, m.position as gpos,
                     row_number() over (order by
                       (select count(*) from public.td_votes v where v.slot_id = w.id) desc, m.position) as rn
                from public.td_matches m
                join public.td_match_results r on r.match_id = m.id
                join public.td_slots w on w.id = r.winner_slot_id
               where m.round_id = v_round.id) t
       where v_cap = 0 or t.rn <= v_cap;
      if (select count(*) from public.td_matches m
            join public.td_match_results r on r.match_id = m.id and r.winner_slot_id is not null
           where m.round_id = v_round.id)
         <> (select count(*) from public.td_matches m where m.round_id = v_round.id) then
        raise exception 'td_advance: a decided group has no winner';
      end if;
      v_winners := v_winners || coalesce(v_revived, '{}'::uuid[]);
      v_feeders := v_feeders || coalesce(v_rev_from, '{}'::uuid[]);
      v_losers := '{}'::uuid[];
      v_n := coalesce(array_length(v_winners, 1), 0);
    end if;

    v_pos := v_round.position + 1;
    -- The 3rd place match is made when the event has it on and BOTH semi-final losers exist and are still active
    -- (owner decision 2026-11-03). A walkover does not block it; a bye does (no loser); a withdrawn loser does. Only a
    -- main round of exactly two matches has semi-final losers (a redemption round never leads straight to a final).
    v_third := v_round.phase = 'main'
               and coalesce((select s.third_place from public.td_settings s where s.event_id = p_event_id), true)
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

-- ============ a judge's tap: the tie-break vote goes only to a brewer in the tie ============
create or replace function public.td_cast_vote(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   uuid;
  v_judges  int;
  v_total   int;
  v_leaders int;
  v_top     int;
  v_slot_n  int;
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
  -- the table's own default (3) stands in if the settings row were ever missing; td_start_event always writes one
  v_judges := coalesce((select st.judge_count from public.td_settings st where st.event_id = v_event), 3);
  -- per competitor in the match: its votes; then the total, the top count, how many share it, and this slot's own count
  select coalesce(sum(t.n), 0), count(*) filter (where t.n = t.mx), max(t.n),
         coalesce(max(t.n) filter (where t.id = p_slot_id), 0)
    into v_total, v_leaders, v_top, v_slot_n
    from (select s.id, count(v.id) as n, max(count(v.id)) over () as mx
            from public.td_slots s left join public.td_votes v on v.slot_id = s.id
           where s.match_id = p_match_id and s.entry_id is not null
           group by s.id) t;
  -- open while judges are still voting, and for exactly one tie-break vote when every judge has voted and it is level
  if not (v_total < v_judges or (v_total = v_judges and v_leaders > 1)) then
    raise exception 'td_cast_vote: every judge has voted in this match' using hint = 'td_votes_full';
  end if;
  -- the tie-break judge chooses among the brewers who are tied (a group of three or four can have one left out of it)
  if v_total >= v_judges and v_slot_n < v_top then
    raise exception 'td_cast_vote: the tie-break vote goes to a brewer in the tie' using hint = 'td_tiebreak_slot';
  end if;
  insert into public.td_votes (event_id, match_id, slot_id) values (v_event, p_match_id, p_slot_id);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_cast_vote');
end;
$$;
revoke all on function public.td_cast_vote(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_cast_vote(uuid, uuid, uuid, uuid) to authenticated;

-- ============ undo a confirmed match: a redemption match removes the rounds after it, like a main one ============
create or replace function public.td_reopen_match(
  p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_winner_slot_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event     uuid;
  v_match     public.td_matches;
  v_round     public.td_rounds;
  v_winner    uuid;
  v_winner_entry uuid;
  v_removed   int := 0;
  v_losers    uuid[];
  v_would     boolean;
begin
  v_event := app.td_guard_match('td_reopen_match', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  select * into v_match from public.td_matches where id = p_match_id;
  -- not decided (a double tap with a fresh operation id): nothing to undo
  if v_match.confirmed_at is null then
    return;
  end if;
  if v_match.result_kind = 'bye' then
    raise exception 'td_reopen_match: a bye has no result to undo' using hint = 'td_match_bye';
  end if;
  select * into v_round from public.td_rounds where id = v_match.round_id;

  select r.winner_slot_id into v_winner from public.td_match_results r where r.match_id = p_match_id;
  -- the organiser undoes the result they saw: if another device has already undone and re-confirmed it differently, stop
  if p_expected_winner_slot_id is not null and p_expected_winner_slot_id is distinct from v_winner then
    raise exception 'td_reopen_match: the result changed since you looked' using hint = 'td_leader_changed';
  end if;
  select s.entry_id into v_winner_entry from public.td_slots s where s.id = v_winner;

  -- what follows a main or redemption round's match: every later round of the event (the redemption round or the next
  -- main round, and from the semi-finals the 3rd place match and the Final). A 3rd place match has nothing after it.
  if v_round.phase in ('main', 'redemption') then
    if exists (
      select 1 from public.td_matches m join public.td_rounds r on r.id = m.round_id
       where r.event_id = v_event and r.position > v_round.position
         and (coalesce(m.result_kind <> 'bye', false)
              or exists (select 1 from public.td_votes v where v.match_id = m.id)
              or exists (select 1 from public.td_score_sheets ss where ss.match_id = m.id))
    ) then
      raise exception 'td_reopen_match: the next round has already started' using hint = 'td_next_round_started';
    end if;
    -- a semi-final round (exactly two matches) with rounds after it: the 3rd place match must come back as it is now
    if v_round.phase = 'main'
       and (select count(*) from public.td_matches m where m.round_id = v_round.id) = 2
       and exists (select 1 from public.td_rounds r where r.event_id = v_event and r.position > v_round.position) then
      select array_agg(l.entry_id order by m.position) into v_losers
        from public.td_matches m
        join public.td_match_results x on x.match_id = m.id
        left join public.td_slots l on l.match_id = m.id and l.id <> x.winner_slot_id and l.entry_id is not null
       where m.round_id = v_round.id;
      v_would := coalesce((select s.third_place from public.td_settings s where s.event_id = v_event), true)
                 and v_losers[1] is not null and v_losers[2] is not null
                 and not exists (select 1 from public.event_entries e where e.id = any (v_losers) and e.withdrawn);
      if v_would is distinct from exists (
           select 1 from public.td_rounds r
            where r.event_id = v_event and r.position > v_round.position and r.phase = 'third_place') then
        raise exception 'td_reopen_match: a semi-final loser was withdrawn or restored since; undoing would change the 3rd place match'
          using hint = 'td_third_place_changed';
      end if;
    end if;
    delete from public.td_rounds r where r.event_id = v_event and r.position > v_round.position;
    get diagnostics v_removed = row_count;
  end if;

  insert into public.td_match_reopens (
    event_id, match_id, round_position, round_phase, match_position, previous_result_kind, previous_winner_entry_id,
    previous_confirmed_at, rounds_removed, reopened_by)
  values (
    v_event, p_match_id, v_round.position, v_round.phase, v_match.position, v_match.result_kind, v_winner_entry,
    v_match.confirmed_at, v_removed, auth.uid());

  delete from public.td_score_decisions where match_id = p_match_id;
  update public.td_matches
     set result_kind = null, confirmed_at = null, walkover_winner_position = null
   where id = p_match_id;
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_reopen_match');
end;
$$;
revoke all on function public.td_reopen_match(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.td_reopen_match(uuid, uuid, uuid, uuid) to authenticated;
