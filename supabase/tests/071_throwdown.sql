-- T-TD.1.2 / T-TD.1.3: Throwdown tables and functions (spec: Handoffs and Specs/THROWDOWN-SPEC-DRAFT.md sections 4 to 7).
-- Proves, as the REAL roles through RLS and the SECURITY DEFINER functions:
--   * the cap key: Community 8 competitors (the ninth ACTIVE entry is refused with the Throwdown key in the detail), a
--     withdrawn entry does not count, another format keeps its own key;
--   * setup: validated, locked the moment Round 1 starts, the module toggle mechanism with NO module (any key refused,
--     a switched-off toggle leaves no trace);
--   * the draw: random (the seed is recorded) and manual (one name becomes a bye, an opponent-only slot moves up, an empty
--     pair is dropped, a competitor fills one slot, zero real pairs is refused), a second start is refused, a replay of
--     the same operation does nothing;
--   * votes are rows, level votes cannot be confirmed, the majority wins, a decided match takes no more taps;
--   * a FULL 8-competitor event to a champion: R1 (4 matches) -> R2 (2) -> 3rd place + Final live together -> done,
--     with winners derived from the vote rows (td_match_results) and nothing projected ahead of the results;
--   * an odd field (a bye is decided at once and advances), a walkover (its own result kind, no 3rd place match when a
--     semi-final was one), and idempotent advancement (a repeated confirm creates no second round);
--   * nobody writes a td_* table directly, a non-member reads zero rows and every function answers "event not found",
--     every parent column is frozen, and a pair match cannot take a third slot.
begin;
select plan(98);

create schema t071;
grant usage on schema t071 to anon, authenticated;

create function t071.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000710' || lpad(n::text, 4, '0'))::uuid
$$;

-- "SQLSTATE|hint|detail|message" of a statement run as a signed-in person (the real `authenticated` role), or 'ok'
create function t071.as_user(uid uuid, stmt text) returns text language plpgsql as $$
declare res text; h text; d text; m text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', uid)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
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

create function t071.contains(res text, pat text, descr text) returns text language sql as $$
  select ok(res like pat, descr) || case when res like pat then '' else E'\n# got: ' || res end
$$;

-- rows a signed-in person can see (as `authenticated`, through row-level security)
create function t071.count_as(uid uuid, tbl text) returns int language plpgsql as $$
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

-- user 1 = organiser of org 100 (user 2 of org 200). Event 110 = Throwdown of org 100.
insert into auth.users (id, email) values
  (t071.u(1), 't071-a@test.seduh-next'), (t071.u(2), 't071-b@test.seduh-next');
insert into orgs (id, name, slug) values (t071.u(100), 'T071 A', 't071-a'), (t071.u(200), 'T071 B', 't071-b');
insert into org_members (org_id, user_id, role) values
  (t071.u(100), t071.u(1), 'owner'), (t071.u(200), t071.u(2), 'owner');
insert into events (id, org_id, format, name) values
  (t071.u(110), t071.u(100), 'throwdown', 'Throwdown 8'),
  (t071.u(120), t071.u(100), 'throwdown', 'Throwdown 5'),
  (t071.u(130), t071.u(100), 'throwdown', 'Throwdown manual'),
  (t071.u(140), t071.u(100), 'throwdown', 'Throwdown walkover'),
  (t071.u(150), t071.u(100), 'throwdown', 'Throwdown cap'),
  (t071.u(160), t071.u(100), 'cup_taster', 'A Cup Taster'),
  (t071.u(210), t071.u(200), 'throwdown', 'Other org');
insert into events (id, org_id, format, name, is_test) values (t071.u(170), t071.u(100), 'throwdown', 'Throwaway', true);
-- competitors: event 110 -> entries 1..8 (ids 1101..1108), 120 -> 5, 130 -> 6, 140 -> 4, 210 -> 2
insert into event_entries (id, event_id, display_name)
select t071.u(e.ev * 10 + n), t071.u(e.ev), 'P' || n
  from (values (110, 8), (120, 5), (130, 6), (140, 4), (170, 2), (210, 2)) e(ev, cnt), generate_series(1, 8) n
 where n <= e.cnt;

