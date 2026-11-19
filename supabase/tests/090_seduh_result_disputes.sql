-- T-ID2.NM: "This isn't mine" (migration 20261126120000_seduh_result_disputes.sql). Fictional data only.
-- Ids 00000000-0000-0000-0000-000000089nnn style via t089.u(n); names start "T089", handles end -t89.
-- Proves:
--   * THE ROLLBACK BLOCK works (run first, in a savepoint, before any audit row exists).
--   * ACL: the two doors are executable by `authenticated` only (not anon, service_role, PUBLIC); the owner functions and every
--     helper by NO API role; the table is reachable by no API role, RLS on, no policy; SECURITY DEFINER with an empty search_path.
--   * WHO MAY DISPUTE: only the caller's OWN open account. Anon, a login with no account, an organiser with no account and a CLOSED
--     account all get the one 42501 `no_account` on both doors; another person's result, an unknown, malformed or null key, a key built
--     from a row that is not the caller's, an unpublished event's row, and a self-reported entry are ALL the one `not_found`, and
--     nothing is written for any of them.
--   * EFFECT: the disputed result leaves public_seduh_profile, app.seduh_published_matches, the cafe search and the results-page
--     profile links AT ONCE, only for that person; the event's published payload is byte-identical; the person's other result and
--     everyone else's results stay; hidden-by-visibility does not stop the person seeing their own results in seduh_my_record.
--   * UNDO: withdrawing works while pending and after 'stands', is refused after 'link_wrong', and shows the result again.
--   * OWNER: overview, resolve (stands / link_wrong), refusals; every change audited with no secrets; frozen parents; a closed
--     account's dispute hides nothing; the 50 cap; reason text rules.
begin;
select plan(105);

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
create function t089.jt(n int, q text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', t089.u(n)::text, true);
  set local role authenticated;
  execute q into r;
  reset role;
  return r;
end $$;
-- a door as anon
create function t089.anon(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role anon;
  execute 'select to_jsonb(t.x) from (' || q || ') t(x)' into r;
  reset role;
  return r;
end $$;
-- the profile's recorded results as anon: "event|placing" per result
create function t089.recorded(handle text) returns text language sql as $$
  select coalesce(string_agg(e ->> 'event_name' || '|' || coalesce(e ->> 'placing', '-'), ', ' order by e ->> 'event_date', e ->> 'event_name'), '')
    from jsonb_array_elements(t089.anon(format('select public.public_seduh_profile(%L)', handle)) -> 'recorded_results') e
$$;
grant execute on all functions in schema t089 to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
-- users 1..6: 1 alpha, 2 bravo, 3 charlie (CLOSED account), 4 no account (login only), 5 organiser with no account, 6 delta (recorded results hidden)
insert into auth.users (id, email) select t089.u(n), 'u' || n || '@t089.seduh-next' from generate_series(1, 6) n;
insert into orgs (id, name, slug) values (t089.u(901), 'T089 Org', 't089-org');
insert into org_members (org_id, user_id, role) values (t089.u(901), t089.u(5), 'owner');
insert into app.seduh_identities (id, phone_e164, display_name, source, country_code)
  select t089.u(n), '+67389000' || lpad(n::text, 2, '0'), 'T089 ' || nm, 'organiser_roster', 'BN'
    from (values (1, 'Alpha'), (2, 'Bravo'), (3, 'Charlie'), (6, 'Delta')) v(n, nm);
insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at)
  select t089.u(100 + n), t089.u(n), t089.u(n), h, 'organiser_link', now()
    from (values (1, 'alpha-t89'), (2, 'bravo-t89'), (3, 'charlie-t89'), (6, 'delta-t89')) v(n, h);
update app.seduh_accounts set closed_at = now() where id = t089.u(103);
update app.seduh_profile_settings set vis_recorded_results = 'hidden' where account_id = t089.u(106);

insert into people (id, org_id, display_name, phone)
  select t089.u(200 + n), t089.u(901), 'T089 P' || n, '+67389100' || lpad(n::text, 2, '0') from unnest(array[1, 2, 3, 6]) n;
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t089.u(n) from unnest(array[1, 2, 3, 6]) n where people.id = t089.u(200 + n);
select set_config('app.seduh_link_write', '', true);

-- E1 and E2 published, E3 unpublished. Alpha is on E1 (Cafe One89) and E2 (Cafe Two89); Bravo, Charlie and Delta on E1 and E2.
insert into events (id, org_id, format, name, event_date) values
  (t089.u(301), t089.u(901), 'cup_taster', 'T089 Cup One', '2026-03-01'),
  (t089.u(302), t089.u(901), 'cup_taster', 'T089 Cup Two', '2026-04-01'),
  (t089.u(303), t089.u(901), 'cup_taster', 'T089 Unpublished', '2026-05-01');
insert into event_entries (id, event_id, person_id, display_name, cafe)
  select t089.u(400 + n * 10 + e), t089.u(300 + e), t089.u(200 + n), 'T089 ' || nm, case e when 1 then 'Cafe One89' else 'Cafe Two89' end
    from (values (1, 'Alpha'), (2, 'Bravo'), (3, 'Charlie'), (6, 'Delta')) v(n, nm), generate_series(1, 2) e;
insert into event_entries (id, event_id, person_id, display_name, cafe) values
  (t089.u(499), t089.u(303), t089.u(201), 'T089 Alpha', 'Cafe Three89');
insert into public.public_results (id, org_id, event_id, payload) values
  (t089.u(501), t089.u(901), t089.u(301), jsonb_build_object('format', 'cup_taster', 'eventName', 'T089 Cup One',
     'standings', jsonb_build_array(
       jsonb_build_object('place', 1, 'name', 'T089 Alpha', 'cafe', 'Cafe One89', 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 90),
       jsonb_build_object('place', 2, 'name', 'T089 Bravo', 'cafe', 'Cafe One89', 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 95),
       jsonb_build_object('place', 3, 'name', 'T089 Charlie', 'cafe', 'Cafe One89', 'round', 'Final', 'correct', 4, 'total', 6, 'timeSecs', 99),
       jsonb_build_object('place', 4, 'name', 'T089 Delta', 'cafe', 'Cafe One89', 'round', 'Final', 'correct', 3, 'total', 6, 'timeSecs', 101)))),
  (t089.u(502), t089.u(901), t089.u(302), jsonb_build_object('format', 'cup_taster', 'eventName', 'T089 Cup Two',
     'standings', jsonb_build_array(
       jsonb_build_object('place', 2, 'name', 'T089 Alpha', 'cafe', 'Cafe Two89', 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 92),
       jsonb_build_object('place', 1, 'name', 'T089 Bravo', 'cafe', 'Cafe Two89', 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 88),
       jsonb_build_object('place', 3, 'name', 'T089 Charlie', 'cafe', 'Cafe Two89', 'round', 'Final', 'correct', 4, 'total', 6, 'timeSecs', 99),
       jsonb_build_object('place', 4, 'name', 'T089 Delta', 'cafe', 'Cafe Two89', 'round', 'Final', 'correct', 3, 'total', 6, 'timeSecs', 101))));
-- a self-reported entry for alpha (never "recorded", never disputable)
insert into app.seduh_self_reported_entries (account_id, year, competition_name, kind) values (t089.u(101), 2024, 'T089 Self Cup', 'competed');

create temp table t089_payload as select event_id, md5(payload::text) as h from public.public_results where event_id in (t089.u(301), t089.u(302));

-- ============ the rollback block works (savepoint; nothing has been audited yet) ============

savepoint t089_rb;
drop function app.seduh_dispute_resolve(bigint, text, text);
drop function app.seduh_disputes_overview();
drop function public.seduh_withdraw_dispute(text);
drop function public.seduh_dispute_result(text, text);
drop function app.seduh_recorded_results(uuid, uuid, boolean);
drop function app.seduh_recorded_rows(uuid, uuid);
drop function app.seduh_result_hidden(uuid, uuid, text);
drop function app.seduh_result_key(uuid, text, text);
drop table app.seduh_result_disputes;
alter table app.seduh_claim_audit drop constraint seduh_claim_audit_action_vocab;
alter table app.seduh_claim_audit add constraint seduh_claim_audit_action_vocab
  check (action in ('claim_link.issue', 'claim_link.revoke', 'claim.complete', 'claim.undo',
                    'membership.confirm', 'membership.unconfirm', 'membership.remove', 'photo.remove'));
select is((select count(*)::int from pg_proc where proname in ('seduh_dispute_result', 'seduh_withdraw_dispute', 'seduh_disputes_overview',
            'seduh_dispute_resolve', 'seduh_recorded_rows', 'seduh_recorded_results', 'seduh_result_hidden', 'seduh_result_key')), 0,
  'ROLLBACK: every function the migration added is gone');
select is(to_regclass('app.seduh_result_disputes')::text, null, 'ROLLBACK: the table is gone');
select is(t089.run($$ select app.seduh_claim_audit_write('result_dispute.open', null, null, null, null, '{}'::jsonb) $$), '23514/', 'ROLLBACK: the audit vocabulary is back to eight actions');
rollback to savepoint t089_rb;
select is(to_regclass('app.seduh_result_disputes') is not null, true, 'the savepoint restored the migration (table is back)');

-- ============ ACL and catalog ============

select is((select coalesce(string_agg(p.proname || '/' || r, ', ' order by p.proname), 'none')
             from pg_proc p, unnest(array['anon', 'service_role', 'public']) r
            where p.pronamespace = 'public'::regnamespace and p.proname in ('seduh_dispute_result', 'seduh_withdraw_dispute')
              and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the two doors are executable by neither anon, service_role nor PUBLIC');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('seduh_dispute_result', 'seduh_withdraw_dispute') and has_function_privilege('authenticated', p.oid, 'execute')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 2,
  '...and by authenticated, SECURITY DEFINER with search_path pinned to the empty string');
select is((select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', ' order by p.oid::regprocedure::text), 'none')
             from pg_proc p, unnest(array['anon', 'authenticated', 'service_role', 'public']) r
            where p.pronamespace = 'app'::regnamespace
              and p.proname in ('seduh_disputes_overview', 'seduh_dispute_resolve', 'seduh_recorded_rows', 'seduh_recorded_results',
                                'seduh_result_hidden', 'seduh_result_key')
              and has_function_privilege(r, p.oid, 'execute')),
  'none', 'the owner functions and every helper in app are executable by no API role');
