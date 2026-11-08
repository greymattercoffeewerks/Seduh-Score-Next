-- Seduh Score Next · Build E: a country on BTC teams and judges (docs/specs/BTC-E-TEAM-JUDGE-COUNTRY-PLAN.md, section 4)
--
-- Why: the real competition fields about 20 teams, 2 to 3 per country. The owner wants a judge kept off any match with a
-- team from the judge's own country (the draw, Build B, uses this data). Today btc_teams and btc_judges are a name in one
-- event and nothing else. This adds the data only; the conflict is a warning in the UI, never a refusal here.
--
--   btc_teams.country_code   ISO 3166-1 alpha-2, nullable, NOT unique (2 to 3 teams share a country)
--   btc_teams.represents     optional free label (a region or federation), 1 to 60 characters, already trimmed
--   btc_judges.country_code  ISO 3166-1 alpha-2, nullable
--
-- The database checks the SHAPE only (two capital letters); the client checks membership of its country list. A NULL
-- passes a CHECK, so the shape checks need no "is null or". No index: nothing filters by country yet.
--
-- What already holds, so nothing is added: RLS (btc_teams_write / btc_judges_write cover UPDATE; the window-lock
-- restrictive policies cover every column), the frozen event_id parent, and the table-level insert/update grant to
-- authenticated (the new columns are writable with no grant change; narrowing these tables to column-level grants is the
-- owner's per-table call, docs/backlog/btc.md). No new table and no new function, so the cross-organisation matrices need
-- no entry. btc_teams and btc_judges are not in score_change_log (it logs matches, votes, bonuses and slots), and a
-- country edit is roster data, not a score, so it is not logged. get_dispute_pack emits to_jsonb of each team and judge
-- row, so the new columns appear there (organiser-only); get_scoring_record and public_event_summary emit no judge row.
--
-- rollback:
--   alter table public.btc_judges drop constraint if exists btc_judges_country_code_format;
--   alter table public.btc_judges drop column if exists country_code;
--   alter table public.btc_teams drop constraint if exists btc_teams_represents_length;
--   alter table public.btc_teams drop constraint if exists btc_teams_country_code_format;
--   alter table public.btc_teams drop column if exists represents;
--   alter table public.btc_teams drop column if exists country_code;

alter table public.btc_teams
  add column country_code text null,
  add column represents   text null,
  add constraint btc_teams_country_code_format check (country_code ~ '^[A-Z]{2}$'),
  add constraint btc_teams_represents_length
    check (represents is null or (represents = btrim(represents) and char_length(represents) between 1 and 60));

alter table public.btc_judges
  add column country_code text null,
  add constraint btc_judges_country_code_format check (country_code ~ '^[A-Z]{2}$');
