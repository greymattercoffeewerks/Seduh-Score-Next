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
--   * an odd field (a bye is decided at once and advances), a walkover (its own result kind; a walkover semi-final still gets a
--     3rd place match, a bye or a withdrawn loser does not), and idempotent advancement (a repeated confirm, and a direct re-run
--     of advancement, create no second round);
--   * nobody writes a td_* table directly, a non-member reads zero rows and every function answers "event not found",
--     every parent column is frozen, and a pair match cannot take a third slot.
begin;
select plan(139);

create schema t072;
grant usage on schema t072 to anon, authenticated;

create function t072.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000710' || lpad(n::text, 4, '0'))::uuid
$$;

-- "SQLSTATE|hint|detail|message" of a statement run as a signed-in person (the real `authenticated` role), or 'ok'
create function t072.as_user(uid uuid, stmt text) returns text language plpgsql as $$
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

create function t072.contains(res text, pat text, descr text) returns text language sql as $$
  select ok(res like pat, descr) || case when res like pat then '' else E'\n# got: ' || res end
$$;

-- rows a signed-in person can see (as `authenticated`, through row-level security)
create function t072.count_as(uid uuid, tbl text) returns int language plpgsql as $$
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
  (t072.u(1), 't072-a@test.seduh-next'), (t072.u(2), 't072-b@test.seduh-next');
insert into orgs (id, name, slug) values (t072.u(100), 'T071 A', 't072-a'), (t072.u(200), 'T071 B', 't072-b');
insert into org_members (org_id, user_id, role) values
  (t072.u(100), t072.u(1), 'owner'), (t072.u(200), t072.u(2), 'owner');
insert into events (id, org_id, format, name) values
  (t072.u(110), t072.u(100), 'throwdown', 'Throwdown 8'),
  (t072.u(120), t072.u(100), 'throwdown', 'Throwdown 5'),
  (t072.u(130), t072.u(100), 'throwdown', 'Throwdown manual'),
  (t072.u(140), t072.u(100), 'throwdown', 'Throwdown walkover'),
  (t072.u(150), t072.u(100), 'throwdown', 'Throwdown cap'),
  (t072.u(160), t072.u(100), 'cup_taster', 'A Cup Taster'),
  (t072.u(210), t072.u(200), 'throwdown', 'Other org');
insert into events (id, org_id, format, name, is_test) values (t072.u(170), t072.u(100), 'throwdown', 'Throwaway', true);
insert into events (id, org_id, format, name) values
  (t072.u(180), t072.u(100), 'throwdown', 'Throwdown leader'),
  (t072.u(190), t072.u(100), 'throwdown', 'Throwdown replay'),
  (t072.u(195), t072.u(100), 'throwdown', 'Throwdown no third place'),
  (t072.u(200), t072.u(100), 'throwdown', 'Throwdown walkover semi'),
  (t072.u(201), t072.u(100), 'throwdown', 'Throwdown withdrawn loser'),
  (t072.u(202), t072.u(100), 'throwdown', 'Throwdown withdrawn winner'),
  (t072.u(203), t072.u(100), 'throwdown', 'Throwdown withdrawn no-show'),
  (t072.u(204), t072.u(100), 'throwdown', 'Throwdown two walkovers');
-- competitors: event 110 -> entries 1..8 (ids 1101..1108), 120 -> 5, 130 -> 6, 140 -> 4, 210 -> 2
insert into event_entries (id, event_id, display_name)
select t072.u(e.ev * 10 + n), t072.u(e.ev), 'P' || n
  from (values (110, 8), (120, 5), (130, 6), (140, 4), (170, 2), (180, 2), (190, 2), (195, 4), (200, 4), (201, 4), (202, 4), (203, 4), (204, 4), (210, 2)) e(ev, cnt), generate_series(1, 8) n
 where n <= e.cnt;

-- reads the winner's display name of a match by position (null while undecided)
create function t072.winner(ev int, rnd int, mpos int) returns text language sql stable as $$
  select e.display_name
    from public.td_rounds r
    join public.td_matches m on m.round_id = r.id and m.position = mpos
    join public.td_match_results x on x.match_id = m.id
    join public.td_slots s on s.id = x.winner_slot_id
    join public.event_entries e on e.id = s.entry_id
   where r.event_id = t072.u(ev) and r.position = rnd
