-- T-ID.B3: the staff/affiliate roster (public.org_person_affiliations), Seduh ID Layer 1 spec 3.4 and 3.6.
-- Proves, with its own fixtures (ids start 63..., rolled back at the end):
--   * the table is a tenant table done by the checklist: RLS on, exactly a `_read` and a `_write` policy built on
--     app.is_org_member (WITH CHECK on the write one, org_members never read directly), grants for `authenticated`
--     only (none for anon, none for service_role, no TRUNCATE), the parent-freeze and the cross-reference triggers
--     present and enabled, and the trigger function closed to every API role;
--   * a stranger (signed in, belongs to nobody) reads zero rows and is refused 42501 on insert; update and delete touch
--     nothing; anon holds no privilege at all; and a stranger's refusal is the SAME 42501 whatever ids they name
--     (a real person of another organisation, a missing person, a mismatched pair): no oracle (B6 lesson);
--   * any member of the organisation may read and edit the roster (owner decision 8), and sees only their own
--     organisation's rows;
--   * a member of BOTH organisations cannot move a row: org_id and person_id are frozen (23001); and cannot attach
--     one organisation's person to the other organisation's roster (one P0001, identical for a real person of the
--     other organisation and for a missing id);
--   * the relationship format check (boundaries), the partial unique index (one OPEN row per relationship, re-adding
--     after ended_at, several ended rows), and the cascade from person and from organisation;
--   * merge_people repoints the merged person's roster (spec 3.6) with the defined collision rule, and is still
--     refused to a non-member.
begin;
select plan(85);

create schema t063;

-- 'ok' or the SQLSTATE a statement was refused with, as the given user and role; ALWAYS rolled back, so nothing the
-- statement does (even if accepted) outlives the call. user NULL = no jwt subject.
create function t063.state(uid text, r text, stmt text) returns text language plpgsql as $$
declare s text;
begin
  execute format('set local role %I', r);
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  begin
    execute stmt;
    raise exception using errcode = 'P9999', message = 'sentinel';
  exception when others then
    s := case when sqlstate = 'P9999' then 'ok' else sqlstate end;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return s;
end $$;

-- The error message of the same refusal ('ok' when accepted).
create function t063.msg(uid text, r text, stmt text) returns text language plpgsql as $$
declare s text;
begin
  execute format('set local role %I', r);
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  begin
    execute stmt;
    raise exception using errcode = 'P9999', message = 'sentinel';
  exception when others then
    s := case when sqlstate = 'P9999' then 'ok' else sqlerrm end;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return s;
end $$;