-- reads the winner's display name of a match by position (null while undecided)
create function t071.winner(ev int, rnd int, mpos int) returns text language sql stable as $$
  select e.display_name
    from public.td_rounds r
    join public.td_matches m on m.round_id = r.id and m.position = mpos
    join public.td_match_results x on x.match_id = m.id
    join public.td_slots s on s.id = x.winner_slot_id
    join public.event_entries e on e.id = s.entry_id
   where r.event_id = t071.u(ev) and r.position = rnd
$$;
-- the id of a match / slot by (event, round position, match position[, slot position])
create function t071.m(ev int, rnd int, mpos int) returns uuid language sql stable as $$
  select m.id from public.td_rounds r join public.td_matches m on m.round_id = r.id and m.position = mpos
   where r.event_id = t071.u(ev) and r.position = rnd
$$;
create function t071.s(ev int, rnd int, mpos int, spos int) returns uuid language sql stable as $$
  select s.id from public.td_slots s where s.match_id = t071.m(ev, rnd, mpos) and s.position = spos
$$;
-- user 1 taps `n` times for slot `spos` of a match
create function t071.tap(ev int, rnd int, mpos int, spos int, n int) returns void language plpgsql as $$
declare i int; r text;
begin
  for i in 1 .. n loop
    r := t071.as_user(t071.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)',
      t071.u(100), t071.m(ev, rnd, mpos), t071.s(ev, rnd, mpos, spos)));
    if r <> 'ok' then raise exception 'tap failed: %', r; end if;
  end loop;
end $$;
create function t071.confirm(ev int, rnd int, mpos int) returns text language sql as $$
  select t071.as_user(t071.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)',
    t071.u(100), t071.m(ev, rnd, mpos)))
$$;
-- the match is won 2-1 by the competitor in slot `spos`
create function t071.decide(ev int, rnd int, mpos int, spos int) returns text language plpgsql as $$
begin
  perform t071.tap(ev, rnd, mpos, spos, 2);
  perform t071.tap(ev, rnd, mpos, 3 - spos, 1);
  return t071.confirm(ev, rnd, mpos);
end $$;
create function t071.rounds(ev int) returns text language sql stable as $$
  select coalesce(string_agg(r.position || ':' || r.phase || ':' || (select count(*) from public.td_matches m where m.round_id = r.id),
                             ' ' order by r.position), 'none')
    from public.td_rounds r where r.event_id = t071.u(ev)
$$;
-- [[e1,e2],[e3,e4],...] from entry numbers (0 = empty) of event ev
create function t071.pairs(ev int, nums int[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_array(
           case when nums[i] = 0 then null else t071.u(ev * 10 + nums[i]) end,
           case when nums[i + 1] = 0 then null else t071.u(ev * 10 + nums[i + 1]) end))
    from generate_series(1, array_length(nums, 1), 2) i
$$;
create function t071.start(ev int, mode text, seed text, nums int[]) returns text language sql as $$
  select t071.as_user(t071.u(1), format('select public.td_start_event(gen_random_uuid(), %L, %L, %L, %L, %s, %L)',
    t071.u(100), t071.u(ev), mode, seed, array_length(nums, 1), t071.pairs(ev, nums)))
$$;

-- ============ the cap: throwdown_participants, Community 8 ============
update app.entitlement_keys set enforced = true where key in ('throwdown_participants', 'cup_taster_participants');
select is(t071.as_user(t071.u(1), (select string_agg(format('insert into event_entries (event_id, display_name) values (%L, %L)', t071.u(150), 'C' || n), '; ')
                                    from generate_series(1, 8) n)), 'ok',
  'a Community Throwdown takes eight competitors');
select is(t071.as_user(t071.u(1), format('insert into event_entries (event_id, display_name) values (%L, ''C9'')', t071.u(150))),
  '42501|entitlement_cap_reached|throwdown_participants|entitlement_cap_reached',
  'the ninth active competitor is refused with the Throwdown key in the detail');
update event_entries set withdrawn = true where event_id = t071.u(150) and display_name = 'C1';
select is(t071.as_user(t071.u(1), format('insert into event_entries (event_id, display_name) values (%L, ''C9'')', t071.u(150))), 'ok',
  'a withdrawn competitor does not count toward the cap');
select is(t071.as_user(t071.u(1), (select string_agg(format('insert into event_entries (event_id, display_name) values (%L, %L)', t071.u(160), 'T' || n), '; ')
                                    from generate_series(1, 8) n)), 'ok',
  'a Cup Taster event still has its own key and its own eight');
select is(t071.as_user(t071.u(1), format('insert into event_entries (event_id, display_name) values (%L, ''T9'')', t071.u(160))),
  '42501|entitlement_cap_reached|cup_taster_participants|entitlement_cap_reached',
  '...and the ninth is refused under the Cup Taster key');
update app.entitlement_keys set enforced = false where key in ('throwdown_participants', 'cup_taster_participants');

-- ============ setup and the module toggle mechanism ============
select is(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t071.u(100), t071.u(110))), 'ok',
  'the organiser saves the setup');
