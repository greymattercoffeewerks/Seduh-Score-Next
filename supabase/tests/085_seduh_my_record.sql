-- T-ID2.D-a: a claimed person's OWN record (migration 20261122100000_seduh_my_record.sql). Fictional data only.
-- Proves:
--   * ACL: the eight person's doors are executable by `authenticated` only (not anon, service_role, PUBLIC); the four owner functions
--     and every helper by NO API role; the two new tables are reachable by no API role, RLS on, no policy.
--   * WHO MAY WRITE: only the caller's OWN open account. Anon, a login with no account, an organiser (org member) with no account,
--     a CLOSED account and an account on a merged identity are ALL refused with the one 42501 `no_account`, on every door; another
--     person's entry or team link is `not_found`, exactly like an id that does not exist, and is left unchanged.
--   * ENTRIES: add, update (full replace), delete; every field refused with its own hint; trimmed; the caps (200); year bounds;
--     counts are derived (no count column exists); an entry is labelled self_reported and never appears in recorded_results.
--   * TEAM LINKS: the picker lists LISTED rows only, with opaque keys (no internal uuid in the output; the uuid itself is not a
--     key); a link is self_reported on creation and a person cannot forge status; roles; the cap (40); one link per team-year;
--     removing and re-adding drops a confirmation.
--   * SETTINGS: partial update, vocabularies per key, unknown keys, non-booleans, an empty object; one person cannot touch another's.
--   * THE PROFILE DOOR: the shape for an empty record is the same as before; self_reported and organiser_records follow
--     vis_self_reported_results and vis_organiser_results ('organisers' hides, like 'hidden'); an unlisted team result disappears;
--     membership shows self_reported, then confirmed, then self_reported again; no id, phone, email or internal key appears.
--   * THE COUNTRY DOOR: a team row's `members` has a person ONLY when listed_on_country_pages is on AND identity and organiser
--     results are public AND the account is open; a person who linked the same team but did not opt in is never listed; the
--     shape of an empty country is unchanged.
--   * OWNER FUNCTIONS: confirm, unconfirm, remove; each audited (no secrets), refusals write nothing; the shape check of a
--     confirmation (the teammate seam) holds; the parents are frozen; a copy of the migration's rollback block (kept in step by hand) removes what it added.
begin;
select plan(192);

create schema t085;
grant usage on schema t085 to anon, authenticated, service_role;

create function t085.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad((85000 + n)::text, 12, '0'))::uuid
$$;
-- 'ok' (rolled back) or SQLSTATE '/' HINT
create function t085.attempt(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics v_hint = pg_exception_hint;
  -- only the door's own snake_case hints are kept (the server's "GRANT ..." advice on a permission error is not)
  return sqlstate || '/' || case when v_hint ~ '^[a-z_]+$' then v_hint else '' end;
