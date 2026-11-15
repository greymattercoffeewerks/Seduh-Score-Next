-- T-ID2.B1: the profile door public.public_seduh_profile(text) (migration 20261116100000_public_seduh_profile.sql).
-- Proves, on fictional fixtures (handles end -t80, phones +673800xxxx, every id in 00000000-0000-0000-0000-0000080xxxxx):
--   * the door: SECURITY DEFINER, STABLE, empty search_path, ACL exactly owner + anon + authenticated; anon runs it and still
--     cannot read any table behind it (app.seduh_*, people, event_entries, td_*);
--   * every visibility setting hides its section ('hidden', and 'organisers' behaves exactly like hidden), a hidden part looks
--     like a part with nothing in it (same keys, zero counts, null fields), and an all-hidden claimed page keeps has_profile;
--   * THE CORE INVARIANT: results of an unpublished event, of a test event (flagged after publishing), of a non-Cup-Taster
--     format, of an ambiguous (duplicate) name, and of a roster name edited after publishing never appear, while a published
--     one does, from BOTH organisations, with the payload's own figures and the provenance 'seduh_score';
--   * the knockout record is ALWAYS zeros for now: Throwdown matches of a published event (decided, with claimed public opponents,
--     byes, pool and level matches in the fixtures) contribute nothing, because the door never reads the live match tables
--     (owner decision 2026-11-16; the fixtures stay so the future payload-based reader can be tested against them);
--   * an unknown, closed, merged, opted-out, reserved, malformed, NULL or hostile handle all get ONE identical empty shape with
--     no error and no echo; a claimed one is found whatever its case or padding;
--   * no phone, email or uuid appears anywhere in the output (the JSON text is scanned), and no hidden setting is returned.
-- Not testable here: an account without adult_attested_at (the column is NOT NULL, so none can exist; its NOT NULL is asserted)
-- and a shadow event (events.is_shadow does not exist: the migration marks the seam).
begin;
select plan(79);

create schema t080;
grant usage on schema t080 to anon, authenticated;

create function t080.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000080' || lpad(n::text, 5, '0'))::uuid
$$;
-- the door as a flat text for scanning
create function t080.txt(h text) returns text language sql stable as $$ select public.public_seduh_profile(h)::text $$;
grant execute on all functions in schema t080 to anon, authenticated;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) select t080.u(n), 'u' || n || '@t080.seduh-next' from generate_series(1, 12) n;
insert into orgs (id, name, slug) values (t080.u(901), 'T080 Org One', 't080-one'), (t080.u(902), 'T080 Org Two', 't080-two');

-- identities 1..12; phones +67380000nn
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t080.u(n), '+67380000' || lpad(n::text, 2, '0'), 'T080 Person ' || n, 'organiser_roster', case when n = 1 then 'XA' end
    from generate_series(1, 12) n;

-- accounts: 1 alpha (all public), 2 bravo (public opponent), 3 charlie (knockout hidden), 4 delta (everything hidden),
-- 5 echo (results: organisers), 6 foxtrot (identity hidden), 7 golf (closed), 8 hotel (merged identity), 9 india (opted out)
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t080.u(100 + n), t080.u(n), t080.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t80'), (2, 'bravo-t80'), (3, 'charlie-t80'), (4, 'delta-t80'), (5, 'echo-t80'),
                 (6, 'foxtrot-t80'), (7, 'golf-t80'), (8, 'hotel-t80'), (9, 'india-t80')) v(n, h);
update app.seduh_profile_settings set vis_knockout_record = 'hidden' where account_id = t080.u(103);
update app.seduh_profile_settings
   set vis_identity = 'hidden', vis_recorded_results = 'hidden', vis_organiser_results = 'hidden',
       vis_self_reported_results = 'hidden', vis_judging_roles = 'hidden', vis_cafe_affiliations = 'hidden',
       vis_knockout_record = 'hidden'
 where account_id = t080.u(104);
