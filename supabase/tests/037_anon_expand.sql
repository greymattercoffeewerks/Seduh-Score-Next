-- T-TEN.B7: anonymous surfaces, expand step.
-- Proves: public_org_by_slug turns a slug into ONE org's (id, name, slug) for anon and signed-in callers,
-- folds case and padding, and returns nothing for an unknown, empty, NULL, over-long or pattern-like
-- slug (no listing, no wildcard); public_event_summary returns an org's event (the newest real one; the live-first rule is tested in 039) with only the
-- columns the audience surfaces use, nothing for an org with no events or an unknown or NULL id, and a
-- stable pick when two events share a timestamp; both functions are executable by anon and
-- authenticated only, SECURITY DEFINER with a pinned search_path; the set of functions anon can execute
-- is pinned, so a new anonymous door cannot appear unnoticed; publish_event_results stamps the org's
-- name and slug into the payload (overwriting anything the writer sent) on EVERY write, through the RPC
-- or directly into the table, keeps the other keys, refuses a payload that is not a JSON object or is
-- over 256 KB, and still refuses a test event and a non-member; a member of two orgs publishes to
-- each under the right name; and anon can read the archive's event_id, payload and published_at but
-- not published_by.
-- Fixtures: org Alpha (a real event, a newer test event), org Bravo (one event), org Charlie (none),
-- org Delta (two events with the same timestamp); user_a owns Alpha, user_b owns Bravo.
begin;
select plan(83);

