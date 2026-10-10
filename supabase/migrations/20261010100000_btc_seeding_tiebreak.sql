-- Seduh Score Next · T-BTC seeding tie rule: the organiser records the order of teams tied in the standings
--
-- Why: generate_btc_bracket refuses when teams are level (points AND wins) across the 8th/9th qualifying
-- boundary ("never default a tie"), and the organiser had no way to settle it inside the app: the bracket
-- simply could not be generated until it was settled elsewhere and the standings somehow changed. How the
-- tie is broken (a head-to-head, a sudden-death cup, the head judge's casting vote) is the event's own rule;
-- the platform records WHO ranks above whom and WHY. Same stance as the knockout tie-break
-- (20261009110000): any signed-in organiser may record it, a reason is required, the app scores nothing.
--
-- What is decided: the order of ONE complete group of teams that are level on (total_points, wins). Any
-- level group may be ordered, not only the one across the cut-off: seeds decide who plays whom (QF1 is
-- seed 1 v seed 8) and, until now, teams level above or below the cut-off were seeded in an arbitrary
-- team-id order. Only the group across the cut-off BLOCKS generation until it is ordered.
--
-- Shape:
--   * btc_seeding_tiebreaks: one row per team in a decided group. total_points, wins and group_size are a
--     SNAPSHOT of the tie being broken. A row only counts while its team's current (total_points, wins) in
--     btc_standings are still those numbers AND the number of teams level on them is still group_size, so a
--     decision can never silently order a DIFFERENT tie that later results create: a re-confirmed
--     preliminary match that moves the numbers, or one that moves a team into or out of the group, makes the
--     old decision inert, and the boundary is blocked again until it is re-recorded. unique (event, points,
--     wins, rank) keeps ranks distinct within a group; the composite FK keeps a team in its own event.
--     Authenticated members get column-level privileges only (below): they cannot set recorded_by or
--     recorded_at, and cannot move a row to another team or event. Their direct writes are refused once the
--     event has a bracket (the policy), so the view can never disagree with the slots generation wrote.
--     Only a COMPLETE decision orders anything: while a group is not resolved (a team left or joined it, or
--     a row was deleted) its recorded ranks are ignored, so a half-valid decision never half-orders a tie.
--     A decision revives when the same teams are level on the same numbers again (same size): intended, and
--     the screen shows its reason when the group is opened again.
--   * btc_seeding_order (security_invoker view): the ONE place seed order is derived. Points desc, wins desc,
--     the recorded rank (nulls last), then team id (the old arbitrary-but-deterministic tail, now reached only
--     by a tie nobody has ordered). It also says, per team, how many teams share its numbers (tied_count),
--     whether that group has been ordered completely (group_resolved: no team in a group of one needs
--     ordering, a bigger group needs every member ranked), and the recorded rank and reason.
--   * record_btc_seeding_tiebreak(org, event, team_ids[], reason): the array IS the order, first = highest.
--     The group must be COMPLETE (every team level with them, none omitted), actually level, the
--     preliminary round fully confirmed (results can still move otherwise) and no bracket yet (seeds are
--     fixed once written). It replaces any earlier decision for those teams in one transaction. Refusals
--     carry a machine-readable `hint` so the client never depends on message wording.
--   * generate_btc_bracket is replaced (same signature, same grants): the seed order and the cut-off check
--     now come from btc_seeding_order. With nothing recorded it behaves exactly as before (a tie across
--     the 8th/9th boundary refuses; teams level elsewhere are seeded by team id).
--   * Not in score_change_log (it would mean teaching the log function a new table, its composite key and its
--     coverage guard): a decision keeps who recorded it and when (not forgeable: see the column privileges),
--     and a re-record REPLACES it, so earlier decisions are not kept. Who actually qualified and who plays
--     whom IS logged, because the bracket slots generate_btc_bracket writes are. Listed in ROADMAP.
--
-- rollback:
--   (in this order)
--   restore generate_btc_bracket verbatim from 20260922130000_btc_bracket_generate_rpc.sql (CREATE OR REPLACE
--     onto the same signature; its revoke-from-public,anon / grant-to-authenticated-and-service_role set is unchanged);
--   drop function if exists record_btc_seeding_tiebreak(uuid, uuid, uuid[], text);
--   drop view if exists btc_seeding_order;
--   drop table if exists btc_seeding_tiebreaks;   (a recorded order is lost with it)
--   alter table btc_teams drop constraint if exists btc_teams_id_event_unique;

alter table btc_teams
  add constraint btc_teams_id_event_unique unique (id, event_id);

create table btc_seeding_tiebreaks (
  event_id      uuid not null references events(id) on delete cascade,
  team_id       uuid not null,
  total_points  int not null,
  wins          int not null,
  group_size    smallint not null check (group_size >= 2),
  tiebreak_rank smallint not null check (tiebreak_rank >= 1),
  reason        text not null
                check (char_length(btrim(reason, E' \t\r\n')) between 1 and 120 and char_length(reason) <= 120),
  recorded_by   uuid default auth.uid(),
  recorded_at   timestamptz not null default now(),
  check (tiebreak_rank <= group_size),
  primary key (event_id, team_id),
  unique (event_id, total_points, wins, tiebreak_rank),
  foreign key (team_id, event_id) references btc_teams (id, event_id) on delete cascade
);
alter table btc_seeding_tiebreaks enable row level security;

create policy btc_seeding_tiebreaks_read on btc_seeding_tiebreaks
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy btc_seeding_tiebreaks_write on btc_seeding_tiebreaks
  for all
  using (
    app.is_org_member(app.org_id_for_event(event_id))
    and not exists (select 1 from btc_bracket_slots s where s.event_id = btc_seeding_tiebreaks.event_id)
  )
  with check (
    app.is_org_member(app.org_id_for_event(event_id))
    and not exists (select 1 from btc_bracket_slots s where s.event_id = btc_seeding_tiebreaks.event_id)
  );

-- Column-level privileges, unlike the other btc_* tables: a decision's audit fields (recorded_by, recorded_at)
-- must be the database's own (their defaults), and a row must stay with its team and event. Members can read
-- every column, insert the fields the RPC provides, change only the rank and the reason, and delete.
revoke all on btc_seeding_tiebreaks from anon, authenticated;
grant select on btc_seeding_tiebreaks to authenticated;
grant insert (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
  on btc_seeding_tiebreaks to authenticated;
grant update (tiebreak_rank, reason) on btc_seeding_tiebreaks to authenticated;
grant delete on btc_seeding_tiebreaks to authenticated;

create view btc_seeding_order
  with (security_invoker = true) as
with counted as (
  select
    s.event_id,
    s.team_id,
    s.played,
    s.wins,
    s.total_points,
    count(*) over (partition by s.event_id, s.total_points, s.wins) as tied_count
  from btc_standings s
),
joined as (
  select
    c.*,
    t.tiebreak_rank,
    t.reason,
    count(t.tiebreak_rank) over (partition by c.event_id, c.total_points, c.wins) as ranked_count
  from counted c
  left join btc_seeding_tiebreaks t
    on t.event_id = c.event_id
   and t.team_id = c.team_id
   and t.total_points = c.total_points
   and t.wins = c.wins
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
    order by total_points desc, wins desc,
             case when group_resolved then tiebreak_rank end asc nulls last, team_id
  ))::int as seed
from resolved;

revoke all on btc_seeding_order from anon, authenticated;
grant select on btc_seeding_order to authenticated;

create or replace function record_btc_seeding_tiebreak(
  p_org_id uuid,
  p_event_id uuid,
  p_team_ids uuid[],
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_points int;
  v_max_points int;
  v_wins int;
  v_max_wins int;
  v_found int;
  v_group_size int;
begin
  -- Same not-found shape as generate_btc_bracket, plus an explicit membership test: org_id_for_event answers for
  -- any caller, so without it a non-member would learn "that event is in this org" from the next refusal.
  if p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
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

  -- Every named team must have a standing in this event; the numbers they share are the tie being broken.
  select count(*), min(total_points), max(total_points), min(wins), max(wins)
    into v_found, v_points, v_max_points, v_wins, v_max_wins
  from public.btc_seeding_order
  where event_id = p_event_id and team_id = any (p_team_ids);
  if v_found <> array_length(p_team_ids, 1) then
    raise exception 'record_btc_seeding_tiebreak: a named team has no standing in this event'
      using hint = 'seeding_group_invalid';
  end if;
  if v_points <> v_max_points or v_wins <> v_max_wins then
    raise exception 'record_btc_seeding_tiebreak: those teams are not level on points and wins'
      using hint = 'seeding_not_tied';
  end if;

  -- The group must be COMPLETE: every team level with them is named, none left to an arbitrary tail.
  select count(*)::int into v_group_size
  from public.btc_seeding_order
  where event_id = p_event_id and total_points = v_points and wins = v_wins;
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
    and (team_id = any (p_team_ids) or (total_points = v_points and wins = v_wins));

  insert into public.btc_seeding_tiebreaks
    (event_id, team_id, total_points, wins, group_size, tiebreak_rank, reason)
  select p_event_id, t.team_id, v_points, v_wins, array_length(p_team_ids, 1)::smallint, t.ord::smallint, v_reason
  from unnest(p_team_ids) with ordinality as t(team_id, ord);
end;
$$;

revoke execute on function record_btc_seeding_tiebreak(uuid, uuid, uuid[], text) from public, anon;
grant execute on function record_btc_seeding_tiebreak(uuid, uuid, uuid[], text) to authenticated;
-- (service_role has the grant for symmetry with the other RPCs, but both functions test is_org_member(), which
-- reads auth.uid(), so a service_role call is refused: nothing calls these as service_role.)
grant execute on function record_btc_seeding_tiebreak(uuid, uuid, uuid[], text) to service_role;

-- generate_btc_bracket: the seed order and the cut-off check come from btc_seeding_order. The body is
-- 20260922130000's, except for those two reads.
create or replace function generate_btc_bracket(p_org_id uuid, p_event_id uuid)
returns setof btc_bracket_slots
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seed uuid[8];
  v_qf uuid[4];
  v_sf uuid[2];
begin
  -- The explicit membership test (new here, as in record_btc_seeding_tiebreak): org_id_for_event answers for any
  -- caller, so without it a non-member could confirm that an event belongs to an org from the next refusal, and
  -- would queue on the advisory lock below before anything stopped them.
  if p_org_id is distinct from app.org_id_for_event(p_event_id) or not app.is_org_member(p_org_id) then
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
      and r8.wins = r9.wins
      and not r8.group_resolved
  ) then
    raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
  end if;

  -- The seed order is btc_seeding_order's. team_id is its final, arbitrary-but-deterministic tiebreak: reached only
  -- for teams level on points and wins that nobody has ordered and that are NOT across the 8th/9th boundary (which
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
$$;

revoke execute on function generate_btc_bracket(uuid, uuid) from public, anon;
grant execute on function generate_btc_bracket(uuid, uuid) to authenticated;
grant execute on function generate_btc_bracket(uuid, uuid) to service_role;
