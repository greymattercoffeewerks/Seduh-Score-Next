-- Seduh Score Next · correct_heat_time: correct an already-stopped heat time
-- until the heat is confirmed.
-- Handoff: SEDUH-NEXT-HANDOFF.md §7.1 (manual timekeepers run alongside the
-- app for verification), §6 (clampElapsed is the sole elapsed_secs writer —
-- the caller still supplies the clamped values, same as record_heat_time).
--
-- Why: first live event (2026-10-04). A tablet timekeeper missed the beat on
-- Stop; the manual timekeeper's time differed, and nothing could change the
-- recorded one. record_heat_time cannot: its 'reject' policy refuses a second
-- write, and its 'overwrite' policy is deliberately scoped to a prior MANUAL
-- entry (20260904120000 — an offline tap and a manual guess must never
-- silently clobber each other). A correction is a different thing from either
-- and gets its own RPC, so neither of those two contracts is loosened.
--
-- What a correction must satisfy:
--   * the heat is still open — 'timing' or 'scoring'. Once it is confirmed the
--     time is locked, and a 'pending' heat has no recorded time to correct.
--   * compare-and-set on the value the caller was shown (p_expected_elapsed_secs):
--     a correction made against a stale screen, or one queued offline behind a
--     newer change, is refused rather than overwriting what is there now.
--   * a reason (1–120 characters). Stored on the row as time_note and passed
--     to the change-log trigger through app.change_reason, so a dispute pack
--     can show why a time was changed, not only that it was.
--   * the heat's updated_at is bumped. confirm_heat guards on that column and
--     rewrites each time from the payload its screen loaded — an entry edit
--     does not touch ct_heats, so without this a scorer who had the heat open
--     would silently put the OLD time back when confirming. With it, that
--     confirm raises its existing P0002 conflict and the scorer reloads. That
--     only holds if the confirm checks AFTER the correction commits: the
--     companion migration 20261006110000 makes confirm_heat lock the heat row
--     first, so the two always run one after the other.
--   * the corrected values are the caller's clamped ones (clampElapsed stays
--     the only cap), but they are checked, reject-only, against the heat: a
--     time cannot exceed ct_heats.duration_secs, maxed must agree with it, raw
--     cannot be below it, and unless the time is a max raw must equal it. That
--     is exactly what clampElapsed returns for a non-negative input (a negative
--     input — a tap's clock skew — never reaches a correction: the client
--     refuses it). Validation, not a second cap — nothing is re-clamped here.
--
-- The original (tapped) value is not copied anywhere new: ct_heat_entries is
-- covered by the append-only score-change log (20260924100000), which records
-- elapsed_secs, elapsed_secs_raw, maxed, time_source and time_note, so the
-- before/after pair is in the log with the reason beside it. That log skips
-- is_test (rehearsal) events by design (D9), so on one of those the original
-- value is simply overwritten. The log's `reason` column is read from
-- app.change_reason, which this function now sets server-side (the
-- 20260924100000 header says no RPC does yet); it is cleared again right after
-- the write so it cannot be stamped onto unrelated rows later in the same
-- transaction.
--
-- A corrected row (time_source 'manual', time_note set) can only be changed by
-- another correction: 20261006110000 makes record_heat_time's 'overwrite'
-- refuse it.
--
-- rollback:
--   drop function if exists correct_heat_time(uuid, uuid, uuid, int, int, int, boolean, text, timestamptz);

