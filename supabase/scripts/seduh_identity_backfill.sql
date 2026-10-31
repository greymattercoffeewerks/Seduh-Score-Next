-- Seduh ID backfill (T-ID.B4): OWNER-RUN. Not a migration. Run seduh_identity_backfill_dry_run.sql FIRST and read it.
--
-- What it does: creates the Seduh ID identities for the people the platform already names in a published, non-test
-- result (source 'archive', status 'active'; an existing identity for the same phone is reused, never duplicated or
-- overwritten), then links those people's rows to them (people.global_person_id; an opted_out identity is linked too,
-- inert). Rows with a bad phone, rows the owner unlinked, merge cycles and people already linked elsewhere are skipped
-- and listed by id. See the header of migration 20261031100000_seduh_identity_backfill.sql for the exact rules.
-- It is idempotent: the second statement below runs the dry run again and must show 0 to create and 0 to link.
--
-- It prints counts and uuids only, never a phone or a name. The first report holds `created_identity_ids` and
-- `linked_person_ids`: KEEP THEM (a note outside the repo) until you are sure, they are what
-- seduh_identity_backfill_undo.sql needs.
--
-- It ENDS IN ROLLBACK so a first run changes nothing and shows what it would do: read both reports, then change the
-- last line to COMMIT and run it again. Run it in a runner that shows EVERY statement's result (the Supabase SQL editor
-- or psql). A runner that returns only the last statement (the ROLLBACK) would hide the reports.
--
-- Needs migration 20261031100000_seduh_identity_backfill.sql. Run as the database owner; the function refuses an API
-- role. Never run this against the cloud without the owner's approval for that run.

-- REVIEW BEFORE APPLYING (security review): payloads and entries are written by organisation members, so a forged
-- 'published result' can name any phone. Read `creates_by_result` in the dry run, check each organisation and event
-- against events you know are real, and pass only those result ids as the second argument:
-- array['<result id>', '<result id>']::uuid[]. null (as below) means every result.

begin;

select jsonb_pretty(app.seduh_identity_backfill(true, null)) as apply_report;

-- the same dry run again, inside the same transaction: nothing left to create or link
select jsonb_pretty(app.seduh_identity_backfill(false, null)) as report_after;

-- Change to COMMIT only after reading both reports above.
rollback;