end $$;
-- the same, but a success KEEPS its effect
create function t085.run(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || case when v_hint ~ '^[a-z_]+$' then v_hint else '' end;
end $$;
-- as a signed-in user (kept effect) / (rolled back); n = 0 means anon
create function t085.as_run(n int, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t085.u(n)::text, true); set local role authenticated; end if;
  r := t085.run(stmt);
  reset role;
  return r;
end $$;
create function t085.as_attempt(n int, stmt text) returns text language plpgsql as $$
declare r text;
begin
  if n = 0 then set local role anon; else perform set_config('request.jwt.claim.sub', t085.u(n)::text, true); set local role authenticated; end if;
  r := t085.attempt(stmt);
  reset role;
  return r;
end $$;
-- a door's jsonb as a signed-in user
create function t085.j(n int, q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', t085.u(n)::text, true);
  set local role authenticated;
  execute q into r;
  reset role;
  return r;
end $$;
grant execute on all functions in schema t085 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- users 1..7 plus 8 (no account, no org); 4 is an organiser. Identities 1,2,3,6,7 and 9 (a merge target).
insert into auth.users (id, email) select t085.u(n), 'u' || n || '@t085.seduh-next' from generate_series(1, 8) n;
insert into orgs (id, name, slug) values (t085.u(901), 'T085 Org', 't085-org');
insert into org_members (org_id, user_id, role) values (t085.u(901), t085.u(4), 'owner');
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t085.u(n), '+67385000' || lpad(n::text, 2, '0'), 'T085 Person ' || n, 'organiser_roster', 'BN' from unnest(array[1, 2, 3, 6, 7, 9]) n;
update app.seduh_identities set status = 'merged', merged_into = t085.u(9) where id = t085.u(6);
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t085.u(100 + n), t085.u(n), t085.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t85'), (2, 'bravo-t85'), (3, 'charlie-t85'), (6, 'foxtrot-t85'), (7, 'golf-t85')) v(n, h);
update app.seduh_accounts set closed_at = now() where id = t085.u(103);

-- teams: R1 and R2 are the same team in two years (QX), R3 is UNLISTED, R4 is another country
insert into app.historical_results (id, competition, competition_name, edition_year, team_name, country_code, stage_reached, source_ref, supplied_by, supplied_on, permission_ref, listed)
values
  (t085.u(201), 'btc', 'T085 Championship', 2024, 'T085 Bandits', 'QX', 'quarter_final', 'x', 'x', '2026-11-01', 'test', true),
  (t085.u(202), 'btc', 'T085 Championship', 2023, 'T085 Bandits', 'QX', 'preliminary', 'x', 'x', '2026-11-01', 'test', true),
  (t085.u(203), 'btc', 'T085 Championship', 2024, 'T085 Ghosts', 'QX', 'entered', 'x', 'x', '2026-11-01', 'test', false),
  (t085.u(204), 'btc', 'T085 Championship', 2024, 'T085 Others', 'QY', 'semi_final', 'x', 'x', '2026-11-01', 'test', true);
-- 40 more teams for the cap test, in their own country
insert into app.historical_results (id, competition, competition_name, edition_year, team_name, country_code, stage_reached, source_ref, supplied_by, supplied_on, permission_ref)
  select t085.u(300 + n), 'btc', 'T085 Championship', 2024, 'T085 Cap ' || n, 'QZ', 'entered', 'x', 'x', '2026-11-01', 'test' from generate_series(1, 41) n;

-- ============ ACL and catalog ============

select is((select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('seduh_my_record', 'seduh_add_entry', 'seduh_update_entry', 'seduh_delete_entry', 'seduh_team_options',
                                'seduh_add_team_link', 'seduh_remove_team_link', 'seduh_set_my_settings')
              and not has_function_privilege('authenticated', p.oid, 'execute')),
  'none', 'all eight person doors are executable by authenticated');
select is((select coalesce(string_agg(p.proname || '/' || r, ', ' order by p.proname), 'none')
             from pg_proc p, unnest(array['anon', 'service_role', 'public']) r
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('seduh_my_record', 'seduh_add_entry', 'seduh_update_entry', 'seduh_delete_entry', 'seduh_team_options',
                                'seduh_add_team_link', 'seduh_remove_team_link', 'seduh_set_my_settings')
              and has_function_privilege(r, p.oid, 'execute')),
  'none', '...and by neither anon, service_role nor PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('seduh_my_record', 'seduh_add_entry', 'seduh_update_entry', 'seduh_delete_entry', 'seduh_team_options',
                              'seduh_add_team_link', 'seduh_remove_team_link', 'seduh_set_my_settings')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 8,
  'every one is SECURITY DEFINER with search_path pinned to the empty string');
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('seduh_memberships_overview', 'seduh_membership_confirm', 'seduh_membership_unconfirm', 'seduh_membership_remove',
                                'seduh_my_account', 'seduh_team_key', 'seduh_clean_text', 'seduh_text_ok', 'seduh_entry_clean', 'seduh_entry_json',
                                'seduh_link_json', 'seduh_my_record_json')
              and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the owner functions and every helper in app are executable by no API role');
select is((select coalesce(string_agg(t || '/' || r, ', '), 'none')
             from unnest(array['app.seduh_self_reported_entries', 'app.seduh_team_memberships']) t,
                  unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, t, 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'the two tables are reachable by no API role');
select is((select count(*)::int from pg_class where oid in ('app.seduh_self_reported_entries'::regclass, 'app.seduh_team_memberships'::regclass) and relrowsecurity), 2, 'row-level security is on for both');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename in ('seduh_self_reported_entries', 'seduh_team_memberships')), 0, '(no policy)');
select is(t085.as_attempt(1, $$ select count(*) from app.seduh_self_reported_entries $$), '42501/', 'a signed-in person cannot read the entries table directly');
select is(t085.as_attempt(1, $$ insert into app.seduh_team_memberships (account_id, result_id, status, confirmed_via, confirmed_at) values (gen_random_uuid(), gen_random_uuid(), 'confirmed', 'owner', now()) $$),
  '42501/', '...nor forge a confirmed membership');
select is((select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
            where table_schema = 'app' and table_name = 'seduh_self_reported_entries'),
  'id, account_id, year, competition_name, location, kind, role, result_text, placement, note, created_at, updated_at',
  'the entries table has no count or total column: counts are derived on read');

-- ============ who may write: one refusal for everyone who is not an open account ============

select is(t085.as_attempt(0, $$ select public.seduh_my_record() $$), '42501/', 'anon cannot call the record door (no execute grant)');
select is(t085.as_attempt(0, $$ select public.seduh_add_entry(2024, 'x', 'competed') $$), '42501/', 'anon cannot add an entry');

create temp table t085_doors (n serial, q text);
insert into t085_doors (q) values
  ($$select public.seduh_my_record()$$),
  ($$select public.seduh_add_entry(2024, 'Probe', 'competed')$$),
  ($$select public.seduh_update_entry(1, 2024, 'Probe', 'competed')$$),
  ($$select public.seduh_delete_entry(1)$$),
  ($$select public.seduh_team_options()$$),
  ($$select public.seduh_add_team_link('abc')$$),
  ($$select public.seduh_remove_team_link(1)$$),
  ($$select public.seduh_set_my_settings('{"listed_on_country_pages": true}'::jsonb)$$);
grant select on t085_doors to authenticated;
select is((select count(distinct t085.as_attempt(8, q))::int from t085_doors), 1, 'a login with no account: every door gives the SAME answer...');
select is((select min(t085.as_attempt(8, q)) from t085_doors), '42501/no_account', '...42501 with the hint no_account');
select is((select min(t085.as_attempt(4, q)) from t085_doors), '42501/no_account', 'an ORGANISER (org member) with no account is refused on every door');
select is((select min(t085.as_attempt(4, q)) from t085_doors), (select max(t085.as_attempt(4, q)) from t085_doors), '...identically');
select is((select min(t085.as_attempt(3, q)) from t085_doors), '42501/no_account', 'a CLOSED account is refused on every door');
select is((select max(t085.as_attempt(3, q)) from t085_doors), '42501/no_account', '...identically');
select is((select min(t085.as_attempt(6, q)) from t085_doors), '42501/no_account', 'an account on a MERGED identity is refused on every door');

-- ============ entries ============

select is(t085.j(1, $$ select public.seduh_my_record() $$) -> 'entries', '[]'::jsonb, 'a new account has no entries');
select is(t085.j(1, $$ select public.seduh_my_record() $$) -> 'counts', '{"entries": 0, "by_kind": {"judged": 0, "coached": 0, "competed": 0, "organised": 0, "volunteered": 0}, "team_links": 0, "courses": 0, "disputes": 0, "disputes_pending": 0, "recorded_results": 0}'::jsonb,
  'and zero counts, all five kinds present');

