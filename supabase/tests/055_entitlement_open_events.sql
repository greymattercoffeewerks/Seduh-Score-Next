-- T-GATE.B4: the Community "one open event at a time" rule (spec: Handoffs and Specs/GATING-SPEC.md 6d D-G20, D-G23).
-- Proves, as the REAL roles through RLS:
--   * the key events_open is seeded unenforced with caps community 1 / per_event null / annual null; DARK, a Community
--     organisation opens as many events as it likes exactly as before;
--   * enforced: a Community organisation with one open event is refused a second (42501, hint entitlement_cap_reached, detail
--     events_open), test events count, finishing the event frees the slot, an annual organisation and an organisation with a
--     per_event grant are not limited, the table owner is not gated, and a non-member gets the STANDARD row-level-security
--     refusal (no oracle);
--   * "ended" is the database's: a member cannot insert it, set it, clear it or change it (23001); setting status to
--     concluded stamps it (whatever the client wrote), and un-concluding does not reopen;
--   * finish_event: a member ends their organisation's event (who, when, via); a second call changes nothing; every other
--     caller (another organisation's member, the right org with another org's event, an unknown event) gets the same 42501
--     "event not found"; anon cannot run it;
--   * admin_event_release: gate refusals, a required reason, an audit row with pinned keys, a no-op for an ended event
--     that logs nothing, and the freed slot;
--   * the preview and the flip for events_open: only organisations that could not start another event are listed, and the
--     confirm count must equal the preview.
begin;
select plan(99);

create schema t055;
grant usage on schema t055 to anon, authenticated, service_role;

create function t055.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000550' || lpad(n::text, 4, '0'))::uuid
$$;

create function t055.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

