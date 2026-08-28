-- T1.2 Cup Taster tables — handoff §5.2, §14 T1.2 AC.
-- Proves: `correct` is nowhere stored as a column except the one atomic per-set
-- fact on ct_results (never a tally/count column anywhere else — that's always
-- derived, via ct_standings), a negative elapsed_secs is rejected, and (T4.2
-- follow-up, migration 20260829100000) two cuppers in the same heat can't
-- both claim the same station — a gap ROADMAP.md tracked as application-layer
-- only until now.
begin;
select plan(9);

-- ============ correct is nowhere a stored tally column ============

-- Every ct_* BASE TABLE's columns (views excluded — ct_standings legitimately
-- exposes a derived correct_count, that's the point), scanned for anything that
-- looks like a persisted tally instead of the one atomic fact (ct_results.correct).
select is(
  (
    select count(*)::int
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.table_name like 'ct_%'
      and t.table_type = 'BASE TABLE'
      and c.column_name ~* '(correct_count|total_correct|tally|correct$)'
      and not (c.table_name = 'ct_results' and c.column_name = 'correct')
  ),
  0,
  'no ct_* base table stores a correct tally/count column other than
   ct_results.correct (the one atomic per-set-per-cupper fact)'
);

select has_column(
  'ct_results', 'correct', 'ct_results.correct exists as the atomic per-set fact'
);

select col_type_is(
  'ct_results', 'correct', 'boolean', 'ct_results.correct is boolean, not an integer count'
);

-- ============ ct_standings derives the tally, nothing stores it ============

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
   'cup_taster', 'Test Event');
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1',
   'Cupper One');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
   'prelims', 1, 3, 480);
insert into ct_sets (id, stage_id, position) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 2),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1', 3);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 1, 480);
insert into ct_heat_entries (id, heat_id, entry_id, elapsed_secs) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a1', 240);
insert into ct_results (heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', true),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c2', false),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c3', true);

select is(
  (select correct_count from ct_standings
     where entry_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'ct_standings derives correct_count (2 of 3) from raw ct_results rows, live'
);

-- ============ ct_standings excludes tiebreak heats (§7.2, §7.3) ============

-- Cupper One also runs a tiebreak heat in the same stage — 1 more correct set,
-- 60 more elapsed seconds. If ct_standings summed across all heat kinds, its
-- correct_count/total_elapsed_secs for entry a1 would become 3/300 instead of
-- staying 2/240 — silently blending a sequential tie-breaker into the primary
-- comparison §7.3 says it must never be summed into.
insert into ct_heats (id, stage_id, heat_number, kind, duration_secs) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1',
   1, 'tiebreak', 480);
insert into ct_heat_entries (id, heat_id, entry_id, elapsed_secs) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2',
   '00000000-0000-0000-0000-0000000000a1', 60);
insert into ct_results (heat_entry_id, set_id, correct) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', true);

select is(
  (select correct_count from ct_standings
     where entry_id = '00000000-0000-0000-0000-0000000000a1'),
  2::bigint,
  'ct_standings.correct_count stays 2 after a tiebreak heat runs — the tiebreak
   set never blends into the primary-stage tally'
);

-- ============ negative elapsed_secs rejected ============

insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1',
   'Cupper Two');

select throws_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, elapsed_secs) values
       ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000a2', -1) $$,
  '23514',
  null,
  'a negative elapsed_secs is rejected by the ct_heat_entries_elapsed_nonneg check'
);

-- ============ station uniqueness is enforced at the DB level, not just the
-- application layer (heats.js's buildHeatPlansFromAssignments) ============
-- a1 already occupies station 'A' in heat d1 (inserted implicitly above via
-- the module's own default — set explicitly here to make the collision
-- target unambiguous).

update ct_heat_entries set station = 'A'
  where id = '00000000-0000-0000-0000-0000000000f1';

select throws_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, station) values
       ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000a2', 'A') $$,
  '23505',
  null,
  'a second cupper claiming an already-taken station in the same heat is
   rejected by ct_heat_entries_heat_station_unique, not just the application
   layer'
);

select lives_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, station) values
       ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000a2', 'B') $$,
  'a genuinely different station in the same heat is unaffected'
);

select lives_ok(
  $$ insert into ct_heat_entries (heat_id, entry_id, station) values
       ('00000000-0000-0000-0000-0000000000d2',
        '00000000-0000-0000-0000-0000000000a2', 'A') $$,
  'the SAME station label in a DIFFERENT heat is unaffected — uniqueness is
   scoped per heat, not global'
);

select * from finish();
rollback;
