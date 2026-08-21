-- Seduh Score Next · live_sessions table
-- Handoff: SEDUH-NEXT-HANDOFF.md §5.3. Not an explicit T1.1/T1.2 table (those lists
-- are §5.1 core and §5.2 Cup Taster respectively; live_sessions is §5.3 "Live" —
-- shared, format-agnostic infrastructure). Created here, ahead of T1.3's RLS task,
-- since T1.3's own AC requires it to exist ("live_sessions open for read, org-write").
--
-- rollback:
--   drop table if exists live_sessions;

-- Keyed by event_id, not org_id (D19): BRACKET-LIVE-SPEC.md §2A accepted one live
-- document per org, overwritten in place — past events left no trace. The partial
-- unique index below gives the same one-live-event-per-org guarantee while
-- retaining history.
create table live_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  event_id    uuid not null references events(id) on delete cascade,
  format      text not null,
  active      boolean not null default false,
  is_test     boolean not null default false,
  payload     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (event_id)
);
alter table live_sessions enable row level security;

create trigger trg_live_sessions_set_updated_at
  before update on live_sessions
  for each row execute function app.set_updated_at();

create unique index live_sessions_one_active_per_org
  on live_sessions (org_id) where active;
