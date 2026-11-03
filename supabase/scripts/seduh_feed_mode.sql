-- Seduh ID feed (T-ID.D1a): the owner's switch, rejecting a queued result, and retention. OWNER-RUN. Not a migration.
-- Run each block on its own, as the database owner. The mode starts as `off` (nothing is queued, the run is refused).
--
--   off    the publish trigger queues nothing; seduh_identity_feed is refused.
--   queue  the trigger queues each published podium of a non-test event; NOTHING is created until the owner runs the feed for
--          chosen ids (seduh_feed_review.sql, then seduh_feed_run.sql). This is the first live mode.
--   auto   as queue, and app.seduh_feed_auto_run() (a job the owner schedules; this migration schedules nothing) creates
--          identities for queued results without review, but only while the per-organisation and global caps over the last
--          24 hours allow; anything over stays queued. Needs the open points of the build brief answered first (the opt-out
--          procedure, the DPO address, who reviews the queue and how often). Do not switch to it without the owner's decision.
--
-- Record every change of mode in CHANGELOG.md or the runbook note (nothing writes an audit row for it).

-- 1. set the mode ('off' | 'queue' | 'auto'); the caps apply to `auto` only
-- update app.seduh_feed_mode set mode = 'queue';
-- update app.seduh_feed_mode set org_daily_cap = 8, global_daily_cap = 40;

-- 2. reject a queued result you do not recognise (it stays on record as `rejected`; a changed payload re-queues it)
-- update app.seduh_feed_queue set state = 'rejected', processed_at = now()
--  where state = 'queued' and result_id in ('00000000-0000-0000-0000-000000000000');

-- 3. retention (owner decision 9: 12 months). Rows older than that are deleted; deleting a processed row also deletes the lists
--    seduh_feed_undo.sql needs for it, so purge only what you will not undo.
-- delete from app.seduh_feed_queue where state <> 'queued' and processed_at < now() - interval '12 months';

-- 4. see the mode
select mode, org_daily_cap, global_daily_cap from app.seduh_feed_mode;