-- Rows a statement changes (0 when refused), as the given user; always rolled back.
create function t063.changed(uid text, stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', uid, true);
  begin
    execute stmt;
    get diagnostics n = row_count;
    raise exception using errcode = 'P9999', message = n::text;
  exception when others then
    n := case when sqlstate = 'P9999' then sqlerrm::int else -1 end;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- Rows a count query returns as the given user (a role without the privilege answers -1).
create function t063.seen(uid text, r text, q text) returns int language plpgsql as $$
declare n int;
begin
  execute format('set local role %I', r);
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  begin
    execute q into n;
  exception when insufficient_privilege then
    n := -1;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

grant usage on schema t063 to anon, authenticated;
grant execute on all functions in schema t063 to anon, authenticated;

-- ============ fixtures (as postgres) ============
-- users: ua (organiser of A), ub (owner of B), uab (both), uc (nobody)
insert into auth.users (id, email) values
  ('63000000-0000-0000-0000-000000000001', 'ua@t063.seduh-next'),
  ('63000000-0000-0000-0000-000000000002', 'ub@t063.seduh-next'),
  ('63000000-0000-0000-0000-000000000003', 'uab@t063.seduh-next'),
  ('63000000-0000-0000-0000-000000000004', 'uc@t063.seduh-next');
insert into orgs (id, name, slug) values
  ('63000000-0000-0000-0000-0000000000a0', 'T063 Org A', 't063-org-a'),
  ('63000000-0000-0000-0000-0000000000b0', 'T063 Org B', 't063-org-b'),
  ('63000000-0000-0000-0000-0000000000c0', 'T063 Org C', 't063-org-c');
insert into org_members (org_id, user_id, role) values
  ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-0000-000000000001', 'organiser'),
  ('63000000-0000-0000-0000-0000000000b0', '63000000-0000-0000-0000-000000000002', 'owner'),
  ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-0000-000000000003', 'organiser'),
  ('63000000-0000-0000-0000-0000000000b0', '63000000-0000-0000-0000-000000000003', 'organiser');
-- people: A has a1..a9 (a2/a3 merge pair, a4/a5, a6/a7, a8/a9 other pairs), B has b1, C has c1
insert into people (id, org_id, display_name, phone) values
  ('63000000-0000-0000-1000-000000000001', '63000000-0000-0000-0000-0000000000a0', 'A one',   '+67363000001'),
  ('63000000-0000-0000-1000-000000000002', '63000000-0000-0000-0000-0000000000a0', 'A two',   '+67363000002'),
  ('63000000-0000-0000-1000-000000000003', '63000000-0000-0000-0000-0000000000a0', 'A three', '+67363000003'),
  ('63000000-0000-0000-1000-000000000004', '63000000-0000-0000-0000-0000000000a0', 'A four',  '+67363000004'),
  ('63000000-0000-0000-1000-000000000005', '63000000-0000-0000-0000-0000000000a0', 'A five',  '+67363000005'),
  ('63000000-0000-0000-1000-000000000006', '63000000-0000-0000-0000-0000000000a0', 'A six',   '+67363000006'),
  ('63000000-0000-0000-1000-000000000007', '63000000-0000-0000-0000-0000000000a0', 'A seven', '+67363000007'),
  ('63000000-0000-0000-1000-000000000008', '63000000-0000-0000-0000-0000000000a0', 'A eight', '+67363000008'),
  ('63000000-0000-0000-1000-000000000009', '63000000-0000-0000-0000-0000000000a0', 'A nine',  '+67363000009'),
  ('63000000-0000-0000-1000-0000000000b1', '63000000-0000-0000-0000-0000000000b0', 'B one',   '+67363000011'),
  ('63000000-0000-0000-1000-0000000000c1', '63000000-0000-0000-0000-0000000000c0', 'C one',   '+67363000021');
-- one roster row per organisation (as postgres), plus one for the throwaway organisation C
insert into public.org_person_affiliations (id, org_id, person_id, relationship, started_on) values
  ('63000000-0000-0000-2000-000000000001', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'staff', '2025-01-01'),
  ('63000000-0000-0000-2000-0000000000b1', '63000000-0000-0000-0000-0000000000b0', '63000000-0000-0000-1000-0000000000b1', 'staff', '2025-02-02'),
  ('63000000-0000-0000-2000-0000000000c1', '63000000-0000-0000-0000-0000000000c0', '63000000-0000-0000-1000-0000000000c1', 'affiliate', null);

-- ============ 1. the checklist, from the catalog (4) ============

select ok((select relrowsecurity from pg_class where oid = 'public.org_person_affiliations'::regclass),
  'row-level security is on');
select is(
  (select array_agg(polname order by polname)::text from pg_policy where polrelid = 'public.org_person_affiliations'::regclass),
  '{org_person_affiliations_read,org_person_affiliations_write}',
  'exactly a _read and a _write policy');
select ok(
  (select bool_and(coalesce(pg_get_expr(polqual, polrelid), '') like '%app.is_org_member(org_id)%'
                   and pg_get_expr(polqual, polrelid) not ilike '%org_members%')
     from pg_policy where polrelid = 'public.org_person_affiliations'::regclass)
  and (select pg_get_expr(polwithcheck, polrelid) like '%app.is_org_member(org_id)%'
         from pg_policy where polrelid = 'public.org_person_affiliations'::regclass and polname = 'org_person_affiliations_write'),
  'both policies are built on app.is_org_member(org_id) (never org_members directly) and the write one has a WITH CHECK');
select is(
  (select array_agg(tgname order by tgname)::text from pg_trigger
    where tgrelid = 'public.org_person_affiliations'::regclass and not tgisinternal and tgenabled = 'O'),
  '{trg_org_person_affiliations_parent_immutable,trg_org_person_affiliations_person_org_check}',
  'the freeze and the cross-reference triggers exist and are enabled');

-- ============ 2. privileges (6) ============

select is(
  (select string_agg(p, ',' order by p) from unnest(array['select','insert','update','delete','truncate','references','trigger']) p
    where has_table_privilege('anon', 'public.org_person_affiliations', p)),
  null, 'anon holds no privilege on the table');
select is(
  (select string_agg(p, ',' order by p) from unnest(array['select','insert','update','delete','truncate','references','trigger']) p
    where has_table_privilege('service_role', 'public.org_person_affiliations', p)),
  null, 'service_role holds no privilege on the table (TRUNCATE included)');
select is(
  (select string_agg(p, ',' order by p) from unnest(array['select','insert','update','delete','truncate','references','trigger']) p
    where has_table_privilege('authenticated', 'public.org_person_affiliations', p)),
  'delete,select', 'authenticated holds table-level select and delete only: insert and update are column grants (20261031120000)');
select is(
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'org_person_affiliations'
      and has_column_privilege('authenticated', 'public.org_person_affiliations', column_name, 'insert')),
  'ended_at,org_id,person_id,relationship,started_on', 'authenticated may insert exactly the five client columns (never id, created_at, created_by)');
