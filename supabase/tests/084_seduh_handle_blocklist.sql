-- The Seduh ID handle watch list (migration 20261121100000_seduh_handle_blocklist.sql).
-- Proves:
--   * the table is owner-only (RLS on, no policy, anon and authenticated cannot read or write it, no one can run its functions);
--     its checks hold the vocabulary and shape of every kind; (term, kind) is unique;
--   * the four kinds: system is EXACT, impersonation is CONTAINS after normalising, profanity follows its own mode (exact or
--     contains), allow beats every block; an allow row can never equal a system word (and the reverse);
--   * the normaliser catches adm1n, the-admin, s3duh, seduh-0fficial, aaadmiin and does NOT turn away innocent names (carrot is not
--     `root`; a profanity word that is exact-only does not block a longer name that contains it: zork vs zorkland);
--   * every refusal is the same neutral answer: seduh_handle_available says `reserved`, claim_seduh_id raises the hint
--     `handle_reserved` and the account insert trigger refuses with 23514, whichever kind matched;
--   * the report lists an EXISTING handle the current list would block, and nothing else;
--   * seduh_handle_reserved is STABLE (and SECURITY INVOKER like every app helper), and its execute grant is still revoked.
-- Profanity here is two FICTIONAL placeholders (zork, quuxfrob); the real list is loaded by the owner from a local file.
begin;
select plan(73);

create schema t084;
grant usage on schema t084 to anon, authenticated, service_role;
create function t084.attempt(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || coalesce(v_hint, '');
end $$;
create function t084.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function t084.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', t084.u(n)::text, true);
end $$;
grant execute on all functions in schema t084 to anon, authenticated, service_role;

insert into auth.users (id, email) select t084.u(n), 'u' || n || '@t084.seduh-next' from generate_series(8401, 8403) n;
insert into orgs (id, name, slug) values (t084.u(8410), 'T084 A', 't084-a');
insert into org_members (org_id, user_id, role) values (t084.u(8410), t084.u(8401), 'owner');
insert into app.seduh_identities (id, phone_e164, display_name, source, status)
values (t084.u(8421), '+67384000001', 'T084 Person One', 'archive', 'active'),
       (t084.u(8422), '+67384000002', 'T084 Person Two', 'archive', 'active');
insert into people (id, org_id, display_name, phone)
values (t084.u(8431), t084.u(8410), 'Person One', '+67384000001'), (t084.u(8432), t084.u(8410), 'Person Two', '+67384000002');
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t084.u(8421) where id = t084.u(8431);
update people set global_person_id = t084.u(8422) where id = t084.u(8432);
select set_config('app.seduh_link_write', '', true);

-- ============ the table is owner-only ============
select is((select relrowsecurity from pg_class where oid = 'app.seduh_handle_blocklist'::regclass), true, 'row-level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'seduh_handle_blocklist'), 0, 'and there is no policy');
set local role anon;
select is(split_part(t084.attempt($$ select * from app.seduh_handle_blocklist $$), '/', 1), '42501', 'anon cannot read the table');
select is(split_part(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'profanity', 'exact') $$), '/', 1), '42501', 'anon cannot write it');
reset role;
set local role authenticated;
select t084.as_user(8401);
select is(split_part(t084.attempt($$ select * from app.seduh_handle_blocklist $$), '/', 1), '42501', 'an authenticated organiser cannot read the table');
select is(split_part(t084.attempt($$ select * from app.seduh_handle_blocklist_clashes() $$), '/', 1), '42501', '...nor run the report');
select is(split_part(t084.attempt($$ select app.seduh_handle_reserved('admin') $$), '/', 1), '42501', '...nor the reserved check itself');
reset role;
select is((select count(*)::int from unnest(array['app.seduh_handle_reserved(text)', 'app.seduh_handle_blocked_by(text)', 'app.seduh_handle_blocklist_clashes()',
                                                    'app.seduh_handle_normalise(text)', 'app.seduh_handle_pattern(text)', 'app.seduh_handle_blocklist_guard()']) f
            where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') or has_function_privilege('service_role', f, 'execute')),
  0, 'no API role may execute any of the watch list functions');
select is((select provolatile::text || prosecdef::text from pg_proc where oid = 'app.seduh_handle_reserved(text)'::regprocedure), 'sfalse',
  'seduh_handle_reserved is STABLE (it reads a table) and SECURITY INVOKER like every app helper');

-- ============ the table's checks ============
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'swear', 'exact') $$), '23514/', 'an unknown kind is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'profanity', 'starts') $$), '23514/', 'an unknown mode is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'impersonation', 'exact') $$), '23514/', 'impersonation must be contains');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'system', 'contains') $$), '23514/', 'system must be exact');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'allow', 'contains') $$), '23514/', 'allow must be exact');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('abc', 'profanity', 'contains') $$), '23514/', 'a contains word shorter than 4 is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('Zork', 'profanity', 'exact') $$), '23514/', 'an upper-case term is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zo-rk', 'profanity', 'exact') $$), '23514/', 'a hyphen in a profanity term is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zo', 'profanity', 'exact') $$), '23514/', 'a profanity term of 2 is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('ab', 'allow', 'exact') $$), '23514/', 'an allow term must be claimable (3 or more)');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode, note) values ('zzzz', 'profanity', 'exact', repeat('x', 201)) $$), '23514/', 'a note over 200 characters is refused');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('admin', 'system', 'exact') $$), '23505/', '(term, kind) is unique');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('zzzz', 'profanity', 'exact'), ('zzzz', 'profanity', 'contains') $$), '23505/', '...whatever the mode');

