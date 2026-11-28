-- remove_unused_people: clears leftover people out of an organisation, never anyone who is part of an event, linked to
-- a Seduh ID, or a staff or affiliate. See 20261202110000_remove_unused_people.sql.
-- Proves: an unused person is deleted; a person with an entry (even a withdrawn one) stays; a linked person stays; a
-- person with an affiliation (even ended) stays; the count says how many went; another organisation's person, an
-- unknown id, a NULL organisation and a non-member are refused with the one standard 42501 and delete nothing; an empty
-- or NULL list deletes nothing; more than 200 is refused with a hint; anon cannot execute it.
begin;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009701', 'member@t097.seduh-next'),
  ('00000000-0000-0000-0000-000000009702', 'outsider@t097.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000009710', 'T097 Org', 't097-org'),
  ('00000000-0000-0000-0000-000000009720', 'T097 Other', 't097-other');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000009710', '00000000-0000-0000-0000-000000009701', 'organiser');
insert into events (id, org_id, format, name, is_test) values
  ('00000000-0000-0000-0000-0000000097e1', '00000000-0000-0000-0000-000000009710', 'cup_taster', 'T097 Cup', true);
insert into app.seduh_identities (id, phone_e164, display_name, source) values
  ('00000000-0000-0000-0000-000000009791', '+6739700006', 'Linked Person', 'archive');
-- p1 unused, p2 unused, p3 has an entry, p4 has a WITHDRAWN entry, p5 has an ended affiliation, p6 is linked, p7 is another org's
insert into people (id, org_id, display_name, phone) values
  ('00000000-0000-0000-0000-0000000097a1', '00000000-0000-0000-0000-000000009710', 'Unused One', '+6739700001'),
  ('00000000-0000-0000-0000-0000000097a2', '00000000-0000-0000-0000-000000009710', 'Unused Two', '+6739700002'),
  ('00000000-0000-0000-0000-0000000097a3', '00000000-0000-0000-0000-000000009710', 'Has Entry', '+6739700003'),
  ('00000000-0000-0000-0000-0000000097a4', '00000000-0000-0000-0000-000000009710', 'Withdrawn Entry', '+6739700004'),
  ('00000000-0000-0000-0000-0000000097a5', '00000000-0000-0000-0000-000000009710', 'Was Staff', '+6739700005'),
  ('00000000-0000-0000-0000-0000000097a6', '00000000-0000-0000-0000-000000009710', 'Linked Person', '+6739700006'),
  ('00000000-0000-0000-0000-0000000097a7', '00000000-0000-0000-0000-000000009720', 'Other Org Person', '+6739700007');
insert into event_entries (event_id, person_id, display_name, withdrawn) values
  ('00000000-0000-0000-0000-0000000097e1', '00000000-0000-0000-0000-0000000097a3', 'Has Entry', false),
  ('00000000-0000-0000-0000-0000000097e1', '00000000-0000-0000-0000-0000000097a4', 'Withdrawn Entry', true);
insert into public.org_person_affiliations (org_id, person_id, relationship, started_on, ended_at) values
  ('00000000-0000-0000-0000-000000009710', '00000000-0000-0000-0000-0000000097a5', 'staff', '2026-01-01', '2026-06-01 00:00+00');
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = '00000000-0000-0000-0000-000000009791' where id = '00000000-0000-0000-0000-0000000097a6';
select set_config('app.seduh_link_write', '', true);

