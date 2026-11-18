-- T-ID2.C6a/C6b: courses and certificates (migration 20261126100000_seduh_courses.sql). Fictional data only.
-- Proves:
--   * ACL: the four course doors are executable by `authenticated` only; every helper by no API role; the table is reachable by no
--     API role (RLS on, no policy); the confirmation columns cannot be forged by a signed-in person.
--   * WHO MAY WRITE: only the caller's OWN open account. Anon, a login with no account, an organiser with no account, a CLOSED account
--     and a MERGED identity are all refused with the one 42501 `no_account`; another person's course is `not_found` (the same answer as
--     a missing id) and is left unchanged.
--   * WHAT IS SHOWN: the public door returns courses only while vis_courses = 'public' (hidden = an empty list, and no `on_card`), never
--     for an unclaimed handle or a closed account, never with an id; the person's own door shows ALL of theirs whatever the setting.
--   * COURSES ARE NOT ENTRIES: adding courses changes neither counts.entries, nor by_kind, nor the public `self_reported` list.
--   * TEXT AND LIMITS: every field's own hint; trimmed; control, zero-width and direction-override characters refused; the cap of 60;
--     year bounds; an end year before the completed year refused.
--   * THE CARD (C6b): at most one `on_card` course (partial unique index and the door); only a CURRENT one can be chosen; an update that
--     expires it clears the choice; an expired one is never reported on the card by the public door; hiding courses hides the choice.
--   * the migration's rollback block (the drops; the function restoration it lists first is not re-run here).
begin;
select plan(107);

create schema t089;
grant usage on schema t089 to anon, authenticated, service_role;

