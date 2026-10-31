-- T-ID.B4: the owner-run, idempotent identity backfill (spec: Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md 3.3 and
-- owner decision 3; migration 20261031100000_seduh_identity_backfill.sql).
-- Proves, with fixtures that carry unique ids and are rolled back (the local database is shared with other sessions, so
-- every assertion is about THIS file's people, phones and identities; the only table-wide figures are the dry-run before/after totals):
--   * CREATES an identity (source 'archive', status 'active', the phone, the first published record's name cut to 120 and
--     trimmed, a valid country) for a person named in a published non-test result, and links the person;
--   * does NOT create one for: a test event's result, an unpublished event, a roster-only person, a person with no entry,
--     an entry the payload does not name (a podium-only publish), a walk-up entry with no person, two entries the payload
--     cannot tell apart, an owner-blocked person;
--   * SKIPS a non-E.164 phone and lists it by person id, repairing nothing;
--   * IDEMPOTENT: a second run creates and links nothing and writes nothing;
--   * REUSES an existing identity, never overwriting its name or country: an active one, an opted_out one (linked, inert,
--     still opted_out and still nameless) and a merged tombstone (resolved to the kept identity, no duplicate made);
--   * leaves a person already linked to a DIFFERENT identity alone and lists them;
--   * two organisations holding one phone share ONE identity, named from the earlier published record;
--   * the report holds counts and uuids only: no phone, no name;
--   * a dry run changes nothing (also inside a READ ONLY transaction, the last statement of this file);
--   * the global_person_id guard still refuses an API caller afterwards, and the flag is not left on;
--   * an API role cannot run it: the ACL refuses it, and (ACL deliberately widened inside the test) the function itself
--     refuses it by role name.
begin;
select plan(66);

create schema t064;
grant usage on schema t064 to anon, authenticated, service_role;

-- 'ok', or SQLSTATE || ': ' || message; the statement always runs inside a sub-transaction that is rolled back.
create function t064.attempt(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ': ' || sqlerrm;
end $$;
create function t064.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function t064.gpi(person int) returns uuid language sql stable as $$
  select global_person_id from public.people where id = t064.u(person)
$$;
-- is person n in the report's list `key`?
create function t064.listed(report jsonb, key text, n int) returns boolean language sql immutable as $$
  select coalesce(report -> key -> 'person_ids' ? t064.u(n)::text, false)
$$;
create function t064.identity_for(phone text) returns uuid language sql stable as $$
  select id from app.seduh_identities where phone_e164 = phone
$$;
grant execute on all functions in schema t064 to anon, authenticated;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values (t064.u(6401), 'u1@t064.seduh-next');
insert into orgs (id, name, slug) values (t064.u(6410), 'T064 A', 't064-a'), (t064.u(6411), 'T064 B', 't064-b');
insert into org_members (org_id, user_id, role) values (t064.u(6410), t064.u(6401), 'owner');

-- one bad phone has to exist for the skip case; the CHECK would refuse it, so it is dropped for this transaction only
alter table people drop constraint people_phone_e164;

-- events: 6501 published full standings (A), 6502 published then marked test (A), 6503 never published (A),
-- 6504 published podium only (B)
insert into events (id, org_id, format, name, is_test) values
  (t064.u(6501), t064.u(6410), 'cup_taster', 'T064 E1', false),
  (t064.u(6502), t064.u(6410), 'cup_taster', 'T064 E2', false),
  (t064.u(6503), t064.u(6410), 'cup_taster', 'T064 E3', false),
  (t064.u(6504), t064.u(6411), 'cup_taster', 'T064 E4', false);

-- identities that exist before the run
insert into app.seduh_identities (id, phone_e164, display_name, country, source, status) values
  (t064.u(6801), '+6739640007', null,                    null,         'archive', 'opted_out'),
  (t064.u(6803), '+6739640018', 'T064 Kept Existing',    null,         'archive', 'active'),
  (t064.u(6804), '+6739640011', 'T064 Existing Lima',    'Elsewhere',  'organiser_roster', 'active'),
  (t064.u(6805), '+6739640099', 'T064 Other Identity',   null,         'archive', 'active'),
  (t064.u(6806), '+6739640030', 'T064 Orphan Identity',  null,         'archive', 'active');
insert into app.seduh_identities (id, phone_e164, display_name, source, status, merged_into) values
  (t064.u(6802), '+6739640008', null, 'archive', 'merged', t064.u(6803));

insert into people (id, org_id, display_name, phone, country) values
  (t064.u(6601), t064.u(6410), 'T064 Alpha',   '+6739640001', ' Brunei '),
  (t064.u(6602), t064.u(6410), 'T064 Bravo',   '555-0102',    null),
  (t064.u(6603), t064.u(6410), 'T064 Charlie', '+6739640003', null),
  (t064.u(6604), t064.u(6410), 'T064 Delta',   '+6739640004', null),
  (t064.u(6605), t064.u(6410), 'T064 Echo',    '+6739640005', null),
  (t064.u(6606), t064.u(6410), 'T064 Foxtrot', '+6739640006', null),
  (t064.u(6607), t064.u(6410), 'T064 Golf',    '+6739640007', null),
  (t064.u(6608), t064.u(6410), 'T064 Hotel',   '+6739640008', null),
  (t064.u(6609), t064.u(6410), 'T064 India',   '+6739640009', null),
  (t064.u(6610), t064.u(6410), 'T064 Juliet',  '+6739640010', 'Brunei'),
  (t064.u(6611), t064.u(6410), 'T064 Lima',    '+6739640011', 'Brunei'),
  (t064.u(6612), t064.u(6410), 'T064 Mike',    '+6739640012', null),
  (t064.u(6614), t064.u(6410), 'T064 Oscar',   '+6739640014', null),
  (t064.u(6615), t064.u(6410), 'T064 Papa',    '+6739640015', null),
  (t064.u(6616), t064.u(6410), 'T064 Quebec',  '+6739640016', repeat('x', 61)),
  (t064.u(6617), t064.u(6410), 'T064 Romeo',   '+6739640017', null),
  (t064.u(6618), t064.u(6410), 'T064 Stale',   '+6739640021', null),
  (t064.u(6701), t064.u(6411), 'T064 Kilo',    '+6739640010', 'Malaysia'),
  (t064.u(6702), t064.u(6411), 'T064 Sierra',  '+6739640020', null);
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t064.u(6805) where id = t064.u(6612);
select set_config('app.seduh_link_write', '', true);
insert into app.person_link_blocks (person_id, phone_e164) values (t064.u(6609), '+6739640009'),
  (t064.u(6618), '+6739640022');   -- written for a number the person no longer holds: it must not apply

-- entries. The payload names are matched on name and cafe (trimmed), so the cafe is set on each.
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t064.u(6901), t064.u(6501), t064.u(6601), 'T064 Alpha',   'Cafe X'),
  (t064.u(6902), t064.u(6501), t064.u(6602), 'T064 Bravo',   'Cafe X'),
  (t064.u(6904), t064.u(6501), t064.u(6604), 'T064 Delta',   'Cafe X'),
  (t064.u(6905), t064.u(6503), t064.u(6605), 'T064 Echo',    'Cafe X'),
  (t064.u(6906), t064.u(6502), t064.u(6606), 'T064 Foxtrot', 'Cafe X'),
  (t064.u(6907), t064.u(6501), t064.u(6607), 'T064 Golf',    'Cafe X'),
  (t064.u(6908), t064.u(6501), t064.u(6608), 'T064 Hotel',   'Cafe X'),
  (t064.u(6909), t064.u(6501), t064.u(6609), 'T064 India',   'Cafe X'),
  (t064.u(6910), t064.u(6501), t064.u(6610), 'T064 Juliet Early', 'Cafe X'),
  (t064.u(6911), t064.u(6501), t064.u(6611), 'T064 Lima',    'Cafe X'),
  (t064.u(6912), t064.u(6501), t064.u(6612), 'T064 Mike',    'Cafe X'),
  (t064.u(6913), t064.u(6501), null,         'T064 November walk-up', 'Cafe X'),
  (t064.u(6914), t064.u(6501), t064.u(6614), 'T064 Twin',    'Cafe X'),
  (t064.u(6915), t064.u(6501), t064.u(6615), 'T064 Twin',    'Cafe X'),
  (t064.u(6916), t064.u(6501), t064.u(6616), 'T064 ' || repeat('q', 145), 'Cafe X'),
  (t064.u(6917), t064.u(6501), t064.u(6617), 'T064 Romeo',   ''),
  (t064.u(6918), t064.u(6501), t064.u(6618), 'T064 Stale',   'Cafe X'),
  (t064.u(6921), t064.u(6504), t064.u(6701), 'T064 Kilo Late', 'Cafe Y'),
  (t064.u(6922), t064.u(6504), t064.u(6702), 'T064 Sierra',    'Cafe Y');

-- the payloads. E1 publishes the full standings (the podium repeats three of them); E4 only a podium of ONE (Kilo), so
-- Sierra is entered but not named. Foxtrot is named in E2, which is marked a test event after its result exists.
insert into public_results (org_id, event_id, published_at, payload) values
  (t064.u(6410), t064.u(6501), '2026-01-01 10:00+00', jsonb_build_object(
     'format', 'cup_taster', 'eventName', 'T064 E1',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T064 Alpha', 'cafe', 'Cafe X')),
     'standings', jsonb_build_array(
       jsonb_build_object('place', 1, 'name', 'T064 Alpha',   'cafe', 'Cafe X'),
       jsonb_build_object('place', 2, 'name', 'T064 Bravo',   'cafe', 'Cafe X'),
       jsonb_build_object('place', 3, 'name', 'T064 Golf',    'cafe', 'Cafe X'),
       jsonb_build_object('place', 4, 'name', 'T064 Hotel',   'cafe', 'Cafe X'),
       jsonb_build_object('place', 5, 'name', 'T064 India',   'cafe', 'Cafe X'),
       jsonb_build_object('place', 6, 'name', 'T064 Juliet Early', 'cafe', 'Cafe X'),
       jsonb_build_object('place', 7, 'name', 'T064 Lima',    'cafe', 'Cafe X'),
       jsonb_build_object('place', 8, 'name', 'T064 Mike',    'cafe', 'Cafe X'),
       jsonb_build_object('place', 9, 'name', 'T064 November walk-up', 'cafe', 'Cafe X'),
       jsonb_build_object('place', 10, 'name', 'T064 Twin',   'cafe', 'Cafe X'),
       jsonb_build_object('place', 11, 'name', 'T064 ' || repeat('q', 145), 'cafe', 'Cafe X'),
       jsonb_build_object('place', 12, 'name', '  T064 Romeo  ', 'cafe', null),
       jsonb_build_object('place', 13, 'name', 'T064 Stale', 'cafe', 'Cafe X')))),
  (t064.u(6410), t064.u(6502), '2026-01-02 10:00+00', jsonb_build_object(
     'format', 'cup_taster', 'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T064 Foxtrot', 'cafe', 'Cafe X')))),
  (t064.u(6411), t064.u(6504), '2026-02-01 10:00+00', jsonb_build_object(
     'format', 'cup_taster', 'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T064 Kilo Late', 'cafe', 'Cafe Y'))));
