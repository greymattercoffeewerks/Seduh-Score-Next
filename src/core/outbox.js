// The operation outbox (handoff §9, §14 T3.2). "Outbox holds operations, not
// rows" — confirming a heat is queued as ONE operation calling ONE RPC
// (confirm_heat, migration 20260822100000), never as separate row-writes that
// could land partially.
//
// Deliberately format-agnostic: this module has no knowledge of what
// operation types exist or how to execute them. `flushOutbox()` takes a
// `handlers` map as a parameter rather than hard-coding one — a hard-coded
// map keyed on Cup Taster operations (e.g. `confirm_heat`) would be
// `src/core/` reaching into format-specific concerns, exactly what §6's
// boundary forbids. A format module owns its own handler map and passes it
// in; this file owns strictly: persist operations in order, replay them in
// that same order, and never let a later operation run ahead of an earlier
// one that hasn't succeeded yet.
//
// Idempotency is NOT this file's job — it's a property of whatever each
// handler calls (confirm_heat's own `processed_operations` ledger, for
// example). This file's job is queue mechanics only: the "queue ordering" and
// "operation atomicity" concerns are what it owns; a specific RPC's own
// atomicity is proven where that RPC lives.
import { outboxListAll, outboxPut, outboxRemove } from './db.js';

// Monotonically increasing, never bare Date.now() — two operations enqueued
// within the same millisecond would otherwise tie on createdAt, and
// IndexedDB's index-cursor order for tied keys falls back to primary-key
// (a random UUID) order, not insertion order. `Math.max(counter + 1,
// Date.now())` keeps values strictly increasing within one page session AND
// still comparable across a reload.
let sequenceCounter = 0;
function nextSequence() {
  sequenceCounter = Math.max(sequenceCounter + 1, Date.now());
  return sequenceCounter;
}

// Queues an operation and persists it immediately — the write this function
// returns from has already survived a page reload/crash the instant it
// resolves, before any network attempt is even made (§9: "writes render
// immediately, marked pending until acknowledged").
export async function enqueueOperation(type, payload) {
  const operation = {
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: nextSequence(),
    attempts: 0,
    lastError: null,
  };
  await outboxPut(operation);
  return operation;
}

export async function countPendingOperations() {
  return (await outboxListAll()).length;
}

export async function listPendingOperations() {
  return outboxListAll();
}

// Reentrancy guard — a flush already in progress must not run a second,
// overlapping pass over the same queue. Concurrent callers share the same
// in-flight promise and see its real outcome; the flush re-lists the queue
// after each pass so anything enqueued mid-flush gets picked up in that same
// call rather than requiring a separate flushOutbox() invocation.
let inFlightFlush = null;

// Replays every queued operation, strictly in FIFO (createdAt) order,
// stopping at the first operation that fails for a genuine reason — a
// dependent operation queued after one that hasn't succeeded yet must never
// run ahead of it (§9's "operations, not rows" guarantee extended to the
// queue's own replay order).
//
// `handlers` maps an operation `type` to `(payload) => Promise<void>`.
export function flushOutbox(handlers) {
  if (inFlightFlush) return inFlightFlush;
  inFlightFlush = runFlush(handlers).finally(() => {
    inFlightFlush = null;
  });
  return inFlightFlush;
}

async function runFlush(handlers) {
  let processed = 0;
  for (;;) {
    const operations = await outboxListAll();
    if (operations.length === 0) return { processed, stopped: false };

    for (const operation of operations) {
      try {
        const handler = handlers[operation.type];
        if (!handler) {
          throw new Error(`outbox: no handler registered for operation type "${operation.type}"`);
        }
        await handler(operation.payload);
        // If outboxRemove itself throws here (IndexedDB quota/contention),
        // the catch below persists it as attempts+1 like any other failure —
        // the handler already ran, so a retry re-invokes it. Safe only
        // because idempotency is each handler's job (see module comment
        // above), not this file's.
        await outboxRemove(operation.id);
        processed += 1;
      } catch (error) {
        // A missing handler is a failure like any other — it must go through
        // the same attempts/lastError persistence as a handler throwing, or
        // it can never surface as a stuck/poison operation (T3.3's
        // computeSyncState() identifies one by attempts > 0; a missing
        // handler that never increments attempts would silently and
        // permanently block the queue with no diagnostic reaching a human).
        await outboxPut({
          ...operation,
          attempts: operation.attempts + 1,
          lastError: error.message,
        });
        return { processed, stopped: true, error };
      }
    }
    // Loop again: operations enqueued while this pass was running should be
    // picked up by this same call, not left for a separate invocation.
  }
}
