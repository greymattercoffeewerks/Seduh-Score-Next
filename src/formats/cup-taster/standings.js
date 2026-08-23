// Standings and advancement (handoff §7.2, §7.3, §14 T4.6). Ranking itself
// is core/ranking (Phase 2) — this module's job is turning `ct_standings`
// rows into the shape core/ranking expects, deriving advancement via
// core/advancement (also Phase 2, unmodified), and writing the resolved
// outcome — clean advancement, a tiebreak heat's result, or a coin toss —
// into `ct_stage_entries` as advancement provenance (§5.2).
//
// The champion rule (§7.3, "most correct → fastest time → one tiebreak set
// → coin toss") is stated as "identical to the cutoff rule, applied at the
// terminal stage" — so this module treats a terminal stage (cutoff === null)
// as an ordinary cutoff-1 stage throughout, rather than a separate code
// path. `resolveAdvancement`'s caller passes `stage.cutoff ?? 1`.
import { rank, chainComparators } from '../../core/ranking.js';
import { computeAdvancement } from '../../core/advancement.js';
import { listEntriesByIds } from '../../core/registry.js';
import { findStageById, findStageByOrdinal } from './setup.js';
import { listStageEntries, listHeatEntries, generateTiebreakHeat } from './heats.js';
import { getSupabase } from '../../core/supabaseClient.js';

// Most correct first, then fastest (lowest elapsed) — §7.3's stated order,
// applied uniformly at every cutoff per that section's own "identical to the
// cutoff rule" framing. A `null` elapsed (no time recorded yet, e.g. a stage
// entry whose heat hasn't run) sorts last on speed, never first — treating
// "no time" as infinitely slow, not as a false tie-break win.
// Field is `numCorrect`, not `correct_count` — deliberately distinct from
// `ct_standings.correct_count`, so a reader (and `no-derived-storage`) never
// mistakes these transient, in-memory ranking rows for a second, competing
// place this count is stored. Nothing here is ever written back to the DB.
function byMostCorrect(a, b) {
  return b.numCorrect - a.numCorrect;
}
function byFastestTime(a, b) {
  const aTime = a.total_elapsed_secs ?? Infinity;
  const bTime = b.total_elapsed_secs ?? Infinity;
  return aTime - bTime;
}
const compareStandingRows = chainComparators(byMostCorrect, byFastestTime);

// Pure — no I/O. `rows` need only carry `numCorrect`/`total_elapsed_secs`
// (plus whatever identifying fields the caller wants preserved through
// `rank()`'s `{ item, position }` envelope). Exported so this ranking rule
// is independently testable without a DB round trip, and so
// `fetchTiebreakHeatOutcome` below can reuse the exact same comparator for a
// tiebreak heat's own (differently-sourced) rows.
export function rankStandingRows(rows) {
  return rank(rows, compareStandingRows);
}

// DB. One row per cupper in the stage, whether or not they've been scored
// yet (a stage entry with no heat played, or a heat still in progress,
// simply has 0 correct / null elapsed — ranked last, never omitted, since an
// organiser checking standings mid-stage needs to see everyone who's
// entered, not just whoever's been scored so far).
export async function fetchStandingsForStage(stageId, client = getSupabase()) {
  const stage = await findStageById(stageId, client);
  const stageEntries = await listStageEntries(stageId, client);

  const { data: standingsRows, error } = await client
    .from('ct_standings')
    .select('*')
    .eq('stage_id', stageId);
  if (error) throw error;
  const standingsByEntryId = new Map(standingsRows.map((row) => [row.entry_id, row]));

  const roster = await listEntriesByIds(
    stageEntries.map((entry) => entry.entry_id),
    client,
  );
  const rosterByEntryId = new Map(roster.map((person) => [person.id, person]));

  const merged = stageEntries.map((stageEntry) => {
    const standing = standingsByEntryId.get(stageEntry.entry_id);
    const person = rosterByEntryId.get(stageEntry.entry_id);
    return {
      stageEntryId: stageEntry.id,
      entry_id: stageEntry.entry_id,
      displayName: person?.display_name ?? '(unknown cupper)',
      numCorrect: standing?.correct_count ?? 0,
      sets_scored: standing?.sets_scored ?? 0,
      total_elapsed_secs: standing?.total_elapsed_secs ?? null,
      // Pass-through, not derived — already written by commitStageResolution
      // once this stage is resolved (§5.2's advancement provenance). `null`
      // before that point, same as any other still-in-progress stage.
      finalPosition: stageEntry.final_position ?? null,
      source: stageEntry.source,
      positionNote: stageEntry.position_note ?? null,
    };
  });

  return { stage, ranked: rankStandingRows(merged) };
}

