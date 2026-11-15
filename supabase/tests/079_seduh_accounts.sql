-- T-ID2.A2: the schema for claimed Seduh IDs (migration 20261115120000_seduh_accounts.sql; spec:
-- Handoffs and Specs/SEDUH-ID-LAYER2-SPEC-DRAFT.md sections 3, 4, 10, 14.4).
-- Proves, for app.seduh_accounts, app.seduh_profile_settings and app.seduh_claim_links:
--   * they live in `app` (not `public`: the tenant matrices 040/041 have nothing to list), have RLS on, no policy, an ACL
--     naming only the owner, and anon, authenticated and service_role can neither read nor write them (select and insert,
--     each role, each table), nor use the founding-number sequence, nor run their functions;
--   * handle: lower case, 3 to 30 characters, no leading, trailing or doubled hyphen, unique, never changes; every word of
--     the reserved list the task names (and the rest of the list) is refused; boundary lengths 3 and 30 are accepted;
--   * founding number: unique, positive, frozen, never reissued (rows are never deleted or truncated, a closed account keeps
--     its number and handle even when its login is deleted); the sequence starts at 2 so a default insert can never get 1;
--     an explicit 1 is refused unless the owner-assignment switch is on, and then only once;
--   * adult_attested_at is required; claim_method has its vocabulary; closed_at cannot go back to NULL;
--   * settings: one row per account, created by the account insert, with the L2-1 defaults, every value inside its field's
--     vocabulary (identity, café and knockout take no 'organisers');
--   * claim link: token_hash is a 64-hex SHA-256 and unique (a raw token is refused), 72-hour window, single use (one open
--     link per identity, used and revoked are exclusive, a used or revoked link cannot be reopened), org and hash frozen;
--   * identities.country_code is a two-letter upper-case code or NULL, and the free-text country stays;
--   * the migration's own rollback block, run here, removes everything.
-- Not claimed: the owner role can still disable the triggers (stated in the migration); the Phase B functions are not here.
begin;
select plan(142);

create schema t079;
grant usage on schema t079 to anon, authenticated, service_role;
-- service_role has no USAGE on app by default: grant it (rolled back with the test) so a 42501 below can only come from the TABLE privilege
grant usage on schema app to anon, authenticated, service_role;

-- 'ok' (the statement is undone) or SQLSTATE; always rolled back.
create function t079.attempt(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate;
end $$;
-- the same, the effect KEPT when it succeeds
create function t079.run(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
-- as another role; always rolled back
create function t079.attempt_as(r text, stmt text) returns text language plpgsql as $$
declare s text;
begin
  execute format('set local role %I', r);
  s := t079.attempt(stmt);
  reset role;
  return s;
end $$;
create function t079.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- an account insert; extras replace the defaults of the named columns
create function t079.acct(ident int, usr int, handle text, extra_cols text default '', extra_vals text default '')
returns text language sql immutable as $$
  select format('insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at%s) values (%L, %L, %L, ''organiser_link'', now()%s)',
                extra_cols, t079.u(7900 + ident), t079.u(7900 + usr), handle, extra_vals) $$;
create function t079.link(id int, ident int, org int, hash text, extra_cols text default '', extra_vals text default '')
returns text language sql immutable as $$
  select format('insert into app.seduh_claim_links (id, identity_id, org_id, token_hash%s) values (%L, %L, %L, %L%s)',
                extra_cols, t079.u(id), t079.u(7900 + ident), t079.u(org), hash, extra_vals) $$;
create function t079.hash(n int) returns text language sql immutable as $$ select lpad(n::text, 64, '0') $$;
grant execute on all functions in schema t079 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email)
  select t079.u(7900 + n), 'u' || n || '@t079.seduh-next' from generate_series(1, 30) n;
insert into app.seduh_identities (id, phone_e164, display_name, source)
  select t079.u(7900 + n), '+67380079' || lpad(n::text, 2, '0'), 'T079 Person ' || n, 'organiser_roster' from generate_series(1, 30) n;
insert into orgs (id, name, slug) values (t079.u(7981), 'T079 A', 't079-a'), (t079.u(7982), 'T079 B', 't079-b');

-- ============ where they live, and how they are locked ============

select ok(to_regclass('app.seduh_accounts') is not null and to_regclass('app.seduh_profile_settings') is not null
          and to_regclass('app.seduh_claim_links') is not null, 'the three tables exist in app');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname ~* 'seduh_(account|profile|claim)'),
  0, 'nothing like them exists in public (so the tenant matrices 040 and 041 have nothing to list)');
