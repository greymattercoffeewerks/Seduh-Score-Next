-- T-TEN.B1: org_id is immutable on every tenant table.
-- Proves: a user who belongs to BOTH orgs (the case row-level security alone cannot tell
-- apart) cannot move a row from org A to org B by changing org_id, nor by pointing a
-- live_sessions / public_results row at another event; the refusal leaves the row exactly
-- where it was; ordinary same-org edits and the real upsert path still work; a one-org
-- member cannot move their OWN row out (the freeze, not RLS, is what refuses it); anon is
-- refused; the tables with no API write path (org_members, processed_operations,
-- team_removed_members) refuse it for any writer. Every refusal pins the error text, so a
-- refusal for some other reason cannot pass for this one. Where an EXISTING check trigger
-- (not the new freeze) is what refuses a case, the assertion says so.
-- Fixtures: org A (events A1, A2), org B (event B1); user_a (A only), user_b (B only),
-- user_ab (both).
begin;
select plan(31);

-- ============ fixtures (as postgres, bypasses RLS) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'user-b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'user-ab@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Org A', 'org-a'),
  ('00000000-0000-0000-0000-0000000000b0', 'Org B', 'org-b');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000003', 'organiser');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A1'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A2'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Event B1');
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000a0', 'Person A', '+6731000001'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000a0', 'Person A2', '+6731000002'),
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000b0', 'Person B', '+6732000001');
insert into person_merges (id, org_id, kept_id, merged_id, merged_name) values
  ('00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-0000000000a0',
   '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a99', 'Gone');
insert into processed_operations (id, org_id, kind) values
  ('00000000-0000-0000-0000-000000000a21', '00000000-0000-0000-0000-0000000000a0', 'publish_session');
insert into team_removed_members (org_id, user_id) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000002');
insert into live_sessions (id, org_id, event_id, format, active) values
  ('00000000-0000-0000-0000-000000000a31', '00000000-0000-0000-0000-0000000000a0',
   '00000000-0000-0000-0000-0000000000e1', 'cup_taster', true);
insert into public_results (id, org_id, event_id, payload) values
  ('00000000-0000-0000-0000-000000000a41', '00000000-0000-0000-0000-0000000000a0',
   '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb);

-- ============ user_ab (a member of BOTH orgs) cannot move a row between them ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ update people set org_id = '00000000-0000-0000-0000-0000000000b0'
     where id = '00000000-0000-0000-0000-000000000a01' $$,
  '23001', 'people.org_id is immutable',
  'a two-org member cannot move a person to their other org'
);
select throws_ok(
  $$ update person_merges
        set org_id = '00000000-0000-0000-0000-0000000000b0',
            kept_id = '00000000-0000-0000-0000-000000000b01'
      where id = '00000000-0000-0000-0000-000000000a11' $$,
  '23001', 'person_merges.org_id is immutable',
  'a two-org member cannot move a person-merge record to their other org (even with a kept person that matches)'
);
select throws_ok(
  $$ update person_merges set org_id = '00000000-0000-0000-0000-0000000000b0'
      where id = '00000000-0000-0000-0000-000000000a11' $$,
  'P0001', 'person_merges.kept_id must belong to the same org as org_id',
  'changing only its org is refused by the EXISTING kept-person check (the kept person no longer matches)'
);
select throws_ok(
  $$ update events set org_id = '00000000-0000-0000-0000-0000000000b0'
     where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23001', 'events.org_id is immutable',
  'a two-org member cannot move an event to their other org (the existing protection still holds)'
);

