-- T-BTC knockout tie rule: record_btc_tiebreak, app.advance_btc_bracket (the helper confirm_btc_match
-- now shares with it), and the btc_matches tie-break columns. See
-- 20261009110000_btc_knockout_tiebreak.sql for the reasoning.
begin;
select plan(76);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'member@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.seduh-next'),
  ('00000000-0000-0000-0000-000000000006', 'other-org@test.seduh-next');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Test Org', 'test-org'),
  ('00000000-0000-0000-0000-000000000020', 'Other Org', 'other-org');
insert into org_members (org_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'organiser'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000006', 'organiser');
insert into events (id, org_id, format, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'btc', 'Bracket Event');

insert into btc_teams (id, event_id, name) select
  ('00000000-0000-0000-0000-0000000000b' || i)::uuid, '00000000-0000-0000-0000-0000000000e1', 'Team ' || i
from generate_series(1, 8) i;
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000bf', '00000000-0000-0000-0000-0000000000e1', 'Filler');
insert into btc_judges (id, event_id, name) select
  ('00000000-0000-0000-0000-0000000000c' || i)::uuid, '00000000-0000-0000-0000-0000000000e1', 'J' || i
from generate_series(1, 3) i;

-- One confirmed preliminary match per team (b1..b8) against a shared filler, tokens
-- giving each team a strictly decreasing total (b1 highest, b8 lowest) — the filler's
-- own cumulative total across all 8 matches lands ABOVE b1's, becoming seed 1 itself;
-- b8 (the lowest of the 9) is then the one team excluded from the top-8 cut, which is
-- exactly what this fixture is for: proving the RPC seeds by points, not by which team
-- "looks real".
do $$
declare
  i int; m uuid; c int; tok int;
begin
  for i in 1..8 loop
    insert into btc_matches (id, event_id, round, team1_id, team2_id, status)
    values (('00000000-0000-0000-0000-0000000000d' || i)::uuid, '00000000-0000-0000-0000-0000000000e1',
             'preliminary', ('00000000-0000-0000-0000-0000000000b' || i)::uuid,
             '00000000-0000-0000-0000-0000000000bf', 'confirmed')
    returning id into m;
    insert into btc_match_judges (match_id, judge_id)
      select m, ('00000000-0000-0000-0000-0000000000c' || j)::uuid from generate_series(1, 3) j;
    for c in 1..15 loop
      tok := case when c <= (16 - i) then 3 else 0 end;
      insert into btc_cup_votes (match_id, cup_number, team1_tokens) values (m, c, tok);
    end loop;
    insert into btc_match_bonuses (match_id, fastest_team_id) values (m, ('00000000-0000-0000-0000-0000000000b' || i)::uuid);
  end loop;
end $$;

-- the client keys on the `hint` of a refusal, not its wording: read it from a caught error
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $f$
declare h text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, '(no hint)');
end $f$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- fixture: a generated bracket, qf1 won, qf2 TIED, qf3 not yet confirmed ----------
select generate_btc_bracket('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000e1');
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010', (select id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010', (select id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010', (select id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'), array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010', (select id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1'), array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);

