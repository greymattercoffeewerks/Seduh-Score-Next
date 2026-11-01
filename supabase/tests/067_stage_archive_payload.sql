-- T-ARC.2: the organiser's browser stages the podium snapshot (migration 20261101110500_stage_archive_payload.sql; spec: Handoffs
-- and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md section 3, owner answers in HANDOFF-CORRECTION-005.md).
-- Proves, calling public.stage_archive_payload as the real `authenticated` / `anon` roles:
--   * DARK: while results_archive_optional is unenforced the call writes NOTHING (no ledger row, no operation row);
--   * WHO: a member stages for their own organisation's event. A stranger (a member of another organisation), a member naming
--     another organisation, a two-organisation member mixing the two, a signed-in caller who belongs to nobody, a NULL
--     organisation, a missing event and anon all get ONE refusal (42501 'event not found') and leave no trace;
--   * WHAT IS STORED: only the whitelisted keys (the same function the tick uses): no standings, no notListed, no unknown key,
--     no phone or email in a podium row; staged_at is the SERVER's now() whatever clock the client sent;
--   * MALFORMED: null, non-object, no podium, empty podium, nine rows, a nameless champion, a non-text name, more than 64 KB,
--     a NULL operation id: refused with a stable hint, nothing stored;
--   * IDEMPOTENCY: the same operation id twice stages once ('duplicate'); another organisation's operation id raises nothing
--     and stores nothing (no row-id existence oracle); an older built_at does not overwrite a newer snapshot ('superseded');
--     a client clock in the future is clamped;
--   * a test event stages nothing ('test_event'), a terminal ledger row is left alone ('closed'), an event that has not ended
--     gets a row with no due_at that the tick fills in later;
--   * END TO END with the T-ARC.1 tick: a staged podium is published whitelisted; a score change after staging gives a stub
--     ('stale_snapshot'); a stub when nothing was staged;
--   * the door is executable by signed-in callers only, is SECURITY DEFINER with search_path pinned, and the ledger stays
--     unreadable by every API role.
-- Everything runs in ONE transaction, so now() is fixed: times are set explicitly relative to it.
-- NOT covered here (stated): two real sessions staging at once (the ledger row lock serialises them; one transaction cannot show
-- it) and the browser side (src/core/archiveStaging.test.js).
begin;
select plan(84);

create schema t067;
grant usage on schema t067 to anon, authenticated;

create function t067.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000670' || lpad(n::text, 4, '0'))::uuid
$$;

-- "ok:<result>" of a call run as a real API role, or "SQLSTATE|hint|message"
create function t067.call_as(r text, uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; m text;
begin
  perform set_config('role', r, true);
  if uid is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', r, 'sub', uid, 'session_id', uid)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  end if;
  begin
    execute stmt into res;
    res := 'ok:' || res;
  exception when others then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    res := sqlstate || '|' || coalesce(case when h like 'archive\_%' then h end, '') || '|' || m;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;

-- the stage call as text, so call_as can run it
create function t067.stage(op int, org int, ev int, payload jsonb, built timestamptz default null) returns text language sql immutable as $$
  select format('select public.stage_archive_payload(%L, %L, %L, %L::jsonb, %L::timestamptz)::text',
                t067.u(op), case when org is null then null else t067.u(org) end, case when ev is null then null else t067.u(ev) end, payload::text, built)
$$;

create function t067.keys(j jsonb) returns text language sql immutable as $$
  select string_agg(k, ',' order by k) from jsonb_object_keys(j) k
$$;
create function t067.arch(n int, col text) returns text language plpgsql stable as $$
declare v text;
begin
  execute format('select %I::text from app.archive_events where event_id = $1', col) into v using t067.u(n);
  return v;
end $$;
create function t067.ops() returns int language sql stable as $$
  select count(*)::int from processed_operations where kind = 'stage_archive_payload'
$$;
create function t067.pub(n int) returns jsonb language sql stable as $$
  select payload from public_results where event_id = t067.u(n)
$$;
create function t067.rows() returns int language sql stable as $$
  select count(*)::int from app.archive_events where event_id in (select t067.u(n) from generate_series(1001, 1010) n)
$$;

-- a plausible browser-built snapshot, WITH things the archive must not carry
create function t067.snap(champion text) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'format', 'cup_taster', 'eventName', 'Snapshot name', 'city', 'Bandar', 'venue', 'Hall', 'eventDate', '2026-10-04',
    'competitors', 8, 'rounds', 3, 'winningTimeSecs', 212,
    'standings', jsonb_build_array(jsonb_build_object('place', 1, 'name', 'Standings Person')),
    'notListed', 2,
    'internalNote', 'do not publish',
    'podium', jsonb_build_array(
      jsonb_build_object('rank', 1, 'name', champion, 'cafe', 'Cafe One', 'correct', 9, 'total', 9, 'phone', '+6737000001', 'email', 'a@example.test', 'id', gen_random_uuid()),
      jsonb_build_object('rank', 2, 'name', 'Second', 'cafe', 'Cafe Two', 'correct', 8, 'total', 9),
      jsonb_build_object('rank', 3, 'name', 'Third', 'cafe', null, 'correct', 7, 'total', 9)))
