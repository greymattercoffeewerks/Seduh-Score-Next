-- T-ARC.1: the archive pipeline's state and tick (migration 20261101100000_archive_tick.sql; spec: Handoffs and Specs/
-- ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md sections 2 and 3, owner answers in HANDOFF-CORRECTION-005.md).
-- Proves, with the tick called DIRECTLY (pg_cron is not needed and not created here):
--   * DARK: while results_archive_optional is unenforced the tick returns {"dark": true} and changes nothing, even for an
--     ended event past the floor;
--   * enforced: due events are worked once. A double tick publishes once (the next tick finds nothing pending); a Community
--     event publishes its staged podium only when the snapshot is valid AND fresh (else a named-only stub whose last_error
--     says why); a paid-tier organiser's listing_choice decides (null/named_only stub, list podium); the whitelist drops
--     standings, notListed, unknown keys and a podium row's extra keys; the staged snapshot is cleared once used;
--   * is_test is re-read at the moment of publish: an event flipped to a test event after its row was made is skipped;
--   * an existing public_results row is NEVER overwritten (the organiser published first, before or after due_at); a
--     result removed after the tick is not published again (every state but pending is terminal);
--   * failure isolation: one event whose publish raises is rolled back, recorded by SQLSTATE only (no message text), backed
--     off, and does not stop the others; after 5 attempts it is 'failed' and left alone;
--   * the floor: rows are created only for events that ended at or after it (none when null), never for a test event;
--   * no API role (anon, authenticated, service_role), member or stranger, can read, write, or call anything new, and the
--     tick refuses an API session by name even if the ACL were widened;
--   * constraints and the frozen parent.
-- Everything runs in ONE transaction, so now() is fixed: times are set explicitly relative to it.
-- NOT covered here (stated): `for update skip locked` between two real sessions (one transaction cannot show it; see
-- supabase/tests/manual/archive-tick-concurrency.sh) and pg_cron itself.
begin;
select plan(109);

create schema t066;
grant usage on schema t066 to anon, authenticated, service_role;

create function t066.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000660' || lpad(n::text, 4, '0'))::uuid
$$;

-- "SQLSTATE|hint" of a statement run as a real API role, or 'ok'
create function t066.as_role(r text, uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  perform set_config('role', r, true);
  if uid is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', r, 'sub', uid, 'session_id', uid)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    -- the hint is kept only when it is one of ours (the privilege error carries a generated GRANT suggestion)
    res := sqlstate || '|' || case when h like 'archive\_%' then h else '' end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;

create function t066.keys(j jsonb) returns text language sql immutable as $$
  select string_agg(k, ',' order by k) from jsonb_object_keys(j) k
$$;

-- a plausible browser-built snapshot, WITH things the archive must not carry
create function t066.snap(champion text) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'format', 'cup_taster', 'eventName', 'Snapshot name', 'city', 'Bandar', 'venue', 'Hall', 'eventDate', '2026-10-04',
    'competitors', 8, 'rounds', 3, 'winningTimeSecs', 212,
    'standings', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'Standings Person')),
    'notListed', jsonb_build_array('Hidden Person'),
    'internalNote', 'do not publish',
    'podium', jsonb_build_array(
      jsonb_build_object('rank', 1, 'name', champion, 'cafe', 'Cafe One', 'correct', 9, 'total', 9, 'phone', '+6737000001', 'email', 'a@example.test'),
      jsonb_build_object('rank', 2, 'name', 'Second', 'cafe', 'Cafe Two', 'correct', 8, 'total', 9),
      jsonb_build_object('rank', 3, 'name', 'Third', 'cafe', null, 'correct', 7, 'total', 9)))
$$;

create function t066.pub(n int) returns jsonb language sql stable as $$
  select payload from public_results where event_id = t066.u(n)
$$;
create function t066.arch(n int, col text) returns text language plpgsql stable as $$
declare v text;
begin
  execute format('select %I::text from app.archive_events where event_id = $1', col) into v using t066.u(n);
  return v;