select is((select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, 'app.seduh_result_disputes', 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'the table is reachable by no API role');
select is((select relrowsecurity from pg_class where oid = 'app.seduh_result_disputes'::regclass), true, 'row-level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'seduh_result_disputes'), 0, '(no policy)');
select is(t089.as_attempt(1, $$ select count(*) from app.seduh_result_disputes $$), '42501/', 'a signed-in person cannot read the table directly');
select is(t089.as_attempt(1, $$ insert into app.seduh_result_disputes (account_id, event_id, result_key) values (gen_random_uuid(), gen_random_uuid(), repeat('a', 32)) $$), '42501/', '...nor write it');

-- ============ who may dispute ============

create temp table t089_doors (n serial, q text);
insert into t089_doors (q) values
  ($$select public.seduh_dispute_result(repeat('a', 32))$$),
  ($$select public.seduh_withdraw_dispute(repeat('a', 32))$$);
grant select on t089_doors to authenticated;
select is(t089.as_attempt(0, $$ select public.seduh_dispute_result(repeat('a', 32)) $$), '42501/', 'anon cannot call the dispute door');
select is(t089.as_attempt(0, $$ select public.seduh_withdraw_dispute(repeat('a', 32)) $$), '42501/', '...or the withdraw door');
select is((select count(distinct t089.as_attempt(4, q))::int from t089_doors), 1, 'a login with no account: both doors give the SAME answer...');
select is((select min(t089.as_attempt(4, q)) from t089_doors), '42501/no_account', '...42501 with the hint no_account');
select is((select min(t089.as_attempt(5, q)) from t089_doors), '42501/no_account', 'an ORGANISER (org member) with no account is refused the same way');
select is((select max(t089.as_attempt(3, q)) from t089_doors), '42501/no_account', 'a CLOSED account is refused the same way');

-- ============ the person sees their own results with keys ============

create temp table t089_k as
  select
    (select r ->> 'result_key' from jsonb_array_elements(t089.j(1, 'select public.seduh_my_record() -> ''recorded_results''')) r where r ->> 'event_name' = 'T089 Cup One') as a1,
    (select r ->> 'result_key' from jsonb_array_elements(t089.j(1, 'select public.seduh_my_record() -> ''recorded_results''')) r where r ->> 'event_name' = 'T089 Cup Two') as a2,
    (select r ->> 'result_key' from jsonb_array_elements(t089.j(2, 'select public.seduh_my_record() -> ''recorded_results''')) r where r ->> 'event_name' = 'T089 Cup One') as b1,
    (select r ->> 'result_key' from jsonb_array_elements(t089.j(2, 'select public.seduh_my_record() -> ''recorded_results''')) r where r ->> 'event_name' = 'T089 Cup Two') as b2,
    (select r ->> 'result_key' from jsonb_array_elements(t089.j(6, 'select public.seduh_my_record() -> ''recorded_results''')) r where r ->> 'event_name' = 'T089 Cup One') as d1;
grant select on t089_k to authenticated;
select is((select count(*)::int from t089_k where a1 ~ '^[0-9a-f]{32}$' and a2 ~ '^[0-9a-f]{32}$' and b1 ~ '^[0-9a-f]{32}$' and d1 ~ '^[0-9a-f]{32}$'), 1, 'my_record lists the recorded results with opaque 32-hex keys');
select is((select count(distinct k)::int from t089_k, unnest(array[a1, a2, b1, b2]) k), 4, 'every result has its own key');
select is(jsonb_array_length(t089.j(1, 'select public.seduh_my_record() -> ''recorded_results''')), 2, 'alpha sees her two recorded results (the unpublished event is not one)');
select is(t089.j(1, 'select public.seduh_my_record() #> ''{recorded_results,0,dispute}'''), 'null'::jsonb, 'no dispute yet');
select is(jsonb_array_length(t089.j(6, 'select public.seduh_my_record() -> ''recorded_results''')), 2, 'a person whose recorded results are hidden on the profile still sees them in My Seduh ID');
select is(t089.recorded('alpha-t89'), 'T089 Cup One|1, T089 Cup Two|2', 'the profile shows both before any dispute');
select is(t089.recorded('delta-t89'), '', '(delta hides recorded results on the profile)');
select is(position('result_key' in t089.anon($$ select public.public_seduh_profile('alpha-t89') $$)::text), 0, 'the PUBLIC profile carries no result key');
select is((select count(*)::int from app.seduh_published_matches(null, t089.u(1))), 2, 'the C5 helper sees both results of alpha');

-- ============ refusals: nothing but the caller's own recorded result can be named ============

select is(t089.as_attempt(2, format($$ select public.seduh_dispute_result(%L) $$, (select a1 from t089_k))), 'P0001/not_found', 'bravo cannot dispute ALPHA''s result');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, (select b1 from t089_k))), 'P0001/not_found', '...nor alpha bravo''s');
select is(t089.as_attempt(1, $$ select public.seduh_dispute_result(repeat('0', 32)) $$), 'P0001/not_found', 'an unknown key is refused');
select is(t089.as_attempt(1, $$ select public.seduh_dispute_result('not-a-key') $$), 'P0001/not_found', 'a malformed key is refused the same way');
select is(t089.as_attempt(1, $$ select public.seduh_dispute_result(null) $$), 'P0001/not_found', 'a null key is refused the same way');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, t089.u(301)::text)), 'P0001/not_found', 'the event''s uuid is not a key');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, app.seduh_result_key(t089.u(301), 'T089 Bravo', 'Cafe One89'))), 'P0001/not_found',
  'a key built from another person''s row of the same event is refused');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, app.seduh_result_key(t089.u(303), 'T089 Alpha', 'Cafe Three89'))), 'P0001/not_found',
  'a key of her own roster row on an UNPUBLISHED event is refused (it is no recorded result)');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, app.seduh_result_key(t089.u(301), 'T089 Self Cup', ''))), 'P0001/not_found',
  'a self-reported entry cannot be disputed');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L, %L) $$, (select a1 from t089_k), repeat('x', 201))), 'P0001/bad_reason', 'a reason over 200 characters is refused');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L, E'line\nbreak') $$, (select a1 from t089_k))), 'P0001/bad_reason', 'a reason with a control character is refused');
