-- Throwdown scoresheet module (spec: Handoffs and Specs/THROWDOWN-SCORESHEET-SPEC.md sections 2 to 4).
-- Proves, as the REAL roles through RLS and the SECURITY DEFINER functions:
--   * setup: the module is in the registry, the preset's lines are COPIED into the settings (a client cannot write them), every
--     bad shape is refused (td_scoresheet_invalid), the table check holds against a direct write, off leaves no trace;
--   * a round's role is derived (D4) and equals the JS rule over the shared fixture;
--   * the winner rule (D7) over the shared fixture (supabase/tests/fixtures/scoresheet-parity.json, embedded below and held equal
--     to the file by a unit test): total, judges, organiser_needed; plus the writers' own paths for each branch;
--   * every refusal of td_save_score_sheet and td_confirm_scored_match, replay idempotency, replacement until decided;
--   * tap votes refused on a scored match; the Final and the 3rd place match are still created when the semi-finals are
--     tap-voted, and when they are scored; walkover works in a scored round;
--   * nobody writes the tables directly, a non-member reads zero rows, anon reads nothing and calls nothing, no total is stored.
begin;
select plan(209);

create schema t091;
grant usage on schema t091 to anon, authenticated;

-- parity-fixture:begin
create table t091.fx as select $fx${
  "note": "Shared by src/core/scoresheet.test.js, src/formats/throwdown/roundRole.test.js and supabase/tests/091_td_scoresheet.sql (embedded there; a unit test fails when the two copies differ). Sheets: slot position -> judge seats 1..3 (array order) -> cups (array order) -> six whole numbers in the latte_art_v1 line order (contrast, surface, harmony, size_position, achieved, appeal).",
  "preset": "latte_art_v1",
  "judgeCount": 3,
  "cups": 2,
  "cases": [
    {
      "name": "highest grand total wins, every judge agrees",
      "sheets": {
        "1": [[[6,3,3,3,6,6],[3,2,2,2,3,3]], [[6,3,3,3,6,6],[3,2,2,2,3,3]], [[6,3,3,3,6,6],[3,2,2,2,3,3]]],
        "2": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]]
      },
      "expect": { "winner": "1", "rule": "total", "totals": [126, 90], "preferring": [3, 0] }
    },
    {
      "name": "the total beats the judge count: two judges prefer slot 2 but slot 1 has more points",
      "sheets": {
        "1": [[[6,3,3,3,6,6],[6,3,3,3,6,6]], [[2,1,1,1,2,3],[2,1,1,1,2,3]], [[2,1,1,1,2,3],[2,1,1,1,2,3]]],
        "2": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]]
      },
      "expect": { "winner": "1", "rule": "total", "totals": [94, 90], "preferring": [1, 2] }
    },
    {
      "name": "one point decides it",
      "sheets": {
        "1": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,4]]],
        "2": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]]
      },
      "expect": { "winner": "1", "rule": "total", "totals": [91, 90], "preferring": [1, 0] }
    },
    {
      "name": "level total: slot 1 is higher with two of three judges",
      "sheets": {
        "1": [[[4,2,2,2,4,4],[4,2,2,2,4,4]], [[4,2,2,2,4,4],[4,2,2,2,4,4]], [[2,1,1,1,2,2],[2,1,1,1,2,2]]],
        "2": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]]
      },
      "expect": { "winner": "1", "rule": "judges", "totals": [90, 90], "preferring": [2, 1] }
    },
    {
      "name": "level total: slot 2 is higher with two of three judges",
      "sheets": {
        "1": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]],
        "2": [[[4,2,2,2,4,4],[4,2,2,2,4,4]], [[4,2,2,2,4,4],[4,2,2,2,4,4]], [[2,1,1,1,2,2],[2,1,1,1,2,2]]]
      },
      "expect": { "winner": "2", "rule": "judges", "totals": [90, 90], "preferring": [1, 2] }
    },
    {
      "name": "level total and one judge scored them equal: the organiser picks",
      "sheets": {
        "1": [[[4,2,2,2,4,4],[4,2,2,2,4,4]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,1,2,1,2,3],[3,1,2,1,2,3]]],
        "2": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]]
      },
      "expect": { "winner": null, "rule": "organiser_needed", "totals": [90, 90], "preferring": [1, 1] }
    },
    {
      "name": "identical sheets: the organiser picks",
      "sheets": {
        "1": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]],
        "2": [[[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]], [[3,2,2,2,3,3],[3,2,2,2,3,3]]]
      },
      "expect": { "winner": null, "rule": "organiser_needed", "totals": [90, 90], "preferring": [0, 0] }
    },
    {
      "name": "all zeros on both sides: the organiser picks",
      "sheets": {
        "1": [[[0,0,0,0,0,0],[0,0,0,0,0,0]], [[0,0,0,0,0,0],[0,0,0,0,0,0]], [[0,0,0,0,0,0],[0,0,0,0,0,0]]],
        "2": [[[0,0,0,0,0,0],[0,0,0,0,0,0]], [[0,0,0,0,0,0],[0,0,0,0,0,0]], [[0,0,0,0,0,0],[0,0,0,0,0,0]]]
      },
      "expect": { "winner": null, "rule": "organiser_needed", "totals": [0, 0], "preferring": [0, 0] }
    },
    {
      "name": "full marks against nothing",
      "sheets": {
        "1": [[[6,3,3,3,6,6],[6,3,3,3,6,6]], [[6,3,3,3,6,6],[6,3,3,3,6,6]], [[6,3,3,3,6,6],[6,3,3,3,6,6]]],
        "2": [[[0,0,0,0,0,0],[0,0,0,0,0,0]], [[0,0,0,0,0,0],[0,0,0,0,0,0]], [[0,0,0,0,0,0],[0,0,0,0,0,0]]]
      },
      "expect": { "winner": "1", "rule": "total", "totals": [162, 0], "preferring": [3, 0] }
    }
  ],
  "roles": [
    { "phase": "third_place", "matches": 1, "role": "third_place" },
    { "phase": "main", "matches": 1, "role": "final" },
    { "phase": "main", "matches": 2, "role": "semi_final" },
    { "phase": "main", "matches": 4, "role": "quarter_final" },
    { "phase": "main", "matches": 3, "role": null },
    { "phase": "main", "matches": 8, "role": null },
    { "phase": "main", "matches": 16, "role": null },
    { "phase": "redemption", "matches": 1, "role": null },
    { "phase": "redemption", "matches": 2, "role": null }
  ]
}$fx$::jsonb as j;
-- parity-fixture:end
grant select on t091.fx to anon, authenticated;

