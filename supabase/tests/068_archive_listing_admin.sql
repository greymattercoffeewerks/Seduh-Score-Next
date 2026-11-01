-- T-ARC.3: the archive tick box, the soft unpublish record and the operator's counts (migration
-- 20261101130000_archive_listing_admin.sql; spec: Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md 2.6 to
-- 2.8, owner decisions 7 and 10 in HANDOFF-CORRECTION-005.md).
-- Proves:
--   * set_archive_listing: a member of a Per-event or Annual organisation stores 'list' or 'named_only' (and nothing is stored
--     until they act); a stranger, a member of another organisation, the wrong organisation for the event, a missing event, a NULL
--     organisation and anon all get ONE refusal (42501 "event not found"), whatever the id; a two-organisation user cannot mix
--     the two; a test event is refused; a Community organisation has no choice once the key is enforced (entitlement_required);
--     a decided ledger row (published, stubbed, skipped, failed, removed) refuses a change (archive_listing_closed); a "named
--     only" with no ledger row writes nothing; the ledger columns are unreadable by every API role and the function's ACL and
--     definer settings are pinned;
--   * the choice drives the tick: 'list' publishes the staged podium, 'named_only' publishes a stub (the T-ARC.1 rules);
--   * the soft unpublish (decision 7): a Community organiser CAN unpublish (the RPC and a direct DELETE), the ledger records
--     it ('removed', what it was, when), the tick does NOT publish it again (not even with a floor that would enqueue it), the
--     trigger records nothing while the pipeline is dark, for a test event, or for a cascade, and a failure inside it never
--     fails the delete;
--   * admin_archive_status: refuses every non-admin and stale-MFA shape with the exact SQLSTATE and hint; a platform admin
--     gets ONE row of the pinned columns (one boolean, the rest integers) whose figures are right on fixtures; nothing is
--     written (no audit row); the body names only the ledger, the key table, public_results (existence only) and the gate.
-- Everything runs in ONE transaction. The shared local database may hold other sessions' rows, so every figure is a DELTA.
begin;
select plan(121);

create schema t068;
grant usage on schema t068 to anon, authenticated, service_role;

create function t068.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000680' || lpad(n::text, 4, '0'))::uuid
$$;

create function t068.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