select is(
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'org_person_affiliations'
      and has_column_privilege('authenticated', 'public.org_person_affiliations', column_name, 'update')),
  'ended_at,org_id,person_id,relationship,started_on', 'authenticated may update exactly the same five (org_id and person_id so the freeze trigger stays the answer)');
select is(
  (select count(*)::int from information_schema.columns c, unnest(array['anon', 'service_role']) r, unnest(array['select', 'insert', 'update', 'references']) p
    where c.table_schema = 'public' and c.table_name = 'org_person_affiliations'
      and has_column_privilege(r, 'public.org_person_affiliations', c.column_name, p)),
  0, 'anon and service_role hold no column privilege either');
select ok(has_function_privilege('authenticated', 'app.move_person_affiliations(uuid, uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'app.move_person_affiliations(uuid, uuid, uuid)', 'execute')
      and not has_function_privilege('service_role', 'app.move_person_affiliations(uuid, uuid, uuid)', 'execute'),
  'the carry-over helper is executable by authenticated only (merge_people runs as the caller)');
select ok(not has_function_privilege('authenticated', 'app.check_affiliation_person_org()', 'execute')
      and not has_function_privilege('anon', 'app.check_affiliation_person_org()', 'execute')
      and not has_function_privilege('service_role', 'app.check_affiliation_person_org()', 'execute'),
  'the cross-reference trigger function is executable by no API role');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'app.check_affiliation_person_org()'::regprocedure),
  'the trigger function is SECURITY DEFINER with search_path pinned to empty');
select ok(not (select prosecdef from pg_proc where oid = 'public.merge_people(uuid,uuid,uuid)'::regprocedure)
      and (select proconfig = array['search_path=""'] from pg_proc where oid = 'public.merge_people(uuid,uuid,uuid)'::regprocedure),
  'merge_people stays SECURITY INVOKER with search_path pinned');

-- ============ 3. a stranger (uc) and anon (9) ============

select is(t063.seen('63000000-0000-0000-0000-000000000004', 'authenticated', 'select count(*)::int from public.org_person_affiliations'),
  0, 'a stranger reads zero rows of the whole table');
select is(t063.seen('63000000-0000-0000-0000-000000000004', 'authenticated',
  'select count(*)::int from public.org_person_affiliations where org_id = ''63000000-0000-0000-0000-0000000000a0'''),
  0, 'a stranger reads zero rows of organisation A');
