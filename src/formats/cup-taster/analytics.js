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

// DB. The population `computeSetDifficulty` and `computeCupperSetGrid` both
// need: every `ct_results` row (with the `heat_entry_id`/`entry_id` link
// needed to attribute a result back to a cupper, not just a set) from a
// stage's `kind = 'normal'` heats only — the same restriction `ct_standings`
// applies and for the identical reason (that view's own migration comment):
// a tiebreak heat's population is a biased subset (only the cuppers who
// tied), so folding its results into a stage-wide figure would skew it
// relative to what everyone actually faced under the same conditions.
// Extracted here on its 2nd verbatim use (this file's own established
// pattern — see e.g. `core/dom.js`'s `labeledField`, `core/timeout.js`'s
// `raceTimeout`). Joined locally in JS across three queries rather than a
// DB-side embed — same reasoning as `heats.js`'s own `hydrateEntries`:
// independent of PostgREST's embed syntax, trivially testable with a fake
// client.
async function fetchNormalHeatResults(stageId, client) {
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
      : await client.from('ct_heat_entries').select('id, entry_id').in('heat_id', heatIds);
  if (entriesError) throw entriesError;
  const heatEntryIds = heatEntries.map((entry) => entry.id);

  const { data: results, error: resultsError } =
    heatEntryIds.length === 0
      ? { data: [], error: null }
      : await client
          .from('ct_results')
          .select('heat_entry_id, set_id, correct')
          .in('heat_entry_id', heatEntryIds);
  if (resultsError) throw resultsError;

  return { heatEntries, results };
}