$$;
-- the id of a match / slot by (event, round position, match position[, slot position])
create function t072.m(ev int, rnd int, mpos int) returns uuid language sql stable as $$
  select m.id from public.td_rounds r join public.td_matches m on m.round_id = r.id and m.position = mpos
   where r.event_id = t072.u(ev) and r.position = rnd
$$;
create function t072.s(ev int, rnd int, mpos int, spos int) returns uuid language sql stable as $$
  select s.id from public.td_slots s where s.match_id = t072.m(ev, rnd, mpos) and s.position = spos
$$;
-- user 1 taps `n` times for slot `spos` of a match
create function t072.tap(ev int, rnd int, mpos int, spos int, n int) returns void language plpgsql as $$
declare i int; r text;
begin
  for i in 1 .. n loop
    r := t072.as_user(t072.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)',
      t072.u(100), t072.m(ev, rnd, mpos), t072.s(ev, rnd, mpos, spos)));
    if r <> 'ok' then raise exception 'tap failed: %', r; end if;
  end loop;
end $$;
create function t072.confirm(ev int, rnd int, mpos int) returns text language sql as $$
  select t072.as_user(t072.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)',
    t072.u(100), t072.m(ev, rnd, mpos)))
$$;
-- the match is won 2-1 by the competitor in slot `spos`
create function t072.decide(ev int, rnd int, mpos int, spos int) returns text language plpgsql as $$
begin
  perform t072.tap(ev, rnd, mpos, spos, 2);
  perform t072.tap(ev, rnd, mpos, 3 - spos, 1);
  return t072.confirm(ev, rnd, mpos);
end $$;
create function t072.rounds(ev int) returns text language sql stable as $$
  select coalesce(string_agg(r.position || ':' || r.phase || ':' || (select count(*) from public.td_matches m where m.round_id = r.id),
                             ' ' order by r.position), 'none')
    from public.td_rounds r where r.event_id = t072.u(ev)
$$;
-- [[e1,e2],[e3,e4],...] from entry numbers (0 = empty) of event ev
create function t072.pairs(ev int, nums int[]) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_array(
           case when nums[i] = 0 then null else t072.u(ev * 10 + nums[i]) end,
           case when nums[i + 1] = 0 then null else t072.u(ev * 10 + nums[i + 1]) end))
    from generate_series(1, array_length(nums, 1), 2) i
$$;
create function t072.start(ev int, mode text, seed text, nums int[]) returns text language sql as $$
  select t072.as_user(t072.u(1), format('select public.td_start_event(gen_random_uuid(), %L, %L, %L, %L, %s, %L)',
    t072.u(100), t072.u(ev), mode, seed, array_length(nums, 1), t072.pairs(ev, nums)))
$$;

-- ============ the cap: throwdown_participants, Community 8 ============
update app.entitlement_keys set enforced = true where key in ('throwdown_participants', 'cup_taster_participants');
select is(t072.as_user(t072.u(1), (select string_agg(format('insert into event_entries (event_id, display_name) values (%L, %L)', t072.u(150), 'C' || n), '; ')
                                    from generate_series(1, 8) n)), 'ok',
  'a Community Throwdown takes eight competitors');
select is(t072.as_user(t072.u(1), format('insert into event_entries (event_id, display_name) values (%L, ''C9'')', t072.u(150))),
  '42501|entitlement_cap_reached|throwdown_participants|entitlement_cap_reached',
  'the ninth active competitor is refused with the Throwdown key in the detail');
update event_entries set withdrawn = true where event_id = t072.u(150) and display_name = 'C1';
select is(t072.as_user(t072.u(1), format('insert into event_entries (event_id, display_name) values (%L, ''C9'')', t072.u(150))), 'ok',
  'a withdrawn competitor does not count toward the cap');
select is(t072.as_user(t072.u(1), (select string_agg(format('insert into event_entries (event_id, display_name) values (%L, %L)', t072.u(160), 'T' || n), '; ')
                                    from generate_series(1, 8) n)), 'ok',
  'a Cup Taster event still has its own key and its own eight');