select is((select count(*)::int from app.seduh_result_disputes), 0, 'none of the refusals wrote anything');
select is((select count(*)::int from app.seduh_claim_audit where action like 'result_dispute.%'), 0, '...or audited anything');
select is(t089.as_attempt(1, format($$ select public.seduh_withdraw_dispute(%L) $$, (select a1 from t089_k))), 'P0001/not_found', 'withdrawing a result that is not disputed is not_found');

-- ============ the dispute: effect at once, for that person only ============

update app.seduh_discovery_switch set enabled = true;
select is(t089.anon($$ select public.seduh_discovery_search('Cafe One89', null) $$) -> 'results' @> '[{"handle": "alpha-t89"}]', true, 'before: a search by her cafe finds alpha');
select is(t089.as_run(1, format($$ select public.seduh_dispute_result(%L, 'Wrong phone number') $$, (select a1 from t089_k))), 'ok', 'alpha says Cup One is not hers');
select is(t089.j(1, format($$ select public.seduh_dispute_result(%L) $$, (select a2 from t089_k))) #>> '{dispute,status}', 'pending', 'the door answers pending (a second, with no reason)');
select is(t089.as_run(1, format($$ select public.seduh_withdraw_dispute(%L) $$, (select a2 from t089_k))), 'ok', '...and she withdraws that second one (kept Cup Two)');
select is(t089.recorded('alpha-t89'), 'T089 Cup Two|2', 'AT ONCE: Cup One is gone from alpha''s public profile, Cup Two stays');
select is((select count(*)::int from app.seduh_published_matches(null, t089.u(1))), 1, 'the C5 helper hides it too');
select is((select count(*)::int from app.seduh_published_matches(t089.u(301), null) where nm = 'T089 Alpha'), 0, '...also when asked by event');
select is(t089.anon($$ select public.seduh_discovery_search('Cafe One89', null) $$) -> 'results' @> '[{"handle": "alpha-t89"}]', false, 'a search by the disputed result''s cafe no longer finds alpha');
select is(t089.anon($$ select public.seduh_discovery_search('Cafe Two89', null) $$) -> 'results' @> '[{"handle": "alpha-t89"}]', true, '...but her other result''s cafe still does');
select is(t089.anon(format($$ select public.seduh_results_profile_links(%L) $$, t089.u(301))) -> 'links' @> '[{"name": "T089 Alpha"}]', false, 'the results page no longer links alpha for that event');
select is(t089.anon(format($$ select public.seduh_results_profile_links(%L) $$, t089.u(301))) -> 'links' @> '[{"name": "T089 Bravo"}]', true, '...and still links bravo (only alpha is affected)');
select is(t089.recorded('bravo-t89'), 'T089 Cup One|2, T089 Cup Two|1', 'bravo''s profile is untouched');
select is((select count(*)::int from public.public_results pr join t089_payload p on p.event_id = pr.event_id where md5(pr.payload::text) = p.h), 2,
  'the published payloads of both events are byte-identical: the event results pages are unchanged');
select is(t089.jt(1, 'select public.seduh_my_record() #>> ''{recorded_results,1,dispute,status}'''), 'pending', 'my_record still lists the disputed result, marked pending');
select is(jsonb_array_length(t089.j(1, 'select public.seduh_my_record() -> ''recorded_results''')), 2, '...so she can see and undo it');
select is(t089.j(1, 'select public.seduh_my_record() #> ''{counts}''') @> '{"recorded_results": 2, "disputes": 1, "disputes_pending": 1}', true, 'counts: two results, one dispute, one pending');
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, (select a1 from t089_k))), 'P0001/already_disputed', 'disputing it twice is refused');
select is(t089.as_attempt(2, format($$ select public.seduh_withdraw_dispute(%L) $$, (select a1 from t089_k))), 'P0001/not_found', 'bravo cannot withdraw alpha''s dispute');
select is((select count(*)::int from app.seduh_claim_audit where action = 'result_dispute.open'), 2, 'each dispute was audited (open x2 incl. the withdrawn one)');
select is((select count(*)::int from app.seduh_claim_audit where action = 'result_dispute.withdraw'), 1, '...and the withdrawal');

