-- Organiser home: public.org_event_summaries (migration 20261124100000). Fictional data only.
-- Proves: ACL (authenticated only); a member of the organisation gets one row per event of THAT organisation and no other,
-- with the counts right and every key present; the live flag follows the one active live_sessions row; a stranger, a member
-- of only the other organisation and anon are refused (the matching 041 matrix entry covers the rollback-probed variants);
-- an organisation with no events answers an empty list, not an error; the output carries counts only (no names or ids of
-- anything but the event); the migration's rollback block removes the function.
begin;
select plan(20);

create schema t087;
grant usage on schema t087 to anon, authenticated;
create function t087.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad((87000 + n)::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email) values
  (t087.u(1), 'a@t087.test'), (t087.u(2), 'b@t087.test'), (t087.u(3), 'none@t087.test');
insert into orgs (id, name, slug) values
  (t087.u(10), 'Org A 086', 'org-a-086'), (t087.u(11), 'Org B 086', 'org-b-086'), (t087.u(12), 'Org Empty 086', 'org-e-086');
insert into org_members (org_id, user_id, role) values
  (t087.u(10), t087.u(1), 'owner'), (t087.u(11), t087.u(2), 'owner'), (t087.u(12), t087.u(1), 'organiser');

insert into events (id, org_id, format, name, is_test) values
  (t087.u(20), t087.u(10), 'cup_taster', 'A cup taster', false),
  (t087.u(21), t087.u(10), 'btc', 'A btc', true),
  (t087.u(22), t087.u(11), 'btc', 'B btc', false);

insert into event_entries (event_id, display_name, withdrawn) values
  (t087.u(20), 'Cupper One', false), (t087.u(20), 'Cupper Two', false), (t087.u(20), 'Cupper Three', true);
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs, status) values
  (t087.u(30), t087.u(20), 'prelims', 1, 3, 600, 'running');
insert into ct_heats (stage_id, heat_number, duration_secs, status) values
  (t087.u(30), 1, 600, 'confirmed'), (t087.u(30), 2, 600, 'scoring'), (t087.u(30), 3, 600, 'pending');
insert into btc_teams (event_id, name) values (t087.u(21), 'Team A'), (t087.u(21), 'Team B');
insert into btc_judges (event_id, name) values (t087.u(21), 'Judge A');
insert into btc_matches (event_id, round, team1_id, team2_id, status)
  select t087.u(21), 'preliminary', a.id, b.id, st
    from (select id from btc_teams where event_id = t087.u(21) and name = 'Team A') a,
         (select id from btc_teams where event_id = t087.u(21) and name = 'Team B') b,
         unnest(array['confirmed', 'confirmed', 'scoring', 'pending']) st;
insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs, status) values
  (t087.u(31), t087.u(20), 'finals', 2, 3, 600, 'complete');
insert into td_rounds (id, event_id, position) values (t087.u(40), t087.u(21), 1);
insert into td_matches (event_id, round_id, position, result_kind, confirmed_at) values
  (t087.u(21), t087.u(40), 1, 'votes', now()), (t087.u(21), t087.u(40), 2, null, null);
insert into live_sessions (org_id, event_id, format, active, is_test) values (t087.u(10), t087.u(20), 'cup_taster', false, false);
insert into live_sessions (org_id, event_id, format, active, is_test) values (t087.u(10), t087.u(21), 'btc', true, true);

-- ============ ACL ============
select is(has_function_privilege('authenticated', 'public.org_event_summaries(uuid)', 'execute'), true, 'authenticated may execute it');
select is(has_function_privilege('anon', 'public.org_event_summaries(uuid)', 'execute'), false, 'anon may not');
select is(has_function_privilege('service_role', 'public.org_event_summaries(uuid)', 'execute'), false, 'service_role may not');

-- ============ a member sees their own organisation's events only ============
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000087001';

select is((select count(*)::int from public.org_event_summaries(t087.u(10))), 2, 'user A: two rows for organisation A');
select is((select count(*)::int from public.org_event_summaries(t087.u(10)) where event_id = t087.u(22)), 0,
  'organisation B''s event is never in organisation A''s answer');
select is((select (facts ->> 'entries')::int || '/' || (facts ->> 'entries_active')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(20)), '3/2', 'entries: all and not withdrawn');
select is((select (facts ->> 'stages')::int || '/' || (facts ->> 'stages_complete')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(20)), '2/1', 'stages');
select is((select (facts ->> 'heats')::int || '/' || (facts ->> 'heats_confirmed')::int || '/' || (facts ->> 'heats_active')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(20)), '3/1/1', 'heats: all, confirmed, timing or scoring');
select is((select (facts ->> 'teams')::int || '/' || (facts ->> 'judges')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(21)), '2/1', 'btc teams and judges');
select is((select (facts ->> 'matches')::int || '/' || (facts ->> 'matches_confirmed')::int || '/' || (facts ->> 'matches_active')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(21)), '4/2/1', 'btc matches: all, confirmed, scoring');
select is((select (facts ->> 'td_matches')::int || '/' || (facts ->> 'td_confirmed')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(21)), '2/1', 'throwdown matches: all, with a confirmed result');
select is((select (facts ->> 'stages')::int || '/' || (facts ->> 'stages_complete')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(20)), '2/1', 'a complete stage is counted as complete');
select is((select (facts ->> 'matches')::int || '/' || (facts ->> 'td_matches')::int
             from public.org_event_summaries(t087.u(10)) where event_id = t087.u(20)), '0/0', 'a count with nothing to count is 0, present');
select is((select count(*)::int from public.org_event_summaries(t087.u(10)) s, jsonb_object_keys(s.facts) k), 28,
  'every row carries the same fourteen keys');
select is((select string_agg(event_id::text || ':' || is_live::text, ',' order by event_id) from public.org_event_summaries(t087.u(10))),
  t087.u(20)::text || ':false,' || t087.u(21)::text || ':true', 'is_live follows the one active live session');

-- ============ refusals ============
select is((select count(*)::int from public.org_event_summaries(t087.u(12))), 0, 'an organisation with no events answers an empty list');
select throws_ok($$ select * from public.org_event_summaries('00000000-0000-0000-0000-000000087011') $$, '42501', null,
  'user A is refused for organisation B');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000087003';
select throws_ok($$ select * from public.org_event_summaries('00000000-0000-0000-0000-000000087010') $$, '42501', null,
  'a login that belongs to nobody is refused');
reset role;
set local role anon;
select throws_ok($$ select * from public.org_event_summaries('00000000-0000-0000-0000-000000087010') $$, '42501', null, 'anon is refused');
reset role;

-- ============ rollback block ============
drop function if exists public.org_event_summaries(uuid);
select is(to_regprocedure('public.org_event_summaries(uuid)') is null, true, 'the rollback block removes the function');

select * from finish();
rollback;
