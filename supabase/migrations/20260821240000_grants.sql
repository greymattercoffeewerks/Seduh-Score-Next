-- Seduh Score Next · Base grants
-- RLS policies only govern which ROWS are visible/writable once a role already
-- has the underlying SQL privilege on the table — a role needs the table/function
-- GRANT before RLS is even consulted. New tables/functions are not auto-exposed
-- by default (supabase/config.toml's [api] auto_expose_new_tables note), so this
-- migration is what actually lets `authenticated`/`anon` reach anything.
--
-- rollback:
--   revoke all on ct_standings from authenticated;
--   revoke all on live_sessions from anon, authenticated;
--   revoke all on ct_results from authenticated;
--   revoke all on ct_heat_entries from authenticated;
--   revoke all on ct_heats from authenticated;
--   revoke all on ct_stage_entries from authenticated;
--   revoke all on ct_sets from authenticated;
--   revoke all on ct_stages from authenticated;
--   revoke all on event_entries from authenticated;
--   revoke all on events from authenticated;
--   revoke all on person_merges from authenticated;
--   revoke all on people from authenticated;
--   revoke all on org_members from authenticated;
--   revoke all on orgs from authenticated;
--   revoke usage on schema app from authenticated, anon;

grant usage on schema app to authenticated, anon;

-- orgs/org_members: read-only to the app layer (no write policy exists — see
-- 20260821230000_rls_policies.sql's comment on why).
grant select on orgs to authenticated;
grant select on org_members to authenticated;

-- org-scoped read + write; RLS policies gate actual row access per org.
grant select, insert, update, delete on people to authenticated;
grant select, insert, update, delete on person_merges to authenticated;
grant select, insert, update, delete on events to authenticated;
grant select, insert, update, delete on event_entries to authenticated;
grant select, insert, update, delete on ct_stages to authenticated;
grant select, insert, update, delete on ct_sets to authenticated;
grant select, insert, update, delete on ct_stage_entries to authenticated;
grant select, insert, update, delete on ct_heats to authenticated;
grant select, insert, update, delete on ct_heat_entries to authenticated;
grant select, insert, update, delete on ct_results to authenticated;

-- live_sessions: open read for anon (audience surfaces have no login), full
-- access for authenticated (RLS still restricts writes to org members).
grant select on live_sessions to anon;
grant select, insert, update, delete on live_sessions to authenticated;

grant select on ct_standings to authenticated;