select is((select coalesce(string_agg(c.relname, ', '), 'none') from pg_class c
            where c.oid in ('app.seduh_accounts'::regclass, 'app.seduh_profile_settings'::regclass, 'app.seduh_claim_links'::regclass)
              and not c.relrowsecurity), 'none', 'row-level security is on for all three');
select is((select count(*)::int from pg_policies where schemaname = 'app'
            and tablename in ('seduh_accounts', 'seduh_profile_settings', 'seduh_claim_links')), 0, 'none has a policy');
select is((select coalesce(string_agg(c.relname || '/' || a.grantee::regrole::text, ', '), 'none')
             from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault(c.relkind::"char", c.relowner))) a
            where c.oid in ('app.seduh_accounts'::regclass, 'app.seduh_profile_settings'::regclass,
                            'app.seduh_claim_links'::regclass, 'app.seduh_founding_number_seq'::regclass)
              and a.grantee <> c.relowner), 'none', 'the ACL of each table and of the founding-number sequence names only the owner');
select is((select coalesce(string_agg(t || '/' || r, ', '), 'none')
             from unnest(array['app.seduh_accounts', 'app.seduh_profile_settings', 'app.seduh_claim_links']) t,
                  unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, t, 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'no API role holds any table privilege');
select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_sequence_privilege(r, 'app.seduh_founding_number_seq', 'usage,select,update')),
  'none', 'no API role can use the founding-number sequence');
select is((select coalesce(string_agg(p.proname || '/' || r, ', '), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
            where p.pronamespace = 'app'::regnamespace and p.proname ~ '^seduh_(accounts_|claim_links_|handle_)'
              and has_function_privilege(r, p.oid, 'execute')),
  'none', 'no API role can execute the new app functions');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname ~ '^seduh_(accounts_|claim_links_|handle_)'), 6,
  'the six new app functions exist (so the checks around them cannot pass on an empty set)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname ~ '^seduh_(accounts_|claim_links_|handle_)' and p.prosecdef), 0,
  'none of the new functions is SECURITY DEFINER (so guard 045 has nothing to demand)');

-- every API role, every table: select and insert are refused with 42501
select is((select coalesce(string_agg(r || '/' || t || '/' || verb || ':' || s, ', '), 'none')
             from unnest(array['anon', 'authenticated', 'service_role']) r,
                  unnest(array['seduh_accounts', 'seduh_profile_settings', 'seduh_claim_links']) t,
                  (values ('select', 'select 1 from app.%I'), ('insert', 'insert into app.%I default values')) v(verb, sqlt),
                  lateral (select t079.attempt_as(r, format(v.sqlt, t))) x(s)
            where s <> '42501'),
  'none', 'anon, authenticated and service_role get 42501 on select and insert, on every table');

-- ============ accounts: the handle ============

select is(t079.run(t079.acct(1, 1, 'ahmad-79')), 'ok', 'an account with a valid handle inserts (fixture 1)');
select is((select handle || '/' || claim_method || '/' || (closed_at is null)::text from app.seduh_accounts where identity_id = t079.u(7901)),
  'ahmad-79/organiser_link/true', 'it starts open');

select is(t079.attempt(t079.acct(2, 2, 'ahmad-79')), '23505', 'a duplicate handle is refused');
select is(t079.attempt(t079.acct(1, 2, 'second-79')), '23505', 'a second account for one identity is refused');
select is(t079.attempt(t079.acct(2, 1, 'second-79')), '23505', 'a second account for one login is refused');

select is(t079.attempt(t079.acct(2, 2, 'abc')), 'ok', 'a 3-character handle is accepted');
select is(t079.attempt(t079.acct(2, 2, repeat('a', 30))), 'ok', 'a 30-character handle is accepted');
select is(t079.attempt(t079.acct(2, 2, 'ab')), '23514', 'a 2-character handle is refused');
select is(t079.attempt(t079.acct(2, 2, repeat('a', 31))), '23514', 'a 31-character handle is refused');
select is(t079.attempt(t079.acct(2, 2, 'Ahmad')), '23514', 'an upper-case handle is refused');
select is(t079.attempt(t079.acct(2, 2, '-ahmad')), '23514', 'a leading hyphen is refused');
select is(t079.attempt(t079.acct(2, 2, 'ahmad-')), '23514', 'a trailing hyphen is refused');
select is(t079.attempt(t079.acct(2, 2, 'ah--mad')), '23514', 'a doubled hyphen is refused');
select is(t079.attempt(t079.acct(2, 2, 'ah_mad')), '23514', 'an underscore is refused');
select is(t079.attempt(t079.acct(2, 2, 'ah mad')), '23514', 'a space is refused');
select is(t079.attempt(t079.acct(2, 2, 'ahmäd')), '23514', 'a non-ASCII letter is refused');
select is(t079.attempt(t079.acct(2, 2, 'ah.mad')), '23514', 'a dot is refused');
select is(t079.attempt(t079.acct(2, 2, '007')), 'ok', 'an all-digit handle of 3 is accepted (a path segment, no collision)');

