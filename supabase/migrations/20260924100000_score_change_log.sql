-- Seduh Score Next · T-TRUST.1: append-only score-change log
--
-- Why: the landing page raises the dispute problem ("a result gets questioned and
-- there's nothing to point to") but the platform kept no history — an edit
-- overwrote the row (confirm_heat upserts `correct`; confirm_btc_match deletes and
-- reinserts every vote), and no table records WHO edited (only created_at/
-- updated_at). This migration adds the missing trail.
--
-- Mechanism: AFTER row triggers, not per-RPC logging. The RLS write policies on
-- these tables are `for all` for any org member, so a direct table write bypasses
-- every RPC; only a trigger sees every write path.
--
-- What is logged (scored inputs, and the state that decides how they count):
--   ct_heat_entries     elapsed_secs, elapsed_secs_raw, maxed, time_source, time_note
--   ct_results          correct
--   ct_heats            kind, status         (a re-open of a confirmed heat is a change)
--   ct_stages           kind, ordinal, status, set_count, cutoff   (re-opening a complete stage is a change)
--   ct_stage_entries    source, final_position, position_note   (tiebreak/coin-toss provenance)
--   btc_cup_votes       team1_tokens         (team2's share is 3 - team1)
--   btc_match_bonuses   fastest_team_id, team1_signature_beverage, team2_signature_beverage
--   btc_matches         round, team1_id, team2_id, status, team1_time_note, team2_time_note
--   btc_bracket_slots   team1_id, team2_id, match_id   (advancement outcomes)
--   events              is_test              (see "is_test" below); DELETE of a real event
--
-- NOT logged, deliberately: derived values (standings, tallies, totals — those stay
-- views, handoff §5.2), display/registry data (people, entries' names), which judges
-- are assigned to a match (btc_match_judges), and timestamps/metadata.
--
-- Only real value changes are logged: an UPDATE that changes none of the logged
-- columns writes nothing. confirm_btc_match replaces ALL votes (delete + reinsert),
-- so re-saving an unchanged match logs a delete and an insert per cup with
-- after_confirm = true. That churn is not a changed score: every row carries `txid`,
-- so a reader (T-TRUST.2) can collapse delete+insert pairs of an identical value
-- within one transaction.
--
-- is_test (D9): rehearsal events are NOT logged, so rehearsal noise cannot pollute
-- real audit history. That skip would otherwise be a bypass (flip is_test, edit
-- scores, flip back), so every change to events.is_test IS logged, on any event,
-- and so is deleting a real (non-test) event. History is not retroactively
-- backfilled when a rehearsal event is later promoted to real.
--
-- Cascades: a row whose parent chain no longer resolves (it is being deleted along
-- with its event/stage/heat) is skipped rather than attributed to nothing. The
-- deletion itself is still recorded, at the level that was deleted: ct_stages,
-- ct_heats, btc_matches and events all log their own DELETE. The log has NO foreign
-- keys to logged rows, so deleting an event never deletes or blocks on its history.
--
-- Bounded values: any string value in old_value/new_value is cut to 500 characters (plus
-- an ellipsis). The full value of a long note is still what the live row holds and what the
-- change detection compares; the log keeps a bounded copy so it cannot be used to bloat the
-- database or to make readers slow. (Scored numbers/booleans/ids are never affected.)
--
-- reason: read from the transaction-local setting `app.change_reason` (null when
-- unset, truncated to 500 chars). It is UNVERIFIED, caller-supplied context — any
-- session can set it — not audit-grade until an RPC sets it server-side. No RPC does
-- yet. `after_confirm` flags changes made after the heat/match/stage was already
-- confirmed/complete, so an un-reasoned correction shows as after_confirm = true
-- with a null reason. Enforcing a reason needs a console prompt: a later step.
--
-- Tamper-evidence, not tamper-proofing: no role has an update/delete/insert
-- privilege or policy, and a trigger rejects UPDATE/DELETE/TRUNCATE statements even
-- from the table owner. A superuser or owner can still disable the triggers; the
-- claim is that ordinary operation, including every app role, cannot rewrite history.
--
-- Moving a row between parents would dodge the log: re-parent a stage onto a rehearsal
-- event, edit its scores (skipped as is_test), move it back. Likewise re-pointing a
-- result at another set, an entry at another cupper, a vote at another cup, or
-- rewriting any primary key. Rather than log every such column, parent and identity
-- columns (and `id` on every logged table) are immutable via a BEFORE UPDATE trigger
-- at the bottom; nothing in the app changes them, and BTC already does the same for
-- teams/judges.
--
-- Deleting a parent (heat/stage/match/event) cascades its scored children. The
-- children's own DELETE rows are skipped (their parent is already gone), but nothing
-- is lost: every child was logged on insert and on every change, so its full history
-- and last value are already in the log; the parent's DELETE row records that the
-- deletion happened, and by whom. (Rows that pre-date this migration have no history
-- before it — the log starts when it is applied.)
--
-- rollback:
--   drop trigger if exists trg_events_org_immutable on events;
--   drop trigger if exists trg_btc_bracket_slots_parent_immutable on btc_bracket_slots;
--   drop trigger if exists trg_btc_match_bonuses_parent_immutable on btc_match_bonuses;
--   drop trigger if exists trg_btc_cup_votes_parent_immutable on btc_cup_votes;
--   drop trigger if exists trg_btc_matches_parent_immutable on btc_matches;
--   drop trigger if exists trg_ct_stage_entries_parent_immutable on ct_stage_entries;
--   drop trigger if exists trg_ct_results_parent_immutable on ct_results;
--   drop trigger if exists trg_ct_heat_entries_parent_immutable on ct_heat_entries;
--   drop trigger if exists trg_ct_heats_parent_immutable on ct_heats;
--   drop trigger if exists trg_ct_stages_parent_immutable on ct_stages;
--   drop function if exists app.forbid_parent_change();
--   drop trigger if exists trg_events_log on events;
--   drop trigger if exists trg_btc_bracket_slots_log on btc_bracket_slots;
--   drop trigger if exists trg_btc_matches_log on btc_matches;
--   drop trigger if exists trg_btc_match_bonuses_log on btc_match_bonuses;
--   drop trigger if exists trg_btc_cup_votes_log on btc_cup_votes;
--   drop trigger if exists trg_ct_stage_entries_log on ct_stage_entries;
--   drop trigger if exists trg_ct_stages_log on ct_stages;
--   drop trigger if exists trg_ct_heats_log on ct_heats;
--   drop trigger if exists trg_ct_results_log on ct_results;
--   drop trigger if exists trg_ct_heat_entries_log on ct_heat_entries;
--   drop function if exists app.log_score_change();
--   drop table if exists score_change_log;
--   drop function if exists app.forbid_score_change_log_mutation();

create table score_change_log (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  event_id       uuid not null,
  table_name     text not null,
  row_id         uuid not null,
  action         text not null,
  old_value      jsonb,
  new_value      jsonb,
  context        jsonb not null default '{}'::jsonb,
  after_confirm  boolean not null default false,
  reason         text,
  changed_by     uuid,          -- auth.uid(); null for service-role/SQL writes
  changed_at     timestamptz not null default now(),
  txid           bigint not null default txid_current(),
  constraint score_change_log_action_valid check (action in ('insert', 'update', 'delete')),
  constraint score_change_log_table_valid check (
    table_name in (
      'ct_heat_entries', 'ct_results', 'ct_heats', 'ct_stages', 'ct_stage_entries',
      'btc_cup_votes', 'btc_match_bonuses', 'btc_matches', 'btc_bracket_slots', 'events'
    )
  )
);
alter table score_change_log enable row level security;
create index on score_change_log (org_id, changed_at);
create index on score_change_log (event_id, changed_at);
create index on score_change_log (row_id, changed_at);

-- Read: org members, own org only. No insert/update/delete policy for any role —
-- writes happen only through the security-definer trigger function below.
create policy score_change_log_read on score_change_log
  for select
  using (app.is_org_member(org_id));

-- Supabase's default privileges hand every API role broad grants on new tables
-- (TRUNCATE, REFERENCES, TRIGGER, and service_role's write access). Strip them all;
-- only SELECT for signed-in users is intended. The trigger function (owner) is the
-- one and only writer.
revoke all on score_change_log from public, anon, authenticated, service_role;
grant select on score_change_log to authenticated;

create or replace function app.forbid_score_change_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'score_change_log is append-only' using errcode = '42501';
end;
$$;

create trigger trg_score_change_log_no_update_delete
  before update or delete on score_change_log
  for each row execute function app.forbid_score_change_log_mutation();
create trigger trg_score_change_log_no_truncate
  before truncate on score_change_log
  for each statement execute function app.forbid_score_change_log_mutation();

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
      v_keys := array['round', 'team1_id', 'team2_id', 'status', 'team1_time_note', 'team2_time_note'];
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
  return null;
end;
$$;

revoke execute on function app.log_score_change() from public, anon, authenticated;

create trigger trg_ct_heat_entries_log
  after insert or update or delete on ct_heat_entries
  for each row execute function app.log_score_change();
create trigger trg_ct_results_log
  after insert or update or delete on ct_results
  for each row execute function app.log_score_change();
create trigger trg_ct_heats_log
  after insert or update or delete on ct_heats
  for each row execute function app.log_score_change();
create trigger trg_ct_stages_log
  after insert or update or delete on ct_stages
  for each row execute function app.log_score_change();
create trigger trg_ct_stage_entries_log
  after insert or update or delete on ct_stage_entries
  for each row execute function app.log_score_change();
create trigger trg_btc_cup_votes_log
  after insert or update or delete on btc_cup_votes
  for each row execute function app.log_score_change();
create trigger trg_btc_match_bonuses_log
  after insert or update or delete on btc_match_bonuses
  for each row execute function app.log_score_change();
create trigger trg_btc_matches_log
  after insert or update or delete on btc_matches
  for each row execute function app.log_score_change();
create trigger trg_btc_bracket_slots_log
  after insert or update or delete on btc_bracket_slots
  for each row execute function app.log_score_change();
-- events: only an is_test flip or a real event's deletion writes a row (see above);
-- restricting the trigger keeps every other events update off this function's path.
create trigger trg_events_log
  after update of is_test or delete on events
  for each row execute function app.log_score_change();

-- Parent AND identity columns are immutable, so neither the is_test / org lookups above
-- nor the logged history can be dodged by re-parenting a row, or by re-pointing it at a
-- different cupper / set / cup / slot (which would silently re-attribute a score), or by
-- rewriting a primary key (which would orphan a row's history under its old row_id).
-- TG_ARGV lists the immutable columns.
create or replace function app.forbid_parent_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if to_jsonb(new) -> v_col is distinct from to_jsonb(old) -> v_col then
      raise exception '%.% is immutable', tg_table_name, v_col using errcode = '23001';
    end if;
  end loop;
  return new;
end;
$$;

create trigger trg_ct_stages_parent_immutable
  before update of id, event_id on ct_stages
  for each row execute function app.forbid_parent_change('id', 'event_id');
create trigger trg_ct_heats_parent_immutable
  before update of id, stage_id, heat_number on ct_heats
  for each row execute function app.forbid_parent_change('id', 'stage_id', 'heat_number');
create trigger trg_ct_heat_entries_parent_immutable
  before update of id, heat_id, entry_id on ct_heat_entries
  for each row execute function app.forbid_parent_change('id', 'heat_id', 'entry_id');
create trigger trg_ct_results_parent_immutable
  before update of id, heat_entry_id, set_id on ct_results
  for each row execute function app.forbid_parent_change('id', 'heat_entry_id', 'set_id');
create trigger trg_ct_stage_entries_parent_immutable
  before update of id, stage_id, entry_id on ct_stage_entries
  for each row execute function app.forbid_parent_change('id', 'stage_id', 'entry_id');
create trigger trg_btc_matches_parent_immutable
  before update of id, event_id on btc_matches
  for each row execute function app.forbid_parent_change('id', 'event_id');
create trigger trg_btc_cup_votes_parent_immutable
  before update of id, match_id, cup_number on btc_cup_votes
  for each row execute function app.forbid_parent_change('id', 'match_id', 'cup_number');
create trigger trg_btc_match_bonuses_parent_immutable
  before update of match_id on btc_match_bonuses
  for each row execute function app.forbid_parent_change('match_id');
create trigger trg_btc_bracket_slots_parent_immutable
  before update of id, event_id, round, slot_label on btc_bracket_slots
  for each row execute function app.forbid_parent_change('id', 'event_id', 'round', 'slot_label');
create trigger trg_events_org_immutable
  before update of id, org_id on events
  for each row execute function app.forbid_parent_change('id', 'org_id');
