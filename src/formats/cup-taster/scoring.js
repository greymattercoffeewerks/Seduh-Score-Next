// Scoring surface (handoff §14 T4.5, §7.4). Storage is three-state
// (null/true/false), and null must never survive into a confirmed heat —
// the v4.x defect this rule replaces used `.some(t => t !== null)` as its
// confirm guard, unlocking Confirm the moment ONE set was scored per
// cupper and silently tallying every unentered set as a zero.
//
// Write model, decided with the user before writing code: unlike T4.3/T4.4's
// direct-write pattern (itself a documented, deferred gap — see
// ROADMAP.md), scoring taps are accumulated in local browser state and
// IndexedDB (never written to `ct_results` directly) until the organiser
// confirms the heat, at which point the whole heat's entries + results are
// submitted as ONE atomic operation via the existing `confirm_heat` RPC
// (migration 20260822100000) through the outbox — the exact use case that
// RPC and the outbox's own module comment ("confirming a heat is queued as
// ONE operation calling ONE RPC") were built for, but never wired up until
// now. This matches handoff §9's explicit framing: a client-side sequence
// of separate row-writes for entries then results is the "half-scored
// heat" failure mode the whole architecture exists to prevent.
import { cacheGet, cacheSet } from '../../core/db.js';
import { buildRpcHandler, enqueueOperation, flushOutbox } from '../../core/outbox.js';
import { getSupabase } from '../../core/supabaseClient.js';

// Cycles unscored -> correct -> wrong -> unscored, so a mis-tap is always
// recoverable within three taps (§7.4).
export function toggleScore(current) {
  if (current == null) return true;
  if (current === true) return false;
  return null;
}

// {correct, total} for one cupper — `total` is the stage's full set count,
// not just however many have been scored so far, so the tally reads as
// visible progress toward completion rather than resetting its denominator
// as taps happen.
export function computeTally(resultsForEntry, setIds) {
  const correct = setIds.filter((setId) => resultsForEntry?.[setId] === true).length;
  return { correct, total: setIds.length };
}

export function isEntryComplete(resultsForEntry, setIds) {
  return setIds.every((setId) => resultsForEntry?.[setId] != null);
}

// Mirrors confirm_heat's own server-side strict-confirm check (migration
// 20260822100000, lines 156-171) so the Confirm button can be disabled
// client-side before ever attempting the RPC — defense in depth, not a
// replacement for the server-side check, which stays authoritative.
export function isHeatComplete(entryIds, draftResults, setIds) {
  return (
    entryIds.length > 0 &&
    entryIds.every((entryId) => isEntryComplete(draftResults[entryId], setIds))
  );
}

// Per-cupper only (decided with the user) — a heat-wide bulk action was
// considered and declined, since cuppers can genuinely finish being judged
// at different points within the same heat's scoring pass. Only touches
// still-null cells; an already-scored ✓ or ✗ is never overwritten, matching
// the toggle's own "never silently changes a real answer" discipline.
export function markCupperRemainingWrong(resultsForEntry, setIds) {
  const next = { ...resultsForEntry };
  for (const setId of setIds) {
    if (next[setId] == null) next[setId] = false;
  }
  return next;
}

function draftKey(heatId) {
  return `ct-scoring-draft:${heatId}`;
}

// `{}` (never null) so a fresh read composes directly with the toggle
// functions above without every call site needing its own `?? {}` guard.
export async function loadDraft(heatId) {
  const draft = await cacheGet(draftKey(heatId));
  return draft ?? {};
}

// Called after every toggle/mark-wrong action (decided with the user) —
// in-progress scoring survives a reload, not just an in-memory session.
// `core/db.js` is the sole IndexedDB chokepoint; this never touches
// `indexedDB` directly.
export async function saveDraft(heatId, draftResults) {
  await cacheSet(draftKey(heatId), draftResults);
}

// A confirmed heat's draft has nothing left to recover — clearing it (set
// to a fresh `{}` rather than deleting the key, since core/db.js's cache
// store exposes get/set only) keeps a stale, already-submitted draft from
// ever resurfacing if this heat is somehow revisited.
export async function clearDraft(heatId) {
  await cacheSet(draftKey(heatId), {});
}

// Once a heat is confirmed, the local draft is gone (clearDraft, above) —
// the read-only confirmed view has to come from the real, persisted
// `ct_results` rows instead, in the SAME {entryId: {setId: correct}} shape
// the draft uses, so renderScoringRows can render either one without
// caring which it was given. `ct_results.heat_entry_id` references
// `ct_heat_entries.id`, not `entry_id` directly, so this maps back through
// the already-loaded heat entries rather than needing a second join query.
export async function loadConfirmedResults(heatEntries, client = getSupabase()) {
  if (heatEntries.length === 0) return {};
  const heatEntryIds = heatEntries.map((entry) => entry.id);
  const { data, error } = await client
    .from('ct_results')
    .select('*')
    .in('heat_entry_id', heatEntryIds);
  if (error) throw error;

  const entryIdByHeatEntryId = new Map(heatEntries.map((entry) => [entry.id, entry.entry_id]));
  const results = {};
  for (const row of data) {
    const entryId = entryIdByHeatEntryId.get(row.heat_entry_id);
    if (!results[entryId]) results[entryId] = {};
    results[entryId][row.set_id] = row.correct;
  }
  return results;
}