select is(t072.as_user(t072.u(1), format('insert into event_entries (event_id, display_name) values (%L, ''T9'')', t072.u(160))),
  '42501|entitlement_cap_reached|cup_taster_participants|entitlement_cap_reached',
  '...and the ninth is refused under the Cup Taster key');
update app.entitlement_keys set enforced = false where key in ('throwdown_participants', 'cup_taster_participants');

-- ============ setup and the module toggle mechanism ============
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(110))), 'ok',
  'the organiser saves the setup');
select is((select judge_count || '/' || third_place || '/' || seeding_mode || '/' || modules::text from td_settings where event_id = t072.u(110)),
  '3/true/random/{}', 'the setup is stored');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 0, true, ''random'', ''{}'')', t072.u(100), t072.u(110))),
  '%td_judge_count_invalid%', 'a judge count of zero is refused');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''dice'', ''{}'')', t072.u(100), t072.u(110))),
  '%td_seeding_invalid%', 'an unknown seeding mode is refused');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{"redemption": true}'')', t072.u(100), t072.u(110))),
  '%td_module_unknown%', 'no module exists in TD.1: enabling any key is refused with a reason, not ignored');
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 5, false, ''random'', ''{"redemption": false}'')', t072.u(100), t072.u(110))), 'ok',
  'a module toggled OFF is accepted...');
select is((select modules::text from td_settings where event_id = t072.u(110)), '{}', '...and leaves no trace in the stored setup');
select t072.contains(t072.as_user(t072.u(1), format('insert into td_settings (event_id) values (%L)', t072.u(120))),
  '42501|%permission denied for table td_settings', 'a client cannot write a setup row directly');
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(110))), 'ok',
  'setup back to three judges with the 3rd place match on');

-- ============ the draw, 8 competitors, random ============
select t072.contains(t072.start(110, 'manual', null, array[1,2,3,4,5,6,7,8]), '%td_seeding_mismatch%', 'a draw mode that differs from the setup is refused');
select t072.contains(t072.start(110, 'random', null, array[1,2,3,4,5,6,7,8]), '%td_seed_invalid%', 'a random draw without its seed is refused');
select t072.contains(t072.start(110, 'random', 'seed-110', array[1,2,3,4,5,6,7]), '%td_draw_empty%', 'a slot count that does not match the pairs is refused');
select t072.contains(t072.start(110, 'random', 'seed-110', array[1,2,3,4,5,6]), '%td_draw_incomplete%', 'a random draw must place every active competitor');
select t072.contains(t072.start(110, 'random', 'seed-110', array[1,2,3,4,5,6,7,1]), '%td_draw_duplicate%', 'a competitor can fill only one slot');
select t072.contains(t072.start(110, 'random', 'seed-110', array[1,2,3,4,5,6,7,1001]), '%td_draw_entry%', 'a competitor of another event is refused');
select is(t072.start(110, 'random', 'seed-110', array[3,7,1,5,2,8,4,6]), 'ok', 'the random draw starts Round 1');
select is(t072.rounds(110), '1:main:4', 'Round 1 has four matches');
select is((select seed || '/' || mode || '/' || slot_count from td_draws where event_id = t072.u(110)), 'seed-110/random/8', 'the shuffle seed is recorded with the draw');
select t072.contains(t072.start(110, 'random', 'seed-110', array[3,7,1,5,2,8,4,6]), '%td_already_started%', 'a second start is refused');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(110))),
  '23001|td_setup_locked%', 'setup is locked once Round 1 has started');
select is((select count(*)::int from td_matches where event_id = t072.u(110) and result_kind is not null), 0, 'no match is decided at the start');
select is(t072.rounds(110), '1:main:4', 'and the later rounds do not exist yet: nothing is projected');

-- ============ voting and confirming ============
select t072.contains(t072.confirm(110, 1, 1), '%td_votes_level%', 'confirm is refused while the votes are level (0-0)');

