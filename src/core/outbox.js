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

// Wraps a Supabase RPC call as a `flushOutbox` handler for one operation
// `type`. Every RPC this project routes through the outbox (confirm_heat,
// publish_session, start_heat/record_heat_time/auto_max_heat) rejects a
// stale/conflicting payload the exact same way: retrying the identical
// payload against the RPC's own idempotency/conflict check fails the exact
// same way forever — permanent. Extracted here — not `formats/cup-taster/` —
// because it's pure RPC-wrapping mechanics with zero knowledge of any
// operation type's name or payload shape; three call sites
// (timing.js/scoring.js/publish.js) had each hand-rolled this identical
// ~10-line block before this extraction.
//
// `status` (not just `error`) is what actually distinguishes a genuine
// server-side rejection from a network-level failure — found running a
// real offline E2E test against a real local Supabase stack (Phase 6
// offline soak): this function's own ORIGINAL assumption was that a
// network-level failure means `client.rpc()` itself REJECTS, never
// reaching this branch at all. That's false — supabase-js/postgrest-js
// catch a raw fetch failure (a real "TypeError: Failed to fetch" under an
// actual dropped connection) and RESOLVE with an `error` object anyway,
// with `status: 0` (no real HTTP response was ever received) as the one
// signal telling it apart from a genuine server rejection (always a real,
// non-zero HTTP status — confirmed 404 for a real Postgrest rejection in
// the same test). Marking every `error` permanent regardless of `status`
// was a real, live bug: an ordinary wifi drop mid-write got silently and
// PERMANENTLY discarded from the queue instead of staying there to retry
// once the connection came back — the exact data-loss scenario the whole
// offline-first design exists to prevent.
export function buildRpcHandler(client, type) {
  return async (payload) => {
    const { error, status } = await client.rpc(type, payload);
    if (error) {
      const err = new Error(error.message);
      err.code = error.code;
      err.details = error.details;
      err.permanent = Boolean(status);
      throw err;
    }
  };
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
//
// Caveat found in review (offline-sync-auditor, 2026-08-29, while closing
// the cross-module handler-map gap — see formats/cup-taster/outboxHandlers.js):
// a caller that arrives while a flush is already in-flight gets back that
// SAME promise, built from whichever caller's `handlers` argument won the
// race — this caller's own `handlers` is silently discarded, not merged.
// Harmless today because every real production call site passes the exact
// same cupTasterOutboxHandlers(client) map (functionally interchangeable
// regardless of whose object reference wins), but a FUTURE call site that
// races one of today's with a narrower map would have its intent silently
// dropped, potentially reintroducing exactly the stall that gap-closing
// task fixed. Not fixed here — no current code path triggers it — but
// worth this note so a future addition doesn't reintroduce it unknowingly.
let inFlightFlush = null;

// Replays every queued operation, strictly in FIFO (createdAt) order,
// stopping at the first operation that fails for a genuine reason — a
// dependent operation queued after one that hasn't succeeded yet must never
// run ahead of it (§9's "operations, not rows" guarantee extended to the
// queue's own replay order).
//
// A handler that throws with `error.permanent === true` is telling this
// function something different from an ordinary failure: not "this didn't
// work yet, try again later" but "this exact operation can never succeed no
// matter how many times it's retried" (a stale-data conflict is the
// motivating case — retrying with the SAME payload against the SAME
// expected-state check will keep failing the SAME way forever). Treating
// that like any other failure would leave it stuck at the head of the
// queue, permanently blocking every later operation behind it — including
// ones for a completely different heat — with no way out short of manually
// clearing IndexedDB. So a permanent failure is removed and the flush
// continues, instead of stopping: nothing is "waiting" on an operation that
// will never succeed, so letting later operations proceed doesn't violate
// the FIFO guarantee above (that guarantee protects operations that MIGHT
// still succeed). The failure itself is still reported back to the caller
// via the returned `error`/`permanentFailure`, not silently discarded.
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
  // The most recent permanent failure across the WHOLE flush (not just one
  // operation) — a permanently-failed operation doesn't stop the pass (see
  // the catch block below), so without this its failure would be silently
  // lost the moment a later operation either succeeds or fails ordinarily
  // and the function returns with no memory anything else went wrong. Named
  // distinctly from the returned `permanentFailure` boolean field below —
  // this holds the actual Error, that's a flag.
  let lastPermanentError = null;

  for (;;) {
    const operations = await outboxListAll();
    if (operations.length === 0) {
      return lastPermanentError
        ? { processed, stopped: false, error: lastPermanentError, permanentFailure: true }
        : { processed, stopped: false, permanentFailure: false };
    }

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
        if (error?.permanent) {
          // See the module comment above `runFlush` — this operation can
          // never succeed as-is, so it's removed rather than left to block
          // every later operation forever. Recorded for the eventual
          // return value, but the loop keeps going: nothing is "waiting"
          // on an operation that will never succeed, so a later,
          // independent operation (this same pass or a future one) must
          // still get its turn.
          await outboxRemove(operation.id);
          lastPermanentError = error;
          continue;
        }
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
        // `permanentFailure` stays a plain boolean here too (unlike the
        // queue-empty return above, `error` is always the STOPPING failure,
        // never the earlier permanent one — this function doesn't try to
        // report two distinct errors from one call). An earlier permanent
        // failure in this same pass must still not vanish silently just
        // because a later, unrelated, ordinary failure is what ultimately
        // stopped things: the permanently-failed operation was already
        // correctly removed from the queue (no data-integrity gap either
        // way), but a caller inspecting only `stopped`/`error` would
        // otherwise have no way to learn something else was also dropped
        // during this same call.
        return { processed, stopped: true, error, permanentFailure: Boolean(lastPermanentError) };
      }
    }
    // Loop again: operations enqueued while this pass was running should be
    // picked up by this same call, not left for a separate invocation.
  }
}
