-- T-TEN.B6: the org-id resolvers no longer disclose which org owns an object.
-- Proves: a non-member gets NULL from every public resolver for another org's event, stage,
-- heat, heat entry and BTC match (a member still gets their org id; a two-org member gets
-- both); anon cannot call them; the _internal resolvers exist, answer the real org and are
-- executable by no API role; the three org-match triggers still REFUSE a mismatch when no
-- user is signed in (the NULL trap: `<>` against a NULL resolver would have let it pass);
-- and for nine RPCs a non-member who passes the TRUE org id gets exactly the refusal a
-- caller passing a WRONG org id gets, and so does one passing NULL; a signed-in non-member
-- who writes directly to live_sessions / public_results / event_entries gets the same
-- row-level-security refusal whatever ids they name (the org-match triggers used to answer
-- "does that org own this event?" first); the row-level-security policies themselves still refuse
-- when the triggers are out of the way; a member of TWO orgs who passes the wrong one of their own
-- is refused too (the resolver answers that member a real org, so this is the arm of the guard a
-- single-org caller can never reach). Fixtures: org A, org B; user_a (A), user_b (B),
-- user_ab (both); a Cup Taster chain and a BTC match in each org.
begin;
select plan(99);

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
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Event A'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b0', 'cup_taster', 'Event B');
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000000e1', 'prelims', 1, 1, 480),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-0000000000e2', 'prelims', 1, 1, 480);
insert into ct_heats (id, stage_id, heat_number, duration_secs) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000051', 1, 480),
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000052', 1, 480);
insert into event_entries (id, event_id, display_name) values
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000e1', 'Cupper A'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-0000000000e2', 'Cupper B');
insert into ct_heat_entries (id, heat_id, entry_id, station) values
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', 'T1'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000072', 'T1');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000e1', 'A-one'),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-0000000000e1', 'A-two'),
  ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-0000000000e2', 'B-one'),
  ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-0000000000e2', 'B-two');
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
   '00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000092'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', 'preliminary',
   '00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000094');
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a0', 'Person A', '+6731000001'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b0', 'Person B', '+6732000001');

-- ============ user_b (a member of B only) asks about org A's objects ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

select is((select app.org_id_for_event('00000000-0000-0000-0000-0000000000e1')), null::uuid,
  'a non-member gets NULL for another org''s event');
select is((select app.org_id_for_stage('00000000-0000-0000-0000-000000000051')), null::uuid,
  'NULL for another org''s stage');
select is((select app.org_id_for_heat('00000000-0000-0000-0000-000000000061')), null::uuid,
  'NULL for another org''s heat');
select is((select app.org_id_for_heat_entry('00000000-0000-0000-0000-000000000081')), null::uuid,
  'NULL for another org''s heat entry');
select is((select app.org_id_for_btc_match('00000000-0000-0000-0000-0000000000a1')), null::uuid,
  'NULL for another org''s BTC match');

-- and a member still sees what they saw before
select is((select app.org_id_for_event('00000000-0000-0000-0000-0000000000e2')),
  '00000000-0000-0000-0000-0000000000b0'::uuid, 'a member still gets their own org for an event');
select is((select app.org_id_for_stage('00000000-0000-0000-0000-000000000052')),
  '00000000-0000-0000-0000-0000000000b0'::uuid, '…for a stage');
select is((select app.org_id_for_heat('00000000-0000-0000-0000-000000000062')),
  '00000000-0000-0000-0000-0000000000b0'::uuid, '…for a heat');
select is((select app.org_id_for_heat_entry('00000000-0000-0000-0000-000000000082')),
  '00000000-0000-0000-0000-0000000000b0'::uuid, '…for a heat entry');
select is((select app.org_id_for_btc_match('00000000-0000-0000-0000-0000000000a2')),
  '00000000-0000-0000-0000-0000000000b0'::uuid, '…for a BTC match');

