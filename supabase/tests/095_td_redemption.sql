-- Throwdown TD.3: the redemption module (migration 20261201100000; owner decisions 2026-11-03 and 2026-11-27).
-- Proves, as the REAL roles through RLS and the SECURITY DEFINER functions:
--   * setup: the module is stored as exactly { group_size, cap, feed }; bad values are refused with td_redemption_invalid;
--     a module that is off leaves no trace; the registry holds two modules;
--   * group sizes: ceil(pool / size) groups, as even as possible, never a group of one (the helper app.td_group_sizes);
--   * a redemption round exists only after a feeding round the organiser chose is fully decided, only when more than four
--     winners remain, and holds exactly the active losers, drawn into POOL matches of 2 to 4 slots;
--   * with the module off, or the round not chosen, or too few winners left, NOTHING is created (no trace);
--   * the pool vote uses the pair's table, view and functions: strictly the most votes wins, level votes cannot be
--     confirmed, and the one tie-break vote goes only to a brewer who is in the tie (td_tiebreak_slot);
--   * group winners rejoin the main round's winners; the cap limits how many return (0 = all), most votes first;
--   * several redemption rounds in one event, and a brewer revived more than once (no one-redemption rule);
--   * td_advance is idempotent, and is not callable by an API role;
--   * undo: a main match before a redemption round, and a redemption match, remove the rounds after them while none has
--     started, and are refused once a later round has a tap;
--   * a walkover in a group names its winner; a withdrawn loser is left out of the draw.
begin;
select plan(131);

create schema t095;
grant usage on schema t095 to anon, authenticated;

create function t095.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000950' || lpad(n::text, 4, '0'))::uuid
$$;

create function t095.as_user(uid uuid, stmt text) returns text language plpgsql as $$
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

create function t095.contains(res text, pat text, descr text) returns text language sql as $$
  select ok(res like pat, descr) || case when res like pat then '' else E'\n# got: ' || res end
$$;

-- user 1 organises org 3; user 2 organises org 4 (a non-member of org 3)
insert into auth.users (id, email) values (t095.u(1), 't095-a@test.seduh-next'), (t095.u(2), 't095-b@test.seduh-next');
insert into orgs (id, name, slug) values (t095.u(3), 'T095 A', 't095-a'), (t095.u(4), 'T095 B', 't095-b');
insert into org_members (org_id, user_id, role) values (t095.u(3), t095.u(1), 'owner'), (t095.u(4), t095.u(2), 'owner');
-- events: 10 = 12 players; 11 = 16 (two redemption rounds); 12 = 16 (a cap); 13 = 16 (a tie-break among four judges);
-- 14 = 8 (too few winners); 15 = 12 (module off); 16 = 12 (undo); 17 = 12 (walkover in a group)
insert into events (id, org_id, format, name)
select t095.u(e.ev), t095.u(3), 'throwdown', 'Redemption ' || e.ev
  from (values (10), (11), (12), (13), (14), (15), (16), (17), (18)) e(ev);
insert into event_entries (id, event_id, display_name)
select t095.u(e.ev * 100 + n), t095.u(e.ev), 'P' || lpad(n::text, 2, '0')
  from (values (10, 12), (11, 16), (12, 16), (13, 16), (14, 8), (15, 12), (16, 12), (17, 12), (18, 12)) e(ev, cnt),
       generate_series(1, 16) n
 where n <= e.cnt;

create function t095.m(ev int, rnd int, mpos int) returns uuid language sql stable as $$
  select m.id from public.td_rounds r join public.td_matches m on m.round_id = r.id and m.position = mpos
   where r.event_id = t095.u(ev) and r.position = rnd
$$;
create function t095.s(ev int, rnd int, mpos int, spos int) returns uuid language sql stable as $$
  select s.id from public.td_slots s where s.match_id = t095.m(ev, rnd, mpos) and s.position = spos
