-- Seduh Score Next · T-TEN.E3: the cheap, safe findings of the Supabase advisors and the performance check
--
-- What the advisors said about the cloud project (2026-10-13) and what is done here:
--   * `public.rls_auto_enable()` is callable by anon and signed-in callers as a SECURITY DEFINER function
--     (WARN). It is a Supabase-provided EVENT TRIGGER function (it turns row-level security on for every new table
--     in `public`: a useful safety net, which stays), so calling it as an RPC fails ("cannot display a value of type
--     event_trigger") and does nothing; but it needs no EXECUTE for anyone: an event trigger runs as its owner.
--     Revoked from PUBLIC, anon and authenticated. It exists only in the cloud project (Supabase installs it), so the
--     statement is guarded and does nothing in a database that lacks it.
--   * Guess the Bean's `sessions` policies call auth.uid() once PER ROW (WARN, auth_rls_initplan). Wrapping it in a
--     SELECT makes Postgres evaluate it once per query. The same checks, the same roles, the same behaviour.
--   * Three foreign keys that matter had no covering index (INFO): ct_stage_entries.entry_id and
--     event_entries.person_id (deleting a roster entry or a person, and so deleting a rehearsal event, scans these
--     tables once per row deleted) and btc_seeding_tiebreaks (team_id, event_id). The five other unindexed foreign keys
--     (who published or merged or removed something, and one merge pointer) sit on tables that only ever hold a handful
--     of rows and are left alone: an index nobody reads is cost.
--
-- Left alone on purpose, and why (ROADMAP "Known open items from T-TEN.E3"):
--   * "multiple permissive policies" (96): every tenant table has a `_read` (SELECT) and a `_write` (FOR ALL) policy, so
--     a SELECT runs both. Splitting every write policy by command is a large change to security-critical policies for
--     a cost that is small at today's volume; the cross-organisation matrix (supabase/tests/040, 041) now makes such a
--     change safe to do when volume asks for it.
--   * "unused index" (10): `org_members_user_id_idx` IS used (my_orgs asks by user: checked at 7,000 members), and the
--     rest are unused only because the tables are tiny.
--   * the SECURITY DEFINER functions callable by anon or signed-in callers (WARN): each is an intended door, pinned by
--     supabase/tests/037 and 041, and each checks its caller.
--   * leaked-password protection (WARN): a dashboard setting for the owner (Authentication, password security).
--
-- rollback:
--   (rls_auto_enable) grant execute on function public.rls_auto_enable() to public, anon, authenticated;  -- only if you want the old state
--   alter policy sessions_delete on sessions using (creator_id = auth.uid());
--   alter policy sessions_insert on sessions with check (creator_id = auth.uid());
--   alter policy sessions_select_own on sessions using (creator_id = auth.uid());
--   alter policy sessions_update on sessions using (creator_id = auth.uid()) with check (creator_id = auth.uid());
--   drop index if exists ct_stage_entries_entry_id_idx;
--   drop index if exists event_entries_person_id_idx;
--   drop index if exists btc_seeding_tiebreaks_team_event_idx;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

alter policy sessions_delete on sessions using (creator_id = (select auth.uid()));
alter policy sessions_insert on sessions with check (creator_id = (select auth.uid()));
alter policy sessions_select_own on sessions using (creator_id = (select auth.uid()));
alter policy sessions_update on sessions
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()));

create index if not exists ct_stage_entries_entry_id_idx on ct_stage_entries (entry_id);
create index if not exists event_entries_person_id_idx on event_entries (person_id);
create index if not exists btc_seeding_tiebreaks_team_event_idx on btc_seeding_tiebreaks (team_id, event_id);
