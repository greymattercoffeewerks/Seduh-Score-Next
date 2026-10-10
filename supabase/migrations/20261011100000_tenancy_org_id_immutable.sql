-- Seduh Score Next · T-TEN.B1: org_id is immutable on every tenant table
--
-- Why now: until a user can belong to two orgs, row-level security alone kept data in its
-- org. Once one account belongs to org A AND org B, `app.is_org_member(org_id)` is true
-- for both, so a policy that checks only "is the (old and new) row's org one of mine?"
-- lets that user UPDATE a row's org_id from A to B and walk the data across. T-TEN.A2's
-- inventory (Handoffs and Specs/TENANCY-INVENTORY.md §1, §2) found seven tables that carry
-- an org_id (or an event_id that pins one) with nothing freezing it:
--   people, person_merges, processed_operations, team_removed_members, org_members,
--   live_sessions, public_results.
-- events (since T1.3) and score_change_log (update/delete forbidden outright) were
-- already covered. This reuses the existing generic app.forbid_parent_change(cols...)
-- (same trigger the Cup Taster / BTC anchor columns use) instead of adding a new function.
--
-- live_sessions and public_results also freeze event_id: both are upserted
-- `on conflict (event_id)` and never rewrite it, and the org check trigger only proves
-- org_id matches the CURRENT event's org, so a two-org member could previously move a row
-- to the other org's event together with its org_id. org_members freezes user_id too (its
-- primary key is (org_id, user_id); nothing ever re-points a membership).
--
-- A guard test (supabase/tests/033_org_id_immutability_coverage.sql) fails if any public
-- table with an org_id column lacks this protection, so a future format cannot forget it.
--
-- rollback:
--   drop trigger if exists trg_people_org_immutable on people;
--   drop trigger if exists trg_person_merges_org_immutable on person_merges;
--   drop trigger if exists trg_processed_operations_org_immutable on processed_operations;
--   drop trigger if exists trg_team_removed_members_org_immutable on team_removed_members;
--   drop trigger if exists trg_org_members_org_immutable on org_members;
--   drop trigger if exists trg_live_sessions_org_immutable on live_sessions;
--   drop trigger if exists trg_public_results_org_immutable on public_results;

create trigger trg_people_org_immutable
  before update on people
  for each row execute function app.forbid_parent_change('org_id');

create trigger trg_person_merges_org_immutable
  before update on person_merges
  for each row execute function app.forbid_parent_change('org_id');

create trigger trg_processed_operations_org_immutable
  before update on processed_operations
  for each row execute function app.forbid_parent_change('org_id');

create trigger trg_team_removed_members_org_immutable
  before update on team_removed_members
  for each row execute function app.forbid_parent_change('org_id');

create trigger trg_org_members_org_immutable
  before update on org_members
  for each row execute function app.forbid_parent_change('org_id', 'user_id');

-- `update of` on these two: forbid_parent_change serialises the WHOLE row to jsonb once per
-- frozen column, and live_sessions / public_results carry a payload of up to a few hundred
-- KB that is rewritten on every heat action. Measured by schema-guardian: ~17.7 ms per
-- update with a plain `before update`, ~0.2 ms with the column list (publish_session's and
-- publish_event_results' upserts never put org_id or event_id in their SET list, so they
-- never fire it). The small tables above keep the plain form.
create trigger trg_live_sessions_org_immutable
  before update of org_id, event_id on live_sessions
  for each row execute function app.forbid_parent_change('org_id', 'event_id');

create trigger trg_public_results_org_immutable
  before update of org_id, event_id on public_results
  for each row execute function app.forbid_parent_change('org_id', 'event_id');
