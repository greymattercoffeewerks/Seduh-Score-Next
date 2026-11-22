// Fixtures for the dashboard's tests: bracket rows built the way the database holds them and turned into a bracket
// by the real `deriveBracket`, so a test can never drift from the shape the dashboard reads. Test-only.
import { deriveBracket } from './bracket.js';

export const entry = (n, over = {}) => ({
  id: `e${n}`,
  display_name: `Competitor ${n}`,
  cafe: null,
  bib: null,
  person_id: null,
  withdrawn: false,
  created_at: '2026-11-20T00:00:00Z',
  ...over,
});

export const entriesOf = (count) => Array.from({ length: count }, (_, i) => entry(i + 1));

/**
 * A match: `sides` are entry ids (null for an empty slot); `result` is null (undecided) or one of
 * 'votes' | 'walkover' | 'bye'; `votes` is [a, b] tap counts; `walkoverWinner` is the winning slot position.
 */
export const match = (sides, { result = null, votes = [], walkoverWinner = null, at } = {}) => ({
  sides,
  result,
  votes,
  walkoverWinner,
  at: at ?? (result ? '2026-11-27T10:00:00Z' : null),
});

/** rounds: [{ phase: 'main' | 'third_place', matches: [match(...)] }], in order. */
export function bracketOf(entries, rounds) {
  const rows = { rounds: [], matches: [], slots: [], votes: [], entries };
  let seq = 0;
  rounds.forEach((round, ri) => {
    const roundId = `r${ri + 1}`;
    rows.rounds.push({ id: roundId, position: ri + 1, kind: 'pair', phase: round.phase ?? 'main' });
    round.matches.forEach((m, mi) => {
      const matchId = `r${ri + 1}m${mi + 1}`;
      rows.matches.push({
        id: matchId,
        round_id: roundId,
        position: mi + 1,
        result_kind: m.result,
        confirmed_at: m.at,
        walkover_winner_position: m.walkoverWinner,
      });
      m.sides.forEach((entryId, si) => {
        const slotId = `${matchId}s${si + 1}`;
        rows.slots.push({ id: slotId, match_id: matchId, position: si + 1, entry_id: entryId });
        for (let k = 0; k < (m.votes[si] ?? 0); k += 1) {
          seq += 1;
          rows.votes.push({ id: `v${seq}`, match_id: matchId, slot_id: slotId, created_at: '' });
        }
      });
    });
  });
  return deriveBracket(rows);
}

/** `n` undecided matches pairing consecutive entries. */
export const undecided = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => match([`e${offset + 2 * i + 1}`, `e${offset + 2 * i + 2}`]));

export function dashboardData({
  entries,
  bracket,
  settings = {},
  draw = null,
  queuedCount = null,
}) {
  return {
    eventId: 'ev1',
    event: { id: 'ev1', name: 'Throwdown Nov', is_test: false },
    settings: {
      judge_count: 3,
      third_place: true,
      seeding_mode: 'random',
      modules: {},
      ...settings,
    },
    settingsSaved: true,
    draw,
    entries,
    bracket,
    queuedCount,
  };
}