select is((select judge_count || '/' || third_place || '/' || seeding_mode || '/' || modules::text from td_settings where event_id = t071.u(110)),
  '3/true/random/{}', 'the setup is stored');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 0, true, ''random'', ''{}'')', t071.u(100), t071.u(110))),
  '%td_judge_count_invalid%', 'a judge count of zero is refused');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''dice'', ''{}'')', t071.u(100), t071.u(110))),
  '%td_seeding_invalid%', 'an unknown seeding mode is refused');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{"redemption": true}'')', t071.u(100), t071.u(110))),
  '%td_module_unknown%', 'no module exists in TD.1: enabling any key is refused with a reason, not ignored');
select is(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 5, false, ''random'', ''{"redemption": false}'')', t071.u(100), t071.u(110))), 'ok',
  'a module toggled OFF is accepted...');
select is((select modules::text from td_settings where event_id = t071.u(110)), '{}', '...and leaves no trace in the stored setup');
select t071.contains(t071.as_user(t071.u(1), format('insert into td_settings (event_id) values (%L)', t071.u(120))),
  '42501|%permission denied for table td_settings', 'a client cannot write a setup row directly');
select is(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t071.u(100), t071.u(110))), 'ok',
  'setup back to three judges with the 3rd place match on');

-- ============ the draw, 8 competitors, random ============
select t071.contains(t071.start(110, 'manual', null, array[1,2,3,4,5,6,7,8]), '%td_seeding_mismatch%', 'a draw mode that differs from the setup is refused');
select t071.contains(t071.start(110, 'random', null, array[1,2,3,4,5,6,7,8]), '%td_seed_invalid%', 'a random draw without its seed is refused');
select t071.contains(t071.start(110, 'random', 'seed-110', array[1,2,3,4,5,6,7]), '%td_draw_empty%', 'a slot count that does not match the pairs is refused');
select t071.contains(t071.start(110, 'random', 'seed-110', array[1,2,3,4,5,6]), '%td_draw_incomplete%', 'a random draw must place every active competitor');
select t071.contains(t071.start(110, 'random', 'seed-110', array[1,2,3,4,5,6,7,1]), '%td_draw_duplicate%', 'a competitor can fill only one slot');
select t071.contains(t071.start(110, 'random', 'seed-110', array[1,2,3,4,5,6,7,21]), '%td_draw_entry%', 'a competitor of another event is refused');
select is(t071.start(110, 'random', 'seed-110', array[3,7,1,5,2,8,4,6]), 'ok', 'the random draw starts Round 1');
select is(t071.rounds(110), '1:main:4', 'Round 1 has four matches');
select is((select seed || '/' || mode || '/' || slot_count from td_draws where event_id = t071.u(110)), 'seed-110/random/8', 'the shuffle seed is recorded with the draw');
select t071.contains(t071.start(110, 'random', 'seed-110', array[3,7,1,5,2,8,4,6]), '%td_already_started%', 'a second start is refused');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t071.u(100), t071.u(110))),
  '23001|td_setup_locked%', 'setup is locked once Round 1 has started');
select is((select count(*)::int from td_matches where event_id = t071.u(110) and result_kind is not null), 0, 'no match is decided at the start');
select is(t071.rounds(110), '1:main:4', 'and the later rounds do not exist yet: nothing is projected');

