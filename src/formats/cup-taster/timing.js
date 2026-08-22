// Timing surface, app mode (handoff §14 T4.3, §7.1). "Timing precedes
// scoring, strictly: pending → timing → scoring → confirmed." This module
// owns the whole lifecycle for an app-timed heat: starting the master clock,
// recording each cupper's stop tap (via the sole cap, `clampElapsed` —
// handoff §5.2, §6), auto-maxing anyone still running once the master clock
// expires, and advancing the heat to `scoring` once every cupper has a final
// time. `formats/cup-taster/timing-screen.js` is the UI built on top of this.
//
// Direct writes, not the outbox (handoff §9) — a deliberate, documented gap
// (see CHANGELOG.md/ROADMAP.md): this is the first genuinely live,
// time-pressured screen in the build plan, exactly what the outbox exists
// for, but wiring it correctly (queue ordering against a live countdown,
// conflict surfacing) is substantial scope on its own and deserves a focused
// pass with offline-sync-auditor rather than folding into this task's first
// cut.
import { clampElapsed } from '../../core/timeclamp.js';
import { isExpired } from '../../core/countdown.js';
import { findHeatById, listHeatEntries } from './heats.js';
import { getSupabase } from '../../core/supabaseClient.js';

// A tap computed as arriving before the heat even started is normal clock
// skew up to a point (clampElapsed floors it to elapsed:0 either way) — but
// past this point it stops looking like drift and starts looking like a
// broken client clock or a stale `started_at` read. Silently absorbing an
// unbounded negative value would let a bad clock hand a cupper the fastest
// time in the heat, undetected. 5s is a generous allowance for real skew.
const MAX_NEGATIVE_SKEW_SECS = 5;

async function findHeatEntry(heatId, entryId, client) {
  const { data, error } = await client
    .from('ct_heat_entries')
    .select('*')
    .eq('heat_id', heatId)
    .eq('entry_id', entryId)
    .single();
  if (error) throw error;
  return data;
}

// The one place a ct_heat_entries update payload is built, so `elapsed_secs`
// only ever comes from `clampElapsed()` (enforced by `no-raw-elapsed-write`)
// regardless of which caller — a real tap or an auto-max — is writing it.
// `clampElapsed` itself floors a negative input to elapsed:0 while
// preserving the true value in `raw` — no pre-clamping happens here, so the
// audit trail `elapsed_secs_raw` promises (handoff §5.2) is never lost
// before it even reaches the one function responsible for it.
function buildClampedUpdate(rawSecs, durationSecs, timeSource, nowMs) {
  const clamped = clampElapsed(rawSecs, durationSecs);
  return {
    elapsed_secs: clamped.elapsed,
    elapsed_secs_raw: clamped.raw,
    maxed: clamped.maxed,
    time_source: timeSource,
    time_edited_at: new Date(nowMs).toISOString(),
  };
}

// A failure here means only the heat's status→scoring transition needs a
// retry — the write that triggered this call (a real tap or an auto-max)
// already succeeded before this runs. Never let it fail the caller: the
// next successful write for this heat (another tap, or
// autoMaxRemainingEntries at expiry) retries the same check, and the
// timing screen self-heals it on the next render too.
async function tryAdvanceToScoring(heatId, client) {
  try {
    await maybeAdvanceToScoring(heatId, client);
  } catch (err) {
    console.error(`tryAdvanceToScoring: failed for heat ${heatId}, will retry on next write`, err);
  }
}

