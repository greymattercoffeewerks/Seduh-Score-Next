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

// ---------------------------------------------------------------------
// Whose operation is it? (T-TEN.C6, shared-device safety)
//
// One browser's IndexedDB outbox is shared by everyone who signs in on that device, and by every
// organisation one person works in. Replaying a queue under the wrong login is not harmless: the
// database refuses an operation from someone who is not a member of its organisation as a PERMANENT
// failure, and a permanent failure is removed from the queue (see runFlush). So an operation is tagged
// when it is queued with the account (`userId`) and organisation (`orgId`) it was made in, and a flush
// only ever replays operations that belong to the signed-in account in the ACTIVE organisation.
// Everything else is left exactly as it is: not run, not counted as a failure, not dropped, not
// reordered. It is waiting for its owner, and the sync panel says so (appShell.js).
//
// The owner is ambient: main.js sets it (setOutboxOwner) from the session and the organisation context,
// because no screen knows who is signed in and threading it through every queued write would mean
// touching every format. This file stays format-agnostic: the only thing it knows about a payload is
// the project-wide name of the organisation parameter (`p_org_id`, or `orgId` on a publish intent).
//
// `undefined` (never set) means ownership is not in use and every operation is the caller's: that is
// the state of a bare test and of nothing in production, where main.js's mountApp() sets the owner
// before anything can flush. `null` means signed out: nothing belongs to anybody, so nothing runs.
// Operations queued before this change carry no tags: an operation with no `userId` is treated as
// belonging to whoever is signed in (today's behaviour — the account cannot be recovered), but its
// organisation is still read from its payload, so it is never replayed into another organisation.
// ---------------------------------------------------------------------
let currentOwner;

// `owner`: `{ userId, orgId }` (either may be null while the organisation is still loading), or null
// when signed out. Anything that is not an object becomes null: never "unset" by accident.
export function setOutboxOwner(owner) {
  currentOwner =
    owner && typeof owner === 'object'
      ? { userId: owner.userId ?? null, orgId: owner.orgId ?? null }
      : null;
}

export function getOutboxOwner() {
  return currentOwner;
}

// Test-only: back to "ownership not in use", so one test's owner cannot leak into the next.
export function _resetOutboxOwnerForTests() {
  currentOwner = undefined;
}

// The organisation a payload is for, by the project-wide parameter name; null when it names none.
export function payloadOrgId(payload) {
  const id = payload?.p_org_id ?? payload?.orgId;
  return typeof id === 'string' && id ? id : null;
}

export const OWNERSHIP = Object.freeze({
  OWN: 'own',
  OTHER_ORG: 'other_org',
  OTHER_ACCOUNT: 'other_account',
});

// Where an operation stands relative to `owner` (default: the current one).
export function operationOwnership(operation, owner = currentOwner) {
  if (owner === undefined) return OWNERSHIP.OWN;
  if (owner === null) return OWNERSHIP.OTHER_ACCOUNT;
  if (operation.userId != null && operation.userId !== owner.userId) {
    return OWNERSHIP.OTHER_ACCOUNT;
  }
  const orgId = operation.orgId ?? payloadOrgId(operation.payload);
  if (orgId != null && orgId !== owner.orgId) return OWNERSHIP.OTHER_ORG;
  return OWNERSHIP.OWN;
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
    // Who made it and where it lands. The organisation is the payload's own when it names one: that
    // is where the write will actually go, even if a screen that was just replaced queues it after
    // the active organisation has moved on. No owner yet: left null, which reads as "anyone's" (above).
    userId: currentOwner?.userId ?? null,
    orgId: payloadOrgId(payload) ?? currentOwner?.orgId ?? null,
    createdAt: nextSequence(),
    attempts: 0,
    lastError: null,
  };
  try {
    await outboxPut(operation);
  } catch (error) {
    // Never persisted, so never queued: this write is as lost as a dropped
    // one, and nothing would ever retry or report it. Announced the same way
    // so the sync panel says so even when the caller swallows the throw —
    // the best-effort live-view publishes do (offline-sync-auditor,
    // 2026-09-27: an IndexedDB quota failure on the champion publish had no
    // later trigger and no report at all). A caller that shows the throw on
    // its own screen raises the panel's sticky notice too, even if the user
    // then retries successfully — accepted as the conservative side until
    // lost writes can be acknowledged (ROADMAP's persisted-list item).
    announceDrop(operation, error, 'not persisted');
    throw error;
  }
  return operation;
}

