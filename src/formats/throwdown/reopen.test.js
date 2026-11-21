import { describe, it, expect } from 'vitest';
import { reopenState, reopenWords, matchesAwaitingUndo } from './reopen.js';

// A small hand-built bracket in deriveBracket's shape: just the fields reopen.js reads.
const side = (slotId, name, { winner = null, votes = 0 } = {}) => ({ slotId, name, winner, votes });
const match = (id, { decided = false, isBye = false, resultKind = null, sides } = {}) => ({
  id,
  decided,
  isBye,
  resultKind: resultKind ?? (decided ? (isBye ? 'bye' : 'votes') : null),
  sides: sides ?? [
    side(`${id}a`, `${id}-A`, { winner: decided ? true : null }),
    side(`${id}b`, `${id}-B`, { winner: decided ? false : null }),
  ],
});
const round = (position, phase, matches) => ({ position, phase, matches });

function semisDone({ final = match('f'), third = match('t') } = {}) {
  return {
    rounds: [
      round(1, 'main', [match('s1', { decided: true }), match('s2', { decided: true })]),
      round(2, 'third_place', [third]),
      round(3, 'main', [final]),
    ],
  };
}

describe('reopenState: when a confirmed match can be undone', () => {
  it('offers it for a semi-final while the 3rd place match and the Final have not started, naming them', () => {
    const s = reopenState(semisDone(), 's1');
    expect(s.allowed).toBe(true);
    expect(s.later.map((r) => r.phase)).toEqual(['third_place', 'main']);
  });

  it('offers it when the round has no later round yet', () => {
    const bracket = { rounds: [round(1, 'main', [match('a', { decided: true }), match('b')])] };
    expect(reopenState(bracket, 'a')).toEqual({ allowed: true, later: [] });
  });

  it('does not offer it for an undecided match or a bye', () => {
    const bracket = {
      rounds: [round(1, 'main', [match('a'), match('b', { decided: true, isBye: true })])],
    };
    expect(reopenState(bracket, 'a').reason).toBe('not_decided');
    expect(reopenState(bracket, 'b').reason).toBe('bye');
    expect(reopenState(bracket, 'nope').reason).toBe('not_decided');
  });

  it.each([
    [
      'a tap in the Final',
      { final: match('f', { sides: [side('fa', 'A', { votes: 1 }), side('fb', 'B')] }) },
    ],
    [
      'a tap in the 3rd place match',
      { third: match('t', { sides: [side('ta', 'A'), side('tb', 'B', { votes: 2 })] }) },
    ],
    ['a decided 3rd place match', { third: match('t', { decided: true }) }],
  ])('refuses a semi-final once the next round has started: %s', (_, parts) => {
    expect(reopenState(semisDone(parts), 's1')).toEqual({
      allowed: false,
      reason: 'next_round_started',
    });
  });

  it('counts a score sheet in a later match as started', () => {
    expect(reopenState(semisDone(), 's1', { sheets: [{ match_id: 'f' }] }).reason).toBe(
      'next_round_started',
    );
  });

  it('counts work still waiting on this device in a later match as started', () => {
    const queuedTap = new Map([['f', { queued: 1, decisionQueued: false, sheets: new Map() }]]);
    const queuedSheet = new Map([
      ['t', { queued: 0, decisionQueued: false, sheets: new Map([['x:1', {}]]) }],
    ]);
    const queuedConfirm = new Map([['f', { queued: 0, decisionQueued: true, sheets: new Map() }]]);
    for (const pending of [queuedTap, queuedSheet, queuedConfirm]) {
      expect(reopenState(semisDone(), 's1', { pending }).reason).toBe('next_round_started');
    }
  });

  it('a bye in the next round does not count as started', () => {
    const bracket = {
      rounds: [
        round(1, 'main', [
          match('a', { decided: true }),
          match('b', { decided: true }),
          match('c', { decided: true }),
        ]),
        round(2, 'main', [match('d'), match('e', { decided: true, isBye: true })]),
      ],
    };
    expect(reopenState(bracket, 'a').allowed).toBe(true);
  });

  it('always offers it for the 3rd place match and the Final (nothing after them), even with the other live', () => {
    const live = semisDone({
      third: match('t', { decided: true }),
      final: match('f', { decided: true }),
    });
    expect(reopenState(live, 't')).toEqual({ allowed: true, later: [] });
    expect(reopenState(live, 'f')).toEqual({ allowed: true, later: [] });
  });

  it('does not offer it again while an undo of the same match is waiting to sync', () => {
    const pending = new Map([['s1', { reopenQueued: true }]]);
    expect(reopenState(semisDone(), 's1', { pending }).reason).toBe('queued');
  });
});

describe('reopenWords', () => {
  const won = match('s1', { decided: true });
  it('names the winner, says the votes are kept, and reminds about published results', () => {
    const w = reopenWords(won, []);
    expect(w.question).toBe('Undo s1-A’s win?');
    expect(w.detail).toContain('votes kept');
    expect(w.detail).toContain('publish them again');
    expect(w.detail).not.toContain('removed');
  });
  it('says which later rounds are removed', () => {
    expect(reopenWords(won, [{ phase: 'third_place' }, { phase: 'main' }]).detail).toContain(
      'The 3rd place match and the Final are removed',
    );
    expect(reopenWords(won, [{ phase: 'main' }]).detail).toContain('The next round is removed');
  });
  it('words a walkover and a scored match for what they keep', () => {
    expect(reopenWords({ ...won, resultKind: 'walkover' }, []).detail).toMatch(
      /^The match goes back to open\. /,
    );
    expect(reopenWords({ ...won, resultKind: 'scores' }, [], { scored: true }).detail).toContain(
      'scoresheets kept',
    );
  });
});

describe('matchesAwaitingUndo: what a queued undo will remove', () => {
  it('is every match after the main round whose undo is queued, and nothing before it', () => {
    const bracket = {
      rounds: [
        round(1, 'main', [match('q1', { decided: true }), match('q2', { decided: true })]),
        round(2, 'main', [match('s1', { decided: true }), match('s2', { decided: true })]),
        round(3, 'third_place', [match('t')]),
        round(4, 'main', [match('f')]),
      ],
    };
    expect([...matchesAwaitingUndo(bracket, new Map([['s1', { reopenQueued: true }]]))]).toEqual([
      't',
      'f',
    ]);
    // the earliest queued undo wins: undoing a quarter-final removes the semi-finals too
    expect([
      ...matchesAwaitingUndo(
        bracket,
        new Map([
          ['s1', { reopenQueued: true }],
          ['q2', { reopenQueued: true }],
        ]),
      ),
    ]).toEqual(['s1', 's2', 't', 'f']);
  });

  it('is empty with no queued undo, or when only the 3rd place match or the Final is being undone', () => {
    const bracket = semisDone({
      third: match('t', { decided: true }),
      final: match('f', { decided: true }),
    });
    expect(matchesAwaitingUndo(bracket, new Map()).size).toBe(0);
    expect(matchesAwaitingUndo(bracket, new Map([['t', { reopenQueued: true }]])).size).toBe(0);
    expect(matchesAwaitingUndo(bracket, new Map([['f', { reopenQueued: true }]])).size).toBe(0);
  });
});