-- the reserved list: the words the task names, each refused with 23514 (and 'abc' above proves the path is not just a length error)
select is((select coalesce(string_agg(w || ':' || t079.attempt(t079.acct(2, 2, w)), ', '), 'none')
             from unnest(array['country', 'admin', 'app', 'results', 'tour', 'community', 'about', 'privacy', 'terms', 'contact',
                               'pricing', 'id', 'api', 'bts', 'tools', 'guess-the-bean', 'me', 'settings']) w
            where length(w) >= 3 and t079.attempt(t079.acct(2, 2, w)) <> '23514'),
  'none', 'every reserved word of 3 or more characters the task names is refused as a handle (23514)');
-- 'id' and 'me' are shorter than 3 characters, so the length check also catches them; the function itself reserves them
select is((select coalesce(string_agg(w, ', '), 'none')
             from unnest(array['country', 'admin', 'app', 'results', 'tour', 'community', 'about', 'privacy', 'terms', 'contact',
                               'pricing', 'id', 'api', 'bts', 'tools', 'guess-the-bean', 'me', 'settings']) w
            where not app.seduh_handle_reserved(w)),
  'none', 'app.seduh_handle_reserved is true for every one of the eighteen words, including id and me');
-- the WHOLE list, read from the function itself: its size is pinned (a shrinking list fails) and every word of three or more
-- characters is refused as a handle (23514)
select is((select count(*)::int from regexp_matches((select prosrc from pg_proc where oid = 'app.seduh_handle_reserved(text)'::regprocedure), '''([a-z0-9-]+)''', 'g')), 55,
  'the reserved list holds 55 words (change this number on purpose when the list is extended)');
select is((select coalesce(string_agg(m[1], ', '), 'none')
             from regexp_matches((select prosrc from pg_proc where oid = 'app.seduh_handle_reserved(text)'::regprocedure), '''([a-z0-9-]+)''', 'g') m
            where not app.seduh_handle_reserved(m[1]) or (length(m[1]) >= 3 and t079.attempt(t079.acct(2, 2, m[1])) <> '23514')),
  'none', 'every word in the list is refused as a handle');
select is((select coalesce(string_agg(w, ', '), 'none') from unnest(array['owner', 'staff', 'security', 'official', 'moderator', 'seduh-score']) w
            where not app.seduh_handle_reserved(w)), 'none', 'the impersonation words (owner, staff, security, official, moderator, seduh-score) are reserved');
select is(app.seduh_handle_reserved('ahmad-79'), false, 'and false for an ordinary handle');
select is(t079.attempt(t079.acct(2, 2, 'country')), '23514', 'the handle that would collide with /id/country/ is refused');

-- the handle never changes
select is(t079.attempt($$ update app.seduh_accounts set handle = 'changed-79' where identity_id = '00000000-0000-0000-0000-000000007901' $$),
  '23001', 'the handle is frozen (23001)');
select is(t079.attempt($$ update app.seduh_accounts set handle = handle where identity_id = '00000000-0000-0000-0000-000000007901' $$),
  'ok', '...but an update that leaves it alone is fine');

select is((select coalesce(string_agg(c, ', '), 'none') from unnest(array['claimed_at', 'claim_method', 'adult_attested_at', 'identity_id', 'id']) c
            where t079.attempt(format('update app.seduh_accounts set %I = %s where identity_id = %L', c,
              case c when 'claimed_at' then 'now() + interval ''1 day''' when 'claim_method' then '''sms'''
                     when 'adult_attested_at' then 'now() + interval ''1 day''' when 'identity_id' then format('%L', t079.u(7920))
                     else 'gen_random_uuid()' end, t079.u(7901))) <> '23001'),
  'none', 'claimed_at, claim_method, adult_attested_at, identity_id and id are frozen (23001)');

