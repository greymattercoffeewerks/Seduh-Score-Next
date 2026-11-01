// Staging the archive snapshot (T-ARC.2), format-agnostic. The archive tick (database-owned, 24 hours after an event
// ends) publishes a podium only from a snapshot the organiser's own browser built and staged here; without a fresh one it
// publishes a named-only stub (spec section 3, option B). This file is the machinery only: a format hands in
// `buildPayload(intent)` and owns what the snapshot says (the reviewed code that already builds the public text), this
// file never decides who won.
//
// It rides the outbox like publishIntent.js, for the same reason: the snapshot is assembled from many reads, so the
// INTENT is enqueued first (a local write that cannot fail just because the device is offline) and the payload is built
// at FLUSH time, after any earlier queued write (the one that finished the event) has been applied.
//
// Idempotency: the intent carries an `operationId` made once at enqueue. The RPC (stage_archive_payload) records it in the
// project's operation ledger in the same transaction as the write, so a replay (a lost response, a second flush) stages
// once and answers 'duplicate'. `p_built_at` is the clock at the START of the reads: the database refuses an older snapshot
// over a newer one ('superseded'), so a replayed old operation cannot regress it. Benign answers (dark, test_event, closed,
// superseded, duplicate) are RETURNS, not errors: the operation simply completes.
import { buildRpcHandler, enqueueOperation, flushOutbox } from './outbox.js';
import { classifyReadFailure } from './publishIntent.js';

export const STAGE_ARCHIVE_OPERATION = 'stage_archive_payload';

// `buildPayload(intent)` returns the snapshot, or null when there is nothing to stage (the event is not finished, or has
// no podium): the operation then completes as a no-op. It may throw: classified like every publish-intent read.
export function archiveStagingHandler(client, buildPayload) {
  const rpc = buildRpcHandler(client, STAGE_ARCHIVE_OPERATION);
  return async (intent) => {
    const builtAt = new Date().toISOString();
    let payload;
    try {
      payload = await buildPayload(intent);
    } catch (error) {
      throw classifyReadFailure(error);
    }
    if (payload === null || payload === undefined) return;
    await rpc({
      p_operation_id: intent.operationId,
      p_org_id: intent.orgId,
      p_event_id: intent.eventId,
      p_payload: payload,
      p_built_at: builtAt,
    });
  };
}

// Persists the intent and nothing else. A test event is never staged (the archive refuses them): `isTest` must be passed
// explicitly, from the caller's already-loaded event, and `true` enqueues nothing. Returns whether an operation was queued.
export async function enqueueArchiveStaging({ orgId, eventId, isTest }) {
  if (typeof isTest !== 'boolean') {
    throw new TypeError(`${STAGE_ARCHIVE_OPERATION}: isTest must be explicitly true or false`);
  }
  if (isTest) return false;
  await enqueueOperation(STAGE_ARCHIVE_OPERATION, {
    orgId,
    eventId,
    operationId: crypto.randomUUID(),
  });
  return true;
}

// Enqueues FIRST, then attempts a flush with the caller's composed handler map.
export async function submitArchiveStaging(intent, handlers) {
  if (!(await enqueueArchiveStaging(intent))) return null;
  return flushOutbox(handlers);
}
