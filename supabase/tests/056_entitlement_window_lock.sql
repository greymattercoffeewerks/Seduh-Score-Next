-- T-GATE.B5: the Per-event window lock (spec: Handoffs and Specs/GATING-SPEC.md 6b "The Per-event window", D-G15, 6d/6e, 4).
-- Proves, as the REAL roles through row-level security:
--   * DARK: with event_window_lock unenforced an event whose window ended behaves exactly as before (every table readable and
--     writable by its organisation);
--   * enforced, a Community event whose Per-event window has ended is closed: every event-scoped table reads empty and
--     refuses writes for the organisation's own member, the live session stops being served to anon (the audience) and to the
--     member, and public_event_summary no longer offers it; the events row itself, the people list and the archive stay;
--   * the hazard the spec names: a live event still running at window end loses its displays until an admin extends it;
--   * what is NOT locked: an event with a current window (even beside a locked one in the same organisation, so a grant on a
--     DIFFERENT event never unlocks this one), a Community event with no grant, an event whose only grant was REVOKED, an
--     event whose window has not started, an Annual organisation and an organisation-level per_event organisation (each with
--     an ended event grant), registration_page (window_bound false);
--   * an admin extension (a new linked row starting at the old end) re-opens the event at once; a revoke of the extension
--     closes it again;
--   * the preview lists the organisations with a locked event, the flip needs its count, my_entitlements carries the window
--     for the UI, and a stranger learns nothing (standard refusals).
begin;
select plan(75);

create schema t056;
grant usage on schema t056 to anon, authenticated, service_role;

create function t056.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000560' || lpad(n::text, 4, '0'))::uuid
$$;

create function t056.claims(uid uuid, aal text, totp_age int default null) returns void language plpgsql as $$
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

