-- Seduh Score Next · anon-safe read on events (id/org_id/name/event_date/is_test/created_at only)
-- Handoff: SEDUH-NEXT-HANDOFF.md §8.4, §14 T5.2/T5.3 (viewer-shell.js's own
-- event-existence check) — closes a gap the new splash screen (core/splashScreen.js)
-- surfaced live-testing.
--
-- rollback:
--   drop policy if exists events_read_public on events;
--   revoke select (id, org_id, name, event_date, is_test, created_at) on events from anon;

-- `events` has only ever been granted to `authenticated`
-- (20260821240000_grants.sql), with RLS scoped to real org membership
-- (`events_read`, 20260821230000_rls_policies.sql: `using
-- (app.is_org_member(org_id))`). That's correct for every organiser
-- surface, but two PUBLIC, unauthenticated surfaces already read this table
-- too — `core/viewer-shell.js`'s own "does this org have an event yet"
-- check (its `noEvent` vs `notStarted` holding-state distinction, §8.4) and
-- the new splash screen — both via `core/events.js`'s
-- `findLatestEventForOrg`. Confirmed live against the local stack:
-- `permission denied for table events` for a genuine anon caller. This has
-- silently degraded viewer-shell.js's own check since it shipped (a real
-- anon viewer always fell back to the generic 'noEvent' card even when an
-- event actually existed) — never caught before because every manual/e2e
-- check of that surface happened to run in an already-authenticated
-- browser tab, not a genuinely anonymous one.
--
-- Fixed narrowly, not by granting full-row access: a Postgres COLUMN-level
-- grant limits anon to exactly the six fields `findLatestEventForOrg`
-- itself now explicitly selects (narrowed from `select('*')` to this same
-- list, in the same change) — never `venue`, `status`, `config` ("config
-- ONLY, never results" per its own table comment, but still
-- organiser-authored and not meant for public eyes), `format`, or
-- `updated_at`. `created_at` is included only because ORDER BY requires
-- SELECT on the sorted column, not because any caller reads it. A bare
-- `select('*')` from anon still hits permission-denied by design; only an
-- explicit column list matching the grant succeeds.
--
-- The new RLS policy is intentionally `using (true)` — unlike the existing
-- `events_read`, it does not scope by org. This app is single-org today
-- (ROADMAP.md: "no org/membership management UI... provisioning the single
-- org happens via service_role"), so an anon caller enumerating every
-- org's event id/name/date/is_test is not a live information-disclosure
-- concern yet, but IS a real one to revisit before any self-serve
-- multi-org onboarding ships — flagged here, not silently assumed away.
-- RLS policies of the same command type are OR'd together (Postgres
-- permissive-by-default): this new policy and the existing org-scoped
-- `events_read` coexist without conflict — an authenticated org member
-- still only ever satisfies (and needs) the existing one.
grant select (id, org_id, name, event_date, is_test, created_at) on events to anon;

create policy events_read_public on events
  for select
  to anon
  using (true);