-- live_sessions: moving org and event together is the move the old org check allowed (the org
-- matched the NEW event); the freeze now refuses it. An event change within the same org is
-- refused ONLY by the freeze (the org check has nothing to say about it).
select throws_ok(
  $$ update live_sessions
        set org_id = '00000000-0000-0000-0000-0000000000b0',
            event_id = '00000000-0000-0000-0000-0000000000e2'
      where id = '00000000-0000-0000-0000-000000000a31' $$,
  '23001', 'live_sessions.org_id is immutable',
  'a two-org member cannot move a live session to the other org''s event and org'
);
select throws_ok(
  $$ update live_sessions set org_id = '00000000-0000-0000-0000-0000000000b0'
      where id = '00000000-0000-0000-0000-000000000a31' $$,
  'P0001', 'live_sessions.org_id must match the owning org of event_id',
  'changing only its org is refused by the EXISTING org check'
);
select throws_ok(
  $$ update live_sessions set event_id = '00000000-0000-0000-0000-0000000000e3'
      where id = '00000000-0000-0000-0000-000000000a31' $$,
  '23001', 'live_sessions.event_id is immutable',
  'pointing it at another event of the SAME org is refused by the new freeze alone'
);
select throws_ok(
  $$ update live_sessions set event_id = '00000000-0000-0000-0000-0000000000e2'
      where id = '00000000-0000-0000-0000-000000000a31' $$,
  'P0001', 'live_sessions.org_id must match the owning org of event_id',
  'pointing it at the other org''s event is refused by the existing org check'
);

select throws_ok(
  $$ update public_results
        set org_id = '00000000-0000-0000-0000-0000000000b0',
            event_id = '00000000-0000-0000-0000-0000000000e2'
      where id = '00000000-0000-0000-0000-000000000a41' $$,
  '23001', 'public_results.org_id is immutable',
  'a two-org member cannot move a published result to the other org''s event and org'
);
select throws_ok(
  $$ update public_results set org_id = '00000000-0000-0000-0000-0000000000b0'
      where id = '00000000-0000-0000-0000-000000000a41' $$,
  'P0001', 'public_results.org_id must match the owning org of event_id',
  'changing only its org is refused by the EXISTING org check'
);
select throws_ok(
  $$ update public_results set event_id = '00000000-0000-0000-0000-0000000000e3'
      where id = '00000000-0000-0000-0000-000000000a41' $$,
  '23001', 'public_results.event_id is immutable',
  'pointing it at another event of the SAME org is refused by the new freeze alone'
);
select throws_ok(
  $$ update public_results set event_id = '00000000-0000-0000-0000-0000000000e2'
      where id = '00000000-0000-0000-0000-000000000a41' $$,
  'P0001', 'public_results.org_id must match the owning org of event_id',
  'pointing it at the other org''s event is refused by the existing org check'
);

-- ============ ordinary edits are unaffected ============

select lives_ok(
  $$ update people set display_name = 'Person A (renamed)' where id = '00000000-0000-0000-0000-000000000a01' $$,
  'a same-org edit of a person still works'
);
select lives_ok(
  $$ update live_sessions set active = false where id = '00000000-0000-0000-0000-000000000a31' $$,
  'a same-org edit of a live session still works'
);
select lives_ok(
  $$ update public_results set payload = '{"v":2}'::jsonb where id = '00000000-0000-0000-0000-000000000a41' $$,
  'a same-org edit of a published result still works'
);
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0',
       '00000000-0000-0000-0000-0000000000e1', '{"v":3}'::jsonb) $$,
  'republishing (the real on-conflict update path) still works'
);

-- ============ user_a (one org only) ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ update people set org_id = '00000000-0000-0000-0000-0000000000b0'
      where id = '00000000-0000-0000-0000-000000000a01' $$,
  '23001', 'people.org_id is immutable',
  'a one-org member cannot move their OWN row out either (the freeze refuses it, not row-level security)'
);
select lives_ok(
  $$ update people set org_id = '00000000-0000-0000-0000-0000000000a0'
      where id = '00000000-0000-0000-0000-000000000b01' $$,
  'user_a trying to pull org B''s person into org A does nothing (it is invisible to them)'
);

-- ============ anon ============

