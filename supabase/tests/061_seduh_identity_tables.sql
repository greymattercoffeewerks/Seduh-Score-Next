-- T-ID.B1: the Seduh ID identity tables (spec: Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md 3.1, 3.2, 3.5, 3.6).
-- Proves: app.seduh_identities and app.seduh_identity_merges live in `app` (not `public`, so 040/041 need no entry),
-- have RLS on, no policy and no foreign key out of the ledger, and are unreachable by anon, authenticated and
-- service_role for select, insert, update, delete and truncate (and the ledger's sequence); the columns are exactly the
-- spec's; every CHECK, the unique phone, the self reference and the NOT NULLs refuse a bad row with the right SQLSTATE
-- (run as the table owner, each in its own sub-transaction) and the boundary values just inside each limit are accepted;
-- display_name is conditional on status (an opted-out identity holds no name, an active one holds 1 to 120 characters,
-- a merged tombstone holds none or 1 to 120: a DELIBERATE relaxation of spec 3.2 so a merge or an erasure can blank a
-- tombstone's name; recorded in the migration header and the PR for the owner);
-- merged_into is set if and only if the status is 'merged', never to itself, and its target cannot be deleted; the
-- updated_at trigger overwrites a hand-set value; the ledger accepts exactly the four reason codes, holds no phone or
-- name column, and is append-only for the owner too (update, delete, truncate, also under session_replication_role =
-- replica), through triggers that are BEFORE and ENABLE ALWAYS.
-- Not claimed (documented in the migration): the owner can still disable or drop the ledger's triggers.
begin;
select plan(70);

create schema t061;

-- "SQLSTATE" of a statement, or 'ok'; runs as the current role. Each call is its own sub-transaction, so a
-- refused statement leaves nothing behind and an accepted one is rolled back by the savepoint of the exception block
-- only when it raises; accepted fixtures are therefore inserted outside this helper.
create function t061.state(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

-- The same, but as another role (the role is reset afterwards, also on success).
create function t061.state_as(r text, stmt text) returns text language plpgsql as $$
declare s text := 'ok';
begin
  execute format('set local role %I', r);
  begin
    execute stmt;
  exception when others then
    s := sqlstate;
  end;
  reset role;
  return s;
end $$;

-- An accepted statement is undone: state() cannot do it, so this one always raises after running.
create function t061.accepts(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception 'undo' using errcode = 'P0099';
exception
  when sqlstate 'P0099' then return 'ok';
  when others then return sqlstate;
end $$;

-- ============ fixtures (as postgres) ============

insert into app.seduh_identities (id, phone_e164, display_name, source) values
  ('00000000-0000-0000-0000-000000006101', '+6738000611', 'T061 Active One', 'archive'),
  ('00000000-0000-0000-0000-000000006102', '+6738000612', 'T061 Active Two', 'organiser_roster');
insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code) values
  ('00000000-0000-0000-0000-000000006101', '00000000-0000-0000-0000-000000006199',
   '00000000-0000-0000-0000-000000006100', 'duplicate_person');

-- ============ where they live, and how they are locked ============

select ok(to_regclass('app.seduh_identities') is not null and to_regclass('app.seduh_identity_merges') is not null,
  'both tables exist in app');
select ok(to_regclass('public.seduh_identities') is null and to_regclass('public.seduh_identity_merges') is null,
  'neither exists in public (so the tenant matrices 040 and 041 need no entry)');
select is(
  (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname ~* 'seduh_identit'),
  0, 'nothing named like them exists in public in any relation kind');

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), 'none')
     from pg_class c
    where c.oid in ('app.seduh_identities'::regclass, 'app.seduh_identity_merges'::regclass) and not c.relrowsecurity),
  'none', 'row-level security is on for both');
select is(
  (select count(*)::int from pg_policies where schemaname = 'app' and tablename in ('seduh_identities', 'seduh_identity_merges')),
  0, 'neither has a policy');
select is(
  (select coalesce(string_agg(c.relname || '/' || a.grantee::regrole::text, ', ' order by c.relname), 'none')
     from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid in ('app.seduh_identities'::regclass, 'app.seduh_identity_merges'::regclass,
                    'app.seduh_identity_merges_id_seq'::regclass)
      and a.grantee <> c.relowner),
  'none', 'the ACL of each table and of the ledger sequence names only the owner');
select is(
  (select coalesce(string_agg(c.relname || '/' || r, ', ' order by c.relname, r), 'none')
     from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r
    where c.oid in ('app.seduh_identities'::regclass, 'app.seduh_identity_merges'::regclass)
      and has_table_privilege(r, c.oid, 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'anon, authenticated and service_role hold no table privilege on either');
select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_sequence_privilege(r, 'app.seduh_identity_merges_id_seq'::regclass, 'usage,select,update')),
  'none', 'and none holds a privilege on the ledger''s sequence');