// Idempotent: a heat already timing/scoring/confirmed is returned unchanged
// rather than restarting the clock — restarting mid-heat would corrupt the
// meaning of every already-recorded elapsed time (they'd all read as
// measured against a `started_at` that never actually applied to them).
export async function startHeat(heatId, client = getSupabase(), { now = () => Date.now() } = {}) {
  const heat = await findHeatById(heatId, client);
  if (heat.timing_mode !== 'app') {
    throw new Error(`startHeat: heat ${heatId} is timing_mode "${heat.timing_mode}", not "app"`);
  }
  if (heat.status !== 'pending') return heat;

  const { data, error } = await client
    .from('ct_heats')
    .update({ status: 'timing', started_at: new Date(now()).toISOString() })
    .eq('id', heatId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw error;
  // A concurrent starter won the race — re-fetch rather than return the
  // stale pre-update read.
  return data ?? findHeatById(heatId, client);
}

// Advances pending → ... no: timing → scoring, once every entry in the heat
// has a final elapsed_secs (tapped or maxed). A no-op, not an error, if the
// heat isn't fully stopped yet or has already moved past `timing` — callers
// (recordTap, autoMaxRemainingEntries) call this unconditionally after every
// write rather than trying to reason about whether this was "the last one."
export async function maybeAdvanceToScoring(heatId, client = getSupabase()) {
  const entries = await listHeatEntries(heatId, client);
  const allStopped = entries.length > 0 && entries.every((entry) => entry.elapsed_secs != null);
  if (!allStopped) return null;

  const { data, error } = await client
    .from('ct_heats')
    .update({ status: 'scoring' })
    .eq('id', heatId)
    .eq('status', 'timing')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Idempotent by rejection, not by silent reuse: an entry that already has a
// recorded time throws rather than being silently overwritten — a duplicate
// tap (double-tap, a retried request) must never change an already-recorded
// time. `.is('elapsed_secs', null)` on the update is the same guarantee
// enforced at the DB layer, closing the gap between the read-check above and
// the write (two concurrent taps for the same cupper).
export async function recordTap(
  heatId,
  entryId,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  const heat = await findHeatById(heatId, client);
  if (heat.status !== 'timing') {
    throw new Error(`recordTap: heat ${heatId} is not currently timing (status: ${heat.status})`);
  }

  const entry = await findHeatEntry(heatId, entryId, client);
  if (entry.elapsed_secs != null) {
    throw new Error(`recordTap: cupper ${entryId}'s time is already recorded for this heat`);
  }

  const rawSecs = Math.floor((now() - new Date(heat.started_at).getTime()) / 1000);
  if (rawSecs < -MAX_NEGATIVE_SKEW_SECS) {
    throw new Error(
      `recordTap: computed a tap ${Math.abs(rawSecs)}s before the heat started for cupper ${entryId} — this looks like a clock problem, not normal drift. Not recorded; check the device's clock.`,
    );
  }
  const update = buildClampedUpdate(rawSecs, heat.duration_secs, 'tapped', now());

  const { data, error } = await client
    .from('ct_heat_entries')
    .update(update)
    .eq('id', entry.id)
    .is('elapsed_secs', null)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // Lost a race — the entry now has some final time (a concurrent tap, or
    // the master clock expiring and auto-maxing it first). Re-fetch to
    // report what actually happened rather than a generic "try again",
    // since the two cases mean very different things to an organiser.
    const raced = await findHeatEntry(heatId, entryId, client);
    if (raced?.time_source === 'maxed') {
      throw new Error(
        `recordTap: cupper ${entryId}'s clock had already expired (maxed at ${raced.elapsed_secs}s) before this tap was processed — the tap could not be recorded.`,
      );
    }
    throw new Error(`recordTap: cupper ${entryId}'s time was recorded by another request first`);
  }

  await tryAdvanceToScoring(heatId, client);
  return data;
}

// Called by the UI once its own countdown detects the master clock has
// expired — there is no server-side timer; every viewer computes remaining
// time locally against `started_at` (handoff §8.2). Anyone still running
// gets maxed via the same sole cap (`clampElapsed`) a real tap uses. Safe to
// call more than once for the same heat: already-maxed/tapped entries are
// excluded by the same `.is('elapsed_secs', null)` guard `recordTap` uses.
export async function autoMaxRemainingEntries(
  heatId,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  const heat = await findHeatById(heatId, client);
  if (heat.status !== 'timing') return [];
  if (!isExpired(new Date(heat.started_at).getTime(), heat.duration_secs, now())) {
    throw new Error(`autoMaxRemainingEntries: heat ${heatId} has not expired yet`);
  }

  const entries = await listHeatEntries(heatId, client);
  const unstopped = entries.filter((entry) => entry.elapsed_secs == null);

  const maxed = [];
  for (const entry of unstopped) {
    const update = buildClampedUpdate(heat.duration_secs, heat.duration_secs, 'maxed', now());
    const { data, error } = await client
      .from('ct_heat_entries')
      .update(update)
      .eq('id', entry.id)
      .is('elapsed_secs', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (data) maxed.push(data);
  }

  await tryAdvanceToScoring(heatId, client);
  return maxed;
}