select is(t063.state('63000000-0000-0000-0000-000000000004', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'affiliate')$$),
  '42501', 'a stranger cannot insert into organisation A (real person): 42501');
select is(t063.msg('63000000-0000-0000-0000-000000000004', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'affiliate')$$),
  'new row violates row-level security policy for table "org_person_affiliations"',
  'and it is the standard row-level-security message');
-- no oracle: a missing person, another organisation's person and a mismatched pair all answer exactly the same
select is(t063.msg('63000000-0000-0000-0000-000000000004', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-0000000000b1', 'affiliate')$$),
  'new row violates row-level security policy for table "org_person_affiliations"',
  'a stranger naming A with B''s person gets the same refusal (no oracle)');
select is(t063.msg('63000000-0000-0000-0000-000000000004', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'affiliate')$$),
  'new row violates row-level security policy for table "org_person_affiliations"',
  'a stranger naming A with a missing person gets the same refusal (no oracle)');
select is(t063.changed('63000000-0000-0000-0000-000000000004',
  $$update public.org_person_affiliations set relationship = 'affiliate' where id = '63000000-0000-0000-2000-000000000001'$$)
  + t063.changed('63000000-0000-0000-0000-000000000004',
  $$delete from public.org_person_affiliations where id = '63000000-0000-0000-2000-000000000001'$$),
  0, 'a stranger updates and deletes nothing');
select is(t063.seen(null, 'anon', 'select count(*)::int from public.org_person_affiliations'),
  -1, 'anon cannot read the table (refused; the privilege itself is pinned above)');
select is(t063.state(null, 'anon',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'affiliate')$$),
  '42501', 'anon cannot insert (refused; the privilege itself is pinned above)');

-- ============ 4. members: read and edit their own roster, any member (decision 8) (8) ============

select is(t063.seen('63000000-0000-0000-0000-000000000001', 'authenticated', 'select count(*)::int from public.org_person_affiliations'),
  1, 'a member of A (organiser, not owner) sees exactly A''s one row, none of B''s or C''s');
select is(t063.seen('63000000-0000-0000-0000-000000000002', 'authenticated', 'select count(*)::int from public.org_person_affiliations'),
  1, 'a member of B sees exactly B''s one row');
select is(t063.seen('63000000-0000-0000-0000-000000000003', 'authenticated', 'select count(*)::int from public.org_person_affiliations'),
  2, 'a member of both sees the two rows of A and B, not C''s');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship, started_on) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'affiliate', current_date)$$),
  'ok', 'an organiser (any member) can add a roster row to their own organisation');
select is(t063.changed('63000000-0000-0000-0000-000000000001',
  $$update public.org_person_affiliations set ended_at = now() where id = '63000000-0000-0000-2000-000000000001'$$),
  1, 'an organiser can end a roster row of their own organisation');
select is(t063.changed('63000000-0000-0000-0000-000000000001',
  $$delete from public.org_person_affiliations where id = '63000000-0000-0000-2000-000000000001'$$),
  1, 'an organiser can delete a roster row of their own organisation');
select is(t063.changed('63000000-0000-0000-0000-000000000001',
  $$update public.org_person_affiliations set relationship = 'affiliate' where id = '63000000-0000-0000-2000-0000000000b1'$$)
  + t063.changed('63000000-0000-0000-0000-000000000001',
  $$delete from public.org_person_affiliations where id = '63000000-0000-0000-2000-0000000000b1'$$),
  0, 'a member of A updates and deletes nothing of B''s');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000b0', '63000000-0000-0000-1000-0000000000b1', 'affiliate')$$),
  '42501', 'a member of A cannot insert into B (even with B''s own person)');

-- created_by is the caller, set by the database (1)
insert into public.org_person_affiliations (id, org_id, person_id, relationship) values
  ('63000000-0000-0000-2000-000000000002', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'volunteer');