$$;

-- ---------- fixtures (as the table owner) ----------
-- the seed's own events would be picked up by the tick: remove them in this transaction
delete from events;
-- user 1: member of A; user 2: member of B; user 3: member of both; user 4: nobody
insert into auth.users (id, email) values
  (t067.u(1), 't067-a@example.test'), (t067.u(2), 't067-b@example.test'), (t067.u(3), 't067-ab@example.test'), (t067.u(4), 't067-c@example.test');
insert into orgs (id, name, slug) values (t067.u(100), 'T067 A', 't067-a'), (t067.u(200), 'T067 B', 't067-b');
insert into org_members (org_id, user_id, role) values
  (t067.u(100), t067.u(1), 'organiser'), (t067.u(200), t067.u(2), 'organiser'),
  (t067.u(100), t067.u(3), 'organiser'), (t067.u(200), t067.u(3), 'organiser');

insert into events (id, org_id, format, name, event_date, city, venue) values
  (t067.u(1001), t067.u(100), 'cup_taster', 'A1 ended', date '2026-10-04', 'Bandar', 'Hall'),
  (t067.u(1002), t067.u(100), 'cup_taster', 'A2 test', date '2026-10-04', null, null),
  (t067.u(1003), t067.u(100), 'cup_taster', 'A3 not ended', date '2026-10-04', null, null),
  (t067.u(1004), t067.u(100), 'cup_taster', 'A4 closed', date '2026-10-04', null, null),
  (t067.u(1005), t067.u(100), 'cup_taster', 'A5 stale', date '2026-10-04', null, null),
  (t067.u(1006), t067.u(100), 'cup_taster', 'A6 tick podium', date '2026-10-04', null, null),
  (t067.u(1007), t067.u(100), 'cup_taster', 'A7 tick stub', date '2026-10-04', null, null),
  (t067.u(2001), t067.u(200), 'cup_taster', 'B1 ended', date '2026-10-04', null, null);
update events set is_test = true where id = t067.u(1002);
update events set ended_at = now() - interval '25 hours', ended_via = 'organiser'
 where id in (t067.u(1001), t067.u(1004), t067.u(1005), t067.u(1006), t067.u(1007), t067.u(2001));

-- ============ structure ============
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'stage_archive_payload'), 1,
  'one stage_archive_payload exists, one overload');
select is((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.proname = 'stage_archive_payload' and p.pronamespace = 'public'::regnamespace), true,
  'it is SECURITY DEFINER with search_path pinned to the empty string');
select is(has_function_privilege('authenticated', 'public.stage_archive_payload(uuid,uuid,uuid,jsonb,timestamptz)', 'execute'), true, 'signed-in callers may execute it');
select is(has_function_privilege('anon', 'public.stage_archive_payload(uuid,uuid,uuid,jsonb,timestamptz)', 'execute'), false, 'anon may not');
select is(has_function_privilege('service_role', 'public.stage_archive_payload(uuid,uuid,uuid,jsonb,timestamptz)', 'execute'), false, 'nor the service role');
select is((select data_type from information_schema.columns where table_schema = 'app' and table_name = 'archive_events' and column_name = 'staged_built_at'),
  'timestamp with time zone', 'the additive column staged_built_at exists on the T-ARC.1 ledger');
select is((select enforced from app.entitlement_keys where key = 'results_archive_optional'), false, 'results_archive_optional is seeded unenforced');

-- ============ DARK ============
create function t067.r(reason text, staged boolean) returns text language sql immutable as $$
  select 'ok:' || jsonb_build_object('staged', staged, 'reason', reason)::text
$$;
-- "SQLSTATE|hint" of a call_as answer
create function t067.hint(res text) returns text language sql immutable as $$
  select split_part(res, '|', 1) || '|' || split_part(res, '|', 2)
$$;
create table t067.m (k text primary key, v int);