end $$;

-- ---------- fixtures (as the table owner) ----------
-- the seed's own events (ended recently, by the concluded backfill) would be picked up by the floor: remove them in this
-- transaction so every count below is about the fixtures only
delete from events;
insert into auth.users (id, email) values (t066.u(1), 't066-member@example.test'), (t066.u(2), 't066-stranger@example.test');
insert into orgs (id, name, slug) values
  (t066.u(100), 'T066 Community', 't066-community'), (t066.u(200), 'T066 Annual', 't066-annual'), (t066.u(300), 'T066 Other', 't066-other');
insert into org_members (org_id, user_id, role) values (t066.u(100), t066.u(1), 'organiser'), (t066.u(300), t066.u(2), 'organiser');
-- valid before the events' due times: the tick evaluates the entitlement AT due_at, not now()
insert into entitlement_grants (org_id, tier, source, valid_from) values (t066.u(200), 'annual', 'manual', now() - interval '30 days');

insert into events (id, org_id, format, name, event_date, city, venue) values
  (t066.u(1001), t066.u(100), 'cup_taster', 'E1 podium', date '2026-10-04', 'Bandar', 'Hall'),
  (t066.u(1002), t066.u(100), 'cup_taster', 'E2 no snapshot', date '2026-10-04', null, null),
  (t066.u(1003), t066.u(100), 'cup_taster', 'E3 stale', date '2026-10-04', null, null),
  (t066.u(1004), t066.u(100), 'cup_taster', 'E4 flipped test', date '2026-10-04', null, null),
  (t066.u(1005), t066.u(100), 'cup_taster', 'E5 not due', date '2026-10-04', null, null),
  (t066.u(1006), t066.u(100), 'cup_taster', 'E6 organiser first', date '2026-10-04', null, null),
  (t066.u(1007), t066.u(100), 'cup_taster', 'E7 boom', date '2026-10-04', null, null),
  (t066.u(1008), t066.u(200), 'cup_taster', 'E8 annual unticked', date '2026-10-04', null, null),
  (t066.u(1009), t066.u(200), 'cup_taster', 'E9 annual list', date '2026-10-04', 'Cafe', 'Cafe'),
  (t066.u(1010), t066.u(200), 'cup_taster', 'E10 annual named only', date '2026-10-04', null, null),
  (t066.u(1011), t066.u(100), 'cup_taster', 'E11 enqueued by floor', date '2026-10-04', null, null),
  (t066.u(1012), t066.u(100), 'cup_taster', 'E12 before floor', date '2026-10-04', null, null),
  (t066.u(1013), t066.u(100), 'cup_taster', 'E13 invalid snapshot', date '2026-10-04', null, null),
  (t066.u(1014), t066.u(100), 'cup_taster', 'E14 organiser late', date '2026-10-04', null, null),
  (t066.u(1015), t066.u(100), 'cup_taster', 'E15 test never enqueued', date '2026-10-04', null, null);
update events set is_test = true where id = t066.u(1015);
update events set ended_at = now() - interval '25 hours', ended_via = 'organiser'
 where id in (select t066.u(n) from generate_series(1001, 1004) n union select t066.u(n) from generate_series(1006, 1010) n
              union select t066.u(1013) union select t066.u(1014));
update events set ended_at = now() - interval '1 hour', ended_via = 'organiser' where id = t066.u(1005);
update events set ended_at = now() - interval '30 hours', ended_via = 'organiser' where id in (t066.u(1011), t066.u(1015));
update events set ended_at = now() - interval '5 days', ended_via = 'organiser' where id = t066.u(1012);

