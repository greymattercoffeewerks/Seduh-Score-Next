// The one shared outbox handler map for BTC, and the human labels for its operation
// types. Same role and same reasoning as formats/cup-taster/outboxHandlers.js:
// core/outbox.js's flushOutbox() registers handlers per call, so a flush triggered
// anywhere (main.js's reconnect flush, another screen's own attempt) can only process
// operation types it was handed a handler for. Without BTC's map in that flush, a queued
// confirm_btc_match throws "no handler registered", counts as an ordinary failed attempt,
// and stops the whole FIFO queue, blocking every operation behind it (Cup Taster's too).
//
// Lives in formats/btc/, not core/: it is this format's own composition of its own
// operation types. main.js is the one file allowed to know both formats, and merges
// this map with Cup Taster's.
import { confirmHandlers } from './scoring.js';

export function btcOutboxHandlers(client) {
  return { ...confirmHandlers(client) };
}

// Kept as a plain object rather than derived from the handler map's keys: a key set
// carries no human wording, and deriving handler registration from label keys would
// let a typo here silently drop a real handler. outboxHandlers.test.js asserts the two
// key sets agree instead.
export const btcOperationLabels = {
  confirm_btc_match: 'confirming a match',
};
