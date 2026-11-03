-- Seduh Score Next - T-TD.1.2: Throwdown tables (individual 1v1 knockout)
--
-- td_settings, td_draws, td_rounds, td_matches, td_slots, td_votes, plus the td_match_results view and the module
-- registry hook. Spec: Handoffs and Specs/THROWDOWN-SPEC-DRAFT.md (local only), sections 4 to 7.
--
-- The shape is general on purpose, so a later module never forces a migration of these tables:
--   * a ROUND has a kind (pair | pool) and a phase (main | redemption | third_place). TD.1 builds only pair rounds;
--     the pool kind is allowed by the checks and by the slot-count rule below, and nothing creates one yet.
--   * a MATCH has 2 to 4 SLOTS (a pair round's matches have exactly 2). A slot holds a competitor (an event_entries
--     row) or is empty (the opponent of a bye).
--   * a VOTE is a row: one tap, carrying the slot it counts for, no judge identity (spec decision 5). Totals, the
--     leader and the winner are ALWAYS derived (td_match_results); no column holds a count or a "who is winning".
--   * the only stored result facts are: result_kind (votes | walkover | bye), when it was confirmed, and for a
--     walkover the explicit winner's slot position. Pauses, "round done" and the champion are derived from the rows
--     (never flags), so pressing Continue twice cannot duplicate a round.
--   * a competitor is an event_entries row (the roster the platform already has); "withdrawn" is that row's own flag, so
--     the 8-player cap question (spec Q8b) can be settled later without a schema change.
--
-- Every write goes through the SECURITY DEFINER functions of the next migration: the API roles hold SELECT only, so a
-- client cannot insert a vote past a confirmed result or move a slot. RLS read policies are org-scoped through
-- app.is_org_member, and every parent column is frozen (SQLSTATE 23001), per the tenancy rules in CONVENTIONS.md.
--
-- rollback:
--   drop view if exists td_match_results;
--   drop table if exists td_votes;
--   drop table if exists td_slots;
--   drop table if exists td_matches;
--   drop table if exists td_rounds;
--   drop table if exists td_draws;
--   drop table if exists td_settings;
--   drop function if exists app.check_td_vote();
--   drop function if exists app.check_td_slot();
--   drop function if exists app.check_td_match();
--   drop function if exists app.td_settings_locked();
--   drop function if exists app.td_modules_known(jsonb);
--   drop function if exists app.td_known_modules();
--   drop function if exists app.td_module_registry();

-- ============ the module registry (empty in TD.1: the toggle mechanism exists, no module does) ============
-- One row per module a later phase adds: its key, the modules it needs (declared dependencies) and the entitlement
-- key that unlocks it (per-module key slot). A phase adds a module by REPLACING this function; the settings check,
-- the dependency check and the entitlement check all read it, so nothing else changes.
create or replace function app.td_module_registry()
returns table (module text, requires text[], entitlement_key text)
language sql
immutable
set search_path = ''
as $$
  select null::text, null::text[], null::text where false;
$$;
revoke all on function app.td_module_registry() from public, anon, authenticated, service_role;

create or replace function app.td_known_modules()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(module), '{}'::text[]) from app.td_module_registry();
$$;
revoke all on function app.td_known_modules() from public, anon, authenticated, service_role;

create or replace function app.td_modules_known(p_modules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_modules) = 'object'
     and not exists (select 1 from jsonb_object_keys(p_modules) k where k <> all (app.td_known_modules()));
$$;
revoke all on function app.td_modules_known(jsonb) from public, anon, authenticated, service_role;

-- ============ settings (locked when Round 1 starts) ============

create table td_settings (
  event_id      uuid primary key references events(id) on delete cascade,
  judge_count   smallint not null default 3,
  third_place   boolean not null default true,
  seeding_mode  text not null default 'random',
  -- module toggles: { "<module key>": true | {config} }. Empty in TD.1; every key must be in the registry above.
  modules       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint td_settings_judge_count_valid check (judge_count between 1 and 15),
  constraint td_settings_seeding_valid check (seeding_mode in ('random', 'manual')),
  constraint td_settings_modules_valid check (app.td_modules_known(modules))
);
alter table td_settings enable row level security;

create trigger trg_td_settings_set_updated_at
  before update on td_settings
  for each row execute function app.set_updated_at();
create trigger trg_td_settings_event_immutable
  before update on td_settings
  for each row execute function app.forbid_parent_change('event_id');

-- The lock: once Round 1 exists, setup (judge count, 3rd place, seeding mode, every module toggle) cannot change.
-- Defence in depth: the RPC checks it first and gives the friendly refusal; this holds for any other writer.
create or replace function app.td_settings_locked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.td_rounds where event_id = new.event_id) then
    raise exception 'throwdown setup is locked: Round 1 has started'
      using errcode = '23001', hint = 'td_setup_locked';
  end if;
  return new;