// Wraps a Supabase RPC call as a `flushOutbox` handler for one operation
// `type`. Every RPC this project routes through the outbox (confirm_heat,
// publish_session, start_heat/record_heat_time/auto_max_heat) rejects a
// stale/conflicting payload the exact same way: retrying the identical
// payload against the RPC's own idempotency/conflict check fails the exact
// same way forever — permanent (which failures are instead retryable is
// isTransientFailure's job, below). Extracted here — not `formats/cup-taster/` —
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
// 401, specifically, is never a genuine business-logic rejection — PostgREST
// returns it only for an auth/JWT problem (an invalid, malformed, or expired
// token), always BEFORE the RPC body or any RLS policy ever runs. A real
// rejection from inside the function (a `raise exception`, a constraint
// violation, an RLS denial) always carries some OTHER non-zero status (400
// for a plain `raise exception`/P0001, 500 for other P0*** codes, 403/other
// for RLS — status alone is no longer the classifier, see
// isTransientFailure below) — confirmed empirically
// against a real local Postgres/PostgREST instance, not assumed: an expired
// JWT returns `401 {"code":"PGRST303","message":"JWT expired"}`, a malformed
// one `401 {"code":"PGRST301", ...}`, while a genuine application-level
// rejection (e.g. publish_session's own "event not found") returns `400
// {"code":"P0001", ...}`. ROADMAP.md's own gap ("hasSession only checks
// session existence at flush-start time") named the real symptom this
// closes: a session valid when a flush BEGINS can expire partway through a
// large queued flush, and every call site sharing this one handler-builder
// (not just main.js's reconnect trigger) would otherwise misclassify that
// stale-token 401 as permanent, discarding a perfectly retryable write.
function isAuthStatus(status) {
  return status === 401;
}

// Transient failures (2026-09-26, pre-event hardening): a response that
// reached the server is NOT automatically permanent. A request timeout, a
// rate limit, a gateway/Cloudflare 5xx, a deadlock or a statement timeout
// says nothing about the payload — the same write can succeed a moment
// later. Classifying those permanent silently discarded a real tap or
// confirm on flaky venue wifi.
//
// Decided by the error CODE first, HTTP status only when there is no code.
// Status alone is not enough: PostgREST maps plpgsql's P0001 to 400 but
// every other P0*** (including P0002, the stale-conflict code confirm_heat/
// record_heat_time/confirm_btc_match raise) to 500. "Retry every 5xx" would
// leave each genuine conflict wedged at the head of the FIFO queue forever —
// there is no manual discard — so a Postgres or PostgREST code is trusted
// as the more specific answer, and only the listed ones are retryable.
// Listed individually, not by SQLSTATE class: class 08 also holds
// protocol_violation (08P01) and class 53 config_limit_exceeded (53400),
// which would fail the same way on every retry.
const TRANSIENT_SQLSTATES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '53000', // insufficient_resources
  '53100', // disk_full
  '53200', // out_of_memory
  '53300', // too_many_connections
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (statement timeout)
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  'PGRST000', // PostgREST could not connect to the database
  'PGRST001', // PostgREST internal connection error
  'PGRST002', // PostgREST schema cache not yet loaded
  'PGRST003', // PostgREST connection-pool acquisition timeout
  // JWT problems — always sent as 401, which isTransientFailure already
  // treats as retryable; listed so a caller holding only a code (a failed
  // read, where postgrest-js's thrown error carries no status) agrees.
  'PGRST301', // JWT invalid / could not be decoded
  'PGRST302', // no JWT sent where one is required
  'PGRST303', // JWT expired / claims invalid
]);

