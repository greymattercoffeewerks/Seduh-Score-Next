-- Seduh ID feed (T-ID.D1a): UNDO a run that was COMMITTED. OWNER-RUN. Not a migration.
--
-- What it undoes: what the chosen queue rows recorded (`created_identity_ids`, `linked_person_ids`). For the result ids you
-- paste: (1) it unlinks the recorded people who are still linked to an identity that one of those rows created (a person linked
-- later to anything else is left alone); (2) it deletes a created identity only if it is still `archive`/`active`, nobody is
-- linked to it any more and no tombstone points at it. An identity that gained a person since (linked later by the link
-- function, which is legitimate), one opted out since, or one a tombstone points at is KEPT and counted. The rows become `undone`.
-- Deleting an identity cannot be undone and the links it carried are gone with it: this is data loss on purpose. `queue` mode exists
-- so that the common case is to reject a result BEFORE it runs, not to undo after.
--
-- Paste the result ids between the array brackets. With none it refuses. The first statement is a dry run (counts only); the
-- second applies. It ENDS IN ROLLBACK: read the counts, then change the last line to COMMIT and run it again. Run as the database owner.

begin;

select jsonb_pretty(app.seduh_feed_undo(
  array[
    -- '00000000-0000-0000-0000-000000000000'
  ]::uuid[], false)) as undo_dry_run;

select jsonb_pretty(app.seduh_feed_undo(
  array[
    -- '00000000-0000-0000-0000-000000000000'
  ]::uuid[], true)) as undo_applied;

-- Change to COMMIT only after reading the counts above.
rollback;