set local role authenticated;
set local request.jwt.claim.sub = '63000000-0000-0000-0000-000000000001';
insert into public.org_person_affiliations (org_id, person_id, relationship) values
  ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'caller_stamp');
reset role;
select is((select created_by from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000001' and relationship = 'caller_stamp'),
  '63000000-0000-0000-0000-000000000001'::uuid, 'created_by defaults to the signed-in caller');

-- a client can never NAME id, created_at or created_by (insert, update, upsert): one 42501, identical for an id that
-- exists in another organisation and one that does not (the row-id existence oracle, closed by 20261031120000)
select is(t063.msg('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (id, org_id, person_id, relationship) values ('63000000-0000-0000-2000-0000000000b1', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'oracle')$$),
  'permission denied for table org_person_affiliations', 'naming the id of ANOTHER organisation''s row on insert is refused 42501 (not 23505)');
select is(t063.msg('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (id, org_id, person_id, relationship) values ('63000000-0000-0000-2000-00000000ffff', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'oracle')$$),
  'permission denied for table org_person_affiliations', 'naming an UNUSED id is refused with the same 42501');
select is(t063.msg('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (id, org_id, person_id, relationship) values ('63000000-0000-0000-2000-0000000000b1', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'oracle') on conflict (id) do update set relationship = excluded.relationship$$),
  'permission denied for table org_person_affiliations', 'an upsert naming another organisation''s row id is refused 42501 as well (no USING-expression answer)');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship, created_by) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'forged', '63000000-0000-0000-0000-000000000002')$$),
  '42501', 'created_by cannot be sent on insert');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship, created_at) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'forged', '2001-01-01')$$),
  '42501', 'created_at cannot be sent on insert');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$update public.org_person_affiliations set created_by = '63000000-0000-0000-0000-000000000002' where person_id = '63000000-0000-0000-1000-000000000001'$$),
  '42501', 'created_by cannot be updated');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$update public.org_person_affiliations set created_at = '2001-01-01' where person_id = '63000000-0000-0000-1000-000000000001'$$),
  '42501', 'created_at cannot be updated');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$update public.org_person_affiliations set id = gen_random_uuid() where person_id = '63000000-0000-0000-1000-000000000001'$$),
  '42501', 'id cannot be updated');
select ok(t063.changed('63000000-0000-0000-0000-000000000001',
  $$update public.org_person_affiliations set relationship = relationship where person_id = '63000000-0000-0000-1000-000000000001'$$) > 0,
  'control: the client columns can still be updated');
select is(t063.changed('63000000-0000-0000-0000-000000000001',
  $$update public.org_person_affiliations set relationship = 'x' where id = '63000000-0000-0000-2000-0000000000b1'$$)
  + t063.changed('63000000-0000-0000-0000-000000000001',
  $$delete from public.org_person_affiliations where id = '63000000-0000-0000-2000-00000000ffff'$$),
  0, 'update/delete by another organisation''s row id and by a missing id both touch zero rows');

-- the carry-over helper refuses whoever is not allowed to call it, with the standard answers
select is(t063.state('63000000-0000-0000-0000-000000000004', 'authenticated',
  $$select app.move_person_affiliations('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', '63000000-0000-0000-1000-000000000002')$$),
  '42501', 'a stranger calling the helper directly is refused 42501');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$select app.move_person_affiliations('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', '63000000-0000-0000-1000-000000000001')$$),
  'P0001', 'the helper refuses a person merged into themselves');
select is(t063.state('63000000-0000-0000-0000-000000000001', 'authenticated',
  $$select app.move_person_affiliations('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', '63000000-0000-0000-1000-0000000000b1')$$),
  'P0001', 'the helper refuses a person of another organisation');
select is(t063.state('63000000-0000-0000-0000-000000000004', 'anon',
  $$select app.move_person_affiliations('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', '63000000-0000-0000-1000-000000000002')$$),
  '42501', 'anon cannot execute the helper');