create function pg_temp.attempt(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $f$;

-- ---------- as the organiser ----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000009701';

select is(public.remove_unused_people('00000000-0000-0000-0000-000000009710',
  array['00000000-0000-0000-0000-0000000097a3','00000000-0000-0000-0000-0000000097a4','00000000-0000-0000-0000-0000000097a5','00000000-0000-0000-0000-0000000097a6']::uuid[]),
  0, 'people with an entry, a withdrawn entry, an ended affiliation or a Seduh ID link are all kept (0 deleted)');
select is((select count(*)::int from people where org_id = '00000000-0000-0000-0000-000000009710'), 6, 'and all six are still there');
select is((select count(*)::int from event_entries where person_id in ('00000000-0000-0000-0000-0000000097a3','00000000-0000-0000-0000-0000000097a4')), 2, 'the entries keep their person link');

select is(public.remove_unused_people('00000000-0000-0000-0000-000000009710',
  array['00000000-0000-0000-0000-0000000097a1','00000000-0000-0000-0000-0000000097a1','00000000-0000-0000-0000-0000000097a3']::uuid[]),
  1, 'an unused person is deleted (named twice, still one), a used one named with it is kept');
select is((select count(*)::int from people where id = '00000000-0000-0000-0000-0000000097a1'), 0, 'the unused person is gone');
select is((select count(*)::int from people where id = '00000000-0000-0000-0000-0000000097a3'), 1, 'the person with an entry is still there');

select is((select string_agg(display_name, ', ' order by display_name) from public.list_unused_people('00000000-0000-0000-0000-000000009710')),
  'Unused Two', 'the list shows only who is safe to remove (no entry, no link, no role), in this organisation');

select is(public.remove_unused_people('00000000-0000-0000-0000-000000009710', '{}'::uuid[]), 0, 'an empty list deletes nothing');
select is(public.remove_unused_people('00000000-0000-0000-0000-000000009710', null), 0, 'a NULL list deletes nothing');

-- refusals: the one standard answer, and nothing is deleted (a good id named beside a bad one is not deleted either)
select is(pg_temp.attempt($$ select public.remove_unused_people('00000000-0000-0000-0000-000000009710', array['00000000-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-0000000097a7']::uuid[]) $$),
  '42501: new row violates row-level security policy for table "people"', 'another organisation''s person is refused with 42501');
select is(pg_temp.attempt($$ select public.remove_unused_people('00000000-0000-0000-0000-000000009710', array['00000000-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-0000000097ff']::uuid[]) $$),
  '42501: new row violates row-level security policy for table "people"', 'an id that does not exist gets the same refusal');
select is((select count(*)::int from people where id = '00000000-0000-0000-0000-0000000097a2'), 1, 'and the unused person named beside the bad ids is NOT deleted');
select is(pg_temp.attempt($$ select public.remove_unused_people(null, array['00000000-0000-0000-0000-0000000097a2']::uuid[]) $$),
  '42501: new row violates row-level security policy for table "people"', 'a NULL organisation is refused');
select is(pg_temp.attempt($$ select public.remove_unused_people('00000000-0000-0000-0000-000000009720', array['00000000-0000-0000-0000-0000000097a7']::uuid[]) $$),
  '42501: new row violates row-level security policy for table "people"', 'naming an organisation the caller is not in is refused');
select matches(pg_temp.attempt($$ select public.remove_unused_people('00000000-0000-0000-0000-000000009710', (select array_agg(gen_random_uuid()) from generate_series(1, 201))) $$),
  '^P0001: remove_unused_people: at most 200', 'more than 200 people at a time is refused');

-- ---------- as a non-member ----------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000009702';
select is(pg_temp.attempt($$ select public.remove_unused_people('00000000-0000-0000-0000-000000009710', array['00000000-0000-0000-0000-0000000097a2']::uuid[]) $$),
  '42501: new row violates row-level security policy for table "people"', 'a non-member is refused with 42501');

select is(pg_temp.attempt($$ select * from public.list_unused_people('00000000-0000-0000-0000-000000009710') $$),
  '42501: new row violates row-level security policy for table "people"', 'a non-member cannot list them either');

-- ---------- anon ----------
reset role;
select is(has_function_privilege('anon', 'public.list_unused_people(uuid)', 'execute'), false, 'anon cannot list them');
select is(has_function_privilege('anon', 'public.remove_unused_people(uuid, uuid[])', 'execute'), false, 'anon cannot execute it');
select is((select count(*)::int from people where id = '00000000-0000-0000-0000-0000000097a2'), 1, 'and nothing the refused callers tried deleted the unused person');

select * from finish();
rollback;