// Pure. The actual per-set aggregation, split out from computeSetDifficulty
// so computeStageReport can share ONE fetch across this and
// computeCupperSetGridFromResults below, instead of each independently
// re-querying the identical stage/population — found in review
// (code-reviewer): computeStageReport was issuing ct_sets/ct_heats/
// ct_heat_entries/ct_results FOUR queries each, TWICE over, for the same
// stage. This project is explicit elsewhere about round-trip cost
// (reportScreen.js's own sequential-not-parallelized per-stage-loop
// comment) — doubling it silently here cut against that same reasoning.
function computeSetDifficultyFromResults(sets, results) {
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

// DB. Per-set difficulty: `avg(correct) group by set_id`, restricted to
// `kind = 'normal'` heats (see `fetchNormalHeatResults`'s own comment for
// why). Does its own fetch — this export stays usable standalone (its own
// test suite calls it directly); computeStageReport bypasses this and calls
// computeSetDifficultyFromResults directly against its own shared fetch
// instead, to avoid the double-query cost.
export async function computeSetDifficulty(stageId, client = getSupabase()) {
  const sets = await listSetsForStage(stageId, client);
  const { results } = await fetchNormalHeatResults(stageId, client);
  return computeSetDifficultyFromResults(sets, results);
}

// Pure. The actual per-cupper grid-building, split out for the same reason
// computeSetDifficultyFromResults was (see its own comment above).
function computeCupperSetGridFromResults(sets, heatEntries, results) {
  const entryIdByHeatEntryId = new Map(heatEntries.map((entry) => [entry.id, entry.entry_id]));
  // entry_id -> (set_id -> correct)
  const correctBySetByEntry = new Map();
  for (const result of results) {
    const entryId = entryIdByHeatEntryId.get(result.heat_entry_id);
    // A result row whose heat_entry_id isn't in THIS stage's normal-heat
    // population shouldn't be reachable (the same `.in('heat_entry_id', ...)`
    // filter that fetched `results` already scoped it) — skipped rather
    // than trusted, matching this module's existing defensive style
    // (computeScoreDistribution's own numCorrect clamp) for a schema
    // anomaly this function has no business assuming can't happen.
    if (entryId == null) continue;
    if (!correctBySetByEntry.has(entryId)) correctBySetByEntry.set(entryId, new Map());
    correctBySetByEntry.get(entryId).set(result.set_id, result.correct);
  }

  const grid = new Map();
  for (const [entryId, correctBySet] of correctBySetByEntry) {
    grid.set(
      entryId,
      sets.map((set) => ({
        setId: set.id,
        position: set.position,
        // null means "no result row for this set" (a heat that ended
        // early, or a genuine data gap) — distinct from `false` (scored
        // and wrong). Mirrors computeSetDifficulty's own null-vs-0 honesty.
        correct: correctBySet.has(set.id) ? correctBySet.get(set.id) : null,
      })),
    );
  }
  return grid;
}

// DB. The per-cupper, per-set Y/N breakdown the report's standings table
// renders as its Set 1..N columns (2026-09-11, user-requested — a WCTC-style
// per-cupper accuracy grid the organiser wanted the report to match).
// Restricted to `kind = 'normal'` heats, same reasoning as
// `computeSetDifficulty`. Keyed by `entry_id` (a cupper's own roster
// identity), not `stageEntryId` or `heat_entry_id` — `fetchStandingsForStage`'s
// own `ranked` rows already carry `entry_id` and need to look this up per
// row without a second join of their own. Does its own fetch, same
// standalone-usability reasoning as computeSetDifficulty above.
export async function computeCupperSetGrid(stageId, client = getSupabase()) {
  const sets = await listSetsForStage(stageId, client);
  const { heatEntries, results } = await fetchNormalHeatResults(stageId, client);
  return computeCupperSetGridFromResults(sets, heatEntries, results);
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
// `finalPosition`/`source`/`positionNote` through), difficulty, distribution,
// and the per-cupper set grid together — the one call the report screen
// makes per stage.
export async function computeStageReport(stageId, client = getSupabase()) {
  const { stage, ranked } = await fetchStandingsForStage(stageId, client);
  // ONE shared fetch of the normal-heat population, reused for both
  // difficulty and the set grid below — see computeSetDifficultyFromResults'
  // own comment for why this replaced two independent fetches.
  const sets = await listSetsForStage(stageId, client);
  const { heatEntries, results } = await fetchNormalHeatResults(stageId, client);
  const difficulty = computeSetDifficultyFromResults(sets, results);
  const distribution = computeScoreDistribution(ranked, stage.set_count);
  const setGrid = computeCupperSetGridFromResults(sets, heatEntries, results);
  return { stage, ranked, difficulty, distribution, setGrid };
}

// Pure. Rounded to the nearest whole second before ever reaching
// core/duration.js's `formatDuration` — that function's own `%` arithmetic
// assumes an integer input (see its own module comment/tests); an
// un-rounded average (e.g. 33.33s) would render as a raw fractional-seconds
// string instead of M:SS. Lives here, not reportScreen.js, so
// computeEventSummary below can reuse it directly — found duplicated
// verbatim in review (code-reviewer): reportScreen.js used to keep its own
// byte-identical copy for its per-stage Avg-time/set column, which this
// function's own computation would otherwise have silently re-diverged
// from. reportScreen.js can't be imported FROM here (it already imports
// analytics.js; the reverse would cycle), so this moved the other way.
export function computeAvgSecsPerSet(totalElapsedSecs, setsScored) {
  if (totalElapsedSecs == null || setsScored === 0) return null;
  return Math.round(totalElapsedSecs / setsScored);
}

// Pure. Rolls every stage's own `ranked` list into one per-cupper summary
// across the WHOLE event (2026-09-11, user-requested — Phase B of the
// WCTC-style analytics upgrade scoped with the user in advance; Phase A's
// own CHANGELOG entry covers Phase A). `stageReports` is
// `mountReportScreen`'s own already-loaded array (one `computeStageReport`
// result per stage, in `listStagesForEvent`'s ordinal-ascending order —
// depended on below, not re-sorted here).
//
// Row order is deliberately NOT a fresh ranking computed from these totals
// — a cupper eliminated early could rack up a higher raw score sum across
// fewer rounds than a finalist without ever having been more successful,
// and re-ranking by total score would misrepresent the real bracket
// outcome this project's own advancement rules already decided. Instead,
// each cupper's true placement is already fully determined by (the most
// advanced stage they reached, their `finalPosition` within it) —
// `resolve_stage`/`standings.js` already computed this — so this function
// only RECONSTRUCTS that ordering from data already present in `ranked`,
// never inventing a second, competing rule. `finalPosition` is reliably
// non-null on a cupper's own LAST round specifically (see
// `describeOutcome`'s own comment: null only ever means "advanced,"
// impossible for the stage nothing came after) — the `?? position`
// fallback below is defensive, matching this module's own established
// style for a schema anomaly this function has no business assuming can't
// happen, not an expected path.
// Known limitation, noted in review (code-reviewer) for consistency with
// this file's own established defensive style elsewhere
// (computeScoreDistribution's own comment/clamp a few functions above):
// nothing here guards against the same `ct_heat_entries` schema anomaly
// that function already documents (its own unique constraint is only
// `(heat_id, entry_id)`, not stage-wide, so nothing stops the same cupper
// appearing twice in one stage's `ranked` list). If that ever happened,
// this function would push two round entries sharing one `stageOrdinal` —
// `eventSummaryRoundColumns`'s per-round cell lookup would silently show
// only the first, while `totalScore`/`totalElapsedSecs` would still sum
// both, a visible mismatch between a row's own cell and its own total. Not
// guarded against here (unlike the sibling function) since doing so
// correctly needs a real merge decision, not just a clamp — left as a
// known gap rather than a silent one, per this project's "no speculative
// validation" stance.
export function computeEventSummary(stageReports) {
  const byEntry = new Map();

  stageReports.forEach((stageReport) => {
    const { stage, ranked } = stageReport;
    for (const { item, position } of ranked) {
      const existing = byEntry.get(item.entry_id) ?? {
        entryId: item.entry_id,
        displayName: item.displayName,
        rounds: [],
        totalScore: 0,
        totalSetsScored: 0,
        totalElapsedSecs: null,
      };
      existing.rounds.push({
        stageKind: stage.kind,
        stageOrdinal: stage.ordinal,
        position,
        numCorrect: item.numCorrect,
        setsScored: item.sets_scored,
        totalElapsedSecs: item.total_elapsed_secs,
        finalPosition: item.finalPosition,
      });
      existing.totalScore += item.numCorrect;
      existing.totalSetsScored += item.sets_scored;
      // Summed only across rounds that actually HAVE a time — a cupper
      // with at least one timed round should never show a total that's
      // silently short by an untimed round's own contribution, but the
      // total itself should stay null (not 0) if NO round has ever been
      // timed at all, same "honest no data" choice this module's other
      // aggregates already make.
      if (item.total_elapsed_secs != null) {
        existing.totalElapsedSecs = (existing.totalElapsedSecs ?? 0) + item.total_elapsed_secs;
      }
      byEntry.set(item.entry_id, existing);
    }
  });

  const summaries = [...byEntry.values()].map((entry) => ({
    ...entry,
    avgSecsPerSet: computeAvgSecsPerSet(entry.totalElapsedSecs, entry.totalSetsScored),
  }));

  summaries.sort((a, b) => {
    const aLast = a.rounds[a.rounds.length - 1];
    const bLast = b.rounds[b.rounds.length - 1];
    if (aLast.stageOrdinal !== bLast.stageOrdinal) return bLast.stageOrdinal - aLast.stageOrdinal;
    return (aLast.finalPosition ?? aLast.position) - (bLast.finalPosition ?? bLast.position);
  });

  return summaries;
}
