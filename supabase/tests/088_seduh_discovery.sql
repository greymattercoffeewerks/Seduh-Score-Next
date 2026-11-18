-- T-ID2.C5: Seduh ID discovery (migration 20261125100000_seduh_discovery.sql).
-- Fictional fixtures: handles end -t88, names start "T088", ids 00000000-0000-0000-0000-0000088xxxxx.
-- Proves:
--   * the switch is OFF after the migration and, while off, EVERY door answers open:false with nothing in it (even for
--     a perfect match), including the results-page link door; the owner's flip is a plain update of one row; a missing row reads closed;
--   * who can ever come back: an unclaimed person, a closed account, a merged or opted-out identity, a hidden name and a person
--     who turned "Show me in Seduh ID search" off never appear in search or country browse; the setting defaults ON;
--   * the results-page link needs a public name AND public recorded results, does not need search opt-in, and never links an
--     unpublished event, a test event, an ambiguous name or an unclaimed person;
--   * a cafe query matches the cafe of a PUBLISHED result only while recorded results are public, and the cafe is never returned;
--   * limits: min and max query length, wildcards are literals, caps with `more`, the country must be two letters;
--   * anon runs the four doors and can read no table behind them; the helpers are owner-only; the doors are SECURITY DEFINER with
--     an empty search_path; nothing returned carries a uuid, email or phone;
--   * the setting round-trips through seduh_set_my_settings and seduh_my_record, and a non-boolean is refused.
begin;
select plan(100);

create schema t088;
grant usage on schema t088 to anon, authenticated;
create function t088.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000088' || lpad(n::text, 5, '0'))::uuid
$$;
-- run a statement text as anon / as a signed-in person; the door's json comes back
create function t088.anon(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role anon;
  execute 'select to_jsonb(t.x) from (' || q || ') t(x)' into r;
  reset role;
  return r;
end $$;
create function t088.attempt(stmt text, role_name text default 'anon') returns text language plpgsql as $$
begin
  execute 'set local role ' || role_name;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end $$;
create function t088.names(j jsonb, key text default 'results') returns text language sql immutable as $$
  select coalesce(string_agg(e ->> 'handle', ',' order by e ->> 'handle') filter (where e ->> 'handle' like '%-t88'), '') from jsonb_array_elements(j -> key) e
$$;
grant execute on all functions in schema t088 to anon, authenticated;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) select t088.u(n), 'u' || n || '@t088.seduh-next' from generate_series(1, 9) n;
insert into orgs (id, name, slug) values (t088.u(901), 'T088 Org', 't088-org');

-- identities: 1 alpha BN, 2 bravo (search off) BN, 3 charlie (name hidden) BN, 4 delta (closed) BN, 5 echo (merged),
-- 6 foxtrot (recorded results hidden) MY, 7 golf (NO account) BN, 8 hotel (opted out), 9 india MY (in search, plain)
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t088.u(n), '+67388000' || lpad(n::text, 2, '0'), 'T088 ' || nm, 'organiser_roster', cc
    from (values (1, 'Alpha', 'BN'), (2, 'Bravo', 'BN'), (3, 'Charlie', 'BN'), (4, 'Delta', 'BN'), (5, 'Echo', 'BN'),
                 (6, 'Foxtrot', 'MY'), (7, 'Golf', 'BN'), (8, 'Hotel', 'BN'), (9, 'India', 'MY')) v(n, nm, cc);
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t088.u(100 + n), t088.u(n), t088.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t88'), (2, 'bravo-t88'), (3, 'charlie-t88'), (4, 'delta-t88'), (5, 'echo-t88'),
                 (6, 'foxtrot-t88'), (8, 'hotel-t88'), (9, 'india-t88')) v(n, h);
update app.seduh_profile_settings set listed_in_search = false where account_id = t088.u(102);
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t088.u(103);
update app.seduh_accounts set closed_at = now() where id = t088.u(104);
update app.seduh_identities set status = 'merged', merged_into = t088.u(1) where id = t088.u(5);
update app.seduh_profile_settings set vis_recorded_results = 'hidden' where account_id = t088.u(106);
update app.seduh_identities set status = 'opted_out', display_name = null where id = t088.u(8);