select is(
  (select count(*)::int from pg_proc
    where oid = 'app.forbid_seduh_identity_merge_mutation()'::regprocedure
      and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')
           or has_function_privilege('service_role', oid, 'execute'))),
  0, 'the ledger trigger function is executable by no API role');

-- every API role is refused every statement on both tables (42501 comes before any constraint is looked at)
select is(
  (select coalesce(string_agg(r || ' ' || t || ' ' || o.label, ', ' order by r, t, o.label), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          (values ('seduh_identities', 'status'), ('seduh_identity_merges', 'reason_code')) tc(t, col),
          lateral (values
            ('select', 'select count(*) from app.%1$I'),
            ('update', 'update app.%1$I set %2$I = %2$I where false'),
            ('delete', 'delete from app.%1$I where false'),
            ('truncate', 'truncate app.%1$I')) o(label, stmt)
    where t061.state_as(r, format(o.stmt, t, col)) <> '42501'),
  'none', 'anon, authenticated and service_role are refused select, update, delete and truncate on both (42501)');
select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r
    where t061.state_as(r, $q$insert into app.seduh_identities (phone_e164, display_name, source)
                              values ('+6738000699', 'x', 'archive')$q$) <> '42501'),
  'none', 'and every one is refused an insert into app.seduh_identities');
select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r
    where t061.state_as(r, $q$insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code)
                              values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'other')$q$) <> '42501'),
  'none', 'and an insert into app.seduh_identity_merges');
select is(
  (select coalesce(string_agg(r, ', ' order by r), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r
    where t061.state_as(r, 'select nextval(''app.seduh_identity_merges_id_seq'')') <> '42501'),
  'none', 'and nobody can draw from the ledger''s sequence');

-- ============ shape: the columns are the spec''s ============

select is(
  (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || (case when attnotnull then ':nn' else '' end),
                     ', ' order by attnum)
     from pg_attribute where attrelid = 'app.seduh_identities'::regclass and attnum > 0 and not attisdropped),
  'id:uuid:nn, phone_e164:text:nn, display_name:text, country:text, source:text:nn, status:text:nn, '
  'merged_into:uuid, created_at:timestamp with time zone:nn, updated_at:timestamp with time zone:nn',
  'app.seduh_identities has exactly the spec''s columns (no email, no auth.users reference, no number, no do_not_link)');
select is(
  (select string_agg(attname || ':' || format_type(atttypid, atttypmod) || (case when attnotnull then ':nn' else '' end),
                     ', ' order by attnum)
     from pg_attribute where attrelid = 'app.seduh_identity_merges'::regclass and attnum > 0 and not attisdropped),
  'id:bigint:nn, kept_id:uuid:nn, merged_id:uuid:nn, merged_at:timestamp with time zone:nn, merged_by:uuid:nn, reason_code:text:nn',
  'the ledger has exactly the spec''s columns: ids, time, actor and a reason code, no phone and no name');
select is(
  (select coalesce(string_agg(conname || ' -> ' || confrelid::regclass::text, ', '), 'none')
     from pg_constraint where contype = 'f' and conrelid = 'app.seduh_identity_merges'::regclass),
  'none', 'the ledger has no foreign key (kept_id and merged_id are bare uuids, as in person_merges)');
select is(
  (select string_agg(conname || ' -> ' || confrelid::regclass::text || ' ' || confdeltype::text, ', ' order by conname)
     from pg_constraint where contype = 'f' and conrelid = 'app.seduh_identities'::regclass),
  'seduh_identities_merged_into_fkey -> app.seduh_identities r',
  'the identity table has one foreign key, the self reference for the tombstone, ON DELETE RESTRICT');
select is(
  (select string_agg(pg_get_constraintdef(oid), '') from pg_constraint
    where conrelid = 'app.seduh_identities'::regclass and conname = 'seduh_identities_phone_e164_shape'),
  $$CHECK ((phone_e164 ~ '^\+[1-9][0-9]{7,14}$'::text))$$,
  'the phone check is textually the E.164 shape');

-- ============ the identity table''s constraints (as the owner) ============

select is(
  (select id is not null and status = 'active' and created_at = now() and updated_at = now()
     from app.seduh_identities where id = '00000000-0000-0000-0000-000000006101'),
  true, 'defaults: a random id, status active, timestamps now');