-- ============ voting and confirming ============
select t071.contains(t071.confirm(110, 1, 1), '%td_votes_level%', 'confirm is refused while the votes are level (0-0)');

select is(t071.winner(110, 1, 1), null, 'an undecided match has no winner (no inferred one)');
select t071.tap(110, 1, 1, 1, 1);
select t071.tap(110, 1, 1, 2, 1);
select t071.contains(t071.confirm(110, 1, 1), '%td_votes_level%', 'confirm is still refused at 1-1');
select is((select count(*)::int from td_votes where match_id = t071.m(110, 1, 1)), 2, 'votes are rows, one per tap, with no judge identity');
select t071.tap(110, 1, 1, 1, 1);
select is(t071.confirm(110, 1, 1), 'ok', 'confirm succeeds at 2-1');
select is(t071.winner(110, 1, 1), 'P3', 'the majority winner is derived from the vote rows');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t071.u(100), t071.m(110, 1, 1), t071.s(110, 1, 1, 2))),
  '%td_match_decided%', 'a decided match takes no more taps');

-- undo, and a replayed tap counts once
select t071.tap(110, 1, 2, 2, 2);
select t071.tap(110, 1, 2, 1, 1);
select is(t071.as_user(t071.u(1), format('select public.td_undo_vote(gen_random_uuid(), %L, %L, %L)', t071.u(100), t071.m(110, 1, 2), t071.s(110, 1, 2, 2))), 'ok',
  'a tap can be taken back');
select t071.contains(t071.confirm(110, 1, 2), '%td_votes_level%', '...which leaves it level again (1-1)');
select is(t071.as_user(t071.u(1), format('select public.td_cast_vote(%L, %L, %L, %L); select public.td_cast_vote(%L, %L, %L, %L)',
    t071.u(9001), t071.u(100), t071.m(110, 1, 2), t071.s(110, 1, 2, 1), t071.u(9001), t071.u(100), t071.m(110, 1, 2), t071.s(110, 1, 2, 1))), 'ok',
  'the same operation replayed...');
select is((select count(*)::int from td_votes where slot_id = t071.s(110, 1, 2, 1)), 2, '...counts once (an outbox replay cannot double a tap)');
select is(t071.confirm(110, 1, 2), 'ok', 'P1 wins 2-1');
select is(t071.winner(110, 1, 2), 'P1', '...derived from the rows');
select is(t071.decide(110, 1, 3, 2), 'ok', 'match 3 is won by the second slot');
select is(t071.rounds(110), '1:main:4', 'Round 2 does not exist while a Round 1 match is undecided');
select is(t071.decide(110, 1, 4, 1), 'ok', 'match 4 is won by the first slot');
select is(t071.rounds(110), '1:main:4 2:main:2', 'the last result creates Round 2 from the four winners, in match order');
select is((select string_agg(e.display_name, ',' order by m.position, s.position)
             from td_matches m join td_slots s on s.match_id = m.id join event_entries e on e.id = s.entry_id
            where m.round_id = (select id from td_rounds where event_id = t071.u(110) and position = 2)),
  'P3,P1,P8,P4', 'Round 2 pairs the winners P3-P1 and P8-P4');
select is(t071.confirm(110, 1, 4), 'ok', 'confirming a decided match again is a quiet no-op...');
select is(t071.rounds(110), '1:main:4 2:main:2', '...and advancement creates no second round');
select is(t071.decide(110, 2, 1, 2), 'ok', 'semi-final 1: P1 beats P3');
select is(t071.rounds(110), '1:main:4 2:main:2', 'the Final and the 3rd place match wait for the other semi-final');
select is(t071.decide(110, 2, 2, 1), 'ok', 'semi-final 2: P8 beats P4');
select is(t071.rounds(110), '1:main:4 2:main:2 3:third_place:1 4:main:1', 'both semi-finals decided: the 3rd place match and the Final exist together');
select is((select string_agg(e.display_name, ',' order by r.position, s.position)
             from td_rounds r join td_matches m on m.round_id = r.id join td_slots s on s.match_id = m.id join event_entries e on e.id = s.entry_id
            where r.event_id = t071.u(110) and r.position >= 3),
  'P3,P4,P1,P8', 'the 3rd place match is between the two semi-final losers, the Final between the winners');
