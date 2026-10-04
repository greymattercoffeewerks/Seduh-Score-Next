-- Seduh Score Next · resolve_stage: declaring the terminal stage's champion concludes the event
-- Handoff: SEDUH-NEXT-HANDOFF.md §9 (offline model).
--
-- rollback: re-apply 20260906060000_resolve_stage_rpc.sql's own `create or replace function
-- resolve_stage(...)` body (identical signature, so grants are retained). Events already set to
-- 'concluded' by this migration's backfill or by the new RPC branch are data, not schema, and are
-- left as they are — 'concluded' is a value the original schema comment (20260821200000_core_tables.sql:
-- `draft | running | concluded`) always allowed.
--
-- Found 2026-10-04, the day of the first live event: every stage and heat finished correctly
-- (all three ct_stages 'complete', every ct_heats 'confirmed', champion published), yet
-- events.status was still 'draft'. Nothing anywhere wrote events.status — src/core/events.js's own
-- comment says so — so the column's draft/running/concluded lifecycle was never wired to anything.
--
-- This migration wires only the 'concluded' end of it, in the one place that already knows the event
-- is over: resolve_stage's terminal branch. It is the same transaction, the same operation_id +
-- processed_operations idempotency guard, and the same invoker-rights RLS as every other write in
-- this function, so a retried flush cannot conclude an event twice or half-conclude one, and a
-- non-member's UPDATE on events is filtered to zero rows by events_write like any other.
--
-- "Terminal" is the stage's own `cutoff is null`, read from ct_stages, not merely
-- `p_next_stage_id is null` — the same fact standingsScreen.js's `isTerminal` already treats as
-- authoritative. The function's existing branch keys on p_next_stage_id (unchanged); the event is
-- additionally required to be at a stage with no cutoff, so a malformed call with a null next-stage
-- at a cutoff stage can never conclude an event whose finals haven't been played.
--
-- Deliberately NOT done here: 'running'. Nothing in the app reads events.status (and findLatestEventForOrg
-- is existence-only by design), so setting it on the first start_heat is a separate, optional change.
--
-- The backfill concludes any existing event not yet 'concluded' whose terminal stage is already
-- 'complete' — i.e. exactly the state this bug left behind. Idempotent; a no-op on a fresh database.

create or replace function resolve_stage(
  p_operation_id uuid,
  p_org_id uuid,
  p_stage_id uuid,
  p_next_stage_id uuid,
  p_advancing_entries jsonb,
  p_champion_stage_entry_id uuid,
  p_eliminated jsonb,
  p_final_position smallint,
  p_below_cutoff jsonb,
  p_coin_toss_note text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row jsonb;
  v_entry_id uuid;
  v_stage_entry_id uuid;
  v_source text;
  v_champion_note text;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Two DISTINCT checks per stage id — see 20260906060000_resolve_stage_rpc.sql for why each is needed.
  if p_org_id is distinct from app.org_id_for_stage(p_stage_id) then
    raise exception 'resolve_stage: stage % not found', p_stage_id;
  end if;

  perform 1 from public.ct_stages where id = p_stage_id;
  if not found then
    raise exception 'resolve_stage: stage % not found', p_stage_id;
  end if;

  if p_next_stage_id is not null then
    if p_org_id is distinct from app.org_id_for_stage(p_next_stage_id) then
      raise exception 'resolve_stage: next stage % not found', p_next_stage_id;
    end if;

    perform 1 from public.ct_stages where id = p_next_stage_id;
    if not found then
      raise exception 'resolve_stage: next stage % not found', p_next_stage_id;
    end if;
  end if;

  if p_next_stage_id is not null then
    for v_row in select * from jsonb_array_elements(coalesce(p_advancing_entries, '[]'::jsonb))
    loop
      v_entry_id := (v_row->>'entry_id')::uuid;
      v_source := v_row->>'source';

      if not exists (
        select 1 from public.ct_stage_entries where stage_id = p_stage_id and entry_id = v_entry_id
      ) then
        raise exception 'resolve_stage: entry % is not a member of stage %', v_entry_id, p_stage_id;
      end if;

      insert into public.ct_stage_entries (stage_id, entry_id, source, position_note)
      values (
        p_next_stage_id,
        v_entry_id,
        v_source,
        case when v_source = 'coin_toss' then p_coin_toss_note else null end
      )
      on conflict (stage_id, entry_id) do nothing;
    end loop;
  elsif p_champion_stage_entry_id is not null then
    select p_coin_toss_note into v_champion_note
    from jsonb_array_elements(coalesce(p_advancing_entries, '[]'::jsonb)) e
    where e->>'source' = 'coin_toss'
    limit 1;

    update public.ct_stage_entries
    set final_position = 1,
        position_note = v_champion_note
    where id = p_champion_stage_entry_id and stage_id = p_stage_id;

    if not found then
      raise exception 'resolve_stage: champion stage entry % not found in stage %',
        p_champion_stage_entry_id, p_stage_id;
    end if;
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_eliminated, '[]'::jsonb))
  loop
    v_stage_entry_id := (v_row->>'stage_entry_id')::uuid;

    update public.ct_stage_entries
    set final_position = p_final_position,
        position_note = case when (v_row->>'via_coin_toss')::boolean then p_coin_toss_note else null end
    where id = v_stage_entry_id and stage_id = p_stage_id;

    if not found then
      raise exception 'resolve_stage: eliminated stage entry % not found in stage %',
        v_stage_entry_id, p_stage_id;
    end if;
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_below_cutoff, '[]'::jsonb))
  loop
    v_stage_entry_id := (v_row->>'stage_entry_id')::uuid;

    update public.ct_stage_entries
    set final_position = (v_row->>'position')::smallint
    where id = v_stage_entry_id and stage_id = p_stage_id;

    if not found then
      raise exception 'resolve_stage: below-cutoff stage entry % not found in stage %',
        v_stage_entry_id, p_stage_id;
    end if;
  end loop;

  update public.ct_stages set status = 'complete' where id = p_stage_id;

  -- The event is over once its terminal stage (cutoff is null) is resolved with no next stage.
  if p_next_stage_id is null then
    update public.events e
    set status = 'concluded'
    from public.ct_stages s
    where s.id = p_stage_id
      and s.cutoff is null
      and e.id = s.event_id
      and e.status <> 'concluded';
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'resolve_stage');
end;
$$;

-- Backfill: events this bug already left at 'draft' (or 'running') with a completed terminal stage.
update public.events e
set status = 'concluded'
where e.status <> 'concluded'
  and exists (
    select 1 from public.ct_stages s
    where s.event_id = e.id and s.cutoff is null and s.status = 'complete'
  );