-- "SQLSTATE|hint|detail|message" of a statement run as a signed-in person (the real `authenticated` role), or 'ok'
create function t055.as_user(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; d text; m text;
begin
  perform set_config('role', 'authenticated', true);
  perform t055.claims(uid, 'aal1');
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
create function t055.as_anon(stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  perform set_config('role', 'anon', true);
  perform t055.claims(null, null);
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
create function t055.as_admin(kind text, stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  perform set_config('role', 'authenticated', true);
  if kind = 'nonadmin' then perform t055.claims(t055.u(2), 'aal2', 10);
  elsif kind = 'aal1' then perform t055.claims(t055.u(1), 'aal1');
  else perform t055.claims(t055.u(1), 'aal2', 10);
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
grant execute on all functions in schema t055 to anon, authenticated, service_role;

-- ============ fixtures (as the owner) ============
insert into auth.users (id, email) values
  (t055.u(1), 't055-admin@test.seduh-next'), (t055.u(2), 't055-nonadmin@test.seduh-next'),
  (t055.u(11), 't055-c@test.seduh-next'), (t055.u(12), 't055-a@test.seduh-next'),
  (t055.u(13), 't055-p@test.seduh-next'), (t055.u(14), 't055-e@test.seduh-next'), (t055.u(15), 't055-e2@test.seduh-next');
insert into app.platform_admins (user_id, note) values (t055.u(1), 't055 admin');
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id in (t055.u(1), t055.u(2));
insert into orgs (id, name, slug) values
  (t055.u(100), 'T055 C', 't055-c'), (t055.u(200), 'T055 A', 't055-a'),
  (t055.u(300), 'T055 P', 't055-p'), (t055.u(400), 'T055 E', 't055-e');
insert into org_members (org_id, user_id, role) values
  (t055.u(100), t055.u(11), 'owner'), (t055.u(200), t055.u(12), 'owner'),
  (t055.u(300), t055.u(13), 'owner'), (t055.u(400), t055.u(14), 'owner'), (t055.u(400), t055.u(15), 'organiser');
insert into entitlement_grants (org_id, tier, source) values (t055.u(200), 'annual', 'manual'), (t055.u(300), 'per_event', 'manual');
create table t055.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;
create function t055.ev(n int, org int, fmt text default 'cup_taster', test boolean default false) returns text language sql as $$
  select format($q$insert into events (id, org_id, format, name, is_test) values (%L, %L, %L, %L, %s)$q$, t055.u(n), t055.u(org), fmt, 'ev ' || n, test::text) $$;
create function t055.open_n(org int) returns int language sql as $$ select count(*)::int from events where org_id = t055.u(org) and ended_at is null $$;
grant execute on all functions in schema t055 to anon, authenticated, service_role;

-- ============ catalogue ============
select is((select enforced from app.entitlement_keys where key = 'events_open'), false, 'events_open is seeded unenforced');
select is((select kind || '|' || coalesce(min_tier, '-') from app.entitlement_keys where key = 'events_open'), 'cap|-', 'a cap key with no minimum tier');
select is((select string_agg(tier || '=' || coalesce(cap_limit::text, 'unlimited'), ',' order by tier) from app.entitlement_caps where key = 'events_open'),
  'annual=unlimited,community=1,per_event=unlimited', 'caps: community 1, per_event and annual unlimited (D-G20)');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name = 'events' and column_name like 'ended\_%'),
  'ended_at,ended_by,ended_via', 'the three ended columns exist');
select is((select tgenabled::text from pg_trigger where tgname = 'trg_events_ended_guard'), 'O', 'the ended guard is enabled');
select is(
  (select coalesce(string_agg(p.proname, ', '), 'none') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('finish_event', 'admin_event_release')
      and not coalesce(p.prosecdef and p.provolatile = 'v' and p.proconfig @> array['search_path=""'], false)),
  'none', 'finish_event and admin_event_release are SECURITY DEFINER, VOLATILE, search_path pinned');
select is(
  (select coalesce(string_agg(p.proname || '/' || r, ', '), 'none') from pg_proc p, unnest(array['anon', 'service_role']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('finish_event', 'admin_event_release') and has_function_privilege(r, p.oid, 'execute')),
  'none', 'neither is executable by anon or service_role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('finish_event', 'admin_event_release') and has_function_privilege('authenticated', p.oid, 'execute')),
  2, 'both are executable by a signed-in caller (the function decides)');
select ok((select p.prosrc ~ 'pg_advisory_xact_lock\(hashtext\(''events_open:'' \|\| new\.org_id::text\)\)' from pg_proc p where p.oid = 'app.check_event_create()'::regprocedure),
  'the creation rule decides under a per-organisation advisory lock (source text)');

-- ============ DARK ============
select is(t055.as_user(t055.u(11), t055.ev(101, 100) || '; ' || t055.ev(102, 100) || '; ' || t055.ev(103, 100)), 'ok', 'dark: a Community member opens three events');
select is(t055.open_n(100), 3, 'all three are open');

-- ============ enforced ============
update app.entitlement_keys set enforced = true where key = 'events_open';
select is(t055.as_user(t055.u(11), t055.ev(104, 100)), '42501|entitlement_cap_reached|events_open|entitlement_cap_reached',
  'enforced: a Community organisation that already has open events is refused another: 42501, entitlement_cap_reached, the key in the detail');
select is(t055.open_n(100), 3, 'and it was not stored');
select is(t055.as_user(t055.u(11), format($$select public.finish_event(%L, %L)$$, t055.u(100), t055.u(101))), 'ok', 'the organiser finishes one');
select is(t055.as_user(t055.u(11), t055.ev(104, 100)), '42501|entitlement_cap_reached|events_open|entitlement_cap_reached', 'two are still open: still refused');
select is(t055.as_user(t055.u(11), format($$select public.finish_event(%L, %L); select public.finish_event(%L, %L)$$, t055.u(100), t055.u(102), t055.u(100), t055.u(103))), 'ok', 'finishing the rest');
select is(t055.open_n(100), 0, 'none open');
select is(t055.as_user(t055.u(11), t055.ev(104, 100)), 'ok', 'a new event can now be created');
select is(t055.as_user(t055.u(11), t055.ev(105, 100)), '42501|entitlement_cap_reached|events_open|entitlement_cap_reached', 'and then only that one');
select is(t055.as_user(t055.u(11), format($$update events set is_test = true where id = %L$$, t055.u(104))), 'ok', 'marking the open event as test...');
select is(t055.as_user(t055.u(11), t055.ev(106, 100, 'cup_taster', true)), '42501|entitlement_cap_reached|events_open|entitlement_cap_reached',
  '...does not exempt it, and a TEST event is itself refused while one is open (is_test is member-writable, so it cannot be an exemption)');
select is(t055.as_user(t055.u(11), t055.ev(106, 100, 'btc')), '42501|entitlement_cap_reached|events_open|entitlement_cap_reached', 'the rule applies to every format');
select is(t055.as_user(t055.u(12), t055.ev(201, 200) || '; ' || t055.ev(202, 200) || '; ' || t055.ev(203, 200)), 'ok', 'an annual organisation opens three at once');
select is(t055.as_user(t055.u(13), t055.ev(301, 300) || '; ' || t055.ev(302, 300)), 'ok', 'so does an organisation with a per_event grant');
select is(t055.as_user(t055.u(14), t055.ev(401, 400)), 'ok', 'a Community organisation with no open events opens its first');
insert into events (id, org_id, format, name) values (t055.u(107), t055.u(100), 'cup_taster', 'owner fixture');
select is(t055.open_n(100), 2, 'the table owner (a seed, a fixture) is not gated');
delete from events where id = t055.u(107);
select is(t055.as_user(t055.u(12), t055.ev(108, 100)), '42501|||new row violates row-level security policy for table "events"',
  'a NON-member naming the full Community organisation gets the standard row-level-security refusal (no oracle on its events)');
select is(t055.as_user(t055.u(12), t055.ev(109, 400)), '42501|||new row violates row-level security policy for table "events"', 'and the same for an organisation with room');

-- ============ the ended columns are the database''s ============
select is(t055.as_user(t055.u(14), format($$insert into events (id, org_id, format, name, ended_at, ended_by, ended_via)
                                             values (%L, %L, 'cup_taster', 'forged ended', now(), %L, 'organiser')$$, t055.u(402), t055.u(400), t055.u(14))),
  '42501|entitlement_cap_reached|events_open|entitlement_cap_reached', 'a client cannot insert an already-ended event to slip past the count (the columns are nulled, so it counts as open)');
select is(t055.as_user(t055.u(11), format($$update events set ended_at = null where id = %L$$, t055.u(101))), '23001|||events.ended_at is written by the database only', 'a member cannot reopen a finished event');
select is(t055.as_user(t055.u(11), format($$update events set ended_via = 'organiser', ended_at = now() where id = %L$$, t055.u(104))), '23001|||events.ended_at is written by the database only', 'nor end one by writing the columns');
select is(t055.as_user(t055.u(11), format($$update events set ended_by = %L where id = %L$$, t055.u(12), t055.u(101))), '23001|||events.ended_at is written by the database only', 'nor change who ended it');
select is(t055.as_user(t055.u(11), format($$update events set name = 'renamed' where id = %L$$, t055.u(104))), 'ok', 'while an ordinary update still works');
select is((select (ended_at is null)::text from events where id = t055.u(104)), 'true', 'the open event is still open');

select is(t055.as_user(t055.u(12), format($$insert into events (id, org_id, format, name, ended_at, ended_by, ended_via)
                                             values (%L, %L, 'cup_taster', 'forged ended, room available', now(), %L, 'organiser')$$, t055.u(204), t055.u(200), t055.u(12))), 'ok',
  'an organisation WITH room may insert an event that names the ended columns...');
select is((select (ended_at is null and ended_by is null and ended_via is null)::text from events where id = t055.u(204)), 'true', '...but they come out null: a client cannot insert an ended event (it stays open)');
select is(t055.as_user(t055.u(12), format($$insert into events (id, org_id, format, name, status) values (%L, %L, 'cup_taster', 'born concluded', 'concluded')$$, t055.u(205), t055.u(200))), 'ok', 'an event inserted already concluded...');
select is((select ended_via from events where id = t055.u(205)), 'concluded', '...is ended at once (the stamp also runs on insert)');

-- concluding stamps it
select is(t055.as_user(t055.u(11), format($$update events set status = 'concluded', ended_at = timestamptz '2001-01-01', ended_via = 'organiser' where id = %L$$, t055.u(104))), 'ok',
  'setting status to concluded (as resolve_stage does) ends the event, whatever the client also wrote in the ended columns');
select is((select (ended_via || '|' || (ended_by = t055.u(11))::text || '|' || (ended_at > now() - interval '1 minute')::text) from events where id = t055.u(104)),
  'concluded|true|true', 'it is stamped concluded, by the caller, now (not the forged 2001)');
select is(t055.as_user(t055.u(11), format($$update events set status = 'draft' where id = %L$$, t055.u(104))), 'ok', 'setting the status back...');
select is((select ended_via from events where id = t055.u(104)), 'concluded', '...does not reopen it');
select is(t055.as_user(t055.u(11), t055.ev(105, 100)), 'ok', 'and the slot is free again');
select is(t055.as_user(t055.u(11), format($$update events set status = 'concluded' where id = %L$$, t055.u(105))), 'ok', 'concluding the new one');
select is(t055.as_user(t055.u(12), format($$update events set status = 'concluded' where id = %L$$, t055.u(401))), 'ok', 'a member of another organisation updates nothing of ours (row-level security: zero rows)');
select is((select ended_at is null from events where id = t055.u(401)), true, 'and that organisation''s event is still open');

-- ============ finish_event ============
select is(t055.as_user(t055.u(14), format($$select public.finish_event(%L, %L)$$, t055.u(400), t055.u(401))), 'ok', 'a member finishes their event');
select is((select (ended_via || '|' || (ended_by = t055.u(14))::text) from events where id = t055.u(401)), 'organiser|true', 'recorded: who, and via organiser');
create table t055.first_end as select ended_at as at from events where id = t055.u(401);
select is(t055.as_user(t055.u(14), format($$select public.finish_event(%L, %L)$$, t055.u(400), t055.u(401))), 'ok', 'finishing it again is allowed');
select is((select ended_at = (select at from t055.first_end) from events where id = t055.u(401)), true, 'and keeps the first answer');
select is(t055.as_user(t055.u(15), format($$select public.finish_event(%L, %L)$$, t055.u(400), t055.u(401))), 'ok', 'a second member of the organisation finishes it again...');
select is((select ended_by from events where id = t055.u(401)), t055.u(14), '...and the first answer stands: ended_by is still the first member');
select is(t055.as_user(t055.u(12), format($$select public.finish_event(%L, %L)$$, t055.u(200), t055.u(201))), 'ok', 'finishing an event...');
select is(t055.as_user(t055.u(12), format($$update events set status = 'concluded' where id = %L$$, t055.u(201))), 'ok', '...then concluding it');
select is((select ended_via || '|' || (ended_by = t055.u(12))::text from events where id = t055.u(201)), 'organiser|true', 'the concluded stamp does not overwrite an earlier end: it is still via organiser');
select is(t055.as_user(t055.u(11), format($$select public.finish_event(%L, %L)$$, t055.u(400), t055.u(401))), '42501|||finish_event: event not found',
  'another organisation''s member naming the right pair: 42501 event not found');
select is(t055.as_user(t055.u(11), format($$select public.finish_event(%L, %L)$$, t055.u(100), t055.u(401))), '42501|||finish_event: event not found',
  'a member of C naming C with E''s event: the same refusal (the event is not C''s)');
select is(t055.as_user(t055.u(11), format($$select public.finish_event(%L, %L)$$, t055.u(100), gen_random_uuid())), '42501|||finish_event: event not found', 'an unknown event: the same refusal');
select is(t055.as_user(t055.u(11), format($$select public.finish_event(%L, %L)$$, gen_random_uuid(), t055.u(101))), '42501|||finish_event: event not found', 'an unknown organisation: the same refusal');
select is(t055.as_user(t055.u(11), 'select public.finish_event(null, null)'), '42501|||finish_event: event not found', 'nulls: the same refusal');
select ok(t055.as_anon(format($$select public.finish_event(%L, %L)$$, t055.u(400), t055.u(401))) like '42501%', 'anon cannot run it');

-- ============ admin_event_release ============
select is(t055.as_admin('nonadmin', format($$select public.admin_event_release(%L, 'why')$$, t055.u(102))), '42501|admin_required', 'release: a non-admin is refused');
select is(t055.as_admin('aal1', format($$select public.admin_event_release(%L, 'why')$$, t055.u(102))), '42501|admin_mfa_required', 'an admin without the second factor is refused');
select is(t055.as_admin('nonadmin', 'select public.admin_event_release(null, null)'), '42501|admin_required', 'the gate comes before the arguments');
select is(t055.as_admin('admin', 'select public.admin_event_release(null, null)'), '22023|reason_required', 'a blank reason is refused');
select is(t055.as_admin('admin', format($$select public.admin_event_release(%L, repeat('r', 501))$$, t055.u(105))), '22023|reason_too_long', 'a 501 character reason is refused');
select is(t055.as_admin('admin', $$select public.admin_event_release(gen_random_uuid(), 'why')$$), '22023|event_not_found', 'an unknown event is refused');
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t055.base) and actor_id = t055.u(1)), 0, 'none of those wrote an audit row');
-- C has an open event (105 was concluded above, so open it again for the release case: a fresh event)
update events set status = 'draft' where id = t055.u(105);
insert into events (id, org_id, format, name) values (t055.u(110), t055.u(100), 'cup_taster', 'stuck');
select is(t055.as_user(t055.u(11), t055.ev(111, 100)), '42501|entitlement_cap_reached|events_open|entitlement_cap_reached', 'C is blocked by its stuck event');
select is(t055.as_admin('admin', format($$select public.admin_event_release(%L, '  organiser lost their login  ')$$, t055.u(110))), 'ok', 'the admin releases it');
select is((select (ended_via || '|' || (ended_by = t055.u(1))::text) from events where id = t055.u(110)), 'admin_release|true', 'recorded: via admin_release, by the admin');
select is(
  (select action || '|' || target_org_id || '|' || (select string_agg(k, ',' order by k) from jsonb_object_keys(detail) k) || '|' || (detail ->> 'from') || '>' || (detail ->> 'to') || '|' || (detail ->> 'reason')
     from app.admin_audit_log where id > (select mid from t055.base) and actor_id = t055.u(1) order by id desc limit 1),
  'event.release|' || t055.u(100) || '|event_id,from,reason,to|open>released|organiser lost their login', 'one audit row: event.release, pinned keys, the trimmed reason');
