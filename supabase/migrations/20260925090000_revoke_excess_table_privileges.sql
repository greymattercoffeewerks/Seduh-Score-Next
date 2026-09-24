-- Seduh Score Next · hardening: strip TRUNCATE / REFERENCES / TRIGGER / MAINTAIN from the API roles
--
-- Found 2026-09-25 (read-only review of the Supabase advisors): 19 of the 27 public tables let
-- `anon` and `authenticated` TRUNCATE them, add REFERENCES/TRIGGER, and (Postgres 17) MAINTAIN
-- them. Nothing in this app uses any of those privileges through the API, and two of them are
-- dangerous in principle:
--   * TRUNCATE is NOT subject to row-level security. A role holding it can empty a whole table
--     however tight the RLS policies are. PostgREST does not expose TRUNCATE, so this is not
--     reachable through the public API today — but "the API happens not to expose it" is not a
--     control, and a future change (a new RPC, a direct connection, a different gateway) would
--     make it one.
--   * TRIGGER lets a role attach triggers to a table; REFERENCES lets it create foreign keys
--     onto it; MAINTAIN lets it VACUUM/ANALYZE/REINDEX/CLUSTER/LOCK it.
-- The same excess was already stripped, by hand, from the newer tables (btc_* in
-- 20260918092000_btc_grants.sql, score_change_log / score_change_counts in
-- 20260924100000_score_change_log.sql). This migration does it for everything else, and —
-- the part a one-off revoke cannot do — changes the DEFAULT so tables created by later
-- migrations do not receive the privileges again.
--
-- Why the default matters: every table a migration creates (as `postgres`) is granted
-- anon/authenticated/service_role `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) by
-- Supabase's default privileges for schema public (`pg_default_acl`). Without the ALTER
-- DEFAULT PRIVILEGES below, the very next migration would quietly reopen this.
--
-- Deliberately NOT touched:
--   * The SELECT/INSERT/UPDATE/DELETE grants. Those are the real access model, granted per table
--     (20260821240000_grants.sql and later) and gated by RLS; nothing here narrows or widens them.
--   * `service_role`. It is the trusted server-side key (bypasses RLS by design); changing what
--     it may do is a separate decision.
--   * Default privileges belonging to other owners (supabase_admin, supabase_auth_admin): they
--     govern objects those roles create, not ours.
--
-- Environment-independence: like 20260918092000_btc_grants.sql, this revokes unconditionally
-- from whatever the starting state is, so a fresh CI/local database (whose defaults can be
-- broader than a long-lived one) and the cloud project converge on the same result.
-- MAINTAIN exists from Postgres 17; local and cloud are both 17.6.
--
-- rollback (restores what anon/authenticated held on these tables before — verified in a
-- transaction, including the default privileges; do NOT use a blanket
-- `grant ... on all tables`, which would also re-open the tables that were deliberately clean):
--   alter default privileges for role postgres in schema public
--     grant truncate, references, trigger, maintain on tables to anon, authenticated;
--   grant truncate, references, trigger, maintain on
--     contacts, ct_heat_entries, ct_heats, ct_results, ct_sets, ct_stage_entries, ct_stages,
--     event_entries, events, guesses, live_sessions, org_members, orgs, people, person_merges,
--     processed_operations, public_results, sessions
--     to anon, authenticated;
--   (ct_standings is a view; it held TRIGGER/REFERENCES/TRUNCATE for the same roles too:)
--   grant truncate, references, trigger on ct_standings to anon, authenticated;

revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated;

-- Future tables: stop the default from re-granting them. Scoped to the role that runs our
-- migrations (`postgres`) in schema public.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