create function t091.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000910' || lpad(n::text, 4, '0'))::uuid
$$;

create function t091.run_as(role_name text, uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; d text; m text;
begin
  perform set_config('role', role_name, true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', role_name, 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
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
create function t091.as_user(uid uuid, stmt text) returns text language sql as $$ select t091.run_as('authenticated', uid, stmt) $$;
create function t091.as_anon(stmt text) returns text language sql as $$ select t091.run_as('anon', null, stmt) $$;
-- a statement run as the test's own (privileged) role: SQLSTATE|hint of the refusal, or ok
create function t091.try(stmt text) returns text language plpgsql as $$
declare h text; begin
  begin execute stmt; return 'ok';
  exception when others then get stacked diagnostics h = pg_exception_hint; return sqlstate || '|' || coalesce(h, ''); end;
end $$;
create function t091.contains(res text, pat text, descr text) returns text language sql as $$
  select ok(res like pat, descr) || case when res like pat then '' else E'\n# got: ' || res end
$$;
create function t091.count_as(uid uuid, tbl text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute format('select count(*) from public.%I', tbl) into n;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return n;
end $$;

insert into auth.users (id, email) values (t091.u(1), 't091-a@test.seduh-next'), (t091.u(2), 't091-b@test.seduh-next');
insert into orgs (id, name, slug) values (t091.u(100), 'T091 A', 't091-a'), (t091.u(200), 'T091 B', 't091-b');
insert into org_members (org_id, user_id, role) values (t091.u(100), t091.u(1), 'owner'), (t091.u(200), t091.u(2), 'owner');
insert into events (id, org_id, format, name) values
  (t091.u(110), t091.u(100), 'throwdown', 'Full flow'),
  (t091.u(120), t091.u(100), 'throwdown', 'Parity and refusals'),
  (t091.u(121), t091.u(100), 'throwdown', 'Rule total'),
  (t091.u(122), t091.u(100), 'throwdown', 'Rule judges'),
  (t091.u(123), t091.u(100), 'throwdown', 'Rule organiser'),
  (t091.u(130), t091.u(100), 'throwdown', 'Module off'),
  (t091.u(140), t091.u(100), 'throwdown', 'Semis scored'),
  (t091.u(150), t091.u(100), 'throwdown', 'Bye semi'),
  (t091.u(210), t091.u(200), 'throwdown', 'Other org');
insert into event_entries (id, event_id, display_name)
select t091.u(e.ev * 10 + n), t091.u(e.ev), 'P' || n
  from (values (110, 8), (120, 2), (121, 2), (122, 2), (123, 2), (130, 2), (140, 4), (150, 3), (210, 2)) e(ev, cnt), generate_series(1, 8) n
 where n <= e.cnt;

create function t091.m(ev int, rnd int, mpos int) returns uuid language sql stable as $$
  select m.id from public.td_rounds r join public.td_matches m on m.round_id = r.id and m.position = mpos
   where r.event_id = t091.u(ev) and r.position = rnd
$$;
create function t091.s(ev int, rnd int, mpos int, spos int) returns uuid language sql stable as $$
  select s.id from public.td_slots s where s.match_id = t091.m(ev, rnd, mpos) and s.position = spos
$$;
create function t091.name(ev int, rnd int, mpos int, spos int) returns text language sql stable as $$
  select e.display_name from public.td_slots s join public.event_entries e on e.id = s.entry_id where s.id = t091.s(ev, rnd, mpos, spos)
$$;
create function t091.winner(ev int, rnd int, mpos int) returns text language sql stable as $$
  select e.display_name from public.td_match_results x
    join public.td_slots s on s.id = x.winner_slot_id join public.event_entries e on e.id = s.entry_id
   where x.match_id = t091.m(ev, rnd, mpos)
$$;
create function t091.rounds(ev int) returns text language sql stable as $$
  select coalesce(string_agg(r.position || ':' || r.phase || ':' || (select count(*) from public.td_matches m where m.round_id = r.id),
                             ' ' order by r.position), 'none')
    from public.td_rounds r where r.event_id = t091.u(ev)
$$;
create function t091.settings(ev int, judges int, modules text) returns text language sql as $$
  select t091.as_user(t091.u(1), format('select public.td_save_settings(%L, %L, %s, true, ''random'', %L)', t091.u(100), t091.u(ev), judges, modules))
$$;
create function t091.start(ev int, nums int[]) returns text language sql as $$
  select t091.as_user(t091.u(1), format('select public.td_start_event(gen_random_uuid(), %L, %L, ''random'', %L, %s, %L)',
    t091.u(100), t091.u(ev), 'seed-' || ev, array_length(nums, 1),
    (select jsonb_agg(jsonb_build_array(t091.u(ev * 10 + nums[i]), case when nums[i + 1] = 0 then null else t091.u(ev * 10 + nums[i + 1]) end))
       from generate_series(1, array_length(nums, 1), 2) i)))
$$;
create function t091.tap(ev int, rnd int, mpos int, spos int, n int) returns text language plpgsql as $$
declare i int; r text;
begin
  for i in 1 .. n loop
    r := t091.as_user(t091.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t091.u(100), t091.m(ev, rnd, mpos), t091.s(ev, rnd, mpos, spos)));
    if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
create function t091.decide_taps(ev int, rnd int, mpos int, spos int) returns text language plpgsql as $$
begin
  perform t091.tap(ev, rnd, mpos, spos, 2);
  perform t091.tap(ev, rnd, mpos, 3 - spos, 1);
  return t091.as_user(t091.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)', t091.u(100), t091.m(ev, rnd, mpos)));
end $$;

-- a paper sheet from [[six numbers per cup], ...] in the latte_art_v1 line order
create function t091.sheet(cups jsonb) returns jsonb language sql immutable as $$
  select jsonb_object_agg(c.i::text, (select jsonb_object_agg(l.key, c.v -> (l.n - 1))
    from (values ('contrast', 1), ('surface', 2), ('harmony', 3), ('size_position', 4), ('achieved', 5), ('appeal', 6)) l(key, n)))
    from jsonb_array_elements(cups) with ordinality c(v, i)
$$;
create function t091.save_raw(ev int, rnd int, mpos int, spos int, seat int, sheet jsonb, op uuid default gen_random_uuid()) returns text language sql as $$
  select t091.as_user(t091.u(1), format('select public.td_save_score_sheet(%L, %L, %L, %L, %L, %L)',
    op, t091.u(100), t091.m(ev, rnd, mpos), t091.s(ev, rnd, mpos, spos), seat, sheet))
$$;
create function t091.save(ev int, rnd int, mpos int, spos int, seat int, cups jsonb) returns text language sql as $$
  select t091.save_raw(ev, rnd, mpos, spos, seat, t091.sheet(cups))
$$;
-- every seat 1..3 gives slot 1 and slot 2 the same cups
create function t091.fill(ev int, rnd int, mpos int, c1 jsonb, c2 jsonb) returns text language plpgsql as $$
declare seat int; r text;
begin
  for seat in 1 .. 3 loop
    r := t091.save(ev, rnd, mpos, 1, seat, c1); if r <> 'ok' then return r; end if;
    r := t091.save(ev, rnd, mpos, 2, seat, c2); if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
-- writes fixture case idx (every slot, every seat) into a two-cup match through the real writer
create function t091.load_case(ev int, rnd int, mpos int, idx int) returns text language plpgsql as $$
declare spos text; seat int; r text; seats jsonb;
begin
  for spos in select jsonb_object_keys(j -> 'cases' -> idx -> 'sheets') from t091.fx loop
    select j -> 'cases' -> idx -> 'sheets' -> spos into seats from t091.fx;
    for seat in 1 .. jsonb_array_length(seats) loop
      r := t091.save(ev, rnd, mpos, spos::int, seat, seats -> (seat - 1));
      if r <> 'ok' then return r; end if;
    end loop;
  end loop;
  return 'ok';
end $$;
create function t091.confirm(ev int, rnd int, mpos int, expected int, pick int, op uuid default gen_random_uuid()) returns text language sql as $$
  select t091.as_user(t091.u(1), format('select public.td_confirm_scored_match(%L, %L, %L, %L, %L)', op, t091.u(100), t091.m(ev, rnd, mpos), expected, pick))
$$;
create function t091.sheet_rows(ev int, rnd int, mpos int) returns int language sql stable as $$
  select count(*)::int from public.td_score_sheets where match_id = t091.m(ev, rnd, mpos)
$$;

create function t091.good() returns jsonb language sql immutable as $$ select '[[3,2,2,2,3,3],[3,2,2,2,3,3]]'::jsonb $$;
create function t091.strong() returns jsonb language sql immutable as $$ select '[[6,3,3,3,6,6],[3,2,2,2,3,3]]'::jsonb $$;

-- ============ registry, entitlement key, setup ============
select is((select kind || '/' || coalesce(min_tier, 'any') || '/' || enforced from app.entitlement_keys where key = 'throwdown_scoresheet'),
  'flag/any/false', 'the throwdown_scoresheet key is a free flag, seeded unenforced');
select is((select string_agg(module || ':' || coalesce(array_to_string(requires, ','), '') || ':' || entitlement_key, ',') from app.td_module_registry()),
  'scoresheet::throwdown_scoresheet,redemption::throwdown_redemption', 'the registry holds the scoresheet and redemption modules, with no dependencies');
select is(t091.settings(110, 3, '{"scoresheet": {"preset": "latte_art_v1", "lines": [{"key": "x", "label": "client wrote this", "max": 99}], "cups": {"final": 2, "third_place": 1}}}'), 'ok',
  'the organiser turns the module on (final 2 cups, 3rd place 1 cup)');
select is((select modules -> 'scoresheet' -> 'lines' = app.td_scoresheet_preset_lines('latte_art_v1') from td_settings where event_id = t091.u(110)), true,
  'the preset''s lines were COPIED into the settings: lines a client sent are ignored');
select is((select modules -> 'scoresheet' -> 'cups' from td_settings where event_id = t091.u(110)), '{"final": 2, "third_place": 1}'::jsonb, 'the cups per role are stored');
select is((select (modules -> 'scoresheet' ->> 'preset') || '/' || jsonb_array_length(modules -> 'scoresheet' -> 'lines') from td_settings where event_id = t091.u(110)),
  'latte_art_v1/6', 'preset latte_art_v1 with its six lines');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "nope", "cups": {"final": 2}}}'), '%td_scoresheet_invalid%', 'an unknown preset is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {}}}'), '%td_scoresheet_invalid%', 'no round named is refused (at least one role)');