-- ============ accounts: founding number ============

select ok((select founding_number from app.seduh_accounts where identity_id = t079.u(7901)) >= 2,
  'a default-driven claim gets a number of 2 or more, never 1');
select is((select seqmin::int from pg_sequence where seqrelid = 'app.seduh_founding_number_seq'::regclass), 2, 'the sequence starts at 2');
select is((select seqcycle from pg_sequence where seqrelid = 'app.seduh_founding_number_seq'::regclass), false, 'and never cycles');
select is(t079.run(t079.acct(2, 2, 'beta-79')), 'ok', 'a second account inserts (fixture 2)');
select ok((select b.founding_number > a.founding_number from app.seduh_accounts a, app.seduh_accounts b
            where a.identity_id = t079.u(7901) and b.identity_id = t079.u(7902)), 'numbers go up');
select is(t079.attempt(t079.acct(3, 3, 'gamma-79', ', founding_number', ', 1')), '42501', 'an explicit 1 is refused (42501)');
select is(t079.attempt(t079.acct(3, 3, 'gamma-79', ', founding_number', ', 0')), '23514', 'an explicit 0 is refused');
select is(t079.attempt(t079.acct(3, 3, 'gamma-79', ', founding_number', ', -5')), '23514', 'a negative number is refused');
select is(t079.attempt(format('select set_config(''app.seduh_owner_assignment'', ''off'', true); %s', t079.acct(3, 3, 'gamma-79', ', founding_number', ', 1'))),
  '42501', 'the switch set to anything but on does not open 1');
select is(t079.attempt(format('select set_config(''app.seduh_owner_assignment'', ''on'', true); %s', t079.acct(3, 3, 'gamma-79', ', founding_number', ', 1'))),
  'ok', 'with the owner-assignment switch on, an explicit 1 is accepted');
select is(t079.attempt(t079.acct(3, 3, 'gamma-79', ', founding_number', format(', %s', (select founding_number from app.seduh_accounts where identity_id = t079.u(7901))))),
  '23505', 'a number already taken is refused');
-- 1 can be used once, ever: with the switch on, a second 1 hits the unique constraint
select is(t079.run(format('select set_config(''app.seduh_owner_assignment'', ''on'', false); %s', t079.acct(3, 3, 'owner-79', ', founding_number', ', 1'))),
  'ok', 'the owner takes 1 (fixture 3)');
select set_config('app.seduh_owner_assignment', 'off', false);
select is(t079.run(t079.acct(4, 4, 'delta-79')), 'ok', 'an ordinary claim after the owner still gets a number above 1 (fixture 4)');
select is((select founding_number from app.seduh_accounts where identity_id = t079.u(7904)) > 1, true, '...never 1');
select is(t079.attempt(format('select set_config(''app.seduh_owner_assignment'', ''on'', true); %s', t079.acct(5, 5, 'epsilon-79', ', founding_number', ', 1'))),
  '23505', 'with the switch on, a second 1 is refused by the unique constraint');
select is((select count(*)::int from app.seduh_accounts where founding_number = 1), 1, 'exactly one account holds 1');
select is(t079.attempt($$ update app.seduh_accounts set founding_number = 99999 where identity_id = '00000000-0000-0000-0000-000000007901' $$),
  '23001', 'the founding number is frozen');

-- never reissued
select is(t079.attempt($$ delete from app.seduh_accounts where identity_id = '00000000-0000-0000-0000-000000007901' $$),
  '42501', 'an account row cannot be deleted');
select is(t079.attempt($$ truncate app.seduh_accounts cascade $$), '42501', 'nor truncated');
select is(t079.attempt($$ set local session_replication_role = replica; delete from app.seduh_accounts $$), '42501',
  '...also under session_replication_role = replica (the trigger is ENABLE ALWAYS)');

-- ============ accounts: the other columns ============

select is(t079.attempt(format('insert into app.seduh_accounts (identity_id, user_id, handle, claim_method) values (%L, %L, ''noadult-79'', ''organiser_link'')',
                              t079.u(7906), t079.u(7906))), '23502', 'adult_attested_at is required (23502)');
select is(t079.attempt(format('insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at) values (%L, %L, ''noadult-79'', ''organiser_link'', null)',
                              t079.u(7906), t079.u(7906))), '23502', '...an explicit NULL too');
select is(t079.attempt(format('insert into app.seduh_accounts (identity_id, user_id, handle, adult_attested_at) values (%L, %L, ''nometh-79'', now())',
                              t079.u(7906), t079.u(7906))), '23502', 'claim_method is required');