-- ============ 5. the two-organisation member (uab): frozen parents and the cross-reference check (8) ============

select is(t063.state('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$update public.org_person_affiliations set org_id = '63000000-0000-0000-0000-0000000000b0' where id = '63000000-0000-0000-2000-000000000002'$$),
  '23001', 'a member of both cannot move a row A to B: org_id is frozen (23001)');
select is(t063.state('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$update public.org_person_affiliations set org_id = '63000000-0000-0000-0000-0000000000a0' where id = '63000000-0000-0000-2000-0000000000b1'$$),
  '23001', 'nor B to A (23001)');
select is(t063.state('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$update public.org_person_affiliations set person_id = '63000000-0000-0000-1000-000000000002' where id = '63000000-0000-0000-2000-000000000002'$$),
  '23001', 'nor re-point a row at another person of the same organisation: person_id is frozen (23001)');
select is(t063.state('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$update public.org_person_affiliations set org_id = '63000000-0000-0000-0000-0000000000b0', person_id = '63000000-0000-0000-1000-0000000000b1' where id = '63000000-0000-0000-2000-000000000002'$$),
  '23001', 'nor move both together (23001)');
select is(t063.msg('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-0000000000b1', 'affiliate')$$),
  'org_person_affiliations.person_id must belong to the same org as org_id',
  'a member of both cannot put B''s person on A''s roster (the trigger''s own refusal)');
select is(t063.msg('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'affiliate')$$),
  'org_person_affiliations.person_id must belong to the same org as org_id',
  'a missing person answers with the very same message (no yes/no oracle for a member either)');
select is(t063.state('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000c0', '63000000-0000-0000-1000-0000000000c1', 'affiliate')$$),
  '42501', 'a member of both cannot write organisation C, which they do not belong to (42501)');
select is(t063.state('63000000-0000-0000-0000-000000000003', 'authenticated',
  $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000b0', '63000000-0000-0000-1000-000000000001', 'affiliate')$$),
  'P0001', 'the reverse pair (B with A''s person) is refused too');

-- ============ 6. relationship format (9) ============

select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'staff')$$),
  'ok', 'staff is accepted');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'head_judge')$$),
  'ok', 'a value with an underscore is accepted');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'ab')$$),
  'ok', 'the shortest value (2 characters) is accepted');
select is(t063.state(null, 'postgres', format($$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', %L)$$, 'a' || repeat('b', 39))),
  'ok', 'the longest value (40 characters) is accepted');
select is(t063.state(null, 'postgres', format($$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', %L)$$, 'a' || repeat('b', 40))),
  '23514', '41 characters is refused (23514)');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'a')$$),
  '23514', 'one character is refused (23514)');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'Staff')$$),
  '23514', 'a capital letter is refused (23514)');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'head judge')$$)
  || t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', '1staff')$$)
  || t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', '_staff')$$)
  || t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'staff-member')$$),
  '23514235142351423514', 'a space, a leading digit, a leading underscore and a hyphen are all refused (23514)');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', null)$$),
  '23502', 'a null relationship is refused (23502)');

-- ============ 7. the partial unique index: one OPEN row per relationship (5) ============

-- person a1 holds open: staff (...001), volunteer (...002), judge (...003); every statement run through t063.state/changed is rolled back
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'volunteer')$$),
  '23505', 'a second OPEN row of the same relationship for the same person is refused (23505)');
select is(t063.state(null, 'postgres', $$insert into public.org_person_affiliations (org_id, person_id, relationship) values ('63000000-0000-0000-0000-0000000000b0', '63000000-0000-0000-1000-0000000000b1', 'volunteer')$$),
  'ok', 'the same relationship is fine for another person / organisation');