-- people linked to identities (golf has people but no account)
insert into people (id, org_id, display_name, phone)
  select t088.u(200 + n), t088.u(901), 'T088 P' || n, '+67388100' || lpad(n::text, 2, '0') from generate_series(1, 9) n;
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t088.u(n) from generate_series(1, 9) n where people.id = t088.u(200 + n);
select set_config('app.seduh_link_write', '', true);

-- E1 published (everyone is on it, all at Cafe Zeta88 except India), E2 unpublished, E3 published then flagged test
insert into events (id, org_id, format, name, event_date) values
  (t088.u(301), t088.u(901), 'cup_taster', 'T088 Cup One', '2026-03-01'),
  (t088.u(302), t088.u(901), 'cup_taster', 'T088 Unpublished', '2026-04-01'),
  (t088.u(303), t088.u(901), 'cup_taster', 'T088 Test Event', '2026-05-01');
insert into event_entries (id, event_id, person_id, display_name, cafe)
  select t088.u(400 + n), t088.u(301), t088.u(200 + n), 'T088 ' || nm, case when n = 9 then null else 'Cafe Zeta88' end
    from (values (1, 'Alpha'), (2, 'Bravo'), (3, 'Charlie'), (6, 'Foxtrot'), (7, 'Golf'), (9, 'India')) v(n, nm);
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t088.u(499), t088.u(302), t088.u(201), 'T088 Alpha', 'Cafe Zeta88'),
  (t088.u(498), t088.u(303), t088.u(201), 'T088 Alpha', 'Cafe Zeta88');
