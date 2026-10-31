-- Seduh ID backfill (T-ID.B4): READ-ONLY dry run. Not a migration. Changes nothing.
--
-- Prints, as ONE json document, counts and row ids only: how many published non-test results there are, how many name
-- slots they hold and how many of those match no entry, more than one entry, or an entry with no person; how many
-- distinct people the platform names; how many would get a NEW identity, REUSE an existing one (active / opted_out),
-- be linked, be already linked, or be skipped (bad phone, blocked by the owner, a merge cycle), with the ids of the
-- skipped people; and the ORPHAN LIST (identities with no linked person, by identity id). It never prints a phone, a
-- name, an email or a cafe, and it does not say which organisations share a phone.
--
-- "Named in a published result" is defined in the header of migration 20261031100000_seduh_identity_backfill.sql:
-- a person is named when the payload's podium (or the full standings, if published) holds a name and cafe that exactly
-- one entry of that event matches, and that entry has a person of the event's organisation.
--
-- Needs migration 20261031100000_seduh_identity_backfill.sql (and B1/B2 before it). Run as the database owner
-- (the SQL editor, psql, or the Supabase MCP's execute_sql). Safe to run any number of times: the transaction is READ
-- ONLY, so the database itself refuses a write. A runner that returns only the last statement should be given just the
-- middle line (the function writes nothing when its argument is false).

-- REVIEW BEFORE APPLYING (security review): payloads and entries are written by organisation members, so a forged
-- 'published result' can name any phone. Read `creates_by_result` in the dry run, check each organisation and event
-- against events you know are real, and pass only those result ids as the second argument:
-- array['<result id>', '<result id>']::uuid[]. null (as below) means every result.

begin read only;
select jsonb_pretty(app.seduh_identity_backfill(false, null)) as dry_run_report;
rollback;
