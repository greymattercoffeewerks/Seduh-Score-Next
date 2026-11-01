-- T-TEN.E1 (part 2): the cross-organisation negative matrix over every RPC that takes an organisation, event,
-- heat, match, stage, slot, entry or person id, and the guard that keeps it complete.
--
-- Two organisations, A and B, each with the resources every RPC needs, and four signed-in callers:
--   user_a (A only), user_b (B only), user_ab (both, an organiser, never an owner), user_c (nobody).
-- For each RPC, six cross-organisation attempts must ALL be refused with the function's own guard (a "not
-- found", "does not belong", "only an owner", permission or row-level-security refusal), never succeed and never
-- fail for some unrelated reason:
--   1. a stranger from the other organisation calls it for A's resource (org A, resource A, caller user_b);
--   2. a member of A calls it with A's id and B's resource (the mismatched p_org_id case);
--   3. a member of A names B as the organisation, with B's resource;
--   4. user_ab, who belongs to both, names A with B's resource;
--   5. ...and names B with A's resource: a member of both cannot mix the two in one call;
--   6. a signed-in caller who belongs to nobody.
-- And the matching own-organisation call is NOT refused by that guard (so the refusals above are the guard, not a
-- broken call). Every attempt runs in a sub-transaction that is always rolled back, so nothing it does persists.
-- The functions the service role alone may run are pinned as not executable by anon or signed-in callers, my_orgs
-- is shown to list exactly the caller's own organisations, and a new RPC that takes one of these ids fails here
-- until it is added to the matrix (or consciously exempted).
begin;
select plan(74);

create schema e1;
grant usage on schema e1 to anon, authenticated;

