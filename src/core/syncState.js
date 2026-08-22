// The three-state sync panel's state derivation (handoff §8.4, §14 T3.3):
// off / live / not synced. "Fail-open never lies about a write that failed" —
// this function is written to be impossible to accidentally return "live"
// from: it starts from "not synced" as the default whenever anything is
// uncertain (a pending operation, a flush error) and only reaches "live"
// once every condition that could mean "not actually caught up" is ruled
// out, never the reverse (there is no code path that clears an error or a
// pending count to force "live").
//
// `enabled` is caller-supplied — sync only means something once there's an
// active context to sync (e.g. a running event); before that, the panel has
// nothing to report, which is "off," not "live" (there is nothing to be
// live about) and not "not synced" (nothing has failed). But `enabled` is
// checked LAST, after the outbox's own real state — a caller passing
// `enabled: false` must never be able to hide a genuinely pending or failed
// operation behind "off," which reads as an unalarming, expected state and
// would be exactly the kind of lie "fail-open" exists to prevent. The
// outbox doesn't stop holding unflushed work just because some other part
// of the app decided sync context is currently off.
//
// `operations` is the outbox's own pending queue (listPendingOperations()'s
// shape — id/type/payload/attempts/lastError). `stuckOperation` surfaces the
// first operation with attempts > 0 — a poison operation (repeatedly
// failing) needs to reach a human, not just accumulate silently in
// IndexedDB (the gap offline-sync-auditor flagged during T3.2's review).
export function computeSyncState({ enabled, operations, lastFlushError = null }) {
  const ops = Array.isArray(operations) ? operations : [];
  const pendingCount = ops.length;

  if (pendingCount > 0 || lastFlushError != null) {
    const stuckOperation = ops.find((op) => op?.attempts > 0) ?? null;
    return { status: 'not synced', pendingCount, stuckOperation, lastFlushError };
  }

  if (!enabled) {
    return { status: 'off', pendingCount: 0, stuckOperation: null, lastFlushError: null };
  }

  return { status: 'live', pendingCount: 0, stuckOperation: null, lastFlushError: null };
}