-- the same key still works for the person after a profile-visibility change: hiding the whole list does not break the control
update app.seduh_profile_settings set vis_recorded_results = 'hidden' where account_id = t089.u(101);
select is(jsonb_array_length(t089.j(1, 'select public.seduh_my_record() -> ''recorded_results''')), 2, 'hidden recorded results: the person still sees both in My Seduh ID');
update app.seduh_profile_settings set vis_recorded_results = 'public' where account_id = t089.u(101);

-- ============ the owner's queue ============

select is((select count(*)::int from app.seduh_disputes_overview() where handle = 'alpha-t89'), 1, 'the overview lists the pending dispute');
select is((select still_matches from app.seduh_disputes_overview() where handle = 'alpha-t89'), true, '...which still matches the roster link');
select is((select linked_person_id from app.seduh_disputes_overview() where handle = 'alpha-t89'), t089.u(201), '...and names the roster person the result came through');
select is((select reason from app.seduh_disputes_overview() where handle = 'alpha-t89'), 'Wrong phone number', '...with the person''s reason');
select is(t089.attempt($$ select * from app.seduh_disputes_overview() $$), 'ok', 'postgres can run it');
select is(t089.as_attempt(1, $$ select * from app.seduh_disputes_overview() $$), '42501/', 'a signed-in person cannot run the owner overview');
select is(t089.as_attempt(1, $$ select app.seduh_dispute_resolve(1, 'stands', 'x') $$), '42501/', '...nor resolve');