-- ============ RPCs: the TRUE org id, a WRONG org id and NULL are refused identically ============
-- user_b is not a member of org A. The first org id is A's (the true owner of every object
-- below); the second is B's (a wrong one); the third is NULL (which used to be refused because
-- the resolver returned the real org, and slipped past once the resolver answered NULL).

select throws_ok(
  replace(c.tpl, '''@ORG@''', o.lit),
  'P0001',
  replace(c.msg, '@ORG@', o.shown),
  c.label || ' (' || o.kind || ' org id)'
)
from (values
  ('delete_test_event',
   $$ select delete_test_event('@ORG@', '00000000-0000-0000-0000-0000000000e1') $$,
   'delete_test_event: event 00000000-0000-0000-0000-0000000000e1 not found'),
  ('publish_event_results',
   $$ select publish_event_results('@ORG@', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb) $$,
   'publish_event_results: event 00000000-0000-0000-0000-0000000000e1 not found'),
  ('unpublish_event_results',
   $$ select unpublish_event_results('@ORG@', '00000000-0000-0000-0000-0000000000e1') $$,
   'unpublish_event_results: event 00000000-0000-0000-0000-0000000000e1 not found'),
  ('publish_session',
   $$ select publish_session(gen_random_uuid(), '@ORG@', '00000000-0000-0000-0000-0000000000e1',
        'cup_taster', false, '{}'::jsonb) $$,
   'publish_session: event 00000000-0000-0000-0000-0000000000e1 not found'),
  ('start_heat',
   $$ select start_heat(gen_random_uuid(), '@ORG@', '00000000-0000-0000-0000-000000000061', now()) $$,
   'start_heat: heat 00000000-0000-0000-0000-000000000061 not found'),
  ('confirm_heat',
   $$ select confirm_heat(gen_random_uuid(), '@ORG@', '00000000-0000-0000-0000-000000000061', now(), '[]'::jsonb) $$,
   'confirm_heat: heat 00000000-0000-0000-0000-000000000061 does not belong to org @ORG@'),
  ('generate_btc_bracket',
   $$ select generate_btc_bracket('@ORG@', '00000000-0000-0000-0000-0000000000e1') $$,
   'generate_btc_bracket: event not found'),
  ('record_btc_tiebreak',
   $$ select record_btc_tiebreak('@ORG@', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000091', 'x') $$,
   'record_btc_tiebreak: match not found'),
  ('update_roster_entry',
   $$ select update_roster_entry('@ORG@', '00000000-0000-0000-0000-000000000071', 'X', null, null, null, null) $$,
   'update_roster_entry: entry 00000000-0000-0000-0000-000000000071 not found')
) as c(label, tpl, msg)
cross join (values
  ('true',  '''00000000-0000-0000-0000-0000000000a0''', '00000000-0000-0000-0000-0000000000a0'),
  ('wrong', '''00000000-0000-0000-0000-0000000000b0''', '00000000-0000-0000-0000-0000000000b0'),
  ('NULL',  'null::uuid',                              '<NULL>')
) as o(kind, lit, shown);

-- NULL must not reveal whether an event exists either: a real and a missing event id get the
-- same shape of refusal (publish_session used to answer them differently).
select throws_ok(
  $$ select publish_session(gen_random_uuid(), null::uuid, '00000000-0000-0000-0000-0000000000ef',
       'cup_taster', false, '{}'::jsonb) $$,
  'P0001',
  'publish_session: event 00000000-0000-0000-0000-0000000000ef not found',
  'publish_session with a NULL org id for a MISSING event is refused the same way as for a real one'
);

-- ============ direct writes: a signed-in non-member gets the SAME refusal for every id ============
-- user_b names org A. Whether the event is really A's, is B's, or does not exist, the answer is
-- the standard row-level-security refusal, so the trigger cannot be used to ask who owns what.

select throws_ok(
  c.sql, '42501', c.msg, c.label
)
from (values
  ('live_sessions: event really in the named org',
   $$ insert into live_sessions (org_id, event_id, format)
      values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster') $$,
   'new row violates row-level security policy for table "live_sessions"'),
  ('live_sessions: event in a different org',
   $$ insert into live_sessions (org_id, event_id, format)
      values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', 'cup_taster') $$,
   'new row violates row-level security policy for table "live_sessions"'),
  ('live_sessions: event does not exist',
   $$ insert into live_sessions (org_id, event_id, format)
      values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000ef', 'cup_taster') $$,
   'new row violates row-level security policy for table "live_sessions"'),
  ('public_results: event really in the named org',
   $$ insert into public_results (org_id, event_id, payload)
      values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb) $$,
   'new row violates row-level security policy for table "public_results"'),
  ('public_results: event in a different org',
   $$ insert into public_results (org_id, event_id, payload)
      values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', '{}'::jsonb) $$,
   'new row violates row-level security policy for table "public_results"'),
  ('public_results: event does not exist',
   $$ insert into public_results (org_id, event_id, payload)
      values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000ef', '{}'::jsonb) $$,
   'new row violates row-level security policy for table "public_results"'),
  ('event_entries: event in A, person in A',
   $$ insert into event_entries (event_id, person_id, display_name)
      values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'X') $$,
   'new row violates row-level security policy for table "event_entries"'),
  ('event_entries: event in A, person in B',
   $$ insert into event_entries (event_id, person_id, display_name)
      values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'X') $$,
   'new row violates row-level security policy for table "event_entries"'),
  ('event_entries: event in A, person does not exist',
   $$ insert into event_entries (event_id, person_id, display_name)
      values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ef', 'X') $$,
   'new row violates row-level security policy for table "event_entries"'),
  ('event_entries: event does not exist, person in B',
   $$ insert into event_entries (event_id, person_id, display_name)
      values ('00000000-0000-0000-0000-0000000000ef', '00000000-0000-0000-0000-0000000000b2', 'X') $$,
   'new row violates row-level security policy for table "event_entries"')
) as c(label, sql, msg);

