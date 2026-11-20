-- T-ID2.TD: Throwdown on the Seduh ID profile (migration 20261127120000_seduh_throwdown_profile.sql). Fictional data only.
-- Ids 00000000-0000-0000-0000-000000092nnn via t092.u(n); names start "T092", handles end -t92.
-- Proves:
--   * ACL: app.seduh_knockout_record is executable by NO API role; the public door is unchanged (anon and authenticated, SECURITY
--     DEFINER, empty search_path).
--   * RECORDED RESULT: a published Throwdown standings row shows on the profile (place, round, no score), a podium-only payload too, a
--     test event never, an unpublished event never; Cup Taster output is unchanged (a Cup Taster payload that carries `matches`
--     still gives no knockout record).
--   * KNOCKOUT RECORD: counts only well-formed played matches of a published, non-test Throwdown payload; a hidden
--     vis_knockout_record gives zeros; an opponent is named only when claimed, open, active and public for BOTH vis_identity and
--     vis_knockout_record, and has not disputed their own result; an unclaimed, hidden, closed or ambiguous opponent only counts.
--   * "THIS ISN'T MINE": a disputed Throwdown result hides that event's matches too, and the disputer is not named in others' records.
--   * NOTHING INTERNAL: no uuid, phone, email or org id in the door's output.
begin;
select plan(41);

create schema t092;
grant usage on schema t092 to anon, authenticated, service_role;
create function t092.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad((92000 + n)::text, 12, '0'))::uuid
$$;
-- a door as anon
create function t092.anon(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role anon;
  execute 'select to_jsonb(t.x) from (' || q || ') t(x)' into r;
  reset role;
  return r;
end $$;
create function t092.profile(handle text) returns jsonb language sql as $$
  select t092.anon(format('select public.public_seduh_profile(%L)', handle))
$$;
-- "event|placing|stage|format" per recorded result, newest first as the door orders them
create function t092.recorded(handle text) returns text language sql as $$
  select coalesce(string_agg((e ->> 'event_name') || '|' || coalesce(e ->> 'placing', '-') || '|' || coalesce(e ->> 'stage', '-')
                             || '|' || (e ->> 'format') || '|' || coalesce(e ->> 'correct', '-'), ', '
                             order by e ->> 'event_date', e ->> 'event_name'), '')
    from jsonb_array_elements(t092.profile(handle) -> 'recorded_results') e
$$;
-- "won/lost" and the named opponents "name:matches:won:lost"
create function t092.ko(handle text) returns text language sql as $$
  select (t092.profile(handle) -> 'knockout_record' ->> 'won') || '/' || (t092.profile(handle) -> 'knockout_record' ->> 'lost') || ' ['
         || coalesce((select string_agg((o ->> 'display_name') || ':' || (o ->> 'matches') || ':' || (o ->> 'won') || ':' || (o ->> 'lost'), ', '
                                        order by o ->> 'display_name')
                        from jsonb_array_elements(t092.profile(handle) -> 'knockout_record' -> 'opponents') o), '') || ']'
$$;
create function t092.run_internal() returns text language plpgsql as $$
begin
  set local role anon;
  perform app.seduh_knockout_record(null, null);
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end $$;
grant execute on all functions in schema t092 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- identities 1..7: 1 alpha (the subject), 2 bravo (named), 3 charlie (vis_knockout_record hidden), 4 delta (NO identity link),
-- 5 echo (vis_identity hidden), 6 foxtrot (named, but disputes his own result), 7 golf (account closed), 8 hotel (named but
-- two roster entries share his name), 9 india (named: opponent in a podium-only event, never in the matches)
insert into auth.users (id, email) select t092.u(n), 'u' || n || '@t092.seduh-next' from generate_series(1, 10) n;
insert into orgs (id, name, slug) values (t092.u(901), 'T092 Org', 't092-org');
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t092.u(n), '+67392000' || lpad(n::text, 2, '0'), 'T092 ' || nm, 'organiser_roster', 'BN'
    from (values (1, 'Alpha'), (2, 'Bravo'), (3, 'Charlie'), (5, 'Echo'), (6, 'Foxtrot'), (7, 'Golf'), (8, 'Hotel'), (9, 'India')) v(n, nm);
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t092.u(100 + n), t092.u(n), t092.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t92'), (2, 'bravo-t92'), (3, 'charlie-t92'), (5, 'echo-t92'), (6, 'foxtrot-t92'), (7, 'golf-t92'),
                 (8, 'hotel-t92'), (9, 'india-t92')) v(n, h);