-- "SQLSTATE|hint" of a statement run as a signed-in member (uid) or anon (uid null), or 'ok'; always restores the role
create function t068.try(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform t068.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    perform t068.claims(uid, 'aal1');
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := sqlstate || '|' || coalesce(h, '');
  end;
  perform set_config('role', 'none', true);
  perform t068.claims(null, null);
  return res;
end $$;

-- the text result of a one-column select run as a member, or the error
create function t068.val(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  perform set_config('role', 'authenticated', true);
  perform t068.claims(uid, 'aal1');
  begin
    execute stmt into res;
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := sqlstate || '|' || coalesce(h, '');
  end;
  perform set_config('role', 'none', true);
  perform t068.claims(null, null);
  return res;
end $$;

-- the exception DETAIL of a statement run as a member
create function t068.detail(uid uuid, stmt text) returns text language plpgsql as $$
declare d text;
begin
  perform set_config('role', 'authenticated', true);
  perform t068.claims(uid, 'aal1');
  begin
    execute stmt;
    d := 'no error';
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
  end;
  perform set_config('role', 'none', true);
  perform t068.claims(null, null);
  return d;
end $$;

-- the same, for the platform-admin shapes of test 065
create function t068.run_as(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  if kind = 'anon' then
    perform set_config('role', 'anon', true);
    perform t068.claims(null, null);
  else
    perform set_config('role', 'authenticated', true);
    if kind = 'nonadmin' then perform t068.claims(t068.u(2), 'aal2', 10);
    elsif kind = 'admin_aal1' then perform t068.claims(t068.u(11), 'aal1');
    elsif kind = 'admin_no_totp' then perform t068.claims(t068.u(11), 'aal2');
    elsif kind = 'admin_stale_totp' then perform t068.claims(t068.u(11), 'aal2', 7200);
    elsif kind = 'admin_pw_fresh' then
      perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', t068.u(11), 'session_id', t068.u(11),
        'aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 10)))::text, true);
      perform set_config('request.jwt.claim.sub', t068.u(11)::text, true);
    elsif kind = 'admin_ended_session' then perform t068.claims(t068.u(13), 'aal2', 10);
    elsif kind = 'admin_ok' then perform t068.claims(t068.u(11), 'aal2', 10);
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
  perform t068.claims(null, null);
  return res;
end $$;
grant execute on all functions in schema t068 to anon, authenticated, service_role;

create function t068.arch(n int, col text) returns text language plpgsql stable as $$
declare v text;
begin
  execute format('select %I::text from app.archive_events where event_id = $1', col) into v using t068.u(n);
  return v;
end $$;
create function t068.has_result(n int) returns boolean language sql stable as $$
  select exists (select 1 from public_results where event_id = t068.u(n))
$$;

-- a browser-built snapshot, as T-ARC.2 will stage it
create function t068.snap() returns jsonb language sql immutable as $$
  select jsonb_build_object('format', 'cup_taster', 'eventName', 'Snap', 'eventDate', '2026-10-04',
    'podium', jsonb_build_array(jsonb_build_object('rank', 1, 'name', 'Champion', 'cafe', 'C', 'correct', 9, 'total', 9)))
$$;

-- ============ fixtures (as the table owner) ============
-- the seed's own events would be picked up by a floor: remove them in this transaction
delete from events;

-- u(1) member of the Community org, u(2) member of the Annual org, u(3) member of a third org (a stranger to both),
-- u(4) organiser of BOTH, u(5) nobody, u(11) platform admin, u(13) admin whose session row is gone
insert into auth.users (id, email) values
  (t068.u(1), 't068-c@example.test'), (t068.u(2), 't068-a@example.test'), (t068.u(3), 't068-o@example.test'),
  (t068.u(4), 't068-ab@example.test'), (t068.u(5), 't068-none@example.test'),
  (t068.u(11), 't068-admin@example.test'), (t068.u(13), 't068-ended@example.test');
insert into app.platform_admins (user_id, note) values (t068.u(11), 't068 admin'), (t068.u(13), 't068 ended admin');
insert into auth.sessions (id, user_id, aal) values (t068.u(11), t068.u(11), 'aal2'), (t068.u(2), t068.u(2), 'aal2');
insert into orgs (id, name, slug) values
  (t068.u(100), 'T068 Community', 't068-community'), (t068.u(200), 'T068 Annual', 't068-annual'), (t068.u(300), 'T068 Other', 't068-other');
insert into org_members (org_id, user_id, role) values
  (t068.u(100), t068.u(1), 'organiser'), (t068.u(200), t068.u(2), 'organiser'), (t068.u(300), t068.u(3), 'organiser'),
  (t068.u(100), t068.u(4), 'organiser'), (t068.u(200), t068.u(4), 'organiser');
insert into entitlement_grants (org_id, tier, source, valid_from) values (t068.u(200), 'annual', 'manual', now() - interval '30 days');

insert into events (id, org_id, format, name, event_date) values
  (t068.u(1001), t068.u(100), 'cup_taster', 'C1 community', date '2026-10-04'),
  (t068.u(1002), t068.u(100), 'cup_taster', 'C2 unpublished after the tick', date '2026-10-04'),
  (t068.u(1003), t068.u(100), 'cup_taster', 'C3 organiser published then removed', date '2026-10-04'),
  (t068.u(1004), t068.u(100), 'cup_taster', 'C4 flipped to test', date '2026-10-04'),
  (t068.u(1005), t068.u(100), 'cup_taster', 'C5 deleted', date '2026-10-04'),
  (t068.u(1006), t068.u(100), 'cup_taster', 'C6 removed while dark', date '2026-10-04'),
  (t068.u(1007), t068.u(100), 'cup_taster', 'C7 removal twice', date '2026-10-04'),
  (t068.u(2001), t068.u(200), 'cup_taster', 'A1 not ended', date '2026-10-04'),
  (t068.u(2002), t068.u(200), 'cup_taster', 'A2 ended', date '2026-10-04'),
  (t068.u(2003), t068.u(200), 'cup_taster', 'A3 test', date '2026-10-04'),
  (t068.u(2004), t068.u(200), 'cup_taster', 'A4 decided', date '2026-10-04'),
  (t068.u(2005), t068.u(200), 'cup_taster', 'A5 old, never ticked', date '2026-10-04'),
  (t068.u(2006), t068.u(200), 'cup_taster', 'A6 listed then tick', date '2026-10-04'),
  (t068.u(2007), t068.u(200), 'cup_taster', 'A7 unticked tick', date '2026-10-04'),
  (t068.u(3001), t068.u(300), 'cup_taster', 'O1 other', date '2026-10-04');
update events set is_test = true where id = t068.u(2003);
-- C1, C6 and C7 ended 4 days ago, BEFORE the 3-day floor used below, so a floored tick never enqueues them; C3 ended 50 hours ago, AFTER it
update events set ended_at = now() - interval '25 hours', ended_via = 'organiser'
 where id in (t068.u(1002), t068.u(2002), t068.u(2004), t068.u(2006), t068.u(2007));
update events set ended_at = now() - interval '4 days', ended_via = 'organiser' where id in (t068.u(1001), t068.u(1006), t068.u(1007));
update events set ended_at = now() - interval '50 hours', ended_via = 'organiser' where id = t068.u(1003);
update events set ended_at = now() - interval '30 days', ended_via = 'organiser' where id = t068.u(2005);

create table t068.base as
  select (select count(*) from app.archive_events) as total,
         (select count(*) from app.archive_events where state = 'pending') as pending,
         (select count(*) from app.archive_events where state = 'pending' and due_at < now() - interval '1 hour') as overdue,
         (select count(*) from app.archive_events where state = 'published') as published,
         (select count(*) from app.archive_events where state = 'stubbed') as stubbed,
         (select count(*) from app.archive_events where state = 'skipped') as skipped,
         (select count(*) from app.archive_events where state = 'failed') as failed,
         (select count(*) from app.archive_events where state = 'removed') as removed,
         (select coalesce(max(id), 0) from app.admin_audit_log) as mid;

-- ============ structure ============
select is(
  (select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'service_role', 'public']) r
    where has_function_privilege(r, 'public.set_archive_listing(uuid,uuid,boolean)', 'execute')
       or has_function_privilege(r, 'public.admin_archive_status()', 'execute')),
  'none', 'anon, service_role and PUBLIC can execute neither new RPC');
select is(has_function_privilege('authenticated', 'public.set_archive_listing(uuid,uuid,boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.admin_archive_status()', 'execute'), true,
  'a signed-in caller can execute both (the member check and the admin gate then decide)');
select is(
  (select count(*)::int from pg_proc p
    where p.oid in ('public.set_archive_listing(uuid,uuid,boolean)'::regprocedure, 'public.admin_archive_status()'::regprocedure,
                    'app.archive_note_removal()'::regprocedure)
      and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'both RPCs and the trigger function are SECURITY DEFINER with search_path pinned to the empty string');
select is(
  (select coalesce(string_agg(r, ', '), 'none') from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'app.archive_note_removal()', 'execute')),
  'none', 'no API role can execute the trigger function');
select is(
  (select coalesce(string_agg(r || '/' || c, ', '), 'none')
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['listing_choice', 'removed_at', 'removed_from', 'state', 'event_id']) c
    where has_column_privilege(r, 'app.archive_events', c, 'select,insert,update')),
  'none', 'no API role can read or write any ledger column (the choice, the removal record, the state)');
