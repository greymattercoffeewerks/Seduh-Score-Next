-- T-ID.B2: the link between a person and a Seduh ID identity (spec: Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md 3.3, 3.5,
-- 3.6, 4.1; migration 20261030140000_seduh_identity_link.sql).
-- Proves:
--   * GUARD: no API caller can set or change people.global_person_id, by insert or update, NULL to uuid, uuid to uuid,
--     uuid to NULL, with a real or a random uuid (so the FK is never an existence oracle: always the guard's 42501), as a
--     member of one organisation or of two; a no-op write and an unrelated column are fine; the owner needs the
--     transaction-local flag too, and the flag does not help an API role; a number change nulls the link; the flag is not
--     left on after the link function ran.
--   * FK: a value that names no identity is refused (23503), and deleting an identity sets the link null (the owner's
--     delete passes the guard as a referential action, touching nothing else).
--   * LINK FUNCTION: a member links their own person to the identity for the person's phone; it also links an opted_out
--     identity, resolves a merged tombstone (and links nothing through a cycle), creates NOTHING when there is no
--     identity, returns nothing, is idempotent, leaves an owner-blocked person alone until the phone changes, and the
--     two-organisation correlation is the stated one (the same uuid in both). Every refusal (a non-member, a stranger,
--     nobody, a NULL organisation, a NULL person, a missing person, another organisation's person, a two-organisation
--     member mixing the two) is ONE 42501 with ONE message, and none of them changes any row.
--   * ACL AND CATALOG: only authenticated may execute it; the resolver, the guard and the new table are reachable by no API
--     role; the functions that touch the identity tables are exactly the link function; the functions that mention
--     global_person_id are exactly the guard, the link function and the owner-run backfill of T-ID.B4 (no other writer); the trigger and the FK are as
--     specified; merge_people deleting the merged row loses its link and the kept row re-links by phone.
begin;
select plan(66);

create schema t062;
grant usage on schema t062 to anon, authenticated;

-- 'ok', or SQLSTATE || ': ' || message; the statement always runs inside a sub-transaction that is rolled back.
create function t062.attempt(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ': ' || sqlerrm;
end $$;
-- the same, but the statement's effect is kept when it succeeds
create function t062.run(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
create function t062.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function t062.gpi(person int) returns uuid language sql stable as $$
  select global_person_id from public.people where id = t062.u(person)
$$;
grant execute on all functions in schema t062 to anon, authenticated;

-- ============ fixtures (as postgres) ============
-- users 6201 a-only, 6202 b-only, 6203 both, 6204 nobody. organisations 6210 (A) and 6211 (B).

insert into auth.users (id, email) values
  (t062.u(6201), 'u1@t062.seduh-next'), (t062.u(6202), 'u2@t062.seduh-next'),
  (t062.u(6203), 'u3@t062.seduh-next'), (t062.u(6204), 'u4@t062.seduh-next');
insert into orgs (id, name, slug) values (t062.u(6210), 'T062 A', 't062-a'), (t062.u(6211), 'T062 B', 't062-b');
insert into org_members (org_id, user_id, role) values
  (t062.u(6210), t062.u(6201), 'owner'), (t062.u(6211), t062.u(6202), 'owner'),
  (t062.u(6210), t062.u(6203), 'organiser'), (t062.u(6211), t062.u(6203), 'organiser');

-- identities: i1 active, i2 opted_out, i3 a tombstone of i1, i4/i5 a cycle, i6 and i7 for the block case, i8 and i9 for merge_people
insert into app.seduh_identities (id, phone_e164, display_name, source, status) values
  (t062.u(6301), '+6739620001', 'T062 Active', 'archive', 'active'),
  (t062.u(6302), '+6739620002', null, 'archive', 'opted_out'),
  (t062.u(6304), '+6739620004', 'T062 Cycle One', 'archive', 'active'),
  (t062.u(6305), '+6739620005', 'T062 Cycle Two', 'archive', 'active'),
  (t062.u(6306), '+6739620006', 'T062 Blocked', 'archive', 'active'),
  (t062.u(6307), '+6739620007', 'T062 After Phone Change', 'archive', 'active'),
  (t062.u(6308), '+6739620010', 'T062 Merged Row', 'archive', 'active'),
  (t062.u(6309), '+6739620011', 'T062 Kept Row', 'archive', 'active'),
  (t062.u(6311), '+6739620012', 'T062 Block Revival', 'archive', 'active');
insert into app.seduh_identities (id, phone_e164, display_name, source, status, merged_into) values
  (t062.u(6303), '+6739620003', null, 'archive', 'merged', t062.u(6301));
update app.seduh_identities set status = 'merged', merged_into = t062.u(6305), display_name = null where id = t062.u(6304);
update app.seduh_identities set status = 'merged', merged_into = t062.u(6304), display_name = null where id = t062.u(6305);

-- people of A (6401..): active phone, opted-out phone, tombstone phone, cycle phone, no identity, blocked, to-be-changed, merge pair
insert into people (id, org_id, display_name, phone) values
  (t062.u(6401), t062.u(6210), 'A active',     '+6739620001'),
  (t062.u(6402), t062.u(6210), 'A opted out',  '+6739620002'),
  (t062.u(6403), t062.u(6210), 'A tombstone',  '+6739620003'),
  (t062.u(6404), t062.u(6210), 'A cycle',      '+6739620004'),
  (t062.u(6405), t062.u(6210), 'A no identity','+6739620099'),
  (t062.u(6406), t062.u(6210), 'A blocked',    '+6739620006'),
  (t062.u(6407), t062.u(6210), 'A changes number', '+6739620098'),
  (t062.u(6408), t062.u(6210), 'A merged row', '+6739620010'),
  (t062.u(6409), t062.u(6210), 'A kept row',   '+6739620011'),
  (t062.u(6410), t062.u(6210), 'A spare',      '+6739620097'),
  (t062.u(6420), t062.u(6211), 'B same phone as A active', '+6739620001'),
  (t062.u(6421), t062.u(6211), 'B other',      '+6739620096');
-- a linked person for the guard cases (the owner writes the link: flag on, then reset)
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t062.u(6301) where id = t062.u(6410);
select set_config('app.seduh_link_write', '', true);
insert into app.person_link_blocks (person_id, phone_e164) values (t062.u(6406), '+6739620006');

-- ============ GUARD: an API caller can never write the column ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006201';

select is(t062.attempt($$ insert into people (org_id, display_name, phone, global_person_id)
  values ('00000000-0000-0000-0000-000000006210', 'x', '+6739620090', '00000000-0000-0000-0000-000000006301') $$),
  '42501: people.global_person_id is written by the database only', 'insert with a real identity id: the guard refuses');
select is(t062.attempt($$ insert into people (org_id, display_name, phone, global_person_id)
  values ('00000000-0000-0000-0000-000000006210', 'x', '+6739620090', gen_random_uuid()) $$),
  '42501: people.global_person_id is written by the database only',
  'insert with a random uuid: the SAME refusal (never the FK''s 23503, so no existence oracle)');
select is(t062.attempt($$ insert into people (org_id, display_name, phone, global_person_id)
  values ('00000000-0000-0000-0000-000000006210', 'x', '+6739620090', null) $$),
  'ok', 'insert with NULL is an ordinary insert');
select is(t062.attempt($$ update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '42501: people.global_person_id is written by the database only', 'update NULL to a real identity id: refused');
select is(t062.attempt($$ update people set global_person_id = gen_random_uuid() where id = '00000000-0000-0000-0000-000000006405' $$),
  '42501: people.global_person_id is written by the database only', 'update NULL to a random uuid: the same refusal');
select is(t062.attempt($$ update people set global_person_id = '00000000-0000-0000-0000-000000006307' where id = '00000000-0000-0000-0000-000000006410' $$),
  '42501: people.global_person_id is written by the database only', 'update uuid to another uuid: refused');
select is(t062.attempt($$ update people set global_person_id = null where id = '00000000-0000-0000-0000-000000006410' $$),
  '42501: people.global_person_id is written by the database only', 'update uuid to NULL: refused (an API caller cannot unlink either)');
select is(t062.attempt($$ update people set global_person_id = global_person_id, display_name = 'renamed' where id = '00000000-0000-0000-0000-000000006410' $$),
  'ok', 'a no-op write of the same value and an unrelated column are fine');
select is(t062.attempt($$ update people set display_name = 'renamed' where id = '00000000-0000-0000-0000-000000006410' $$),
  'ok', 'an unrelated edit of a linked row is fine');
-- the flag does not help an API role
select is(t062.attempt($$ select set_config('app.seduh_link_write', 'on', true);
    update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '42501: people.global_person_id is written by the database only', 'an API caller who sets the flag themselves is still refused (the role backstop)');

-- the other API roles: the flag does not help service_role either (anon has no UPDATE on people at all)
reset role;
-- whichever wall answers first (the guard, a table privilege or the row-level-security helper; this differs between a
-- local reset and a fresh CI build), the write is refused with 42501 and the row is unchanged
select matches(t062.attempt($$ set local role service_role; select set_config('app.seduh_link_write', 'on', true);
    update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '^42501: (people\.global_person_id is written by the database only|permission denied for .*)$',
  'service_role with the flag set is refused with 42501');
select matches(t062.attempt($$ set local role anon; select set_config('app.seduh_link_write', 'on', true);
    update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '^42501: (people\.global_person_id is written by the database only|permission denied for .*)$',
  'anon with the flag set is refused with 42501');
-- the owner clearing a link WITHOUT the flag at depth 1 is refused (the FK carve-out needs a nested call)
select is(t062.attempt($$ update people set global_person_id = null where id = '00000000-0000-0000-0000-000000006410' $$),
  '42501: people.global_person_id is written by the database only', 'the owner clearing a link without the flag is refused (the nested-depth carve-out does not apply at depth 1)');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006201';
-- a member of TWO organisations
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006203';
select is(t062.attempt($$ update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '42501: people.global_person_id is written by the database only', 'a two-organisation member cannot set it either (NULL to uuid)');
select is(t062.attempt($$ update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006421' $$),
  '42501: people.global_person_id is written by the database only', '...nor on the other organisation''s person');
select is(t062.attempt($$ update people set global_person_id = (select global_person_id from public.people where id = '00000000-0000-0000-0000-000000006410')
    where id = '00000000-0000-0000-0000-000000006421' $$),
  '42501: people.global_person_id is written by the database only', '...nor copy one organisation''s link onto the other''s person (uuid to uuid)');
reset role;

-- a number change nulls the link (as a plain member, through a direct update: update_roster_entry does the same update)
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006201';
update people set phone = '+6739620095' where id = t062.u(6410);
reset role;
select is(t062.gpi(6410), null, 'changing a person''s phone sets the link to NULL (a stale link must not survive)');
select is((select phone from people where id = t062.u(6410)), '+6739620095', '...and the phone change itself went through');

-- the owner: the flag is required, the flag works, and it is not left on
select is(t062.attempt($$ update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '42501: people.global_person_id is written by the database only', 'the owner too must raise the flag (deny by default)');
select is(t062.attempt($$ select set_config('app.seduh_link_write', 'on', true);
    update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  'ok', 'the owner with the transaction-local flag may write it');
select is(t062.attempt($$ select set_config('app.seduh_link_write', 'on', true);
    update people set global_person_id = gen_random_uuid() where id = '00000000-0000-0000-0000-000000006405' $$),
  '23503: insert or update on table "people" violates foreign key constraint "people_global_person_id_fkey"',
  'the foreign key refuses an identity that does not exist (23503), for the one writer that can reach it');

-- ============ FK: deleting an identity sets the link null ============

select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t062.u(6307) where id = t062.u(6407);
select set_config('app.seduh_link_write', '', true);
select is(t062.gpi(6407), t062.u(6307), 'fixture: a person linked to identity 6307');
delete from app.seduh_identities where id = t062.u(6307);
select is(t062.gpi(6407), null, 'the owner deleting that identity sets the link to NULL (ON DELETE SET NULL passes the guard as a referential action)');
select is((select phone from people where id = t062.u(6407)), '+6739620098', '...and changes nothing else on the person');

-- ============ LINK FUNCTION ============

select is((select prorettype::regtype::text from pg_proc where oid = 'public.link_person_identity(uuid,uuid)'::regprocedure), 'void',
  'link_person_identity returns nothing (found / not found is not revealed by the return)');

create temp table identity_count on commit drop as select count(*)::int as n from app.seduh_identities;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006201';
select public.link_person_identity(t062.u(6210), t062.u(6401));
select public.link_person_identity(t062.u(6210), t062.u(6402));
select public.link_person_identity(t062.u(6210), t062.u(6403));
select public.link_person_identity(t062.u(6210), t062.u(6404));
select public.link_person_identity(t062.u(6210), t062.u(6405));
select public.link_person_identity(t062.u(6210), t062.u(6406));
reset role;
select is(t062.gpi(6401), t062.u(6301), 'a member links their own person to the active identity for the phone');
select is(t062.gpi(6402), t062.u(6302), 'an opted_out identity is linked too (inert): the link cannot tell which phones objected');
select is(t062.gpi(6403), t062.u(6301), 'a merged tombstone resolves through merged_into to the identity it was merged into');
select is(t062.gpi(6404), null, 'a merged_into CYCLE links nothing and raises nothing (bounded)');
select is(t062.gpi(6405), null, 'a phone with no identity stays unlinked');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739620099'), 0, '...and the function created NO identity for it');
select is((select count(*)::int from app.seduh_identities), (select n from identity_count), '...and no link call created an identity anywhere (count unchanged)');
-- the write flag is not left on by the link function: read it straight after the calls above, with nothing resetting it
select is(coalesce(current_setting('app.seduh_link_write', true), ''), '', 'the link function does not leave the write flag on in the caller''s transaction');
select is(t062.gpi(6406), null, 'an owner-blocked person is left unlinked');

-- idempotent
set local role authenticated;
select public.link_person_identity(t062.u(6210), t062.u(6401));
reset role;
select is(t062.gpi(6401), t062.u(6301), 'calling it again changes nothing (idempotent)');
select is(t062.attempt($$ update people set global_person_id = '00000000-0000-0000-0000-000000006301' where id = '00000000-0000-0000-0000-000000006405' $$),
  '42501: people.global_person_id is written by the database only', 'so a later write in the same transaction is refused again');

-- the block lapses when the phone changes; the person's NEW number is then found
set local role authenticated;
update people set phone = '+6739620007' where id = t062.u(6406);
select public.link_person_identity(t062.u(6210), t062.u(6406));
reset role;
-- identity 6307 was deleted above (the FK case), so use the recreated one
select is(t062.gpi(6406), null, 'a changed number is looked up afresh (identity 6307 was deleted, so still unlinked)');
insert into app.seduh_identities (id, phone_e164, display_name, source) values (t062.u(6307), '+6739620007', 'T062 Recreated', 'archive');
set local role authenticated;
select public.link_person_identity(t062.u(6210), t062.u(6406));
reset role;
select is(t062.gpi(6406), t062.u(6307), 'the old block (for the old phone) no longer applies once the phone changed');

-- a block for an old number does not revive when the number comes back
insert into app.person_link_blocks (person_id, phone_e164) values (t062.u(6410), '+6739620095');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006201';
update people set phone = '+6739620012' where id = t062.u(6410);
select public.link_person_identity(t062.u(6210), t062.u(6410));   -- phone differs from the block's: the block is dropped, and the link is made
reset role;
select is((select count(*)::int from app.person_link_blocks where person_id = t062.u(6410)), 0, 'a link call drops a block written for an earlier number');
select is(t062.gpi(6410), t062.u(6311), '...and links the person by the number they now hold');
-- the race: the function locks the person row and re-checks the phone in its update (two sessions cannot be driven from pgTAP)
select ok((select prosrc ~* 'for update' and prosrc ~* 'phone = v_phone' from pg_proc where oid = 'public.link_person_identity(uuid,uuid)'::regprocedure),
  'link_person_identity locks the person row and re-checks the phone in its update (a concurrent number change cannot leave a stale link)');

-- two organisations: the stated correlation
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006203';
set local role authenticated;
select public.link_person_identity(t062.u(6211), t062.u(6420));
reset role;
select is(t062.gpi(6420), t062.u(6301), 'ACCEPTED SIGNAL: the same phone in two organisations gets the SAME uuid (a two-organisation member can correlate)');

-- ============ every refusal is one 42501 with one message, and changes nothing ============

create temp table refusals (who text, what text, outcome text) on commit drop;
grant all on refusals to anon, authenticated;
create procedure t062.refuse(who text, uid int, what text, org uuid, person uuid) language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', t062.u(uid)::text, true);
  insert into refusals values (who, what, t062.attempt(format('select public.link_person_identity(%L, %L)', org, person)));
end $$;
grant execute on procedure t062.refuse(text, int, text, uuid, uuid) to authenticated;

set local role authenticated;
call t062.refuse('b only', 6202, 'a stranger names A and A''s person', t062.u(6210), t062.u(6405));
call t062.refuse('nobody', 6204, 'nobody names A and A''s person', t062.u(6210), t062.u(6405));
call t062.refuse('a only', 6201, 'a member of A names A and B''s person', t062.u(6210), t062.u(6421));
call t062.refuse('a only', 6201, 'a member of A names B and B''s person', t062.u(6211), t062.u(6421));
call t062.refuse('a only', 6201, 'a member of A names A and a missing person', t062.u(6210), gen_random_uuid());
call t062.refuse('a only', 6201, 'a member of A names A and a NULL person', t062.u(6210), null);
call t062.refuse('a only', 6201, 'a member of A names a NULL organisation', null, t062.u(6405));
call t062.refuse('a only', 6201, 'a member of A names a missing organisation', gen_random_uuid(), t062.u(6405));
call t062.refuse('both', 6203, 'a two-organisation member names A and B''s person', t062.u(6210), t062.u(6421));
call t062.refuse('both', 6203, 'a two-organisation member names B and A''s person', t062.u(6211), t062.u(6405));
call t062.refuse('both', 6203, 'a two-organisation member names B and a missing person', t062.u(6211), gen_random_uuid());
reset role;

select is((select count(*)::int from refusals), 11, 'eleven refusal shapes were tried');
select is((select count(distinct outcome)::int from refusals), 1, 'and ALL of them gave the same outcome (SQLSTATE and message)');
select is((select min(outcome) from refusals), '42501: new row violates row-level security policy for table "people"',
  'which is the standard 42501 row-level security refusal');
select is(t062.gpi(6405), null, 'no refused call linked anything (A''s person)');
select is(t062.gpi(6421), null, 'no refused call linked anything (B''s person)');

-- ============ ACL: who can run what ============

select is(has_function_privilege('authenticated', 'public.link_person_identity(uuid,uuid)', 'execute'), true, 'authenticated may execute the link function');
select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'service_role', 'public']) r
            where has_function_privilege(r, 'public.link_person_identity(uuid,uuid)', 'execute')),
  'none', 'anon, service_role and PUBLIC may not');
select is(t062.attempt($$ set local role anon; select public.link_person_identity(gen_random_uuid(), gen_random_uuid()) $$),
  '42501: permission denied for function link_person_identity', 'anon calling it is refused at the door');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'app') and p.prokind in ('f', 'p')
      and p.prosrc ~* '(seduh_identities|seduh_identity_merges|person_link_blocks)'),
  'link_person_identity(uuid,uuid)',
  'the functions outside app that touch the Seduh ID tables are exactly the link function (a second writer or reader must be added here on purpose)');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and p.prokind in ('f', 'p')
      and p.prosrc ~* 'app\.(seduh_identit|person_link_blocks)'
      and not (p.prosecdef and p.proconfig @> array['search_path=""'])),
  'none', 'every function that touches them is SECURITY DEFINER with search_path pinned to the empty string');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 't062') and p.prokind in ('f', 'p')
      and p.prosrc ~* 'global_person_id'),
  'app.guard_people_global_person_id(), app.seduh_backfill_plan_internal(uuid[]), app.seduh_identity_backfill(boolean,uuid[]), link_person_identity(uuid,uuid)',
  'NO OTHER function mentions people.global_person_id: the guard, the link function and the owner-run backfill (064) write it; its read-only plan helper only reads it');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
    where p.oid in ('app.org_id_for_person_internal(uuid)'::regprocedure, 'app.guard_people_global_person_id()'::regprocedure)
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the resolver and the guard are executable by no API role (PUBLIC included)');
select is((select prosecdef from pg_proc where oid = 'app.org_id_for_person_internal(uuid)'::regprocedure), true, 'the resolver is SECURITY DEFINER (the _internal pattern)');
select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, 'app.person_link_blocks', 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'app.person_link_blocks is reachable by no API role');
select is((select relrowsecurity from pg_class where oid = 'app.person_link_blocks'::regclass), true, '...with row-level security on and no policy');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'person_link_blocks'), 0, '(no policy)');

