-- Seduh Score Next · revoke PUBLIC execute on the six write RPCs, grant service_role
-- Handoff: SEDUH-NEXT-HANDOFF.md §9 (offline model — these are the RPCs the
-- outbox flushes through).
--
-- rollback:
--   revoke execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) from service_role;
--   revoke execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) from service_role;
--   revoke execute on function start_heat(uuid, uuid, uuid, timestamptz) from service_role;
--   revoke execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) from service_role;
--   revoke execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) from service_role;
--   revoke execute on function merge_people(uuid, uuid, uuid) from service_role;
--   grant execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) to public;
--   grant execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) to public;
--   grant execute on function start_heat(uuid, uuid, uuid, timestamptz) to public;
--   grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) to public;
--   grant execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) to public;
--   grant execute on function merge_people(uuid, uuid, uuid) to public;
--
-- Found by `security-reviewer` while reviewing 20260830130000_rpc_search_path_pin.sql:
-- Postgres grants EXECUTE on a new function to PUBLIC by default unless
-- explicitly revoked (unlike table DML privileges, which default to nothing
-- for PUBLIC). None of these six functions' own original migrations
-- (20260822090000, 20260822100000, 20260827200000, 20260828150000) ever
-- issued that revoke — each only ever added `grant execute ... to
-- authenticated`, on top of the PUBLIC default neither statement touches.
-- `anon` inherits PUBLIC, so `anon` has had EXECUTE on all six the whole
-- time, silently contradicting every one of these functions' own module
-- comment ("grant execute on function ... to authenticated" reads as the
-- WHOLE access story, but never was).
--
-- Confirmed NOT currently exploitable, live, before this migration was
-- written: `set role anon;` then calling each of the six hits a real
-- Postgres error — `permission denied for table people` / `ct_heats` /
-- `processed_operations` / etc. — before RLS is even reached, since `anon`
-- has no table-level GRANT on any of the tables these functions touch
-- (20260821240000_grants.sql only ever gives `anon` `select` on
-- `live_sessions`/`ct_standings`). This migration closes the gap as
-- defense-in-depth, matching the "authenticated only" intent every one of
-- these six functions' own comment already states, not because there's a
-- live hole today.
--
-- Revoking from PUBLIC does not touch the existing explicit `grant execute
-- ... to authenticated` from each function's own original migration — that
-- grant stands on its own, independent of the PUBLIC default. `authenticated`
-- callers are unaffected; only `anon` (which has no OTHER route to EXECUTE on
-- these six) loses access.
--
-- `service_role` ALSO loses EXECUTE here, by the exact same mechanism `anon`
-- did — found by `security-reviewer`'s own re-check of this migration before
-- it shipped, live-verified: `service_role` is a standalone role, not a
-- member of `authenticated`/`anon`, and it is NOT a Postgres superuser in
-- this project (`rolsuper = false`) — only `rolbypassrls = true`.
-- BYPASSRLS bypasses row-level security POLICY evaluation only; it has no
-- effect on GRANT-based privilege checks (table DML, or function EXECUTE),
-- which is standard, correct Postgres behavior, not a bug — but it
-- contradicts the common assumption that `service_role` is "superuser,
-- bypasses everything." Nothing in this codebase currently calls any of
-- these six RPCs as service_role (org/organiser provisioning goes directly
-- against `orgs`/`org_members`, not through these functions — see
-- core/config.js's/loginScreen.js's own comments), so this is dormant, not
-- an active break — but a very plausible thing for a future server-side
-- admin/support script to reach for, and it would otherwise fail with an
-- opaque "permission denied for function" with no clue why. Granting
-- explicitly here, symmetric with `authenticated`, restores the
-- intent-matching default (service_role can always call these, same as any
-- organiser, since it exists specifically for privileged operations outside
-- the app) without reopening anything for `anon`.
revoke execute on function merge_people(uuid, uuid, uuid) from public;
revoke execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) from public;
revoke execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) from public;
revoke execute on function start_heat(uuid, uuid, uuid, timestamptz) from public;
revoke execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) from public;
revoke execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) from public;

grant execute on function merge_people(uuid, uuid, uuid) to service_role;
grant execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) to service_role;
grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb) to service_role;
grant execute on function start_heat(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) to service_role;
grant execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) to service_role;