create function e1.u(tag text, n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-' || tag || '-' || lpad(n::text, 12, '0'))::uuid
$$;

-- The SQLSTATE and message of a statement, or 'ok' when it ran; always rolled back.
create function e1.attempt(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate || ': ' || sqlerrm;
end $$;

-- A valid E.164 phone for a fixture person (people.phone has been CHECKed since T-ID.A3): '+67390', the sequence
-- number, and two digits taken from the org tag so the two orgs differ. Never use a bare string such as '555-1'.
create function e1.phone(t text, n int) returns text language sql immutable as $$
  select '+67390' || lpad(n::text, 2, '0') || lpad((ascii(left(t, 1)) % 100)::text, 2, '0')
$$;

-- ============ fixtures (as postgres) ============

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user-a@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000002', 'user-b@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000003', 'user-ab@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000004', 'user-c@test.seduh-next');

do $fixture$
declare t text;
begin
  foreach t in array array['aaaa', 'bbbb'] loop
    insert into orgs (id, name, slug) values (e1.u(t, 100), 'Org ' || t, 'org-' || t);
    insert into org_members (org_id, user_id, role) values
      (e1.u(t, 100),
       case t when 'aaaa' then '00000000-0000-0000-0000-000000000001'::uuid else '00000000-0000-0000-0000-000000000002'::uuid end,
       'owner'),
      (e1.u(t, 100), '00000000-0000-0000-0000-000000000003', 'organiser');
    insert into events (id, org_id, format, name) values (e1.u(t, 1), e1.u(t, 100), 'cup_taster', 'Event ' || t);
    insert into events (id, org_id, format, name, is_test) values (e1.u(t, 20), e1.u(t, 100), 'cup_taster', 'Test event ' || t, true);
    insert into events (id, org_id, format, name, is_test) values (e1.u(t, 50), e1.u(t, 100), 'btc', 'Brewers event ' || t, true);
    insert into event_entries (id, event_id, display_name) values (e1.u(t, 2), e1.u(t, 1), 'Cupper ' || t);
    insert into people (id, org_id, display_name, phone) values
      (e1.u(t, 17), e1.u(t, 100), 'Person ' || t, e1.phone(t, 1)),
      (e1.u(t, 18), e1.u(t, 100), 'Other person ' || t, e1.phone(t, 2));
    insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values (e1.u(t, 3), e1.u(t, 1), 'prelims', 1, 1, 480);
    insert into ct_sets (id, stage_id, position) values (e1.u(t, 4), e1.u(t, 3), 1);
    insert into ct_stage_entries (id, stage_id, entry_id) values (e1.u(t, 5), e1.u(t, 3), e1.u(t, 2));
    insert into ct_heats (id, stage_id, heat_number, duration_secs) values (e1.u(t, 6), e1.u(t, 3), 1, 480);
    insert into ct_heat_entries (id, heat_id, entry_id, station) values (e1.u(t, 7), e1.u(t, 6), e1.u(t, 2), 'Table');
    insert into btc_teams (id, event_id, name) values
      (e1.u(t, 9), e1.u(t, 1), 'Team one ' || t), (e1.u(t, 10), e1.u(t, 1), 'Team two ' || t);
    insert into btc_judges (id, event_id, name) values
      (e1.u(t, 11), e1.u(t, 1), 'Judge ' || t),
      (e1.u(t, 21), e1.u(t, 1), 'Judge two ' || t),
      (e1.u(t, 22), e1.u(t, 1), 'Judge three ' || t);
    insert into btc_matches (id, event_id, round, team1_id, team2_id) values
      (e1.u(t, 12), e1.u(t, 1), 'preliminary', e1.u(t, 9), e1.u(t, 10));
    insert into btc_match_judges (match_id, judge_id) values (e1.u(t, 12), e1.u(t, 11));
    insert into btc_bracket_slots (id, event_id, round, slot_label) values (e1.u(t, 14), e1.u(t, 1), 'final', 'Final ' || t);
  end loop;
end
$fixture$;

-- ============ the matrix specification: one row per RPC ============
-- sql: the call; '@' is the organisation the caller names, '%' the organisation the resource belongs to.
-- org_only: the function takes no resource (so only "who may call it for this organisation" is asked).
-- org_arg:  false for a function that is told no organisation, only the resource (create_btc_match): a caller who
--   belongs to the resource's organisation is then simply allowed, so only callers who do not belong attack it.
create table e1.rpc (name text primary key, sql text not null, org_only boolean not null default false, org_arg boolean not null default true,
  own_expect text not null default 'ok');  -- the exact outcome of the caller's OWN call: 'ok', or the one downstream rule that stops it
insert into e1.rpc (name, sql, org_only) values
  ('start_heat', 'select public.start_heat(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',6), now())', false),
  ('auto_max_heat', 'select public.auto_max_heat(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',6), now())', false),
  ('confirm_heat', 'select public.confirm_heat(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',6), now(), ''[]''::jsonb)', false),
  ('record_heat_time', 'select public.record_heat_time(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',7), ''timing'', 10, 10, false, ''tap'', now(), ''reject'')', false),
  ('correct_heat_time', 'select public.correct_heat_time(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',7), 10, 11, 11, false, ''a reason'', now())', false),
  ('resolve_stage', 'select public.resolve_stage(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',3), null, ''[]''::jsonb, null, ''[]''::jsonb, null, ''[]''::jsonb, null)', false),
  ('publish_session', 'select public.publish_session(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',1), ''cup_taster'', false, ''{}''::jsonb, now())', false),
  ('publish_event_results', 'select public.publish_event_results(e1.u(''@'',100), e1.u(''%'',1), ''{"format":"cup_taster"}''::jsonb)', false),
  ('unpublish_event_results', 'select public.unpublish_event_results(e1.u(''@'',100), e1.u(''%'',1))', false),
  ('delete_test_event', 'select public.delete_test_event(e1.u(''@'',100), e1.u(''%'',20))', false),
  ('get_dispute_pack', 'select public.get_dispute_pack(e1.u(''@'',100), e1.u(''%'',1))', false),
  ('merge_people', 'select public.merge_people(e1.u(''@'',100), e1.u(''%'',17), e1.u(''%'',18))', false),
  ('update_roster_entry', 'select public.update_roster_entry(e1.u(''@'',100), e1.u(''%'',2), ''New name'', null, null, null, null)', false),
  ('confirm_btc_match', 'select public.confirm_btc_match(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',12), now(), ''[]''::jsonb, null, false, false, null, null)', false),
  ('record_btc_tiebreak', 'select public.record_btc_tiebreak(e1.u(''@'',100), e1.u(''%'',12), e1.u(''%'',9), ''a reason'')', false),
  ('record_btc_seeding_tiebreak', 'select public.record_btc_seeding_tiebreak(e1.u(''@'',100), e1.u(''%'',1), array[e1.u(''%'',9), e1.u(''%'',10)], ''a reason'')', false),
  ('generate_btc_bracket', 'select public.generate_btc_bracket(e1.u(''@'',100), e1.u(''%'',1))', false),
  ('create_btc_bracket_match', 'select public.create_btc_bracket_match(e1.u(''@'',100), e1.u(''%'',14), array[e1.u(''%'',11)])', false),
  ('load_btc_demo', 'select public.load_btc_demo(e1.u(''@'',100), e1.u(''%'',50), true)', false),
  ('create_btc_match', 'select public.create_btc_match(e1.u(''%'',1), ''preliminary'', e1.u(''%'',9), e1.u(''%'',10), array[e1.u(''%'',11), e1.u(''%'',21), e1.u(''%'',22)])', false),
  ('team_list_members', 'select * from public.team_list_members(e1.u(''@'',100))', true),
  ('team_list_removed_members', 'select * from public.team_list_removed_members(e1.u(''@'',100))', true),
  ('finish_event', 'select public.finish_event(e1.u(''@'',100), e1.u(''%'',1))', false),
  ('my_entitlements', 'select public.my_entitlements(e1.u(''@'',100), e1.u(''%'',1))', false),
  ('team_remove_member', 'select public.team_remove_member(e1.u(''@'',100), ''00000000-0000-0000-0000-000000000003''::uuid)', true),
  ('link_person_identity', 'select public.link_person_identity(e1.u(''@'',100), e1.u(''%'',17))', false),
  ('stage_archive_payload', 'select public.stage_archive_payload(gen_random_uuid(), e1.u(''@'',100), e1.u(''%'',1), ''{"podium":[{"name":"A"}]}''::jsonb)', false),
  ('set_archive_listing', 'select public.set_archive_listing(e1.u(''@'',100), e1.u(''%'',1), true)', false);

