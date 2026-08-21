-- Seduh Score Next · T1.2 Cup Taster tables
-- ct_stages, ct_sets, ct_stage_entries, ct_heats, ct_heat_entries, ct_results,
-- plus the ct_standings view.
-- Handoff: SEDUH-NEXT-HANDOFF.md §5.2.
--
-- rollback:
--   drop view if exists ct_standings;
--   drop table if exists ct_results;
--   drop table if exists ct_heat_entries;
--   drop table if exists ct_heats;
--   drop table if exists ct_stage_entries;
--   drop table if exists ct_sets;
--   drop table if exists ct_stages;

create table ct_stages (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  kind          text not null,                   -- prelims | semis | finals
  ordinal       smallint not null,
  set_count     smallint not null,
  duration_secs integer not null,
  cutoff        smallint,                        -- null on the terminal stage
  status        text not null default 'pending', -- pending | running | complete
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, ordinal)
);
alter table ct_stages enable row level security;

create trigger trg_ct_stages_set_updated_at
  before update on ct_stages
  for each row execute function app.set_updated_at();

-- Sets carry position and nothing about their contents. Coffee identity is
-- deliberately not recorded (D18).
create table ct_sets (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references ct_stages(id) on delete cascade,
  position    smallint not null,
  label       text,
  created_at  timestamptz not null default now(),
  unique (stage_id, position)
);
alter table ct_sets enable row level security;

-- Who is in a stage and why. Carries advancement provenance, including
-- tiebreak and coin-toss resolutions.
create table ct_stage_entries (
  id              uuid primary key default gen_random_uuid(),
  stage_id        uuid not null references ct_stages(id) on delete cascade,
  entry_id        uuid not null references event_entries(id) on delete cascade,
  source          text not null default 'seed',
      -- seed | advanced | tiebreak_won | coin_toss | manual
  final_position  smallint,
  position_note   text,                          -- "coin toss, witnessed by …"
  created_at      timestamptz not null default now(),
  unique (stage_id, entry_id)
);
alter table ct_stage_entries enable row level security;

create table ct_heats (
  id                   uuid primary key default gen_random_uuid(),
  stage_id             uuid not null references ct_stages(id) on delete cascade,
  heat_number          smallint not null,
  kind                 text not null default 'normal',   -- normal | tiebreak
  timing_mode          text not null default 'app',      -- app | manual
  status               text not null default 'pending',
      -- pending | timing | scoring | confirmed
  duration_secs        integer not null,                 -- snapshot at creation
  started_at           timestamptz,
  master_elapsed_secs  integer,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (stage_id, heat_number, kind)
);
alter table ct_heats enable row level security;

create trigger trg_ct_heats_set_updated_at
  before update on ct_heats
  for each row execute function app.set_updated_at();

-- Per-cupper timing. `elapsed_secs` is the single authoritative value everything
-- ranks on, already clamped (core/timeclamp is the sole writer — never a raw
-- assignment; enforced in application code by no-raw-elapsed-write, not here,
-- since the cap depends on the heat's duration_secs, not a fixed bound this CHECK
-- could express). `elapsed_secs_raw` preserves what was entered or tapped before
-- clamping.
create table ct_heat_entries (
  id                uuid primary key default gen_random_uuid(),
  heat_id           uuid not null references ct_heats(id) on delete cascade,
  entry_id          uuid not null references event_entries(id) on delete cascade,
  station           text,                         -- "Table A" — assigned by the app
  elapsed_secs      integer,
  elapsed_secs_raw  integer,
  maxed             boolean not null default false,
  time_source       text not null default 'tapped',  -- tapped | manual | maxed
  time_note         text,
  time_edited_at    timestamptz,
  created_at        timestamptz not null default now(),
  unique (heat_id, entry_id),
  constraint ct_heat_entries_elapsed_nonneg
    check (elapsed_secs is null or elapsed_secs >= 0)
);
alter table ct_heat_entries enable row level security;
create index on ct_heat_entries (entry_id);

-- The atomic fact. One row per cupper per set. Everything derives from here.
-- `correct` here is the raw per-set-per-cupper fact a judge records — never
-- confused with a per-heat/per-stage TALLY, which is always derived (ct_standings
-- below), never a stored column anywhere in this schema.
create table ct_results (
  id             uuid primary key default gen_random_uuid(),
  heat_entry_id  uuid not null references ct_heat_entries(id) on delete cascade,
  set_id         uuid not null references ct_sets(id) on delete cascade,
  correct        boolean not null,
  created_at     timestamptz not null default now(),
  unique (heat_entry_id, set_id)
);
alter table ct_results enable row level security;
create index on ct_results (set_id);

-- Standings: the count is a view, never a column (handoff §5.2). Per (entry,
-- stage): how many sets correct across every heat the entry ran in that stage's
-- NORMAL heats, and total elapsed time — the two inputs §7.3's champion rule
-- (most correct, then fastest time) ranks on. core/ranking (Phase 2) consumes
-- this, it doesn't reimplement the aggregation.
--
-- Restricted to kind = 'normal': a tiebreak (§7.2) is a separate heat among only
-- the tied cuppers, and §7.3 treats "most correct → fastest time → one tiebreak
-- set → coin toss" as SEQUENTIAL tie-breaking criteria, not summed inputs. An
-- entry that runs a tiebreak gets a second ct_heat_entries row in the same
-- stage — without this filter its tiebreak set's correctness and time would
-- silently blend into the primary tally, distorting the comparison relative to
-- competitors who never tied and never ran one. The tiebreak's own outcome is a
-- separate read (ct_heats where kind = 'tiebreak'), never merged in here.
--
-- security_invoker = true: without it, a view is evaluated as its OWNER on
-- Postgres 15+ (this stack is on major_version 17), bypassing the RLS policies
-- T1.3 adds to the underlying tables — a cross-tenant leak through the one
-- surface Phase 2 ranking is meant to read. With it, the view runs as the
-- querying role, so T1.3's policies apply exactly as they would to a direct
-- query against ct_heat_entries/ct_heats/ct_results.
create view ct_standings
  with (security_invoker = true) as
select
  he.entry_id,
  h.stage_id,
  count(r.id) filter (where r.correct) as correct_count,
  count(r.id) as sets_scored,
  sum(he.elapsed_secs) as total_elapsed_secs
from ct_heat_entries he
join ct_heats h on h.id = he.heat_id
left join ct_results r on r.heat_entry_id = he.id
where h.kind = 'normal'
group by he.entry_id, h.stage_id;
