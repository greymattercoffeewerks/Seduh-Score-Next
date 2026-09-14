-- Seduh Score Next · Guess the Bean — submit_guess RPC (Phase 4, participant entry)
-- Handoff: Handoffs and Specs/guess-the-bean-next-port-SPEC.md Phase 4 pass/fail:
-- "Guess + contact write lands as one atomic transaction (test: kill network
-- mid-submit, confirm no orphaned guess-without-contact)." Legacy
-- (booth/guess/index.html, github.com/greymattercoffee/Seduh-Score dev
-- branch) achieves this with a Firestore batch write (guessRef + contactRef,
-- one batch.commit()) — the direct Postgres equivalent isn't "two client
-- inserts in a row" (a dropped connection between them would leave an
-- orphaned guess with no contact, exactly the failure mode the spec names),
-- it's ONE function call whose own statements share one transaction:
-- either both inserts happen or neither does.
--
-- This does not replace guesses_insert/contacts_insert
-- (20260914121000_guess_the_bean_rls.sql) — those stay in place as
-- defense-in-depth on the tables themselves, already reviewed clean across
-- 3 rounds. This RPC is simply the path the real participant client
-- actually calls; the two-step direct-insert shape (tested in Phase 1's own
-- pgTAP suite) remains correct but is no longer what Phase 4's UI uses.
--
-- Also closes the Phase 1-documented RETURNING constraint (this project's
-- own CLAUDE.md/state.json "do not repeat" list): a pre-reveal anon guess
-- insert with RETURNING throws an RLS violation, since RETURNING re-checks
-- the new row against the table's SELECT policy for the inserting role.
-- This RPC's own `returns uuid` is NOT subject to that — a function's
-- return value isn't a table SELECT, so the client learns the new guess's
-- id without ever needing RETURNING or `.insert().select()` against the
-- table directly.
--
-- rollback:
--   revoke execute on function submit_guess(uuid, text, integer, text, text) from anon, authenticated;
--   drop function if exists submit_guess(uuid, text, integer, text, text);

create or replace function submit_guess(
  p_session_id uuid,
  p_name text,
  p_guess integer,
  p_phone text default null,
  p_instagram text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guess_id uuid;
begin
  -- Re-reads the session fresh, same guard guesses_insert's own WITH CHECK
  -- already enforces — SECURITY DEFINER bypasses that policy entirely for
  -- the inserts below, so this function must re-implement the same "only
  -- when open" invariant itself rather than relying on it silently.
  --
  -- coalesce(..., false), not a bare `not app.session_is_open(...)`: that
  -- function is `language sql` and returns NULL (not false) for a
  -- nonexistent p_session_id (its own SELECT matches zero rows) — and
  -- PL/pgSQL's IF treats a NULL condition as false, so `if not NULL` never
  -- fires. Without the coalesce, a nonexistent session_id silently falls
  -- through to the insert below, which then fails on the guesses table's
  -- own session_id FK instead of this function's own named exception — not
  -- a security or atomicity gap (the FK still backstops it, no orphaned row
  -- results), but a real gap against this comment's own stated intent.
  -- schema-guardian: found live, fixed here before this file ships.
  if not coalesce(app.session_is_open(p_session_id), false) then
    raise exception 'submit_guess: session is not open for guessing';
  end if;

  -- Client-generated id would also work (Phase 4's own documented
  -- constraint), but since this RPC's return value bypasses RETURNING
  -- entirely, generating it server-side here is simpler and just as safe —
  -- the client never needs to supply or read it back via a table SELECT.
  v_guess_id := gen_random_uuid();

  insert into public.guesses (id, session_id, name, guess)
    values (v_guess_id, p_session_id, p_name, p_guess);

  -- contact_required's own CHECK constraint (phone is not null or
  -- instagram is not null) fires here if both are omitted — raises,
  -- rolling back the guesses insert above too, in the SAME transaction.
  insert into public.contacts (guess_id, phone, instagram)
    values (v_guess_id, p_phone, p_instagram);

  return v_guess_id;
end;
$$;

-- PUBLIC gets EXECUTE on a new function by default — revoke explicitly and
-- grant only to the two roles that should ever call this, matching every
-- other write RPC's precedent in this codebase
-- (20260830140000_revoke_public_execute_on_write_rpcs.sql). `anon` NEEDS
-- this one (unlike those six, which are organiser-only) — participant
-- entry has no login by design.
revoke execute on function submit_guess(uuid, text, integer, text, text) from public;
grant execute on function submit_guess(uuid, text, integer, text, text) to anon, authenticated;