create or replace function correct_heat_time(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_entry_id uuid,
  p_expected_elapsed_secs int,
  p_elapsed_secs int,
  p_elapsed_secs_raw int,
  p_maxed boolean,
  p_reason text,
  p_time_edited_at timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_heat_id uuid;
  v_heat_status text;
  v_current_elapsed int;
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_duration_secs int;
begin
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Same not-found answer for "no such entry" and "not your org's entry", so
  -- the RPC cannot be used to probe another org's ids.
  if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
    raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  select he.heat_id into v_heat_id from public.ct_heat_entries he where he.id = p_heat_entry_id;

  if v_heat_id is null then
    raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  if v_reason is null then
    raise exception 'correct_heat_time: a reason is required';
  end if;
  if char_length(v_reason) > 120 then
    raise exception 'correct_heat_time: the reason is too long (120 characters at most)';
  end if;
  if p_elapsed_secs is null or p_elapsed_secs < 0
     or p_elapsed_secs_raw is null or p_maxed is null then
    raise exception 'correct_heat_time: a corrected time needs elapsed_secs (0 or more), elapsed_secs_raw and maxed';
  end if;

  perform 1 from public.ct_heats where id = v_heat_id for update;

  -- A retry of an operation that was still in flight when this call started
  -- waited on the lock above; once it holds the lock it must find the ledger
  -- row and stop, not trip the compare-and-set its own earlier success caused.
  if exists (select 1 from public.processed_operations where id = p_operation_id) then
    return;
  end if;

  select h.status, h.duration_secs, he.elapsed_secs
    into v_heat_status, v_duration_secs, v_current_elapsed
  from public.ct_heat_entries he
  join public.ct_heats h on h.id = he.heat_id
  where he.id = p_heat_entry_id;

  if v_heat_status not in ('timing', 'scoring') then
    raise exception 'CONFLICT: heat % is %, its times can no longer be corrected', v_heat_id, v_heat_status
      using detail = json_build_object(
              'heat_id', v_heat_id,
              'current_status', v_heat_status
            )::text,
            errcode = 'P0002';
  end if;

  if v_current_elapsed is null then
    raise exception 'correct_heat_time: heat entry % has no recorded time to correct', p_heat_entry_id;
  end if;

  if v_current_elapsed is distinct from p_expected_elapsed_secs then
    raise exception 'CONFLICT: heat entry % time is now % seconds, expected % seconds',
      p_heat_entry_id, v_current_elapsed, p_expected_elapsed_secs
      using detail = json_build_object(
              'heat_entry_id', p_heat_entry_id,
              'current_elapsed_secs', v_current_elapsed,
              'expected_elapsed_secs', p_expected_elapsed_secs
            )::text,
            errcode = 'P0002';
  end if;

  if p_elapsed_secs = v_current_elapsed then
    raise exception 'correct_heat_time: the corrected time is the same as the recorded time';
  end if;

  -- Reject-only consistency with clampElapsed's output for this heat (see header).
  if p_elapsed_secs_raw < p_elapsed_secs then
    raise exception 'correct_heat_time: elapsed_secs_raw cannot be below elapsed_secs';
  end if;
  -- (ct_heats.duration_secs is NOT NULL, so there is always a duration to check.)
  if p_elapsed_secs > v_duration_secs then
    raise exception 'correct_heat_time: the corrected time cannot exceed the heat duration (% seconds)', v_duration_secs;
  end if;
  if p_maxed is distinct from (p_elapsed_secs = v_duration_secs) then
    raise exception 'correct_heat_time: maxed must be true exactly when the time equals the heat duration';
  end if;
  if not p_maxed and p_elapsed_secs_raw <> p_elapsed_secs then
    raise exception 'correct_heat_time: elapsed_secs_raw must equal elapsed_secs unless the time is a max';
  end if;

  -- Transaction-local, read by the score-change log trigger (reason column).
  perform set_config('app.change_reason', v_reason, true);

  update public.ct_heat_entries
  set elapsed_secs = p_elapsed_secs,
      elapsed_secs_raw = p_elapsed_secs_raw,
      maxed = p_maxed,
      time_source = 'manual',
      time_note = v_reason,
      time_edited_at = coalesce(p_time_edited_at, now())
  where id = p_heat_entry_id;
  if not found then
    raise exception 'correct_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  -- Cleared straight away: transaction-local, but a later statement in the same
  -- transaction must not inherit this reason.
  perform set_config('app.change_reason', '', true);

  -- Makes a stale confirm_heat conflict instead of undoing this correction
  -- (see the header). app.set_updated_at() owns the value.
  update public.ct_heats set updated_at = now() where id = v_heat_id;
  if not found then
    raise exception 'correct_heat_time: heat % not found', v_heat_id;
  end if;

  insert into public.processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'correct_heat_time');
end;
$$;

revoke execute on function correct_heat_time(uuid, uuid, uuid, int, int, int, boolean, text, timestamptz) from public, anon;
grant execute on function correct_heat_time(uuid, uuid, uuid, int, int, int, boolean, text, timestamptz) to authenticated, service_role;
