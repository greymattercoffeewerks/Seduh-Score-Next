-- Throwdown: undo a confirmed match (td_reopen_match, migration 20261129100000; owner decisions 2026-11-21).
-- Proves, as the REAL roles through RLS and the SECURITY DEFINER function:
--   * a confirmed vote match goes back to open with its taps kept, and can be fixed and confirmed again;
--   * an undo of a main-round match removes the later rounds (3rd place match and Final) while none of them has started,
--     and confirming again rebuilds them; once a later round has a tap, the undo is refused (td_next_round_started);
--   * a 3rd place match and the Final have nothing after them, so undoing them removes nothing;
--   * a walkover goes back to open (no winner position left); a bye has nothing to undo (td_match_bye);
--   * a scored match keeps its sheets and loses the organiser's pick;
--   * the result the organiser saw is checked (td_leader_changed), an undecided match is a quiet no-op, a replayed
--     operation does nothing the second time;
--   * every undo is recorded in td_match_reopens (kind, winner, confirmed time, rounds removed, who), and a record of a
--     match later removed keeps its positions with match_id null;
--   * a non-member gets "event not found" and reads zero records; nobody writes the record table directly; its event is
--     frozen.
begin;
select plan(83);

create schema t093;
grant usage on schema t093 to anon, authenticated;

create function t093.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000930' || lpad(n::text, 4, '0'))::uuid
$$;

create function t093.as_user(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; m text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
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

create function t093.try(stmt text) returns text language plpgsql as $$
declare h text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '|' || coalesce(h, '');
end $$;

create function t093.contains(res text, pat text, descr text) returns text language sql as $$
  select ok(res like pat, descr) || case when res like pat then '' else E'\n# got: ' || res end
$$;

create function t093.count_as(uid uuid, tbl text) returns int language plpgsql as $$
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

-- user 1 = organiser of org 100; user 2 = organiser of org 200 (a non-member of org 100)
insert into auth.users (id, email) values
  (t093.u(1), 't093-a@test.seduh-next'), (t093.u(2), 't093-b@test.seduh-next');
insert into orgs (id, name, slug) values (t093.u(100), 'T093 A', 't093-a'), (t093.u(200), 'T093 B', 't093-b');
insert into org_members (org_id, user_id, role) values
  (t093.u(100), t093.u(1), 'owner'), (t093.u(200), t093.u(2), 'owner');
-- 300: four competitors, taps; 310: walkover; 320: a bye; 330: scored final; 340: a record whose match is later removed
insert into events (id, org_id, format, name) values
  (t093.u(300), t093.u(100), 'throwdown', 'Reopen taps'),
  (t093.u(310), t093.u(100), 'throwdown', 'Reopen walkover'),
  (t093.u(320), t093.u(100), 'throwdown', 'Reopen bye'),
  (t093.u(330), t093.u(100), 'throwdown', 'Reopen scored'),
  (t093.u(340), t093.u(100), 'throwdown', 'Reopen removed record');
insert into event_entries (id, event_id, display_name)
select t093.u(e.ev * 10 + n), t093.u(e.ev), 'P' || n
  from (values (300, 4), (310, 2), (320, 3), (330, 2), (340, 4)) e(ev, cnt), generate_series(1, 4) n
 where n <= e.cnt;

create function t093.m(ev int, rnd int, mpos int) returns uuid language sql stable as $$
  select m.id from public.td_rounds r join public.td_matches m on m.round_id = r.id and m.position = mpos
   where r.event_id = t093.u(ev) and r.position = rnd
$$;
create function t093.s(ev int, rnd int, mpos int, spos int) returns uuid language sql stable as $$
  select s.id from public.td_slots s where s.match_id = t093.m(ev, rnd, mpos) and s.position = spos
$$;
create function t093.winner(ev int, rnd int, mpos int) returns text language sql stable as $$
  select e.display_name from public.td_match_results x
    join public.td_slots s on s.id = x.winner_slot_id join public.event_entries e on e.id = s.entry_id
   where x.match_id = t093.m(ev, rnd, mpos)
$$;
create function t093.rounds(ev int) returns text language sql stable as $$
  select coalesce(string_agg(r.position || ':' || r.phase || ':' || (select count(*) from public.td_matches m where m.round_id = r.id),
                             ' ' order by r.position), 'none')
    from public.td_rounds r where r.event_id = t093.u(ev)
$$;
create function t093.settings(ev int, modules text default '{}') returns text language sql as $$
  select t093.as_user(t093.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', %L)', t093.u(100), t093.u(ev), modules))