update app.seduh_profile_settings set vis_recorded_results = 'organisers' where account_id = t080.u(105);
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t080.u(106);
update app.seduh_accounts set closed_at = now() where id = t080.u(107);
update app.seduh_identities set status = 'merged', merged_into = t080.u(10) where id = t080.u(8);
update app.seduh_identities set status = 'opted_out', display_name = null where id = t080.u(9);

-- people: 1..9 in org one linked to identities 1..9; 21 = alpha again in org two; 30 = an unclaimed competitor
insert into people (id, org_id, display_name, phone, email)
  select t080.u(200 + n), t080.u(901), 'T080 P' || n, '+67380100' || lpad(n::text, 2, '0'), 'p' || n || '@t080.seduh-next'
    from generate_series(1, 9) n;
insert into people (id, org_id, display_name, phone) values
  (t080.u(221), t080.u(902), 'T080 Alpha Two', '+6738010021'),
  (t080.u(230), t080.u(901), 'T080 Unclaimed', '+6738010030');
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t080.u(id_n) from (select n as id_n from generate_series(1, 9) n) g where people.id = t080.u(200 + g.id_n);
update people set global_person_id = t080.u(1) where id = t080.u(221);
select set_config('app.seduh_link_write', '', true);

-- events. E1 one/cup_taster/full standings, E2 two/cup_taster/podium only, E3 unpublished, E4 published then flagged test,
-- E5 duplicate names, E6 renamed entry, E7 a BTC-format event with a podium naming alpha
insert into events (id, org_id, format, name, event_date) values
  (t080.u(301), t080.u(901), 'cup_taster', 'T080 Cup One', '2026-03-01'),
  (t080.u(302), t080.u(902), 'cup_taster', 'T080 Cup Two', '2026-05-01'),
  (t080.u(303), t080.u(901), 'cup_taster', 'T080 Unpublished', '2026-06-01'),
  (t080.u(304), t080.u(901), 'cup_taster', 'T080 Test Event', '2026-07-01'),
  (t080.u(305), t080.u(901), 'cup_taster', 'T080 Duplicate Names', '2026-08-01'),
  (t080.u(306), t080.u(901), 'cup_taster', 'T080 Renamed', '2026-09-01'),
  (t080.u(307), t080.u(901), 'btc', 'T080 BTC Event', '2026-10-01'),
  (t080.u(308), t080.u(901), 'cup_taster', 'T080 Cafe Probe', '2026-10-02'),
  (t080.u(309), t080.u(901), 'cup_taster', 'T080 Dup Rows', '2026-10-03'),
  (t080.u(310), t080.u(901), 'cup_taster', 'T080 Partial Score', '2026-01-01');
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t080.u(401), t080.u(301), t080.u(201), 'T080 Alpha', 'Cafe One'),
  (t080.u(404), t080.u(301), t080.u(204), 'T080 Delta', 'Cafe One'),
  (t080.u(405), t080.u(301), t080.u(205), 'T080 Echo', null),
  (t080.u(406), t080.u(301), t080.u(206), 'T080 Foxtrot', null),
  (t080.u(402), t080.u(302), t080.u(221), 'T080 Alpha Two', null),
  (t080.u(403), t080.u(303), t080.u(201), 'T080 Alpha', 'Cafe One'),
  (t080.u(407), t080.u(304), t080.u(201), 'T080 Alpha', 'Cafe One'),
  (t080.u(408), t080.u(305), t080.u(201), 'T080 Twin', null),
  (t080.u(409), t080.u(305), t080.u(230), 'T080 Twin', null),
  (t080.u(410), t080.u(306), t080.u(201), 'T080 Alpha Renamed Since', null),
  (t080.u(411), t080.u(307), t080.u(201), 'T080 Alpha', 'Cafe One'),
  -- alpha is at Cafe Two; someone else with the same name is at Cafe One, and the published row says Cafe One
  (t080.u(412), t080.u(308), t080.u(201), 'T080 Cafe Probe', 'Cafe Two'),
  (t080.u(413), t080.u(308), t080.u(230), 'T080 Cafe Probe', 'Cafe One'),
  (t080.u(414), t080.u(309), t080.u(201), 'T080 Dup', null),
  (t080.u(415), t080.u(310), t080.u(201), 'T080 Partial', null);