select is(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 3}}}'), 'ok', 'three cups is accepted (the upper bound)');
select is(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"semi_final": 1, "quarter_final": 3}}}'), 'ok', 'the semi-final and quarter-final roles are accepted');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 4}}}'), '%td_scoresheet_invalid%', 'four cups is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 0}}}'), '%td_scoresheet_invalid%', 'zero cups is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 1.5}}}'), '%td_scoresheet_invalid%', 'half a cup is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"round_of_16": 1}}}'), '%td_scoresheet_invalid%', 'an unknown round role is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 2.0}}}'), '%td_scoresheet_invalid%', 'a cup count written 2.0 is refused (it would not read back as a whole number)');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": "2"}}}'), '%td_scoresheet_invalid%', 'a cup count that is text is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": true}'), '%td_scoresheet_invalid%', 'switching it on with no preset and no cups is refused');
select t091.contains(t091.settings(120, 3, '{"scoresheet": {"cups": {"final": 2}}}'), '%td_scoresheet_invalid%', 'a missing preset is refused');
select is(t091.try($q$update td_settings set modules = '{"scoresheet": {"preset": "latte_art_v1", "lines": [], "cups": {"final": 2}}}' where event_id = t091.u(110)$q$),
  '23514|', 'the table itself refuses lines that differ from the preset (a direct write cannot get past the check)');