$$;
create function t093.start(ev int, nums int[]) returns text language sql as $$
  select t093.as_user(t093.u(1), format('select public.td_start_event(gen_random_uuid(), %L, %L, ''random'', %L, %s, %L)',
    t093.u(100), t093.u(ev), 'seed-' || ev, array_length(nums, 1),
    (select jsonb_agg(jsonb_build_array(t093.u(ev * 10 + nums[i]), case when nums[i + 1] = 0 then null else t093.u(ev * 10 + nums[i + 1]) end))
       from generate_series(1, array_length(nums, 1), 2) i)))
$$;
create function t093.tap(ev int, rnd int, mpos int, spos int, n int) returns text language plpgsql as $$
declare i int; r text;
begin
  for i in 1 .. n loop
    r := t093.as_user(t093.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t093.u(100), t093.m(ev, rnd, mpos), t093.s(ev, rnd, mpos, spos)));
    if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
create function t093.untap(ev int, rnd int, mpos int, spos int, n int) returns text language plpgsql as $$
declare i int; r text;
begin
  for i in 1 .. n loop
    r := t093.as_user(t093.u(1), format('select public.td_undo_vote(gen_random_uuid(), %L, %L, %L)', t093.u(100), t093.m(ev, rnd, mpos), t093.s(ev, rnd, mpos, spos)));
    if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
create function t093.confirm(ev int, rnd int, mpos int) returns text language sql as $$
  select t093.as_user(t093.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)', t093.u(100), t093.m(ev, rnd, mpos)))
$$;
-- the match is won 2-1 by slot `spos`
create function t093.decide(ev int, rnd int, mpos int, spos int) returns text language plpgsql as $$
declare r text;
begin
  r := t093.tap(ev, rnd, mpos, spos, 2); if r <> 'ok' then return r; end if;
  r := t093.tap(ev, rnd, mpos, 3 - spos, 1); if r <> 'ok' then return r; end if;
  return t093.confirm(ev, rnd, mpos);
end $$;
create function t093.reopen(ev int, rnd int, mpos int, expected uuid default null, op uuid default gen_random_uuid(), who int default 1) returns text language sql as $$
  select t093.as_user(t093.u(who), format('select public.td_reopen_match(%L, %L, %L, %L)', op, t093.u(100), t093.m(ev, rnd, mpos), expected))
$$;
create function t093.votes(ev int, rnd int, mpos int) returns text language sql stable as $$
  select (select count(*) from public.td_votes v where v.slot_id = t093.s(ev, rnd, mpos, 1)) || '-' ||
         (select count(*) from public.td_votes v where v.slot_id = t093.s(ev, rnd, mpos, 2))
$$;
create function t093.records(ev int) returns int language sql stable as $$
  select count(*)::int from public.td_match_reopens where event_id = t093.u(ev)
$$;

-- ============ 300: a vote match goes back to open, keeps its taps, and is fixed ============
select is(t093.settings(300), 'ok', 'event 300 set up (3 judges, 3rd place match on)');
select is(t093.start(300, array[1,2,3,4]), 'ok', 'event 300 starts: P1 v P2, P3 v P4');
select is(t093.reopen(300, 1, 1), 'ok', 'undoing a match that is not decided yet is a quiet no-op');
select is(t093.records(300), 0, '...and records nothing');

select is(t093.decide(300, 1, 1, 1), 'ok', 'the wrong winner, P1, is confirmed 2-1');
-- the confirmed time, backdated so it cannot equal the undo's own time in this one transaction
update td_matches set confirmed_at = now() - interval '7 minutes' where id = t093.m(300, 1, 1);
create table t093.seen as select confirmed_at from td_matches where id = t093.m(300, 1, 1);
select is(t093.rounds(300), '1:main:2', 'the other semi-final is still open, so nothing follows yet');
select t093.contains(t093.reopen(300, 1, 1, t093.s(300, 1, 1, 2)), '%td_leader_changed%',
  'an undo naming a winner the match does not have is refused');
select is(t093.reopen(300, 1, 1, t093.s(300, 1, 1, 1)), 'ok', 'the organiser undoes the result they saw');
select is((select coalesce(result_kind, 'open') || '/' || (confirmed_at is null) from td_matches where id = t093.m(300, 1, 1)),
  'open/true', 'the match is open again');
select is(t093.votes(300, 1, 1), '2-1', 'its taps are kept');
select is((select previous_result_kind || '/' || e.display_name || '/' || round_position || '/' || round_phase || '/' || match_position
                  || '/' || rounds_removed || '/' || (reopened_by = t093.u(1)) || '/' || (match_id = t093.m(300, 1, 1))
             from td_match_reopens r join event_entries e on e.id = r.previous_winner_entry_id where r.event_id = t093.u(300)),
  'votes/P1/1/main/1/0/true/true', 'the undo is recorded: the result kind, the winner it had, where, nothing removed, who');