select is(t079.attempt(replace(t079.acct(6, 6, 'sms-79'), '''organiser_link''', '''sms''')), 'ok', 'claim_method sms (reserved) is accepted');
select is(t079.attempt(replace(t079.acct(6, 6, 'bad-79'), '''organiser_link''', '''email''')), '23514', 'an unknown claim_method is refused');
select is(t079.attempt(t079.acct(6, 6, 'early-79', ', closed_at', ', now() - interval ''1 day''')), '23514', 'closed_at before claimed_at is refused');
select is(t079.attempt(format('insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at) values (%L, null, ''nouser-79'', ''organiser_link'', now())',
                              t079.u(7906))), '23514', 'an open account must have a login (user_or_closed)');
select is(t079.attempt(format('insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at, closed_at) values (%L, null, ''nouser-79'', ''organiser_link'', now(), now())',
                              t079.u(7906))), 'ok', '...but a closed one need not');

-- closing: a closed account stays closed, keeps its handle and number, and survives its login being deleted
select is(t079.run(t079.acct(7, 7, 'closing-79')), 'ok', 'an account to close (fixture 7)');
select is(t079.run($$ update app.seduh_accounts set closed_at = now() where identity_id = '00000000-0000-0000-0000-000000007907' $$), 'ok',
  'it closes');
select is(t079.attempt($$ update app.seduh_accounts set closed_at = null where identity_id = '00000000-0000-0000-0000-000000007907' $$), '23001',
  'a closed account cannot be reopened');
select is(t079.attempt($$ update app.seduh_accounts set closed_at = closed_at + interval '1 day' where identity_id = '00000000-0000-0000-0000-000000007907' $$), '23001',
  'nor have its closing date changed');
select is(t079.attempt(t079.acct(8, 8, 'closing-79')), '23505', 'a closed account still holds its handle: nobody else can take it');
select is(t079.run($$ delete from auth.users where id = '00000000-0000-0000-0000-000000007907' $$), 'ok',
  'deleting the login of a closed account works');
select is((select user_id is null and handle = 'closing-79' and founding_number >= 2 from app.seduh_accounts where identity_id = t079.u(7907)), true,
  '...and the row stays, with its handle and number, and no login');
select is(t079.attempt($$ update app.seduh_accounts set user_id = '00000000-0000-0000-0000-000000007909' where identity_id = '00000000-0000-0000-0000-000000007907' $$), '23001',
  'a closed account without a login cannot be given another login');
select is(t079.attempt($$ delete from auth.users where id = '00000000-0000-0000-0000-000000007901' $$), '23514',
  'deleting the login of an OPEN account is refused (close it first)');
select is(t079.attempt($$ delete from app.seduh_identities where id = '00000000-0000-0000-0000-000000007901' $$), '23503',
  'an identity with an account cannot be deleted');

-- ============ settings ============

select is((select count(*)::int from app.seduh_profile_settings), (select count(*)::int from app.seduh_accounts),
  'every account has exactly one settings row, made by the account insert');
select is((select count(*)::int from app.seduh_profile_settings s where s.account_id = (select id from app.seduh_accounts where identity_id = t079.u(7901))), 1,
  '(fixture 1 has its row)');
select is((select concat_ws('/', vis_identity, vis_recorded_results, vis_organiser_results, vis_self_reported_results, vis_judging_roles,
                              vis_cafe_affiliations, vis_knockout_record, listed_on_country_pages)
             from app.seduh_profile_settings where account_id = (select id from app.seduh_accounts where identity_id = t079.u(7901))),
  'public/public/public/public/public/public/public/f', 'the L2-1 defaults: everything public, the country-page listing off');
select is(t079.attempt(format('insert into app.seduh_profile_settings (account_id) values (%L)', (select id from app.seduh_accounts where identity_id = t079.u(7901)))),
  '23505', 'a second settings row for an account is refused');