$$;
create function t095.rounds(ev int) returns text language sql stable as $$
  select coalesce(string_agg(r.position || ':' || r.phase || ':' || (select count(*) from public.td_matches m where m.round_id = r.id),
                             ' ' order by r.position), 'none')
    from public.td_rounds r where r.event_id = t095.u(ev)
$$;
create function t095.settings(ev int, judges int, modules text default '{}') returns text language sql as $$
  select t095.as_user(t095.u(1), format('select public.td_save_settings(%L, %L, %s, true, ''random'', %L)', t095.u(3), t095.u(ev), judges, modules))
$$;
create function t095.start(ev int, n int) returns text language sql as $$
  select t095.as_user(t095.u(1), format('select public.td_start_event(gen_random_uuid(), %L, %L, ''random'', %L, %s, %L)',
    t095.u(3), t095.u(ev), 'seed-' || ev, n,
    (select jsonb_agg(jsonb_build_array(t095.u(ev * 100 + i), t095.u(ev * 100 + i + 1))) from generate_series(1, n, 2) i)))
$$;
create function t095.tap_slot(slot uuid, match uuid, n int) returns text language plpgsql as $$
declare i int; r text;
begin
  for i in 1 .. n loop
    r := t095.as_user(t095.u(1), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t095.u(3), match, slot));
    if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
create function t095.confirm_match(match uuid) returns text language sql as $$
  select t095.as_user(t095.u(1), format('select public.td_confirm_match(gen_random_uuid(), %L, %L)', t095.u(3), match))
$$;
-- a match is won by the slot at `wpos`: it gets `w` taps and the first other slot gets `o`
create function t095.decide_match(match uuid, wpos int, w int default 2, o int default 1) returns text language plpgsql as $$
declare r text; ws uuid; os uuid;
begin
  select id into ws from public.td_slots where match_id = match and position = wpos;
  select id into os from public.td_slots where match_id = match and position <> wpos order by position limit 1;
  r := t095.tap_slot(ws, match, w); if r <> 'ok' then return r; end if;
  if o > 0 then r := t095.tap_slot(os, match, o); if r <> 'ok' then return r; end if; end if;
  return t095.confirm_match(match);
end $$;
-- every match of a round is won by the slot at `wpos` (an unfinished round returns the first refusal)
create function t095.decide_round(ev int, rnd int, wpos int, w int default 2, o int default 1) returns text language plpgsql as $$
declare mid uuid; r text;
begin
  for mid in select m.id from public.td_matches m join public.td_rounds rr on rr.id = m.round_id
              where rr.event_id = t095.u(ev) and rr.position = rnd order by m.position loop
    r := t095.decide_match(mid, wpos, w, o);
    if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
-- a round decided so that `entry` wins the match it is in; every other match is won by slot 1
create function t095.decide_for(ev int, rnd int, entry uuid) returns text language plpgsql as $$
declare mid uuid; r text; wpos int;
begin
  for mid in select m.id from public.td_matches m join public.td_rounds rr on rr.id = m.round_id
              where rr.event_id = t095.u(ev) and rr.position = rnd order by m.position loop
    wpos := coalesce((select s.position from public.td_slots s where s.match_id = mid and s.entry_id = entry), 1);
    r := t095.decide_match(mid, wpos);
    if r <> 'ok' then return r; end if;
  end loop;
  return 'ok';
end $$;
create function t095.names(match uuid) returns text language sql stable as $$
  select string_agg(e.display_name, ',' order by e.display_name)
    from public.td_slots s join public.event_entries e on e.id = s.entry_id where s.match_id = match
$$;
create function t095.round_names(ev int, rnd int) returns text language sql stable as $$
  select string_agg(e.display_name, ',' order by e.display_name)
    from public.td_rounds r join public.td_matches m on m.round_id = r.id join public.td_slots s on s.match_id = m.id
    join public.event_entries e on e.id = s.entry_id
   where r.event_id = t095.u(ev) and r.position = rnd