select is(t055.as_user(t055.u(11), t055.ev(111, 100)), 'ok', 'and C can create again');
select is(t055.as_admin('admin', format($$select public.admin_event_release(%L, 'again')$$, t055.u(110))), 'ok', 'releasing an ended event is a no-op');
select is((select count(*)::int from app.admin_audit_log where id > (select mid from t055.base) and actor_id = t055.u(1)), 1, 'which logged nothing');

-- ============ the preview and the flip ============
-- state now: C has its new event 111 open; A has three open (annual); P has two open (per_event grant); E has none
update app.entitlement_keys set enforced = false where key = 'events_open';
create function t055.admin() returns void language sql as $$ select t055.claims(t055.u(1), 'aal2', 10) $$;
select t055.admin();
select is(
  (select string_agg(e ->> 'name' || ':' || (e -> 'detail' ->> 'open_events') || ':' || (e ->> 'tier'), ',' order by e ->> 'name')
     from jsonb_array_elements(public.admin_gating_preview('events_open') -> 'organisations') e where e ->> 'name' like 'T055%'),
  'T055 C:1:community', 'preview: only C (Community, one open event) could not start another; E (none open), A and P (not limited) are not listed');
select is((public.admin_gating_preview('events_open') ->> 'would_lose')::int,
  (select count(*)::int from orgs o where app.effective_tier(o.id) = 'community'
      and (select count(*) from events x where x.org_id = o.id and x.ended_at is null) >= 1),
  'and would_lose equals an independent count');
