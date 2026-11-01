-- T-ARC.4c: public.archive_event_status(p_org_id, p_event_ids), the member-readable archive status (migration
-- 20261101160000_archive_event_status.sql). Proves:
--   * a member gets one row per requested event with exactly the pinned columns, and the right figures for every ledger state
--     (none, pending, retrying, failed, stubbed with each stub reason, published, skipped, removed, removed then re-published,
--     the saved tick box, the due time from the ledger or from ended_at);
--   * the reason is a WHITELIST: a SQLSTATE or an internal code in last_error never comes out, a staged snapshot's contents and
--     any error text never appear in the answer;
--   * a non-member, a stranger, an unknown or NULL organisation, a two-organisation user mixing the two, a missing, NULL or
--     another organisation's event id, and anon are all refused (42501, the standard refusal) and learn nothing; a bad list is 22023;
--   * it only reads: no row changes, and the ACL / definer / search_path / read-only volatility are pinned.
-- One transaction; the shared local database may hold other rows, so only this test's ids are counted.
begin;
select plan(49);

create schema t070;
grant usage on schema t070 to anon, authenticated;
create function t070.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000700' || lpad(n::text, 4, '0'))::uuid
$$;

-- "SQLSTATE|hint" of a statement run as a signed-in member (uid) or anon (uid null), or 'ok'; the role is always restored
create function t070.try(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := sqlstate || '|' || coalesce(h, '');
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;

-- the JSON of the answer for the given events (as a member), keyed by event id, or the error
create function t070.ask(uid uuid, org uuid, ids uuid[]) returns jsonb language plpgsql as $$
declare res jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  select coalesce(jsonb_object_agg(r.event_id, to_jsonb(r) - 'event_id'), '{}'::jsonb) into res
    from public.archive_event_status(org, ids) r;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;
grant execute on all functions in schema t070 to anon, authenticated;

insert into auth.users (id, email) values
  (t070.u(1), 't070-x@example.test'), (t070.u(2), 't070-y@example.test'), (t070.u(3), 't070-none@example.test'),
  (t070.u(4), 't070-xy@example.test');
insert into orgs (id, name, slug) values (t070.u(100), 'T070 X', 't070-x'), (t070.u(200), 'T070 Y', 't070-y');
insert into org_members (org_id, user_id, role) values
  (t070.u(100), t070.u(1), 'organiser'), (t070.u(200), t070.u(2), 'organiser'),
  (t070.u(100), t070.u(4), 'organiser'), (t070.u(200), t070.u(4), 'organiser');

insert into events (id, org_id, format, name) values
  (t070.u(1), t070.u(100), 'cup_taster', 'E1 no ledger, not ended'),
  (t070.u(2), t070.u(100), 'cup_taster', 'E2 no ledger, ended'),
  (t070.u(3), t070.u(100), 'cup_taster', 'E3 pending, ticked list'),
  (t070.u(4), t070.u(100), 'cup_taster', 'E4 stubbed no snapshot'),
  (t070.u(5), t070.u(100), 'cup_taster', 'E5 failed'),
  (t070.u(6), t070.u(100), 'cup_taster', 'E6 retrying'),
  (t070.u(7), t070.u(100), 'cup_taster', 'E7 removed'),
  (t070.u(8), t070.u(100), 'cup_taster', 'E8 published'),
  (t070.u(9), t070.u(100), 'cup_taster', 'E9 stubbed stale'),
  (t070.u(10), t070.u(100), 'cup_taster', 'E10 stubbed invalid'),
  (t070.u(11), t070.u(100), 'cup_taster', 'E11 removed then published again'),
  (t070.u(12), t070.u(100), 'cup_taster', 'E12 skipped (organiser published first)'),
  (t070.u(13), t070.u(100), 'cup_taster', 'E13 pending, named only'),
  (t070.u(201), t070.u(200), 'cup_taster', 'Y1 failed');

update events set ended_at = timestamptz '2026-10-04 10:00+00', ended_via = 'organiser'
 where org_id in (t070.u(100), t070.u(200)) and id <> t070.u(1);

-- a snapshot that must never come out, and error codes that must not come out as they are
insert into app.archive_events (event_id, org_id, due_at, state, attempts, last_error, listing_choice, staged_payload, staged_at, outcome_via, removed_at, removed_from)
values
  (t070.u(3),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'pending', 0, null, 'list',
     '{"podium":[{"name":"LEAK-ME-NAME"}]}', now(), null, null, null),
  (t070.u(4),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'stubbed', 0, 'no_snapshot', null, null, null, 'auto', null, null),
  (t070.u(5),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'failed', 5, '40P01', 'named_only', null, null, null, null, null),
  (t070.u(6),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'pending', 2, 'XX000', null, null, null, null, null, null),
  (t070.u(7),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'removed', 1, '23505', null, null, null, 'auto', now(), 'published'),
  (t070.u(8),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'published', 0, null, 'list', null, null, 'auto', null, null),
  (t070.u(9),  t070.u(100), timestamptz '2026-10-05 10:00+00', 'stubbed', 0, 'stale_snapshot', 'list', null, null, 'auto', null, null),
  (t070.u(10), t070.u(100), timestamptz '2026-10-05 10:00+00', 'stubbed', 0, 'invalid_snapshot', 'list', null, null, 'auto', null, null),
  (t070.u(11), t070.u(100), timestamptz '2026-10-05 10:00+00', 'removed', 0, null, null, null, null, 'auto', now(), 'published'),
  (t070.u(12), t070.u(100), timestamptz '2026-10-05 10:00+00', 'skipped', 0, 'is_test', null, null, null, 'organiser_early', null, null),
  (t070.u(13), t070.u(100), null, 'pending', 0, null, 'named_only', null, null, null, null, null),
  (t070.u(201), t070.u(200), timestamptz '2026-10-05 10:00+00', 'failed', 5, '40P01', null, null, null, null, null, null);
insert into public_results (org_id, event_id, payload) values
  (t070.u(100), t070.u(8), '{"eventName":"E8","podium":[{"name":"Public"}]}'),
  (t070.u(100), t070.u(11), '{"eventName":"E11","podium":[{"name":"Again"}]}'),
  (t070.u(100), t070.u(12), '{"eventName":"E12","podium":[{"name":"Own"}]}'),
  (t070.u(100), t070.u(4), '{"eventName":"E4","listing":"named_only"}');

create temp table t070_before on commit drop as
  select event_id, state, attempts, last_error, listing_choice, staged_payload::text sp, updated_at from app.archive_events
   where event_id in (select id from events where org_id in (t070.u(100), t070.u(200)));

-- ============ a member: the figures ============
create temp table t070_all on commit drop as
  select t070.ask(t070.u(1), t070.u(100), (select array_agg(t070.u(n)) from generate_series(1, 13) n)) as j;
grant select on t070_all to authenticated;

select is((select count(*)::int from jsonb_object_keys((select j from t070_all))), 13, 'one row per requested event');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys((select j -> t070.u(1)::text from t070_all)) k),
  'due_at,listing_choice,published,reason,removed,retrying,state',
  'exactly the pinned columns (event_id is the key): nothing else leaves the database');