-- phone: both length bounds, the first digit, the plus, text, a trailing newline, null, a duplicate
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('6738000620', 'x', 'archive')$$),
  '23514', 'phone without the leading + is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+0738000620', 'x', 'archive')$$),
  '23514', 'phone whose first digit is 0 is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+1234567', 'x', 'archive')$$),
  '23514', 'phone with 7 digits is refused (below the lower bound)');
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+12345678', 'x', 'archive')$$),
  'ok', 'phone with 8 digits is accepted (the lower bound)');
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+123456789012345', 'x', 'archive')$$),
  'ok', 'phone with 15 digits is accepted (the upper bound)');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+1234567890123456', 'x', 'archive')$$),
  '23514', 'phone with 16 digits is refused (above the upper bound)');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+67380006ab', 'x', 'archive')$$),
  '23514', 'phone with letters is refused');
select is(t061.state(format($$insert into app.seduh_identities (phone_e164, display_name, source) values (%L, 'x', 'archive')$$, E'+6738000621\n')),
  '23514', 'phone with a trailing newline is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values (null, 'x', 'archive')$$),
  '23502', 'a null phone is refused (it stays as the suppression record, so it is never null)');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000611', 'Dup', 'archive')$$),
  '23505', 'a second identity for the same phone is refused (unique)');
select is(t061.state($$update app.seduh_identities set phone_e164 = '6738000612x' where id = '00000000-0000-0000-0000-000000006101'$$),
  '23514', 'the phone check also holds on update');

-- source and status vocabularies
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000622', 'x', 'self')$$),
  '23514', 'an unknown source is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000622', 'x', null)$$),
  '23502', 'a null source is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, status) values ('+6738000622', 'x', 'archive', 'deleted')$$),
  '23514', 'an unknown status is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, status) values ('+6738000622', 'x', 'archive', null)$$),
  '23502', 'a null status is refused');

-- display_name conditional on status
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000623', null, 'archive')$$),
  '23514', 'an active identity must have a name: null is refused (a NULL must not slip past the CHECK)');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000623', '', 'archive')$$),
  '23514', 'an active identity must have a name: the empty string is refused');
select is(t061.state(format($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000623', %L, 'archive')$$, repeat('n', 121))),
  '23514', 'a name of 121 characters is refused');
select is(t061.accepts(format($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000623', %L, 'archive')$$, repeat('n', 120))),
  'ok', 'a name of 120 characters is accepted');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, status) values ('+6738000623', 'Named', 'archive', 'opted_out')$$),
  '23514', 'an opted-out identity holds NO name');
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source, status) values ('+6738000623', null, 'archive', 'opted_out')$$),
  'ok', 'an opted-out identity with a blank name is accepted (the phone stays as the suppression record)');
select is(t061.state($$update app.seduh_identities set status = 'opted_out' where id = '00000000-0000-0000-0000-000000006101'$$),
  '23514', 'opting out without blanking the name is refused on update too');

select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source) values ('+6738000623', 'x', 'archive')$$),
  'ok', 'a name of 1 character is accepted (the lower bound)');
select is(t061.state(format($$insert into app.seduh_identities (phone_e164, display_name, source, status, merged_into) values ('+6738000623', %L, 'archive', 'merged', '00000000-0000-0000-0000-000000006101')$$, repeat('n', 121))),
  '23514', 'a merged tombstone''s name of 121 characters is refused');

-- country
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source, country) values ('+6738000624', 'x', 'archive', 'x')$$),
  'ok', 'a country of 1 character is accepted (the lower bound)');
select is(t061.accepts(format($$insert into app.seduh_identities (phone_e164, display_name, source, country) values ('+6738000624', 'x', 'archive', %L)$$, repeat('c', 60))),
  'ok', 'a country of 60 characters is accepted (the upper bound)');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, country) values ('+6738000624', 'x', 'archive', '')$$),
  '23514', 'an empty country is refused');
select is(t061.state(format($$insert into app.seduh_identities (phone_e164, display_name, source, country) values ('+6738000624', 'x', 'archive', %L)$$, repeat('c', 61))),
  '23514', 'a country of 61 characters is refused');
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source, country) values ('+6738000624', 'x', 'archive', 'Brunei')$$),
  'ok', 'a country is optional and accepted when sensible');

-- the tombstone pointer
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source, status, merged_into)
                         values ('+6738000625', null, 'archive', 'merged', '00000000-0000-0000-0000-000000006101')$$),
  'ok', 'a merged tombstone pointing at a real identity is accepted (name may be blank)');
select is(t061.accepts($$insert into app.seduh_identities (phone_e164, display_name, source, status, merged_into)
                         values ('+6738000625', 'Old Name', 'archive', 'merged', '00000000-0000-0000-0000-000000006101')$$),
  'ok', 'and with the name kept');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, status)
                       values ('+6738000625', 'x', 'archive', 'merged')$$),
  '23514', 'status merged without merged_into is refused');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, merged_into)
                       values ('+6738000625', 'x', 'archive', '00000000-0000-0000-0000-000000006101')$$),
  '23514', 'merged_into on a non-merged identity is refused');