create function t089.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad((89000 + n)::text, 12, '0'))::uuid
$$;
create function t089.attempt(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || case when v_hint ~ '^[a-z_]+$' then v_hint else '' end;
end $$;
create function t089.run(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || case when v_hint ~ '^[a-z_]+$' then v_hint else '' end;
end $$;
create function t089.as_run(n int, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t089.u(n)::text, true); set local role authenticated; end if;
  r := t089.run(stmt);
  reset role;
  return r;
end $$;
create function t089.as_attempt(n int, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t089.u(n)::text, true); set local role authenticated; end if;
  r := t089.attempt(stmt);
  reset role;
  return r;
end $$;
create function t089.j(n int, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', t089.u(n)::text, true);
  set local role authenticated;
  execute q into r;
  reset role;
  return r;
end $$;
-- the public door, as anon
create function t089.pub(h text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role anon;
  select public.public_seduh_profile(h) into r;
  reset role;
  return r;
end $$;
grant execute on all functions in schema t089 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- users 1..7 plus 8 (no account, no org); 4 is an organiser. Identities 1, 2, 3, 6, 7, 9 (9 = a merge target).
insert into auth.users (id, email) select t089.u(n), 'u' || n || '@t089.seduh-next' from generate_series(1, 8) n;
insert into orgs (id, name, slug) values (t089.u(901), 'T089 Org', 't089-org');
insert into org_members (org_id, user_id, role) values (t089.u(901), t089.u(4), 'owner');
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t089.u(n), '+67389000' || lpad(n::text, 2, '0'), 'T089 Person ' || n, 'organiser_roster', 'BN' from unnest(array[1, 2, 3, 6, 7, 9]) n;
update app.seduh_identities set status = 'merged', merged_into = t089.u(9) where id = t089.u(6);
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t089.u(100 + n), t089.u(n), t089.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t89'), (2, 'bravo-t89'), (3, 'charlie-t89'), (6, 'foxtrot-t89'), (7, 'golf-t89')) v(n, h);
update app.seduh_accounts set closed_at = now() where id = t089.u(103);
-- identity 7: has an account but we use it for the cap test; identity 9 and others without account are never reachable

-- ============ ACL and catalog ============

select is((select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('seduh_add_course', 'seduh_update_course', 'seduh_delete_course', 'seduh_set_card_course')
              and not has_function_privilege('authenticated', p.oid, 'execute')),
  'none', 'all four course doors are executable by authenticated');
select is((select coalesce(string_agg(p.proname || '/' || r, ', ' order by p.proname), 'none')
             from pg_proc p, unnest(array['anon', 'service_role', 'public']) r
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('seduh_add_course', 'seduh_update_course', 'seduh_delete_course', 'seduh_set_card_course')
              and has_function_privilege(r, p.oid, 'execute')),
  'none', '...and by neither anon, service_role nor PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('seduh_add_course', 'seduh_update_course', 'seduh_delete_course', 'seduh_set_card_course')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 4,
  'every one is SECURITY DEFINER with search_path pinned to the empty string');
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('seduh_course_current', 'seduh_course_json', 'seduh_course_clean')
              and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the helpers in app are executable by no API role');
select is((select coalesce(string_agg(r, ', '), 'none')
             from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, 'app.seduh_courses', 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'the table is reachable by no API role');
select is((select relrowsecurity from pg_class where oid = 'app.seduh_courses'::regclass), true, 'row-level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'seduh_courses'), 0, '(no policy)');
select is(t089.as_attempt(1, $$ select count(*) from app.seduh_courses $$), '42501/', 'a signed-in person cannot read the table directly');
select is(t089.as_attempt(1, $$ insert into app.seduh_courses (account_id, title, provider, completed_year, status, confirmed_by, confirmed_at)
                               values (gen_random_uuid(), 'x', 'y', 2024, 'confirmed', 'z', now()) $$),
  '42501/', '...nor forge a confirmed course');
select is((select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
            where table_schema = 'app' and table_name = 'seduh_courses'),
  'id, account_id, title, provider, completed_year, valid_until_year, level, note, status, confirmed_by, confirmed_at, on_card, created_at, updated_at',
  'the table has no count column and no certificate number, image or link');

-- ============ who may write ============

select is(t089.as_attempt(0, $$ select public.seduh_add_course('x', 'y', 2024) $$), '42501/', 'anon cannot add a course (no execute grant)');
create temp table t089_doors (n serial, q text);
insert into t089_doors (q) values
  ($$select public.seduh_add_course('Probe', 'Probe', 2024)$$),
  ($$select public.seduh_update_course(1, 'Probe', 'Probe', 2024)$$),
  ($$select public.seduh_delete_course(1)$$),
  ($$select public.seduh_set_card_course(1)$$),
  ($$select public.seduh_set_card_course(null)$$);
grant select on t089_doors to authenticated;
select is((select count(distinct t089.as_attempt(8, q))::int from t089_doors), 1, 'a login with no account: every course door gives the SAME answer...');
select is((select min(t089.as_attempt(8, q)) from t089_doors), '42501/no_account', '...42501 with the hint no_account');
select is((select min(t089.as_attempt(4, q)) from t089_doors), '42501/no_account', 'an ORGANISER (org member) with no account is refused on every door');
select is((select max(t089.as_attempt(4, q)) from t089_doors), '42501/no_account', '...identically');
select is((select min(t089.as_attempt(3, q)) from t089_doors), '42501/no_account', 'a CLOSED account is refused on every door');
select is((select max(t089.as_attempt(3, q)) from t089_doors), '42501/no_account', '...identically');
select is((select min(t089.as_attempt(6, q)) from t089_doors), '42501/no_account', 'an account on a MERGED identity is refused on every door');
select is((select count(*)::int from app.seduh_courses), 0, 'none of the refused calls wrote a row');

-- ============ add ============

select is(t089.j(1, $$ select public.seduh_my_record() $$) -> 'courses', '[]'::jsonb, 'a new account has no courses');
select is(t089.j(1, $$ select public.seduh_my_record() $$) #> '{counts,courses}', '0'::jsonb, '...and a zero course count');
select is(t089.j(1, $$ select public.seduh_my_record() $$) #> '{settings,vis_courses}', '"public"'::jsonb, 'courses are public by default (D2)');
select is(t089.j(1, $$ select public.seduh_my_record() $$) #> '{limits,courses}', '60'::jsonb, 'the limit is reported as 60');

create temp table t089_c1 as select t089.j(1, $$ select public.seduh_add_course('  Barista Skills  ', ' Test Academy ', 2024, 2027, ' Intermediate ', ' a note ') $$) as j;
grant select on t089_c1 to authenticated;
select is((select j - 'id' from t089_c1),
  '{"title": "Barista Skills", "provider": "Test Academy", "completed_year": 2024, "valid_until_year": 2027, "level": "Intermediate", "note": "a note", "current": true, "on_card": false, "status": "self_reported", "confirmed_by": null, "provenance": "self_reported"}'::jsonb,
  'adding returns the course trimmed, self_reported, current, not on the card');
select is(t089.j(1, $$ select public.seduh_add_course('Roasting 101', 'Roast Co', 2020) $$) - 'id',
  '{"title": "Roasting 101", "provider": "Roast Co", "completed_year": 2020, "valid_until_year": null, "level": null, "note": null, "current": true, "on_card": false, "status": "self_reported", "confirmed_by": null, "provenance": "self_reported"}'::jsonb,
  'the optional fields may be left out; no end year means current');
select is(t089.j(1, $$ select public.seduh_add_course('Q Grader', 'Q Inst', 2018, 2021, '  ', '') $$) - 'id' - 'title' - 'provider',
  '{"completed_year": 2018, "valid_until_year": 2021, "level": null, "note": null, "current": false, "on_card": false, "status": "self_reported", "confirmed_by": null, "provenance": "self_reported"}'::jsonb,
  'blank optional text becomes null; a past end year is not current');
select is((select count(*)::int from app.seduh_courses where account_id = t089.u(101)), 3, 'three rows exist for the person');

select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', 1979) $$), 'P0001/bad_year', 'a year before 1980 is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', (extract(year from now() + interval '14 hours'))::int + 1) $$), 'P0001/bad_year', 'a year after the current one (anywhere on Earth) is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', (extract(year from now() + interval '14 hours'))::int) $$), 'ok', '...the current year is fine');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', null) $$), 'P0001/bad_year', 'a null year is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', 2024, 2023) $$), 'P0001/bad_valid_until', 'an end year before the completed year is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', 2024, 2101) $$), 'P0001/bad_valid_until', 'an end year after 2100 is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', 2024, 2024) $$), 'ok', '...an end year equal to the completed year is fine');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('  ', 'y', 2024) $$), 'P0001/bad_title', 'a blank title is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course(repeat('x', 121), 'y', 2024) $$), 'P0001/bad_title', 'a 121-character title is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course(repeat('x', 120), 'y', 2024) $$), 'ok', '...120 is fine');
select is(t089.as_attempt(1, $$ select public.seduh_add_course(null, 'y', 2024) $$), 'P0001/bad_title', 'a null title is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', '  ', 2024) $$), 'P0001/bad_provider', 'a blank provider is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', repeat('y', 81), 2024) $$), 'P0001/bad_provider', 'an 81-character provider is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', 2024, null, repeat('l', 41)) $$), 'P0001/bad_level', 'a 41-character level is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'y', 2024, null, null, repeat('n', 301)) $$), 'P0001/bad_note', 'a 301-character note is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course(E'two\nlines', 'y', 2024) $$), 'P0001/bad_title', 'a control character (a newline) is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('rev' || U&'\202Eersed', 'y', 2024) $$), 'P0001/bad_title', 'a direction-override character is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('x', 'zero' || U&'\200Bwidth', 2024) $$), 'P0001/bad_provider', 'a zero-width character is refused');

