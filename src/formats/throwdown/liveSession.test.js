import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { assembleThrowdownPayload, publishThrowdownLive } from './liveSession.js';
import { throwdownOutboxHandlers, throwdownOperationLabels } from './outboxHandlers.js';
import { describeThrowdownError, resultLine } from './words.js';
import { payloadFor, roundOf, namesUpTo } from './projectorFixtures.js';

const entries = ['A', 'B', 'C', 'D'].map((n) => ({
  id: `e${n}`,
  display_name: n,
  cafe: 'Secret Cafe',
}));
const base = {
  rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
  matches: [
    {
      id: 'm1',
      round_id: 'r1',
      position: 1,
      result_kind: 'votes',
      confirmed_at: '2026-11-03T10:00:00Z',
      walkover_winner_position: null,
    },
    {
      id: 'm2',
      round_id: 'r1',
      position: 2,
      result_kind: null,
      confirmed_at: null,
      walkover_winner_position: null,
    },
  ],
  slots: [
    { id: 's1', match_id: 'm1', position: 1, entry_id: 'eA' },
    { id: 's2', match_id: 'm1', position: 2, entry_id: 'eB' },
    { id: 's3', match_id: 'm2', position: 1, entry_id: 'eC' },
    { id: 's4', match_id: 'm2', position: 2, entry_id: 'eD' },
  ],
  votes: [
    { slot_id: 's1', match_id: 'm1' },
    { slot_id: 's1', match_id: 'm1' },
    { slot_id: 's2', match_id: 'm1' },
    { slot_id: 's3', match_id: 'm2' },
  ],
  entries,
};

describe('assembleThrowdownPayload', () => {
  const payload = assembleThrowdownPayload({
    event: { name: 'Night' },
    bracket: deriveBracket(base),
    activeCount: 4,
  });

  it('shows counts only for a decided match: a live tally would reveal a result before it is confirmed', () => {
    const [done, open] = payload.rounds[0].matches;
    expect(done.sides.map((s) => s.votes)).toEqual([2, 1]);
    expect(open.sides.map((s) => s.votes)).toEqual([null, null]);
    expect(payload.nowPlaying.map((m) => m.id)).toEqual(['m2']);
    expect(JSON.stringify(payload.nowPlaying)).not.toContain('"votes":1');
  });

  it('carries names and results only: no cafe, no ids of rows beyond the match id', () => {
    expect(JSON.stringify(payload)).not.toContain('Secret Cafe');
    expect(payload).toMatchObject({
      eventName: 'Night',
      phase: 'live',
      competitors: 4,
      champion: null,
    });
  });

  it('gives a walkover no counts, only its kind, and a bye no empty opponent', () => {
    const b = deriveBracket({
      ...base,
      matches: [
        { ...base.matches[0], result_kind: 'walkover', walkover_winner_position: 2 },
        {
          id: 'm2',
          round_id: 'r1',
          position: 2,
          result_kind: 'bye',
          confirmed_at: 't',
          walkover_winner_position: null,
        },
      ],
      slots: [
        ...base.slots.slice(0, 2),
        { id: 's3', match_id: 'm2', position: 1, entry_id: 'eC' },
        { id: 's4', match_id: 'm2', position: 2, entry_id: null },
      ],
    });
    const p = assembleThrowdownPayload({ event: { name: 'x' }, bracket: b, activeCount: 3 });
    expect(p.rounds[0].matches[0]).toMatchObject({ resultKind: 'walkover' });
    expect(p.rounds[0].matches[0].sides.map((s) => s.votes)).toEqual([null, null]);
    expect(p.rounds[0].matches[1].sides).toHaveLength(1);
    expect(p.recent.map((m) => m.id)).toEqual(['m1']);
  });

  it('is in the setup phase before the draw', () => {
    const p = assembleThrowdownPayload({
      event: { name: 'x' },
      bracket: deriveBracket({ rounds: [], matches: [], slots: [], votes: [], entries }),
      activeCount: 4,
    });
    expect(p.phase).toBe('setup');
    expect(p.rounds).toEqual([]);
  });
});

describe('outbox registration', () => {
  it('has a handler for every operation type and a label for every handler', () => {
    const handlers = throwdownOutboxHandlers({ rpc: async () => ({}) });
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(throwdownOperationLabels).sort());
  });
});

describe('words', () => {
  it('chooses a refusal by hint, not by text', () => {
    expect(describeThrowdownError({ hint: 'td_votes_level', message: 'x' })).toMatch(/level/);
    expect(describeThrowdownError({ hint: 'td_setup_locked' })).toMatch(/locked/);
  });
  it('writes a result in words', () => {
    const [m] = deriveBracket(base).rounds[0].matches;
    expect(resultLine(m)).toBe('2 to 1');
    expect(resultLine({ resultKind: 'walkover' })).toBe('Walkover');
  });
});