select is(t072.winner(110, 1, 1), null, 'an undecided match has no winner (no inferred one)');
select t072.tap(110, 1, 1, 1, 1);
select t072.tap(110, 1, 1, 2, 1);
select t072.contains(t072.confirm(110, 1, 1), '%td_votes_level%', 'confirm is still refused at 1-1');
select is((select count(*)::int from td_votes where match_id = t072.m(110, 1, 1)), 2, 'votes are rows, one per tap, with no judge identity');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'td_votes'),
  'created_at,event_id,id,match_id,slot_id', 'and a vote row has no judge column at all: only the slot it counts for');
select t072.tap(110, 1, 1, 1, 1);
select is(t072.confirm(110, 1, 1), 'ok', 'confirm succeeds at 2-1');
select is(t072.winner(110, 1, 1), 'P3', 'the majority winner is derived from the vote rows');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(110, 1, 1), t072.s(110, 1, 1, 2))),
  '%td_match_decided%', 'a decided match takes no more taps');

-- undo, and a replayed tap counts once
select t072.tap(110, 1, 2, 2, 2);
select t072.tap(110, 1, 2, 1, 1);
select is(t072.as_user(t072.u(1), format('select public.td_undo_vote(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(110, 1, 2), t072.s(110, 1, 2, 2))), 'ok',
  'a tap can be taken back');
select t072.contains(t072.confirm(110, 1, 2), '%td_votes_level%', '...which leaves it level again (1-1)');
select is(t072.as_user(t072.u(1), format('select public.td_cast_vote(%L, %L, %L, %L); select public.td_cast_vote(%L, %L, %L, %L)',
    t072.u(9001), t072.u(100), t072.m(110, 1, 2), t072.s(110, 1, 2, 1), t072.u(9001), t072.u(100), t072.m(110, 1, 2), t072.s(110, 1, 2, 1))), 'ok',
  'the same operation replayed...');
select is((select count(*)::int from td_votes where slot_id = t072.s(110, 1, 2, 1)), 2, '...counts once (an outbox replay cannot double a tap)');
select is(t072.confirm(110, 1, 2), 'ok', 'P1 wins 2-1');
select is(t072.winner(110, 1, 2), 'P1', '...derived from the rows');
select is(t072.decide(110, 1, 3, 2), 'ok', 'match 3 is won by the second slot');
select is(t072.rounds(110), '1:main:4', 'Round 2 does not exist while a Round 1 match is undecided');
select is(t072.decide(110, 1, 4, 1), 'ok', 'match 4 is won by the first slot');
select is(t072.rounds(110), '1:main:4 2:main:2', 'the last result creates Round 2 from the four winners, in match order');
select is((select string_agg(e.display_name, ',' order by m.position, s.position)
             from td_matches m join td_slots s on s.match_id = m.id join event_entries e on e.id = s.entry_id
            where m.round_id = (select id from td_rounds where event_id = t072.u(110) and position = 2)),
  'P3,P1,P8,P4', 'Round 2 pairs the winners P3-P1 and P8-P4');
select is(t072.confirm(110, 1, 4), 'ok', 'confirming a decided match again is a quiet no-op...');
select is(t072.rounds(110), '1:main:4 2:main:2', '...and advancement creates no second round');
select is(t072.decide(110, 2, 1, 2), 'ok', 'semi-final 1: P1 beats P3');
select is(t072.rounds(110), '1:main:4 2:main:2', 'the Final and the 3rd place match wait for the other semi-final');
select is(t072.decide(110, 2, 2, 1), 'ok', 'semi-final 2: P8 beats P4');
select is(t072.rounds(110), '1:main:4 2:main:2 3:third_place:1 4:main:1', 'both semi-finals decided: the 3rd place match and the Final exist together');
select is((select string_agg(e.display_name, ',' order by r.position, s.position)
             from td_rounds r join td_matches m on m.round_id = r.id join td_slots s on s.match_id = m.id join event_entries e on e.id = s.entry_id
            where r.event_id = t072.u(110) and r.position >= 3),
  'P3,P4,P1,P8', 'the 3rd place match is between the two semi-final losers, the Final between the winners');
select is(t072.decide(110, 4, 1, 1), 'ok', 'the Final is scoreable before the 3rd place match');
select is(t072.decide(110, 3, 1, 2), 'ok', 'and the 3rd place match after it');
select is(t072.rounds(110), '1:main:4 2:main:2 3:third_place:1 4:main:1', 'no round follows the Final');
select is(t072.winner(110, 4, 1) || '/' || t072.winner(110, 3, 1), 'P1/P4', 'champion P1, 3rd place P4, derived from the rows');
select is((select count(*)::int from td_matches where event_id = t072.u(110) and result_kind is null), 0, 'every match is decided');

-- ============ an odd field: the bye ============
select is(t072.start(120, 'random', 'seed-120', array[1,2,3,4,5,0]), 'ok', 'five competitors: the last pair is a bye');
select is(t072.rounds(120), '1:main:3', 'Round 1 has three matches');
select is((select result_kind from td_matches where id = t072.m(120, 1, 3)), 'bye', 'the bye is decided at once');
select is(t072.winner(120, 1, 3), 'P5', 'and the lone competitor advances');
select is(t072.decide(120, 1, 1, 1) || t072.decide(120, 1, 2, 2), 'okok', 'the two real matches are played');
select is(t072.rounds(120), '1:main:3 2:main:2', 'three winners make two matches, the last one a bye');
select is((select result_kind from td_matches where id = t072.m(120, 2, 2)), 'bye', 'and that match is a decided bye');
select is(t072.decide(120, 2, 1, 1), 'ok', 'P1 beats P4');
select is(t072.rounds(120), '1:main:3 2:main:2 3:main:1', 'no 3rd place match when a semi-final was a bye; the Final follows');
select is(t072.decide(120, 3, 1, 2), 'ok', 'the Final is won by the bye competitor');
select is(t072.winner(120, 3, 1), 'P5', 'champion P5');

-- ============ a manual draw ============
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''manual'', ''{}'')', t072.u(100), t072.u(130))), 'ok', 'a manual setup');
select t072.contains(t072.start(130, 'manual', null, array[1,2,1,3]), '%td_draw_duplicate%', 'a competitor in two slots is refused on start as well as on selection');
select t072.contains(t072.start(130, 'manual', null, array[1,0,0,2]), '%td_draw_empty%', 'a draw with no real pair is refused');
select is(t072.start(130, 'manual', null, array[1,0, 0,2, 0,0, 3,4, 5,0]), 'ok', 'a manual draw with empty slots starts');
select is(t072.rounds(130), '1:main:4', 'the empty pair is dropped: four matches remain');
select is((select string_agg(coalesce(e.display_name, '-'), ',' order by m.position, s.position)
             from td_matches m join td_slots s on s.match_id = m.id left join event_entries e on e.id = s.entry_id
            where m.round_id = (select id from td_rounds where event_id = t072.u(130))),
  'P1,-,P2,-,P3,P4,P5,-', 'a lone name is a bye, and an opponent-only slot moves to the first position');
select is((select mode || '/' || coalesce(seed, 'none') from td_draws where event_id = t072.u(130)), 'manual/none', 'a manual draw records no seed');

-- ============ a walkover ============
select is(t072.start(140, 'random', 'seed-140', array[1,2,3,4]), 'ok', 'four competitors');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(140, 1, 1), t072.s(140, 1, 2, 1))),
  '%td_slot_invalid%', 'a walkover names a slot of THAT match');
