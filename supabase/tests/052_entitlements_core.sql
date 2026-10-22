-- T-GATE.B1: the entitlement core (tables, resolvers, catalog seed), shipped dark (spec: Handoffs and Specs/GATING-SPEC.md,
-- 3.1 to 3.3, 6b to 6e, D-G11, D-G18). Proves:
--   * the seed: nine keys, three tiers, EVERY key unenforced, and the Cup Taster participant cap is 8 / unlimited / unlimited;
--     every cap key has a caps row for every tier (a missing row would read as unlimited);
--   * the reference tables are closed to every API role (RLS on, no policy, no privilege, no default ACL leak);
--   * resolution: no grant = community; an organisation grant, an event grant (only for that event), the HIGHEST wins
--     and never a sum, an expired / future / revoked grant does not count, a revocation dated in the future still
--     counts until then, and a key with window_bound = false counts an expired (not revoked) grant;
--   * has_entitlement: unknown key raises with a stable hint; a key that is NOT enforced allows everyone (the dark
--     guarantee), including a tier that would be refused once enforced; once enforced a flag key needs min_tier, a
--     cap key is allowed unless its limit is 0, a null min_tier is open to every tier;
--   * entitlement_limit: null while dark; the tier's limit when enforced; a flag key is refused with a stable hint;
--   * entitlement_grants: an event grant must name an event of the SAME organisation; the window is checked; every
--     column but revoked_at is frozen; the API roles can read (members of the organisation only) and write nothing;
--   * my_entitlements: members get the tier and one entry per key; a non-member, another organisation's event and
--     anon are all refused the same way (no oracle on other tenants); while dark every key is allowed and no cap shows.
-- The functions are run as the owner with an explicit clock (p_at); the API surface is exercised as the real roles.
begin;
select plan(90);

create schema t052;
grant usage on schema t052 to anon, authenticated;

create function t052.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0520-' || lpad(n::text, 12, '0'))::uuid
$$;

-- "SQLSTATE|hint" of a statement, or 'ok'; always rolled back (a sub-transaction), so a probe changes nothing.
create function t052.refusal(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '');
end $$;

-- Rows changed by a write (0 when refused); always rolled back.
create function t052.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  raise exception using errcode = 'P9999', message = n::text;
exception when others then
  if sqlstate = 'P9999' then return sqlerrm::int; end if;
  return -1;
end $$;
grant execute on all functions in schema t052 to anon, authenticated;

-- ============ fixtures (as the owner) ============
insert into auth.users (id, email) values
  (t052.u(1), 'x-member@test.seduh-next'),
  (t052.u(2), 'y-member@test.seduh-next'),
  (t052.u(3), 'nobody@test.seduh-next');
insert into orgs (id, name, slug) values (t052.u(100), 'Org X', 'org-x-052'), (t052.u(200), 'Org Y', 'org-y-052');
insert into org_members (org_id, user_id, role) values
  (t052.u(100), t052.u(1), 'owner'),
  (t052.u(200), t052.u(2), 'owner');
insert into events (id, org_id, format, name) values
  (t052.u(101), t052.u(100), 'cup_taster', 'X event one'),
  (t052.u(102), t052.u(100), 'cup_taster', 'X event two'),
  (t052.u(201), t052.u(200), 'cup_taster', 'Y event one');

-- ============ the seed ============
select is((select count(*)::int from app.entitlement_tiers), 3, 'three tiers are seeded');
select is(
  (select string_agg(tier || '=' || rank, ',' order by rank) from app.entitlement_tiers),
  'community=0,per_event=1,annual=2', 'in the order community < per_event < annual');
select is((select count(*)::int from app.entitlement_keys), 9, 'nine keys are seeded');
select is((select count(*)::int from app.entitlement_keys where enforced), 0, 'and EVERY key is seeded unenforced (dark, D-G11)');
select is(
  (select string_agg(tier || '=' || coalesce(cap_limit::text, 'unlimited'), ',' order by tier)
     from app.entitlement_caps where key = 'cup_taster_participants'),
  'annual=unlimited,community=8,per_event=unlimited',
  'cup_taster_participants: community 8, per-event and annual unlimited (D-G3)');
select is(
  (select coalesce(string_agg(k.key || '/' || t.tier, ', '), 'none')
     from app.entitlement_keys k cross join app.entitlement_tiers t
    where k.kind = 'cap' and not exists (select 1 from app.entitlement_caps c where c.key = k.key and c.tier = t.tier)),
  'none', 'every cap key has a caps row for every tier (a missing row would read as unlimited)');