-- ============ fixtures ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'owner-b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'both@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-0000000000a0', 'Alpha Coffee', 'alpha-coffee'),
  ('00000000-0000-0000-0000-0000000000b0', 'Bravo Roasters', 'bravo-roasters'),
  ('00000000-0000-0000-0000-0000000000c0', 'Charlie Beans', 'charlie-beans'),
  ('00000000-0000-0000-0000-0000000000d0', 'Delta Cafe', 'delta-cafe'),
  ('00000000-0000-0000-0000-0000000000c1', 'Kelvin Co', 'kelvin-co'),
  ('00000000-0000-0000-0000-0000000000c2', 'Nine Lives', '9-lives-cafe-2026'),
  ('00000000-0000-0000-0000-0000000000c3', 'Long Slug Co', 'aaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbb'),
  ('00000000-0000-0000-0000-0000000000ec', 'Echo Tea', 'echo-tea');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000002', 'owner'),
  ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000003', 'organiser'),
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000003', 'organiser');
insert into events (id, org_id, format, name, event_date, is_test, created_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Alpha Real Night', '2026-10-04', false, '2026-10-01 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a0', 'cup_taster', 'Alpha Rehearsal', '2026-10-08', true,  '2026-10-02 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000b0', 'btc',        'Bravo Cup',       '2026-11-05', false, '2026-10-03 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d0', 'cup_taster', 'Delta One',       null,         false, '2026-10-05 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d0', 'cup_taster', 'Delta Two',       null,         false, '2026-10-05 10:00:00+00'),
  -- Echo: the newest event BY CREATION has the LOWER id and the EARLIER event_date, so only created_at can pick it
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000ec', 'cup_taster', 'Echo Newest Created', '2026-01-01', false, '2026-10-09 10:00:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000ec', 'cup_taster', 'Echo Older Created',  '2026-12-01', false, '2026-10-01 10:00:00+00');

-- ============ public_org_by_slug, as anon ============

set local role anon;

select results_eq(
  $$ select id, name, slug from public_org_by_slug('alpha-coffee') $$,
  $$ values ('00000000-0000-0000-0000-0000000000a0'::uuid, 'Alpha Coffee', 'alpha-coffee') $$,
  'anon turns a slug into that org''s id, name and slug'
);
select results_eq(
  $$ select id from public_org_by_slug(E'  \tALPHA-Coffee \n') $$,
  $$ values ('00000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'case and padding are folded the way create_org folds them'
);
select results_eq(
  $$ select id from public_org_by_slug('bravo-roasters') $$,
  $$ values ('00000000-0000-0000-0000-0000000000b0'::uuid) $$,
  'and another org''s slug gives that org'
);
select is(
  (select count(*)::int from public_org_by_slug(c.slug)), 0,
  'no rows for ' || c.label
)
from (values
  ('an unknown slug', 'no-such-org'), ('an empty slug', ''), ('only spaces', '   '), ('NULL', null::text),
  ('a trailing wildcard', 'alpha%'), ('a lone wildcard', '%'), ('a single-character wildcard', '_lpha-coffee'),
  ('a prefix of a real slug', 'alpha'), ('a slug with a suffix', 'alpha-coffee-2'),
  ('an over-long input (101 characters)', repeat('a', 101)), ('an over-long input (100000 characters)', repeat('a', 100000)),
  -- a real slug padded to 101 characters: it WOULD resolve if the length guard were missing
  ('a real slug padded to 101 characters', repeat(' ', 101 - 12) || 'alpha-coffee'),
  ('an injection attempt', 'alpha-coffee'' or ''1''=''1')
) as c(label, slug);
select is((select count(*)::int from public_org_by_slug(repeat(' ', 100 - 12) || 'alpha-coffee')), 1,
  'a real slug padded to exactly 100 characters still resolves (the length guard is at 100)');
select is((select count(*)::int from public_org_by_slug(E'\ralpha-coffee\r')), 1, 'carriage returns are trimmed like the other padding');
select is((select count(*)::int from public_org_by_slug('9-lives-cafe-2026')), 1, 'a slug with a leading digit and several hyphens resolves');
select is((select count(*)::int from public_org_by_slug('aaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbbbbbb')), 1, 'and one at the 40-character limit');
select is((select count(*)::int from public_org_by_slug('kelvin-co')), 1, 'a real slug resolves');
select is(lower(chr(8490)), 'k', 'premise: this database lower-cases the Kelvin sign to k (the next check is meaningless otherwise)');
select is((select count(*)::int from public_org_by_slug(chr(8490) || 'elvin-co')), 0,
  'a look-alike (the Kelvin sign, which lower-cases to k) does not alias it');
select is(
  (select string_agg(x.argname, ',' order by x.ord)
     from pg_proc p, unnest(p.proargnames) with ordinality as x(argname, ord)
    where p.pronamespace = 'public'::regnamespace and p.proname = 'public_org_by_slug'),
  'p_slug,id,name,slug',
  'it takes one slug and returns exactly id, name and slug (nothing else about the org)'
);

-- ============ public_event_summary, as anon ============

select results_eq(
  $$ select id, name, event_date, is_test from public_event_summary('00000000-0000-0000-0000-0000000000a0') $$,
  $$ values ('00000000-0000-0000-0000-0000000000e1'::uuid, 'Alpha Real Night', '2026-10-04'::date, false) $$,
  'anon gets an org''s newest REAL event (the newer rehearsal does not win; 039 covers the live-event rule)'
);
select results_eq(
  $$ select id, name from public_event_summary('00000000-0000-0000-0000-0000000000b0') $$,
  $$ values ('00000000-0000-0000-0000-0000000000e3'::uuid, 'Bravo Cup') $$,
  'another org gives its own event'
);
select is(
  (select count(*)::int from public_event_summary(c.org)), 0,
  'no rows for ' || c.label
)
from (values
  ('an org with no events', '00000000-0000-0000-0000-0000000000c0'::uuid),
  ('an unknown org id', '00000000-0000-0000-0000-0000000000ee'::uuid),
  ('NULL', null::uuid)
) as c(label, org);
select results_eq(
  $$ select id from public_event_summary('00000000-0000-0000-0000-0000000000d0') $$,
  $$ values ('00000000-0000-0000-0000-0000000000f2'::uuid) $$,
  'two events with the same timestamp: the higher id wins, every time'
);
select results_eq(
  $$ select id from public_event_summary('00000000-0000-0000-0000-0000000000ec') $$,
  $$ values ('00000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'the newest event is the one CREATED last (not the higher id, not the later event date)'
);
select is(
  (select string_agg(x.argname, ',' order by x.ord)
     from pg_proc p, unnest(p.proargnames) with ordinality as x(argname, ord)
    where p.pronamespace = 'public'::regnamespace and p.proname = 'public_event_summary'),
  'p_org_id,id,name,event_date,is_test',
  'it returns exactly id, name, event_date and is_test (no org_id, no created_at, no config)'
);

-- ============ who may call them ============

reset role;
select ok(
  has_function_privilege('anon', 'public_org_by_slug(text)', 'execute')
  and has_function_privilege('authenticated', 'public_org_by_slug(text)', 'execute')
  and has_function_privilege('anon', 'public_event_summary(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public_event_summary(uuid)', 'execute'),
  'anon and authenticated can execute both'
);
select ok(
  not has_function_privilege('service_role', 'public_org_by_slug(text)', 'execute')
  and not has_function_privilege('service_role', 'public_event_summary(uuid)', 'execute'),
  'the service role is not granted them (it has no need)'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace = 'public'::regnamespace and p.proname in ('public_org_by_slug', 'public_event_summary') and a.grantee = 0),
  0,
  'and nothing is granted to PUBLIC'
);
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('public_org_by_slug', 'public_event_summary')
      and p.prosecdef and p.provolatile = 's' and coalesce(p.proconfig @> array['search_path=""'], false)),
  2,
  'both are SECURITY DEFINER, STABLE and have a pinned search_path'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public_org_by_slug('bravo-roasters')), 1, 'a signed-in user can look up any slug too');
