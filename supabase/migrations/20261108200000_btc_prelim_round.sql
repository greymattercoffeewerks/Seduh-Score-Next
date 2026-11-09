-- Seduh Score Next · Build A: a preliminary round number on btc_matches (docs/specs/BTC-MARCH-2027-ENGINE-SPEC-DRAFT.md, section 3)
--
-- Why: the real competition plays TWO preliminary rounds. Today both would be round = 'preliminary' and nothing tells
-- them apart. Build B (the draw, create_btc_round) needs to say "round 1" and "round 2". This adds the number only: no
-- draw, no RPC, no change to create_btc_match's signature.
--
--   btc_matches.prelim_round  smallint, nullable. NULL means "not numbered": every existing preliminary match (demo and
--                             test events included) keeps working and reads as round 1 in the UI. No upper bound, so a
--                             committee that later wants three rounds needs no migration.
--   btc_matches_prelim_round_valid  prelim_round is null or (round = 'preliminary' and prelim_round >= 1). A knockout
--                             match cannot carry a number, and 0 or a negative is refused (23514).
--   partial index on (event_id, prelim_round) where round = 'preliminary': Build B reads "the matches of round n of
--                             this event".
--
-- btc_standings is unchanged: it sums every confirmed preliminary match, so two rounds add up on their own.
--
-- Score log (decided in this task, not in the spec): btc_matches is a score-logged table and the column-coverage guard
-- (018) fails until every column is classified. Moving a match between round 1 and round 2 changes which round its
-- points belong to and, once Build C reads times per round, which time counts, so prelim_round is LOGGED, like `round`.
-- app.log_score_change is replaced (create or replace, from its latest definition in 20261009110000_btc_knockout_tiebreak.sql)
-- with ONE change: 'prelim_round' joins the btc_matches key list. Everything else, including the revoke, is unchanged. The
-- trigger bindings are untouched. A row insert logs the new column too (a NULL is logged as JSON null).
--
-- What already holds, so nothing else is added: RLS (the btc_matches policies cover every column), the frozen event_id
-- parent, the table-level insert/update grant to authenticated. No new table and no new function, so the cross-
-- organisation matrices (040, 041) need no entry. get_dispute_pack exports whole btc_matches rows (to_jsonb), so the
-- column appears there (organiser-only); get_scoring_record shows log values generically and needs no change.
--
-- rollback:
--   (in this order)
--   restore app.log_score_change() verbatim from 20261009110000_btc_knockout_tiebreak.sql (CREATE OR REPLACE; its trigger
--     bindings are unchanged) and re-run its `revoke execute ... from public, anon, authenticated`;
--   drop index if exists public.btc_matches_event_prelim_round_idx;
--   alter table public.btc_matches drop constraint if exists btc_matches_prelim_round_valid;
--   alter table public.btc_matches drop column if exists prelim_round;
--   (a number already recorded is lost with the column; the score_change_log rows that recorded it stay.)

alter table public.btc_matches
  add column prelim_round smallint null,
  add constraint btc_matches_prelim_round_valid
    check (prelim_round is null or (round = 'preliminary' and prelim_round >= 1));

create index btc_matches_event_prelim_round_idx
  on public.btc_matches (event_id, prelim_round)
  where round = 'preliminary';

-- The change log now also records prelim_round (only btc_matches' key list differs from 20261009110000's body).
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
      v_keys := array['round', 'prelim_round', 'team1_id', 'team2_id', 'status', 'team1_time_note', 'team2_time_note',
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
