-- T-TRUST.1 guard: every column of every score-logged table must be consciously
-- classified as
--   logged     — a change writes a score_change_log row (app.log_score_change v_keys)
--   immutable  — a change is rejected (app.forbid_parent_change trigger args)
--   metadata   — deliberately neither: timestamps, display data, config that does not
--                decide a score, ranking, attribution or advancement
-- If this file fails, someone added a column to a logged table (or changed a trigger)
-- without deciding which bucket it belongs in. That decision is the point: a new scoring
-- column that is silently neither logged nor locked is exactly how an edit slips past
-- the trail. Fix by classifying it below AND making the migration match; never by adding
-- it to `metadata` just to make this pass unless it truly cannot affect a result.
begin;
select plan(22);

create temp table _buckets (table_name text, column_name text, bucket text,
                            primary key (table_name, column_name));
insert into _buckets values
  -- ct_heat_entries
  ('ct_heat_entries', 'id', 'immutable'), ('ct_heat_entries', 'heat_id', 'immutable'),
  ('ct_heat_entries', 'entry_id', 'immutable'),
  ('ct_heat_entries', 'elapsed_secs', 'logged'), ('ct_heat_entries', 'elapsed_secs_raw', 'logged'),
  ('ct_heat_entries', 'maxed', 'logged'), ('ct_heat_entries', 'time_source', 'logged'),
  ('ct_heat_entries', 'time_note', 'logged'),
  ('ct_heat_entries', 'station', 'metadata'), ('ct_heat_entries', 'time_edited_at', 'metadata'),
  ('ct_heat_entries', 'created_at', 'metadata'),
  -- ct_results
  ('ct_results', 'id', 'immutable'), ('ct_results', 'heat_entry_id', 'immutable'),
  ('ct_results', 'set_id', 'immutable'),
  ('ct_results', 'correct', 'logged'),
  ('ct_results', 'created_at', 'metadata'),
  -- ct_heats (timing inputs only matter through elapsed_secs, which is logged)
  ('ct_heats', 'id', 'immutable'), ('ct_heats', 'stage_id', 'immutable'),
  ('ct_heats', 'heat_number', 'immutable'),
  ('ct_heats', 'kind', 'logged'), ('ct_heats', 'status', 'logged'),
  ('ct_heats', 'timing_mode', 'metadata'), ('ct_heats', 'duration_secs', 'metadata'),
  ('ct_heats', 'started_at', 'metadata'), ('ct_heats', 'master_elapsed_secs', 'metadata'),
  ('ct_heats', 'published_at', 'metadata'), ('ct_heats', 'created_at', 'metadata'),
  ('ct_heats', 'updated_at', 'metadata'),
  -- ct_stages
  ('ct_stages', 'id', 'immutable'), ('ct_stages', 'event_id', 'immutable'),
  ('ct_stages', 'kind', 'logged'), ('ct_stages', 'ordinal', 'logged'),
  ('ct_stages', 'status', 'logged'), ('ct_stages', 'set_count', 'logged'),
  ('ct_stages', 'cutoff', 'logged'),
  ('ct_stages', 'duration_secs', 'metadata'), ('ct_stages', 'created_at', 'metadata'),
  ('ct_stages', 'updated_at', 'metadata'),
  -- ct_stage_entries
  ('ct_stage_entries', 'id', 'immutable'), ('ct_stage_entries', 'stage_id', 'immutable'),
  ('ct_stage_entries', 'entry_id', 'immutable'),
  ('ct_stage_entries', 'source', 'logged'), ('ct_stage_entries', 'final_position', 'logged'),
  ('ct_stage_entries', 'position_note', 'logged'),
  ('ct_stage_entries', 'created_at', 'metadata'),
  -- btc_cup_votes
  ('btc_cup_votes', 'id', 'immutable'), ('btc_cup_votes', 'match_id', 'immutable'),
  ('btc_cup_votes', 'cup_number', 'immutable'),
  ('btc_cup_votes', 'team1_tokens', 'logged'),
  ('btc_cup_votes', 'created_at', 'metadata'),
  -- btc_match_bonuses (keyed by match_id)
  ('btc_match_bonuses', 'match_id', 'immutable'),
  ('btc_match_bonuses', 'fastest_team_id', 'logged'),
  ('btc_match_bonuses', 'team1_signature_beverage', 'logged'),
  ('btc_match_bonuses', 'team2_signature_beverage', 'logged'),
  ('btc_match_bonuses', 'updated_at', 'metadata'),
  -- btc_matches
  ('btc_matches', 'id', 'immutable'), ('btc_matches', 'event_id', 'immutable'),
  ('btc_matches', 'round', 'logged'), ('btc_matches', 'team1_id', 'logged'),
  ('btc_matches', 'team2_id', 'logged'), ('btc_matches', 'status', 'logged'),
  ('btc_matches', 'team1_time_note', 'logged'), ('btc_matches', 'team2_time_note', 'logged'),
  ('btc_matches', 'created_at', 'metadata'), ('btc_matches', 'updated_at', 'metadata'),
  -- btc_bracket_slots (seeds/feeders are static, written once at bracket generation)
  ('btc_bracket_slots', 'id', 'immutable'), ('btc_bracket_slots', 'event_id', 'immutable'),
  ('btc_bracket_slots', 'round', 'immutable'), ('btc_bracket_slots', 'slot_label', 'immutable'),
  ('btc_bracket_slots', 'team1_id', 'logged'), ('btc_bracket_slots', 'team2_id', 'logged'),
  ('btc_bracket_slots', 'match_id', 'logged'),
  ('btc_bracket_slots', 'seed_1', 'metadata'), ('btc_bracket_slots', 'seed_2', 'metadata'),
  ('btc_bracket_slots', 'feeder_slot_1', 'metadata'), ('btc_bracket_slots', 'feeder_slot_2', 'metadata'),
  ('btc_bracket_slots', 'created_at', 'metadata'), ('btc_bracket_slots', 'updated_at', 'metadata'),
  -- events (only the is_test flag and org ownership matter to the trail)
  ('events', 'id', 'immutable'), ('events', 'org_id', 'immutable'),
  ('events', 'is_test', 'logged'),
  ('events', 'format', 'metadata'), ('events', 'name', 'metadata'),
  ('events', 'event_date', 'metadata'), ('events', 'venue', 'metadata'),
  ('events', 'status', 'metadata'), ('events', 'config', 'metadata'),
  ('events', 'created_at', 'metadata'), ('events', 'updated_at', 'metadata'),
  ('events', 'city', 'metadata');