update e1.rpc set org_arg = false where name = 'create_btc_match';
-- Where the organisation's own call is stopped by a LATER rule of the function (the fixture is a pending heat, an
-- unscored cupper, a bracket that exists, ...), the rule is named here, so the own call is shown to pass the
-- organisation check and stop at exactly that rule, not for some unrelated reason.
update e1.rpc set own_expect = case name
  when 'confirm_btc_match'           then 'P0001: confirm_btc_match: match must have exactly 3 judges'
  when 'confirm_heat'                then 'P0001: confirm_heat: 1 cupper\(s\) do not have every set scored'
  when 'correct_heat_time'           then 'P0002: CONFLICT: heat .* is pending, its times can no longer be corrected'
  when 'create_btc_bracket_match'    then 'P0001: create_btc_bracket_match: both of this slot''s teams must be known first'
  when 'generate_btc_bracket'        then 'P0001: generate_btc_bracket: a bracket already exists for this event'
  when 'record_btc_seeding_tiebreak' then 'P0001: record_btc_seeding_tiebreak: the bracket already exists, so the seeds are fixed'
  when 'record_btc_tiebreak'         then 'P0001: record_btc_tiebreak: a tie-break applies to knockout matches only'
  when 'record_heat_time'            then 'P0002: CONFLICT: heat .* is pending now, expected timing'
  else 'ok' end;
select is((select count(*)::int from e1.rpc), 28, 'the matrix covers 28 RPCs');
select is(
  (select coalesce(string_agg(r.name, ', '), 'none') from e1.rpc r
    where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.name)),
  'none',
  'and every RPC the matrix names exists');

-- ============ the calls, one run per caller ============

create table e1.results (caller text, rpc text, kind text, code text);
grant select on e1.rpc to anon, authenticated;
grant insert on e1.results to anon, authenticated;
grant execute on all functions in schema e1 to anon, authenticated;

