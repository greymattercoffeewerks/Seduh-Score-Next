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
import { buildRpcHandler, enqueueOperation, flushOutbox } from './outbox.js';

// Mirrors formats/cup-taster/timing.js's timingHandlers(client) and
// scoring.js's confirmHandlers(client) shape — kept here in core/, not a
// format module, since publish_session is itself format-agnostic (its own
// p_format parameter carries the format, per this file's own module
// comment). A format's own outboxHandlers.js composition (e.g.
// formats/cup-taster/outboxHandlers.js) imports this to include
// publish_session in its flush map — core exporting something a format
// imports is the normal, permitted direction; nothing here imports back
// from any format module.
export function publishHandlers(client) {
  return { publish_session: buildRpcHandler(client, 'publish_session') };
}

// Enqueues + immediately attempts a flush — same shape as
// scoring.js's submitConfirmHeat (see its own comment for the full
// reasoning: persisted before any network call, survives a crash/reload the
// instant this resolves, the flush attempt gives the common case an
// immediate result without waiting for a separate sync pass).
//
// `handlers`, when passed, REPLACES publishHandlers(client) — same optional
// cross-module-composition override timing.js's submitTimingOperation and
// scoring.js's submitConfirmHeat take (see their comments); nothing calls
// this with an explicit map yet, since nothing calls publishSession() from
// any screen yet (see ROADMAP.md's own T5.1 note), but the shape is here
// ready for whichever future screen wires this in.
export async function publishSession(
  orgId,
  eventId,
  { format, isTest, payload },
  client = getSupabase(),
  handlers,
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
  return flushOutbox(handlers ?? publishHandlers(client));
}

// The read-side counterpart to this file's own write path — live_sessions
// enforces at most one active row per org (a partial unique index; see
// supabase/migrations/20260821220000_live_sessions_table.sql), so "which
// event is the org's active one right now" is a format-agnostic question
// with a format-agnostic answer, same reasoning as publishHandlers above.
// Moved here from formats/cup-taster/eventDashboardScreen.js (found in
// review, code-reviewer/module-boundary-checker, 2026-09-05) — a future
// format's own event dashboard needs this identical query, and nothing
// about it is Cup-Taster-specific.
export async function findActiveLiveEventId(orgId, client = getSupabase()) {
  const { data, error } = await client
    .from('live_sessions')
    .select('event_id')
    .eq('org_id', orgId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data?.event_id ?? null;
}