-- ============ user_ab (both orgs) and anon ============

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is(
  (select array[app.org_id_for_event('00000000-0000-0000-0000-0000000000e1'),
                app.org_id_for_event('00000000-0000-0000-0000-0000000000e2')]),
  array['00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0']::uuid[],
  'a member of both orgs resolves both events'
);
select is(
  (select array[app.org_id_for_btc_match('00000000-0000-0000-0000-0000000000a1'),
                app.org_id_for_btc_match('00000000-0000-0000-0000-0000000000a2')]),
  array['00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0']::uuid[],
  'and both BTC matches'
);

select lives_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000e2', 'cup_taster') $$,
  'a member (of both orgs) can still create a live session for their own org''s event'
);

select is(
  (select array[app.org_id_for_stage('00000000-0000-0000-0000-000000000051'),
                app.org_id_for_stage('00000000-0000-0000-0000-000000000052')]),
  array['00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0']::uuid[],
  'a member of both orgs resolves both stages'
);
select is(
  (select array[app.org_id_for_heat('00000000-0000-0000-0000-000000000061'),
                app.org_id_for_heat('00000000-0000-0000-0000-000000000062')]),
  array['00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0']::uuid[],
  'both heats'
);
select is(
  (select array[app.org_id_for_heat_entry('00000000-0000-0000-0000-000000000081'),
                app.org_id_for_heat_entry('00000000-0000-0000-0000-000000000082')]),
  array['00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000b0']::uuid[],
  'and both heat entries'
);

-- ============ user_ab (both orgs) names the WRONG one of their own orgs ============
-- Every object below is org B's. user_ab is a member of B, so the resolver answers them B (a real
-- org, not NULL) and the guard's `is distinct from` arm is what must refuse org A. A single-org
-- caller never reaches that arm (their resolver answers NULL), so only a two-org member can prove it.

