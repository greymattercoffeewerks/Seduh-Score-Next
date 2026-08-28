// Timing surface, app mode (handoff §14 T4.3, §7.1). "Timing precedes
// scoring, strictly: pending → timing → scoring → confirmed." This module
// owns the whole lifecycle for an app-timed heat: starting the master clock,
// recording each cupper's stop tap (via the sole cap, `clampElapsed` —
// handoff §5.2, §6), and auto-maxing anyone still running once the master
// clock expires. `formats/cup-taster/timingScreen.js` is the UI built on
// top of this.
//
// `buildClampedUpdate` is exported and reused by `timingManual.js` (T4.4)
// too — the write-payload shape is identical regardless of `timing_mode`;
// only *how* a raw seconds value is obtained (a tap vs. a hand-typed number)
// differs between the two modes, so only that part is duplicated rather
// than the whole lifecycle.
//
// Through the outbox (T4.3/T4.4 follow-up, migration 20260828150000) — was
// a direct-write, deliberate, documented gap (see CHANGELOG.md/ROADMAP.md)
// until now. `start_heat`/`record_heat_time`/`auto_max_heat` are three RPCs
// mirroring confirm_heat's own idempotent, org-scoped shape; the migration's
// own header comment has the full design rationale (why RPCs are needed at
// all, why started_at stays client-timestamp-supplied). The short version:
// every write here captures its payload (a timestamp, a clamped elapsed
// value) at the moment of the ACTION, never re-derived at flush time, so a
// tap recorded while offline doesn't inflate by however long the device was
// offline; and every write takes the caller's own already-rendered local
// state as a parameter instead of re-reading the server first, so recording
// a tap has no network dependency of its own and can always be queued
// immediately, online or not. The RPC is what does the real, authoritative
// validation once it actually flushes — surfacing a genuine conflict (a
// duplicate tap, a heat that moved on) as a `.permanent` outbox failure
// rather than silently accepting or silently dropping it.
//
// timingHandlers() below is shared by every write in this module AND
// timingManual.js's recordManualTime — a single flushOutbox() call using
// only its own caller's operation type would stall on any OTHER timing
// operation queued ahead of it in strict FIFO order (an app-mode heat that
// gets started, then rapid-tapped, while offline enqueues start_heat and
// several record_heat_time operations together, in completely normal use).
// NOT shared with scoring.js's confirm_heat or publish.js's publish_session
// — core/outbox.js registers handlers per flushOutbox() call, not globally,
// so those two operation types have this exact same latent gap against
// each other and against this module's own operations. Pre-existing (both
// already had it, independently, before this task), not introduced here,
// and out of scope for this pass — see ROADMAP.md's own note on it.
import { clampElapsed } from '../../core/timeclamp.js';
import { enqueueOperation, flushOutbox } from '../../core/outbox.js';
import { getSupabase } from '../../core/supabaseClient.js';

// A tap computed as arriving before the heat even started is normal clock
// skew up to a point (clampElapsed floors it to elapsed:0 either way) — but
// past this point it stops looking like drift and starts looking like a
// broken client clock or a stale `started_at` read. Silently absorbing an
// unbounded negative value would let a bad clock hand a cupper the fastest
// time in the heat, undetected. 5s is a generous allowance for real skew.
const MAX_NEGATIVE_SKEW_SECS = 5;

// The one place a ct_heat_entries update payload is built, so `elapsed_secs`
// only ever comes from `clampElapsed()` (enforced by `no-raw-elapsed-write`)
// regardless of which caller — a real tap, a manual entry, or an auto-max —
// is writing it. `clampElapsed` itself floors a negative input to elapsed:0
// while preserving the true value in `raw` — no pre-clamping happens here,
// so the audit trail `elapsed_secs_raw` promises (handoff §5.2) is never
// lost before it even reaches the one function responsible for it.
export function buildClampedUpdate(rawSecs, durationSecs, timeSource, nowMs) {
  const clamped = clampElapsed(rawSecs, durationSecs);
  return {
    elapsed_secs: clamped.elapsed,
    elapsed_secs_raw: clamped.raw,
    maxed: clamped.maxed,
    time_source: timeSource,
    time_edited_at: new Date(nowMs).toISOString(),
  };
}

// The one place a record_heat_time payload is built, so recordTap (below)
// and timingManual.js's recordManualTime don't drift apart on this shape —
// found in review: the two call sites had ended up building this same
// 9-field object independently, byte-for-byte identical except for
// `p_conflict_policy`. `heatEntry`/`heat`/`update` are the caller's own
// already-computed values (buildClampedUpdate's output plus local state),
// never re-derived here.
export function buildRecordHeatTimePayload(heat, heatEntry, orgId, update, conflictPolicy) {
  return {
    p_operation_id: crypto.randomUUID(),
    p_org_id: orgId,
    p_heat_entry_id: heatEntry.id,
    p_expected_heat_status: heat.status,
    p_elapsed_secs: update.elapsed_secs,
    p_elapsed_secs_raw: update.elapsed_secs_raw,
    p_maxed: update.maxed,
    p_time_source: update.time_source,
    p_time_edited_at: update.time_edited_at,
    p_conflict_policy: conflictPolicy,
  };
}

// Every RPC error these operations can return is a rejection of that exact
// payload (a real conflict — see migration 20260828150000's own comments)
// and will fail the exact same way on retry, so it's always marked
// `.permanent`. A network-level failure (client.rpc() itself rejecting
// before ever reaching the server) never reaches this branch and stays the
// outbox's normal, retryable failure.
function rpcHandler(client, type) {
  return async (payload) => {
    const { error } = await client.rpc(type, payload);
    if (error) {
      const err = new Error(error.message);
      err.code = error.code;
      err.details = error.details;
      err.permanent = true;
      throw err;
    }
  };
}