select is(t091.try($q$update td_settings set modules = '{"scoresheet": {"preset": "latte_art_v1", "lines": [], "cups": {"final": 2}, "extra": 1}}' where event_id = t091.u(110)$q$),
  '23514|', '...nor an extra key');
select is(t091.settings(130, 3, '{"scoresheet": false}'), 'ok', 'a module toggled off is accepted');
select is((select modules::text from td_settings where event_id = t091.u(130)), '{}', '...and leaves no trace in the stored setup');

-- ============ a round's role is derived (D4), equal to the JS rule ============
select is(app.td_role_of(r ->> 'phase', (r ->> 'matches')::int), r ->> 'role',
  'role of a ' || (r ->> 'phase') || ' round of ' || (r ->> 'matches') || ' match(es): ' || coalesce(r ->> 'role', 'none'))
  from t091.fx, jsonb_array_elements(j -> 'roles') r;

-- ============ the 8-competitor event: taps to the semi-finals, sheets for the Final and the 3rd place match ============
select is(t091.start(110, array[3,7,1,5,2,8,4,6]), 'ok', 'the draw starts Round 1');
select is((select string_agg(app.td_round_role(m.id), ',') from td_matches m where m.event_id = t091.u(110)), 'quarter_final,quarter_final,quarter_final,quarter_final',
  'Round 1 of 8 is the quarter-finals by its match count');
select t091.contains(t091.save(110, 1, 1, 1, 1, t091.good()), '%td_match_not_scored%', 'a quarter-final the setup does not score takes no sheet');
select is(t091.decide_taps(110, 1, 1, 1), 'ok', 'quarter-final 1 is still decided by taps');
select is(t091.decide_taps(110, 1, 2, 2), 'ok', 'quarter-final 2 by taps');
select is(t091.decide_taps(110, 1, 3, 1), 'ok', 'quarter-final 3 by taps');
select is(t091.decide_taps(110, 1, 4, 1), 'ok', 'quarter-final 4 by taps');
select is(t091.rounds(110), '1:main:4 2:main:2', 'the semi-finals exist once the quarter-finals are decided');
select is(t091.decide_taps(110, 2, 1, 1), 'ok', 'semi-final 1 by taps (the setup does not score semi-finals)');
select is(t091.rounds(110), '1:main:4 2:main:2', 'one semi-final is not enough to advance');
select is(t091.decide_taps(110, 2, 2, 2), 'ok', 'semi-final 2 by taps');
select is(t091.rounds(110), '1:main:4 2:main:2 3:third_place:1 4:main:1',
  'the 3rd place match and the Final are both created when the semi-finals are tap-voted and the final is scored');
select is(app.td_round_role(t091.m(110, 3, 1)) || '/' || app.td_round_role(t091.m(110, 4, 1)), 'third_place/final', 'their roles are derived');
select is(app.td_match_scored(t091.m(110, 4, 1)) and app.td_match_scored(t091.m(110, 3, 1)) and not app.td_match_scored(t091.m(110, 2, 1)), true,
  'the Final and the 3rd place match are scored, the semi-final is not');
select t091.contains(t091.tap(110, 4, 1, 1, 1), '23001|td_match_scored|%', 'a tap on the scored Final is refused (td_match_scored)');
select t091.contains(t091.tap(110, 3, 1, 2, 1), '23001|td_match_scored|%', '...and on the scored 3rd place match');
select is(t091.try(format('insert into td_votes (event_id, match_id, slot_id) values (%L, %L, %L)', t091.u(110), t091.m(110, 4, 1), t091.s(110, 4, 1, 1))),
  '23001|td_match_scored', 'the vote table itself refuses a row on a scored match, whoever writes it');
select is((select count(*)::int from td_votes where match_id in (t091.m(110, 3, 1), t091.m(110, 4, 1))), 0, 'no vote row exists on a scored match');
select t091.contains(t091.as_user(t091.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)', t091.u(100), t091.m(110, 4, 1))),
  '%td_votes_level%', 'the tap confirm cannot decide a scored match (it has no votes)');
-- the 3rd place match: ONE cup
select t091.contains(t091.save(110, 3, 1, 1, 1, t091.good()), '%td_sheet_cups%', 'the 3rd place match has one cup: two cups are refused');
select is(t091.fill(110, 3, 1, '[[4,2,2,2,4,4]]', '[[3,2,2,2,3,3]]'), 'ok', 'three judges score both competitors: one cup each (18 against 15 a judge)');
select is(t091.sheet_rows(110, 3, 1), 3 * 2 * 1 * 6, '3 seats x 2 competitors x 1 cup x 6 lines of points are stored (and nothing else)');
-- the Final: TWO cups; one sheet missing first
select is(t091.save(110, 4, 1, 1, 1, t091.strong()), 'ok', 'a Final sheet of two cups is saved');
select is(t091.save(110, 4, 1, 1, 2, t091.strong()) || t091.save(110, 4, 1, 1, 3, t091.strong()) || t091.save(110, 4, 1, 2, 1, t091.good()) || t091.save(110, 4, 1, 2, 2, t091.good()),
  'okokokok', 'five of six sheets are in');
select t091.contains(t091.confirm(110, 4, 1, 1, null), '%td_sheets_incomplete%', 'confirm is refused until every seat x competitor sheet is in');
select is((select sheets_complete || '/' || sheets_expected from td_score_standings where match_id = t091.m(110, 4, 1) and slot_position = 2), '2/3',
  'the console view says 2 of 3 sheets are complete for the second competitor');