-- 1. every real column is classified
select is(
  (select coalesce(array_agg(c.table_name || '.' || c.column_name order by c.table_name, c.column_name), '{}'::text[])
     from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in (select distinct table_name from _buckets)
      and not exists (select 1 from _buckets b
                       where b.table_name = c.table_name and b.column_name = c.column_name)),
  '{}'::text[],
  'no column on a logged table is unclassified (a new column must be logged, locked, or consciously marked metadata)');

-- 2. no stale classification for a column that no longer exists
select is(
  (select coalesce(array_agg(b.table_name || '.' || b.column_name order by b.table_name, b.column_name), '{}'::text[])
     from _buckets b
    where not exists (select 1 from information_schema.columns c
                       where c.table_schema = 'public' and c.table_name = b.table_name
                         and c.column_name = b.column_name)),
  '{}'::text[],
  'no classification refers to a column that no longer exists');

-- 3. the `logged` bucket matches the keys app.log_score_change() really watches
select is(
  (select coalesce(array_agg(k order by k), '{}'::text[])
     from unnest(regexp_split_to_array(
            regexp_replace(
              (regexp_match(pg_get_functiondef('app.log_score_change'::regproc),
                            'when ''' || t.table_name || ''' then\s+v_keys := array\[([^\]]*)\]'))[1],
              '[''\s]', '', 'g'), ',')) as k),
  (select coalesce(array_agg(b.column_name order by b.column_name), '{}'::text[])
     from _buckets b where b.table_name = t.table_name and b.bucket = 'logged'),
  t.table_name || ': the columns the log trigger watches are exactly the `logged` bucket')
from (select distinct table_name from _buckets order by 1) t;

-- 4. the `immutable` bucket matches the columns the immutability trigger really guards
select is(
  (select coalesce(array_agg(k order by k), '{}'::text[])
     from unnest(regexp_split_to_array(
            regexp_replace(
              (regexp_match(pg_get_triggerdef(g.oid), 'forbid_parent_change\((.*)\)'))[1],
              '[''\s]', '', 'g'), ',')) as k),
  (select coalesce(array_agg(b.column_name order by b.column_name), '{}'::text[])
     from _buckets b where b.table_name = t.table_name and b.bucket = 'immutable'),
  t.table_name || ': the columns the immutability trigger guards are exactly the `immutable` bucket')
from (select distinct table_name from _buckets order by 1) t
join pg_trigger g on g.tgrelid = ('public.' || t.table_name)::regclass
                 and g.tgfoid = 'app.forbid_parent_change'::regproc
order by t.table_name;

select * from finish();
rollback;