select is(t072.as_user(t072.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(140, 1, 1), t072.s(140, 1, 1, 2))), 'ok',
  'P1 does not show: the opponent advances by walkover');
select is((select result_kind from td_matches where id = t072.m(140, 1, 1)) || '/' || t072.winner(140, 1, 1) || '/' || (select count(*) from td_votes where match_id = t072.m(140, 1, 1)),
  'walkover/P2/0', 'a walkover is its own result kind with no vote tally');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(140, 1, 1), t072.s(140, 1, 1, 1))),
  '%td_match_decided%', 'no taps after a walkover');
select is(t072.decide(140, 1, 2, 1), 'ok', 'the other semi-final is played');
select is(t072.rounds(140), '1:main:2 2:third_place:1 3:main:1', 'a semi-final decided by walkover still gets a 3rd place match: both losers exist and are active');

-- ============ the 3rd place match after a walkover (owner decision 2026-11-03) ============
select is(t072.start(200, 'random', 'seed-200', array[1,2,3,4]), 'ok', 'four competitors start');
select is(t072.as_user(t072.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(200, 1, 1), t072.s(200, 1, 1, 2))), 'ok',
  'semi-final 1 is a walkover: the second competitor advances');
select is(t072.decide(200, 1, 2, 1), 'ok', 'semi-final 2 is played');
select is(t072.rounds(200), '1:main:2 2:third_place:1 3:main:1', 'the walkover loser and the semi-final 2 loser play the 3rd place match, with the Final live beside it');
select is((select string_agg(e.display_name, ',' order by s.position)
             from td_slots s join event_entries e on e.id = s.entry_id
            where s.match_id = t072.m(200, 2, 1)),
  'P1,P4', 'the 3rd place match is between the walkover loser (P1) and the other loser (P4)');
