-- T-ID.D1a: the Seduh ID archive feed, review-queue mode (spec: Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md
-- section 5 and T-ID-D1-BUILD-BRIEF.md; migration 20261103100000_seduh_feed.sql; the counts column is in 065).
-- Proves, with fixtures that carry unique ids and are rolled back (the local database is shared with other sessions, so every
-- assertion is about THIS file's people, phones and results):
--   * the mode is `off` by default and then NOTHING is queued (a publish, a changed payload); `queue` queues a published PODIUM of
--     a non-test event and nothing else (a stub with no podium is not queued); NOTHING IS CREATED OR LINKED by queueing;
--   * the trigger is fail open: with the queue broken (a constraint that refuses every row) a publish still succeeds;
--   * a member's publish (role authenticated, once through the RPC and once as a raw insert) enqueues and creates nothing, and
--     that member can neither read nor write the queue or the mode nor call any feed function (the ACL refuses; with the ACL
--     opened by mistake each function still refuses an API role by name);
--   * the trigger is an AFTER ROW trigger (test 045's guard targets BEFORE ROW definer triggers and does not match it);
--   * the owner's run creates, for a person NAMED in a published non-test podium, an identity (source archive, status active, the
--     published name cut to 120, a valid country) and links them; it creates NOTHING for: a test event, a bad phone, an owner-blocked
--     person, an ambiguous name slot, a walk-up entry, a renamed entry, a roster-only person, a person named only in the full
--     standings (the deliberate difference from B4: podium only), a stub; it reuses an opted_out identity (inert, still nameless),
--     a merged tombstone (the kept identity) and an active one (name and country never overwritten); it leaves a person linked
--     elsewhere alone; two organisations holding one phone share ONE identity;
--   * CONTRACT with B4: for the same podium results the feed's plan equals B4's plan except for the person named only in the
--     standings, and the identities and links a run leaves equal B4's, row for row;
--   * `off` refuses the owner's run; a null or empty list is refused (there is no "all"); an id not in the queue is counted, not run;
--   * idempotent; an identical re-save does not re-queue; a changed payload re-queues what was already processed and keeps the
--     lists undo needs; a phone change nulls the link (existing guard) and a processed result is not re-run, so nothing re-links;
--   * undo unlinks only the recorded people still linked to an identity the run created and deletes only identities that are
--     still archive/active with nobody linked and no tombstone pointing at them (an identity that gained a person, one opted out
--     since, and one a tombstone points at are kept; a person linked elsewhere since is untouched), and a second undo does nothing;
--   * `auto`: nothing runs unless the mode is auto; the per-organisation and global daily caps keep the rest QUEUED (an exact
--     hand-worked case), only the last 24 hours count, and a raised cap lets the same rows through;
--   * the reports hold counts and uuids only (no phone, no name); the queue holds ids only; the catalog: no API role has any
--     privilege on the two tables, every function is SECURITY DEFINER with search_path '' and executable by no API role;
--   * the migration's rollback block, run here, removes everything and a publish still works afterwards.
begin;
select plan(180);

create schema t071;
grant usage on schema t071 to anon, authenticated, service_role;

-- 'ok', or SQLSTATE || ': ' || message; the statement always runs inside a sub-transaction that is rolled back.
create function t071.attempt(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ': ' || sqlerrm;
end $$;
create function t071.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function t071.rid(event_n int) returns uuid language sql stable as $$
  select id from public.public_results where event_id = t071.u(event_n)
$$;
create function t071.gpi(person int) returns uuid language sql stable as $$
  select global_person_id from public.people where id = t071.u(person)
$$;
create function t071.identity_for(phone text) returns uuid language sql stable as $$
  select id from app.seduh_identities where phone_e164 = phone
$$;
create function t071.qstate(event_n int) returns text language sql stable as $$
  select state from app.seduh_feed_queue where result_id = t071.rid(event_n)
$$;
-- an event of an organisation with n people (named 'T071 P<event>_<i>', phones given), each entered with the cafe 'Cafe T'
create function t071.mk_event(event_n int, org uuid, phones text[]) returns void language plpgsql as $$
declare i int;
begin
  insert into public.events (id, org_id, format, name, is_test) values (t071.u(event_n), org, 'cup_taster', 'T071 E' || event_n, false);
  for i in 1 .. cardinality(phones) loop
    insert into public.people (id, org_id, display_name, phone) values (t071.u(event_n * 10 + i), org, 'T071 P' || event_n || '_' || i, phones[i]);
    insert into public.event_entries (id, event_id, person_id, display_name, cafe)
    values (t071.u(event_n * 100 + i), t071.u(event_n), t071.u(event_n * 10 + i), 'T071 P' || event_n || '_' || i, 'Cafe T');
  end loop;
end $$;
-- the first k of those people as a podium
create function t071.podium_of(event_n int, k int) returns jsonb language sql immutable as $$
  select jsonb_build_object('format', 'cup_taster', 'podium',
           (select jsonb_agg(jsonb_build_object('rank', i, 'name', 'T071 P' || event_n || '_' || i, 'cafe', 'Cafe T') order by i)
              from generate_series(1, k) i))
$$;
-- everything this file's runs leave behind, as one text (identities of the +673971 numbers, then the links of 'T071 ' people),
-- leaving out the one person who is named only in a standings array and so is outside the feed by design
create function t071.snapshot() returns text language sql stable as $$
  select coalesce((select string_agg(i.phone_e164 || '|' || coalesce(i.display_name, '~') || '|' || coalesce(i.country, '~') || '|'
                                      || i.source || '|' || i.status, ';' order by i.phone_e164)
                     from app.seduh_identities i
                    where i.phone_e164 like '+673971%' and i.phone_e164 <> '+6739710010'), '')
         || '#' ||
         coalesce((select string_agg(p.display_name || '>' || coalesce(i.phone_e164, '~'), ';' order by p.display_name)
                     from public.people p left join app.seduh_identities i on i.id = p.global_person_id
                    where p.display_name like 'T071 %' and p.display_name <> 'T071 Juliet'), '')
$$;
-- run a statement, take a snapshot, and undo it all: returns the snapshot (a function-local rollback, via an exception)
create function t071.snap_after(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception '%', t071.snapshot() using errcode = 'P9998';
exception when sqlstate 'P9998' then
  return sqlerrm;
end $$;
-- the same, for the plan tables of the two matchers, compared both ways
create function t071.plan_diff(a text, b text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select coalesce(string_agg(person_id::text, '','' order by person_id), ''none'') from (select * from %s except select * from %s) x', a, b) into r;
  return r;
end $$;
grant execute on all functions in schema t071 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values (t071.u(7101), 'u1@t071.seduh-next'), (t071.u(7102), 'u2@t071.seduh-next');
insert into orgs (id, name, slug) values (t071.u(7110), 'T071 A', 't071-a'), (t071.u(7111), 'T071 B', 't071-b');
insert into org_members (org_id, user_id, role) values (t071.u(7110), t071.u(7101), 'owner'), (t071.u(7111), t071.u(7102), 'owner');

-- one bad phone has to exist for the skip case; the CHECK would refuse it, so it is dropped for this transaction only
alter table people drop constraint people_phone_e164;

-- identities that exist before the run
insert into app.seduh_identities (id, phone_e164, display_name, country, source, status) values
  (t071.u(7801), '+6739710006', null,                  null,        'archive', 'opted_out'),
  (t071.u(7803), '+6739710017', 'T071 Kept',           null,        'archive', 'active'),
  (t071.u(7804), '+6739710008', 'T071 Existing Golf',  'Elsewhere', 'organiser_roster', 'active'),
  (t071.u(7805), '+6739710019', 'T071 Other Identity', null,        'archive', 'active');
insert into app.seduh_identities (id, phone_e164, display_name, source, status, merged_into) values
  (t071.u(7802), '+6739710007', null, 'archive', 'merged', t071.u(7803));

-- org A: events 7201 (podium: Alpha, Bravo, Charlie, Twin), 7202 (Echo, Foxtrot, Golf, Hotel; Juliet is in the standings only),
-- 7203 (a walk-up, a renamed entry, plus a roster-only person with no entry), 7204 (published, then marked test),
-- 7207 (published while the mode is off). Org B: 7205 (Oscar, and Papa who holds Alpha's phone).
insert into events (id, org_id, format, name, is_test) values
  (t071.u(7201), t071.u(7110), 'cup_taster', 'T071 E1', false),
  (t071.u(7202), t071.u(7110), 'cup_taster', 'T071 E2', false),
  (t071.u(7203), t071.u(7110), 'cup_taster', 'T071 E3', false),
  (t071.u(7204), t071.u(7110), 'cup_taster', 'T071 E4', false),
  (t071.u(7205), t071.u(7111), 'cup_taster', 'T071 E5', false),
  (t071.u(7206), t071.u(7110), 'cup_taster', 'T071 E6', false),
  (t071.u(7207), t071.u(7110), 'cup_taster', 'T071 E7', false);
insert into people (id, org_id, display_name, phone, country) values
  (t071.u(7601), t071.u(7110), 'T071 Alpha',   '+6739710001', ' Brunei '),
  (t071.u(7602), t071.u(7110), 'T071 Bravo',   '555-0102',    null),
  (t071.u(7603), t071.u(7110), 'T071 Charlie', '+6739710003', null),
  (t071.u(7604), t071.u(7110), 'T071 Delta',   '+6739710004', null),
  (t071.u(7605), t071.u(7110), 'T071 Delta2',  '+6739710005', null),
  (t071.u(7606), t071.u(7110), 'T071 Echo',    '+6739710006', null),
  (t071.u(7607), t071.u(7110), 'T071 Foxtrot', '+6739710007', null),
  (t071.u(7608), t071.u(7110), 'T071 Golf',    '+6739710008', 'Brunei'),
  (t071.u(7609), t071.u(7110), 'T071 Hotel',   '+6739710009', null),
  (t071.u(7610), t071.u(7110), 'T071 Juliet',  '+6739710010', null),
  (t071.u(7613), t071.u(7110), 'T071 Lima',    '+6739710013', null),
  (t071.u(7614), t071.u(7110), 'T071 Mike',    '+6739710014', null),
  (t071.u(7615), t071.u(7110), 'T071 Nova',    '+6739710015', null),
  (t071.u(7616), t071.u(7111), 'T071 Oscar',   '+6739710016', 'Malaysia'),
  (t071.u(7617), t071.u(7111), 'T071 Papa',    '+6739710001', null),
  (t071.u(7618), t071.u(7110), 'T071 Quebec',  '+6739710020', null);
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t071.u(7805) where id = t071.u(7609);
select set_config('app.seduh_link_write', '', true);
insert into app.person_link_blocks (person_id, phone_e164) values (t071.u(7603), '+6739710003');
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t071.u(7901), t071.u(7201), t071.u(7601), 'T071 Alpha',   'Cafe X'),
  (t071.u(7902), t071.u(7201), t071.u(7602), 'T071 Bravo',   'Cafe X'),
  (t071.u(7903), t071.u(7201), t071.u(7603), 'T071 Charlie', 'Cafe X'),
  (t071.u(7904), t071.u(7201), t071.u(7604), 'T071 Twin',    'Cafe X'),
  (t071.u(7905), t071.u(7201), t071.u(7605), 'T071 Twin',    'Cafe X'),
  (t071.u(7906), t071.u(7202), t071.u(7606), 'T071 Echo',    'Cafe X'),
  (t071.u(7907), t071.u(7202), t071.u(7607), 'T071 Foxtrot', 'Cafe X'),
  (t071.u(7908), t071.u(7202), t071.u(7608), 'T071 Golf',    'Cafe X'),
  (t071.u(7909), t071.u(7202), t071.u(7609), 'T071 Hotel',   'Cafe X'),
  (t071.u(7910), t071.u(7202), t071.u(7610), 'T071 Juliet',  'Cafe X'),
  (t071.u(7911), t071.u(7203), null,         'T071 Kilo walk-up', 'Cafe X'),
  (t071.u(7912), t071.u(7203), t071.u(7614), 'T071 Mike',    'Cafe X'),
  (t071.u(7913), t071.u(7204), t071.u(7615), 'T071 Nova',    'Cafe X'),
  (t071.u(7914), t071.u(7205), t071.u(7616), 'T071 Oscar',   'Cafe Y'),
  (t071.u(7915), t071.u(7205), t071.u(7617), 'T071 Papa',    'Cafe Y'),
  (t071.u(7916), t071.u(7207), t071.u(7618), 'T071 Quebec',  'Cafe X');

create temp table reports (kind text primary key, r jsonb) on commit drop;

-- ============ the mode is off by default, and then nothing is queued ============

select is((select mode || '/' || org_daily_cap || '/' || global_daily_cap from app.seduh_feed_mode), 'off/8/40',
  'the mode is off by default, with the caps of 8 per organisation and 40 in all per 24 hours');
select is((select count(*)::int from app.seduh_feed_mode), 1, '...and it is one row');

insert into public_results (org_id, event_id, published_at, payload) values
  (t071.u(7110), t071.u(7207), '2026-01-03 10:00+00', jsonb_build_object('format', 'cup_taster',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T071 Quebec', 'cafe', 'Cafe X'))));
select is(t071.qstate(7207), null, 'mode off: a published podium is not queued');
update public_results set payload = payload || '{"venue": "x"}'::jsonb where event_id = t071.u(7207);
select is(t071.qstate(7207), null, '...nor is a changed payload');
select is((select count(*)::int from app.seduh_feed_queue where org_id in (t071.u(7110), t071.u(7111))), 0, '...nothing at all is on the queue');
select is(t071.attempt('select app.seduh_identity_feed(array[gen_random_uuid()])'), 'P0001: the Seduh ID feed is off', 'mode off: the owner''s run is refused');
select is((select r ->> 'mode' from (select app.seduh_feed_review() as r) x), 'off', 'the review says the mode is off');
select is((select (app.seduh_feed_review() ->> 'podium_results_not_queued')::int), (select count(*)::int from public_results pr join events e on e.id = pr.event_id
            where e.is_test is not true and jsonb_typeof(pr.payload -> 'podium') = 'array' and jsonb_array_length(pr.payload -> 'podium') > 0), 'the review counts the podiums published but never queued (every one, while off)');
select is(t071.attempt('select app.seduh_feed_auto_run()'), 'ok', 'the auto job runs and...');
select is((select app.seduh_feed_auto_run() ->> 'ran'), 'false', '...does nothing unless the mode is auto');

-- ============ queue mode: publishing queues the podium and creates nothing ============

update app.seduh_feed_mode set mode = 'queue';

insert into public_results (org_id, event_id, published_at, payload) values
  (t071.u(7110), t071.u(7201), '2026-01-01 10:00+00', jsonb_build_object('format', 'cup_taster', 'eventName', 'T071 E1',
     'podium', jsonb_build_array(
       jsonb_build_object('rank', 1, 'name', 'T071 Alpha', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 2, 'name', 'T071 Bravo', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 3, 'name', 'T071 Charlie', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 4, 'name', 'T071 Twin', 'cafe', 'Cafe X')))),
  (t071.u(7110), t071.u(7202), '2026-01-02 10:00+00', jsonb_build_object('format', 'cup_taster', 'eventName', 'T071 E2',
     'podium', jsonb_build_array(
       jsonb_build_object('rank', 1, 'name', 'T071 Echo', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 2, 'name', 'T071 Foxtrot', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 3, 'name', 'T071 Golf', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 4, 'name', 'T071 Hotel', 'cafe', 'Cafe X')),
     'standings', jsonb_build_array(
       jsonb_build_object('place', 1, 'name', 'T071 Echo', 'cafe', 'Cafe X'),
       jsonb_build_object('place', 5, 'name', 'T071 Juliet', 'cafe', 'Cafe X')))),
  (t071.u(7110), t071.u(7203), '2026-01-03 10:00+00', jsonb_build_object('format', 'cup_taster',
     'podium', jsonb_build_array(
       jsonb_build_object('rank', 1, 'name', 'T071 Kilo walk-up', 'cafe', 'Cafe X'),
       jsonb_build_object('rank', 2, 'name', 'T071 Mike Renamed', 'cafe', 'Cafe X')))),
  (t071.u(7110), t071.u(7204), '2026-01-04 10:00+00', jsonb_build_object('format', 'cup_taster',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T071 Nova', 'cafe', 'Cafe X')))),
  (t071.u(7111), t071.u(7205), '2026-01-05 10:00+00', jsonb_build_object('format', 'cup_taster',
     'podium', jsonb_build_array(
       jsonb_build_object('rank', 1, 'name', 'T071 Oscar', 'cafe', 'Cafe Y'),
       jsonb_build_object('rank', 2, 'name', 'T071 Papa', 'cafe', 'Cafe Y')))),
  (t071.u(7110), t071.u(7206), '2026-01-06 10:00+00', jsonb_build_object('format', 'cup_taster', 'eventName', 'T071 E6',
     'listing', 'named_only'));   -- a stub: no podium
update events set is_test = true where id = t071.u(7204);

select is((select string_agg(e.n::text || '=' || coalesce(t071.qstate(e.n), 'none'), ',' order by e.n) from unnest(array[7201, 7202, 7203, 7204, 7205, 7206, 7207]) e(n)),
  '7201=queued,7202=queued,7203=queued,7204=queued,7205=queued,7206=none,7207=none',
  'queue mode: the five published podiums are queued; the stub (no podium) is not; the one published while off still is not');
select is((select count(*)::int from app.seduh_feed_queue where org_id in (t071.u(7110), t071.u(7111))), 5, '...five rows, nothing else');
select is((select string_agg(distinct (q.org_id = pr.org_id)::text, ',') from app.seduh_feed_queue q join public_results pr on pr.id = q.result_id), 'true',
  'each queue row carries its result''s organisation');
select is((select count(*)::int from app.seduh_identities where phone_e164 like '+673971%'), 5, 'QUEUEING CREATED NOTHING: only the five identities the fixtures made exist (four, and a tombstone)');
select is((select count(*)::int from people where display_name like 'T071 %' and global_person_id is not null), 1,
  '...and linked nothing: only the one person the fixtures linked (Hotel)');

-- a changed payload on a row still waiting changes nothing; an identical re-save asks nothing
update public_results set payload = payload where event_id = t071.u(7201);
select is((select enqueued_at = now() from app.seduh_feed_queue where result_id = t071.rid(7201)), true, 'an identical re-save leaves the queued row as it was');

-- ============ the review (dry run): counts and ids ============

insert into reports select 'review', app.seduh_feed_review();
select is((select r ->> 'mode' from reports where kind = 'review'), 'queue', 'the review says the mode is queue');
select is((select (r -> 'queue' ->> 'queued')::int from reports where kind = 'review') >= 5, true, '...with the queue counts by state');
create function t071.rv(event_n int, key text) returns int language sql stable as $$
  select (x ->> key)::int from reports r, jsonb_array_elements(r.r -> 'queued_results') x
   where r.kind = 'review' and x ->> 'result_id' = t071.rid(event_n)::text
$$;
grant execute on function t071.rv(int, text) to authenticated;
select is(t071.rv(7201, 'identities_to_create') || '/' || t071.rv(7201, 'skipped_bad_phone') || '/' || t071.rv(7201, 'skipped_blocked'), '1/1/1',
  'E1 would create 1 (Alpha), skips 1 bad phone and 1 owner-blocked person; the ambiguous Twin slot names nobody');
select is(t071.rv(7202, 'identities_to_create') || '/' || t071.rv(7202, 'identities_reused') || '/' || t071.rv(7202, 'people_linked_elsewhere'), '0/3/1',
  'E2 would create 0, reuse 3 identities (opted_out, the tombstone''s kept one, the active one) and finds 1 person linked elsewhere; Juliet (standings only) is not read');
select is(t071.rv(7203, 'identities_to_create') || '/' || t071.rv(7203, 'people_to_link'), '0/0', 'E3 (a walk-up and a renamed entry) would create nothing');
select is(t071.rv(7204, 'identities_to_create'), 0, 'E4 (the event is now a test event) would create nothing');
select is(t071.rv(7205, 'identities_to_create'), 2, 'E5 would create 2 (Oscar, and Papa who holds the phone Alpha will get)');
select is((select (x ->> 'identities_to_create')::int from reports r, jsonb_array_elements(r.r -> 'by_org') x
            where r.kind = 'review' and x ->> 'org_id' = t071.u(7110)::text), 1, 'per organisation: A would create 1');
select is((select (x ->> 'identities_to_create')::int from reports r, jsonb_array_elements(r.r -> 'by_org') x
            where r.kind = 'review' and x ->> 'org_id' = t071.u(7111)::text), 2, '...B would create 2');
select is((select count(*)::int from reports r where r.kind = 'review' and (r.r::text ~ '\+[0-9]{6}' or r.r::text ~* 't071' or r.r::text like '%555-01%')), 0,
  'the review holds counts and uuids only: no phone, no name');
select is((select count(*)::int from app.seduh_identities where phone_e164 like '+673971%'), 5, 'the review created nothing');

-- ============ the contract with B4: the same decision for the same podium ============

create temp table ids_ab on commit drop as
  select array_agg(id order by id) as ids from public_results where event_id in (t071.u(7201), t071.u(7202), t071.u(7203), t071.u(7204), t071.u(7205));
select is(t071.plan_diff('app.seduh_backfill_plan_internal((select ids from ids_ab))', 'app.seduh_feed_plan_internal((select ids from ids_ab))'),
  t071.u(7610)::text, 'B4''s plan has exactly one row the feed''s does not: the person named only in the standings (the deliberate difference)');
select is(t071.plan_diff('app.seduh_feed_plan_internal((select ids from ids_ab))', 'app.seduh_backfill_plan_internal((select ids from ids_ab))'),
  'none', '...and the feed''s plan has nothing B4''s lacks: same class, same rank, same name, same identity, same link');
select is((select count(*)::int from app.seduh_feed_plan_internal((select ids from ids_ab)) where class = 'eligible'), 7,
  'the plan found seven eligible people (Alpha, Echo, Foxtrot, Golf, Hotel, Oscar, Papa; B4 would add an eighth, Juliet)');
select isnt(t071.snap_after('select app.seduh_identity_backfill(true, (select ids from ids_ab))'), t071.snapshot(), 'a B4 run changes the snapshot (the comparison below compares something)');
select is(t071.snap_after('select app.seduh_identity_feed((select ids from ids_ab))'), t071.snap_after('select app.seduh_identity_backfill(true, (select ids from ids_ab))'),
  'THE CONTRACT: the identities and links an owner run of the feed leaves are exactly the ones B4 leaves for the same podiums (name, country, source, status, every link)');
select is(t071.snapshot(), t071.snap_after('select 1'), '...and both of those runs were rolled back (the snapshot is unchanged)');

-- ============ refusals before any run ============

select is(t071.attempt('select app.seduh_identity_feed(null)'), '22023: seduh_identity_feed needs the result ids you chose', 'a null list is refused: there is no "all"');
select is(t071.attempt('select app.seduh_identity_feed(array[]::uuid[])'), '22023: seduh_identity_feed needs the result ids you chose', '...and so is an empty one');

-- ============ the owner's run ============

insert into reports select 'run', app.seduh_identity_feed(array[t071.rid(7201), t071.rid(7202), t071.rid(7203), t071.rid(7204), t071.rid(7205), t071.rid(7206), t071.rid(7207), t071.u(1)]);
select is((select r ->> 'results_processed' from reports where kind = 'run'), '5', 'the run processed the five queued results');
select is((select r ->> 'results_not_queued' from reports where kind = 'run'), '3', '...and counted the three ids that were not queued (the stub, the one published while off, an unknown id) without running them');
select is((select r ->> 'identities_created' from reports where kind = 'run'), '2', 'it created 2 identities (Alpha, Oscar; Papa holds the phone of Alpha and creates none)');
select is((select source || '/' || status || '/' || display_name || '/' || country from app.seduh_identities where phone_e164 = '+6739710001'), 'archive/active/T071 Alpha/Brunei',
  'Alpha, named in a published non-test podium, got an identity: source archive, status active, the published name, the trimmed country');
select is(t071.gpi(7601), t071.identity_for('+6739710001'), '...and is linked to it');
select is(t071.gpi(7617), t071.identity_for('+6739710001'), 'Papa (another organisation, the same phone) is linked to the SAME identity');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739710001'), 1, '...one identity for the phone');
select is((select display_name from app.seduh_identities where phone_e164 = '+6739710016'), 'T071 Oscar', 'Oscar''s identity is named from the published record');
select is(t071.gpi(7616), t071.identity_for('+6739710016'), '...and Oscar is linked');
select is((select country from app.seduh_identities where phone_e164 = '+6739710016'), 'Malaysia', '...with their country');

select is(t071.identity_for('+6739710015'), null, 'nothing for a TEST event (Nova)');
select is(t071.identity_for('+6739710002'), null, 'nothing for the bad phone... (Bravo has none to give)');
select is((select phone from people where id = t071.u(7602)), '555-0102', '...and Bravo''s phone was not repaired or touched');
select is(t071.gpi(7602), null, '...Bravo is not linked');
select is(t071.identity_for('+6739710003'), null, 'nothing for an owner-blocked person (Charlie)');
select is(t071.gpi(7603), null, '...who stays unlinked');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6739710004', '+6739710005')), 0, 'nothing for two entries the podium cannot tell apart (Delta and Delta2)');
select is(t071.identity_for('+6739710010'), null, 'NOTHING for a person named only in the full standings (Juliet): the feed is podium only');
select is(t071.gpi(7610), null, '...and Juliet is not linked');
select is((select count(*)::int from people where id in (t071.u(7613), t071.u(7614)) and global_person_id is not null), 0, 'nothing for a roster-only person (Lima) or a renamed entry (Mike)');
select is(t071.identity_for('+6739710020'), null, 'nothing for a podium published while the mode was off (Quebec): it was never queued');

select is((select status || '/' || coalesce(display_name, 'NULL') from app.seduh_identities where id = t071.u(7801)), 'opted_out/NULL',
  'an opted_out identity is reused untouched: still opted_out and nameless');
select is(t071.gpi(7606), t071.u(7801), '...Echo is linked to it (inert)');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739710006'), 1, '...and no new active identity was made for the opted-out phone');
select is(t071.gpi(7607), t071.u(7803), 'a person whose phone has a merged tombstone is linked to the KEPT identity');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739710007'), 1, '...and no second identity was made for the tombstone''s phone');
select is((select display_name || '/' || country from app.seduh_identities where id = t071.u(7804)), 'T071 Existing Golf/Elsewhere', 'an existing active identity''s name and country are never overwritten');
select is(t071.gpi(7608), t071.u(7804), '...and Golf is linked to it');
select is(t071.gpi(7609), t071.u(7805), 'a person already linked to a different identity is left exactly as they were (Hotel)');

select is((select state || '/' || processed_via || '/' || (processed_at is not null) from app.seduh_feed_queue where result_id = t071.rid(7201)), 'processed/owner/true',
  'a processed queue row says so, and who ran it');
select is((select cardinality(created_identity_ids) || '/' || cardinality(linked_person_ids) from app.seduh_feed_queue where result_id = t071.rid(7201)), '1/1',
  'the row records the identity it created and the person it linked (what undo uses)');
select is((select cardinality(created_identity_ids) || '/' || cardinality(linked_person_ids) from app.seduh_feed_queue where result_id = t071.rid(7202)), '0/3',
  '...a row that only reused identities records no created identity and the three people it linked');
select is((select count(*)::int from reports where kind = 'run' and (r::text ~ '\+[0-9]{6}' or r::text ~* 't071' or r::text like '%555-01%')), 0, 'the run''s report holds counts and uuids only');

-- idempotent
insert into reports select 'again', app.seduh_identity_feed(array[t071.rid(7201), t071.rid(7202), t071.rid(7203), t071.rid(7204), t071.rid(7205)]);
select is((select (r ->> 'results_processed') || '/' || (r ->> 'identities_created') || '/' || (r ->> 'people_linked') || '/' || (r ->> 'results_not_queued') from reports where kind = 'again'),
  '0/0/0/5', 'a second run does nothing: the five are no longer queued');
select is(current_setting('app.seduh_link_write', true), '', 'the link flag is not left on');

-- ============ a re-queue keeps the undo lists; a phone change is not re-linked ============

update public_results set payload = payload where event_id = t071.u(7201);
select is(t071.qstate(7201), 'processed', 'an identical re-save does not re-queue a processed result');
update public_results set payload = payload || '{"venue": "v"}'::jsonb where event_id = t071.u(7201);
select is(t071.qstate(7201), 'queued', 'a CHANGED payload re-queues a processed result for a new review');
select is((select cardinality(created_identity_ids) from app.seduh_feed_queue where result_id = t071.rid(7201)), 1, '...and what was recorded for undo stays');
select is(t071.attempt($$ select app.seduh_identity_feed(array[(select id from public_results where event_id = '00000000-0000-0000-0000-000000007201')]) $$), 'ok',
  'the owner can run it again (nothing new to create: the person is linked)');
select is(t071.qstate(7201), 'queued', '...but the attempt above was rolled back by attempt(), so it is still queued');
select app.seduh_identity_feed(array[t071.rid(7201)]);
select is((select cardinality(created_identity_ids) || '/' || cardinality(linked_person_ids) from app.seduh_feed_queue where result_id = t071.rid(7201)), '1/1',
  'a second processing of the same row adds nothing to the lists (the identity and the link are already there)');

-- a phone change after creation nulls the link (the guard from B2); the feed does not put it back
update people set phone = '+6739710099' where id = t071.u(7601);
select is(t071.gpi(7601), null, 'a phone change after creation nulls the link (the existing guard trigger)');
select is(t071.qstate(7201), 'processed', '...and the result stays processed');
select is((select (app.seduh_identity_feed(array[t071.rid(7201)]) ->> 'results_not_queued')), '1', 'a run for that result does nothing: it is not queued');
select is(t071.gpi(7601), null, '...so nothing re-linked the person');
update people set phone = '+6739710001' where id = t071.u(7601);

-- ============ undo ============

-- Alpha was unlinked above (phone changed and back); link Alpha again as the owner would, then undo E1 and E5
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t071.identity_for('+6739710001') where id = t071.u(7601);
select set_config('app.seduh_link_write', '', true);
select is((select app.seduh_feed_undo(array[t071.rid(7201), t071.rid(7205)], false) ->> 'mode'), 'dry_run', 'the undo dry run says so');
select is((select (app.seduh_feed_undo(array[t071.rid(7201), t071.rid(7205)], false) ->> 'people_to_unlink') || '/' || (app.seduh_feed_undo(array[t071.rid(7201), t071.rid(7205)], false) ->> 'identities_to_delete')), '3/2',
  '...and would unlink 3 people (Alpha, Papa, Oscar) and delete 2 identities (the ones of Alpha and Oscar)');
select is(t071.gpi(7601), t071.identity_for('+6739710001'), 'a dry run unlinked nobody');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739710001'), 1, '...and deleted no identity');

-- an identity that gained a person since is kept: link Lima to the identity of Oscar (as link_person_identity could have)
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t071.identity_for('+6739710016') where id = t071.u(7613);
select set_config('app.seduh_link_write', '', true);
insert into reports select 'undo', app.seduh_feed_undo(array[t071.rid(7201), t071.rid(7205)], true);
select is((select r ->> 'mode' from reports where kind = 'undo'), 'apply', 'the undo applied');
select is(t071.gpi(7601), null, 'Alpha (recorded, linked to the identity E1 created) is unlinked');
select is(t071.identity_for('+6739710001'), null, '...and that identity, now with nobody, is deleted');
select is(t071.gpi(7617), null, 'Papa (recorded by E5, linked to that same identity) is unlinked too');
select is(t071.gpi(7616), null, 'Oscar (recorded, linked to the identity E5 created) is unlinked...');
select isnt(t071.identity_for('+6739710016'), null, '...but his identity is KEPT: Lima (never recorded) gained it since');
select is((select (r ->> 'people_unlinked') || '/' || (r ->> 'identities_deleted') || '/' || (r ->> 'identities_kept') from reports where kind = 'undo'), '3/1/1', 'the undo report: 3 unlinked, 1 deleted, 1 kept');
select is(t071.gpi(7613), t071.identity_for('+6739710016'), 'a person who was never recorded (Lima) is untouched');
select is(t071.qstate(7201) || '/' || t071.qstate(7205), 'undone/undone', 'both queue rows are undone (kept for the record)');
insert into reports select 'undo_again', app.seduh_feed_undo(array[t071.rid(7201), t071.rid(7205)], true);
select is((select (r ->> 'people_unlinked') || '/' || (r ->> 'identities_deleted') from reports where kind = 'undo_again'), '0/0', 'a second undo finds nothing to do');
select is(t071.identity_for('+6739710006') is not null and t071.identity_for('+6739710007') is not null, true,
  'identities that existed before (reused by E2) were never in an undo list');
select is((select count(*)::int from people where id in (t071.u(7606), t071.u(7607), t071.u(7608)) and global_person_id is not null), 3,
  '...and E2 was not undone (its people are still linked)');
select is(t071.attempt($$ select app.seduh_feed_undo(array[]::uuid[], false) $$), '22023: seduh_feed_undo needs the result ids you chose', 'undo needs ids: no "undo everything"');

-- the undo guards: an opted-out-since identity, an identity with a tombstone, and a person linked elsewhere since
create temp table undo_fx (k int primary key, rid uuid) on commit drop;
select t071.mk_event(7401, t071.u(7110), array['+6739710061', '+6739710062', '+6739710063']);
insert into public_results (id, org_id, event_id, payload) values (t071.u(7411), t071.u(7110), t071.u(7401), t071.podium_of(7401, 3));
select app.seduh_identity_feed(array[t071.u(7411)]);
select is((select cardinality(created_identity_ids) || '/' || cardinality(linked_person_ids) from app.seduh_feed_queue where result_id = t071.u(7411)), '3/3', 'a fresh result created 3 identities and linked 3 people');
update app.seduh_identities set status = 'opted_out', display_name = null where phone_e164 = '+6739710061';                      -- opted out since
insert into app.seduh_identities (phone_e164, display_name, source, status, merged_into)
  values ('+6739710069', null, 'archive', 'merged', t071.identity_for('+6739710062'));                                          -- a tombstone points at the second
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t071.u(7805) where id = t071.u(74013);                                                      -- linked elsewhere since (third)
select set_config('app.seduh_link_write', '', true);
insert into reports select 'undo2', app.seduh_feed_undo(array[t071.u(7411)], true);
select is(t071.gpi(74011), null, 'undo unlinks the person whose identity was opted out since...');
select isnt(t071.identity_for('+6739710061'), null, '...but KEEPS that identity (no longer archive/active)');
select is(t071.gpi(74012), null, 'unlinks the second person...');
select isnt(t071.identity_for('+6739710062'), null, '...but KEEPS the identity a tombstone points at');
select is(t071.gpi(74013), t071.u(7805), 'a person linked elsewhere since is left alone');
select is(t071.identity_for('+6739710063'), null, '...and the identity nobody is linked to any more is deleted');
select is((select (r ->> 'people_unlinked') || '/' || (r ->> 'identities_deleted') || '/' || (r ->> 'identities_kept') from reports where kind = 'undo2'), '2/1/2', 'the undo report: 2 unlinked, 1 deleted, 2 kept');

-- ============ rejecting by hand, and fail open ============

update app.seduh_feed_queue set state = 'rejected', processed_at = now() where result_id = t071.rid(7203);
select is(t071.qstate(7203), 'rejected', 'the owner can reject a queued result by hand (a row with no further effect)');
select is((select app.seduh_identity_feed(array[t071.rid(7203)]) ->> 'results_not_queued'), '1', '...and the run does not touch it');

select t071.mk_event(7501, t071.u(7110), array['+6739710071']);
alter table app.seduh_feed_queue add constraint t071_boom check (false) not valid;
select is(t071.attempt($$ insert into public_results (id, org_id, event_id, payload) values ('00000000-0000-0000-0000-000000007511', '00000000-0000-0000-0000-000000007110',
       '00000000-0000-0000-0000-000000007501', '{"podium":[{"rank":1,"name":"T071 P7501_1","cafe":"Cafe T"}]}'::jsonb) $$), 'ok',
  'FAIL OPEN: with a queue that refuses every row, the publish still succeeds');
insert into public_results (id, org_id, event_id, payload) values (t071.u(7511), t071.u(7110), t071.u(7501), t071.podium_of(7501, 1));
select is((select count(*)::int from public_results where id = t071.u(7511)), 1, '...the published row is there');
select is((select count(*)::int from app.seduh_feed_queue where result_id = t071.u(7511)), 0, '...and nothing was queued (the error was swallowed)');
alter table app.seduh_feed_queue drop constraint t071_boom;
update public_results set payload = payload || '{"venue": "w"}'::jsonb where id = t071.u(7511);
select is(t071.qstate(7501), 'queued', 'with the queue working again the next change to the payload queues it');

-- ============ a member''s publish enqueues and creates nothing ============

select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select t071.mk_event(7601, t071.u(7110), array['+6739710081']);
select t071.mk_event(7602, t071.u(7110), array['+6739710082']);
select set_config('request.jwt.claims', jsonb_build_object('sub', t071.u(7101), 'role', 'authenticated')::text, true);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000007101';
select is(t071.attempt(format('select public.publish_event_results(%L, %L, %L::jsonb)', t071.u(7110), t071.u(7601), t071.podium_of(7601, 1))), 'ok',
  'a member publishes a podium through the RPC and gets no error');
select public.publish_event_results(t071.u(7110), t071.u(7601), t071.podium_of(7601, 1));
insert into public_results (org_id, event_id, payload) values (t071.u(7110), t071.u(7602), t071.podium_of(7602, 1));
select is(t071.attempt('select count(*) from app.seduh_feed_queue'), '42501: permission denied for table seduh_feed_queue', 'the member cannot read the queue');
select is(t071.attempt('insert into app.seduh_feed_queue (result_id, org_id) values (gen_random_uuid(), gen_random_uuid())'), '42501: permission denied for table seduh_feed_queue', '...write to it');
select is(t071.attempt('update app.seduh_feed_queue set state = ''rejected'''), '42501: permission denied for table seduh_feed_queue', '...update it');
select is(t071.attempt('select * from app.seduh_feed_mode'), '42501: permission denied for table seduh_feed_mode', '...read the mode');
select is(t071.attempt('update app.seduh_feed_mode set mode = ''auto'''), '42501: permission denied for table seduh_feed_mode', '...or change it');
select matches(t071.attempt('select app.seduh_identity_feed(array[gen_random_uuid()])'), '^42501: permission denied for (function seduh_identity_feed|schema app)$', '...or call the feed');
select matches(t071.attempt('select app.seduh_feed_review()'), '^42501: permission denied for (function seduh_feed_review|schema app)$', '...or the review');
select matches(t071.attempt('select app.seduh_feed_auto_run()'), '^42501: permission denied for (function seduh_feed_auto_run|schema app)$', '...or the auto job');
select matches(t071.attempt('select app.seduh_feed_undo(array[gen_random_uuid()], false)'), '^42501: permission denied for (function seduh_feed_undo|schema app)$', '...or undo');
select matches(t071.attempt('select app.seduh_feed_apply(array[gen_random_uuid()], ''owner'')'), '^42501: permission denied for (function seduh_feed_apply|schema app)$', '...or the creating step');
select matches(t071.attempt('select app.enqueue_seduh_feed()'), '^42501: permission denied for (function enqueue_seduh_feed|schema app)$', '...or the trigger function');
reset role;
select is((select string_agg(e.n::text || '=' || coalesce(t071.qstate(e.n), 'none'), ',' order by e.n) from unnest(array[7601, 7602]) e(n)), '7601=queued,7602=queued',
  'THE MEMBER''S PUBLISH ENQUEUED (through the RPC and as a raw insert)...');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6739710081', '+6739710082')), 0, '...and CREATED NOTHING');
select is((select count(*)::int from people where id in (t071.u(76011), t071.u(76021)) and global_person_id is not null), 0, '...and linked nobody');
select is((select published_by from public_results where event_id = t071.u(7601)), t071.u(7101), 'and the publish itself recorded the member as the publisher (the feed did not disturb it)');

-- the ACL opened by mistake: each function still refuses an API role by name
grant execute on function app.seduh_identity_feed(uuid[]), app.seduh_feed_review(), app.seduh_feed_auto_run(), app.seduh_feed_undo(uuid[], boolean),
  app.seduh_feed_apply(uuid[], text) to authenticated, anon, service_role;   -- undone by the rollback
set local role authenticated;
select is(t071.attempt('select app.seduh_identity_feed(array[gen_random_uuid()])'), '42501: seduh_identity_feed is run by the database owner only', 'even with the door opened, the feed refuses an API role by name');
select is(t071.attempt('select app.seduh_feed_review()'), '42501: seduh_feed_review is run by the database owner only', '...the review');
select is(t071.attempt('select app.seduh_feed_auto_run()'), '42501: seduh_feed_auto_run is run by the database owner only', '...the auto job');
select is(t071.attempt('select app.seduh_feed_undo(array[gen_random_uuid()], true)'), '42501: seduh_feed_undo is run by the database owner only', '...undo');
select is(t071.attempt('select app.seduh_feed_apply(array[gen_random_uuid()], ''owner'')'), '42501: seduh_feed_apply is run by the database owner only', '...and the creating step');
reset role;
set local role service_role;
select matches(t071.attempt('select app.seduh_identity_feed(array[gen_random_uuid()])'), '^42501: (seduh_identity_feed is run by the database owner only|permission denied for schema app)$', 'service_role is refused as well');
reset role;
-- a session role of authenticator (what PostgREST connects as), with SET ROLE postgres afterwards, is refused through session_user
-- only when the session is one: here the session is postgres, so the by-name check is on current_user and the role setting
set local role anon;
select is(t071.attempt('select app.seduh_identity_feed(array[gen_random_uuid()])'), '42501: seduh_identity_feed is run by the database owner only', 'anon too');
reset role;
revoke execute on function app.seduh_identity_feed(uuid[]), app.seduh_feed_review(), app.seduh_feed_auto_run(), app.seduh_feed_undo(uuid[], boolean),
  app.seduh_feed_apply(uuid[], text) from authenticated, anon, service_role;   -- the door is shut again for the catalog checks below

-- ============ `auto` and its caps ============

select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);   -- the claims of the member must not outlive their section

update app.seduh_feed_mode set mode = 'queue';
select is((select app.seduh_feed_auto_run() ->> 'ran'), 'false', 'in queue mode the auto job does nothing');
update app.seduh_feed_queue set state = 'rejected', processed_at = now() where state = 'queued';
-- only the last 24 hours count towards a cap: push everything processed so far back two days
update app.seduh_feed_queue set processed_at = now() - interval '2 days' where state = 'processed';

select t071.mk_event(7301, t071.u(7110), array['+6739710031', '+6739710032']);     -- org A, 2 new identities
select t071.mk_event(7302, t071.u(7110), array['+6739710033']);                    -- org A, 1 new
select t071.mk_event(7303, t071.u(7111), array['+6739710034', '+6739710035']);     -- org B, 2 new
insert into public_results (id, org_id, event_id, payload) values
  (t071.u(7311), t071.u(7110), t071.u(7301), t071.podium_of(7301, 2)),
  (t071.u(7312), t071.u(7110), t071.u(7302), t071.podium_of(7302, 1)),
  (t071.u(7313), t071.u(7111), t071.u(7303), t071.podium_of(7303, 2));
update app.seduh_feed_mode set mode = 'auto', org_daily_cap = 2, global_daily_cap = 3;
select is((select string_agg(t071.qstate(e.n), ',' order by e.n) from unnest(array[7301, 7302, 7303]) e(n)), 'queued,queued,queued', 'in auto mode a publish still only queues: nothing is created by it');
select is((select count(*)::int from app.seduh_identities where phone_e164 between '+6739710031' and '+6739710035'), 0, '...(no identity yet)');

insert into reports select 'auto1', app.seduh_feed_auto_run();
select is((select (r ->> 'processed') || '/' || (r ->> 'deferred_over_cap') || '/' || (r ->> 'errored') from reports where kind = 'auto1'), '1/2/0',
  'caps (org 2, global 3): the first result (2 new) goes through, the second (org A would reach 3) and the third (the platform would reach 4) stay queued');
select is((select string_agg(t071.qstate(e.n), ',' order by e.n) from unnest(array[7301, 7302, 7303]) e(n)), 'processed,queued,queued', '...the states agree');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6739710031', '+6739710032')), 2, 'the first result''s two identities exist');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6739710033', '+6739710034', '+6739710035')), 0, '...and the deferred ones created nothing');
select is((select processed_via from app.seduh_feed_queue where result_id = t071.u(7311)), 'auto', 'the row says the job ran it');
update app.seduh_feed_mode set global_daily_cap = 10;
insert into reports select 'auto2', app.seduh_feed_auto_run();
select is((select (r ->> 'processed') || '/' || (r ->> 'deferred_over_cap') from reports where kind = 'auto2'), '1/1', 'global cap raised to 10: org B''s result goes; org A''s second still waits on the ORGANISATION cap');
select is((select string_agg(t071.qstate(e.n), ',' order by e.n) from unnest(array[7301, 7302, 7303]) e(n)), 'processed,queued,processed', '...states');
insert into reports select 'auto3', app.seduh_feed_auto_run();
select is((select (r ->> 'processed') || '/' || (r ->> 'deferred_over_cap') from reports where kind = 'auto3'), '0/1', 'a run with nothing new allowed changes nothing');
update app.seduh_feed_mode set org_daily_cap = 5;
select is((select (app.seduh_feed_auto_run() ->> 'processed')), '1', 'organisation cap raised: the deferred result goes');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6739710033', '+6739710034', '+6739710035')), 3, '...and its identity exists');
update app.seduh_feed_queue set processed_at = now() - interval '2 days' where result_id = t071.u(7311);
select is((select (r ->> 'created_last_24h')::int from (select app.seduh_feed_review() as r) x), 3, 'the review counts what was created in the last 24 hours (the first result''s two are two days old and are not counted)');

-- a failing result does not stop the job; only the SQLSTATE is kept
select t071.mk_event(7304, t071.u(7110), array['+6739710036']);
insert into public_results (id, org_id, event_id, payload) values (t071.u(7314), t071.u(7110), t071.u(7304), t071.podium_of(7304, 1));
create function t071.boom() returns trigger language plpgsql as $$ begin raise exception 'a message with +6739710036 in it'; end $$;
create trigger t071_boom before insert on app.seduh_identities for each row execute function t071.boom();
select is((select (app.seduh_feed_auto_run() ->> 'errored')), '1', 'an error while creating is counted, not raised...');
drop trigger t071_boom on app.seduh_identities;
select is((select state || '/' || last_error from app.seduh_feed_queue where result_id = t071.u(7314)), 'queued/P0001', '...the row stays queued and keeps only the SQLSTATE (never the message, which could carry a phone)');
select is(current_setting('app.seduh_link_write', true), '', '...and the link flag is not left on by the failure');
update app.seduh_feed_mode set mode = 'queue', org_daily_cap = 8, global_daily_cap = 40;

-- ============ shape, ACL and catalog ============

select is((select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'app.seduh_feed_queue'::regclass and attnum > 0 and not attisdropped),
  'result_id,org_id,state,enqueued_at,processed_at,processed_via,created_identity_ids,linked_person_ids,last_error,created_at,updated_at',
  'the queue holds ids and times only: no phone, name, cafe or free text column');
select is((select coalesce(string_agg(t.typname, ','), 'none') from (select distinct a.atttypid from pg_attribute a where a.attrelid = 'app.seduh_feed_queue'::regclass and a.attnum > 0 and not a.attisdropped) x
            join pg_type t on t.oid = x.atttypid where t.typname not in ('uuid', '_uuid', 'text', 'timestamptz')), 'none', '...of types uuid, uuid[], text and timestamptz only');
select is(t071.attempt($$ insert into app.seduh_feed_queue (result_id, org_id, last_error) values (gen_random_uuid(), gen_random_uuid(), 'a message with a +6739710036 in it') $$),
  '23514: new row for relation "seduh_feed_queue" violates check constraint "seduh_feed_queue_last_error_shape"', 'last_error cannot hold free text');
select is(t071.attempt($$ insert into app.seduh_feed_queue (result_id, org_id, state, processed_at) values (gen_random_uuid(), gen_random_uuid(), 'done', now()) $$),
  '23514: new row for relation "seduh_feed_queue" violates check constraint "seduh_feed_queue_state_vocab"', 'the state vocabulary is closed');
select is(t071.attempt($$ insert into app.seduh_feed_queue (result_id, org_id, state) values (gen_random_uuid(), gen_random_uuid(), 'processed') $$),
  '23514: new row for relation "seduh_feed_queue" violates check constraint "seduh_feed_queue_processed_at_by_state"', 'a processed row has a time and a queued one has none');
select is(t071.attempt(format('update app.seduh_feed_queue set org_id = gen_random_uuid() where result_id = %L', t071.u(7311))), '23001: seduh_feed_queue.org_id is immutable',
  'a queue row never moves to another organisation');
select is(t071.attempt($$ update app.seduh_feed_mode set mode = 'on' $$), '23514: new row for relation "seduh_feed_mode" violates check constraint "seduh_feed_mode_vocab"', 'the mode vocabulary is closed');
select is(t071.attempt($$ insert into app.seduh_feed_mode (singleton) values (false) $$), '23514: new row for relation "seduh_feed_mode" violates check constraint "seduh_feed_mode_one_row"', 'there is one mode row');
select is(t071.attempt($$ delete from app.seduh_feed_mode $$), '42501: seduh_feed_mode is one row and is changed, not removed', 'the mode row cannot be deleted...');
select is(t071.attempt($$ truncate app.seduh_feed_mode $$), '42501: seduh_feed_mode is one row and is changed, not removed', '...or truncated');
select is(t071.attempt($$ update app.seduh_feed_mode set org_daily_cap = -1 $$), '23514: new row for relation "seduh_feed_mode" violates check constraint "seduh_feed_mode_org_cap"', 'a cap cannot be negative');

select is((select coalesce(string_agg(c.relname || '/' || r, ', ' order by c.relname, r), 'none')
             from pg_class c, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where c.oid in ('app.seduh_feed_queue'::regclass, 'app.seduh_feed_mode'::regclass)
              and has_table_privilege(r, c.oid, 'select,insert,update,delete,truncate,references,trigger')), 'none',
  'no API role holds any privilege on the queue or the mode (PUBLIC included)');
select is((select string_agg(relname || ':' || relrowsecurity, ',' order by relname) from pg_class where oid in ('app.seduh_feed_queue'::regclass, 'app.seduh_feed_mode'::regclass)),
  'seduh_feed_mode:true,seduh_feed_queue:true', 'row-level security is on for both...');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename in ('seduh_feed_queue', 'seduh_feed_mode')), 0, '...with no policy');
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where n.nspname = 'app' and p.proname ~ '^(seduh_feed_|seduh_identity_feed|enqueue_seduh_feed|forbid_seduh_feed)'
              and has_function_privilege(r, p.oid, 'execute')), 'none', 'every function of the feed is executable by no API role (PUBLIC included)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname ~ '^(seduh_feed_|seduh_identity_feed|enqueue_seduh_feed)'), 8, 'the eight functions of the feed exist (a ninth must be added here on purpose)');
select is((select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname ~ '^(seduh_feed_|seduh_identity_feed|enqueue_seduh_feed)'
              and not (p.prosecdef and p.proconfig @> array['search_path=""'])), 'none', 'each one is SECURITY DEFINER with search_path pinned to the empty string');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname ~ '^(seduh_feed_|seduh_identity_feed)' and p.provolatile = 's'),
  'seduh_feed_plan_internal,seduh_feed_review,seduh_feed_slots_internal', 'only the three readers are STABLE');

