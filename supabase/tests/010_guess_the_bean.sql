-- Guess the Bean — Phase 1 RLS, per guess-the-bean-next-port-SPEC.md's checklist
-- and Phase 1 "Test coverage" list: insert-when-closed rejected, insert-when-open
-- accepted, contact-select-by-non-owner rejected, guess-update rejected.
begin;
select plan(57);

-- ---------- fixtures (as postgres, bypasses RLS) ----------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'creator@test.seduh-next'),
  ('00000000-0000-0000-0000-0000000000c2', 'other-creator@test.seduh-next');

-- open session (guess_enabled, not revealed)
insert into sessions (id, creator_id, name, guess_enabled, revealed, bean_count) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1',
   'Open Session', true, false, 428);

-- closed session (guess_enabled = false)
insert into sessions (id, creator_id, name, guess_enabled, revealed, bean_count) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1',
   'Closed Session', false, false, 428);

-- revealed session, with one guess already in it
insert into sessions (id, creator_id, name, guess_enabled, revealed, bean_count) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1',
   'Revealed Session', true, true, 500);
insert into guesses (id, session_id, name, guess) values
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3',
   'Revealed Guesser', 500);

-- a fourth session, used only by the "creator can update" test below so it
-- doesn't mutate session a1's open state out from under the later guesses tests
insert into sessions (id, creator_id, name, guess_enabled, revealed, bean_count) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c1',
   'Update Test Session', true, false, 428);

-- a fifth session, revealed and never touched by reset_guess_session_data
-- (unlike a3, which an earlier test resets back to revealed=false) — used
-- only by submit_guess's "rejects an already-revealed session" test below.
insert into sessions (id, creator_id, name, guess_enabled, revealed, bean_count) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c1',
   'Submit-Guess Revealed Session', true, true, 428);

-- a guess + contact on the OPEN session, owned by creator c1
insert into guesses (id, session_id, name, guess) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   'Guesser One', 1200);
insert into contacts (id, guess_id, phone) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
   '+6738001111');

-- ---------- sessions: public read ----------

set local role anon;
select is(
  (select count(*)::int from sessions where id in (
    '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-0000000000a3',
    '00000000-0000-0000-0000-0000000000a4',
    '00000000-0000-0000-0000-0000000000a5'
  )),
  5,
  'an unauthenticated (anon) client can read every public test-session row'
);
reset role;

-- ---------- sessions: authenticated read is restricted to OWN sessions only ----------
-- The real gap security-reviewer found live: sessions_select's `using (true)`
-- originally had no `to` clause, so it also matched `authenticated` — combined
-- with authenticated's full-column grant (needed so a creator can read their
-- own name/creator_id), that let ANY logged-in user read ANY OTHER creator's
-- creator_id/name, violating the spec's own Phase 3 AC ("Only the session's
-- own creator can see/modify it"). c2 here is authenticated but owns none of
-- the four fixture sessions (all owned by c1) — must read zero.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select is(
  (select count(*)::int from sessions),
  0,
  'a DIFFERENT authenticated user (not any session''s creator) reads zero sessions'
);
reset role;
reset request.jwt.claim.sub;

-- ---------- sessions: insert only by authenticated user, creator_id = auth.uid() ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$ insert into sessions (creator_id, name, bean_count) values
       ('00000000-0000-0000-0000-0000000000c1', 'My New Session', 428) $$,
  'an authenticated user CAN create a session with creator_id = their own auth.uid()'
);
select throws_ok(
  $$ insert into sessions (creator_id, name, bean_count) values
       ('00000000-0000-0000-0000-0000000000c2', 'Spoofed Session', 428) $$,
  '42501',
  null,
  'an authenticated user CANNOT create a session claiming a different creator_id'
);
reset role;
reset request.jwt.claim.sub;

set local role anon;
select throws_ok(
  $$ insert into sessions (creator_id, name, bean_count) values
       ('00000000-0000-0000-0000-0000000000c1', 'Anon Session', 428) $$,
  '42501',
  null,
  'an unauthenticated (anon) client CANNOT create a session'
);
reset role;