select is((select count(*)::int from public_event_summary('00000000-0000-0000-0000-0000000000b0')), 1, 'and any org''s newest event');
reset role;

-- ============ the anonymous door list is pinned ============

-- Left out of the comparison: functions that belong to an extension (pgTAP itself installs dozens in
-- public while this file runs), trigger functions (they can only be fired by a trigger, never called),
-- and rls_auto_enable, a Supabase event-trigger helper that the cloud project grants to anon and a
-- local stack does not.
select is(
  (select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'get_scoring_record, public_event_summary, public_live_now, public_org_by_slug, session_bean_count, session_display_guesses, submit_guess',
  'the public functions anon can execute are exactly this list (a new anonymous door must be added here on purpose)'
);
select is(
  (select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'app'::regnamespace and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)),
  'session_bean_count, session_display_guesses, session_id_for_guess, session_is_creator, session_is_open, window_lock_on, window_locked_events',
  'and the internal functions anon can execute are only the Guess the Bean helpers its policies need'
);

-- ============ publish_event_results stamps whose result it is ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1',
       '{"champion":"Sam","org_name":"Fake Org","org_slug":"fake-org"}'::jsonb) $$,
  'an owner publishes a real event, even with a payload that already claims another org''s name'
);
reset role;
select is(
  (select payload ->> 'org_name' from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Alpha Coffee', 'the published payload carries the org''s real name (the client''s claim was overwritten)'
);
select is(
  (select payload ->> 'org_slug' from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'alpha-coffee', '…and its real slug'
);
select is(
  (select payload ->> 'champion' from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Sam', '…and the rest of the payload is kept'
);
select is(
  (select count(*)::int from jsonb_object_keys((select payload from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'))),
  3, '…with exactly three keys (champion, org_name, org_slug)'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '{"champion":"Alex"}'::jsonb) $$,
  'republishing replaces the payload'
);
reset role;
select is(
  (select payload ->> 'champion' || '|' || (payload ->> 'org_name') from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Alex|Alpha Coffee', '…and the org name is stamped again'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  format('select publish_event_results(%L, %L, %L::jsonb)', '00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', c.payload),
  '22023', 'publish_event_results: the payload must be a JSON object',
  'a payload that is ' || c.label || ' is refused'
)
from (values ('an array', '[1,2]'), ('a string', '"x"'), ('a number', '5'), ('JSON null', 'null')) as c(label, payload);
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', null) $$,
  '22023', 'publish_event_results: the payload must be a JSON object',
  'and so is a SQL NULL'
);
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', '{}'::jsonb) $$,
  'P0001', 'publish_event_results: refusing to publish a test event (00000000-0000-0000-0000-0000000000e2)',
  'a test event is still refused'
);
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e2', '[1]'::jsonb) $$,
  '22023', 'publish_event_results: the payload must be a JSON object',
  'a bad payload on a test event reports the payload (the payload check comes before the test-event check)'
);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '{}'::jsonb) $$,
  'P0001', 'publish_event_results: event 00000000-0000-0000-0000-0000000000e1 not found',
  'and another org''s owner still gets "not found"'
);
reset role;

-- ============ the stamp holds for EVERY writer, not only the RPC ============

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ update public_results
        set payload = '{"org_name":"Bravo Roasters","org_slug":"bravo-roasters","champion":"Forged"}'::jsonb
      where event_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'a member writes straight into the table, claiming ANOTHER org''s name'
);
reset role;
select is(
  (select (payload ->> 'org_name') || '|' || (payload ->> 'org_slug') || '|' || (payload ->> 'champion')
     from public_results where event_id = '00000000-0000-0000-0000-0000000000e1'),
  'Alpha Coffee|alpha-coffee|Forged',
  'the trigger replaced the claim with the row''s real org, and kept the other keys'
);
set local role authenticated;
select throws_ok(
  $$ update public_results set payload = '[1,2]'::jsonb where event_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '22023', 'public_results: the payload must be a JSON object',
  'a raw write of a non-object payload is refused too'
);
select throws_ok(
  $$ update public_results set payload = jsonb_build_object('pad', repeat('x', 300000)) where event_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '22023', 'public_results: the payload is too large (256 KB at most)',
  'and so is one over 256 KB'
);
select lives_ok(
  $$ update public_results set payload = jsonb_build_object('pad', repeat('x', 200000)) where event_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'while one of 200 KB (about seventy times a real payload) is accepted'
);
-- the cap counts the client's payload, not the stamp: one of exactly 262144 bytes (the text of
-- {"p": "xxx..."} is 9 bytes more than the x's) is accepted, can be written again, and 1 byte more is not
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('p', repeat('x', 262135))) $$,
  'a payload of exactly 256 KB is accepted'
);
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('p', repeat('x', 262135))) $$,
  'and can be published again over the row it already stamped'
);
select lives_ok(
  $$ update public_results set published_at = now() where event_id = '00000000-0000-0000-0000-0000000000e1' $$,
  'and the stored row (now carrying the stamp) can still be touched'
);
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('p', repeat('x', 262136))) $$,
  '22023', 'public_results: the payload is too large (256 KB at most)',
  'while one byte more is refused'
);
-- the cap is in BYTES, not characters: two-byte letters reach it with half the characters
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('p', repeat('é', 131067) || 'x')) $$,
  'a payload of exactly 262144 bytes made of two-byte letters is accepted'
);
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('p', repeat('é', 131068))) $$,
  '22023', 'public_results: the payload is too large (256 KB at most)',
  'and one of 262145 bytes (only 131077 characters) is refused'
);
-- the trigger's own shape check, on direct writes (the RPC has its own, earlier, message)
select throws_ok(
  format('update public_results set payload = %L::jsonb where event_id = %L', c.p, '00000000-0000-0000-0000-0000000000e1'),
  '22023', 'public_results: the payload must be a JSON object',
  'a raw write of ' || c.label || ' is refused by the trigger'
)
from (values ('a string', '"x"'), ('a number', '5'), ('JSON null', 'null'), ('SQL NULL', null::text)) as c(label, p);
reset role;
select is(
  (select string_agg(tgname::text, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.public_results'::regclass and not tgisinternal),
  'trg_public_results_archive_note,trg_public_results_org_check,trg_public_results_org_immutable,trg_public_results_stamp_org',
  'the triggers on public_results fire in this order (the org check runs before the payload checks)'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('pad', repeat('x', 300000))) $$,
  '22023', 'public_results: the payload is too large (256 KB at most)',
  'the RPC path refuses an oversize payload as well (the trigger is the one guard)'
);
reset role;
select ok(
  not has_function_privilege('anon', 'app.stamp_public_results_org()', 'execute')
  and not has_function_privilege('authenticated', 'app.stamp_public_results_org()', 'execute')
  and not has_function_privilege('service_role', 'app.stamp_public_results_org()', 'execute'),
  'the trigger function is executable by no API role'
);
select ok(
  (select p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)
     from pg_proc p where p.oid = 'app.stamp_public_results_org()'::regprocedure),
  'and it is SECURITY DEFINER with a pinned search_path (it must read orgs the writer cannot see)'
);