$$;
create function t095.sizes(ev int, rnd int) returns text language sql stable as $$
  select string_agg(c::text, ',' order by c desc)
    from (select count(*) c from public.td_matches m join public.td_rounds r on r.id = m.round_id
            join public.td_slots s on s.match_id = m.id
           where r.event_id = t095.u(ev) and r.position = rnd and s.entry_id is not null group by m.id) x
$$;
-- the names of everyone who lost a pair match in round `rnd` (the slot that is not the winner)
create function t095.losers(ev int, rnd int) returns text language sql stable as $$
  select string_agg(e.display_name, ',' order by e.display_name)
    from public.td_rounds r join public.td_matches m on m.round_id = r.id
    join public.td_match_results x on x.match_id = m.id
    join public.td_slots s on s.match_id = m.id and s.id <> x.winner_slot_id and s.entry_id is not null
    join public.event_entries e on e.id = s.entry_id
   where r.event_id = t095.u(ev) and r.position = rnd
$$;
create function t095.winners(ev int, rnd int) returns text language sql stable as $$
  select string_agg(e.display_name, ',' order by e.display_name)
    from public.td_rounds r join public.td_matches m on m.round_id = r.id
    join public.td_match_results x on x.match_id = m.id
    join public.td_slots s on s.id = x.winner_slot_id
    join public.event_entries e on e.id = s.entry_id
   where r.event_id = t095.u(ev) and r.position = rnd
$$;

-- ============ pure: group sizes ============
select is(app.td_group_sizes(2, 3), '{2}'::int[], 'a pool of 2 is one group of 2');
select is(app.td_group_sizes(3, 3), '{3}'::int[], 'a pool of 3 with groups of 3 is one group');
select is(app.td_group_sizes(4, 3), '{2,2}'::int[], '4 with groups of 3: two groups of 2, never a 3 and a 1');
select is(app.td_group_sizes(5, 3), '{3,2}'::int[], '5 with groups of 3: 3 and 2');
select is(app.td_group_sizes(7, 3), '{3,2,2}'::int[], '7 with groups of 3: 3, 2, 2');
select is(app.td_group_sizes(8, 4), '{4,4}'::int[], '8 with groups of 4: 4 and 4');
select is(app.td_group_sizes(5, 4), '{3,2}'::int[], '5 with groups of 4: 3 and 2, not a 4 and a 1');
select is(app.td_group_sizes(13, 4), '{4,3,3,3}'::int[], '13 with groups of 4: 4, 3, 3, 3');
select is(app.td_group_sizes(3, 2), '{3}'::int[], '3 with groups of 2: one group of 3 (no singleton)');
select is(app.td_group_sizes(9, 2), '{3,2,2,2}'::int[], '9 with groups of 2: one group of 3, three of 2');
select is(app.td_group_sizes(16, 2), array_fill(2, array[8]), '16 with groups of 2: eight pairs');
select is(app.td_group_sizes(1, 3), '{}'::int[], 'a pool of 1 makes no group');
select is(app.td_group_sizes(6, 5), '{}'::int[], 'a group size outside 2 to 4 makes no group');

-- ============ registry and setup ============
select is((select string_agg(module || ':' || coalesce(array_to_string(requires, ','), '') || ':' || entitlement_key, ',' order by module)
             from app.td_module_registry()),
  'redemption::throwdown_redemption,scoresheet::throwdown_scoresheet', 'the registry holds redemption (key throwdown_redemption) and scoresheet');