-- ---------- sessions: update only by creator_id = auth.uid() ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$ update sessions set revealed = true
       where id = '00000000-0000-0000-0000-0000000000a4' $$,
  'the session''s own creator CAN update it'
);
reset role;
reset request.jwt.claim.sub;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
update sessions set revealed = true where id = '00000000-0000-0000-0000-0000000000a2';
select is(
  (select revealed from sessions where id = '00000000-0000-0000-0000-0000000000a2'),
  null,
  -- NULL, not false: c2 can no longer SEE session a2 at all under
  -- sessions_select_own (it belongs to c1), so this read returns zero rows
  -- rather than a2's actual (unchanged) revealed value — proof the update
  -- didn't apply AND proof c2 has no read access to someone else's session.
  'a DIFFERENT authenticated user (not the creator) cannot update or even read someone else''s session'
);
reset role;
reset request.jwt.claim.sub;

-- confirm as postgres (bypasses RLS): the update genuinely didn't apply, not
-- just "c2 can't see the result"
select is(
  (select revealed from sessions where id = '00000000-0000-0000-0000-0000000000a2'),
  false,
  'session a2''s revealed is still false — c2''s update attempt above had zero effect'
);

-- ---------- guesses: insert-when-open accepted (anon) ----------

set local role anon;
select lives_ok(
  $$ insert into guesses (session_id, name, guess) values
       ('00000000-0000-0000-0000-0000000000a1', 'New Guesser', 999) $$,
  'an anon client CAN insert a guess into an open (guess_enabled, not revealed) session'
);
reset role;

