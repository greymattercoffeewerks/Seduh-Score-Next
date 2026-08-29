// The one shared outbox handler map for Cup Taster (2026-08-29 follow-up,
// closing a known ROADMAP.md gap). `core/outbox.js`'s `flushOutbox()`
// registers handlers per call, not globally — each write module
// (timing.js, scoring.js, core/publish.js) already exports its OWN narrow
// map (timingHandlers/confirmHandlers/publishHandlers) for its own writes,
// but a flush triggered with only one module's map can't process an
// operation type queued by a DIFFERENT module: the exact scenario this
// project's primary offline workflow hits (a heat timed AND scored fully
// offline in one session enqueues start_heat/record_heat_time entries, then
// a confirm_heat behind them — a flush using only confirm_heat's own map
// throws "no handler registered" on the very first queued timing
// operation, an ordinary non-permanent failure that stops the whole flush
// before confirm_heat is ever attempted).
//
// This file is the composition point, deliberately NOT inside any of
// timing.js/scoring.js/core/publish.js themselves — each of those already
// takes an optional `handlers` override on its own write function precisely
// so it doesn't need to import this file back (importing this file INTO
// timing.js, which this file itself imports FROM, would be a circular
// module dependency). Lives in formats/cup-taster/, not core/, since it's
// this format's own composition of ITS operation types — the same §6
// boundary test the rest of this project uses: a future format builds its
// own equivalent file from its own operation types; this one is Cup
// Taster's, not touched by adding a new format.
import { timingHandlers } from './timing.js';
import { confirmHandlers } from './scoring.js';
import { publishHandlers } from '../../core/publish.js';

export function cupTasterOutboxHandlers(client) {
  return {
    ...timingHandlers(client),
    ...confirmHandlers(client),
    ...publishHandlers(client),
  };
}