insert into public.public_results (id, org_id, event_id, payload) values
  (t088.u(501), t088.u(901), t088.u(301), jsonb_build_object('format', 'cup_taster', 'eventName', 'T088 Cup One',
     'standings', jsonb_build_array(
       jsonb_build_object('place', 1, 'name', 'T088 Alpha', 'cafe', 'Cafe Zeta88', 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 90),
       jsonb_build_object('place', 2, 'name', 'T088 Bravo', 'cafe', 'Cafe Zeta88', 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 95),
       jsonb_build_object('place', 3, 'name', 'T088 Charlie', 'cafe', 'Cafe Zeta88', 'round', 'Final', 'correct', 4, 'total', 6, 'timeSecs', 99),
       jsonb_build_object('place', 4, 'name', 'T088 Foxtrot', 'cafe', 'Cafe Zeta88', 'round', 'Final', 'correct', 3, 'total', 6, 'timeSecs', 101),
       jsonb_build_object('place', 5, 'name', 'T088 Golf', 'cafe', 'Cafe Zeta88', 'round', 'Final', 'correct', 2, 'total', 6, 'timeSecs', 120),
       jsonb_build_object('place', 6, 'name', 'T088 India', 'cafe', null, 'round', 'Final', 'correct', 1, 'total', 6, 'timeSecs', 130),
       jsonb_build_object('place', 7, 'name', 'T088 Nobody', 'cafe', null, 'round', 'Final', 'correct', 0, 'total', 6, 'timeSecs', 140)))),
  (t088.u(503), t088.u(901), t088.u(303), jsonb_build_object('format', 'cup_taster', 'eventName', 'T088 Test Event',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T088 Alpha', 'cafe', 'Cafe Zeta88', 'correct', 6, 'total', 6))));
update events set is_test = true where id = t088.u(303);


-- ---- extra fixtures for the PUBLISH and ROSTER boundaries of the cafe match (names avoid "T088" so earlier searches are unchanged) ----
-- juliet: her only "Quebec88" entry is on an UNPUBLISHED event; kilo: roster cafe edited after publishing ("Lima88" now, "Mike88" printed);
-- november: two identical payload rows (names nobody); oscar: the same cafe on the TEST event only
insert into auth.users (id, email) select t088.u(n), 'u' || n || '@t088.seduh-next' from generate_series(10, 13) n;
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t088.u(n), '+67388000' || lpad(n::text, 2, '0'), nm, 'organiser_roster', 'ZZ'
    from (values (10, 'Quux Juliet'), (11, 'Quux Kilo'), (12, 'Quux November'), (13, 'Quux Oscar')) v(n, nm);
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t088.u(100 + n), t088.u(n), t088.u(n), h, 'organiser_link', now()
    from (values (10, 'juliet-t88'), (11, 'kilo-t88'), (12, 'november-t88'), (13, 'oscar-t88')) v(n, h);
insert into people (id, org_id, display_name, phone)
  select t088.u(200 + n), t088.u(901), 'T088 P' || n, '+67388100' || lpad(n::text, 2, '0') from generate_series(10, 13) n;
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t088.u(n) from generate_series(10, 13) n where people.id = t088.u(200 + n);
select set_config('app.seduh_link_write', '', true);
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t088.u(410), t088.u(302), t088.u(210), 'Quux Juliet', 'Cafe Quebec88'),
  (t088.u(411), t088.u(301), t088.u(211), 'Quux Kilo', 'Cafe Lima88'),
  (t088.u(412), t088.u(301), t088.u(212), 'Quux November', 'Cafe Oscar88'),
  (t088.u(413), t088.u(303), t088.u(213), 'Quux Oscar', 'Cafe Papa88');
update public.public_results set payload = jsonb_set(payload, '{standings}', (payload -> 'standings') || jsonb_build_array(
    jsonb_build_object('place', 8, 'name', 'Quux Kilo', 'cafe', 'Cafe Mike88', 'round', 'Final', 'correct', 1, 'total', 6, 'timeSecs', 150),
    jsonb_build_object('place', 9, 'name', 'Quux November', 'cafe', 'Cafe Oscar88', 'round', 'Final', 'correct', 1, 'total', 6, 'timeSecs', 151),
    jsonb_build_object('place', 10, 'name', 'Quux November', 'cafe', 'Cafe Oscar88', 'round', 'Final', 'correct', 1, 'total', 6, 'timeSecs', 152)))
  where id = t088.u(501);
update events set is_test = false where id = t088.u(303);
update public.public_results set payload = jsonb_set(payload, '{podium}', (payload -> 'podium') || jsonb_build_array(
    jsonb_build_object('rank', 2, 'name', 'Quux Oscar', 'cafe', 'Cafe Papa88', 'correct', 1, 'total', 6)))
  where id = t088.u(503);
update events set is_test = true where id = t088.u(303);

-- ============ shape, privileges ============

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and (p.proname like 'seduh\_discovery\_%' or p.proname = 'seduh_results_profile_links')),
  'seduh_discovery_countries, seduh_discovery_open, seduh_discovery_search, seduh_results_profile_links',
  'exactly four public discovery doors');
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none') from pg_proc p
    where p.proname in ('seduh_discovery_open', 'seduh_discovery_search', 'seduh_discovery_countries', 'seduh_results_profile_links')
      and p.pronamespace = 'public'::regnamespace
      and not (p.prosecdef and p.provolatile = 's' and coalesce(p.proconfig @> array['search_path=""'], false))),
  'none', 'every door is SECURITY DEFINER, STABLE, search_path pinned to the empty string');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', '), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('seduh_discovery_open', 'seduh_discovery_search', 'seduh_discovery_countries', 'seduh_results_profile_links')
      and not has_function_privilege(r, p.oid, 'execute')),
  'none', 'anon and authenticated can run every door');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', '), 'none')
     from pg_proc p, unnest(array['service_role', 'public']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('seduh_discovery_open', 'seduh_discovery_search', 'seduh_discovery_countries', 'seduh_results_profile_links')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'service_role and PUBLIC cannot');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', '), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
    where p.pronamespace = 'app'::regnamespace and p.proname in ('seduh_discovery_open', 'seduh_discovery_people', 'seduh_published_matches')
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the three app helpers have no API grant');
select is(t088.attempt($$ select * from app.seduh_discovery_switch $$), '42501', 'anon cannot read the switch table');
select is(t088.attempt($$ select * from app.seduh_discovery_switch $$, 'authenticated'), '42501', 'a signed-in caller cannot read the switch table');
select is(t088.attempt($$ update app.seduh_discovery_switch set enabled = true $$, 'authenticated'), '42501', '...or flip it');
select is(t088.attempt($$ select app.seduh_discovery_open() $$), '42501', 'anon cannot run the app helper');
select is(t088.attempt($$ select * from app.seduh_discovery_people(true) $$, 'authenticated'), '42501', 'nor can a signed-in caller');
select is(t088.attempt($$ select * from app.seduh_accounts $$), '42501', 'anon still reads no account table');
select is(t088.attempt($$ select * from app.seduh_profile_settings $$), '42501', 'nor the settings table');
select is((select count(*)::int from app.seduh_discovery_switch), 1, 'one switch row');
select is(t088.attempt($$ insert into app.seduh_discovery_switch (id, enabled) values (false, true) $$ , 'postgres'), '23514', 'a second row (id false) is refused by the check');

