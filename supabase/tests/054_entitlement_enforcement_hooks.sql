-- T-GATE.B3: the enforcement hooks (spec: Handoffs and Specs/GATING-SPEC.md 3.4, D-G4, D-G8, D-G19, D-G29, 7a risks 1 and 3).
-- Proves, as the REAL roles through RLS:
--   * DARK: with every key unenforced (the seed) a Community organisation creates a BTC event and registers ten Cup Taster
--     entries exactly as before;
--   * events insert (btc_format): refused for a Community organisation with 42501 / entitlement_required and the key in the
--     detail, allowed for an annual organisation and for an organisation-level per_event grant, a CUP TASTER event is never
--     refused; a non-member gets the STANDARD row-level-security refusal (never the entitlement one: no oracle); the table
--     owner is not gated; a client cannot insert the snapshot columns (they are nulled);
--   * events.format is frozen for everyone (a Community organisation cannot turn a cup_taster event into a BTC one or back);
--   * the participant cap (cup_taster_participants, Community 8): the ninth ACTIVE entry is refused with 42501 /
--     entitlement_cap_reached; a withdrawn entry does not count; reinstating one at the cap is refused too; an entry inserted
--     withdrawn, and any other update, are not gated; the owner is not gated; an annual organisation and an event with a
--     per_event event grant are not capped; another organisation's member gets the standard refusal;
--   * the go-live snapshot: stamped by the FIRST activation of the event's live session (tier only), once, never by a client
--     (23001), and an event keeps its snapshot tier when a better grant arrives later while a not-yet-live event resolves
--     live; admin_event_resnapshot lifts it upward only, with a required reason, an audit row with pinned keys, and the
--     usual gate; the same tier is a no-op; a lower tier is refused.
begin;
select plan(72);

create schema t054;
grant usage on schema t054 to anon, authenticated, service_role;

create function t054.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000540' || lpad(n::text, 4, '0'))::uuid
$$;

create function t054.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

