-- Seduh Score Next · T-BTC.1 BTC (Barista Team Championship) tables
-- btc_teams, btc_judges, btc_matches, btc_match_judges, btc_cup_votes,
-- btc_match_bonuses, btc_bracket_slots, plus the btc_cup_totals,
-- btc_match_totals and btc_standings views.
-- Plan: BTC Next Migration — Plan of Action §5 (Supabase data model sketch).
-- Legacy reference: bbtc/index.html in the pre-Next repo — see the plan doc for
-- the full format-rules/data-model account this schema is derived from.
--
-- rollback:
--   drop view if exists btc_standings;
--   drop view if exists btc_match_totals;
--   drop view if exists btc_cup_totals;
--   drop table if exists btc_bracket_slots;
--   drop trigger if exists trg_btc_match_bonuses_check_teams on btc_match_bonuses;
--   drop function if exists app.check_btc_match_bonus_teams();
--   drop table if exists btc_match_bonuses;
--   drop trigger if exists trg_btc_cup_votes_check_participants on btc_cup_votes;
--   drop function if exists app.check_btc_cup_vote_participants();
--   drop table if exists btc_cup_votes;
--   drop table if exists btc_match_judges;
--   drop table if exists btc_matches;
--   drop table if exists btc_judges;
--   drop table if exists btc_teams;

-- ============ roster ============

create table btc_teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (event_id, name)
);
alter table btc_teams enable row level security;
create index on btc_teams (event_id);

create table btc_judges (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (event_id, name)
);
alter table btc_judges enable row level security;
create index on btc_judges (event_id);

-- ============ matches ============

-- No hardcoded team-count assumption anywhere in this table or its indexes —
-- a regional BTC event can field up to 24 teams (host + ACF countries +
-- invitational), so the preliminary round is sized for a large round-robin
-- match list, not just legacy's 8-team default (see the plan doc §5/§8).
create table btc_matches (
  id                         uuid primary key default gen_random_uuid(),
  event_id                   uuid not null references events(id) on delete cascade,
  round                      text not null,
      -- preliminary | quarterfinal | semifinal | final | third_place
  team1_id                   uuid not null references btc_teams(id) on delete restrict,
  team2_id                   uuid not null references btc_teams(id) on delete restrict,
  status                     text not null default 'pending', -- pending | scoring | confirmed
  team1_time_note            text, -- organiser-entered finish time; see plan doc §8 item 3
  team2_time_note            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint btc_matches_distinct_teams check (team1_id <> team2_id),
  constraint btc_matches_round_valid check (
    round in ('preliminary', 'quarterfinal', 'semifinal', 'final', 'third_place')
  ),
  constraint btc_matches_status_valid check (
    status in ('pending', 'scoring', 'confirmed')
  )
);
alter table btc_matches enable row level security;
create index on btc_matches (event_id, round);
create index on btc_matches (team1_id);
create index on btc_matches (team2_id);

create trigger trg_btc_matches_set_updated_at
  before update on btc_matches
  for each row execute function app.set_updated_at();

-- Exactly 3 judges per match (handoff-equivalent rule from the legacy format) is
-- NOT enforced here — a set-based count constraint across rows needs a deferred
-- trigger or a covering check function, and is deliberately left as an
-- application/RPC-layer validation. Tracked in Phase T-BTC.2's match-creation
-- RPC (BTC Next Migration — Plan of Action §6) — scoring-auditor reviews it
-- and a corresponding pgTAP test lands there, not guessed at schema level now.
create table btc_match_judges (
  match_id  uuid not null references btc_matches(id) on delete cascade,
  judge_id  uuid not null references btc_judges(id) on delete restrict,
  primary key (match_id, judge_id)
);
alter table btc_match_judges enable row level security;
create index on btc_match_judges (judge_id);

