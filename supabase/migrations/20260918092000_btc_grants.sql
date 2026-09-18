-- Seduh Score Next · T-BTC.1 BTC grants
-- RLS alone doesn't expose a table — see 20260821240000_grants.sql's own
-- comment, and 20260915130000_guess_the_bean_close_default_privileges.sql's
-- postmortem: a freshly created table can already hold broader anon/
-- authenticated privileges than any migration explicitly granted, purely from
-- local/CI environment defaults (auto_expose_new_tables), and this only
-- surfaces on a truly fresh database (CI), not a long-lived local one. Revoke
-- first, then grant exactly what's needed, so this is environment-independent
-- rather than additive-looking-but-accidentally-permissive.
--
-- No anon grants yet: BTC has no live/audience surface until T-BTC.3 (plan
-- doc §6). Revoking anon entirely here, not narrowing it, keeps this an
-- explicit later decision rather than an inherited default.
--
-- rollback:
--   revoke all on btc_standings from authenticated;
--   revoke all on btc_match_totals from authenticated;
--   revoke all on btc_cup_totals from authenticated;
--   revoke all on btc_bracket_slots from anon, authenticated;
--   revoke all on btc_match_bonuses from anon, authenticated;
--   revoke all on btc_cup_votes from anon, authenticated;
--   revoke all on btc_match_judges from anon, authenticated;
--   revoke all on btc_matches from anon, authenticated;
--   revoke all on btc_judges from anon, authenticated;
--   revoke all on btc_teams from anon, authenticated;

revoke all on btc_teams from anon, authenticated;
revoke all on btc_judges from anon, authenticated;
revoke all on btc_matches from anon, authenticated;
revoke all on btc_match_judges from anon, authenticated;
revoke all on btc_cup_votes from anon, authenticated;
revoke all on btc_match_bonuses from anon, authenticated;
revoke all on btc_bracket_slots from anon, authenticated;

grant select, insert, update, delete on btc_teams to authenticated;
grant select, insert, update, delete on btc_judges to authenticated;
grant select, insert, update, delete on btc_matches to authenticated;
grant select, insert, update, delete on btc_match_judges to authenticated;
grant select, insert, update, delete on btc_cup_votes to authenticated;
grant select, insert, update, delete on btc_match_bonuses to authenticated;
grant select, insert, update, delete on btc_bracket_slots to authenticated;

grant select on btc_cup_totals to authenticated;
grant select on btc_match_totals to authenticated;
grant select on btc_standings to authenticated;
