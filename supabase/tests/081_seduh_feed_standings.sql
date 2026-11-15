-- T-ID2.B2: the Seduh ID feed reads the full standings, and the archive snapshot carries them (migration
-- 20261117100000_seduh_feed_standings.sql; owner decisions 2026-11-15, spec 14.7). Test 071 holds the rest of the feed's contract
-- (ACLs, undo, caps, auto, refusals) and its assertions were updated for this change; this file proves the NEW behaviour on its own
-- fictional fixtures (names 'T081 ...', phones +673810xxxx, ids 00000000-0000-0000-0000-0000081xxxxx), rolled back at the end:
--   * a published result with `standings` is queued, a podium-only one still is (unchanged), a standings-only one is, a stub and a
--     test event never are; while the mode is off nothing is queued but the review counts a standings result as "published, not queued";
--   * the feed names every standings row that passes the door's match rule (exactly one roster entry by trimmed name and cafe, with a
--     person of the event's organisation) and the phone rules, and NOBODY else: an ambiguous name, a walk-up, a renamed entry, a
--     person of another organisation, a bad phone, a blank name and a test event create nothing;
--   * podium and standings naming one person is ONE slot, one identity and one link; a podium-only result names exactly its podium;
--   * idempotent: running again creates and links nothing; a podium-only result later widened to full standings is re-queued
--     and creates only the people the widening added;
--   * the archive snapshot whitelist keeps the podium rules (8 rows, 64 KB), and now carries standings (200 rows, only the keys the
--     results page reads, a name cut to 120, nothing else) and notListed with them; a standings array that is too long, empty or has an
--     unusable row is dropped whole and the podium still publishes; the stub is unchanged and names nobody;
--   * the migration's rollback (the three previous definitions, restored here) brings back the podium-only behaviour.
begin;
select plan(73);

create schema t081;
grant usage on schema t081 to anon, authenticated, service_role;

create function t081.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000081' || lpad(n::text, 5, '0'))::uuid
$$;
create function t081.rid(event_n int) returns uuid language sql stable as $$
  select id from public.public_results where event_id = t081.u(event_n)
$$;
create function t081.qstate(event_n int) returns text language sql stable as $$
  select state from app.seduh_feed_queue where result_id = t081.rid(event_n)
$$;
create function t081.gpi(person int) returns uuid language sql stable as $$
  select global_person_id from public.people where id = t081.u(person)
$$;
create function t081.has_identity(phone text) returns boolean language sql stable as $$
  select exists (select 1 from app.seduh_identities where phone_e164 = phone)
$$;
create function t081.keys(j jsonb) returns text language sql immutable as $$
  select string_agg(k, ',' order by k) from jsonb_object_keys(j) k
$$;
-- 'ok', or SQLSTATE || ': ' || message (the statement is rolled back)
create function t081.attempt(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ': ' || sqlerrm;
end $$;
-- one event of an organisation with a person and an entry for each phone given (person n: u(base + i), entry u(base + 500 + i))
create function t081.mk_event(event_n int, org uuid, base int, phones text[], is_test boolean default false) returns void language plpgsql as $$
declare i int;
begin
  insert into public.events (id, org_id, format, name, is_test) values (t081.u(event_n), org, 'cup_taster', 'T081 E' || event_n, is_test);
  for i in 1 .. cardinality(phones) loop
    insert into public.people (id, org_id, display_name, phone) values (t081.u(base + i), org, 'T081 P' || (base + i), phones[i]);
    insert into public.event_entries (id, event_id, person_id, display_name, cafe)
    values (t081.u(base + 500 + i), t081.u(event_n), t081.u(base + i), 'T081 P' || (base + i), 'Cafe T');
  end loop;
end $$;
create function t081.rows_of(first_n int, last_n int, key text) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object(key, i - first_n + 1, 'name', 'T081 P' || i, 'cafe', 'Cafe T') order by i) from generate_series(first_n, last_n) i
$$;
grant execute on all functions in schema t081 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into orgs (id, name, slug) values (t081.u(9001), 'T081 X', 't081-x'), (t081.u(9002), 'T081 Y', 't081-y');
alter table people drop constraint people_phone_e164;   -- one bad phone has to exist for a case; undone by the rollback at the end

update app.seduh_feed_mode set mode = 'off', org_daily_cap = 8, global_daily_cap = 40;

