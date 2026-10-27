-- T-GATE.B5 follow-up: the set-based locked-events function and public_event_summary (20261027100000).
-- Proves:
--   * the new app.window_locked_events() answers EXACTLY what the previous definition (one app.event_window_ended() call per ended
--     grant, copied below as t058.old_locked) answered, on a deliberately messy set of grants, and what app.event_window_locked()
--     says event by event: an ended single grant, an extension that is current / ended, a revoked grant (also one revoked in the
--     future), a window not started, an open-ended grant, no grant, an organisation-level plan that is current / revoked / expired /
--     not started, and an organisation-level grant of the LOWEST tier (not a plan);
--   * dark, it is empty;
--   * public_event_summary skips a locked event (also one with the live session), offers an unlocked one, and offers everything
--     again while the key is off; privileges and definer settings are unchanged;
--   * the cost guard: the buffer reads of the locked set grow by a few pages per ended grant, not by the ~20 the previous
--     definition read; the guard is proven to bite by measuring the previous definition against the same limit.
begin;
select plan(39);

create schema t058;
create function t058.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000580' || lpad(n::text, 4, '0'))::uuid
$$;

-- the previous definition, verbatim from 20261023140000 (the cost of the equivalence is irrelevant here)
create function t058.old_locked() returns setof uuid language sql stable as $$
  select g.event_id
    from public.entitlement_grants g
   where app.window_lock_on()
     and g.event_id is not null and g.valid_until is not null and g.valid_until <= now()
     and (g.revoked_at is null or g.revoked_at > now())
     and app.event_window_ended(g.event_id, now())
   group by g.event_id
$$;

