-- T-ID.C3: the platform operator's counts-only view of Seduh ID (owner decision 7a: counts only; migration
-- 20261031110000_admin_seduh_id_counts.sql).
-- Proves:
--   * public.admin_seduh_id_counts() refuses every caller but a platform admin at aal2 with a fresh TOTP, with the exact
--     SQLSTATE and the hint the console translates (anon; a non-admin; an admin at aal1; aal2 with no TOTP; a stale TOTP;
--     a password-only "fresh" proof; an admin whose session row has ended), and a refused call writes nothing;
--   * an admin gets ONE row of integers and nothing else: every result column is an integer, the column list is
--     pinned (a name, phone, id, email or per-organisation figure added later fails here), and the body mentions only the
--     two identity relations, people and the gate;
--   * the counts are right on fixtures that include a merged tombstone, orphans (one opted out), two people sharing one
--     identity, a blocked person (a live block counts; a block that lapsed after a phone change, and a person with no
--     block, do not). The local database is shared with other sessions, so every figure is a DELTA against
--     a baseline read as the owner before the fixtures; the whole row is also compared with the same questions asked directly;
--   * the statuses add up to the total and so do the sources, and a tombstone is never counted as an orphan;
--   * a call changes and logs nothing (no audit row), it is STABLE, SECURITY DEFINER with search_path '', and only
--     `authenticated` may execute it (anon, service_role and PUBLIC may not).
begin;
select plan(43);

create schema t065;
grant usage on schema t065 to anon, authenticated, service_role;

create function t065.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000650' || lpad(n::text, 4, '0'))::uuid
$$;