select is(t071.decide(110, 4, 1, 1), 'ok', 'the Final is scoreable before the 3rd place match');
select is(t071.decide(110, 3, 1, 2), 'ok', 'and the 3rd place match after it');
select is(t071.rounds(110), '1:main:4 2:main:2 3:third_place:1 4:main:1', 'no round follows the Final');
select is(t071.winner(110, 4, 1) || '/' || t071.winner(110, 3, 1), 'P1/P4', 'champion P1, 3rd place P4, derived from the rows');
select is((select count(*)::int from td_matches where event_id = t071.u(110) and result_kind is null), 0, 'every match is decided');

-- ============ an odd field: the bye ============
select is(t071.start(120, 'random', 'seed-120', array[1,2,3,4,5,0]), 'ok', 'five competitors: the last pair is a bye');
select is(t071.rounds(120), '1:main:3', 'Round 1 has three matches');
select is((select result_kind from td_matches where id = t071.m(120, 1, 3)), 'bye', 'the bye is decided at once');
select is(t071.winner(120, 1, 3), 'P5', 'and the lone competitor advances');
select is(t071.decide(120, 1, 1, 1) || t071.decide(120, 1, 2, 2), 'okok', 'the two real matches are played');
select is(t071.rounds(120), '1:main:3 2:main:2', 'three winners make two matches, the last one a bye');
select is(t071.decide(120, 2, 1, 1), 'ok', 'P1 beats P4');
select is(t071.rounds(120), '1:main:3 2:main:2 3:main:1', 'no 3rd place match when a semi-final was a bye; the Final follows');
select is(t071.decide(120, 3, 1, 2), 'ok', 'the Final is won by the bye competitor');
select is(t071.winner(120, 3, 1), 'P5', 'champion P5');

-- ============ a manual draw ============
select is(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''manual'', ''{}'')', t071.u(100), t071.u(130))), 'ok', 'a manual setup');
select t071.contains(t071.start(130, 'manual', null, array[1,2,1,3]), '%td_draw_duplicate%', 'a competitor in two slots is refused on start as well as on selection');
select t071.contains(t071.start(130, 'manual', null, array[1,0,0,2]), '%td_draw_empty%', 'a draw with no real pair is refused');
select is(t071.start(130, 'manual', null, array[1,0, 0,2, 0,0, 3,4, 5,0]), 'ok', 'a manual draw with empty slots starts');
select is(t071.rounds(130), '1:main:4', 'the empty pair is dropped: four matches remain');
select is((select string_agg(coalesce(e.display_name, '-'), ',' order by m.position, s.position)
             from td_matches m join td_slots s on s.match_id = m.id left join event_entries e on e.id = s.entry_id
            where m.round_id = (select id from td_rounds where event_id = t071.u(130))),
  'P1,-,P2,-,P3,P4,P5,-', 'a lone name is a bye, and an opponent-only slot moves to the first position');
select is((select mode || '/' || coalesce(seed, 'none') from td_draws where event_id = t071.u(130)), 'manual/none', 'a manual draw records no seed');

-- ============ a walkover ============
select is(t071.start(140, 'random', 'seed-140', array[1,2,3,4]), 'ok', 'four competitors');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t071.u(100), t071.m(140, 1, 1), t071.s(140, 1, 2, 1))),
  '%td_slot_invalid%', 'a walkover names a slot of THAT match');
select is(t071.as_user(t071.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t071.u(100), t071.m(140, 1, 1), t071.s(140, 1, 1, 2))), 'ok',
  'P1 does not show: the opponent advances by walkover');
select is((select result_kind from td_matches where id = t071.m(140, 1, 1)) || '/' || t071.winner(140, 1, 1) || '/' || (select count(*) from td_votes where match_id = t071.m(140, 1, 1)),
  'walkover/P2/0', 'a walkover is its own result kind with no vote tally');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t071.u(100), t071.m(140, 1, 1), t071.s(140, 1, 1, 1))),
  '%td_match_decided%', 'no taps after a walkover');
select is(t071.decide(140, 1, 2, 1), 'ok', 'the other semi-final is played');
select is(t071.rounds(140), '1:main:2 2:main:1', 'no 3rd place match when a semi-final ended in a walkover');

