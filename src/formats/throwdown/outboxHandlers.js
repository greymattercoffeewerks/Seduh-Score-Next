// The one shared outbox handler map for Throwdown, and the human labels for its operation types. Same role and
// reasoning as formats/btc/outboxHandlers.js: a flush can only process operation types it was handed a handler for, so
// main.js merges this map with the other formats'. Without it a queued td_cast_vote would throw "no handler" and stop
// the whole FIFO queue.
import { dataHandlers } from './data.js';
import { publishThrowdownLiveSessionHandlers } from './liveSession.js';

export function throwdownOutboxHandlers(client) {
  return { ...dataHandlers(client), ...publishThrowdownLiveSessionHandlers(client) };
}

export const throwdownOperationLabels = {
  td_start_event: 'starting the draw',
  td_cast_vote: 'recording a vote',
  td_undo_vote: 'taking back a vote',
  td_confirm_match: 'confirming a match',
  td_record_walkover: 'recording a walkover',
  publish_throwdown_live_session: 'updating the live display',
};