update app.seduh_accounts set closed_at = now() where id = t092.u(107);
update app.seduh_profile_settings set vis_knockout_record = 'hidden' where account_id = t092.u(103);
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t092.u(105);

insert into people (id, org_id, display_name, phone)
  select t092.u(200 + n), t092.u(901), 'T092 P' || n, '+67392100' || lpad(n::text, 2, '0') from generate_series(1, 11) n;
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t092.u(n) from unnest(array[1, 2, 3, 5, 6, 7, 8, 9]) n where people.id = t092.u(200 + n);
update people set global_person_id = t092.u(1) where id = t092.u(211);
select set_config('app.seduh_link_write', '', true);

-- E1: the Throwdown night (published, full standings and matches). E2: a Throwdown night published as podium only (no matches).
-- E3: a TEST Throwdown (published, then flagged). E4: an unpublished Throwdown. E5: a Cup Taster event whose payload carries `matches`.
insert into events (id, org_id, format, name, event_date) values
  (t092.u(301), t092.u(901), 'throwdown', 'T092 Night One', '2026-11-27'),
  (t092.u(302), t092.u(901), 'throwdown', 'T092 Night Two', '2026-12-04'),
  (t092.u(303), t092.u(901), 'throwdown', 'T092 Test Night', '2026-12-11'),
  (t092.u(304), t092.u(901), 'throwdown', 'T092 Unpublished', '2026-12-18'),
  (t092.u(305), t092.u(901), 'cup_taster', 'T092 Cup', '2026-10-01');
-- roster: everyone on E1 (cafe "Cafe n"), Alpha and India on E2..E5, Delta (person 4, unlinked) on E1, a second "T092 Hotel" on E1
insert into event_entries (id, event_id, person_id, display_name, cafe)
  select t092.u(400 + n), t092.u(301), t092.u(200 + n), 'T092 ' || nm, 'Cafe ' || nm
    from (values (1, 'Alpha'), (2, 'Bravo'), (3, 'Charlie'), (4, 'Delta'), (5, 'Echo'), (6, 'Foxtrot'), (7, 'Golf'), (8, 'Hotel')) v(n, nm);
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t092.u(499), t092.u(301), t092.u(210), 'T092 Hotel', 'Cafe Hotel'),
  (t092.u(498), t092.u(301), t092.u(211), 'T092 Alpha', 'Cafe Alpha Two');   -- Alpha's second entry (another person row, same identity)           -- a second entry with Hotel's exact name and cafe
insert into event_entries (id, event_id, person_id, display_name, cafe)
  select t092.u(500 + e * 10 + n), t092.u(300 + e), t092.u(200 + n), 'T092 ' || nm, 'Cafe ' || nm
    from (values (1, 'Alpha'), (9, 'India')) v(n, nm), generate_series(2, 5) e;