create temp table t085_e1 as select t085.j(1, $$ select public.seduh_add_entry(2024, '  Test Open 2024 ', 'competed', ' Brunei ', 'competitor', '2nd', 2, 'a note') $$) as j;
grant select on t085_e1 to authenticated;
select is((select j - 'id' from t085_e1),
  '{"year": 2024, "competition_name": "Test Open 2024", "location": "Brunei", "kind": "competed", "role": "competitor", "result_text": "2nd", "placement": 2, "note": "a note", "provenance": "self_reported"}'::jsonb,
  'adding an entry returns it trimmed, labelled self_reported');
select is(t085.j(1, $$ select public.seduh_add_entry(2023, 'Bare', 'judged') $$) - 'id',
  '{"year": 2023, "competition_name": "Bare", "location": null, "kind": "judged", "role": null, "result_text": null, "placement": null, "note": null, "provenance": "self_reported"}'::jsonb,
  'the optional fields may be left out (null)');
select is(t085.j(1, $$ select public.seduh_add_entry(2022, 'Blank', 'organised', '   ', '', '  ') $$) - 'id' - 'year' - 'competition_name' - 'kind',
  '{"location": null, "role": null, "result_text": null, "placement": null, "note": null, "provenance": "self_reported"}'::jsonb,
  'blank optional text becomes null');
select is((select count(*)::int from app.seduh_self_reported_entries where account_id = t085.u(101)), 3, 'three rows exist for the person');

select is(t085.as_attempt(1, $$ select public.seduh_add_entry(1979, 'x', 'competed') $$), 'P0001/bad_year', 'a year before 1980 is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry((extract(year from now() + interval '14 hours'))::int + 1, 'x', 'competed') $$), 'P0001/bad_year', 'a year after the current one (anywhere on Earth) is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry((extract(year from now() + interval '14 hours'))::int, 'x', 'competed') $$), 'ok', '...the current year is fine');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(null, 'x', 'competed') $$), 'P0001/bad_year', 'a null year is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'won') $$), 'P0001/bad_kind', 'a kind outside the vocabulary is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', null) $$), 'P0001/bad_kind', 'a null kind is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, '  ', 'competed') $$), 'P0001/bad_competition', 'a blank competition name is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, repeat('x', 121), 'competed') $$), 'P0001/bad_competition', 'a 121-character name is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, repeat('x', 120), 'competed') $$), 'ok', '...120 is fine');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, E'two\nlines', 'competed') $$), 'P0001/bad_competition', 'a control character (a newline) is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'rev' || U&'\202Eersed', 'competed') $$), 'P0001/bad_competition', 'a direction-override character is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'zero' || U&'\200Bwidth', 'competed') $$), 'P0001/bad_competition', 'a zero-width character is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', repeat('x', 81)) $$), 'P0001/bad_location', 'a 81-character location is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', null, repeat('x', 61)) $$), 'P0001/bad_role', 'a 61-character role is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', null, null, repeat('x', 81)) $$), 'P0001/bad_result', 'an 81-character result is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', null, null, null, 0) $$), 'P0001/bad_placement', 'placement 0 is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', null, null, null, 501) $$), 'P0001/bad_placement', 'placement 501 is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', null, null, null, null, repeat('x', 501)) $$), 'P0001/bad_note', 'a 501-character note is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_entry(2024, 'x', 'competed', null, null, null, null, repeat('x', 500)) $$), 'ok', '...500 is fine');
select is((select count(*)::int from app.seduh_self_reported_entries where account_id = t085.u(101)), 3, 'no refused call wrote anything');

-- the same person's update, another person's update, delete
select is(t085.as_attempt(2, format($$ select public.seduh_update_entry(%s, 2020, 'Hijack', 'competed') $$, (select (j ->> 'id')::bigint from t085_e1))),
  'P0001/not_found', 'ANOTHER person cannot edit an entry (not_found, as if it did not exist)');
select is(t085.as_attempt(2, format($$ select public.seduh_delete_entry(%s) $$, (select (j ->> 'id')::bigint from t085_e1))),
  'P0001/not_found', '...nor delete it');
select is((select competition_name from app.seduh_self_reported_entries where id = (select (j ->> 'id')::bigint from t085_e1)), 'Test Open 2024', 'and the entry is unchanged');
select is(t085.as_attempt(1, $$ select public.seduh_update_entry(999999999, 2020, 'x', 'competed') $$), 'P0001/not_found', 'an id that does not exist gives the same answer');
select is(t085.as_attempt(1, format($$ select public.seduh_update_entry(%s, 2020, '', 'competed') $$, (select (j ->> 'id')::bigint from t085_e1))), 'P0001/bad_competition', 'an update is validated like an add');
select is(t085.j(1, format($$ select public.seduh_update_entry(%s, 2021, 'Renamed', 'coached', null, 'assistant', null, null, null) $$, (select (j ->> 'id')::bigint from t085_e1))) - 'id',
  '{"year": 2021, "competition_name": "Renamed", "kind": "coached", "location": null, "role": "assistant", "result_text": null, "placement": null, "note": null, "provenance": "self_reported"}'::jsonb,
  'the owner of the entry replaces every field (an omitted one becomes null)');