-- (caller, organisation named, organisation the resource belongs to): 'attack' cases and 'own' controls
create table e1.cases (caller text, org text, res text, kind text);
insert into e1.cases values
  ('user_b',  'aaaa', 'aaaa', 'attack'),   -- 1 a stranger names A with A's resource
  ('user_a',  'aaaa', 'bbbb', 'attack'),   -- 2 a member of A: A's id, B's resource
  ('user_a',  'bbbb', 'bbbb', 'attack'),   -- 3 a member of A names B
  ('user_ab', 'aaaa', 'bbbb', 'attack'),   -- 4 both organisations: A's id, B's resource
  ('user_ab', 'bbbb', 'aaaa', 'attack'),   -- 5 both organisations: B's id, A's resource
  ('user_c',  'aaaa', 'aaaa', 'attack'),   -- 6 nobody
  ('user_ab', 'aaaa', 'aaaa', 'attack_nonowner'),  -- 7 a member who is not an OWNER, on an owner-only function
  ('user_ab', 'bbbb', 'bbbb', 'attack_nonowner'),
  ('user_a',  'aaaa', 'aaaa', 'own'),
  ('user_b',  'bbbb', 'bbbb', 'own'),
  ('user_ab', 'aaaa', 'aaaa', 'own'),
  ('user_ab', 'bbbb', 'bbbb', 'own');
grant select on e1.cases to anon, authenticated;

create procedure e1.run_as(who text) language plpgsql as $$
begin
  insert into e1.results
  select who, r.name, c.kind || ':' || c.org || '/' || c.res,
         e1.attempt(replace(replace(r.sql, '@', c.org), '%', c.res))
    from e1.rpc r join e1.cases c on c.caller = who
   -- an org-only function has no resource to mismatch: only the organisation named matters
   where not (r.org_only and c.res <> c.org)
     -- the team functions are for an organisation's OWNERS: user_ab is an organiser of both, so is only an attacker here
     and not (r.name like 'team\_%' and c.caller = 'user_ab' and c.kind = 'own')
     -- only the owner-only (org_only) functions are attacked by an organiser who is not an owner: for the others it is an ordinary call
     and not (c.kind = 'attack_nonowner' and not r.org_only)
     and not (not r.org_arg and c.kind = 'attack'
              and (who = 'user_ab' or (who = 'user_a' and c.res = 'aaaa') or (who = 'user_b' and c.res = 'bbbb')));
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
call e1.run_as('user_a');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
call e1.run_as('user_b');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
call e1.run_as('user_ab');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
call e1.run_as('user_c');
reset role;

-- the function's own guard speaking (and not an argument error, a missing row of the fixture, or success)
create function e1.is_guard(code text, rpc text) returns boolean language sql immutable as $$
  select code ~ '^(42501|P0001): ' and code ~* ('(not found|does not belong|only an owner'
    || case when rpc = 'link_person_identity' then '|row-level security policy for table "people"' else '' end || ')')
$$;

-- ============ every cross-organisation attempt is refused by the guard ============

select is(
  (select coalesce(string_agg(r.caller || ' ' || r.kind || ' -> ' || left(r.code, 90), E'\n' order by r.kind, r.caller), 'none')
     from e1.results r where r.rpc = q.name and r.kind like 'attack%' and not e1.is_guard(r.code, r.rpc)),
  'none',
  q.name || ': every cross-organisation attempt is refused by its own guard'
) from e1.rpc q order by q.name;

-- ...and the own-organisation call is not refused by that guard: the attempts above are not just a broken call
select is(
  (select coalesce(string_agg(r.caller || ' ' || r.kind || ' -> ' || left(r.code, 90), E'\n' order by r.kind, r.caller), 'none')
     from e1.results r where r.rpc = q.name and r.kind like 'own:%' and r.code !~ ('^(' || q.own_expect || ')')),
  'none',
  q.name || ': the same call for the caller''s own organisation gets exactly its expected outcome (' || left(q.own_expect, 60) || ')'
) from e1.rpc q order by q.name;

-- each RPC was attacked, and its own organisation's callers did call it (a missing row would otherwise pass)
select cmp_ok(
  (select min(c)::int from (select count(*) filter (where r.kind like 'attack%') as c from e1.results r group by r.rpc) x),
  '>=', 3, 'every RPC was attacked at least three ways');
select is((select count(distinct rpc)::int from e1.results), (select count(*)::int from e1.rpc), 'and every RPC in the matrix produced results');
select cmp_ok(
  (select min(c)::int from (select count(*) filter (where r.kind like 'own:%') as c from e1.results r group by r.rpc) x),
  '>=', 2, 'and was called by its own organisation''s members');
select is(
  (select coalesce(string_agg(r.rpc, ', '), 'none')
     from (select name as rpc from e1.rpc r2 where (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r2.name) <> 1) r),
  'none',
  'every RPC in the matrix has exactly one overload (the guards below match functions by name)');