-- a member of TWO orgs publishes to each, and each row carries its own org
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '{"champion":"A"}'::jsonb) $$,
  'a member of both orgs publishes Alpha''s event'
);
select lives_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000e3', '{"champion":"B"}'::jsonb) $$,
  'and Bravo''s event'
);
reset role;
select is(
  (select string_agg(event_id::text || '=' || (payload ->> 'org_slug'), ',' order by event_id) from public_results
    where event_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3')),
  '00000000-0000-0000-0000-0000000000e1=alpha-coffee,00000000-0000-0000-0000-0000000000e3=bravo-roasters',
  'each row carries its own org (the stamp follows the row, not the caller''s other membership)'
);

-- a non-member who sends a bad payload learns "not found", not the payload error
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select throws_ok(
  $$ select publish_event_results('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000000e1', '[1]'::jsonb) $$,
  'P0001', 'publish_event_results: event 00000000-0000-0000-0000-0000000000e1 not found',
  'a non-member with a bad payload still gets "not found" (the event check comes first)'
);
reset role;

-- signed-in users keep what they had on the archive
select ok(
  has_column_privilege('authenticated', 'public.public_results', 'published_by', 'select')
  and has_table_privilege('authenticated', 'public.public_results', 'insert')
  and has_table_privilege('authenticated', 'public.public_results', 'update')
  and has_table_privilege('authenticated', 'public.public_results', 'delete'),
  'signed-in users keep their grants on the archive (including published_by)'
);

-- ============ anon and the archive ============

set local role anon;
select is(
  (select count(*)::int from (select event_id, payload, published_at from public_results
                               where event_id = '00000000-0000-0000-0000-0000000000e1') r), 1,
  'anon can read the published row''s event_id, payload and published_at'
);
select throws_ok(
  $$ select published_by from public_results $$,
  '42501', 'permission denied for table public_results',
  'but not who published it'
);
select throws_ok(
  $$ select * from public_results $$,
  '42501', 'permission denied for table public_results',
  'and `select *` is refused too'
);
reset role;
select is(
  (select array_agg(a.attname::text order by a.attname) from pg_attribute a
    where a.attrelid = 'public.public_results'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', a.attrelid, a.attnum, 'select')),
  array['event_id', 'id', 'org_id', 'payload', 'published_at'],
  'the columns anon can read are exactly this list (a new column stays hidden until it is added here on purpose)'
);

select * from finish();
rollback;