-- ============ the trigger and the foreign key are as specified ============

select is(
  (select t.tgname || '/' || t.tgenabled::text || '/' || (t.tgtype & 1) || '/' || (t.tgtype & 2) || '/' || (t.tgtype & 4) || '/' || (t.tgtype & 16)
     from pg_trigger t where t.tgrelid = 'public.people'::regclass and t.tgname = 'trg_people_global_person_id_guard'),
  'trg_people_global_person_id_guard/O/1/2/4/16',
  'the guard is an enabled BEFORE ROW trigger on INSERT and UPDATE of people');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.people'::regclass and tgname = 'trg_people_org_immutable'), 1,
  'the existing org_id freeze trigger on people is still there');
select is((select confdeltype::text || '/' || confrelid::regclass::text from pg_constraint where conname = 'people_global_person_id_fkey'),
  'n/app.seduh_identities', 'the foreign key points at app.seduh_identities and is ON DELETE SET NULL');
select is((select attnotnull from pg_attribute where attrelid = 'public.people'::regclass and attname = 'global_person_id'), false, 'and the column is still nullable');

-- ============ merge_people deletes the merged row and its link; the kept row re-links by phone ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006201';
select public.link_person_identity(t062.u(6210), t062.u(6408));
reset role;
select is(t062.gpi(6408), t062.u(6308), 'fixture: the person that will be merged away is linked');
set local role authenticated;
select public.merge_people(t062.u(6210), t062.u(6409), t062.u(6408));
reset role;
select is((select count(*)::int from people where id = t062.u(6408)), 0, 'merge_people deleted the merged row, and its link went with it');
select is(t062.gpi(6409), null, 'the kept row was not linked by the merge');
set local role authenticated;
select public.link_person_identity(t062.u(6210), t062.u(6409));
reset role;
select is(t062.gpi(6409), t062.u(6309), 'the next link call links the kept row by its own phone');

select * from finish();
rollback;