select is(t067.call_as('authenticated', t067.u(1), t067.stage(1, 100, 1001, t067.snap('Alice'))), t067.r('dark', false), 'unenforced: a member''s call answers dark');
select is(t067.rows(), 0, 'dark: no ledger row was created');
select is(t067.ops(), 0, 'dark: no operation row was recorded (the same operation id can stage after the flip)');
select is(t067.call_as('authenticated', t067.u(4), t067.stage(1, 100, 1001, t067.snap('Alice'))), '42501||stage_archive_payload: event not found',
  'dark: a stranger is still refused');
select is(t067.hint(t067.call_as('authenticated', t067.u(1), t067.stage(1, 100, 1001, '[]'::jsonb))), 'P0001|archive_payload_invalid',
  'dark: a malformed snapshot is still refused, so a bug cannot hide while the pipeline is off');

update app.entitlement_keys set enforced = true where key = 'results_archive_optional';

-- ============ a member stages ============
select is(t067.call_as('authenticated', t067.u(1), t067.stage(1, 100, 1001, t067.snap('Alice'), now() - interval '1 hour')), t067.r(null, true),
  'enforced: a member stages for their organisation''s event');
select is(t067.rows(), 1, 'one ledger row was made');
select is(t067.keys(t067.arch(1001, 'staged_payload')::jsonb), 'city,competitors,eventDate,eventName,format,podium,rounds,venue,winningTimeSecs',
  'the stored snapshot carries the whitelisted keys only (no standings, notListed or unknown key)');
select is(t067.keys((t067.arch(1001, 'staged_payload')::jsonb) #> '{podium,0}'), 'cafe,correct,name,rank,total', 'a podium row keeps rank, name, cafe, correct, total only');
select is(t067.arch(1001, 'staged_payload') !~* '(6737|example\.test|standings|notListed|internalNote|Standings Person)', true,
  'no phone, email, id, standings or unknown value reached the stored snapshot');
select is(t067.arch(1001, 'staged_at')::timestamptz = now(), true, 'staged_at is the server''s now(), not the client''s clock');
select is(t067.arch(1001, 'staged_built_at')::timestamptz = now() - interval '1 hour', true, 'staged_built_at is the client''s build time');
select is(t067.arch(1001, 'state') || '|' || (t067.arch(1001, 'due_at')::timestamptz = (select ended_at + interval '24 hours' from events where id = t067.u(1001)))::text,
  'pending|true', 'the row is pending and carries due_at = ended_at + 24 hours');
select is((select org_id from processed_operations where id = t067.u(1) and kind = 'stage_archive_payload'), t067.u(100), 'the operation id was recorded under the organisation');

-- ============ idempotency and ordering ============
select is(t067.call_as('authenticated', t067.u(1), t067.stage(1, 100, 1001, t067.snap('Zed'), now())), t067.r('duplicate', false), 'the same operation id stages once: duplicate');
select is(t067.arch(1001, 'staged_payload')::jsonb #>> '{podium,0,name}', 'Alice', 'and the first snapshot stays');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(2, 100, 1001, t067.snap('Old'), now() - interval '2 hours')), t067.r('superseded', false),
  'a snapshot built earlier than the staged one is superseded (a replayed old operation)');
select is(t067.arch(1001, 'staged_payload')::jsonb #>> '{podium,0,name}', 'Alice', 'and does not overwrite it');
select is(t067.ops(), 1, 'a superseded call consumed no operation id');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(3, 100, 1001, t067.snap('Bea'), now() - interval '30 minutes')), t067.r(null, true), 'a newer snapshot replaces the older');
select is(t067.arch(1001, 'staged_payload')::jsonb #>> '{podium,0,name}', 'Bea', 'the newer champion is stored');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(4, 100, 1001, t067.snap('Cara'), now() + interval '1 day')), t067.r(null, true), 'a client clock a day ahead still stages');
select is(t067.arch(1001, 'staged_built_at')::timestamptz = now(), true, 'and is clamped to the server''s now(), so it cannot lock out every later snapshot');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(5, 100, 1001, t067.snap('Dee'))), t067.r(null, true), 'a call with no built_at means now() and stages');
select is(t067.arch(1001, 'staged_payload')::jsonb #>> '{podium,0,name}', 'Dee', 'the latest champion is stored');

-- another organisation's operation id: no error, no write, no oracle
select is(t067.call_as('authenticated', t067.u(2), t067.stage(3, 200, 2001, t067.snap('Bee'))), t067.r('duplicate', false),
  'a member of B naming an operation id A already used gets the same ''duplicate'' as a replay (no existence oracle)');
select is(t067.arch(2001, 'staged_payload'), null, 'and B''s event stored nothing');
select is((select org_id from processed_operations where id = t067.u(3)), t067.u(100), 'A''s operation row is untouched');
select is(t067.call_as('authenticated', t067.u(2), t067.stage(6, 200, 2001, t067.snap('Bee'))), t067.r(null, true), 'B stages its own event with its own operation id');

-- ============ test event, closed row, event not ended ============
select is(t067.call_as('authenticated', t067.u(1), t067.stage(7, 100, 1002, t067.snap('Test'))), t067.r('test_event', false), 'a test event stages nothing');
select is(t067.arch(1002, 'state'), null, 'and gets no ledger row');
insert into app.archive_events (event_id, org_id, due_at, state, outcome_via) values (t067.u(1004), t067.u(100), now() - interval '1 hour', 'skipped', 'organiser_early');
insert into t067.m values ('ops', t067.ops());
select is(t067.call_as('authenticated', t067.u(1), t067.stage(8, 100, 1004, t067.snap('Late'))), t067.r('closed', false), 'a terminal ledger row is left alone: closed');
select is(t067.arch(1004, 'staged_payload'), null, 'nothing was stored on it');
select is(t067.ops(), (select v from t067.m where k = 'ops'), 'and no operation id was consumed');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(9, 100, 1003, t067.snap('Early'))), t067.r(null, true), 'an event that has not ended can stage');
select is(t067.arch(1003, 'due_at'), null, 'its due_at is left for the tick to fill in');