-- the pipeline's rows. Most are made here so each case is pinned; E11 is made by the tick from the floor.
insert into app.archive_events (event_id, org_id, due_at, listing_choice, staged_payload, staged_at) values
  (t066.u(1001), t066.u(100), now() - interval '1 hour', null, t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1002), t066.u(100), now() - interval '1 hour', null, null, null),
  (t066.u(1003), t066.u(100), now() - interval '1 hour', null, t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1004), t066.u(100), now() - interval '1 hour', null, t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1005), t066.u(100), now() + interval '23 hours', null, t066.snap('Alice'), now() - interval '10 minutes'),
  (t066.u(1006), t066.u(100), now() - interval '1 hour', null, null, null),
  (t066.u(1007), t066.u(100), now() - interval '1 hour', null, t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1008), t066.u(200), now() - interval '1 hour', null, t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1009), t066.u(200), now() - interval '1 hour', 'list', t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1010), t066.u(200), now() - interval '1 hour', 'named_only', t066.snap('Alice'), now() - interval '2 hours'),
  (t066.u(1013), t066.u(100), now() - interval '1 hour', null,
     jsonb_build_object('podium', (select jsonb_agg(jsonb_build_object('rank', n, 'name', 'P' || n)) from generate_series(1, 9) n)),
     now() - interval '2 hours'),
  (t066.u(1014), t066.u(100), now() - interval '1 hour', null, null, null),
  (t066.u(9999), t066.u(100), now() - interval '1 hour', null, null, null);          -- no such event: the ledger has no FK

-- E3's score changed after the snapshot was staged
insert into score_change_log (org_id, event_id, table_name, row_id, action, changed_at)
values (t066.u(100), t066.u(1003), 'ct_results', gen_random_uuid(), 'update', now() - interval '1 hour');

-- E6 and E14: the organiser published first (E6 before the 24 hours were up, E14 after, before the tick got to it)
insert into public_results (org_id, event_id, payload, published_at) values
  (t066.u(100), t066.u(1006), '{"eventName": "Organiser own", "podium": [{"name": "Org Pick"}]}', now() - interval '2 hours'),
  (t066.u(100), t066.u(1014), '{"eventName": "Organiser late", "podium": [{"name": "Late Pick"}]}', now() - interval '10 minutes');

-- E4 is flipped to a test event AFTER its row exists (is_test is member-writable): the tick must re-read it
update events set is_test = true where id = t066.u(1004);

-- E7: the publish raises (stands for any database error), with a message that carries a name and a phone
create function t066.boom() returns trigger language plpgsql as $$
begin
  if new.event_id = t066.u(1007) then
    raise exception 'SECRET Alice +6737000001' using errcode = 'XX999';
  end if;
  return new;
end $$;
create trigger trg_aaa_t066_boom before insert on public.public_results for each row execute function t066.boom();

-- ============ structure ============
select is((select relrowsecurity from pg_class where oid = 'app.archive_events'::regclass), true, 'app.archive_events has row-level security on');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'archive_events'), 0, 'and no policy');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text, r), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'app'::regnamespace and p.proname in ('archive_tick', 'archive_process_one', 'archive_snapshot_payload', 'archive_stub_payload')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'no API role may execute any of the four archive functions');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'app'::regnamespace and p.proname in ('archive_tick', 'archive_process_one')
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  2, 'the tick and the per-event worker are SECURITY DEFINER with search_path pinned to the empty string');
select is((select enforced from app.entitlement_keys where key = 'results_archive_optional'), false, 'results_archive_optional is seeded unenforced');

-- ============ DARK ============
select is(app.archive_tick(now() - interval '3 days'), '{"dark": true}'::jsonb, 'unenforced: the tick answers dark');
select is((select count(*)::int from app.archive_events where event_id = t066.u(1011)), 0, 'dark: it created no row for an ended event past the floor');
select is((select count(*)::int from app.archive_events where state = 'pending'), 13, 'dark: all 13 prepared rows are still pending');
select is((select count(*)::int from public_results where event_id in (select t066.u(n) from generate_series(1001, 1015) n)), 2,
  'dark: nothing was published (only the two the organiser published)');