end;
$$;
revoke all on function app.td_settings_locked() from public, anon, authenticated, service_role;
create trigger trg_td_settings_locked
  before insert or update on td_settings
  for each row execute function app.td_settings_locked();

-- ============ the draw record ============
-- What a random draw cannot be recomputed from is stored once: the mode, the seed of the recorded shuffle (null for a
-- manual draw) and the slot count the organiser chose. One row per event: a second start is refused by the key.

create table td_draws (
  event_id     uuid primary key references events(id) on delete cascade,
  mode         text not null,
  seed         text,
  slot_count   smallint not null,
  created_at   timestamptz not null default now(),
  constraint td_draws_mode_valid check (mode in ('random', 'manual')),
  constraint td_draws_seed_matches_mode check ((mode = 'random') = (seed is not null)),
  constraint td_draws_slot_count_valid check (slot_count >= 2)
);
alter table td_draws enable row level security;
create trigger trg_td_draws_event_immutable
  before update on td_draws
  for each row execute function app.forbid_parent_change('event_id');

-- ============ rounds ============

create table td_rounds (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  position    smallint not null,   -- play order; the 3rd place round sits just before the Final and both are live at once
  kind        text not null default 'pair',
  phase       text not null default 'main',
  created_at  timestamptz not null default now(),
  unique (event_id, position),
  constraint td_rounds_position_valid check (position >= 1),
  constraint td_rounds_kind_valid check (kind in ('pair', 'pool')),
  constraint td_rounds_phase_valid check (phase in ('main', 'redemption', 'third_place')),
  -- a pool round is a redemption round and nothing else (reserved shape; TD.3)
  constraint td_rounds_kind_phase check ((kind = 'pool') = (phase = 'redemption'))
);
alter table td_rounds enable row level security;
create trigger trg_td_rounds_parent_immutable
  before update on td_rounds
  for each row execute function app.forbid_parent_change('event_id');

-- ============ matches ============

create table td_matches (
  id                         uuid primary key default gen_random_uuid(),
  event_id                   uuid not null references events(id) on delete cascade,
  round_id                   uuid not null references td_rounds(id) on delete cascade,
  position                   smallint not null,
  -- the stored result facts; null result_kind = not decided yet
  result_kind                text,
  confirmed_at               timestamptz,
  walkover_winner_position   smallint,
  created_at                 timestamptz not null default now(),
  unique (round_id, position),
  constraint td_matches_position_valid check (position >= 1),
  constraint td_matches_result_kind_valid check (result_kind in ('votes', 'walkover', 'bye')),
  constraint td_matches_confirmed_with_result check ((result_kind is null) = (confirmed_at is null)),
  constraint td_matches_walkover_winner check (
    coalesce(result_kind = 'walkover', false) = (walkover_winner_position is not null)
    and (walkover_winner_position is null or walkover_winner_position between 1 and 4)
  )
);
alter table td_matches enable row level security;
create index on td_matches (event_id);
create index on td_matches (round_id);
create trigger trg_td_matches_parent_immutable
  before update on td_matches
  for each row execute function app.forbid_parent_change('event_id', 'round_id');

create or replace function app.check_td_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_matches');
  if (select r.event_id from public.td_rounds r where r.id = new.round_id) is distinct from new.event_id then
    raise exception 'td_matches.round_id must belong to the same event';
  end if;
  return new;
end;
$$;
revoke all on function app.check_td_match() from public, anon, authenticated, service_role;
create trigger trg_td_matches_xref
  before insert or update on td_matches
  for each row execute function app.check_td_match();

-- ============ slots ============

create table td_slots (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id) on delete cascade,
  match_id         uuid not null references td_matches(id) on delete cascade,
  position         smallint not null,
  -- the competitor; null = empty (the opponent of a bye). NO ACTION on purpose: a roster entry in the bracket cannot
  -- be deleted (withdraw it), but deleting a whole event still cascades through both tables.
  entry_id         uuid references event_entries(id),
  -- where the competitor came from (provenance only): the match whose winner or loser this slot holds
  feeder_match_id  uuid references td_matches(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (match_id, position),
  constraint td_slots_position_valid check (position between 1 and 4)
);
alter table td_slots enable row level security;
create index on td_slots (event_id);
create index on td_slots (match_id);
create index on td_slots (entry_id);
create index on td_slots (feeder_match_id);
create trigger trg_td_slots_parent_immutable
  before update on td_slots
  for each row execute function app.forbid_parent_change('event_id', 'match_id');