-- the cap: person 7 gets exactly 60
select is((select count(*)::int from (select t089.j(7, format($$ select public.seduh_add_course('Course %s', 'P', 2020) $$, g)) from generate_series(1, 60) g) s), 60, 'sixty courses can be added');
select is(t089.as_attempt(7, $$ select public.seduh_add_course('One too many', 'P', 2020) $$), 'P0001/too_many_courses', 'the 61st is refused');
select is(t089.as_attempt(1, $$ select public.seduh_add_course('Fine', 'P', 2020) $$), 'ok', '...and the cap is per person (another person is unaffected)');

-- ============ update, delete, ownership ============

create temp table t089_c2 as select t089.j(2, $$ select public.seduh_add_course('Bravo Course', 'B Co', 2022, 2030, 'Pro', 'bravo note') $$) as j;
grant select on t089_c2 to authenticated;
select is(t089.as_attempt(1, format($$ select public.seduh_update_course(%s, 'Hijack', 'Hijack', 2024) $$, (select (j ->> 'id') from t089_c2))), 'P0001/not_found', 'updating ANOTHER person''s course is not_found');
select is(t089.as_attempt(1, format($$ select public.seduh_update_course(-5, 'Hijack', 'Hijack', 2024) $$)), 'P0001/not_found', '...exactly like a missing id');
select is(t089.as_attempt(1, format($$ select public.seduh_delete_course(%s) $$, (select (j ->> 'id') from t089_c2))), 'P0001/not_found', 'deleting ANOTHER person''s course is not_found');
select is(t089.as_attempt(1, format($$ select public.seduh_set_card_course(%s) $$, (select (j ->> 'id') from t089_c2))), 'P0001/not_found', 'putting ANOTHER person''s course on my card is not_found');
select is((select title || '/' || provider || '/' || on_card::text from app.seduh_courses where id = (select (j ->> 'id')::bigint from t089_c2)), 'Bravo Course/B Co/false', 'and their course is unchanged');

