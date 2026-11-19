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
  td_leader_changed: 'The result changed while you were looking. Check it and confirm again.',
  td_match_scored: 'That match is decided by scoresheets, not by votes.',
  td_match_not_scored: 'That match is decided by votes, not by scoresheets.',
  td_seat_invalid: 'There is no such judge seat on this event.',
  td_cup_invalid: 'There is no such cup in this round.',
  td_line_unknown: 'The scoresheet has no such line.',
  td_points_invalid: 'Points must be whole numbers within each line’s maximum.',
  td_sheet_invalid: 'That scoresheet could not be read. Open it again and re-enter the points.',
  td_sheet_cups: 'The scoresheet does not have the right number of cups.',
  td_sheet_line_unknown: 'The scoresheet has a line this event does not use.',
  td_sheet_incomplete: 'Every line of every cup needs a score before the sheet can be saved.',
  td_sheet_points_invalid: 'Points must be whole numbers within each line’s maximum.',
  td_sheets_incomplete:
    'Not every judge’s sheet is in yet. Enter all the sheets before confirming.',
  td_organiser_pick_required:
    'The sheets are level. Choose the winner yourself; it is recorded as your decision.',
  td_organiser_pick_unneeded:
    'The sheets already decide this match. Check the result and confirm again.',
  td_scoresheet_invalid:
    'Choose at least one round for scoresheets, with 1 to 3 cups, and a known scoresheet.',
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
  scores: 'Scoresheets',
});

// The rounds a scoresheet can decide, by the role the bracket gives them (roundRole.js).
export const ROLE_WORDS = Object.freeze({
  final: 'Final',
  third_place: '3rd place match',
  semi_final: 'Semi-finals',
  quarter_final: 'Quarter-finals',
});

// The rule that decided a scored match, in words (console only: never on a public surface).
export function ruleWords(rule) {
  if (rule === 'total') return 'the higher total points';
  if (rule === 'judges') return 'more judges scoring them higher (the totals were level)';
  if (rule === 'organiser') return 'the organiser’s decision (the sheets were level)';
  return '';
}

// The line under a decided match, in words: "2 to 1", "Walkover", "Bye".
export function resultLine(match) {
  if (match.resultKind === 'walkover') return RESULT_WORDS.walkover;
  if (match.resultKind === 'bye') return RESULT_WORDS.bye;
  if (match.resultKind === 'scores') return RESULT_WORDS.scores;
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