-- One row per judge's vote per cup — the raw atomic fact, mirroring
-- ct_results' own "correct is a count, never a column" discipline (root
-- CLAUDE.md non-negotiable) one level further than an earlier draft of this
-- migration did: a judge casts one token per cup toward a team (3 judges per
-- match, so up to 3 tokens per cup, shared between the two teams — legacy
-- rule, plan doc §2). Per-cup and per-match totals are ALWAYS derived
-- (btc_cup_totals/btc_match_totals below), never stored. This also makes
-- real per-judge audit possible server-side, which a pre-summed per-cup
-- column could not — legacy's own in-memory drinks[][] array couldn't do
-- this either (schema-guardian review, T-BTC.1).
create table btc_cup_votes (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references btc_matches(id) on delete cascade,
  cup_number  smallint not null,
  judge_id    uuid not null references btc_judges(id) on delete restrict,
  team_id     uuid not null references btc_teams(id) on delete restrict,
  created_at  timestamptz not null default now(),
  -- one vote per judge per cup — also the index the per-cup/per-match
  -- aggregation below actually queries on.
  unique (match_id, cup_number, judge_id)
);
alter table btc_cup_votes enable row level security;
create index on btc_cup_votes (match_id);

-- A CHECK constraint can't reference another table, so "this vote's team is
-- one of the match's two teams, and this vote's judge is actually assigned to
-- the match" is enforced here instead — same trigger-based cross-table guard
-- shape as app.check_live_session_org / app.check_btc_match_bonus_teams.
create or replace function app.check_btc_cup_vote_participants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team1 uuid;
  v_team2 uuid;
  v_judge_assigned boolean;
begin
  select team1_id, team2_id into v_team1, v_team2
  from public.btc_matches where id = new.match_id;

  if new.team_id not in (v_team1, v_team2) then
    raise exception 'btc_cup_votes.team_id must be a participant of the match';
  end if;

  select exists (
    select 1 from public.btc_match_judges
    where match_id = new.match_id and judge_id = new.judge_id
  ) into v_judge_assigned;

  if not v_judge_assigned then
    raise exception 'btc_cup_votes.judge_id must be assigned to the match';
  end if;

  return new;
end;
$$;

create trigger trg_btc_cup_votes_check_participants
  before insert or update on btc_cup_votes
  for each row execute function app.check_btc_cup_vote_participants();

-- Kept separate from btc_matches so a bonus-toggle edit doesn't touch the match
-- row's own concurrency story (plan doc §5's own stated rationale).
create table btc_match_bonuses (
  match_id                     uuid primary key references btc_matches(id) on delete cascade,
  fastest_team_id              uuid references btc_teams(id),
  signature_beverage_team_id   uuid references btc_teams(id),
  updated_at                   timestamptz not null default now()
);
alter table btc_match_bonuses enable row level security;

create trigger trg_btc_match_bonuses_set_updated_at
  before update on btc_match_bonuses
  for each row execute function app.set_updated_at();

-- A CHECK constraint can't reference another table, so "each bonus team must
-- actually be one of this match's two teams" is enforced here instead —
-- mirrors app.check_live_session_org's own trigger-based cross-table guard.
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

  if new.signature_beverage_team_id is not null
     and new.signature_beverage_team_id not in (v_team1, v_team2) then
    raise exception 'btc_match_bonuses.signature_beverage_team_id must be a participant of the match';
  end if;

  return new;
end;
$$;

create trigger trg_btc_match_bonuses_check_teams
  before insert or update on btc_match_bonuses
  for each row execute function app.check_btc_match_bonus_teams();

-- ============ bracket ============

