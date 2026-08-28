-- Seduh Score Next · closes a known ROADMAP.md gap: no DB-level
-- unique(heat_id, station) constraint on ct_heat_entries
-- Handoff: SEDUH-NEXT-HANDOFF.md §14 T4.2.
--
-- rollback:
--   alter table ct_heat_entries drop constraint if exists ct_heat_entries_heat_station_unique;
--   alter table ct_heat_entries alter column station drop not null;

-- Station-uniqueness-per-heat was application-layer only:
-- buildHeatPlansFromAssignments (heats.js) rejects two cuppers sharing a
-- station within ONE caller's own plan, but nothing stopped two genuinely
-- concurrent requests from each independently passing that check and then
-- both writing the same (heat_id, station) pair — scoring-auditor flagged
-- this as low-risk at the time (T4.2 is an organiser-driven setup screen,
-- not the live-heat timing surface; a real collision needs a genuinely
-- concurrent write to trigger), noted in ROADMAP.md rather than fixed.
--
-- station is never null on a row this app actually writes —
-- buildHeatPlansFromAssignments throws before ct_heat_entries is ever
-- touched if any assignment is missing one — but a plain UNIQUE constraint
-- alone does NOT close the gap: Postgres treats every NULL as distinct from
-- every other NULL under UNIQUE, so unique(heat_id, station) places zero
-- constraint on rows where station IS NULL (verified empirically — two such
-- rows insert with no error). The NOT NULL below is what actually makes the
-- invariant "no two cuppers share a station in a heat" hold at the DB level
-- for every row, not just the ones the app happens to populate correctly —
-- schema-guardian caught this in review.
--
-- Named explicitly, not left to Postgres's own auto-generated name — heats.js's
-- ensureHeatEntries needs to tell this violation apart from the existing
-- unique(heat_id, entry_id) constraint's own violation (a normal, safe-to-retry
-- concurrent-insert race) to give a correctly-scoped error instead of
-- retrying a collision that can never succeed no matter how many times it's
-- attempted.
alter table ct_heat_entries
  alter column station set not null;

alter table ct_heat_entries
  add constraint ct_heat_entries_heat_station_unique unique (heat_id, station);