-- ============ malformed snapshots ============
insert into t067.m values ('ops2', t067.ops());
select is(t067.hint(t067.call_as('authenticated', t067.u(1), t067.stage(10 + c.n, 100, 1001, c.p))), c.expected, 'refused: ' || c.label)
  from (values
    (1, null::jsonb, 'P0001|archive_payload_invalid', 'a NULL snapshot'),
    (2, '[1]'::jsonb, 'P0001|archive_payload_invalid', 'a snapshot that is not an object'),
    (3, '{}'::jsonb, 'P0001|archive_payload_invalid', 'no podium'),
    (4, '{"podium": []}'::jsonb, 'P0001|archive_payload_invalid', 'an empty podium'),
    (5, jsonb_build_object('podium', (select jsonb_agg(jsonb_build_object('name', 'P' || n)) from generate_series(1, 9) n)), 'P0001|archive_payload_invalid', 'nine podium rows'),
    (6, '{"podium": [{"rank": 1}]}'::jsonb, 'P0001|archive_payload_invalid', 'a champion with no name'),
    (7, '{"podium": [{"name": 7}]}'::jsonb, 'P0001|archive_payload_invalid', 'a non-text name'),
    (8, jsonb_build_object('pad', repeat('x', 70000), 'podium', jsonb_build_array(jsonb_build_object('name', 'A'))), 'P0001|archive_payload_too_large', 'more than 64 KB')
  ) c(n, p, expected, label);
select is(t067.hint(t067.call_as('authenticated', t067.u(1),
    format('select public.stage_archive_payload(null, %L, %L, %L::jsonb)::text', t067.u(100), t067.u(1001), t067.snap('Nop')::text))),
  'P0001|archive_payload_invalid', 'refused: a NULL operation id');