select is(t085.as_run(1, format($$ select public.seduh_delete_entry(%s) $$, (select (j ->> 'id')::bigint from t085_e1))), 'ok', 'the owner deletes it');
select is(t085.as_attempt(1, format($$ select public.seduh_delete_entry(%s) $$, (select (j ->> 'id')::bigint from t085_e1))), 'P0001/not_found', '...and a second delete is not_found');
select is(t085.as_attempt(1, $$ update app.seduh_self_reported_entries set account_id = account_id $$), '42501/', 'direct table writes by a person are refused');
select is(t085.j(1, $$ select public.seduh_my_record() $$) #>> '{counts,entries}', '2', 'the record counts the remaining two, derived on read');
select is(t085.j(1, $$ select public.seduh_my_record() $$) #>> '{counts,by_kind,judged}', '1', '...by kind');
select is((t085.j(1, $$ select public.seduh_my_record() $$) #>> '{account,handle}') || '|' || (t085.j(1, $$ select public.seduh_my_record() $$) #>> '{account,profile_path}'),
  'alpha-t85|/id/alpha-t85/', 'the record carries the person''s handle and page path');
select is((t085.j(1, $$ select public.seduh_my_record() $$)::text ~ ('(\+673|@t085|' || t085.u(1) || '|' || t085.u(101) || ')')), false, 'the record holds no phone, email, identity id, account id or user id');

-- the cap, under the account lock
insert into app.seduh_self_reported_entries (account_id, year, competition_name, kind)
  select t085.u(107), 2020, 'Filler ' || n, 'competed' from generate_series(1, 199) n;
select is(t085.as_run(7, $$ select public.seduh_add_entry(2024, 'The 200th', 'competed') $$), 'ok', 'the 200th entry is accepted');
select is(t085.as_attempt(7, $$ select public.seduh_add_entry(2024, 'The 201st', 'competed') $$), 'P0001/too_many_entries', 'the 201st is refused');
select is((select count(*)::int from app.seduh_self_reported_entries where account_id = t085.u(107)), 200, '...and exactly 200 rows exist');

-- table-level shape (as owner), the defence behind the doors
select is(t085.attempt($$ insert into app.seduh_self_reported_entries (account_id, year, competition_name, kind) values (t085.u(101), 1979, 'x', 'competed') $$), '23514/', 'the table itself refuses a year before 1980');
select is(t085.attempt($$ insert into app.seduh_self_reported_entries (account_id, year, competition_name, kind) values (t085.u(101), 2024, 'x', 'sold') $$), '23514/', '...a kind outside the vocabulary');
select is(t085.attempt($$ insert into app.seduh_self_reported_entries (account_id, year, competition_name, kind) values (t085.u(101), 2024, ' x', 'competed') $$), '23514/', '...untrimmed text');
select is(t085.attempt($$ insert into app.seduh_self_reported_entries (account_id, year, competition_name, kind) values (gen_random_uuid(), 2024, 'x', 'competed') $$), '23503/', '...an account that does not exist');
select is(t085.attempt($$ update app.seduh_self_reported_entries set account_id = t085.u(102) where account_id = t085.u(101) $$), '23001/', '...and an entry cannot be moved to another account');

-- ============ team picker and links ============

select is(jsonb_array_length(t085.j(1, $$ select public.seduh_team_options('QX') $$) -> 'teams'), 2, 'the picker lists the two LISTED XA team-years');
select is((select string_agg(t ->> 'team_name' || ':' || (t ->> 'edition_year'), ', ' order by t ->> 'edition_year' desc) from jsonb_array_elements(t085.j(1, $$ select public.seduh_team_options('qx') $$) -> 'teams') t),
  'T085 Bandits:2024, T085 Bandits:2023', 'newest first, the unlisted team is not there (and the code is case-insensitive)');
select is((t085.j(1, $$ select public.seduh_team_options('QX') $$)::text ~ ('(' || t085.u(201) || '|' || t085.u(202) || '|' || t085.u(203) || ')')), false, 'no internal uuid appears in the picker');
select is((t085.j(1, $$ select public.seduh_team_options('QX') $$)::text ~* 'T085 Ghosts'), false, '...and the unlisted team is not named');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((t085.j(1, $$ select public.seduh_team_options('QX') $$) -> 'teams') -> 0) k),
  'competition,competition_name,country_code,edition_year,linked,placement,provenance,stage_reached,team_key,team_name', 'each option has exactly these keys');
select is(jsonb_array_length(t085.j(1, $$ select public.seduh_team_options('QY', 'btc') $$) -> 'teams'), 1, 'filter by country and competition');
select is(jsonb_array_length(t085.j(1, $$ select public.seduh_team_options('QX', 'nonesuch') $$) -> 'teams'), 0, 'an unknown competition gives an empty list');
select is(jsonb_array_length(t085.j(1, $$ select public.seduh_team_options() $$) -> 'teams'), (select least(300, count(*))::int from app.historical_results where listed), 'with no filter: every listed team-year (all of them, at most 300)');
select is(t085.as_attempt(1, $$ select public.seduh_team_options('XAA') $$), 'P0001/bad_input', 'a malformed country code is refused');
select is((t085.j(1, $$ select public.seduh_team_options('QX') $$) ->> 'truncated'), 'false', 'not truncated');

create temp table t085_k as select
  (select t ->> 'team_key' from jsonb_array_elements(t085.j(1, $$ select public.seduh_team_options('QX') $$) -> 'teams') t where t ->> 'edition_year' = '2024') as k2024,
  (select t ->> 'team_key' from jsonb_array_elements(t085.j(1, $$ select public.seduh_team_options('QX') $$) -> 'teams') t where t ->> 'edition_year' = '2023') as k2023;
grant select on t085_k to authenticated;
select is((select count(*)::int from t085_k where k2024 is not null and k2023 is not null and k2024 <> k2023 and k2024 ~ '^[0-9a-f]{32}$'), 1, 'the keys are opaque 32-hex tokens, one per team-year');
select is((select k2024 from t085_k), (t085.j(2, $$ select public.seduh_team_options('QX') $$) -> 'teams' -> 0 ->> 'team_key'), 'a key is stable and the same for every person');

select is(t085.as_attempt(1, $$ select public.seduh_add_team_link('not-a-key') $$), 'P0001/team_not_found', 'a made-up key is refused');
select is(t085.as_attempt(1, format($$ select public.seduh_add_team_link(%L) $$, t085.u(201)::text)), 'P0001/team_not_found', 'the internal uuid is NOT a key');
select is(t085.as_attempt(1, format($$ select public.seduh_add_team_link(%L) $$, app.seduh_team_key(t085.u(203)))), 'P0001/team_not_found', 'the key of an UNLISTED team is refused like an unknown one');
select is(t085.as_attempt(1, format($$ select public.seduh_add_team_link(%L, 'goalkeeper') $$, (select k2024 from t085_k))), 'P0001/bad_role', 'a role outside the vocabulary is refused');
select is(t085.as_attempt(1, $$ select public.seduh_add_team_link(null) $$), 'P0001/team_not_found', 'a null key is refused');

create temp table t085_l1 as select t085.j(1, format($$ select public.seduh_add_team_link(%L) $$, (select k2024 from t085_k))) as j;
grant select on t085_l1 to authenticated;
select is((select j - 'id' from t085_l1),
  ('{"team_key": "' || (select k2024 from t085_k) || '", "team_name": "T085 Bandits", "country_code": "QX", "competition": "btc", "competition_name": "T085 Championship", "edition_year": 2024, "stage_reached": "quarter_final", "placement": null, "listed": true, "role": "member", "membership": "self_reported", "team_provenance": "organiser_archive"}')::jsonb,
  'a new link is a member, self_reported, with the team labelled organiser_archive');
select is(t085.as_attempt(1, format($$ select public.seduh_add_team_link(%L) $$, (select k2024 from t085_k))), 'P0001/already_linked', 'one link per team-year');
select is(t085.as_run(1, format($$ select public.seduh_add_team_link(%L, 'captain') $$, (select k2023 from t085_k))), 'ok', 'the same team in another year is a separate link');
select is((select count(*)::int from app.seduh_team_memberships where account_id = t085.u(101) and status = 'self_reported'), 2, 'both are self_reported: nothing a person does can confirm');
select is(jsonb_path_query_first(t085.j(1, $$ select public.seduh_team_options('QX') $$), '$.teams[*] ? (@.edition_year == 2024).linked'), 'true'::jsonb, 'the picker marks what is already linked');
select is(t085.as_attempt(2, format($$ select public.seduh_remove_team_link(%s) $$, (select (j ->> 'id')::bigint from t085_l1))), 'P0001/not_found', 'another person cannot remove my link');
select is((select count(*)::int from app.seduh_team_memberships where account_id = t085.u(101)), 2, '...and it is still there');
select is(t085.j(1, $$ select public.seduh_my_record() $$) #>> '{counts,team_links}', '2', 'the record counts two links');
select is(t085.j(1, $$ select public.seduh_my_record() $$) #>> '{team_links,0,edition_year}', '2024', 'newest first');

-- the cap of 40
insert into app.seduh_team_memberships (account_id, result_id)
  select t085.u(107), t085.u(300 + n) from generate_series(1, 39) n;
select is(t085.as_run(7, format($$ select public.seduh_add_team_link(%L) $$, app.seduh_team_key(t085.u(340)))), 'ok', 'the 40th link is accepted');
select is(t085.as_attempt(7, format($$ select public.seduh_add_team_link(%L) $$, app.seduh_team_key(t085.u(341)))), 'P0001/too_many_links', 'the 41st link is refused');

-- table-level shape
select is(t085.attempt($$ insert into app.seduh_team_memberships (account_id, result_id, role) values (t085.u(102), t085.u(204), 'striker') $$), '23514/', 'the table refuses a role outside the vocabulary');
select is(t085.attempt($$ insert into app.seduh_team_memberships (account_id, result_id, status) values (t085.u(102), t085.u(204), 'confirmed') $$), '23514/', '...a confirmed row with no confirmation');
select is(t085.attempt($$ insert into app.seduh_team_memberships (account_id, result_id, confirmed_at) values (t085.u(102), t085.u(204), now()) $$), '23514/', '...a self_reported row with a confirmation');
select is(t085.attempt($$ insert into app.seduh_team_memberships (account_id, result_id, status, confirmed_via, confirmed_by_account, confirmed_at) values (t085.u(102), t085.u(204), 'confirmed', 'teammate', t085.u(102), now()) $$), '23514/', '...a teammate confirming themselves');
select is(t085.attempt($$ insert into app.seduh_team_memberships (account_id, result_id, status, confirmed_via, confirmed_by_account, confirmed_at) values (t085.u(102), t085.u(204), 'confirmed', 'owner', t085.u(101), now()) $$), '23514/', '...an owner confirmation that names a teammate');
select is(t085.attempt($$ insert into app.seduh_team_memberships (account_id, result_id, status, confirmed_via, confirmed_by_account, confirmed_at) values (t085.u(102), t085.u(204), 'confirmed', 'teammate', t085.u(101), now()) $$), 'ok', 'the teammate-confirmation shape exists (the seam): a different account may confirm');
select is(t085.attempt($$ update app.seduh_team_memberships set result_id = t085.u(204) where account_id = t085.u(101) $$), '23001/', 'a link cannot be moved to another team');
select is(t085.attempt($$ update app.seduh_team_memberships set account_id = t085.u(102) where account_id = t085.u(101) $$), '23001/', '...or to another person');
select is(t085.attempt($$ delete from app.historical_results where id = t085.u(201) $$), '23503/', 'a team result that has members cannot be deleted');

-- ============ settings ============

select is(t085.j(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "organisers"}') $$) ->> 'vis_self_reported_results', 'organisers', 'a partial update returns the new settings');
select is((select vis_identity || '/' || vis_organiser_results || '/' || listed_on_country_pages::text from app.seduh_profile_settings where account_id = t085.u(101)), 'public/public/false', '...and leaves the others');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{}') $$), 'P0001/bad_input', 'an empty object is refused');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings(null) $$), 'P0001/bad_input', 'a null is refused');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('["x"]') $$), 'P0001/bad_input', 'an array is refused');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "friends"}') $$), 'P0001/bad_setting', 'a value outside the vocabulary is refused');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{"vis_identity": "organisers"}') $$), 'P0001/bad_setting', 'identity takes no "organisers"');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{"vis_knockout_record": "organisers"}') $$), 'P0001/bad_setting', 'nor the knockout record');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{"founding_number": 1}') $$), 'P0001/bad_setting', 'an unknown key is refused');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{"listed_on_country_pages": "yes"}') $$), 'P0001/bad_setting', 'a non-boolean is refused');
select is(t085.as_attempt(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "hidden", "bogus": 1}') $$), 'P0001/bad_setting', 'one bad key refuses the whole call');
select is((select vis_self_reported_results from app.seduh_profile_settings where account_id = t085.u(101)), 'organisers', '...and changes nothing (the good key was not applied)');
select is((select vis_self_reported_results from app.seduh_profile_settings where account_id = t085.u(102)), 'public', 'another person''s settings were never touched');
select is(t085.j(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "public"}') $$) ->> 'vis_self_reported_results', 'public', 'put back to public');

-- ============ the profile door ============

select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.public_seduh_profile('bravo-t85')) k),
  'cafe_affiliations,courses,handle,has_profile,identity,judging_roles,knockout_record,organiser_records,recorded_results,self_reported',
  'the door''s top-level keys are unchanged');