-- buffer reads (hits + reads) of one statement, from EXPLAIN (ANALYZE, BUFFERS): a count, not a clock, so it does not flake
create function t058.buffers(stmt text) returns bigint language plpgsql as $$
declare j jsonb;
begin
  execute 'explain (analyze, buffers, format json) ' || stmt into j;
  return coalesce((j -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0) + coalesce((j -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0);
end $$;

-- ============ fixtures (as the owner) ============
insert into orgs (id, name, slug) values
  (t058.u(100), 'T058 C', 't058-c'), (t058.u(200), 'T058 A', 't058-a'), (t058.u(300), 'T058 R', 't058-r'),
  (t058.u(400), 'T058 E', 't058-e'), (t058.u(500), 'T058 F', 't058-f'), (t058.u(600), 'T058 L', 't058-l'), (t058.u(700), 'T058 B', 't058-b');
insert into events (id, org_id, format, name, event_date)
  select t058.u(n), t058.u(o), 'cup_taster', 'e' || n, date '2026-10-10'
    from (values (1,100),(2,100),(3,100),(4,100),(5,100),(6,100),(7,100),(8,100),(9,200),(10,300),(11,400),(12,500),(13,600),(14,100),(15,100),(16,100),(17,100),(18,700),(19,100)) v(n, o);

-- organisation-level grants: A current annual; R annual REVOKED; E annual EXPIRED; F annual not started; L a grant of the LOWEST tier
insert into entitlement_grants (org_id, tier, valid_from, valid_until, revoked_at, source) values
  (t058.u(200), 'annual', now() - interval '1 day', null, null, 'manual'),
  (t058.u(300), 'annual', now() - interval '5 days', null, now() - interval '1 hour', 'manual'),
  (t058.u(400), 'annual', now() - interval '10 days', now() - interval '1 day', null, 'manual'),
  (t058.u(500), 'annual', now() + interval '1 day', null, null, 'manual'),
  (t058.u(600), 'community', now() - interval '1 day', null, null, 'manual'),
  (t058.u(700), 'annual', now() - interval '5 days', now(), null, 'manual');   -- B: its plan ends at exactly this instant (valid_until is exclusive)

-- event grants. An ended window is now()-8d .. now()-3d.
insert into entitlement_grants (id, org_id, event_id, tier, valid_from, valid_until, revoked_at, source, extends_grant_id) values
  (t058.u(9001), t058.u(100), t058.u(1),  'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 1 ended: LOCKED
  (t058.u(9002), t058.u(100), t058.u(2),  'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 2 ended ...
  (t058.u(9102), t058.u(100), t058.u(2),  'per_event', now() - interval '3 days', now() + interval '2 days', null, 'manual', t058.u(9002)),        -- ... with a CURRENT extension
  (t058.u(9003), t058.u(100), t058.u(3),  'per_event', now() - interval '8 days', now() - interval '3 days', now() - interval '4 days', 'manual', null), -- 3 revoked
  (t058.u(9004), t058.u(100), t058.u(4),  'per_event', now() + interval '2 days', now() + interval '7 days', null, 'manual', null),                 -- 4 not started
  (t058.u(9005), t058.u(100), t058.u(5),  'per_event', now() - interval '8 days', now() - interval '3 days', now() + interval '1 hour', 'manual', null), -- 5 revoked in the FUTURE: counts: LOCKED
  (t058.u(9006), t058.u(100), t058.u(6),  'per_event', now() - interval '10 days', now() - interval '5 days', null, 'manual', null),                -- 6 ended base ...
  (t058.u(9106), t058.u(100), t058.u(6),  'per_event', now() - interval '5 days', now() - interval '2 days', null, 'manual', t058.u(9006)),        -- ... and an ended extension: LOCKED (once)
  (t058.u(9007), t058.u(100), t058.u(7),  'per_event', now() - interval '8 days', null, null, 'manual', null),                                      -- 7 open-ended: not locked
  (t058.u(9009), t058.u(200), t058.u(9),  'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 9 org plan current: not locked
  (t058.u(9010), t058.u(300), t058.u(10), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 10 org plan revoked: LOCKED
  (t058.u(9011), t058.u(400), t058.u(11), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 11 org plan expired: LOCKED
  (t058.u(9012), t058.u(500), t058.u(12), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 12 org plan not started: LOCKED
  (t058.u(9013), t058.u(600), t058.u(13), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 13 org grant of the lowest tier: LOCKED
  (t058.u(9014), t058.u(100), t058.u(14), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 14 ended base ...
  (t058.u(9114), t058.u(100), t058.u(14), 'per_event', now() + interval '2 days', now() + interval '6 days', null, 'manual', t058.u(9014)),        -- ... and an extension that has NOT STARTED: LOCKED
  (t058.u(9015), t058.u(100), t058.u(15), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 15 ended base ...
  (t058.u(9115), t058.u(100), t058.u(15), 'per_event', now() - interval '3 days', now() + interval '2 days', now() + interval '1 hour', 'manual', t058.u(9015)), -- ... and a current extension revoked only in the FUTURE: still current: not locked
  (t058.u(9016), t058.u(100), t058.u(16), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 16 ended base ...
  (t058.u(9116), t058.u(100), t058.u(16), 'per_event', now() - interval '3 days', now() + interval '2 days', now() - interval '1 hour', 'manual', t058.u(9016)), -- ... and a current extension already REVOKED: LOCKED
  (t058.u(9017), t058.u(100), t058.u(17), 'per_event', now() - interval '5 days', now(), null, 'manual', null),                                     -- 17 its window ends at exactly this instant: LOCKED (exclusive end)
  (t058.u(9018), t058.u(700), t058.u(18), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 18 org plan ended at exactly this instant: LOCKED
  (t058.u(9019), t058.u(100), t058.u(19), 'per_event', now() - interval '8 days', now() - interval '3 days', null, 'manual', null),                 -- 19 ended base ...
  (t058.u(9119), t058.u(100), t058.u(19), 'per_event', now(), now() + interval '2 days', null, 'manual', t058.u(9019));                              -- ... and an extension that starts at exactly this instant: current: not locked
-- (event 8 has no grant at all)

-- ============ dark ============
select is((select count(*)::int from app.window_locked_events()), 0, 'dark (event_window_lock unenforced): the locked set is empty');

-- ============ enforced: the set, and the equivalence ============
update app.entitlement_keys set enforced = true where key = 'event_window_lock';
select is(
  (select array_agg(x order by x) from app.window_locked_events() x),
  array[t058.u(1), t058.u(5), t058.u(6), t058.u(10), t058.u(11), t058.u(12), t058.u(13), t058.u(14), t058.u(16), t058.u(17), t058.u(18)],
  'enforced: exactly the events 1, 5, 6, 10 to 14, 16, 17 and 18 are locked');
select is(
  (select array_agg(x order by x) from app.window_locked_events() x),
  (select array_agg(x order by x) from t058.old_locked() x),
  'and that is exactly what the previous definition answered');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(1)), 1, '1: an ended single event grant locks the event');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(2)), 0, '2: a CURRENT extension of an ended grant unlocks it');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(3)), 0, '3: a REVOKED ended grant does not lock');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(4)), 0, '4: a window that has not started does not lock');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(5)), 1, '5: a grant revoked only in the FUTURE still counts as an ended window: locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(6)), 1, '6: an ended base and an ended extension lock the event, and it is listed once');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(7)), 0, '7: an open-ended event grant (no end) never locks');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(8)), 0, '8: an event with no grant is not locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(9)), 0, '9: an organisation-level plan that is current: never locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(10)), 1, '10: the organisation-level plan was REVOKED: locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(11)), 1, '11: the organisation-level plan EXPIRED: locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(12)), 1, '12: the organisation-level plan has not started: locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(13)), 1, '13: an organisation-level grant of the LOWEST tier is not a plan: locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(14)), 1, '14: an ended base with an extension that has NOT STARTED is locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(15)), 0, '15: an extension revoked only in the FUTURE is still current: not locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(16)), 1, '16: an extension already REVOKED does not unlock: locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(17)), 1, '17: a window that ends at exactly now is ended (valid_until is exclusive): locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(18)), 1, '18: an organisation plan that ends at exactly now is over (exclusive end): locked');