-- ============ the seeds ============
select is((select count(*)::int from app.seduh_handle_blocklist where kind = 'system'), 56, 'today''s 56 reserved words are seeded as system (firdaus included)');
select is((select count(*)::int from app.seduh_handle_blocklist where kind = 'system' and term = 'firdaus'), 1, 'firdaus is a system row (worker/idRoute.js HANDLE_ALIASES needs it)');
select is((select count(*)::int from app.seduh_handle_blocklist where kind = 'profanity'), 0, 'no profanity is in the migration (the repository is public)');
select is((select string_agg(term, ',' order by term) from app.seduh_handle_blocklist where kind = 'impersonation' and term in ('admin', 'superuser', 'root', 'official', 'seduh', 'seduhscore', 'support', 'staff', 'moderator', 'owner', 'security', 'help')),
  'admin,help,moderator,official,owner,root,security,seduh,seduhscore,staff,superuser,support', 'the impersonation set the owner named is seeded');

-- ============ the normaliser ============
select is(app.seduh_handle_normalise('S3-DUH'), 'seduh', 'lower case, hyphens removed, 3 -> e');
select is(app.seduh_handle_normalise('0134578@$'), 'oieastbas', 'every look-alike is mapped');
select is(app.seduh_handle_pattern('official'), 'o+f+f+i+c+i+a+l+', 'a term becomes a pattern in which each character may repeat');
select is(app.seduh_handle_normalise(null), '', 'null is the empty string');

-- ============ system: EXACT ============
select is(app.seduh_handle_reserved('claim'), true, 'system: claim');
select is(app.seduh_handle_reserved('firdaus'), true, 'system: firdaus');
select is(app.seduh_handle_reserved('guess-the-bean'), true, 'system: a hyphenated route word');
select is(app.seduh_handle_reserved('countryside-84'), false, 'system is exact: a longer word is not blocked');
select is(app.seduh_handle_reserved('ahmad-79'), false, 'an ordinary handle is free');
select is(app.seduh_handle_reserved('cla1m') or app.seduh_handle_reserved('c0untry'), false, 'system is exact: look-alikes of a route word are not normalised (only impersonation and profanity are)');

-- ============ impersonation: CONTAINS after normalising ============
select is((select coalesce(string_agg(w, ', '), 'none') from unnest(array['adm1n', 'the-admin', 's3duh', 'seduh-0fficial', 'aaadmiin', '5upp0rt-team', 'ad-min', 'my-r00t', 'super-user-1', 'a-d-m-i-n', 'x-superuser']) w
            where not app.seduh_handle_reserved(w)), 'none', 'adm1n, the-admin, s3duh, seduh-0fficial and other disguises are blocked');
select is((select coalesce(string_agg(w, ', '), 'none') from unnest(array['carrot-84', 'protein', 'brooks', 'groovy', 'helena', 'cassandra', 'assam', 'ahmad-79']) w
            where app.seduh_handle_reserved(w)), 'none',
  'innocent names are free: carrot and protein are not `root` (a repeated-letter collapse would have blocked them)');
select is(app.seduh_handle_reserved('helpful-84'), true, 'but `help` inside a word does block it (contains; the owner allow-lists a real name that clashes)');

-- ============ profanity: each row has its own mode (fictional placeholders) ============
insert into app.seduh_handle_blocklist (term, kind, match_mode, note)
values ('zork', 'profanity', 'exact', 'test placeholder'), ('quuxfrob', 'profanity', 'contains', 'test placeholder');
select is(app.seduh_handle_reserved('zork'), true, 'exact profanity: the word itself is blocked');
select is(app.seduh_handle_reserved('z0rk'), true, '...and its look-alike');
select is(app.seduh_handle_reserved('zoork'), true, '...and a stretched spelling');
select is(app.seduh_handle_reserved('zorkland'), false, 'exact profanity does NOT block an innocent superstring (Scunthorpe)');
select is(app.seduh_handle_reserved('azork'), false, '...nor a word that ends with it');
select is(app.seduh_handle_reserved('quuxfrob'), true, 'contains profanity: the word itself');
select is(app.seduh_handle_reserved('xx-quuxfr0b-yy'), true, '...inside a longer handle, disguised');
select is(app.seduh_handle_reserved('quuxfrobnicate'), true, '...as a prefix of a longer word');
select is(app.seduh_handle_reserved('quux'), false, '...but not a shorter piece of it');

select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values (repeat('q', 31), 'profanity', 'exact') $$), '23514/', 'a term over 30 characters is refused');

