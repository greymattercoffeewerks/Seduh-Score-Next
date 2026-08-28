-- Seduh Score Next · T4.3/T4.4 follow-up: timing writes through the outbox
-- Handoff: SEDUH-NEXT-HANDOFF.md §9 (offline model), §7.1 (timing lifecycle),
-- §6 (clampElapsed is the sole elapsed_secs writer).
--
-- rollback:
--   revoke execute on function start_heat(uuid, uuid, uuid, timestamptz) from authenticated;
--   drop function if exists start_heat(uuid, uuid, uuid, timestamptz);
--   revoke execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) from authenticated;
--   drop function if exists record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text);
--   revoke execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) from authenticated;
--   drop function if exists auto_max_heat(uuid, uuid, uuid, timestamptz);

-- ROADMAP.md's own known open item: T4.3's app-mode timer and T4.4's manual
-- entry both write directly to the database, not through Phase 3's outbox —
-- the exact "live, time-pressured screen" the outbox exists for, deferred at
-- the time as its own focused pass. Three RPCs close it, one per write this
-- surface makes, all idempotent via the same processed_operations ledger
-- confirm_heat/publish_session already use.
--
-- Why this needs RPCs at all, not just enqueue-then-plain-update: a queued
-- write can flush arbitrarily long after it was made (the whole point of
-- queuing it). The JS-level pre-write checks the direct-write functions
-- used to make (heat.status, an entry's current elapsed_secs) were read
-- live, synchronously, right before the write — reads that queuing removes
-- entirely, since the whole write now happens later, out of band, possibly
-- offline. These RPCs move that same validation server-side, atomically
-- with the write, and report a real conflict (P0002, same idiom
-- confirm_heat uses) when reality has moved on since the operation was
-- queued — which the outbox already knows how to treat as `.permanent`
-- (core/outbox.js) rather than retrying forever.
--
-- started_at stays CLIENT-supplied (p_started_at below), not server now() —
-- deliberately, to preserve the already-shipped and already-Playwright-
-- tested cross-surface agreement design (tests/e2e/cross-surface-countdown.
-- spec.js): every viewer already computes remaining time locally against
-- whatever started_at it reads, and introducing a second, server-side clock
-- source here would just be a new way for that agreement to drift, not a
-- fix for anything.

-- ============ start_heat ============
-- Mirrors startHeat()'s own idempotent contract exactly: a heat that's
-- already past 'pending' is left untouched, not an error — a concurrent
-- device, or this very operation retrying after its write landed but the
-- ack was lost, must both be safe no-ops.
create or replace function start_heat(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_id uuid,
  p_started_at timestamptz
)
returns void
language plpgsql
as $$
declare
  v_status text;
  v_timing_mode text;
begin
  if exists (select 1 from processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Two distinct checks, matching confirm_heat's own established shape
  -- (migration 20260822100000) — each catches a case the other can't.
  -- app.org_id_for_heat is `security definer` (RLS migration) and returns
  -- the heat's TRUE org regardless of who's asking, so on its own it only
  -- catches a nonexistent heat or a caller passing the WRONG org id for a
  -- heat they can otherwise see (a member of more than one org). It cannot
  -- tell "correct org id, and a real member" from "correct org id, but not
  -- actually a member of it" — only a plain, RLS-filtered select can (found
  -- in review: an earlier draft used only this check as the sole gate, and
  -- a non-member caller who simply passed the heat's real org id sailed
  -- straight through it, only failing later and confusingly, at the
  -- processed_operations insert's own RLS).
  if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'start_heat: heat % not found', p_heat_id;
  end if;

  select status, timing_mode into v_status, v_timing_mode
  from ct_heats where id = p_heat_id;
  if v_status is null then
    raise exception 'start_heat: heat % not found', p_heat_id;
  end if;

  if v_timing_mode <> 'app' then
    raise exception 'start_heat: heat % is not an app-mode heat', p_heat_id;
  end if;

  -- No FOUND check on this update — see the module comment above for why a
  -- heat that's already left 'pending' is a safe no-op here, not an error.
  update ct_heats
  set status = 'timing', started_at = p_started_at
  where id = p_heat_id and status = 'pending';

  insert into processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'start_heat');
end;
$$;

grant execute on function start_heat(uuid, uuid, uuid, timestamptz) to authenticated;

-- ============ record_heat_time ============
-- One RPC covers both callers that write a single cupper's time, since the
-- shape (org check, heat-status check, the write itself, the same
-- advance-to-scoring check confirm_heat's own strict-confirm sits next to)
-- is identical between them — only the conflict rule on an
-- already-recorded time differs:
--   'reject'    — a real tap. A second tap for the same cupper is a race or
--                 a bug (a double-tap, or the clock expiring and
--                 auto-max_heat winning first) and must be refused, exactly
--                 like recordTap()'s own current "already recorded" guard.
--   'overwrite' — a hand-entered manual time. A judge correcting a mis-typed
--                 number is normal, expected workflow (see timingManual.js's
--                 own module comment) — never a race to guard against.
--
-- p_expected_heat_status closes the gap a bare per-entry null-check can't:
-- once a heat has left the status this write assumes it's still in (a tap
-- queued while 'timing', flushing after the heat somehow already reached
-- 'scoring' or beyond), every already-recorded entry is frozen — most
-- importantly once confirm_heat has run, since that's the point past which
-- elapsed_secs values are part of the confirmed, scored record. Silently
-- rewriting one after the fact would be exactly the kind of post-hoc
-- tampering the outbox's own idempotency ledger exists to prevent.
create or replace function record_heat_time(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_entry_id uuid,
  p_expected_heat_status text,
  p_elapsed_secs int,
  p_elapsed_secs_raw int,
  p_maxed boolean,
  p_time_source text,
  p_time_edited_at timestamptz,
  p_conflict_policy text
)
returns void
language plpgsql
as $$
declare
  v_heat_id uuid;
  v_heat_status text;
  v_already_set boolean;
begin
  if p_conflict_policy not in ('reject', 'overwrite') then
    raise exception 'record_heat_time: invalid p_conflict_policy %', p_conflict_policy;
  end if;

  if exists (select 1 from processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Same two-check shape as start_heat above — see its own comment for why
  -- the security-definer identity check alone is not a real authorization
  -- gate, only the plain, RLS-filtered select below is.
  if p_org_id is distinct from app.org_id_for_heat_entry(p_heat_entry_id) then
    raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  -- heat_id is immutable for a given entry (never reassigned to a
  -- different heat), so resolving it here, before the lock below, is safe —
  -- unlike status/already-set, it can't go stale while waiting for the lock.
  select he.heat_id into v_heat_id from ct_heat_entries he where he.id = p_heat_entry_id;

  if v_heat_id is null then
    raise exception 'record_heat_time: heat entry % not found', p_heat_entry_id;
  end if;

  -- Locks the PARENT heat row before reading status/already-set (below) and
  -- before the entry write and "is everyone else done" check further down —
  -- without this, two concurrent record_heat_time calls for the last two
  -- still-null entries of the same heat can each run their own existence
  -- check against a snapshot that doesn't yet see the OTHER transaction's
  -- still-uncommitted write (plain reads under READ COMMITTED don't block
  -- on or wait for an in-flight write to a DIFFERENT row): both entries
  -- land correctly, but EACH transaction's own "is anyone still null" check
  -- sees the other's entry as still null, so NEITHER ever flips the heat to
  -- 'scoring'.
  perform 1 from ct_heats where id = v_heat_id for update;

  -- Read status/already-set ONLY after acquiring the lock above, never
  -- before — found in review (schema-guardian), reproduced with two real
  -- concurrent sessions: an earlier version of this function read these
  -- BEFORE the lock, so a call delayed waiting for the lock (e.g. stuck
  -- behind auto_max_heat's own lock on this same heat) would resume and
  -- validate against a now-stale snapshot, silently overwriting a value
  -- the OTHER, already-committed transaction had just finalized — exactly
  -- the "frozen record" guarantee p_expected_heat_status exists to
  -- protect. Re-reading here, after the lock, guarantees this sees
  -- whatever the lock-holder actually committed, no matter how long the
  -- wait was.
  select h.status, (he.elapsed_secs is not null)
    into v_heat_status, v_already_set
  from ct_heat_entries he
  join ct_heats h on h.id = he.heat_id
  where he.id = p_heat_entry_id;

  if v_heat_status <> p_expected_heat_status then
    raise exception 'CONFLICT: heat % is % now, expected %', v_heat_id, v_heat_status, p_expected_heat_status
      using detail = json_build_object(
              'heat_id', v_heat_id,
              'current_status', v_heat_status,
              'expected_status', p_expected_heat_status
            )::text,
            errcode = 'P0002';
  end if;

  if p_conflict_policy = 'reject' and v_already_set then
    raise exception 'CONFLICT: heat entry % already has a recorded time', p_heat_entry_id
      using errcode = 'P0002';
  end if;

  update ct_heat_entries
  set elapsed_secs = p_elapsed_secs,
      elapsed_secs_raw = p_elapsed_secs_raw,
      maxed = p_maxed,
      time_source = p_time_source,
      time_edited_at = p_time_edited_at
  where id = p_heat_entry_id;

  -- Same rule as the JS-level maybeAdvanceToScoring(), folded into this same
  -- transaction so the status flip is never observably lagging behind the
  -- write that actually completed the heat.
  if not exists (
    select 1 from ct_heat_entries where heat_id = v_heat_id and elapsed_secs is null
  ) then
    update ct_heats set status = 'scoring' where id = v_heat_id and status in ('pending', 'timing');
  end if;

  insert into processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'record_heat_time');
end;
$$;

grant execute on function record_heat_time(uuid, uuid, uuid, text, int, int, boolean, text, timestamptz, text) to authenticated;

-- ============ auto_max_heat ============
-- One operation for the whole sweep, not one per still-running cupper —
-- "outbox holds operations, not rows" (core/outbox.js's own module
-- comment), the same reasoning confirm_heat already applies to a whole
-- heat's worth of results. duration_secs is read server-side from ct_heats
-- itself, never trusted from the client, closing a value the client has no
-- real reason to ever pass differently from what's already on the row.
create or replace function auto_max_heat(
  p_operation_id uuid,
  p_org_id uuid,
  p_heat_id uuid,
  p_time_edited_at timestamptz
)
returns void
language plpgsql
as $$
declare
  v_duration_secs int;
begin
  if exists (select 1 from processed_operations where id = p_operation_id) then
    return;
  end if;

  -- Same two-check shape as start_heat/record_heat_time above.
  if p_org_id is distinct from app.org_id_for_heat(p_heat_id) then
    raise exception 'auto_max_heat: heat % not found', p_heat_id;
  end if;

  if not exists (select 1 from ct_heats where id = p_heat_id) then
    raise exception 'auto_max_heat: heat % not found', p_heat_id;
  end if;

  -- Not strictly required for THIS function's own correctness (its single
  -- bulk sweep-then-flip already gets a correct result against a
  -- concurrent record_heat_time via Postgres's own UPDATE-vs-UPDATE
  -- row-lock-and-recheck semantics), but serializing against
  -- record_heat_time's own same-row lock (see its comment) removes any
  -- doubt and costs nothing extra for the single-writer-per-heat case this
  -- app actually has.
  perform 1 from ct_heats where id = p_heat_id for update;

  select duration_secs into v_duration_secs from ct_heats where id = p_heat_id and status = 'timing';

  -- A safe no-op if the heat isn't (or is no longer) 'timing' — matches
  -- autoMaxRemainingEntries()'s own established "safe to call more than
  -- once" contract: a stray or late auto-max attempt after the heat already
  -- fully advanced some other way must never be an error.
  if v_duration_secs is not null then
    update ct_heat_entries
    set elapsed_secs = v_duration_secs,
        elapsed_secs_raw = v_duration_secs,
        maxed = true,
        time_source = 'maxed',
        time_edited_at = p_time_edited_at
    where heat_id = p_heat_id and elapsed_secs is null;

    update ct_heats set status = 'scoring' where id = p_heat_id and status = 'timing';
  end if;

  insert into processed_operations (id, org_id, kind) values (p_operation_id, p_org_id, 'auto_max_heat');
end;
$$;

grant execute on function auto_max_heat(uuid, uuid, uuid, timestamptz) to authenticated;
