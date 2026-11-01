-- T-ARC.4b: my_entitlements reports `enforced` for the archive key only. Proves:
--   * a member gets `enforced` on results_archive_optional and on NO other key (the whitelist is exactly one key);
--   * it follows the key: false while dark (allowed true), true once flipped (allowed false for community, true for per_event);
--   * the entry shape is otherwise unchanged (flag keys carry only allowed, caps still carry allowed and limit);
--   * nothing admin-only appears anywhere in the result (note, min_tier, window_bound, granted_by, caps rows);
--   * a non-member, another organisation's event, an unknown organisation and anon are refused as before (no oracle);
--   * the signature, SECURITY DEFINER and the pinned search_path are unchanged and anon holds no execute privilege.
begin;
select plan(21);

create schema t069;
grant usage on schema t069 to anon, authenticated;
create function t069.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0690-' || lpad(n::text, 12, '0'))::uuid
$$;
create function t069.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  return sqlstate;
end $$;
grant execute on all functions in schema t069 to anon, authenticated;

insert into auth.users (id, email) values
  (t069.u(1), 'x-member@test.seduh-next'), (t069.u(2), 'y-member@test.seduh-next'), (t069.u(3), 'nobody@test.seduh-next');
insert into orgs (id, name, slug) values (t069.u(100), 'Org X', 'org-x-069'), (t069.u(200), 'Org Y', 'org-y-069');
insert into org_members (org_id, user_id, role) values (t069.u(100), t069.u(1), 'owner'), (t069.u(200), t069.u(2), 'owner');
insert into events (id, org_id, format, name) values
  (t069.u(101), t069.u(100), 'cup_taster', 'X event'), (t069.u(201), t069.u(200), 'cup_taster', 'Y event');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000001';

-- dark (the seed): the field is there, false, and allowed stays true
select is(public.my_entitlements(t069.u(100)) -> 'keys' -> 'results_archive_optional', '{"allowed": true, "enforced": false}'::jsonb,
  'dark: the archive key reports enforced=false next to allowed=true');
select is(public.my_entitlements(t069.u(100), t069.u(101)) -> 'keys' -> 'results_archive_optional', '{"allowed": true, "enforced": false}'::jsonb,
  'dark, with an event named (the console''s call): the same entry');
select is(
  (select string_agg(e.key, ',' order by e.key) from jsonb_each(public.my_entitlements(t069.u(100)) -> 'keys') e where e.value ? 'enforced'),
  'results_archive_optional', 'the whitelist is exactly one key: no other key carries `enforced`');
select is((public.my_entitlements(t069.u(100)) -> 'keys') -> 'btc_format', '{"allowed": true}'::jsonb, 'another flag key is unchanged (allowed only)');
select is((public.my_entitlements(t069.u(100)) -> 'keys') -> 'cup_taster_participants', '{"allowed": true, "limit": null}'::jsonb, 'a cap key is unchanged (allowed and limit)');
select is((select count(*)::int from jsonb_object_keys(public.my_entitlements(t069.u(100)) -> 'keys')), 11, 'still one entry per key');
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.my_entitlements(t069.u(100), t069.u(101))) k),
  'keys,tier,window', 'the top-level shape is unchanged (tier, keys, window)');

-- enforced: community is refused the choice, a per_event plan has it
reset role;
update app.entitlement_keys set enforced = true where key = 'results_archive_optional';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000001';
select is(public.my_entitlements(t069.u(100)) -> 'keys' -> 'results_archive_optional', '{"allowed": false, "enforced": true}'::jsonb,
  'enforced, community: allowed=false (the listing is compulsory), enforced=true');
select is(public.my_entitlements(t069.u(100), t069.u(101)) -> 'keys' -> 'results_archive_optional', '{"allowed": false, "enforced": true}'::jsonb,
  'enforced, community, with an event named: the same entry');
reset role;
insert into entitlement_grants (org_id, tier, valid_from, source) values (t069.u(100), 'per_event', now() - interval '1 day', 'manual');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000001';
select is(public.my_entitlements(t069.u(100)) -> 'keys' -> 'results_archive_optional', '{"allowed": true, "enforced": true}'::jsonb,
  'enforced, per_event: allowed=true, enforced=true');
select is(
  (select string_agg(e.key, ',' order by e.key) from jsonb_each(public.my_entitlements(t069.u(100)) -> 'keys') e where e.value ? 'enforced'),
  'results_archive_optional', 'still exactly one key carries `enforced` once something is enforced');

-- nothing admin-only: every entry has exactly the intended fields (a denylist of names would miss a new column)
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000001';
select is(
  (select coalesce(string_agg(e.key, ',' order by e.key), 'none')
     from jsonb_each(public.my_entitlements(t069.u(100), t069.u(101)) -> 'keys') e
     join app.entitlement_keys k on k.key = e.key
    where (select string_agg(f, ',' order by f) from jsonb_object_keys(e.value) f)
          is distinct from case when k.key = 'results_archive_optional' then 'allowed,enforced'
                                when k.kind = 'cap' then 'allowed,limit' else 'allowed' end),
  'none', 'every key entry carries exactly allowed (+ limit for a cap, + enforced for the archive key) and nothing else');
select is((select count(*)::int from app.entitlement_keys), 11, 'and the join above covered all eleven keys');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000001';

-- the refusals are unchanged
select is(t069.refusal($$ select public.my_entitlements(t069.u(200)) $$), '42501', 'a member of X asking for Y: 42501');
select is(t069.refusal($$ select public.my_entitlements(t069.u(100), t069.u(201)) $$), '42501', 'X with Y''s event: the same 42501');
select is(t069.refusal($$ select public.my_entitlements(gen_random_uuid()) $$), '42501', 'an unknown organisation: the same 42501');
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000003';
select is(t069.refusal($$ select public.my_entitlements(t069.u(100)) $$), '42501', 'a signed-in stranger: 42501, nothing returned');
reset role;
set local role anon;
set local request.jwt.claim.sub = '00000000-0000-0000-0690-000000000001';
select is(t069.refusal($$ select public.my_entitlements(t069.u(100)) $$), '42501', 'anon, even carrying a member''s sub: 42501 (only the missing grant can refuse)');
reset role;

select is(has_function_privilege('anon', 'public.my_entitlements(uuid,uuid)', 'execute'), false, 'anon holds no execute privilege on my_entitlements (the ACL itself, not only the refusal)');
select is(has_function_privilege('authenticated', 'public.my_entitlements(uuid,uuid)', 'execute'), true, 'authenticated does');

select is(
  (select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',') || '|' || pg_get_function_identity_arguments(p.oid)
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'my_entitlements'),
  'true|search_path=""|p_org uuid, p_event uuid', 'SECURITY DEFINER, search_path pinned to empty, signature unchanged');

select * from finish();
rollback;