select is(t072.confirm(200, 1, 2), 'ok', 'confirming a decided semi-final again...');
select is(t072.rounds(200), '1:main:2 2:third_place:1 3:main:1', '...creates nothing: advancement is idempotent');

-- a withdrawn loser means no 3rd place match (both losers must be active)
select is(t072.start(201, 'random', 'seed-201', array[1,2,3,4]), 'ok', 'four competitors start (second event)');
update event_entries set withdrawn = true where id = t072.u(2012);
select is(t072.decide(201, 1, 1, 1) || t072.decide(201, 1, 2, 1), 'okok', 'both semi-finals are played, the loser P2 having withdrawn');
select is(t072.rounds(201), '1:main:2 2:main:1', 'a withdrawn loser blocks the 3rd place match: only the Final follows');

-- the check is about the LOSERS: a withdrawn semi-final WINNER does not block the 3rd place match
create function t072.walk(ev int, rnd int, mpos int, spos int) returns text language sql as $$
  select t072.as_user(t072.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)',
    t072.u(100), t072.m(ev, rnd, mpos), t072.s(ev, rnd, mpos, spos)))
$$;
select is(t072.start(202, 'random', 'seed-202', array[1,2,3,4]), 'ok', 'four competitors start (withdrawn winner)');
select is(t072.decide(202, 1, 1, 2), 'ok', 'semi-final 1: P2 wins');
update event_entries set withdrawn = true where id = t072.u(2022);
select is(t072.decide(202, 1, 2, 1), 'ok', 'semi-final 2: P3 wins, after the winner P2 withdrew');
select is(t072.rounds(202), '1:main:2 2:third_place:1 3:main:1', 'a withdrawn WINNER does not block the 3rd place match: only the losers are asked');

-- a walkover whose no-show has been withdrawn (the usual real case) gets no 3rd place match
select is(t072.start(203, 'random', 'seed-203', array[1,2,3,4]), 'ok', 'four competitors start (withdrawn no-show)');
update event_entries set withdrawn = true where id = t072.u(2031);
select is(t072.walk(203, 1, 1, 2), 'ok', 'semi-final 1 is a walkover after P1 withdrew');
select is(t072.decide(203, 1, 2, 1), 'ok', 'semi-final 2 is played');
select is(t072.rounds(203), '1:main:2 2:main:1', 'a withdrawn no-show means no 3rd place match');

-- a walkover in both semi-finals: the 3rd place match is between the two no-shows
select is(t072.start(204, 'random', 'seed-204', array[1,2,3,4]), 'ok', 'four competitors start (two walkovers)');
select is(t072.walk(204, 1, 1, 2) || t072.walk(204, 1, 2, 2), 'okok', 'both semi-finals are walkovers');
select is(t072.rounds(204), '1:main:2 2:third_place:1 3:main:1', 'both walkovers: the 3rd place match and the Final exist');
select is((select string_agg(e.display_name, ',' order by s.position)
             from td_slots s join event_entries e on e.id = s.entry_id
            where s.match_id = t072.m(204, 2, 1)),
  'P1,P3', 'the 3rd place match is between the two no-shows');

