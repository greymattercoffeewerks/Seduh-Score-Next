// Timing surface, manual mode (handoff §14 T4.4, §7.1). With physical
// stopwatches, there is no master clock to start or stop —
// `timing_mode = 'manual'` skips the 'timing' status entirely: a manual
// heat sits in 'pending' from the moment it's created, each cupper's time
// is hand-entered directly against it, and the heat advances straight to
// 'scoring' once every entry has one — there is no "start heat" action for
// this mode (contrast `startHeat` in `timing.js`, which is the app-mode
// entry point into 'timing').
//
// Reuses `timing.js`'s clamp-write builder and advancement helpers
// (`buildClampedUpdate`, `maybeAdvanceToScoring`, `tryAdvanceToScoring`)
// rather than reimplementing them — the only genuinely manual-mode-specific
// behavior is the write itself, and unlike a real tap (which rejects a
// second write outright, since a duplicate tap is a race or a bug), a
// hand-entered time can be corrected by re-saving: a judge fixing a
// mis-typed number is normal, expected workflow here, not a race to guard
// against. `.is('elapsed_secs', null)` has no equivalent in this module for
// that reason. That correction window is bounded by the `status !== 'pending'`
// guard below, not open-ended — once the last entry lands and the heat
// advances to 'scoring', this function refuses further writes, same as the
// tap path locks once a heat leaves 'timing'.
import { findHeatById } from './heats.js';
import { buildClampedUpdate, findHeatEntry, tryAdvanceToScoring } from './timing.js';
import { getSupabase } from '../../core/supabaseClient.js';

export async function recordManualTime(
  heatId,
  entryId,
  rawSecs,
  client = getSupabase(),
  { now = () => Date.now() } = {},
) {
  if (!Number.isInteger(rawSecs) || rawSecs < 0) {
    throw new Error(
      `recordManualTime: elapsed seconds must be a non-negative whole number, got ${rawSecs}`,
    );
  }

  const heat = await findHeatById(heatId, client);
  if (heat.timing_mode !== 'manual') {
    throw new Error(
      `recordManualTime: heat ${heatId} is timing_mode "${heat.timing_mode}", not "manual"`,
    );
  }
  if (heat.status !== 'pending') {
    throw new Error(
      `recordManualTime: heat ${heatId} is not accepting manual times (status: ${heat.status})`,
    );
  }

  const entry = await findHeatEntry(heatId, entryId, client);
  const update = buildClampedUpdate(rawSecs, heat.duration_secs, 'manual', now());

  const { data, error } = await client
    .from('ct_heat_entries')
    .update(update)
    .eq('id', entry.id)
    .select()
    .maybeSingle();
  if (error) throw error;

  await tryAdvanceToScoring(heatId, client);
  return data;
}