-- the trigger: an AFTER ROW trigger on INSERT and UPDATE OF payload, SECURITY DEFINER; test 045''s guard (BEFORE ROW definer triggers) does not match it
select is((select (t.tgtype & 1 = 1)::text || '/' || (t.tgtype & 2 = 0)::text || '/' || (t.tgtype & 4 = 4)::text || '/' || (t.tgtype & 16 = 16)::text
             || '/' || (select string_agg(a.attname, ',') from pg_attribute a where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr))
             || '/' || p.prosecdef::text
            from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname = 'trg_public_results_seduh_feed'),
  'true/true/true/true/payload/true', 'trg_public_results_seduh_feed is a ROW trigger, AFTER (not BEFORE), on insert and update of payload only, and SECURITY DEFINER');
select is((select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where t.tgrelid = 'public.public_results'::regclass and not t.tgisinternal and p.proname = 'enqueue_seduh_feed' and (t.tgtype & 2) = 2), 0,
  '...so test 045''s catalog guard (SECURITY DEFINER BEFORE ROW triggers) does not match it');

-- who writes global_person_id: the feed's functions are named here on purpose (062 lists them too)
select is((select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname ~ '^(seduh_feed_|seduh_identity_feed)' and p.prosrc ~* 'global_person_id'),
  'app.seduh_feed_apply(uuid[],text), app.seduh_feed_plan_internal(uuid[]), app.seduh_feed_undo(uuid[],boolean)',
  'the feed''s functions that mention people.global_person_id: the creating step and undo write it, the plan reads it');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'enqueue_seduh_feed' and p.prosrc ~* 'seduh_identities|global_person_id'), 0,
  'the trigger function touches no identity and no link');

