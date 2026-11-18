-- BTC void cup (committee rule, owner 2026-11-18): a cup where both teams failed to submit, or both submitted the
-- wrong cup, scores 0 tokens for BOTH teams. Per cup; every bonus is decided as usual. Migration
-- 20261125100000_btc_void_cup.sql.
--
-- The fixture numbers V1-V4 are mirrored, number for number, by src/formats/btc/scoring.test.js
-- ("void cup: computeScores pinned to ..."), so the SQL authority (btc_match_scores) and the JS preview cannot drift.
--   V1 preliminary, cups 1-3 void, cups 4-15 'split' (team1 2 / team2 1), fastest team 2  => 24/12 tokens, 29 / 14
--   V2 preliminary, all 15 cups void, fastest team 1                                       => 0/0 tokens, 2 / 0 (level: no +5)
--   V3 final, cups 1-4 void, the rest 'all2' (3 to team 2), fastest team 1, signature team 1 => 0/48 tokens, 4 / 53
--   V4 semifinal, 'tie' pattern with cup 1 void                                            => 28/29 tokens, 28 / 34
--
-- Fixture ids are unique to this file (the local database is shared with parallel reviewers).
begin;
select plan(56);

insert into auth.users (id, email) values
  ('88000000-0000-0000-0000-000000000001', 'void-member@test.seduh-next'),
  ('88000000-0000-0000-0000-000000000005', 'void-outsider@test.seduh-next');
insert into orgs (id, name, slug) values
  ('88000000-0000-0000-0000-000000000010', 'Void Org', 'void-cup-org'),
  ('88000000-0000-0000-0000-000000000020', 'Void Other Org', 'void-cup-other-org');
insert into org_members (org_id, user_id, role) values
  ('88000000-0000-0000-0000-000000000010', '88000000-0000-0000-0000-000000000001', 'organiser');
insert into events (id, org_id, format, name) values
  ('88000000-0000-0000-0000-0000000000e1', '88000000-0000-0000-0000-000000000010', 'btc', 'Void Cup Event');
insert into btc_teams (id, event_id, name) values
  ('88000000-0000-0000-0000-0000000000b1', '88000000-0000-0000-0000-0000000000e1', 'Void Team A'),
  ('88000000-0000-0000-0000-0000000000b2', '88000000-0000-0000-0000-0000000000e1', 'Void Team B'),
  ('88000000-0000-0000-0000-0000000000b3', '88000000-0000-0000-0000-0000000000e1', 'Void Team C');
insert into btc_judges (id, event_id, name) values
  ('88000000-0000-0000-0000-0000000000c1', '88000000-0000-0000-0000-0000000000e1', 'VJ1'),
  ('88000000-0000-0000-0000-0000000000c2', '88000000-0000-0000-0000-0000000000e1', 'VJ2'),
  ('88000000-0000-0000-0000-0000000000c3', '88000000-0000-0000-0000-0000000000e1', 'VJ3');
-- d1 = V1 | d2 = V2 | d3 = a normal match sent the OLD way (no voided key) | d4 = guard cases | d5 = V3 | d6 = V4
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('88000000-0000-0000-0000-0000000000d1', '88000000-0000-0000-0000-0000000000e1', 'preliminary',
   '88000000-0000-0000-0000-0000000000b1', '88000000-0000-0000-0000-0000000000b2'),
  ('88000000-0000-0000-0000-0000000000d2', '88000000-0000-0000-0000-0000000000e1', 'preliminary',
   '88000000-0000-0000-0000-0000000000b1', '88000000-0000-0000-0000-0000000000b2'),
  ('88000000-0000-0000-0000-0000000000d3', '88000000-0000-0000-0000-0000000000e1', 'preliminary',
   '88000000-0000-0000-0000-0000000000b3', '88000000-0000-0000-0000-0000000000b1'),
  ('88000000-0000-0000-0000-0000000000d4', '88000000-0000-0000-0000-0000000000e1', 'preliminary',
   '88000000-0000-0000-0000-0000000000b3', '88000000-0000-0000-0000-0000000000b2'),
  ('88000000-0000-0000-0000-0000000000d5', '88000000-0000-0000-0000-0000000000e1', 'final',
   '88000000-0000-0000-0000-0000000000b1', '88000000-0000-0000-0000-0000000000b2'),
  ('88000000-0000-0000-0000-0000000000d6', '88000000-0000-0000-0000-0000000000e1', 'semifinal',
   '88000000-0000-0000-0000-0000000000b1', '88000000-0000-0000-0000-0000000000b2');
