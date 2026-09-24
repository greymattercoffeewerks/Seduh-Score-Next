-- Seduh Score Next · T-TRUST.1: append-only score-change log
--
-- Why: the landing page raises the dispute problem ("a result gets questioned and
-- there's nothing to point to") but the platform kept no history — an edit
-- overwrote the row (confirm_heat upserts `correct`; confirm_btc_match deletes and
-- reinserts every vote), and no table records WHO edited (only created_at/
-- updated_at). This migration adds the missing trail.
--
-- Mechanism: AFTER row triggers on the five scored tables, not per-RPC logging.
-- The RLS write policies on these tables are `for all` for any org member, so a
-- direct table write bypasses every RPC; only a trigger sees every write path.
--
--   ct_heat_entries      elapsed_secs, elapsed_secs_raw, maxed, time_source, time_note
--   ct_results           correct
--   btc_cup_votes        team1_tokens (one row per cup; team2's share is 3 - team1)
--   btc_match_bonuses    fastest_team_id, team1_signature_beverage, team2_signature_beverage
--   btc_matches          team1_id, team2_id, status, team1_time_note, team2_time_note
--
-- Only real value changes are logged: an UPDATE that changes none of the scored
-- columns writes nothing. A replace-all write (btc delete+reinsert of votes) still
-- logs each delete and insert — the diff is what shows a vote actually changed.
--
-- Deliberate scope decisions (2026-09-24):
--   * is_test events are NOT logged (rehearsal noise must not pollute real audit
--     history — D9's spirit).
--   * Rows whose parent chain no longer resolves (cascade delete, e.g.
--     delete_test_event) are skipped, and the log has NO foreign keys to scored
--     rows, so deleting an event never deletes or blocks on its history.
--   * `reason` is read from the transaction-local setting `app.change_reason`
--     (null when unset). No RPC passes it yet; `after_confirm` flags changes made
--     after the heat/match was already confirmed, so an un-reasoned correction is
--     visible as after_confirm = true and reason is null. Enforcing a reason needs
--     a console prompt and is a later step.
--   * Insert-only: no update/delete policy exists for any role, and a trigger
--     rejects UPDATE/DELETE/TRUNCATE even for the table owner.
--
-- rollback:
--   drop trigger if exists trg_btc_matches_log on btc_matches;
--   drop trigger if exists trg_btc_match_bonuses_log on btc_match_bonuses;
--   drop trigger if exists trg_btc_cup_votes_log on btc_cup_votes;
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
  constraint score_change_log_action_valid check (action in ('insert', 'update', 'delete')),
  constraint score_change_log_table_valid check (
    table_name in ('ct_heat_entries', 'ct_results', 'btc_cup_votes', 'btc_match_bonuses', 'btc_matches')
  )
);
alter table score_change_log enable row level security;
create index on score_change_log (event_id, changed_at);
create index on score_change_log (row_id, changed_at);

-- Read: org members, own org only. No insert/update/delete policy for any role —
-- writes happen only through the security-definer trigger function below.
create policy score_change_log_read on score_change_log
  for select
  using (app.is_org_member(org_id));

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
  v_confirmed boolean;
  v_is_test   boolean;
  v_org_id    uuid;
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
      v_keys := array['team1_id', 'team2_id', 'status', 'team1_time_note', 'team2_time_note'];
      v_ctx_keys := array['event_id', 'round'];
      v_event_id := (v_row ->> 'event_id')::uuid;
      -- The state the match was in BEFORE this change: a re-open of a confirmed
      -- match is itself an after-confirm change.
      v_confirmed := coalesce(v_old ->> 'status', v_row ->> 'status') = 'confirmed';
  end case;

  -- Parent chain gone (cascade delete) or event missing: nothing to attribute to.
  if v_event_id is null then
    return null;
  end if;

  select e.org_id, e.is_test into v_org_id, v_is_test
    from public.events e where e.id = v_event_id;
  if v_org_id is null or v_is_test then
    return null;
  end if;

  select coalesce(jsonb_object_agg(k, v_old -> k), '{}'::jsonb) into v_old_scope
    from unnest(v_keys) as k where v_old is not null;
  select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb) into v_new_scope
    from unnest(v_keys) as k where v_new is not null;

  if tg_op = 'UPDATE' and v_old_scope = v_new_scope then
    return null;
  end if;

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
    nullif(current_setting('app.change_reason', true), ''),
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
create trigger trg_btc_cup_votes_log
  after insert or update or delete on btc_cup_votes
  for each row execute function app.log_score_change();
create trigger trg_btc_match_bonuses_log
  after insert or update or delete on btc_match_bonuses
  for each row execute function app.log_score_change();
create trigger trg_btc_matches_log
  after insert or update or delete on btc_matches
  for each row execute function app.log_score_change();
