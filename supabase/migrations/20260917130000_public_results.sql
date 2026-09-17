-- Seduh Score Next · public_results table + city column + publish/unpublish RPCs
-- (2026-09-17, user-requested "highlights/archive" public results page — the fake-data
-- design preview at /results/ (src/marketing/resultsScreen.js) needs a real,
-- organiser-controlled publish pipeline before real Cup Taster results can reach it.
-- Phase 1 of that build: schema only, no UI wiring yet.
--
-- rollback:
--   revoke execute on function unpublish_event_results(uuid, uuid) from service_role;
--   revoke execute on function unpublish_event_results(uuid, uuid) from authenticated;
--   drop function if exists unpublish_event_results(uuid, uuid);
--   revoke execute on function publish_event_results(uuid, uuid, jsonb) from service_role;
--   revoke execute on function publish_event_results(uuid, uuid, jsonb) from authenticated;
--   drop function if exists publish_event_results(uuid, uuid, jsonb);
--   drop trigger if exists trg_public_results_org_check on public_results;
--   drop function if exists app.check_public_results_org();
--   drop policy if exists public_results_org on public_results;
--   drop policy if exists public_results_read_public on public_results;
--   revoke select, insert, update, delete on public_results from authenticated;
--   revoke select on public_results from anon;
--   drop table if exists public_results;
--   alter table events drop column if exists city;

-- `venue` (20260821200000_core_tables.sql) is the only location field events has
-- today. The results archive wants City and Venue as two separate columns in its
-- "Location"/venue display (user decision, 2026-09-17) — City is new, optional,
-- organiser-entered, same shape as venue right next to it.
alter table events add column city text;

-- One published snapshot per event, not a live re-derivation. This is a deliberate
-- exception to `no-derived-storage`'s "never persist a tally" rule, same category as
-- `event_entries.display_name`/`cafe` already being explicit SNAPSHOTS
-- (20260821200000_core_tables.sql's own comment on that table): the podium/counts in
-- `payload` are computed once, client-side, from `analytics.js`'s already-reviewed
-- `computeEventSummary()` (which itself reads live standings/final_position — this
-- table never competes with that as a second live source of truth), at the moment an
-- organiser explicitly chooses to publish. `no-derived-storage`'s actual target is
-- `ct_results`/`ct_standings` staying pure during a LIVE event; a one-way public
-- export taken after the event has already concluded is a different concern
-- entirely — same reasoning `live_sessions.payload` already established for the
-- audience-facing live surfaces.
create table public_results (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  event_id      uuid not null unique references events(id) on delete cascade,
  payload       jsonb not null,
  published_at  timestamptz not null default now(),
  published_by  uuid references auth.users(id)
);
alter table public_results enable row level security;
create index on public_results (org_id);

-- Anon-public read, same shape and same documented caveat as
-- 20260831100000_events_anon_safe_read.sql's own events_read_public: this app is
-- single-org today, so an anon caller reading every org's published rows is not a
-- live information-disclosure concern yet, but IS a real one to revisit before any
-- self-serve multi-org onboarding ships.
create policy public_results_read_public on public_results
  for select
  to anon
  using (true);

-- Org-member read+write, same shape as processed_operations_write
-- (20260822100000_confirm_heat_rpc.sql) and every other org-scoped table
-- (20260821230000_rls_policies.sql). This is the RLS defense-in-depth layer behind
-- the two SECURITY INVOKER RPCs below, not the only gate — see their own comment.
create policy public_results_org on public_results
  for all
  to authenticated
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

-- RLS alone doesn't grant access — a role needs the underlying table privilege
-- first (20260821240000_grants.sql's own documented rule). The explicit revoke
-- before granting mirrors 20260831100000_events_anon_safe_read.sql's own fix: whether
-- a newly-created table starts with `anon` already holding full table privileges is
-- CLI/config-transition-dependent (`auto_expose_new_tables`), not a safe constant —
-- `public_results_org` being `to authenticated` only means RLS already default-denies
-- any anon write today regardless, but this closes the "grant may be broader than
-- intended" gap defensively rather than relying on that alone, same as that
-- migration did for `events`.
revoke select, insert, update, delete on public_results from anon;
grant select on public_results to anon;
grant select, insert, update, delete on public_results to authenticated;

-- public_results.org_id and event_id are independent FKs — nothing above ties them
-- together, and `public_results_org`'s own `with check` only verifies `org_id` is
-- the CALLER's own org, not that `event_id` actually belongs to it. Without this,
-- any org member could bypass publish_event_results entirely with a raw insert
-- (their own org_id, a DIFFERENT org's event_id, any payload), and — since this
-- table is also anon-readable — plant attacker-controlled content on a row anyone
-- can read; the same raw-insert path would also bypass the RPC's is_test rejection
-- for the org's OWN test events. Same exact class of gap this codebase has already
-- closed twice (`app.check_live_session_org()`, 20260821230000_rls_policies.sql;
-- `app.check_ct_results_set_stage()`, 20260822100000_confirm_heat_rpc.sql), found
-- again here by schema-guardian/security-reviewer before ship rather than after —
-- this table is MORE exposed than either precedent (anon-public read), so both
-- checks are enforced at the trigger level, not left to the RPCs alone.
create or replace function app.check_public_results_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id <> app.org_id_for_event(new.event_id) then
    raise exception 'public_results.org_id must match the owning org of event_id';
  end if;
  if (select is_test from public.events where id = new.event_id) then
    raise exception 'public_results: refusing to publish a test event (%)', new.event_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger trg_public_results_org_check
  before insert or update on public_results
  for each row execute function app.check_public_results_org();

-- This repo's established write-RPC posture is SECURITY INVOKER (the default), not
-- DEFINER, with the calling user's own RLS policy as genuine defense-in-depth behind
-- the function's own guard clause — confirmed via confirm_heat/delete_test_event
-- (neither declares `security definer`; 20260830130000_rpc_search_path_pin.sql's own
-- comment states this explicitly). These two RPCs follow that same posture, and
-- delete_test_event's exact shape: one unified "not found" error covers both a
-- genuinely nonexistent event_id and a wrong-org one (never distinguishable to the
-- caller), and the is_test condition is checked BOTH in the guard clause and again on
-- the write statement itself, since the two are separate statements under READ
-- COMMITTED and nothing should depend on that staying true only because no other code
-- path currently updates events.is_test after creation. `trg_public_results_org_check`
-- above enforces the identical is_test rejection at the table level too (and the
-- org_id/event_id match this function's own guard clause also checks) — this
-- function's own checks stay for a clearer, function-specific error message raised
-- before ever reaching the trigger's more generic one, not because the trigger can't
-- be trusted alone.
--
-- p_payload is caller-assembled (Phase 3's resultsPublishing.js helper, built from
-- analytics.js's already-reviewed computeEventSummary()) — this function's only job
-- is authorizing WHETHER this org may publish THIS event, never re-deriving or
-- validating the payload's own internal shape.
create or replace function publish_event_results(
  p_org_id uuid,
  p_event_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'publish_event_results: event % not found', p_event_id;
  end if;

  if (select is_test from public.events where id = p_event_id) then
    raise exception 'publish_event_results: refusing to publish a test event (%)', p_event_id
      using errcode = 'P0001';
  end if;

  -- The is_test condition is repeated here, on the actual write, as its own `where`
  -- on the insert SOURCE (not just an `on conflict ... where` guard, which would only
  -- ever protect the update branch, not a first-time insert) — same
  -- READ-COMMITTED-is-two-statements discipline delete_test_event's own comment
  -- documents: the guard above and this statement can observe different rows if
  -- something updates events.is_test in between, even though nothing in this
  -- codebase does that today.
  insert into public.public_results (org_id, event_id, payload, published_by)
  select p_org_id, p_event_id, p_payload, auth.uid()
  from public.events e
  where e.id = p_event_id and not e.is_test
  on conflict (event_id) do update
    set payload = excluded.payload,
        published_at = now(),
        published_by = excluded.published_by;
end;
$$;

create or replace function unpublish_event_results(
  p_org_id uuid,
  p_event_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_org_id is distinct from app.org_id_for_event(p_event_id) then
    raise exception 'unpublish_event_results: event % not found', p_event_id;
  end if;

  delete from public.public_results where event_id = p_event_id and org_id = p_org_id;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default unless explicitly
-- revoked (unlike table DML privileges) — matching delete_test_event's own final
-- block, closed here immediately rather than needing a later follow-up migration the
-- way the original six write RPCs did (20260830140000_revoke_public_execute_on_write_rpcs.sql).
revoke execute on function publish_event_results(uuid, uuid, jsonb) from public;
grant execute on function publish_event_results(uuid, uuid, jsonb) to authenticated;
grant execute on function publish_event_results(uuid, uuid, jsonb) to service_role;

revoke execute on function unpublish_event_results(uuid, uuid) from public;
grant execute on function unpublish_event_results(uuid, uuid) to authenticated;
grant execute on function unpublish_event_results(uuid, uuid) to service_role;