-- E1: six people; the podium is P1..P3, the standings P1..P5 (P6 withdrew and is not listed)
select t081.mk_event(1, t081.u(9001), 100, array['+6738100001', '+6738100002', '+6738100003', '+6738100004', '+6738100005', '+6738100006']);
-- E2: podium only (P7..P9 are entered, only the podium is published)
select t081.mk_event(2, t081.u(9001), 200, array['+6738100011', '+6738100012', '+6738100013']);
-- E3: a payload with standings and NO podium key (P1..P2)
select t081.mk_event(3, t081.u(9001), 300, array['+6738100021', '+6738100022']);
-- E4: the match-rule failures, plus one good person (u(401))
select t081.mk_event(4, t081.u(9001), 400, array['+6738100031']);
insert into people (id, org_id, display_name, phone) values
  (t081.u(410), t081.u(9001), 'T081 Twin A', '+6738100032'), (t081.u(411), t081.u(9001), 'T081 Twin B', '+6738100033'),
  (t081.u(412), t081.u(9001), 'T081 Renamed', '+6738100034'), (t081.u(413), t081.u(9002), 'T081 Cross', '+6738100035'),
  (t081.u(414), t081.u(9001), 'T081 BadPhone', '555-0199');
alter table event_entries disable trigger trg_event_entries_person_org_check;   -- the cross-organisation entry needs it; rolled back with the test
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t081.u(910), t081.u(4), t081.u(410), 'T081 Twin', 'Cafe T'), (t081.u(911), t081.u(4), t081.u(411), 'T081 Twin', 'Cafe T'),   -- two entries, one name+cafe
  (t081.u(912), t081.u(4), null,        'T081 Walkup', 'Cafe T'),                                                                -- no person
  (t081.u(913), t081.u(4), t081.u(412), 'T081 Renamed Now', 'Cafe T'),                                                           -- renamed after publishing
  (t081.u(914), t081.u(4), t081.u(413), 'T081 Cross', 'Cafe T'),                                                                 -- a person of another organisation
  (t081.u(915), t081.u(4), t081.u(414), 'T081 BadPhone', 'Cafe T');
-- E5: published, then marked a test event (the BEFORE trigger refuses to publish a test event, so it is flagged afterwards)
select t081.mk_event(5, t081.u(9001), 500, array['+6738100041']);
-- E6: a stub
select t081.mk_event(6, t081.u(9001), 600, array['+6738100042']);
-- E7: podium-only, later widened to full standings
select t081.mk_event(7, t081.u(9001), 700, array['+6738100051', '+6738100052', '+6738100053', '+6738100054', '+6738100055']);
-- E8: standings only, published while the mode is off
select t081.mk_event(8, t081.u(9001), 800, array['+6738100061']);
-- E9: a test event from the start
select t081.mk_event(9, t081.u(9001), 900, array['+6738100071'], true);

-- ============ mode off: nothing is queued, and the review counts the standings result as not queued ============

create temp table base (n int) on commit drop;
insert into base select (app.seduh_feed_review() ->> 'podium_results_not_queued')::int;
insert into public_results (org_id, event_id, payload) values
  (t081.u(9001), t081.u(8), jsonb_build_object('format', 'cup_taster', 'standings', t081.rows_of(801, 801, 'place')));
select is(t081.qstate(8), null, 'mode off: a published standings-only result is not queued');
select is((app.seduh_feed_review() ->> 'podium_results_not_queued')::int - (select n from base), 1,
  'the review counts a published standings result with no queue row (the key keeps its old name)');

-- ============ queue mode: what is queued ============

update app.seduh_feed_mode set mode = 'queue';