-- ============ the switch is OFF ============

select is((select enabled from app.seduh_discovery_switch), false, 'the switch is OFF after the migration');
select is(t088.anon($$ select public.seduh_discovery_open() $$) #>> '{}', 'false', 'open() is false');
select is(t088.anon($$ select public.seduh_discovery_search('T088 Alpha', null) $$), '{"open":false,"more":false,"results":[]}'::jsonb, 'OFF: a perfect match returns nothing');
select is(t088.anon($$ select public.seduh_discovery_search(null, 'BN') $$), '{"open":false,"more":false,"results":[]}'::jsonb, 'OFF: country browse returns nothing');
select is(t088.anon($$ select public.seduh_discovery_countries() $$), '{"open":false,"countries":[]}'::jsonb, 'OFF: no countries');
select is(t088.anon($$ select public.seduh_results_profile_links('00000000-0000-0000-0000-000008830100') $$), '{"open":false,"links":[]}'::jsonb, 'OFF: no profile links');
select is((select count(*)::int from app.seduh_discovery_people(false)), 0, 'OFF: the helper returns nobody');

-- the person's setting works while off, and defaults ON
select is((select listed_in_search from app.seduh_profile_settings where account_id = t088.u(101)), true, 'listed_in_search defaults to true');
select is((select count(*)::int from app.seduh_profile_settings s join app.seduh_accounts a on a.id = s.account_id where a.handle like '%-t88' and s.listed_in_search is not true), 1, 'only bravo opted out');

-- ============ the owner flips it ============

update app.seduh_discovery_switch set enabled = true, changed_at = now();
select is(t088.anon($$ select public.seduh_discovery_open() $$) #>> '{}', 'true', 'ON: open() is true');

-- who comes back for "t088": alpha, foxtrot, india only (bravo opted out, charlie hidden name, delta closed, echo merged,
-- golf unclaimed, hotel opted out)
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('t088', null) $$)), 'alpha-t88,foxtrot-t88,india-t88',
  'search "t088": only open, attested, active, public-name, listed people');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('  T088   ALPHA ', null) $$)), 'alpha-t88', 'case and spacing do not matter');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('bravo', null) $$)), '', 'an opted-out person is not found by name');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('bravo-t88', null) $$)), '', '...or by handle');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('charlie', null) $$)), '', 'a hidden name is not found by name');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('charlie-t88', null) $$)), '', '...or by handle');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('delta', null) $$)), '', 'a closed account is not found');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('echo', null) $$)), '', 'a merged identity is not found');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('golf', null) $$)), '', 'an unclaimed person is not found');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('hotel', null) $$)), '', 'an opted-out identity is not found');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('alpha-t88', null) $$)), 'alpha-t88', 'a handle finds its person');

-- cafe
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('zeta88', null) $$)), 'alpha-t88',
  'a cafe query finds the person with that cafe on a published result: not bravo (opted out), not charlie (hidden), not foxtrot (recorded results hidden), not golf (unclaimed)');
select is(t088.anon($$ select public.seduh_discovery_search('zeta88', null) $$)::text !~* 'zeta', true, 'the cafe itself is never returned');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('zeta88', 'MY') $$)), '', 'the cafe query respects the country filter');