describe('is_test on the live publish', () => {
  it('refuses to publish an event whose is_test is not an explicit boolean (D9)', async () => {
    await expect(
      publishThrowdownLive({ event: { id: 'e', org_id: 'o' }, takeOver: true }, {}),
    ).rejects.toThrow(/is_test/);
    await expect(
      publishThrowdownLive(
        { event: { id: 'e', org_id: 'o', is_test: undefined }, takeOver: true },
        {},
      ),
    ).rejects.toThrow(TypeError);
  });
  it('requires the composed handler map', async () => {
    await expect(
      publishThrowdownLive({ event: { id: 'e', org_id: 'o', is_test: true }, takeOver: true }),
    ).rejects.toThrow(/handler map/);
  });
});

describe('a match decided by scoresheets on the live payload', () => {
  const scoresheet = { preset: 'latte_art_v1', cups: { final: 2 } };
  const two = {
    ...base,
    matches: [{ ...base.matches[0], result_kind: 'scores', confirmed_at: '2026-11-27T10:00:00Z' }],
    slots: base.slots.slice(0, 2),
    votes: [],
    scoreWinners: new Map([['m1', 's2']]),
  };
  const pendingOne = {
    ...base,
    matches: [{ ...base.matches[0], result_kind: null, confirmed_at: null }],
    slots: base.slots.slice(0, 2),
    votes: [],
  };
  // every number, and every string with a digit in it, anywhere under a node. Only ids and the bracket's own
  // structure (a match's number in its round, the round's size, a route's wording) may carry a digit.
  const STRUCTURE = new Set(['id', 'number', 'roundSize', 'route', 'roundLabel', 'label']);
  const leaks = (node, key = '') => {
    if (STRUCTURE.has(key)) return [];
    if (typeof node === 'number') return [`${key}=${node}`];
    if (typeof node === 'string') return /\d/.test(node) ? [`${key}=${node}`] : [];
    if (node && typeof node === 'object')
      return Object.entries(node).flatMap(([k, v]) => leaks(v, k));
    return [];
  };
  const FORBIDDEN = /score|total|point|cup|judge_|preference|rule|sheet/i;
  const build = (rows, sheet) =>
    assembleThrowdownPayload({
      event: { name: 'Night' },
      bracket: deriveBracket(rows),
      activeCount: 2,
      scoresheet: sheet,
    });

  it('shows a decided one as its winner only: no score, total, judge count or rule anywhere', () => {
    const payload = build(two, scoresheet);
    const m = payload.rounds[0].matches[0];
    expect(m.sides.map((s) => s.winner)).toEqual([false, true]);
    expect(m.sides.every((s) => s.votes === null)).toBe(true);
    const keys = new Set();
    JSON.stringify(payload, (k, v) => {
      keys.add(k);
      return v;
    });
    expect([...keys].filter((k) => FORBIDDEN.test(k))).toEqual([]);
    expect(leaks(payload.rounds)).toEqual([]);
  });

  it('says only that judges are scoring while it is being decided, with no numbers', () => {
    const payload = build(pendingOne, scoresheet);
    expect(payload.nowPlaying[0].judging).toBe(true);
    expect(leaks(payload.nowPlaying)).toEqual([]);
  });

  it('leaves no trace when the module is off', () => {
    const payload = build(pendingOne, undefined);
    expect(JSON.stringify(payload)).not.toContain('judging');
  });

  it('does not mark a round the setup leaves to taps', () => {
    const payload = build(pendingOne, { preset: 'latte_art_v1', cups: { third_place: 1 } });
    expect(payload.nowPlaying[0]).not.toHaveProperty('judging');
  });
});