insert into public_results (org_id, event_id, published_at, payload) values
  (t081.u(9001), t081.u(1), '2026-02-01 10:00+00', jsonb_build_object('format', 'cup_taster', 'eventName', 'T081 E1',
     'podium', t081.rows_of(101, 103, 'rank'), 'standings', t081.rows_of(101, 105, 'place'), 'notListed', 1)),
  (t081.u(9001), t081.u(2), '2026-02-02 10:00+00', jsonb_build_object('format', 'cup_taster', 'podium', t081.rows_of(201, 203, 'rank'))),
  (t081.u(9001), t081.u(3), '2026-02-03 10:00+00', jsonb_build_object('format', 'cup_taster', 'standings',
     jsonb_build_array(jsonb_build_object('place', 1, 'name', ' T081 P301'), t081.rows_of(302, 302, 'place') -> 0))),
  (t081.u(9001), t081.u(4), '2026-02-04 10:00+00', jsonb_build_object('format', 'cup_taster', 'standings', jsonb_build_array(
     jsonb_build_object('place', 1, 'name', 'T081 P401', 'cafe', 'Cafe T'),
     jsonb_build_object('place', 2, 'name', 'T081 Twin', 'cafe', 'Cafe T'),
     jsonb_build_object('place', 3, 'name', 'T081 Walkup', 'cafe', 'Cafe T'),
     jsonb_build_object('place', 4, 'name', 'T081 Renamed', 'cafe', 'Cafe T'),
     jsonb_build_object('place', 5, 'name', 'T081 Cross', 'cafe', 'Cafe T'),
     jsonb_build_object('place', 6, 'name', 'T081 BadPhone', 'cafe', 'Cafe T'),
     jsonb_build_object('place', 7, 'name', '  ', 'cafe', 'Cafe T')))),
  (t081.u(9001), t081.u(5), '2026-02-05 10:00+00', jsonb_build_object('format', 'cup_taster', 'standings', t081.rows_of(501, 501, 'place'))),
  (t081.u(9001), t081.u(6), '2026-02-06 10:00+00', jsonb_build_object('format', 'cup_taster', 'eventName', 'T081 E6', 'listing', 'named_only')),
  (t081.u(9001), t081.u(7), '2026-02-07 10:00+00', jsonb_build_object('format', 'cup_taster', 'podium', t081.rows_of(701, 703, 'rank')));
update events set is_test = true where id = t081.u(5);
-- E3's first entry is padded and has a blank cafe; the published row has an unpadded-by-one name and no cafe key: the match is by TRIMMED name and café
update event_entries set display_name = '  T081 P301 ', cafe = '  ' where id = t081.u(801);

select is((select string_agg(e.n::text || '=' || coalesce(t081.qstate(e.n), 'none'), ',' order by e.n) from unnest(array[1, 2, 3, 4, 5, 6, 7, 8]) e(n)),
  '1=queued,2=queued,3=queued,4=queued,5=queued,6=none,7=queued,8=none',
  'queue mode: a result with standings, a podium-only one and a standings-only one are queued; a stub is not; the one published while off still is not');
select is(t081.attempt(format($q$ insert into public_results (org_id, event_id, payload) values (%L, %L,
    '{"standings": [{"place": 1, "name": "T081 P901", "cafe": "Cafe T"}]}'::jsonb) $q$, t081.u(9001), t081.u(9))) <> 'ok', true,
  'a test event cannot be published at all (so a test event is never queued from the start)');
select is((select count(*)::int from app.seduh_feed_queue where result_id in (select id from public_results where event_id = t081.u(9))), 0, '...and nothing was queued for it');
select is((select count(*)::int from app.seduh_identities where phone_e164 like '+673810%'), 0, 'QUEUEING CREATED NOTHING');

-- ============ the plan: who is named ============

select is((select string_agg(distinct p.person_id::text, ',' order by p.person_id::text) from app.seduh_feed_plan_internal(array[t081.rid(1)]) p where p.class = 'eligible'),
  (select string_agg(t081.u(i)::text, ',' order by t081.u(i)::text) from generate_series(101, 105) i),
  'E1 (podium P1..P3, standings P1..P5) names exactly P1..P5: the standings rows, with the podium three counted once each');
select is((select count(*)::int from app.seduh_feed_plan_internal(array[t081.rid(1)]) where person_id = t081.u(106)), 0, '...and not P6, who is in neither list');
select is((select count(*)::int from app.seduh_feed_plan_internal(array[t081.rid(1)])), 5, '...five rows: one per person, nobody twice');
select is((select string_agg(distinct p.person_id::text, ',' order by p.person_id::text) from app.seduh_feed_plan_internal(array[t081.rid(2)]) p),
  (select string_agg(t081.u(i)::text, ',' order by t081.u(i)::text) from generate_series(201, 203) i),
  'E2 (podium only) names exactly its podium three: unchanged');