select is(t091.save(110, 4, 1, 2, 3, t091.good()), 'ok', 'the sixth sheet completes it');
select is(t091.confirm(110, 4, 1, 1, null), 'ok', 'the Final is confirmed: slot 1 wins on total');
select is(t091.winner(110, 4, 1), t091.name(110, 4, 1, 1), 'the winner is derived through td_match_results');
select is((select result_kind from td_matches where id = t091.m(110, 4, 1)), 'scores', 'result_kind is scores');
select t091.contains(t091.save(110, 4, 1, 1, 1, t091.good()), '23001|td_match_decided|%', 'a sheet cannot be replaced after the match is decided');
select is(t091.try(format('update td_score_sheets set points = 0 where match_id = %L', t091.m(110, 4, 1))), '23001|td_match_decided',
  '...and the table refuses an update of a decided match too');
select is(t091.confirm(110, 3, 1, 1, null), 'ok', 'the 3rd place match is confirmed on the one-cup sheets');
select is(t091.rounds(110), '1:main:4 2:main:2 3:third_place:1 4:main:1', 'nothing follows the Final: no extra round');

-- ============ the refusals of td_save_score_sheet (event 120: a Final, two cups, three judges) ============
select is(t091.settings(120, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 2}}}'), 'ok', 'event 120: Final scored, two cups');
select is(t091.start(120, array[1,2]), 'ok', 'two competitors: Round 1 is one match, so it is the Final');
select is(app.td_round_role(t091.m(120, 1, 1)), 'final', 'a main round of one match is the final');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, t091.sheet('[[6,3,3,3,6,6],[0,0,0,0,0,0]]') #- '{2,harmony}'), '%td_sheet_incomplete%', 'a blank line is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,harmony}', 'null')), '%td_sheet_incomplete%', 'a null line is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,flavour}', '3')), '%td_sheet_line_unknown%', 'an unknown line is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,contrast}', '2.5')), '%td_sheet_points_invalid%', 'a fraction is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,contrast}', '"5"')), '%td_sheet_points_invalid%', 'a number written as text is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,contrast}', '-1')), '%td_sheet_points_invalid%', 'a negative is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,contrast}', '7')), '%td_sheet_points_invalid%', 'above the line''s maximum (contrast 7 of 6) is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{2,surface}', '4')), '%td_sheet_points_invalid%', '...on any cup (surface 4 of 3)');
select is(t091.save_raw(120, 1, 1, 1, 1, jsonb_set(t091.sheet(t091.good()), '{1,contrast}', '6.0')), 'ok', 'a whole number written 6.0 is the whole number 6 (and is stored as 6)');
select t091.contains(t091.save(120, 1, 1, 1, 1, '[[3,2,2,2,3,3]]'), '%td_sheet_cups%', 'one cup where the round has two is refused');
select t091.contains(t091.save(120, 1, 1, 1, 1, '[[3,2,2,2,3,3],[3,2,2,2,3,3],[3,2,2,2,3,3]]'), '%td_sheet_cups%', 'three cups where the round has two is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, jsonb_build_object('1', t091.sheet(t091.good()) -> '1', '3', t091.sheet(t091.good()) -> '2')), '%td_sheet_cups%', 'cups numbered 1 and 3 are refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, '{"1": 5, "2": 6}'), '%td_sheet_invalid%', 'a cup that is not an object is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, '[1, 2]'), '%td_sheet_invalid%', 'a sheet that is an array is refused');
select t091.contains(t091.save_raw(120, 1, 1, 1, 1, 'null'), '%td_sheet_invalid%', 'a sheet that is json null is refused');
select t091.contains(t091.save(120, 1, 1, 1, 0, t091.good()), '%td_seat_invalid%', 'judge seat 0 is refused');
select t091.contains(t091.save(120, 1, 1, 1, 4, t091.good()), '%td_seat_invalid%', 'judge seat 4 of a three-judge panel is refused');
select t091.contains(t091.as_user(t091.u(1), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, null, %L)',
  t091.u(100), t091.m(120, 1, 1), t091.s(120, 1, 1, 1), t091.sheet(t091.good()))), '%td_seat_invalid%', 'a null seat is refused');
select t091.contains(t091.as_user(t091.u(1), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, 1, %L)',
  t091.u(100), t091.m(120, 1, 1), t091.s(110, 4, 1, 1), t091.sheet(t091.good()))), '%td_slot_invalid%', 'a slot of another match is refused');
select t091.contains(t091.as_user(t091.u(1), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, 1, %L)',
  t091.u(100), t091.m(120, 1, 1), gen_random_uuid(), t091.sheet(t091.good()))), '%td_slot_invalid%', 'a slot that does not exist is refused');
-- an empty slot (the opponent of a bye can never be scored); simulated by emptying a slot of this undecided match
update td_slots set entry_id = null where id = t091.s(120, 1, 1, 2);
select t091.contains(t091.save(120, 1, 1, 2, 1, t091.good()), '%td_slot_empty%', 'an empty slot is refused');
update td_slots set entry_id = t091.u(1202) where id = t091.s(120, 1, 1, 2);
select t091.contains(t091.as_user(t091.u(2), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, 1, %L)',
  t091.u(200), t091.m(120, 1, 1), t091.s(120, 1, 1, 1), t091.sheet(t091.good()))), '%event not found%', 'another organisation''s organiser gets "event not found"');
select t091.contains(t091.as_user(t091.u(2), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, 1, %L)',
  t091.u(100), t091.m(120, 1, 1), t091.s(120, 1, 1, 1), t091.sheet(t091.good()))), '%event not found%', '...also naming the right organisation');