select is(
  (select string_agg(tgname::text, ',' order by tgname) from pg_trigger
    where tgrelid = 'public.public_results'::regclass and not tgisinternal and tgname = 'trg_public_results_archive_note'),
  'trg_public_results_archive_note', 'the removal trigger exists on public_results');
select is(
  (select (t.tgtype & 1 = 1) and (t.tgtype & 2 = 0) and (t.tgtype & 8 = 8)
     from pg_trigger t where t.tgname = 'trg_public_results_archive_note'),
  true, 'and it is an AFTER DELETE ROW trigger');
select is((select count(*)::int from pg_constraint where conrelid = 'app.archive_events'::regclass
            and conname in ('archive_events_removed_from_valid', 'archive_events_removed_shape')), 2,
  'the two additive ledger constraints exist');

select throws_ok(format('insert into app.archive_events (event_id, org_id, state) values (%L, %L, ''removed'')', t068.u(9990), t068.u(200)),
  '23514', null, 'a removed row with no removed_at/removed_from is refused by the ledger''s own CHECK');
select throws_ok(format('insert into app.archive_events (event_id, org_id, state, removed_at, removed_from) values (%L, %L, ''removed'', now(), ''removed'')', t068.u(9991), t068.u(200)),
  '23514', null, 'and removed_from must be a state the row can have come from');

-- ============ set_archive_listing: who may call it (the key is still unenforced, so the entitlement does not speak yet) ============
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2001))),
  '{"due_at": null, "listing": "list", "recorded": true}', 'a member of the Annual organisation ticks the box: list is stored (no end yet, so no due time)');
select is(t068.arch(2001, 'listing_choice') || '|' || t068.arch(2001, 'state') || '|' || t068.arch(2001, 'org_id'), 'list|pending|' || t068.u(200)::text,
  'it made one pending ledger row for the right organisation');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, false)::text', t068.u(200), t068.u(2001))),
  '{"due_at": null, "listing": "named_only", "recorded": true}', 'and unticking it stores named_only');
select is(t068.arch(2001, 'listing_choice'), 'named_only', 'the ledger shows the change');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2002))),
  jsonb_build_object('listing', 'list', 'recorded', true, 'due_at', (select ended_at + interval '24 hours' from events where id = t068.u(2002)))::text,
  'for an ended event the row carries its due time (ended_at + 24 hours)');