update events set is_test = true where id = t064.u(6502);

create temp table before_counts on commit drop as
  select (select count(*) from app.seduh_identities) as identities,
         (select count(*) from public.people where global_person_id is not null) as linked;
-- the account of the last report, kept for the later assertions
create temp table reports (kind text primary key, r jsonb) on commit drop;

-- ============ the dry run: counts and ids, and it changes nothing ============

insert into reports select 'dry', app.seduh_identity_backfill(false);
select is((select r ->> 'mode' from reports where kind = 'dry'), 'dry_run', 'a dry run says it is a dry run');
select is((select identities = (select count(*) from app.seduh_identities) and linked = (select count(*) from public.people where global_person_id is not null) from before_counts),
  true, 'the dry run created no identity and linked no person');
select is(t064.identity_for('+6739640001'), null, '...(Alpha still has no identity)');
select is(t064.listed((select r from reports where kind = 'dry'), 'skipped_bad_phone', 6602), true, 'the dry run lists the non-E.164 person by id');
select is(t064.listed((select r from reports where kind = 'dry'), 'skipped_blocked', 6609), true, '...and the owner-blocked person');
select is(t064.listed((select r from reports where kind = 'dry'), 'people_linked_elsewhere', 6612), true, '...and the person already linked to a different identity');
select cmp_ok((select (r ->> 'identities_to_create')::int from reports where kind = 'dry'), '>=', 4,
  'the dry run counts the identities it would create (Alpha, Juliet/Kilo, Quebec, Romeo)');
