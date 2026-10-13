-- Seduh Score Next · T-TEN.D6: anonymous surfaces, CONTRACT step
--
-- Why: with more than one organisation, an anonymous caller must not be able to list every organisation's
-- events, or read every live session ever published. T-TEN.B7 (the EXPAND step) added the narrow doors the
-- audience surfaces now use (public_org_by_slug, public_event_summary) and the client moved to them
-- (T-TEN.D1/D2, released to production before this was written). This migration removes the OLD doors.
--
-- RUN ONLY WITH NO LIVE EVENT, after the venue displays have been reloaded: a projector or phone left open
-- on cached JavaScript from before D2 still reads `events` directly, and stops showing its event the
-- moment this is applied (it recovers on a reload).
--
-- What this does:
--   * events: drops the anonymous policy `events_read_public` (20260831100000_events_anon_safe_read.sql,
--     which said so in its own comment: "revisit before multi-org") and revokes every privilege `anon`
--     holds on the table, including the six-column read grant. Anonymous callers now reach an event only
--     through public_event_summary, which returns one row for one organisation. Signed-in members are
--     untouched (their own `events_read` / `events_write` policies and the `authenticated` grants stay).
--   * live_sessions: replaces the read policy `live_sessions_read` (`using (true)`, 20260821230000_rls_policies.sql,
--     "the one deliberate exception", with the same "before multi-org" caveat) with one that shows
--     ACTIVE rows only, to anon and authenticated alike. A SUPERSEDED session's payload (every standing, name
--     and time of an earlier event the organisation has since replaced) is no longer public. Be clear about
--     the limit: only publish_session ever deactivates a session, so an organisation's MOST RECENT session
--     stays active, and public, until it publishes another; the audience surfaces need exactly that, and a
--     per-organisation door plus an "end the session" action is the real fix (ROADMAP, T-TEN.D6 open items).
--     anon also loses INSERT/UPDATE/DELETE/TRUNCATE on the table (it never had a policy to use them, but on
--     some environments it holds the table privilege, so RLS was the only barrier). Members still read their own organisation's
--     rows of every state through `live_sessions_write` (a FOR ALL policy covers SELECT), so the organiser's
--     own lookups (findActiveLiveEventId) are unchanged.
--
-- Checked before writing it (T-TEN.D6, repo grep and the policies themselves):
--   * Every audience read of live_sessions asks for `active = true` (core/viewer-shell.js); nothing else in
--     the client reads the table anonymously (core/publish.js is the organiser's, signed in).
--   * No other anonymous policy, view or grant depends on reading `events` (public_results and the Guess the
--     Bean tables do not subquery it; foreign-key checks do not need the reader's privilege).
--   * Realtime: a database change reaches an anonymous subscriber only if the NEW row is visible to them.
--     The only thing in the app that ends a session is publish_session, which deactivates the old row and,
--     in the same transaction, activates the new one, so the subscriber is told by the new row. A future
--     "end the session without a replacement" would deactivate a row that anon can no longer see change, so
--     it would NOT reach open screens by itself (they would show the last state until reloaded); whoever adds
--     that path must give the audience a signal another way. Recorded in ROADMAP (T-TEN.D6 open items).
--   * live_sessions_write is re-created for `authenticated` ONLY (same checks). It is a FOR ALL policy with no
--     role, so it also applied to anon on SELECT, where it calls app.is_org_member, a function anon may not
--     execute. While the read policy was `using (true)` Postgres folded that away; with `using (active)` the
--     function is reached for any row that is not active and the whole anonymous read fails with "permission
--     denied for function is_org_member" (found by the pgTAP written for this task). anon could never write the
--     table (no INSERT/UPDATE/DELETE grant), so scoping the write policy changes nothing it could do.
--   * The public RPC doors, the public results archive and Guess the Bean are untouched.
--
-- rollback: (restores both old doors exactly as they were; only run it to bring back the single-organisation
--   behaviour, since it re-opens every organisation's events and finished sessions to anyone)
--   drop policy if exists live_sessions_read on live_sessions;
--   create policy live_sessions_read on live_sessions for select using (true);
--   drop policy if exists live_sessions_write on live_sessions;
--   create policy live_sessions_write on live_sessions for all
--     using (app.is_org_member(org_id)) with check (app.is_org_member(org_id));
--   create policy events_read_public on events for select to anon using (true);
--   grant select (id, org_id, name, event_date, is_test, created_at) on events to anon;
--   (the anon write privileges on live_sessions are deliberately NOT restored: nothing ever used them)

-- Refuse to run before the doors that replace the old reads exist (this is applied by hand to the cloud project).
do $$
begin
  if to_regprocedure('public.public_event_summary(uuid)') is null
     or to_regprocedure('public.public_org_by_slug(text)') is null then
    raise exception 'T-TEN.D6 needs the T-TEN.B7 anonymous doors (public_event_summary, public_org_by_slug) first'
      using errcode = '55000';
  end if;
end;
$$;

drop policy if exists events_read_public on events;
-- REVOKE on a table also removes the column-level grants on it, so this closes the six-column read too.
revoke all on table events from anon;

revoke insert, update, delete, truncate on table live_sessions from anon;

drop policy if exists live_sessions_read on live_sessions;
create policy live_sessions_read on live_sessions
  for select
  to anon, authenticated
  using (active);

-- Scoped to signed-in callers (see the note above); the expressions are exactly the previous ones.
drop policy if exists live_sessions_write on live_sessions;
create policy live_sessions_write on live_sessions
  for all
  to authenticated
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));