select ok((select r.previous_confirmed_at = x.confirmed_at and r.reopened_at is not null
             from td_match_reopens r, t093.seen x where r.event_id = t093.u(300)),
  '...with the time it had been confirmed (not the time of the undo) and when it was undone');
select is(t093.untap(300, 1, 1, 1, 1) || t093.tap(300, 1, 1, 2, 1), 'okok', 'the wrong tap is taken back and the right one made');
select is(t093.confirm(300, 1, 1), 'ok', 'the match is confirmed again');
select is(t093.winner(300, 1, 1), 'P2', 'P2 now wins it');

-- ============ an undo removes the later rounds while none has started, and confirming again rebuilds them ============
select is(t093.decide(300, 1, 2, 1), 'ok', 'P3 wins the other semi-final');
select is(t093.rounds(300), '1:main:2 2:third_place:1 3:main:1', 'the 3rd place match and the Final are made');
select is(t093.reopen(300, 1, 1), 'ok', 'the first semi-final is undone before anything in the next round has started');
select is(t093.rounds(300), '1:main:2', 'the 3rd place match and the Final are removed');
select is((select string_agg(rounds_removed::text, ',' order by rounds_removed) from td_match_reopens where event_id = t093.u(300)),
  '0,2', 'the new record says two rounds were removed (the first said none)');
select is(t093.confirm(300, 1, 1), 'ok', 'the same semi-final is confirmed again');
select is(t093.rounds(300), '1:main:2 2:third_place:1 3:main:1', 'the 3rd place match and the Final are made again');
select is((select string_agg(e.display_name, ' v ' order by s.position) from td_slots s join event_entries e on e.id = s.entry_id
            where s.match_id = t093.m(300, 3, 1)), 'P2 v P3', 'the Final is the same pairing as before');
select is((select string_agg(e.display_name, ' v ' order by s.position) from td_slots s join event_entries e on e.id = s.entry_id
            where s.match_id = t093.m(300, 2, 1)), 'P1 v P4', 'and the 3rd place match is the two semi-final losers');

select is(t093.tap(300, 3, 1, 1, 1), 'ok', 'a judge taps in the Final');
select t093.contains(t093.reopen(300, 1, 1), '%td_next_round_started%', 'now a semi-final can no longer be undone');
select is(t093.rounds(300), '1:main:2 2:third_place:1 3:main:1', '...and nothing was removed');
select is(t093.untap(300, 3, 1, 1, 1), 'ok', 'the tap in the Final is taken back');
select is(t093.tap(300, 2, 1, 1, 1), 'ok', 'a judge taps in the 3rd place match instead');
select t093.contains(t093.reopen(300, 1, 1), '%td_next_round_started%', 'a tap in the 3rd place match also counts as started');
select is(t093.untap(300, 2, 1, 1, 1), 'ok', 'that tap is taken back too');

-- ============ a 3rd place match and the Final have nothing after them ============
select is(t093.decide(300, 2, 1, 1), 'ok', 'the 3rd place match is decided');
select is(t093.reopen(300, 2, 1), 'ok', 'and undone');
select is(t093.rounds(300) || '/' || coalesce((select result_kind from td_matches where id = t093.m(300, 3, 1)), 'open'),
  '1:main:2 2:third_place:1 3:main:1/open', 'the Final is untouched by undoing the 3rd place match');
select is(t093.confirm(300, 2, 1), 'ok', 'the 3rd place match is confirmed again');
select is(t093.decide(300, 3, 1, 1), 'ok', 'the Final is decided');
select is(t093.reopen(300, 3, 1, null, t093.u(900)), 'ok', 'the Final is undone (operation 900)');
select is((select rounds_removed from td_match_reopens where match_id = t093.m(300, 3, 1))::int, 0, 'undoing the Final removed nothing');
select is(t093.confirm(300, 3, 1), 'ok', 'the Final is confirmed again');
select is(t093.reopen(300, 3, 1, null, t093.u(900)), 'ok', 'a replay of operation 900 is accepted...');
select is((select result_kind from td_matches where id = t093.m(300, 3, 1)), 'votes', '...and does nothing: the Final stays decided');
select is(t093.records(300), 4, 'four undos are recorded for event 300, the replay not among them');

-- ============ 310: a walkover goes back to open ============
select is(t093.settings(310) || t093.start(310, array[1,2]), 'okok', 'event 310 starts');
select is(t093.as_user(t093.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)',
  t093.u(100), t093.m(310, 1, 1), t093.s(310, 1, 1, 2))), 'ok', 'a walkover to P2 is recorded');