select is((select string_agg(distinct p.person_id::text, ',' order by p.person_id::text) from app.seduh_feed_plan_internal(array[t081.rid(3)]) p),
  (select string_agg(t081.u(i)::text, ',' order by t081.u(i)::text) from generate_series(301, 302) i),
  'E3 (standings and no podium key) names its standings rows');
select is((select string_agg(distinct p.person_id::text, ',') from app.seduh_feed_plan_internal(array[t081.rid(4)]) p where p.class = 'eligible'), t081.u(401)::text,
  'E4: of seven rows only the one that matches exactly one entry, with a person of this organisation and a valid phone, is eligible');
select is((select class from app.seduh_feed_plan_internal(array[t081.rid(4)]) where person_id = t081.u(414)), 'bad_phone', '...the bad phone is classed bad_phone, never repaired');
select is((select count(*)::int from app.seduh_feed_plan_internal(array[t081.rid(4)]) where person_id in (t081.u(410), t081.u(411), t081.u(412), t081.u(413))), 0,
  '...nobody for the ambiguous name (Twin), the renamed entry, or the person of another organisation (the walk-up and the blank name have none to name)');
select is((select count(*)::int from app.seduh_feed_plan_internal(array[t081.rid(5)])), 0, 'E5 (flagged as a test event after publishing) names nobody');

-- the review reads the standings: E1 would create 5 identities, E4 one
create temp table review as select app.seduh_feed_review() as r;
select is((select (x ->> 'identities_to_create')::int from review, jsonb_array_elements(r -> 'queued_results') x where x ->> 'result_id' = t081.rid(1)::text), 5,
  'the review: E1 would create 5 identities');
select is((select (x ->> 'identities_to_create') || '/' || (x ->> 'skipped_bad_phone') from review, jsonb_array_elements(r -> 'queued_results') x where x ->> 'result_id' = t081.rid(4)::text), '1/1',
  '...E4 would create 1 and skip 1 bad phone');
select is((select (x ->> 'identities_to_create')::int from review, jsonb_array_elements(r -> 'queued_results') x where x ->> 'result_id' = t081.rid(5)::text), 0, '...E5 (test) would create none');
select is((select r::text ~ '\+[0-9]{6}' or r::text ~* 't081' from review), false, '...and the review holds no phone and no name');
select is((select (r -> 'queue' ->> 'queued')::int from review) >= 6, true, '...and the queue counts still read');

-- ============ the owner's run ============

create temp table run1 as
  select app.seduh_identity_feed(array[t081.rid(1), t081.rid(2), t081.rid(3), t081.rid(4), t081.rid(5), t081.rid(7)]) as r;
select is((select r ->> 'results_processed' from run1), '6', 'the run processed the six queued results it was given');
select is((select r ->> 'identities_created' from run1), '14',
  'it created 14 identities: E1 five (P1..P5), E2 three, E3 two, E4 one (the good person), E7 three; E5 (test) none');
select is((select count(*)::int from app.seduh_identities where phone_e164 like '+673810%' and source = 'archive' and status = 'active'), 14, '...all source archive, status active');
select is((select string_agg(t081.gpi(i)::text is not null || '', ',' order by i) from generate_series(101, 106) i), 'true,true,true,true,true,false',
  'E1: P1..P5, three of them outside the podium, are linked; P6 (in neither list) is not');
select is(t081.has_identity('+6738100004') and t081.has_identity('+6738100005'), true, '...and the two standings-only people (P4, P5) got identities');
select is((select display_name from app.seduh_identities where phone_e164 = '+6738100004'), 'T081 P104', '...named from the published record');
select is(t081.has_identity('+6738100006'), false, 'nothing for the person in neither list (P6)');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6738100001', '+6738100002', '+6738100003')), 3,
  'a person in both the podium and the standings has ONE identity (P1..P3)');
select is(t081.gpi(401) is not null and t081.gpi(410) is null and t081.gpi(411) is null and t081.gpi(412) is null and t081.gpi(413) is null and t081.gpi(414) is null, true,
  'E4: the good person is linked; the ambiguous pair, the renamed entry, the person of another organisation and the bad phone are not');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6738100032', '+6738100033', '+6738100034', '+6738100035')), 0, '...and no identity was made for their phones');
