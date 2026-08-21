-- Seduh Score Next · T1.3 RLS
-- Policies on every table. live_sessions open for read, org-write.
-- Handoff: SEDUH-NEXT-HANDOFF.md §4.
--
-- rollback:
--   drop trigger if exists trg_live_sessions_org_check on live_sessions;
--   drop function if exists app.check_live_session_org();
--   drop policy if exists live_sessions_write on live_sessions;
--   drop policy if exists live_sessions_read on live_sessions;
--   drop policy if exists ct_results_write on ct_results;
--   drop policy if exists ct_results_read on ct_results;
--   drop policy if exists ct_heat_entries_write on ct_heat_entries;
--   drop policy if exists ct_heat_entries_read on ct_heat_entries;
--   drop policy if exists ct_heats_write on ct_heats;
--   drop policy if exists ct_heats_read on ct_heats;
--   drop policy if exists ct_stage_entries_write on ct_stage_entries;
--   drop policy if exists ct_stage_entries_read on ct_stage_entries;
--   drop policy if exists ct_sets_write on ct_sets;
--   drop policy if exists ct_sets_read on ct_sets;
--   drop policy if exists ct_stages_write on ct_stages;
--   drop policy if exists ct_stages_read on ct_stages;
--   drop policy if exists event_entries_write on event_entries;
--   drop policy if exists event_entries_read on event_entries;
--   drop policy if exists events_write on events;
--   drop policy if exists events_read on events;
--   drop policy if exists person_merges_write on person_merges;
--   drop policy if exists person_merges_read on person_merges;
--   drop policy if exists people_write on people;
--   drop policy if exists people_read on people;
--   drop policy if exists org_members_read on org_members;
--   drop policy if exists orgs_read on orgs;
--   drop function if exists app.org_id_for_heat_entry(uuid);
--   drop function if exists app.org_id_for_heat(uuid);
--   drop function if exists app.org_id_for_stage(uuid);
--   drop function if exists app.org_id_for_event(uuid);
--   drop function if exists app.is_org_member(uuid);

-- ============ the membership chokepoint ============
-- SECURITY DEFINER + owned by the migration role (superuser locally / project
-- owner on Supabase, both RLS-exempt) so this can read org_members without
-- recursing through org_members' own policy. `set search_path = ''` plus
-- fully-qualified `public.` references close the search-path-hijack hole a bare
-- SECURITY DEFINER function would otherwise have. STABLE, not VOLATILE — safe to
-- call repeatedly within one statement/policy evaluation.
create or replace function app.is_org_member(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id
      and user_id = auth.uid()
  );
$$;

-- ============ org_id resolvers ============
-- One function per FK-chain hop, each built on the previous — the single place
-- each level's join lives, so no policy re-implements the chain inline (mirrors
-- Kira-Kira's app.can_read_tx chokepoint pattern).
create or replace function app.org_id_for_event(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.events where id = p_event_id;
$$;

create or replace function app.org_id_for_stage(p_stage_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_event(event_id) from public.ct_stages where id = p_stage_id;
$$;

create or replace function app.org_id_for_heat(p_heat_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_stage(stage_id) from public.ct_heats where id = p_heat_id;
$$;

create or replace function app.org_id_for_heat_entry(p_heat_entry_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.org_id_for_heat(heat_id) from public.ct_heat_entries where id = p_heat_entry_id;
$$;

-- ============ orgs, org_members — read-only to the app layer ============
-- No handoff-specified UI creates/edits orgs or memberships yet (§4's "one
-- organiser, one org, for October" is provisioned once, outside RLS, via
-- service_role). No write policy exists on either table — that's a deliberate
-- absence, not a gap: T1.4's WITH CHECK gate has nothing to check here because
-- there is nothing to write.
create policy orgs_read on orgs
  for select
  using (app.is_org_member(id));

create policy org_members_read on org_members
  for select
  using (app.is_org_member(org_id));

-- ============ org-scoped read + write ============

create policy people_read on people
  for select
  using (app.is_org_member(org_id));
create policy people_write on people
  for all
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy person_merges_read on person_merges
  for select
  using (app.is_org_member(org_id));
create policy person_merges_write on person_merges
  for all
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy events_read on events
  for select
  using (app.is_org_member(org_id));
create policy events_write on events
  for all
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

create policy event_entries_read on event_entries
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy event_entries_write on event_entries
  for all
  using (app.is_org_member(app.org_id_for_event(event_id)))
  with check (app.is_org_member(app.org_id_for_event(event_id)));

create policy ct_stages_read on ct_stages
  for select
  using (app.is_org_member(app.org_id_for_event(event_id)));
create policy ct_stages_write on ct_stages
  for all
  using (app.is_org_member(app.org_id_for_event(event_id)))
  with check (app.is_org_member(app.org_id_for_event(event_id)));

create policy ct_sets_read on ct_sets
  for select
  using (app.is_org_member(app.org_id_for_stage(stage_id)));
create policy ct_sets_write on ct_sets
  for all
  using (app.is_org_member(app.org_id_for_stage(stage_id)))
  with check (app.is_org_member(app.org_id_for_stage(stage_id)));

create policy ct_stage_entries_read on ct_stage_entries
  for select
  using (app.is_org_member(app.org_id_for_stage(stage_id)));
create policy ct_stage_entries_write on ct_stage_entries
  for all
  using (app.is_org_member(app.org_id_for_stage(stage_id)))
  with check (app.is_org_member(app.org_id_for_stage(stage_id)));

create policy ct_heats_read on ct_heats
  for select
  using (app.is_org_member(app.org_id_for_stage(stage_id)));
create policy ct_heats_write on ct_heats
  for all
  using (app.is_org_member(app.org_id_for_stage(stage_id)))
  with check (app.is_org_member(app.org_id_for_stage(stage_id)));

create policy ct_heat_entries_read on ct_heat_entries
  for select
  using (app.is_org_member(app.org_id_for_heat(heat_id)));
create policy ct_heat_entries_write on ct_heat_entries
  for all
  using (app.is_org_member(app.org_id_for_heat(heat_id)))
  with check (app.is_org_member(app.org_id_for_heat(heat_id)));

create policy ct_results_read on ct_results
  for select
  using (app.is_org_member(app.org_id_for_heat_entry(heat_entry_id)));
create policy ct_results_write on ct_results
  for all
  using (app.is_org_member(app.org_id_for_heat_entry(heat_entry_id)))
  with check (app.is_org_member(app.org_id_for_heat_entry(heat_entry_id)));

-- ============ live_sessions — the one deliberate exception ============
-- Read: open, unauthenticated — audience surfaces have no login (§4, §8).
-- Write: org_members of the owning org only.
create policy live_sessions_read on live_sessions
  for select
  using (true);
create policy live_sessions_write on live_sessions
  for all
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

-- live_sessions.org_id and event_id are independent FKs — nothing above ties them
-- together, so an org member could otherwise insert a row claiming another org's
-- event (org_id = their own org, event_id = someone else's event), silently
-- breaking the "one active session per org's own event" invariant
-- live_sessions_one_active_per_org implies. security-reviewer confirmed this was
-- exploitable via a live INSERT before this trigger existed.
create or replace function app.check_live_session_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.org_id <> app.org_id_for_event(new.event_id) then
    raise exception 'live_sessions.org_id must match the owning org of event_id';
  end if;
  return new;
end;
$$;

create trigger trg_live_sessions_org_check
  before insert or update on live_sessions
  for each row execute function app.check_live_session_org();