select is(t068.val(t068.u(3), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2002))), '42501|',
  'a stranger naming the right organisation and event: one refusal, no hint');
select is(t068.val(t068.u(3), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(300), t068.u(2002))), '42501|',
  'a member of ANOTHER organisation naming their own organisation with this event: the same refusal');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(3001))), '42501|',
  'a member naming their own organisation with another organisation''s event: the same refusal');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(300), t068.u(3001))), '42501|',
  'a member naming the other organisation and its event: the same refusal');
select is(t068.val(t068.u(4), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(1001))), '42501|',
  'a two-organisation member cannot name one organisation with the other''s event');
select is(t068.val(t068.u(4), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(100), t068.u(2002))), '42501|',
  'nor the other way round');
select is(t068.val(t068.u(5), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2002))), '42501|',
  'a signed-in person who belongs to nothing: the same refusal');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), gen_random_uuid())), '42501|',
  'an event that does not exist: the same refusal (no existence oracle)');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(null, %L, true)::text', t068.u(2002))), '42501|',
  'a NULL organisation: the same refusal');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, null, true)::text', t068.u(200))), '42501|',
  'a NULL event: the same refusal');
select is(t068.try(null, format('select public.set_archive_listing(%L, %L, true)', t068.u(200), t068.u(2002))), '42501|',
  'anon cannot call it (permission denied)');
select is((select count(*)::int from app.archive_events where event_id in (t068.u(3001), t068.u(1001))), 0,
  'none of the refused calls made a ledger row');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, null)::text', t068.u(200), t068.u(2002))), '22023|archive_listing_invalid',
  'a null choice is refused (22023, archive_listing_invalid)');

-- ============ the matrix of event kinds ============
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2003))), 'P0001|archive_event_is_test',
  'a test event is refused (P0001, archive_event_is_test)');
select is(t068.arch(2003, 'event_id'), null, 'and no ledger row was made for it');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, false)::text', t068.u(200), t068.u(2005))),
  '{"listing": "named_only", "recorded": false}', 'a "named only" with no ledger row records nothing (the default is already a named-only entry)');
select is(t068.arch(2005, 'event_id'), null, 'and made no row for an event that ended long before the floor (the tick would have published it)');

-- a decided row refuses a change, for every decided state
insert into app.archive_events (event_id, org_id, due_at, state, outcome_via, removed_at, removed_from)
values (t068.u(2004), t068.u(200), now() - interval '1 hour', 'published', 'auto', null, null);
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2004))), 'P0001|archive_listing_closed',
  'a published row: the choice is closed');
select is(
  (select string_agg(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, %L)::text', t068.u(200), t068.u(2004), b)), ',' order by b)
     from (values (true), (false)) v(b)),
  'P0001|archive_listing_closed,P0001|archive_listing_closed', 'closed for both a tick and an untick');
update app.archive_events set state = 'stubbed' where event_id = t068.u(2004);
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2004))), 'P0001|archive_listing_closed', 'a stubbed row: closed');
update app.archive_events set state = 'skipped' where event_id = t068.u(2004);
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2004))), 'P0001|archive_listing_closed', 'a skipped row: closed');
update app.archive_events set state = 'failed' where event_id = t068.u(2004);
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2004))), 'P0001|archive_listing_closed', 'a failed row: closed');
update app.archive_events set state = 'removed', removed_at = now(), removed_from = 'failed' where event_id = t068.u(2004);
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2004))), 'P0001|archive_listing_closed', 'a removed row: closed');
select is(t068.arch(2004, 'listing_choice'), null, 'and no refused call changed the stored choice');

-- ============ the entitlement: speaks only once the key is enforced ============
update app.entitlement_keys set enforced = true where key = 'results_archive_optional';
select is(t068.val(t068.u(1), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(100), t068.u(1001))), '42501|entitlement_required',
  'enforced: a Community organisation has no choice (42501, entitlement_required)');
select is(t068.detail(t068.u(1), format('select public.set_archive_listing(%L, %L, true)', t068.u(100), t068.u(1001))), 'results_archive_optional',
  'and the refusal names the key in its detail, the shape the console and the client already translate');
select is(t068.arch(1001, 'event_id'), null, 'and the refusal made no ledger row');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2006))) like '%"listing": "list"%', true,
  'enforced: the Annual organisation still chooses');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, false)::text', t068.u(200), t068.u(2007))),
  '{"listing": "named_only", "recorded": false}', 'enforced: an untick with no row still records nothing');