-- The slot count rule: a pair round's matches hold exactly 2 slots (positions 1 and 2); a pool round's hold 2 to 4.
create or replace function app.check_td_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_kind  text;
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_slots');
  select m.event_id, r.kind into v_event, v_kind
    from public.td_matches m join public.td_rounds r on r.id = m.round_id
   where m.id = new.match_id;
  if v_event is distinct from new.event_id then
    raise exception 'td_slots.match_id must belong to the same event';
  end if;
  if v_kind = 'pair' and new.position > 2 then
    raise exception 'a pair match has exactly 2 slots';
  end if;
  if new.entry_id is not null
     and (select e.event_id from public.event_entries e where e.id = new.entry_id) is distinct from new.event_id then
    raise exception 'td_slots.entry_id must belong to the same event';
  end if;
  return new;
end;
$$;
revoke all on function app.check_td_slot() from public, anon, authenticated, service_role;
create trigger trg_td_slots_xref
  before insert or update on td_slots
  for each row execute function app.check_td_slot();

-- ============ votes: one row per tap, no judge identity ============

create table td_votes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  match_id    uuid not null references td_matches(id) on delete cascade,
  slot_id     uuid not null references td_slots(id) on delete cascade,
  created_at  timestamptz not null default clock_timestamp()
);
alter table td_votes enable row level security;
create index on td_votes (event_id);
create index on td_votes (match_id);
create index on td_votes (slot_id, created_at);
create trigger trg_td_votes_parent_immutable
  before update on td_votes
  for each row execute function app.forbid_parent_change('event_id', 'match_id', 'slot_id');

create or replace function app.check_td_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot_match uuid;
  v_slot_event uuid;
  v_slot_entry uuid;
  v_match_event uuid;
  v_confirmed  timestamptz;
begin
  perform app.refuse_non_member(app.org_id_for_event_internal(new.event_id), 'td_votes');
  select s.match_id, s.event_id, s.entry_id into v_slot_match, v_slot_event, v_slot_entry
    from public.td_slots s where s.id = new.slot_id;
  select m.event_id, m.confirmed_at into v_match_event, v_confirmed
    from public.td_matches m where m.id = new.match_id;
  if v_slot_match is distinct from new.match_id or v_slot_event is distinct from new.event_id
     or v_match_event is distinct from new.event_id then
    raise exception 'td_votes: the slot must belong to the match, and both to the event';
  end if;
  if v_slot_entry is null then
    raise exception 'td_votes: a vote needs a competitor in the slot' using hint = 'td_slot_empty';
  end if;
  if v_confirmed is not null then
    raise exception 'td_votes: the match is already decided' using errcode = '23001', hint = 'td_match_decided';
  end if;
  return new;
end;
$$;
revoke all on function app.check_td_vote() from public, anon, authenticated, service_role;
create trigger trg_td_votes_xref
  before insert or update on td_votes
  for each row execute function app.check_td_vote();

-- ============ derived: who won each decided match ============
-- The ONE place a winner is computed in SQL (the functions and the tests read this). votes: the slot with strictly the
-- most vote rows, or null while level; walkover: the explicit winner's slot; bye: the one filled slot. Undecided
-- matches have no winner. security_invoker so the caller's row-level security applies.
create view td_match_results
  with (security_invoker = true) as
select
  m.id as match_id,
  m.event_id,
  m.result_kind,
  m.confirmed_at,
  case m.result_kind
    when 'bye' then (
      select s.id from td_slots s where s.match_id = m.id and s.entry_id is not null order by s.position limit 1)
    when 'walkover' then (
      select s.id from td_slots s where s.match_id = m.id and s.position = m.walkover_winner_position)
    when 'votes' then (
      select case when count(*) filter (where t.n = t.mx) = 1
                  then (array_agg(t.slot_id) filter (where t.n = t.mx))[1] end
        from (
          select s.id as slot_id,
                 count(v.id) as n,
                 max(count(v.id)) over () as mx
            from td_slots s left join td_votes v on v.slot_id = s.id
           where s.match_id = m.id and s.entry_id is not null
           group by s.id
        ) t)
  end as winner_slot_id
from td_matches m;

-- ============ row-level security: org members read; nobody writes directly ============

create policy td_settings_read on td_settings for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy td_draws_read on td_draws for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy td_rounds_read on td_rounds for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy td_matches_read on td_matches for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy td_slots_read on td_slots for select using (app.is_org_member(app.org_id_for_event(event_id)));
create policy td_votes_read on td_votes for select using (app.is_org_member(app.org_id_for_event(event_id)));

-- ============ grants: SELECT only (every write is a SECURITY DEFINER function) ============

revoke all on td_settings, td_draws, td_rounds, td_matches, td_slots, td_votes from anon, authenticated;
grant select on td_settings to authenticated;
grant select on td_draws to authenticated;
grant select on td_rounds to authenticated;
grant select on td_matches to authenticated;
grant select on td_slots to authenticated;
grant select on td_votes to authenticated;
revoke all on td_match_results from anon, authenticated;
grant select on td_match_results to authenticated;