create function t092.side(nm text, won boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('name', 'T092 ' || nm, 'cafe', 'Cafe ' || nm, 'winner', won)
$$;
create function t092.match(rnd text, a text, a_won boolean, b text) returns jsonb language sql immutable as $$
  select jsonb_build_object('round', rnd, 'sides', jsonb_build_array(t092.side(a, a_won), t092.side(b, not a_won)))
$$;
create function t092.stand(p int, nm text, rnd text) returns jsonb language sql immutable as $$
  select jsonb_build_object('place', p, 'name', 'T092 ' || nm, 'cafe', 'Cafe ' || nm, 'round', rnd)
$$;

insert into public.public_results (id, org_id, event_id, payload) values
  (t092.u(601), t092.u(901), t092.u(301), jsonb_build_object('format', 'throwdown', 'eventName', 'T092 Night One', 'competitors', 8, 'rounds', 3,
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T092 Alpha', 'cafe', 'Cafe Alpha')),
     'standings', jsonb_build_array(t092.stand(1, 'Alpha', 'Final'), t092.stand(2, 'Echo', 'Final'), t092.stand(3, 'Bravo', 'Semi-finals'),
                                    t092.stand(3, 'Foxtrot', 'Semi-finals'), t092.stand(5, 'Charlie', 'Quarter-finals'),
                                    t092.stand(5, 'Delta', 'Quarter-finals'), t092.stand(5, 'Golf', 'Quarter-finals'),
                                    t092.stand(5, 'Hotel', 'Quarter-finals')),
     'matches', jsonb_build_array(
       t092.match('Quarter-finals', 'Alpha', true, 'Delta'),                  -- beat an opponent with no Seduh ID: counts, not named
       t092.match('Quarter-finals', 'Alpha', true, 'Charlie'),                -- opponent hides their knockout record: counts, not named
       t092.match('Quarter-finals', 'Alpha', true, 'Golf'),                   -- opponent's account is closed: counts, not named
       t092.match('Quarter-finals', 'Alpha', true, 'Hotel'),                  -- two roster entries share the name: counts, not named
       jsonb_build_object('round', 'Quarter-finals', 'sides', jsonb_build_array(t092.side('Alpha', true),
         jsonb_build_object('name', 'T092 Alpha', 'cafe', 'Cafe Alpha Two', 'winner', false))),                   -- both sides are Alpha's entries: counts for nothing
       t092.match('Semi-finals', 'Alpha', true, 'Bravo'),                     -- named
       t092.match('Semi-finals', 'Foxtrot', true, 'Echo'),                    -- not Alpha's
       t092.match('Final', 'Alpha', false, 'Echo'),                           -- Alpha lost; Echo hides their identity: not named
       t092.match('3rd place', 'Bravo', true, 'Foxtrot'),
       -- malformed elements, all ignored
       jsonb_build_object('round', 'Final', 'sides', jsonb_build_array(t092.side('Alpha', true), t092.side('Bravo', true))),      -- two winners
       jsonb_build_object('round', 'Final', 'sides', jsonb_build_array(t092.side('Alpha', false), t092.side('Bravo', false))),    -- no winner
       jsonb_build_object('round', 'Final', 'sides', jsonb_build_array(t092.side('Alpha', true))),                                -- one side
       jsonb_build_object('round', 'Final', 'sides', jsonb_build_array(t092.side('Alpha', true), t092.side('Bravo', false), t092.side('Echo', false))), -- three sides
       jsonb_build_object('round', 'Final', 'sides', jsonb_build_array(t092.side('Alpha', true), t092.side('Alpha', false))),     -- the same side twice
       jsonb_build_object('round', 'Final', 'sides', jsonb_build_array(jsonb_build_object('name', 'T092 Alpha', 'winner', 'yes'), t092.side('Bravo', false))), -- winner not a boolean
       to_jsonb('not a match'::text), jsonb_build_object('round', 'Final')))),
  (t092.u(602), t092.u(901), t092.u(302), jsonb_build_object('format', 'throwdown', 'eventName', 'T092 Night Two',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T092 Alpha', 'cafe', 'Cafe Alpha'),
                                 jsonb_build_object('rank', 2, 'name', 'T092 India', 'cafe', 'Cafe India')))),
  (t092.u(603), t092.u(901), t092.u(303), jsonb_build_object('format', 'throwdown', 'eventName', 'T092 Test Night',
     'standings', jsonb_build_array(t092.stand(1, 'Alpha', 'Final'), t092.stand(2, 'India', 'Final')),
     'matches', jsonb_build_array(t092.match('Final', 'Alpha', true, 'India')))),
  (t092.u(605), t092.u(901), t092.u(305), jsonb_build_object('format', 'cup_taster', 'eventName', 'T092 Cup',
     'standings', jsonb_build_array(jsonb_build_object('place', 1, 'name', 'T092 Alpha', 'cafe', 'Cafe Alpha', 'round', 'Final',
                                                       'correct', 6, 'total', 6, 'timeSecs', 90),
                                    t092.stand(2, 'India', 'Final')),
     'matches', jsonb_build_array(t092.match('Final', 'Alpha', true, 'India'))));