select is(t095.settings(10, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": [1]}}'), 'ok', 'the organiser turns redemption on');
select is((select modules -> 'redemption' from td_settings where event_id = t095.u(10)),
  '{"cap": 0, "feed": [1], "group_size": 3}'::jsonb, 'it is stored as exactly group_size, cap and feed');
select is(t095.settings(15, 3, '{"redemption": {"feed": [2, 1, 2]}}'), 'ok', 'a missing group size and cap take their defaults; the feed is sorted and distinct');
select is((select modules -> 'redemption' from td_settings where event_id = t095.u(15)),
  '{"cap": 0, "feed": [1, 2], "group_size": 3}'::jsonb, '...stored as group size 3, cap 0, feed [1, 2]');
select t095.contains(t095.settings(15, 3, '{"redemption": {"group_size": 5, "cap": 0, "feed": [1]}}'), '%td_redemption_invalid%', 'a group size of 5 is refused');
select t095.contains(t095.settings(15, 3, '{"redemption": {"group_size": 1, "cap": 0, "feed": [1]}}'), '%td_redemption_invalid%', 'a group size of 1 is refused');
select t095.contains(t095.settings(15, 3, '{"redemption": {"group_size": 3, "cap": -1, "feed": [1]}}'), '%td_redemption_invalid%', 'a negative cap is refused');
select t095.contains(t095.settings(15, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": []}}'), '%td_redemption_invalid%', 'no feeding round is refused');
select t095.contains(t095.settings(15, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": [5]}}'), '%td_redemption_invalid%', 'a feeding round past 4 is refused');
select t095.contains(t095.settings(15, 3, '{"redemption": true}'), '%td_redemption_invalid%', 'a bare true is not a setup');
select is(t095.settings(15, 3, '{"redemption": false}'), 'ok', 'redemption toggled OFF is accepted...');
select is((select modules::text from td_settings where event_id = t095.u(15)), '{}', '...and leaves no trace in the stored setup');
select is((select count(*)::int from td_settings where event_id = t095.u(15) and modules ? 'redemption'), 0, 'no redemption key is stored');

-- ============ event 10: 12 players, groups of 3, fed by round 1 ============
select is(t095.start(10, 12), 'ok', 'event 10 starts with 12 players (6 matches)');
select is(t095.rounds(10), '1:main:6', 'only Round 1 exists: nothing is drawn ahead');
select is(t095.decide_round(10, 1, 1), 'ok', 'every Round 1 match is decided (slot 1 wins)');
select is(t095.rounds(10), '1:main:6 2:redemption:2', 'a redemption round of two groups appears when Round 1 is complete');
select is((select kind || '/' || phase from td_rounds where event_id = t095.u(10) and position = 2), 'pool/redemption', 'it is a pool round of phase redemption');
select is(t095.sizes(10, 2), '3,3', 'the 6 losers sit in two groups of 3');
select is(t095.round_names(10, 2), t095.losers(10, 1), 'the redemption entrants are exactly Round 1''s losers');
select is((select count(distinct s.entry_id)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(10) and r.position = 2), 6, 'nobody is in two groups');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(10) and r.position = 2 and s.feeder_match_id is not null), 6, 'each entrant records the match they lost');
select is((select count(*)::int from td_matches m join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(10) and r.position = 2 and m.result_kind is not null), 0, 'no group is decided yet');
-- the draw is recorded: the round carries its draw code, and the groups are exactly the losers ordered by md5(code || id)
select is((select length(draw_seed) > 8 from td_rounds where event_id = t095.u(10) and position = 2), true, 'the redemption round records its draw code');
select is((select count(*)::int from td_rounds where event_id = t095.u(10) and draw_seed is not null), 1, 'and no other round carries one');
select is((select string_agg(s.entry_id::text, ',' order by m.position, s.position)
             from td_matches m join td_slots s on s.match_id = m.id
            where m.round_id = (select id from td_rounds where event_id = t095.u(10) and position = 2)),
  (select string_agg(l.entry_id::text, ',' order by md5((select draw_seed from td_rounds where event_id = t095.u(10) and position = 2) || l.entry_id::text))
     from td_matches m join td_match_results x on x.match_id = m.id
     join td_slots l on l.match_id = m.id and l.id <> x.winner_slot_id and l.entry_id is not null
     join td_rounds r on r.id = m.round_id and r.event_id = t095.u(10) and r.position = 1),
  'the groups can be replayed from the draw code and the losers');
-- idempotent: advancing again changes nothing
select app.td_advance(t095.u(10));
select app.td_advance(t095.u(10));
select is(t095.rounds(10), '1:main:6 2:redemption:2', 'advancing again twice creates no second redemption round');
select is(t095.as_user(t095.u(1), format('select app.td_advance(%L)', t095.u(10))) like '42501%', true, 'an API role cannot call td_advance');

-- group 1: judges level 1-1-1; confirm is refused; the tie-break vote casts one more
select is(t095.tap_slot(t095.s(10, 2, 1, 1), t095.m(10, 2, 1), 1), 'ok', 'group 1: one vote for brewer 1');
select is(t095.tap_slot(t095.s(10, 2, 1, 2), t095.m(10, 2, 1), 1), 'ok', 'group 1: one vote for brewer 2');
select is(t095.tap_slot(t095.s(10, 2, 1, 3), t095.m(10, 2, 1), 1), 'ok', 'group 1: one vote for brewer 3 (all three judges are in, level)');
select t095.contains(t095.confirm_match(t095.m(10, 2, 1)), '%td_votes_level%', 'a level group cannot be confirmed');
select is(t095.tap_slot(t095.s(10, 2, 1, 3), t095.m(10, 2, 1), 1), 'ok', 'the tie-break judge casts one more vote (a tie among three, all of them in it)');
select t095.contains(t095.tap_slot(t095.s(10, 2, 1, 1), t095.m(10, 2, 1), 1), '%td_votes_full%', 'and no further vote is taken');
select is(t095.confirm_match(t095.m(10, 2, 1)), 'ok', 'brewer 3 now has strictly the most votes and the group is confirmed');
select is((select winner_slot_id from td_match_results where match_id = t095.m(10, 2, 1)), t095.s(10, 2, 1, 3), 'the winner is brewer 3 (2-1-1, strictly the most)');
select is(t095.rounds(10), '1:main:6 2:redemption:2', 'one group decided: the redemption round is not complete, nothing follows');
-- group 2: a plain majority
select is(t095.decide_match(t095.m(10, 2, 2), 2), 'ok', 'group 2: brewer 2 takes 2 of 3 votes and is confirmed');
select is(t095.rounds(10), '1:main:6 2:redemption:2 3:main:4', 'both groups decided: the next main round is made, of 6 winners and 2 revived = 8 brewers');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(10) and r.position = 3 and s.entry_id is not null), 8, 'the next round holds 8 brewers: Round 1''s 6 winners and the 2 group winners');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(10) and r.position = 3 and s.entry_id in (
              select ws.entry_id from td_match_results x join td_slots ws on ws.id = x.winner_slot_id
                join td_matches mm on mm.id = x.match_id join td_rounds rr on rr.id = mm.round_id
               where rr.event_id = t095.u(10) and rr.position in (1, 2))), 8, '...every one of them a winner of Round 1 or of a group');