select is((select phone from people where id = t081.u(414)), '555-0199', '...the bad phone was not repaired');
select is(t081.has_identity('+6738100041'), false, 'nothing for the test event (E5)');
select is((select count(*)::int from people where id in (t081.u(701), t081.u(702), t081.u(703)) and global_person_id is not null), 3, 'E7 (podium only): the podium three are linked');
select is((select count(*)::int from people where id in (t081.u(704), t081.u(705)) and global_person_id is not null), 0, '...and the two entered but not published are not');
select is((select string_agg(t081.qstate(e.n), ',' order by e.n) from unnest(array[1, 2, 3, 4, 5, 7]) e(n)), 'processed,processed,processed,processed,processed,processed',
  'all six queue rows are processed');
select is((select cardinality(created_identity_ids) || '/' || cardinality(linked_person_ids) from app.seduh_feed_queue where result_id = t081.rid(1)), '5/5',
  'the row of E1 records the five identities it created and the five people it linked (what undo uses)');

-- idempotent: nothing is queued again by an identical save, and running the same ids creates and links nothing
update public_results set payload = payload where event_id = t081.u(1);
select is(t081.qstate(1), 'processed', 'an identical re-save does not queue a processed result again');
select is((select count(*)::int from app.seduh_feed_queue where result_id = t081.rid(1)), 1, '...and there is still one queue row for it');
select is((app.seduh_identity_feed(array[t081.rid(1), t081.rid(4)]) ->> 'results_processed')::int, 0, 'running processed results again processes nothing (they are not queued)');
select is((select count(*)::int from app.seduh_identities where phone_e164 like '+673810%'), 14, '...and creates no identity');

-- a podium-only result widened to full standings is queued again and creates only the people the widening added
update public_results set payload = payload || jsonb_build_object('standings', t081.rows_of(701, 705, 'place')) where event_id = t081.u(7);
select is(t081.qstate(7), 'queued', 'E7 widened to full standings is queued again for review');
select is((select (r ->> 'identities_created') || '/' || (r ->> 'people_linked') from (select app.seduh_identity_feed(array[t081.rid(7)]) as r) x), '2/2',
  'the second run creates and links only the two added people (P704, P705); the podium three already had theirs');
select is((select count(*)::int from app.seduh_identities where phone_e164 like '+673810%'), 16, '...16 identities in all, none twice');
select is((select cardinality(created_identity_ids) || '/' || cardinality(linked_person_ids) from app.seduh_feed_queue where result_id = t081.rid(7)), '5/5',
  '...and the row keeps what the first run recorded and adds the new');

-- a result published while the mode was off has no queue row: the run counts it and does nothing
select is((select r ->> 'results_processed' || '/' || (r ->> 'results_not_queued') from (select app.seduh_identity_feed(array[t081.rid(8)]) as r) x), '0/1',
  'E8 (published while the mode was off, so never queued) is counted and left alone');
select is(t081.has_identity('+6738100061'), false, '...nothing was created for it');

-- ============ the archive snapshot whitelist ============

create function t081.pod(n int) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('rank', i, 'name', 'W' || i, 'cafe', 'C', 'correct', 5, 'total', 6) order by i) from generate_series(1, n) i
$$;
create function t081.std(n int) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('place', i, 'name', 'S' || i, 'cafe', 'C', 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 200 + i,
                                       'phone', '+6738100099', 'email', 'x@example.test', 'id', 'abc') order by i) from generate_series(1, n) i
$$;
grant execute on all functions in schema t081 to anon, authenticated, service_role;

select is(t081.keys(app.archive_snapshot_payload(jsonb_build_object('format', 'cup_taster', 'podium', t081.pod(3), 'standings', t081.std(10), 'notListed', 2, 'internalNote', 'x'))),
  'format,notListed,podium,standings', 'snapshot: standings and notListed are carried; an unknown key is dropped');
select is(jsonb_array_length(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(10))) -> 'standings'), 10, '...all ten standings rows');
select is(t081.keys(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(2))) #> '{standings,0}'), 'cafe,correct,name,place,round,timeSecs,total',
  'a standings row keeps place, name, cafe, round, correct, total, timeSecs only (no phone, email or id)');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(2))) #>> '{standings,1,name}', 'S2', '...in the order given');