select is(t061.state($$insert into app.seduh_identities (id, phone_e164, display_name, source, status, merged_into)
                       values ('00000000-0000-0000-0000-000000006103', '+6738000625', null, 'archive', 'merged',
                               '00000000-0000-0000-0000-000000006103')$$),
  '23514', 'an identity cannot be merged into itself (insert)');
select is(t061.state($$update app.seduh_identities set status = 'merged', display_name = null,
                              merged_into = '00000000-0000-0000-0000-000000006102'
                        where id = '00000000-0000-0000-0000-000000006102'$$),
  '23514', 'an identity cannot be merged into itself (update)');
select is(t061.state($$insert into app.seduh_identities (phone_e164, display_name, source, status, merged_into)
                       values ('+6738000625', null, 'archive', 'merged', gen_random_uuid())$$),
  '23503', 'merged_into must name an existing identity');

-- a tombstone''s target cannot be deleted from under it
insert into app.seduh_identities (id, phone_e164, display_name, source, status, merged_into) values
  ('00000000-0000-0000-0000-000000006104', '+6738000626', null, 'archive', 'merged', '00000000-0000-0000-0000-000000006102');
select is(t061.state($$delete from app.seduh_identities where id = '00000000-0000-0000-0000-000000006102'$$),
  '23503', 'deleting the target of a tombstone is refused (ON DELETE RESTRICT)');

-- updated_at
update app.seduh_identities set updated_at = '2000-01-01', country = 'Brunei' where id = '00000000-0000-0000-0000-000000006101';
select is((select updated_at = now() from app.seduh_identities where id = '00000000-0000-0000-0000-000000006101'),
  true, 'the updated_at trigger overwrites a hand-set value');

-- ============ the ledger ============

select is(t061.state($$insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code)
                       values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'because I said so')$$),
  '23514', 'a free-text reason is refused');
select is(t061.state($$insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code)
                       values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), null)$$),
  '23502', 'a null reason is refused');
select is(
  (select coalesce(string_agg(rc, ', ' order by rc), 'none')
     from unnest(array['duplicate_person', 'phone_changed', 'recycled_number', 'other']) rc
    where t061.accepts(format($$insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code)
                                values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), %L)$$, rc)) <> 'ok'),
  'none', 'each of the four reason codes is accepted');
select is(t061.state($$insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code)
                       values ('00000000-0000-0000-0000-000000006101', '00000000-0000-0000-0000-000000006101', gen_random_uuid(), 'other')$$),
  '23514', 'an identity cannot be merged into itself in the ledger');
select is(t061.state($$insert into app.seduh_identity_merges (kept_id, merged_id, merged_by, reason_code)
                       values (gen_random_uuid(), gen_random_uuid(), null, 'other')$$),
  '23502', 'the acting admin must be recorded');

-- append-only, for the owner, also under replica mode
select is(t061.state($$update app.seduh_identity_merges set reason_code = 'other'$$), '42501', 'UPDATE of the ledger is refused for the owner');
select is(t061.state($$delete from app.seduh_identity_merges$$), '42501', 'DELETE from the ledger is refused for the owner');
select is(t061.state($$truncate app.seduh_identity_merges$$), '42501', 'TRUNCATE of the ledger is refused for the owner');
set local session_replication_role = replica;
select is(t061.state($$update app.seduh_identity_merges set reason_code = 'other'$$), '42501', 'UPDATE is still refused under replica mode');
select is(t061.state($$delete from app.seduh_identity_merges$$), '42501', 'DELETE is still refused under replica mode');
select is(t061.state($$truncate app.seduh_identity_merges$$), '42501', 'TRUNCATE is still refused under replica mode');
set local session_replication_role = origin;
select is((select count(*)::int from app.seduh_identity_merges where merged_id = '00000000-0000-0000-0000-000000006199'),
  1, 'and the fixture row is untouched');
select is(
  (select string_agg(t.tgname, ', ' order by t.tgname)
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'app.seduh_identity_merges'::regclass and not t.tgisinternal
      and t.tgenabled = 'A' and p.proname = 'forbid_seduh_identity_merge_mutation'
      and (t.tgtype & 2) > 0                                   -- BEFORE
      and (((t.tgtype & 1) > 0 and (t.tgtype & 8) > 0 and (t.tgtype & 16) > 0)    -- row: DELETE and UPDATE
        or ((t.tgtype & 1) = 0 and (t.tgtype & 32) > 0))),                         -- statement: TRUNCATE
  'trg_seduh_identity_merges_no_truncate, trg_seduh_identity_merges_no_update_delete',
  'the two guarding triggers are BEFORE, the right kind and ENABLE ALWAYS, and there are no others');

select * from finish();
rollback;