select is(t055.as_admin('admin', $$select public.admin_set_key_enforced('events_open', true, 0)$$), '22023|confirm_mismatch', 'enforce: the wrong count is refused');
select t055.admin();
select is(t055.as_admin('admin', format($$select public.admin_set_key_enforced('events_open', true, %s)$$, (public.admin_gating_preview('events_open') ->> 'would_lose')::int + 1)), '22023|confirm_mismatch', 'and a count one too high');
select t055.admin();
select public.admin_set_key_enforced('events_open', true, (public.admin_gating_preview('events_open') ->> 'would_lose')::int);
select is((select enforced from app.entitlement_keys where key = 'events_open'), true, 'the right count flips it');
select is(app.entitlement_limit(t055.u(100), 'events_open'), 1, 'the limit a Community organisation reads is 1');
select is(app.entitlement_limit(t055.u(200), 'events_open'), null, 'and an annual one is unlimited');
select is(t055.as_user(t055.u(11), 'select public.my_entitlements(' || quote_literal(t055.u(100)) || ') -> ''keys'' -> ''events_open'''), 'ok', 'a member can read it through my_entitlements');
select t055.admin();
select public.admin_set_key_enforced('events_open', false, null);
select is(t055.as_user(t055.u(11), t055.ev(112, 100)), 'ok', 'relaxed: the rule is off again at once');