-- shape limits
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('a', null) $$)), '', 'a one-character query returns nothing');
select is(t088.anon($$ select public.seduh_discovery_search('a', null) $$) ->> 'open', 'true', '...and says so without an error');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search(repeat('a', 41), null) $$)), '', 'a 41-character query returns nothing');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('%%', null) $$)), '', 'a LIKE wildcard is a literal');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('__', null) $$)), '', '...and so is an underscore');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('t088', 'bn;') $$)), '', 'a bad country returns nothing');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search(null, null) $$)), '', 'no query and no country returns nothing');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('', '') $$)), '', '...also empty strings');

select is(t088.names(t088.anon(format($$ select public.seduh_discovery_search(%L, null) $$, repeat('t088 ', 60)))), '', 'a 300-character query is refused up front');

-- country browse
select is(t088.names(t088.anon($$ select public.seduh_discovery_search(null, 'bn') $$)), 'alpha-t88', 'browse BN: alpha only (the rest are hidden, closed, opted out, merged or unclaimed)');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search(null, 'MY') $$)), 'foxtrot-t88,india-t88', 'browse MY');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('t088', 'MY') $$)), 'foxtrot-t88,india-t88', 'query plus country');
select is(
  (select (c ->> 'people')::int from jsonb_array_elements(t088.anon($$ select public.seduh_discovery_countries() $$) -> 'countries') c where c ->> 'country_code' = 'BN'),
  (select count(*)::int from app.seduh_discovery_people(true) where country_code = 'BN'),
  'the country list counts exactly the people the helper can find (BN)');
select is((select count(*)::int from app.seduh_discovery_people(true) where country_code = 'BN' and handle like '%-t88'), 1, 'and of this fixture only alpha is findable in BN');

-- the caps: 25 more people in a fresh country
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t088.u(1000 + n), '+67388200' || lpad(n::text, 2, '0'), 'T088 Cap' || lpad(n::text, 2, '0'), 'organiser_roster', 'ID' from generate_series(1, 25) n;
insert into auth.users (id, email) select t088.u(1000 + n), 'cap' || n || '@t088.seduh-next' from generate_series(1, 25) n;
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t088.u(2000 + n), t088.u(1000 + n), t088.u(1000 + n), 'cap' || lpad(n::text, 2, '0') || '-t88', 'organiser_link', now() from generate_series(1, 25) n;
select is(jsonb_array_length(t088.anon($$ select public.seduh_discovery_search('t088 cap', null) $$) -> 'results'), 20, 'a search returns at most 20');
select is(t088.anon($$ select public.seduh_discovery_search('t088 cap', null) $$) ->> 'more', 'true', '...and says there is more');
select is(jsonb_array_length(t088.anon($$ select public.seduh_discovery_search(null, 'ID') $$) -> 'results'), 25, 'a country browse returns up to 60 (25 here)');
select is(t088.anon($$ select public.seduh_discovery_search(null, 'ID') $$) ->> 'more', 'false', '...with more false');
select is((t088.anon($$ select public.seduh_discovery_search('t088 cap', null) $$) -> 'results' -> 0) ->> 'handle', 'cap01-t88', 'results are ordered by name');

-- nothing sensitive in any output
select is((select string_agg(t088.anon(format($$ select public.seduh_discovery_search(%L, null) $$, q))::text, ' ') ~* '[0-9a-f]{8}-[0-9a-f]{4}-|@|\+673|phone|email|user_id|identity_id'
             from unnest(array['t088', 'zeta88', 'alpha']) q), false, 'no uuid, email or phone in search output');
select is(t088.anon($$ select public.seduh_discovery_countries() $$)::text ~* '[0-9a-f]{8}-|@|\+673', false, 'nor in the countries output');
select is((select jsonb_array_length(t088.anon($$ select public.seduh_discovery_search('alpha-t88', null) $$) -> 'results')), 1, 'alpha is found (so the photo check below is not vacuous)');
select is((t088.anon($$ select public.seduh_discovery_search('alpha', null) $$) -> 'results' -> 0) ->> 'photo_url', null, 'no photo: photo_url is null');

-- ============ the results-page links ============