select is(
  (select string_agg(key || ':' || coalesce(min_tier, 'any'), ',' order by key) from app.entitlement_keys where kind = 'flag'),
  'audience_branding:per_event,btc_format:per_event,cup_taster_analytics:annual,cup_taster_report:per_event,guess_the_bean_create:any,registration_page:per_event,results_archive_optional:per_event,season_history:annual',
  'the flag keys carry the owner''s minimum tiers (btc_format is per_event: BTC is not on Community, 2026-10-23)');
select is((select window_bound from app.entitlement_keys where key = 'registration_page'), false, 'registration_page is not bound by the window (D-G16)');
select is((select count(*)::int from app.entitlement_keys where key in ('audience_enhanced', 'cup_taster_unlimited')), 0,
  'the retired stub keys are gone (D-G28; replaced by cup_taster_participants)');

-- ============ closed to the API roles ============
select is(
  (select coalesce(string_agg(t || '/' || r, ', '), 'none')
     from unnest(array['app.entitlement_tiers', 'app.entitlement_keys', 'app.entitlement_caps']) t
    cross join unnest(array['anon', 'authenticated', 'service_role']) r
    where has_table_privilege(r, t, 'select,insert,update,delete,truncate,references,trigger')),
  'none', 'no API role holds any privilege on the three reference tables');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app' and c.relname in ('entitlement_tiers', 'entitlement_keys', 'entitlement_caps')
      and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  3, 'and each has row-level security on with no policy');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), 'none')
     from pg_proc p
    where p.pronamespace = 'app'::regnamespace and p.proname in ('effective_tier', 'has_entitlement', 'entitlement_limit')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('service_role', p.oid, 'execute'))),
  'none', 'the three resolvers are not executable by any API role');
select is(
  (select coalesce(string_agg(p.proname, ', '), 'none')
     from pg_proc p
    where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
      and p.proname in ('effective_tier', 'has_entitlement', 'entitlement_limit', 'my_entitlements')
      and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))),
  'none', 'and every one of them (and my_entitlements) is SECURITY DEFINER with search_path pinned to empty');

-- ============ effective_tier ============
-- the clock
create function t052.t(d int) returns timestamptz language sql immutable as $$
  select timestamptz '2026-11-10 12:00:00+00' + make_interval(days => d)
$$;

select is(app.effective_tier(t052.u(100), null, t052.t(0)), 'community', 'no grant: community');
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(0)), 'community', 'no grant, with an event: community');
select is(app.effective_tier(gen_random_uuid(), null, t052.t(0)), 'community', 'an organisation that does not exist: community (no grant is not an error)');

-- an organisation grant: Org X is per_event from day 0, open-ended
insert into entitlement_grants (id, org_id, tier, valid_from, source, note) values
  (t052.u(1001), t052.u(100), 'per_event', t052.t(0), 'manual', 'org grant');
select is(app.effective_tier(t052.u(100), null, t052.t(1)), 'per_event', 'an open-ended organisation grant counts after valid_from');
select is(app.effective_tier(t052.u(100), null, t052.t(-1)), 'community', 'a grant that has not started does not count');
select is(app.effective_tier(t052.u(200), null, t052.t(1)), 'community', 'and it does not leak to another organisation');

-- an event grant on event one only: annual for 5 days
insert into entitlement_grants (id, org_id, event_id, tier, valid_from, valid_until, source) values
  (t052.u(1002), t052.u(100), t052.u(101), 'annual', t052.t(0), t052.t(5), 'manual');
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(1)), 'annual', 'an event grant applies to its event');
select is(app.effective_tier(t052.u(100), t052.u(102), t052.t(1)), 'per_event', 'but not to another event of the organisation (the org grant is all it has)');
select is(app.effective_tier(t052.u(100), null, t052.t(1)), 'per_event', 'nor to the organisation with no event named');
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(6)), 'per_event', 'after the event grant ends the higher tier is gone: highest CURRENT wins');
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(5)), 'per_event', 'valid_until is exclusive');

-- the window-ignoring read (registration page)
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(10), true), 'annual',
  'ignoring the window, an EXPIRED (never revoked) event grant still counts');
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(10), false), 'per_event', 'and not when the window is respected');
-- revocation
update entitlement_grants set revoked_at = t052.t(3) where id = t052.u(1002);
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(2)), 'annual', 'a grant revoked in the future still counts until then');
select is(app.effective_tier(t052.u(100), t052.u(101), t052.t(3)), 'per_event', 'and not from the revocation on');

