-- Seduh Score Next · Guess the Bean — session lifecycle (Phase 3 danger zone)
-- Handoff: Handoffs and Specs/guess-the-bean-next-port-SPEC.md Phase 3 ("port
-- legacy's toast/danger-zone/sign-in-note UX patterns"). Legacy's own
-- booth/setup/index.html "Reset Data" and "End Session" buttons delete
-- submissions the creator can't otherwise delete under this port's RLS —
-- the spec's own checklist locks guesses/contacts delete to "never, for
-- anyone except service role." A SECURITY DEFINER RPC is how the creator
-- reaches that privilege safely, verified server-side, matching this
-- project's own `delete_test_event` RPC precedent for Cup Taster
-- (20260905130000_delete_test_event_rpc.sql) rather than loosening the
-- table-level RLS checklist itself.
--
-- rollback:
--   revoke execute on function reset_guess_session_data(uuid) from authenticated;
--   drop function if exists reset_guess_session_data(uuid);
--   revoke delete on sessions from authenticated;
--   drop policy if exists sessions_delete on sessions;

-- ============ End Session ============
-- No RPC needed: deleting the session row itself is a plain, creator-scoped
-- DELETE — guesses/contacts cascade automatically via their own pre-existing
-- `on delete cascade` FKs (20260914120000_guess_the_bean_tables.sql).
-- Postgres enforces FK cascade at the constraint level regardless of RLS on
-- the CASCADED-TO tables (guesses/contacts), so their own delete-locked RLS
-- is never actually reached or bypassed insecurely here — this is standard,
-- documented cascade behavior, not a loophole.
create policy sessions_delete on sessions
  for delete
  using (creator_id = auth.uid());

grant delete on sessions to authenticated;

-- ============ Reset Data ============
-- Clears submissions but keeps the session (config/settings preserved),
-- matching legacy's own onResetData exactly: purge guesses (contacts cascade
-- with them) and reset `revealed` back to false. Deliberately does NOT touch
-- `guess_enabled` — same as legacy, which only ever resets `revealed` here.
create or replace function reset_guess_session_data(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.sessions
    where id = p_session_id and creator_id = auth.uid()
  ) then
    raise exception 'reset_guess_session_data: not the session creator';
  end if;

  -- Re-checking creator_id = auth.uid() on the actual mutating statements
  -- (not just the guard above) closes the same TOCTOU class
  -- delete_test_event_rpc.sql's own review already caught once
  -- (20260905130000_delete_test_event_rpc.sql lines 53-61): under READ
  -- COMMITTED, a guard SELECT and the statements that follow it are
  -- separate — today nothing can change creator_id between them
  -- (sessions_update's own WITH CHECK makes it effectively immutable), but
  -- that's an accidental property of a DIFFERENT policy, not something this
  -- function enforces itself. schema-guardian: flagged live, fixed here
  -- rather than left "procedurally safe."
  delete from public.guesses
    where session_id = p_session_id
      and exists (
        select 1 from public.sessions
        where id = p_session_id and creator_id = auth.uid()
      );
  update public.sessions
    set revealed = false
    where id = p_session_id and creator_id = auth.uid();
end;
$$;

-- PUBLIC gets EXECUTE on a new function by default (Postgres's own
-- documented default, unlike table DML privileges) — revoke it explicitly
-- rather than rely on `anon` simply never calling this, matching the
-- precedent 20260830140000_revoke_public_execute_on_write_rpcs.sql set for
-- Cup Taster's own write RPCs. This one has a real internal creator check
-- (unlike those six's original gap, caught only in review), so `anon`
-- calling it would fail closed regardless — but defense-in-depth is cheap
-- here and matches house style for every write RPC in this codebase.
revoke execute on function reset_guess_session_data(uuid) from public;
grant execute on function reset_guess_session_data(uuid) to authenticated;
