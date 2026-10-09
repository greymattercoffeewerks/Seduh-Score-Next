-- Seduh Score Next · T-BTC knockout tie rule: the organiser records the winner of a tied match
--
-- Why: a knockout match that ends level on bonus-inclusive totals advanced nobody
-- (20260922132000, 20261009100000 — "never default a tie"), and the organiser had no way to
-- resolve it, so the bracket simply stopped. The decision of HOW to break a tie (a sudden-death
-- cup, a head judge's casting vote, a re-brew) is made at the venue under the event's own rules;
-- the platform's job is to record WHO won and WHY, in a form that is auditable. Decision
-- (user, 2026-10-09): any signed-in organiser may record it; a reason is required; the app does
-- not score a tie-break cup itself.
--
-- Shape:
--   * btc_matches.tiebreak_winner_team_id / tiebreak_reason (both null, or both set). A CHECK
--     keeps it honest even against a direct table write: the winner is one of the match's own two
--     teams, the match is not preliminary, the reason is 1-120 characters after trimming the same
--     whitespace set (space, tab, CR, LF) the RPC trims. These are LOGGED columns
--     (app.log_score_change now lists them; the column-coverage guard 018 is updated to match), so
--     recording or changing a tie-break lands in score_change_log and the dispute pack with the
--     reason beside it.
--   * Nothing about the totals changes. btc_match_scores still says 30-30; the tie-break is a
--     separate fact that only decides who advances. A tied match is still shown as tied.
--   * app.advance_btc_bracket(match) is the ONE place advancement is derived. It used to be the tail
--     of confirm_btc_match; it is lifted out so record_btc_tiebreak can reuse it instead of growing
--     a second copy that could drift. Effective winner: decisive totals win; on a tie, the recorded
--     tie-break winner; on a tie with none recorded, nobody (seats cleared, or the call refused if the
--     downstream match already exists, exactly as 20261009100000). A decisive result SUPERSEDES an
--     earlier tie-break: if a re-confirm makes the match no longer level, the stale tie-break is
--     cleared in the same transaction, so it can never resurface if the match is tied again later.
--     A re-confirm that is still level keeps the recorded winner.
--   * record_btc_tiebreak(org, match, winner, reason): knockout rounds only, match must be
--     confirmed AND currently tied, winner must be one of its two teams, reason required. It sets
--     app.change_reason (read by the log trigger) for just this transaction, then calls the helper.
--     Changing the winner after the downstream match exists is refused by the helper's existing
--     guard. Re-recording the SAME winner and reason changes nothing (the UPDATE is skipped, so no
--     updated_at bump either), so no outbox is needed: this is an online organiser action like
--     generate_btc_bracket, not a per-second scoring write. A real change touches the match row, so
--     updated_at moves and a stale scoring draft of the same match conflicts instead of silently
--     overwriting.
--   * Refusals carry a machine-readable `hint` (bracket_advanced, tiebreak_not_tied,
--     tiebreak_unconfirmed, tiebreak_match_not_found) so the client never depends on message wording.
--   * app.advance_btc_bracket does nothing for a match that is not confirmed (an unconfirmed match
--     reads 0-0 in btc_match_scores, which would look like a tie and clear seats), and takes winner/
--     loser orientation from the MATCH's own teams — the same ids the podium reads — not the slot's.
--   * confirm_btc_match is replaced (same signature). Its body is identical to 20261009100000 up to
--     the ledger insert, except that the seven variables only the advancement block used are no longer
--     declared; the block itself is now a single `perform app.advance_btc_bracket(...)`.
--
-- rollback:
--   (in this order)
--   drop function if exists record_btc_tiebreak(uuid, uuid, uuid, text);
--   then restore confirm_btc_match verbatim from 20261009100000_btc_confirm_match_tie_clears_downstream.sql
--     (CREATE OR REPLACE onto the same signature; same revoke-from-public / grant-to-authenticated-and-
--     service_role set);
--   drop function if exists app.advance_btc_bracket(uuid);
--   restore app.log_score_change() verbatim from 20260924100000_score_change_log.sql (CREATE OR REPLACE;
--     its trigger bindings are unchanged) and re-run its `revoke execute ... from public, anon, authenticated`;
--   alter table btc_matches drop constraint btc_matches_tiebreak_shape,
--     drop column tiebreak_reason, drop column tiebreak_winner_team_id;
--   (a tie-break already recorded is lost with its columns; the log rows that recorded it stay).

alter table btc_matches
  add column tiebreak_winner_team_id uuid references btc_teams(id) on delete restrict,
  add column tiebreak_reason text;

alter table btc_matches
  add constraint btc_matches_tiebreak_shape check (
    (tiebreak_winner_team_id is null and tiebreak_reason is null)
    or (
      tiebreak_winner_team_id is not null
      and tiebreak_reason is not null
      and tiebreak_winner_team_id in (team1_id, team2_id)
      and round <> 'preliminary'
      and char_length(btrim(tiebreak_reason, E' \t\r\n')) between 1 and 120
    )
  );

create index on btc_matches (tiebreak_winner_team_id) where tiebreak_winner_team_id is not null;

-- The change log now also records the two tie-break columns (only btc_matches' key list differs
-- from 20260924100000's function body; trigger bindings are unchanged).
create or replace function app.log_score_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new       jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old       jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row       jsonb := coalesce(v_new, v_old);
  v_keys      text[];
  v_ctx_keys  text[];
  v_event_id  uuid;
  v_org_id    uuid;
  v_confirmed boolean := false;
  v_old_scope jsonb;
  v_new_scope jsonb;
  v_row_id    uuid;
begin
  case tg_table_name
    when 'ct_heat_entries' then
      v_keys := array['elapsed_secs', 'elapsed_secs_raw', 'maxed', 'time_source', 'time_note'];
      v_ctx_keys := array['heat_id', 'entry_id'];
      select s.event_id, h.status = 'confirmed' into v_event_id, v_confirmed
        from public.ct_heats h join public.ct_stages s on s.id = h.stage_id
       where h.id = (v_row ->> 'heat_id')::uuid;
    when 'ct_results' then
      v_keys := array['correct'];
      v_ctx_keys := array['heat_entry_id', 'set_id'];
      select s.event_id, h.status = 'confirmed' into v_event_id, v_confirmed
        from public.ct_heat_entries he
        join public.ct_heats h on h.id = he.heat_id
        join public.ct_stages s on s.id = h.stage_id
       where he.id = (v_row ->> 'heat_entry_id')::uuid;
    when 'ct_heats' then
      v_keys := array['kind', 'status'];
      v_ctx_keys := array['stage_id', 'heat_number'];
      select s.event_id into v_event_id
        from public.ct_stages s where s.id = (v_row ->> 'stage_id')::uuid;
      -- The state BEFORE this change: re-opening a confirmed heat is itself an
      -- after-confirm change.
      v_confirmed := coalesce(v_old ->> 'status', v_row ->> 'status') = 'confirmed';
    when 'ct_stages' then
      v_keys := array['kind', 'ordinal', 'status', 'set_count', 'cutoff'];
      v_ctx_keys := array['kind', 'ordinal'];
      v_event_id := (v_row ->> 'event_id')::uuid;
      v_confirmed := coalesce(v_old ->> 'status', v_row ->> 'status') = 'complete';
    when 'ct_stage_entries' then
      v_keys := array['source', 'final_position', 'position_note'];
      v_ctx_keys := array['stage_id', 'entry_id'];
      select s.event_id, s.status = 'complete' into v_event_id, v_confirmed
        from public.ct_stages s where s.id = (v_row ->> 'stage_id')::uuid;
    when 'btc_cup_votes' then
      v_keys := array['team1_tokens'];
      v_ctx_keys := array['match_id', 'cup_number'];
      select m.event_id, m.status = 'confirmed' into v_event_id, v_confirmed
        from public.btc_matches m where m.id = (v_row ->> 'match_id')::uuid;
    when 'btc_match_bonuses' then
      v_keys := array['fastest_team_id', 'team1_signature_beverage', 'team2_signature_beverage'];
      v_ctx_keys := array['match_id'];
      select m.event_id, m.status = 'confirmed' into v_event_id, v_confirmed
        from public.btc_matches m where m.id = (v_row ->> 'match_id')::uuid;
    when 'btc_matches' then
      v_keys := array['round', 'team1_id', 'team2_id', 'status', 'team1_time_note', 'team2_time_note',
                       'tiebreak_winner_team_id', 'tiebreak_reason'];
      v_ctx_keys := array[]::text[];
      v_event_id := (v_row ->> 'event_id')::uuid;
      v_confirmed := coalesce(v_old ->> 'status', v_row ->> 'status') = 'confirmed';
    when 'btc_bracket_slots' then
      v_keys := array['team1_id', 'team2_id', 'match_id'];
      v_ctx_keys := array['round', 'slot_label'];
      v_event_id := (v_row ->> 'event_id')::uuid;
      -- An advancement edit after the linked match was confirmed is an after-confirm change.
      select m.status = 'confirmed' into v_confirmed
        from public.btc_matches m
       where m.id = coalesce((v_old ->> 'match_id')::uuid, (v_row ->> 'match_id')::uuid);
    when 'events' then
      v_keys := array['is_test'];
      v_ctx_keys := array[]::text[];
      v_event_id := (v_row ->> 'id')::uuid;
  end case;

  -- Parent chain gone (cascade delete) or event missing: nothing to attribute to.
  if v_event_id is null then
    return null;
  end if;

  if tg_table_name = 'events' then
    -- Not a scored table: only an is_test flip (either direction) and the deletion
    -- of a real event are recorded. Inserts, and any other column, are not.
    if tg_op = 'INSERT' then
      return null;
    end if;
    v_org_id := (v_row ->> 'org_id')::uuid;
    if tg_op = 'DELETE' and coalesce((v_old ->> 'is_test')::boolean, false) then
      return null;
    end if;
  else
    -- Rehearsal events are skipped (their flag flips are logged via `events`).
    select e.org_id into v_org_id
      from public.events e where e.id = v_event_id and not e.is_test;
    if v_org_id is null then
      return null;
    end if;
  end if;

  -- "Did anything logged actually change?" is decided on the FULL values, before any
  -- truncation below, so an edit past the 500th character of a note is still a change.
  if tg_op = 'UPDATE'
     and not exists (select 1 from unnest(v_keys) as k where (v_old -> k) is distinct from (v_new -> k)) then
    return null;
  end if;

  -- Free-text values (time/position notes) are unbounded columns; the log stores at most
  -- 500 characters of any string value, suffixed with an ellipsis when cut. This bounds
  -- both log growth and the cost of anything that reads it (get_scoring_record compares
  -- deleted/inserted values, whose cost otherwise scales with bytes an organiser can write).
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v_old -> k) = 'string'
                                             and length(v_old ->> k) > 500
                                            then to_jsonb(left(v_old ->> k, 500) || '…')
                                            else v_old -> k end), '{}'::jsonb) into v_old_scope
    from unnest(v_keys) as k where v_old is not null;
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v_new -> k) = 'string'
                                             and length(v_new ->> k) > 500
                                            then to_jsonb(left(v_new ->> k, 500) || '…')
                                            else v_new -> k end), '{}'::jsonb) into v_new_scope
    from unnest(v_keys) as k where v_new is not null;

  -- btc_match_bonuses is keyed by match_id (its primary key), not a surrogate id.
  v_row_id := (v_row ->> case when tg_table_name = 'btc_match_bonuses' then 'match_id' else 'id' end)::uuid;

  insert into public.score_change_log
    (org_id, event_id, table_name, row_id, action, old_value, new_value, context,
     after_confirm, reason, changed_by)
  values (
    v_org_id, v_event_id, tg_table_name, v_row_id, lower(tg_op),
    case when v_old is null then null else v_old_scope end,
    case when v_new is null then null else v_new_scope end,
    (select coalesce(jsonb_object_agg(k, v_row -> k), '{}'::jsonb) from unnest(v_ctx_keys) as k),
    coalesce(v_confirmed, false),
    left(nullif(current_setting('app.change_reason', true), ''), 500),
    auth.uid()
  );
  if coalesce(v_confirmed, false) and tg_table_name <> 'events' then
    insert into public.score_change_counts (event_id, table_name, n)
    values (v_event_id, tg_table_name, 1)
    on conflict (event_id, table_name) do update set n = public.score_change_counts.n + 1;
  end if;
  return null;