-- highest wins, never a sum: an org grant of annual for Org Y, plus an event grant of per_event
insert into entitlement_grants (org_id, tier, valid_from, source) values (t052.u(200), 'annual', t052.t(0), 'manual');
insert into entitlement_grants (org_id, event_id, tier, valid_from, source) values (t052.u(200), t052.u(201), 'per_event', t052.t(0), 'manual');
select is(app.effective_tier(t052.u(200), t052.u(201), t052.t(1)), 'annual', 'an organisation''s annual beats its event''s per_event: the highest, never a sum');

insert into entitlement_grants (id, org_id, event_id, tier, valid_from, valid_until, source, revoked_at) values
  (t052.u(1003), t052.u(100), t052.u(102), 'annual', t052.t(0), t052.t(2), 'manual', t052.t(0));
select is(app.effective_tier(t052.u(100), t052.u(102), t052.t(10), true), 'per_event', 'a revoked grant never counts, window ignored or not');

-- ============ has_entitlement ============
select is(t052.refusal($$ select app.has_entitlement(t052.u(100), 'not_a_key') $$), '22023|entitlement_key_unknown', 'an unknown key raises with a stable hint');
select is(t052.refusal($$ select app.entitlement_limit(t052.u(100), 'not_a_key') $$), '22023|entitlement_key_unknown', 'also for entitlement_limit');
select is(t052.refusal($$ select app.entitlement_limit(t052.u(100), 'btc_format') $$), '22023|entitlement_key_not_cap', 'entitlement_limit on a flag key is refused with a stable hint');

-- dark: nothing is enforced, so everyone is allowed, community included (the guarantee that behaviour is unchanged)
select is(
  (select coalesce(string_agg(k.key, ', '), 'none') from app.entitlement_keys k
    where not app.has_entitlement(gen_random_uuid(), k.key, null, t052.t(0))),
  'none', 'while dark, has_entitlement is true for every key even for a community organisation');
select is(app.entitlement_limit(gen_random_uuid(), 'cup_taster_participants', null, t052.t(0)), null, 'and the cap reads as unlimited while dark');

-- enforce a flag key
update app.entitlement_keys set enforced = true where key = 'btc_format';
select is(app.has_entitlement(gen_random_uuid(), 'btc_format', null, t052.t(0)), false, 'enforced flag: a community organisation is refused');
select is(app.has_entitlement(t052.u(100), 'btc_format', null, t052.t(1)), true, 'a per_event organisation is allowed (rank at or above min_tier)');
select is(app.has_entitlement(t052.u(100), 'btc_format', null, t052.t(-1)), false, 'a grant that has not started is not enough');
select is(app.has_entitlement(t052.u(200), 'btc_format', null, t052.t(1)), true, 'an annual organisation is allowed');
update app.entitlement_keys set min_tier = 'annual' where key = 'btc_format';
select is(app.has_entitlement(t052.u(100), 'btc_format', null, t052.t(1)), false, 'raising min_tier to annual refuses per_event');
select is(app.has_entitlement(t052.u(100), 'btc_format', t052.u(101), t052.t(1)), true, 'but the event grant (annual) lifts that one event');
select is(app.has_entitlement(t052.u(100), 'btc_format', t052.u(102), t052.t(1)), false, 'and not the other event');
-- the event of another organisation cannot lend its grant
select is(app.has_entitlement(t052.u(100), 'btc_format', t052.u(201), t052.t(1)), false, 'another organisation''s event grant is not borrowed');
update app.entitlement_keys set enforced = true where key = 'guess_the_bean_create';
select is(app.has_entitlement(gen_random_uuid(), 'guess_the_bean_create', null, t052.t(0)), true, 'enforced with min_tier null: open to every tier');

-- window_bound = false (registration page): an expired, unrevoked event grant still counts
update app.entitlement_keys set enforced = true where key = 'registration_page';
select is(app.has_entitlement(t052.u(100), 'registration_page', t052.u(101), t052.t(10)), true,
  'registration_page: an expired but unrevoked grant still counts (not bound by the window)');
select is(app.has_entitlement(t052.u(100), 'registration_page', t052.u(102), t052.t(10)), true,
  'registration_page: the organisation''s own per_event grant counts');
update entitlement_grants set revoked_at = t052.t(0) where id = t052.u(1001);
select is(app.has_entitlement(t052.u(100), 'registration_page', t052.u(102), t052.t(10)), false, 'revoked: gone, window-bound or not');

