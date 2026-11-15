-- T-ID2.B3b: only an OPEN account blocks claiming an identity (migration 20261119100000_seduh_reclaim_after_close.sql).
-- Proves:
--   * the plain unique on identity_id is gone and a PARTIAL unique (closed_at is null) stands in its place; the composite key the
--     claim links and the reservation use (id, identity_id) is untouched; two OPEN accounts for one identity are still refused;
--     a closed row still cannot be deleted or reopened; the handle and the founding number stay plain unique.
--   * close then re-claim: the identity is claimable again (status can_issue, an issue works, begin answers ok), the NEW account gets
--     a NEW handle and a NEW founding number; the old handle stays taken and cannot be re-used by the re-claim; the old page is
--     gone and the new one answers; the status has one row per person and says claimed with the NEW handle; the first link still
--     names the first account.
--   * a claim that raced for an identity (an open account appeared) is refused identity_claimed.
--   * #0001: a reserved identity that is closed and re-claimed gets a sequence number, never 1 again.
--   * the rollback block restores the plain unique (and refuses, on purpose, once an identity has two rows).
begin;
select plan(33);

create schema t083;
grant usage on schema t083 to anon, authenticated, service_role;
create function t083.attempt(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  raise exception using errcode = 'P9999', message = 'sentinel';
exception when others then
  if sqlstate = 'P9999' then return 'ok'; end if;
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || coalesce(v_hint, '');
end $$;
create function t083.run(stmt text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '/' || coalesce(v_hint, '');
end $$;
create function t083.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function t083.as_user(n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', t083.u(n)::text, true);
end $$;
-- close the account of a handle the way the owner's undo runbook does (CONVENTIONS.md)
create function t083.undo(p_handle text) returns text language sql as $$
  select t083.run(format($u$ with closed as (
    update app.seduh_accounts set closed_at = now(), user_id = null where handle = %L and closed_at is null
    returning id, identity_id, founding_number)
  insert into app.seduh_claim_audit (action, identity_id, account_id, detail)
  select 'claim.undo', identity_id, id, jsonb_build_object('founding_number', founding_number, 'reason', 'test') from closed $u$, p_handle))
$$;
grant execute on all functions in schema t083 to anon, authenticated, service_role;

-- users: 8301 organiser, 8302 first claimant, 8303 second claimant, 8304 third. organisation 8310. identities 8321 (the main one),
-- 8322 (the owner's #0001 case). people 8331 and 8332.
insert into auth.users (id, email) select t083.u(n), 'u' || n || '@t083.seduh-next' from generate_series(8301, 8304) n;
insert into orgs (id, name, slug) values (t083.u(8310), 'T083 A', 't083-a');
insert into org_members (org_id, user_id, role) values (t083.u(8310), t083.u(8301), 'owner');
insert into app.seduh_identities (id, phone_e164, display_name, source, status)
values (t083.u(8321), '+67383000001', 'T083 Person One', 'archive', 'active'),
       (t083.u(8322), '+67383000002', 'T083 Person Two', 'archive', 'active');
insert into people (id, org_id, display_name, phone)
values (t083.u(8331), t083.u(8310), 'Person One', '+67383000001'), (t083.u(8332), t083.u(8310), 'Person Two', '+67383000002');
select set_config('app.seduh_link_write', 'on', true);
update people set global_person_id = t083.u(8321) where id = t083.u(8331);
update people set global_person_id = t083.u(8322) where id = t083.u(8332);
select set_config('app.seduh_link_write', '', true);

-- ============ the structure ============
select is((select count(*)::int from pg_constraint where conrelid = 'app.seduh_accounts'::regclass and conname = 'seduh_accounts_identity_id_key'), 0,
  'the plain unique on identity_id is gone');
select is((select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
            where i.indrelid = 'app.seduh_accounts'::regclass and c.relname = 'seduh_accounts_identity_open_key'
              and i.indisunique and i.indpred is not null and pg_get_expr(i.indpred, i.indrelid) = '(closed_at IS NULL)'), 1,
  'a partial unique index on identity_id where closed_at is null stands in its place');
select is((select count(*)::int from pg_constraint where conrelid = 'app.seduh_accounts'::regclass and conname in
            ('seduh_accounts_id_identity_key', 'seduh_accounts_handle_key', 'seduh_accounts_founding_number_key', 'seduh_accounts_user_id_key')), 4,
  'the composite key (id, identity_id), the handle, the founding number and the login stay plain unique');
select is((select count(*)::int from pg_constraint where conname in ('seduh_claim_links_account_same_identity', 'seduh_reserved_numbers_account_same_identity')
             and contype = 'f' and confrelid = 'app.seduh_accounts'::regclass), 2, 'the claim link and the reservation still name an account AND its identity');

-- the rollback block, while no identity has two rows: run in a sub-transaction that reports what it saw and is then undone
create function t083.rollback_probe() returns text language plpgsql as $$
begin
  drop index if exists app.seduh_accounts_identity_open_key;
  alter table app.seduh_accounts add constraint seduh_accounts_identity_id_key unique (identity_id);
  raise exception 'probe: unique=% index=%',
    (select count(*) from pg_constraint where conrelid = 'app.seduh_accounts'::regclass and conname = 'seduh_accounts_identity_id_key'),
    (select count(*) from pg_class where relname = 'seduh_accounts_identity_open_key');
exception when others then
  return sqlerrm;
end $$;
select is(t083.rollback_probe(), 'probe: unique=1 index=0', 'the rollback block restores the plain unique and removes the partial index');
select is((select count(*)::int from pg_class where relname = 'seduh_accounts_identity_open_key'), 1, '...and the probe was undone: the partial index is back');

-- ============ first claim ============
set local role authenticated;
select t083.as_user(8301);
select set_config('t083.tok1', public.issue_seduh_claim_link(t083.u(8331)), false);
select t083.as_user(8302);
select set_config('t083.res1', public.claim_seduh_id(current_setting('t083.tok1'), 'first-83', true)::text, false);
reset role;
set local role authenticated;
select t083.as_user(8301);
select is((select state || ':' || coalesce(handle, '') from public.seduh_claim_statuses(t083.u(8310), array[t083.u(8331)])), 'claimed:first-83', 'status: claimed with the first handle');
reset role;
select is(t083.attempt($$ insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at)
  values ('00000000-0000-0000-0000-000000008321', '00000000-0000-0000-0000-000000008303', 'dupe-83', 'organiser_link', now()) $$), '23505/',
  'a second OPEN account for the identity is still refused');
set local role authenticated;
select t083.as_user(8301);
select is(t083.attempt('select public.issue_seduh_claim_link(' || quote_literal(t083.u(8331)) || ')'), 'P0001/identity_claimed', 'an open account blocks a new link: identity_claimed');
reset role;

-- ============ undo, then re-claim ============
select is(t083.undo('first-83'), 'ok', 'the undo runbook closes the account');
select is(t083.attempt($$ delete from app.seduh_accounts where handle = 'first-83' $$) <> 'ok', true, 'a closed row is still never deleted');
select is(t083.attempt($$ update app.seduh_accounts set closed_at = null where handle = 'first-83' $$), '23001/', 'a closed account still cannot be reopened');
set local role authenticated;
select t083.as_user(8301);
select is((select state || ':' || coalesce(handle, '') from public.seduh_claim_statuses(t083.u(8310), array[t083.u(8331)])), 'can_issue:',
  'status after the undo: can_issue, no handle (one row)');
reset role;
select is(public.seduh_handle_available('first-83'), 'taken', 'the retired handle stays taken');
set local role service_role;
select is(public.seduh_claim_begin(current_setting('t083.tok1')) ->> 'status', 'used', 'the first link is still used');
reset role;
set local role authenticated;
select t083.as_user(8301);
select set_config('t083.tok2', public.issue_seduh_claim_link(t083.u(8331)), false);
set local role authenticated;
select t083.as_user(8301);
select is((select state from public.seduh_claim_statuses(t083.u(8310), array[t083.u(8331)])), 'link_open', 'a new link can be issued after the undo');
reset role;
reset role;
set local role service_role;
select is(public.seduh_claim_begin(current_setting('t083.tok2')) ->> 'status', 'ok', 'begin answers ok for the new link');
reset role;
set local role authenticated;
select t083.as_user(8303);
select is(t083.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t083.tok2'), 'first-83')), 'P0001/handle_taken',
  'the re-claim cannot take the retired handle');
select set_config('t083.res2', public.claim_seduh_id(current_setting('t083.tok2'), 'second-83', true)::text, false);
reset role;
select is(current_setting('t083.res2')::jsonb ->> 'handle', 'second-83', 'the re-claim works with a NEW handle');
select ok((current_setting('t083.res2')::jsonb ->> 'founding_number')::int > (current_setting('t083.res1')::jsonb ->> 'founding_number')::int,
  'and gets a NEW, higher founding number');
select is((select count(*)::int from app.seduh_accounts where identity_id = t083.u(8321)), 2, 'the identity now has two rows: one closed, one open');
select is((select count(*)::int from app.seduh_accounts where identity_id = t083.u(8321) and closed_at is null), 1, '...and exactly one of them open');
set local role authenticated;
select t083.as_user(8301);
select is((select state || ':' || coalesce(handle, '') from public.seduh_claim_statuses(t083.u(8310), array[t083.u(8331)])), 'claimed:second-83',
  'status: one row, claimed with the NEW handle');
reset role;
set local role authenticated;
select t083.as_user(8301);
select is((select count(*)::int from public.seduh_claim_statuses(t083.u(8310), array[t083.u(8331), t083.u(8332)])), 2, 'one status row per person');
reset role;
set local role anon;
select is((public.public_seduh_profile('first-83') ->> 'has_profile') || '/' || (public.public_seduh_profile('second-83') ->> 'has_profile'), 'false/true',
  'the old page stays gone and the new page answers');
reset role;
select is((select count(*)::int from app.seduh_claim_links l join app.seduh_accounts a on a.id = l.account_id where l.identity_id = t083.u(8321) and l.used_at is not null and a.handle = 'first-83'), 1,
  'the first link still names the first account');
select is((select count(*)::int from app.seduh_claim_audit where identity_id = t083.u(8321) and action = 'claim.complete'), 2, 'both claims were audited');

-- a claim that lost the race for the identity: an open account appeared after the link was issued
select is(t083.undo('second-83'), 'ok', 'the second claim is undone too');
set local role authenticated;
select t083.as_user(8301);
select set_config('t083.tok3', public.issue_seduh_claim_link(t083.u(8331)), false);
reset role;
insert into app.seduh_accounts (identity_id, user_id, handle, claim_method, adult_attested_at) values (t083.u(8321), t083.u(8304), 'racer-83', 'organiser_link', now());
set local role authenticated;
select t083.as_user(8303);
select is(t083.attempt(format('select public.claim_seduh_id(%L, %L, true)', current_setting('t083.tok3'), 'third-83')), 'P0001/identity_claimed',
  'an identity that gained an open account while a link was open: identity_claimed');
reset role;

-- ============ #0001 is never reissued ============
insert into app.seduh_reserved_numbers (founding_number, identity_id, note) values (1, t083.u(8322), 'owner');
set local role authenticated;
select t083.as_user(8301);
select set_config('t083.tok4', public.issue_seduh_claim_link(t083.u(8332)), false);
select t083.as_user(8302);
select is(public.claim_seduh_id(current_setting('t083.tok4'), 'owner-83', true) ->> 'founding_number', '1', 'the reserved identity takes number 1');
reset role;
select is(t083.undo('owner-83'), 'ok', 'the owner''s claim is undone');
set local role authenticated;
select t083.as_user(8301);
select set_config('t083.tok5', public.issue_seduh_claim_link(t083.u(8332)), false);
select t083.as_user(8302);
select ok((public.claim_seduh_id(current_setting('t083.tok5'), 'owner-again-83', true) ->> 'founding_number')::int >= 2, 'a re-claim of the reserved identity gets a sequence number, never 1 again');
reset role;

-- the rollback block refuses, on purpose, once an identity has two rows
select is(t083.attempt($$ drop index if exists app.seduh_accounts_identity_open_key; alter table app.seduh_accounts add constraint seduh_accounts_identity_id_key unique (identity_id) $$), '23505/',
  'the rollback block fails on a populated database (an identity with two rows): do not roll back there');

select * from finish();
rollback;
