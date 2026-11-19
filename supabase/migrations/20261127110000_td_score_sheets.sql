-- Seduh Score Next - Throwdown scoresheet, part 2 of 2: the sheets, the derived winner and the two writers
--
-- Spec: Handoffs and Specs/THROWDOWN-SCORESHEET-SPEC.md (local only), sections 2 to 4. Part 1 (20261127100000) made the module
-- switchable; this part is its data.
--
--   * td_matches.result_kind gains 'scores' (votes | walkover | bye | scores), and td_match_results (the ONE place a winner
--     is computed in SQL) gains a 'scores' arm that reads app.td_scored_winner. Every consumer (app.td_advance, the console)
--     keeps working through the view. Round and match shapes, slots, advancement and the vote tables are not changed.
--   * td_score_sheets: one row per (match, slot, judge seat, cup, line). The points are the only fact stored: NO cup, judge or
--     grand total is a column anywhere (they are derived by app.td_scored_standings and the view built on it).
--   * td_score_decisions: a row only when the organiser picked the winner of a level match (rule D7 (c)).
--   * A round's role (final, third_place, semi_final, quarter_final) is derived, never stored (D4): app.td_role_of is the
--     pure rule, app.td_round_role asks it about a match's round.
--   * A match is SCORED when the event's settings name its round's role under modules.scoresheet.cups. A scored match takes no
--     tap votes (trigger on td_votes, hint td_match_scored), so the two methods can never mix.
--   * The winner rule (D7) lives in ONE SQL function, app.td_scored_decide, and ONE JS function (src/core/scoresheet.js).
--     (a) the highest grand total wins; (b) if level, the competitor MORE judges scored higher (a judge's own total across
--     cups); (c) if still level, the organiser picks and the pick is recorded. Both read the same shared fixture file.
--   * Writers (SECURITY DEFINER, the API roles hold SELECT only, same pattern as td_cast_vote): td_save_score_sheet replaces
--     one judge seat's whole sheet for one competitor; td_confirm_scored_match decides the match and advances in the same
--     transaction. Both are idempotent through processed_operations.
--
-- Everything is org-scoped through app.is_org_member (never a policy that reads org_members), every parent column is frozen
-- (SQLSTATE 23001), nothing is granted to anon. td_score_standings is security_invoker; it is the console's read view
-- (per slot: grand total, per-judge totals, judges preferring, sheets complete). Scores are never part of any public door.
--
-- The Per-event window lock (20261023140000, restrictive policy on every table with an event_id; test 056 fails otherwise) covers
-- both new tables, with the same text as 20261103130000. Nothing changes while the lock key is off.
--
-- rollback: (run in this order; the first statement refuses to leave a 'scores' match behind: delete such matches first)
--   drop policy if exists td_score_sheets_window_lock on public.td_score_sheets;
--   drop policy if exists td_score_decisions_window_lock on public.td_score_decisions;
--   drop view if exists td_score_standings;
--   create or replace view td_match_results with (security_invoker = true) as
--     select m.id as match_id, m.event_id, m.result_kind, m.confirmed_at,
--       case m.result_kind
--         when 'bye' then (select s.id from td_slots s where s.match_id = m.id and s.entry_id is not null order by s.position limit 1)
--         when 'walkover' then (select s.id from td_slots s where s.match_id = m.id and s.position = m.walkover_winner_position)
--         when 'votes' then (
--           select case when count(*) filter (where t.n = t.mx) = 1 then (array_agg(t.slot_id) filter (where t.n = t.mx))[1] end
--             from (select s.id as slot_id, count(v.id) as n, max(count(v.id)) over () as mx
--                     from td_slots s left join td_votes v on v.slot_id = s.id
--                    where s.match_id = m.id and s.entry_id is not null group by s.id) t)
--       end as winner_slot_id
--     from td_matches m;
--   drop function if exists public.td_confirm_scored_match(uuid, uuid, uuid, int, int);
--   drop function if exists public.td_save_score_sheet(uuid, uuid, uuid, uuid, int, jsonb);
--   drop table if exists td_score_decisions;
--   drop table if exists td_score_sheets;
--   drop function if exists app.check_td_score_decision();
--   drop function if exists app.check_td_score_sheet();
--   drop function if exists app.td_scored_winner(uuid);
--   drop function if exists app.td_scored_decide(uuid);
--   drop function if exists app.td_scored_standings(uuid);
--   drop function if exists app.td_match_scored(uuid);
--   drop function if exists app.td_round_role(uuid);
--   drop function if exists app.td_role_of(text, int);
--   alter table td_matches drop constraint td_matches_result_kind_valid;
--   alter table td_matches add constraint td_matches_result_kind_valid check (result_kind in ('votes', 'walkover', 'bye'));
--   -- the TD.1 body of app.check_td_vote (20261103111000), restored:
--   create or replace function app.check_td_vote()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_slot_match uuid;
--     v_slot_event uuid;
--     v_slot_entry uuid;
--     v_match_event uuid;
--     v_confirmed  timestamptz;
--   begin
--     perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_votes');
--     select s.match_id, s.event_id, s.entry_id into v_slot_match, v_slot_event, v_slot_entry
--       from public.td_slots s where s.id = new.slot_id;
--     select m.event_id, m.confirmed_at into v_match_event, v_confirmed
--       from public.td_matches m where m.id = new.match_id;
--     if v_slot_match is distinct from new.match_id or v_slot_event is distinct from new.event_id
--        or v_match_event is distinct from new.event_id then
--       raise exception 'td_votes: the slot must belong to the match, and both to the event';
--     end if;
--     if v_slot_entry is null then
--       raise exception 'td_votes: a vote needs a competitor in the slot' using hint = 'td_slot_empty';
--     end if;
--     if v_confirmed is not null then
--       raise exception 'td_votes: the match is already decided' using errcode = '23001', hint = 'td_match_decided';
--     end if;
--     return new;
--   end;
--   $$;