select is(public.public_seduh_profile('bravo-t85') -> 'self_reported', '[]'::jsonb, 'an empty record: self_reported is []');
select is(public.public_seduh_profile('bravo-t85') -> 'organiser_records', '[]'::jsonb, '...and organiser_records is []');
select is(public.public_seduh_profile('nobody-t85') -> 'organiser_records', '[]'::jsonb, 'an unknown handle gets the same empty shape');

select is(jsonb_array_length(public.public_seduh_profile('alpha-t85') -> 'self_reported'), 2, 'the door shows the two self-reported entries');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.public_seduh_profile('alpha-t85') -> 'self_reported' -> 0) k),
  'competition_name,kind,location,note,placement,provenance,result_text,role,year', 'each has exactly these keys (no id)');
select is(public.public_seduh_profile('alpha-t85') #>> '{self_reported,0,provenance}', 'self_reported', 'labelled self_reported');
select is(public.public_seduh_profile('alpha-t85') #>> '{self_reported,0,year}', '2023', 'newest year first');
select is(public.public_seduh_profile('alpha-t85') -> 'recorded_results', '[]'::jsonb, 'an entry is NEVER a recorded result');
select is(jsonb_array_length(public.public_seduh_profile('alpha-t85') -> 'organiser_records'), 2, 'the door shows the two team links');
select is(public.public_seduh_profile('alpha-t85') -> 'organiser_records' -> 0,
  '{"competition": "btc", "competition_name": "T085 Championship", "edition_year": 2024, "team_name": "T085 Bandits", "country_code": "QX", "stage_reached": "quarter_final", "placement": null, "role": "member", "membership": "self_reported", "provenance": "organiser_archive"}'::jsonb,
  'a team link: the team result is organiser_archive, the membership self_reported');
select is((public.public_seduh_profile('alpha-t85')::text ~ ('(' || t085.u(201) || '|' || t085.u(1) || '|' || t085.u(101) || '|\+673|@t085|' || (select k2024 from t085_k) || ')')), false, 'no result, identity, account or user id, phone, email or picker key appears');

select is(t085.j(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "organisers"}') $$) ->> 'vis_self_reported_results', 'organisers', 'set entries to organisers-only');
select is(public.public_seduh_profile('alpha-t85') -> 'self_reported', '[]'::jsonb, '...an anonymous caller sees none');
select is(public.public_seduh_profile('alpha-t85') -> 'has_profile', 'true'::jsonb, '...the page still exists');
select is(jsonb_array_length(public.public_seduh_profile('alpha-t85') -> 'organiser_records'), 2, '...and the team links are governed by their own setting');
select is(t085.j(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "hidden", "vis_organiser_results": "hidden"}') $$) ->> 'vis_organiser_results', 'hidden', 'hide both');
select is((public.public_seduh_profile('alpha-t85') -> 'self_reported')::text || (public.public_seduh_profile('alpha-t85') -> 'organiser_records')::text, '[][]', 'both sections are empty arrays when hidden');
select is(t085.j(1, $$ select public.seduh_set_my_settings('{"vis_self_reported_results": "public", "vis_organiser_results": "organisers"}') $$) ->> 'vis_organiser_results', 'organisers', 'organisers-only team links');
select is(public.public_seduh_profile('alpha-t85') -> 'organiser_records', '[]'::jsonb, '...hide like hidden');
select is(t085.j(1, $$ select public.seduh_set_my_settings('{"vis_organiser_results": "public"}') $$) ->> 'vis_organiser_results', 'public', 'back to public');

-- an unlisted team result disappears from the page (a removal is complete), but the person still sees it
update app.historical_results set listed = false where id = t085.u(202);
select is(jsonb_array_length(public.public_seduh_profile('alpha-t85') -> 'organiser_records'), 1, 'an unlisted team result leaves the public page');
select is(jsonb_array_length(t085.j(1, $$ select public.seduh_my_record() $$) -> 'team_links'), 2, '...while the person''s own record still lists it');
select is(t085.j(1, $$ select public.seduh_my_record() $$) #>> '{team_links,1,listed}', 'false', '...marked listed = false');
update app.historical_results set listed = true where id = t085.u(202);

-- ============ the country door ============

select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.public_country_record('QX') -> 'championships' -> 0 -> 'teams' -> 0) k),
  'members,placement,provenance,rounds,score_note,stage_reached,team_name', 'a team row has the old keys plus members');
select is(public.public_country_record('QX') #> '{championships,0,teams,0,members}', '[]'::jsonb, 'by default nobody is listed');
select is(public.public_country_record('ZZ') -> 'championships', '[]'::jsonb, 'the shape of an empty country is unchanged');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.public_country_record('ZZ')) k), 'championships,country_code,has_record,stats,teams', '...(same keys)');