create function t065.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
declare c jsonb := jsonb_build_object('role', 'authenticated');
begin
  if uid is not null then c := c || jsonb_build_object('sub', uid, 'session_id', uid); end if;
  if aal is not null then c := c || jsonb_build_object('aal', aal); end if;
  if totp_age is not null then
    c := c || jsonb_build_object('amr', jsonb_build_array(
      jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - totp_age)));
  end if;
  perform set_config('request.jwt.claims', c::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
end $$;

-- Runs a statement as one kind of caller and reports "SQLSTATE|hint" or 'ok'; always restores the role.
create function t065.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t065.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t065.claims(t065.u(2), 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t065.claims(t065.u(1), 'aal1');
    elsif kind = 'admin_no_totp' then perform t065.claims(t065.u(1), 'aal2');
    elsif kind = 'admin_stale_totp' then perform t065.claims(t065.u(1), 'aal2', 7200);
    elsif kind = 'admin_pw_fresh' then
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', t065.u(1), 'session_id', t065.u(1),
        'aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 10)))::text, true);
      perform set_config('request.jwt.claim.sub', t065.u(1)::text, true);
    elsif kind = 'admin_ended_session' then perform t065.claims(t065.u(3), 'aal2', 10);
    elsif kind = 'admin_ok' then perform t065.claims(t065.u(1), 'aal2', 10);
    else raise exception 'unknown caller kind %', kind;
    end if;
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := sqlstate || '|' || coalesce(h, '');
  end;
  perform set_config('role', 'none', true);
  return res;
end $$;
grant execute on function t065.claims(uuid, text, int), t065.run_as(text, text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- u(1) admin, u(2) non-admin, u(3) admin whose session row is gone (signed out everywhere)
insert into auth.users (id, email) values
  (t065.u(1), 't065-admin@test.seduh-next'), (t065.u(2), 't065-nonadmin@test.seduh-next'), (t065.u(3), 't065-ended@test.seduh-next');
insert into app.platform_admins (user_id, note) values (t065.u(1), 't065 admin'), (t065.u(3), 't065 ended admin');
insert into auth.sessions (id, user_id, aal) values (t065.u(1), t065.u(1), 'aal2'), (t065.u(2), t065.u(2), 'aal2');

-- the baseline: the shared local database may hold other sessions' identities and people
create table t065.base as
  select (select count(*) from app.seduh_identities) as ids,
         (select count(*) from app.seduh_identities where status = 'active') as active,
         (select count(*) from app.seduh_identities where status = 'opted_out') as opted_out,
         (select count(*) from app.seduh_identities where status = 'merged') as merged,
         (select count(*) from app.seduh_identities where source = 'organiser_roster') as roster,
         (select count(*) from app.seduh_identities where source = 'archive') as archive,
         (select count(*) from app.seduh_identities i where i.status <> 'merged'
            and not exists (select 1 from public.people p where p.global_person_id = i.id)) as orphan,
         (select count(*) from public.people) as people,
         (select count(*) from public.people where global_person_id is not null) as linked,
         (select count(*) from app.person_link_blocks b join public.people p on p.id = b.person_id and p.phone = b.phone_e164) as blocked,
         (select coalesce(max(id), 0) from app.admin_audit_log) as mid;

insert into orgs (id, name, slug) values (t065.u(100), 'T065 A', 't065-a'), (t065.u(101), 'T065 B', 't065-b');
-- i1 active/archive (linked), i2 active/roster (ORPHAN), i3 opted_out/archive (linked), i4 opted_out/roster (ORPHAN),
-- i5 merged tombstone of i1 (no person: NOT an orphan), i6 active/archive (linked by two people)
insert into app.seduh_identities (id, phone_e164, display_name, source, status) values
  (t065.u(201), '+6739650001', 'T065 One', 'archive', 'active'),
  (t065.u(202), '+6739650002', 'T065 Two', 'organiser_roster', 'active'),
  (t065.u(203), '+6739650003', null, 'archive', 'opted_out'),
  (t065.u(204), '+6739650004', null, 'organiser_roster', 'opted_out'),
  (t065.u(206), '+6739650006', 'T065 Six', 'archive', 'active');
insert into app.seduh_identities (id, phone_e164, display_name, source, status, merged_into) values
  (t065.u(205), '+6739650005', null, 'archive', 'merged', t065.u(201));
-- seven people: p1 -> i1, p2 -> i3, p3 and p4 (two organisations) -> i6, p5 unlinked and never blocked, p6 unlinked and
-- blocked (live block), p7 unlinked with a LAPSED block (blocked while holding another phone)
insert into people (id, org_id, display_name, phone) values
  (t065.u(301), t065.u(100), 'P1', '+6739650001'),
  (t065.u(302), t065.u(100), 'P2', '+6739650003'),
  (t065.u(303), t065.u(100), 'P3', '+6739650006'),
  (t065.u(304), t065.u(101), 'P4', '+6739650006'),
  (t065.u(305), t065.u(100), 'P5', '+6739650090'),
  (t065.u(306), t065.u(101), 'P6', '+6739650091'),
  (t065.u(307), t065.u(101), 'P7', '+6739650093');
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t065.u(201) where id = t065.u(301);
update people set global_person_id = t065.u(203) where id = t065.u(302);
update people set global_person_id = t065.u(206) where id in (t065.u(303), t065.u(304));
select set_config('app.seduh_link_write', '', true);
insert into app.person_link_blocks (person_id, phone_e164) values (t065.u(306), '+6739650091'), (t065.u(307), '+6739650092');

-- ============ who may execute it ============
select is(
  (select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'service_role', 'public']) r
    where has_function_privilege(r, 'public.admin_seduh_id_counts()', 'execute')),
  'none', 'anon, service_role and PUBLIC cannot execute it');
select is(has_function_privilege('authenticated', 'public.admin_seduh_id_counts()', 'execute'), true,
  'a signed-in caller can execute it (the gate then decides)');
select is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.admin_seduh_id_counts()'::regprocedure),
  true, 'it is SECURITY DEFINER with search_path pinned to the empty string');
select is((select p.provolatile::text from pg_proc p where p.oid = 'public.admin_seduh_id_counts()'::regprocedure), 's',
  'it is STABLE (a read: it cannot write an audit row, and none is wanted)');
