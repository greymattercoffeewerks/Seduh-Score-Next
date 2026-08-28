// Timing surface, manual mode (handoff §14 T4.4, §7.1). With physical
// stopwatches, there is no master clock to start or stop —
// `timing_mode = 'manual'` skips the 'timing' status entirely: a manual
// heat sits in 'pending' from the moment it's created, each cupper's time
// is hand-entered directly against it, and the heat advances straight to
// 'scoring' once every entry has one — there is no "start heat" action for
// this mode (contrast `startHeat` in `timing.js`, which is the app-mode
// entry point into 'timing').
//
// Reuses `timing.js`'s clamp-write builder and outbox wiring
// (`buildClampedUpdate`, `timingHandlers`) rather than reimplementing
// them — the only genuinely manual-mode-specific behavior is the write
// itself. Through the outbox as of the T4.3/T4.4 follow-up (migration
// 20260828150000) — see timing.js's own module comment for the full
// design rationale. Unlike a real tap (which `record_heat_time`'s
// 'reject' policy refuses outright, since a duplicate tap is a race or a
// bug), a hand-entered time can be corrected by re-saving: a judge fixing a
// mis-typed number is normal, expected workflow here, not a race to guard
// against — this module always passes 'overwrite'. That correction window
// is bounded by `record_heat_time`'s own p_expected_heat_status check, not
// open-ended — once the last entry lands and the heat advances to
// 'scoring', the RPC refuses further writes with a conflict, same as the
// tap path locks once a heat leaves 'timing'.
import { enqueueOperation, flushOutbox } from '../../core/outbox.js';
import { buildClampedUpdate, buildRecordHeatTimePayload, timingHandlers } from './timing.js';
import { getSupabase } from '../../core/supabaseClient.js';

// `heat` and `heatEntry` are the caller's own already-loaded, already-
// rendered state — same discipline as timing.js's recordTap, and for the
// same reason: this must succeed (i.e. enqueue) purely from local
// knowledge, with no network dependency of its own.
//
// Returns the clamped `expectedElapsedSecs` this call attempted to write, alongside
// the flush result — same reason as recordTap's own identical return shape
// (see its comment): a caller checking "did MY save take" against fresh,
// reloaded state must compare against this exact value. It matters even
// more here than for a tap — 'overwrite' means a correction can land on an
// entry that ALREADY had a non-null elapsed_secs from an earlier save, so a
// bare null-check couldn't distinguish "my correction landed" from "my
// correction was rejected and the OLD value is still sitting there" at all.
export async function recordManualTime(
  heat,
  heatEntry,
  rawSecs,
  orgId,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  if (!Number.isInteger(rawSecs) || rawSecs < 0) {
    throw new Error(
      `recordManualTime: elapsed seconds must be a non-negative whole number, got ${rawSecs}`,
    );
  }

  const nowMs = now();
  const update = buildClampedUpdate(rawSecs, heat.duration_secs, 'manual', nowMs);

  const payload = buildRecordHeatTimePayload(heat, heatEntry, orgId, update, 'overwrite');
  await enqueueOperation('record_heat_time', payload);
  const flushResult = await flushOutbox(timingHandlers(client));
  return { expectedElapsedSecs: update.elapsed_secs, flushResult };
}