insert into public.public_results (id, org_id, event_id, payload) values
  (t080.u(501), t080.u(901), t080.u(301), jsonb_build_object(
     'format', 'cup_taster', 'eventName', 'T080 Cup One', 'eventDate', '2026-03-01',
     'podium', jsonb_build_array(jsonb_build_object('rank', 3, 'name', 'T080 Alpha', 'cafe', 'Cafe One', 'correct', 1, 'total', 1)),
     'standings', jsonb_build_array(
       jsonb_build_object('place', 1, 'name', 'T080 Delta', 'cafe', 'Cafe One', 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 100),
       jsonb_build_object('place', 2, 'name', 'T080 Echo', 'cafe', null, 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 110),
       jsonb_build_object('place', 3, 'name', 'T080 Foxtrot', 'cafe', null, 'round', 'Final', 'correct', 4, 'total', 6, 'timeSecs', 120),
       jsonb_build_object('place', 4, 'name', 'T080 Alpha', 'cafe', 'Cafe One', 'round', 'Final', 'correct', 3, 'total', 6, 'timeSecs', 133)))),
  (t080.u(502), t080.u(902), t080.u(302), jsonb_build_object(
     'format', 'cup_taster', 'eventName', 'T080 Cup Two', 'eventDate', '2026-02-30',
     -- an impossible payload date must not break the door; time and round on a PODIUM row are not shown by the page, so not here
     'podium', jsonb_build_array(jsonb_build_object('rank', 2, 'name', 'T080 Alpha Two', 'cafe', null, 'correct', 4, 'total', 6, 'timeSecs', 200, 'round', 'Final')))),
  (t080.u(504), t080.u(901), t080.u(304), jsonb_build_object(
     'format', 'cup_taster', 'eventName', 'T080 Test Event',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T080 Alpha', 'cafe', 'Cafe One', 'correct', 6, 'total', 6)))),
  (t080.u(505), t080.u(901), t080.u(305), jsonb_build_object(
     'format', 'cup_taster', 'eventName', 'T080 Duplicate Names',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T080 Twin', 'cafe', null, 'correct', 6, 'total', 6)))),
  (t080.u(506), t080.u(901), t080.u(306), jsonb_build_object(
     'format', 'cup_taster', 'eventName', 'T080 Renamed',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T080 Alpha Before Rename', 'cafe', null, 'correct', 6, 'total', 6)))),
  (t080.u(508), t080.u(901), t080.u(308), jsonb_build_object('format', 'cup_taster', 'eventName', 'T080 Cafe Probe',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T080 Cafe Probe', 'cafe', 'Cafe One', 'correct', 6, 'total', 6)))),
  (t080.u(509), t080.u(901), t080.u(309), jsonb_build_object('format', 'cup_taster', 'eventName', 'T080 Dup Rows',
     'standings', jsonb_build_array(
       jsonb_build_object('place', 1, 'name', 'T080 Dup', 'cafe', null, 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 90),
       jsonb_build_object('place', 2, 'name', 'T080 Dup', 'cafe', null, 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 95)))),
  (t080.u(510), t080.u(901), t080.u(310), jsonb_build_object('format', 'cup_taster', 'eventName', 'T080 Partial Score',
     'standings', jsonb_build_array(jsonb_build_object('place', 1, 'name', 'T080 Partial', 'cafe', null, 'round', 'Final', 'correct', 5)))),
  (t080.u(507), t080.u(901), t080.u(307), jsonb_build_object(
     'format', 'btc', 'eventName', 'T080 BTC Event',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T080 Alpha', 'cafe', 'Cafe One', 'correct', 6, 'total', 6))));
-- E4 is published (a test event cannot be), THEN flagged as a test event
update events set is_test = true where id = t080.u(304);

-- Throwdown: TD1 published, TD2 unpublished, TD3 published then flagged test
insert into events (id, org_id, format, name) values
  (t080.u(311), t080.u(901), 'throwdown', 'T080 TD One'),
  (t080.u(312), t080.u(901), 'throwdown', 'T080 TD Two'),
  (t080.u(313), t080.u(901), 'throwdown', 'T080 TD Three'),
  (t080.u(314), t080.u(901), 'throwdown', 'T080 TD Four');
insert into public.public_results (org_id, event_id, payload) values
  (t080.u(901), t080.u(311), '{"format":"throwdown","eventName":"T080 TD One"}'),
  (t080.u(901), t080.u(313), '{"format":"throwdown","eventName":"T080 TD Three"}'),
  (t080.u(901), t080.u(314), '{"format":"throwdown","eventName":"T080 TD Four"}');
update events set is_test = true where id = t080.u(313);
-- entries: alpha (1), bravo (2), charlie (3), unclaimed (30) in each Throwdown event; entry id = 600 + (event-311)*100 + person
create function t080.te(ev int, p int) returns uuid language sql immutable as $$ select t080.u(600 + (ev - 311) * 100 + p) $$;
insert into event_entries (id, event_id, person_id, display_name)
  select t080.te(e, p), t080.u(e), t080.u(200 + p), 'T080 TD ' || p
    from generate_series(311, 313) e, unnest(array[1, 2, 3, 30]) p;
insert into event_entries (id, event_id, person_id, display_name)
  select t080.te(314, p), t080.u(314), t080.u(200 + p), 'T080 TD ' || p from unnest(array[1, 6, 7, 8, 9]) p;
-- a match: round r, position pos, entries pa v pb (pb null = bye), votes va:vb; kind votes|walkover|bye|undecided; wo = winning position
create function t080.td(ev int, r int, pos int, pa int, pb int, va int, vb int, kind text, wo int default null) returns void
language plpgsql as $$
declare m uuid := t080.u(2000 + ev * 100 + r * 10 + pos); s1 uuid := t080.u(3000 + ev * 100 + r * 10 + pos); s2 uuid := t080.u(4000 + ev * 100 + r * 10 + pos);
begin
  insert into public.td_rounds (id, event_id, position) values (t080.u(1000 + ev * 10 + r), t080.u(ev), r) on conflict do nothing;
  insert into public.td_matches (id, event_id, round_id, position) values (m, t080.u(ev), t080.u(1000 + ev * 10 + r), pos);
  insert into public.td_slots (id, event_id, match_id, position, entry_id) values (s1, t080.u(ev), m, 1, t080.te(ev, pa));
  insert into public.td_slots (id, event_id, match_id, position, entry_id) values (s2, t080.u(ev), m, 2, case when pb is not null then t080.te(ev, pb) end);
  insert into public.td_votes (event_id, match_id, slot_id) select t80_ev.e, m, s1 from (select t080.u(ev) as e) t80_ev, generate_series(1, va);
  insert into public.td_votes (event_id, match_id, slot_id) select t80_ev.e, m, s2 from (select t080.u(ev) as e) t80_ev, generate_series(1, vb);
  if kind <> 'undecided' then
    update public.td_matches set result_kind = kind, confirmed_at = now(), walkover_winner_position = wo where id = m;
  end if;
end $$;
-- TD1 (published): alpha beats bravo 2:1, loses to charlie 1:2, beats the unclaimed competitor by walkover, loses to bravo 0:3;
--   a bye for alpha, an undecided match against bravo, and a match won by the unclaimed competitor over bravo (alpha is not in it)
select t080.td(311, 1, 1, 1, 2, 2, 1, 'votes');
select t080.td(311, 1, 2, 1, 3, 1, 2, 'votes');
select t080.td(311, 1, 3, 1, 30, 0, 0, 'walkover', 1);
select t080.td(311, 2, 1, 1, 2, 0, 3, 'votes');
select t080.td(311, 2, 2, 1, null, 0, 0, 'bye');
select t080.td(311, 2, 3, 1, 2, 5, 0, 'undecided');
select t080.td(311, 2, 4, 30, 2, 2, 0, 'votes');
-- a redemption POOL match (alpha beats bravo 3:0) and a LEVEL confirmed match (1:1): neither counts for either side
insert into public.td_rounds (id, event_id, position, kind, phase) values (t080.u(1000 + 311 * 10 + 3), t080.u(311), 3, 'pool', 'redemption');
select t080.td(311, 3, 1, 1, 2, 3, 0, 'votes');
select t080.td(311, 4, 1, 1, 2, 1, 1, 'votes');
-- TD4 (published): alpha beats foxtrot (identity hidden), golf (closed), hotel (merged) and india (opted out): none may be NAMED,
-- all four count as wins
select t080.td(314, 1, 1, 1, 6, 2, 0, 'votes');
select t080.td(314, 1, 2, 1, 7, 2, 0, 'votes');
select t080.td(314, 1, 3, 1, 8, 2, 0, 'votes');
select t080.td(314, 1, 4, 1, 9, 2, 0, 'votes');
-- TD2 (not published) and TD3 (published, then flagged test): alpha wins in each, and neither may count
select t080.td(312, 1, 1, 1, 2, 3, 0, 'votes');
select t080.td(313, 1, 1, 1, 2, 3, 0, 'votes');

-- ============ the door: shape, privileges, no direct table access ============

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'public_seduh_profile'
      and p.prosecdef and p.provolatile = 's' and coalesce(p.proconfig @> array['search_path=""'], false)),
  'public_seduh_profile(text)', 'the door is SECURITY DEFINER and STABLE with search_path pinned to the empty string');
select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
    where p.proname = 'public_seduh_profile' and p.pronamespace = 'public'::regnamespace and a.grantee <> p.proowner and a.grantee not in (
      (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'))),
  0, 'the door ACL names only the owner, anon and authenticated (no PUBLIC, no service role)');
select ok(has_function_privilege('anon', 'public.public_seduh_profile(text)', 'execute')
          and has_function_privilege('authenticated', 'public.public_seduh_profile(text)', 'execute')
          and not has_function_privilege('service_role', 'public.public_seduh_profile(text)', 'execute'),
          'anon and signed-in callers can run it; the service role cannot');
select is((select is_nullable from information_schema.columns where table_schema = 'app' and table_name = 'seduh_accounts' and column_name = 'adult_attested_at'),
          'NO', 'adult_attested_at is NOT NULL, so an unattested account cannot exist (the door also checks it)');

set local role anon;
select is(public.public_seduh_profile('bravo-t80') ->> 'has_profile', 'true', 'anon can run the door');
select throws_ok($$ select count(*) from app.seduh_accounts $$, '42501', null, 'anon cannot read app.seduh_accounts');
select throws_ok($$ select count(*) from app.seduh_profile_settings $$, '42501', null, 'anon cannot read the settings');
select throws_ok($$ select count(*) from app.seduh_identities $$, '42501', null, 'anon cannot read the identities');
select throws_ok($$ select count(*) from public.people $$, '42501', null, 'anon cannot read people');
select throws_ok($$ select count(*) from public.event_entries $$, '42501', null, 'anon cannot read event entries');
select throws_ok($$ select count(*) from public.td_slots $$, '42501', null, 'anon cannot read td_slots');
select throws_ok($$ select count(*) from public.td_match_results $$, '42501', null, 'anon cannot read the match results view');
reset role;
set local role authenticated;
select is(public.public_seduh_profile('bravo-t80') ->> 'has_profile', 'true', 'a signed-in caller can run the door');
select throws_ok($$ select count(*) from app.seduh_accounts $$, '42501', null, 'and still cannot read the account table');
reset role;

-- ============ the full page of an all-public claimed account ============

create temp table t80_a on commit drop as select public.public_seduh_profile('alpha-t80') as r;
select is((select r ->> 'has_profile' from t80_a), 'true', 'alpha has a profile');
select is((select r ->> 'handle' from t80_a), 'alpha-t80', 'the handle is returned');
select is((select r -> 'identity' ->> 'display_name' from t80_a), 'T080 Person 1', 'identity: the display name');
select is((select r -> 'identity' ->> 'country_code' from t80_a), 'XA', 'identity: the ISO country code');
select is((select (r -> 'identity' ->> 'founding_number')::int from t80_a), (select founding_number from app.seduh_accounts where handle = 'alpha-t80'), 'identity: the founding number');
select is((select r -> 'identity' ->> 'claimed_on' from t80_a), (select (claimed_at at time zone 'UTC')::date::text from app.seduh_accounts where handle = 'alpha-t80'), 'identity: the claimed date');
select is((select r -> 'identity' -> 'photo_url' from t80_a), 'null'::jsonb, 'identity: photo_url is a null seam');
select is((select jsonb_array_length(r -> 'recorded_results') from t80_a), 3,
  'three results: two published events of one organisation and one of the other (none from the unpublished, test, duplicate, renamed, wrong-cafe, duplicate-row or BTC events)');
select is((select jsonb_build_array(r -> 'recorded_results' -> 2 -> 'correct', r -> 'recorded_results' -> 2 -> 'total') from t80_a),
  '[null, null]'::jsonb, 'a row with a score but no total shows neither, as the results page shows a dash');
select is((select r -> 'recorded_results' -> 0 ->> 'event_name' from t80_a), 'T080 Cup Two', 'newest first: the second organisation''s event');
select is((select r -> 'recorded_results' -> 0 ->> 'organiser_name' from t80_a), 'T080 Org Two', 'the organiser is named, not identified');
select is((select r -> 'recorded_results' -> 0 -> 'placing' from t80_a), '2'::jsonb, 'a podium-only publication gives the podium rank');
select is((select r -> 'recorded_results' -> 0 ->> 'provenance' from t80_a), 'seduh_score', 'provenance seduh_score');
select is((select r -> 'recorded_results' -> 0 ->> 'format' from t80_a), 'cup_taster', 'the format');
select is((select r -> 'recorded_results' -> 0 ->> 'event_date' from t80_a), '2026-05-01', 'the event date comes from the event (a payload date that is not a real date cannot break the door)');
select is((select jsonb_build_array(r -> 'recorded_results' -> 0 -> 'stage', r -> 'recorded_results' -> 0 -> 'time_secs') from t80_a),
  '[null, null]'::jsonb, 'a podium row shows no round and no time, as the results page does not');
select is((select jsonb_build_array(r -> 'recorded_results' -> 0 -> 'correct', r -> 'recorded_results' -> 0 -> 'total') from t80_a),
  '[4, 6]'::jsonb, 'a podium row shows its score');
select is((select r -> 'recorded_results' -> 1 ->> 'organiser_name' from t80_a), 'T080 Org One', 'the first organiser''s event is the second item');
select is((select r -> 'recorded_results' -> 1 -> 'placing' from t80_a), '4'::jsonb, 'full standings give the standings place (4th, not the podium''s 3rd)');
select is((select r -> 'recorded_results' -> 1 ->> 'stage' from t80_a), 'Final', 'the round label');
select is((select jsonb_build_array(r -> 'recorded_results' -> 1 -> 'correct', r -> 'recorded_results' -> 1 -> 'total', r -> 'recorded_results' -> 1 -> 'time_secs') from t80_a),
  '[3, 6, 133]'::jsonb, 'the key figures: correct, total, time');
select is((select (select array_agg(k order by k) from jsonb_object_keys(r -> 'recorded_results' -> 1) k) from t80_a),
  array['correct','event_date','event_name','format','organiser_name','placing','provenance','stage','time_secs','total'],
  'an item has exactly these keys');
select is((select jsonb_array_length(r -> 'organiser_records') + jsonb_array_length(r -> 'self_reported') + jsonb_array_length(r -> 'judging_roles') + jsonb_array_length(r -> 'cafe_affiliations') from t80_a),
  0, 'the four seams are empty arrays');
select is((select jsonb_typeof(r -> 'organiser_records') || jsonb_typeof(r -> 'self_reported') || jsonb_typeof(r -> 'judging_roles') || jsonb_typeof(r -> 'cafe_affiliations') from t80_a),
  'arrayarrayarrayarray', 'each seam is an array, not null');

-- the knockout record returns NOTHING until Throwdown publishes a results payload (owner decision 2026-11-16): alpha has decided
-- Throwdown matches in published, non-test events (TD1 and TD4: wins, losses, named-opponent candidates) and all her settings are
-- public, yet the door shows zeros and no opponent, and so does bravo (a public opponent); it never reads td_matches
select is((select r -> 'knockout_record' from t80_a), '{"won":0,"lost":0,"opponents":[]}'::jsonb,
  'Throwdown matches of a published event contribute NOTHING to the knockout record');
select is((select public.public_seduh_profile('bravo-t80') -> 'knockout_record'), '{"won":0,"lost":0,"opponents":[]}'::jsonb,
  'nor to a public opponent''s');

-- ============ every setting hides its section; "organisers" is hidden for an anonymous caller ============

create function t080.with_setting(col text, val text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute format('update app.seduh_profile_settings set %I = %L where account_id = %L', col, val, t080.u(101));
  r := public.public_seduh_profile('alpha-t80');
  execute format('update app.seduh_profile_settings set %I = %L where account_id = %L', col, 'public', t080.u(101));
  return r;
end $$;
select is(jsonb_array_length(t080.with_setting('vis_recorded_results', 'hidden') -> 'recorded_results'), 0, 'vis_recorded_results hidden: no results');
select is(jsonb_array_length(t080.with_setting('vis_recorded_results', 'organisers') -> 'recorded_results'), 0, 'vis_recorded_results organisers: no results either');
select is(t080.with_setting('vis_knockout_record', 'hidden') -> 'knockout_record', '{"won":0,"lost":0,"opponents":[]}'::jsonb, 'vis_knockout_record hidden: zero counts, no opponents');
select is(t080.with_setting('vis_identity', 'hidden') -> 'identity',
  '{"display_name":null,"country_code":null,"founding_number":null,"claimed_on":null,"photo_url":null}'::jsonb, 'vis_identity hidden: the same keys, all null');
select is(t080.with_setting('vis_identity', 'hidden') ->> 'handle', 'alpha-t80', 'vis_identity hidden: the handle (the page address) stays');
select is(jsonb_array_length(t080.with_setting('vis_identity', 'hidden') -> 'recorded_results'), 3, 'hiding the identity does not hide the results');
select is(t080.with_setting('vis_judging_roles', 'hidden'), (select r from t80_a), 'the Phase C settings (judging roles) change nothing yet: the seams are empty either way');
select is(t080.with_setting('vis_cafe_affiliations', 'hidden'), (select r from t80_a), 'nor café affiliations');
select is(public.public_seduh_profile('alpha-t80'), (select r from t80_a), 'every setting was put back (the page is as it was)');

-- accounts that start with settings
select is((select jsonb_array_length(public.public_seduh_profile('echo-t80') -> 'recorded_results')), 0, 'echo (results: organisers): none shown');
select is((select public.public_seduh_profile('foxtrot-t80') -> 'identity' ->> 'display_name'), null, 'foxtrot hides the identity');
select is((select jsonb_array_length(public.public_seduh_profile('foxtrot-t80') -> 'recorded_results')), 1, 'foxtrot still shows the result');
select is((select public.public_seduh_profile('charlie-t80') -> 'knockout_record' ->> 'won'), '0', 'charlie hides the knockout record: zero wins shown (the real win over alpha is not leaked)');

-- an all-hidden claimed page keeps its handle and has_profile, with every section empty
select is((select public.public_seduh_profile('delta-t80') ->> 'has_profile'), 'true', 'delta (all hidden): has_profile stays true so a QR code never breaks');
select is((select public.public_seduh_profile('delta-t80') ->> 'handle'), 'delta-t80', 'delta: the handle is returned');
select is((select public.public_seduh_profile('delta-t80') - 'has_profile' - 'handle'),
  (select public.public_seduh_profile('nobody-t80') - 'has_profile' - 'handle'),
  'delta: every section is exactly as empty as a page that does not exist');

-- ============ the same keys at every level, found or not ============

select is((select array_agg(k order by k) from jsonb_object_keys((select r from t80_a)) k),
          (select array_agg(k order by k) from jsonb_object_keys(public.public_seduh_profile('nobody-t80')) k), 'a profile and an empty answer have the same top-level keys');
select is((select array_agg(k order by k) from jsonb_object_keys((select r -> 'identity' from t80_a)) k),
          (select array_agg(k order by k) from jsonb_object_keys(public.public_seduh_profile('nobody-t80') -> 'identity') k), 'and the same identity keys');
select is((select array_agg(k order by k) from jsonb_object_keys((select r -> 'knockout_record' from t80_a)) k),
          (select array_agg(k order by k) from jsonb_object_keys(public.public_seduh_profile('nobody-t80') -> 'knockout_record') k), 'and the same knockout keys');

-- ============ one identical empty shape ============

create temp table t80_empty on commit drop as select public.public_seduh_profile('nobody-t80') as r;
select is((select r ->> 'has_profile' from t80_empty), 'false', 'an unknown handle: has_profile false');
select is((select r -> 'handle' from t80_empty), 'null'::jsonb, 'the handle is not echoed');
select is(public.public_seduh_profile('golf-t80'), (select r from t80_empty), 'a closed account is identical to an unknown one');
select is(public.public_seduh_profile('hotel-t80'), (select r from t80_empty), 'a merged identity is identical');
select is(public.public_seduh_profile('india-t80'), (select r from t80_empty), 'an opted-out identity is identical');
select is(public.public_seduh_profile('admin'), (select r from t80_empty), 'a reserved word is identical');
select is(public.public_seduh_profile('country'), (select r from t80_empty), 'country (a fixed page) is identical');
select is(public.public_seduh_profile('ab'), (select r from t80_empty), 'too short is identical');
select is(public.public_seduh_profile(repeat('a', 31)), (select r from t80_empty), 'too long is identical');
select is(public.public_seduh_profile('-alpha-t80'), (select r from t80_empty), 'a leading hyphen is identical');
select is(public.public_seduh_profile('alpha--t80'), (select r from t80_empty), 'a doubled hyphen is identical');
select is(public.public_seduh_profile(''), (select r from t80_empty), 'an empty handle is identical');
select is(public.public_seduh_profile(null), (select r from t80_empty), 'NULL is identical');
select is(public.public_seduh_profile('x''; drop table app.seduh_accounts; --'), (select r from t80_empty), 'a hostile string is identical, and not an error');
select is(public.public_seduh_profile('alpha-t80%'), (select r from t80_empty), 'a LIKE wildcard matches nothing');
select is(public.public_seduh_profile(' ALPHA-T80 '), (select r from t80_a), 'a handle is lower-cased and trimmed before it is looked up');

-- ============ nothing private leaves the door ============

select is((select count(*)::int from app.seduh_accounts where handle like '%-t80'), 9, 'fixture: nine accounts');
select is(
  (select count(*)::int
     from unnest(array['alpha-t80', 'bravo-t80', 'charlie-t80', 'delta-t80', 'echo-t80', 'foxtrot-t80', 'golf-t80', 'nobody-t80']) h
    where t080.txt(h) ~ '\+673|@|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-|user_id|org_id|identity_id|token|hash|phone|email|vis_|listed'),
  0, 'no phone, email, uuid, internal id, token or setting name appears in any door output');
select is(t080.txt('alpha-t80') ~ 'T080 Unclaimed', false, 'the unclaimed competitor is never named');
select is(t080.txt('alpha-t80') ~ 'T080 Test Event|T080 Unpublished|T080 Duplicate|T080 Renamed|T080 Cafe Probe|T080 Dup Rows|T080 BTC|T080 TD (Two|Three)', false,
  'no event of an unpublished, test, ambiguous, renamed or BTC kind is named');

select * from finish();
rollback;
