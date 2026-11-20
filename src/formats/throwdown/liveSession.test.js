import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { assembleThrowdownPayload, publishThrowdownLive } from './liveSession.js';
import { throwdownOutboxHandlers, throwdownOperationLabels } from './outboxHandlers.js';
import { describeThrowdownError, resultLine } from './words.js';

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
  // every number, and every string with a digit in it (ids aside), anywhere under a node
  const leaks = (node, key = '') => {
    if (typeof node === 'number') return [`${key}=${node}`];
    if (typeof node === 'string') return key !== 'id' && /\d/.test(node) ? [`${key}=${node}`] : [];
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