-- a 500 character reason is accepted (the limit is exact)
insert into events (id, org_id, format, name) values (t055.u(113), t055.u(100), 'cup_taster', 'long reason');
select is(t055.as_admin('admin', format($$select public.admin_event_release(%L, repeat('r', 500))$$, t055.u(113))), 'ok', 'release: exactly 500 characters of reason is accepted');

-- ============ BTC: created on any tier, checked at the first go-live (owner decision 2026-10-23, option A) ============
create function t055.golive(ev int, org int, active boolean default true) returns text language sql as $$
  select format($q$insert into live_sessions (org_id, event_id, format, active) values (%L, %L, 'btc', %s)$q$, t055.u(org), t055.u(ev), active::text) $$;
grant execute on all functions in schema t055 to anon, authenticated, service_role;
do $$ begin perform t055.as_user(t055.u(11), t055.ev(150, 100, 'btc') || '; ' || t055.ev(151, 100, 'btc')); end $$;
do $$ begin perform t055.as_user(t055.u(12), t055.ev(250, 200, 'btc')); end $$;
select is((select count(*)::int from events where id in (t055.u(150), t055.u(151), t055.u(250))), 3, 'dark: a Community and an annual organisation create BTC events');
select is(t055.as_user(t055.u(11), t055.golive(150, 100)), 'ok', 'dark: a Community organisation goes live with a BTC event as before');
delete from live_sessions where event_id = t055.u(150);
update app.entitlement_keys set enforced = true where key = 'btc_format';
select is(t055.as_user(t055.u(11), t055.ev(152, 100, 'btc')), 'ok', 'enforced: a Community organisation can still CREATE a BTC event');
select is(t055.as_user(t055.u(11), t055.golive(150, 100)), '42501|entitlement_required|btc_format|entitlement_required',
  'but cannot go live without a grant: 42501, hint entitlement_required, the key in the detail');
