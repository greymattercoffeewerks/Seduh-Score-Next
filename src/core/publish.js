// Publish, format-agnostic (handoff §6, §14 T5.1). The write path a
// format's own screens will eventually call to push a `live_sessions` row —
// what the projector (T5.3) and phone (T5.4) surfaces both read. Only the
// mechanism lives here: WHEN a format calls this (once at heat start with a
// light timing-only payload, again on an explicit results publish, per D7's
// "split publish cadence") and WHAT its payload contains (Cup Taster's is a
// standings table, §8.3) are both format-specific decisions, made by
// whichever `formats/cup-taster/` caller eventually wires this in — not
// this task's scope (logic module only, ahead of T5.2's viewer-shell
// existing to build real wiring against).
//
// Routed through the outbox as ONE operation, same discipline T4.5's
// confirm_heat established — "Publish is explicit and separate. A queued
// publish that has not drained shows not synced, never green" (§9) is only
// true if publishing genuinely goes through the same queue/flush/fail-open
// machinery every other tracked write does, not a direct client.rpc() call.
//
// `isTest` is a required, explicit argument, never re-derived here from a
// fresh `events` read — the caller is expected to source it from whatever
// event object it already has loaded (the same `event?.is_test` every
// existing screen already reads for its own banner), matching this
// codebase's established pattern of trusting an already-loaded event over
// adding a network round-trip inside a write path. This is "is_test
// propagation": a publish call has nowhere to smuggle a missing/wrong flag
// through — the guard below makes "required" a real, enforced contract, not
// just a comment a future caller could still get wrong for free (found in
// review: a caller that forgot the key would have silently enqueued
// `isTest: undefined`, defeating D9's guarantee at the one place a caller
// could get it wrong at no cost).
import { getSupabase } from './supabaseClient.js';
import { enqueueOperation, flushOutbox } from './outbox.js';

// Enqueues + immediately attempts a flush — same shape as
// scoring.js's submitConfirmHeat (see its own comment for the full
// reasoning: persisted before any network call, survives a crash/reload the
// instant this resolves, the flush attempt gives the common case an
// immediate result without waiting for a separate sync pass).
export async function publishSession(
  orgId,
  eventId,
  { format, isTest, payload },
  client = getSupabase(),
) {
  if (typeof isTest !== 'boolean') {
    throw new TypeError('publishSession: isTest must be explicitly true or false');
  }
  const rpcPayload = {
    p_operation_id: crypto.randomUUID(),
    p_org_id: orgId,
    p_event_id: eventId,
    p_format: format,
    p_is_test: isTest,
    p_payload: payload,
  };
  await enqueueOperation('publish_session', rpcPayload);
  return flushOutbox({
    publish_session: async (opPayload) => {
      const { error } = await client.rpc('publish_session', opPayload);
      if (error) {
        // Every error publish_session itself can return (an event/org
        // mismatch, a nonexistent event, an RLS rejection for a non-member)
        // is a rejection of THIS payload specifically; retrying the exact
        // same org/event pair will fail the exact same way forever, the
        // same reasoning confirm_heat's own handler documents. A genuine
        // network-level failure (client.rpc() rejecting before ever
        // reaching the server) never reaches this branch and stays the
        // outbox's normal, retryable failure.
        const err = new Error(error.message);
        err.code = error.code;
        err.details = error.details;
        err.permanent = true;
        throw err;
      }
    },
  });
}
