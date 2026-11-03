import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { assembleThrowdownPayload } from './liveSession.js';
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