select is(t068.val(t068.u(4), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(100), t068.u(1001))), '42501|entitlement_required',
  'a two-organisation user is judged by the organisation they name: Community has no choice even though the other holds a plan');
select is(t068.val(t068.u(4), format('select public.set_archive_listing(%L, %L, true)::text', t068.u(200), t068.u(2007))) like '%"listing": "list"%', true,
  'and the same user ticking for the Annual organisation succeeds');
update app.archive_events set listing_choice = 'named_only' where event_id = t068.u(2007);

-- ============ the choice drives the tick ============
update app.archive_events set staged_payload = t068.snap(), staged_at = now() - interval '2 hours', due_at = now() - interval '1 hour'
 where event_id in (t068.u(2002), t068.u(2006), t068.u(2007));
select is(app.archive_tick(null) ->> 'dark', 'false', 'the tick runs (enforced, no floor)');
select is(t068.arch(2002, 'state') || '|' || t068.arch(2002, 'outcome_via'), 'published|auto', 'a ticked event (list) published its staged podium');
select is(t068.arch(2006, 'state'), 'published', 'a second ticked event published too');
select is(t068.arch(2007, 'state') || '|' || coalesce(t068.arch(2007, 'last_error'), 'null'), 'stubbed|null',
  'an unticked event (named_only) published a named-only entry');