// The one place a confirm_heat p_entries payload is built, so it's always
// shaped exactly how the RPC expects (migration 20260822100000, lines
// 87-91). `elapsed_secs`/`elapsed_secs_raw`/`maxed`/`time_source` are
// passed through unchanged from each hydrated entry — T4.3/T4.4 already
// wrote the authoritative values via clampElapsed() well before scoring
// ever starts (a heat can't reach 'scoring' status with any entry still
// missing a time), so this never re-derives or re-clamps them; it only
// adds the newly-scored `results` array per entry.
//
// Still-unscored sets are OMITTED from `results`, never sent as an
// explicit `correct: null` — this matters even though isHeatComplete
// already gates the Confirm button client-side (defense in depth, not the
// only guard). `ct_results.correct` is `not null` in the schema, and
// confirm_heat's insert loop runs BEFORE its own strict-confirm row-count
// check — so a null `correct` value would trip a raw NOT NULL constraint
// violation first, never reaching the friendly "N cupper(s) do not have
// every set scored" error the RPC's comment (and this module's own header)
// says enforces §7.4. Omitting unscored sets instead means an incomplete
// payload is simply short on `ct_results` rows per cupper, which the
// RPC's row-count check catches exactly as documented — so if the client
// gate is ever bypassed, the server still fails the way the whole design
// says it should, with a message a caller can actually show someone.
export function buildConfirmEntries(hydratedEntries, draftResults, setIds) {
  return hydratedEntries.map((entry) => ({
    entry_id: entry.entry_id,
    // Pass-through of a value clampElapsed() already produced (via
    // timing.js/timingManual.js at write time), not a new derivation — the
    // rule can't statically tell a safe forward from an unsafe one, so
    // it's silenced narrowly on just this one property, not the whole file.
    // eslint-disable-next-line seduh-next/no-raw-elapsed-write
    elapsed_secs: entry.elapsed_secs,
    elapsed_secs_raw: entry.elapsed_secs_raw,
    maxed: entry.maxed,
    time_source: entry.time_source,
    results: setIds
      .map((setId) => ({ set_id: setId, correct: draftResults[entry.entry_id]?.[setId] ?? null }))
      .filter((result) => result.correct !== null),
  }));
}

// Enqueues + immediately attempts a flush — the outbox persists the
// operation before any network call, so this survives a crash/reload the
// instant it resolves (§9: "writes render immediately, marked pending
// until acknowledged"), and the flush attempt gives the common case
// (successful confirm on a good connection) an immediate result rather
// than requiring a separate, later sync pass. Returns the flush result
// as-is; the caller decides what "still pending"/"stopped" means for its
// own UI rather than this function guessing on its behalf — the flush may
// process an unrelated, earlier-queued operation instead of (or before)
// this one, per the outbox's own strict FIFO ordering guarantee.
// Mirrors timing.js's own timingHandlers(client) shape — the export a
// screen composes into formats/cup-taster/outboxHandlers.js's
// cupTasterOutboxHandlers(client) so a flush triggered from anywhere can
// also process a queued confirm_heat, not just this module's own callers.
export function confirmHandlers(client) {
  return { confirm_heat: buildRpcHandler(client, 'confirm_heat') };
}

// `handlers`, when passed, REPLACES confirmHandlers(client) — same optional
// cross-module-composition override timing.js's submitTimingOperation
// takes; see its comment. Omitting it keeps this function's original,
// narrower behavior (used by this file's own tests).
export async function submitConfirmHeat(
  heatId,
  orgId,
  expectedUpdatedAt,
  entries,
  client = getSupabase(),
  handlers,
) {
  const payload = {
    p_operation_id: crypto.randomUUID(),
    p_org_id: orgId,
    p_heat_id: heatId,
    p_expected_updated_at: expectedUpdatedAt,
    p_entries: entries,
  };
  await enqueueOperation('confirm_heat', payload);
  return flushOutbox(handlers ?? confirmHandlers(client));
}

// confirm_heat's optimistic-concurrency conflict (migration 20260822100000,
// lines 123-131) carries both versions in the exception DETAIL specifically
// so a caller doesn't have to say just "something went wrong" — this is the
// one Cup-Taster-specific error shape core/errors.js's generic
// describeError() has no way to know about. Returns null (not a generic
// fallback string) for anything else, so callers can try this first and
// fall through to describeError() for the rest, rather than this function
// swallowing errors describeError() would have described better.
export function describeConfirmError(err) {
  if (err?.code !== 'P0002') return null;
  try {
    const detail = JSON.parse(err.details ?? err.detail ?? '{}');
    if (detail?.current_updated_at) {
      return `This heat was changed elsewhere after you started scoring it (at ${detail.current_updated_at}) — reload the heat and re-check its scores before confirming again.`;
    }
  } catch {
    // Malformed/missing DETAIL — fall through to the generic conflict
    // message below rather than letting a JSON.parse failure mask the
    // real conflict as an unrelated crash.
  }
  return 'This heat was changed elsewhere after you started scoring it — reload the heat and re-check its scores before confirming again.';
}