// Pure. `cutoff` is a plain number — the caller resolves `stage.cutoff ??
// 1` before calling, so this same function serves both a real cutoff stage
// and (per §7.3) the terminal/champion stage, and also a tiebreak heat's own
// outcome against however many slots remain (see fetchTiebreakHeatOutcome
// below) — three different callers, one rule, matching core/advancement's
// own design (handoff §6: nothing format-specific about "walk ranked groups
// until the cutoff is exceeded").
export function resolveAdvancement(ranked, cutoff) {
  return computeAdvancement(ranked, cutoff);
}

// DB. Creates the tiebreak heat for a stage's border tie — a thin wrapper
// over heats.js's generateTiebreakHeat, unwrapping core/advancement's
// `{ item, position }` envelope into the plain entry rows that function
// expects. Kept here rather than inlined at every call site so the screen
// doesn't need to know that unwrapping detail.
export async function createTiebreakHeatForTie(
  stageId,
  tiedAtBorder,
  { timingMode = 'app', random = Math.random } = {},
  client = getSupabase(),
) {
  const tiedEntries = tiedAtBorder.map(({ item }) => item);
  return generateTiebreakHeat(stageId, tiedEntries, { timingMode, random }, client);
}

// DB. Reads a CONFIRMED tiebreak heat's own results directly — never via
// `ct_standings`, which filters `kind = 'normal'` out specifically so a
// tiebreak's contribution never blends into the stage's primary tally (see
// that view's own migration comment). Ranked with the identical comparator
// `fetchStandingsForStage` uses, so the two are directly comparable.
//
// `stageRanked` is the stage-level ranking (`fetchStandingsForStage`'s own
// output) — a heat-entries row only ever carries `entry_id`, but every
// downstream consumer needs more: `stageEntryId` to target the right
// `ct_stage_entries` row when a result is eventually committed, and
// `displayName` since this outcome is rendered directly (the coin-toss
// picker lists these SAME rows, not the stage-level ones). Threading both
// through here, once, means no downstream consumer needs to know a tiebreak
// heat's rows came from a different source than the stage-level ones.
export async function fetchTiebreakHeatOutcome(heat, stageRanked, client = getSupabase()) {
  const heatEntries = await listHeatEntries(heat.id, client);
  const heatEntryIds = heatEntries.map((entry) => entry.id);
  const stageRowByEntryId = new Map(stageRanked.map(({ item }) => [item.entry_id, item]));

  const { data: results, error } =
    heatEntryIds.length === 0
      ? { data: [], error: null }
      : await client.from('ct_results').select('*').in('heat_entry_id', heatEntryIds);
  if (error) throw error;

  const correctCountByHeatEntryId = new Map();
  for (const result of results) {
    if (!result.correct) continue;
    correctCountByHeatEntryId.set(
      result.heat_entry_id,
      (correctCountByHeatEntryId.get(result.heat_entry_id) ?? 0) + 1,
    );
  }

  const rows = heatEntries.map((entry) => {
    const stageRow = stageRowByEntryId.get(entry.entry_id);
    return {
      entry_id: entry.entry_id,
      stageEntryId: stageRow?.stageEntryId,
      displayName: stageRow?.displayName ?? '(unknown cupper)',
      numCorrect: correctCountByHeatEntryId.get(entry.id) ?? 0,
      total_elapsed_secs: entry.elapsed_secs,
    };
  });

  return rankStandingRows(rows);
}

// Pure. Everyone in `ranked` who's neither in the resolved-tie group nor
// among the clean advancers already has a correct, final rank() position —
// no tiebreak or coin toss touches them. Used to build the "below the line"
// portion of a stage's final placements (handoff §5.2's `final_position`).
export function belowTheLine(ranked, advancing, tiedAtBorder) {
  const excluded = new Set([...advancing, ...tiedAtBorder].map(({ item }) => item.stageEntryId));
  return ranked.filter(({ item }) => !excluded.has(item.stageEntryId));
}

