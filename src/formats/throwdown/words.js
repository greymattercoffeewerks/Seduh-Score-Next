// Throwdown's wording: the one place its refusals and result words are written, so a console screen, the phone and
// the projector say the same thing. Refusals are chosen by the database's stable hint, never by its text.
import { describeError } from '../../core/errors.js';

const REFUSALS = {
  td_votes_level: 'The votes are level. Take another vote before confirming.',
  td_match_decided: 'That match has already been decided.',
  td_match_not_ready: 'That match does not have two competitors yet.',
  td_setup_locked: 'Setup is locked because Round 1 has started.',
  td_already_started: 'This event has already started.',
  td_draw_duplicate: 'A competitor can fill only one slot.',
  td_draw_entry: 'One of the competitors is not on this event’s active list.',
  td_draw_empty: 'The draw needs at least one pair of two competitors.',
  td_draw_incomplete: 'A random draw must include every active competitor.',
  td_seeding_mismatch: 'The draw mode does not match the setup.',
  td_module_unknown: 'That module is not available.',
  td_module_dependency: 'That module needs another module switched on first.',
  td_judge_count_invalid: 'The judge count must be between 1 and 15.',
  td_leader_changed:
    'The votes changed while you were looking. Check the result and confirm again.',
  td_slot_invalid: 'That competitor is not in this match.',
  td_slot_empty: 'That slot has no competitor.',
  td_seeding_invalid: 'Choose a random or a manual draw.',
  td_seed_invalid: 'A random draw needs its draw code.',
  td_draw_shape: 'The draw is not in pairs.',
  td_module_invalid: 'The module choices are not valid.',
  event_window_locked: 'This event is closed.',
};

export function describeThrowdownError(err) {
  if (err?.hint && Object.hasOwn(REFUSALS, err.hint)) return REFUSALS[err.hint];
  return describeError(err);
}

export const RESULT_WORDS = Object.freeze({
  votes: (a, b) => `${a} to ${b}`,
  walkover: 'Walkover',
  bye: 'Bye',
});

// The line under a decided match, in words: "2 to 1", "Walkover", "Bye".
export function resultLine(match) {
  if (match.resultKind === 'walkover') return RESULT_WORDS.walkover;
  if (match.resultKind === 'bye') return RESULT_WORDS.bye;
  if (match.resultKind === 'votes') {
    const [a, b] = match.sides.filter((s) => s.entryId);
    return RESULT_WORDS.votes(a.votes, b.votes);
  }
  return null;
}

export function matchTitle(match) {
  const names = match.sides.map((s) => s.name ?? (match.isBye ? 'Bye' : 'To be decided'));
  return names.join(' vs ');
}