select is(jsonb_array_length(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(200))) -> 'standings'), 200, 'snapshot: 200 standings rows are carried');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(201))) ? 'standings', false, '...201 are dropped whole');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(201))) #>> '{podium,0,name}', 'W1', '...and the podium still publishes');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', '[]'::jsonb, 'notListed', 2)) ?| array['standings', 'notListed'], false,
  'an empty standings array is omitted, and so is a notListed that goes with none');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'notListed', 2)) ? 'notListed', false, 'notListed alone (no standings) is dropped');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(3) || '[{"place": 4, "name": "  "}]'::jsonb)) ? 'standings', false,
  'one unusable standings row (a blank name) drops the whole array: never a part of a ranking');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(3) || '["text"]'::jsonb)) ? 'standings', false,
  '...and so does a row that is not an object');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', jsonb_build_object('place', 1))) ? 'standings', false, '...and a standings value that is not an array');
select is(length(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(1), 'standings',
  jsonb_build_array(jsonb_build_object('name', repeat('n', 300), 'cafe', repeat('c', 300), 'round', repeat('r', 300))))) #>> '{standings,0,name}'), 120, 'a standings name is cut to 120');
select is(length(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(1), 'standings',
  jsonb_build_array(jsonb_build_object('name', 'n', 'cafe', repeat('c', 300), 'round', repeat('r', 300)))) ) #>> '{standings,0,cafe}'), 120, '...and a cafe');
select is(app.archive_snapshot_payload(jsonb_build_object('pad', repeat('x', 70000), 'podium', t081.pod(1), 'standings', t081.std(2))), null, 'over 64 KB is still unusable');
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(9), 'standings', t081.std(3))), null, 'a nine-row podium is still unusable');
select is(app.archive_snapshot_payload(jsonb_build_object('standings', t081.std(3))), null, 'standings with no podium are not a snapshot (a podium is still required)');
select is(octet_length(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(200)))::text) < 65536, true, 'a full 200-row snapshot stays under the 64 KB cap');
select is(t081.keys(app.archive_stub_payload(t081.u(6))), 'eventName,format,listing', 'the stub is unchanged: names nobody (no podium, no standings)');
select is(app.archive_snapshot_payload(null), null, 'a null snapshot is unusable');
select is(
  (select app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings',
     (select jsonb_agg(jsonb_build_object('name', repeat('n', 120), 'cafe', repeat('c', 120))) from generate_series(1, 200)))) ? 'standings'),
  false, 'an input under 64 KB whose rebuilt output would exceed it drops the standings whole (the staged column has the same cap)');
select is(octet_length(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings',
  (select jsonb_agg(jsonb_build_object('name', repeat('n', 120), 'cafe', repeat('c', 120))) from generate_series(1, 200))))::text) <= 65536, true,
  '...and the output stays within 64 KB');

-- ============ the migration's rollback: the three previous definitions come back ============

savepoint rollback_block;
create or replace function app.enqueue_seduh_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- a save that left the payload as it was (the archive tick and the organiser's republish can both do that) asks nothing new
    if tg_op = 'UPDATE' and new.payload is not distinct from old.payload then
      return null;
    end if;
    -- `off` (the default) and a missing mode row enqueue nothing; a stub or a podium-less payload names nobody (decision 5:
    -- podium only); a test event is never queued (the BEFORE trigger already refuses to publish one)
    if coalesce((select m.mode from app.seduh_feed_mode m), 'off') in ('queue', 'auto')
       and jsonb_typeof(new.payload -> 'podium') = 'array'
       and jsonb_array_length(new.payload -> 'podium') > 0
       and exists (select 1 from public.events e where e.id = new.event_id and e.is_test is not true) then
      -- a changed payload on a PROCESSED result asks for a new review; what is recorded for undo and processed_at (which the caps read)
      -- stay, so a member cannot reset a cap by republishing. A result the owner REJECTED or UNDID is not revived by a member:
      -- the owner puts it back with SQL if they want it looked at again
      insert into app.seduh_feed_queue as q (result_id, org_id)
      values (new.id, new.org_id)
      on conflict (result_id) do update
         set state = 'queued', enqueued_at = now(), last_error = null
       where q.state = 'processed';
    end if;
  exception when others then
    null;   -- a publish must never fail because of the feed
  end;
  return null;
end;
$$;
create or replace function app.seduh_feed_slots_internal(p_result_ids uuid[] default null)
returns table (result_id uuid, published_at timestamptz, nm text, cf text, entry_count integer, person_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with slots as (
    select distinct
           pr.id as result_id, pr.published_at, e.id as event_id, e.org_id,
           btrim(s.elem ->> 'name') as nm,
           coalesce(btrim(s.elem ->> 'cafe'), '') as cf
    from public.public_results pr
    join public.events e on e.id = pr.event_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pr.payload -> 'podium') = 'array' then pr.payload -> 'podium' else '[]'::jsonb end) as s(elem)
    where e.is_test is not true
      and (p_result_ids is null or pr.id = any (p_result_ids))
      and nullif(btrim(s.elem ->> 'name'), '') is not null
  )
  select s.result_id, s.published_at, s.nm, s.cf,
         count(en.id)::integer as entry_count,
         case when count(en.id) = 1 then (array_agg(p.id))[1] end as person_id
  from slots s
  left join public.event_entries en
    on en.event_id = s.event_id
   and btrim(en.display_name) = s.nm
   and coalesce(btrim(en.cafe), '') = s.cf
  left join public.people p
    on p.id = en.person_id
   and p.org_id = s.org_id
  group by s.result_id, s.published_at, s.nm, s.cf;