// For a caller that has an error CODE but no HTTP status — a read helper
// that throws postgrest-js's error object as-is (core/publishIntent.js's
// payload read chain). Same list isTransientFailure uses.
export function isTransientErrorCode(code) {
  return TRANSIENT_SQLSTATES.has(code);
}

// Module-private: buildRpcHandler below is the one caller (the publish-from-an-intent handler in
// core/publishIntent.js reuses buildRpcHandler for its RPC, so the mapping is not re-derived anywhere).
function isTransientFailure({ status, code }) {
  if (!status || isAuthStatus(status)) return true;
  // A gateway can send a JSON body whose `code` isn't a SQLSTATE string —
  // fall through to the status rule rather than guessing from it.
  if (typeof code === 'string' && code) return TRANSIENT_SQLSTATES.has(code);
  return status === 408 || status === 429 || status >= 500;
}

export function buildRpcHandler(client, type) {
  return async (payload) => {
    const { error, status } = await client.rpc(type, payload);
    if (error) {
      const err = new Error(error.message);
      err.code = error.code;
      err.details = error.details;
      err.hint = error.hint;
      err.permanent = !isTransientFailure({ status, code: error.code });
      throw err;
    }
  };
}

// The error that dropped `operationId` during the flush that returned
// `flushResult`, or null if that operation wasn't dropped by it (it landed,
// is still queued, or was never part of this flush). `flushResult.error`
// alone can't answer that: it is the latest drop or the stopping failure,
// which may belong to any operation in the shared queue.
export function droppedErrorFor(flushResult, operationId) {
  return flushResult?.dropped?.find((drop) => drop.operationId === operationId)?.error ?? null;
}

// The operations a flush would run now: the signed-in account's, in the active organisation, oldest
// first. Every "how much is waiting?" question about THIS person's work (the sync panel, the retry
// timer, the organisation switch, deleting a test event) is asked of this list, never of the whole
// device's queue.
export async function listPendingOperations() {
  const owner = currentOwner;
  return (await outboxListAll()).filter(
    (operation) => operationOwnership(operation, owner) === OWNERSHIP.OWN,
  );
}

export async function countPendingOperations() {
  return (await listPendingOperations()).length;
}

// The whole device's queue split by whose it is, from ONE read and one owner (two separate reads could
// straddle a change of owner and count an operation twice): `own` is what a flush would run;
// `otherOrg` is the signed-in account's own, waiting for its organisation to be the active one;
// `otherAccount` was made by somebody else (or there is nobody signed in). Never run, never dropped.
export async function partitionOperations() {
  const owner = currentOwner;
  const own = [];
  const otherOrg = [];
  const otherAccount = [];
  for (const operation of await outboxListAll()) {
    const ownership = operationOwnership(operation, owner);
    if (ownership === OWNERSHIP.OWN) own.push(operation);
    else if (ownership === OWNERSHIP.OTHER_ORG) otherOrg.push(operation);
    else otherAccount.push(operation);
  }
  return { own, otherOrg, otherAccount };
}

export async function listOtherOperations() {
  const { otherOrg, otherAccount } = await partitionOperations();
  return { otherOrg, otherAccount };
}

// Every operation on the device whoever it belongs to, oldest first. ONLY for "is this operation still
// in the queue at all?" questions about an operation the caller itself just queued: such a question must
// not read "no" because the owner changed in the meantime, or a write that is safely waiting would be
// taken for one that was dropped and entered again.
export async function listAllOperations() {
  return outboxListAll();
}

// Operations waiting for one organisation, whichever account made them: what deleting one of its events
// could orphan. One that names no organisation at all could be for this one, so it counts.
export async function countOperationsInOrg(orgId) {
  return (await outboxListAll()).filter((operation) => {
    const operationOrg = operation.orgId ?? payloadOrgId(operation.payload);
    return operationOrg == null || operationOrg === orgId;
  }).length;
}

