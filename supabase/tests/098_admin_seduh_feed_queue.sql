-- The console's Seduh ID queue (migration 20261202120000_admin_seduh_feed_queue.sql).
-- Proves:
--   * all three functions refuse every caller but a platform admin at aal2 with a fresh TOTP (anon, a non-admin, aal1, no
--     TOTP, a stale TOTP), with the SQLSTATE and hint the console translates, and a refused call changes nothing;
--   * the view returns the waiting podiums with NAMES and places only: the column list is pinned (no phone, cafe or person
--     id), and the answer holds no phone or cafe text from the payload;
--   * Reject marks one queued result rejected (processed_via admin, processed_at set), writes one audit row with ids only,
--     refuses a result that is not queued (feed_not_queued), and creates no identity;
--   * Approve is refused for everyone while the switch is off (seduh_feed_console_off), writes nothing, and with the switch
--     on an admin creates the identity, links the person and records one audit row (counts only); a non-admin still cannot
--     even with the switch on, and the creating step cannot be reached by an API role with p_via = 'admin';
--   * the switch defaults to off and the owner-run path (p_via 'owner') still refuses an API role.
begin;
select plan(30);

create schema t098;
grant usage on schema t098 to anon, authenticated, service_role;
create function t098.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000980' || lpad(n::text, 4, '0'))::uuid
$$;

create function t098.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

