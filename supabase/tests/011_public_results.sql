-- public_results — the user-requested "highlights/archive" public results page
-- (2026-09-17). Proves: anon can read but never write; a raw insert/update
-- bypassing the two RPCs is rejected by trg_public_results_org_check for both
-- ways it could go wrong (wrong-org event_id, and the caller's own test event); a
-- wrong-org/nonexistent event gets the same indistinguishable "not found" message
-- (mirrors 008_delete_test_event.sql's own precedent); a non-member is refused by the RPC's own org
-- check even when they pass the event's true org id (T-TEN.B6; the RLS policies behind it are
-- proven directly in 034_resolver_disclosure.sql); publishing a real event
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

-- ============ publish_event_results: a non-member is refused ============
-- Passes org 020 as BOTH the true owning org of event e9 AND p_org_id. Since T-TEN.B6 the
-- function's own ownership check refuses it (the resolver answers NULL to a non-member), the same
-- as a wrong org id. Before B6 the check passed and events_read's USING clause hid the INSERT's
-- source row, so the call succeeded with 0 rows; that silent success is gone.

-- T-TEN.B6: org_id_for_* now answers NULL for a non-member, so a non-member who passes the TRUE
-- org id is refused by the function's own check, exactly like one who passes a wrong org id. This
-- case used to reach RLS (and silently match zero rows); it no longer gets that far.
select throws_ok(
  $$ select publish_event_results(
       '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-0000000000e9', '{}'::jsonb
     ) $$,
  'P0001',
  'publish_event_results: event 00000000-0000-0000-0000-0000000000e9 not found',
  'a non-member passing the owning org id is refused as not found (same as a wrong org id)'
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

-- ============ unpublish_event_results: a non-member is refused ============
-- Since T-TEN.B6 refused by the function's own check exactly like a wrong org id (it used to
-- succeed with RLS matching zero rows, the shape 008_delete_test_event.sql used to show).

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

-- T-TEN.B6: org_id_for_* now answers NULL for a non-member, so a non-member who passes the TRUE
-- org id is refused by the function's own check, exactly like one who passes a wrong org id. This
-- case used to reach RLS (and silently match zero rows); it no longer gets that far.
select throws_ok(
  $$ select unpublish_event_results(
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1'
     ) $$,
  'P0001',
  'unpublish_event_results: event 00000000-0000-0000-0000-0000000000e1 not found',
  'a non-member passing the owning org id is refused as not found (same as a wrong org id)'
);

reset role;
select is(
  (select count(*)::int from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'the row was NOT actually removed — the call was refused by the function''s own check'
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