-- ============ nobody writes directly; strangers see nothing ============
select t071.contains(t071.as_user(t071.u(1), format('insert into td_votes (event_id, match_id, slot_id) values (%L, %L, %L)', t071.u(110), t071.m(110, 1, 1), t071.s(110, 1, 1, 1))),
  '42501|%permission denied for table td_votes', 'a member cannot insert a vote directly');
select t071.contains(t071.as_user(t071.u(1), format('update td_matches set result_kind = ''votes'' where id = %L', t071.m(120, 3, 1))),
  '42501|%permission denied for table td_matches', 'a member cannot set a result directly');
select t071.contains(t071.as_user(t071.u(1), 'delete from td_votes'), '42501|%permission denied for table td_votes', 'a member cannot delete votes directly');
select is((select count(*)::int from information_schema.role_table_grants
            where grantee in ('anon', 'authenticated') and table_schema = 'public'
              and table_name in ('td_settings', 'td_draws', 'td_rounds', 'td_matches', 'td_slots', 'td_votes', 'td_match_results')
              and (grantee = 'anon' or privilege_type <> 'SELECT')), 0,
  'anon holds nothing on any Throwdown table, and signed-in members only SELECT');
select ok(t071.count_as(t071.u(1), 'td_votes') > 0 and t071.count_as(t071.u(1), 'td_matches') > 0, 'a member of the organisation reads its rows');
select is(t071.count_as(t071.u(2), 'td_matches') + t071.count_as(t071.u(2), 'td_votes') + t071.count_as(t071.u(2), 'td_slots')
          + t071.count_as(t071.u(2), 'td_rounds') + t071.count_as(t071.u(2), 'td_settings') + t071.count_as(t071.u(2), 'td_draws'),
  0, 'a non-member reads zero rows of every Throwdown table');
select t071.contains(t071.as_user(t071.u(2), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t071.u(100), t071.m(120, 3, 1), t071.s(120, 3, 1, 1))),
  '%event not found%', 'a stranger naming the other organisation is told only "not found"');
select t071.contains(t071.as_user(t071.u(2), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)', t071.u(200), t071.m(120, 3, 1))),
  '%event not found%', '...and so is one naming their own organisation with a foreign match');
select t071.contains(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t071.u(100), t071.u(160))),
  '%event not found%', 'the functions refuse an event of another format');

-- ============ the Per-event window lock reaches the functions too ============
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (t071.u(100), t071.u(150), 'per_event', now() - interval '10 days', now() - interval '5 days', 'manual');
update app.entitlement_keys set enforced = true where key = 'event_window_lock';
select is(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t071.u(100), t071.u(150))),
  '42501|event_window_locked||td_save_settings: this event is closed', 'an event whose Per-event window has ended is closed to the Throwdown functions as well');
update app.entitlement_keys set enforced = false where key = 'event_window_lock';
select is(t071.as_user(t071.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t071.u(100), t071.u(150))), 'ok',
  '...and with the lock switched off it is open again');

-- ============ structure ============
select throws_ok(format('update td_matches set event_id = %L where id = %L', t071.u(210), t071.m(120, 1, 1)), '23001', null, 'a match cannot move to another event');
select throws_ok(format('update td_votes set slot_id = %L where id = (select id from td_votes limit 1)', t071.s(120, 1, 1, 1)), '23001', null, 'a vote cannot be re-pointed');
select throws_ok(format('insert into td_slots (event_id, match_id, position) values (%L, %L, 3)', t071.u(120), t071.m(120, 1, 1)),
  'P0001', 'a pair match has exactly 2 slots', 'a pair match cannot take a third slot');

-- ============ deleting a test event removes its bracket ============
select is(t071.start(170, 'random', 'seed-170', array[1,2]), 'ok', 'a throwaway Throwdown starts');
select is(t071.as_user(t071.u(1), format('select public.delete_test_event(%L, %L)', t071.u(100), t071.u(170))), 'ok', 'and is deleted whole');
select is((select count(*)::int from td_rounds where event_id = t071.u(170)) + (select count(*)::int from td_slots where event_id = t071.u(170)), 0, 'with its rounds and slots');

select * from finish();
rollback;
