-- Seduh Score Next · BTC void cup (committee rule, owner 2026-11-18)
--
-- The rule: a cup where BOTH teams failed to submit, or both submitted the wrong cup, scores 0 tokens for BOTH teams.
-- It applies per cup; the other cups of the match score as normal. Nothing else changes: token totals are still
-- counted per team, the most-tokens bonus (+5), the fastest bonus (+2) and the signature bonus (+2, knockout) are
-- decided as usual (a team can still send a cup that is later marked zero for a wrong spec), and a match that ends
-- level follows the existing rules (no win bonus in a preliminary; a recorded tie-break winner in a knockout).
--
-- Why an explicit flag. Until now every cup held exactly 3 tokens and team2's share was derived as 3 - team1_tokens, so
-- "0 and 0" cannot be said with team1_tokens alone. A void cup is STORED:
--
--   btc_cup_votes.voided  boolean not null default false
--   btc_cup_votes_void_holds_no_tokens  check (not voided or team1_tokens = 0)   (23514 otherwise)
--
-- team2's share becomes `case when voided then 0 else 3 - team1_tokens end` in every place it is derived (the views
-- below; confirm_btc_match writes only team1_tokens, so there is no other copy). Token totals and points stay derived:
-- nothing here stores a total.
--
-- What this migration replaces (each from its LATEST definition, never an original):
--   * btc_cup_totals (20260922120000)  dropped and recreated: team2's share, and a new trailing `voided` column.
--   * btc_match_totals, btc_match_scores (20260922100000; create or replace, same columns in the same order, two NEW
--     columns appended: cups_scored and cups_voided). The scores formula text is unchanged.
--   * btc_standings (20260922100000; create or replace, same columns). Its completeness test was "tokens = cups x 3",
--     which a void cup breaks (a 15-cup match with one void cup holds 42 tokens, not 45): it is now "every cup scored"
--     (cups_scored = cups for the round), the same meaning. Nothing else in the project reads that sum, except
--     src/formats/btc/cutData.js and matchList.js, changed in this same release to read cups_scored.
--   * confirm_btc_match (20261011140000's body; same signature, so grants and the revokes in force are untouched): each
--     entry of p_votes may carry "voided": true. A payload without the key (a draft or queued operation made before this
--     change) means false, so it still flushes. A voided entry with team1_tokens other than 0 is refused (a curated
--     message), and "each cup's tokens must be between 0 and 3" is unchanged. A void cup counts as scored for the
--     completeness check (the count is of cup rows, as before).
--   * app.log_score_change (20261108200000's body): ONE change, 'voided' joins the btc_cup_votes key list, so turning a
--     cup void (or back) after confirmation is a logged correction like any token edit. Everything else, including the
--     revoke, is unchanged.
-- Not touched: get_scoring_record (generic over log values), get_dispute_pack (exports whole rows with to_jsonb, so the
-- column appears), load_btc_demo (it writes team1_tokens only, voided defaults to false), the RLS policies and the
-- frozen-parent triggers on btc_cup_votes (no new column is a parent), btc_seeding_order and btc_prelim_times (they
-- read btc_standings and keep working on its unchanged columns).
--
-- No new table and no new function, so the cross-organisation matrices (040, 041) need no entry; confirm_btc_match is
-- already in 041 and keeps its org checks, its idempotency key, its row lock and its post-lock ledger re-check.
--
-- rollback (in this order; tested in supabase/tests/088_btc_void_cup.sql, which runs these statements):
--   1. Refuse while a void cup exists, because dropping the flag would silently turn 0-0 into 0-3:
--        do $$ begin
--          if exists (select 1 from public.btc_cup_votes where voided) then
--            raise exception 'btc void cup rollback: % void cup(s) are recorded; list them (select * from btc_cup_votes where voided) and score them again first',
--              (select count(*) from public.btc_cup_votes where voided);
--          end if;
--        end $$;
--   2. restore app.log_score_change() verbatim from 20261108200000_btc_prelim_round.sql (CREATE OR REPLACE) and re-run
--      its `revoke execute ... from public, anon, authenticated`;
--   3. restore confirm_btc_match verbatim from 20261011140000_tenancy_rpc_null_org_guard.sql (CREATE OR REPLACE; same
--      signature, so the grants stay);
--   4. create or replace view btc_standings: the 20260922100000 definition (tokens = cups x 3 completeness);
--   5. create or replace view btc_match_scores and btc_match_totals with the 20260922100000 definitions. CREATE OR REPLACE
--      cannot drop columns, so cups_scored and cups_voided stay on both views, inert and unread (a limit of
--      views, not of the data; the old behaviour is restored because the formula no longer reads voided);
--   6. drop view btc_cup_totals; recreate it as in 20260922120000 and re-grant select to authenticated;
--   7. alter table public.btc_cup_votes drop constraint btc_cup_votes_void_holds_no_tokens, drop column voided;
--   (the score_change_log rows that recorded a void stay.)

alter table public.btc_cup_votes
  add column voided boolean not null default false,
  add constraint btc_cup_votes_void_holds_no_tokens check (not voided or team1_tokens = 0);

-- ============ derived views ============

drop view if exists btc_cup_totals;

create view btc_cup_totals
  with (security_invoker = true) as
select
  cv.match_id,
  cv.cup_number,
  cv.team1_tokens,
  (case when cv.voided then 0 else 3 - cv.team1_tokens end) as team2_tokens,
  cv.voided
from btc_cup_votes cv
join btc_matches m on m.id = cv.match_id
where cv.cup_number <= app.btc_cups_for_round(m.round);

-- Dropping a view drops its grants.
revoke all on btc_cup_totals from anon, authenticated;
grant select on btc_cup_totals to authenticated;

create or replace view btc_match_totals
  with (security_invoker = true) as
select
  m.id as match_id,
  m.event_id,
  m.round,
  m.status,
  m.team1_id,
  m.team2_id,
  -- Only a cup inside the round counts (matches scoring.js's own filter, so the view and the JS preview cannot
  -- disagree about a stray direct-written row). A void cup has team1_tokens = 0 (the check) and gives team2 nothing.
  coalesce(
    sum(cv.team1_tokens) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)), 0
  ) as team1_tokens,
  coalesce(
    sum(case when cv.voided then 0 else 3 - cv.team1_tokens end)
      filter (where cv.cup_number <= app.btc_cups_for_round(m.round)), 0
  ) as team2_tokens,
  mb.fastest_team_id,
  coalesce(mb.team1_signature_beverage, false) as team1_signature_beverage,
  coalesce(mb.team2_signature_beverage, false) as team2_signature_beverage,
  -- How many cups of the round hold a score (void ones included), and how many of those are void.
  count(cv.cup_number) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)) as cups_scored,
  count(cv.cup_number) filter (where cv.voided and cv.cup_number <= app.btc_cups_for_round(m.round)) as cups_voided
