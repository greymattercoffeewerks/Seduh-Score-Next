-- T5.1 publish_session — handoff §5.3/§8/§9.
-- Proves: a wrong-org caller is rejected before anything is written,
-- publishing an event's session actually activates it, publishing a SECOND
-- event for the same org atomically deactivates the first (the
-- live_sessions_one_active_per_org invariant a plain client-side upsert
-- can't satisfy across two rows), and a retried operation id is a safe
-- no-op rather than a second write. Runs under a real `authenticated` role
-- with RLS actually in force throughout, matching 005_confirm_heat.sql's
-- own precedent.
begin;
select plan(18);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next');

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- the caller below is NOT a member of Other Org

insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Test Event A', true),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Test Event B', false),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000020',
   'cup_taster', 'Other Org Event', false);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ a wrong-org caller writes nothing ============
-- Reads as "not found," not a distinct "wrong org" message — deliberately;
-- see the migration's own comment on this check for why.

select throws_ok(
  $$ select publish_session(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000e9', 'cup_taster', false, '{}'::jsonb
     ) $$,
  null,
  'publish_session: event 00000000-0000-0000-0000-0000000000e9 not found',
  'a caller cannot publish an event that belongs to a different org'
);

select is(
  (select count(*)::int from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e9'),
  0,
  'nothing was written for the wrong-org event'
);

-- ============ a nonexistent event is rejected with a clear message, not a raw FK error ============
-- The same check the wrong-org case above hits (app.org_id_for_event
-- returns null for a missing event; `is distinct from` is what makes that
-- null-safe) — a plain `<>` would have silently fallen through to a raw
-- foreign-key-violation on the insert instead (found in review).

select throws_ok(
  $$ select publish_session(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-000000000fff', 'cup_taster', false, '{}'::jsonb
     ) $$,
  null,
  'publish_session: event 00000000-0000-0000-0000-000000000fff not found',
  'a nonexistent event is rejected with its own clear message, not a raw constraint error'
);

select is(
  (select count(*)::int from live_sessions where event_id = '00000000-0000-0000-0000-000000000fff'),
  0,
  'nothing was written for the nonexistent event'
);

-- ============ a non-member is rejected even with the event's own correct org id ============
-- Unlike the wrong-org case above (a mismatched org_id/event_id pair, caught
-- by the function's own explicit check), this passes org 020 as BOTH the
-- true owning org of event e9 AND p_org_id — so the function's own ownership
-- check passes, and it's live_sessions_write's RLS WITH CHECK that must
-- reject the actual INSERT, since the caller (a member of org 010 only) is
-- not a member of org 020. Proves the RLS backstop actually fires, not just
-- the function's own application-level guard.

select throws_ok(
  $$ select publish_session(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000e9', 'cup_taster', false, '{}'::jsonb
     ) $$,
  '42501',
  null,
  'a non-member is rejected by RLS even when org_id correctly matches the event''s own org'
);

select is(
  (select count(*)::int from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e9'),
  0,
  'nothing was written for the non-member''s correctly-addressed call either'
);

-- ============ a genuine publish activates the session, propagating is_test ============

select lives_ok(
  $$ select publish_session(
       '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000e1', 'cup_taster', true,
       '{"stage":"prelims"}'::jsonb
     ) $$,
  'a real org member can publish their own event'
);

select is(
  (select active from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e1'),
  true,
  'the session is active'
);

select is(
  (select is_test from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e1'),
  true,
  'is_test was propagated from the caller-supplied flag'
);

select is(
  (select format from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'cup_taster',
  'format was stored as given'
);

-- ============ publishing a second event for the same org deactivates the first ============
-- Proves the FINAL state after one complete, successful call: Event A
-- inactive, Event B active — never both, never neither. (This alone doesn't
-- prove atomicity — a naive two-statement, non-transactional sequence would
-- produce the same final state when nothing fails partway through. The
-- actual atomicity proof, that a failure partway through rolls back the
-- deactivate too, is the forced-failure block further below.)

select lives_ok(
  $$ select publish_session(
       '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000e2', 'cup_taster', false,
       '{"stage":"finals"}'::jsonb
     ) $$,
  'publishing a second event for the same org succeeds'
);

select is(
  (select active from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e1'),
  false,
  'the first event''s session was deactivated by publishing the second'
);

select is(
  (select active from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e2'),
  true,
  'the second event''s session is now the active one'
);

select is(
  (select count(*)::int from live_sessions
     where org_id = '00000000-0000-0000-0000-000000000010' and active),
  1,
  'exactly one session is active for the org — never zero, never two'
);

-- ============ a failure partway through rolls back the deactivate too ============
-- The actual atomicity proof: Event B is currently the active session for
-- this org. Publishing Event A again with a null format must fail
-- (format is not null) on the insert/update — AFTER the deactivate-others
-- update has already run inside the same function call. If that update
-- were not rolled back along with the failed insert, Event B would be left
-- incorrectly deactivated with nothing else active in its place.

select throws_ok(
  $$ select publish_session(
       gen_random_uuid(), '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000e1', null, false, '{}'::jsonb
     ) $$,
  '23502',
  null,
  'publishing with a null format fails on the not-null constraint'
);

select is(
  (select active from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e2'),
  true,
  'Event B is still active — the failed call''s own deactivate-others update was rolled back too, not left applied'
);

-- ============ retry after timeout does not duplicate or re-apply ============
-- Same operation id, replayed with a DIFFERENT payload — a genuine no-op
-- must leave the FIRST call's payload untouched, not silently apply the
-- second call's data under the guise of "idempotent."

select lives_ok(
  $$ select publish_session(
       '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000e2', 'cup_taster', false,
       '{"stage":"should not apply"}'::jsonb
     ) $$,
  'replaying the same operation id is a safe no-op, not an error'
);

select is(
  (select payload from live_sessions where event_id = '00000000-0000-0000-0000-0000000000e2'),
  '{"stage":"finals"}'::jsonb,
  'the retried call''s payload was NOT applied — the operation was already processed'
);

reset role;

select * from finish();
rollback;