select is((select j -> t070.u(1)::text from t070_all),
  '{"state":"none","due_at":null,"published":false,"listing_choice":null,"removed":false,"retrying":false,"reason":null}'::jsonb,
  'no ledger row and not ended: none, no due time');
select is((select j -> t070.u(2)::text from t070_all),
  '{"state":"none","due_at":"2026-10-05T10:00:00+00:00","published":false,"listing_choice":null,"removed":false,"retrying":false,"reason":null}'::jsonb,
  'no ledger row but ended: none, the due time is ended_at + 24 hours');
select is((select j -> t070.u(3)::text from t070_all),
  '{"state":"pending","due_at":"2026-10-05T10:00:00+00:00","published":false,"listing_choice":"list","removed":false,"retrying":false,"reason":null}'::jsonb,
  'pending with the saved tick box (list)');
select is((select j -> t070.u(13)::text from t070_all),
  '{"state":"pending","due_at":"2026-10-05T10:00:00+00:00","published":false,"listing_choice":"named_only","removed":false,"retrying":false,"reason":null}'::jsonb,
  'pending with a ledger row that has no due time yet: the due time still comes from ended_at; the saved choice is named_only');
select is((select j -> t070.u(4)::text from t070_all),
  '{"state":"stubbed","due_at":"2026-10-05T10:00:00+00:00","published":true,"listing_choice":null,"removed":false,"retrying":false,"reason":"no_snapshot"}'::jsonb,
  'stubbed because there was no snapshot');
