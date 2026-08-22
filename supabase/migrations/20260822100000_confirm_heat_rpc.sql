-- Seduh Score Next · T3.2 confirm_heat RPC + processed_operations ledger
-- Handoff: SEDUH-NEXT-HANDOFF.md §9 (offline model), §7.1/§7.4 (strict confirm).
--
-- rollback:
--   revoke execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) from authenticated;
--   drop function if exists confirm_heat(uuid, uuid, uuid, timestamptz, jsonb);
--   drop trigger if exists trg_ct_results_set_stage_check on ct_results;
--   drop function if exists app.check_ct_results_set_stage();
--   revoke select, insert on processed_operations from authenticated;
--   drop policy if exists processed_operations_write on processed_operations;
--   drop policy if exists processed_operations_read on processed_operations;
--   drop table if exists processed_operations;

-- The server-side half of outbox idempotency (§9: "client-generated UUIDs as
-- idempotency keys"). The client's IndexedDB outbox is the queue; this table
-- is the dedup ledger a retried operation checks against — a retry after
-- timeout replays the SAME operation id, and confirm_heat below treats that as
-- an already-applied no-op rather than re-validating or re-writing anything
-- (which matters specifically because re-validating would incorrectly compare
-- against the row's now-changed updated_at and misreport a real success as a
-- conflict).
create table processed_operations (
  id          uuid primary key,
  org_id      uuid not null references orgs(id) on delete cascade,
  kind        text not null,
  processed_at timestamptz not null default now()
);
alter table processed_operations enable row level security;
create index on processed_operations (org_id);

create policy processed_operations_read on processed_operations
  for select
  using (app.is_org_member(org_id));
create policy processed_operations_write on processed_operations
  for all
  using (app.is_org_member(org_id))
  with check (app.is_org_member(org_id));

-- RLS alone doesn't grant access — a role needs the underlying table
-- privilege first (20260821240000_grants.sql's own documented rule). Append
-- (insert) only; no update/delete, the ledger is add-only by design.
grant select, insert on processed_operations to authenticated;

-- ct_results.set_id and .heat_entry_id are independent FKs with nothing tying
-- set_id to the SAME stage heat_entry_id's heat belongs to — the same class
-- of gap already found and closed twice (live_sessions.org_id/event_id in
-- T1.3, event_entries.person_id and person_merges.kept_id in T3.1). Low
-- exploitability today (no channel currently lets a caller learn another
-- org's set_id), but the established standard here is to close it regardless
-- of current guessability rather than rely on UUID obscurity.
create or replace function app.check_ct_results_set_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select stage_id from public.ct_sets where id = new.set_id)
     <> (
       select h.stage_id
       from public.ct_heat_entries he
       join public.ct_heats h on h.id = he.heat_id
       where he.id = new.heat_entry_id
     )
  then
    raise exception 'ct_results.set_id must belong to the same stage as heat_entry_id''s heat';
  end if;
  return new;
end;
$$;

create trigger trg_ct_results_set_stage_check
  before insert or update on ct_results
  for each row execute function app.check_ct_results_set_stage();

-- Confirming a heat writes every cupper's final time AND every set's score in
-- one transaction — a client-side sequence (write entries, then write
-- results) risks the exact half-scored-heat failure mode §9 names explicitly.
--
-- p_expected_updated_at is optimistic concurrency: the client sends the
-- updated_at it last read; a mismatch means someone else touched this heat
-- since, and the write is rejected rather than silently overwriting (§9 —
-- "conflicts are never silently resolved"). The current server-side row is
-- returned via the exception's DETAIL so the caller can show both versions
-- instead of just "something went wrong."
--
-- p_entries shape: [{entry_id, elapsed_secs, elapsed_secs_raw, maxed,
-- time_source, results: [{set_id, correct}, ...]}, ...] — elapsed_secs/_raw
-- are expected to already be clampElapsed()'s output; this function trusts
-- its caller the same way the no-raw-elapsed-write lint rule does for
-- ordinary writes, it does not re-derive the clamp server-side.
create or replace function confirm_heat(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_id uuid,
  p_expected_updated_at timestamptz,
  p_entries jsonb
)
returns void
language plpgsql
as $$
declare
  v_current_updated_at timestamptz;
  v_entry jsonb;
  v_result jsonb;
  v_entry_id uuid;
  v_expected_set_count int;
  v_incomplete_count int;
begin
  if exists (select 1 from processed_operations where id = p_operation_id) then
    return;
  end if;

  if p_org_id <> app.org_id_for_heat(p_heat_id) then
    raise exception 'confirm_heat: heat % does not belong to org %', p_heat_id, p_org_id;
  end if;

  select updated_at into v_current_updated_at from ct_heats where id = p_heat_id;
  if v_current_updated_at is null then
    raise exception 'confirm_heat: heat % not found', p_heat_id;
  end if;

  if v_current_updated_at <> p_expected_updated_at then
    raise exception 'CONFLICT: heat % has been modified since it was read', p_heat_id
      using detail = json_build_object(
              'heat_id', p_heat_id,
              'current_updated_at', v_current_updated_at,
              'expected_updated_at', p_expected_updated_at
            )::text,
            errcode = 'P0002';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_entry_id := (v_entry->>'entry_id')::uuid;

    update ct_heat_entries
    set elapsed_secs = (v_entry->>'elapsed_secs')::int,
        elapsed_secs_raw = (v_entry->>'elapsed_secs_raw')::int,
        maxed = coalesce((v_entry->>'maxed')::boolean, false),
        time_source = coalesce(v_entry->>'time_source', 'tapped')
    where id = v_entry_id and heat_id = p_heat_id;

    if not found then
      raise exception 'confirm_heat: heat_entry % not found in heat %', v_entry_id, p_heat_id;
    end if;

    for v_result in select * from jsonb_array_elements(coalesce(v_entry->'results', '[]'::jsonb))
    loop
      insert into ct_results (heat_entry_id, set_id, correct)
      values (v_entry_id, (v_result->>'set_id')::uuid, (v_result->>'correct')::boolean)
      on conflict (heat_entry_id, set_id) do update set correct = excluded.correct;
    end loop;
  end loop;

  -- Strict confirm (§7.4): every set on every cupper carries a score before a
  -- heat can close — the v4.x defect this closes was a guard checking `some`
  -- scored set per cupper instead of every set.
  select set_count into v_expected_set_count
  from ct_stages
  join ct_heats on ct_heats.stage_id = ct_stages.id
  where ct_heats.id = p_heat_id;

  select count(*) into v_incomplete_count
  from ct_heat_entries he
  where he.heat_id = p_heat_id
    and (select count(*) from ct_results r where r.heat_entry_id = he.id) <> v_expected_set_count;

  if v_incomplete_count > 0 then
    raise exception 'confirm_heat: % cupper(s) do not have every set scored', v_incomplete_count;
  end if;

  update ct_heats set status = 'confirmed' where id = p_heat_id;

  insert into processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'confirm_heat');
end;
$$;

grant execute on function confirm_heat(uuid, uuid, uuid, timestamptz, jsonb) to authenticated;
