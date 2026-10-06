// Correcting a stopped heat time, until the heat is confirmed (live-event
// finding #1, 2026-10-04). A tablet timekeeper missed the beat on Stop, the
// manual timekeeper's time differed, and nothing could change the recorded
// one. `record_heat_time` cannot be loosened to allow it — its 'reject' policy
// refuses any second write and its 'overwrite' policy is scoped to a prior
// MANUAL entry on purpose (migration 20260904120000: an offline tap and a
// manual guess must never silently clobber each other) — so a correction is
// its own RPC, `correct_heat_time` (migration 20261006100000), with its own
// rules, all enforced server-side:
//   - only while the heat is 'timing' or 'scoring' (a confirmed heat is locked);
//   - compare-and-set on the time the screen showed, so a stale or offline-
//     queued correction can't overwrite what is there now;
//   - a required reason, kept on the row and in the append-only change log;
//   - the heat's updated_at moves, so a confirm_heat built from a screen
//     loaded before the correction conflicts rather than restoring the old time.
//
// `elapsed_secs` still has exactly one writer: the clamped value comes from
// `buildClampedUpdate` (timing.js → `clampElapsed`), same as a tap or a manual
// entry; the RPC just stores it. Through the outbox like every other timing
// write (the payload is captured at the moment of the action, never re-derived
// at flush time). No DOM here — `timeCorrectionEditor.js` is the UI.
import {
  droppedErrorFor,
  enqueueOperation,
  flushOutbox,
  listPendingOperations,
} from '../../core/outbox.js';
import { buildClampedUpdate, timingHandlers } from './timing.js';
import { formatDuration } from '../../core/duration.js';
import { describeError } from '../../core/errors.js';
import { getSupabase } from '../../core/supabaseClient.js';

// Mirrors the RPC's own limit.
export const REASON_MAX_LENGTH = 120;

// Nothing a stopwatch records is longer than a day. Without a bound a mistyped
// minutes field reaches the database as an integer-overflow error, which the outbox
// drops as permanent and the screen can only describe as "something went wrong".
export const MAX_RAW_SECS = 24 * 60 * 60;

// A problem with what the person typed (no reason, a time that is already the
// recorded one) — as opposed to a failure of the write. The editor shows it
// next to the field, locally, and never re-renders the screen for it: a render
// would close the editor and throw away the reason they had just chosen.
export class CorrectionInputError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'CorrectionInputError';
    // Which part of the form to point at: 'time' or 'reason'.
    this.field = field;
  }
}

// Quick-pick reasons for the editor's chips. Free text ("Other") is allowed
// too; these exist so the common cases take one tap, not typing, mid-event.
export const CORRECTION_REASONS = ['Missed the stop', "Manual timekeeper's time", 'Wrong cupper'];

// Trims and validates a reason; returns the trimmed text, or throws a
// CorrectionInputError whose message is fit to show to the person who typed it.
export function validateReason(raw) {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason === '')
    throw new CorrectionInputError('Choose or type a reason for the change.', 'reason');
  if (reason.length > REASON_MAX_LENGTH) {
    throw new CorrectionInputError(
      `Keep the reason to ${REASON_MAX_LENGTH} characters or fewer.`,
      'reason',
    );
  }
  return reason;
}