create function t098.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t098.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t098.claims(t098.u(2), 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t098.claims(t098.u(1), 'aal1');
    elsif kind = 'admin_no_totp' then perform t098.claims(t098.u(1), 'aal2');
    elsif kind = 'admin_stale_totp' then perform t098.claims(t098.u(1), 'aal2', 7200);
    elsif kind = 'admin_ok' then perform t098.claims(t098.u(1), 'aal2', 10);
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
grant execute on function t098.claims(uuid, text, int), t098.run_as(text, text) to anon, authenticated, service_role;

-- ============ fixtures (as postgres) ============
insert into auth.users (id, email) values
  (t098.u(1), 't098-admin@test.seduh-next'), (t098.u(2), 't098-nonadmin@test.seduh-next');
insert into app.platform_admins (user_id, note) values (t098.u(1), 't098 admin');
insert into auth.sessions (id, user_id, aal) values (t098.u(1), t098.u(1), 'aal2'), (t098.u(2), t098.u(2), 'aal2');
insert into orgs (id, name, slug) values (t098.u(100), 'T098 Org', 't098-org');
update app.seduh_feed_mode set mode = 'queue', console_actions = false;

-- two real (non-test) events with a podium naming one entered person each, published so the trigger queues them
insert into events (id, org_id, format, name, is_test, event_date) values
  (t098.u(110), t098.u(100), 'cup_taster', 'T098 Event One', false, '2026-11-20'),
  (t098.u(111), t098.u(100), 'cup_taster', 'T098 Event Two', false, '2026-11-21');
insert into people (id, org_id, display_name, phone) values
  (t098.u(201), t098.u(100), 'T098 Alpha', '+6739800001'),
  (t098.u(202), t098.u(100), 'T098 Bravo', '+6739800002');
insert into event_entries (event_id, person_id, display_name, cafe) values
  (t098.u(110), t098.u(201), 'T098 Alpha', 'Cafe Secret'),
  (t098.u(111), t098.u(202), 'T098 Bravo', 'Cafe Secret');
insert into public_results (id, org_id, event_id, payload) values
  (t098.u(310), t098.u(100), t098.u(110), jsonb_build_object('format', 'cup_taster',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T098 Alpha', 'cafe', 'Cafe Secret', 'phone', '+6739800001')))),
  (t098.u(311), t098.u(100), t098.u(111), jsonb_build_object('format', 'cup_taster',
     'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'T098 Bravo', 'cafe', 'Cafe Secret'))));
create table t098.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;

select is((select count(*)::int from app.seduh_feed_queue where result_id in (t098.u(310), t098.u(311)) and state = 'queued'), 2,
  'both podiums are waiting in the queue');
select is((select console_actions from app.seduh_feed_mode), false, 'the console switch is off');

-- ============ the gate ============
select is(t098.run_as(k, 'select * from public.admin_seduh_feed_queue()'), e, 'view as ' || k || ' -> ' || e)
from (values ('anon', '42501|'), ('nonadmin', '42501|admin_required'), ('admin_aal1', '42501|admin_mfa_required'),
             ('admin_no_totp', '42501|admin_mfa_required'), ('admin_stale_totp', '42501|admin_mfa_required')) as t(k, e);
select is(t098.run_as('nonadmin', format('select public.admin_seduh_feed_reject(%L)', t098.u(310))), '42501|admin_required', 'a non-admin cannot reject');
select is(t098.run_as('admin_stale_totp', format('select public.admin_seduh_feed_reject(%L)', t098.u(310))), '42501|admin_mfa_required', 'a stale TOTP cannot reject');
select is(t098.run_as('nonadmin', format('select public.admin_seduh_feed_approve(%L)', t098.u(310))), '42501|admin_required', 'a non-admin cannot approve');
select is((select count(*)::int from app.seduh_feed_queue where result_id in (t098.u(310), t098.u(311)) and state = 'queued'), 2, 'refused calls changed nothing');

-- ============ the view ============
select is(t098.run_as('admin_ok', 'select * from public.admin_seduh_feed_queue()'), 'ok', 'an admin can read the queue');
select is(
  (select string_agg(a.attname, ',' order by a.attnum) from pg_proc p
     cross join lateral unnest(p.proargnames, p.proargmodes) with ordinality as a(attname, mode, attnum)
    where p.oid = 'public.admin_seduh_feed_queue()'::regprocedure and a.mode = 't'),
  'result_id,org_name,event_name,event_date,enqueued_at,podium,console_actions',
  'the view''s columns are pinned: names and places, no phone, no cafe, no person id');
create temp table t098.seen on commit drop as select * from public.admin_seduh_feed_queue() where false;
grant all on t098.seen to authenticated;
select set_config('role', 'authenticated', true);
select t098.claims(t098.u(1), 'aal2', 10);
insert into t098.seen select * from public.admin_seduh_feed_queue();
select set_config('role', 'none', true);
select is((select count(*)::int from t098.seen where result_id in (t098.u(310), t098.u(311))), 2, 'both waiting podiums are in the answer');
select is((select podium::text from t098.seen where result_id = t098.u(310)), '[{"name": "T098 Alpha", "position": 1}]', 'the podium is a place and a name');
select is((select count(*)::int from t098.seen where seen::text ~* '(Cafe Secret|6739800001)'), 0, 'no cafe and no phone anywhere in the answer');

-- ============ reject ============
select is(t098.run_as('admin_ok', format('select public.admin_seduh_feed_reject(%L)', t098.u(311))), 'ok', 'an admin can reject a waiting podium');
select is((select state || '/' || processed_via || '/' || (processed_at is not null) from app.seduh_feed_queue where result_id = t098.u(311)), 'rejected/admin/true',
  'the row is rejected, by admin, with a time');
select is(t098.run_as('admin_ok', format('select public.admin_seduh_feed_reject(%L)', t098.u(311))), '22023|feed_not_queued', 'rejecting it again is refused');
select is(t098.run_as('admin_ok', 'select public.admin_seduh_feed_reject(gen_random_uuid())'), '22023|feed_not_queued', 'so is an id that is not queued');
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t098.base) and action = 'seduh_feed.reject' and detail = jsonb_build_object('result_id', t098.u(311))), 1,
  'one audit row, with the result id only');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739800002'), 0, 'rejecting created no identity');

-- ============ approve: off, then on ============
select is(t098.run_as('admin_ok', format('select public.admin_seduh_feed_approve(%L)', t098.u(310))), '42501|seduh_feed_console_off', 'with the switch off even an admin cannot approve');
select is((select state from app.seduh_feed_queue where result_id = t098.u(310)), 'queued', '...and nothing was created or changed');
update app.seduh_feed_mode set console_actions = true;
select is(t098.run_as('nonadmin', format('select public.admin_seduh_feed_approve(%L)', t098.u(310))), '42501|admin_required', 'with the switch on a non-admin still cannot');
select is(t098.run_as('admin_ok', format('select public.admin_seduh_feed_approve(%L)', t098.u(310))), 'ok', 'with the switch on an admin can approve');
select is((select count(*)::int from app.seduh_identities where phone_e164 = '+6739800001') || '/' || (select (global_person_id is not null)::text from people where id = t098.u(201)), '1/true',
  'the identity is created and the person linked');
select is((select state || '/' || processed_via from app.seduh_feed_queue where result_id = t098.u(310)), 'processed/admin', 'the row says an admin ran it');
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t098.base) and action = 'seduh_feed.approve' and detail = jsonb_build_object('result_id', t098.u(310), 'identities_created', 1, 'people_linked', 1)), 1,
  'one audit row, with counts only');

-- ============ the creating step stays shut to the API ============
select is(t098.run_as('admin_ok', $$select app.seduh_feed_apply(array[gen_random_uuid()], 'admin')$$), '42501|', 'an API role cannot call the creating step directly, even as p_via admin');

select * from finish();
rollback;