select is(t095.round_names(10, 3) like '%' || (select e.display_name from td_slots s join event_entries e on e.id = s.entry_id where s.id = t095.s(10, 2, 1, 3)) || '%', true, 'group 1''s winner is in it');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(10) and r.position = 3 and s.feeder_match_id in (t095.m(10, 2, 1), t095.m(10, 2, 2))), 2, 'a returning brewer records the group they won');

-- ============ the way back is undoable until the next round starts (event 10) ============
select is(t095.as_user(t095.u(1), format('select public.td_reopen_match(gen_random_uuid(), %L, %L)', t095.u(3), t095.m(10, 2, 2))), 'ok', 'group 2 is undone before round 3 has a tap');
select is(t095.rounds(10), '1:main:6 2:redemption:2', 'round 3 is removed with it');
select is(t095.confirm_match(t095.m(10, 2, 2)), 'ok', 'group 2 is confirmed again');
select is(t095.rounds(10), '1:main:6 2:redemption:2 3:main:4', 'round 3 is made again');
select is(t095.tap_slot(t095.s(10, 3, 1, 1), t095.m(10, 3, 1), 1), 'ok', 'a judge taps in round 3');
select t095.contains(t095.as_user(t095.u(1), format('select public.td_reopen_match(gen_random_uuid(), %L, %L)', t095.u(3), t095.m(10, 2, 2))),
  '%td_next_round_started%', 'now a group can no longer be undone');