-- feeder_slot_1/2 point at the QF/SF slots whose winners (or, for the
-- third-place slot, losers) fill this slot's two team positions — mirrors
-- legacy's seeds/from/winner/loser bracket-slot shape, server-side and
-- org-scoped. team1_id/team2_id use ON DELETE RESTRICT (matching
-- btc_matches' own team FKs); match_id and the self-referencing feeder slots
-- use ON DELETE SET NULL — a slot's own bracket position is the durable fact,
-- its resolved match/feeder links are bookkeeping that should clear rather
-- than block a delete elsewhere (schema-guardian review, T-BTC.1).
create table btc_bracket_slots (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  round          text not null,
  slot_label     text not null, -- qf1..qf4 | sf1 | sf2 | final | third_place
  seed_1         smallint,
  seed_2         smallint,
  team1_id       uuid references btc_teams(id) on delete restrict,
  team2_id       uuid references btc_teams(id) on delete restrict,
  match_id       uuid references btc_matches(id) on delete set null,
  feeder_slot_1  uuid references btc_bracket_slots(id) on delete set null,
  feeder_slot_2  uuid references btc_bracket_slots(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (event_id, slot_label),
  constraint btc_bracket_slots_round_valid check (
    round in ('quarterfinal', 'semifinal', 'final', 'third_place')
  )
);
alter table btc_bracket_slots enable row level security;
create index on btc_bracket_slots (event_id, round);
create index on btc_bracket_slots (match_id);
create index on btc_bracket_slots (feeder_slot_1);
create index on btc_bracket_slots (feeder_slot_2);

create trigger trg_btc_bracket_slots_set_updated_at
  before update on btc_bracket_slots
  for each row execute function app.set_updated_at();

-- ============ derived totals and standings ============
-- correct/tallies are a count, never a column (root CLAUDE.md's non-negotiable,
-- extended here from Cup Taster's ct_results/ct_standings split): per-cup
-- totals, match totals, and preliminary standings are always views, never
-- persisted fields.

-- security_invoker = true for the same reason ct_standings needs it (T1.2's own
-- comment): without it, a view runs as its owner on Postgres 15+, bypassing
-- the RLS policies T-BTC.1's own next migration adds.
create view btc_cup_totals
  with (security_invoker = true) as
select
  cv.match_id,
  cv.cup_number,
  count(*) filter (where cv.team_id = m.team1_id) as team1_tokens,
  count(*) filter (where cv.team_id = m.team2_id) as team2_tokens
from btc_cup_votes cv
join btc_matches m on m.id = cv.match_id
group by cv.match_id, cv.cup_number, m.team1_id, m.team2_id;

create view btc_match_totals
  with (security_invoker = true) as
select
  m.id as match_id,
  m.event_id,
  m.round,
  m.status,
  m.team1_id,
  m.team2_id,
  count(*) filter (where cv.team_id = m.team1_id) as team1_tokens,
  count(*) filter (where cv.team_id = m.team2_id) as team2_tokens,
  mb.fastest_team_id,
  mb.signature_beverage_team_id
from btc_matches m
left join btc_cup_votes cv on cv.match_id = m.id
left join btc_match_bonuses mb on mb.match_id = m.id
group by m.id, m.event_id, m.round, m.status, m.team1_id, m.team2_id,
         mb.fastest_team_id, mb.signature_beverage_team_id;

-- Preliminary leaderboard only (mirrors legacy's calcPrelimLB) — confirmed
-- matches, points = judge token sum + 5 round-winner bonus + 2 fastest-team
-- bonus (signature-beverage bonus is excluded here: it never applies in
-- preliminary per the format rules, plan doc §2).
create view btc_standings
  with (security_invoker = true) as
with totals as (
  select
    *,
    (team1_tokens > team2_tokens) as team1_is_round_winner,
    (team2_tokens > team1_tokens) as team2_is_round_winner
  from btc_match_totals
  where round = 'preliminary' and status = 'confirmed'
),
per_team as (
  select
    event_id,
    team1_id as team_id,
    team1_tokens
      + case when team1_is_round_winner then 5 else 0 end
      + case when fastest_team_id = team1_id then 2 else 0 end as points,
    team1_is_round_winner as won
  from totals
  union all
  select
    event_id,
    team2_id as team_id,
    team2_tokens
      + case when team2_is_round_winner then 5 else 0 end
      + case when fastest_team_id = team2_id then 2 else 0 end as points,
    team2_is_round_winner as won
  from totals
)
select
  event_id,
  team_id,
  count(*) as played,
  sum(case when won then 1 else 0 end)::int as wins,
  sum(points)::int as total_points
from per_team
group by event_id, team_id;
