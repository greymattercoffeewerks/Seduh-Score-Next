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
import { publishLiveSessionHandlers } from './liveSession.js';
import { resolveStageHandlers } from './standings.js';

export function cupTasterOutboxHandlers(client) {
  return {
    ...timingHandlers(client),
    ...confirmHandlers(client),
    ...publishLiveSessionHandlers(client),
    ...resolveStageHandlers(client),
  };
}

// Human-readable labels for this format's own operation types, for the
// organiser-facing sync panel (core/appShell.js's `renderSync`) to name
// WHICH operation is stuck rather than a bare "retrying failed" (ROADMAP.md
// gap, closed 2026-09-11). Lives here, not core/, for the identical reason
// `cupTasterOutboxHandlers` above does — this format's own vocabulary for
// its own operation types; appShell.js stays format-agnostic and accepts
// this map as an optional caller-supplied prop (main.js passes it through,
// the one file already allowed to know both "core" and "this app is Cup
// Taster"), falling back to a generic message when a type has no label —
// see that file's own comment. Kept as a plain object, not derived from
// `cupTasterOutboxHandlers`'s own keys — a Set of registered handler types
// doesn't carry the human wording a label needs, and the reverse (deriving
// handler registration from label keys) would let a typo in this map
// silently drop a real handler. `outboxHandlers.test.js` instead asserts
// the two key sets stay in agreement, so drift between them is caught by a
// test rather than trusted to eyes alone.
export const cupTasterOperationLabels = {
  start_heat: 'starting a heat',
  record_heat_time: 'recording a time',
  auto_max_heat: 'recording a max time',
  confirm_heat: 'confirming a heat',
  resolve_stage: 'resolving a stage',
  publish_live_session: 'publishing to the live view',
};