from btc_matches m
left join btc_cup_votes cv on cv.match_id = m.id
left join btc_match_bonuses mb on mb.match_id = m.id
group by m.id, m.event_id, m.round, m.status, m.team1_id, m.team2_id,
         mb.fastest_team_id, mb.team1_signature_beverage, mb.team2_signature_beverage;

-- THE scoring formula, unchanged: tokens, plus 5 to the team with strictly more tokens, plus 2 for the fastest team,
-- plus 2 for a signature beverage but only outside the preliminary round. A void cup only changes the tokens.
create or replace view btc_match_scores
  with (security_invoker = true) as
select
  t.match_id,
  t.event_id,
  t.round,
  t.status,
  t.team1_id,
  t.team2_id,
  t.team1_tokens,
  t.team2_tokens,
  t.team1_tokens
    + case when t.team1_tokens > t.team2_tokens then 5 else 0 end
    + case when t.fastest_team_id = t.team1_id then 2 else 0 end
    + case when t.round <> 'preliminary' and t.team1_signature_beverage then 2 else 0 end
    as team1_total,
  t.team2_tokens
    + case when t.team2_tokens > t.team1_tokens then 5 else 0 end
    + case when t.fastest_team_id = t.team2_id then 2 else 0 end
    + case when t.round <> 'preliminary' and t.team2_signature_beverage then 2 else 0 end
    as team2_total,
  t.cups_scored,
  t.cups_voided
from btc_match_totals t;

-- Preliminary leaderboard: a confirmed match counts only once every cup of the round is scored. That was "tokens =
-- cups x 3" while every cup held 3; with a void cup it is the count of cups itself.
create or replace view btc_standings
  with (security_invoker = true) as
with per_team as (
  select event_id, team1_id as team_id, team1_total as points,
         (team1_tokens > team2_tokens) as won
  from btc_match_scores
  where round = 'preliminary' and status = 'confirmed'
    and cups_scored = app.btc_cups_for_round(round)
  union all
  select event_id, team2_id as team_id, team2_total as points,
         (team2_tokens > team1_tokens) as won
  from btc_match_scores
  where round = 'preliminary' and status = 'confirmed'
    and cups_scored = app.btc_cups_for_round(round)
)
select
  event_id,
  team_id,
  count(*) as played,
  sum(case when won then 1 else 0 end)::int as wins,
  sum(points)::int as total_points
from per_team
group by event_id, team_id;

-- ============ the change log records the flag ============

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
      v_keys := array['team1_tokens', 'voided'];
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

-- ============ confirm_btc_match: a void flag per cup ============
-- Same signature, so the grants (authenticated, service_role) and the anon/public revokes already in force stay. The
-- body is 20261011140000's, with the void flag added to the token check and the insert.
create or replace function public.confirm_btc_match(p_operation_id uuid, p_org_id uuid, p_match_id uuid, p_expected_updated_at timestamp with time zone, p_votes jsonb, p_fastest_team_id uuid, p_team1_signature boolean, p_team2_signature boolean, p_team1_time_note text, p_team2_time_note text)
 returns void
 language plpgsql
 set search_path to ''
as $function$
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

  if p_org_id is null or p_org_id is distinct from app.org_id_for_btc_match(p_match_id) then
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

  -- A void cup gives both teams nothing: it must not also carry team1 tokens. An entry without the key (a draft or a
  -- queued operation from before this change) is not void.
  if exists (
    select 1 from jsonb_array_elements(p_votes) v
    where coalesce((v->>'voided')::boolean, false) and (v->>'team1_tokens')::int <> 0
  ) then
    raise exception 'confirm_btc_match: a void cup cannot hold tokens';
  end if;

  delete from public.btc_cup_votes where match_id = p_match_id;

  insert into public.btc_cup_votes (match_id, cup_number, team1_tokens, voided)
  select p_match_id,
         (v->>'cup_number')::smallint,
         (v->>'team1_tokens')::smallint,
         coalesce((v->>'voided')::boolean, false)
  from jsonb_array_elements(p_votes) v;

  -- Strict confirm, same shape as before: the unique (match_id, cup_number) constraint
  -- plus the cup-range check above make "count = cups" equivalent to "every cup 1..cups
  -- scored exactly once", so a short payload fails with the friendly message, not a
  -- raw constraint error. A void cup is a scored cup.
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
$function$;