select is(t093.reopen(310, 1, 1), 'ok', 'the walkover is undone');
select is((select coalesce(result_kind, 'open') || '/' || coalesce(walkover_winner_position::text, 'none') from td_matches where id = t093.m(310, 1, 1)),
  'open/none', 'the match is open with no walkover winner left');
select is((select previous_result_kind || '/' || e.display_name from td_match_reopens r join event_entries e on e.id = r.previous_winner_entry_id
            where r.event_id = t093.u(310)), 'walkover/P2', 'the record keeps the walkover and its winner');

-- ============ 320: a bye has nothing to undo ============
select is(t093.settings(320) || t093.start(320, array[1,2,3,0]), 'okok', 'event 320 starts with a bye for P3');
select t093.contains(t093.reopen(320, 1, 2), '%td_match_bye%', 'a bye cannot be undone');

-- ============ 330: a scored match keeps its sheets and loses the organiser's pick ============
select is(t093.settings(330, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 1}}}') || t093.start(330, array[1,2]), 'okok',
  'event 330 starts with a scored final of one cup');
select is((select string_agg(t093.as_user(t093.u(1), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, %s, %L)',
              t093.u(100), t093.m(330, 1, 1), t093.s(330, 1, 1, sp), seat,
              '{"1": {"contrast": 1, "surface": 1, "harmony": 1, "size_position": 1, "achieved": 1, "appeal": 1}}')), '' order by seat, sp)
             from generate_series(1, 3) seat, generate_series(1, 2) sp), repeat('ok', 6), 'every judge scores both the same (level)');
select is(t093.as_user(t093.u(1), format('select public.td_confirm_scored_match(gen_random_uuid(), %L, %L, null, 2)', t093.u(100), t093.m(330, 1, 1))),
  'ok', 'the organiser picks P2');
select is(t093.reopen(330, 1, 1), 'ok', 'the scored final is undone');
select is((select count(*) from td_score_decisions where match_id = t093.m(330, 1, 1))::int || '/' ||
          (select count(*) from td_score_sheets where match_id = t093.m(330, 1, 1))::int,
  '0/36', 'the pick is removed and all 36 sheet lines are kept');
select is(t093.as_user(t093.u(1), format('select public.td_confirm_scored_match(gen_random_uuid(), %L, %L, null, 1)', t093.u(100), t093.m(330, 1, 1))),
  'ok', 'the organiser picks again, P1 this time');
select is(t093.winner(330, 1, 1), 'P1', '...and P1 wins');

-- ============ 340: a record of a match that a later undo removes keeps its positions ============
select is(t093.settings(340) || t093.start(340, array[1,2,3,4]) || t093.decide(340, 1, 1, 1) || t093.decide(340, 1, 2, 1)
          || t093.decide(340, 3, 1, 1), 'okokokokok', 'event 340 played to a champion');
select is(t093.reopen(340, 3, 1) || t093.untap(340, 3, 1, 1, 2) || t093.untap(340, 3, 1, 2, 1), 'okokok',
  'the Final is undone and its taps taken back');
select is(t093.reopen(340, 1, 1), 'ok', 'a semi-final is undone, removing the (now empty) Final');
select is((select (match_id is null) || '/' || round_position || '/' || round_phase || '/' || match_position || '/' || previous_result_kind
             from td_match_reopens where event_id = t093.u(340) and round_position = 3),
  'true/3/main/1/votes', 'the Final''s record survives with its positions, its match id now empty');

-- ============ 350: a withdrawal since the semi-finals would change the 3rd place match, so the undo is refused ============
insert into events (id, org_id, format, name) values (t093.u(350), t093.u(100), 'throwdown', 'Reopen withdrawn');
insert into event_entries (id, event_id, display_name) select t093.u(3500 + n), t093.u(350), 'P' || n from generate_series(1, 4) n;
select is(t093.settings(350) || t093.start(350, array[1,2,3,4]) || t093.decide(350, 1, 1, 1) || t093.decide(350, 1, 2, 1), 'okokokok',
  'event 350: both semi-finals decided, the 3rd place match P2 v P4 made');
update event_entries set withdrawn = true where id = t093.u(3504);
select t093.contains(t093.reopen(350, 1, 1), '%td_third_place_changed%',
  'P4 has withdrawn since: undoing a semi-final would drop the 3rd place match, so it is refused');