-- caps
update app.entitlement_keys set enforced = true where key = 'cup_taster_participants';
select is(app.entitlement_limit(gen_random_uuid(), 'cup_taster_participants', null, t052.t(0)), 8, 'enforced cap: community is limited to 8');
select is(app.entitlement_limit(t052.u(200), 'cup_taster_participants', null, t052.t(1)), null, 'annual is unlimited');
select is(app.entitlement_limit(t052.u(100), 'cup_taster_participants', t052.u(101), t052.t(1)), null, 'an event grant (annual here) lifts that event to unlimited');
select is(app.has_entitlement(gen_random_uuid(), 'cup_taster_participants', null, t052.t(0)), true, 'a cap of 8 still allows (the count is the trigger''s job)');
update app.entitlement_caps set cap_limit = 0 where key = 'cup_taster_participants' and tier = 'community';
select is(app.has_entitlement(gen_random_uuid(), 'cup_taster_participants', null, t052.t(0)), false, 'a cap of 0 refuses');
select is(t052.refusal($$ update app.entitlement_caps set cap_limit = -1 where key = 'cup_taster_participants' $$), '23514|', 'a negative limit is refused by the table');
select is(t052.refusal($$ insert into app.entitlement_caps (key, tier, cap_limit) values ('btc_format', 'community', 3) $$), '23503|', 'a cap on a flag key is refused by the table');
select is(t052.refusal($$ insert into app.entitlement_keys (key, kind, min_tier) values ('x_cap', 'cap', 'annual') $$), '23514|', 'a cap key with a min_tier is refused by the table');
select is(t052.refusal($$ insert into app.entitlement_keys (key, kind) values ('Bad Key', 'flag') $$), '23514|', 'and a key name outside [a-z0-9_] is refused');

-- ============ entitlement_grants: the table ============
select is(t052.refusal($$ insert into entitlement_grants (org_id, event_id, tier, source) values (t052.u(100), t052.u(201), 'annual', 'manual') $$),
  '23503|', 'an event grant naming ANOTHER organisation''s event is refused (composite foreign key)');
select is(t052.refusal($$ insert into entitlement_grants (org_id, tier, source) values (t052.u(100), 'gold', 'manual') $$), '23503|', 'an unknown tier is refused');
select is(t052.refusal($$ insert into entitlement_grants (org_id, tier, source) values (t052.u(100), 'annual', 'free') $$), '23514|', 'an unknown source is refused');
select is(t052.refusal($$ insert into entitlement_grants (org_id, tier, valid_from, valid_until, source) values (t052.u(100), 'annual', t052.t(2), t052.t(2), 'manual') $$),
  '23514|', 'an empty window is refused');
select is(t052.refusal($$ insert into entitlement_grants (org_id, tier, source) values (gen_random_uuid(), 'annual', 'manual') $$), '23503|', 'a grant for an unknown organisation is refused');

select is(t052.refusal($$ update entitlement_grants set tier = 'community' where id = t052.u(1001) $$), '23001|', 'tier is frozen');
select is(t052.refusal($$ update entitlement_grants set valid_until = t052.t(30) where id = t052.u(1002) $$), '23001|', 'valid_until is frozen (an extension is a new row)');
select is(t052.refusal($$ update entitlement_grants set org_id = t052.u(200) where id = t052.u(1001) $$), '23001|', 'org_id is frozen');
select is(t052.refusal($$ update entitlement_grants set event_id = t052.u(102) where id = t052.u(1002) $$), '23001|', 'event_id is frozen');
select is(t052.refusal($$ update entitlement_grants set note = 'edited' where id = t052.u(1001) $$), '23001|', 'note is frozen');
select is(t052.refusal($$ update entitlement_grants set revoked_at = t052.t(4) where id = t052.u(1002) $$), 'ok', 'but revoked_at can be set');
select is(t052.refusal($$ delete from entitlement_grants where id = t052.u(1003) $$), 'ok', 'the owner can delete (the table is not append-only; the admin functions never do)');

-- the child org of a deleted organisation goes with it (the audit log is separate and survives)
select is(
  (select count(*)::int from pg_trigger t where t.tgrelid = 'public.entitlement_grants'::regclass and not t.tgisinternal
      and t.tgenabled = 'O' and (t.tgtype & 2) > 0 and (t.tgtype & 16) > 0 and (t.tgtype & 1) > 0 and t.tgqual is null),
  1, 'exactly one enabled row-level BEFORE UPDATE trigger guards the table');