select is(t067.arch(1001, 'staged_payload')::jsonb #>> '{podium,0,name}', 'Dee', 'none of the malformed calls changed the stored snapshot');
select is(t067.ops(), (select v from t067.m where k = 'ops2'), 'and none consumed an operation id');

-- ============ who may stage (one refusal, no trace) ============
insert into t067.m values ('ops3', t067.ops()), ('rows3', (select count(*)::int from app.archive_events));
select is(t067.call_as(c.r, c.u, t067.stage(30 + c.n, c.org, c.ev, t067.snap('Mallory'))), '42501||stage_archive_payload: event not found', 'refused identically: ' || c.label)
  from (values
    (1, 'authenticated', t067.u(4), 100, 1001, 'a signed-in caller who belongs to nobody'),
    (2, 'authenticated', t067.u(2), 100, 1001, 'a member of B naming A for A''s event'),
    (3, 'authenticated', t067.u(1), 200, 2001, 'a member of A naming B for B''s event'),
    (4, 'authenticated', t067.u(1), 100, 2001, 'a member of A naming A for B''s event'),
    (5, 'authenticated', t067.u(3), 100, 2001, 'a member of both naming A for B''s event'),
    (6, 'authenticated', t067.u(3), 200, 1001, 'a member of both naming B for A''s event'),
    (7, 'authenticated', t067.u(1), null::int, 1001, 'a NULL organisation'),
    (8, 'authenticated', t067.u(1), 100, null::int, 'a NULL event'),
    (9, 'authenticated', t067.u(1), 100, 9999, 'an event that does not exist'),
    (10, 'authenticated', null::uuid, 100, 1001, 'a token with no user')
  ) c(n, r, u, org, ev, label);
select is(left(t067.call_as('anon', null, t067.stage(41, 100, 1001, t067.snap('Mallory'))), 5), '42501', 'anon is refused (no execute privilege)');
select is(t067.ops(), (select v from t067.m where k = 'ops3'), 'no refused call recorded an operation id');
select is((select count(*)::int from app.archive_events), (select v from t067.m where k = 'rows3'), 'and none created a ledger row');
select is(t067.call_as('authenticated', t067.u(3), t067.stage(42, 100, 1001, t067.snap('Eve'))), t067.r(null, true), 'a member of both organisations stages with matching ids');
select is(t067.arch(1001, 'staged_payload')::jsonb #>> '{podium,0,name}', 'Eve', 'and it landed on the right event');

-- ============ end to end with the T-ARC.1 tick ============
select is(t067.call_as('authenticated', t067.u(1), t067.stage(50, 100, 1005, t067.snap('Stale'))), t067.r(null, true), 'A5 staged');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(51, 100, 1006, t067.snap('Frank'))), t067.r(null, true), 'A6 staged');
-- A5: a score changed after the snapshot was staged
insert into score_change_log (org_id, event_id, table_name, row_id, action, changed_at)
values (t067.u(100), t067.u(1005), 'ct_results', gen_random_uuid(), 'update', now() + interval '1 second');
-- A3 has now ended (25 hours ago), so it is due; A7 has no ledger row and no snapshot
update events set ended_at = now() - interval '25 hours', ended_via = 'organiser' where id = t067.u(1003);

select is(app.archive_tick(now() - interval '3 days'), jsonb_build_object('dark', false, 'enqueued', 1, 'published', 4, 'stubbed', 2, 'skipped', 0, 'errored', 0),
  'the tick: A7 enqueued; published A1, A3, A6 and B1 (staged podiums); stubbed A5 (stale) and A7 (nothing staged)');
select is(t067.arch(1001, 'state') || '|' || (t067.pub(1001) #>> '{podium,0,name}'), 'published|Eve', 'A1: the latest staged podium was published');
select is(t067.arch(1003, 'state') || '|' || (t067.arch(1003, 'due_at')::timestamptz = (select ended_at + interval '24 hours' from events where id = t067.u(1003)))::text,
  'published|true', 'A3: the tick filled in the due_at the row had no value for when it was staged, and published');
select is(t067.keys(t067.pub(1006)), 'city,competitors,eventDate,eventName,format,org_name,org_slug,podium,rounds,venue,winningTimeSecs', 'A6: the public payload carries the whitelisted keys plus the table''s own stamp');
select is(t067.keys(t067.pub(1006) #> '{podium,0}'), 'cafe,correct,name,rank,total', 'A6: and a podium row has no phone, email or id');
select is(t067.pub(1006) #>> '{podium,0,name}', 'Frank', 'A6: the champion is the staged one');
select is(t067.arch(1005, 'state') || '|' || t067.arch(1005, 'last_error'), 'stubbed|stale_snapshot', 'A5: a score changed after staging gives a stub, reason stale_snapshot');
select is(t067.pub(1005) ? 'podium', false, 'A5: the stale podium was not published');
select is(t067.arch(1007, 'state') || '|' || t067.arch(1007, 'last_error'), 'stubbed|no_snapshot', 'A7: nothing staged gives a stub');
select is(t067.pub(2001) #>> '{podium,0,name}', 'Bee', 'B1: the other organisation''s event published its own snapshot');
select is(t067.arch(1001, 'staged_payload'), null, 'and a published row''s snapshot is cleared');
select is(t067.call_as('authenticated', t067.u(1), t067.stage(60, 100, 1001, t067.snap('Late'))), t067.r('closed', false), 'once published, staging answers closed');

-- ============ nobody on the API side reads the ledger through this door ============
select is(left(t067.call_as('authenticated', t067.u(1), 'select count(*)::text from app.archive_events'), 5), '42501', 'a member still cannot read the ledger');

select * from finish();
rollback;