select is(t089.j(1, format($$ select public.seduh_update_course(%s, 'Barista Skills 2', 'New Provider', 2023) $$, (select (j ->> 'id') from t089_c1))) - 'id',
  '{"title": "Barista Skills 2", "provider": "New Provider", "completed_year": 2023, "valid_until_year": null, "level": null, "note": null, "current": true, "on_card": false, "status": "self_reported", "confirmed_by": null, "provenance": "self_reported"}'::jsonb,
  'an update is a FULL replace (an omitted optional field becomes null)');
select is(t089.as_attempt(1, format($$ select public.seduh_update_course(%s, '', 'P', 2023) $$, (select (j ->> 'id') from t089_c1))), 'P0001/bad_title', 'an update is validated like an add');
select is(t089.as_attempt(1, format($$ select public.seduh_delete_course(%s) $$, (select (j ->> 'id') from t089_c1))), 'ok', 'a person can delete their own course (rolled back here)');
select is(t089.as_run(1, format($$ select public.seduh_delete_course(%s) $$, (select (j ->> 'id') from t089_c1))), 'ok', '...and it is gone');
select is(t089.as_attempt(1, format($$ select public.seduh_delete_course(%s) $$, (select (j ->> 'id') from t089_c1))), 'P0001/not_found', '...a second delete is not_found');
select throws_ok($$ update app.seduh_courses set account_id = gen_random_uuid() where account_id = '00000000-0000-0000-0000-000000089102' $$, '23001', null, 'the parent account of a course cannot change');

-- ============ what the public sees ============

-- person 1 now has: Roasting 101 (2020, current) and Q Grader (2018-2021, expired)
select is(jsonb_typeof(t089.pub('alpha-t89') -> 'courses'), 'array', 'the public door has a courses list');
select cmp_ok(jsonb_array_length(t089.pub('alpha-t89') -> 'courses'), '>=', 2, 'a public person''s courses are shown');
select is((select count(*)::int from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c ? 'id'), 0, 'no course has an id in the public door');
select is((select count(*)::int from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c -> 'provenance' <> '"self_reported"'::jsonb), 0, 'every one is labelled self_reported');
select is((select (c ->> 'current')::boolean from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c ->> 'title' = 'Q Grader'), false, 'an expired certificate says current: false');
select is((select (c ->> 'current')::boolean from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c ->> 'title' = 'Roasting 101'), true, '...a certificate with no end year is current');
select is((select array_agg((c ->> 'completed_year')::int) from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c),
           (select array_agg(y order by y desc) from (select (c ->> 'completed_year')::int y from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c) s),
  'courses are newest first');

