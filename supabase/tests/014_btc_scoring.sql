-- T-BTC.2 scoring: confirm_btc_match RPC, the per-team signature-beverage bonus, and
-- the single-source btc_match_scores formula.
-- The fixture numbers below (37/15, 47/24, 32/30, 4/65, 0/50) are mirrored by
-- src/formats/btc/scoring.test.js so the SQL authority and the JS preview cannot
-- silently drift apart.
--
-- Not provable here: the row lock (`for update`) and the post-lock ledger re-check are
-- concurrency behaviour, and pgTAP runs a single session. They are covered by review
-- and by the migration's own comments, not by an assertion.
begin;
select plan(60);

-- ---------- fixtures (as postgres, bypasses RLS) ----------

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
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000010', 'btc', 'Scoring Event');
insert into btc_teams (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'Team A'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', 'Team B'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000e1', 'Team C');
insert into btc_judges (id, event_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'J1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 'J2'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1', 'J3'),
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000e1', 'J4 (never assigned)');
-- d1 prelim (15 cups) | d2 final (20) | d3 semifinal (20, token tie) | d4 prelim, PENDING
-- with votes written directly | d5 prelim with only 2 judges
insert into btc_matches (id, event_id, round, team1_id, team2_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', 'final',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e1', 'semifinal',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000e1', 'preliminary',
   '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into btc_match_judges (match_id, judge_id)
select m.id, j.id
from (values ('00000000-0000-0000-0000-0000000000d1'::uuid),
             ('00000000-0000-0000-0000-0000000000d2'::uuid),
             ('00000000-0000-0000-0000-0000000000d3'::uuid),
             ('00000000-0000-0000-0000-0000000000d4'::uuid)) m(id)
cross join (values ('00000000-0000-0000-0000-0000000000c1'::uuid),
                   ('00000000-0000-0000-0000-0000000000c2'::uuid),
                   ('00000000-0000-0000-0000-0000000000c3'::uuid)) j(id);
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c2');
-- d4 is PENDING but already holds a full set of votes for Team C: standings must ignore it.
insert into btc_cup_votes (match_id, cup_number, judge_id, team_id)
select '00000000-0000-0000-0000-0000000000d4', c, j.id, '00000000-0000-0000-0000-0000000000b3'
from generate_series(1, 15) c
cross join (values ('00000000-0000-0000-0000-0000000000c1'::uuid),
                   ('00000000-0000-0000-0000-0000000000c2'::uuid),
                   ('00000000-0000-0000-0000-0000000000c3'::uuid)) j(id);

-- Test-only payload builder (rolled back with the transaction).
--   'split': judges 1 and 2 vote team1, judge 3 votes team2 on every cup
--   'all2' : every vote is team2
--   'tie'  : cups 1-10 split 2-1 for team1, cups 11-20 split 1-2 (30 tokens each over 20 cups)
-- p_drop removes that many votes from the end; p_first is the first cup number.
create function public.tmp_votes(p_cups int, p_pattern text, p_drop int default 0, p_first int default 1)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('cup_number', v.c, 'judge_id', v.jid, 'team_id', v.tid) order by v.c, v.n)
  from (
    select c, n, jid,
           case
             when p_pattern = 'all2' then '00000000-0000-0000-0000-0000000000b2'::uuid
             when p_pattern = 'tie' and c <= 10 and n = 3 then '00000000-0000-0000-0000-0000000000b2'::uuid
             when p_pattern = 'tie' and c > 10 and n <> 1 then '00000000-0000-0000-0000-0000000000b2'::uuid
             when p_pattern = 'split' and n = 3 then '00000000-0000-0000-0000-0000000000b2'::uuid
             else '00000000-0000-0000-0000-0000000000b1'::uuid
           end as tid
    from generate_series(p_first, p_first + p_cups - 1) c
    cross join (values (1, '00000000-0000-0000-0000-0000000000c1'::uuid),
                       (2, '00000000-0000-0000-0000-0000000000c2'::uuid),
                       (3, '00000000-0000-0000-0000-0000000000c3'::uuid)) j(n, jid)
    order by c, n
    limit p_cups * 3 - p_drop
  ) v;
$$;
grant execute on function public.tmp_votes(int, text, int, int) to authenticated;