select is(t079.attempt(format('insert into app.seduh_profile_settings (account_id) values (%L)', t079.u(1))), '23503', 'a settings row needs an account');
select is((select coalesce(string_agg(col || '=' || val || ':' || t079.attempt(format(
              'update app.seduh_profile_settings set %I = %L where account_id = (select id from app.seduh_accounts where identity_id = %L)',
              col, val, t079.u(7901))), ', '), 'none')
             from (values ('vis_identity', 'organisers'), ('vis_identity', 'private'), ('vis_cafe_affiliations', 'organisers'),
                          ('vis_knockout_record', 'organisers'), ('vis_recorded_results', 'private'), ('vis_organiser_results', 'private'),
                          ('vis_self_reported_results', 'private'), ('vis_judging_roles', 'private'), ('vis_recorded_results', 'PUBLIC')) v(col, val)
            where t079.attempt(format('update app.seduh_profile_settings set %I = %L where account_id = (select id from app.seduh_accounts where identity_id = %L)',
                                      col, val, t079.u(7901))) <> '23514'),
  'none', 'a value outside a field''s vocabulary is refused (identity, café, knockout take no organisers; results and roles take only public, organisers, hidden)');
select is((select coalesce(string_agg(col, ', '), 'none')
             from unnest(array['vis_recorded_results', 'vis_organiser_results', 'vis_self_reported_results', 'vis_judging_roles']) col
            where t079.attempt(format('update app.seduh_profile_settings set %I = ''organisers'' where account_id = (select id from app.seduh_accounts where identity_id = %L)',
                                      col, t079.u(7901))) <> 'ok'),
  'none', 'results and judging roles accept organisers');
select is((select coalesce(string_agg(col, ', '), 'none')
             from unnest(array['vis_identity', 'vis_recorded_results', 'vis_organiser_results', 'vis_self_reported_results', 'vis_judging_roles',
                               'vis_cafe_affiliations', 'vis_knockout_record']) col
            where t079.attempt(format('update app.seduh_profile_settings set %I = ''hidden'' where account_id = (select id from app.seduh_accounts where identity_id = %L)',
                                      col, t079.u(7901))) <> 'ok'),
  'none', 'every part can be hidden');
select is(t079.attempt(format('update app.seduh_profile_settings set listed_on_country_pages = null where account_id = (select id from app.seduh_accounts where identity_id = %L)', t079.u(7901))),
  '23502', 'the listing flag is never NULL');
select is(t079.attempt(format('update app.seduh_profile_settings set account_id = %L where account_id = (select id from app.seduh_accounts where identity_id = %L)',
                              (select id from app.seduh_accounts where identity_id = t079.u(7902)), t079.u(7901))), '23001', 'the settings row cannot be moved to another account (frozen)');
select ok((select count(*) = 0 from information_schema.columns where table_schema = 'app' and table_name = 'seduh_profile_settings'
            and column_name ~ '(phone|email|cohort)'), 'no phone, email or cohort column: phone and email are never a setting');

-- ============ country_code on the identity ============

select is(t079.attempt($$ update app.seduh_identities set country_code = 'BN' where id = '00000000-0000-0000-0000-000000007901' $$), 'ok', 'BN is accepted');
select is(t079.attempt($$ update app.seduh_identities set country_code = null where id = '00000000-0000-0000-0000-000000007901' $$), 'ok', 'NULL is accepted');
select is((select coalesce(string_agg(c, ', '), 'none') from unnest(array['bn', 'BRN', 'B', 'B1', ' B', 'BN ', '']) c
            where t079.attempt(format('update app.seduh_identities set country_code = %L where id = %L', c, t079.u(7901))) <> '23514'),
  'none', 'a lower-case, 1- or 3-letter, padded or empty code is refused');
select ok((select count(*) = 1 from information_schema.columns where table_schema = 'app' and table_name = 'seduh_identities' and column_name = 'country'),
  'the free-text country column is still there');

-- ============ the claim link ============

select is(t079.run(t079.link(1, 11, 7981, t079.hash(1))), 'ok', 'a claim link inserts (fixture)');
select is((select (expires_at - created_at) = interval '72 hours' and used_at is null and revoked_at is null from app.seduh_claim_links where id = t079.u(1)), true,
  'it expires after 72 hours and starts open');