select is((select pronargs::int from pg_proc where oid = 'public.admin_seduh_id_counts()'::regprocedure), 0,
  'it takes no argument (nothing to guess, nothing to look up)');

-- ============ the gate ============
select is(
  t065.run_as(c.kind, 'select * from public.admin_seduh_id_counts()'),
  c.expected,
  'admin_seduh_id_counts as ' || c.kind || ' -> ' || c.expected)
from (values
  ('anon', '42501|'),
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_no_totp', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required'),
  ('admin_pw_fresh', '42501|admin_mfa_required'),
  ('admin_ended_session', '42501|admin_session_ended'),
  ('admin_ok', 'ok')) c(kind, expected)
order by c.kind;
select is(
  (select p.prosrc ~ '^\s*(#variable_conflict[^\n]*\n)?\s*begin\s+perform\s+app\.require_platform_admin\(\);'
     from pg_proc p where p.oid = 'public.admin_seduh_id_counts()'::regprocedure),
  true, 'the body opens with the gate and nothing runs before it');
select is(
  (select array(select distinct m[1] from pg_proc p, regexp_matches(p.prosrc, '\m((?:public|auth|app)\.[a-z_]+)', 'g') m
                 where p.oid = 'public.admin_seduh_id_counts()'::regprocedure order by 1)),
  array['app.person_link_blocks', 'app.require_platform_admin', 'app.seduh_identities', 'public.people'],
  'the body mentions exactly the two identity relations, the people table and the gate (no merge ledger, no organisation, no event)');

-- ============ the shape: integers only ============
select is(
  (select proargnames from pg_proc where oid = 'public.admin_seduh_id_counts()'::regprocedure),
  array['identities_total', 'identities_active', 'identities_opted_out', 'identities_merged', 'identities_from_roster',
        'identities_from_archive', 'identities_orphan', 'people_total', 'people_linked', 'people_blocked'],
  'it returns exactly these ten columns: no name, phone, id, email or per-organisation figure');
select is(
  (select coalesce(string_agg(distinct t::text, ','), 'none') from pg_proc p, unnest(p.proallargtypes) t
    where p.oid = 'public.admin_seduh_id_counts()'::regprocedure),
  '23', 'every column is an int4 (integers only)');
select is(
  (select proargmodes::text from pg_proc where oid = 'public.admin_seduh_id_counts()'::regprocedure),
  '{t,t,t,t,t,t,t,t,t,t}', 'and every one is a table column (no argument, no out parameter hiding another kind)');

-- ============ what an admin gets ============
select t065.claims(t065.u(1), 'aal2', 10);
set local role authenticated;
create temp table got on commit drop as select * from public.admin_seduh_id_counts();
reset role;
select is((select count(*)::int from got), 1, 'exactly one row');
select is((select identities_total::bigint - b.ids from got, t065.base b), 6::bigint, 'identities_total: +6');
select is((select identities_active::bigint - b.active from got, t065.base b), 3::bigint, 'identities_active: +3 (one, two, six)');
select is((select identities_opted_out::bigint - b.opted_out from got, t065.base b), 2::bigint, 'identities_opted_out: +2 (three, four)');
select is((select identities_merged::bigint - b.merged from got, t065.base b), 1::bigint, 'identities_merged: +1 (the tombstone)');
select is((select identities_from_roster::bigint - b.roster from got, t065.base b), 2::bigint, 'identities_from_roster: +2');
select is((select identities_from_archive::bigint - b.archive from got, t065.base b), 4::bigint, 'identities_from_archive: +4');
select is((select identities_orphan::bigint - b.orphan from got, t065.base b), 2::bigint,
  'identities_orphan: +2 (two and four; an opted-out one counts, as in the B4 list; the tombstone does NOT)');