-- "SQLSTATE|hint|detail|message" of a statement run as a signed-in person (as the real `authenticated` role), or 'ok'
create function t054.as_user(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; d text; m text;
begin
  perform set_config('role', 'authenticated', true);
  perform t054.claims(uid, 'aal1');
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint, d = pg_exception_detail, m = message_text;
    res := sqlstate || '|' || coalesce(h, '') || '|' || coalesce(d, '') || '|' || m;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;
-- the same, as an admin (aal2, fresh TOTP) or a non-admin, for the admin function
create function t054.as_admin(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  perform set_config('role', 'authenticated', true);
  if kind = 'nonadmin' then perform t054.claims(t054.u(2), 'aal2', 10);
  else perform t054.claims(t054.u(1), 'aal2', 10);
  end if;
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    res := sqlstate || '|' || coalesce(h, '');
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;
grant execute on all functions in schema t054 to anon, authenticated, service_role;

-- ============ fixtures (as the owner) ============
insert into auth.users (id, email) values
  (t054.u(1), 't054-admin@test.seduh-next'),
  (t054.u(2), 't054-nonadmin@test.seduh-next'),
  (t054.u(11), 't054-c@test.seduh-next'),   -- member of C (community)
  (t054.u(12), 't054-a@test.seduh-next'),   -- member of A (annual)
  (t054.u(13), 't054-p@test.seduh-next');   -- member of P (organisation-level per_event)
insert into app.platform_admins (user_id, note) values (t054.u(1), 't054 admin');
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id in (t054.u(1), t054.u(2));
insert into orgs (id, name, slug) values
  (t054.u(100), 'T054 C', 't054-c'), (t054.u(200), 'T054 A', 't054-a'), (t054.u(300), 'T054 P', 't054-p');
insert into org_members (org_id, user_id, role) values
  (t054.u(100), t054.u(11), 'owner'), (t054.u(200), t054.u(12), 'owner'), (t054.u(300), t054.u(13), 'owner');
insert into entitlement_grants (org_id, tier, source) values (t054.u(200), 'annual', 'manual'), (t054.u(300), 'per_event', 'manual');
-- C's events: E1 (the cap tests), E2 (gets an event grant), E3 (go-live), E4 (never published); A's event for the annual cap
insert into events (id, org_id, format, name) values
  (t054.u(101), t054.u(100), 'cup_taster', 'C E1'),
  (t054.u(102), t054.u(100), 'cup_taster', 'C E2'),
  (t054.u(103), t054.u(100), 'cup_taster', 'C E3'),
  (t054.u(104), t054.u(100), 'cup_taster', 'C E4'),
  (t054.u(105), t054.u(100), 'btc', 'C B1 (made by the owner)'),
  (t054.u(201), t054.u(200), 'cup_taster', 'A E1');
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (t054.u(100), t054.u(102), 'per_event', now() - interval '1 day', now() + interval '1 day', 'manual');
create table t054.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;

create function t054.entry(ev int, n int, w boolean default false) returns text language sql as $$
  select format($q$insert into event_entries (id, event_id, display_name, withdrawn) values (%L, %L, %L, %s)$q$,
                ('00000000-0000-0000-0540-' || lpad((ev * 100 + n)::text, 12, '0'))::uuid, t054.u(ev), 'cupper ' || n, w::text)
$$;
create function t054.active_n(ev int) returns int language sql as $$
  select count(*)::int from event_entries where event_id = t054.u(ev) and not withdrawn $$;
grant execute on all functions in schema t054 to anon, authenticated, service_role;

-- ============ catalogue ============
select is(
  (select string_agg(t.tgname || ':' || t.tgenabled::text, ',' order by t.tgname) from pg_trigger t
    where t.tgrelid in ('public.events'::regclass, 'public.event_entries'::regclass, 'public.live_sessions'::regclass)
      and t.tgname in ('trg_events_entitlement_create', 'trg_events_snapshot_frozen', 'trg_events_org_immutable',
                       'trg_event_entries_cap_insert', 'trg_event_entries_cap_reinstate', 'trg_live_sessions_stamp_entitlements')),
  'trg_event_entries_cap_insert:O,trg_event_entries_cap_reinstate:O,trg_events_entitlement_create:O,trg_events_org_immutable:O,trg_events_snapshot_frozen:O,trg_live_sessions_stamp_entitlements:O',
  'the six triggers exist and are enabled');
select ok((select p.prosrc ~ 'pg_advisory_xact_lock\(hashtext\(''entitlement_cap:'' \|\| new\.event_id::text\)\)' from pg_proc p where p.oid = 'app.check_event_entry_cap()'::regprocedure),
  'the cap trigger decides under a per-event advisory lock (source text: one session cannot observe a lock)');
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text || '/' || r, ', '), 'none')
     from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.oid in ('app.check_event_create()'::regprocedure, 'app.check_event_entry_cap()'::regprocedure, 'app.stamp_event_entitlements()'::regprocedure,
                    'app.forbid_event_snapshot_edit()'::regprocedure, 'app.resolved_tier(uuid,uuid,timestamptz,boolean)'::regprocedure,
                    'app.entitlement_api_caller()'::regprocedure)
      and has_function_privilege(r, p.oid, 'execute')),
  'none', 'none of the new app functions is executable by an API role');
select is(
  (select coalesce(string_agg(p.proname, ', '), 'none') from pg_proc p
    where p.oid in ('app.check_event_create()'::regprocedure, 'app.check_event_entry_cap()'::regprocedure, 'app.stamp_event_entitlements()'::regprocedure)
      and not coalesce(p.prosecdef and p.proconfig @> array['search_path=""'], false)),
  'none', 'the three SECURITY DEFINER trigger functions pin search_path');

-- ============ DARK: nothing changes while every key is unenforced ============
select is((select count(*)::int from app.entitlement_keys where enforced), 0, 'every key is unenforced at the start');
select is(t054.as_user(t054.u(11), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(100), 'btc', 'dark btc')$$), 'ok',
  'dark: a Community member creates a BTC event');
select is(t054.as_user(t054.u(11), (select string_agg(t054.entry(101, n), '; ') from generate_series(1, 10) n)), 'ok',
  'dark: and registers TEN active Cup Taster entries (the cap of 8 is not enforced)');
select is(t054.active_n(101), 10, 'ten are there');
delete from event_entries where event_id = t054.u(101);

-- ============ events: the BTC gate ============
update app.entitlement_keys set enforced = true where key = 'btc_format';
select is(t054.as_user(t054.u(11), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(100), 'btc', 'gated btc')$$),
  '42501|entitlement_required|btc_format|entitlement_required', 'enforced: a Community member is refused a BTC event: 42501, hint entitlement_required, the key in the detail');