select is(t089.run($$ select app.seduh_dispute_resolve(0, 'stands', 'no such') $$), 'P0002/', 'resolving an unknown dispute is refused');
select is(t089.run(format($$ select app.seduh_dispute_resolve((select id from app.seduh_result_disputes limit 1), 'maybe', 'x') $$)), 'P0001/', 'an outcome outside the vocabulary is refused');
select is(t089.run(format($$ select app.seduh_dispute_resolve((select id from app.seduh_result_disputes limit 1), 'stands', '') $$)), 'P0001/bad_reason', 'a note is required');
select is((select count(*)::int from app.seduh_claim_audit where action = 'result_dispute.resolve'), 0, 'refusals audited nothing');

-- outcome 'stands': the result stays hidden at the person's wish; she can still withdraw
select is(t089.run(format($$ select app.seduh_dispute_resolve((select id from app.seduh_result_disputes where account_id = %L), 'stands', 'Checked with the organiser: it is hers') $$, t089.u(101))), 'ok', 'the owner resolves it: stands');
select is(t089.run(format($$ select app.seduh_dispute_resolve((select id from app.seduh_result_disputes where account_id = %L), 'stands', 'again') $$, t089.u(101))), 'P0001/', 'a resolved dispute cannot be resolved again');
select is(t089.recorded('alpha-t89'), 'T089 Cup Two|2', 'stands: it stays hidden at her request');
select is(t089.jt(1, 'select public.seduh_my_record() #>> ''{recorded_results,1,dispute,status}'''), 'stands', 'her My Seduh ID shows the outcome');
select is(t089.as_run(1, format($$ select public.seduh_withdraw_dispute(%L) $$, (select a1 from t089_k))), 'ok', 'she may withdraw after the owner said it stands');
select is(t089.recorded('alpha-t89'), 'T089 Cup One|1, T089 Cup Two|2', 'UNDO: the result is back on her profile');
select is((select count(*)::int from app.seduh_published_matches(null, t089.u(1))), 2, '...and in the C5 helper');
select is((select count(*)::int from app.seduh_result_disputes where account_id = t089.u(101)), 0, '...and the dispute row is gone (the audit keeps the history)');

