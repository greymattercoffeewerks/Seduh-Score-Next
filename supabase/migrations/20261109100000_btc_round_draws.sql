-- Seduh Score Next · Build B, part 1: the preliminary draw's database layer
-- (docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md sections 4.1, 4.2, 4.4; the pure draw is src/formats/btc/draw.js)
--
-- Three things, one migration:
--
--   1. btc_round_draws  one row per (event, preliminary round): HOW that round was drawn (mode, the recorded seed, the
--                       match count, whether rematches were avoided, and the judge conflicts that were knowingly
--                       accepted). It answers "why did the draw produce this?" for a committee, an appeal or the Board
--                       comparison. Mirrors Throwdown's td_draws.
--   2. create_btc_round(p_org_id, p_event_id, p_prelim_round, p_mode, p_seed, p_matches, p_avoid_rematches)
--                       creates a WHOLE round atomically: every match with its prelim_round, its 3 judges, and the draw
--                       row, or nothing at all.
--   3. create_btc_match gains an optional p_prelim_round (default null) so a hand-made correction match in round 2
--                       carries its round. A signature change, so the function is dropped and recreated (with its
--                       grants and revokes) and nothing else changes.
--
-- ============ btc_round_draws ============
--   event_id, prelim_round   the primary key: a round can be drawn once. A second draw for the same round is refused
--                            (btc_round_exists) and an organiser who wants to redraw removes the round's matches AND its
--                            draw row first (members may delete the row; see the grants).
--   mode                     random | by_results | manual. Both seeded modes record their seed (by_results uses it for
--                            equal-points order); manual has none. CHECK keeps the pair in step.
--   conflict_ticks           jsonb array of the judge-country conflicts present in the round when it was created:
--                            [{ match, judge_id, team_id, country_code }] where `match` is the 1-BASED match number in draw order (draw.js's
--                            conflicts[].matchIndex is 0-based). create_btc_round derives them from the rows
--                            (a judge and a team of the same non-null country); the client does not claim them.
--                            A conflict is never refused here: a committee may need an exception (spec 4.2 step 3).
--   created_by               default auth.uid(); a client never names it. created_at default now().
-- Tenancy: reads and writes through app.is_org_member(app.org_id_for_event(event_id)); event_id frozen by
-- app.forbid_parent_change; matrices 040 and 041 have an entry. RLS write policies are insert and delete only.
-- Grants (a new table: the post-2026-10-30 rule applies): select, column-level INSERT (no created_by or created_at),
-- DELETE, and NO update at all: the record's contents never change after the draw, so there is nothing for a client
-- to update and nothing to leave open (the freeze trigger stays as the answer to a move, and is tested by 040/042).
-- Deliberately a decision of this task, not the spec's "write grants": a record you can edit afterwards is not evidence.
--
-- ============ create_btc_round, the five steps of spec 4.2 (in this order) ============
--   1. a non-member (or the wrong organisation for the event) gets the standard not-found; the per-event advisory lock
--      (the same key as generate_btc_bracket and record_btc_seeding_tiebreak: hashtext(event id)) is taken; a bracket
--      that already exists refuses (btc_round_bracket_exists).
--   2. the round already has matches (an unnumbered preliminary match counts as round 1) or a draw row: btc_round_exists.
--   3. p_prelim_round above 1: every earlier round must exist and be fully confirmed: btc_prior_round_open.
--   4. p_matches is validated: each team of the event exactly once (btc_round_incomplete), teams and judges belong to
--      this event, 3 distinct judges, nobody plays themselves; seed and mode agree (btc_round_seed_mode).
--   5. insert the matches (prelim_round set), their judges and the draw row, and return the matches in draw order.
-- Refusals carry a machine-readable hint. SECURITY INVOKER, search_path pinned empty: every write goes through the
-- caller's own RLS, as create_btc_match does. Not idempotent by design: a retry after a dropped response is refused with
-- btc_round_exists, which the caller reads as "already created" (src/formats/btc/rounds.js).
--
-- Match order: the matches get created_at stamped one millisecond apart in draw order (a transaction's now() is one
-- instant for every row), so "match number" is created_at order, which is what listMatches already sorts by.
--
-- Score log: btc_matches is a logged table. A round's inserts write one change-log row per match on a real event
-- (test events are not logged, D9); prelim_round is already a logged column (Build A, 018 classifies it).
--
-- rollback:
--   (in this order, in one transaction)
--   drop function if exists public.create_btc_round(uuid, uuid, smallint, text, text, jsonb, boolean);
--   drop function if exists public.create_btc_match(uuid, text, uuid, uuid, uuid[], smallint);
--   -- restore create_btc_match's 5-argument form: run the CREATE OR REPLACE FUNCTION and its three revoke/grant
--   -- statements from 20260918100000_btc_create_match_rpc.sql verbatim (the anon revoke of 20260922110000 is a no-op
--   -- afterwards: that migration's revoke already ran on the old function and the new one never grants anon).
--   drop table if exists public.btc_round_draws;   -- its policies (including btc_round_draws_window_lock) and the draw
--                                                   -- records go with it; the matches it created stay

create table public.btc_round_draws (
  event_id         uuid        not null references public.events (id) on delete cascade,
  prelim_round     smallint    not null,
  mode             text        not null,
  seed             text,
  match_count      smallint    not null,
  avoid_rematches  boolean     not null default true,
  conflict_ticks   jsonb       not null default '[]'::jsonb,
  created_by       uuid        default auth.uid(),
  created_at       timestamptz not null default now(),
  primary key (event_id, prelim_round),
  constraint btc_round_draws_round_valid check (prelim_round >= 1),
  constraint btc_round_draws_mode_valid check (mode in ('random', 'by_results', 'manual')),
  constraint btc_round_draws_seed_matches_mode
    check ((mode in ('random', 'by_results')) = (seed is not null) and (seed is null or seed <> '')),
  constraint btc_round_draws_match_count_valid check (match_count >= 1),
  constraint btc_round_draws_ticks_is_array check (jsonb_typeof(conflict_ticks) = 'array')
);
alter table public.btc_round_draws enable row level security;

create trigger trg_btc_round_draws_event_immutable
  before update on public.btc_round_draws
  for each row execute function app.forbid_parent_change('event_id');

create policy btc_round_draws_read on public.btc_round_draws
  for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_round_draws_insert on public.btc_round_draws
  for insert with check (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_round_draws_delete on public.btc_round_draws
  for delete using (app.is_org_member(app.org_id_for_event(event_id)));

revoke all on public.btc_round_draws from anon, authenticated;
grant select on public.btc_round_draws to authenticated;
grant insert (event_id, prelim_round, mode, seed, match_count, avoid_rematches, conflict_ticks)
  on public.btc_round_draws to authenticated;
grant delete on public.btc_round_draws to authenticated;

-- The Per-event window lock (20261023140000; test 056 fails for any table with an event_id column that lacks this policy):
-- same text as the original loop, same behaviour while the key is off.
create policy btc_round_draws_window_lock on public.btc_round_draws as restrictive for all to authenticated
  using (not (select app.window_lock_on()) or not coalesce(event_id in (select app.window_locked_events()), false))
  with check (not (select app.window_lock_on()) or not coalesce(event_id in (select app.window_locked_events()), false));

-- ============ create_btc_match: the optional round number ============

drop function if exists public.create_btc_match(uuid, text, uuid, uuid, uuid[]);

create function public.create_btc_match(
  p_event_id uuid,
  p_round text,
  p_team1_id uuid,
  p_team2_id uuid,
  p_judge_ids uuid[],
  p_prelim_round smallint default null
)
returns public.btc_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_match public.btc_matches;
  v_judge_id uuid;
  v_distinct_judge_count int;
begin
  if p_team1_id = p_team2_id then
    raise exception 'create_btc_match: a team cannot play itself';
  end if;

  select count(distinct j) into v_distinct_judge_count from unnest(p_judge_ids) as j;
  if coalesce(array_length(p_judge_ids, 1), 0) <> 3 or v_distinct_judge_count <> 3 then
    raise exception 'create_btc_match: exactly 3 distinct judges are required';
  end if;

  -- (unchanged) ids of another event are refused before RLS could tell "missing" from "not yours"
  if not exists (
    select 1 from public.btc_teams where id = p_team1_id and event_id = p_event_id
  ) then
    raise exception 'create_btc_match: team1 does not belong to this event';
  end if;
  if not exists (
    select 1 from public.btc_teams where id = p_team2_id and event_id = p_event_id
  ) then
    raise exception 'create_btc_match: team2 does not belong to this event';
  end if;
  if exists (
    select 1 from unnest(p_judge_ids) as jid
    where not exists (
      select 1 from public.btc_judges j where j.id = jid and j.event_id = p_event_id
    )
  ) then
    raise exception 'create_btc_match: all judges must belong to this event';
  end if;

  -- new: only a preliminary match carries a round number (the table's CHECK says the same; this gives a hint)
  if p_prelim_round is not null and p_round is distinct from 'preliminary' then
    raise exception 'create_btc_match: only a preliminary match has a round number'
      using hint = 'btc_match_round_invalid';
  end if;

  insert into public.btc_matches (event_id, round, team1_id, team2_id, prelim_round)
  values (p_event_id, p_round, p_team1_id, p_team2_id, p_prelim_round)
  returning * into v_match;

  foreach v_judge_id in array p_judge_ids loop
    insert into public.btc_match_judges (match_id, judge_id) values (v_match.id, v_judge_id);
  end loop;

  return v_match;
end;
$$;

revoke execute on function public.create_btc_match(uuid, text, uuid, uuid, uuid[], smallint) from public, anon;
grant execute on function public.create_btc_match(uuid, text, uuid, uuid, uuid[], smallint) to authenticated;
grant execute on function public.create_btc_match(uuid, text, uuid, uuid, uuid[], smallint) to service_role;

-- ============ create_btc_round ============

create function public.create_btc_round(
  p_org_id uuid,
  p_event_id uuid,
  p_prelim_round smallint,
  p_mode text,
  p_seed text,
  p_matches jsonb,
  p_avoid_rematches boolean default true
)
returns setof public.btc_matches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count       int;
  v_i           int;
  v_r           int;
  v_item        jsonb;
  v_t1          uuid;
  v_t2          uuid;
  v_judges      uuid[];
  v_all_teams   uuid[] := '{}';
  v_event_teams uuid[];
  v_base        timestamptz;
  v_ticks       jsonb;
  v_match       public.btc_matches;
  v_judge       uuid;
begin
  -- 1. Same not-found shape as generate_btc_bracket, plus an explicit membership test. Since 20261011130000
  -- org_id_for_event itself answers NULL for a non-member, so the test is belt and braces (kept so the not-found shape
  -- survives a loosened resolver): p_org_id must equal the event's organisation and the caller must belong to it.
  if p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'create_btc_round: event not found' using hint = 'btc_round_event_not_found';
  end if;

  -- cheap argument checks first (the caller is a member now, so these say nothing about other organisations)
  if p_prelim_round is null or p_prelim_round < 1 then
    raise exception 'create_btc_round: the round number must be 1 or more' using hint = 'btc_round_invalid';
  end if;
  if p_mode is null or p_mode not in ('random', 'by_results', 'manual') then
    raise exception 'create_btc_round: the mode must be random, by_results or manual' using hint = 'btc_round_invalid';
  end if;
  if (p_mode in ('random', 'by_results')) <> (p_seed is not null and p_seed <> '')
     or (p_seed is not null and p_seed = '') then
    raise exception 'create_btc_round: a random or by-results draw records its seed, a manual draw has none'
      using hint = 'btc_round_seed_mode';
  end if;
  if p_avoid_rematches is null then
    raise exception 'create_btc_round: say whether repeat opponents are avoided' using hint = 'btc_round_invalid';
  end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) = 0 then
    raise exception 'create_btc_round: the round needs a list of matches' using hint = 'btc_round_matches_invalid';
  end if;
  v_count := jsonb_array_length(p_matches);

  -- Serialises with generate_btc_bracket and record_btc_seeding_tiebreak (same key) and with a second draw for the
  -- same event: two taps on "Create" cannot both pass the checks below.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'create_btc_round: the bracket already exists, so the preliminary rounds are closed'
      using hint = 'btc_round_bracket_exists';
  end if;

  -- 2. an unnumbered preliminary match (older and demo events) is round 1
  if exists (
       select 1 from public.btc_matches
        where event_id = p_event_id and round = 'preliminary' and coalesce(prelim_round, 1) = p_prelim_round
     )
     or exists (
       select 1 from public.btc_round_draws where event_id = p_event_id and prelim_round = p_prelim_round
     ) then
    raise exception 'create_btc_round: round % has already been drawn', p_prelim_round
      using hint = 'btc_round_exists';
  end if;

  -- 3 (spec step 4, run before the match checks because it is cheap): every earlier round must exist and be confirmed
  for v_r in 1 .. p_prelim_round - 1 loop
    if not exists (
         select 1 from public.btc_matches
          where event_id = p_event_id and round = 'preliminary' and coalesce(prelim_round, 1) = v_r
       ) then
      raise exception 'create_btc_round: round % has not been drawn yet', v_r using hint = 'btc_prior_round_open';
    end if;
    if exists (
         select 1 from public.btc_matches
          where event_id = p_event_id and round = 'preliminary' and coalesce(prelim_round, 1) = v_r
            and status <> 'confirmed'
       ) then
      raise exception 'create_btc_round: round % is not fully confirmed yet', v_r using hint = 'btc_prior_round_open';
    end if;
  end loop;

  -- 4 (spec step 3): validate the matches
  for v_i in 0 .. v_count - 1 loop
    v_item := p_matches -> v_i;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'create_btc_round: match % is not an object', v_i + 1 using hint = 'btc_round_matches_invalid';
    end if;
    begin
      v_t1 := (v_item ->> 'team1_id')::uuid;
      v_t2 := (v_item ->> 'team2_id')::uuid;
      v_judges := array(select j::uuid from jsonb_array_elements_text(v_item -> 'judge_ids') as j);
    exception when invalid_text_representation or invalid_parameter_value or datatype_mismatch then
      raise exception 'create_btc_round: match % has an id that is not valid', v_i + 1
        using hint = 'btc_round_matches_invalid';
    end;
    if v_t1 is null or v_t2 is null then
      raise exception 'create_btc_round: match % needs two teams', v_i + 1 using hint = 'btc_round_matches_invalid';
    end if;
    if v_t1 = v_t2 then
      raise exception 'create_btc_round: match % has a team playing itself', v_i + 1
        using hint = 'btc_round_matches_invalid';
    end if;
    if coalesce(array_length(v_judges, 1), 0) <> 3
       or (select count(distinct j) from unnest(v_judges) as j) <> 3 then
      raise exception 'create_btc_round: match % needs exactly 3 distinct judges', v_i + 1
        using hint = 'btc_round_matches_invalid';
    end if;
    v_all_teams := v_all_teams || v_t1 || v_t2;
  end loop;

  -- every team of the event exactly once
  select coalesce(array_agg(t.id), '{}') into v_event_teams from public.btc_teams t where t.event_id = p_event_id;
  if exists (select 1 from unnest(v_all_teams) as x where x <> all (v_event_teams)) then
    raise exception 'create_btc_round: a team in the draw does not belong to this event'
      using hint = 'btc_round_matches_invalid';
  end if;
  if (select count(distinct x) from unnest(v_all_teams) as x) <> cardinality(v_all_teams)
     or cardinality(v_all_teams) <> cardinality(v_event_teams) then
    raise exception 'create_btc_round: every team of the event must play exactly once in the round (% teams, % places)',
      cardinality(v_event_teams), cardinality(v_all_teams)
      using hint = 'btc_round_incomplete';
  end if;

  if exists (
       select 1
         from jsonb_array_elements(p_matches) as m(e),
              lateral jsonb_array_elements_text(m.e -> 'judge_ids') as j(id)
        where not exists (select 1 from public.btc_judges bj where bj.id = j.id::uuid and bj.event_id = p_event_id)
     ) then
    raise exception 'create_btc_round: all judges must belong to this event' using hint = 'btc_round_matches_invalid';
  end if;

  -- the judge-country conflicts that are present (never refused: a committee may need an exception)
  select coalesce(jsonb_agg(
           jsonb_build_object('match', m.n, 'judge_id', bj.id, 'team_id', bt.id, 'country_code', bj.country_code)
           order by m.n, bj.id, bt.id), '[]'::jsonb)
    into v_ticks
    from (select x.ord::int as n, (x.e ->> 'team1_id')::uuid as t1, (x.e ->> 'team2_id')::uuid as t2, x.e -> 'judge_ids' as ids
            from jsonb_array_elements(p_matches) with ordinality as x(e, ord)) m
    cross join lateral jsonb_array_elements_text(m.ids) as j(id)
    join public.btc_judges bj on bj.id = j.id::uuid
    join public.btc_teams bt on bt.id in (m.t1, m.t2)
   where bj.country_code is not null and bj.country_code = bt.country_code;

  -- 5. write: the matches in draw order, their judges, then the record
  v_base := clock_timestamp();
  for v_i in 0 .. v_count - 1 loop
    v_item := p_matches -> v_i;
    insert into public.btc_matches (event_id, round, prelim_round, team1_id, team2_id, created_at)
    values (p_event_id, 'preliminary', p_prelim_round,
            (v_item ->> 'team1_id')::uuid, (v_item ->> 'team2_id')::uuid,
            v_base + (v_i * interval '1 millisecond'))
    returning * into v_match;
    for v_judge in select j::uuid from jsonb_array_elements_text(v_item -> 'judge_ids') as j loop
      insert into public.btc_match_judges (match_id, judge_id) values (v_match.id, v_judge);
    end loop;
    return next v_match;
  end loop;

  insert into public.btc_round_draws (event_id, prelim_round, mode, seed, match_count, avoid_rematches, conflict_ticks)
  values (p_event_id, p_prelim_round, p_mode, p_seed, v_count, p_avoid_rematches, v_ticks);

  return;
end;
$$;

revoke execute on function public.create_btc_round(uuid, uuid, smallint, text, text, jsonb, boolean) from public, anon;
grant execute on function public.create_btc_round(uuid, uuid, smallint, text, text, jsonb, boolean) to authenticated;
grant execute on function public.create_btc_round(uuid, uuid, smallint, text, text, jsonb, boolean) to service_role;