select is(t054.as_user(t054.u(11), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(100), 'cup_taster', 'cup taster still fine')$$), 'ok',
  'a Cup Taster event is not gated');
select is(t054.as_user(t054.u(12), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(200), 'btc', 'annual btc')$$), 'ok',
  'an annual organisation creates a BTC event');
select is(t054.as_user(t054.u(13), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(300), 'btc', 'per-event btc')$$), 'ok',
  'an organisation with a per_event grant (organisation level) creates a BTC event');
select is(t054.as_user(t054.u(12), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(100), 'btc', 'not my org')$$),
  '42501||' || '|new row violates row-level security policy for table "events"',
  'a NON-member naming the Community organisation gets the standard row-level-security refusal (not the entitlement one: no oracle)');
select is(t054.as_user(t054.u(12), $$insert into events (id, org_id, format, name) values (gen_random_uuid(), t054.u(100), 'cup_taster', 'not my org either')$$),
  '42501||' || '|new row violates row-level security policy for table "events"', 'and the same for a Cup Taster event: the answer does not depend on the entitlement');
select is((select count(*)::int from (select 1 from events where org_id = t054.u(100) and name = 'gated btc') x), 0, 'the refused event does not exist');
insert into events (id, org_id, format, name) values (t054.u(106), t054.u(100), 'btc', 'owner btc');
select is((select count(*)::int from events where id = t054.u(106)), 1, 'the table owner (a seed, a fixture) is not gated');
select is(t054.as_user(t054.u(11), format($$insert into events (id, org_id, format, name, entitlements_snapshot, entitlements_snapshot_at)
                                            values (%L, t054.u(100), 'cup_taster', 'forged', '{"tier":"annual"}', now())$$, t054.u(107))), 'ok',
  'a client may insert an event that names the snapshot columns...');
select is((select (entitlements_snapshot is null and entitlements_snapshot_at is null)::text from events where id = t054.u(107)), 'true',
  '...but they come out null: the snapshot is the database''s to write (7a risk 3)');
update app.entitlement_keys set enforced = false where key = 'btc_format';

-- ============ events.format is frozen ============
select is(t054.as_user(t054.u(11), format($$update events set format = 'btc' where id = %L$$, t054.u(104))), '23001|||events.format is immutable',
  'a member cannot change a cup_taster event into a BTC one (7a risk 1)');
select is(t054.as_user(t054.u(11), format($$update events set format = 'cup_taster' where id = %L$$, t054.u(105))), '23001|||events.format is immutable',
  'nor the reverse');
select is(t054.as_user(t054.u(11), format($$update events set name = 'renamed' where id = %L$$, t054.u(104))), 'ok', 'while an ordinary update still works');
select throws_ok(format($$update events set format = 'btc' where id = %L$$, t054.u(104)), '23001', null, 'and the table owner is refused too');

-- ============ the participant cap ============
update app.entitlement_keys set enforced = true where key = 'cup_taster_participants';
select is(t054.as_user(t054.u(11), (select string_agg(t054.entry(101, n), '; ') from generate_series(1, 8) n)), 'ok', 'cap: a Community event takes eight active entries');
select is(t054.as_user(t054.u(11), t054.entry(101, 9)),
  '42501|entitlement_cap_reached|cup_taster_participants|entitlement_cap_reached', 'the ninth is refused: 42501, hint entitlement_cap_reached, the key in the detail');
select is(t054.active_n(101), 8, 'and was not stored');
select is(t054.as_user(t054.u(11), format($$update event_entries set withdrawn = true where id = %L$$, ('00000000-0000-0000-0540-' || lpad('10101', 12, '0'))::uuid)), 'ok', 'a participant withdraws');
select is(t054.active_n(101), 7, 'a withdrawn participant does not count (D-G19)');
select is(t054.as_user(t054.u(11), t054.entry(101, 9)), 'ok', 'so the slot can be filled');
select is(t054.active_n(101), 8, 'eight active again');
select is(t054.as_user(t054.u(11), format($$update event_entries set withdrawn = false where id = %L$$, ('00000000-0000-0000-0540-' || lpad('10101', 12, '0'))::uuid)),
  '42501|entitlement_cap_reached|cup_taster_participants|entitlement_cap_reached', 'REINSTATING the withdrawn one at the cap is refused (no ninth person by withdraw-and-re-add)');