-- outcome 'link_wrong': bravo disputes Cup One, the owner agrees, unlinks the person, and the result can never be withdrawn
select is(t089.as_run(2, format($$ select public.seduh_dispute_result(%L) $$, (select b1 from t089_k))), 'ok', 'bravo disputes Cup One');
select is(t089.run(format($$ select app.seduh_dispute_resolve((select id from app.seduh_result_disputes where account_id = %L), 'link_wrong', 'Wrong phone on the roster') $$, t089.u(102))), 'ok', 'the owner resolves: link_wrong');
select is(t089.as_attempt(2, format($$ select public.seduh_withdraw_dispute(%L) $$, (select b1 from t089_k))), 'P0001/not_undoable', 'a link_wrong result cannot be shown again by the person');
select is(t089.recorded('bravo-t89'), 'T089 Cup Two|1', 'it stays hidden');
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = null where id = t089.u(202);
select set_config('app.seduh_link_write', '', true);
select is((select count(*)::int from app.seduh_disputes_overview() where handle = 'bravo-t89' and status = 'link_wrong'), 1, 'after the roster is corrected the dispute stays on file...');
select is((select still_matches from app.seduh_disputes_overview() where handle = 'bravo-t89'), false, '...and no longer matches (the link is gone)');
select is((select linked_person_id from app.seduh_disputes_overview() where handle = 'bravo-t89'), null, '...so no roster person is named');
select is(t089.recorded('bravo-t89'), '', 'unlinked: no recorded result at all (neither event names her any more)');