// DB. Commits a fully-resolved stage outcome in one pass:
//   - `advancingEntries`: [{ entryId, source }] — source is 'advanced'
//     (clean, no tie involved), 'tiebreak_won' (won the tiebreak heat
//     outright), or 'coin_toss' (won the coin toss after the tiebreak heat
//     ALSO drew). Written as new ct_stage_entries rows in the next stage.
//     Empty/ignored at the terminal stage — there is no next stage to enter.
//   - `championStageEntryId`: terminal stage only — the single winner's
//     CURRENT ct_stage_entries row gets final_position = 1 (this is a
//     position within THIS stage, not entry into a next one, since none
//     exists).
//   - `eliminated`: [{ stageEntryId, viaCoinToss }] — every member of the
//     resolved border-tie group who did NOT advance, all sharing
//     `finalPosition` (see below). `viaCoinToss` controls whether
//     `coinTossNote` is recorded on that row too (a coin toss is the one
//     case §5.2's schema comment gives an explicit note example for; a
//     cupper eliminated directly by the tiebreak heat's own scoring needs no
//     such note — the result speaks for itself).
//   - `finalPosition`: `effectiveCutoff + 1` — the correct competition-
//     ranking value for "everyone left over once the scarce slot(s) are
//     filled," per standard tie semantics (a resolved N-way tie for the last
//     spot, having yielded exactly one advancing entry, leaves the rest tied
//     for the position immediately after it — this generalizes to any group
//     size and needs no per-entry distinction, which matches this module's
//     deliberate scope: a tiebreak/coin-toss exists ONLY to allocate the
//     scarce slot(s), not to produce a full sub-ranking of who's eliminated).
//   - `belowCutoff`: [{ stageEntryId, position }] — entries never touched by
//     any tie, keeping their original rank() position as their final one.
//   - `coinTossNote`: string | null — recorded on every row touched by a
//     coin toss (both the winning and the losing side), never elsewhere.
export async function commitStageResolution(
  {
    stage,
    nextStage,
    advancingEntries,
    championStageEntryId,
    eliminated,
    finalPosition,
    belowCutoff,
    coinTossNote,
  },
  client = getSupabase(),
) {
  if (nextStage) {
    if (advancingEntries.length > 0) {
      const { error } = await client.from('ct_stage_entries').insert(
        advancingEntries.map(({ entryId, source }) => ({
          stage_id: nextStage.id,
          entry_id: entryId,
          source,
          position_note: source === 'coin_toss' ? coinTossNote : null,
        })),
      );
      if (error) throw error;
    }
  } else if (championStageEntryId) {
    const { error } = await client
      .from('ct_stage_entries')
      .update({
        final_position: 1,
        position_note: advancingEntries.some((entry) => entry.source === 'coin_toss')
          ? coinTossNote
          : null,
      })
      .eq('id', championStageEntryId);
    if (error) throw error;
  }

  for (const { stageEntryId, viaCoinToss } of eliminated) {
    const { error } = await client
      .from('ct_stage_entries')
      .update({
        final_position: finalPosition,
        position_note: viaCoinToss ? coinTossNote : null,
      })
      .eq('id', stageEntryId);
    if (error) throw error;
  }

  for (const { stageEntryId, position } of belowCutoff) {
    const { error } = await client
      .from('ct_stage_entries')
      .update({ final_position: position })
      .eq('id', stageEntryId);
    if (error) throw error;
  }

  const { error: stageError } = await client
    .from('ct_stages')
    .update({ status: 'complete' })
    .eq('id', stage.id);
  if (stageError) throw stageError;
}

// DB. The next stage to advance into, or `null` at the terminal stage
// (cutoff === null) — a thin, named wrapper over setup.js's
// findStageByOrdinal so the screen doesn't need to re-derive "next ordinal"
// or re-check "is this terminal" itself.
export async function findNextStage(stage, client = getSupabase()) {
  if (stage.cutoff == null) return null;
  return findStageByOrdinal(stage.event_id, stage.ordinal + 1, client);
}