update events set is_test = true where id = t092.u(303);

create temp table t092_payload as select event_id, md5(payload::text) as h from public.public_results;

-- ============ ACL and catalog ============

select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where has_function_privilege(r, 'app.seduh_knockout_record(uuid, uuid)', 'execute')),
  'none', 'app.seduh_knockout_record is executable by no API role');
select is((select count(*)::int from pg_proc p where p.oid = 'app.seduh_knockout_record(uuid, uuid)'::regprocedure
            and p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']), 1,
  '...SECURITY DEFINER, STABLE, search_path pinned to the empty string');
select is((select count(*)::int from pg_proc p where p.oid = 'public.public_seduh_profile(text)'::regprocedure
            and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 1,
  'the profile door is unchanged: anon and authenticated, SECURITY DEFINER, empty search_path');
select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.seduh_recorded_rows(uuid, uuid)', 'execute')
               or has_function_privilege(r, 'app.seduh_published_matches(uuid, uuid)', 'execute')),
  'none', 'the redefined helpers stay executable by no API role');

-- ============ recorded results ============

select is(t092.recorded('alpha-t92'),
  'T092 Cup|1|Final|cup_taster|6, T092 Night One|1|Final|throwdown|-, T092 Night Two|1|-|throwdown|-',
  'Alpha: the Cup Taster result as before, and the Throwdown results (standings with its round, podium-only with none), no score; the test and unpublished nights are absent');
select is(t092.recorded('bravo-t92'), 'T092 Night One|3|Semi-finals|throwdown|-', 'Bravo: a shared 3rd place shows as 3rd with the round');
select is(t092.recorded('foxtrot-t92'), 'T092 Night One|3|Semi-finals|throwdown|-', '...and so does the other semi-final loser');
select is((select count(*)::int from app.seduh_recorded_rows(t092.u(101), t092.u(1)) where event_id in (t092.u(303), t092.u(304))), 0,
  'a test Throwdown and an unpublished Throwdown are never a recorded result');
select is((select count(*)::int from jsonb_array_elements(t092.profile('alpha-t92') -> 'recorded_results') e where e ? 'result_key'), 0, 'no public recorded result carries a result key');
select is((select count(*)::int from app.seduh_published_matches(t092.u(303), null)), 0, 'a test Throwdown is never a published match (the discovery helper)');

-- ============ the knockout record ============

select is(t092.ko('alpha-t92'), '5/1 [T092 Bravo:1:1:0]',
  'Alpha: 5 won and 1 lost from the well-formed played matches only (a test night, a Cup Taster payload and malformed elements add nothing); only Bravo is named');
select is(t092.ko('bravo-t92'), '1/1 [T092 Alpha:1:0:1, T092 Foxtrot:1:1:0]', 'Bravo: the symmetric record, both opponents named');
select is(t092.ko('foxtrot-t92'), '1/1 [T092 Bravo:1:0:1]', 'Foxtrot: Echo hides their identity, so only Bravo is named');
select is(t092.ko('echo-t92'), '1/1 [T092 Alpha:1:1:0, T092 Foxtrot:1:0:1]',
  'Echo hides their name but not their record: the record shows, and names the opponents who are public');
select is(t092.ko('charlie-t92'), '0/0 []', 'Charlie hides vis_knockout_record: the same zeros as a person with no matches');
select is(t092.ko('india-t92'), '0/0 []', 'India was only in a podium-only night, a test night and a Cup Taster payload: no record');
select is(t092.recorded('india-t92'), 'T092 Cup|2|Final|cup_taster|-, T092 Night Two|2|-|throwdown|-',
  '...while the recorded results show (the test night does not)');
select is(t092.ko('nobody-t92'), '0/0 []', 'an unknown handle gets the empty shape');
select is((t092.profile('nobody-t92') ->> 'has_profile'), 'false', '...with has_profile false');
select is(t092.ko('golf-t92'), '0/0 []', 'a closed account has no page, so no record');

