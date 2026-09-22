-- Seduh Score Next · T-BTC.2 scoring, part 1: per-team signature-beverage bonus
--
-- Found by checking the legacy source while designing scoring (bbtc/index.html):
-- the signature-beverage bonus is a per-team flag there (s1.sigBev and s2.sigBev
-- are independent, both teams can earn it), while T-BTC.1 shipped a single
-- btc_match_bonuses.signature_beverage_team_id column that can only name ONE
-- team. Fastest-team really is mutually exclusive in legacy (turning it on for
-- one team clears the other), so fastest_team_id stays as it is.
--
-- Forward-only, per the repo rule that a pushed migration is never edited: the
-- T-BTC.1 migrations are already on the cloud project, so this is a new
-- migration. It also makes btc_match_scores the ONE place the +5 round-winner /
-- +2 fastest / +2 signature-beverage formula lives; btc_standings now reads
-- from it instead of carrying its own copy.
--
-- rollback:
--   drop view if exists btc_standings;
--   drop view if exists btc_match_scores;
--   drop view if exists btc_match_totals;
--   drop function if exists app.btc_cups_for_round(text);
--   alter table btc_cup_votes drop constraint btc_cup_votes_cup_number_range;
--   alter table btc_match_bonuses add column signature_beverage_team_id uuid references btc_teams(id);
--   update btc_match_bonuses mb
--     set signature_beverage_team_id = case
--       when mb.team1_signature_beverage then m.team1_id
--       when mb.team2_signature_beverage then m.team2_id end
--     from btc_matches m where m.id = mb.match_id;
--   alter table btc_match_bonuses drop column team1_signature_beverage;
--   alter table btc_match_bonuses drop column team2_signature_beverage;
--   then restore the previous definitions by copying, verbatim, from
--   20260918090000_btc_tables.sql: the function app.check_btc_match_bonus_teams,
--   then the views btc_match_totals and btc_standings (in that order), followed by
--   grant select on btc_match_totals to authenticated and on btc_standings to
--   authenticated. (The rollback was executed against a local database with exactly
--   those steps and the schema returned to its T-BTC.1 shape.)
--   The rollback is lossy only if BOTH teams had the flag on one match (the old
--   single column cannot hold that), which is exactly the defect this fixes.

drop view if exists btc_standings;
drop view if exists btc_match_totals;

alter table btc_match_bonuses
  add column team1_signature_beverage boolean not null default false,
  add column team2_signature_beverage boolean not null default false;

-- Carry any existing single-team value forward before the column goes away.
update btc_match_bonuses mb
set team1_signature_beverage = (mb.signature_beverage_team_id = m.team1_id),
    team2_signature_beverage = (mb.signature_beverage_team_id = m.team2_id)
from btc_matches m
where m.id = mb.match_id
  and mb.signature_beverage_team_id is not null;

alter table btc_match_bonuses drop column signature_beverage_team_id;

-- The participant guard now only concerns fastest_team_id; the two booleans are
-- positional (team1 / team2 of the match), so they cannot name a stranger.
create or replace function app.check_btc_match_bonus_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team1 uuid;
  v_team2 uuid;
begin
  select team1_id, team2_id into v_team1, v_team2
  from public.btc_matches where id = new.match_id;

  if new.fastest_team_id is not null
     and new.fastest_team_id not in (v_team1, v_team2) then
    raise exception 'btc_match_bonuses.fastest_team_id must be a participant of the match';
  end if;

  return new;
end;
$$;

-- The cup_number range was unconstrained in T-BTC.1. 20 is the largest round.
alter table btc_cup_votes
  add constraint btc_cup_votes_cup_number_range check (cup_number between 1 and 20);

-- Server-side truth for how many cups a round has (legacy RC table): 15 in the
-- preliminary round, 20 in every knockout round. The third-place match is scored
-- as a Finals-length match in legacy (createBracketMatch maps every non-qf/sf slot
-- to 'finals'), so it is 20 too. IMMUTABLE and pure. Defined here, not with the RPC,
-- because the views below need it and the confirm RPC (next migration) reuses it.
create or replace function app.btc_cups_for_round(p_round text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_round when 'preliminary' then 15 else 20 end;
$$;
revoke execute on function app.btc_cups_for_round(text) from public, anon;
grant execute on function app.btc_cups_for_round(text) to authenticated, service_role;

-- ============ derived views (security_invoker, same reasoning as T-BTC.1) ============

create view btc_match_totals
  with (security_invoker = true) as
select
  m.id as match_id,
  m.event_id,
  m.round,
  m.status,
  m.team1_id,
  m.team2_id,
  count(cv.id) filter (where cv.team_id = m.team1_id) as team1_tokens,
  count(cv.id) filter (where cv.team_id = m.team2_id) as team2_tokens,
  mb.fastest_team_id,
  coalesce(mb.team1_signature_beverage, false) as team1_signature_beverage,
  coalesce(mb.team2_signature_beverage, false) as team2_signature_beverage
from btc_matches m
-- Only votes the RPC could have written count: a cup inside the round, by a judge who is
-- assigned to this match. Table-level RLS lets a member write votes directly, and the
-- client preview (scoring.js validVoteEntries) applies the same two filters, so the view
-- and the preview cannot disagree about a stray row.
left join btc_cup_votes cv on cv.match_id = m.id
  and cv.cup_number <= app.btc_cups_for_round(m.round)
  and exists (
    select 1 from btc_match_judges mj
    where mj.match_id = m.id and mj.judge_id = cv.judge_id
  )
left join btc_match_bonuses mb on mb.match_id = m.id
group by m.id, m.event_id, m.round, m.status, m.team1_id, m.team2_id,
         mb.fastest_team_id, mb.team1_signature_beverage, mb.team2_signature_beverage;

-- THE scoring formula, in one place (legacy t1Tot/t2Tot): judge tokens, plus 5 to
-- the team with strictly more tokens, plus 2 for the fastest team, plus 2 for a
-- signature beverage but only outside the preliminary round.
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

-- Preliminary leaderboard (legacy calcPrelimLB): confirmed preliminary matches
-- only, and only ones that hold a complete set of valid votes (cups x 3), so a match
-- flipped to 'confirmed' by a direct table write cannot enter the standings. "won" is
-- the TOKEN round-winner. Legacy counts a win on the bonus-inclusive total instead;
-- for every match confirmed through the RPC the two agree, because it holds exactly 45
-- votes (odd, so no token tie) and the token winner gets +5 against at most +2 for the
-- other team. They can only differ on a token tie, which the RPC cannot produce. Knockout winners are NOT
-- decided here: a 20-cup match CAN tie on tokens (30-30, fastest team 32 v 30), so the
-- bracket step must decide winners on the bonus-inclusive team totals and leave a
-- total tie unresolved, never default it to team 2 as legacy's v1>v2 ? t1 : t2 does.
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

-- Dropping a view drops its grants. T-BTC.1's grants migration only revoked the
-- TABLES from anon, never these views; revoke-then-grant here so no environment
-- default can leave anon holding SELECT on any of them.
revoke all on btc_cup_totals from anon, authenticated;
grant select on btc_cup_totals to authenticated;
revoke all on btc_match_totals from anon, authenticated;
revoke all on btc_match_scores from anon, authenticated;
revoke all on btc_standings from anon, authenticated;
grant select on btc_match_totals to authenticated;
grant select on btc_match_scores to authenticated;
grant select on btc_standings to authenticated;
