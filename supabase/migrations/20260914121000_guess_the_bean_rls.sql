-- Seduh Score Next · Guess the Bean — Phase 1 RLS + grants
-- Handoff: Handoffs and Specs/guess-the-bean-next-port-SPEC.md, RLS checklist.
--
-- Deliberately NOT the "every write policy is FOR ALL" shape CONVENTIONS.md
-- documents for the org-scoped tables: guesses/contacts need public INSERT +
-- restricted SELECT but must never be UPDATE/DELETE-able by anon or authenticated
-- (checklist: "never, for anyone except service role"). Splitting into per-command
-- policies and simply never writing an UPDATE/DELETE policy achieves that directly
-- — service_role bypasses RLS by default, so the absence IS the enforcement.
--
-- rollback:
--   revoke all on contacts from anon, authenticated;
--   revoke all on guesses from anon, authenticated;
--   revoke all on sessions from anon, authenticated;
--   drop policy if exists contacts_select on contacts;
--   drop policy if exists contacts_insert on contacts;
--   drop policy if exists guesses_select on guesses;
--   drop policy if exists guesses_insert on guesses;
--   drop policy if exists sessions_update on sessions;
--   drop policy if exists sessions_insert on sessions;
--   drop policy if exists sessions_select_own on sessions;
--   drop policy if exists sessions_select on sessions;
--   drop function if exists app.session_id_for_guess(uuid);
--   drop function if exists app.session_is_creator(uuid);
--   drop function if exists app.session_is_revealed(uuid);
--   drop function if exists app.session_is_open(uuid);