select is(t063.state(null, 'postgres', $$
  with e as (update public.org_person_affiliations set ended_at = now() where id = '63000000-0000-0000-2000-000000000002' returning 1)
  insert into public.org_person_affiliations (org_id, person_id, relationship) select '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'volunteer' from e$$),
  'ok', 're-adding the relationship after the earlier row ended is accepted');
update public.org_person_affiliations set ended_at = now() - interval '1 day' where id = '63000000-0000-0000-2000-000000000002';
insert into public.org_person_affiliations (org_id, person_id, relationship, ended_at) values
  ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'volunteer', now() - interval '2 days'),
  ('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000001', 'volunteer', now() - interval '3 days');
select is((select count(*)::int from public.org_person_affiliations
            where person_id = '63000000-0000-0000-1000-000000000001' and relationship = 'volunteer' and ended_at is not null),
  3, 'several ENDED rows of one relationship coexist');
select is(t063.state(null, 'postgres', $$update public.org_person_affiliations set ended_at = null where id = '63000000-0000-0000-2000-000000000002'$$),
  'ok', 'reopening one ended row is accepted while no open twin exists');

-- ============ 8. cascades (3) ============

delete from public.people where id = '63000000-0000-0000-1000-0000000000c1';
select is((select count(*)::int from public.org_person_affiliations where id = '63000000-0000-0000-2000-0000000000c1'),
  0, 'deleting a person deletes their roster rows');
insert into public.people (id, org_id, display_name, phone) values
  ('63000000-0000-0000-1000-0000000000c2', '63000000-0000-0000-0000-0000000000c0', 'C two', '+67363000022');
insert into public.org_person_affiliations (id, org_id, person_id, relationship) values
  ('63000000-0000-0000-2000-0000000000c2', '63000000-0000-0000-0000-0000000000c0', '63000000-0000-0000-1000-0000000000c2', 'staff');
delete from public.orgs where id = '63000000-0000-0000-0000-0000000000c0';
select is((select count(*)::int from public.org_person_affiliations where org_id = '63000000-0000-0000-0000-0000000000c0'),
  0, 'deleting an organisation deletes its roster rows');
select is((select count(*)::int from public.org_person_affiliations where org_id = '63000000-0000-0000-0000-0000000000b0'),
  1, 'and leaves other organisations'' rows alone');

-- ============ 9. merge_people repoints the roster (spec 3.6) (14) ============
-- case 1: kept a2, merged a3. kept: staff OPEN from 2025-03-01 (id ...0a01), affiliate ENDED.
--         merged: staff OPEN from 2025-01-01 (duplicate, earlier), affiliate OPEN (no twin), judge ENDED twice (no clash).
insert into public.org_person_affiliations (id, org_id, person_id, relationship, started_on, ended_at) values
  ('63000000-0000-0000-2000-000000000a01', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'staff', '2025-03-01', null),
  ('63000000-0000-0000-2000-000000000a02', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', 'affiliate', '2024-01-01', '2024-06-01'),
  ('63000000-0000-0000-2000-000000000a11', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000003', 'staff', '2025-01-01', null),
  ('63000000-0000-0000-2000-000000000a12', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000003', 'affiliate', '2025-02-01', null),
  ('63000000-0000-0000-2000-000000000a13', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000003', 'judge', '2023-01-01', '2023-12-31'),
  ('63000000-0000-0000-2000-000000000a14', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000003', 'judge', '2022-01-01', '2022-12-31');
-- the judge row a14 has a known creation stamp and author, which must survive the move
update public.org_person_affiliations set created_at = '2020-01-01 00:00+00', created_by = '63000000-0000-0000-0000-000000000002'
 where id = '63000000-0000-0000-2000-000000000a14';

-- a non-member cannot merge A's people (the function's own refusal, unchanged)
select is(t063.msg('63000000-0000-0000-0000-000000000004', 'authenticated',
  $$select public.merge_people('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', '63000000-0000-0000-1000-000000000003')$$),
  'merge_people: kept person 63000000-0000-0000-1000-000000000002 not found in org 63000000-0000-0000-0000-0000000000a0',
  'a stranger still cannot merge people of A (refused as before)');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000003'),
  4, 'and the refused merge changed nothing');

set local role authenticated;
set local request.jwt.claim.sub = '63000000-0000-0000-0000-000000000001';
select public.merge_people('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000002', '63000000-0000-0000-1000-000000000003');
reset role;

select is((select count(*)::int from public.people where id = '63000000-0000-0000-1000-000000000003'),
  0, 'the merged person is gone');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000003'),
  0, 'no roster row still points at the merged person');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000002'),
  5, 'the kept person holds 5 rows: their 2 own plus the merged person''s affiliate and two judge rows (the staff duplicate is dropped)');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000002' and relationship = 'staff' and ended_at is null),
  1, 'still exactly one OPEN staff row');