insert into btc_match_judges (match_id, judge_id)
select m.id, j.id
from (select id from btc_matches where event_id = '88000000-0000-0000-0000-0000000000e1') m
cross join (select id from btc_judges where event_id = '88000000-0000-0000-0000-0000000000e1') j;

-- Test-only payload builder (rolled back with the transaction). 'split': 2 tokens to team1 every cup; 'all2': all 3 to
-- team2; 'tie': 2 to team1 for cups 1-10, 1 after. A cup in p_void is sent voided with 0 tokens. p_old_shape sends no
-- voided key at all (a payload made before the void cup existed).
create function public.tmp88_cups(p_cups int, p_pattern text, p_void int[] default '{}', p_old_shape boolean default false)
returns jsonb language sql as $$
  select jsonb_agg(
    jsonb_build_object('cup_number', c, 'team1_tokens',
      case when c = any(p_void) then 0
           when p_pattern = 'all2' then 0
           when p_pattern = 'tie' and c <= 10 then 2
           when p_pattern = 'tie' then 1
           else 2 end)
    || case when c = any(p_void) and not p_old_shape then jsonb_build_object('voided', true) else '{}'::jsonb end
    order by c)
  from generate_series(1, p_cups) c;
$$;
grant execute on function public.tmp88_cups(int, text, int[], boolean) to authenticated;

-- ---------- the column and its check ----------

select has_column('public', 'btc_cup_votes', 'voided', 'btc_cup_votes has the voided column');
select col_not_null('public', 'btc_cup_votes', 'voided', 'voided is not null');
select col_default_is('public', 'btc_cup_votes', 'voided', 'false', 'voided defaults to false (older callers stay normal cups)');
select throws_ok(
  $$ insert into btc_cup_votes (match_id, cup_number, team1_tokens, voided)
     values ('88000000-0000-0000-0000-0000000000d4', 1, 2, true) $$,
  '23514', null, 'a voided cup holding team1 tokens is refused by the table check'
);
select lives_ok(
  $$ insert into btc_cup_votes (match_id, cup_number, team1_tokens, voided)
     values ('88000000-0000-0000-0000-0000000000d4', 1, 0, true),
            ('88000000-0000-0000-0000-0000000000d4', 2, 3, false) $$,
  'a voided cup with 0 tokens and a normal 3-token cup are both accepted'
);
select is((select team2_tokens::int from btc_cup_totals where match_id = '88000000-0000-0000-0000-0000000000d4' and cup_number = 1),
          0, 'a voided cup gives team 2 NOTHING in btc_cup_totals (not 3 - 0)');
select is((select team2_tokens::int from btc_cup_totals where match_id = '88000000-0000-0000-0000-0000000000d4' and cup_number = 2),
          0, 'a normal cup with 3 tokens to team 1 still gives team 2 the balance of 0');
select is((select voided from btc_cup_totals where match_id = '88000000-0000-0000-0000-0000000000d4' and cup_number = 1),
          true, 'btc_cup_totals says which cup is void');
select is((select team2_tokens::int from btc_cup_totals where match_id = '88000000-0000-0000-0000-0000000000d4' and cup_number = 2) +
          (select count(*)::int from btc_cup_totals where match_id = '88000000-0000-0000-0000-0000000000d4' and voided),
          1, 'sanity: one void cup, one normal cup');
-- A direct-written partial match (2 cups) is cleared again before the real cases.
delete from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d4';

set local role authenticated;
set local request.jwt.claim.sub = '88000000-0000-0000-0000-000000000001';