describe('the projector additions to the live payload', () => {
  const T = (m) => `2026-11-27T10:0${m}:00Z`;
  const sheet = { preset: 'latte_art_v1', cups: { final: 2 } };

  it('upNext and thenNext are the first two undecided playable matches in bracket order', () => {
    const payload = payloadFor({
      names: namesUpTo(8),
      rounds: [
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P2', result: [2, 1], at: T(1) },
            { a: 'P3', b: 'P4' },
            { a: 'P5', b: 'P6', result: [2, 1], at: T(2) },
            { a: 'P7', b: 'P8' },
          ],
        },
      ],
    });
    expect([payload.upNext.number, payload.thenNext.number]).toEqual([2, 4]);
    expect(payload.upNext).toMatchObject({ roundLabel: 'Quarter-finals', roundSize: 4 });
    expect(payload.upNext.sides.map((s) => s.name)).toEqual(['P3', 'P4']);
  });

  it('has neither before the draw nor when nothing is left to play', () => {
    const setup = payloadFor({ names: namesUpTo(4), rounds: [] });
    expect([setup.upNext, setup.thenNext]).toEqual([null, null]);
    expect(setup.competitorNames).toEqual(namesUpTo(4));
    const done = payloadFor({ names: namesUpTo(2), rounds: [roundOf(1, { decided: 1 })] });
    expect([done.upNext, done.thenNext]).toEqual([null, null]);
  });

  it('numbers every match in its round, and names a round the way a room says it', () => {
    const payload = payloadFor({ names: namesUpTo(16), rounds: [roundOf(8, { decided: 2 })] });
    expect(payload.rounds[0].matches.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(payload.rounds[0].roundLabel).toBe('Round of 16');
    expect(payload.rounds[0].label).toBe('Round 1');
  });

  it('a result carries its round, role and confirmed time; a vote split only when decided', () => {
    const payload = payloadFor({ names: namesUpTo(4), rounds: [roundOf(2, { decided: 2 })] });
    expect(payload.recent[0]).toMatchObject({
      roundLabel: 'Semi-finals',
      roundPhase: 'main',
      role: 'semi_final',
      confirmedAt: expect.any(String),
    });
    expect(payload.upNext).toBeNull();
  });

  it('routes: where each competitor came from, and nothing in round 1', () => {
    const r1 = roundOf(4, { decided: 4 });
    const payload = payloadFor({
      names: namesUpTo(8),
      rounds: [
        r1,
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P3' },
            { a: 'P5', b: 'P7' },
          ],
        },
      ],
    });
    expect(payload.upNext.sides.map((s) => s.route)).toEqual([
      'Won quarter-final match 1',
      'Won quarter-final match 2',
    ]);
    const first = payloadFor({ names: namesUpTo(8), rounds: [roundOf(4)] });
    expect(first.upNext.sides.map((s) => s.route)).toEqual([null, null]);
  });

  it('a scoresheet match shows only that it is being judged, and no number reaches upNext, thenNext or recent', () => {
    const payload = payloadFor({
      names: namesUpTo(4),
      scoresheet: sheet,
      rounds: [
        roundOf(2, { decided: 2 }),
        { phase: 'main', matches: [{ a: 'P1', b: 'P3' }] },
        { phase: 'third_place', matches: [{ a: 'P2', b: 'P4' }] },
      ],
    });
    expect(payload.upNext.judging).toBe(true);
    expect(payload.judgedRounds).toBe(true);
    const bare = (node, key = '') => {
      if (
        ['id', 'number', 'roundSize', 'route', 'roundLabel', 'label', 'confirmedAt'].includes(key)
      ) {
        return [];
      }
      if (typeof node === 'number') return [`${key}=${node}`];
      if (node && typeof node === 'object')
        return Object.entries(node).flatMap(([k, v]) => bare(v, k));
      return [];
    };
    expect(bare(payload.upNext)).toEqual([]);
    expect(bare(payload.thenNext)).toEqual([]);
    const decided = payloadFor({
      names: ['Ana', 'Bima'],
      scoresheet: sheet,
      rounds: [{ phase: 'main', matches: [{ a: 'Ana', b: 'Bima', result: 'scores:1' }] }],
    });
    expect(bare(decided.recent)).toEqual([]);
    expect(decided.recent[0].sides.map((s) => s.votes)).toEqual([null, null]);
    expect(JSON.stringify(decided)).not.toMatch(/judge_|points|total/i);
  });

  it('says only whether judged rounds exist, with the module off leaving no trace', () => {
    const payload = payloadFor({ names: namesUpTo(4), rounds: [roundOf(2)] });
    expect(payload.judgedRounds).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('judging');
  });

  it('stillIn lists who is left, and is null until somebody is out', () => {
    const none = payloadFor({ names: namesUpTo(8), rounds: [roundOf(4)] });
    expect(none.stillIn).toBeNull();
    const some = payloadFor({ names: namesUpTo(8), rounds: [roundOf(4, { decided: 1 })] });
    expect(some.stillIn.of).toBe(8);
    expect(some.stillIn.names.map((n) => n.name)).toEqual([
      'P1',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'P8',
    ]);
    expect(some.stillIn.names.filter((n) => n.next).map((n) => n.name)).toEqual(['P3', 'P4']);
  });
});
