-- Seduh Score Next · Guess the Bean — Phase 1 schema
-- Handoff: Handoffs and Specs/guess-the-bean-next-port-SPEC.md, Phase 1 + data model.
-- sessions/guesses/contacts, anchored directly to auth.users(id) — NOT org-scoped,
-- unlike Cup Taster's schema. This is a deliberate divergence per the spec's locked
-- identity-anchor decision: Guess the Bean is a personal Community-tier tool, one
-- creator per session, not an org-owned format. Seduh ID attaches later as an
-- additive seduh_id_profiles table on the same auth.users UUID — no re-keying
-- planned, so no seduh_id_profiles table is built here (spec's own do-not-touch).
--
-- rollback:
--   drop table if exists contacts;
--   drop table if exists guesses;
--   drop table if exists sessions;

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  guess_enabled boolean not null default true,
  revealed      boolean not null default false,
  orientation   text not null default 'landscape' check (orientation in ('landscape','portrait')),
  created_at    timestamptz not null default now()
);
alter table sessions enable row level security;

create index on sessions (creator_id);

create table guesses (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  guess       integer not null check (guess between 1 and 100000000),
  created_at  timestamptz not null default now()
);
alter table guesses enable row level security;

create index on guesses (session_id);

-- phone/instagram: privacy-split from guesses (handoff requirement) — a public
-- reveal shows guesses.name/guess to everyone, never this table's contents.
-- guess_id is unique: the entry form pairs exactly one contact row with each
-- guess (spec: "paired 1:1... same Firestore batch write" equivalent) — without
-- this, a retried client-side write is not guaranteed idempotent and could
-- attach two contact rows to one guess, leaving Phase 6's organiser-facing
-- winner lookup with an ambiguous result.
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  guess_id    uuid not null unique references guesses(id) on delete cascade,
  phone       text check (char_length(phone) <= 30),
  instagram   text check (char_length(instagram) <= 50),
  created_at  timestamptz not null default now(),
  constraint contact_required check (phone is not null or instagram is not null)
);
alter table contacts enable row level security;

-- No separate `create index on contacts (guess_id)`: the `unique` constraint
-- above already creates that index implicitly.