select is(t093.rounds(350), '1:main:2 2:third_place:1 3:main:1', '...and nothing was removed');
update event_entries set withdrawn = false where id = t093.u(3504);
select is(t093.reopen(350, 1, 1), 'ok', 'P4 restored: the undo goes ahead');
select is(t093.confirm(350, 1, 1), 'ok', 'the semi-final is confirmed again');
select is(t093.rounds(350), '1:main:2 2:third_place:1 3:main:1', 'and the 3rd place match comes back');
-- the reverse: a loser withdrawn at the semi-finals (no 3rd place match made), restored before the undo
insert into events (id, org_id, format, name) values (t093.u(360), t093.u(100), 'throwdown', 'Reopen restored');
insert into event_entries (id, event_id, display_name) select t093.u(3600 + n), t093.u(360), 'P' || n from generate_series(1, 4) n;
select is(t093.settings(360) || t093.start(360, array[1,2,3,4]) || t093.decide(360, 1, 1, 1), 'okokok', 'event 360: semi-final 1 decided');
update event_entries set withdrawn = true where id = t093.u(3604);
select is(t093.decide(360, 1, 2, 1), 'ok', 'semi-final 2 decided while P4 is withdrawn');
select is(t093.rounds(360), '1:main:2 2:main:1', 'no 3rd place match is made');
update event_entries set withdrawn = false where id = t093.u(3604);
select t093.contains(t093.reopen(360, 1, 1), '%td_third_place_changed%',
  'P4 restored since: undoing would add a 3rd place match that was never played for, so it is refused');

-- ============ 370/380: a later walkover, or a later score sheet, also counts as started (and they are kept) ============
insert into events (id, org_id, format, name) values
  (t093.u(370), t093.u(100), 'throwdown', 'Reopen later walkover'),
  (t093.u(380), t093.u(100), 'throwdown', 'Reopen later sheet');
insert into event_entries (id, event_id, display_name)
select t093.u(e.ev * 10 + n), t093.u(e.ev), 'P' || n from (values (370), (380)) e(ev), generate_series(1, 4) n;
select is(t093.settings(370) || t093.start(370, array[1,2,3,4]) || t093.decide(370, 1, 1, 1) || t093.decide(370, 1, 2, 1), 'okokokok',
  'event 370: semi-finals decided, the 3rd place match and the Final made');
select is(t093.as_user(t093.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)',
  t093.u(100), t093.m(370, 2, 1), t093.s(370, 2, 1, 1))), 'ok', 'the 3rd place match is decided by walkover');
select t093.contains(t093.reopen(370, 1, 1), '%td_next_round_started%', 'a walkover in the next round blocks the undo');
select is(t093.rounds(370), '1:main:2 2:third_place:1 3:main:1', '...nothing is removed');
select is((select result_kind from td_matches where id = t093.m(370, 2, 1)), 'walkover', '...and the walkover is kept');
select is(t093.settings(380, '{"scoresheet": {"preset": "latte_art_v1", "cups": {"final": 1}}}') || t093.start(380, array[1,2,3,4])
          || t093.decide(380, 1, 1, 1) || t093.decide(380, 1, 2, 1), 'okokokok', 'event 380: a scored Final is made');
select is(t093.as_user(t093.u(1), format('select public.td_save_score_sheet(gen_random_uuid(), %L, %L, %L, 1, %L)',
  t093.u(100), t093.m(380, 3, 1), t093.s(380, 3, 1, 1),
  '{"1": {"contrast": 1, "surface": 1, "harmony": 1, "size_position": 1, "achieved": 1, "appeal": 1}}')), 'ok',
  'one judge''s sheet is saved in the Final');
select t093.contains(t093.reopen(380, 1, 1), '%td_next_round_started%', 'a score sheet in the next round blocks the undo');
select is((select count(*) from td_score_sheets where match_id = t093.m(380, 3, 1))::int, 6, '...and the sheet is kept');

-- ============ who may undo, and the record table ============
select t093.contains(t093.reopen(300, 3, 1, null, gen_random_uuid(), 2), '%event not found%',
  'a non-member gets "event not found"');
select ok(t093.count_as(t093.u(1), 'td_match_reopens') = 9 and t093.count_as(t093.u(2), 'td_match_reopens') = 0,
  'the organiser reads their records; a non-member reads zero');
select t093.contains(t093.as_user(t093.u(1), format('insert into td_match_reopens (event_id, round_position, round_phase, match_position, previous_result_kind, previous_confirmed_at) values (%L, 1, ''main'', 1, ''votes'', now())', t093.u(300))),
  '42501|%', 'nobody writes a record directly');
select is(t093.try(format('update td_match_reopens set event_id = %L where event_id = %L', t093.u(310), t093.u(300))), '23001|',
  'the event of a record is frozen');

select * from finish();
rollback;
