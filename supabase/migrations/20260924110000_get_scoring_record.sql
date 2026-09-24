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
-- dispute pack (T-TRUST.2b). Returned per correction: when, role label, area, a
-- stage/heat label where resolvable, how many values changed, and the stated reason
-- (caller-supplied and UNVERIFIED — label it "reason given" wherever it is shown).
--
-- Security shape: SECURITY DEFINER (anon has no access to score_change_log), so the
-- output contract is the whole protection: it is built only from the columns named
-- below, and returns null for any event that is not in public_results (an unpublished
-- event reveals nothing, and neither does an unknown id). Every reference is
-- schema-qualified under search_path = ''.
--
-- Replace-all churn: confirm_btc_match deletes and reinserts every vote, so re-saving an
-- unchanged match logs delete+insert pairs. A delete whose same-transaction insert
-- restores the identical value (and vice versa) is dropped, so a plain re-save is not
-- reported as a correction.
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
  v_placings    jsonb;
  v_flips       int;
begin
  if not exists (select 1 from public.public_results where event_id = p_event_id) then
    return null;
  end if;

  with base as (
    select l.id, l.txid, l.table_name, l.action, l.old_value, l.new_value, l.context,
           l.changed_at, l.reason,
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
           -- Which heat a Cup Taster row belongs to, where it can still be resolved.
           case l.table_name
             when 'ct_heat_entries' then (l.context ->> 'heat_id')::uuid
             when 'ct_heats'        then l.row_id
             when 'ct_results'      then (select he.heat_id from public.ct_heat_entries he
                                           where he.id = (l.context ->> 'heat_entry_id')::uuid)
           end as heat_id,
           case l.table_name
             when 'ct_stages'        then l.row_id
             when 'ct_stage_entries' then (l.context ->> 'stage_id')::uuid
           end as stage_id_direct
      from public.score_change_log l
     where l.event_id = p_event_id
       and l.after_confirm
       and l.table_name <> 'events'
  ),
  kept as (
    select b.* from base b
     where not exists (
       select 1 from base o
        where o.txid = b.txid and o.table_name = b.table_name
          and o.context = b.context and o.id <> b.id
          and ((b.action = 'delete' and o.action = 'insert' and o.new_value = b.old_value)
            or (b.action = 'insert' and o.action = 'delete' and o.old_value = b.new_value))
     )
  ),
  labelled as (
    select r.*,
           coalesce(
             (select initcap(s.kind) || case when h.id is not null then ' · heat ' || h.heat_number end
                from public.ct_heats h join public.ct_stages s on s.id = h.stage_id
               where h.id = r.heat_id),
             (select initcap(s.kind) from public.ct_stages s where s.id = r.stage_id_direct)
           ) as label
      from kept r
  ),
  grouped as (
    select txid, area, label,
           min(changed_at) as at,
           count(*)        as changes,
           max(reason)     as reason
      from labelled
     group by txid, area, label
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'at', g.at, 'by', 'Organiser', 'area', g.area, 'label', g.label,
             'changes', g.changes, 'reason', g.reason)
           order by g.at, g.area), '[]'::jsonb)
    into v_corrections
    from grouped g;

  -- Tie-break / coin-toss provenance: stage, how the placing was decided, and the
  -- organiser's note. No entry ids, no cupper names.
  select coalesce(jsonb_agg(
           jsonb_build_object('stage', initcap(s.kind), 'source', se.source, 'note', se.position_note)
           order by s.ordinal, se.source), '[]'::jsonb)
    into v_placings
    from public.ct_stage_entries se
    join public.ct_stages s on s.id = se.stage_id
   where s.event_id = p_event_id and se.position_note is not null;

  -- Times the rehearsal (is_test) flag was changed: flips are logged precisely so the
  -- rehearsal skip cannot hide an edit window.
  select count(*) into v_flips
    from public.score_change_log l
   where l.event_id = p_event_id and l.table_name = 'events' and l.action = 'update';

  return jsonb_build_object(
    'corrections', v_corrections,
    'correction_count', jsonb_array_length(v_corrections),
    'placing_notes', v_placings,
    'rehearsal_flag_changes', v_flips
  );
end;
$$;

revoke execute on function get_scoring_record(uuid) from public;
grant execute on function get_scoring_record(uuid) to anon, authenticated, service_role;
