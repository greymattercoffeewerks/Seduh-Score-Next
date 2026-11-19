// A round's ROLE in the bracket (owner decision D4): derived from what the round is, never stored. The database holds
// the same rule (app.td_role_of, used by app.td_round_role); the two are driven by the same fixture file
// (supabase/tests/fixtures/scoresheet-parity.json) in the unit tests and in pgTAP 091.
//   * the round with phase third_place            -> 'third_place'
//   * a main round with 1 / 2 / 4 matches         -> 'final' / 'semi_final' / 'quarter_final'
//   * anything else (bigger rounds, redemption)   -> null (decided by taps, as ever)
export const ROUND_ROLES = Object.freeze(['final', 'third_place', 'semi_final', 'quarter_final']);

const MAIN_BY_MATCH_COUNT = Object.freeze({ 1: 'final', 2: 'semi_final', 4: 'quarter_final' });

export function roundRole(phase, matchCount) {
  if (phase === 'third_place') return 'third_place';
  if (phase === 'main') return MAIN_BY_MATCH_COUNT[matchCount] ?? null;
  return null;
}

// How many cups per competitor a round has on its scoresheet, or null when the round is tap-voted (the module is off,
// or it names no cups for this round's role). `scoresheet` is td_settings.modules.scoresheet.
export function scoredCups(scoresheet, phase, matchCount) {
  const role = roundRole(phase, matchCount);
  const cups = role && scoresheet?.cups ? scoresheet.cups[role] : undefined;
  return Number.isInteger(cups) ? cups : null;
}