select is(t054.active_n(101), 8, 'still eight');
select is(t054.as_user(t054.u(11), t054.entry(101, 10, true)), 'ok', 'an entry inserted already withdrawn is not a participant: allowed at the cap');
select is(t054.as_user(t054.u(11), format($$update event_entries set display_name = 'renamed' where id = %L$$, ('00000000-0000-0000-0540-' || lpad('10102', 12, '0'))::uuid)), 'ok',
  'an update that adds nobody is not gated at the cap');
select is(t054.as_user(t054.u(11), format($$update event_entries set withdrawn = true where id = %L$$, ('00000000-0000-0000-0540-' || lpad('10110', 12, '0'))::uuid)), 'ok',
  'withdrawing an already-withdrawn entry changes nothing and is not gated');
select is(t054.as_user(t054.u(12), t054.entry(101, 11)), '42501||' || '|new row violates row-level security policy for table "event_entries"',
  'another organisation''s member gets the standard row-level-security refusal on a full roster (the cap is not an oracle)');
insert into event_entries (id, event_id, display_name) values ('00000000-0000-0000-0540-000000010112', t054.u(101), 'owner adds a ninth');
select is(t054.active_n(101), 9, 'the table owner (a fixture) is not capped');
delete from event_entries where id = '00000000-0000-0000-0540-000000010112';
select is(t054.as_user(t054.u(12), (select string_agg(t054.entry(201, n), '; ') from generate_series(1, 12) n)), 'ok', 'an annual organisation registers twelve (no cap)');
select is(t054.as_user(t054.u(11), (select string_agg(t054.entry(102, n), '; ') from generate_series(1, 10) n)), 'ok',
  'an event with a per_event EVENT grant is not capped, in an organisation that is otherwise Community');
select is(app.entitlement_limit(t054.u(100), 'cup_taster_participants', t054.u(101)), 8, 'the limit the trigger reads for the Community event');
select is(app.entitlement_limit(t054.u(100), 'cup_taster_participants', t054.u(102)), null, 'and for the event with the grant');
-- a BTC event is not capped (BTC has no participant key); registration on it is not gated
select is(t054.as_user(t054.u(11), format($$insert into event_entries (event_id, display_name) select %L, 'b' || n from generate_series(1, 12) n$$, t054.u(105))), 'ok',
  'a BTC event''s entries are not capped (no participant key for BTC)');

-- ============ the go-live snapshot ============
-- E3 goes live as Community
select is(t054.as_user(t054.u(11), format($$insert into live_sessions (org_id, event_id, format, active) values (%L, %L, 'cup_taster', true)$$, t054.u(100), t054.u(103))), 'ok',
  'a member publishes (activates) the event''s live session');
select is((select entitlements_snapshot::text from events where id = t054.u(103)), '{"tier": "community"}', 'the first activation stamped the tier the event resolved to');
select ok((select entitlements_snapshot_at is not null from events where id = t054.u(103)), 'and when');
select is((select entitlements_snapshot is null from events where id = t054.u(104)), true, 'an event that never went live has no snapshot (it resolves live)');
select is(t054.as_user(t054.u(11), format($$update events set entitlements_snapshot = '{"tier":"annual"}' where id = %L$$, t054.u(103))),
  '23001|||events.entitlements_snapshot is written by the database only',
  'a member cannot edit the snapshot (23001)');
select is(t054.as_user(t054.u(11), format($$update events set entitlements_snapshot_at = now() + interval '1 day' where id = %L$$, t054.u(103))),
  '23001|||events.entitlements_snapshot is written by the database only', 'nor its time');
select is(t054.as_user(t054.u(11), format($$update events set entitlements_snapshot = null where id = %L$$, t054.u(103))),
  '23001|||events.entitlements_snapshot is written by the database only', 'nor clear it so that it is stamped afresh');