// Everything the signed-in ACCOUNT has waiting on this device, in any of its organisations: what
// signing out would leave behind for them.
export async function listAccountOperations() {
  const owner = currentOwner;
  return (await outboxListAll()).filter(
    (operation) => operationOwnership(operation, owner) !== OWNERSHIP.OTHER_ACCOUNT,
  );
}

// Reentrancy guard — a flush already in progress must not run a second,
// overlapping pass over the same queue. Concurrent callers share the same
// in-flight promise and see its real outcome; the flush re-lists the queue
// after each pass so anything enqueued mid-flush gets picked up in that same
// call rather than requiring a separate flushOutbox() invocation.
//
// A late-arriving caller's own `handlers` map is MERGED into the run
// already in flight (`activeHandlers`, mutated in place — the closure
// `runFlush` holds resolves each operation's handler fresh on every loop
// iteration, so a merge made mid-pass is visible to the very next
// iteration, not just the next `flushOutbox()` call). Narrows the gap
// found in review (offline-sync-auditor, 2026-08-29, while closing the
// cross-module handler-map gap — see
// formats/cup-taster/outboxHandlers.js): previously the second caller's
// entire map was silently discarded in favor of whichever caller's
// argument won the race, unconditionally aborting the whole pass the
// instant that caller's own operation type came up. Harmless in practice
// today, since every real call site passes the exact same
// cupTasterOutboxHandlers(client) map, but a future call site racing one
// of today's with a narrower map would have had its own operation types
// go unresolved for the whole in-flight pass.
//
// Residual window (offline-sync-auditor, 2026-09-11): a merge landing
// AFTER `runFlush`'s loop has already reached and failed on that specific
// operation within the CURRENT pass's already-fetched batch still aborts
// that pass the same way as before this fix — the merge only helps once
// it lands before the loop gets there. Not data loss (`main.js`'s
// reconnect-flush retries later and this fix still applies then, since
// `activeHandlers` isn't reset until the whole pass settles), just a
// possible one-cycle delay for whatever was queued behind the aborted
// operation. Closing this fully would mean re-fetching the queue the
// instant a merge lands rather than only between passes — not done here;
// the eventual-recovery path above already bounds the damage to "delayed
// a cycle," not "lost."
//
// Last write wins per-type-key on a genuine key collision (two different
// handlers registered for the same operation `type`) — an unlikely case
// today, since every type name is owned by exactly one format module.
let inFlightFlush = null;
let activeHandlers = null;

// Every permanently-dropped operation is announced here, once per operation,
// from inside runFlush itself (and from enqueueOperation when a write can't
// even be persisted) — found in review (offline-sync-auditor,
// 2026-09-27): only main.js's background reconnect flush forwarded
// `permanentError` to the sync panel. Every screen-triggered flush
// (publishLiveSession from scoring/standings/timing, a timing tap flushing
// past someone else's leftover op) returned the drop to a caller that either
// ignored it or only looked at its own operation — the panel's next poll saw
// an empty queue and showed "Synced" for a write that was gone (§8.4/§9).
// Announcing from the one place every drop happens covers every caller,
// present and future (any format), without each screen having to remember
// to forward a result it has no reason to understand. Listeners are
// same-tab only: a flush run in another tab announces to that tab's shell.
const dropListeners = new Set();

// `listener({ operation, error })` is called once per dropped operation.
// `operation` carries `type`, so a listener can name WHAT was lost — the
// panel doesn't yet (ROADMAP's "report doesn't say which operation was
// lost"). Returns an unsubscribe function.
export function onOperationDropped(listener) {
  dropListeners.add(listener);
  return () => dropListeners.delete(listener);
}

function announceDrop(operation, error, reason = 'dropped') {
  // Logged too: the panel keeps only a count, and only for the life of the
  // tab, so the console is the only record of WHICH operation was lost.
  console.warn(`outbox: operation "${operation.type}" (${operation.id}) ${reason}`, error);
  for (const listener of dropListeners) {
    // A throwing listener must not abort the flush: the operation is
    // already removed, and the operations behind it still need their turn.
    try {
      listener({ operation, error });
    } catch (listenerError) {
      console.error('outbox: drop listener failed', listenerError);
    }
  }
}