-- ============ allow beats every block ============
insert into app.seduh_handle_blocklist (term, kind, match_mode, note)
values ('staffan', 'allow', 'exact', 'a real name that contains staff'), ('z0rk', 'allow', 'exact', 'test');
select is(app.seduh_handle_reserved('staffan'), false, 'allow: staffan is permitted although it contains staff');
select is(app.seduh_handle_reserved('staffan2'), true, '...but only that exact handle');
select is(app.seduh_handle_reserved('z0rk'), false, 'allow beats profanity');
select is(app.seduh_handle_reserved('zork'), true, '...for that exact handle only');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('claim', 'allow', 'exact') $$), '23514/', 'an allow row cannot equal a system word');
select is(t084.attempt($$ insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('staffan', 'system', 'exact') $$), '23514/', 'a system row cannot equal an allow row');
insert into app.seduh_handle_blocklist (term, kind, match_mode) values ('kestrel-84', 'allow', 'exact');
select is(t084.attempt($$ update app.seduh_handle_blocklist set term = 'claim' where term = 'kestrel-84' and kind = 'allow' $$), '23514/', 'the guard also holds on UPDATE (an allow row cannot be edited into a system word)');

-- ============ one neutral answer, at every door ============
set local role anon;
select is((select coalesce(string_agg(w || ':' || public.seduh_handle_available(w), ', '), 'none') from unnest(array['adm1n', 'zork', 'quuxfrob-1', 'claim']) w
            where public.seduh_handle_available(w) <> 'reserved'), 'none', 'seduh_handle_available says reserved for every kind');
select is(public.seduh_handle_available('fine-handle-84'), 'available', 'an ordinary handle is available');
select is(public.seduh_handle_available('staffan'), 'available', 'an allow-listed handle is available');
select is(public.seduh_handle_available('ab'), 'invalid', 'the shape check still comes first');
reset role;

set local role authenticated;
select t084.as_user(8401);
select set_config('t084.tok1', public.issue_seduh_claim_link(t084.u(8431)), false);
select t084.as_user(8402);
select is(t084.attempt($$ select public.claim_seduh_id(current_setting('t084.tok1'), 's3duh-team', true) $$), 'P0001/handle_reserved', 'claim_seduh_id refuses an impersonation (handle_reserved)');
select is(t084.attempt($$ select public.claim_seduh_id(current_setting('t084.tok1'), 'zork', true) $$), 'P0001/handle_reserved', '...a profanity word (the same hint)');
select is(t084.attempt($$ select public.claim_seduh_id(current_setting('t084.tok1'), 'country', true) $$), 'P0001/handle_reserved', '...and a system word (the same hint)');
select set_config('t084.res1', public.claim_seduh_id(current_setting('t084.tok1'), 'fine-handle-84', true)::text, false);
reset role;
select is(current_setting('t084.res1')::jsonb ->> 'handle', 'fine-handle-84', 'an ordinary handle still claims');
select is((select handle from app.seduh_accounts where identity_id = t084.u(8421)), 'fine-handle-84', '(the account exists)');
select is(t084.attempt($$ insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at)
  values ('00000000-0000-0000-0000-000000008422', '00000000-0000-0000-0000-000000008403', 'adm1n', 'organiser_link', now()) $$), '23514/',
  'the account insert trigger refuses a disguised admin whatever the door');

-- ============ a handle claimed BEFORE a term existed keeps its public page ============
insert into app.seduh_handle_blocklist (term, kind, match_mode, note) values ('finehan', 'impersonation', 'contains', 'test');
select is(app.seduh_handle_reserved('fine-handle-84'), true, 'a later term now matches the existing handle');
select is((select public.public_seduh_profile('fine-handle-84') ->> 'has_profile'), 'true', '...and the profile door still serves the page (a term never unpublishes a person)');
select is((select public.public_seduh_profile('adm1n-nobody') ->> 'has_profile'), 'false', 'while a blocked handle with no account is still the empty shape');
delete from app.seduh_handle_blocklist where term = 'finehan';

-- ============ the report ============
select is((select count(*)::int from app.seduh_handle_blocklist_clashes()), 0, 'report: no existing handle clashes yet');
insert into app.seduh_handle_blocklist (term, kind, match_mode, note) values ('finehandle', 'impersonation', 'contains', 'test');
select is((select handle || '/' || matched_kind || '/' || matched_term || '/' || closed::text from app.seduh_handle_blocklist_clashes()), 'fine-handle-84/impersonation/finehandle/false',
  'report: an existing handle the list now blocks is listed with the row that matched');
insert into app.seduh_handle_blocklist (term, kind, match_mode, note) values ('fine-handle-84', 'allow', 'exact', 'test');
select is((select count(*)::int from app.seduh_handle_blocklist_clashes()), 0, 'report: an allow-listed handle is not a clash');
update app.seduh_accounts set closed_at = now(), user_id = null where handle = 'fine-handle-84';
delete from app.seduh_handle_blocklist where term = 'fine-handle-84' and kind = 'allow';
select is((select closed from app.seduh_handle_blocklist_clashes() where handle = 'fine-handle-84'), true, 'report: a CLOSED account is listed too, marked closed (its handle is retired, not free)');

select * from finish();
rollback;
