-- Seduh Score Next · BTC March 2027, Build C: a seeding tie is equal POINTS, wins no longer define one
--
-- Why: the committee's rule for the preliminary standings is points, then the sum of each team's finish times,
-- confirmed by hand by the organiser; wins do not order the table. The shipped tie mechanism (20261010100000) keyed
-- everything on (total_points, wins), so a team with fewer wins on equal points was seeded below another with no
-- way to rank them by time. Spec: docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md section 5, Option A.
--
-- What changes:
--   * btc_seeding_tiebreaks: the snapshot loses `wins` and the unique key becomes (event_id, total_points,
--     tiebreak_rank). Every existing decision is DELETED first, explicitly (a decision made on (points, wins)
--     describes a different tie from the one it would now be read as: it could silently order a bigger group).
--     Checked in the cloud on 2026-11-10: the table had zero rows, so nothing real is lost; a local or demo
--     database loses only demo decisions. Dropping the column also drops the old unique constraint.
--   * btc_seeding_order: partition and order by points only (then the recorded rank, nulls last, then team id).
--     `wins` stays in the output, for display only, and no longer orders anything. Same output columns.
--   * record_btc_seeding_tiebreak: "level" means equal points; the group must still be complete, the preliminary
--     round confirmed and no bracket yet. Same hints, same signature, same grants (CREATE OR REPLACE keeps them).
--   * generate_btc_bracket: the 8th/9th cut-off check compares points only. Same signature and grants.
--   * btc_prelim_times (new, read-only): one row per team per confirmed preliminary match with its typed finish
--     time (`time_note`, null when none was typed), so the tie card does not reassemble it from raw matches.
--     security_invoker (the caller's own RLS on btc_matches applies: a non-member reads zero rows), granted to
--     `authenticated` only, never `anon`. `prelim_round` reads NULL as round 1, as the rest of the app does. A team
--     that played twice in one round has two rows for it; the client joins them.
--   Not touched: confirm_btc_match, the outbox, the live payload, btc_standings (it still sums points and wins).
--
-- rollback (in this order; the (points, wins) definitions below are the ones in force before this migration:
-- the view from 20261010100000, the two functions as redefined by 20261011140000):
--   drop view if exists btc_prelim_times;
--   drop view if exists btc_seeding_order;
--   delete from btc_seeding_tiebreaks;   -- decisions made on points alone cannot be read as (points, wins) ones
--   alter table btc_seeding_tiebreaks drop constraint if exists btc_seeding_tiebreaks_event_points_rank_key;
--   alter table btc_seeding_tiebreaks add column wins int not null;
--   alter table btc_seeding_tiebreaks add unique (event_id, total_points, wins, tiebreak_rank);
--   grant insert (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
--     on btc_seeding_tiebreaks to authenticated;
--
--   create view btc_seeding_order
--     with (security_invoker = true) as
--   with counted as (
--     select
--       s.event_id,
--       s.team_id,
--       s.played,
--       s.wins,
--       s.total_points,
--       count(*) over (partition by s.event_id, s.total_points, s.wins) as tied_count
--     from btc_standings s
--   ),
--   joined as (
--     select
--       c.*,
--       t.tiebreak_rank,
--       t.reason,
--       count(t.tiebreak_rank) over (partition by c.event_id, c.total_points, c.wins) as ranked_count
--     from counted c
--     left join btc_seeding_tiebreaks t
--       on t.event_id = c.event_id
--      and t.team_id = c.team_id
--      and t.total_points = c.total_points
--      and t.wins = c.wins
--      and t.group_size = c.tied_count
--   ),
--   resolved as (
--     select
--       j.*,
--       (j.tied_count = 1 or j.ranked_count = j.tied_count) as group_resolved
--     from joined j
--   )
--   select
--     event_id,
--     team_id,
--     played,
--     wins,
--     total_points,
--     tied_count::int as tied_count,
--     -- a rank and its reason exist only as part of a COMPLETE decision for this exact group
--     case when group_resolved then tiebreak_rank end as tiebreak_rank,
--     case when group_resolved then reason end as reason,
--     group_resolved,
--     (row_number() over (
--       partition by event_id
--       order by total_points desc, wins desc,
--                case when group_resolved then tiebreak_rank end asc nulls last, team_id
--     ))::int as seed
--   from resolved;
--
--   revoke all on btc_seeding_order from anon, authenticated;
--   grant select on btc_seeding_order to authenticated;
--   CREATE OR REPLACE FUNCTION public.record_btc_seeding_tiebreak(p_org_id uuid, p_event_id uuid, p_team_ids uuid[], p_reason text)
--    RETURNS void
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
--     v_points int;
--     v_max_points int;
--     v_wins int;
--     v_max_wins int;
--     v_found int;
--     v_group_size int;
--   begin
--     -- Same not-found shape as generate_btc_bracket, plus an explicit membership test: org_id_for_event answers for
--     -- any caller, so without it a non-member would learn "that event is in this org" from the next refusal.
--     if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
--       raise exception 'record_btc_seeding_tiebreak: event not found' using hint = 'seeding_event_not_found';
--     end if;
--
--     -- Serialises with generate_btc_bracket (same key) and with a second recording for the same event.
--     perform pg_advisory_xact_lock(hashtext(p_event_id::text));
--
--     if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
--       raise exception 'record_btc_seeding_tiebreak: the bracket already exists, so the seeds are fixed'
--         using hint = 'seeding_bracket_exists';
--     end if;
--
--     if exists (
--       select 1 from public.btc_matches
--       where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
--     ) then
--       raise exception 'record_btc_seeding_tiebreak: every preliminary match must be confirmed first'
--         using hint = 'seeding_preliminary_open';
--     end if;
--
--     if p_team_ids is null
--        or coalesce(array_length(p_team_ids, 1), 0) < 2
--        or exists (select 1 from unnest(p_team_ids) as x where x is null)
--        or (select count(distinct x) from unnest(p_team_ids) as x) <> array_length(p_team_ids, 1) then
--       raise exception 'record_btc_seeding_tiebreak: name at least two different teams'
--         using hint = 'seeding_group_invalid';
--     end if;
--
--     -- Every named team must have a standing in this event; the numbers they share are the tie being broken.
--     select count(*), min(total_points), max(total_points), min(wins), max(wins)
--       into v_found, v_points, v_max_points, v_wins, v_max_wins
--     from public.btc_seeding_order
--     where event_id = p_event_id and team_id = any (p_team_ids);
--     if v_found <> array_length(p_team_ids, 1) then
--       raise exception 'record_btc_seeding_tiebreak: a named team has no standing in this event'
--         using hint = 'seeding_group_invalid';
--     end if;
--     if v_points <> v_max_points or v_wins <> v_max_wins then
--       raise exception 'record_btc_seeding_tiebreak: those teams are not level on points and wins'
--         using hint = 'seeding_not_tied';
--     end if;
--
--     -- The group must be COMPLETE: every team level with them is named, none left to an arbitrary tail.
--     select count(*)::int into v_group_size
--     from public.btc_seeding_order
--     where event_id = p_event_id and total_points = v_points and wins = v_wins;
--     if v_group_size <> array_length(p_team_ids, 1) then
--       raise exception 'record_btc_seeding_tiebreak: name every team that is level, not some of them'
--         using hint = 'seeding_group_incomplete';
--     end if;
--
--     if v_reason is null then
--       raise exception 'record_btc_seeding_tiebreak: a reason is required' using hint = 'seeding_reason_required';
--     end if;
--     if char_length(v_reason) > 120 then
--       raise exception 'record_btc_seeding_tiebreak: the reason is too long (120 characters at most)'
--         using hint = 'seeding_reason_too_long';
--     end if;
--
--     -- Replace any earlier decision for these teams, and any earlier decision for this very tie.
--     delete from public.btc_seeding_tiebreaks
--     where event_id = p_event_id
--       and (team_id = any (p_team_ids) or (total_points = v_points and wins = v_wins));
--
--     insert into public.btc_seeding_tiebreaks
--       (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
--     select p_event_id, t.team_id, v_points, v_wins, array_length(p_team_ids, 1)::smallint, t.ord::smallint, v_reason
--     from unnest(p_team_ids) with ordinality as t(team_id, ord);
--   end;
--   $function$;
--   CREATE OR REPLACE FUNCTION public.generate_btc_bracket(p_org_id uuid, p_event_id uuid)
--    RETURNS SETOF btc_bracket_slots
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   declare
--     v_seed uuid[8];
--     v_qf uuid[4];
--     v_sf uuid[2];
--   begin
--     -- The explicit membership test (new here, as in record_btc_seeding_tiebreak): org_id_for_event answers for any
--     -- caller, so without it a non-member could confirm that an event belongs to an org from the next refusal, and
--     -- would queue on the advisory lock below before anything stopped them.
--     if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
--       raise exception 'generate_btc_bracket: event not found';
--     end if;
--
--     -- Serializes two near-simultaneous calls for the same event (e.g. a double-click on
--     -- "Generate bracket"): without this, both could pass the "already exists" check below
--     -- before either inserts: the unique (event_id, slot_label) constraint would still stop
--     -- the second insert, but as a raw constraint violation rather than the friendly error
--     -- this function means to give. Released automatically at transaction end.
--     perform pg_advisory_xact_lock(hashtext(p_event_id::text));
--
--     if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
--       raise exception 'generate_btc_bracket: a bracket already exists for this event';
--     end if;
--
--     if exists (
--       select 1 from public.btc_matches
--       where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
--     ) then
--       raise exception 'generate_btc_bracket: every preliminary match must be confirmed first';
--     end if;
--
--     if (select count(*) from public.btc_standings where event_id = p_event_id) < 8 then
--       raise exception 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required';
--     end if;
--
--     -- A tie across the 8th/9th boundary that nobody has ordered is a real "who actually qualified" question
--     -- this function refuses to guess at. The organiser orders the tied teams (record_btc_seeding_tiebreak)
--     -- and retries.
--     if exists (
--       select 1
--       from public.btc_seeding_order r8
--       join public.btc_seeding_order r9 on r9.event_id = r8.event_id and r9.seed = r8.seed + 1
--       where r8.event_id = p_event_id
--         and r8.seed = 8
--         and r8.total_points = r9.total_points
--         and r8.wins = r9.wins
--         and not r8.group_resolved
--     ) then
--       raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
--     end if;
--
--     -- The seed order is btc_seeding_order's. team_id is its final, arbitrary-but-deterministic tiebreak: reached only
--     -- for teams level on points and wins that nobody has ordered and that are NOT across the 8th/9th boundary (which
--     -- the check above refused), so they still get a stable seed order rather than an undefined one.
--     select array_agg(team_id order by seed) into v_seed
--     from public.btc_seeding_order
--     where event_id = p_event_id and seed <= 8;
--
--     insert into public.btc_bracket_slots (event_id, round, slot_label, seed_1, seed_2, team1_id, team2_id)
--     values
--       (p_event_id, 'quarterfinal', 'qf1', 1, 8, v_seed[1], v_seed[8]),
--       (p_event_id, 'quarterfinal', 'qf2', 4, 5, v_seed[4], v_seed[5]),
--       (p_event_id, 'quarterfinal', 'qf3', 3, 6, v_seed[3], v_seed[6]),
--       (p_event_id, 'quarterfinal', 'qf4', 2, 7, v_seed[2], v_seed[7]);
--
--     -- RETURNING INTO can't target a scalar/array across a multi-row INSERT (plpgsql
--     -- raises "query returned more than one row"), so the 4 new ids are re-selected here.
--     select array_agg(id order by slot_label) into v_qf
--     from public.btc_bracket_slots
--     where event_id = p_event_id and slot_label in ('qf1', 'qf2', 'qf3', 'qf4');
--
--     insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
--     values
--       (p_event_id, 'semifinal', 'sf1', v_qf[1], v_qf[2]), -- qf1, qf2
--       (p_event_id, 'semifinal', 'sf2', v_qf[3], v_qf[4]); -- qf3, qf4
--
--     select array_agg(id order by slot_label) into v_sf
--     from public.btc_bracket_slots
--     where event_id = p_event_id and slot_label in ('sf1', 'sf2');
--
--     insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
--     values
--       (p_event_id, 'final', 'final', v_sf[1], v_sf[2]),
--       (p_event_id, 'third_place', 'third_place', v_sf[1], v_sf[2]);
--
--     return query select * from public.btc_bracket_slots where event_id = p_event_id;
--   end;
--   $function$;

drop view btc_seeding_order;

-- Decisions made on (points, wins) are discarded, explicitly: see the header.
delete from btc_seeding_tiebreaks;

alter table btc_seeding_tiebreaks drop column wins;   -- takes the old unique (event, points, wins, rank) with it
alter table btc_seeding_tiebreaks
  add constraint btc_seeding_tiebreaks_event_points_rank_key unique (event_id, total_points, tiebreak_rank);

-- (The insert grant listed `wins`; dropping the column removed it from the grant. Nothing else about access changes.)

create view btc_seeding_order
  with (security_invoker = true) as
with counted as (
  select
    s.event_id,
    s.team_id,
    s.played,
    s.wins,
    s.total_points,
    count(*) over (partition by s.event_id, s.total_points) as tied_count
  from btc_standings s
),
joined as (
  select
    c.*,
    t.tiebreak_rank,
    t.reason,
    count(t.tiebreak_rank) over (partition by c.event_id, c.total_points) as ranked_count
  from counted c
  left join btc_seeding_tiebreaks t
    on t.event_id = c.event_id
   and t.team_id = c.team_id
   and t.total_points = c.total_points
   and t.group_size = c.tied_count
),
resolved as (
  select
    j.*,
    (j.tied_count = 1 or j.ranked_count = j.tied_count) as group_resolved
  from joined j
)
select
  event_id,
  team_id,
  played,
  wins,
  total_points,
  tied_count::int as tied_count,
  -- a rank and its reason exist only as part of a COMPLETE decision for this exact group
  case when group_resolved then tiebreak_rank end as tiebreak_rank,
  case when group_resolved then reason end as reason,
  group_resolved,
  (row_number() over (
    partition by event_id
    order by total_points desc,
             case when group_resolved then tiebreak_rank end asc nulls last, team_id
  ))::int as seed
from resolved;

revoke all on btc_seeding_order from anon, authenticated;
grant select on btc_seeding_order to authenticated;

CREATE OR REPLACE FUNCTION public.record_btc_seeding_tiebreak(p_org_id uuid, p_event_id uuid, p_team_ids uuid[], p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_points int;
  v_max_points int;
  v_found int;
  v_group_size int;
begin
  -- Same not-found shape as generate_btc_bracket, plus an explicit membership test: org_id_for_event answers for
  -- any caller, so without it a non-member would learn "that event is in this org" from the next refusal.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'record_btc_seeding_tiebreak: event not found' using hint = 'seeding_event_not_found';
  end if;

  -- Serialises with generate_btc_bracket (same key) and with a second recording for the same event.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'record_btc_seeding_tiebreak: the bracket already exists, so the seeds are fixed'
      using hint = 'seeding_bracket_exists';
  end if;

  if exists (
    select 1 from public.btc_matches
    where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
  ) then
    raise exception 'record_btc_seeding_tiebreak: every preliminary match must be confirmed first'
      using hint = 'seeding_preliminary_open';
  end if;

  if p_team_ids is null
     or coalesce(array_length(p_team_ids, 1), 0) < 2
     or exists (select 1 from unnest(p_team_ids) as x where x is null)
     or (select count(distinct x) from unnest(p_team_ids) as x) <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: name at least two different teams'
      using hint = 'seeding_group_invalid';
  end if;

  -- Every named team must have a standing in this event; the points they share are the tie being broken.
  select count(*), min(total_points), max(total_points)
    into v_found, v_points, v_max_points
  from public.btc_seeding_order
  where event_id = p_event_id and team_id = any (p_team_ids);
  if v_found <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: a named team has no standing in this event'
      using hint = 'seeding_group_invalid';
  end if;
  if v_points <> v_max_points then
    raise exception 'record_btc_seeding_tiebreak: those teams are not level on points'
      using hint = 'seeding_not_tied';
  end if;

  -- The group must be COMPLETE: every team level with them is named, none left to an arbitrary tail.
  select count(*)::int into v_group_size
  from public.btc_seeding_order
  where event_id = p_event_id and total_points = v_points;
  if v_group_size <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: name every team that is level, not some of them'
      using hint = 'seeding_group_incomplete';
  end if;

  if v_reason is null then
    raise exception 'record_btc_seeding_tiebreak: a reason is required' using hint = 'seeding_reason_required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'record_btc_seeding_tiebreak: the reason is too long (120 characters at most)'
      using hint = 'seeding_reason_too_long';
  end if;

  -- Replace any earlier decision for these teams, and any earlier decision for this very tie.
  delete from public.btc_seeding_tiebreaks
  where event_id = p_event_id
    and (team_id = any (p_team_ids) or total_points = v_points);

  insert into public.btc_seeding_tiebreaks
    (event_id, team_id, total_points, group_size, tiebreak_rank, reason)
  select p_event_id, t.team_id, v_points, array_length(p_team_ids, 1)::smallint, t.ord::smallint, v_reason
  from unnest(p_team_ids) with ordinality as t(team_id, ord);
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_btc_bracket(p_org_id uuid, p_event_id uuid)
 RETURNS SETOF btc_bracket_slots
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_seed uuid[8];
  v_qf uuid[4];
  v_sf uuid[2];
begin
  -- The explicit membership test (new here, as in record_btc_seeding_tiebreak): org_id_for_event answers for any
  -- caller, so without it a non-member could confirm that an event belongs to an org from the next refusal, and
  -- would queue on the advisory lock below before anything stopped them.
  if p_org_id is null or p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
    raise exception 'generate_btc_bracket: event not found';
  end if;

  -- Serializes two near-simultaneous calls for the same event (e.g. a double-click on
  -- "Generate bracket"): without this, both could pass the "already exists" check below
  -- before either inserts: the unique (event_id, slot_label) constraint would still stop
  -- the second insert, but as a raw constraint violation rather than the friendly error
  -- this function means to give. Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from public.btc_bracket_slots where event_id = p_event_id) then
    raise exception 'generate_btc_bracket: a bracket already exists for this event';
  end if;

  if exists (
    select 1 from public.btc_matches
    where event_id = p_event_id and round = 'preliminary' and status <> 'confirmed'
  ) then
    raise exception 'generate_btc_bracket: every preliminary match must be confirmed first';
  end if;

  if (select count(*) from public.btc_standings where event_id = p_event_id) < 8 then
    raise exception 'generate_btc_bracket: at least 8 teams with a confirmed preliminary result are required';
  end if;

  -- A tie across the 8th/9th boundary that nobody has ordered is a real "who actually qualified" question
  -- this function refuses to guess at. The organiser orders the tied teams (record_btc_seeding_tiebreak)
  -- and retries.
  if exists (
    select 1
    from public.btc_seeding_order r8
    join public.btc_seeding_order r9 on r9.event_id = r8.event_id and r9.seed = r8.seed + 1
    where r8.event_id = p_event_id
      and r8.seed = 8
      and r8.total_points = r9.total_points
      and not r8.group_resolved
  ) then
    raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
  end if;

  -- The seed order is btc_seeding_order's. team_id is its final, arbitrary-but-deterministic tiebreak: reached only
  -- for teams level on points that nobody has ordered and that are NOT across the 8th/9th boundary (which
  -- the check above refused), so they still get a stable seed order rather than an undefined one.
  select array_agg(team_id order by seed) into v_seed
  from public.btc_seeding_order
  where event_id = p_event_id and seed <= 8;

  insert into public.btc_bracket_slots (event_id, round, slot_label, seed_1, seed_2, team1_id, team2_id)
  values
    (p_event_id, 'quarterfinal', 'qf1', 1, 8, v_seed[1], v_seed[8]),
    (p_event_id, 'quarterfinal', 'qf2', 4, 5, v_seed[4], v_seed[5]),
    (p_event_id, 'quarterfinal', 'qf3', 3, 6, v_seed[3], v_seed[6]),
    (p_event_id, 'quarterfinal', 'qf4', 2, 7, v_seed[2], v_seed[7]);

  -- RETURNING INTO can't target a scalar/array across a multi-row INSERT (plpgsql
  -- raises "query returned more than one row"), so the 4 new ids are re-selected here.
  select array_agg(id order by slot_label) into v_qf
  from public.btc_bracket_slots
  where event_id = p_event_id and slot_label in ('qf1', 'qf2', 'qf3', 'qf4');

  insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
  values
    (p_event_id, 'semifinal', 'sf1', v_qf[1], v_qf[2]), -- qf1, qf2
    (p_event_id, 'semifinal', 'sf2', v_qf[3], v_qf[4]); -- qf3, qf4

  select array_agg(id order by slot_label) into v_sf
  from public.btc_bracket_slots
  where event_id = p_event_id and slot_label in ('sf1', 'sf2');

  insert into public.btc_bracket_slots (event_id, round, slot_label, feeder_slot_1, feeder_slot_2)
  values
    (p_event_id, 'final', 'final', v_sf[1], v_sf[2]),
    (p_event_id, 'third_place', 'third_place', v_sf[1], v_sf[2]);

  return query select * from public.btc_bracket_slots where event_id = p_event_id;
end;
$function$;

-- The preliminary finish times, for the tie card. See the header.
create view btc_prelim_times
  with (security_invoker = true) as
select m.event_id, m.team1_id as team_id, coalesce(m.prelim_round, 1)::int as prelim_round,
       m.team1_time_note as time_note
from btc_matches m
where m.round = 'preliminary' and m.status = 'confirmed'
union all
select m.event_id, m.team2_id as team_id, coalesce(m.prelim_round, 1)::int as prelim_round,
       m.team2_time_note as time_note
from btc_matches m
where m.round = 'preliminary' and m.status = 'confirmed';

revoke all on btc_prelim_times from anon, authenticated;
grant select on btc_prelim_times to authenticated;