-- the setting
update app.seduh_profile_settings set vis_knockout_record = 'hidden' where account_id = t092.u(101);
select is(t092.ko('alpha-t92'), '0/0 []', 'Alpha hides her knockout record: zeros');
select is(t092.ko('bravo-t92'), '1/1 [T092 Foxtrot:1:1:0]', '...and Bravo no longer names her (she is not public for vis_knockout_record), the match still counts');
select is(t092.recorded('alpha-t92') <> '', true, '...her recorded results are a separate setting and still show');
update app.seduh_profile_settings set vis_knockout_record = 'public' where account_id = t092.u(101);
update app.seduh_profile_settings set vis_identity = 'hidden' where account_id = t092.u(101);
select is(t092.ko('bravo-t92'), '1/1 [T092 Foxtrot:1:1:0]', 'with her identity hidden Bravo does not name her either');
update app.seduh_profile_settings set vis_identity = 'public' where account_id = t092.u(101);

-- "This isn't mine"
insert into app.seduh_result_disputes (account_id, event_id, result_key)
  values (t092.u(106), t092.u(301), app.seduh_result_key(t092.u(301), 'T092 Foxtrot', 'Cafe Foxtrot'));
select is(t092.recorded('foxtrot-t92'), '', 'Foxtrot disputes the Night One result: it leaves their profile');
select is(t092.ko('foxtrot-t92'), '0/0 []', '...and their matches for that night go with it');
select is(t092.ko('bravo-t92'), '1/1 [T092 Alpha:1:0:1]', '...and Bravo no longer names Foxtrot (the matches still count)');
select is(t092.ko('alpha-t92'), '5/1 [T092 Bravo:1:1:0]', 'nobody else is affected');
select is((select count(*)::int from app.seduh_published_matches(t092.u(301), t092.u(6))), 0, 'the discovery helper hides the disputed Throwdown row too');
select is((select count(*)::int from app.seduh_published_matches(t092.u(301), t092.u(1))), 1, '...and shows an undisputed one');
delete from app.seduh_result_disputes;
insert into app.seduh_result_disputes (account_id, event_id, result_key)
  values (t092.u(101), t092.u(301), app.seduh_result_key(t092.u(301), 'T092 Alpha', 'Cafe Alpha'));
select is(t092.ko('alpha-t92'), '0/0 []', 'Alpha disputes Night One: her record for it is gone');
select is(t092.recorded('alpha-t92'), 'T092 Cup|1|Final|cup_taster|6, T092 Night Two|1|-|throwdown|-', '...and so is the result, the others stay');
select is(t092.ko('bravo-t92'), '1/1 [T092 Foxtrot:1:1:0]', '...and Bravo no longer names her');
delete from app.seduh_result_disputes;
select is(t092.ko('alpha-t92'), '5/1 [T092 Bravo:1:1:0]', 'withdrawn (row removed): the record is back');

-- an opponent whose identity stops being active is not named
update app.seduh_identities set status = 'opted_out', display_name = null where id = t092.u(2);
select is(t092.ko('alpha-t92'), '5/1 []', 'a non-active identity is never named (the match still counts)');
update app.seduh_identities set status = 'active', display_name = 'T092 Bravo' where id = t092.u(2);

-- ============ nothing internal, nothing changed ============

select is((t092.profile('alpha-t92')::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'), false, 'no uuid anywhere in the door''s output');
select is((t092.profile('alpha-t92')::text ~ '(\+673|@t092|u1@)'), false, 'no phone or email either');
select is((select array_agg(k order by k) from jsonb_object_keys(t092.profile('alpha-t92') -> 'knockout_record') k), array['lost', 'opponents', 'won'], 'the knockout shape is unchanged');
select is((select array_agg(k order by k) from jsonb_object_keys(t092.profile('alpha-t92') -> 'knockout_record' -> 'opponents' -> 0) k),
  array['display_name', 'lost', 'matches', 'won'], 'an opponent is a name and counts, nothing else');
select is((select count(*)::int from public.public_results r join t092_payload t on t.event_id = r.event_id and t.h = md5(r.payload::text)), (select count(*)::int from t092_payload),
  'the published payloads are byte-identical');
select is(t092.run_internal(), '42501', 'anon cannot call the knockout function');

select * from finish();
rollback;