select is(t095.rounds(10), '1:main:6 2:redemption:2 3:main:4', '...and nothing was removed');

-- ============ event 11: two redemption rounds, and a brewer revived twice ============
select is(t095.settings(11, 3, '{"redemption": {"group_size": 4, "cap": 0, "feed": [1, 2]}}'), 'ok', 'event 11: groups of 4, fed by rounds 1 and 2');
select is(t095.start(11, 16), 'ok', '...16 players, 8 matches');
select is(t095.decide_round(11, 1, 1), 'ok', 'Round 1 is decided');
select is(t095.rounds(11) || ' ' || t095.sizes(11, 2), '1:main:8 2:redemption:2 4,4', 'the first redemption round: two groups of 4');
select is(t095.decide_round(11, 2, 1), 'ok', 'both groups decided (slot 1 wins each)');
select is(t095.rounds(11), '1:main:8 2:redemption:2 3:main:5', 'Round 2 follows: 8 winners and 2 revived = 10 brewers, 5 matches (the revived meet each other last)');
-- the match of the two revived is the last: slot 2 wins it, so the revived brewer in slot 1 is out again
select is(t095.decide_match(t095.m(11, 3, 1), 1) || t095.decide_match(t095.m(11, 3, 2), 1) || t095.decide_match(t095.m(11, 3, 3), 1)
          || t095.decide_match(t095.m(11, 3, 4), 1) || t095.decide_match(t095.m(11, 3, 5), 2), 'okokokokok',
  'Round 2 is decided: slot 1 wins, except the match of the two revived, where slot 2 wins (the first revived brewer is out again)...');
select is(t095.rounds(11), '1:main:8 2:redemption:2 3:main:5 4:redemption:2', '...a SECOND redemption round follows Round 2 (5 winners is more than four)');
select is(t095.sizes(11, 4), '3,2', 'its 5 losers sit in groups of 3 and 2');
select is(t095.round_names(11, 4), t095.losers(11, 3), 'its entrants are exactly Round 2''s losers');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(11) and r.position in (2, 4) and s.entry_id = (
              select ws.entry_id from td_match_results x join td_slots ws on ws.id = x.winner_slot_id
                where x.match_id = t095.m(11, 2, 1))), 2, 'the brewer who won group 1 of the first redemption round is in the second redemption round too (no one-redemption rule)');
select is(t095.decide_for(11, 4, (select ws.entry_id from td_match_results x join td_slots ws on ws.id = x.winner_slot_id
                                    where x.match_id = t095.m(11, 2, 1))), 'ok',
  'the second redemption round is decided, the twice-fallen brewer winning their group');
select is(t095.rounds(11), '1:main:8 2:redemption:2 3:main:5 4:redemption:2 5:main:4', 'Round 3 follows: 5 winners and 2 revived = 7 brewers, 4 matches (3 pairs and a bye)');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(11) and r.position = 5 and s.entry_id = (
              select ws.entry_id from td_match_results x join td_slots ws on ws.id = x.winner_slot_id
                where x.match_id = t095.m(11, 2, 1))), 1, 'that brewer, revived a second time, is back in the next main round');