select cmp_ok((select (r ->> 'name_slots_ambiguous_entries')::int from reports where kind = 'dry'), '>=', 1, '...an ambiguous name slot is counted, not guessed');
select cmp_ok((select (r ->> 'name_slots_entry_without_person')::int from reports where kind = 'dry'), '>=', 1, '...and a named walk-up entry with no person');
select cmp_ok((select (r ->> 'published_results_test_excluded')::int from reports where kind = 'dry'), '>=', 1, '...and a test event result is counted as excluded');

-- the owner's control: a run restricted to vetted result ids reads nothing else
select is((select jsonb_array_length(app.seduh_identity_backfill(false, array[(select id from public_results where event_id = t064.u(6504))]) -> 'creates_by_result')), 1,
  'a dry run restricted to one result lists only that result in creates_by_result...');
select is((select (app.seduh_identity_backfill(false, array[(select id from public_results where event_id = t064.u(6504))]) -> 'creates_by_result' -> 0 ->> 'identities_to_create')::int
             || '/' || (app.seduh_identity_backfill(false, array[(select id from public_results where event_id = t064.u(6504))]) ->> 'restricted_to_results')), '1/true',
  '...with the identities it would create there, and says it was restricted');
select is((select (app.seduh_identity_backfill(false, array[t064.u(1)]) ->> 'people_named')::int), 0, 'a restriction naming no real result names nobody');