select is((select id from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000002' and relationship = 'staff' and ended_at is null),
  '63000000-0000-0000-2000-000000000a01'::uuid, 'the kept person''s own (earlier) row survives, by its id');
select is((select started_on from public.org_person_affiliations where id = '63000000-0000-0000-2000-000000000a01'),
  '2025-01-01'::date, 'and takes the merged row''s earlier started_on');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000002' and relationship = 'affiliate' and ended_at is null and started_on = '2025-02-01'),
  1, 'the merged person''s OPEN affiliate moved (the kept person''s affiliate row was ENDED, so no clash)');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000002' and relationship = 'judge' and ended_at is not null),
  2, 'both ENDED judge rows moved (ended rows are never dropped, even two of one relationship)');
select is((select count(*)::int from public.org_person_affiliations
            where person_id = '63000000-0000-0000-1000-000000000002' and relationship = 'judge' and ended_at = '2022-12-31'
              and created_at = '2020-01-01 00:00+00' and created_by = '63000000-0000-0000-0000-000000000002'),
  1, 'moved rows keep their dates, creation stamp and author');

-- case 2: kept a4 has an OPEN staff row with NO start date, merged a5 has an OPEN staff row from 2025-06-01: the date is taken
-- case 3: kept a6 has staff from 2025-01-01, merged a7 from 2025-09-01 (later): the kept date stays
-- case 4: kept a8 has an ENDED staff row, merged a9 an OPEN staff row: no clash, the open row moves
insert into public.org_person_affiliations (id, org_id, person_id, relationship, started_on, ended_at) values
  ('63000000-0000-0000-2000-000000000b01', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000004', 'staff', null, null),
  ('63000000-0000-0000-2000-000000000b02', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000005', 'staff', '2025-06-01', null),
  ('63000000-0000-0000-2000-000000000c01', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000006', 'staff', '2025-01-01', null),
  ('63000000-0000-0000-2000-000000000c02', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000007', 'staff', '2025-09-01', null),
  ('63000000-0000-0000-2000-000000000d01', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000008', 'staff', '2024-01-01', '2024-12-31'),
  ('63000000-0000-0000-2000-000000000d02', '63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000009', 'staff', '2025-05-05', null);
set local role authenticated;
set local request.jwt.claim.sub = '63000000-0000-0000-0000-000000000001';
select public.merge_people('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000004', '63000000-0000-0000-1000-000000000005');
select public.merge_people('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000006', '63000000-0000-0000-1000-000000000007');
select public.merge_people('63000000-0000-0000-0000-0000000000a0', '63000000-0000-0000-1000-000000000008', '63000000-0000-0000-1000-000000000009');
reset role;
select is((select started_on from public.org_person_affiliations where id = '63000000-0000-0000-2000-000000000b01'),
  '2025-06-01'::date, 'a kept open row with no start date takes the merged row''s start date');
select is((select started_on from public.org_person_affiliations where id = '63000000-0000-0000-2000-000000000c01'),
  '2025-01-01'::date, 'a kept row that started EARLIER keeps its own date');
select is((select count(*)::int from public.org_person_affiliations where person_id = '63000000-0000-0000-1000-000000000008' and relationship = 'staff'),
  2, 'a merged OPEN row beside the kept person''s ENDED row of the same relationship moves (two rows, one open)');

select * from finish();
rollback;