-- ---------- V1 ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a1', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d1'),
       public.tmp88_cups(15, 'split', array[1,2,3]), '88000000-0000-0000-0000-0000000000b2', false, false, '8:00', '9:00') $$,
  'V1: a match with void cups completes and confirms'
);
select is((select status from btc_matches where id = '88000000-0000-0000-0000-0000000000d1'), 'confirmed', 'V1 is confirmed');
select is((select count(*)::int from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d1' and voided), 3, 'V1 stored 3 void cups');
select is((select count(*)::int from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d1'), 15, 'V1 stored all 15 cups');
select is((select array[team1_tokens, team2_tokens]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d1'),
          array[24, 12], 'V1 tokens: the void cups add nothing to either team');
select is((select array[team1_total, team2_total]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d1'),
          array[29, 14], 'V1 totals: most-tokens +5 to team 1, fastest +2 to team 2');
select is((select array[cups_scored, cups_voided]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d1'),
          array[15, 3], 'V1 reports 15 scored cups, 3 of them void');

-- ---------- V2: an all-void match is level ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a2', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d2',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d2'),
       public.tmp88_cups(15, 'split', (select array_agg(g) from generate_series(1,15) g)),
       '88000000-0000-0000-0000-0000000000b1', false, false, null, null) $$,
  'V2: an all-void match confirms'
);
select is((select array[team1_tokens, team2_tokens]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d2'),
          array[0, 0], 'V2 tokens: 0 and 0');
select is((select array[team1_total, team2_total]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d2'),
          array[2, 0], 'V2 is level: no win bonus, the fastest +2 still applies');

-- ---------- V3: a knockout, void cups, signature and fastest ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a3', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d5',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d5'),
       public.tmp88_cups(20, 'all2', array[1,2,3,4]), '88000000-0000-0000-0000-0000000000b1', true, false, null, null) $$,
  'V3: a final with void cups confirms'
);
select is((select array[team1_tokens, team2_tokens]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d5'),
          array[0, 48], 'V3 tokens: 16 cups x 3 to team 2, the 4 void cups add nothing');
select is((select array[team1_total, team2_total]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d5'),
          array[4, 53], 'V3 totals: fastest +2 and signature +2 for team 1; team 2 has the tokens and the +5');

-- ---------- V4: voiding one cup of a token tie decides the +5 ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a4', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d6',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d6'),
       public.tmp88_cups(20, 'tie', array[1]), null, false, false, null, null) $$,
  'V4: a semifinal with one void cup confirms'
);
select is((select array[team1_tokens, team2_tokens]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d6'),
          array[28, 29], 'V4 tokens: 28 / 29');
select is((select array[team1_total, team2_total]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d6'),
          array[28, 34], 'V4 totals: team 2 holds the +5');

-- ---------- the standings still count a match with void cups (it is complete: every cup is scored) ----------

select is((select played::int from btc_standings where team_id = '88000000-0000-0000-0000-0000000000b1'), 2, 'standings: both V1 and V2 count as played');
select is((select total_points::int from btc_standings where team_id = '88000000-0000-0000-0000-0000000000b1'), 31, 'standings: team A = 29 (V1) + 2 (V2)');
select is((select total_points::int from btc_standings where team_id = '88000000-0000-0000-0000-0000000000b2'), 14, 'standings: team B = 14 (V1) + 0 (V2)');
select is((select wins::int from btc_standings where team_id = '88000000-0000-0000-0000-0000000000b1'), 1, 'standings: V1 is a win, the level all-void V2 is not');

-- ---------- refusals ----------

select throws_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a5', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d4',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d4'),
       (select jsonb_agg(case when (e->>'cup_number')::int = 7 then jsonb_build_object('cup_number', 7, 'team1_tokens', 2, 'voided', true) else e end)
          from jsonb_array_elements(public.tmp88_cups(15, 'split')) e),
       null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: a void cup cannot hold tokens', 'a voided cup that also carries tokens is refused'
);
select is((select status from btc_matches where id = '88000000-0000-0000-0000-0000000000d4'), 'pending', 'the refused match is unchanged');
select is((select count(*)::int from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d4'), 0, 'and nothing was written');
select throws_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a6', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d4',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d4'),
       public.tmp88_cups(14, 'split', array[2]), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: 1 of 15 cups are missing a score', 'a short payload is still refused: a void cup does not stand in for a missing one'
);
select throws_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a7', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d4',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d4'),
       '[{"cup_number":1,"team1_tokens":4,"voided":true}]'::jsonb, null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: each cup''s tokens must be between 0 and 3', 'the 0 to 3 token range still applies to a void entry'
);

-- ---------- a payload from before the change (no voided key) still confirms, as normal cups ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a8', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d3',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d3'),
       public.tmp88_cups(15, 'all2', array[]::int[], true), null, false, false, null, null) $$,
  'a payload with no voided key (queued before this change) still confirms'
);
select is((select count(*)::int from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d3' and voided), 0, 'and none of its cups is void');
select is((select array[team1_tokens, team2_tokens]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d3'),
          array[0, 45], 'old shape: team 2 still gets 3 for each cup team 1 got 0 (an unflagged 0 is not a void cup)');

-- ---------- idempotency ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a1', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d1', '2000-01-01T00:00:00Z', '[]'::jsonb, null, false, false, null, null) $$,
  'replaying the same operation id is still a no-op'
);
select is((select count(*)::int from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d1' and voided), 3, 'the replay did not touch the void cups');

-- ---------- editing a void cup after confirmation is a logged correction ----------

select lives_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000a9', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d1'),
       public.tmp88_cups(15, 'split'), '88000000-0000-0000-0000-0000000000b2', false, false, '8:00', '9:00') $$,
  'a confirmed match can be re-confirmed with the void cups scored normally'
);
select is((select array[team1_tokens, team2_tokens]::int[] from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d1'),
          array[30, 15], 'after the edit V1 is the plain split again');

-- ---------- a non-member ----------

set local request.jwt.claim.sub = '88000000-0000-0000-0000-000000000005';
select throws_ok(
  $$ select confirm_btc_match('88000000-0000-0000-0000-0000000000aa', '88000000-0000-0000-0000-000000000010',
       '88000000-0000-0000-0000-0000000000d4',
       (select updated_at from btc_matches where id = '88000000-0000-0000-0000-0000000000d4'),
       public.tmp88_cups(15, 'split', array[1]), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: match not found', 'a non-member cannot confirm a match with a void cup (one message, no oracle)'
);
select is((select count(*)::int from btc_match_scores where event_id = '88000000-0000-0000-0000-0000000000e1'), 0, 'a non-member reads zero score rows');
select is((select count(*)::int from btc_cup_totals where match_id = '88000000-0000-0000-0000-0000000000d5'), 0, 'a non-member reads zero cup rows (void flag included)');
select is((select count(*)::int from btc_cup_votes where match_id = '88000000-0000-0000-0000-0000000000d2'), 0, 'a non-member reads zero btc_cup_votes rows');
select is((select count(*)::int from btc_standings where event_id = '88000000-0000-0000-0000-0000000000e1'), 0, 'a non-member reads zero standings rows');

-- ---------- the change log ----------

reset role;
select ok(
  exists (select 1 from score_change_log
           where event_id = '88000000-0000-0000-0000-0000000000e1' and table_name = 'btc_cup_votes'
             and after_confirm and old_value ->> 'voided' = 'true'),
  'turning void cups normal after confirmation is logged (the old value says voided = true)'
);
select ok(
  exists (select 1 from score_change_log
           where event_id = '88000000-0000-0000-0000-0000000000e1' and table_name = 'btc_cup_votes' and action = 'insert'),
  'cup-vote inserts are logged for the confirmed event (precondition of the next check)'
);
select ok(
  not exists (select 1 from score_change_log
               where event_id = '88000000-0000-0000-0000-0000000000e1' and table_name = 'btc_cup_votes'
                 and action = 'insert' and not (new_value ? 'voided')),
  'every logged cup-vote insert records the voided key'
);

-- ---------- the rollback restores the old behaviour ----------
-- The statements below are a copy of migration 20261125100000's rollback block, steps 1, 4, 5, 6 and 7. Steps 2 and 3
-- (restoring the two functions verbatim from earlier migrations) are run by supabase/tests/manual/btc-void-cup-rollback.sh,
-- which builds them from those migration files and checks the result (outcome recorded in CHANGELOG.md).

select throws_ok(
  $$ do $do$ begin
       if exists (select 1 from public.btc_cup_votes where voided) then
         raise exception 'btc void cup rollback: % void cup(s) are recorded', (select count(*) from public.btc_cup_votes where voided);
       end if;
     end $do$ $$,
  'P0001', null, 'step 1: the rollback refuses while a void cup is recorded'
);
-- V2, V3 and V4 still hold void cups here; clear the flag the way an operator would (scoring them again).
update btc_cup_votes set voided = false where voided;
select ok(
  exists (select 1 from score_change_log
           where event_id = '88000000-0000-0000-0000-0000000000e1' and table_name = 'btc_cup_votes'
             and action = 'update' and after_confirm and old_value ->> 'voided' = 'true' and new_value ->> 'voided' = 'false'),
  'an UPDATE that clears a void flag after confirmation is logged with both values'
);
select lives_ok($$ do $do$ begin
  if exists (select 1 from public.btc_cup_votes where voided) then raise exception 'void cups remain'; end if;
end $do$ $$, 'step 1 passes once no void cup is recorded');

create or replace view btc_standings with (security_invoker = true) as
with per_team as (
  select event_id, team1_id as team_id, team1_total as points, (team1_tokens > team2_tokens) as won
  from btc_match_scores
  where round = 'preliminary' and status = 'confirmed' and team1_tokens + team2_tokens = app.btc_cups_for_round(round) * 3
  union all
  select event_id, team2_id as team_id, team2_total as points, (team2_tokens > team1_tokens) as won
  from btc_match_scores
  where round = 'preliminary' and status = 'confirmed' and team1_tokens + team2_tokens = app.btc_cups_for_round(round) * 3
)
select event_id, team_id, count(*) as played, sum(case when won then 1 else 0 end)::int as wins, sum(points)::int as total_points
from per_team group by event_id, team_id;

create or replace view btc_match_scores with (security_invoker = true) as
select t.match_id, t.event_id, t.round, t.status, t.team1_id, t.team2_id, t.team1_tokens, t.team2_tokens,
  t.team1_tokens + case when t.team1_tokens > t.team2_tokens then 5 else 0 end
    + case when t.fastest_team_id = t.team1_id then 2 else 0 end
    + case when t.round <> 'preliminary' and t.team1_signature_beverage then 2 else 0 end as team1_total,
  t.team2_tokens + case when t.team2_tokens > t.team1_tokens then 5 else 0 end
    + case when t.fastest_team_id = t.team2_id then 2 else 0 end
    + case when t.round <> 'preliminary' and t.team2_signature_beverage then 2 else 0 end as team2_total,
  t.cups_scored, t.cups_voided
from btc_match_totals t;

create or replace view btc_match_totals with (security_invoker = true) as
select m.id as match_id, m.event_id, m.round, m.status, m.team1_id, m.team2_id,
  coalesce(sum(cv.team1_tokens) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)), 0) as team1_tokens,
  coalesce(sum(3 - cv.team1_tokens) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)), 0) as team2_tokens,
  mb.fastest_team_id,
  coalesce(mb.team1_signature_beverage, false) as team1_signature_beverage,
  coalesce(mb.team2_signature_beverage, false) as team2_signature_beverage,
  count(cv.cup_number) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)) as cups_scored,
  count(cv.cup_number) filter (where false) as cups_voided