reset role;
set local role anon;
select throws_ok(
  $$ update people set org_id = '00000000-0000-0000-0000-0000000000b0'
      where id = '00000000-0000-0000-0000-000000000a01' $$,
  '42501', null,
  'anon cannot update a person at all'
);

-- ============ the rows are exactly where they were ============

reset role;
select is(
  (select org_id from people where id = '00000000-0000-0000-0000-000000000a01'),
  '00000000-0000-0000-0000-0000000000a0'::uuid,
  'the person is still in org A'
);
select is(
  (select org_id from people where id = '00000000-0000-0000-0000-000000000b01'),
  '00000000-0000-0000-0000-0000000000b0'::uuid,
  'org B''s person is still in org B'
);
select is(
  (select org_id from person_merges where id = '00000000-0000-0000-0000-000000000a11'),
  '00000000-0000-0000-0000-0000000000a0'::uuid,
  'the person-merge record is still in org A'
);
select is(
  (select org_id::text || '/' || event_id::text from live_sessions where id = '00000000-0000-0000-0000-000000000a31'),
  '00000000-0000-0000-0000-0000000000a0/00000000-0000-0000-0000-0000000000e1',
  'the live session is still on org A''s first event'
);
select is(
  (select org_id::text || '/' || event_id::text from public_results where id = '00000000-0000-0000-0000-000000000a41'),
  '00000000-0000-0000-0000-0000000000a0/00000000-0000-0000-0000-0000000000e1',
  'the published result is still on org A''s first event'
);
select is(
  (select payload ->> 'v' from public_results where id = '00000000-0000-0000-0000-000000000a41'),
  '3',
  'and the republish really replaced the payload (not a no-op)'
);

-- ============ tables with no API write path refuse it for ANY writer ============

select throws_ok(
  $$ update org_members set org_id = '00000000-0000-0000-0000-0000000000b0'
      where org_id = '00000000-0000-0000-0000-0000000000a0'
        and user_id = '00000000-0000-0000-0000-000000000003' $$,
  '23001', 'org_members.org_id is immutable',
  'a membership cannot be moved to another org, even by postgres'
);
select throws_ok(
  $$ update org_members set user_id = '00000000-0000-0000-0000-000000000001'
      where org_id = '00000000-0000-0000-0000-0000000000b0'
        and user_id = '00000000-0000-0000-0000-000000000003' $$,
  '23001', 'org_members.user_id is immutable',
  'nor re-pointed at a different user'
);
select throws_ok(
  $$ update processed_operations set org_id = '00000000-0000-0000-0000-0000000000b0'
      where id = '00000000-0000-0000-0000-000000000a21' $$,
  '23001', 'processed_operations.org_id is immutable',
  'a processed-operation record cannot be moved to another org'
);
select throws_ok(
  $$ update team_removed_members set org_id = '00000000-0000-0000-0000-0000000000b0'
      where org_id = '00000000-0000-0000-0000-0000000000a0' $$,
  '23001', 'team_removed_members.org_id is immutable',
  'a removed-member marker cannot be moved to another org'
);
-- The service role must be refused too, but WHICH refusal depends on its table grants (a
-- local stack may grant it no UPDATE on memberships: 42501; CI's does, so it reaches the
-- freeze: 23001). Either is a refusal; anything else, including success, fails the test.
set local role service_role;
select lives_ok(
  $$ do $b$
     begin
       update org_members set org_id = '00000000-0000-0000-0000-0000000000b0'
        where org_id = '00000000-0000-0000-0000-0000000000a0';
       raise exception 'the service role moved a membership to another org' using errcode = 'XX000';
     exception when sqlstate '42501' or sqlstate '23001' then
       null;
     end $b$ $$,
  'the service role cannot move a membership to another org either (refused by grant or by the freeze)'
);
reset role;
select is(
  (select count(*)::int from org_members
    where org_id = '00000000-0000-0000-0000-0000000000a0' and user_id = '00000000-0000-0000-0000-000000000003'),
  1,
  'and the membership is still in org A'
);

select * from finish();
rollback;