select throws_ok(
  replace(c.tpl, '@ORG@', '00000000-0000-0000-0000-0000000000a0'),
  'P0001',
  replace(c.msg, '@ORG@', '00000000-0000-0000-0000-0000000000a0'),
  c.label || ' (a two-org member passing the wrong one of their own orgs)'
)
from (values
  ('delete_test_event',
   $$ select delete_test_event('@ORG@', '00000000-0000-0000-0000-0000000000e2') $$,
   'delete_test_event: event 00000000-0000-0000-0000-0000000000e2 not found'),
  ('publish_event_results',
   $$ select publish_event_results('@ORG@', '00000000-0000-0000-0000-0000000000e2', '{}'::jsonb) $$,
   'publish_event_results: event 00000000-0000-0000-0000-0000000000e2 not found'),
  ('unpublish_event_results',
   $$ select unpublish_event_results('@ORG@', '00000000-0000-0000-0000-0000000000e2') $$,
   'unpublish_event_results: event 00000000-0000-0000-0000-0000000000e2 not found'),
  ('publish_session',
   $$ select publish_session(gen_random_uuid(), '@ORG@', '00000000-0000-0000-0000-0000000000e2',
        'cup_taster', false, '{}'::jsonb) $$,
   'publish_session: event 00000000-0000-0000-0000-0000000000e2 not found'),
  ('start_heat',
   $$ select start_heat(gen_random_uuid(), '@ORG@', '00000000-0000-0000-0000-000000000062', now()) $$,
   'start_heat: heat 00000000-0000-0000-0000-000000000062 not found'),
  ('confirm_heat',
   $$ select confirm_heat(gen_random_uuid(), '@ORG@', '00000000-0000-0000-0000-000000000062', now(), '[]'::jsonb) $$,
   'confirm_heat: heat 00000000-0000-0000-0000-000000000062 does not belong to org @ORG@'),
  ('generate_btc_bracket',
   $$ select generate_btc_bracket('@ORG@', '00000000-0000-0000-0000-0000000000e2') $$,
   'generate_btc_bracket: event not found'),
  ('record_btc_tiebreak',
   $$ select record_btc_tiebreak('@ORG@', '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-000000000093', 'x') $$,
   'record_btc_tiebreak: match not found'),
  ('update_roster_entry',
   $$ select update_roster_entry('@ORG@', '00000000-0000-0000-0000-000000000072', 'X', null, null, null, null) $$,
   'update_roster_entry: entry 00000000-0000-0000-0000-000000000072 not found')
) as c(label, tpl, msg);

reset role;
set local request.jwt.claim.sub = '';
set local role anon;
select throws_ok(
  $$ select app.org_id_for_event('00000000-0000-0000-0000-0000000000e1') $$,
  '42501', 'permission denied for function org_id_for_event',
  'anon cannot call the resolver at all'
);
reset role;

-- ============ no user signed in (postgres, seeds, migrations: neither a user nor an API role) ============
-- The user set earlier is only a transaction-local setting; clear it so auth.uid() is NULL here
-- and in the NULL-trap section below, which is only meaningful with no caller identity.

set local request.jwt.claim.sub = '';
select is((select auth.uid()), null::uuid, 'no user is signed in for the next two sections');
select is((select app.org_id_for_event('00000000-0000-0000-0000-0000000000e1')), null::uuid,
  'with no signed-in user the public resolver answers NULL (it gates on the caller)');
select is((select app.org_id_for_event_internal('00000000-0000-0000-0000-0000000000e1')),
  '00000000-0000-0000-0000-0000000000a0'::uuid, 'the internal event resolver answers the real org regardless of caller');
select is((select app.org_id_for_stage_internal('00000000-0000-0000-0000-000000000051')),
  '00000000-0000-0000-0000-0000000000a0'::uuid, '…stage');
select is((select app.org_id_for_heat_internal('00000000-0000-0000-0000-000000000061')),
  '00000000-0000-0000-0000-0000000000a0'::uuid, '…heat');
