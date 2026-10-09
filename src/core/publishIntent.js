// Publishing a live session from an INTENT, format-agnostic (extracted from Cup Taster's liveSession.js on its
// second use, when BTC needed the identical machinery). A format's screens enqueue a small intent
// ({ orgId, eventId, format, isTest, ...whatever the format needs to rebuild its payload }) and the payload
// itself is built here, at actual FLUSH time, from fresh state, by the format's own `buildPayload(intent)`.
//
// Why not core/publish.js's publishSession(): its contract assumes the caller already HAS the payload before
// enqueueing. A live payload is assembled from many sequential reads, and awaiting those first meant an
// offline device never reached enqueueOperation(): the very first read threw, nothing was persisted, and the
// publish was silently dropped (found in review, offline-sync-auditor) — the one outcome the offline model
// exists to prevent. Enqueue first (a local IndexedDB write that cannot fail just because the device is
// offline), then let the flush do the reads and the RPC. A publish enqueued behind an un-flushed write waits
// its turn (flushOutbox's FIFO-halt-on-failure) and drains on main.js's existing reconnect flush.
//
// Ordering: `snapshotAt` is captured BEFORE the reads and sent as `p_snapshot_at`, publish_session's
// staleness key (migration 20260912090000), so a slow earlier publish committing after a fresher one is a
// no-op, never a regression of the audience payload. The START of the read is the conservative choice: when
// two publishes' reads overlap, the one triggered first is treated as older whichever chain finishes first.
// Wall-clock, not monotonic: two devices could race with clock drift, but the guard only decides WHICH real
// publish wins, never whether the result stays internally consistent.
import { buildRpcHandler, enqueueOperation, flushOutbox, isTransientErrorCode } from './outbox.js';
import { ROW_NOT_FOUND } from './errors.js';

// The READ chain before the RPC needs classifying (2026-09-27, found in review: offline-sync-auditor). Every
// read helper throws postgrest-js's own error object unclassified, and an error with no `.permanent` stays at
// the head of the FIFO queue, retried forever, with no manual discard, blocking every write behind it.
//
// - Network drop / timeout (code ''), a gateway body with no code, an expired JWT or a transient SQLSTATE:
//   retryable, stays queued.
// - Permission denied (42501): retryable. An authenticated organiser cannot hit it on these tables; it is what
//   an ANONYMOUS read gets once a failed token refresh drops the session. The RPC path keeps that same case
//   queued as a 401, but these read helpers throw away the status.
// - Anything else (a malformed id, or a plain Error from a bug while building the payload): permanent. A
//   publish is always rebuilt from fresh state, so the next one repairs whatever this one would have said.
//   postgrest-js never throws Error instances from these reads (plain objects carrying a `code`, '' for a
//   network drop), so an Error with no `code` at all is our own code, not the network. Checking for the
//   missing `code` keeps a future postgrest-js that returns real PostgrestError instances on the network path.
const INSUFFICIENT_PRIVILEGE = '42501';

function isTransientReadFailure(error) {
  // The code's VALUE, not the key's presence: a helper that re-wraps an error the way buildRpcHandler does
  // (`err.code = error.code`) can carry `code: undefined`, and must not be mistaken for a network failure.
  if (error instanceof Error && error.code == null) return false;
  const code = error?.code;
  if (typeof code !== 'string' || code === '') return true;
  return code === INSUFFICIENT_PRIVILEGE || isTransientErrorCode(code);
}

// `cause` keeps the original stack: the permanent branch exists mostly to catch a bug in our own payload
// building, which needs it to debug.
function classifyReadFailure(error) {
  const err = new Error(error?.message ?? String(error), { cause: error });
  err.code = error?.code;
  err.details = error?.details;
  err.permanent = !isTransientReadFailure(error);
  return err;
}

// The outbox handler for one intent type. `buildPayload(intent)` returns the payload, or null when there is
// nothing left to publish (the operation then completes as a no-op, not a "lost write"). It may throw: the
// error is classified as above. The RPC call itself goes through buildRpcHandler, so its error-to-permanent
// mapping (a network drop, a 401, a timeout/rate-limit/gateway 5xx or a transient SQLSTATE retry later; any
// other server answer is a genuine rejection) is the one every other tracked write uses. The operation id is
// fresh per attempt on purpose: a retry rebuilds from fresh state with a newer snapshot clock, so a replay is
// safe, and a stable id would make publish_session's operation ledger turn the retry into a silent no-op.
//
// A TEST event deleted while its publish was still queued (the realistic case: a rehearsal event removed on
// the organiser's device with its publish still waiting) has nothing left to publish: PGRST116 on an `isTest`
// intent completes as a no-op, not a "lost write" (2026-09-27, offline-sync-auditor). Only for `isTest`
// intents: delete_test_event is the only delete path and it refuses a real event, so PGRST116 on a real event
// means a different account or an RLS problem, permanent and reported, never skipped silently.
export function publishIntentHandler(client, buildPayload) {
  const rpc = buildRpcHandler(client, 'publish_session');
  return async (intent) => {
    const snapshotAt = new Date().toISOString();
    let payload;
    try {
      payload = await buildPayload(intent);
    } catch (error) {
      if (error?.code === ROW_NOT_FOUND && intent.isTest === true) return;
      throw classifyReadFailure(error);
    }
    if (payload === null) return;
    await rpc({
      p_operation_id: crypto.randomUUID(),
      p_org_id: intent.orgId,
      p_event_id: intent.eventId,
      p_format: intent.format,
      p_is_test: intent.isTest,
      p_payload: payload,
      p_snapshot_at: snapshotAt,
    });
  };
}

// Persists the intent and nothing else: a local IndexedDB write that cannot fail just because the device is
// offline. `isTest` is threaded straight through from the caller's already-loaded event (D9 propagation),
// never re-derived here, and is required: a missing key would silently enqueue `isTest: undefined`, defeating
// D9 at the one place a caller could get it wrong at no cost. A caller that must have the intent durable
// BEFORE a flush it does not control (a confirm, whose publish must queue behind it even if the screen is
// left) uses this directly.
export async function enqueuePublishIntent(type, intent) {
  if (typeof intent.isTest !== 'boolean') {
    throw new TypeError(`${type}: isTest must be explicitly true or false`);
  }
  await enqueueOperation(type, intent);
}

// Enqueues the intent FIRST, then attempts a flush; if the flush cannot complete now (offline, or a transient
// failure in the read chain) the operation stays queued like any other tracked write. `handlers` is the
// caller's composed outbox map (formats/*/outboxHandlers.js merged in main.js): a flush that lacks another
// format's handler stops at that format's queued operation.
export async function submitPublishIntent(type, intent, handlers) {
  await enqueuePublishIntent(type, intent);
  return flushOutbox(handlers);
}