select is(t088.names(t088.anon($$ select public.seduh_results_profile_links('00000000-0000-0000-0000-000008830100') $$), 'links'), '', 'unknown event: no links');
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301))), 'links'), 'alpha-t88,bravo-t88,india-t88',
  'the published event links alpha, bravo (opted out of SEARCH only) and india; not charlie (hidden name), foxtrot (recorded results hidden), golf (unclaimed), delta/echo/hotel (not linked here) or an unmatched name');
select is(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301)))::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-|@|\+673', true, 'link output has no uuid, email or phone');
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(302))), 'links'), '', 'an unpublished event links nobody');
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(303))), 'links'), '', 'a test event links nobody');
select is(t088.anon($$ select public.seduh_results_profile_links(null) $$) -> 'links', '[]'::jsonb, 'a null event links nobody');
-- an ambiguous name: a second roster entry with the same name and cafe means nobody is linked
insert into people (id, org_id, display_name, phone) values (t088.u(250), t088.u(901), 'T088 P-twin', '+6738810050');
insert into event_entries (id, event_id, person_id, display_name, cafe) values (t088.u(450), t088.u(301), t088.u(250), 'T088 India', null);
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301))), 'links'), 'alpha-t88,bravo-t88', 'a duplicated roster name links nobody (india drops out)');
-- the profile and the links agree: alpha's profile shows the result the link points at
select is(jsonb_array_length(public.public_seduh_profile('alpha-t88') -> 'recorded_results') >= 1, true, 'the page a link opens does show that result');
-- recorded results back to public: the link appears
update app.seduh_profile_settings set vis_recorded_results = 'public' where account_id = t088.u(106);
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301))), 'links'), 'alpha-t88,bravo-t88,foxtrot-t88', 'public recorded results link (foxtrot now)');
-- hidden name: gone again from everything
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t088.u(101);
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301))), 'links'), 'bravo-t88,foxtrot-t88', 'alpha hides the name: no link');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('alpha', null) $$)), '', '...and no search result');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search(null, 'BN') $$)), '', '...and no browse result');
update app.seduh_profile_settings set vis_identity = 'public' where account_id = t088.u(101);


-- ---- the PUBLISH and ROSTER boundaries of the cafe match, and 'organisers' visibility ----
update app.seduh_discovery_switch set enabled = true;
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('quebec88', null) $$)), '', 'a cafe only on an UNPUBLISHED event matches nobody');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('papa88', null) $$)), '', 'a cafe only on a TEST event matches nobody');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('lima88', null) $$)), '', 'a roster cafe edited after publishing matches nothing (the roster value was never printed)');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('mike88', null) $$)), '', '...nor does the printed one (the roster no longer agrees)');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('oscar88', null) $$)), '', 'two identical payload rows name nobody');
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301))), 'links'), 'alpha-t88,bravo-t88,foxtrot-t88', 'none of those four is linked on the published event either');
update app.seduh_profile_settings set vis_recorded_results = 'organisers' where account_id = t088.u(106);
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('zeta88', null) $$)), 'alpha-t88', 'recorded results organisers is not public: no cafe match for foxtrot');
select is(t088.names(t088.anon(format($$ select public.seduh_results_profile_links(%L) $$, t088.u(301))), 'links'), 'alpha-t88,bravo-t88', '...and no link for foxtrot');
update app.seduh_profile_settings set vis_recorded_results = 'public' where account_id = t088.u(106);