// Whether this tab has a flush running (or waiting for the cross-tab lock).
// Lets the sync panel hold a drop until the pass that dropped it is over,
// so a whole pass's drops are announced once (see appShell.js).
export function isFlushInProgress() {
  return inFlightFlush !== null;
}

// The reentrancy guard above only covers this tab. Two organiser tabs (say
// timing in one, standings in another) share one IndexedDB outbox, and
// once main.js retried on a timer both drained it every 15s — running the
// same operation twice, the loser failing the ledger insert with a false
// "failed to save" for a write that actually landed (found in review:
// offline-sync-auditor, 2026-09-26). A Web Lock makes flushes take turns
// across tabs; the waiting tab re-reads the queue when its turn comes, so
// it only sees what's still left. Falls back to running directly where the
// API doesn't exist (older browsers, jsdom).
const FLUSH_LOCK_NAME = 'seduh-outbox-flush';
function withCrossTabLock(fn) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(FLUSH_LOCK_NAME, fn) : fn();
}

// Replays the owner's queued operations, strictly in FIFO (createdAt) order,
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
// still succeed). The failure itself is never silently discarded: each drop
// is announced to onOperationDropped's listeners (the sync panel), and the
// caller gets it back via the returned `permanentFailure`/`dropped`/`error`.
//
// `handlers` maps an operation `type` to `(payload) => Promise<void>`.
export function flushOutbox(handlers) {
  if (inFlightFlush) {
    Object.assign(activeHandlers, handlers);
    return inFlightFlush;
  }
  activeHandlers = { ...handlers };
  inFlightFlush = withCrossTabLock(() => runFlush(activeHandlers)).finally(() => {
    inFlightFlush = null;
    activeHandlers = null;
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
  // Every operation dropped during this call, in drop order — lets a caller
  // tell whether ITS OWN operation was the one dropped (compare
  // `operationId` against the id enqueueOperation returned) instead of
  // blaming its action for another operation's error. Present only
  // alongside `permanentFailure: true`.
  const dropped = [];

  for (;;) {
    const operations = await listPendingOperations();
    if (operations.length === 0) {
      return lastPermanentError
        ? {
            processed,
            stopped: false,
            error: lastPermanentError,
            permanentFailure: true,
            permanentError: lastPermanentError,
            dropped,
          }
        : { processed, stopped: false, permanentFailure: false };
    }

    for (const operation of operations) {
      // Whoever is signed in, or whichever organisation is active, may have changed since this batch was
      // read (signing out, switching, a second account signing in in another tab): what is left of it is
      // not this flush's to run. Leave it, and read the queue again for the new owner.
      if (operationOwnership(operation) !== OWNERSHIP.OWN) break;
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
        // Somebody else became the owner while the handler was running (another account signed in, the
        // organisation changed): whatever it threw is about a request made for the previous owner, and
        // this operation is no longer this flush's to judge. In particular a PERMANENT failure must not
        // remove it. Left exactly as it is, for its owner; the next pass starts from the new owner's queue.
        if (operationOwnership(operation) !== OWNERSHIP.OWN) break;
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
          dropped.push({ operationId: operation.id, type: operation.type, error });
          announceDrop(operation, error);
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
        //
        // `permanentError` is the most recent dropped operation's own error
        // (never the stopping failure, which is `error`) — kept as the
        // one-field summary; `dropped` has every drop with its operation id.
        return lastPermanentError
          ? {
              processed,
              stopped: true,
              error,
              permanentFailure: true,
              permanentError: lastPermanentError,
              dropped,
            }
          : { processed, stopped: true, error, permanentFailure: false };
      }
    }
    // Loop again: operations enqueued while this pass was running should be
    // picked up by this same call, not left for a separate invocation.
  }
}