-- rows a signed-in person (or anon, uid null) sees in a table; 0 if refused
create function t056.cnt(uid uuid, tbl text, filter text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', case when uid is null then 'anon' else 'authenticated' end, true);
  perform t056.claims(uid, 'aal1');
  begin
    execute format('select count(*) from public.%I where %s', tbl, filter) into n;
  exception when others then n := -1;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- rows a signed-in person's no-op UPDATE changes (RLS filters; an error is -1)
create function t056.upd(uid uuid, tbl text, col text, filter text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform t056.claims(uid, 'aal1');
  begin
    execute format('update public.%I set %I = %I where %s', tbl, col, col, filter);
    get diagnostics n = row_count;
  exception when others then n := -1;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

-- "SQLSTATE|hint|message" of a statement as a signed-in person, or 'ok'
create function t056.as_user(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; m text;
begin
  perform set_config('role', 'authenticated', true);
  perform t056.claims(uid, 'aal1');
  begin
    execute stmt;
    res := 'ok';
  exception when others then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    res := sqlstate || '|' || coalesce(h, '') || '|' || m;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return res;
end $$;

create function t056.as_admin(stmt text) returns text language plpgsql as $$
declare res text; h text;
begin
  perform set_config('role', 'authenticated', true);
  perform t056.claims(t056.u(1), 'aal2', 10);
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
grant execute on all functions in schema t056 to anon, authenticated, service_role;

-- ============ fixtures (as the owner) ============
insert into auth.users (id, email) values
  (t056.u(1), 't056-admin@test.seduh-next'),
  (t056.u(11), 't056-c@test.seduh-next'), (t056.u(12), 't056-a@test.seduh-next'),
  (t056.u(13), 't056-p@test.seduh-next'), (t056.u(14), 't056-x@test.seduh-next');
insert into app.platform_admins (user_id, note) values (t056.u(1), 't056 admin');
insert into auth.sessions (id, user_id, aal) select id, id, 'aal2' from auth.users where id = t056.u(1);
insert into orgs (id, name, slug) values
  (t056.u(100), 'T056 C', 't056-c'), (t056.u(200), 'T056 A', 't056-a'), (t056.u(300), 'T056 P', 't056-p'), (t056.u(400), 'T056 X', 't056-x');
insert into org_members (org_id, user_id, role) values
  (t056.u(100), t056.u(11), 'owner'), (t056.u(200), t056.u(12), 'owner'), (t056.u(300), t056.u(13), 'owner'), (t056.u(400), t056.u(14), 'owner');
-- A: annual (organisation level); P: per_event (organisation level)
insert into entitlement_grants (org_id, tier, source) values (t056.u(200), 'annual', 'manual'), (t056.u(300), 'per_event', 'manual');
create table t056.base as select coalesce(max(id), 0) as mid from app.admin_audit_log;

-- one event with a full tree of rows; base = the id range of the event
create function t056.tree(org int, ev int, b int) returns void language plpgsql as $$
begin
  insert into events (id, org_id, format, name, event_date) values (t056.u(ev), t056.u(org), 'cup_taster', 'ev ' || ev, date '2026-10-10');
  insert into event_entries (id, event_id, display_name) values (t056.u(b + 1), t056.u(ev), 'cupper');
  insert into ct_stages (id, event_id, kind, ordinal, set_count, duration_secs) values (t056.u(b + 2), t056.u(ev), 'prelims', 1, 1, 480);
  insert into ct_sets (id, stage_id, position) values (t056.u(b + 3), t056.u(b + 2), 1);
  insert into ct_stage_entries (id, stage_id, entry_id) values (t056.u(b + 4), t056.u(b + 2), t056.u(b + 1));
  insert into ct_heats (id, stage_id, heat_number, duration_secs) values (t056.u(b + 5), t056.u(b + 2), 1, 480);
  insert into ct_heat_entries (id, heat_id, entry_id, station) values (t056.u(b + 6), t056.u(b + 5), t056.u(b + 1), 'Table');
  insert into ct_results (id, heat_entry_id, set_id, correct) values (t056.u(b + 7), t056.u(b + 6), t056.u(b + 3), true);
  insert into btc_teams (id, event_id, name) values (t056.u(b + 8), t056.u(ev), 'T1 ' || ev), (t056.u(b + 9), t056.u(ev), 'T2 ' || ev);
  insert into btc_judges (id, event_id, name) values (t056.u(b + 10), t056.u(ev), 'J ' || ev);
  insert into btc_matches (id, event_id, round, team1_id, team2_id) values (t056.u(b + 11), t056.u(ev), 'preliminary', t056.u(b + 8), t056.u(b + 9));
  insert into btc_match_judges (match_id, judge_id) values (t056.u(b + 11), t056.u(b + 10));
  insert into btc_cup_votes (id, match_id, cup_number, team1_tokens) values (t056.u(b + 12), t056.u(b + 11), 1, 1);
  insert into btc_match_bonuses (match_id) values (t056.u(b + 11));
  insert into btc_bracket_slots (id, event_id, round, slot_label) values (t056.u(b + 13), t056.u(ev), 'final', 'Final ' || ev);
  insert into live_sessions (id, org_id, event_id, format, active) values (t056.u(b + 14), t056.u(org), t056.u(ev), 'cup_taster', ev in (101, 201));
end $$;

-- C: E101 ended window (will be locked, a live session running at the end), E102 current window, E103 no grant,
--    E104 only a REVOKED ended window, E105 ended window beside a current one is E101/E102 already; E106 future window
select t056.tree(100, 101, 1000);
select t056.tree(100, 102, 2000);
select t056.tree(100, 103, 3000);
select t056.tree(100, 104, 4000);
select t056.tree(100, 106, 6000);
select t056.tree(200, 201, 7000);   -- A (annual): ended event grant
select t056.tree(300, 301, 8000);   -- P (org-level per_event): ended event grant
select t056.tree(400, 401, 9000);   -- X: a stranger's event, locked too
insert into entitlement_grants (id, org_id, event_id, tier, valid_from, valid_until, source) values
  (t056.u(901), t056.u(100), t056.u(101), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual'),
  (t056.u(902), t056.u(100), t056.u(102), 'per_event', now() - interval '1 day', now() + interval '4 days', 'manual'),
  (t056.u(904), t056.u(100), t056.u(104), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual'),
  (t056.u(906), t056.u(100), t056.u(106), 'per_event', now() + interval '2 days', now() + interval '7 days', 'manual'),
  (t056.u(907), t056.u(200), t056.u(201), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual'),
  (t056.u(908), t056.u(300), t056.u(301), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual'),
  (t056.u(909), t056.u(400), t056.u(401), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual');
update entitlement_grants set revoked_at = now() - interval '4 days' where id = t056.u(904);

-- the tables: the row id of each (base + n) for the event tree, as a filter
create table t056.spec (tbl text primary key, setcol text not null, flt text not null);   -- flt: '%' = the event's base
insert into t056.spec values
  ('event_entries', 'display_name', 'id = t056.u(% + 1)'),
  ('ct_stages', 'ordinal', 'id = t056.u(% + 2)'),
  ('ct_sets', 'position', 'id = t056.u(% + 3)'),
  ('ct_stage_entries', 'id', 'id = t056.u(% + 4)'),
  ('ct_heats', 'duration_secs', 'id = t056.u(% + 5)'),
  ('ct_heat_entries', 'station', 'id = t056.u(% + 6)'),
  ('ct_results', 'correct', 'id = t056.u(% + 7)'),
  ('btc_teams', 'name', 'id = t056.u(% + 8)'),
  ('btc_judges', 'name', 'id = t056.u(% + 10)'),
  ('btc_matches', 'round', 'id = t056.u(% + 11)'),
  ('btc_match_judges', 'judge_id', 'match_id = t056.u(% + 11)'),
  ('btc_cup_votes', 'team1_tokens', 'id = t056.u(% + 12)'),
  ('btc_match_bonuses', 'match_id', 'match_id = t056.u(% + 11)'),
  ('btc_bracket_slots', 'slot_label', 'id = t056.u(% + 13)'),
  ('live_sessions', 'format', 'id = t056.u(% + 14)');
grant select on t056.spec to anon, authenticated;
create function t056.f(tbl text, b int) returns text language sql as $$
  select replace(flt, '%', b::text) from t056.spec where t056.spec.tbl = f.tbl $$;
grant execute on all functions in schema t056 to anon, authenticated, service_role;
create function t056.sum_cnt(uid uuid, b int) returns text language sql as $$
  select string_agg(s.tbl || '=' || t056.cnt(uid, s.tbl, t056.f(s.tbl, b)), ',' order by s.tbl) from t056.spec s $$;
create function t056.sum_upd(uid uuid, b int) returns text language sql as $$
  select string_agg(s.tbl || '=' || t056.upd(uid, s.tbl, s.setcol, t056.f(s.tbl, b)), ',' order by s.tbl) from t056.spec s $$;
create function t056.expect(v text) returns text language sql as $$
  select string_agg(s.tbl || '=' || v, ',' order by s.tbl) from t056.spec s $$;
grant execute on all functions in schema t056 to anon, authenticated, service_role;

-- ============ catalogue ============
select is((select enforced from app.entitlement_keys where key = 'event_window_lock'), false, 'event_window_lock is seeded unenforced');
select is(
  (select string_agg(c.relname || '.' || p.polname, ', ' order by c.relname, p.polname)
     from pg_policy p join pg_class c on c.oid = p.polrelid
    where not p.polpermissive and p.polname like '%\_window\_lock%'),
  'btc_bracket_slots.btc_bracket_slots_window_lock, btc_cup_votes.btc_cup_votes_window_lock, btc_judges.btc_judges_window_lock, btc_match_bonuses.btc_match_bonuses_window_lock, btc_match_judges.btc_match_judges_window_lock, btc_matches.btc_matches_window_lock, btc_seeding_tiebreaks.btc_seeding_tiebreaks_window_lock, btc_teams.btc_teams_window_lock, ct_heat_entries.ct_heat_entries_window_lock, ct_heats.ct_heats_window_lock, ct_results.ct_results_window_lock, ct_sets.ct_sets_window_lock, ct_stage_entries.ct_stage_entries_window_lock, ct_stages.ct_stages_window_lock, event_entries.event_entries_window_lock, live_sessions.live_sessions_window_lock, live_sessions.live_sessions_window_lock_anon, score_change_log.score_change_log_window_lock',
  'there is a RESTRICTIVE window-lock policy on every event-scoped table (and only those)');
select is(
  (select coalesce(string_agg(c.relname, ', '), 'none') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'event_id' and not a.attisdropped)
      and c.relname not in ('events', 'public_results', 'entitlement_grants', 'score_change_counts')
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid and not p.polpermissive and p.polname like '%\_window\_lock%')),
  'none', 'no other table with an event_id column is left unlocked (the events row, the archive, the grants and the counters are the deliberate exceptions)');
select is(
  (select coalesce(string_agg(p.proname, ', '), 'none') from pg_proc p
    where p.pronamespace = 'app'::regnamespace and p.proname in ('event_window_ended', 'event_window_locked', 'window_lock_on', 'event_id_for_stage_internal',
        'event_id_for_heat_internal', 'event_id_for_heat_entry_internal', 'event_id_for_btc_match_internal')
      and not coalesce(p.prosecdef and p.proconfig @> array['search_path=""'], false)),
  'none', 'the lock functions are SECURITY DEFINER with search_path pinned');
select is(
  (select coalesce(string_agg(p.proname || '/' || r, ', ' order by p.proname, r), 'none') from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
    where p.pronamespace = 'app'::regnamespace and p.proname in ('event_window_ended', 'event_window_locked', 'window_lock_on', 'window_locked_events', 'event_id_for_stage_internal')
      and has_function_privilege(r, p.oid, 'execute')),
  'event_id_for_stage_internal/authenticated, window_locked_events/anon, window_locked_events/authenticated',
  'who can run them: the policies need window_locked_events (no argument: it answers only "which events are locked now") as anon and authenticated and the resolvers as authenticated; the rest, and the service role: nobody');

-- ============ DARK ============
select is(app.event_window_ended(t056.u(101)), true, 'the engine says E101''s window has ended');
select is(app.event_window_locked(t056.u(101)), false, 'but the lock is not on: not locked');
select is(t056.sum_cnt(t056.u(11), 1000), t056.expect('1'), 'dark: an ended Community event reads in full for its organiser, table by table');
select is(t056.sum_upd(t056.u(11), 1000), t056.expect('1'), 'and writes in full');
select is(t056.cnt(null, 'live_sessions', format('id = %L', t056.u(1014))), 1, 'and its live session is served to the audience');
select is((select count(*)::int from public.public_event_summary(t056.u(100)) r where r.id = t056.u(101)), 1, 'and public_event_summary offers it as the live event');

-- ============ ENFORCED ============
update app.entitlement_keys set enforced = true where key = 'event_window_lock';
select is(app.event_window_locked(t056.u(101)), true, 'enforced: E101 (ended window, Community) is locked');
select is(t056.sum_cnt(t056.u(11), 1000), t056.expect('0'), 'its organiser reads NOTHING from any workspace table or the live session');
select is(t056.sum_upd(t056.u(11), 1000), t056.expect('0'), 'and updates nothing');
select is(t056.cnt(null, 'live_sessions', format('id = %L', t056.u(1014))), 0, 'the audience (anon) is no longer served the running live session: the hazard the spec names');
select is(t056.cnt(t056.u(11), 'events', format('id = %L', t056.u(101))), 1, 'the event row itself is still visible, so the organiser sees what happened');
select is(t056.as_user(t056.u(11), format($$insert into event_entries (event_id, display_name) values (%L, 'late cupper')$$, t056.u(101))), '42501||new row violates row-level security policy "event_entries_window_lock" for table "event_entries"',
  'registering a competitor is refused (42501, row-level security)');
select is(t056.as_user(t056.u(11), format($$insert into ct_stages (event_id, kind, ordinal, set_count, duration_secs) values (%L, 'finals', 2, 1, 480)$$, t056.u(101))), '42501||new row violates row-level security policy "ct_stages_window_lock" for table "ct_stages"',
  'a new stage is refused');
select is(t056.as_user(t056.u(11), format($$insert into btc_teams (event_id, name) values (%L, 'late team')$$, t056.u(101))), '42501||new row violates row-level security policy "btc_teams_window_lock" for table "btc_teams"', 'a BTC team is refused');
select is(t056.as_user(t056.u(11), format($$insert into live_sessions (org_id, event_id, format, active) values (%L, %L, 'cup_taster', true)$$, t056.u(100), t056.u(101))), '42501||new row violates row-level security policy "live_sessions_window_lock" for table "live_sessions"',
  'and so is going live again');
select isnt(t056.as_user(t056.u(11), format($$select public.start_heat(gen_random_uuid(), %L, %L, now())$$, t056.u(100), t056.u(1005))), 'ok', 'a workspace RPC (start_heat) is refused on the locked event: the RPCs are invoker functions, so the same policies bind them');
select isnt(t056.as_user(t056.u(11), format($$select public.record_heat_time(gen_random_uuid(), %L, %L, 'timing', 10, 10, false, 'tap', now(), 'reject')$$, t056.u(100), t056.u(1006))), 'ok',
  'scoring (record_heat_time) too');
select is((select status from ct_heats where id = t056.u(1005)), (select status from ct_heats where id = t056.u(2005)), 'and the locked event''s heat did not change state');
select is(t056.as_user(t056.u(11), format($$delete from event_entries where id = %L$$, t056.u(1001))), 'ok', 'a delete is a silent zero-row (row-level security filters it)...');
select is((select count(*)::int from event_entries where id = t056.u(1001)), 1, '...and the row is still there');
select is(t056.cnt(t056.u(11), 'score_change_log', format('event_id = %L', t056.u(101))), 0, 'the change log of the locked event is closed to the organiser');
select is(t056.cnt(t056.u(11), 'btc_standings', format('event_id = %L', t056.u(101))), 0, 'and so is a view over the tables (btc_standings, security_invoker)');

-- not locked
select is(t056.sum_cnt(t056.u(11), 2000), t056.expect('1'), 'E102 (a CURRENT window in the same organisation) reads in full: a grant on one event does not unlock another, and does not lock this one');
select is(t056.sum_upd(t056.u(11), 2000), t056.expect('1'), 'and writes in full');
select is(t056.cnt(null, 'live_sessions', format('id = %L', t056.u(7014))), 1, 'an Annual organisation''s live session is served to the audience (not locked)');
select is(t056.sum_cnt(t056.u(11), 3000), t056.expect('1'), 'E103 (a Community event with no grant at all) is untouched');
select is(t056.sum_cnt(t056.u(11), 4000), t056.expect('1'), 'E104 (its only grant was REVOKED) is a plain Community event again: not locked');
select is(t056.sum_cnt(t056.u(11), 6000), t056.expect('1'), 'E106 (a window that has not started) is not locked');
select is(t056.sum_cnt(t056.u(12), 7000), t056.expect('1'), 'an Annual organisation is never locked, whatever event grant it holds');
select is(t056.sum_cnt(t056.u(13), 8000), t056.expect('1'), 'nor an organisation with an organisation-level per_event plan');
select is(t056.sum_cnt(t056.u(14), 9000), t056.expect('0'), 'a different organisation''s ended Community event is locked for that organisation too (the rule is per event, not per tester)');
select is(t056.sum_cnt(t056.u(11), 9000), t056.expect('0'), 'and a stranger reads nothing of it either way');
select is(t056.cnt(t056.u(12), 'event_entries', format('id = %L', t056.u(1001))), 0, 'a member of another organisation sees nothing of the locked event (as before)');

-- the audience door
select is((select count(*)::int from public.public_event_summary(t056.u(100)) r where r.id = t056.u(101)), 0, 'public_event_summary never offers the locked E101 as the live event');
select is((select count(*)::int from public.public_event_summary(t056.u(100))), 1, 'but still offers an event of the organisation (an unlocked one)');

-- deleting a locked event must still work (the BTC delete cleanup is a definer function, so the locked policies do not blind it)
select t056.tree(400, 402, 9500);
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (t056.u(400), t056.u(402), 'per_event', now() - interval '8 days', now() - interval '3 days', 'manual');
update btc_match_bonuses set fastest_team_id = t056.u(9508) where match_id = t056.u(9511);
select is(app.event_window_locked(t056.u(402)), true, 'a second locked BTC event of X, with a fastest-team bonus');
select is(t056.as_user(t056.u(14), format($$delete from events where id = %L$$, t056.u(402))), 'ok', 'its organiser can still DELETE it (the cleanup trigger runs with definer rights)');
select is((select count(*)::int from events where id = t056.u(402)), 0, 'the event is gone');
select is((select count(*)::int from btc_matches where event_id = t056.u(402)), 0, 'with its matches');
select is(t056.as_user(t056.u(11), format($$delete from events where id = %L$$, t056.u(401))), 'ok', 'a member of another organisation deleting X''s locked event changes nothing...');
select is((select count(*)::int from events where id = t056.u(401)), 1, '...it is still there');

-- ============ the preview, the snapshot, and the flip ============
select is(app.window_lock_on(), true, 'sanity: the lock is on');
update app.entitlement_keys set enforced = false where key = 'event_window_lock';
select t056.claims(t056.u(1), 'aal2', 10);
select is(
  (select string_agg(e ->> 'name' || ':' || (e -> 'detail' ->> 'locked_events'), ',' order by e ->> 'name')
     from jsonb_array_elements(public.admin_gating_preview('event_window_lock') -> 'organisations') e where e ->> 'name' like 'T056%'),
  'T056 C:1,T056 X:1', 'preview: the organisations with a locked event now are C (E101) and X (E401); A, P, and C''s other events are not counted');
select is(t056.as_admin($$select public.admin_set_key_enforced('event_window_lock', true, 0)$$), '22023|confirm_mismatch', 'the flip needs the preview''s count');
select t056.claims(t056.u(1), 'aal2', 10);
select public.admin_set_key_enforced('event_window_lock', true, (public.admin_gating_preview('event_window_lock') ->> 'would_lose')::int);
select is(app.window_lock_on(), true, 'and the right count flips it');

select is(t056.as_user(t056.u(11), format($$select (public.my_entitlements(%L, %L) -> 'window' ->> 'locked')$$, t056.u(100), t056.u(101))), 'ok', 'a member can ask for the window of an event');
create function t056.win(org int, ev int) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform t056.claims(t056.u(11), 'aal1');
  select public.my_entitlements(t056.u(org), t056.u(ev)) -> 'window' into r;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;
grant execute on function t056.win(int, int) to authenticated;
select is((t056.win(100, 101) ->> 'locked')::boolean, true, 'my_entitlements: the locked event says so');
select ok((t056.win(100, 101) ->> 'ends_at')::timestamptz < now(), 'and when its window ended');
select is((t056.win(100, 102) ->> 'locked')::boolean, false, 'the current-window event is not locked');
select ok((t056.win(100, 102) ->> 'ends_at')::timestamptz > now(), 'and carries when it ends, for the warning');
select is(t056.win(100, 103), 'null'::jsonb, 'an event with no window says null');
select is(t056.win(100, 104), 'null'::jsonb, 'an event whose only grant was revoked says null too');

-- ============ an admin extension re-opens it ============
select t056.claims(t056.u(1), 'aal2', 10);
select public.admin_grant_extend(t056.u(901), now() + interval '2 days', 'venue postponed the final');
select is(app.event_window_locked(t056.u(101)), false, 'an extension (a new row starting where the old one ended, current now) unlocks E101 at once');
select is(t056.sum_cnt(t056.u(11), 1000), t056.expect('1'), 'every table reads again');
select is(t056.sum_upd(t056.u(11), 1000), t056.expect('1'), 'and writes again');
select is(t056.cnt(null, 'live_sessions', format('id = %L', t056.u(1014))), 1, 'and the audience is served the live session again');
select is(app.event_window_locked(t056.u(401)), true, 'the other organisation''s event stays locked (an extension is per grant)');
-- the extension is revoked: closed again (a window that ended is still an ended window)
select t056.claims(t056.u(1), 'aal2', 10);
select public.admin_grant_revoke((select id from entitlement_grants where extends_grant_id = t056.u(901) and revoked_at is null), 'extended by mistake');
select is(app.event_window_locked(t056.u(101)), true, 'revoking the extension closes it again: the ended original window still counts');
select is(t056.sum_cnt(t056.u(11), 1000), t056.expect('0'), 'and the tables are empty again');
-- an extension that has itself ended also locks it
select t056.claims(t056.u(1), 'aal2', 10);
select public.admin_grant_extend(t056.u(901), now() + interval '1 hour', 'one more hour');
select is(app.event_window_locked(t056.u(101), now()), false, 'a new extension re-opens it...');
select is(app.event_window_locked(t056.u(101), now() + interval '2 hours'), true, '...and it locks again when THAT ends');

-- ============ other boundaries ============
select is(app.event_window_locked(t056.u(102), now() + interval '6 days'), true, 'a current window locks when it ends (checked with an explicit clock)');
select is(app.event_window_locked(t056.u(102), now() + interval '3 days'), false, 'but not before');
select is(app.event_window_locked(t056.u(102), (select valid_until from entitlement_grants where id = t056.u(902))), true, 'the end instant itself is locked (valid_until is exclusive)');
select is(app.event_window_locked(t056.u(102), (select valid_until - interval '1 second' from entitlement_grants where id = t056.u(902))), false, 'one second before it is not');
select is(app.event_window_locked(gen_random_uuid()), false, 'an unknown event is not locked');
select is(app.event_window_locked(null), false, 'a null event is not locked');
-- registration_page keeps resolving after the window (window_bound = false)
update app.entitlement_keys set enforced = true where key = 'registration_page';
select is(app.has_entitlement(t056.u(100), 'registration_page', t056.u(104)), false, 'registration_page: a REVOKED grant never counts, window-bound or not (E104)');
select is(app.has_entitlement(t056.u(100), 'registration_page', t056.u(101), now() + interval '30 days'), true, 'registration_page still resolves for E101 long after its window ended');
update app.entitlement_keys set enforced = false where key = 'registration_page';
-- relaxing the lock is one call and is audited
select t056.claims(t056.u(1), 'aal2', 10);
select public.admin_set_key_enforced('event_window_lock', false, null);
select is(t056.sum_cnt(t056.u(14), 9000), t056.expect('1'), 'relaxed: one call, and X reads its own event again');

select * from finish();
rollback;