-- a non-boolean for the new setting is REFUSED (not cast): as bravo, P0001 with the hint bad_setting, and nothing stored
create function t088.attempt_as(n int, stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  perform set_config('request.jwt.claim.sub', t088.u(n)::text, true);
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  reset role;
  return sqlstate || '/' || coalesce(v_hint, '');
end $$;
grant execute on function t088.attempt_as(int, text) to authenticated;
select is((select listed_in_search from app.seduh_profile_settings where account_id = t088.u(102)), false, 'bravo is opted out (before)');
select is(t088.attempt_as(2, $$ select public.seduh_set_my_settings('{"listed_in_search": "yes"}') $$), 'P0001/bad_setting', 'a string for listed_in_search is refused');
select is(t088.attempt_as(2, $$ select public.seduh_set_my_settings('{"listed_in_search": 1}') $$), 'P0001/bad_setting', 'a number is refused');
select is(t088.attempt_as(2, $$ select public.seduh_set_my_settings('{"listed_on_country_pages": "yes"}') $$), 'P0001/bad_setting', 'and for the country listing');
select is((select listed_in_search from app.seduh_profile_settings where account_id = t088.u(102)), false, '...and nothing was stored (after)');

-- ============ the switch closes it all again, even with the row gone ============

update app.seduh_discovery_switch set enabled = false;
select is(t088.anon($$ select public.seduh_discovery_search('T088 Alpha', null) $$) ->> 'open', 'false', 'switched back OFF: search closed');
update app.seduh_discovery_switch set enabled = true;
delete from app.seduh_discovery_switch;
select is(t088.anon($$ select public.seduh_discovery_open() $$) #>> '{}', 'false', 'a missing switch row reads CLOSED');
select is(t088.anon($$ select public.seduh_discovery_search('T088 Alpha', null) $$) ->> 'open', 'false', '...for search too');
insert into app.seduh_discovery_switch (id, enabled) values (true, true);

-- ============ the person's own setting ============

create function t088.as_user(n int, stmt text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', t088.u(n)::text, true);
  set local role authenticated;
  execute 'select to_jsonb(t.x) from (' || stmt || ') t(x)' into r;
  reset role;
  return r;
end $$;
grant execute on function t088.as_user(int, text) to authenticated;
select is(t088.as_user(2, $$ select public.seduh_my_record() -> 'settings' -> 'listed_in_search' $$) #>> '{}', 'false', 'seduh_my_record returns the setting (bravo: off)');
select is(t088.as_user(2, $$ select public.seduh_set_my_settings('{"listed_in_search": true}') -> 'listed_in_search' $$) #>> '{}', 'true', 'the existing settings door turns it on');
select is((select listed_in_search from app.seduh_profile_settings where account_id = t088.u(102)), true, '...and it is stored');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('bravo', null) $$)), 'bravo-t88', 'bravo is now found');
select is(t088.as_user(2, $$ select public.seduh_set_my_settings('{"listed_in_search": false, "vis_knockout_record": "hidden"}') -> 'listed_in_search' $$) #>> '{}', 'false', 'it can be turned off with another key in one call');
select is(t088.names(t088.anon($$ select public.seduh_discovery_search('bravo', null) $$)), '', 'bravo is gone again at once');
select is(t088.attempt($$ select public.seduh_set_my_settings('{"listed_in_search": "yes"}') $$, 'anon'), '42501', 'anon cannot call the settings door');

-- ============ the rollback block removes what the migration added ============

-- (a copy of the migration's rollback, kept in step by hand; the two restored functions are not re-created here)
create function t088.has_obj(n text) returns boolean language sql stable as $$
  select to_regprocedure(n) is not null $$;
select is(t088.has_obj('public.seduh_discovery_search(text,text)') and t088.has_obj('app.seduh_discovery_people(boolean)'), true, 'doors exist before the rollback copy');
drop function public.seduh_results_profile_links(uuid);
drop function public.seduh_discovery_countries();
drop function public.seduh_discovery_search(text, text);
drop function public.seduh_discovery_open();
drop function app.seduh_published_matches(uuid, uuid);
drop function app.seduh_discovery_people(boolean);
drop function app.seduh_discovery_open();
drop table app.seduh_discovery_switch;
alter table app.seduh_profile_settings drop column listed_in_search;
select is(t088.has_obj('public.seduh_discovery_search(text,text)') or t088.has_obj('app.seduh_discovery_people(boolean)'), false, 'the rollback copy removes the doors and helpers');
select is(to_regclass('app.seduh_discovery_switch') is null, true, '...the switch table');
select is((select count(*)::int from information_schema.columns where table_schema = 'app' and table_name = 'seduh_profile_settings' and column_name = 'listed_in_search'), 0, '...and the column');

select * from finish();
rollback;
