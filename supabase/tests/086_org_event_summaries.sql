-- Organiser home: public.org_event_summaries (migration 20261123100000). Fictional data only.
-- Proves: ACL (authenticated only); a member of the organisation gets one row per event of THAT organisation and no other,
-- with the counts right and every key present; the live flag follows the one active live_sessions row; a stranger, a member
-- of only the other organisation and anon are refused (the matching 041 matrix entry covers the rollback-probed variants);
-- an organisation with no events answers an empty list, not an error; the output carries counts only (no names or ids of
-- anything but the event); the migration's rollback block removes the function.
begin;
select plan(17);

create schema t086;
grant usage on schema t086 to anon, authenticated;
create function t086.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad((86000 + n)::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email) values
  (t086.u(1), 'a@t086.test'), (t086.u(2), 'b@t086.test'), (t086.u(3), 'none@t086.test');
insert into orgs (id, name, slug) values
  (t086.u(10), 'Org A 086', 'org-a-086'), (t086.u(11), 'Org B 086', 'org-b-086'), (t086.u(12), 'Org Empty 086', 'org-e-086');
insert into org_members (org_id, user_id, role) values
  (t086.u(10), t086.u(1), 'owner'), (t086.u(11), t086.u(2), 'owner'), (t086.u(12), t086.u(1), 'organiser');

insert into events (id, org_id, format, name, is_test) values
  (t086.u(20), t086.u(10), 'cup_taster', 'A cup taster', false),
  (t086.u(21), t086.u(10), 'btc', 'A btc', true),
  (t086.u(22), t086.u(11), 'btc', 'B btc', false);

insert into event_entries (event_id, display_name, withdrawn) values
  (t086.u(20), 'Cupper One', false), (t086.u(20), 'Cupper Two', false), (t086.u(20), 'Cupper Three', true);
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs, status) values
  (t086.u(30), t086.u(20), 'prelims', 1, 3, 600, 'running');
insert into ct_heats (stage_id, heat_number, duration_secs, status) values
  (t086.u(30), 1, 600, 'confirmed'), (t086.u(30), 2, 600, 'scoring'), (t086.u(30), 3, 600, 'pending');
insert into btc_teams (event_id, name) values (t086.u(21), 'Team A'), (t086.u(21), 'Team B');
insert into btc_judges (event_id, name) values (t086.u(21), 'Judge A');
insert into live_sessions (org_id, event_id, format, active, is_test) values (t086.u(10), t086.u(21), 'btc', true, true);

-- ============ ACL ============
select is(has_function_privilege('authenticated', 'public.org_event_summaries(uuid)', 'execute'), true, 'authenticated may execute it');
select is(has_function_privilege('anon', 'public.org_event_summaries(uuid)', 'execute'), false, 'anon may not');
select is(has_function_privilege('service_role', 'public.org_event_summaries(uuid)', 'execute'), false, 'service_role may not');

-- ============ a member sees their own organisation's events only ============
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000086001';

select is((select count(*)::int from public.org_event_summaries(t086.u(10))), 2, 'user A: two rows for organisation A');
select is((select count(*)::int from public.org_event_summaries(t086.u(10)) where event_id = t086.u(22)), 0,
  'organisation B''s event is never in organisation A''s answer');
select is((select (facts ->> 'entries')::int || '/' || (facts ->> 'entries_active')::int
             from public.org_event_summaries(t086.u(10)) where event_id = t086.u(20)), '3/2', 'entries: all and not withdrawn');
select is((select (facts ->> 'stages')::int || '/' || (facts ->> 'stages_complete')::int
             from public.org_event_summaries(t086.u(10)) where event_id = t086.u(20)), '1/0', 'stages');
select is((select (facts ->> 'heats')::int || '/' || (facts ->> 'heats_confirmed')::int || '/' || (facts ->> 'heats_active')::int
             from public.org_event_summaries(t086.u(10)) where event_id = t086.u(20)), '3/1/1', 'heats: all, confirmed, timing or scoring');
select is((select (facts ->> 'teams')::int || '/' || (facts ->> 'judges')::int
             from public.org_event_summaries(t086.u(10)) where event_id = t086.u(21)), '2/1', 'btc teams and judges');
select is((select (facts ->> 'matches')::int + (facts ->> 'td_matches')::int
             from public.org_event_summaries(t086.u(10)) where event_id = t086.u(21)), 0, 'a count with nothing to count is 0, present');
select is((select count(*)::int from public.org_event_summaries(t086.u(10)) s, jsonb_object_keys(s.facts) k where s.event_id = t086.u(20)), 14,
  'every row carries the same fourteen keys');
select is((select string_agg(event_id::text || ':' || is_live::text, ',' order by event_id) from public.org_event_summaries(t086.u(10))),
  t086.u(20)::text || ':false,' || t086.u(21)::text || ':true', 'is_live follows the one active live session');

-- ============ refusals ============
select is((select count(*)::int from public.org_event_summaries(t086.u(12))), 0, 'an organisation with no events answers an empty list');
select throws_ok($$ select * from public.org_event_summaries('00000000-0000-0000-0000-000000086011') $$, '42501', null,
  'user A is refused for organisation B');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000086003';
select throws_ok($$ select * from public.org_event_summaries('00000000-0000-0000-0000-000000086010') $$, '42501', null,
  'a login that belongs to nobody is refused');
reset role;
set local role anon;
select throws_ok($$ select * from public.org_event_summaries('00000000-0000-0000-0000-000000086010') $$, '42501', null, 'anon is refused');
reset role;

-- ============ rollback block ============
drop function if exists public.org_event_summaries(uuid);
select is(to_regprocedure('public.org_event_summaries(uuid)') is null, true, 'the rollback block removes the function');

select * from finish();
rollback;