-- a dry run in a READ ONLY transaction works (the review and the plan write nothing); the last statement before the rollback test
-- (the rollback block below changes the schema, so it is the very last thing and read-only mode cannot be restored: it is a separate savepoint)

-- ============ the migration's rollback block ============

savepoint rollback_block;
drop trigger if exists trg_public_results_seduh_feed on public.public_results;
drop function if exists app.seduh_feed_undo(uuid[], boolean);
drop function if exists app.seduh_feed_auto_run();
drop function if exists app.seduh_feed_review();
drop function if exists app.seduh_identity_feed(uuid[]);
drop function if exists app.seduh_feed_apply(uuid[], text);
drop function if exists app.seduh_feed_plan_internal(uuid[]);
drop function if exists app.seduh_feed_slots_internal(uuid[]);
drop function if exists app.enqueue_seduh_feed();
drop table if exists app.seduh_feed_queue;
drop table if exists app.seduh_feed_mode;
drop function if exists app.forbid_seduh_feed_mode_delete();
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname ~ '^(seduh_feed_|seduh_identity_feed|enqueue_seduh_feed|forbid_seduh_feed)')
          + (select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname like 'seduh_feed_%')
          + (select count(*)::int from pg_trigger where tgname = 'trg_public_results_seduh_feed'), 0,
  'the rollback block removes every function, both tables and the trigger');