select is((select people_total::bigint - b.people from got, t065.base b), 7::bigint, 'people_total: +7');
select is((select people_linked::bigint - b.linked from got, t065.base b), 4::bigint,
  'people_linked: +4 (two people share one identity: people are counted, not identities)');
select is((select people_blocked::bigint - b.blocked from got, t065.base b), 1::bigint,
  'people_blocked: +1 (the live block counts; the lapsed block and the never-blocked person do not)');
select is((select count(*)::int from app.person_link_blocks where person_id in (t065.u(306), t065.u(307))), 2,
  'the lapsed block really is in the table (so the +1 above is the join at work, not a missing row)');

select is((select identities_active + identities_opted_out + identities_merged = identities_total from got), true,
  'the three statuses add up to the total');
select is((select identities_from_roster + identities_from_archive = identities_total from got), true,
  'the two sources add up to the total');
select is((select (identities_total, identities_active, identities_opted_out, identities_merged, identities_from_roster,
                   identities_from_archive, identities_orphan, people_total, people_linked, people_blocked)::text from got),
  (select (count(*), count(*) filter (where status = 'active'), count(*) filter (where status = 'opted_out'),
           count(*) filter (where status = 'merged'), count(*) filter (where source = 'organiser_roster'),
           count(*) filter (where source = 'archive'),
           count(*) filter (where status <> 'merged' and not exists (select 1 from public.people p where p.global_person_id = i.id)),
           (select count(*) from public.people), (select count(*) from public.people where global_person_id is not null),
           (select count(*) from app.person_link_blocks b join public.people p on p.id = b.person_id and p.phone = b.phone_e164))::text
     from app.seduh_identities i),
  'every figure equals the same question asked directly');
select is((select (identities_total is not null and identities_orphan is not null and people_blocked is not null) from got), true,
  'no figure is null');

-- linking a person to an orphan takes it out of the orphan count
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t065.u(202) where id = t065.u(305);
select set_config('app.seduh_link_write', '', true);
select t065.claims(t065.u(1), 'aal2', 10);
set local role authenticated;
create temp table got2 on commit drop as select * from public.admin_seduh_id_counts();
reset role;
select is((select g2.identities_orphan - g.identities_orphan from got g, got2 g2), -1, 'linking a person to an orphan removes it from the orphan count');
select is((select g2.people_linked - g.people_linked from got g, got2 g2), 1, 'and adds one linked person');
select is((select g2.identities_total - g.identities_total from got g, got2 g2), 0, 'and changes no identity total');

-- ============ it changes and logs nothing ============
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t065.base)), 0,
  'no audit row was written by any call (refused or answered)');
select is((select count(*)::bigint from app.seduh_identities), (select ids + 6 from t065.base), 'no identity was created or removed by the calls');

-- ============ no other door ============
select is(
  (select coalesce(string_agg(r || '/' || t, ', '), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['app.seduh_identities', 'app.person_link_blocks']) t
    where has_table_privilege(r, t, 'select,insert,update,delete,truncate')),
  'none', 'no API role can read or write the identity tables directly');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text collate "C"), 'none')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p') and p.proname like 'admin\_%'
      and p.prosrc ~* '(seduh_identities|seduh_identity_merges|person_link_blocks)'),
  'admin_seduh_id_counts()',
  'the only admin function that touches the Seduh ID tables is the counts function (no merge, no unlink, no lookup from the console)');
select is(
  (select p.prosrc ~* '(display_name|email|name)' from pg_proc p where p.oid = 'public.admin_seduh_id_counts()'::regprocedure),
  false, 'the counts function never names a display name, an email or any name column');
select is(
  (select array(select m[1] from pg_proc p, regexp_matches(p.prosrc, '[a-z_.]*phone[a-z_0-9]*', 'gi') m
                 where p.oid = 'public.admin_seduh_id_counts()'::regprocedure)),
  array['p.phone', 'b.phone_e164'],
  'a phone is named only in the join that tells a live block from a lapsed one, never selected or returned');

select * from finish();
rollback;