select confirm_btc_match('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c), '00000000-0000-0000-0000-0000000000bf', false, false, null, null);
select confirm_btc_match('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c), null, false, false, null, null);
-- capture ids while still the genuine member (the other personas below are RLS-filtered to nothing)
select set_config('test.qf2_match_id', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')::text, false);
select set_config('test.qf2_team1', (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'))::text, false);
select set_config('test.qf2_team2', (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'))::text, false);
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, 'fixture: qf2''s tie advanced nobody (sf1''s team2 seat is empty)');

-- ---------- refusals ----------
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $$,
  'P0001', 'record_btc_tiebreak: the match must be confirmed first',
  'an unconfirmed match cannot have a tie-break'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $$,
  'P0001', 'record_btc_tiebreak: this match is not tied',
  'a match with a decisive result cannot have a tie-break'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'x') $$,
  'P0001', 'record_btc_tiebreak: a tie-break applies to knockout matches only',
  'a preliminary match cannot have a tie-break'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), '00000000-0000-0000-0000-0000000000b8', 'x') $$,
  'P0001', 'record_btc_tiebreak: the winner must be one of the match''s two teams',
  'the winner must be one of the match''s own teams'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), null::uuid, 'x') $$,
  'P0001', 'record_btc_tiebreak: the winner must be one of the match''s two teams',
  'a null winner is refused the same way'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), '') $$,
  'P0001', 'record_btc_tiebreak: a reason is required',
  'a blank reason is refused'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), ' ' || chr(9) || chr(10) || ' ') $$,
  'P0001', 'record_btc_tiebreak: a reason is required',
  'a whitespace-only reason is refused'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), repeat('r', 121)) $$,
  'P0001', 'record_btc_tiebreak: the reason is too long (120 characters at most)',
  'a reason over 120 characters is refused'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000dead', (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $$,
  'P0001', 'record_btc_tiebreak: match not found',
  'an unknown match is reported as not found'
);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000099', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $$,
  'P0001', 'record_btc_tiebreak: match not found',
  'a forged org id is reported as not found'
);
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          null, 'none of the refused calls recorded anything');
select is(pg_temp.hint_of($q$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $q$),
          'tiebreak_unconfirmed', 'an unconfirmed match is refused with the tiebreak_unconfirmed hint');
select is(pg_temp.hint_of($q$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $q$),
          'tiebreak_not_tied', 'a decisive match is refused with the tiebreak_not_tied hint');