-- ============ the API roles ============
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0520-000000000001';
select is((select count(*)::int from entitlement_grants where org_id = t052.u(100)), 3, 'a member of X reads X''s grants');
select is((select count(*)::int from entitlement_grants where org_id = t052.u(200)), 0, 'and none of Y''s');
select is(t052.affected($$ select granted_by, note from entitlement_grants $$), -1, 'but not the operator metadata columns (granted_by, note): column privilege');
select is(t052.affected($$ insert into entitlement_grants (org_id, tier, source) values (t052.u(100), 'annual', 'manual') $$), -1, 'a member cannot grant themselves a tier (no insert)');
select is(t052.affected($$ update entitlement_grants set revoked_at = now() where org_id = t052.u(100) $$), -1, 'a member cannot revoke (no update)');
select is(t052.affected($$ delete from entitlement_grants where org_id = t052.u(100) $$), -1, 'or delete');
set local request.jwt.claim.sub = '00000000-0000-0000-0520-000000000003';
select is((select count(*)::int from entitlement_grants), 0, 'a signed-in person who belongs to nothing reads no grants');
reset role;
set local role anon;
select is(t052.affected($$ select 1 from entitlement_grants $$), -1, 'anon cannot read the table at all');
reset role;

-- ============ my_entitlements ============
-- reset the keys this file flipped, then check the dark answer
update app.entitlement_keys set enforced = false where key in ('btc_format', 'guess_the_bean_create', 'registration_page', 'cup_taster_participants');
update app.entitlement_keys set min_tier = 'per_event' where key = 'btc_format';
update app.entitlement_caps set cap_limit = 8 where key = 'cup_taster_participants' and tier = 'community';
-- my_entitlements reads the real clock: an annual grant on X's first event that started yesterday
insert into entitlement_grants (org_id, event_id, tier, valid_from, source) values (t052.u(100), t052.u(101), 'annual', now() - interval '1 day', 'manual');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0520-000000000001';
select is((select jsonb_object_keys_count from (select count(*)::int as jsonb_object_keys_count from jsonb_object_keys(public.my_entitlements(t052.u(100)) -> 'keys')) x), 9, 'a member gets one entry per key');
select is(public.my_entitlements(t052.u(100)) ->> 'tier', 'community', 'X''s only live grant was revoked above: community');
select is(public.my_entitlements(t052.u(100), t052.u(101)) ->> 'tier', 'annual', 'with an event named the event grant counts (annual here)');
select is(
  (select count(*)::int from jsonb_each(public.my_entitlements(t052.u(100)) -> 'keys') e where (e.value ->> 'allowed')::boolean),
  9, 'while dark every key is allowed');
select is(public.my_entitlements(t052.u(100)) -> 'keys' -> 'cup_taster_participants' -> 'limit', 'null'::jsonb, 'and a cap shows no limit while dark');
select is(public.my_entitlements(t052.u(100)) -> 'keys' -> 'btc_format' -> 'limit', null, 'a flag key has no limit field');
select is(t052.refusal($$ select public.my_entitlements(t052.u(200)) $$), '42501|', 'a member of X asking for Y: 42501');
select is(t052.refusal($$ select public.my_entitlements(t052.u(100), t052.u(201)) $$), '42501|', 'asking for X with Y''s event: the same 42501');
select is(t052.refusal($$ select public.my_entitlements(gen_random_uuid()) $$), '42501|', 'an organisation that does not exist: the same 42501');
select is(
  public.my_entitlements(t052.u(100), t052.u(102)) ->> 'tier',
  'community', 'the second event has no grant left (its only one was deleted): community');
reset role;
-- enforced, the cap shows its number
update app.entitlement_keys set enforced = true where key = 'cup_taster_participants';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0520-000000000001';
select is(public.my_entitlements(t052.u(100)) -> 'keys' -> 'cup_taster_participants', '{"allowed": true, "limit": 8}'::jsonb, 'enforced: the cap shows 8 for a community organisation');
reset role;
set local role anon;
select is(t052.refusal($$ select public.my_entitlements(t052.u(100)) $$), '42501|', 'anon cannot run my_entitlements (no execute privilege)');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0520-000000000003';
select is(t052.refusal($$ select public.my_entitlements(t052.u(100)) $$), '42501|', 'a signed-in non-member: 42501');
reset role;

select * from finish();
rollback;