-- advancement itself, run again directly (a repeated confirm returns before reaching it)
do $$ begin perform app.td_advance(t072.u(200)); end $$;
select is(t072.rounds(200), '1:main:2 2:third_place:1 3:main:1', 'a direct second run of advancement creates nothing');

-- ============ nobody writes directly; strangers see nothing ============
select t072.contains(t072.as_user(t072.u(1), format('insert into td_votes (event_id, match_id, slot_id) values (%L, %L, %L)', t072.u(110), t072.m(110, 1, 1), t072.s(110, 1, 1, 1))),
  '42501|%permission denied for table td_votes', 'a member cannot insert a vote directly');
select t072.contains(t072.as_user(t072.u(1), format('update td_matches set result_kind = ''votes'' where id = %L', t072.m(120, 3, 1))),
  '42501|%permission denied for table td_matches', 'a member cannot set a result directly');
select t072.contains(t072.as_user(t072.u(1), 'delete from td_votes'), '42501|%permission denied for table td_votes', 'a member cannot delete votes directly');
select is((select count(*)::int from information_schema.role_table_grants
            where grantee in ('anon', 'authenticated') and table_schema = 'public'
              and table_name in ('td_settings', 'td_draws', 'td_rounds', 'td_matches', 'td_slots', 'td_votes', 'td_match_results')
              and (grantee = 'anon' or privilege_type <> 'SELECT')), 0,
  'anon holds nothing on any Throwdown table, and signed-in members only SELECT');
select ok(t072.count_as(t072.u(1), 'td_votes') > 0 and t072.count_as(t072.u(1), 'td_matches') > 0, 'a member of the organisation reads its rows');
select is(t072.count_as(t072.u(2), 'td_match_results') + t072.count_as(t072.u(2), 'td_matches') + t072.count_as(t072.u(2), 'td_votes') + t072.count_as(t072.u(2), 'td_slots')
          + t072.count_as(t072.u(2), 'td_rounds') + t072.count_as(t072.u(2), 'td_settings') + t072.count_as(t072.u(2), 'td_draws'),
  0, 'a non-member reads zero rows of every Throwdown table');
select t072.contains(t072.as_user(t072.u(2), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(120, 3, 1), t072.s(120, 3, 1, 1))),
  '%event not found%', 'a stranger naming the other organisation is told only "not found"');
select t072.contains(t072.as_user(t072.u(2), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)', t072.u(200), t072.m(120, 3, 1))),
  '%event not found%', '...and so is one naming their own organisation with a foreign match');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(160))),
  '%event not found%', 'the functions refuse an event of another format');

-- ============ the Per-event window lock reaches the functions too ============
insert into entitlement_grants (org_id, event_id, tier, valid_from, valid_until, source)
  values (t072.u(100), t072.u(150), 'per_event', now() - interval '10 days', now() - interval '5 days', 'manual');
update app.entitlement_keys set enforced = true where key = 'event_window_lock';
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(150))),
  '42501|event_window_locked||td_save_settings: this event is closed', 'an event whose Per-event window has ended is closed to the Throwdown functions as well');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(110))),
  '23001|td_setup_locked%', 'an open event is not closed by the window guard: it reaches its own rule (setup locked)');
update app.entitlement_keys set enforced = false where key = 'event_window_lock';
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, true, ''random'', ''{}'')', t072.u(100), t072.u(150))), 'ok',
  '...and with the lock switched off it is open again');

-- ============ replays, the leader check, and the 3rd place switch ============
-- replay of one undo operation takes back ONE vote
select is(t072.start(180, 'random', 'seed-180', array[1,2]), 'ok', 'a two-competitor event starts');
select t072.tap(180, 1, 1, 1, 2);
select is(t072.as_user(t072.u(1), format('select public.td_undo_vote(%L, %L, %L, %L); select public.td_undo_vote(%L, %L, %L, %L)',
    t072.u(9002), t072.u(100), t072.m(180, 1, 1), t072.s(180, 1, 1, 1), t072.u(9002), t072.u(100), t072.m(180, 1, 1), t072.s(180, 1, 1, 1))), 'ok',
  'the same undo operation replayed...');