select is(pg_temp.hint_of($q$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000dead', (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'x') $q$),
          'tiebreak_match_not_found', 'an unknown match is refused with the tiebreak_match_not_found hint');

-- ---------- recording a tie-break ----------
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Sudden-death cup') $$,
  'the organiser records qf2''s winner with a reason'
);
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'the recorded winner advances into sf1 (qf2 feeds sf1''s team2 seat)');
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'the match row carries the winner');
select is((select tiebreak_reason from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          'Sudden-death cup', 'and the reason');
select is((select team1_total = team2_total from btc_match_scores where match_id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          true, 'the totals are untouched: the match is still level (the tie-break is a separate fact)');
select is((select count(*)::int from score_change_log where table_name = 'btc_matches' and row_id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1') and after_confirm and new_value ->> 'tiebreak_reason' = 'Sudden-death cup' and reason = 'Sudden-death cup'),
          1, 'the decision is in the change log, after-confirm, with the reason beside it');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), repeat('r', 120)) $$,
  'a reason of exactly 120 characters is accepted (the boundary)'
);
select is(char_length((select tiebreak_reason from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'))),
          120, 'and stored whole');
select is(coalesce(current_setting('app.change_reason', true), ''),
          '', 'the reason is not left behind in the session setting after the call');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Sudden-death cup, second look') $$,
  'the SAME winner with a different reason is a real change'
);
select is((select tiebreak_reason from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          'Sudden-death cup, second look', 'and the new reason is what is stored');
update btc_matches set tiebreak_winner_team_id = (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1')), tiebreak_reason = repeat('r', 120) where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1');
select is((select char_length(tiebreak_reason) from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          120, 'the table accepts a 120-character reason too (the CHECK boundary)');
update btc_matches set tiebreak_winner_team_id = null, tiebreak_reason = null where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Head judge casting vote') $$,
  'the winner can be changed while the downstream match does not exist'
);
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and the seat moves to the new winner');
select set_config('test.qf2_row', (select ctid::text from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), false);
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Head judge casting vote') $$,
  're-recording the same decision is a harmless no-op'
);
select is((select ctid::text from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          current_setting('test.qf2_row'), 'and rewrites no row at all (same physical row version: no updated_at bump, no log row)');
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and leaves the seat where it was');

-- ---------- a re-confirm and the recorded tie-break ----------
select confirm_btc_match('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c), null, false, false, null, null);
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          null, 'a re-confirm that makes the match decisive clears the now-meaningless tie-break');
select is((select tiebreak_reason from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          null, 'and its reason');
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and the seat follows the totals (team1 won every cup)');
select confirm_btc_match('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c), null, false, false, null, null);
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, 'tying it again does NOT resurrect the old decision: nobody advances until it is re-decided');
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          null, 'and no tie-break is on the row');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Replayed round') $$,
  'it can be decided afresh'
);
select confirm_btc_match('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 0 else 3 end)) from generate_series(1, 20) c), null, false, false, null, null);
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'a re-confirm that is STILL level keeps the recorded winner');
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and the seat stays filled');

-- ---------- the advancement helper only acts on a CONFIRMED match ----------
update btc_bracket_slots set team1_id = '00000000-0000-0000-0000-0000000000bf'::uuid where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1';
select app.advance_btc_bracket((select match_id from btc_bracket_slots where slot_label = 'qf3' and event_id = '00000000-0000-0000-0000-0000000000e1'));
select is((select team1_id from btc_bracket_slots where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000bf'::uuid, 'an unconfirmed match (0-0 in the view, which would read as a tie) cannot clear the seat it feeds');
update btc_bracket_slots set team1_id = null where slot_label = 'sf2' and event_id = '00000000-0000-0000-0000-0000000000e1';

-- ---------- once the next round's match exists ----------
select create_btc_bracket_match('00000000-0000-0000-0000-000000000010', (select id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c3']::uuid[]);
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Changed my mind') $$,
  'P0001', 'confirm_btc_match: this match''s winner has already advanced to a match in progress — that downstream match must be removed before this result can change',
  'changing the winner is refused once sf1''s own match exists'
);
select is(pg_temp.hint_of($q$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Changed my mind') $q$),
          'bracket_advanced', 'and the refusal carries the bracket_advanced hint');
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'the refused change rolled back: the original winner is still recorded');
select is((select tiebreak_reason from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          'Replayed round', 'and its reason');
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and the seat is unchanged');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Replayed round') $$,
  're-recording the SAME winner is still fine'
);

-- ---------- a tied semifinal: winner to the final, loser to third place ----------
select confirm_btc_match('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c), null, false, false, null, null);
select is((select team1_id from btc_bracket_slots where slot_label = 'final' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, 'a tied semifinal fills neither the final...');
select is((select team1_id from btc_bracket_slots where slot_label = 'third_place' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, '...nor third place');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Casting vote') $$,
  'the organiser records the semifinal''s winner'
);
select is((select team1_id from btc_bracket_slots where slot_label = 'final' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'the winner goes to the final');
select is((select team1_id from btc_bracket_slots where slot_label = 'third_place' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and the loser goes to third place');
select lives_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'Re-decided') $$,
  'the semifinal decision can be flipped while the final does not exist yet'
);
select is((select team1_id from btc_bracket_slots where slot_label = 'final' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'the final now holds the other team');
select is((select team1_id from btc_bracket_slots where slot_label = 'third_place' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team2_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and third place holds the team that is now the loser');

-- ---------- the CHECK holds even against a direct table write ----------
select throws_ok(
  $$ update btc_matches set tiebreak_winner_team_id = '00000000-0000-0000-0000-0000000000b8', tiebreak_reason = 'x' where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1') $$,
  '23514', null,
  'a direct write cannot name a team that is not in the match'
);
select throws_ok(
  $$ update btc_matches set tiebreak_winner_team_id = (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1')) where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1') $$,
  '23514', null,
  'a winner without a reason is refused'
);
select throws_ok(
  $$ update btc_matches set tiebreak_reason = 'x' where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1') $$,
  '23514', null,
  'a reason without a winner is refused'
);
select throws_ok(
  $$ update btc_matches set tiebreak_winner_team_id = (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1')), tiebreak_reason = chr(9) || chr(10) where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1') $$,
  '23514', null,
  'a whitespace-only reason (tab/newline) is refused by the table too, not just by the RPC'
);
select throws_ok(
  $$ update btc_matches set tiebreak_winner_team_id = team1_id, tiebreak_reason = 'x' where id = '00000000-0000-0000-0000-0000000000d1' $$,
  '23514', null,
  'a preliminary match cannot carry a tie-break even by a direct write'
);
select throws_ok(
  $$ update btc_matches set tiebreak_winner_team_id = team1_id, tiebreak_reason = repeat('r', 121) where id = (select match_id from btc_bracket_slots where slot_label = 'qf4' and event_id = '00000000-0000-0000-0000-0000000000e1') $$,
  '23514', null,
  'a reason over 120 characters is refused by the table too'
);

-- ---------- who may call it ----------
update btc_bracket_slots set team2_id = null where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', current_setting('test.qf2_match_id')::uuid, current_setting('test.qf2_team2')::uuid, 'hijack') $$,
  'P0001', 'record_btc_tiebreak: match not found',
  'a member of a DIFFERENT org, using the event''s real org id, is told the match does not exist (RLS)'
);
select lives_ok(
  $$ select app.advance_btc_bracket(current_setting('test.qf2_match_id')::uuid) $$,
  'a member of another org can call the helper but it finds nothing to act on'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
select throws_ok(
  $$ select record_btc_tiebreak('00000000-0000-0000-0000-000000000010', current_setting('test.qf2_match_id')::uuid, current_setting('test.qf2_team2')::uuid, 'hijack') $$,
  'P0001', 'record_btc_tiebreak: match not found',
  'a user in no org gets the identical answer'
);
select lives_ok(
  $$ select app.advance_btc_bracket(current_setting('test.qf2_match_id')::uuid) $$,
  'a user in no org can call the helper but it finds nothing to act on'
);
reset role;
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          null, 'and neither call touched the emptied seat (the helper runs under the caller''s rights, not the owner''s)');
update btc_bracket_slots set team2_id = current_setting('test.qf2_team1')::uuid where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1';
select is((select tiebreak_winner_team_id from btc_matches where id = current_setting('test.qf2_match_id')::uuid) = current_setting('test.qf2_team1')::uuid,
          true, 'and neither attempt changed the recorded winner');
select is(has_function_privilege('anon', 'record_btc_tiebreak(uuid, uuid, uuid, text)', 'execute'),
          false, 'anon cannot execute record_btc_tiebreak');
select is(has_function_privilege('anon', 'app.advance_btc_bracket(uuid)', 'execute'),
          false, 'anon cannot execute the advancement helper');
select is(has_function_privilege('authenticated', 'record_btc_tiebreak(uuid, uuid, uuid, text)', 'execute'),
          true, 'authenticated can execute record_btc_tiebreak');

-- ---------- a decisive result corrected into a tie, with the next round's match present ----------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select confirm_btc_match('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', 3)) from generate_series(1, 20) c), null, false, false, null, null);
select is((select tiebreak_winner_team_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')),
          null, 'a decisive re-confirm for the team already through is allowed, and clears the tie-break');
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'with that team still in sf1 (sf1''s match already exists)');
select throws_ok(
  $$ select confirm_btc_match('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: this match is now tied, but its winner has already advanced to a match in progress — that downstream match must be removed before this result can change',
  'turning it back into a tie is refused: the seat would have to be emptied under an existing match'
);
select is((select team2_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          (select team1_id from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf2' and event_id = '00000000-0000-0000-0000-0000000000e1')), 'and the seat is unchanged (the NULL target is compared as a difference, not skipped)');
select throws_ok(
  $$ select confirm_btc_match('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000010', (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1'), (select updated_at from btc_matches where id = (select match_id from btc_bracket_slots where slot_label = 'qf1' and event_id = '00000000-0000-0000-0000-0000000000e1')), (select jsonb_agg(jsonb_build_object('cup_number', c, 'team1_tokens', case when c <= 10 then 3 else 0 end)) from generate_series(1, 20) c), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: this match is now tied, but its winner has already advanced to a match in progress — that downstream match must be removed before this result can change',
  'the same refusal for a match that feeds the team1 seat (qf1 into sf1)'
);
select is((select team1_id from btc_bracket_slots where slot_label = 'sf1' and event_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000bf'::uuid, 'and that seat is unchanged too');

reset role;
reset request.jwt.claim.sub;

select * from finish();
rollback;