-- ---------- cup counts ----------

select is(app.btc_cups_for_round('preliminary'), 15, 'preliminary round has 15 cups');
select is(app.btc_cups_for_round('final'), 20, 'final round has 20 cups');
select is(app.btc_cups_for_round('third_place'), 20, 'third-place is scored as a 20-cup match, as in legacy');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

-- ---------- a complete, valid preliminary confirm ----------

select lives_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split'), '00000000-0000-0000-0000-0000000000b1', false, false,
       '  8:42  ', '   ') $$,
  'a complete preliminary payload confirms'
);
select is((select status from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
          'confirmed', 'match status flips to confirmed');
select is((select count(*)::int from btc_cup_votes where match_id = '00000000-0000-0000-0000-0000000000d1'),
          45, '45 raw judge votes were written (15 cups x 3 judges)');
select is((select team1_time_note from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
          '8:42', 'free-text time note is trimmed');
select is((select team2_time_note from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
          null, 'a blank time note is stored as null, not an empty string');
select is((select fastest_team_id from btc_match_bonuses where match_id = '00000000-0000-0000-0000-0000000000d1'),
          '00000000-0000-0000-0000-0000000000b1'::uuid, 'fastest team recorded');

-- ---------- idempotent replay ----------

select lives_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', '2000-01-01T00:00:00Z',
       '[]'::jsonb, null, false, false, null, null) $$,
  'replaying the same operation id is a no-op even with a stale/empty payload'
);
select is((select count(*)::int from processed_operations where id = '00000000-0000-0000-0000-0000000000a1'),
          1, 'exactly one ledger row for the operation');

-- ---------- rejections ----------

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', '2000-01-01T00:00:00Z',
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0002', null,
  'a stale expected_updated_at is a CONFLICT (P0002), never a silent overwrite'
);
select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', null,
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0002', null,
  'a NULL expected_updated_at is also a conflict: the guard cannot be skipped by omitting it'
);

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split', 1), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: 1 of 45 judge votes are missing',
  'strict confirm: one missing judge vote is rejected with a friendly message'
);
select is((select count(*)::int from btc_cup_votes where match_id = '00000000-0000-0000-0000-0000000000d1'),
          45, 'the failed re-confirm rolled back atomically: the earlier 45 votes are intact');

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split'), null, true, false, null, null) $$,
  'P0001', 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round',
  'signature-beverage for team 1 is rejected in the preliminary round'
);
select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split'), null, false, true, null, null) $$,
  'P0001', 'confirm_btc_match: the signature-beverage bonus does not apply in the preliminary round',
  'and so is signature-beverage for team 2'
);

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(16, 'split'), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: cup numbers must be between 1 and 15 for a preliminary match',
  'a cup number above the round''s cup count is rejected'
);
select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split', 0, 0), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: cup numbers must be between 1 and 15 for a preliminary match',
  'cup number 0 (below the range) is rejected too'
);

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split'), '00000000-0000-0000-0000-0000000000b3', false, false, null, null) $$,
  'P0001', 'btc_match_bonuses.fastest_team_id must be a participant of the match',
  'fastest team must be one of the two participants'
);

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d5',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d5'),
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: match must have exactly 3 judges (has 2)',
  'a match without exactly 3 assigned judges cannot be confirmed'
);

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split')
         || jsonb_build_array(jsonb_build_object('cup_number', 1,
              'judge_id', '00000000-0000-0000-0000-0000000000c1',
              'team_id', '00000000-0000-0000-0000-0000000000b1')),
       null, false, false, null, null) $$,
  '23505', null,
  'a duplicate (cup, judge) vote is rejected by the unique constraint'
);
select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       jsonb_set(public.tmp_votes(15, 'split'), '{0,judge_id}',
                 to_jsonb('00000000-0000-0000-0000-0000000000c4'::text)),
       null, false, false, null, null) $$,
  'P0001', 'btc_cup_votes.judge_id must be assigned to the match',
  'a vote from a judge who is not assigned to this match is rejected'
);

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-000000000099',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: match not found',
  'an org id that does not own the match is reported as not found (and never echoes the match id)'
);

-- ---------- the single scoring formula, via the views ----------
-- Prelim, split: team1 30 tokens, team2 15. Team1 wins the +5 and is fastest (+2) => 37; team2 => 15.