select is(t055.as_user(t055.u(11), t055.golive(150, 100, false)), 'ok', 'an inactive session row is not going live');
select is(t055.as_user(t055.u(11), format($$update live_sessions set active = true where event_id = %L$$, t055.u(150))), '42501|entitlement_required|btc_format|entitlement_required',
  'and activating it later is refused too');
select is(t055.as_user(t055.u(11), format($$insert into live_sessions (org_id, event_id, format, active) values (%L, %L, 'cup_taster', true)$$, t055.u(100), t055.u(111))), 'ok',
  'a Cup Taster go-live is not touched by btc_format');
delete from live_sessions where event_id in (t055.u(150), t055.u(111));
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (t055.u(100), t055.u(150), 'per_event', now() - interval '1 day', now() + interval '4 days', 'manual');
select is(t055.as_user(t055.u(11), t055.golive(150, 100)), 'ok', 'with an event-scoped per_event grant the Community organisation goes live with THAT event');
select is(t055.as_user(t055.u(11), t055.golive(151, 100)), '42501|entitlement_required|btc_format|entitlement_required', 'a grant on a different event does not unlock this one');
select is((select entitlements_snapshot ->> 'tier' from events where id = t055.u(150)), 'per_event', 'and the go-live stamped the tier the event resolved to');
select is(t055.as_user(t055.u(12), t055.golive(250, 200)), 'ok', 'an annual organisation is unaffected');
select is(t055.as_user(t055.u(12), t055.golive(150, 100)), '42501|||new row violates row-level security policy for table "live_sessions"',
  'a NON-member naming the Community organisation gets the standard refusal (no oracle on its grants)');
select is(t055.as_user(t055.u(11), t055.golive(250, 200)), '42501|||new row violates row-level security policy for table "live_sessions"', 'and a Community member naming the annual organisation too');
update entitlement_grants set revoked_at = now() - interval '1 hour' where event_id = t055.u(150);
select is(t055.as_user(t055.u(11), format($$update live_sessions set active = false where event_id = %L$$, t055.u(150)) || '; ' || format($$update live_sessions set active = true where event_id = %L$$, t055.u(150))), 'ok',
  'after the grant is revoked the event that already went live can be restarted (its snapshot holds; the window lock itself is a later step)');
update app.entitlement_keys set enforced = false where key = 'btc_format';

select * from finish();
rollback;