-- ============ resolver chokepoints ============
-- Same "one function per FK-chain hop, SECURITY DEFINER STABLE" chokepoint
-- pattern as app.org_id_for_event/org_id_for_stage/etc (20260821230000_rls_policies.sql)
-- — but load-bearing here for a SECOND reason beyond that pattern's usual one:
-- anon's grant on `sessions` is column-scoped (see the grants section below),
-- so a raw subquery reading sessions.creator_id/guess_enabled/revealed
-- directly from inside guesses'/contacts' own policies would fail with
-- "permission denied for table sessions" for anon — confirmed live,
-- security-reviewer's finding. A SECURITY DEFINER function runs as its
-- OWNER (the migration role), not the caller, so it needs no grant on the
-- calling role at all, the same way app.is_org_member reads org_members
-- without org_members granting anything to the caller directly.
--
-- A second, independent reason this shape is required (not just cleaner):
-- contacts_insert's WITH CHECK reads the `guesses` table to find the parent
-- session — but `guesses` has its own SELECT policy, and a still-open,
-- not-yet-revealed guess is NOT visible to anon under guesses_select (only
-- visible once revealed, or to the session's own creator). A raw subquery
-- against `guesses` from within contacts_insert would therefore be
-- RLS-filtered to zero rows for the exact case that matters most — a
-- participant pairing their own just-inserted guess with their own contact
-- info, in the same open session. app.session_id_for_guess bypasses guesses'
-- own RLS the same way (SECURITY DEFINER), closing what would otherwise be a
-- real functional bug in the participant flow, not just a privilege wrinkle.
-- EXISTS, not a bare scalar select + coalesce(..., false) — a genuinely
-- nonexistent p_session_id makes the WHERE clause match zero rows, and a
-- plain `select coalesce(expr, false) from t where ...` over zero rows
-- returns NULL for the whole query (coalesce never even runs — there's no
-- row to evaluate it against), not false. EXISTS always returns a real
-- boolean regardless of row count, closing that gap once here rather than
-- coalescing every individual caller. Found by security-reviewer,
-- reviewing the new submit_guess RPC (20260915100000): a bare
-- `if not app.session_is_open(...)` silently let a nonexistent session_id
-- fall through to a raw foreign-key violation instead of this function's
-- own intended denial — a real enumeration oracle (a nonexistent session id
-- produced a different, more specific error than a real-but-closed one) on
-- an anon-reachable RPC. guesses_insert/contacts_insert's own WITH CHECK
-- calls into this same function and were incidentally masked from the same
-- bug (by RLS's own NULL-means-deny semantics, or by guesses' FK), but
-- the helper itself was still wrong — fixed at the source, not just at
-- submit_guess's own call site.
create or replace function app.session_is_open(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions
    where id = p_session_id
      and guess_enabled
      and not revealed
  );
$$;

create or replace function app.session_is_revealed(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(revealed, false) from public.sessions where id = p_session_id;
$$;

-- Returns a BOOLEAN, never the raw creator_id — a function returning the
-- actual UUID would be directly callable by anon (Postgres grants EXECUTE to
-- PUBLIC by default, and it must stay callable by anon for guesses_select/
-- contacts_select to evaluate at all), which would let anon fetch any
-- session's creator_id one call at a time and completely undo the
-- column-scoped grant below. Comparing against auth.uid() INSIDE the
-- function instead means an anon caller (auth.uid() is always NULL when
-- unauthenticated) gets `creator_id = NULL`, which SQL evaluates to NULL —
-- not `false` — for every session_id they try, existing or not; a NULL in a
-- USING clause excludes the row exactly like `false` does, so this is
-- indistinguishable (and leaks nothing) either way. security-reviewer
-- verified this live.
create or replace function app.session_is_creator(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select creator_id = auth.uid() from public.sessions where id = p_session_id;
$$;

create or replace function app.session_id_for_guess(p_guess_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select session_id from public.guesses where id = p_guess_id;
$$;

-- ============ sessions ============
-- Public safe-column read, `to anon` ONLY — not itemized in the spec's RLS
-- checklist, but required by Phase 4 (participant entry flow reads
-- guess_enabled/revealed/orientation with no login) and Phase 5 (display/
-- stage mode), same "no auth on audience surfaces" precedent live_sessions
-- already established.
--
-- Deliberately scoped `to anon`, NOT left with no `to` clause (which would
-- also match `authenticated`) — security-reviewer's live-verified finding:
-- `authenticated` holds a FULL-column grant on `sessions` (needed below so
-- the creator can read their own name/creator_id), and Postgres column
-- grants are not policy-conditional — they apply table-wide to every row a
-- role can see under ANY matching permissive policy. A `using (true))` with
-- no `to` clause plus authenticated's full-column grant meant ANY logged-in
-- user could read ANY OTHER creator's creator_id/name, directly violating
-- the spec's own Phase 3 AC ("Only the session's own creator can see/modify
-- it"). Scoping this policy `to anon` and adding `sessions_select_own`
-- (authenticated, own-row-only) below is the only combination that
-- satisfies both: anon gets safe-column-only visibility into every session
-- (via anon's narrower grant), authenticated gets full-column visibility
-- into ONLY their own sessions (via their broader grant, but row-restricted).
--
-- Known trade-off, not a security gap: a signed-in user (authenticated role)
-- who opens SOMEONE ELSE's participant link sees nothing — the `to anon`
-- policy doesn't match their role, and `sessions_select_own` only matches
-- their own sessions. Phase 4's real participant client should use an
-- anon-key Supabase client for its reads regardless of the visitor's own
-- login state (participant surfaces are "no login" by design per the spec
-- anyway) — that sidesteps this at the application layer rather than
-- requiring a data-leaking schema compromise to "fix" it here.
create policy sessions_select on sessions
  for select
  to anon
  using (true);

create policy sessions_select_own on sessions
  for select
  to authenticated
  using (creator_id = auth.uid());

create policy sessions_insert on sessions
  for insert
  to authenticated
  with check (creator_id = auth.uid());

create policy sessions_update on sessions
  for update
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

-- No delete policy: not in the Phase 1 RLS checklist, and no phase in the spec
-- deletes a session. If Phase 3's setup screen turns out to need one, that's a
-- new migration, not an edit to this one, once this has shipped (forward-only).

-- ============ guesses ============
-- Insert: no auth required (public participant flow). app.session_is_open
-- re-reads sessions fresh on every insert, so a session flipped closed
-- mid-write is enforced server-side, not just by the client's own realtime
-- watch.
create policy guesses_insert on guesses
  for insert
  to anon, authenticated
  with check (app.session_is_open(guesses.session_id));

-- Select: public once the parent session is revealed. Before reveal, restricted
-- to the session's own creator rather than fully empty — the creator's own
-- display/stage surface needs a live guess feed pre-reveal (Phase 5), and the
-- checklist itself flags this as "restricted (or empty) — confirm against
-- legacy... don't assume." security-reviewer / Phase 5 implementer: verify this
-- matches legacy's actual pre-reveal display behavior before shipping Phase 5.
-- No `to` clause (applies to both anon and authenticated) is safe ONLY
-- because anon/authenticated hold IDENTICAL grants on `guesses` (see the
-- grants section: `grant select, insert on guesses to authenticated, anon`
-- — symmetric, unlike sessions' deliberately asymmetric grant). If a future
-- migration ever narrows one role's column grant here without the other,
-- re-examine this policy's missing `to` clause the same way sessions_select
-- needed one — security-reviewer flagged this as the exact leak class
-- (broad USING + a role holding a broader grant than assumed) to watch for.
create policy guesses_select on guesses
  for select
  using (
    app.session_is_revealed(guesses.session_id)
    or app.session_is_creator(guesses.session_id)
  );

-- No update/delete policy, for anyone: matches "never, for anyone except
-- service role" — service_role bypasses RLS entirely by default.

-- ============ contacts ============
-- Insert: no auth required, paired 1:1 with a guesses insert in the same
-- transaction (app-level guarantee — the spec's own Firestore-batch-write
-- equivalent). This WITH CHECK independently re-verifies the parent guess's own
-- session is still open at write time, closing the same race window as
-- guesses_insert above rather than trusting the app's transaction alone.
create policy contacts_insert on contacts
  for insert
  to anon, authenticated
  with check (app.session_is_open(app.session_id_for_guess(contacts.guess_id)));

-- Select: only the session's own creator, never public — the entire point of
-- the guess/contact table split (handoff privacy requirement). No `to`
-- clause needed here the way sessions_select did — this USING is already
-- creator-only (not `using (true)`), so a future grant asymmetry between
-- anon/authenticated on `contacts` wouldn't reopen a leak the same way it
-- would for a broad-USING policy; still relies on anon/authenticated
-- currently holding identical grants (see guesses_select's own comment).
create policy contacts_select on contacts
  for select
  using (app.session_is_creator(app.session_id_for_guess(contacts.guess_id)));

-- No update/delete policy, for anyone — same reasoning as guesses above.

-- ============ grants ============
-- RLS alone does nothing without the underlying table privilege
-- (CONVENTIONS.md "Base GRANTs are a separate layer from RLS, and both are
-- required" — discovered directly on T1.3).
grant usage on schema app to authenticated, anon;
grant select, insert, update on sessions to authenticated;

-- anon's sessions grant is column-scoped, NOT a bare `grant select on sessions
-- to anon` — sessions_select's `using (true)` makes every row visible to
-- anon, and creator_id is the spec's own declared Seduh ID identity anchor
-- ("no re-keying planned"), so a full-row grant would make that anchor UUID
-- unauthenticatedly enumerable across every session in the system, forever.
-- Only guess_enabled/revealed/orientation (plus id, already known from the
-- URL) are ever read unauthenticated, per the spec's Phase 4/5 sections.
-- Follows 20260831100000_events_anon_safe_read.sql's own precedent AND its
-- hard-won lesson: that migration's first draft used an ADDITIVE-only
-- column grant, which failed in CI because `anon` can already hold a full
-- table-level grant from `supabase start`'s environment-dependent
-- `auto_expose_new_tables` behavior — a column grant can never narrow a
-- role that already holds the broader table-level privilege. `revoke` first
-- is what actually makes this environment-independent, not the column list
-- alone. The resolver functions above are what let guesses'/contacts' own
-- policies keep working despite this narrower grant — they run as the
-- function owner, not as anon, so they need no grant on sessions at all.
revoke select, insert, update, delete on sessions from anon;
grant select (id, guess_enabled, revealed, orientation) on sessions to anon;

grant select, insert on guesses to authenticated, anon;
grant select, insert on contacts to authenticated, anon;