select is((select app.org_id_for_heat_entry_internal('00000000-0000-0000-0000-000000000081')),
  '00000000-0000-0000-0000-0000000000a0'::uuid, '…heat entry');
select is((select app.org_id_for_btc_match_internal('00000000-0000-0000-0000-0000000000a1')),
  '00000000-0000-0000-0000-0000000000a0'::uuid, '…BTC match');
select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname like 'org\_id\_for\_%\_internal'
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('service_role', p.oid, 'execute')
      and p.prosecdef
      and coalesce(p.proconfig @> array['search_path=""'], false)),
  6,
  'all six internal resolvers exist (the five of T-TEN.B6 and org_id_for_person_internal, T-ID.B2), are SECURITY DEFINER with a pinned search_path, and no API role can execute them'
);

-- ============ the NULL trap: with no user, a mismatch is still refused ============

select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster') $$,
  'P0001', 'live_sessions.org_id must match the owning org of event_id',
  'a live session whose org does not match its event is refused even with no signed-in user'
);
select throws_ok(
  $$ insert into public_results (org_id, event_id, payload)
     values ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb) $$,
  'P0001', 'public_results.org_id must match the owning org of event_id',
  'a published result whose org does not match its event is refused even with no signed-in user'
);
select throws_ok(
  $$ insert into event_entries (event_id, person_id, display_name)
     values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'Cross') $$,
  'P0001', 'event_entries.person_id must belong to the same org as event_id',
  'a roster entry for another org''s person is refused even with no signed-in user'
);
select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000ef', 'cup_taster') $$,
  'P0001', 'live_sessions.org_id must match the owning org of event_id',
  'with no user, a live session for a MISSING event is refused by the trigger (not passed on a NULL comparison)'
);
select throws_ok(
  $$ insert into public_results (org_id, event_id, payload)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000ef', '{}'::jsonb) $$,
  'P0001', 'public_results.org_id must match the owning org of event_id',
  'with no user, a published result for a MISSING event is refused by the trigger'
);
select throws_ok(
  $$ insert into event_entries (event_id, person_id, display_name)
     values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ef', 'Ghost') $$,
  'P0001', 'event_entries.person_id must belong to the same org as event_id',
  'with no user, a roster entry for a MISSING person is refused by the trigger'
);
select lives_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster') $$,
  'and the matching live session is accepted'
);
select lives_ok(
  $$ insert into public_results (org_id, event_id, payload)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb) $$,
  'and the matching published result is accepted'
);
select lives_ok(
  $$ insert into event_entries (event_id, person_id, display_name)
     values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'Matching') $$,
  'and the matching roster entry is accepted'
);

-- ============ the row-level-security policies still refuse on their own ============
-- The triggers and function guards now fire first, so nothing above reaches the policies. Prove
-- them directly: a DELETE (no BEFORE trigger sits in front of it) and, with the three org-match
-- triggers switched off inside this transaction, an INSERT. Rows exist for org A from the section above.

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok($$ delete from live_sessions where org_id = '00000000-0000-0000-0000-0000000000a0' $$,
  'user_b deleting org A''s live sessions does nothing (they are invisible to a non-member)');
select lives_ok($$ delete from public_results where org_id = '00000000-0000-0000-0000-0000000000a0' $$,
  'user_b deleting org A''s published results does nothing');
select lives_ok($$ delete from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'user_b deleting org A''s roster entries does nothing');
reset role;
select is((select count(*)::int from live_sessions where org_id = '00000000-0000-0000-0000-0000000000a0'), 1, 'org A''s live session survived');
select is((select count(*)::int from public_results where org_id = '00000000-0000-0000-0000-0000000000a0'), 1, 'org A''s published result survived');
select is((select count(*)::int from event_entries where event_id = '00000000-0000-0000-0000-0000000000e1' and display_name = 'Matching'), 1,
  'org A''s roster entry survived');