select is((select count(*)::int from td_votes where slot_id = t072.s(180, 1, 1, 1)), 1, '...takes back one vote, not two');
select t072.tap(180, 1, 1, 1, 1);
select t072.contains(t072.as_user(t072.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(180, 1, 1), t072.s(180, 1, 1, 2))),
  '%td_leader_changed%', 'a confirm that expected the other competitor to lead is refused');
select is(t072.as_user(t072.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(180, 1, 1), t072.s(180, 1, 1, 1))), 'ok',
  'and one that expected the real leader is committed');

-- a walkover and a draw replayed with the same operation id do nothing the second time
select is(t072.as_user(t072.u(1), format('select public.td_start_event(%L, %L, %L, ''random'', ''seed-190'', 2, %L); select public.td_start_event(%L, %L, %L, ''random'', ''seed-190'', 2, %L)',
    t072.u(9003), t072.u(100), t072.u(190), t072.pairs(190, array[1,2]), t072.u(9003), t072.u(100), t072.u(190), t072.pairs(190, array[1,2]))), 'ok',
  'the same draw operation replayed is not "already started"');
select is(t072.as_user(t072.u(1), format('select public.td_record_walkover(%L, %L, %L, %L); select public.td_record_walkover(%L, %L, %L, %L)',
    t072.u(9004), t072.u(100), t072.m(190, 1, 1), t072.s(190, 1, 1, 1), t072.u(9004), t072.u(100), t072.m(190, 1, 1), t072.s(190, 1, 1, 1))), 'ok',
  'the same walkover operation replayed is a quiet no-op');
select t072.contains(t072.as_user(t072.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t072.u(100), t072.m(190, 1, 1), t072.s(190, 1, 1, 2))),
  '%td_match_decided%', 'but a DIFFERENT walkover operation on the decided match is refused');

-- the 3rd place switch: off means no 3rd place match
select is(t072.as_user(t072.u(1), format('select public.td_save_settings(%L, %L, 3, false, ''random'', ''{}'')', t072.u(100), t072.u(195))), 'ok', '3rd place switched off');
select is(t072.start(195, 'random', 'seed-195', array[1,2,3,4]), 'ok', 'four competitors start');
select is(t072.decide(195, 1, 1, 1) || t072.decide(195, 1, 2, 1), 'okok', 'both semi-finals are played');
select is(t072.rounds(195), '1:main:2 2:main:1', 'with the switch off only the Final follows (no 3rd place round)');

-- ============ structure ============
select throws_ok(format('update td_matches set event_id = %L where id = %L', t072.u(210), t072.m(120, 1, 1)), '23001', null, 'a match cannot move to another event');
select throws_ok(format('update td_votes set slot_id = %L where id = (select id from td_votes limit 1)', t072.s(120, 1, 1, 1)), '23001', null, 'a vote cannot be re-pointed');
select throws_ok(format('update td_rounds set event_id = %L where id = (select round_id from td_matches where id = %L)', t072.u(210), t072.m(120, 1, 1)), '23001', null, 'a round cannot move to another event');
select throws_ok(format('update td_slots set match_id = %L where id = %L', t072.m(110, 1, 1), t072.s(120, 1, 1, 1)), '23001', null, 'a slot cannot be moved to another match');
select throws_ok(format('update td_settings set event_id = %L where event_id = %L', t072.u(210), t072.u(110)), '23001', null, 'a setup row cannot move to another event');
select throws_ok(format('insert into td_slots (event_id, match_id, position) values (%L, %L, 3)', t072.u(120), t072.m(120, 1, 1)),
  'P0001', 'a pair match has exactly 2 slots', 'a pair match cannot take a third slot');

-- ============ deleting a test event removes its bracket ============
select is(t072.start(170, 'random', 'seed-170', array[1,2]), 'ok', 'a throwaway Throwdown starts');
select is(t072.as_user(t072.u(1), format('select public.delete_test_event(%L, %L)', t072.u(100), t072.u(170))), 'ok', 'and is deleted whole');
select is((select count(*)::int from td_rounds where event_id = t072.u(170)) + (select count(*)::int from td_slots where event_id = t072.u(170)), 0, 'with its rounds and slots');

select * from finish();
rollback;