select is((select j -> t070.u(9)::text from t070_all) ->> 'reason', 'stale_snapshot', 'stubbed because the snapshot was stale');
select is((select j -> t070.u(10)::text from t070_all) ->> 'reason', 'invalid_snapshot', 'stubbed because the snapshot was invalid');
select is((select j -> t070.u(5)::text from t070_all),
  '{"state":"failed","due_at":"2026-10-05T10:00:00+00:00","published":false,"listing_choice":"named_only","removed":false,"retrying":false,"reason":"processing_error"}'::jsonb,
  'failed after the retries: the SQLSTATE 40P01 comes out only as processing_error');
select is((select j -> t070.u(6)::text from t070_all),
  '{"state":"pending","due_at":"2026-10-05T10:00:00+00:00","published":false,"listing_choice":null,"removed":false,"retrying":true,"reason":"processing_error"}'::jsonb,
  'retrying: pending with a failed attempt behind it; XX000 comes out only as processing_error');
select is((select j -> t070.u(7)::text from t070_all),
  '{"state":"removed","due_at":"2026-10-05T10:00:00+00:00","published":false,"listing_choice":null,"removed":true,"retrying":false,"reason":null}'::jsonb,
  'removed after a take-down: removed true, nothing published, an old error code is not shown');
select is((select j -> t070.u(11)::text from t070_all),
  '{"state":"removed","due_at":"2026-10-05T10:00:00+00:00","published":true,"listing_choice":null,"removed":true,"retrying":false,"reason":null}'::jsonb,
  'removed, then published again by hand: removed and published are both true');
select is((select j -> t070.u(8)::text from t070_all),
  '{"state":"published","due_at":"2026-10-05T10:00:00+00:00","published":true,"listing_choice":"list","removed":false,"retrying":false,"reason":null}'::jsonb,
  'published by the pipeline');
select is((select j -> t070.u(12)::text from t070_all),
  '{"state":"skipped","due_at":"2026-10-05T10:00:00+00:00","published":true,"listing_choice":null,"removed":false,"retrying":false,"reason":null}'::jsonb,
  'skipped because the organiser published first: an internal skip code (is_test) is not shown');

-- ============ no leak ============
select is(
  (select position('LEAK-ME-NAME' in (select j::text from t070_all))), 0, 'the staged snapshot''s contents never appear in the answer');
select is(
  (select (j::text ~ '(40P01|XX000|23505|Public|Again)') from t070_all), false,
  'no SQLSTATE, internal code or payload text appears anywhere in the answer');
select is(
  (select coalesce(string_agg(distinct e.value ->> 'reason', ',' order by e.value ->> 'reason'), '')
     from t070_all, jsonb_each(j) e where e.value ->> 'reason' is not null),
  'invalid_snapshot,no_snapshot,processing_error,stale_snapshot',
  'the reason is one of the four whitelisted codes, whatever the ledger held');

-- ============ the list handling ============
select is(t070.ask(t070.u(1), t070.u(100), array[t070.u(3), t070.u(3), t070.u(3)]) -> t070.u(3)::text ->> 'state', 'pending', 'a repeated id is answered once');
select is((select count(*)::int from jsonb_object_keys(t070.ask(t070.u(1), t070.u(100), array[t070.u(3), t070.u(3)]))), 1, '...as one row');
select is(t070.ask(t070.u(1), t070.u(100), '{}'::uuid[]), '{}'::jsonb, 'an empty list answers no rows');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, null)', t070.u(100))), '22023|archive_status_invalid', 'a NULL list is 22023');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, (select array_agg(gen_random_uuid()) from generate_series(1, 201)))', t070.u(100))),
  '22023|archive_status_too_many', 'more than 200 ids is 22023');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, (select array_agg(%L::uuid) from generate_series(1, 200)))', t070.u(100), t070.u(3))),
  'ok', 'exactly 200 ids is allowed');