from btc_matches m
left join btc_cup_votes cv on cv.match_id = m.id
left join btc_match_bonuses mb on mb.match_id = m.id
group by m.id, m.event_id, m.round, m.status, m.team1_id, m.team2_id,
         mb.fastest_team_id, mb.team1_signature_beverage, mb.team2_signature_beverage;

drop view btc_cup_totals;
create view btc_cup_totals with (security_invoker = true) as
select cv.match_id, cv.cup_number, cv.team1_tokens, (3 - cv.team1_tokens) as team2_tokens
from btc_cup_votes cv join btc_matches m on m.id = cv.match_id
where cv.cup_number <= app.btc_cups_for_round(m.round);
revoke all on btc_cup_totals from anon, authenticated;
grant select on btc_cup_totals to authenticated;

alter table public.btc_cup_votes drop constraint btc_cup_votes_void_holds_no_tokens, drop column voided;

select hasnt_column('public', 'btc_cup_votes', 'voided', 'step 7: the voided column is gone');
select hasnt_column('public', 'btc_cup_totals', 'voided', 'step 6: btc_cup_totals is back to its old columns');
select is((select team2_tokens::int from btc_match_scores where match_id = '88000000-0000-0000-0000-0000000000d6'),
          32, 'rolled back: team 2 is the balance (3 - team 1) for every cup again, including the cup that was void');
select is((select played::int from btc_standings where team_id = '88000000-0000-0000-0000-0000000000b1'), 3,
          'rolled back: the standings still count all three complete matches by the old tokens = cups x 3 test');

select * from finish();
rollback;