alter table live_sessions disable trigger trg_live_sessions_org_check;
alter table public_results disable trigger trg_public_results_org_check;
alter table event_entries disable trigger trg_event_entries_person_org_check;
set local role authenticated;
select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster') $$,
  '42501', 'new row violates row-level security policy for table "live_sessions"',
  'with the trigger out of the way, live_sessions_write''s WITH CHECK alone refuses a non-member''s insert'
);
select throws_ok(
  $$ insert into public_results (org_id, event_id, payload)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "public_results"',
  'public_results_org''s WITH CHECK alone refuses it'
);
select throws_ok(
  $$ insert into event_entries (event_id, display_name)
     values ('00000000-0000-0000-0000-0000000000e1', 'Intruder') $$,
  '42501', 'new row violates row-level security policy for table "event_entries"',
  'event_entries_write''s WITH CHECK alone refuses it'
);
reset role;
alter table live_sessions enable trigger trg_live_sessions_org_check;
alter table public_results enable trigger trg_public_results_org_check;
alter table event_entries enable trigger trg_event_entries_person_org_check;

-- ============ an API-role session with NO resolvable user id is gated too ============
-- A token can reach the database as role `authenticated` with an empty `sub`. The gate must not
-- depend on auth.uid() alone: such a session is not a trusted no-user writer (postgres, seeds),
-- so it gets the same standard refusal for every id instead of the strict, discriminating check.

set local role authenticated;
set local request.jwt.claim.sub = '';
select is((select auth.uid()), null::uuid, 'this section really has no user id (auth.uid() is NULL)');
select is(current_setting('role'), 'authenticated', '…and really runs as the authenticated API role');
select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', 'cup_taster') $$,
  '42501', 'new row violates row-level security policy for table "live_sessions"',
  'authenticated with no user id: live session for an event really in the named org'
);
select throws_ok(
  $$ insert into live_sessions (org_id, event_id, format)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', 'cup_taster') $$,
  '42501', 'new row violates row-level security policy for table "live_sessions"',
  'authenticated with no user id: …for an event in a different org gives the SAME answer'
);
select throws_ok(
  $$ insert into public_results (org_id, event_id, payload)
     values ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', '{}'::jsonb) $$,
  '42501', 'new row violates row-level security policy for table "public_results"',
  'authenticated with no user id: a published result is refused the same way'
);
select throws_ok(
  $$ insert into event_entries (event_id, person_id, display_name)
     values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'X') $$,
  '42501', 'new row violates row-level security policy for table "event_entries"',
  'authenticated with no user id: a roster entry is refused the same way'
);
reset role;

-- ============ every RPC that checks p_org_id against a resolver carries the NULL guard ============
-- A behavioural test cannot see the guard in the RPCs whose later row-level-security step throws the
-- same message, so count it in the source: all nineteen, none left on the bare form.

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and 'p_org_id' = any (p.proargnames)
      and p.prosrc ~ 'app\.org_id_for_'),
  22,
  'twenty-two public RPCs take p_org_id and check it against a resolver (the nineteen of T-TEN.B6, link_person_identity, T-ID.B2, stage_archive_payload, T-ARC.2, and set_archive_listing, T-ARC.3)'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and 'p_org_id' = any (p.proargnames)
      and p.prosrc ~ 'p_org_id is null or p_org_id is distinct from app\.org_id_for_'),
  21,
  'and the twenty-one of them other than link_person_identity carry the p_org_id NULL guard (link_person_identity opens with app.refuse_non_member instead, which refuses a NULL organisation as a non-member: 062 pins it)'
);

-- ============ the public resolvers keep their shape ============

select is(
  (select count(*)::int
     from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and p.proname in ('org_id_for_event', 'org_id_for_stage', 'org_id_for_heat', 'org_id_for_heat_entry', 'org_id_for_btc_match')
      and p.prosecdef
      and coalesce(p.proconfig @> array['search_path=""'], false)
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')),
  5,
  'the five public resolvers stay SECURITY DEFINER, pinned, executable by authenticated (policies need it) and not by anon'
);

select * from finish();
rollback;