// `heat` and `heatEntry` are the caller's own already-loaded, already-rendered
// state — same discipline as recordTap/recordManualTime: enqueueing needs no
// network read. `heatEntry.elapsed_secs` is exactly the value the person saw,
// and goes to the RPC as the compare-and-set expectation.
//
// Returns `expectedElapsedSecs` (the clamped value this call attempted to
// write), its `operationId`, and the flush result, for the caller's ground-
// truth check against a fresh reload (see resolveCorrection below).
export async function correctHeatTime(
  heat,
  heatEntry,
  rawSecs,
  reason,
  orgId,
  client = getSupabase(),
  { now = () => Date.now(), handlers } = {},
) {
  // First, so an absurd figure (up to and including Infinity, from a runaway minutes
  // field) is the person's input error, not a programming error with a technical message.
  if (rawSecs > MAX_RAW_SECS) {
    throw new CorrectionInputError('That is longer than a day — check the minutes.', 'time');
  }
  if (!Number.isInteger(rawSecs) || rawSecs < 0) {
    throw new Error(
      `correctHeatTime: elapsed seconds must be a non-negative whole number, got ${rawSecs}`,
    );
  }
  if (heatEntry.elapsed_secs == null) {
    throw new Error('correctHeatTime: this cupper has no recorded time to correct.');
  }
  const cleanReason = validateReason(reason);

  const update = buildClampedUpdate(rawSecs, heat.duration_secs, 'manual', now());
  if (update.elapsed_secs === heatEntry.elapsed_secs) {
    throw new CorrectionInputError(
      `That is already the recorded time (${formatDuration(update.elapsed_secs)}).`,
      'time',
    );
  }

  const { id: operationId } = await enqueueOperation('correct_heat_time', {
    p_operation_id: crypto.randomUUID(),
    p_org_id: orgId,
    p_heat_entry_id: heatEntry.id,
    p_expected_elapsed_secs: heatEntry.elapsed_secs,
    p_elapsed_secs: update.elapsed_secs,
    p_elapsed_secs_raw: update.elapsed_secs_raw,
    p_maxed: update.maxed,
    p_reason: cleanReason,
    p_time_edited_at: update.time_edited_at,
  });
  // The operation is already persisted. If the flush itself rejects (IndexedDB hiccup,
  // a lock failure) that is still "saved, not yet sent" — report it as a stopped flush,
  // not a thrown error the screen would turn into "try again" and a duplicate.
  let flushResult;
  try {
    flushResult = await flushOutbox(handlers ?? timingHandlers(client));
  } catch (error) {
    flushResult = { processed: 0, stopped: true, error, permanentFailure: false };
  }
  return { expectedElapsedSecs: update.elapsed_secs, operationId, flushResult };
}

// What every screen's "Edit time" save does, in one place: queue the correction
// and flush, and say which of three things happened without making the screen
// interpret exceptions.
//   { inputError }  — the person's input was unusable (CorrectionInputError); nothing
//                     was queued. Show it in the editor; do NOT re-render.
//   { error }       — anything else threw before the correction was queued (nothing is
//                     queued; a flush that fails afterwards is reported in `check`).
//   { check }       — queued and flushed (or still queued). The screen keeps `check`
//                     for resolveCorrection() after its next render, or shows the
//                     queued message when isStillQueued(check).
export async function attemptCorrection(heat, heatEntry, rawSecs, reason, orgId, client, options) {
  try {
    const { expectedElapsedSecs, operationId, flushResult } = await correctHeatTime(
      heat,
      heatEntry,
      rawSecs,
      reason,
      orgId,
      client,
      options,
    );
    return {
      check: {
        heatEntryId: heatEntry.id,
        displayName: heatEntry.displayName,
        expectedElapsedSecs,
        operationId,
        flushResult,
      },
    };
  } catch (err) {
    if (err instanceof CorrectionInputError) return { inputError: err };
    return { error: err };
  }
}

// True when the correction is still in the outbox — saved on this device, not yet
// applied. Asked of the outbox itself, not inferred from the flush result: that can
// say "stopped" for a write that did land (a LATER operation was what failed) and
// "fine" for one that is still queued (a flush already in flight finished first).
// The screen must not reload while this is true — the reload needs the same
// connection — and must say the change is queued, not "try again": a second
// correction would queue behind this one and, built from the same old time, be
// refused.
export async function isStillQueued(check) {
  try {
    return (await listPendingOperations()).some((operation) => operation.id === check.operationId);
  } catch {
    // Can't read the outbox: fall back to the flush result's own account.
    console.warn('timeCorrection: could not read the outbox to see whether a correction is queued');
    return (
      check.flushResult?.stopped === true && !droppedErrorFor(check.flushResult, check.operationId)
    );
  }
}

