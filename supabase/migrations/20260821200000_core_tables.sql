-- Seduh Score Next · T1.1 Core tables
-- orgs, org_members, people, person_merges, events, event_entries.
-- Handoff: SEDUH-NEXT-HANDOFF.md §5.1.
--
-- rollback:
--   drop table if exists event_entries;
--   drop table if exists events;
--   drop table if exists person_merges;
--   drop table if exists people;
--   drop table if exists org_members;
--   drop table if exists orgs;
--   drop function if exists app.set_updated_at();
--   drop schema if exists app;

create schema if not exists app;

-- updated_at is trigger-owned, never client-supplied, on every table that has one
-- (D11's "RLS on every table from day one" scaffolding extends to this: a client
-- can't forge a stale-looking or future updated_at to defeat the §9 offline
-- conflict check, which compares the updated_at a write read against the row's
-- current value).
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============ tenancy ============

create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table orgs enable row level security;

create trigger trg_orgs_set_updated_at
  before update on orgs
  for each row execute function app.set_updated_at();

create table org_members (
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'organiser',
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table org_members enable row level security;

-- ============ competitor registry — the Seduh ID seam ============

-- `phone` is NOT NULL: names and numbers are collected ahead of the event, and a
-- required natural key is what makes duplicate humans impossible rather than
-- merely regrettable. A same-day walk-up cannot be added without a number — an
-- accepted constraint, not an oversight (handoff §5.1).
create table people (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  global_person_id  uuid,                        -- reserved for Seduh ID; null today
  display_name      text not null,
  phone             text not null,
  email             text,
  cafe              text,                        -- CURRENT affiliation; display only
  country           text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table people enable row level security;

create trigger trg_people_set_updated_at
  before update on people
  for each row execute function app.set_updated_at();

create index on people (org_id);
create index on people (global_person_id) where global_person_id is not null;
create unique index on people (org_id, phone);
create unique index on people (org_id, lower(email)) where email is not null;

-- Merge ledger. `merged_id` is deliberately NOT a foreign key — the row is gone.
create table person_merges (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  kept_id      uuid not null references people(id) on delete cascade,
  merged_id    uuid not null,
  merged_name  text not null,
  merged_at    timestamptz not null default now(),
  merged_by    uuid references auth.users(id)
);
alter table person_merges enable row level security;

create index on person_merges (org_id, kept_id);

-- ============ events ============

create table events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  format      text not null,                     -- cup_taster | guess_the_bean
  name        text not null,
  event_date  date,
  venue       text,
  status      text not null default 'draft',     -- draft | running | concluded
  is_test     boolean not null default false,
  config      jsonb not null default '{}'::jsonb, -- config ONLY, never results
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table events enable row level security;

create trigger trg_events_set_updated_at
  before update on events
  for each row execute function app.set_updated_at();

create index on events (org_id, event_date desc);

-- `display_name` and `cafe` are SNAPSHOTS. Both change over a career; a cupper who
-- moves shops must not retroactively rewrite their 2026 record.
create table event_entries (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  person_id     uuid references people(id) on delete set null,
  display_name  text not null,
  cafe          text,
  bib           text,
  withdrawn     boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table event_entries enable row level security;

create index on event_entries (event_id);

-- Partial, scoped to linked entries only: a walk-up with no `people` row yet (D16 —
-- phone is required to register a person) has person_id null, and several such
-- unlinked entries can coexist in one event; this index only constrains "one person,
-- one entry, per event" for entries that are actually linked. (Postgres treats NULL
-- as distinct in a plain table-level UNIQUE too, so the partial scope isn't needed
-- to tolerate multiple nulls — it's kept for the explicit, unambiguous intent: this
-- constraint is about linked entries, and `ON CONFLICT (event_id, person_id) WHERE
-- person_id IS NOT NULL` can name it directly.)
create unique index on event_entries (event_id, person_id) where person_id is not null;