select is(t091.sheet_rows(120, 1, 1), 12, 'only the one valid sheet (6.0 -> 6, two cups of six lines) got in; every refusal left nothing behind');
select is((select points::int from td_score_sheets where match_id = t091.m(120, 1, 1) and cup = 1 and line_key = 'contrast'), 6, '6.0 is stored as 6');
-- the module-off event and a replay
select is(t091.settings(130, 3, '{}'), 'ok', 'event 130: no module');
select is(t091.start(130, array[1,2]), 'ok', 'event 130 started');
select t091.contains(t091.save(130, 1, 1, 1, 1, t091.good()), '%td_match_not_scored%', 'with the module off no sheet is taken');
select t091.contains(t091.confirm(130, 1, 1, 1, null), '%td_match_not_scored%', '...and no scored confirm either');
select is(t091.tap(130, 1, 1, 1, 1), 'ok', '...and taps work exactly as before');
-- idempotency: a replay does nothing, and an old replay does not undo a newer replacement
select is(t091.save_raw(120, 1, 1, 1, 2, t091.sheet(t091.good()), t091.u(9001)), 'ok', 'sheet saved with operation A');
select is(t091.save_raw(120, 1, 1, 1, 2, t091.sheet('[[1,1,1,1,1,1],[1,1,1,1,1,1]]'), t091.u(9002)), 'ok', 'replaced with operation B');
select is(t091.save_raw(120, 1, 1, 1, 2, t091.sheet(t091.good()), t091.u(9001)), 'ok', 'replaying operation A is accepted...');
select is((select sum(points)::int from td_score_sheets where slot_id = t091.s(120, 1, 1, 1) and judge_seat = 2), 12, '...and changes nothing (the replacement B still stands)');
select is((select count(*)::int from processed_operations where id = t091.u(9001) and kind = 'td_save_score_sheet'), 1, 'the operation was recorded once, and the replay did not record it again');

-- ============ the table, written directly (as the owner: the row trigger and the checks are the second line) ============
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''contrast'', 7)', t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 2))),
  'P0001|td_points_invalid', 'a row above the line max is refused by the trigger');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 4, 1, ''contrast'', 1)', t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 2))),
  'P0001|td_seat_invalid', 'a seat above the judge count is refused');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 3, ''contrast'', 1)', t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 2))),
  'P0001|td_cup_invalid', 'a cup above the round''s cups is refused');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''nope'', 1)', t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 2))),
  'P0001|td_line_unknown', 'a line the event''s sheet does not have is refused');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''contrast'', -1)', t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 2))),
  '23514|', 'negative points are refused by the check');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''contrast'', 1)', t091.u(120), t091.m(120, 1, 1), t091.s(110, 4, 1, 1))),
  'P0001|', 'a slot of another match is refused');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''contrast'', 1)', t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 1))),
  '23505|', 'a second row for the same slot, seat, cup and line is refused (unique)');
select is(t091.try(format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''contrast'', 1)', t091.u(130), t091.m(130, 1, 1), t091.s(130, 1, 1, 1))),
  '23001|td_match_not_scored', 'a row on a tap-voted match is refused');
select is(t091.try(format('update td_score_sheets set event_id = %L where slot_id = %L', t091.u(110), t091.s(120, 1, 1, 1))), '23001|', 'the event of a sheet row is frozen');
select is(t091.try(format('update td_score_sheets set match_id = %L where slot_id = %L', t091.m(110, 4, 1), t091.s(120, 1, 1, 1))), '23001|', 'the match of a sheet row is frozen');
select is(t091.try(format('update td_score_sheets set slot_id = %L where slot_id = %L', t091.s(120, 1, 1, 2), t091.s(120, 1, 1, 1))), '23001|', 'the slot of a sheet row is frozen');
-- (the organiser decision's frozen parent is tested after event 123 has one, below)
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name in ('td_score_sheets', 'td_score_decisions')
            and column_name ~* '(total|sum|score|winner_slot|standing)'), 0, 'no total, score or standing column exists on either table (derived only)');
select is((select count(*)::int from td_score_decisions where match_id in (t091.m(110, 3, 1), t091.m(110, 4, 1))), 0, 'no organiser decision is recorded for a match decided by rule (a) or (b)');

-- ============ the winner rule over the shared fixture: the database and the JS agree ============
create function t091.parity_actual(i int) returns text language plpgsql as $$
declare r text;
begin
  r := t091.load_case(120, 1, 1, i);
  if r <> 'ok' then return 'load failed: ' || r; end if;
  return (select coalesce(d.winner_position::text, '-') || '/' || d.rule from app.td_scored_decide(t091.m(120, 1, 1)) d)
      || '/' || (select string_agg(grand_total::text, ',' order by slot_position) from td_score_standings where match_id = t091.m(120, 1, 1))
      || '/' || (select string_agg(judges_preferring::text, ',' order by slot_position) from td_score_standings where match_id = t091.m(120, 1, 1));
end $$;
create function t091.parity_expected(i int) returns text language sql stable as $$
  select coalesce(j -> 'cases' -> i -> 'expect' ->> 'winner', '-') || '/' || (j -> 'cases' -> i -> 'expect' ->> 'rule')
      || '/' || (j -> 'cases' -> i -> 'expect' -> 'totals' ->> 0) || ',' || (j -> 'cases' -> i -> 'expect' -> 'totals' ->> 1)
      || '/' || (j -> 'cases' -> i -> 'expect' -> 'preferring' ->> 0) || ',' || (j -> 'cases' -> i -> 'expect' -> 'preferring' ->> 1)
    from t091.fx
$$;
select is(t091.parity_actual(i), t091.parity_expected(i), 'fixture case ' || i || ': ' || (select j -> 'cases' -> i ->> 'name' from t091.fx))
  from generate_series(0, 8) i order by i;
select is((select jsonb_array_length(j -> 'cases') from t091.fx), 9, 'the fixture has nine cases (the loop above covers all of them)');
select is((select string_agg(winner_position::text, ',') from (select (app.td_scored_decide(t091.m(120, 1, 1))).winner_position) x), '1', 'the last fixture case is decided for slot 1 (sanity)');

