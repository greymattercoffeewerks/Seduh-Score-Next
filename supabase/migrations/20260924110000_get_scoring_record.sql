-- Seduh Score Next · T-TRUST.2a: public scoring record (corrections summary)
--
-- Backs the public "How this was scored" disclosure on the Results archive. Returns a
-- SHAPE-ONLY summary of what changed after a heat/match/stage was confirmed, computed
-- LIVE from score_change_log at read time — never a stored snapshot. That matters:
-- public_results is writable by any org member directly (its RLS policy is `for all`),
-- so anything stored inside a published payload could be omitted or edited by the
-- organiser. A function that reads the append-only log when asked cannot be.
--
-- Decisions (2026-09-24): corrections are public; the actor is shown by ROLE only
-- ("Organiser"), never a name or user id; NO raw scores appear — no old/new values, no
-- per-cupper or per-cup data. Exact raw data is released only through the organiser's
-- dispute pack (T-TRUST.2b).
--
-- Per correction: when, role label, area, a stage/heat/match label where resolvable,
-- how many RECORDS changed (a record is one logged row: one update to a result or time,
-- not one column), and the stated reason with how many of those records carried one.
-- The reason is organiser-typed, UNVERIFIED free text (capped at 500 chars by the log
-- trigger): it can contain anything, including a score or a name, so every consumer must
-- render it as plain text and label it "reason given". The console's future reason
-- prompt should tell the organiser not to include scores or names. Tie-break/coin-toss
-- provenance is exposed as a CATEGORY and count only — the organiser's free-text
-- position_note is deliberately NOT returned (it can name people).
--
-- Limits, stated so the UI copy can be honest:
--   * Edits made while a confirmed heat/match/stage is RE-OPENED are logged with
--     after_confirm = false and are not listed here; the re-open itself is (as a
--     "heat status" / "match details" / "stage settings" correction), so a viewer can
--     see that a re-open happened. The full record is in the dispute pack.
--   * Labels resolve for Cup Taster heats/stages and BTC matches/bracket slots. If the
--     parent has since been deleted the label is null; the correction is still counted.
--   * rehearsal_flag_changes counts every `events` row in the log, which today is exactly
--     the is_test flips (that is all the log trigger writes for events). If that trigger
--     ever logs another events column this count must be narrowed.
--   * The correction list is capped at 200 entries (correction_count still reports the
--     true total, and `truncated` says so); the cap bounds what an anonymous caller can
--     make the server compute and send.
--
-- Security shape: SECURITY DEFINER (anon has no access to score_change_log), so the
-- output contract is the whole protection: it is built only from the columns named
-- below, and returns null for any event that is not in public_results (an unpublished
-- event reveals nothing, and neither does an unknown id; whether an event is published
-- is already public via public_results' anon-read policy). Every reference is
-- schema-qualified under search_path = ''. Hard-codes the ct_*/btc_* tables: a new
-- format's tables need a new migration before they appear here.
--
-- Replace-all churn: confirm_btc_match deletes and reinserts every vote, so re-saving an
-- unchanged match logs delete+insert pairs. Per (transaction, table, context), if the
-- deleted values exactly equal the inserted values the whole group is dropped, so a plain
-- re-save is not reported as a correction. This uses window functions only, NOT a join and
-- NOT a per-row self-join: the first version was quadratic, and a join-based rewrite was
-- still planner-dependent (a stale row estimate right after a burst of inserts chose a
-- nested loop and timed out under anon's statement_timeout — which would have let an
-- organiser suppress the record by inflating the log).
--
-- rollback:
--   revoke execute on function get_scoring_record(uuid) from anon, authenticated, service_role;
--   drop function if exists get_scoring_record(uuid);

create or replace function get_scoring_record(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_corrections jsonb;
  v_total       int;
  v_placings    jsonb;
  v_flips       int;
  v_flips_after int;
  v_published   timestamptz;
begin
  select pr.published_at into v_published
    from public.public_results pr where pr.event_id = p_event_id;
  if v_published is null then
    return null;
  end if;

  with base as (
    select l.id, l.txid, l.table_name, l.action, l.old_value, l.new_value, l.context,
           l.row_id, l.changed_at, l.reason,
           case l.table_name
             when 'ct_heat_entries'   then 'times'
             when 'ct_results'        then 'results'
             when 'ct_heats'          then 'heat status'
             when 'ct_stages'         then 'stage settings'
             when 'ct_stage_entries'  then 'stage placings'
             when 'btc_cup_votes'     then 'votes'
             when 'btc_match_bonuses' then 'bonuses'
             when 'btc_matches'       then 'match details'
             when 'btc_bracket_slots' then 'bracket'
           end as area,
           -- Which heat / stage / match this row belongs to, where it can still be resolved.
           case l.table_name
             when 'ct_heat_entries' then (l.context ->> 'heat_id')::uuid
             when 'ct_heats'        then l.row_id
             when 'ct_results'      then (select he.heat_id from public.ct_heat_entries he
                                           where he.id = (l.context ->> 'heat_entry_id')::uuid)
           end as heat_id,
           case l.table_name
             when 'ct_stages'        then l.row_id
             when 'ct_stage_entries' then (l.context ->> 'stage_id')::uuid
           end as stage_id,
           case l.table_name
             when 'btc_cup_votes'     then (l.context ->> 'match_id')::uuid
             when 'btc_match_bonuses' then (l.context ->> 'match_id')::uuid
             when 'btc_matches'       then l.row_id
           end as match_id
      from public.score_change_log l
     where l.event_id = p_event_id
       and l.after_confirm
       and l.table_name <> 'events'
  ),
  -- Replace-all churn: a (txn, table, context) group whose deleted values equal its
  -- inserted values (as multisets) is a re-save, not a correction. Decided with WINDOW
  -- functions only — deliberately no join. An earlier join-based version was fast or
  -- catastrophically slow depending on the planner's row estimate, and estimates are stale
  -- right after a burst of inserts (exactly when an organiser could be inflating the log):
  -- rank each delete and each insert within its group by value, pair the r-th delete with
  -- the r-th insert, and cancel the group only if every pair matches and the counts agree.
  ranked_di as (
    select b.*,
           row_number() over (partition by b.txid, b.table_name, b.context, b.action
                              order by coalesce(b.old_value, b.new_value)::text, b.id) as rn
      from base b
     where b.action in ('delete', 'insert')
  ),
  paired as (
    select r.*,
           max(r.new_value::text) filter (where r.action = 'insert')
             over (partition by r.txid, r.table_name, r.context, r.rn) as ins_val,
           max(r.old_value::text) filter (where r.action = 'delete')
             over (partition by r.txid, r.table_name, r.context, r.rn) as del_val
      from ranked_di r
  ),
  judged as (
    select p.*,
           bool_and(coalesce(case p.action
                               when 'delete' then p.old_value::text = p.ins_val
                               else p.new_value::text = p.del_val end, false))
             over (partition by p.txid, p.table_name, p.context) as all_paired,
           count(*) filter (where p.action = 'delete')
             over (partition by p.txid, p.table_name, p.context) as n_del,
           count(*) filter (where p.action = 'insert')
             over (partition by p.txid, p.table_name, p.context) as n_ins
      from paired p
  ),
  kept as (
    select b.id, b.txid, b.table_name, b.action, b.old_value, b.new_value, b.context,
           b.row_id, b.changed_at, b.reason, b.area, b.heat_id, b.stage_id, b.match_id
      from base b
     where b.action = 'update'
    union all
    select j.id, j.txid, j.table_name, j.action, j.old_value, j.new_value, j.context,
           j.row_id, j.changed_at, j.reason, j.area, j.heat_id, j.stage_id, j.match_id
      from judged j
     where not (j.all_paired and j.n_del = j.n_ins)
  ),
  labelled as (
    select k.*,
           coalesce(
             (select initcap(s.kind) || ' · heat ' || h.heat_number
                from public.ct_heats h join public.ct_stages s on s.id = h.stage_id
               where h.id = k.heat_id),
             (select initcap(s.kind) from public.ct_stages s where s.id = k.stage_id),
             (select initcap(replace(m.round, '_', ' ')) || ' match'
                from public.btc_matches m where m.id = k.match_id),
             case when k.table_name = 'btc_bracket_slots'
                  then 'Bracket · ' || initcap(replace(k.context ->> 'round', '_', ' ')) end
           ) as label,
           -- what one correction is about: keeps corrections to different heats/matches
           -- inside one transaction as separate entries even when a label is null or shared
           coalesce(k.heat_id, k.stage_id, k.match_id,
                    case when k.table_name = 'btc_bracket_slots' then k.row_id end) as scope_id
      from kept k
  ),
  grouped as (
    select txid, area, label, scope_id,
           min(changed_at) as at,
           count(*)        as changes,
           (array_agg(reason order by changed_at, id) filter (where reason is not null))[1] as reason,
           count(reason)   as reasoned
      from labelled
     group by txid, area, label, scope_id
  ),
  ranked as (
    select g.*, row_number() over (order by g.at, g.area, g.label, g.txid) as rn,
           count(*) over () as total
      from grouped g
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'at', r.at, 'by', 'Organiser', 'area', r.area, 'label', r.label,
             'changes', r.changes, 'reason', r.reason, 'reasoned', r.reasoned)
           order by r.rn) filter (where r.rn <= 200), '[]'::jsonb),
         coalesce(max(r.total), 0)
    into v_corrections, v_total
    from ranked r;

  -- How a placing was decided, by category and count only. No free text, no entry ids.
  select coalesce(jsonb_agg(
           jsonb_build_object('stage', x.stage, 'decided_by', x.decided_by, 'count', x.n)
           order by x.ordinal, x.decided_by), '[]'::jsonb)
    into v_placings
    from (select initcap(s.kind) as stage, s.ordinal,
                 case se.source when 'coin_toss' then 'coin toss' else 'tiebreak' end as decided_by,
                 count(*) as n
            from public.ct_stage_entries se
            join public.ct_stages s on s.id = se.stage_id
           where s.event_id = p_event_id and se.source in ('coin_toss', 'tiebreak_won')
           group by s.kind, s.ordinal, se.source) x;

  -- Rehearsal-flag flips, split by whether they happened after publication (a flip after
  -- publishing is the suspicious one; a flip before is usually a legitimate promotion).
  select count(*), count(*) filter (where l.changed_at > v_published)
    into v_flips, v_flips_after
    from public.score_change_log l
   where l.event_id = p_event_id and l.table_name = 'events' and l.action = 'update';

  return jsonb_build_object(
    'corrections', v_corrections,
    'correction_count', v_total,
    'truncated', v_total > 200,
    'placings', v_placings,
    'rehearsal_flag_changes', v_flips,
    'rehearsal_flag_changes_after_publish', v_flips_after
  );
end;
$$;

revoke execute on function get_scoring_record(uuid) from public;
grant execute on function get_scoring_record(uuid) to anon, authenticated, service_role;