// What is still waiting in the outbox, read at every render so the screen shows it
// whatever it rebuilt from: the entries with a queued correction (their rows come back
// as "Waiting to sync" — server state still holds the old time; heat-entry ids are
// unique, so this is not scoped to one heat) and whether a confirm for THIS heat is
// queued (a correction queued behind a confirm would be refused once the confirm lands,
// after promising to sync — so Edit is withheld).
// Never throws: an unreadable outbox must not stop a screen from rendering.
export async function loadPendingWork(heatId) {
  const work = { queuedEntryIds: new Set(), confirmQueued: false };
  try {
    for (const operation of await listPendingOperations()) {
      if (operation.type === 'correct_heat_time') {
        work.queuedEntryIds.add(operation.payload?.p_heat_entry_id);
      } else if (operation.type === 'confirm_heat' && operation.payload?.p_heat_id === heatId) {
        work.confirmQueued = true;
      }
    }
  } catch {
    // Treated as nothing pending: the server-side compare-and-set still guards every
    // correction, so this fails safe — it just may offer Edit on a queued row.
    console.warn('timeCorrection: could not read the outbox for pending work');
  }
  return work;
}

export function describeQueuedCorrection(displayName) {
  return `${displayName ?? 'Cupper'}'s correction is saved on this device and will sync when the connection is back. The time shown stays the old one until then, so don't edit it again.`;
}

// The RPC's two conflicts, told apart by the detail it attaches (the message
// is only a fallback). Returns null for anything else so a caller can try this
// first and fall through to describeError(), same convention as
// describeTimingConflict/describeConfirmError.
export function describeCorrectionError(err) {
  if (err?.code !== 'P0002') return null;
  let detail = null;
  try {
    detail = JSON.parse(err.details ?? err.detail ?? 'null');
  } catch {
    // Malformed/missing DETAIL — fall through to the message check below.
  }
  const status = detail?.current_status;
  if (status === 'confirmed' || (!status && err.message?.includes(' is confirmed,'))) {
    return 'This heat has already been confirmed, so its times are locked.';
  }
  if (!status && Number.isInteger(detail?.current_elapsed_secs)) {
    return `This cupper's time was changed elsewhere — it is now ${formatDuration(detail.current_elapsed_secs)}. Refresh this page, then edit it again if it is still wrong.`;
  }
  return 'This heat has moved on since this screen loaded — refresh this page before trying again.';
}

// Ground truth over the outbox flush's own bookkeeping — the shape every
// timing/scoring screen here uses: compare a freshly reloaded entry against
// the exact value this call attempted to write, and only fall back to this
// operation's OWN dropped error (droppedErrorFor) to explain a miss, never
// `flushResult.error`, which can belong to any queued operation. A manual
// time of the expected value is the signature of a correction that landed (a
// correction to the value already recorded is refused before it is queued).
//
// `check` is what a screen kept from correctHeatTime plus the entry's name;
// `hydratedEntries` is the render's own freshly loaded list. Returns
// `{ tone, message }` for the screen's feedback region.
export function resolveCorrection(check, hydratedEntries) {
  const { heatEntryId, displayName, expectedElapsedSecs, operationId, flushResult } = check;
  const fresh = hydratedEntries.find((entry) => entry.id === heatEntryId);
  const name = displayName ?? 'Cupper';
  if (fresh?.elapsed_secs === expectedElapsedSecs && fresh.time_source === 'manual') {
    return {
      tone: 'success',
      // A time at or past the heat's duration is recorded as the max (D22) — say
      // so, since the typed figure is not what is stored.
      message: `${name}'s time corrected to ${formatDuration(expectedElapsedSecs)}.${
        fresh.maxed
          ? " That is the heat's maximum time — anything longer is recorded as the max."
          : ''
      }`,
      // The roster id the editors are keyed by, so a screen can leave this
      // row's finished draft out of the ones it restores.
      entryId: fresh.entry_id,
    };
  }
  const ownDropError = droppedErrorFor(flushResult, operationId);
  if (ownDropError) {
    return {
      tone: 'error',
      message: describeCorrectionError(ownDropError) ?? describeError(ownDropError),
    };
  }
  return {
    tone: 'error',
    // Reached only when the correction is NOT in the outbox, was not refused by its own
    // flush, and the reload does not show it — it may have landed and been changed since,
    // or been dropped by another tab's flush. Don't promise a sync that may not be coming.
    message: `Couldn't confirm ${name}'s correction — reload the page and check the time.`,
  };
}