-- ============ result_kind gains 'scores' ============
alter table td_matches drop constraint td_matches_result_kind_valid;
alter table td_matches
  add constraint td_matches_result_kind_valid check (result_kind in ('votes', 'walkover', 'bye', 'scores'));

-- ============ a round's role (D4): derived, never stored ============
-- The pure rule: the third_place phase is the 3rd place match; a main round by its match count (1 final, 2 semi-finals,
-- 4 quarter-finals); anything else (a bigger round, a redemption round) has no role and is tap-voted. src/formats/throwdown/
-- roundRole.js is the JS twin; a shared fixture pins them together. SECURITY INVOKER and executable by signed-in callers
-- on purpose: the read view below calls it, and it only reads rows the caller's row-level security already allows.
create or replace function app.td_role_of(p_phase text, p_matches int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_phase
    when 'third_place' then 'third_place'
    when 'main' then case p_matches when 1 then 'final' when 2 then 'semi_final' when 4 then 'quarter_final' end
  end
$$;
revoke all on function app.td_role_of(text, int) from public, anon;
grant execute on function app.td_role_of(text, int) to authenticated;

create or replace function app.td_round_role(p_match uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select app.td_role_of(r.phase, (select count(*)::int from public.td_matches x where x.round_id = r.id))
    from public.td_matches m join public.td_rounds r on r.id = m.round_id
   where m.id = p_match
$$;
revoke all on function app.td_round_role(uuid) from public, anon;
grant execute on function app.td_round_role(uuid) to authenticated;

-- true when the event's setup names this match's round role under modules.scoresheet.cups
create or replace function app.td_match_scored(p_match uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select (st.modules -> 'scoresheet' -> 'cups') ? app.td_round_role(m.id)
                     from public.td_matches m join public.td_settings st on st.event_id = m.event_id
                    where m.id = p_match), false)
$$;
revoke all on function app.td_match_scored(uuid) from public, anon, authenticated, service_role;

-- ============ the sheets: one row per (match, slot, judge seat, cup, line), points only ============
create table td_score_sheets (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  match_id    uuid not null references td_matches(id) on delete cascade,
  slot_id     uuid not null references td_slots(id) on delete cascade,
  judge_seat  smallint not null,      -- a plain seat 1..judge_count; no judge identity (a later format may bind seats to logins)
  cup         smallint not null,
  line_key    text not null,
  points      smallint not null,
  entered_at  timestamptz not null default now(),
  unique (slot_id, judge_seat, cup, line_key),
  constraint td_score_sheets_seat_valid check (judge_seat between 1 and 15),
  constraint td_score_sheets_cup_valid check (cup between 1 and 3),
  constraint td_score_sheets_line_valid check (length(line_key) between 1 and 40),
  constraint td_score_sheets_points_valid check (points >= 0)
);
alter table td_score_sheets enable row level security;
create index on td_score_sheets (event_id);
create index on td_score_sheets (match_id);
create trigger trg_td_score_sheets_parent_immutable
  before update on td_score_sheets
  for each row execute function app.forbid_parent_change('event_id', 'match_id', 'slot_id');

-- Defence in depth for the writer (which gives the friendly refusals first): the slot belongs to the match and the event, it
-- holds a competitor, the match is scored and not decided, the seat, cup and line exist in THIS event's setup, and the points
-- are inside the line's max. The setup's own copy of the lines is the authority, never the preset.
create or replace function app.check_td_score_sheet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_match uuid;
  v_slot_event uuid;
  v_slot_entry uuid;
  v_match_event uuid;
  v_confirmed  timestamptz;
  v_role       text;
  v_cfg        jsonb;
  v_judges     int;
  v_max        int;
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_score_sheets');
  select s.match_id, s.event_id, s.entry_id into v_slot_match, v_slot_event, v_slot_entry
    from public.td_slots s where s.id = new.slot_id;
  select m.event_id, m.confirmed_at into v_match_event, v_confirmed
    from public.td_matches m where m.id = new.match_id;
  if v_slot_match is distinct from new.match_id or v_slot_event is distinct from new.event_id
     or v_match_event is distinct from new.event_id then
    raise exception 'td_score_sheets: the slot must belong to the match, and both to the event';
  end if;
  if v_confirmed is not null then
    raise exception 'td_score_sheets: the match is already decided' using errcode = '23001', hint = 'td_match_decided';
  end if;
  if v_slot_entry is null then
    raise exception 'td_score_sheets: a sheet needs a competitor in the slot' using hint = 'td_slot_empty';
  end if;
  v_role := app.td_round_role(new.match_id);
  select st.modules -> 'scoresheet', st.judge_count into v_cfg, v_judges
    from public.td_settings st where st.event_id = new.event_id;
  if v_role is null or v_cfg is null or not ((v_cfg -> 'cups') ? v_role) then
    raise exception 'td_score_sheets: this match is decided by taps, not by scoresheets'
      using errcode = '23001', hint = 'td_match_not_scored';
  end if;
  if new.judge_seat > v_judges then
    raise exception 'td_score_sheets: there is no such judge seat' using hint = 'td_seat_invalid';
  end if;
  if new.cup > (v_cfg -> 'cups' ->> v_role)::int then
    raise exception 'td_score_sheets: there is no such cup in this round' using hint = 'td_cup_invalid';
  end if;
  select (l ->> 'max')::int into v_max from jsonb_array_elements(v_cfg -> 'lines') l where l ->> 'key' = new.line_key;
  if not found then
    raise exception 'td_score_sheets: there is no such line on this sheet' using hint = 'td_line_unknown';
  end if;
  if new.points > v_max then
    raise exception 'td_score_sheets: the points are above the line''s maximum' using hint = 'td_points_invalid';
  end if;
  return new;
end;
$$;
revoke all on function app.check_td_score_sheet() from public, anon, authenticated, service_role;
create trigger trg_td_score_sheets_xref
  before insert or update on td_score_sheets
  for each row execute function app.check_td_score_sheet();

-- ============ the organiser's pick, recorded (D7 (c)): only for a level match ============
create table td_score_decisions (
  match_id         uuid primary key references td_matches(id) on delete cascade,
  event_id         uuid not null references events(id) on delete cascade,
  winner_position  smallint not null,
  decided_at       timestamptz not null default now(),
  constraint td_score_decisions_position_valid check (winner_position between 1 and 4)
);
alter table td_score_decisions enable row level security;
create index on td_score_decisions (event_id);
create trigger trg_td_score_decisions_parent_immutable
  before update on td_score_decisions
  for each row execute function app.forbid_parent_change('event_id', 'match_id');

create or replace function app.check_td_score_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match_event uuid;
  v_confirmed   timestamptz;
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_score_decisions');
  select m.event_id, m.confirmed_at into v_match_event, v_confirmed from public.td_matches m where m.id = new.match_id;
  if v_match_event is distinct from new.event_id then
    raise exception 'td_score_decisions: the match must belong to the event';
  end if;
  if v_confirmed is not null then
    raise exception 'td_score_decisions: the match is already decided' using errcode = '23001', hint = 'td_match_decided';
  end if;
  if not app.td_match_scored(new.match_id) then
    raise exception 'td_score_decisions: this match is decided by taps, not by scoresheets'
      using errcode = '23001', hint = 'td_match_not_scored';
  end if;
  if not exists (select 1 from public.td_slots s
                  where s.match_id = new.match_id and s.position = new.winner_position and s.entry_id is not null) then
    raise exception 'td_score_decisions: the winner must be a competitor of the match' using hint = 'td_slot_invalid';
  end if;
  return new;
end;
$$;
revoke all on function app.check_td_score_decision() from public, anon, authenticated, service_role;
create trigger trg_td_score_decisions_xref
  before insert or update on td_score_decisions
  for each row execute function app.check_td_score_decision();

-- ============ no taps on a scored match ============
create or replace function app.check_td_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_match uuid;
  v_slot_event uuid;
  v_slot_entry uuid;
  v_match_event uuid;
  v_confirmed  timestamptz;
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_votes');
  select s.match_id, s.event_id, s.entry_id into v_slot_match, v_slot_event, v_slot_entry
    from public.td_slots s where s.id = new.slot_id;
  select m.event_id, m.confirmed_at into v_match_event, v_confirmed
    from public.td_matches m where m.id = new.match_id;
  if v_slot_match is distinct from new.match_id or v_slot_event is distinct from new.event_id
     or v_match_event is distinct from new.event_id then
    raise exception 'td_votes: the slot must belong to the match, and both to the event';
  end if;
  -- a scored match is decided by its sheets only: the two methods can never mix
  if app.td_match_scored(new.match_id) then
    raise exception 'td_votes: this match is decided by scoresheets, not taps' using errcode = '23001', hint = 'td_match_scored';
  end if;
  if v_slot_entry is null then
    raise exception 'td_votes: a vote needs a competitor in the slot' using hint = 'td_slot_empty';
  end if;
  if v_confirmed is not null then
    raise exception 'td_votes: the match is already decided' using errcode = '23001', hint = 'td_match_decided';
  end if;
  return new;
end;
$$;
revoke all on function app.check_td_vote() from public, anon, authenticated, service_role;

-- ============ derived: per slot, what the sheets say ============
-- The ONE place the sums and the judge comparison are counted (the view and the winner rule both read it). Totals are never
-- stored. A seat's "sheet" is complete when it holds every line of every cup of this round (the writer only ever saves
-- complete sheets, so this is a cross-check). A judge counts toward `judges_preferring` only when the other slot has that
-- seat's sheet as well. Returns nothing for a match that is not scored. SECURITY INVOKER: the caller's row-level security
-- applies, so a non-member gets zero rows; executable by signed-in callers because the read view calls it.
create or replace function app.td_scored_standings(p_match uuid)
returns table (
  slot_id uuid, slot_position smallint, grand_total int, judge_totals jsonb,
  judges_preferring int, sheets_complete int, sheets_expected int
)
language sql
stable
set search_path = ''
as $$
  with shape as (
    select m.id as match_id, st.judge_count,
           (st.modules -> 'scoresheet' -> 'cups' ->> app.td_round_role(m.id))::int
             * jsonb_array_length(st.modules -> 'scoresheet' -> 'lines') as rows_per_sheet
      from public.td_matches m join public.td_settings st on st.event_id = m.event_id
     where m.id = p_match
       and (st.modules -> 'scoresheet' -> 'cups') ? app.td_round_role(m.id)
  ),
  seat as (
    select sh.slot_id, sh.judge_seat, sum(sh.points)::int as seat_total, count(*)::int as n
      from public.td_score_sheets sh where sh.match_id = p_match
     group by sh.slot_id, sh.judge_seat
  )
  select s.id, s.position,
         coalesce((select sum(x.seat_total) from seat x where x.slot_id = s.id), 0)::int,
         coalesce((select jsonb_object_agg(x.judge_seat::text, x.seat_total) from seat x where x.slot_id = s.id), '{}'::jsonb),
         (select count(*) from seat a join seat b on b.judge_seat = a.judge_seat and b.slot_id <> a.slot_id
           where a.slot_id = s.id and a.seat_total > b.seat_total)::int,
         (select count(*) from seat x where x.slot_id = s.id and x.n = sh.rows_per_sheet)::int,
         sh.judge_count::int
    from shape sh join public.td_slots s on s.match_id = sh.match_id and s.entry_id is not null
   order by s.position