export function timingHandlers(client) {
  return {
    start_heat: rpcHandler(client, 'start_heat'),
    record_heat_time: rpcHandler(client, 'record_heat_time'),
    auto_max_heat: rpcHandler(client, 'auto_max_heat'),
  };
}

async function submitTimingOperation(type, payload, client) {
  await enqueueOperation(type, payload);
  return flushOutbox(timingHandlers(client));
}

// Idempotent by the RPC's own contract (a heat already timing/scoring/
// confirmed is left untouched server-side, matching this function's own
// long-standing contract before the outbox wiring) — restarting mid-heat
// would corrupt the meaning of every already-recorded elapsed time.
// started_at is captured HERE, the moment Start is tapped, never read back
// from the server afterward — this is what the whole surface's already-
// shipped, already-Playwright-tested cross-viewer agreement design depends
// on (tests/e2e/cross-surface-countdown.spec.js), and it lets the caller
// render its own countdown immediately, before any network round trip
// completes. Returns both the captured value AND the flush result — the
// caller's job to reconcile the two against fresh, reloaded state (see
// timingScreen.js), never this function's, matching scoring.js's
// established "ground truth over flush bookkeeping" principle.
export async function startHeat(
  heatId,
  orgId,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  const startedAtMs = now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const flushResult = await submitTimingOperation(
    'start_heat',
    {
      p_operation_id: crypto.randomUUID(),
      p_org_id: orgId,
      p_heat_id: heatId,
      p_started_at: startedAtIso,
    },
    client,
  );
  return { startedAtMs, startedAtIso, flushResult };
}

// `heat` and `heatEntry` are the CALLER's own already-loaded, already-
// rendered state — the same rows its last render() used to decide a Stop
// button belongs here at all — never re-read from the server here. That's
// the module comment's own point: this must succeed (i.e. enqueue) purely
// from local knowledge, with no network dependency of its own, so a tap
// made while genuinely offline is captured immediately rather than blocked
// on a read that can't complete.
//
// Returns the clamped `expectedElapsedSecs` this call attempted to write, alongside
// the flush result — a caller checking "did MY tap take" against fresh,
// reloaded state must compare against this exact value, not just whether
// the entry is non-null: a 'reject'-policy conflict means someone else's
// write is what's actually sitting there, and a bare null-check can't tell
// the two apart (found in review while designing timingScreen.js's own
// ground-truth check — an earlier draft used exactly that null-check and
// would have silently attributed a rejected duplicate tap to the wrong
// action as a false "recorded" success).
export async function recordTap(
  heat,
  heatEntry,
  orgId,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  const nowMs = now();
  const rawSecs = Math.floor((nowMs - new Date(heat.started_at).getTime()) / 1000);
  if (rawSecs < -MAX_NEGATIVE_SKEW_SECS) {
    throw new Error(
      `recordTap: computed a tap ${Math.abs(rawSecs)}s before the heat started for heat entry ${heatEntry.id} — this looks like a clock problem, not normal drift. Not recorded; check the device's clock.`,
    );
  }
  const update = buildClampedUpdate(rawSecs, heat.duration_secs, 'tapped', nowMs);
  const flushResult = await submitTimingOperation(
    'record_heat_time',
    buildRecordHeatTimePayload(heat, heatEntry, orgId, update, 'reject'),
    client,
  );
  return { expectedElapsedSecs: update.elapsed_secs, flushResult };
}

// One operation for the whole sweep, not one per still-running cupper —
// "outbox holds operations, not rows" (core/outbox.js's own module
// comment). duration_secs is read server-side, inside the RPC, from
// ct_heats itself — the caller doesn't need to (and shouldn't) supply it.
// Safe to call more than once for the same heat: the RPC only ever touches
// entries still null, and is a no-op once the heat has left 'timing'.
// A P0002 conflict from record_heat_time/start_heat is the one shape
// core/errors.js's generic describeError() can't know about — every RPC
// error here carries `.code` (see rpcHandler above), so describeError()
// would otherwise show its generic "something went wrong" for both a
// genuinely actionable conflict AND an unrelated bug alike. Returns null
// for anything else, matching scoring.js's own describeConfirmError
// convention exactly, so callers can try this first and fall through.
// "Refresh this page", not "reload the heat" — found in review
// (ui-accessibility-reviewer): neither timingScreen.js nor
// timingManualScreen.js has a router/reload affordance of any kind yet (no
// caller mounts them inside anything but their own preview harnesses
// today), so a message naming an in-app action that doesn't exist would
// leave an organiser with no way to actually do what it tells them to. A
// browser refresh is the one thing this message can honestly ask for right
// now; revisit the wording once a real app shell/router exists.
export function describeTimingConflict(err) {
  if (err?.code !== 'P0002') return null;
  if (err.message?.includes('already has a recorded time')) {
    return "This cupper's time was already recorded — refresh this page to see the current value.";
  }
  return 'This heat has moved on since this screen last loaded — refresh this page before trying again.';
}

export async function autoMaxRemainingEntries(
  heatId,
  orgId,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  return submitTimingOperation(
    'auto_max_heat',
    {
      p_operation_id: crypto.randomUUID(),
      p_org_id: orgId,
      p_heat_id: heatId,
      p_time_edited_at: new Date(now()).toISOString(),
    },
    client,
  );
}