-- courses are not entries
create temp table t089_before as select t089.j(1, $$ select public.seduh_my_record() $$) as rec;
select is((select rec #> '{counts,entries}' from t089_before), '0'::jsonb, 'courses do not count as entries (counts.entries is 0 with courses present)');
select is((select rec #> '{counts,by_kind}' from t089_before), '{"judged": 0, "coached": 0, "competed": 0, "organised": 0, "volunteered": 0}'::jsonb, '...nor in any kind');
select is(t089.pub('alpha-t89') -> 'self_reported', '[]'::jsonb, '...and never appear in the public self_reported list');
select is(jsonb_array_length(t089.pub('alpha-t89') -> 'recorded_results'), 0, '...nor in recorded results');
select is((select rec #> '{counts,courses}' from t089_before)::int, (select count(*)::int from app.seduh_courses where account_id = t089.u(101)), 'courses have their own count');

-- unclaimed, closed, unknown
select is(t089.pub('nobody-t89') -> 'courses', '[]'::jsonb, 'an unknown handle has an empty courses list');
select is((t089.pub('nobody-t89') ->> 'has_profile')::boolean, false, '...and no profile');
insert into app.seduh_courses (account_id, title, provider, completed_year) values (t089.u(103), 'Closed Person Course', 'P', 2020);
select is((t089.pub('charlie-t89') ->> 'has_profile')::boolean, false, 'a CLOSED account has no public profile...');
select is(t089.pub('charlie-t89') -> 'courses', '[]'::jsonb, '...and its courses are never returned');
select is((select count(*)::int from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c ->> 'title' = 'Closed Person Course'), 0, 'one person''s courses never leak onto another''s page');

-- the hide switch
select is(t089.j(1, $$ select public.seduh_set_my_settings('{"vis_courses": "hidden"}'::jsonb) $$) ->> 'vis_courses', 'hidden', 'the person can hide their courses (the door returns the new setting)');
select is(t089.pub('alpha-t89') -> 'courses', '[]'::jsonb, 'with vis_courses hidden the public door returns NO courses');
select is(jsonb_array_length(t089.j(1, $$ select public.seduh_my_record() $$) -> 'courses') > 0, true, '...but the person still sees all of theirs');
select is((select (t089.j(1, $$ select public.seduh_my_record() $$) #>> '{settings,vis_courses}')), 'hidden', '...and the setting is reported');
select is(t089.as_attempt(1, $$ select public.seduh_set_my_settings('{"vis_courses": "organisers"}'::jsonb) $$), 'P0001/bad_setting', 'courses take only public or hidden (organisers is refused)');
select is(t089.as_attempt(1, $$ select public.seduh_set_my_settings('{"vis_courses": true}'::jsonb) $$), 'P0001/bad_setting', '...and not a boolean');
select is(t089.j(1, $$ select public.seduh_set_my_settings('{"vis_courses": "public"}'::jsonb) $$) ->> 'vis_courses', 'public', 'and back to public');
select is(t089.j(1, $$ select public.seduh_set_my_settings('{"listed_in_search": false}'::jsonb) $$) ->> 'vis_courses', 'public', 'an earlier setting still works and the shape keeps every key');
select is((select count(*)::int from jsonb_object_keys(t089.j(1, $$ select public.seduh_set_my_settings('{"listed_in_search": true}'::jsonb) $$))), 10, 'the settings answer has all ten keys');

-- ============ the card certificate (C6b) ============

create temp table t089_cur as select t089.j(1, $$ select public.seduh_add_course('Current Cert', 'Cert Body', 2023, 2099) $$) as j;
create temp table t089_cur2 as select t089.j(1, $$ select public.seduh_add_course('Second Cert', 'Cert Body', 2022) $$) as j;
create temp table t089_exp as select (select id from app.seduh_courses where account_id = t089.u(101) and title = 'Q Grader') as id;
grant select on t089_cur, t089_cur2, t089_exp to authenticated;
select is(t089.as_attempt(1, format($$ select public.seduh_set_card_course(%s) $$, (select id from t089_exp))), 'P0001/not_current', 'an EXPIRED certificate cannot be chosen for the card');
select is(t089.as_run(1, format($$ select public.seduh_set_card_course(%s) $$, (select (j ->> 'id') from t089_cur))), 'ok', 'a current one can');
select is((select (c ->> 'on_card')::boolean from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c ->> 'title' = 'Current Cert'), true, 'the public door reports it as on_card');
select is((select count(*)::int from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where (c ->> 'on_card')::boolean), 1, '...and only one');
select is(t089.as_run(1, format($$ select public.seduh_set_card_course(%s) $$, (select (j ->> 'id') from t089_cur2))), 'ok', 'choosing another one...');
select is((select count(*)::int from app.seduh_courses where account_id = t089.u(101) and on_card), 1, '...moves the choice: still exactly one on_card row');
select is((select title from app.seduh_courses where account_id = t089.u(101) and on_card), 'Second Cert', '...the new one');
select throws_ok(format($$ update app.seduh_courses set on_card = true where id = %s $$, (select (j ->> 'id') from t089_cur)), '23505', null, 'the database itself allows at most one on_card course per account');
select is(t089.as_run(1, $$ select public.seduh_set_card_course(null) $$), 'ok', 'null clears the choice');
select is((select count(*)::int from app.seduh_courses where account_id = t089.u(101) and on_card), 0, '...nothing is on the card');
select is(t089.as_run(1, format($$ select public.seduh_set_card_course(%s) $$, (select (j ->> 'id') from t089_cur))), 'ok', 'choose again');
select is((select (t089.j(1, $$ select public.seduh_my_record() $$) -> 'courses') @> jsonb_build_array(jsonb_build_object('title', 'Current Cert', 'on_card', true))), true, 'the person''s own door shows which one is on the card');
-- expiring it through an update clears the choice
select is((select (t089.j(1, format($$ select public.seduh_update_course(%s, 'Current Cert', 'Cert Body', 2023, 2024) $$, (select (j ->> 'id') from t089_cur))) ->> 'on_card')::boolean), false, 'an update that expires the card certificate clears the choice');
select is((select count(*)::int from app.seduh_courses where account_id = t089.u(101) and on_card), 0, '...in the table too');
-- expiring it behind the door's back (owner SQL) still never reaches the card
update app.seduh_courses set on_card = true, valid_until_year = 2024 where id = (select (j ->> 'id')::bigint from t089_cur);
select is((select (c ->> 'on_card')::boolean from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c where c ->> 'title' = 'Current Cert'), false, 'a stale on_card on an expired course is never reported on the card');
update app.seduh_courses set on_card = false where account_id = t089.u(101);
-- hidden courses hide the choice
select is(t089.as_run(1, format($$ select public.seduh_set_card_course(%s) $$, (select (j ->> 'id') from t089_cur2))), 'ok', 'choose a certificate, then hide courses');
select is(t089.j(1, $$ select public.seduh_set_my_settings('{"vis_courses": "hidden"}'::jsonb) $$) ->> 'vis_courses', 'hidden', '...hidden');
select is((select count(*)::int from jsonb_array_elements(t089.pub('alpha-t89') -> 'courses') c), 0, 'no course, so no on_card, reaches an anonymous caller');
select is(t089.j(1, $$ select public.seduh_set_my_settings('{"vis_courses": "public"}'::jsonb) $$) ->> 'vis_courses', 'public', 'back to public');

-- ============ the migration's rollback block (the drops; the function restoration it lists first is a manual step) ============

savepoint rollback_block;
drop function if exists public.seduh_set_card_course(bigint);
drop function if exists public.seduh_delete_course(bigint);
drop function if exists public.seduh_update_course(bigint, text, text, integer, integer, text, text);
drop function if exists public.seduh_add_course(text, text, integer, integer, text, text);
drop function if exists app.seduh_course_clean(text, text, integer, integer, text, text);
drop function if exists app.seduh_course_json(app.seduh_courses);
drop function if exists app.seduh_course_current(smallint);
drop table if exists app.seduh_courses;
alter table app.seduh_profile_settings drop column if exists vis_courses;
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.proname ~ '^seduh_(add_|update_|delete_|set_card_)?course'), 0, 'the rollback block removes every function it added');
select is((select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname = 'seduh_courses'), 0, '...and the table');
select is((select count(*)::int from information_schema.columns where table_schema = 'app' and table_name = 'seduh_profile_settings' and column_name = 'vis_courses'), 0, '...and the setting column');
rollback to savepoint rollback_block;

select * from finish();
rollback;