-- ============ who may call what at all ============

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_org', 'org_add_existing_member', 'org_set_role', 'team_add_member', 'team_restore_member', 'admin_record_account_create')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'none',
  'the six service-role-only functions cannot be run by anon or by any signed-in caller');

select is(
  (select coalesce(string_agg(r.name, ', ' order by r.name), 'none')
     from e1.rpc r join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = r.name
    where has_function_privilege('anon', p.oid, 'execute')),
  'none',
  'no RPC in the matrix can be executed by anon');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), 'none')
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
      -- ANY uuid (or uuid[]) argument, named or not: an id of something that belongs to an organisation
      and exists (select 1 from unnest(p.proargtypes::oid[]) a where a in ('uuid'::regtype::oid, '_uuid'::regtype::oid))
      and p.proname not in (select name from e1.rpc)
      -- exempt, each by its own test: the public doors and read helpers (037, 039, 025, 026, 019), the creator-scoped
      -- Guess the Bean functions (010), and the platform-admin console's RPCs (048 reads, 049 writes): their
      -- authorisation is "a platform admin at aal2 with a fresh TOTP" (app.require_platform_admin), not membership
      -- of an organisation; the reads return aggregates and identity metadata only (048 pins their column lists), the
      -- writes wrap the service-role-only provisioning functions and audit every change (049 refuses anyone else); the entitlement grant functions are the same kind (053; admin_event_resnapshot: 054)
      and p.oid::regprocedure::text not in (
        'public_event_summary(uuid)', 'team_can_manage(uuid,uuid)', 'team_can_restore(uuid,uuid)', 'get_scoring_record(uuid)',
        'reset_guess_session_data(uuid)', 'session_bean_count(uuid)', 'session_display_guesses(uuid)',
        'submit_guess(uuid,text,integer,text,text)',
        'admin_org_detail(uuid)', 'admin_list_audit(integer,bigint,uuid)',
        'admin_create_org(text,text,uuid,boolean)', 'admin_add_member(uuid,uuid,text,boolean)', 'admin_set_role(uuid,uuid,text)',
        'admin_grant_create(uuid,text,uuid,integer,timestamp with time zone,text,text)', 'admin_grant_extend(uuid,timestamp with time zone,text)',
        'admin_grant_revoke(uuid,text)', 'admin_list_grants(uuid)', 'admin_event_resnapshot(uuid,text)', 'admin_event_release(uuid,text)',
        'admin_plan_org(uuid)', 'admin_payment_confirm(uuid,text,uuid,integer,timestamp with time zone,text)')),
  'none',
  'every function or procedure a signed-in or anonymous caller can run that takes a uuid (an organisation, event, heat, match, stage, slot, entry, person or user id) is in this matrix or on the short, named exemption list: a new one fails here until it is added to e1.rpc');

-- ============ the read-only helpers and doors ============

set local role anon;
select is(
  (select get_scoring_record(e1.u('aaaa', 1)) is null),
  true,
  'anon asking for the scoring record of an event that was never published gets nothing');
select is(
  (select get_scoring_record(e1.u('bbbb', 1)) is null),
  true,
  '...for either organisation');
reset role;

-- the answers: a stranger is not told they may manage another organisation's team
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is(
  (select public.team_can_manage(e1.u('aaaa', 100), '00000000-0000-0000-0000-000000000002')),
  false,
  'user_b cannot manage organisation A''s team');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is(
  (select public.team_can_manage(e1.u('aaaa', 100), '00000000-0000-0000-0000-000000000003')),
  false,
  'user_ab, an organiser of A and not an owner, cannot manage A''s team either');
reset role;

-- my_orgs lists exactly the caller's own organisations
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is((select string_agg(slug, ',' order by slug) from public.my_orgs()), 'org-aaaa', 'my_orgs: user_a sees only organisation A');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select string_agg(slug, ',' order by slug) from public.my_orgs()), 'org-bbbb', 'my_orgs: user_b sees only organisation B');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is((select string_agg(slug, ',' order by slug) from public.my_orgs()), 'org-aaaa,org-bbbb', 'my_orgs: user_ab sees both');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.my_orgs()), 0, 'my_orgs: a signed-in stranger sees none');
reset role;
set local role anon;
select throws_ok($$ select * from public.my_orgs() $$, '42501', null, 'my_orgs: anon cannot call it');
reset role;

select * from finish();
rollback;