-- ============ audit and constraints ============

select is((select count(*)::int from app.seduh_claim_audit where action = 'result_dispute.resolve'), 2, 'both resolutions audited');
select is((select count(*)::int from app.seduh_claim_audit where action like 'result_dispute.%' and detail ? 'dispute_id' and detail ? 'event_id'), 7, 'every dispute audit row carries the dispute and event ids (open x3, withdraw x2, resolve x2)');
select is((select count(*)::int from app.seduh_claim_audit where action like 'result_dispute.%' and not app.admin_audit_detail_ok(detail)), 0, 'no audit detail holds a secret-looking key');
select is(t089.run($$ update app.seduh_claim_audit set action = 'result_dispute.open' where action = 'result_dispute.open' $$), '42501/', 'the audit stays append-only');

insert into app.seduh_result_disputes (account_id, event_id, result_key) values (t089.u(106), t089.u(301), repeat('b', 32));
select is(t089.attempt($$ update app.seduh_result_disputes set account_id = '00000000-0000-0000-0000-000000089999' $$), '23001/', 'the account of a dispute is frozen');
select is(t089.attempt($$ update app.seduh_result_disputes set event_id = '00000000-0000-0000-0000-000000089302' $$), '23001/', 'the event of a dispute is frozen');
select is(t089.attempt($$ update app.seduh_result_disputes set result_key = repeat('c', 32) $$), '23001/', 'the key of a dispute is frozen');
select is(t089.attempt($$ update app.seduh_result_disputes set status = 'invented' $$), '23514/', 'the status vocabulary is enforced');
select is(t089.attempt($$ update app.seduh_result_disputes set status = 'stands' $$), '23514/', 'a resolved status needs a resolved_at');
select is(t089.attempt($$ insert into app.seduh_result_disputes (account_id, event_id, result_key) select account_id, event_id, result_key from app.seduh_result_disputes $$), '23505/', 'one dispute per account and result');
select is(t089.attempt($$ insert into app.seduh_result_disputes (account_id, event_id, result_key) values ('00000000-0000-0000-0000-000000089106', '00000000-0000-0000-0000-000000089301', 'XYZ') $$), '23514/', 'the key must be 32 hex characters');

-- a CLOSED account's dispute hides nothing
insert into app.seduh_result_disputes (account_id, event_id, result_key)
  values (t089.u(103), t089.u(301), app.seduh_result_key(t089.u(301), 'T089 Charlie', 'Cafe One89'));
select is((select count(*)::int from app.seduh_published_matches(t089.u(301), t089.u(3))), 1, 'a dispute of a CLOSED account hides nothing');
select is(app.seduh_result_hidden(t089.u(3), t089.u(301), app.seduh_result_key(t089.u(301), 'T089 Charlie', 'Cafe One89')), false, '(the one hide rule says so too)');
select is(app.seduh_result_hidden(t089.u(6), t089.u(301), repeat('b', 32)), true, '...and an open account''s does');

-- the cap of 50 per account (the events trigger reads the last signed-in caller: clear it)
select set_config('request.jwt.claim.sub', '', true);
insert into events (id, org_id, format, name) select t089.u(1000 + n), t089.u(901), 'cup_taster', 'T089 Cap ' || n from generate_series(1, 50) n;
insert into app.seduh_result_disputes (account_id, event_id, result_key)
  select t089.u(101), t089.u(1000 + n), lpad(n::text, 32, '0') from generate_series(1, 50) n;
select is(t089.as_attempt(1, format($$ select public.seduh_dispute_result(%L) $$, (select a1 from t089_k))), 'P0001/too_many_disputes', 'the 51st dispute is refused');

-- deleting an event takes its disputes with it
delete from events where id = t089.u(1001);
select is((select count(*)::int from app.seduh_result_disputes where event_id = t089.u(1001)), 0, 'a deleted event cascades its disputes');

select * from finish();
rollback;
