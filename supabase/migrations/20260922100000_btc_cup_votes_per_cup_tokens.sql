-- Seduh Score Next · T-BTC.2 scoring, part 4: per-cup token totals, not per-judge votes
--
-- Design correction, caught by comparing against the legacy Seduh Score UI before this
-- work merged: judges are on record for transparency (still exactly 3 assigned per
-- match, still shown on the scoring screen), but scoring itself was never meant to
-- attribute a vote to an individual judge. A cup holds exactly 3 tokens, split between
-- the two teams; the scorer enters ONE number — team1's share (0-3) — and team2's share
-- is always the balance (3 - team1). btc_cup_votes previously stored one row per
-- (cup, judge) with its own team_id, which both over-modelled the data (an audit trail
-- nothing in this format's rules or the legacy UI ever asked for — see the superseded
-- comment on btc_cup_votes in 20260918090000_btc_tables.sql) and made the scoring
-- screen's own 45-90 button grid needlessly complex. This migration is forward-only, as
-- the three migrations it edits the shape of (20260922090000/091000/092000) are already
-- pushed to the cloud project and are never edited themselves.
--
-- rollback (lossy: there is no way to reconstruct synthetic per-judge/per-team votes
-- from a bare team1_tokens count, so this restores the OLD SHAPE only, never real
-- per-judge data — acceptable because nothing has scored a live match under either
-- shape yet; verified against an empty btc_cup_votes both locally and on the cloud
-- project before this migration was written):
--   drop view if exists btc_standings;
--   drop view if exists btc_match_scores;
--   drop view if exists btc_match_totals;
--   drop view if exists btc_cup_totals;
--   alter table btc_cup_votes drop constraint btc_cup_votes_match_cup_unique;
--   alter table btc_cup_votes drop column team1_tokens;
--   alter table btc_cup_votes add column judge_id uuid references btc_judges(id) on delete restrict;
--   alter table btc_cup_votes add column team_id uuid references btc_teams(id) on delete restrict;
--   alter table btc_cup_votes alter column judge_id set not null;
--   alter table btc_cup_votes alter column team_id set not null;
--   alter table btc_cup_votes add constraint btc_cup_votes_match_id_cup_number_judge_id_key
--     unique (match_id, cup_number, judge_id);
--   create or replace function app.check_btc_cup_vote_participants()
--     returns trigger language plpgsql security definer set search_path = ''
--     as $$ begin
--       if not exists (select 1 from public.btc_match_judges mj where mj.match_id = new.match_id and mj.judge_id = new.judge_id) then
--         raise exception 'btc_cup_votes: the judge must be assigned to this match';
--       end if;
--       if not exists (select 1 from public.btc_matches m where m.id = new.match_id and new.team_id in (m.team1_id, m.team2_id)) then
--         raise exception 'btc_cup_votes: the team must be a participant of this match';
--       end if;
--       return new;
--     end; $$;
--   create trigger trg_btc_cup_votes_check_participants
--     before insert or update of match_id, judge_id, team_id on btc_cup_votes
--     for each row execute function app.check_btc_cup_vote_participants();
--   then restore btc_cup_totals/btc_match_totals/btc_match_scores/btc_standings by
--   copying, verbatim, from 20260918090000_btc_tables.sql and
--   20260922090000_btc_bonuses_per_team_signature.sql, followed by the same
--   revoke-then-grant select on all four to authenticated the earlier migrations used.
--   (Run and verified live in a transaction against a local database with exactly
--   those steps; the schema returned to its pre-this-migration shape.)

drop view if exists btc_standings;
drop view if exists btc_match_scores;
drop view if exists btc_match_totals;
drop view if exists btc_cup_totals;

drop trigger if exists trg_btc_cup_votes_check_participants on btc_cup_votes;
drop function if exists app.check_btc_cup_vote_participants();

alter table btc_cup_votes
  drop column judge_id,
  drop column team_id,
  add column team1_tokens smallint not null check (team1_tokens between 0 and 3),
  add constraint btc_cup_votes_match_cup_unique unique (match_id, cup_number);

