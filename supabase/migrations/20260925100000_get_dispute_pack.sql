-- Seduh Score Next · T-TRUST.2b: get_dispute_pack — the organiser-only exact record of an event
--
-- Why: the public "How this was scored" disclosure (get_scoring_record) is deliberately
-- shape-only — it never shows a score. It tells a reader that exact scores "can be requested from
-- the organiser". This is what the organiser then hands over: every recorded score for one event
-- plus the full change log with old and new values, for settling a dispute.
--
-- Decisions (2026-09-24/25): exact raw data is released ONLY through this pack, on request, by the
-- organiser; the public page never shows it. Names are competitors' display names as entered for the
-- event; NO contact details (people.phone/email are not included). The actor of a logged change is
-- the user id (`changed_by`) — the organiser can map it to a person; it is not published anywhere.
--
-- Why one database function, not several client queries: this is a document meant to settle a
-- dispute, so it must be one CONSISTENT snapshot (a single statement reads every table at the same
-- instant, so the pack cannot straddle a change), not several reads at slightly different moments;
-- and it avoids client paging (PostgREST caps a response at 1,000 rows) and the URL-length limit on
-- long `id in (...)` lists.
--
-- Security shape: SECURITY INVOKER (the repo's write-RPC posture; see publish_event_results). Every
-- read goes through the CALLER's own row-level security, so an org member sees exactly their own
-- org's rows and nothing else; the explicit guard below additionally refuses a wrong org_id or a
-- non-member with one unified "not found" error (never distinguishing "no such event" from "not
-- yours"). Not executable by anon. search_path is pinned to empty; every reference is qualified.
--
-- NOTE: the event and entries are exported as WHOLE rows (to_jsonb(row)), so any column added to
-- events or event_entries later would ride into every pack automatically. supabase/tests/
-- 021_get_dispute_pack.sql asserts the exact column lists, so adding one fails a test and forces a
-- decision (is it fit to hand to a dispute party?) instead of leaking silently.
--
-- Covers BOTH formats' tables: a Cup Taster event simply has empty btc_* arrays and vice versa, so
-- the BTC screens need only a button, not another function.
--
-- The change log is capped at the oldest 20,000 rows (`change_log_truncated` says so, and
-- `change_log_total` is the true count): the pack is an organiser's own export, so a hard bound
-- protects the database from a pathological log without hiding the fact that it was cut.
--
-- Limits stated IN the pack itself (`about`), so a recipient reads them with the data:
--   * the log starts on 2026-09-24; events scored earlier have no history;
--   * rehearsal (test) events are not logged (their rehearsal-flag flips are);
--   * a stated `reason` is the organiser's own unverified text;
--   * an exported test event carries an unmistakable warning (D9).
--
-- rollback:
--   revoke execute on function get_dispute_pack(uuid, uuid) from authenticated, service_role;
--   drop function if exists get_dispute_pack(uuid, uuid);

-- STABLE is load-bearing: a stable function runs every statement in its body on the CALLER's
-- single query snapshot, which is what makes the pack one consistent snapshot. Do not change
-- it to VOLATILE without re-deriving that claim.
create or replace function get_dispute_pack(p_org_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_event     jsonb;
  v_is_test   boolean;
  v_log       jsonb;
  v_log_total bigint;
  v_comp      jsonb;
  v_btc       jsonb;
begin
  if p_org_id is distinct from app.org_id_for_event(p_event_id)
     or not app.is_org_member(p_org_id) then
    raise exception 'get_dispute_pack: event % not found', p_event_id;
  end if;

  select to_jsonb(e), e.is_test into v_event, v_is_test
    from public.events e where e.id = p_event_id;
  if v_event is null then
    raise exception 'get_dispute_pack: event % not found', p_event_id;
  end if;

  v_comp := jsonb_build_object(
    'entries', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                  from public.event_entries x where x.event_id = p_event_id),
    'stages', (select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinal, x.id), '[]'::jsonb)
                 from public.ct_stages x where x.event_id = p_event_id),
    'sets', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.position, x.id), '[]'::jsonb)
               from public.ct_sets x join public.ct_stages s on s.id = x.stage_id
              where s.event_id = p_event_id),
    'stage_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.created_at, x.id), '[]'::jsonb)
                        from public.ct_stage_entries x join public.ct_stages s on s.id = x.stage_id
                       where s.event_id = p_event_id),
    'heats', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, x.heat_number, x.kind, x.id), '[]'::jsonb)
                from public.ct_heats x join public.ct_stages s on s.id = x.stage_id
               where s.event_id = p_event_id),
    'heat_entries', (select coalesce(jsonb_agg(to_jsonb(x) order by s.ordinal, h.heat_number, h.kind, x.station, x.id), '[]'::jsonb)
                       from public.ct_heat_entries x
                       join public.ct_heats h on h.id = x.heat_id
                       join public.ct_stages s on s.id = h.stage_id
                      where s.event_id = p_event_id),
    'results', (select coalesce(jsonb_agg(to_jsonb(r) order by s.ordinal, h.heat_number, h.kind, he.station, st.position, r.id), '[]'::jsonb)
                  from public.ct_results r
                  join public.ct_heat_entries he on he.id = r.heat_entry_id
                  join public.ct_heats h on h.id = he.heat_id
                  join public.ct_stages s on s.id = h.stage_id
                  join public.ct_sets st on st.id = r.set_id
                 where s.event_id = p_event_id)
  );

  v_btc := jsonb_build_object(
    'teams', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                from public.btc_teams x where x.event_id = p_event_id),
    'judges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                 from public.btc_judges x where x.event_id = p_event_id),
    'matches', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb)
                  from public.btc_matches x where x.event_id = p_event_id),
    'match_judges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id, x.judge_id), '[]'::jsonb)
                       from public.btc_match_judges x join public.btc_matches m on m.id = x.match_id
                      where m.event_id = p_event_id),
    'cup_votes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id, x.cup_number, x.id), '[]'::jsonb)
                    from public.btc_cup_votes x join public.btc_matches m on m.id = x.match_id
                   where m.event_id = p_event_id),
    'match_bonuses', (select coalesce(jsonb_agg(to_jsonb(x) order by x.match_id), '[]'::jsonb)
                        from public.btc_match_bonuses x join public.btc_matches m on m.id = x.match_id
                       where m.event_id = p_event_id),
    'bracket_slots', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.slot_label, x.id), '[]'::jsonb)
                        from public.btc_bracket_slots x where x.event_id = p_event_id)
  );

  select count(*) into v_log_total from public.score_change_log l where l.event_id = p_event_id;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.changed_at, l.id), '[]'::jsonb) into v_log
    from (select * from public.score_change_log where event_id = p_event_id
           order by changed_at, id limit 20000) l;

  return jsonb_build_object(
    'pack_version', 1,
    'generated_at', now(),
    'is_test', v_is_test,
    'warning', case when v_is_test then 'TEST DATA — NOT A LIVE EVENT' end,
    'confidentiality',
      'Contains competitors'' names, cafes and bib numbers and every recorded score. Share it only with the people involved in the dispute.',
    'about', jsonb_build_array(
      'Every table below is read in one consistent snapshot at generated_at.',
      'change_log lists every logged change to a score, time, heat or stage state, or placing (Cup Taster), and to a match, cup vote, bonus or bracket slot (BTC), with old and new values, oldest first. It starts on 2026-09-24: an event scored before then has no history.',
      'NOT logged: edits to competitors'' names, cafes or bib numbers, withdrawals, and which judges are assigned to a BTC match. The current values of those are in the tables below.',
      'Any text value in old_value or new_value (for example a time note) is cut to its first 500 characters followed by an ellipsis. The full current text is in the tables below.',
      'Rehearsal (test) events are not logged, but every change to an event''s rehearsal flag is. An event that was rehearsal and later became real has no history from before that change.',
      'If change_log_truncated is true, only the oldest 20,000 log rows are included; change_log_total is the true count.',
      'A stated reason is the organiser''s own text and is not verified. changed_by is a user id; a null changed_by means a change made without a signed-in user (for example directly in the database).',
      'A change is after_confirm = true when it was made after the heat, match or stage was confirmed or completed.'
    ),
    'event', v_event,
    'cup_taster', v_comp,
    'btc', v_btc,
    'change_log', v_log,
    'change_log_total', v_log_total,
    'change_log_truncated', v_log_total > 20000,
    'counts', jsonb_build_object(
      'entries', jsonb_array_length(v_comp -> 'entries'),
      'stages', jsonb_array_length(v_comp -> 'stages'),
      'sets', jsonb_array_length(v_comp -> 'sets'),
      'stage_entries', jsonb_array_length(v_comp -> 'stage_entries'),
      'heats', jsonb_array_length(v_comp -> 'heats'),
      'heat_entries', jsonb_array_length(v_comp -> 'heat_entries'),
      'results', jsonb_array_length(v_comp -> 'results'),
      'btc_teams', jsonb_array_length(v_btc -> 'teams'),
      'btc_judges', jsonb_array_length(v_btc -> 'judges'),
      'btc_matches', jsonb_array_length(v_btc -> 'matches'),
      'btc_match_judges', jsonb_array_length(v_btc -> 'match_judges'),
      'btc_cup_votes', jsonb_array_length(v_btc -> 'cup_votes'),
      'btc_match_bonuses', jsonb_array_length(v_btc -> 'match_bonuses'),
      'btc_bracket_slots', jsonb_array_length(v_btc -> 'bracket_slots'),
      'change_log_rows_in_pack', jsonb_array_length(v_log)
    )
  );
end;
$$;

revoke execute on function get_dispute_pack(uuid, uuid) from public;
grant execute on function get_dispute_pack(uuid, uuid) to authenticated, service_role;