-- ============ the helpers ============
select is(app.archive_snapshot_payload(null), null, 'snapshot: null is unusable');
select is(app.archive_snapshot_payload('[1]'::jsonb), null, 'snapshot: a non-object is unusable');
select is(app.archive_snapshot_payload('{"podium": []}'::jsonb), null, 'snapshot: an empty podium is unusable');
select is(app.archive_snapshot_payload('{"x": 1}'::jsonb), null, 'snapshot: no podium is unusable');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', (select jsonb_agg(jsonb_build_object('name', 'P' || n)) from generate_series(1, 9) n))),
  null, 'snapshot: nine podium rows are unusable (at most eight)');
select is(app.archive_snapshot_payload('{"podium": [{"name": "  "}]}'::jsonb), null, 'snapshot: a blank champion name is unusable');
select is(app.archive_snapshot_payload('{"podium": [{"name": "A"}, "text"]}'::jsonb), null, 'snapshot: a podium row that is not an object is unusable');
select is(app.archive_snapshot_payload('{"podium": [{"name": "A"}, {"name": 7}]}'::jsonb), null, 'snapshot: a non-text name is unusable');
select is(app.archive_snapshot_payload('{"podium": [{"name": "A"}, {"rank": 2}]}'::jsonb), null, 'snapshot: a podium row with no name key at all is unusable');
select is(app.archive_snapshot_payload(jsonb_build_object('pad', repeat('x', 70000), 'podium', jsonb_build_array(jsonb_build_object('name', 'A')))),
  null, 'snapshot: over 64 KB is unusable');
select is(t066.keys(app.archive_snapshot_payload(t066.snap('Alice'))),
  'city,competitors,eventDate,eventName,format,podium,rounds,venue,winningTimeSecs',
  'snapshot whitelist: standings, notListed and unknown keys are dropped');
