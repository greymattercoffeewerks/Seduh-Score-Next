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
import { buildRpcHandler, enqueueOperation, flushOutbox } from '../../core/outbox.js';

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
// Compared by nullness first, not by subtracting `?? Infinity` sentinels —
// found by scoring-auditor (2026-09-06, reviewing the ct_standings fan-out
// fix): `Infinity - Infinity` is `NaN`, so two-or-more untimed rows tied on
// `numCorrect` (every stage entry before its heat has run, the everyday
// "organiser opens Standings before scoring starts" case, not an edge case)
// previously got sequential positions instead of sharing one — chainComparators
// treats a non-zero (NaN included) result as "not a tie", and rank()'s
// adjacent-pair check inherits that. core/ranking.js itself is unaffected —
// it faithfully passes through whatever a comparator returns; the defect was
// entirely this comparator's own null-handling.
function byFastestTime(a, b) {
  const aTime = a.total_elapsed_secs;
  const bTime = b.total_elapsed_secs;
  if (aTime == null && bTime == null) return 0;
  if (aTime == null) return 1;
  if (bTime == null) return -1;
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

// The one place a resolve_stage payload is built, so the RPC's own shape
// (migration 20260906060000) stays in exactly one place rather than being
// re-derived at every caller — same discipline as scoring.js's
// buildConfirmEntries/timing.js's buildRecordHeatTimePayload. `plan` is
// exactly the object buildCommitPlan (standingsScreen.js) already produced —
// this function's only job is reshaping it into the RPC's own snake_case
// param names, never re-deriving any of the advancement decisions
// themselves (those stay a pure, independently-testable concern of
// buildCommitPlan/resolveAdvancement/belowTheLine, not this DB-facing layer).
export function buildResolveStagePayload(
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
  orgId,
) {
  return {
    p_operation_id: crypto.randomUUID(),
    p_org_id: orgId,
    p_stage_id: stage.id,
    p_next_stage_id: nextStage?.id ?? null,
    p_advancing_entries: advancingEntries.map(({ entryId, source }) => ({
      entry_id: entryId,
      source,
    })),
    p_champion_stage_entry_id: championStageEntryId ?? null,
    p_eliminated: eliminated.map(({ stageEntryId, viaCoinToss }) => ({
      stage_entry_id: stageEntryId,
      via_coin_toss: viaCoinToss,
    })),
    p_final_position: finalPosition,
    p_below_cutoff: belowCutoff.map(({ stageEntryId, position }) => ({
      stage_entry_id: stageEntryId,
      position,
    })),
    p_coin_toss_note: coinTossNote ?? null,
  };
}

// Mirrors scoring.js's confirmHandlers/timing.js's timingHandlers exactly —
// the export a screen composes into outboxHandlers.js's
// cupTasterOutboxHandlers(client) so a flush triggered from anywhere can
// also process a queued resolve_stage, not just this module's own callers.
export function resolveStageHandlers(client) {
  return { resolve_stage: buildRpcHandler(client, 'resolve_stage') };
}

// DB. Commits a fully-resolved stage outcome atomically, via the
// resolve_stage RPC (migration 20260906060000), enqueued and flushed through
// the outbox exactly like every other write in this app (confirm_heat,
// start_heat/record_heat_time/auto_max_heat, publish_session) — see that
// migration's own header comment for why: this used to be a sequence of
// independent network round trips (an unguarded insert, two loops of
// per-row updates, a final stage-status update) with no transaction and no
// idempotency key, so a connection drop mid-sequence could leave a stage
// half-resolved and a retry wasn't safe. Net effect is unchanged — same
// advancing-entries insert, same eliminated/below-cutoff final_position
// writes, same terminal-stage champion branch, same coin-toss note
// placement — only *how* it's written changed (one atomic, idempotent RPC
// call instead of a client-side sequence).
//
// Returns the flushOutbox() result as-is, same as submitConfirmHeat/
// submitTimingOperation — the caller (standingsScreen.js's commit()) decides
// what "still pending"/"stopped" means for its own UI by re-reading the
// stage's own status afterward (the "ground truth over flush bookkeeping"
// principle scoringScreen.js/timingScreen.js already established), rather
// than trusting the flush's own bookkeeping directly: the outbox is a single
// shared queue, so a flush result can reflect an unrelated, earlier-queued
// operation rather than this specific resolve_stage attempt.
//
// `handlers`, when passed, REPLACES resolveStageHandlers(client) entirely —
// same optional cross-module-composition override every other outbox-backed
// write function in this app takes (see scoring.js's submitConfirmHeat,
// timing.js's submitTimingOperation). Omitting it keeps this function's
// original, narrower behavior — used by this file's own tests.
export async function commitStageResolution(plan, orgId, client = getSupabase(), handlers) {
  const payload = buildResolveStagePayload(plan, orgId);
  await enqueueOperation('resolve_stage', payload);
  return flushOutbox(handlers ?? resolveStageHandlers(client));
}

// DB. The next stage to advance into, or `null` at the terminal stage
// (cutoff === null) — a thin, named wrapper over setup.js's
// findStageByOrdinal so the screen doesn't need to re-derive "next ordinal"
// or re-check "is this terminal" itself.
export async function findNextStage(stage, client = getSupabase()) {
  if (stage.cutoff == null) return null;
  return findStageByOrdinal(stage.event_id, stage.ordinal + 1, client);
}