select is((select entitlements_snapshot::text from events where id = t054.u(103)), '{"tier": "community"}', 'it is unchanged');
-- off and on again does not re-stamp
create table t054.stamp as select entitlements_snapshot_at as at from events where id = t054.u(103);
select is(t054.as_user(t054.u(11), format($$update live_sessions set active = false where event_id = %L$$, t054.u(103))), 'ok', 'the session is ended');
select is(t054.as_user(t054.u(11), format($$update live_sessions set active = true where event_id = %L$$, t054.u(103))), 'ok', 'and started again');
select is((select entitlements_snapshot_at = (select at from t054.stamp) from events where id = t054.u(103)), true, 'the stamp is set once: a second activation does not move it');
-- an annual grant arrives later: the live event keeps its tier, an unpublished one resolves live
insert into entitlement_grants (id, org_id, tier, source) values (t054.u(900), t054.u(100), 'annual', 'manual');
select is(app.entitlement_limit(t054.u(100), 'cup_taster_participants', t054.u(103)), 8, 'a grant bought after go-live does not lift the live event (it keeps its snapshot tier)');
select is(app.entitlement_limit(t054.u(100), 'cup_taster_participants', t054.u(104)), null, 'while an event that is not live yet resolves live (annual: no cap)');
select is(t054.as_user(t054.u(11), 'select public.my_entitlements(' || quote_literal(t054.u(100)) || ', ' || quote_literal(t054.u(103)) || ')'), 'ok', 'for a member');
-- the 8 participants of E3 are capped, a ninth refused, even though the organisation is now annual
select is(t054.as_user(t054.u(11), (select string_agg(t054.entry(103, n), '; ') from generate_series(1, 8) n)), 'ok', 'E3 takes eight');
select is(t054.as_user(t054.u(11), t054.entry(103, 9)), '42501|entitlement_cap_reached|cup_taster_participants|entitlement_cap_reached',
  'and refuses the ninth although the organisation is annual now: the snapshot holds');

-- ============ admin_event_resnapshot ============
select is(t054.as_admin('nonadmin', format($$select public.admin_event_resnapshot(%L, 'why')$$, t054.u(103))), '42501|admin_required', 'resnapshot: a non-admin is refused');
select is(t054.as_admin('admin', 'select public.admin_event_resnapshot(null, null)'), '22023|reason_required', 'a blank reason is refused');
select is(t054.as_admin('admin', format($$select public.admin_event_resnapshot(%L, repeat('r', 501))$$, t054.u(103))), '22023|reason_too_long', 'a 501 character reason is refused');
select is(t054.as_admin('admin', $$select public.admin_event_resnapshot(gen_random_uuid(), 'why')$$), '22023|event_not_found', 'an unknown event is refused');
select is(t054.as_admin('admin', format($$select public.admin_event_resnapshot(%L, 'why')$$, t054.u(104))), '22023|snapshot_absent', 'an event with no snapshot is refused');
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t054.base) and actor_id = t054.u(1)), 0, 'none of those refusals logged anything');
select is(t054.as_admin('admin', format($$select public.admin_event_resnapshot(%L, '  annual grant bought after go-live  ')$$, t054.u(103))), 'ok', 'the admin re-snapshots E3 upward');
select is((select entitlements_snapshot::text from events where id = t054.u(103)), '{"tier": "annual"}', 'the snapshot is annual now');
select is(app.entitlement_limit(t054.u(100), 'cup_taster_participants', t054.u(103)), null, 'and the cap is lifted for that event');
select is(t054.as_user(t054.u(11), t054.entry(103, 9)), 'ok', 'the ninth entry is accepted');
select is(
  (select action || '|' || target_org_id || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(detail) k) || '|' || (detail ->> 'from') || '>' || (detail ->> 'to') || '|' || (detail ->> 'reason')
     from app.admin_audit_log where id > (select mid from t054.base) and actor_id = t054.u(1) order by id desc limit 1),
  'event.resnapshot|' || t054.u(100) || '|event_id,from,reason,to|community>annual|annual grant bought after go-live',
  'one audit row: event.resnapshot, with exactly the pinned keys and the trimmed reason');
select is(t054.as_admin('admin', format($$select public.admin_event_resnapshot(%L, 'again')$$, t054.u(103))), 'ok', 'the same tier again: a no-op');
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t054.base) and actor_id = t054.u(1)), 1, 'which logged nothing');
update entitlement_grants set revoked_at = now() - interval '1 minute' where id = t054.u(900);
select is(t054.as_admin('admin', format($$select public.admin_event_resnapshot(%L, 'try to lower')$$, t054.u(103))), '22023|snapshot_downgrade',
  'a snapshot only moves up: a lower live tier is refused');
select is((select entitlements_snapshot::text from events where id = t054.u(103)), '{"tier": "annual"}', 'and unchanged');

select * from finish();
rollback;
