-- Seduh ID feed (T-ID.D1c): READ-ONLY review of the queue. Not a migration. Changes nothing.
--
-- Prints, as ONE json document, counts and row ids only: the feed's mode and caps, how many identities the feed created in the
-- last 24 hours, the queue by state, how many published podiums were never queued (a non-zero figure in queue/auto mode means the
-- fail-open trigger missed one, or the mode was off when it was published), and for EACH queued result: its organisation, its
-- event, and what running the feed for it would do (identities to create, identities reused, people to link, people skipped for a
-- bad phone / an owner block / a merge cycle, people linked elsewhere). A `by_org` block gives the same per organisation.
-- It never prints a phone, a name, an email or a cafe.
--
-- HOW TO REVIEW. Payloads, entries and people are written by organisation members, and nothing checks a payload against the
-- scores, so a forged "published podium" can name any phone (CONVENTIONS "Seduh ID feed"). For each queued result, check the
-- organisation and the event against events you know are real (the admin console's organisation detail; the event's own
-- results screen), and note the result ids you trust. Anything you do not recognise: reject it (seduh_feed_reject below), do not run it.
--
-- Needs migration 20261103100000_seduh_feed.sql. Run as the database owner (the SQL editor, psql, or the Supabase MCP's
-- execute_sql). Safe to run any number of times: the transaction is READ ONLY, so the database itself refuses a write.

begin read only;
select jsonb_pretty(app.seduh_feed_review()) as feed_review;
rollback;