-- ============ event 12: the cap limits the winners that go back ============
select is(t095.settings(12, 3, '{"redemption": {"group_size": 2, "cap": 3, "feed": [1]}}'), 'ok', 'event 12: groups of 2, at most 3 return');
select is(t095.start(12, 16), 'ok', '...16 players');
select is(t095.decide_round(12, 1, 1), 'ok', 'Round 1 is decided');
select is(t095.sizes(12, 2), '2,2,2,2', 'the 8 losers make four groups of 2');
select is(t095.decide_match(t095.m(12, 2, 1), 1, 2, 1), 'ok', 'group 1 is won 2-1');
select is(t095.decide_match(t095.m(12, 2, 2), 1, 2, 1), 'ok', 'group 2 is won 2-1');
select is(t095.decide_match(t095.m(12, 2, 3), 1, 2, 1), 'ok', 'group 3 is won 2-1');
select is(t095.rounds(12), '1:main:8 2:redemption:4', 'three groups decided: the round is not complete');
select is(t095.decide_match(t095.m(12, 2, 4), 1, 3, 0), 'ok', 'group 4 is won 3-0 (the last group, the most votes)');
select is(t095.rounds(12), '1:main:8 2:redemption:4 3:main:6', 'the next round holds 8 winners and only 3 returning brewers: 11, six matches');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(12) and r.position = 3 and s.entry_id is not null), 11, '11 brewers in it');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(12) and r.position = 3 and s.feeder_match_id in (select mm.id from td_matches mm where mm.round_id = (select id from td_rounds where event_id = t095.u(12) and position = 2))), 3, 'three of them came from groups');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(12) and r.position = 3 and s.feeder_match_id = t095.m(12, 2, 3)), 0, 'the group-3 winner (2 votes, a later group than 1 and 2) is the one left out');
select is((select count(*)::int from td_slots s join td_matches m on m.id = s.match_id join td_rounds r on r.id = m.round_id
            where r.event_id = t095.u(12) and r.position = 3 and s.feeder_match_id = t095.m(12, 2, 4)), 1, 'the 3-0 winner of the LAST group returns: the cap ranks by votes, not by group order');

-- ============ event 13: the tie-break vote goes only to a brewer in the tie ============
select is(t095.settings(13, 4, '{"redemption": {"group_size": 4, "cap": 0, "feed": [1]}}'), 'ok', 'event 13: four judges, groups of 4');
select is(t095.start(13, 16), 'ok', '...16 players');
select is(t095.decide_round(13, 1, 1, 3, 1), 'ok', 'Round 1 is decided 3-1 each');
select is(t095.sizes(13, 2), '4,4', 'two groups of 4');
select is(t095.tap_slot(t095.s(13, 2, 1, 1), t095.m(13, 2, 1), 2), 'ok', 'group 1: two votes for brewer 1');
select is(t095.tap_slot(t095.s(13, 2, 1, 2), t095.m(13, 2, 1), 2), 'ok', 'group 1: two votes for brewer 2 (all four judges in, 2-2-0-0)');
select t095.contains(t095.confirm_match(t095.m(13, 2, 1)), '%td_votes_level%', 'level: confirm is refused');
select t095.contains(t095.tap_slot(t095.s(13, 2, 1, 3), t095.m(13, 2, 1), 1), '%td_tiebreak_slot%', 'the tie-break vote cannot go to brewer 3, who is not in the tie');
select t095.contains(t095.tap_slot(t095.s(13, 2, 1, 4), t095.m(13, 2, 1), 1), '%td_tiebreak_slot%', '...nor to brewer 4');
select is(t095.tap_slot(t095.s(13, 2, 1, 2), t095.m(13, 2, 1), 1), 'ok', 'it can go to brewer 2, who is in it');
select is(t095.confirm_match(t095.m(13, 2, 1)), 'ok', 'and brewer 2 wins 3-2');
select is((select winner_slot_id from td_match_results where match_id = t095.m(13, 2, 1)), t095.s(13, 2, 1, 2), 'the explicit tie-break gives strictly the most votes');