select is(t079.attempt(t079.link(2, 12, 7981, 'not-a-hash')), '23514', 'a raw token (not a 64-hex hash) is refused');
select is(t079.attempt(t079.link(2, 12, 7981, repeat('A', 64))), '23514', 'a 64-character UPPER-case hex hash is refused');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(15) || 'a')), '23514', 'an over-long hash is refused');
select is(t079.attempt(t079.link(2, 12, 7981, repeat('g', 64))), '23514', 'a 64-character non-hex token is refused');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(1))), '23505', 'a hash can be stored once');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(2), ', expires_at', ', now() + interval ''73 hours''')), '23514', 'a 73-hour expiry is refused');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(2), ', expires_at', ', now() + interval ''72 hours''')), 'ok', 'exactly 72 hours is accepted');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(2), ', expires_at', ', now()')), '23514', 'an expiry that is not after creation is refused');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(2), ', expires_at', ', now() - interval ''1 hour''')), '23514', 'an expiry in the past of creation is refused');
select is(t079.attempt(t079.link(2, 12, 7981, t079.hash(2), ', issued_by', format(', %L', t079.u(7901)))), 'ok', 'the issuing user is recorded');
select is(t079.attempt(t079.link(2, 12, 7999, t079.hash(2))), '23503', 'the issuing organisation must exist');
select is(t079.attempt(t079.link(2, 99, 7981, t079.hash(2))), '23503', 'the identity must exist');

-- one open link per identity
select is(t079.attempt(t079.link(2, 11, 7982, t079.hash(2))), '23505', 'a second OPEN link for the same identity is refused (even from another organisation)');
select is(t079.attempt(format('update app.seduh_claim_links set revoked_at = now() where id = %L; %s', t079.u(1), t079.link(2, 11, 7982, t079.hash(2)))), 'ok',
  'once the first is revoked, a new one can be issued');
select is(t079.attempt(format('update app.seduh_claim_links set revoked_at = now() where id = %L; %s; %s', t079.u(1),
                              t079.link(2, 11, 7982, t079.hash(2)), t079.link(3, 11, 7982, t079.hash(3)))), '23505', '...but only one at a time');

-- single use: a link is used by recording the account it made
select is(t079.run(t079.acct(11, 11, 'link-user-79')), 'ok', 'an account made through a link (fixture 11)');
select is(t079.attempt(format('update app.seduh_claim_links set used_at = now() where id = %L', t079.u(1))), '23514', 'used without an account is refused');
select is(t079.attempt(format('update app.seduh_claim_links set account_id = %L where id = %L', (select id from app.seduh_accounts where identity_id = t079.u(7911)), t079.u(1))),
  '23514', 'an account without used_at is refused');
select is(t079.run(format('update app.seduh_claim_links set used_at = now(), account_id = %L where id = %L', (select id from app.seduh_accounts where identity_id = t079.u(7911)), t079.u(1))),
  'ok', 'the link is used, with its account');
select is((select count(*)::int from app.seduh_claim_links where used_at is not null and account_id is not null), 1, '(recorded)');
select is(t079.attempt(format('update app.seduh_claim_links set used_at = null, account_id = null where id = %L', t079.u(1))), '23001', 'a used link cannot be reopened');
select is(t079.attempt(format('update app.seduh_claim_links set used_at = used_at + interval ''1 minute'' where id = %L', t079.u(1))), '23001', 'its used_at cannot be rewritten');
select is(t079.attempt(format('update app.seduh_claim_links set account_id = %L where id = %L', (select id from app.seduh_accounts where identity_id = t079.u(7901)), t079.u(1))), '23001',
  'nor repointed at another account');
select is(t079.attempt(format('update app.seduh_claim_links set revoked_at = now() where id = %L', t079.u(1))), '23514', 'a used link cannot be revoked');
select is(t079.attempt(t079.link(4, 12, 7981, t079.hash(4), ', used_at, account_id', format(', now(), %L', (select id from app.seduh_accounts where identity_id = t079.u(7904))))),
  '23503', 'a link cannot name another identity''s account (composite foreign key)');
select is(t079.attempt(t079.link(4, 12, 7981, t079.hash(4), ', used_at, account_id', format(', now(), %L', (select id from app.seduh_accounts where identity_id = t079.u(7911))))),
  '23505', 'one account is made by at most one link');
select is(t079.attempt(t079.link(4, 4, 7981, t079.hash(4), ', created_at, expires_at, used_at, account_id',
            format(', now() - interval ''4 days'', now() - interval ''1 day'', now(), %L', (select id from app.seduh_accounts where identity_id = t079.u(7904))))),
  '23514', 'a link that has expired cannot be used (used_at after expires_at)');
select is(t079.attempt(t079.link(4, 4, 7981, t079.hash(4), ', used_at, account_id',
            format(', now() - interval ''1 minute'', %L', (select id from app.seduh_accounts where identity_id = t079.u(7904))))),
  '23514', 'a link cannot be used before it was created');
select is(t079.attempt(t079.link(4, 12, 7981, t079.hash(4), ', used_at, revoked_at, account_id', format(', now(), now(), %L', (select id from app.seduh_accounts where identity_id = t079.u(7904))))),
  '23514', 'a link cannot be both used and revoked');