-- bravo links the SAME team and never opts in
select is(t085.as_run(2, format($$ select public.seduh_add_team_link(%L) $$, (select k2024 from t085_k))), 'ok', 'a second person links the same team-year');
select is(t085.j(1, $$ select public.seduh_set_my_settings('{"listed_on_country_pages": true}') $$) ->> 'listed_on_country_pages', 'true', 'alpha opts in');
select is(public.public_country_record('QX') #> '{championships,0,teams,0,members}',
  '[{"handle": "alpha-t85", "display_name": "T085 Person 1", "membership": "self_reported"}]'::jsonb,
  'the 2024 row lists alpha only: bravo linked the team but did not opt in');
select is(public.public_country_record('QX') #> '{championships,1,teams,0,members}',
  '[{"handle": "alpha-t85", "display_name": "T085 Person 1", "membership": "self_reported"}]'::jsonb, '...and the 2023 row lists alpha (a team-year each)');
select is(public.public_country_record('QY') #> '{championships,0,teams,0,members}', '[]'::jsonb, 'another country''s team has no members');
select is((select jsonb_array_length(public.public_country_record('QX') #> '{teams}')), 1, 'the across-years summary is unchanged (no members there)');
select is(t085.j(2, $$ select public.seduh_set_my_settings('{"listed_on_country_pages": true}') $$) ->> 'listed_on_country_pages', 'true', 'bravo opts in too');
select is((select string_agg(m ->> 'handle', ',' order by m ->> 'handle') from jsonb_array_elements(public.public_country_record('QX') #> '{championships,0,teams,0,members}') m), 'alpha-t85,bravo-t85', 'both are listed, in order');
select is(t085.j(2, $$ select public.seduh_set_my_settings('{"vis_identity": "hidden"}') $$) ->> 'vis_identity', 'hidden', 'bravo hides their identity');
select is((select string_agg(m ->> 'handle', ',') from jsonb_array_elements(public.public_country_record('QX') #> '{championships,0,teams,0,members}') m), 'alpha-t85', '...and leaves the list');
select is(t085.j(2, $$ select public.seduh_set_my_settings('{"vis_identity": "public", "vis_organiser_results": "organisers"}') $$) ->> 'vis_organiser_results', 'organisers', 'bravo makes organiser results organisers-only');
select is((select string_agg(m ->> 'handle', ',') from jsonb_array_elements(public.public_country_record('QX') #> '{championships,0,teams,0,members}') m), 'alpha-t85', '...and is not listed either (organisers-only is hidden to the public)');
select is(t085.j(2, $$ select public.seduh_set_my_settings('{"vis_identity": "public", "vis_organiser_results": "hidden"}') $$) ->> 'vis_organiser_results', 'hidden', 'bravo hides organiser results instead');
select is((select string_agg(m ->> 'handle', ',') from jsonb_array_elements(public.public_country_record('QX') #> '{championships,0,teams,0,members}') m), 'alpha-t85', '...also off the list (no back door)');
select is(t085.j(2, $$ select public.seduh_set_my_settings('{"vis_organiser_results": "public", "listed_on_country_pages": false}') $$) ->> 'listed_on_country_pages', 'false', 'bravo opts out again');
select is((select string_agg(m ->> 'handle', ',') from jsonb_array_elements(public.public_country_record('QX') #> '{championships,0,teams,0,members}') m), 'alpha-t85', '...and is off the list');
update app.seduh_accounts set closed_at = now() where id = t085.u(101);
select is(public.public_country_record('QX') #> '{championships,0,teams,0,members}', '[]'::jsonb, 'a CLOSED account is never listed');
select is(public.public_seduh_profile('alpha-t85') -> 'has_profile', 'false'::jsonb, '(and its page is gone)');
select is(t085.as_attempt(1, $$ select public.seduh_my_record() $$), '42501/no_account', 'a closed account can no longer read its record through the door');
-- reopen for the rest of the test by creating no new account: use account 2 (bravo) for the owner functions below
select is((public.public_country_record('QX')::text ~ ('(' || t085.u(201) || '|' || t085.u(101) || ')')), false, 'the country door leaks no id');

-- ============ the owner's functions ============

-- owner SQL has no signed-in user: clear the one the helpers set, or the audit would name them as the actor
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::int from app.seduh_memberships_overview() where handle = 'bravo-t85'), 1, 'the owner overview lists bravo''s membership');
create temp table t085_m as select id from app.seduh_team_memberships where account_id = t085.u(102) and result_id = t085.u(201);
select is(t085.attempt($$ select app.seduh_membership_confirm((select id from t085_m), '  ') $$), 'P0001/bad_reason', 'confirming needs a reason');
select is(t085.attempt($$ select app.seduh_membership_confirm(999999999, 'checked') $$), 'P0002/', 'an unknown membership is refused');
select is(t085.run($$ select app.seduh_membership_confirm((select id from t085_m), 'confirmed by phone with the captain') $$), 'ok', 'the owner confirms');
select is((select status || '/' || confirmed_via || '/' || (confirmed_by_account is null)::text || '/' || (confirmed_at is not null)::text from app.seduh_team_memberships where id = (select id from t085_m)), 'confirmed/owner/true/true', '...status, via, no teammate, timestamp');
select is(t085.attempt($$ select app.seduh_membership_confirm((select id from t085_m), 'again') $$), 'P0001/', 'confirming twice is refused');
select is((select count(*)::int from app.seduh_claim_audit where action = 'membership.confirm' and actor_id is null
            and account_id = t085.u(102) and detail ->> 'reason' = 'confirmed by phone with the captain'), 1, 'one audit row: the action, the account and the reason, no actor (owner SQL)');
select is((select count(*)::int from app.seduh_claim_audit where action like 'membership.%' and detail::text ~* '(@|\+673|token)'), 0, '...no secret in it');
select is(t085.j(2, $$ select public.seduh_my_record() $$) #>> '{team_links,0,membership}', 'confirmed', 'the person sees it confirmed');
select is(t085.as_attempt(2, $$ select app.seduh_membership_confirm(1, 'x') $$), '42501/', 'a person cannot call the owner function (no schema access)');
select is(t085.as_attempt(2, $$ select * from app.seduh_memberships_overview() $$), '42501/', '...nor the overview');
-- bravo's page shows it confirmed once their settings allow it
select is(public.public_seduh_profile('bravo-t85') #>> '{organiser_records,0,membership}', 'confirmed', 'the profile door shows membership confirmed');
select is(t085.run($$ select app.seduh_membership_unconfirm((select id from t085_m), 'was a mistake') $$), 'ok', 'the owner unconfirms');
select is((select status || '/' || coalesce(confirmed_via, 'null') from app.seduh_team_memberships where id = (select id from t085_m)), 'self_reported/null', '...back to self_reported');
select is(t085.attempt($$ select app.seduh_membership_unconfirm((select id from t085_m), 'again') $$), 'P0001/', 'unconfirming what is not confirmed is refused');
select is((select count(*)::int from app.seduh_claim_audit where action = 'membership.unconfirm' and account_id = t085.u(102)), 1, 'audited');
-- remove and re-add drops a confirmation
select is(t085.run($$ select app.seduh_membership_confirm((select id from t085_m), 'ok again') $$), 'ok', 'confirm once more');
select is(t085.as_run(2, format($$ select public.seduh_remove_team_link(%s) $$, (select id from t085_m))), 'ok', 'the person removes the link');
select is(t085.as_run(2, format($$ select public.seduh_add_team_link(%L) $$, (select k2024 from t085_k))), 'ok', '...and adds it again');
select is((select status from app.seduh_team_memberships where account_id = t085.u(102) and result_id = t085.u(201)), 'self_reported', 'a re-added link is self_reported again');
create temp table t085_m2 as select id from app.seduh_team_memberships where account_id = t085.u(102) and result_id = t085.u(201);
select is(t085.run($$ select app.seduh_membership_remove((select id from t085_m2), 'not on that team') $$), 'ok', 'the owner removes a false membership');
select is((select count(*)::int from app.seduh_team_memberships where account_id = t085.u(102) and result_id = t085.u(201)), 0, '...it is gone');
select is((select count(*)::int from app.seduh_claim_audit where action = 'membership.remove' and account_id = t085.u(102) and detail ->> 'reason' = 'not on that team'), 1, '...audited with the reason');
select is(t085.attempt($$ select app.seduh_membership_remove((select id from t085_m2), 'again') $$), 'P0002/', 'removing it twice is refused');
select is(t085.attempt($$ update app.seduh_claim_audit set action = 'claim.undo' where action = 'membership.remove' $$), '42501/', 'the audit stays append-only');

-- ============ the rollback block removes what the migration added (the doors' restore is the previous migrations) ============

savepoint rollback_block;
drop function if exists public.seduh_set_my_settings(jsonb);
drop function if exists public.seduh_remove_team_link(bigint);
drop function if exists public.seduh_add_team_link(text, text);
drop function if exists public.seduh_team_options(text, text);
drop function if exists public.seduh_delete_entry(bigint);
drop function if exists public.seduh_update_entry(bigint, integer, text, text, text, text, text, integer, text);
drop function if exists public.seduh_add_entry(integer, text, text, text, text, text, integer, text);
drop function if exists public.seduh_my_record();
drop function if exists app.seduh_membership_remove(bigint, text);
drop function if exists app.seduh_membership_unconfirm(bigint, text);
drop function if exists app.seduh_membership_confirm(bigint, text);
drop function if exists app.seduh_memberships_overview();
drop function if exists app.seduh_my_record_json(uuid);
drop function if exists app.seduh_link_json(bigint);
drop function if exists app.seduh_entry_json(app.seduh_self_reported_entries);
drop function if exists app.seduh_my_account(boolean);
drop function if exists app.seduh_team_key(uuid);
drop function if exists app.seduh_entry_clean(integer, text, text, text, text, text, integer, text);
drop function if exists app.seduh_clean_text(text, integer, boolean, text);
drop function if exists app.seduh_course_json(app.seduh_courses); -- 20261126110000
drop table if exists app.seduh_result_disputes; -- 20261126120000 (its text rules use seduh_text_ok)
drop table if exists app.seduh_courses; -- 20261126110000 (it holds a check that uses seduh_text_ok)
drop table if exists app.seduh_team_memberships;
drop table if exists app.seduh_self_reported_entries;
drop function if exists app.seduh_text_ok(text);
select is((select count(*)::int from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
            and p.proname !~ 'photo' and (p.proname ~ '^seduh_(my_|add_entry|update_entry|delete_entry|team_|add_team|remove_team|set_my|entry_|link_json|clean_text|text_ok|membership)')), 0, 'the rollback block removes every function it added (the photo functions are 086''s)');
select is((select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname in ('seduh_self_reported_entries', 'seduh_team_memberships')), 0, '...and both tables');
rollback to savepoint rollback_block;

select * from finish();
rollback;