-- ============ the writers, branch by branch ============
-- (a) total
select is(t091.settings(121, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 2}}}'), 'ok', 'event 121 set up');
select is(t091.start(121, array[1,2]), 'ok', 'event 121 started');
select is(t091.load_case(121, 1, 1, 0), 'ok', 'event 121: sheets in (fixture case 0, slot 1 ahead on total)');
select t091.contains(t091.confirm(121, 1, 1, null, null), '%td_leader_changed%', 'rule total: confirm without the winner the organiser saw is refused');
select t091.contains(t091.confirm(121, 1, 1, 2, null), '%td_leader_changed%', '...and with the wrong winner');
select t091.contains(t091.confirm(121, 1, 1, 1, 1), '%td_organiser_pick_unneeded%', '...and an organiser pick is refused when the scores decide');
select is(t091.load_case(121, 1, 1, 4), 'ok', 'the sheets change after the organiser looked (fixture case 4: slot 2 now wins on judges)');
select t091.contains(t091.confirm(121, 1, 1, 1, null), '%td_leader_changed%', 'a confirm naming the winner the organiser saw is refused when the sheets now say the other competitor wins (td_leader_changed)');
select is(t091.load_case(121, 1, 1, 0), 'ok', 'the sheets are back to fixture case 0 (slot 1 wins on total)');
select is(t091.confirm(121, 1, 1, 1, null, t091.u(9101)), 'ok', 'confirmed with the winner the organiser saw');
select is(t091.winner(121, 1, 1), t091.name(121, 1, 1, 1), 'slot 1 won');
select is(t091.confirm(121, 1, 1, 1, null, t091.u(9101)), 'ok', 'replaying the confirm is accepted...');
select is((select count(*)::int from td_matches where event_id = t091.u(121) and result_kind = 'scores'), 1, '...and decided nothing twice');
select is(t091.confirm(121, 1, 1, 2, 2), 'ok', 'a second confirm of a decided match (a fresh operation) is a quiet no-op');
select is(t091.winner(121, 1, 1), t091.name(121, 1, 1, 1), '...and the winner is unchanged');
-- (b) judges
select is(t091.settings(122, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 2}}}'), 'ok', 'event 122 set up');
select is(t091.start(122, array[1,2]), 'ok', 'event 122 started');
select is(t091.load_case(122, 1, 1, 4), 'ok', 'event 122: sheets in (fixture case 4: level, slot 2 higher with two judges)');
select t091.contains(t091.confirm(122, 1, 1, 1, null), '%td_leader_changed%', 'rule judges: the wrong winner is refused');
select t091.contains(t091.confirm(122, 1, 1, 2, 1), '%td_organiser_pick_unneeded%', 'rule judges: an organiser pick is refused when the judges decide');
select is(t091.confirm(122, 1, 1, 2, null), 'ok', 'rule judges: confirmed for slot 2');
select is(t091.winner(122, 1, 1), t091.name(122, 1, 1, 2), 'slot 2 won with more judges');
select is((select count(*)::int from td_score_decisions where event_id = t091.u(122)), 0, 'and no organiser decision was recorded');
-- (c) organiser pick
select is(t091.settings(123, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 2}}}'), 'ok', 'event 123 set up');
select is(t091.start(123, array[1,2]), 'ok', 'event 123 started');
select is(t091.load_case(123, 1, 1, 5), 'ok', 'event 123: sheets in (fixture case 5: level total, one judge scored them equal)');
select is((select coalesce(winner_position::text, '') || rule from app.td_scored_decide(t091.m(123, 1, 1)) d), 'organiser_needed', 'nobody wins yet: the organiser must pick');
select is((select count(*)::int from td_match_results where match_id = t091.m(123, 1, 1) and winner_slot_id is not null), 0, 'and no winner is derived');
select t091.contains(t091.confirm(123, 1, 1, null, null), '%td_organiser_pick_required%', 'confirm without a pick is refused');
select t091.contains(t091.confirm(123, 1, 1, 1, null), '%td_leader_changed%', 'a "winner the organiser saw" cannot be given for a level match');
select t091.contains(t091.confirm(123, 1, 1, null, 3), '%td_slot_invalid%', 'a pick that is not a competitor of the match is refused');
select is((select count(*)::int from td_score_decisions where event_id = t091.u(123)), 0, 'a refused confirm recorded nothing');
select is(t091.confirm(123, 1, 1, null, 2), 'ok', 'the organiser picks slot 2');
select is((select winner_position::int from td_score_decisions where match_id = t091.m(123, 1, 1)), 2, 'the pick is recorded as an organiser decision');
select is(t091.winner(123, 1, 1), t091.name(123, 1, 1, 2), 'and the picked competitor is the winner');
select is((select result_kind from td_matches where id = t091.m(123, 1, 1)), 'scores', 'result_kind is scores');
select is(t091.try(format('update td_score_decisions set event_id = %L where match_id = %L', t091.u(120), t091.m(123, 1, 1))), '23001|', 'the event of an organiser decision is frozen');
select is(t091.try(format('insert into td_score_decisions (match_id, event_id, winner_position) values (%L, %L, 1)', t091.m(122, 1, 1), t091.u(122))), '23001|td_match_decided',
  'a decision cannot be added to a match that is already decided');

-- ============ semi-finals scored: the Final and the 3rd place match follow; a walkover works in a scored round ============
select is(t091.settings(140, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"semi_final": 1}}}'), 'ok', 'event 140: semi-finals scored, one cup');
select is(t091.start(140, array[1,2,3,4]), 'ok', 'event 140 started');
select is(app.td_round_role(t091.m(140, 1, 1)), 'semi_final', 'Round 1 of 4 is the semi-finals');
select is(t091.fill(140, 1, 1, '[[6,3,3,3,6,6]]', '[[3,2,2,2,3,3]]'), 'ok', 'semi-final 1 sheets in');
select is(t091.confirm(140, 1, 1, 1, null), 'ok', 'semi-final 1 confirmed');
select is(t091.rounds(140), '1:main:2', 'one semi-final decided: nothing follows yet');
select is(t091.as_user(t091.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t091.u(100), t091.m(140, 1, 2), t091.s(140, 1, 2, 2))), 'ok',
  'semi-final 2 is a walkover (works in a scored round exactly as before)');
select is(t091.rounds(140), '1:main:2 2:third_place:1 3:main:1', 'the 3rd place match and the Final are created after scored and walkover semi-finals');
select is((select result_kind from td_matches where id = t091.m(140, 1, 2)), 'walkover', 'the walkover keeps its own result kind');
select is(t091.confirm(140, 1, 1, 1, null, t091.u(9140)), 'ok', 'a replayed confirm of semi-final 1');
select is(t091.rounds(140), '1:main:2 2:third_place:1 3:main:1', '...creates no second round');
select t091.contains(t091.tap(140, 3, 1, 1, 1), 'ok', 'the Final is not scored in this event: taps work');