-- revoke, then no un-revoke
select is(t079.run(t079.link(5, 13, 7981, t079.hash(5))), 'ok', 'another open link (fixture)');
select is(t079.run(format('update app.seduh_claim_links set revoked_at = now() where id = %L', t079.u(5))), 'ok', 'it is revoked');
select is(t079.attempt(format('update app.seduh_claim_links set revoked_at = null where id = %L', t079.u(5))), '23001', 'a revoked link cannot be reopened');
select is(t079.attempt(format('update app.seduh_claim_links set revoked_at = now() + interval ''1 day'' where id = %L', t079.u(5))), '23001', 'nor re-dated');
select is(t079.run(t079.link(6, 13, 7981, t079.hash(6))), 'ok', 'a new link after a revoke works (fixture)');

-- frozen parent and credential
select is(t079.attempt(format('update app.seduh_claim_links set org_id = %L where id = %L', t079.u(7982), t079.u(6))), '23001', 'the issuing organisation is frozen (tenancy rule)');
select is(t079.attempt(format('update app.seduh_claim_links set identity_id = %L where id = %L', t079.u(7914), t079.u(6))), '23001', 'the identity is frozen');
select is(t079.attempt(format('update app.seduh_claim_links set token_hash = %L where id = %L', t079.hash(77), t079.u(6))), '23001', 'the token hash is frozen');
select is(t079.attempt(format('update app.seduh_claim_links set expires_at = expires_at - interval ''1 hour'' where id = %L', t079.u(6))), '23001', 'the expiry is frozen');
select is(t079.attempt(format('update app.seduh_claim_links set id = %L where id = %L', t079.u(66), t079.u(6))), '23001', 'the id is frozen');
select is((select coalesce(string_agg(column_name, ', '), 'none') from information_schema.columns
            where table_schema = 'app' and table_name = 'seduh_claim_links' and column_name ~* '(token|secret|email|phone)' and column_name <> 'token_hash'),
  'none', 'the only token column is the hash (no raw token, no email, no phone)');
select is((select count(*)::int from pg_trigger where tgrelid = 'app.seduh_claim_links'::regclass and tgname = 'trg_seduh_claim_links_parent_immutable'), 1,
  'the claim link carries the tenancy freeze trigger');
select is(t079.run(t079.link(7, 14, 7982, t079.hash(7))), 'ok', 'a committed claim link of organisation B (fixture)');
select is((select count(*)::int from app.seduh_claim_links where org_id = t079.u(7982)), 1, '(it is there)');
select is(t079.run($$ delete from orgs where id = '00000000-0000-0000-0000-000000007982' $$), 'ok',
  'deleting an organisation removes its (unused) claim links and is not blocked by them');
select is((select count(*)::int from app.seduh_claim_links where org_id = t079.u(7982)), 0, '(none left)');

-- ============ the migration's rollback block ============

savepoint rollback_block;
drop table if exists app.seduh_claim_links;
drop table if exists app.seduh_profile_settings;
drop table if exists app.seduh_accounts;
drop sequence if exists app.seduh_founding_number_seq;
drop function if exists app.seduh_claim_links_guard();
drop function if exists app.seduh_accounts_after_insert();
drop function if exists app.seduh_accounts_no_delete();
drop function if exists app.seduh_accounts_before_update();
drop function if exists app.seduh_accounts_before_insert();
drop function if exists app.seduh_handle_reserved(text);
alter table app.seduh_identities drop constraint if exists seduh_identities_country_code_shape;
alter table app.seduh_identities drop column if exists country_code;
select is((select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname ~ '^seduh_(accounts|profile_settings|claim_links|founding_number_seq)')
          + (select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname ~ '^seduh_(accounts_|claim_links_|handle_)')
          + (select count(*)::int from information_schema.columns where table_schema = 'app' and table_name = 'seduh_identities' and column_name = 'country_code'),
  0, 'the rollback block removes every table, the sequence, every function and the column');
select is((select count(*)::int from app.seduh_identities where id = t079.u(7901)), 1, '...and leaves the identities themselves');
rollback to savepoint rollback_block;
select is((select count(*)::int from pg_class where relnamespace = 'app'::regnamespace and relname in ('seduh_accounts', 'seduh_profile_settings', 'seduh_claim_links')), 3,
  '(the test rolls the rollback block back: the tables are there again)');

select * from finish();
rollback;
