// What the Throwdown event dashboard reads, in one place, so runSheet.js can stay pure. The reads the phases cannot
// be drawn without (the event and everything `loadThrowdown` reads) throw; the one advisory read (how many writes are
// waiting on this device) fails to `null` instead of stopping the page, so a slow queue never stops an organiser
// opening their own event.
import { getSupabase } from '../../core/supabaseClient.js';
import { findEvent } from '../../core/events.js';
import { listPendingOperations } from '../../core/outbox.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { loadThrowdown, TD_OPERATIONS } from './data.js';

const TD_TYPES = new Set(Object.values(TD_OPERATIONS));

// Throwdown writes waiting in THIS person's outbox on this device (the active organisation's). Not narrowed to one
// event: the operations carry a match id or an event id depending on their kind, and the question the warning
// answers is "is something of mine not sent yet?".
export async function countQueuedTdOperations(listQueued = listPendingOperations) {
  const queued = await listQueued();
  return queued.filter((op) => TD_TYPES.has(op.type)).length;
}

/**
 * @returns {Promise<object>} `{ eventId, event, ...loadThrowdown(), queuedCount }`; `queuedCount` is null when
 *   its read failed. Any other failure rejects.
 */
export async function loadThrowdownDashboardData(
  eventId,
  { client = getSupabase(), listQueued = listPendingOperations } = {},
) {
  // The advisory read starts beside the required ones, not after them: a slow link must not double the wait.
  const queuedCount = raceTimeout(
    Promise.resolve().then(() => countQueuedTdOperations(listQueued)),
    DEFAULT_LOAD_TIMEOUT_MS,
  ).catch(() => null);
  // A failed required read rejects at once: the advisory read (which never rejects) is not waited for.
  const [event, throwdown] = await raceTimeout(
    Promise.all([findEvent(eventId, client), loadThrowdown(eventId, client)]),
    DEFAULT_LOAD_TIMEOUT_MS,
  );
  return { eventId, event, ...throwdown, queuedCount: await queuedCount };
}