select is((select payload ->> 'listing' from public_results where event_id = t068.u(2007)), 'named_only', 'and the stub says so');
select is((select payload ? 'podium' from public_results where event_id = t068.u(2007)), false, 'with no podium');
select is((select payload #>> '{podium,0,name}' from public_results where event_id = t068.u(2002)), 'Champion', 'while the ticked one carries the podium');
select is(t068.val(t068.u(2), format('select public.set_archive_listing(%L, %L, false)::text', t068.u(200), t068.u(2002))), 'P0001|archive_listing_closed',
  'after the tick has published, the choice is closed');

-- ============ the soft unpublish (decision 7) ============
-- C2: the pipeline publishes a Community podium; the organiser unpublishes it by the RPC
insert into app.archive_events (event_id, org_id, due_at, staged_payload, staged_at)
values (t068.u(1002), t068.u(100), now() - interval '1 hour', t068.snap(), now() - interval '2 hours');
do $$ begin perform app.archive_tick(null); end $$;
select is(t068.arch(1002, 'state') || '|' || t068.arch(1002, 'outcome_via'), 'published|auto', 'a Community podium was published by the tick');
select is(t068.try(t068.u(1), format('select public.unpublish_event_results(%L, %L)', t068.u(100), t068.u(1002))), 'ok',
  'a Community organiser CAN unpublish it (decision 7: allowed)');
select is(t068.has_result(1002), false, 'the result is gone');
select is(t068.arch(1002, 'state') || '|' || t068.arch(1002, 'removed_from') || '|' || (t068.arch(1002, 'removed_at') is not null)::text
          || '|' || t068.arch(1002, 'outcome_via') || '|' || (t068.arch(1002, 'staged_payload') is null)::text,
  'removed|published|true|auto|true', 'the ledger records it: removed, from published, when, who published it, snapshot dropped');
select is(app.archive_tick(null) ->> 'published', '0', 'the next tick publishes nothing');
select is(t068.has_result(1002), false, 'and the result is NOT back (a removed row is never republished)');
select is(t068.arch(1002, 'state'), 'removed', 'the row stays removed');

-- C3: the organiser published by hand (no ledger row yet), then removed it with a direct DELETE
insert into public_results (org_id, event_id, payload) values (t068.u(100), t068.u(1003), '{"eventName": "C3", "podium": [{"name": "Own"}]}');
select is(t068.arch(1003, 'event_id'), null, 'before the removal there is no ledger row for the hand-published event');
select is(t068.try(t068.u(1), format('delete from public.public_results where event_id = %L', t068.u(1003))), 'ok', 'a direct DELETE by the organiser is allowed too');
select is(t068.arch(1003, 'state') || '|' || t068.arch(1003, 'removed_from') || '|' || coalesce(t068.arch(1003, 'outcome_via'), 'null'), 'removed|none|null',
  'the trigger made the row and recorded the removal (removed_from none: the pipeline never touched it)');
select is(t068.arch(1003, 'due_at')::timestamptz, (select ended_at + interval '24 hours' from events where id = t068.u(1003)), 'with its due time');
select is(app.archive_tick(now() - interval '3 days') ->> 'published', '0', 'a tick with a floor that would enqueue the event publishes nothing');
select is(t068.has_result(1003), false, 'the hand-removed result stays removed');

-- a removal is recorded once: publish by hand again, remove again, the first record stands
insert into public_results (org_id, event_id, payload) values (t068.u(100), t068.u(1003), '{"eventName": "C3 again", "podium": [{"name": "Own"}]}');
create table t068.mark as select removed_at from app.archive_events where event_id = t068.u(1003);
select is(t068.try(t068.u(1), format('delete from public.public_results where event_id = %L', t068.u(1003))), 'ok', 'the second removal is allowed too');
select is(t068.has_result(1003), false, 'and removes the result');
select is(t068.arch(1003, 'removed_from'), 'none', 'a second removal does not rewrite the first record');
select is((select a.removed_at = m.removed_at from app.archive_events a, t068.mark m where a.event_id = t068.u(1003)), true,
  'removed_at is still the FIRST removal');

-- the trigger records nothing for a test event, a gone event, or a stranger's rows
insert into public_results (org_id, event_id, payload) values (t068.u(100), t068.u(1004), '{"eventName": "C4", "podium": [{"name": "X"}]}');
update events set is_test = true where id = t068.u(1004);
delete from public_results where event_id = t068.u(1004);
select is(t068.arch(1004, 'event_id'), null, 'a removal for an event that has become a test event leaves no ledger row');
insert into public_results (org_id, event_id, payload) values (t068.u(100), t068.u(1005), '{"eventName": "C5", "podium": [{"name": "X"}]}');
delete from events where id = t068.u(1005);
select is((select count(*)::int from public_results where event_id = t068.u(1005)), 0, 'deleting an event cascades its result away');
select is(t068.arch(1005, 'event_id'), null, 'and the cascade leaves no ledger row for the gone event');

-- fail-open: a ledger that refuses the write must not stop the unpublish
insert into public_results (org_id, event_id, payload) values (t068.u(100), t068.u(1007), '{"eventName": "C7", "podium": [{"name": "X"}]}');
alter table app.archive_events add constraint t068_block_removed check (state <> 'removed') not valid;
select is(t068.try(t068.u(1), format('delete from public.public_results where event_id = %L', t068.u(1007))), 'ok',
  'a ledger write that would fail does not fail the organiser''s unpublish (fail-open)');
alter table app.archive_events drop constraint t068_block_removed;
select is(t068.has_result(1007), false, 'and the result was removed');
select is(t068.arch(1007, 'event_id'), null, 'the failed record left no half-written row');

-- dark: nothing is recorded while the pipeline does not exist
update app.entitlement_keys set enforced = false where key = 'results_archive_optional';
insert into public_results (org_id, event_id, payload) values (t068.u(100), t068.u(1006), '{"eventName": "C6", "podium": [{"name": "X"}]}');
delete from public_results where event_id = t068.u(1006);
select is(t068.arch(1006, 'event_id'), null, 'dark: a removal leaves no ledger row');
update app.entitlement_keys set enforced = true where key = 'results_archive_optional';

-- the trigger function is not a door
select is(t068.try(t068.u(1), 'select app.archive_note_removal()'), '42501|', 'a member cannot call the trigger function');
select is(t068.try(null, 'select public.admin_archive_status()'), '42501|', 'anon cannot call the counts');

-- ============ admin_archive_status: the gate ============
select is(
  t068.run_as(c.kind, 'select * from public.admin_archive_status()'),
  c.expected,
  'admin_archive_status as ' || c.kind || ' -> ' || c.expected)
from (values
  ('anon', '42501|'),
  ('nonadmin', '42501|admin_required'),
  ('admin_aal1', '42501|admin_mfa_required'),
  ('admin_no_totp', '42501|admin_mfa_required'),
  ('admin_stale_totp', '42501|admin_mfa_required'),
  ('admin_pw_fresh', '42501|admin_mfa_required'),
  ('admin_ended_session', '42501|admin_session_ended'),
  ('admin_ok', 'ok')) c(kind, expected)
order by c.kind;
select is(
  (select p.prosrc ~ '^\s*(#variable_conflict[^\n]*\n)?\s*begin\s+perform\s+app\.require_platform_admin\(\);'
     from pg_proc p where p.oid = 'public.admin_archive_status()'::regprocedure),
  true, 'the body opens with the gate and nothing runs before it');
select is(
  (select array(select distinct m[1] from pg_proc p, regexp_matches(p.prosrc, '\m((?:public|auth|app)\.[a-z_]+)', 'g') m
                 where p.oid = 'public.admin_archive_status()'::regprocedure order by 1)),
  array['app.archive_events', 'app.entitlement_keys', 'app.require_platform_admin', 'public.public_results'],
  'the body names only the ledger, the key table, public_results (existence) and the gate: no event, organisation, person or payload');
select is(
  (select p.prosrc ~* '(payload|display_name|email|phone|name\b|org_id|event_id\s*,)' from pg_proc p where p.oid = 'public.admin_archive_status()'::regprocedure),
  false, 'it never names a payload, a name, an email, a phone or an organisation (event_id only inside the existence join)');

-- ============ admin_archive_status: the shape ============
select is(
  (select proargnames from pg_proc where oid = 'public.admin_archive_status()'::regprocedure),
  array['pipeline_live', 'events_total', 'events_pending', 'events_pending_overdue', 'events_published', 'events_stubbed', 'events_skipped',
        'events_failed', 'events_removed', 'published_by_pipeline', 'stubbed_by_pipeline', 'published_by_organiser', 'stubbed_no_snapshot',
        'stubbed_invalid_snapshot', 'stubbed_stale_snapshot', 'listing_list', 'listing_named_only', 'removed_after_pipeline', 'removed_unpublished'],
  'it returns exactly these nineteen columns: no name, id, payload, organisation or per-organisation figure');
select is(
  (select array_agg(t::regtype::text order by ord) from pg_proc p, unnest(p.proallargtypes) with ordinality u(t, ord)
    where p.oid = 'public.admin_archive_status()'::regprocedure),
  array['boolean'] || array_fill('integer'::text, array[18]), 'one boolean, then eighteen integers');
select is((select pronargs::int from pg_proc where oid = 'public.admin_archive_status()'::regprocedure), 0, 'it takes no argument');
select is((select p.provolatile::text from pg_proc p where p.oid = 'public.admin_archive_status()'::regprocedure), 's', 'it is STABLE (a read: no audit row)');

-- ============ admin_archive_status: the figures ============
-- fixtures for the counts (the shared ledger may hold others: every figure is a delta)
insert into app.archive_events (event_id, org_id, due_at, state, outcome_via, last_error, listing_choice) values
  (t068.u(9001), t068.u(200), now() - interval '3 hours', 'pending', null, null, 'list'),                     -- overdue pending
  (t068.u(9002), t068.u(200), now() - interval '5 minutes', 'pending', null, null, 'named_only'),            -- pending, not overdue
  (t068.u(9003), t068.u(200), now() - interval '5 hours', 'stubbed', 'auto', 'no_snapshot', null),
  (t068.u(9004), t068.u(200), now() - interval '5 hours', 'stubbed', 'auto', 'invalid_snapshot', null),
  (t068.u(9005), t068.u(200), now() - interval '5 hours', 'stubbed', 'auto', 'stale_snapshot', null),
  (t068.u(9006), t068.u(200), now() - interval '5 hours', 'skipped', 'organiser_early', null, null),
  (t068.u(9007), t068.u(200), now() - interval '5 hours', 'skipped', 'organiser_late', null, null),
  (t068.u(9008), t068.u(200), now() - interval '5 hours', 'failed', null, '23505', null);
insert into app.archive_events (event_id, org_id, due_at, state, outcome_via, removed_at, removed_from) values
  (t068.u(9009), t068.u(200), now() - interval '5 hours', 'removed', 'auto', now(), 'stubbed');
-- a removed row the organiser then published again by hand (a live result): removed_unpublished must NOT count it
insert into app.archive_events (event_id, org_id, due_at, state, outcome_via, removed_at, removed_from)
  values (t068.u(2005), t068.u(200), now() - interval '5 hours', 'removed', 'auto', now(), 'published');
insert into public_results (org_id, event_id, payload) values (t068.u(200), t068.u(2005), '{"eventName": "A5", "podium": [{"name": "X"}]}');
-- a removed row that still carries a stubbed reason: stubbed_no_snapshot must count STUBBED rows only
insert into app.archive_events (event_id, org_id, due_at, state, outcome_via, last_error, removed_at, removed_from)
  values (t068.u(9012), t068.u(200), now() - interval '5 hours', 'removed', 'auto', 'no_snapshot', now(), 'stubbed');
-- the overdue edge: 61 minutes past due is overdue, 59 is not
insert into app.archive_events (event_id, org_id, due_at, state) values
  (t068.u(9010), t068.u(200), now() - interval '61 minutes', 'pending'), (t068.u(9011), t068.u(200), now() - interval '59 minutes', 'pending');
do $$ begin perform t068.claims(t068.u(11), 'aal2', 10); end $$;
set local role authenticated;
create temp table got on commit drop as select * from public.admin_archive_status();
reset role;
select is((select count(*)::int from got), 1, 'exactly one row');
select is((select pipeline_live from got), true, 'pipeline_live: true while the key is enforced');
update app.entitlement_keys set enforced = false where key = 'results_archive_optional';
do $$ begin perform t068.claims(t068.u(11), 'aal2', 10); end $$;
set local role authenticated;
create temp table got_dark on commit drop as select * from public.admin_archive_status();
reset role;
update app.entitlement_keys set enforced = true where key = 'results_archive_optional';
select is((select pipeline_live from got_dark), false, 'pipeline_live: false while the key is unenforced (the operator''s dark/live signal)');
select is((select events_total::bigint - b.total from got, t068.base b), (select count(*) from app.archive_events) - (select total from t068.base), 'events_total: every ledger row');
select is((select events_pending::bigint - b.pending from got, t068.base b),
  (select count(*) from app.archive_events where state = 'pending') - (select pending from t068.base), 'events_pending matches the ledger');
select is((select events_pending from got) >= 3, true, 'and counts at least the two fixtures and the not-yet-ended row');
select is((select events_pending_overdue from got),
  (select count(*)::int from app.archive_events where state = 'pending' and due_at < now() - interval '1 hour'),
  'events_pending_overdue matches an hour-past-due count of the ledger');
select is((select count(*)::int from app.archive_events where state = 'pending' and due_at < now() - interval '1 hour'
            and event_id in (t068.u(9001), t068.u(9002), t068.u(9010), t068.u(9011))), 2,
  'and of the four fixtures exactly 9001 (3 hours) and 9010 (61 minutes) are overdue, 9002 (5 minutes) and 9011 (59 minutes) are not');
select is((select events_stubbed::bigint - b.stubbed from got, t068.base b),
  (select count(*) from app.archive_events where state = 'stubbed') - (select stubbed from t068.base), 'events_stubbed matches the ledger');
select is((select events_skipped::bigint - b.skipped from got, t068.base b),
  (select count(*) from app.archive_events where state = 'skipped') - (select skipped from t068.base), 'events_skipped matches the ledger');
select is((select events_failed::bigint - b.failed from got, t068.base b), 1::bigint, 'events_failed: +1');
select is((select events_removed::bigint - b.removed from got, t068.base b),
  (select count(*) from app.archive_events where state = 'removed') - (select removed from t068.base), 'events_removed matches the ledger');
select is((select stubbed_no_snapshot from got), (select count(*)::int from app.archive_events where state = 'stubbed' and last_error = 'no_snapshot'), 'stubbed_no_snapshot');
select is((select stubbed_invalid_snapshot from got), (select count(*)::int from app.archive_events where state = 'stubbed' and last_error = 'invalid_snapshot'), 'stubbed_invalid_snapshot');
select is((select stubbed_stale_snapshot from got), (select count(*)::int from app.archive_events where state = 'stubbed' and last_error = 'stale_snapshot'), 'stubbed_stale_snapshot');
select is((select published_by_organiser from got), (select count(*)::int from app.archive_events where outcome_via in ('organiser_early', 'organiser_late')), 'published_by_organiser: both organiser outcomes');
select is((select published_by_pipeline from got), (select count(*)::int from app.archive_events where state = 'published' and outcome_via = 'auto'), 'published_by_pipeline');
select is((select stubbed_by_pipeline from got), (select count(*)::int from app.archive_events where state = 'stubbed' and outcome_via = 'auto'), 'stubbed_by_pipeline');
select is((select listing_list from got), (select count(*)::int from app.archive_events where listing_choice = 'list'), 'listing_list');
select is((select listing_named_only from got), (select count(*)::int from app.archive_events where listing_choice = 'named_only'), 'listing_named_only');
select is((select removed_after_pipeline from got), (select count(*)::int from app.archive_events where state = 'removed' and removed_from in ('published', 'stubbed') and outcome_via = 'auto'),
  'removed_after_pipeline: only removals of a result the pipeline itself published (C2 and the stubbed fixture; the hand-published C3 is not)');
select is((select removed_after_pipeline from got) >= 2, true, 'and it counts at least those two');
select is((select removed_unpublished from got), (select count(*)::int from app.archive_events a where state = 'removed'
            and not exists (select 1 from public_results pr where pr.event_id = a.event_id)),
  'removed_unpublished: removed rows with no result now (a removed row the organiser published again by hand is not counted)');
select is((select statuses from (select events_pending + events_published + events_stubbed + events_skipped + events_failed + events_removed = events_total as statuses from got) x),
  true, 'the six states add up to the total');

-- ============ it changes and logs nothing; no phone, name or id comes back ============
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t068.base)), 0, 'no audit row was written by any call (refused or answered)');
select is(
  (select (row_to_json(g)::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-|@|\+\d{6}') from got g),
  false, 'no uuid, email or phone appears anywhere in the answer');

select * from finish();
rollback;
