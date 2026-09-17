-- public_results — the user-requested "highlights/archive" public results page
-- (2026-09-17). Proves: anon can read but never write; a raw insert/update
-- bypassing the two RPCs is rejected by trg_public_results_org_check for both
-- ways it could go wrong (wrong-org event_id, and the caller's own test event); a
-- wrong-org/nonexistent event gets the same indistinguishable "not found" message
-- (mirrors 008_delete_test_event.sql's own precedent); a non-member is rejected by
-- RLS even when the RPC's own org check is satisfied; publishing a real event
-- works and republishing upserts in place; a real event's genuine publish/unpublish
-- round-trip is visible to anon exactly when expected.
begin;
select plan(18);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'organiser@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'stranger@test.seduh-next');
  -- 002 is a real, valid user — just never made a member of Test Org

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser');
  -- the caller below is NOT a member of Other Org

insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Real Event', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000010',
   'cup_taster', 'Own Test Event', true),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-000000000020',
   'cup_taster', 'Other Org Event', false);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ raw-insert bypass: wrong org_id/event_id pairing is rejected ============
-- Proves trg_public_results_org_check, not just the RPCs — an org member could
-- otherwise INSERT directly, claiming another org's event as their own.

select throws_ok(
  $$ insert into public_results (org_id, event_id, payload) values (
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e9', '{}'::jsonb
     ) $$,
  null,
  'public_results.org_id must match the owning org of event_id',
  'a raw insert claiming another org''s event is rejected by the trigger'
);

-- ============ raw-insert bypass: the caller's OWN test event is rejected too ============
-- Proves the trigger closes the is_test bypass a raw insert would otherwise have,
-- not just the org mismatch — publish_event_results' own guard is not the only
-- thing stopping this.

select throws_ok(
  $$ insert into public_results (org_id, event_id, payload) values (
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2', '{}'::jsonb
     ) $$,
  'P0001',
  'public_results: refusing to publish a test event (00000000-0000-0000-0000-0000000000e2)',
  'a raw insert of the caller''s own test event is rejected by the trigger, bypassing the RPC entirely'
);

-- ============ publish_event_results: wrong-org caller rejected, indistinguishable from not-found ============

select throws_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e9', '{}'::jsonb
     ) $$,
  null,
  'publish_event_results: event 00000000-0000-0000-0000-0000000000e9 not found',
  'a caller cannot publish an event that belongs to a different org'
);

select throws_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000fff', '{}'::jsonb
     ) $$,
  null,
  'publish_event_results: event 00000000-0000-0000-0000-000000000fff not found',
  'a nonexistent event is rejected with the same message as a wrong-org one'
);

-- ============ publish_event_results: a non-member is rejected by RLS ============
-- Passes org 020 as BOTH the true owning org of event e9 AND p_org_id, so the
-- function's own ownership check passes — this isolates RLS as the actual gate.
-- The INSERT ... SELECT ... FROM events source is hidden entirely by events_read's
-- own USING clause for a non-member, so this call succeeds (0 rows), not a thrown
-- 42501 — same "INSERT vs DELETE" distinction 008_delete_test_event.sql's own
-- comment makes, confirmed here to hold for an INSERT ... SELECT source too.

select lives_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e9', '{}'::jsonb
     ) $$,
  'the call itself does not error — events_read''s own RLS hides the source row from a non-member'
);

reset role;
select is(
  (select count(*)::int from public_results where event_id = '00000000-0000-0000-0000-0000000000e9'),
  0,
  'the non-member''s publish attempt inserted nothing'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ publish_event_results: a test event is refused ============

select throws_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e2', '{}'::jsonb
     ) $$,
  'P0001',
  'publish_event_results: refusing to publish a test event (00000000-0000-0000-0000-0000000000e2)',
  'a real org member cannot publish their own test event'
);

-- ============ publish_event_results: a genuine publish succeeds, anon can read it ============

select lives_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1',
       '{"podium":[{"rank":1,"name":"First Winner"}]}'::jsonb
     ) $$,
  'a real org member can publish their own real event'
);

select is(
  (select payload->'podium'->0->>'name' from public_results
    where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'First Winner',
  'the payload was stored as given'
);

set local role anon;
select is(
  (select count(*)::int from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'anon can read the published row'
);
select throws_ok(
  $$ insert into public_results (org_id, event_id, payload) values (
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb
     ) $$,
  null,
  null,
  'anon cannot write to public_results'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ============ republish upserts in place — never a second row ============

select lives_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1',
       '{"podium":[{"rank":1,"name":"Updated Winner"}]}'::jsonb
     ) $$,
  'republishing the same event succeeds'
);

select is(
  (select count(*)::int from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'still exactly one row for this event — an upsert, not a second row'
);

select is(
  (select payload->'podium'->0->>'name' from public_results
    where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Updated Winner',
  'the payload was overwritten, not merged or duplicated'
);

-- ============ unpublish_event_results: a non-member is rejected by RLS ============
-- Same "call succeeds, but RLS matches zero rows" shape as
-- 008_delete_test_event.sql's own non-member DELETE case.

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ select unpublish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  'the call itself does not error — public_results_org''s own USING clause hides the row from a non-member'
);

reset role;
select is(
  (select count(*)::int from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'the row was NOT actually removed — a non-member''s unpublish matched zero rows under RLS'
);

-- ============ unpublish_event_results: the real organiser can remove their own published row ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select unpublish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  'the real organiser can unpublish their own event'
);

reset role;
select is(
  (select count(*)::int from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'the row is genuinely gone'
);

select * from finish();
rollback;