select is(t066.keys(app.archive_snapshot_payload(t066.snap('Alice')) #> '{podium,0}'), 'cafe,correct,name,rank,total',
  'snapshot whitelist: a podium row keeps rank, name, cafe, correct, total only (no phone, no email)');
select is(length(app.archive_snapshot_payload(jsonb_build_object('podium', jsonb_build_array(jsonb_build_object('name', repeat('n', 300))))) #>> '{podium,0,name}'),
  120, 'snapshot: a name is cut to 120');
select is(app.archive_stub_payload(t066.u(1002)),
  '{"format": "cup_taster", "eventName": "E2 no snapshot", "eventDate": "2026-10-04", "listing": "named_only"}'::jsonb,
  'stub: the event''s own facts and listing = named_only, no podium, no null keys');
select is(app.archive_stub_payload(t066.u(9999)), null, 'stub: null for an event that does not exist');

-- ============ the tick ============
update app.entitlement_keys set enforced = true where key = 'results_archive_optional';

select is(app.archive_tick(null),
  jsonb_build_object('dark', false, 'enqueued', 0, 'published', 2, 'stubbed', 5, 'skipped', 4, 'errored', 1),
  'enforced, no floor: 2 podiums (E1, E9), 5 stubs (E2, E3, E8, E10, E13), 4 skipped (E4, E6, E14, the missing event), E7 errored, E5 not due, no row created');
select is((select count(*)::int from app.archive_events where event_id = t066.u(1011)), 0, 'a null floor created no row');

-- E1: the Community podium, whitelisted
select is(t066.arch(1001, 'state') || '|' || t066.arch(1001, 'outcome_via') || '|' || coalesce(t066.arch(1001, 'last_error'), 'null'), 'published|auto|null', 'E1: published by the tick');
select is(t066.keys(t066.pub(1001)), 'city,competitors,eventDate,eventName,format,org_name,org_slug,podium,rounds,venue,winningTimeSecs',
  'E1: the public payload carries only the whitelisted keys plus the table''s own org stamp');
select is(t066.keys(t066.pub(1001) #> '{podium,0}'), 'cafe,correct,name,rank,total', 'E1: podium rows carry no phone or email');
select is(t066.pub(1001) #>> '{podium,0,name}', 'Alice', 'E1: the champion is the staged one');
select is(t066.pub(1001) ->> 'org_slug', 't066-community', 'E1: the existing stamp trigger ran (organiser slug)');
select is((select published_by from public_results where event_id = t066.u(1001)), null, 'E1: published_by is null (nobody signed in did it)');
select is((select staged_payload is null and staged_at is null from app.archive_events where event_id = t066.u(1001)), true, 'E1: the staged snapshot is cleared once published');

-- stubs, and why
select is(t066.arch(1002, 'state') || '|' || t066.arch(1002, 'last_error'), 'stubbed|no_snapshot', 'E2: no snapshot gives a stub, reason no_snapshot');
select is(t066.keys(t066.pub(1002)), 'eventDate,eventName,format,listing,org_name,org_slug', 'E2: the stub has no podium');
select is(t066.pub(1002) ->> 'listing', 'named_only', 'E2: and says named_only');
select is(t066.arch(1003, 'state') || '|' || t066.arch(1003, 'last_error'), 'stubbed|stale_snapshot', 'E3: a score changed after staging gives a stub, reason stale_snapshot');
select is(t066.pub(1003) ? 'podium', false, 'E3: the stale podium was not published');
select is(t066.arch(1013, 'state') || '|' || t066.arch(1013, 'last_error'), 'stubbed|invalid_snapshot', 'E13: nine podium rows give a stub, reason invalid_snapshot');
select is((select staged_payload is null from app.archive_events where event_id = t066.u(1003)), true, 'E3: the unused snapshot is cleared too');

-- is_test re-check
select is(t066.arch(1004, 'state') || '|' || t066.arch(1004, 'last_error'), 'skipped|is_test', 'E4: flipped to a test event after its row was made: skipped at publish time');
select is((select count(*)::int from public_results where event_id = t066.u(1004)), 0, 'E4: nothing was published for it');
select is((select staged_payload is null from app.archive_events where event_id = t066.u(1004)), true, 'E4: its snapshot was dropped');

-- not due
select is(t066.arch(1005, 'state'), 'pending', 'E5: not due yet, still pending');
select is((select count(*)::int from public_results where event_id = t066.u(1005)), 0, 'E5: nothing published before 24 hours');

-- an existing result is never overwritten
select is(t066.pub(1006) ->> 'eventName', 'Organiser own', 'E6: the organiser''s own result is untouched');
select is(t066.pub(1006) #>> '{podium,0,name}', 'Org Pick', 'E6: and its podium too');
select is(t066.arch(1006, 'state') || '|' || t066.arch(1006, 'outcome_via'), 'skipped|organiser_early', 'E6: skipped, organiser_early (published before due)');
select is(t066.pub(1014) ->> 'eventName', 'Organiser late', 'E14: an organiser result published after due_at but before the tick is untouched');
select is(t066.arch(1014, 'state') || '|' || t066.arch(1014, 'outcome_via'), 'skipped|organiser_late', 'E14: skipped, organiser_late');
select is(t066.arch(9999, 'state') || '|' || t066.arch(9999, 'last_error'), 'skipped|event_gone', 'a ledger row whose event is gone is skipped');

-- failure isolation
select is(t066.arch(1007, 'state') || '|' || t066.arch(1007, 'attempts') || '|' || t066.arch(1007, 'last_error'), 'pending|1|XX999',
  'E7: the failing event stays pending with one attempt and only the SQLSTATE recorded');
select is((select next_try_at = now() + interval '5 minutes' from app.archive_events where event_id = t066.u(1007)), true, 'E7: retried in 5 minutes');
select is((select count(*)::int from public_results where event_id = t066.u(1007)), 0, 'E7: nothing half-published');
select is((select count(*)::int from app.archive_events a where (to_jsonb(a) - 'staged_payload')::text ~* '(SECRET|Alice|6737)' and a.event_id = t066.u(1007)), 0,
  'E7: no message text, name or phone reached the ledger row (the member-staged snapshot is the only thing it holds)');

-- the paid-tier choice
select is(t066.arch(1008, 'state') || '|' || coalesce(t066.arch(1008, 'last_error'), 'null'), 'stubbed|null', 'E8: an annual organiser who did not tick gets a stub (their choice, no error)');
select is(t066.pub(1008) ? 'podium', false, 'E8: no podium');
select is(t066.arch(1009, 'state') || '|' || (t066.pub(1009) #>> '{podium,0,name}'), 'published|Alice', 'E9: an annual organiser who ticked list gets the podium');
select is(t066.arch(1010, 'state') || '|' || coalesce(t066.arch(1010, 'last_error'), 'null'), 'stubbed|null', 'E10: named_only gets a stub');
select is((select staged_payload is null from app.archive_events where event_id = t066.u(1010)), true, 'E10: and the snapshot it never used is cleared');

-- ============ the floor, and the double tick ============
select is(app.archive_tick(now() - interval '3 days'),
  jsonb_build_object('dark', false, 'enqueued', 1, 'published', 0, 'stubbed', 1, 'skipped', 0, 'errored', 0),
  'with a floor: one row is created (E11, ended after it) and worked; the finished ones are not touched; E7 waits for its retry time');
select is(t066.arch(1011, 'state') || '|' || t066.arch(1011, 'last_error'), 'stubbed|no_snapshot', 'E11: made by the tick, no snapshot, so a stub');
select is((select due_at = ended_at + interval '24 hours' from app.archive_events a join events e on e.id = a.event_id where a.event_id = t066.u(1011)), true,
  'E11: due_at is stored as ended_at + 24 hours');
select is((select count(*)::int from app.archive_events where event_id in (t066.u(1012), t066.u(1015))), 0,
  'E12 (ended before the floor) and E15 (a test event) got no row');
select is(app.archive_tick(now() - interval '3 days'),
  jsonb_build_object('dark', false, 'enqueued', 0, 'published', 0, 'stubbed', 0, 'skipped', 0, 'errored', 0),
  'a double tick does nothing: the second finds nothing pending and due');
select is((select count(*)::int from public_results where event_id in (select t066.u(n) from generate_series(1001, 1015) n)), 10,
  'ten results exist for the fifteen events: E1, E2, E3, E6, E8, E9, E10, E11, E13, E14, each exactly once');

-- a result removed after the tick is not published again
delete from public_results where event_id = t066.u(1001);
select is(app.archive_tick(now() - interval '3 days') ->> 'published', '0', 'E1 unpublished after the tick: the next tick does not publish it again');
select is((select count(*)::int from public_results where event_id = t066.u(1001)), 0, 'E1 stays unpublished (soft unpublish is not undone)');
-- T-ARC.3 (migration 20261101130000): the removal is now recorded; 'removed' is as terminal as the state it replaced
select is(t066.arch(1001, 'state'), 'removed', 'E1 is recorded as removed (T-ARC.3) and stays terminal');

-- ============ retry, backoff, give up ============
update app.archive_events set next_try_at = now() - interval '1 minute' where event_id = t066.u(1007);
select is(app.archive_tick(null) ->> 'errored', '1', 'E7 retried at its time and failed again');
select is((select attempts || '|' || (next_try_at = now() + interval '10 minutes') from app.archive_events where event_id = t066.u(1007)), '2|true', 'E7: attempt 2, backed off to 10 minutes');
do $$
begin
  for i in 1..3 loop
    update app.archive_events set next_try_at = now() - interval '1 minute' where event_id = '00000000-0000-0000-0000-000006601007' and state = 'pending';
    perform app.archive_tick(null);
  end loop;
end $$;
select is(t066.arch(1007, 'state') || '|' || t066.arch(1007, 'attempts') || '|' || t066.arch(1007, 'last_error'), 'failed|5|XX999', 'E7: after 5 attempts it is failed');
select is(app.archive_tick(null) ->> 'errored', '0', 'a failed event is left alone');
drop trigger trg_aaa_t066_boom on public.public_results;

-- the race: an organiser publishes between the tick's existence check and its insert (simulated by a trigger that writes the
-- organiser's row just before the tick's own row lands). The conflict must leave THEIR row, not overwrite it.
insert into events (id, org_id, format, name, event_date) values (t066.u(1016), t066.u(100), 'cup_taster', 'E16 race', date '2026-10-04');
update events set ended_at = now() - interval '25 hours', ended_via = 'organiser' where id = t066.u(1016);
insert into app.archive_events (event_id, org_id, due_at) values (t066.u(1016), t066.u(100), now() - interval '1 hour');
create function t066.racer() returns trigger language plpgsql as $$
begin
  if new.event_id = t066.u(1016) and pg_trigger_depth() = 1 then
    insert into public.public_results (org_id, event_id, payload) values (new.org_id, new.event_id, '{"eventName": "Won the race"}');
  end if;
  return new;
end $$;
create trigger trg_aaa_t066_racer before insert on public.public_results for each row execute function t066.racer();
select is(app.archive_tick(null) ->> 'skipped', '1', 'race: the tick lost the insert and skipped');
select is(t066.pub(1016) ->> 'eventName', 'Won the race', 'race: the organiser''s row was not overwritten');
select is(t066.arch(1016, 'state') || '|' || t066.arch(1016, 'outcome_via'), 'skipped|organiser_late', 'race: recorded as organiser_late');
drop trigger trg_aaa_t066_racer on public.public_results;

-- retention: a snapshot nobody used is cleared 30 days after due
insert into app.archive_events (event_id, org_id, due_at, state, staged_payload, staged_at)
values (t066.u(9998), t066.u(100), now() - interval '31 days', 'failed', t066.snap('Old'), now() - interval '32 days'),
       (t066.u(9997), t066.u(100), now() - interval '29 days', 'failed', t066.snap('Recent'), now() - interval '30 days');
do $$ begin perform app.archive_tick(null); end $$;
select is((select staged_payload is null from app.archive_events where event_id = t066.u(9998)), true, 'retention: a snapshot 31 days past due is cleared');
select is((select staged_payload is not null from app.archive_events where event_id = t066.u(9997)), true, 'retention: one 29 days past due is kept');

-- ============ nobody on the API side reaches any of it ============
select is(t066.as_role('authenticated', t066.u(1), 'select * from app.archive_events'), '42501|', 'a member of the organisation cannot read the ledger');
select is(t066.as_role('authenticated', t066.u(1), format('insert into app.archive_events (event_id, org_id) values (%L, %L)', t066.u(8001), t066.u(100))), '42501|', 'nor insert');
select is(t066.as_role('authenticated', t066.u(1), format('update app.archive_events set listing_choice = ''list'' where event_id = %L', t066.u(1008))), '42501|', 'nor update (the tick box is not a client write; T-ARC.3 adds a definer RPC)');
select is(t066.as_role('authenticated', t066.u(1), 'delete from app.archive_events'), '42501|', 'nor delete');
select is(t066.as_role('authenticated', t066.u(1), 'select app.archive_tick(null)'), '42501|', 'nor run the tick');
select is(t066.as_role('authenticated', t066.u(1), format('select app.archive_process_one(%L)', t066.u(1005))), '42501|', 'nor the per-event worker');
select is(t066.as_role('authenticated', t066.u(1), $q$select app.archive_snapshot_payload('{}'::jsonb)$q$), '42501|', 'nor the whitelist helper');
select is(t066.as_role('authenticated', t066.u(1), format('select app.archive_stub_payload(%L)', t066.u(1005))), '42501|', 'nor the stub helper');
select is(t066.as_role('authenticated', t066.u(2), 'select * from app.archive_events'), '42501|', 'a stranger (a member of another organisation) cannot read it either');
select is(t066.as_role('authenticated', t066.u(2), 'select app.archive_tick(null)'), '42501|', 'nor run the tick');
select is(t066.as_role('authenticated', null, 'select * from app.archive_events'), '42501|', 'a signed-in token with no user cannot read it');
select is(t066.as_role('anon', null, 'select * from app.archive_events'), '42501|', 'anon cannot read it');
select is(t066.as_role('anon', null, 'select app.archive_tick(null)'), '42501|', 'anon cannot run the tick');
select is(t066.as_role('service_role', null, 'select * from app.archive_events'), '42501|', 'the service role cannot read it');
select is(t066.as_role('service_role', null, format('insert into app.archive_events (event_id, org_id) values (%L, %L)', t066.u(8001), t066.u(100))), '42501|', 'nor write it');
select is(t066.as_role('service_role', null, 'select app.archive_tick(null)'), '42501|', 'nor run the tick');
-- belt and braces: even if the ACL were widened by mistake, the tick refuses an API session by name
grant execute on function app.archive_tick(timestamptz) to anon, authenticated, service_role;
-- service_role has no USAGE on schema app, which would refuse it before the function is reached: give it, for this check only
select set_config('t066.had_usage', has_schema_privilege('service_role', 'app', 'usage')::text, true);
grant usage on schema app to service_role;
select is(t066.as_role('authenticated', t066.u(1), 'select app.archive_tick(null)'), '42501|archive_tick_owner_only', 'with a widened ACL the tick still refuses authenticated by name');
select is(t066.as_role('anon', null, 'select app.archive_tick(null)'), '42501|archive_tick_owner_only', '... and anon');
select is(t066.as_role('service_role', null, 'select app.archive_tick(null)'), '42501|archive_tick_owner_only', '... and the service role');
revoke all on function app.archive_tick(timestamptz) from public, anon, authenticated, service_role;
do $$ begin
  if current_setting('t066.had_usage') = 'false' then revoke usage on schema app from service_role; end if;
end $$;
select is(has_function_privilege('authenticated', 'app.archive_tick(timestamptz)', 'execute'), false, 'the test put the ACL back');

-- ============ constraints and the frozen parent ============
select throws_ok(format('insert into app.archive_events (event_id, org_id, state) values (%L, %L, ''bogus'')', t066.u(8002), t066.u(100)), '23514', null, 'a state outside the set is refused');
select throws_ok(format('insert into app.archive_events (event_id, org_id, listing_choice) values (%L, %L, ''maybe'')', t066.u(8002), t066.u(100)), '23514', null, 'a listing choice outside the set is refused');
select throws_ok(format('insert into app.archive_events (event_id, org_id, outcome_via) values (%L, %L, ''organiser_before_due'')', t066.u(8002), t066.u(100)), '23514', null, 'an outcome outside the set is refused');
select throws_ok(format('insert into app.archive_events (event_id, org_id, attempts) values (%L, %L, 6)', t066.u(8002), t066.u(100)), '23514', null, 'more than 5 attempts is refused');
select throws_ok(format('insert into app.archive_events (event_id, org_id, last_error) values (%L, %L, ''boom Alice +6737000001'')', t066.u(8002), t066.u(100)), '23514', null, 'free text in last_error is refused (a code only)');
select throws_ok(format('insert into app.archive_events (event_id, org_id, staged_payload) values (%L, %L, ''{}'')', t066.u(8002), t066.u(100)), '23514', null, 'a snapshot without staged_at is refused');
select throws_ok(format('insert into app.archive_events (event_id, org_id, staged_payload, staged_at) values (%L, %L, ''[]'', now())', t066.u(8002), t066.u(100)), '23514', null, 'a snapshot that is not an object is refused');
select throws_ok(format('insert into app.archive_events (event_id, org_id, state) values (%L, %L, ''published'')', t066.u(8002), t066.u(100)), '23514', null, 'a published row must say how');
select throws_ok(format('insert into app.archive_events (event_id, org_id) values (%L, %L)', t066.u(1008), t066.u(100)), '23505', null, 'one row per event');
select throws_ok(format('update app.archive_events set event_id = %L where event_id = %L', t066.u(8003), t066.u(1008)), '23001', null, 'a row cannot move to another event');
select throws_ok(format('update app.archive_events set org_id = %L where event_id = %L', t066.u(300), t066.u(1008)), '23001', null, 'nor to another organisation');

select * from finish();
rollback;