select is((select count(*)::int from app.window_locked_events() x where x = t058.u(19)), 0, '19: an extension that starts at exactly now is current (valid_from is inclusive): not locked');
select is((select count(*)::int from app.window_locked_events()), (select count(distinct x)::int from app.window_locked_events() x), 'no event is listed twice');
select is(
  (select count(*)::int from events e where (e.id in (select app.window_locked_events())) is distinct from app.event_window_locked(e.id)),
  0, 'the set agrees with app.event_window_locked() for every event (the per-event engine my_entitlements uses)');

-- ============ public_event_summary ============
insert into live_sessions (id, org_id, event_id, format, active) values (t058.u(8001), t058.u(100), t058.u(1), 'cup_taster', true);   -- the locked event is the one running live
select is((select count(*)::int from public.public_event_summary(t058.u(100))), 1, 'public_event_summary offers one event of an organisation that has locked and unlocked ones');
select ok(
  (select r.id from public.public_event_summary(t058.u(100)) r) not in (select app.window_locked_events()),
  'and it is never a locked one, even though the locked E1 is the event with the live session');
select is((select count(*)::int from public.public_event_summary(t058.u(300))), 0, 'an organisation whose only event is locked offers nothing');
select is((select count(*)::int from public.public_event_summary(t058.u(200))), 1, 'an organisation with an organisation-level plan always offers its event');
update app.entitlement_keys set enforced = false where key = 'event_window_lock';
select is((select count(*)::int from public.public_event_summary(t058.u(300))), 1, 'dark: the same organisation offers its event again');
select is((select r.id from public.public_event_summary(t058.u(100)) r), t058.u(1), 'dark: the live session decides again (E1 is the live event)');
update app.entitlement_keys set enforced = true where key = 'event_window_lock';

-- ============ privileges and definer settings unchanged ============
select is(has_function_privilege('anon', 'app.window_locked_events()', 'execute'), true, 'anon may run window_locked_events (the audience policy needs it)');
select is(has_function_privilege('authenticated', 'app.window_locked_events()', 'execute'), true, 'authenticated too');
select is(has_function_privilege('service_role', 'app.window_locked_events()', 'execute'), false, 'the service role may not');
select is(has_function_privilege('anon', 'public.public_event_summary(uuid)', 'execute'), true, 'anon may still call public_event_summary');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'app.window_locked_events()'::regprocedure),
  true, 'window_locked_events is SECURITY DEFINER with search_path pinned');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.public_event_summary(uuid)'::regprocedure),
  true, 'public_event_summary is SECURITY DEFINER with search_path pinned');

-- ============ the cost guard ============
-- 300 more events with an ended window each (ids 1000 to 1299), all in one organisation (the worst case for the organisation check)
insert into events (id, org_id, format, name, event_date)
  select t058.u(1000 + n), t058.u(100), 'cup_taster', 'g' || n, date '2026-10-10' from generate_series(0, 299) n;
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  select t058.u(100), t058.u(1000 + n), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual' from generate_series(0, 299) n;
analyze entitlement_grants;
analyze events;
select t058.buffers('select count(*) from app.window_locked_events()');   -- warm the caches
create temp table cost058 as select
  (select count(*)::int from entitlement_grants where event_id is not null and valid_until <= now() and (revoked_at is null or revoked_at > now())) as n,
  t058.buffers('select count(*) from app.window_locked_events()') as new_set,
  t058.buffers('select count(*) from t058.old_locked()') as old_set,
  t058.buffers('select count(*) from public.public_event_summary(''' || t058.u(100) || ''')') as summary;
select diag(format('buffer reads for %s ended grants: new set %s, previous definition %s, public_event_summary %s', n, new_set, old_set, summary)) from cost058;
select ok((select new_set from cost058) < 6 * (select n from cost058), 'the locked set reads fewer than 6 pages per ended grant (about 3 measured; the previous definition read 16 to 22)');
select ok((select summary from cost058) < 6 * (select n from cost058), 'public_event_summary reads fewer than 6 pages per event with an ended window');
select ok((select old_set from cost058) > 2 * (select new_set from cost058), 'the guard bites: the previous definition reads more than twice as many pages as the new one');

select * from finish();
rollback;
