-- Seduh ID feed (T-ID.D1c): OWNER-RUN. Not a migration. Run seduh_feed_review.sql FIRST and read it.
--
-- Runs the feed for the result ids YOU chose (there is no "all"): for each queued result it creates the Seduh ID identities for
-- the people named in the published podium and links those people, with B4's rules exactly (an existing identity for the phone is
-- reused and never overwritten, an opted_out one is linked but inert, a merged tombstone resolves to the kept identity, a bad
-- phone / an owner-blocked person / a merge cycle is skipped, a person already linked elsewhere is left alone). Podium only:
-- a person named only in the full standings is not touched. Refused while the mode is `off`.
--
-- Paste the ids between the quotes below. It prints counts and uuids only, never a phone or a name. The report holds
-- `created_identity_ids` and `linked_person_ids`: they are also recorded on each queue row (that is what
-- seduh_feed_undo.sql reads), but KEEP THEM in a note outside the repo until you are sure.
--
-- It ENDS IN ROLLBACK so a first run changes nothing and shows what it would do: read the report, then change the last line to
-- COMMIT and run it again. Run it in a runner that shows EVERY statement's result (the Supabase SQL editor or psql). A runner
-- that returns only the last statement (the ROLLBACK) would hide the report.
-- Never run this against the cloud without the owner's approval for that run.

begin;

select jsonb_pretty(app.seduh_identity_feed(
  array[
    -- '00000000-0000-0000-0000-000000000000'   <- one result id per line, quoted, comma between
  ]::uuid[]
)) as feed_report;

-- Change to COMMIT only after reading the report above.
rollback;
