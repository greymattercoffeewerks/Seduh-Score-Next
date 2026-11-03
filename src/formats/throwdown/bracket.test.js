import { describe, it, expect } from 'vitest';
import { deriveBracket, roundLabel } from './bracket.js';

const entries = ['A', 'B', 'C', 'D'].map((n) => ({ id: `e${n}`, display_name: n }));
const round = (id, position, phase = 'main') => ({ id, position, kind: 'pair', phase });
const match = (id, round_id, position, extra = {}) => ({
  id,
  round_id,
  position,
  result_kind: null,
  confirmed_at: null,
  walkover_winner_position: null,
  ...extra,
});
const slot = (id, match_id, position, entry_id) => ({ id, match_id, position, entry_id });
const taps = (slotId, n, matchId) =>
  Array.from({ length: n }, () => ({ slot_id: slotId, match_id: matchId }));

describe('deriveBracket', () => {
  it('is not started with no rounds, and projects nothing', () => {
    expect(deriveBracket({ rounds: [], matches: [], slots: [], votes: [], entries })).toMatchObject(
      {
        started: false,
        rounds: [],
        champion: null,
        playableMatches: [],
      },
    );
  });

  it('derives the winner from the vote rows, shows counts, and marks undecided matches playable', () => {
    const b = deriveBracket({
      rounds: [round('r1', 1)],
      matches: [
        match('m1', 'r1', 1, { result_kind: 'votes', confirmed_at: 't' }),
        match('m2', 'r1', 2),
      ],
      slots: [
        slot('s1', 'm1', 1, 'eA'),
        slot('s2', 'm1', 2, 'eB'),
        slot('s3', 'm2', 1, 'eC'),
        slot('s4', 'm2', 2, 'eD'),
      ],
      votes: [...taps('s1', 1, 'm1'), ...taps('s2', 2, 'm1')],
      entries,
    });
    const [m1, m2] = b.rounds[0].matches;
    expect(m1.sides.map((s) => [s.name, s.votes, s.winner])).toEqual([
      ['A', 1, false],
      ['B', 2, true],
    ]);
    expect(m2.playable).toBe(true);
    expect(m2.sides.every((s) => s.winner === null)).toBe(true);
    expect(b.playableMatches.map((m) => m.id)).toEqual(['m2']);
    expect(b.rounds[0].label).toBe('Semi-finals');
  });

  it('shows a walkover as its own result with the recorded winner, whatever the votes say', () => {
    const b = deriveBracket({
      rounds: [round('r1', 1)],
      matches: [
        match('m1', 'r1', 1, {
          result_kind: 'walkover',
          confirmed_at: 't',
          walkover_winner_position: 1,
        }),
      ],
      slots: [slot('s1', 'm1', 1, 'eA'), slot('s2', 'm1', 2, 'eB')],
      votes: taps('s2', 3, 'm1'),
      entries,
    });
    const m = b.rounds[0].matches[0];
    expect(m.resultKind).toBe('walkover');
    expect(m.sides.find((s) => s.winner).name).toBe('A');
  });

  it('treats a bye as decided, advancing the lone competitor, and not playable', () => {
    const b = deriveBracket({
      rounds: [round('r1', 1)],
      matches: [match('m1', 'r1', 1, { result_kind: 'bye', confirmed_at: 't' })],
      slots: [slot('s1', 'm1', 1, 'eA'), slot('s2', 'm1', 2, null)],
      votes: [],
      entries,
    });
    const m = b.rounds[0].matches[0];
    expect(m.isBye).toBe(true);
    expect(m.playable).toBe(false);
    expect(m.sides[0].winner).toBe(true);
    expect(m.sides[1].name).toBeNull();
  });

  it('names champion, runner-up and 3rd place only when decided, and is complete only when all are', () => {
    const base = {
      rounds: [round('r3', 3, 'third_place'), round('r4', 4)],
      matches: [match('m3', 'r3', 1), match('m4', 'r4', 1)],
      slots: [
        slot('a', 'm3', 1, 'eC'),
        slot('b', 'm3', 2, 'eD'),
        slot('c', 'm4', 1, 'eA'),
        slot('d', 'm4', 2, 'eB'),
      ],
      entries,
    };
    const open = deriveBracket({ ...base, votes: [] });
    expect(open.champion).toBeNull();
    expect(open.complete).toBe(false);
    expect(open.playableMatches).toHaveLength(2);
    const done = deriveBracket({
      ...base,
      matches: [
        match('m3', 'r3', 1, { result_kind: 'votes', confirmed_at: 't' }),
        match('m4', 'r4', 1, { result_kind: 'votes', confirmed_at: 't' }),
      ],
      votes: [...taps('c', 2, 'm4'), ...taps('d', 1, 'm4'), ...taps('b', 2, 'm3')],
    });
    expect(done).toMatchObject({ champion: 'A', runnerUp: 'B', thirdPlace: 'D', complete: true });
  });

  it('does not call a level confirmed-by-votes match decided for a winner (no inferred winner)', () => {
    const b = deriveBracket({
      rounds: [round('r1', 1)],
      matches: [match('m1', 'r1', 1, { result_kind: 'votes', confirmed_at: 't' })],
      slots: [slot('s1', 'm1', 1, 'eA'), slot('s2', 'm1', 2, 'eB')],
      votes: [...taps('s1', 1, 'm1'), ...taps('s2', 1, 'm1')],
      entries,
    });
    expect(b.rounds[0].matches[0].winnerSlotId).toBeNull();
    expect(b.champion).toBeNull();
  });
});

describe('roundLabel', () => {
  it('names rounds from the matches that exist', () => {
    expect(roundLabel({ phase: 'main' }, 1, 3)).toBe('Final');
    expect(roundLabel({ phase: 'main' }, 2, 2)).toBe('Semi-finals');
    expect(roundLabel({ phase: 'main' }, 4, 1)).toBe('Quarter-finals');
    expect(roundLabel({ phase: 'main' }, 3, 1)).toBe('Round 1');
    expect(roundLabel({ phase: 'third_place' }, 1, 2)).toBe('3rd place');
  });
});