-- ============ refusals: one answer, nothing learnt ============
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(201))), '42501|', 'an event of another organisation (named under my organisation) is refused');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(999))), '42501|', 'a missing event is refused the same way');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, array[%L::uuid, null])', t070.u(100), t070.u(3))), '42501|', 'a NULL id in the list is refused the same way');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, array[%L::uuid, %L])', t070.u(100), t070.u(3), t070.u(201))), '42501|', 'one foreign id spoils the whole list (no partial answer)');
select is(t070.try(t070.u(2), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(3))), '42501|', 'a stranger (member of another organisation) is refused');
select is(t070.try(t070.u(3), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(3))), '42501|', 'a signed-in person with no organisation is refused');
select is(t070.try(t070.u(2), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(200), t070.u(3))), '42501|', 'a member naming their own organisation with another organisation''s event is refused');
select is(t070.try(t070.u(4), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(200), t070.u(3))), '42501|', 'a two-organisation user cannot ask about X''s event under Y');
select is(t070.try(t070.u(4), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(201))), '42501|', '...nor about Y''s event under X');
select is(t070.try(t070.u(4), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(3))), 'ok', 'a two-organisation user asking about X''s event under X is answered');
select is(t070.try(t070.u(4), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(200), t070.u(201))), 'ok', '...and Y''s under Y');
select is(t070.ask(t070.u(4), t070.u(200), array[t070.u(201)]) -> t070.u(201)::text ->> 'state', 'failed', 'Y''s event shows Y''s own ledger state to a member of Y');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(null, array[%L::uuid])', t070.u(3))), '42501|', 'a NULL organisation is refused');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(999), t070.u(3))), '42501|', 'an unknown organisation is refused');
select is(t070.try(null, format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(3))), '42501|', 'anon cannot call it');
select is(t070.try(t070.u(1), format('select * from public.archive_event_status(%L, array[%L::uuid])', t070.u(100), t070.u(3))), 'ok', 'a member can');

-- a test event asked about under its own organisation is answered like any other (the panel hides it itself)
update events set is_test = true where id = t070.u(1);
select is(t070.ask(t070.u(1), t070.u(100), array[t070.u(1)]) -> t070.u(1)::text ->> 'state', 'none', 'a test event is answered (no ledger row): the panel decides what to show');
update events set is_test = false where id = t070.u(1);

-- ============ read only, and the contract ============
select is((select count(*)::int from t070_before b join app.archive_events a using (event_id)
            where (a.state, a.attempts, a.last_error, a.listing_choice, a.staged_payload::text, a.updated_at)
                  is distinct from (b.state, b.attempts, b.last_error, b.listing_choice, b.sp, b.updated_at)),
  0, 'calling it changed no ledger row');
select is((select count(*)::int from t070_before), 12, 'and removed none (12 rows of this test, before and after)');
select is((select p.provolatile::text from pg_proc p where p.oid = 'public.archive_event_status(uuid, uuid[])'::regprocedure), 's', 'it is STABLE (read only)');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.archive_event_status(uuid, uuid[])'::regprocedure), true, 'it is SECURITY DEFINER');
select is((select p.proconfig from pg_proc p where p.oid = 'public.archive_event_status(uuid, uuid[])'::regprocedure), array['search_path=""'], 'search_path is pinned to the empty path');
select is(
  (select coalesce(string_agg(r, ',' order by r), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'public.archive_event_status(uuid, uuid[])', 'execute')),
  'authenticated', 'only authenticated can execute it');
select is(
  (select position('app.refuse_non_member' in regexp_replace(p.prosrc, '--[^\n]*', '', 'g')) between 1 and 80
     from pg_proc p where p.oid = 'public.archive_event_status(uuid, uuid[])'::regprocedure),
  true, 'the body opens with the shared membership refusal');
select is(
  (select pg_get_function_result('public.archive_event_status(uuid, uuid[])'::regprocedure)),
  'TABLE(event_id uuid, state text, due_at timestamp with time zone, published boolean, listing_choice text, removed boolean, retrying boolean, reason text)',
  'the result columns are exactly the frozen list');

select * from finish();
rollback;