-- ============ no trace: the module off, a round not chosen, too few winners ============
select is(t095.settings(14, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": [1]}}'), 'ok', 'event 14: redemption on, 8 players');
select is(t095.start(14, 8) || t095.decide_round(14, 1, 1), 'okok', '...Round 1 (4 matches) is decided');
select is(t095.rounds(14), '1:main:4 2:main:2', 'only 4 winners remain: no redemption round, the semi-finals follow');
select is(t095.start(15, 12) || t095.decide_round(15, 1, 1), 'okok', 'event 15 (redemption off): 12 players, Round 1 decided');
select is(t095.rounds(15), '1:main:6 2:main:3', 'no redemption round and no trace of one: the next main round follows');
select is((select count(*)::int from td_rounds where event_id in (t095.u(14), t095.u(15)) and (kind = 'pool' or phase = 'redemption')), 0, 'no pool round exists in either');

-- ============ event 16: undo of the feeding round; event 17: a walkover in a group ============
select is(t095.settings(16, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": [1]}}') || t095.start(16, 12), 'okok', 'event 16 starts with redemption on');
select is(t095.decide_round(16, 1, 1), 'ok', 'Round 1 is decided');
select is(t095.rounds(16), '1:main:6 2:redemption:2', 'the redemption round appears');
select is(t095.as_user(t095.u(1), format('select public.td_reopen_match(gen_random_uuid(), %L, %L)', t095.u(3), t095.m(16, 1, 3))), 'ok', 'a Round 1 match is undone before any group has a tap');
select is(t095.rounds(16), '1:main:6', 'the redemption round is removed');
select is(t095.confirm_match(t095.m(16, 1, 3)), 'ok', 'the match is confirmed again (its taps were kept)');
select is(t095.rounds(16), '1:main:6 2:redemption:2', 'the redemption round is drawn again, from the corrected losers');
select is(t095.round_names(16, 2), t095.losers(16, 1), '...and holds the corrected losers');

select is(t095.settings(17, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": [1]}}') || t095.start(17, 12) || t095.decide_round(17, 1, 1), 'okokok', 'event 17: Round 1 decided');
select is(t095.as_user(t095.u(1), format('select public.td_record_walkover(gen_random_uuid(), %L, %L, %L)', t095.u(3), t095.m(17, 2, 1), t095.s(17, 2, 1, 2))), 'ok', 'a walkover in group 1: brewer 2 advances');
select is((select winner_slot_id from td_match_results where match_id = t095.m(17, 2, 1)), t095.s(17, 2, 1, 2), 'the walkover names its winner (brewer 2)');
select is(t095.decide_match(t095.m(17, 2, 2), 3), 'ok', 'group 2 is decided');
select is(t095.rounds(17), '1:main:6 2:redemption:2 3:main:4', 'the walkover winner and the group-2 winner return');

-- ============ event 18: a withdrawn loser is left out of the draw ============
select is(t095.settings(18, 3, '{"redemption": {"group_size": 3, "cap": 0, "feed": [1]}}') || t095.start(18, 12), 'okok', 'event 18 starts with redemption on');
select is(t095.decide_match(t095.m(18, 1, 1), 1) || t095.decide_match(t095.m(18, 1, 2), 1) || t095.decide_match(t095.m(18, 1, 3), 1)
          || t095.decide_match(t095.m(18, 1, 4), 1) || t095.decide_match(t095.m(18, 1, 5), 1), 'okokokokok', 'five Round 1 matches are decided');
update event_entries set withdrawn = true where id = t095.u(18 * 100 + 12);
select is(t095.decide_match(t095.m(18, 1, 6), 1), 'ok', 'P12 withdrew; the last match, which P12 lost, is decided');
select is(t095.sizes(18, 2), '3,2', 'only the 5 active losers are drawn: a group of 3 and a group of 2');
select is(t095.round_names(18, 2) like '%P12%', false, 'the withdrawn loser is in no group');

-- ============ shapes and rights ============
select t095.contains(t095.as_user(t095.u(1), format('insert into td_slots (event_id, match_id, position, entry_id) values (%L, %L, 3, null)', t095.u(10), t095.m(10, 1, 1))),
  '%42501%', 'a client cannot insert a slot directly');
select t095.contains(t095.as_user(t095.u(2), format('select public.td_cast_vote(gen_random_uuid(), %L, %L, %L)', t095.u(4), t095.m(10, 2, 1), t095.s(10, 2, 1, 1))),
  '%event not found%', 'a non-member cannot vote in a group');
select is((select count(*)::int from td_rounds where event_id = t095.u(10)), 3, 'event 10 still has its three rounds');

select * from finish();
rollback;