select is(t071.attempt($$ update public_results set payload = payload || '{"venue": "z"}'::jsonb where event_id = '00000000-0000-0000-0000-000000007201' $$), 'ok',
  '...and a publish still works afterwards');
rollback to savepoint rollback_block;
select is((select count(*)::int from pg_trigger where tgname = 'trg_public_results_seduh_feed'), 1, '(the test rolls the rollback block back: the trigger is there again)');

-- the D1b migration's rollback block (20261103110000): the counts function goes back to the ten columns of T-ID.C3
savepoint rollback_counts;
drop function if exists public.admin_seduh_id_counts();
create function public.admin_seduh_id_counts()
returns table (identities_total integer, identities_active integer, identities_opted_out integer, identities_merged integer,
  identities_from_roster integer, identities_from_archive integer, identities_orphan integer, people_total integer,
  people_linked integer, people_blocked integer)
language plpgsql stable security definer set search_path = '' as $f$
#variable_conflict use_column
begin
  perform app.require_platform_admin();
  return query
  select (select count(*)::integer from app.seduh_identities),
         (select count(*)::integer from app.seduh_identities i where i.status = 'active'),
         (select count(*)::integer from app.seduh_identities i where i.status = 'opted_out'),
         (select count(*)::integer from app.seduh_identities i where i.status = 'merged'),
         (select count(*)::integer from app.seduh_identities i where i.source = 'organiser_roster'),
         (select count(*)::integer from app.seduh_identities i where i.source = 'archive'),
         (select count(*)::integer from app.seduh_identities i
           where i.status <> 'merged' and not exists (select 1 from public.people p where p.global_person_id = i.id)),
         (select count(*)::integer from public.people),
         (select count(*)::integer from public.people p where p.global_person_id is not null),
         (select count(*)::integer from app.person_link_blocks b
           join public.people p on p.id = b.person_id and p.phone = b.phone_e164);
end;
$f$;
revoke all on function public.admin_seduh_id_counts() from public, anon, authenticated, service_role;
grant execute on function public.admin_seduh_id_counts() to authenticated;
select is((select cardinality(proargnames) from pg_proc where oid = 'public.admin_seduh_id_counts()'::regprocedure), 10,
  'the counts migration''s rollback block restores the ten columns of T-ID.C3');
select is((has_function_privilege('authenticated', 'public.admin_seduh_id_counts()', 'execute')
           and not has_function_privilege('anon', 'public.admin_seduh_id_counts()', 'execute')), true, '...and its ACL (authenticated only)');
rollback to savepoint rollback_counts;
select is((select cardinality(proargnames) from pg_proc where oid = 'public.admin_seduh_id_counts()'::regprocedure), 14, '(rolled back again: the console function has its fourteen columns)');

-- read only: the review and the plan write nothing
set local transaction_read_only = on;
select is((select app.seduh_feed_review() ->> 'mode'), 'queue', 'the review works inside a READ ONLY transaction (it writes nothing)');

select * from finish();
rollback;