end;
$$;

revoke execute on function app.log_score_change() from public, anon, authenticated;

-- Advancement, derived in one place. Called by confirm_btc_match and record_btc_tiebreak, both of
-- which hold the match row's lock (select ... for update) before calling it. A no-op for a match
-- that no bracket slot references (every preliminary match).
create or replace function app.advance_btc_bracket(p_match_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slot public.btc_bracket_slots;
  v_status text;
  v_team1 uuid;
  v_team2 uuid;
  v_team1_total int;
  v_team2_total int;
  v_tiebreak uuid;
  v_winner_id uuid;
  v_loser_id uuid;
  v_target uuid;
  v_downstream public.btc_bracket_slots;
begin
  select * into v_slot from public.btc_bracket_slots where match_id = p_match_id;
  if v_slot.id is null then
    return;
  end if;

  select status, team1_id, team2_id, tiebreak_winner_team_id
    into v_status, v_team1, v_team2, v_tiebreak
  from public.btc_matches where id = p_match_id;

  -- Only a confirmed match has a result to advance from. An unconfirmed one reads 0-0 in
  -- btc_match_scores, which would look like a tie and clear seats.
  if v_status is distinct from 'confirmed' then
    return;
  end if;

  select team1_total, team2_total into v_team1_total, v_team2_total
  from public.btc_match_scores where match_id = p_match_id;

  -- Unreachable today (btc_match_scores left-joins and coalesces, so every match has a row), but
  -- a tie clears seats, so the absence of a row must not be mistaken for one.
  if v_team1_total is null or v_team2_total is null then
    raise exception 'advance_btc_bracket: no score found for match %', p_match_id;
  end if;

  if v_team1_total <> v_team2_total then
    -- Orientation comes from the MATCH's own teams (the ids btc_match_scores and the podium use).
    -- They equal the slot's: the match is created from the slot and a seat cannot change once its
    -- match exists.
    v_winner_id := case when v_team1_total > v_team2_total then v_team1 else v_team2 end;
    v_loser_id := case when v_team1_total > v_team2_total then v_team2 else v_team1 end;
    -- A decisive result supersedes any earlier tie-break: it was a decision about a tie that no
    -- longer exists, and must not come back if the match is ever level again.
    if v_tiebreak is not null then
      update public.btc_matches
      set tiebreak_winner_team_id = null, tiebreak_reason = null
      where id = p_match_id;
    end if;
  elsif v_tiebreak is not null then
    -- Level on totals, and the organiser has recorded who goes through.
    v_winner_id := v_tiebreak;
    v_loser_id := case when v_tiebreak = v_team1 then v_team2 else v_team1 end;
  end if;
  -- else: level with no tie-break: both stay NULL, so every seat this match feeds is cleared
  -- (or the call is refused below if that seat's own match already exists).

  -- Locked (FOR UPDATE): a concurrent create_btc_bracket_match on one of these same downstream
  -- slots (20260922131000, itself locking the slot row it reads) serializes against this loop
  -- instead of racing it. v_target is computed once per row and reused for both the guard check and
  -- the write, so there is no second copy of the derivation to drift.
  for v_downstream in
    select * from public.btc_bracket_slots
    where feeder_slot_1 = v_slot.id or feeder_slot_2 = v_slot.id
    for update
  loop
    v_target := case when v_downstream.round = 'third_place' then v_loser_id else v_winner_id end;
    if v_downstream.match_id is not null and (
      (v_downstream.feeder_slot_1 = v_slot.id and v_downstream.team1_id is distinct from v_target) or
      (v_downstream.feeder_slot_2 = v_slot.id and v_downstream.team2_id is distinct from v_target)
    ) then
      -- The 'confirm_btc_match:' prefix is kept on purpose: 016 and 027 pin this text. The client keys
      -- on the hint, not the wording.
      raise exception 'confirm_btc_match: this match% % has already advanced to a match in progress — that downstream match must be removed before this result can change',
        case when v_target is null then ' is now tied, but its' else '''s' end,
        case when v_downstream.round = 'third_place' then 'loser' else 'winner' end
        using hint = 'bracket_advanced';
    end if;
    if v_downstream.feeder_slot_1 = v_slot.id then
      update public.btc_bracket_slots set team1_id = v_target
      where id = v_downstream.id and team1_id is distinct from v_target;
    else
      update public.btc_bracket_slots set team2_id = v_target
      where id = v_downstream.id and team2_id is distinct from v_target;
    end if;
  end loop;
end;
$$;

revoke execute on function app.advance_btc_bracket(uuid) from public, anon;
grant execute on function app.advance_btc_bracket(uuid) to authenticated;
grant execute on function app.advance_btc_bracket(uuid) to service_role;

-- confirm_btc_match: same signature and body as 20261009100000 up to the ledger insert; the
-- advancement block is now the shared helper.
create or replace function confirm_btc_match(
  p_operation_id uuid,
  p_org_id uuid,
  p_match_id uuid,
  p_expected_updated_at timestamptz,
  p_votes jsonb,
  p_fastest_team_id uuid,
  p_team1_signature boolean,
  p_team2_signature boolean,
  p_team1_time_note text,
  p_team2_time_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round text;
  v_updated_at timestamptz;
  v_cups int;
  v_judge_count int;
  v_vote_count int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
    raise exception 'confirm_btc_match: match not found';
  end if;

  select round, updated_at into v_round, v_updated_at
  from public.btc_matches where id = p_match_id
  for update;

  if v_round is null then
    raise exception 'confirm_btc_match: match not found';
  end if;

  -- Re-check the ledger now that the row is locked (see 20260922091000's own comment
  -- on this exact re-check for why it must happen after the lock, not just before it).
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  if v_updated_at is distinct from p_expected_updated_at then
    raise exception 'CONFLICT: match % has been modified since it was read', p_match_id
      using detail = json_build_object(
              'match_id', p_match_id,
              'current_updated_at', v_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  if v_round = 'preliminary' and (p_team1_signature or p_team2_signature) then
    raise exception 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round';
  end if;

  v_cups := app.btc_cups_for_round(v_round);

  -- Judges are on record for transparency, not tied to individual votes — but the
  -- match must still carry exactly 3 of them before it can be confirmed.
  select count(*) into v_judge_count
  from public.btc_match_judges where match_id = p_match_id;
  if v_judge_count <> 3 then
    raise exception 'confirm_btc_match: match must have exactly 3 judges (has %)', v_judge_count;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where (v->>'cup_number')::int < 1 or (v->>'cup_number')::int > v_cups
  ) then
    raise exception 'confirm_btc_match: cup numbers must be between 1 and % for a % match', v_cups, v_round;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where (v->>'team1_tokens')::int < 0 or (v->>'team1_tokens')::int > 3
  ) then
    raise exception 'confirm_btc_match: each cup''s tokens must be between 0 and 3';
  end if;

  delete from public.btc_cup_votes where match_id = p_match_id;

  insert into public.btc_cup_votes (match_id, cup_number, team1_tokens)
  select p_match_id,
         (v->>'cup_number')::smallint,
         (v->>'team1_tokens')::smallint
  from jsonb_array_elements(p_votes) v;

  -- Strict confirm, same shape as before: the unique (match_id, cup_number) constraint
  -- plus the cup-range check above make "count = cups" equivalent to "every cup 1..cups
  -- scored exactly once", so a short payload fails with the friendly message, not a
  -- raw constraint error.
  select count(*) into v_vote_count from public.btc_cup_votes where match_id = p_match_id;
  if v_vote_count <> v_cups then
    raise exception 'confirm_btc_match: % of % cups are missing a score', v_cups - v_vote_count, v_cups;
  end if;

  insert into public.btc_match_bonuses
    (match_id, fastest_team_id, team1_signature_beverage, team2_signature_beverage)
  values
    (p_match_id, p_fastest_team_id, coalesce(p_team1_signature, false), coalesce(p_team2_signature, false))
  on conflict (match_id) do update
    set fastest_team_id = excluded.fastest_team_id,
        team1_signature_beverage = excluded.team1_signature_beverage,
        team2_signature_beverage = excluded.team2_signature_beverage;

  update public.btc_matches
  set status = 'confirmed',
      team1_time_note = nullif(btrim(p_team1_time_note), ''),
      team2_time_note = nullif(btrim(p_team2_time_note), '')
  where id = p_match_id;

  insert into public.processed_operations (id, org_id, kind)
  values (p_operation_id, p_org_id, 'confirm_btc_match');

  perform app.advance_btc_bracket(p_match_id);
end;
$$;

revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from public;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to authenticated;
grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to service_role;

create or replace function record_btc_tiebreak(
  p_org_id uuid,
  p_match_id uuid,
  p_winner_team_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round text;
  v_status text;
  v_team1_id uuid;
  v_team2_id uuid;
  v_team1_total int;
  v_team2_total int;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
begin
  -- Same org check and not-found shape as confirm_btc_match: a caller who is not a member sees RLS
  -- hide the row below, so "not found" and "not yours" are indistinguishable.
  if p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
    raise exception 'record_btc_tiebreak: match not found' using hint = 'tiebreak_match_not_found';
  end if;

  select round, status, team1_id, team2_id into v_round, v_status, v_team1_id, v_team2_id
  from public.btc_matches where id = p_match_id
  for update;

  if v_round is null then
    raise exception 'record_btc_tiebreak: match not found' using hint = 'tiebreak_match_not_found';
  end if;

  if v_round = 'preliminary' then
    raise exception 'record_btc_tiebreak: a tie-break applies to knockout matches only';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'record_btc_tiebreak: the match must be confirmed first' using hint = 'tiebreak_unconfirmed';
  end if;

  select team1_total, team2_total into v_team1_total, v_team2_total
  from public.btc_match_scores where match_id = p_match_id;
  if v_team1_total is null or v_team2_total is null then
    raise exception 'record_btc_tiebreak: no score found for match %', p_match_id;
  end if;
  if v_team1_total <> v_team2_total then
    raise exception 'record_btc_tiebreak: this match is not tied' using hint = 'tiebreak_not_tied';
  end if;

  if p_winner_team_id is distinct from v_team1_id and p_winner_team_id is distinct from v_team2_id then
    raise exception 'record_btc_tiebreak: the winner must be one of the match''s two teams';
  end if;

  if v_reason is null then
    raise exception 'record_btc_tiebreak: a reason is required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'record_btc_tiebreak: the reason is too long (120 characters at most)';
  end if;

  -- Transaction-local, read by the score-change log trigger (its reason column).
  perform set_config('app.change_reason', v_reason, true);

  -- Skipped when nothing changes, so re-recording the same decision touches no row.
  update public.btc_matches
  set tiebreak_winner_team_id = p_winner_team_id,
      tiebreak_reason = v_reason
  where id = p_match_id
    and (tiebreak_winner_team_id is distinct from p_winner_team_id
         or tiebreak_reason is distinct from v_reason);

  -- Fills (or, if the winner changed, moves) every seat this match feeds; refused if the
  -- downstream match already exists with the other team in it.
  perform app.advance_btc_bracket(p_match_id);

  -- Do not leak this reason into whatever else runs later in the same transaction.
  perform set_config('app.change_reason', '', true);
end;
$$;

-- Explicit anon revoke, not just from public (see 20260922130000's own comment).
revoke execute on function record_btc_tiebreak(uuid, uuid, uuid, text) from public, anon;
grant execute on function record_btc_tiebreak(uuid, uuid, uuid, text) to authenticated;
grant execute on function record_btc_tiebreak(uuid, uuid, uuid, text) to service_role;