-- ---------- guesses + contacts: anon can pair a NEW guess with contact info ----------
-- The real Phase 4 participant flow: a public client inserts a guess, then
-- immediately inserts a matching contact row for it in the same open session.
-- This specifically proves app.session_id_for_guess's SECURITY DEFINER bypass
-- of guesses' own RLS actually works — a not-yet-revealed guess is NOT
-- visible to anon under guesses_select, so a naive (non-bypassing) resolver
-- would make contacts_insert's WITH CHECK see zero rows here and fail.
--
-- IMPORTANT, discovered live while writing this test: the client CANNOT use
-- `insert ... returning id` (or Supabase JS's `.insert(...).select()`) to
-- learn the new guess's id — Postgres requires the inserting role to also
-- satisfy the table's SELECT policy for RETURNING to succeed, and a
-- pre-reveal anon guess never does (guesses_select needs revealed=true or
-- the session's creator). `insert ... returning id` for this exact anon/
-- open-session/pre-reveal case throws "new row violates row-level security
-- policy for table guesses" even though the insert's own WITH CHECK passes.
-- Phase 4's real client MUST generate the guess's id client-side (uuid v4)
-- before inserting, and pass it explicitly to both inserts — never rely on
-- RETURNING/`.select()` to learn it after the fact. Flagged as a Phase 4
-- implementation constraint, not a Phase 1 schema defect.
set local role anon;
select lives_ok(
  $$ insert into guesses (id, session_id, name, guess) values
       ('00000000-0000-0000-0000-0000000000b9',
        '00000000-0000-0000-0000-0000000000a1', 'Paired Guesser', 42) $$,
  'an anon client CAN insert a guess with a client-generated id'
);
select lives_ok(
  $$ insert into contacts (guess_id, phone) values
       ('00000000-0000-0000-0000-0000000000b9', '+6738002222') $$,
  'an anon client CAN then pair a contact with that guess, in the same still-open session'
);
reset role;

-- ---------- guesses: insert-when-closed rejected (guess_enabled = false) ----------

set local role anon;
select throws_ok(
  $$ insert into guesses (session_id, name, guess) values
       ('00000000-0000-0000-0000-0000000000a2', 'Blocked Guesser', 100) $$,
  '42501',
  null,
  'an anon client CANNOT insert a guess into a session with guess_enabled = false'
);

-- ---------- guesses: insert-when-revealed rejected ----------

select throws_ok(
  $$ insert into guesses (session_id, name, guess) values
       ('00000000-0000-0000-0000-0000000000a3', 'Late Guesser', 100) $$,
  '42501',
  null,
  'an anon client CANNOT insert a guess into an already-revealed session'
);
reset role;

-- ---------- guesses: update/delete rejected for everyone but service_role ----------

select is(
  has_table_privilege('anon', 'guesses', 'update'),
  false,
  'anon has no table-level UPDATE on guesses'
);
select is(
  has_table_privilege('authenticated', 'guesses', 'update'),
  false,
  'authenticated has no table-level UPDATE on guesses'
);
select is(
  has_table_privilege('anon', 'guesses', 'delete'),
  false,
  'anon has no table-level DELETE on guesses'
);
select is(
  has_table_privilege('authenticated', 'guesses', 'delete'),
  false,
  'authenticated has no table-level DELETE on guesses'
);

-- ---------- contacts: update/delete rejected for everyone but service_role ----------
-- Same checklist item as guesses above ("never, for anyone except service
-- role"), just as security-relevant here since contacts holds phone/Instagram.

select is(
  has_table_privilege('anon', 'contacts', 'update'),
  false,
  'anon has no table-level UPDATE on contacts'
);
select is(
  has_table_privilege('authenticated', 'contacts', 'update'),
  false,
  'authenticated has no table-level UPDATE on contacts'
);
select is(
  has_table_privilege('anon', 'contacts', 'delete'),
  false,
  'anon has no table-level DELETE on contacts'
);
select is(
  has_table_privilege('authenticated', 'contacts', 'delete'),
  false,
  'authenticated has no table-level DELETE on contacts'
);

-- ---------- sessions: anon's grant is column-scoped (id/guess_enabled/revealed/orientation only) ----------
-- creator_id is the spec's own declared Seduh ID identity anchor — must never
-- be unauthenticatedly readable, even though the row itself is (sessions_select
-- is `using (true)`). Proves the actual GRANT mechanism, not just an
-- observable outcome — a column-read assertion alone could pass vacuously in
-- an environment where anon never had table-level SELECT to begin with (see
-- 20260831100000_events_anon_safe_read.sql's own test for this exact trap).

set local role anon;
select throws_ok(
  $$ select creator_id from sessions $$,
  '42501',
  null,
  'an unauthenticated (anon) client cannot read sessions.creator_id'
);
select throws_ok(
  $$ select name from sessions $$,
  '42501',
  null,
  'an unauthenticated (anon) client cannot read sessions.name'
);
select is(
  (select guess_enabled from sessions where id = '00000000-0000-0000-0000-0000000000a1'),
  true,
  'an unauthenticated (anon) client CAN read sessions.guess_enabled via the granted safe columns'
);
reset role;

-- ---------- guesses: select — Phase 5's anonymous display feed is name-only before reveal ----------

set local role anon;
select is(
  (select count(*)::int from guesses where session_id = '00000000-0000-0000-0000-0000000000a3'),
  1,
  'an anon client CAN read guesses once the parent session is revealed'
);
select is(
  (select count(*)::int from guesses where session_id = '00000000-0000-0000-0000-0000000000a1'),
  3,
  'an anon client CAN read the safe arrival feed from an open, not-yet-revealed session'
);
select throws_ok(
  $$ select guess from guesses where session_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '42501', null,
  'an anon client CANNOT read numeric guesses before the reveal'
);
select is(
  (select count(*)::int from app.session_display_guesses('00000000-0000-0000-0000-0000000000a1')),
  0,
  'the gated display RPC returns zero rows before the reveal'
);
select is(
  (select guess from app.session_display_guesses('00000000-0000-0000-0000-0000000000a3')),
  500,
  'the gated display RPC returns the numeric guess after the reveal'
);
select is(
  (select public.session_bean_count('00000000-0000-0000-0000-0000000000a3')),
  500,
  'the public display RPC wrapper returns bean_count only through the gated app resolver'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from guesses where session_id = '00000000-0000-0000-0000-0000000000a1'),
  3,
  'the session''s own creator CAN read guesses from their own not-yet-revealed session'
);
reset role;
reset request.jwt.claim.sub;

-- ---------- contacts: select restricted to the session's own creator ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from contacts where guess_id = '00000000-0000-0000-0000-0000000000b1'),
  1,
  'the session''s own creator CAN read the contact row for a guess on their session'
);
reset role;
reset request.jwt.claim.sub;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select is(
  (select count(*)::int from contacts where guess_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'a DIFFERENT authenticated user (not the session''s creator) reads zero contacts'
);
reset role;
reset request.jwt.claim.sub;

set local role anon;
select is(
  (select count(*)::int from contacts),
  0,
  'an unauthenticated (anon) client reads zero contacts — never public'
);
reset role;

-- ---------- sessions.bean_count: required, bounded, never a plain anon read ----------

select throws_ok(
  $$ insert into sessions (creator_id, name, bean_count) values
       ('00000000-0000-0000-0000-0000000000c1', 'No Bean Count', null) $$,
  '23502',
  null,
  'bean_count is required — a null value is rejected'
);
select throws_ok(
  $$ insert into sessions (creator_id, name, bean_count) values
       ('00000000-0000-0000-0000-0000000000c1', 'Zero Beans', 0) $$,
  '23514',
  null,
  'bean_count must be at least 1'
);

set local role anon;
select throws_ok(
  $$ select bean_count from sessions $$,
  '42501',
  null,
  'an unauthenticated (anon) client cannot read sessions.bean_count directly, even on a revealed session'
);
reset role;

-- ---------- app.session_bean_count(): the ONE place anon can read it, post-reveal only ----------

set local role anon;
select is(
  app.session_bean_count('00000000-0000-0000-0000-0000000000a1'),
  null,
  'session_bean_count() returns null pre-reveal, even to anon'
);
select is(
  app.session_bean_count('00000000-0000-0000-0000-0000000000a3'),
  500,
  'session_bean_count() returns the real count once the session is revealed'
);
reset role;

-- ---------- sessions_delete: creator only, cascades to guesses/contacts ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
delete from sessions where id = '00000000-0000-0000-0000-0000000000a4';
reset role;
reset request.jwt.claim.sub;

-- checked as postgres (bypassing RLS) — c2 can't even SEE a4 under
-- sessions_select_own, so checking the count as c2 would read 0 regardless
-- of whether the delete above actually did anything; this is the only way
-- to prove the delete itself had zero effect, not just "c2 can't observe it"
select is(
  (select count(*)::int from sessions where id = '00000000-0000-0000-0000-0000000000a4'),
  1,
  'a DIFFERENT authenticated user (not the creator) cannot delete someone else''s session'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$ delete from sessions where id = '00000000-0000-0000-0000-0000000000a4' $$,
  'the session''s own creator CAN delete it (End Session)'
);
reset role;
reset request.jwt.claim.sub;

select is(
  (select count(*)::int from sessions where id = '00000000-0000-0000-0000-0000000000a4'),
  0,
  'the deleted session is genuinely gone (as postgres, bypassing RLS)'
);

-- ---------- reset_guess_session_data(): creator only, clears guesses+contacts, resets revealed ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';
select throws_ok(
  $$ select reset_guess_session_data('00000000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'reset_guess_session_data: not the session creator',
  'a DIFFERENT authenticated user cannot reset someone else''s session data'
);
reset role;
reset request.jwt.claim.sub;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$ select reset_guess_session_data('00000000-0000-0000-0000-0000000000a3') $$,
  'the session''s own creator CAN reset their session''s guess data'
);
reset role;
reset request.jwt.claim.sub;

select is(
  (select count(*)::int from guesses where session_id = '00000000-0000-0000-0000-0000000000a3'),
  0,
  'reset_guess_session_data deleted every guess for that session (as postgres, bypassing RLS)'
);
select is(
  (select revealed from sessions where id = '00000000-0000-0000-0000-0000000000a3'),
  false,
  'reset_guess_session_data reset revealed back to false'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select throws_ok(
  $$ select reset_guess_session_data('00000000-0000-0000-0000-000000009999') $$,
  'P0001',
  'reset_guess_session_data: not the session creator',
  'a genuinely nonexistent session_id raises the SAME exception as wrong-creator — no existence side channel'
);
reset role;
reset request.jwt.claim.sub;

-- ---------- sessions.bean_count: immutable after creation ----------

select throws_ok(
  $$ update sessions set bean_count = 999
       where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'P0001',
  'sessions.bean_count cannot be changed after creation',
  'bean_count cannot be changed after creation, even by the session''s own creator (as postgres, direct write)'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select throws_ok(
  $$ update sessions set bean_count = 999
       where id = '00000000-0000-0000-0000-0000000000a1' $$,
  'P0001',
  'sessions.bean_count cannot be changed after creation',
  'bean_count cannot be changed after creation via the RLS-permitted update path either'
);
reset role;
reset request.jwt.claim.sub;

-- ---------- submit_guess(): atomic guess+contact write (Phase 4) ----------

set local role anon;
select isa_ok(
  (select submit_guess('00000000-0000-0000-0000-0000000000a1', 'RPC Guesser', 700, '+6738003333', null)),
  'uuid',
  'submit_guess returns a uuid when it succeeds'
);
reset role;

select is(
  (select count(*)::int from guesses g join contacts c on c.guess_id = g.id
     where g.session_id = '00000000-0000-0000-0000-0000000000a1' and g.name = 'RPC Guesser'),
  1,
  'submit_guess created exactly one matching guess+contact pair (as postgres, bypassing RLS)'
);

set local role anon;
select throws_ok(
  $$ select submit_guess('00000000-0000-0000-0000-0000000000a2', 'Blocked RPC Guesser', 700, '+6738003333', null) $$,
  'P0001',
  'submit_guess: session is not open for guessing',
  'submit_guess rejects a session with guess_enabled = false'
);
select throws_ok(
  $$ select submit_guess('00000000-0000-0000-0000-0000000000a5', 'Late RPC Guesser', 700, '+6738003333', null) $$,
  'P0001',
  'submit_guess: session is not open for guessing',
  'submit_guess rejects an already-revealed session'
);
-- A syntactically-valid but genuinely nonexistent session_id must get the
-- SAME named exception, not fall through to a raw foreign-key violation.
-- app.session_is_open() itself now uses EXISTS(...) rather than a scalar
-- select + coalesce(..., false) (20260914121000_guess_the_bean_rls.sql's own
-- comment has the full account) precisely so it always returns a real
-- boolean, never NULL, for a row that doesn't exist — schema-guardian and
-- security-reviewer independently found the old NULL-vs-false gap live.
select throws_ok(
  $$ select submit_guess('00000000-0000-0000-0000-000000009999', 'Nonexistent Session Guesser', 700, '+6738003333', null) $$,
  'P0001',
  'submit_guess: session is not open for guessing',
  'submit_guess rejects a genuinely nonexistent session_id with the same named exception, not a raw FK violation'
);
reset role;

select is(
  (select count(*)::int from guesses where name in ('Blocked RPC Guesser', 'Late RPC Guesser')),
  0,
  'neither rejected submit_guess call left behind a guess row (as postgres, bypassing RLS)'
);

-- The core atomicity guarantee the spec names explicitly: a submission with
-- NEITHER phone nor instagram fails the contacts table's own
-- contact_required CHECK — proving the guesses insert rolled back TOO,
-- in the same transaction, rather than leaving an orphaned guess with no
-- contact (the exact "kill network mid-submit" failure mode a two-step
-- client-side insert pair can't rule out).
set local role anon;
select throws_ok(
  $$ select submit_guess('00000000-0000-0000-0000-0000000000a1', 'No Contact Guesser', 700, null, null) $$,
  '23514',
  null,
  'submit_guess rejects a submission with neither phone nor instagram'
);
reset role;

select is(
  (select count(*)::int from guesses where name = 'No Contact Guesser'),
  0,
  'the rejected no-contact submission left NO orphaned guess row behind — atomicity holds (as postgres, bypassing RLS)'
);

select * from finish();
rollback;
