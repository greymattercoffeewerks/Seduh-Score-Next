-- Seduh Score Next · revoke EXECUTE from anon explicitly on every write RPC
--
-- Found chasing a CI-only pgTAP failure ("anon cannot execute confirm_btc_match")
-- that did not reproduce locally under the pinned dev CLI (supabase@2.115.0) but did
-- reproduce under a newer one (2.117.0, what CI's `supabase/setup-cli@v1 version:
-- latest` actually runs). The newer local Postgres bootstrap sets a DEFAULT PRIVILEGE
-- that grants EXECUTE on new functions to anon/authenticated/service_role AS THEIR OWN
-- ROLE (pg_default_acl for role postgres, schema public, object type 'f'), not via the
-- PUBLIC pseudo-role. Every write RPC in this project's history revokes EXECUTE only
-- `from public` (see e.g. 20260830140000's own header: "PUBLIC gets EXECUTE on a new
-- function by default; revoked in the function's own first migration") — correct
-- against a PUBLIC-only default grant, a no-op against a role-specific one.
--
-- Confirmed this is a LOCAL/CI TOOLING discrepancy, not a live gap: the actual cloud
-- project (wxzwanprluqmgoagbkpv) was checked directly and anon already holds no
-- EXECUTE on any of these functions there — its own bootstrap does not set this
-- default privilege. This migration is still the right fix, not a workaround: relying
-- on "whatever this environment's default privileges happen to be" was always the
-- latent bug; naming every role a grant should reach (and every role it should not) is
-- correct regardless of which default-ACL behaviour a given Postgres bootstrap uses,
-- and it makes local dev/CI match the intended access model instead of coincidentally
-- matching it only because of what the cloud platform's bootstrap happens to grant.
--
-- Scope: every existing write RPC across the whole project, not just BTC — the same
-- gap-shaped hole exists in all of them, found by grepping every `revoke execute ...`
-- in supabase/migrations/ for one that never names anon. submit_guess is deliberately
-- excluded: it is Guess the Bean's own anon-callable RPC (anon submitting a guess is
-- the intended, designed access), not an oversight.
--
-- rollback:
--   grant execute on function merge_people(uuid, uuid, uuid) to anon;
--   grant execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) to anon;
--   grant execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb, timestamptz) to anon;
--   grant execute on function start_heat(uuid, uuid, uuid, timestamptz) to anon;
--   grant execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) to anon;
--   grant execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) to anon;
--   grant execute on function delete_test_event(uuid, uuid) to anon;
--   grant execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) to anon;
--   grant execute on function reset_guess_session_data(uuid) to anon;
--   grant execute on function publish_event_results(uuid, uuid, jsonb) to anon;
--   grant execute on function unpublish_event_results(uuid, uuid) to anon;
--   grant execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) to anon;
--   grant execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) to anon;
--   (Reverting this migration restores the exact PRE-existing state: none of these
--   functions were ever meant to be anon-executable, so the rollback exists only for
--   symmetry with this project's convention, not because granting anon back is ever
--   correct. Run and verified live in a transaction against a local database with
--   exactly these statements; the schema returned to its pre-this-migration ACL.)

revoke execute on function merge_people(uuid, uuid, uuid) from anon;
revoke execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) from anon;
revoke execute on function publish_session(uuid, uuid, uuid, text, boolean, jsonb, timestamptz) from anon;
revoke execute on function start_heat(uuid, uuid, uuid, timestamptz) from anon;
revoke execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) from anon;
revoke execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) from anon;
revoke execute on function delete_test_event(uuid, uuid) from anon;
revoke execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) from anon;
revoke execute on function reset_guess_session_data(uuid) from anon;
revoke execute on function publish_event_results(uuid, uuid, jsonb) from anon;
revoke execute on function unpublish_event_results(uuid, uuid) from anon;
revoke execute on function create_btc_match(uuid, text, uuid, uuid, uuid[]) from anon;
revoke execute on function confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text) from anon;