-- ============ derived views, recreated on the new shape ============

create view btc_cup_totals
  with (security_invoker = true) as
select
  cv.match_id,
  cv.cup_number,
  cv.team1_tokens,
  (3 - cv.team1_tokens) as team2_tokens
from btc_cup_votes cv;

create view btc_match_totals
  with (security_invoker = true) as
select
  m.id as match_id,
  m.event_id,
  m.round,
  m.status,
  m.team1_id,
  m.team2_id,
  -- Only a cup inside the round counts (matches scoring.js's own filter, so the view
  -- and the JS preview cannot disagree about a stray direct-written row).
  coalesce(
    sum(cv.team1_tokens) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)), 0
  ) as team1_tokens,
  coalesce(
    sum(3 - cv.team1_tokens) filter (where cv.cup_number <= app.btc_cups_for_round(m.round)), 0
  ) as team2_tokens,
  mb.fastest_team_id,
  coalesce(mb.team1_signature_beverage, false) as team1_signature_beverage,
  coalesce(mb.team2_signature_beverage, false) as team2_signature_beverage
from btc_matches m
left join btc_cup_votes cv on cv.match_id = m.id
left join btc_match_bonuses mb on mb.match_id = m.id
group by m.id, m.event_id, m.round, m.status, m.team1_id, m.team2_id,
         mb.fastest_team_id, mb.team1_signature_beverage, mb.team2_signature_beverage;

-- THE scoring formula, unchanged from 20260922090000 (legacy t1Tot/t2Tot): tokens,
-- plus 5 to the team with strictly more tokens, plus 2 for the fastest team, plus 2
-- for a signature beverage but only outside the preliminary round.
create view btc_match_scores
  with (security_invoker = true) as
select
  t.match_id,
  t.event_id,
  t.round,
  t.status,
  t.team1_id,
  t.team2_id,
  t.team1_tokens,
  t.team2_tokens,
  t.team1_tokens
    + case when t.team1_tokens > t.team2_tokens then 5 else 0 end
    + case when t.fastest_team_id = t.team1_id then 2 else 0 end
    + case when t.round <> 'preliminary' and t.team1_signature_beverage then 2 else 0 end
    as team1_total,
  t.team2_tokens
    + case when t.team2_tokens > t.team1_tokens then 5 else 0 end
    + case when t.fastest_team_id = t.team2_id then 2 else 0 end
    + case when t.round <> 'preliminary' and t.team2_signature_beverage then 2 else 0 end
    as team2_total
from btc_match_totals t;

-- Preliminary leaderboard, unchanged reasoning from 20260922090000: a confirmed
-- match only counts once it holds a complete set of cups (each cup always contributes
-- exactly 3 tokens now, so total tokens = cups x 3 is still equivalent to "every cup
-- scored" — the same completeness proxy as before, just simpler to reach).
create view btc_standings
  with (security_invoker = true) as
with per_team as (
  select event_id, team1_id as team_id, team1_total as points,
         (team1_tokens > team2_tokens) as won
  from btc_match_scores
  where round = 'preliminary' and status = 'confirmed'
    and team1_tokens + team2_tokens = app.btc_cups_for_round(round) * 3
  union all
  select event_id, team2_id as team_id, team2_total as points,
         (team2_tokens > team1_tokens) as won
  from btc_match_scores
  where round = 'preliminary' and status = 'confirmed'
    and team1_tokens + team2_tokens = app.btc_cups_for_round(round) * 3
)
select
  event_id,
  team_id,
  count(*) as played,
  sum(case when won then 1 else 0 end)::int as wins,
  sum(points)::int as total_points
from per_team
group by event_id, team_id;

-- Dropping a view drops its grants (same reasoning as 20260922090000).
revoke all on btc_cup_totals from anon, authenticated;
grant select on btc_cup_totals to authenticated;
revoke all on btc_match_totals from anon, authenticated;
grant select on btc_match_totals to authenticated;
revoke all on btc_match_scores from anon, authenticated;
grant select on btc_match_scores to authenticated;
revoke all on btc_standings from anon, authenticated;
grant select on btc_standings to authenticated;
