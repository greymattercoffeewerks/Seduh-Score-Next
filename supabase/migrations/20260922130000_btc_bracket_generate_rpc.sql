-- Seduh Score Next · T-BTC.2 sub-step 5: generate_btc_bracket RPC
--
-- Fixed bracket shape (BTC Next Migration plan doc; user's own stated regional
-- format): preliminary round-robin cuts to a top-8 single-elimination bracket —
-- 4 quarterfinals, 2 semifinals, 1 final, plus a third-place match fed by the two
-- semifinal LOSERS (legacy's own createBracketMatch scores third place as a
-- Finals-length match — already handled, cupsForRound treats every non-preliminary
-- round as 20 cups). Standard seeding keeps the top seeds apart until the final:
-- QF1 = 1v8, QF2 = 4v5, QF3 = 3v6, QF4 = 2v7. SF1 is fed by QF1+QF2, SF2 by QF3+QF4;
-- the final and third-place slots are both fed by SF1+SF2 — the final by their
-- winners, third-place by their losers (btc_bracket_slots' own header comment in
-- 20260918090000_btc_tables.sql already anticipated exactly this: "feeder_slot_1/2
-- point at the QF/SF slots whose winners (or, for the third-place slot, losers)
-- fill this slot's two team positions"). This RPC only ever creates the 8 slots
-- (4 QF seeded, SF/final/third-place empty, feeder-linked); nothing here creates a
-- btc_matches row — that's create_btc_bracket_match's job, once a slot's two teams
-- are both known, mirroring create_btc_match's own separation of "the bracket
-- position exists" from "the match itself exists."
--
-- Not outbox-routed, matching create_btc_match's own reasoning (20260918100000's
-- comment): a one-time setup action, not a live per-second write, so a dropped
-- response just means the caller doesn't know whether it landed — the "a bracket
-- already exists for this event" guard below makes a retry naturally safe (no
-- processed_operations ledger needed) the same way create_btc_match's own
-- duplicate-match tolerance is a deliberate, not-forbidden outcome, except here a
-- SECOND bracket for one event genuinely never makes sense, so the guard actively
-- refuses it rather than merely tolerating a duplicate.
--
-- rollback:
--   revoke execute on function generate_btc_bracket(uuid, uuid) from service_role;
--   revoke execute on function generate_btc_bracket(uuid, uuid) from authenticated;
--   revoke execute on function generate_btc_bracket(uuid, uuid) from anon;
--   drop function if exists generate_btc_bracket(uuid, uuid);

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
  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'generate_btc_bracket: event not found';
  end if;

  -- Serializes two near-simultaneous calls for the same event (e.g. a double-click on
  -- "Generate bracket"): without this, both could pass the "already exists" check below
  -- before either inserts — the unique (event_id, slot_label) constraint would still stop
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

  -- A tie at the 8th/9th boundary is a real "who actually qualified" question this
  -- function refuses to guess at, the same discipline as the scoring formula never
  -- defaulting an unresolved token tie to either team. The organiser resolves it
  -- outside this RPC (there is no seeding-tie-break UI yet — deferred, tracked in
  -- ROADMAP.md) and retries.
  if exists (
    with ranked as (
      select team_id, total_points, wins,
             row_number() over (order by total_points desc, wins desc, team_id) as rn
      from public.btc_standings
      where event_id = p_event_id
    )
    select 1 from ranked r8 join ranked r9 on r9.rn = r8.rn + 1
    where r8.rn = 8 and r8.total_points = r9.total_points and r8.wins = r9.wins
  ) then
    raise exception 'generate_btc_bracket: teams are tied for the 8th qualifying spot — resolve the tie before generating the bracket';
  end if;

  -- team_id is the final, arbitrary-but-deterministic tiebreak for seed ORDER only
  -- (never for the 8th/9th boundary check above, which already refused a real tie) —
  -- ties above/below the cutoff still get a stable seed order rather than an
  -- undefined one.
  select array_agg(team_id order by rn) into v_seed
  from (
    select team_id,
           row_number() over (order by total_points desc, wins desc, team_id) as rn
    from public.btc_standings
    where event_id = p_event_id
  ) ranked
  where rn <= 8;

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

-- Explicit anon revoke, not just from public: a newer Postgres/Supabase-CLI bootstrap
-- grants EXECUTE to anon/authenticated directly via pg_default_acl, not via PUBLIC, so
-- "revoke ... from public" alone is a no-op against it (the exact gap closed for every
-- other write RPC in 20260922110000 — these two RPCs didn't exist yet when that ran).
revoke execute on function generate_btc_bracket(uuid, uuid) from public, anon;
grant execute on function generate_btc_bracket(uuid, uuid) to authenticated;
grant execute on function generate_btc_bracket(uuid, uuid) to service_role;