$$;
revoke all on function app.td_scored_standings(uuid) from public, anon;
grant execute on function app.td_scored_standings(uuid) to authenticated;

-- The winner rule (owner decision D7), in this ONE place (src/core/scoresheet.js decideScored is its twin):
--   total            the highest grand total wins
--   judges           if level, the competitor MORE judges scored higher
--   organiser_needed if still level: no winner yet, the organiser picks (recorded in td_score_decisions)
-- Two filled slots only; anything else returns no row. Call it once every sheet is in.
create or replace function app.td_scored_decide(p_match uuid)
returns table (winner_position smallint, rule text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pos  smallint[];
  v_tot  int[];
  v_pref int[];
begin
  select array_agg(t.slot_position order by t.slot_position), array_agg(t.grand_total order by t.slot_position),
         array_agg(t.judges_preferring order by t.slot_position)
    into v_pos, v_tot, v_pref
    from app.td_scored_standings(p_match) t;
  if coalesce(array_length(v_pos, 1), 0) <> 2 then
    return;
  end if;
  if v_tot[1] <> v_tot[2] then
    return query select case when v_tot[1] > v_tot[2] then v_pos[1] else v_pos[2] end, 'total'::text;
  elsif v_pref[1] <> v_pref[2] then
    return query select case when v_pref[1] > v_pref[2] then v_pos[1] else v_pos[2] end, 'judges'::text;
  else
    return query select null::smallint, 'organiser_needed'::text;
  end if;
end;
$$;
revoke all on function app.td_scored_decide(uuid) from public, anon;
grant execute on function app.td_scored_decide(uuid) to authenticated;

-- The winner's slot POSITION of a scored match: D7 (a) or (b) from the sheets, or the organiser's recorded pick for (c);
-- null while nothing decides it. Read by td_match_results.
create or replace function app.td_scored_winner(p_match uuid)
returns smallint
language sql
stable
set search_path = ''
as $$
  select case when d.rule = 'organiser_needed'
              then (select x.winner_position from public.td_score_decisions x where x.match_id = p_match)
              else d.winner_position end
    from app.td_scored_decide(p_match) d
$$;
revoke all on function app.td_scored_winner(uuid) from public, anon;
grant execute on function app.td_scored_winner(uuid) to authenticated;

-- ============ derived: who won each decided match (td_match_results gains the 'scores' arm) ============
create or replace view td_match_results
  with (security_invoker = true) as
select
  m.id as match_id,
  m.event_id,
  m.result_kind,
  m.confirmed_at,
  case m.result_kind
    when 'bye' then (
      select s.id from td_slots s where s.match_id = m.id and s.entry_id is not null order by s.position limit 1)
    when 'walkover' then (
      select s.id from td_slots s where s.match_id = m.id and s.position = m.walkover_winner_position)
    when 'scores' then (
      select s.id from td_slots s where s.match_id = m.id and s.position = app.td_scored_winner(m.id))
    when 'votes' then (
      select case when count(*) filter (where t.n = t.mx) = 1
                  then (array_agg(t.slot_id) filter (where t.n = t.mx))[1] end
        from (
          select s.id as slot_id,
                 count(v.id) as n,
                 max(count(v.id)) over () as mx
            from td_slots s left join td_votes v on v.slot_id = s.id
           where s.match_id = m.id and s.entry_id is not null
           group by s.id
        ) t)
  end as winner_slot_id
from td_matches m;

-- The console's read view: per filled slot of a scored match, what the sheets say. Org members only (security_invoker).
create view td_score_standings
  with (security_invoker = true) as
select m.id as match_id, m.event_id, t.slot_id, t.slot_position, t.grand_total, t.judge_totals,
       t.judges_preferring, t.sheets_complete, t.sheets_expected
  from td_matches m
  cross join lateral app.td_scored_standings(m.id) t;

-- ============ row-level security: org members read; nobody writes directly ============
create policy td_score_sheets_read on td_score_sheets for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy td_score_decisions_read on td_score_decisions for select using (app.is_org_member(app.org_id_for_event(event_id)));

revoke all on td_score_sheets, td_score_decisions from anon, authenticated;
grant select on td_score_sheets to authenticated;
grant select on td_score_decisions to authenticated;
revoke all on td_score_standings from anon, authenticated;
grant select on td_score_standings to authenticated;

-- ============ a scorekeeper saves one paper sheet ============
-- One paper sheet = one judge seat x one competitor (slot), every cup. p_sheet = {"1": {"<line>": points, ...}, "2": {...}}.
-- Only a COMPLETE sheet is saved: every cup 1..cups of the round, every line of the event's setup, each a whole number
-- 0..max. It REPLACES that seat's earlier sheet for that slot, until the match is decided (never after). Refusals (hints):
--   td_match_decided, td_match_not_scored, td_slot_invalid (not a slot of the match), td_slot_empty, td_seat_invalid,
--   td_sheet_invalid (not an object / a cup is not an object), td_sheet_cups (a cup missing, extra or not numbered 1..cups),
--   td_sheet_line_unknown, td_sheet_incomplete (a blank line), td_sheet_points_invalid (not a whole number, or out of range).
create or replace function public.td_save_score_sheet(
  p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_slot_id uuid, p_judge_seat int, p_sheet jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  uuid;
  v_role   text;
  v_cfg    jsonb;
  v_judges int;
  v_cups   int;
  v_entry  uuid;
  v_cup    jsonb;
  v_line   jsonb;
  v_key    text;
  v_val    jsonb;
  i        int;
begin
  v_event := app.td_guard_match('td_save_score_sheet', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    raise exception 'td_save_score_sheet: the match is already decided' using errcode = '23001', hint = 'td_match_decided';
  end if;
  if not app.td_match_scored(p_match_id) then
    raise exception 'td_save_score_sheet: this match is decided by taps, not by scoresheets' using hint = 'td_match_not_scored';
  end if;
  v_role := app.td_round_role(p_match_id);
  select st.modules -> 'scoresheet', st.judge_count into v_cfg, v_judges
    from public.td_settings st where st.event_id = v_event;
  v_cups := (v_cfg -> 'cups' ->> v_role)::int;

  select s.entry_id into v_entry from public.td_slots s where s.id = p_slot_id and s.match_id = p_match_id;
  if not found then
    raise exception 'td_save_score_sheet: slot not found' using hint = 'td_slot_invalid';
  end if;
  if v_entry is null then
    raise exception 'td_save_score_sheet: the slot has no competitor' using hint = 'td_slot_empty';
  end if;
  if p_judge_seat is null or p_judge_seat not between 1 and v_judges then
    raise exception 'td_save_score_sheet: there is no such judge seat' using hint = 'td_seat_invalid';
  end if;

  -- the sheet, whole or not at all
  if p_sheet is null or jsonb_typeof(p_sheet) <> 'object' then
    raise exception 'td_save_score_sheet: the sheet must be an object of cups' using hint = 'td_sheet_invalid';
  end if;
  if (select count(*) from jsonb_object_keys(p_sheet)) <> v_cups then
    raise exception 'td_save_score_sheet: this round has % cup(s)', v_cups using hint = 'td_sheet_cups';
  end if;
  for i in 1 .. v_cups loop
    if not (p_sheet ? i::text) then
      raise exception 'td_save_score_sheet: cup % is missing', i using hint = 'td_sheet_cups';
    end if;
    v_cup := p_sheet -> i::text;
    if jsonb_typeof(v_cup) <> 'object' then
      raise exception 'td_save_score_sheet: cup % must be an object of lines', i using hint = 'td_sheet_invalid';
    end if;
    for v_key in select jsonb_object_keys(v_cup) loop
      if not exists (select 1 from jsonb_array_elements(v_cfg -> 'lines') l where l ->> 'key' = v_key) then
        raise exception 'td_save_score_sheet: unknown line % on cup %', v_key, i using hint = 'td_sheet_line_unknown';
      end if;
    end loop;
    for v_line in select * from jsonb_array_elements(v_cfg -> 'lines') loop
      v_val := v_cup -> (v_line ->> 'key');
      if v_val is null or jsonb_typeof(v_val) = 'null' then
        raise exception 'td_save_score_sheet: line % of cup % is blank', v_line ->> 'key', i using hint = 'td_sheet_incomplete';
      end if;
      if jsonb_typeof(v_val) <> 'number'
         or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
         or (v_val #>> '{}')::numeric < 0
         or (v_val #>> '{}')::numeric > (v_line ->> 'max')::numeric then
        raise exception 'td_save_score_sheet: line % of cup % needs a whole number from 0 to %',
          v_line ->> 'key', i, v_line ->> 'max' using hint = 'td_sheet_points_invalid';
      end if;
    end loop;
  end loop;

  delete from public.td_score_sheets where slot_id = p_slot_id and judge_seat = p_judge_seat;
  insert into public.td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points)
  select v_event, p_match_id, p_slot_id, p_judge_seat, c.key::smallint, l.key, (l.value #>> '{}')::numeric::smallint
    from jsonb_each(p_sheet) c, jsonb_each(c.value) l;
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_save_score_sheet');
end;
$$;
revoke all on function public.td_save_score_sheet(uuid, uuid, uuid, uuid, int, jsonb) from public, anon;
grant execute on function public.td_save_score_sheet(uuid, uuid, uuid, uuid, int, jsonb) to authenticated;

-- ============ the organiser confirms the scored match: D7, then advance ============
-- p_expected_winner_position: the slot position the organiser saw winning on D7 (a) or (b); it must match what the sheets say
-- now (td_leader_changed otherwise, and it is required then). p_organiser_pick: the winner the organiser picks when the match
-- is level after (b); required then (td_organiser_pick_required), and refused when the sheets already decide it
-- (td_organiser_pick_unneeded). A pick is recorded in td_score_decisions. Other refusals: td_match_not_scored,
-- td_match_not_ready (fewer than two competitors), td_sheets_incomplete (every seat x filled slot needs its whole sheet),
-- td_slot_invalid (the pick is not a competitor of the match). An already decided match is a quiet no-op.
create or replace function public.td_confirm_scored_match(
  p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_winner_position int, p_organiser_pick int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  uuid;
  v_winner smallint;
  v_rule   text;
begin
  v_event := app.td_guard_match('td_confirm_scored_match', p_org_id, p_match_id);
  perform pg_advisory_xact_lock(hashtext('td:' || v_event::text));
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;
  if (select m.confirmed_at from public.td_matches m where m.id = p_match_id) is not null then
    return;
  end if;
  if not app.td_match_scored(p_match_id) then
    raise exception 'td_confirm_scored_match: this match is decided by taps, not by scoresheets' using hint = 'td_match_not_scored';
  end if;
  if (select count(*) from public.td_slots s where s.match_id = p_match_id and s.entry_id is not null) < 2 then
    raise exception 'td_confirm_scored_match: the match does not have two competitors' using hint = 'td_match_not_ready';
  end if;
  if exists (select 1 from app.td_scored_standings(p_match_id) t where t.sheets_complete < t.sheets_expected) then
    raise exception 'td_confirm_scored_match: not every judge''s sheet is in' using hint = 'td_sheets_incomplete';
  end if;

  select d.winner_position, d.rule into v_winner, v_rule from app.td_scored_decide(p_match_id) d;

  if v_rule in ('total', 'judges') then
    if p_organiser_pick is not null then
      raise exception 'td_confirm_scored_match: the scores decide this match, there is nothing to pick'
        using hint = 'td_organiser_pick_unneeded';
    end if;
    if p_expected_winner_position is distinct from v_winner then
      raise exception 'td_confirm_scored_match: the winner changed since you looked' using hint = 'td_leader_changed';
    end if;
  else
    -- level after the judge count: the organiser decides, and the decision is recorded
    if p_expected_winner_position is not null then
      raise exception 'td_confirm_scored_match: the winner changed since you looked' using hint = 'td_leader_changed';
    end if;
    if p_organiser_pick is null then
      raise exception 'td_confirm_scored_match: the match is level, the organiser must pick the winner'
        using hint = 'td_organiser_pick_required';
    end if;
    if not exists (select 1 from public.td_slots s
                    where s.match_id = p_match_id and s.position = p_organiser_pick and s.entry_id is not null) then
      raise exception 'td_confirm_scored_match: slot not found' using hint = 'td_slot_invalid';
    end if;
    insert into public.td_score_decisions (match_id, event_id, winner_position)
      values (p_match_id, v_event, p_organiser_pick);
  end if;

  update public.td_matches set result_kind = 'scores', confirmed_at = now() where id = p_match_id;
  perform app.td_advance(v_event);
  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'td_confirm_scored_match');
end;
$$;
revoke all on function public.td_confirm_scored_match(uuid, uuid, uuid, int, int) from public, anon;
grant execute on function public.td_confirm_scored_match(uuid, uuid, uuid, int, int) to authenticated;

-- ============ the Per-event window lock covers both tables (same policy text as the Throwdown tables') ============
do $pol$
declare
  s record;
begin
  for s in select * from (values ('td_score_sheets', 'event_id'), ('td_score_decisions', 'event_id')) as v(tbl, ev) loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not (select app.window_lock_on()) or not coalesce((%s) in (select app.window_locked_events()), false)) with check (not (select app.window_lock_on()) or not coalesce((%s) in (select app.window_locked_events()), false))',
      s.tbl || '_window_lock', s.tbl, s.ev, s.ev);
  end loop;
end
$pol$;