$$;
create or replace function app.archive_snapshot_payload(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_top    jsonb;
  v_podium jsonb;
  v_n      integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 65536 then
    return null;
  end if;
  if coalesce(jsonb_typeof(p -> 'podium'), '') <> 'array' then
    return null;
  end if;
  v_n := jsonb_array_length(p -> 'podium');
  if v_n < 1 or v_n > 8 then
    return null;
  end if;
  -- every row an object with a non-blank text name (the champion is row 1)
  if exists (
       select 1 from jsonb_array_elements(p -> 'podium') r
        where jsonb_typeof(r) <> 'object' or coalesce(jsonb_typeof(r -> 'name'), '') <> 'string' or nullif(btrim(r ->> 'name'), '') is null) then
    return null;
  end if;

  select coalesce(jsonb_object_agg(e.key,
                    case when jsonb_typeof(e.value) = 'string' then to_jsonb(left(e.value #>> '{}', 200)) else e.value end), '{}'::jsonb)
    into v_top
    from jsonb_each(p) e
   where e.key in ('format', 'eventName', 'city', 'venue', 'eventDate', 'competitors', 'rounds', 'winningTimeSecs')
     and jsonb_typeof(e.value) = case when e.key in ('competitors', 'rounds', 'winningTimeSecs') then 'number' else 'string' end;

  select jsonb_agg(jsonb_build_object(
           'rank',    case when jsonb_typeof(r.v -> 'rank')    = 'number' then r.v -> 'rank'    end,
           'name',    to_jsonb(left(r.v ->> 'name', 120)),
           'cafe',    case when jsonb_typeof(r.v -> 'cafe')    = 'string' then to_jsonb(left(r.v ->> 'cafe', 120)) end,
           'correct', case when jsonb_typeof(r.v -> 'correct') = 'number' then r.v -> 'correct' end,
           'total',   case when jsonb_typeof(r.v -> 'total')   = 'number' then r.v -> 'total'   end)
         order by r.ord)
    into v_podium
    from jsonb_array_elements(p -> 'podium') with ordinality as r(v, ord);

  return v_top || jsonb_build_object('podium', v_podium);
end;
$$;

select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(3))) ? 'standings', false,
  'rollback: the previous whitelist drops standings again');
select is((select count(distinct person_id)::int from app.seduh_feed_slots_internal(array[t081.rid(1)]) where person_id is not null), 3,
  'rollback: the previous matching names only the podium of E1 (three people)');
update public_results set payload = jsonb_build_object('format', 'cup_taster', 'standings', t081.rows_of(601, 601, 'place')) where event_id = t081.u(6);
select is(t081.qstate(6), null, 'rollback: the previous trigger does not queue a standings-only result');
rollback to savepoint rollback_block;
select is(app.archive_snapshot_payload(jsonb_build_object('podium', t081.pod(3), 'standings', t081.std(3))) ? 'standings', true, '(rolled back again: the whitelist carries standings)');
select is((select count(distinct person_id)::int from app.seduh_feed_slots_internal(array[t081.rid(1)]) where person_id is not null), 5, '(...and the matching reads the standings)');

select * from finish();
rollback;
