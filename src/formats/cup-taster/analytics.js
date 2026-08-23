// Report and analytics (handoff §14 T4.7, §6's `analytics` module: "Per-cupper,
// per-set difficulty, distribution"). Scoped with the user before writing code:
// the report only ever surfaces once the WHOLE event is finished — the terminal
// stage (cutoff === null) has been resolved via T4.6's "Declare champion" action
// — never mid-competition. This sidesteps every partial-data question a live
// report would raise (an unconfirmed heat, a stage still awaiting a tiebreak)
// entirely: by the time this module's data is read, every stage's numbers are
// already final and will never change again.
import { listStagesForEvent, listSetsForStage } from './setup.js';
import { fetchStandingsForStage } from './standings.js';
import { getSupabase } from '../../core/supabaseClient.js';

// DB. The one gate every other function in this module implicitly assumes:
// the terminal stage (§7.5: the one stage with `cutoff === null`, guaranteed
// unique per validateStagePlan's own check) has been resolved. `false` also
// covers "no stage plan exists yet" and "terminal stage exists but hasn't
// been declared complete" — both mean the same thing to a caller: no report
// yet.
export async function isEventComplete(eventId, client = getSupabase()) {
  const stages = await listStagesForEvent(eventId, client);
  const terminal = stages.find((stage) => stage.cutoff == null);
  return terminal?.status === 'complete';
}

// DB. Per-set difficulty: `avg(correct) group by set_id`, restricted to
// `kind = 'normal'` heats — the same restriction `ct_standings` applies and
// for the identical reason (that view's own migration comment): a tiebreak
// heat's population is a biased subset (only the cuppers who tied), so
// folding its results into a stage-wide difficulty figure would skew it
// relative to the sets everyone actually faced under the same conditions.
// Joined locally in JS across three queries rather than a DB-side embed —
// same reasoning as heats.js's own hydrateEntries: independent of
// PostgREST's embed syntax, trivially testable with a fake client.
export async function computeSetDifficulty(stageId, client = getSupabase()) {
  const sets = await listSetsForStage(stageId, client);

  const { data: normalHeats, error: heatsError } = await client
    .from('ct_heats')
    .select('id')
    .eq('stage_id', stageId)
    .eq('kind', 'normal');
  if (heatsError) throw heatsError;
  const heatIds = normalHeats.map((heat) => heat.id);

  const { data: heatEntries, error: entriesError } =
    heatIds.length === 0
      ? { data: [], error: null }
      : await client.from('ct_heat_entries').select('id').in('heat_id', heatIds);
  if (entriesError) throw entriesError;
  const heatEntryIds = heatEntries.map((entry) => entry.id);

  const { data: results, error: resultsError } =
    heatEntryIds.length === 0
      ? { data: [], error: null }
      : await client.from('ct_results').select('set_id, correct').in('heat_entry_id', heatEntryIds);
  if (resultsError) throw resultsError;

  const bySet = new Map();
  for (const result of results) {
    const bucket = bySet.get(result.set_id) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (result.correct) bucket.correct += 1;
    bySet.set(result.set_id, bucket);
  }

  return sets.map((set) => {
    const bucket = bySet.get(set.id) ?? { correct: 0, total: 0 };
    return {
      setId: set.id,
      position: set.position,
      label: set.label,
      sampleSize: bucket.total,
      // null, not 0 — a set nobody has a result for yet (shouldn't happen
      // once the event is complete, but stays honestly "no data" rather
      // than a misleading "0% correct" if it ever did).
      avgCorrect: bucket.total === 0 ? null : bucket.correct / bucket.total,
    };
  });
}

// Pure. Buckets `ranked` (fetchStandingsForStage's own output — no second DB
// read needed, the correct-count data is already in hand) into a histogram
// from 0 to `setCount` correct, inclusive — every bucket present even at
// zero, so a caller can render a complete distribution without first
// checking which counts actually occurred.
export function computeScoreDistribution(ranked, setCount) {
  const buckets = new Map();
  for (let count = 0; count <= setCount; count += 1) buckets.set(count, 0);
  for (const { item } of ranked) {
    // Clamped, not trusted as-is: `ct_heat_entries`'s own unique constraint
    // is only `(heat_id, entry_id)`, not scoped across every heat in a
    // stage, so nothing in the schema actually prevents the same cupper
    // being placed in two heats within one stage — a data anomaly
    // `ct_standings.correct_count` (and so `numCorrect`) would silently
    // inherit and exceed `setCount`. Not new to this module (the anomaly,
    // if it ever happened, already exists in the view); this only makes
    // sure a bucket index is never built out of range from it.
    const count = Math.min(item.numCorrect, setCount);
    buckets.set(count, (buckets.get(count) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([correctCount, numCuppers]) => ({
    correctCount,
    numCuppers,
  }));
}

// DB. One stage's full report: standings (with each entry's final
// advancement provenance, since fetchStandingsForStage now carries
// `finalPosition`/`source`/`positionNote` through), difficulty, and
// distribution together — the one call the report screen makes per stage.
export async function computeStageReport(stageId, client = getSupabase()) {
  const { stage, ranked } = await fetchStandingsForStage(stageId, client);
  const difficulty = await computeSetDifficulty(stageId, client);
  const distribution = computeScoreDistribution(ranked, stage.set_count);
  return { stage, ranked, difficulty, distribution };
}