select is((select total_points from btc_standings where team_id = '00000000-0000-0000-0000-0000000000b1'),
          37, 'standings: team1 = 30 tokens + 5 round winner + 2 fastest');
select is((select wins from btc_standings where team_id = '00000000-0000-0000-0000-0000000000b1'),
          1, 'standings: team1 has one win');
select is((select total_points from btc_standings where team_id = '00000000-0000-0000-0000-0000000000b2'),
          15, 'standings: team2 = 15 tokens, no bonuses');
select is((select count(*)::int from btc_standings where team_id = '00000000-0000-0000-0000-0000000000b3'),
          0, 'a PENDING match, even one holding a full set of votes, never reaches the standings');

-- Final (20 cups), split: team1 40, team2 20; fastest = team2 (+2); BOTH teams earn
-- signature-beverage (+2 each, the case the old single column could not hold).
select lives_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d2',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d2'),
       public.tmp_votes(20, 'split'), '00000000-0000-0000-0000-0000000000b2', true, true, null, null) $$,
  'a complete 20-cup final confirms with both teams holding signature-beverage'
);
select is((select team1_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d2'),
          47::bigint, 'final: team1 = 40 + 5 + 2 signature-beverage');
select is((select team2_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d2'),
          24::bigint, 'final: team2 = 20 + 2 fastest + 2 signature-beverage');

-- Semifinal (20 cups) with a TOKEN TIE, 30 each: nobody gets the +5. Team1 fastest => 32 v 30.
select lives_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d3',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d3'),
       public.tmp_votes(20, 'tie'), '00000000-0000-0000-0000-0000000000b1', false, false, null, null) $$,
  'a token-tied semifinal confirms'
);
select is((select team1_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d3'),
          32::bigint, 'tie: team1 = 30 tokens + 2 fastest, and NO round-winner bonus');
select is((select team2_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d3'),
          30::bigint, 'tie: team2 = 30 tokens, and NO round-winner bonus');

-- ---------- re-confirming REPLACES votes and bonuses, it does not append ----------
-- Final again: every vote to team2, fastest now team1, signature for team1 ONLY.
-- team1 = 0 + 2 fastest + 2 signature = 4; team2 = 60 tokens + 5 round winner = 65.
select lives_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d2',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d2'),
       public.tmp_votes(20, 'all2'), '00000000-0000-0000-0000-0000000000b1', true, false, null, null) $$,
  'an already-confirmed final can be edited by re-confirming'
);
select is(
  (select fastest_team_id::text || ':' || team1_signature_beverage || ':' || team2_signature_beverage
     from btc_match_bonuses where match_id = '00000000-0000-0000-0000-0000000000d2'),
  '00000000-0000-0000-0000-0000000000b1:true:false',
  'the bonuses row was REPLACED (upsert updates, not do-nothing): fastest team1, signature team1 only'
);
select is((select team1_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d2'),
          4::bigint, 'edited final: team1 = 0 tokens + 2 fastest + 2 signature (one team only)');
select is((select team2_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d2'),
          65::bigint, 'edited final: team2 = 60 tokens + 5 round winner, no bonuses');

select lives_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1',
       (select updated_at from btc_matches where id = '00000000-0000-0000-0000-0000000000d1'),
       public.tmp_votes(15, 'all2'), null, false, false, null, null) $$,
  'an already-confirmed preliminary match can be edited too'
);
select is((select team2_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d1'),
          50::bigint, 'edited preliminary: team2 = 45 tokens + 5 round winner');
select is((select team1_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d1'),
          0::bigint, 'edited preliminary: team1 = 0 (the old fastest bonus went with the old bonuses row)');

reset role;
reset request.jwt.claim.sub;

-- ---------- the view's own preliminary guard (defence in depth) ----------
-- The RPC never lets a preliminary match carry a signature flag, but a direct write could.
update btc_match_bonuses set team1_signature_beverage = true
  where match_id = '00000000-0000-0000-0000-0000000000d1';
select is((select team1_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d1'),
          0::bigint, 'a signature flag written directly onto a PRELIMINARY match is ignored by the view');
update btc_match_bonuses set team2_signature_beverage = true
  where match_id = '00000000-0000-0000-0000-0000000000d1';
select is((select team2_total from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d1'),
          50::bigint, 'the same guard holds for team 2 (45 tokens + 5, no +2)');

-- ---------- the view counts only votes the RPC could have written ----------
-- A stray vote past the round's last cup (cup 16 of a 15-cup match) must not count, exactly
-- like the client preview, which drops it.
insert into btc_cup_votes (match_id, cup_number, judge_id, team_id) values
  ('00000000-0000-0000-0000-0000000000d1', 16, '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000b1');
select is((select team1_tokens from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d1'),
          0::bigint, 'a direct-written vote past the last cup of the round is not counted');
-- A judge no longer assigned to the match stops counting (the preview drops them too).
delete from btc_match_judges
  where match_id = '00000000-0000-0000-0000-0000000000d1'
    and judge_id = '00000000-0000-0000-0000-0000000000c3';
select is((select team2_tokens from btc_match_scores where match_id = '00000000-0000-0000-0000-0000000000d1'),
          30::bigint, 'votes by a judge who is no longer assigned are not counted (45 -> 30 tokens)');
insert into btc_match_judges (match_id, judge_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c3');
delete from btc_cup_votes
  where match_id = '00000000-0000-0000-0000-0000000000d1' and cup_number = 16;

-- A match flipped to confirmed by a direct table write, holding no votes, must not reach
-- the standings (only complete, valid vote sets do).
update btc_matches set status = 'confirmed' where id = '00000000-0000-0000-0000-0000000000d5';
select is((select played::int from btc_standings where team_id = '00000000-0000-0000-0000-0000000000b1'),
          1, 'a directly-confirmed match with no votes does not count as played in the standings');

-- ---------- a member of a DIFFERENT org ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000006';

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-0000000000d1', now(),
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: match not found',
  'a member of another org, passing THEIR OWN org id, cannot confirm this match'
);
select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', now(),
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: match not found',
  'nor by passing the true owning org id: RLS hides the row, so it is the same not-found'
);

reset role;
reset request.jwt.claim.sub;

-- ---------- an outsider in no org ----------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';

select throws_ok(
  $$ select confirm_btc_match(
       '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-0000000000d1', now(),
       public.tmp_votes(15, 'split'), null, false, false, null, null) $$,
  'P0001', 'confirm_btc_match: match not found',
  'a non-member cannot confirm: RLS hides the row, so it is reported as not found'
);
select is((select count(*)::int from btc_match_scores), 0, 'a non-member reads zero rows from btc_match_scores');
select is((select count(*)::int from btc_standings), 0, 'a non-member reads zero rows from btc_standings');
select is((select count(*)::int from btc_cup_votes), 0, 'a non-member reads zero rows from btc_cup_votes');
select is((select count(*)::int from btc_match_bonuses), 0, 'a non-member reads zero rows from btc_match_bonuses');

reset role;
reset request.jwt.claim.sub;

select is(
  (select count(*)::int from processed_operations
     where id in ('00000000-0000-0000-0000-0000000000c1',
                  '00000000-0000-0000-0000-0000000000c2',
                  '00000000-0000-0000-0000-0000000000c3')),
  0, 'none of the rejected foreign or outsider calls left a ledger row behind'
);

-- ---------- privileges ----------

select is(has_table_privilege('anon', 'btc_match_totals', 'select'), false, 'anon has no SELECT on btc_match_totals');
select is(has_table_privilege('anon', 'btc_match_scores', 'select'), false, 'anon has no SELECT on btc_match_scores');
select is(has_table_privilege('anon', 'btc_standings', 'select'), false, 'anon has no SELECT on btc_standings');
select is(has_table_privilege('anon', 'btc_cup_totals', 'select'), false, 'anon has no SELECT on btc_cup_totals');
select is(
  has_function_privilege('anon', 'confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text)', 'execute'),
  false, 'anon cannot execute confirm_btc_match'
);
select is(
  has_function_privilege('authenticated', 'confirm_btc_match(uuid, uuid, uuid, timestamptz, jsonb, uuid, boolean, boolean, text, text)', 'execute'),
  true, 'authenticated can execute confirm_btc_match'
);

select * from finish();
rollback;
