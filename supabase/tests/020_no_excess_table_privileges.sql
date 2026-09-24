-- Hardening: the API roles hold no TRUNCATE / REFERENCES / TRIGGER / MAINTAIN on any public table,
-- new tables do not inherit them, and the real access model (SELECT/INSERT/UPDATE/DELETE per table)
-- is untouched.
--
-- This doubles as a regression guard for FUTURE migrations: a later migration that creates a table
-- and explicitly `grant all`s it to anon/authenticated, or that resets default privileges, fails here.
begin;
select plan(10);

-- 1. no public table or view grants any of the four to anon or authenticated
select is(
  (select coalesce(array_agg(c.relname || ':' || r.rolname || ':' || p.priv order by c.relname, r.rolname, p.priv), '{}'::text[])
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     cross join (values ('anon'), ('authenticated')) as r(rolname)
     cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as p(priv)
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(r.rolname, c.oid, p.priv)),
  '{}'::text[],
  'anon and authenticated hold no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any public table or view');

-- 2. the default privileges no longer hand them to future tables
select is(
  (select coalesce(array_agg(pg_get_userbyid(a.grantee) || ':' || a.privilege_type order by 1), '{}'::text[])
     from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace and n.nspname = 'public'
     cross join lateral aclexplode(d.defaclacl) a
    where d.defaclobjtype = 'r'
      and pg_get_userbyid(d.defaclrole) = 'postgres'
      and pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
      and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')),
  '{}'::text[],
  'postgres''s default privileges in public no longer grant them to anon/authenticated');

-- 3. and a table created now really does not receive them (the default is what protects tomorrow's table)
create table public._priv_probe (id int);
select is(
  (select array_agg(p.priv order by p.priv)
     from (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as p(priv)
     cross join (values ('anon'), ('authenticated')) as r(rolname)
    where has_table_privilege(r.rolname, 'public._priv_probe', p.priv)),
  null,
  'a table created by a later migration does not inherit any of the four');
drop table public._priv_probe;

-- 4. the real access model is unchanged: spot-check the grants each public surface depends on
select ok(has_table_privilege('anon', 'public.guesses', 'INSERT'), 'anon can still insert a guess');
select ok(has_table_privilege('anon', 'public.contacts', 'INSERT'), 'anon can still insert a contact');
select ok(has_table_privilege('authenticated', 'public.sessions', 'UPDATE'), 'a signed-in creator can still update a session');
select ok(has_table_privilege('authenticated', 'public.ct_results', 'INSERT')
          and has_table_privilege('authenticated', 'public.ct_results', 'UPDATE')
          and has_table_privilege('authenticated', 'public.ct_results', 'DELETE'), 'organisers can still write results');
select ok(has_table_privilege('anon', 'public.public_results', 'SELECT'), 'anon can still read the public results archive');
select ok(has_table_privilege('anon', 'public.live_sessions', 'SELECT'), 'anon can still read live sessions');
select ok(has_table_privilege('authenticated', 'public.score_change_log', 'SELECT')
          and not has_table_privilege('authenticated', 'public.score_change_counts', 'SELECT'),
  'the score log is still readable by signed-in users and its counter is still unreadable');
-- (service_role is deliberately out of scope: it is the trusted server-side key. Not asserted either way.)

select * from finish();
rollback;