-- a RESTRICTED apply (the owner's control) creates only what the vetted result names; rolled back to leave the real run clean
savepoint restricted;
create temp table restricted_apply on commit drop as
  select app.seduh_identity_backfill(true, array[(select id from public_results where event_id = t064.u(6504))]) as r;
select is(t064.identity_for('+6739640001'), null, 'a restricted apply creates nothing for a result it was not given (Alpha, E1)');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739640010'), 1, '...and creates what the given result names (Kilo, E4)');
select is((select (r -> 'applied' ->> 'identities_created')::int from restricted_apply), 1, '...exactly one identity');
rollback to savepoint restricted;

-- ============ the run ============

insert into reports select 'apply', app.seduh_identity_backfill(true);
select is((select r ->> 'mode' from reports where kind = 'apply'), 'apply', 'the owner run says it applied');

-- created
select is((select source || '/' || status from app.seduh_identities where phone_e164 = '+6739640001'), 'archive/active',
  'Alpha, named in a published non-test result, got an identity: source archive, status active');
select is((select display_name from app.seduh_identities where phone_e164 = '+6739640001'), 'T064 Alpha', '...named from the published record');
select is((select country from app.seduh_identities where phone_e164 = '+6739640001'), 'Brunei', '...with the person''s country, trimmed');
select is(t064.gpi(6601), t064.identity_for('+6739640001'), '...and the person is linked to it');
select is((select char_length(display_name) from app.seduh_identities where phone_e164 = '+6739640016'), 120, 'a long published name is cut to 120');
select is((select country from app.seduh_identities where phone_e164 = '+6739640016'), null, '...and a country longer than 60 is not carried over');
select is((select display_name from app.seduh_identities where phone_e164 = '+6739640017'), 'T064 Romeo',
  'a published name with padding and a missing cafe matches its entry (trimmed, null cafe = empty) and is stored trimmed');

-- the lists the undo script needs
select ok((select (r -> 'applied' -> 'created_identity_ids') ? t064.identity_for('+6739640001')::text from reports where kind = 'apply'),
  'created_identity_ids holds the identity the run created (Alpha)');
select ok((select (r -> 'applied' -> 'linked_person_ids') ? t064.u(6601)::text from reports where kind = 'apply'), 'linked_person_ids holds the person the run linked (Alpha)');
select ok((select not (r -> 'applied' -> 'created_identity_ids') ? t064.u(6801)::text from reports where kind = 'apply'),
  'created_identity_ids does not hold an identity that already existed (the opted_out one, reused)');

-- a block written for another number does not apply
select is(t064.gpi(6618), t064.identity_for('+6739640021'), 'a block written for a number the person no longer holds does not stop them (Stale)');
select isnt(t064.identity_for('+6739640021'), null, '...and their identity was created');

-- the orphan list
select ok((select (r -> 'orphan_identities' -> 'identity_ids') ? t064.u(6806)::text from reports where kind = 'apply'), 'an identity with no person is on the orphan list');
select ok((select not (r -> 'orphan_identities' -> 'identity_ids') ? t064.identity_for('+6739640001')::text from reports where kind = 'apply'), '...a linked one (Alpha) is not');

-- not created
select is(t064.identity_for('+6739640006'), null, 'no identity from a TEST event''s result (Foxtrot)');
select is(t064.identity_for('+6739640005'), null, 'no identity for a person in an UNPUBLISHED event (Echo)');
select is(t064.identity_for('+6739640003'), null, 'no identity for a ROSTER-ONLY person with no entry (Charlie)');
select is(t064.identity_for('+6739640004'), null, 'no identity for an entry the payload does not name (Delta, full standings published)');
select is(t064.identity_for('+6739640020'), null, 'no identity for an entry a PODIUM-ONLY publish does not name (Sierra)');
select is((select count(*)::int from app.seduh_identities where phone_e164 in ('+6739640014', '+6739640015')), 0,
  'two entries the payload cannot tell apart create nothing (Oscar and Papa)');
select is(t064.identity_for('+6739640009'), null, 'an owner-blocked person creates no identity (India)');
select is(t064.gpi(6609), null, '...and stays unlinked');
select is((select count(*)::int from public.people where id in (t064.u(6603), t064.u(6604), t064.u(6605), t064.u(6606), t064.u(6614), t064.u(6615), t064.u(6702)) and global_person_id is not null),
  0, 'none of the people who are not named got a link');

-- skipped bad phone
select is(t064.gpi(6602), null, 'the non-E.164 person is not linked');
select is(t064.listed((select r from reports where kind = 'apply'), 'skipped_bad_phone', 6602), true, '...and the run lists them by id');
select is((select phone from people where id = t064.u(6602)), '555-0102', '...and their phone was not repaired or touched');

-- reuse
select is((select status || '/' || coalesce(display_name, 'NULL') from app.seduh_identities where id = t064.u(6801)), 'opted_out/NULL',
  'an opted_out identity is reused untouched: still opted_out and still nameless');
select is(t064.gpi(6607), t064.u(6801), '...and the person is linked to it (inert)');
select is(t064.gpi(6608), t064.u(6803), 'a person whose phone has a merged tombstone is linked to the KEPT identity');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739640008'), 1, '...and no second identity was made for the tombstone''s phone');
select is((select display_name || '/' || coalesce(country, 'NULL') from app.seduh_identities where id = t064.u(6804)), 'T064 Existing Lima/Elsewhere',
  'an existing active identity is reused and its name and country are not overwritten');
select is(t064.gpi(6611), t064.u(6804), '...and the person is linked to it');
select is(t064.gpi(6612), t064.u(6805), 'a person already linked to a different identity is left exactly as they were');

-- two organisations, one phone
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739640010'), 1, 'two organisations holding one phone share ONE identity');
select is(t064.gpi(6610), t064.gpi(6701), '...both people point at it');
select is((select display_name from app.seduh_identities where phone_e164 = '+6739640010'), 'T064 Juliet Early',
  '...named from the EARLIER published record');
select is((select country from app.seduh_identities where phone_e164 = '+6739640010'), 'Brunei', '...with the first record''s country');

-- the report: counts and uuids only
select is((select count(*)::int from reports where r::text ~ '\+[0-9]{6}' or r::text ~* '(t064|cafe [xy])' or r::text like '%555-01%'), 0,
  'neither report contains a phone number or a name (counts and uuids only)');

-- idempotent
insert into reports select 'again', app.seduh_identity_backfill(true);
select is((select (r -> 'applied' ->> 'identities_created') || '/' || (r -> 'applied' ->> 'people_linked') from reports where kind = 'again'), '0/0',
  'a second run creates no identity and links no person');
select is((select (r ->> 'identities_to_create') || '/' || (r ->> 'people_to_link') from reports where kind = 'again'), '0/0', '...and its own plan has nothing to do');
select is(current_setting('app.seduh_link_write', true), '', 'the link flag is not left on');

-- the guard still refuses an API caller
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006401';
select is(t064.attempt(format('update people set global_person_id = %L where id = %L', t064.u(6805), t064.u(6601))),
  '42501: people.global_person_id is written by the database only', 'afterwards an API caller still cannot change a link');
select is(t064.attempt(format('update people set global_person_id = null where id = %L', t064.u(6601))),
  '42501: people.global_person_id is written by the database only', '...nor clear one');
reset role;

-- ACL and the role-name refusal
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where p.oid in ('app.seduh_identity_backfill(boolean,uuid[])'::regprocedure, 'app.seduh_backfill_plan_internal(uuid[])'::regprocedure, 'app.seduh_backfill_slots_internal(uuid[])'::regprocedure)
              and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the backfill and its two helpers are executable by no API role (service_role and PUBLIC included)');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.seduh_identity_backfill(boolean,uuid[])'::regprocedure),
  true, 'the backfill is SECURITY DEFINER with search_path pinned to the empty string');
set local role authenticated;
select is(t064.attempt('select app.seduh_identity_backfill(false)'), '42501: permission denied for function seduh_identity_backfill',
  'an authenticated caller is refused at the door');
reset role;
set local role service_role;
select matches(t064.attempt('select app.seduh_identity_backfill(true)'), '^42501: permission denied for (function seduh_identity_backfill|schema app)$',
  'so is service_role (it has no use of the app schema at all)');
reset role;
grant execute on function app.seduh_identity_backfill(boolean, uuid[]) to authenticated, anon, service_role;   -- undone by the rollback
set local role authenticated;
select is(t064.attempt('select app.seduh_identity_backfill(true)'), '42501: seduh_identity_backfill is run by the database owner only',
  'even with the door opened by mistake, the function refuses an API role by name');
reset role;

-- a dry run in a READ ONLY transaction (the last statement: read-write cannot be restored)
set local transaction_read_only = on;
select is((select app.seduh_identity_backfill(false) ->> 'mode'), 'dry_run', 'a dry run works inside a READ ONLY transaction (it writes nothing)');

select * from finish();
rollback;