-- ============ a bye semi-final in a scored round ============
select is(t091.settings(150, 3, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"semi_final": 1}}}'), 'ok', 'event 150: three competitors');
select is(t091.start(150, array[1,2,3,0]), 'ok', 'event 150 started: semi-final 2 is a bye');
select t091.contains(t091.save(150, 1, 2, 1, 1, '[[3,2,2,2,3,3]]'), '%td_match_decided%', 'a bye match (decided at once) takes no sheet');
select is(t091.fill(150, 1, 1, '[[6,3,3,3,6,6]]', '[[3,2,2,2,3,3]]'), 'ok', 'the other semi-final is scored');
select is(t091.confirm(150, 1, 1, 1, null), 'ok', '...and confirmed');
select is(t091.rounds(150) || ' ' || t091.name(150, 2, 1, 1) || ' ' || t091.name(150, 2, 1, 2), '1:main:2 2:main:1 P1 P3',
  'the scored winner and the bye competitor meet in the Final (a bye works in a scored round, and a bye leaves no 3rd place match)');

-- ============ nobody writes directly; reads are the organisation''s own; anon gets nothing ============
select t091.contains(t091.as_user(t091.u(1), format('insert into td_score_sheets (event_id, match_id, slot_id, judge_seat, cup, line_key, points) values (%L, %L, %L, 1, 1, ''contrast'', 1)',
  t091.u(120), t091.m(120, 1, 1), t091.s(120, 1, 1, 2))), '42501|%permission denied for table td_score_sheets', 'a client cannot insert a sheet row');
select t091.contains(t091.as_user(t091.u(1), format('update td_score_sheets set points = 0 where match_id = %L', t091.m(120, 1, 1))), '42501|%permission denied for table td_score_sheets', '...or update one');
select t091.contains(t091.as_user(t091.u(1), format('delete from td_score_sheets where match_id = %L', t091.m(120, 1, 1))), '42501|%permission denied for table td_score_sheets', '...or delete one');
select t091.contains(t091.as_user(t091.u(1), format('insert into td_score_decisions (match_id, event_id, winner_position) values (%L, %L, 1)', t091.m(120, 1, 1), t091.u(120))),
  '42501|%permission denied for table td_score_decisions', 'a client cannot write a decision either');
select cmp_ok(t091.count_as(t091.u(1), 'td_score_sheets'), '>', 0, 'an organisation member reads its sheets');
select is(t091.count_as(t091.u(2), 'td_score_sheets'), 0, 'a member of another organisation reads zero sheet rows');
select cmp_ok(t091.count_as(t091.u(1), 'td_score_decisions'), '>', 0, 'a member reads the organiser decisions');
select is(t091.count_as(t091.u(2), 'td_score_decisions'), 0, 'a non-member reads zero decisions');
select cmp_ok(t091.count_as(t091.u(1), 'td_score_standings'), '>', 0, 'a member reads the standings view');
select is(t091.count_as(t091.u(2), 'td_score_standings'), 0, 'a non-member reads zero standings');
select is((select count(*)::int from td_score_standings where match_id = t091.m(120, 1, 1)), 2, 'the view has one row per filled slot');
select is(t091.count_as(t091.u(2), 'td_match_results'), 0, 'a non-member reads zero rows of the results view');
select cmp_ok(t091.count_as(t091.u(1), 'td_match_results'), '>', 0, 'a member reads the results view');
select is((select count(*)::int from td_match_results where match_id = t091.m(110, 4, 1) and winner_slot_id is not null), 1, 'the scored Final''s winner is derived through the results view (the "scores" arm)');
select is(t091.as_user(t091.u(2), format('select 1 from app.td_scored_winner(%L) w where w is not null', t091.m(110, 4, 1))), 'ok', 'calling the derivation as a stranger runs under row-level security...');
create function t091.stranger_winner() returns text language plpgsql as $$
declare w smallint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', t091.u(2))::text, true);
  perform set_config('request.jwt.claim.sub', t091.u(2)::text, true);
  select app.td_scored_winner(t091.m(110, 4, 1)) into w;
  perform set_config('role', 'none', true);
  return coalesce(w::text, 'nothing');
end $$;
select is(t091.stranger_winner(), 'nothing', '...and tells a stranger nothing about another organisation''s scored match');
select t091.contains(t091.as_anon('select count(*) from td_score_sheets'), '42501|%', 'anon cannot read the sheets');
select t091.contains(t091.as_anon('select count(*) from td_score_decisions'), '42501|%', 'anon cannot read the decisions');
select t091.contains(t091.as_anon('select count(*) from td_score_standings'), '42501|%', 'anon cannot read the standings view');
select t091.contains(t091.as_anon(format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, 1, %L)', t091.u(100), t091.m(120, 1, 1), t091.s(120, 1, 1, 1), t091.sheet(t091.good()))),
  '42501|%', 'anon cannot call the sheet writer');
select t091.contains(t091.as_anon(format('select public.td_confirm_scored_match(gen_random_uuid(), %L, %L, 1, null)', t091.u(100), t091.m(120, 1, 1))), '42501|%', 'anon cannot call the scored confirm');
select t091.contains(t091.as_anon(format('select app.td_scored_decide(%L)', t091.m(120, 1, 1))), '42501|%', 'anon cannot run the winner rule');
select t091.contains(t091.as_anon(format('select app.td_scored_standings(%L)', t091.m(120, 1, 1))), '42501|%', 'anon cannot run the standings derivation');
select is((select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_name in ('td_score_sheets', 'td_score_decisions', 'td_score_standings')), 0,
  'anon holds no privilege on the new tables or the view');
select is((select string_agg(distinct privilege_type, ',') from information_schema.role_table_grants where grantee = 'authenticated' and table_name in ('td_score_sheets', 'td_score_decisions', 'td_score_standings')),
  'SELECT', 'signed-in callers hold SELECT only');
select is((select count(*)::int from pg_trigger where tgname in ('trg_td_score_sheets_parent_immutable', 'trg_td_score_decisions_parent_immutable') and tgenabled = 'O'), 2,
  'both new tables freeze their parents (enabled triggers)');

select * from finish();
rollback;
