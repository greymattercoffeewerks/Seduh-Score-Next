-- Seduh Score Next · standings/advancement follow-up: resolve_stage RPC
-- Handoff: SEDUH-NEXT-HANDOFF.md §9 (offline model), §5.2/§7.2/§7.3 (advancement
-- provenance, tiebreak/coin-toss).
--
-- rollback:
--   revoke execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) from authenticated;
--   revoke execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) from service_role;
--   drop function if exists resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text);

-- Found by offline-sync-auditor reviewing an unrelated "champion declared"
-- live-view addition: formats/cup-taster/standings.js's commitStageResolution
-- performed, sequentially, as independent network round trips — an insert
-- into ct_stage_entries for advancing entries (no idempotency key, no
-- ON CONFLICT handling), a loop of per-row updates for eliminated entries,
-- another loop for below-cutoff entries, then a final update flipping
-- ct_stages.status = 'complete'. None of it ran in one transaction, and none
-- of it went through the outbox the way every other write in this app does
-- (confirm_heat/start_heat/record_heat_time/auto_max_heat/publish_session
-- all are). A connection drop mid-sequence could leave a stage
-- half-resolved, and retrying wasn't safe since the insert had no idempotency
-- guard at all. This RPC mirrors confirm_heat's own shape exactly: one
-- transaction, gated by an operation_id + processed_operations idempotency
-- check, org-scoped.
--
-- p_stage_id / p_next_stage_id: matches standings.js's own "isTerminal is
-- `stage.cutoff == null`, never `nextStage === null`" distinction
-- (standingsScreen.js's buildCommitPlan comment) — p_next_stage_id is null
-- at the terminal stage, non-null at a cutoff stage, and this function
-- branches on p_next_stage_id being null exactly like commitStageResolution's
-- own JS did, not on p_champion_stage_entry_id being non-null (an organiser
-- could in principle reach a cutoff stage with a single clean winner and no
-- tie, which is NOT the terminal-stage "declare champion" case — that shape
-- only ever arises from client-side buildCommitPlan today, but the RPC's own
-- branch stays keyed on the same fact standings.js already treats as
-- authoritative, not re-derived from a shape that happens to look similar).
--
-- p_advancing_entries: [{entry_id, source}], source one of
-- 'advanced'|'tiebreak_won'|'coin_toss' — same three values standings.js's
-- own commitStageResolution already wrote directly. Inserted into
-- p_next_stage_id (non-terminal) or read back only for the coin-toss-note
-- check (terminal, exactly one entry, see below) — never inserted at the
-- terminal stage, matching the original "no next stage to enter" comment.
-- Each entry_id is checked against p_stage_id's OWN ct_stage_entries before
-- being trusted: an entry that isn't already a member of the resolving stage
-- has no business advancing out of it — this is both the correctness check
-- (every advancing entryId standings.js ever sends is sourced from THIS
-- stage's own ranked entries) and the security one (closes the same class of
-- gap already fixed for event_entries.person_id/event_id,
-- person_merges.kept_id, and live_sessions.org_id/event_id — a caller cannot
-- forge an entry_id belonging to another org's roster into their own
-- next-stage, since it will never appear as a member of their own current
-- stage). ON CONFLICT (stage_id, entry_id) DO NOTHING on top of that is the
-- idempotency belt-and-suspenders for the insert specifically — the
-- processed_operations ledger is the primary guard, this is what keeps a
-- retried insert safe even independent of the ledger.
--
-- p_champion_stage_entry_id: terminal stage only, per commitStageResolution's
-- own doc comment — the single winner's CURRENT ct_stage_entries row gets
-- final_position = 1. position_note is recalculated from whether ANY entry
-- in p_advancing_entries carries source = 'coin_toss', mirroring
-- buildCommitPlan's own `advancingEntries.some(entry => entry.source ===
-- 'coin_toss')` — not re-derived from a boolean flag the client would
-- otherwise have to compute and could get out of sync with the array it
-- actually sent.
--
-- p_eliminated: [{stage_entry_id, via_coin_toss}], all sharing
-- p_final_position (effectiveCutoff + 1 — computed client-side exactly as it
-- was before, since it needs the stage's own cutoff and the resolved
-- tie-group's shape, neither of which this RPC re-derives).
--
-- p_below_cutoff: [{stage_entry_id, position}] — entries never touched by
-- any tie, each keeping their own already-computed rank() position.
--
-- Every stage_entry_id this function touches (champion/eliminated/
-- below-cutoff) is matched WITH stage_id = p_stage_id in its own UPDATE, not
-- by id alone — the same "two independently-FK'd columns" shape
-- check_ct_results_set_stage (confirm_heat's own migration) already closes
-- for ct_results; a stage_entry_id genuinely outside p_stage_id (a stale
-- client read, or a forged id) is caught as a hard "not found" error rather
-- than silently mutating a row this stage's own resolution has no business
-- touching.
--
-- `set search_path = ''` + every table reference schema-qualified `public.`:
-- found missing by BOTH schema-guardian and security-reviewer independently
-- (2026-09-06) — a direct regression of `20260830130000_rpc_search_path_pin.sql`'s
-- own fix, which every write RPC added since (`record_heat_time`'s
-- 20260904120000 follow-up, `delete_test_event_rpc`'s 20260905130000) has
-- correctly carried forward and this one, the first RPC added since, did
-- not. Not currently live-exploitable (neither `anon` nor `authenticated`
-- has CREATE on `public` — confirmed against 20260821240000_grants.sql), but
-- that migration's own comment frames this as "safety depends on an
-- invariant staying true forever, not on being verified once," which is
-- exactly why it's fixed here rather than left as a documented risk.
--
-- `revoke ... from public` + `grant ... to service_role`: found missing by
-- security-reviewer (2026-09-06) — Postgres grants EXECUTE to PUBLIC by
-- default on function creation, the same gap `20260830140000_revoke_public_
-- execute_on_write_rpcs.sql` closed for this project's other six write
-- RPCs. Confirmed not currently live-exploitable the same way that
-- migration confirmed for the other six (`anon`/`authenticated` have no
-- table-level grant on any table this function touches, so a call fails on
-- a table-permission error before ever reaching this function's own logic)
-- — closed here anyway, in the SAME migration rather than a follow-up,
-- since this function has never yet been pushed anywhere and there's no
-- reason to ship the gap even briefly.
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

  -- Two DISTINCT checks per stage id, matching start_heat/record_heat_time's
  -- own established shape (migration 20260828150000) — each catches a case
  -- the other can't. app.org_id_for_stage is `security definer` and returns
  -- the stage's TRUE org regardless of who's asking, so on its own it only
  -- catches a nonexistent stage or a caller passing the WRONG org id for a
  -- stage they can otherwise see (a member of more than one org) — it CANNOT
  -- tell "correct org id, and a real member" from "correct org id, but not
  -- actually a member of it" (found in review while drafting this migration,
  -- the exact gap start_heat's own migration comment already documents: an
  -- earlier version of this function used only this check as the sole gate,
  -- and a non-member caller who simply passed the stage's real org id would
  -- have sailed straight through it, only failing later — and confusingly —
  -- at whichever row-level write RLS happened to block first). The second,
  -- plain RLS-filtered `perform` below is what actually closes that gap: it
  -- runs under invoker rights, so ct_stages_read's own
  -- `is_org_member(org_id_for_event(event_id))` policy filters it to zero
  -- rows for a genuine non-member, regardless of what org id they claimed.
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

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'resolve_stage');
end;
$$;

revoke execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) from public;
grant execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) to authenticated;
grant execute on function resolve_stage(uuid, uuid, uuid, uuid, jsonb, uuid, jsonb, smallint, jsonb, text) to service_role;
