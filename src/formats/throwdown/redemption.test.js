import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { bracketRows, namesUpTo } from './projectorFixtures.js';
import {
  groupSizes,
  redemptionForm,
  redemptionModuleFromForm,
  redemptionProblem,
  feedWords,
  redemptionSummary,
  redemptionRounds,
  redemptionRoundWords,
  revivedCounts,
  redemptionOn,
  hasRedemptionRound,
} from './redemption.js';
import { tallyVotes, voteState, tiedSlotIds, leadOf } from './votes.js';
import { matchTitle, resultLine, listWords } from './words.js';
import { reopenState, matchesAwaitingUndo } from './reopen.js';
import { MODULES } from './modules.js';

describe('group sizes (the same cases as pgTAP 095, app.td_group_sizes)', () => {
  const cases = [
    [2, 3, [2]],
    [3, 3, [3]],
    [4, 3, [2, 2]],
    [5, 3, [3, 2]],
    [7, 3, [3, 2, 2]],
    [8, 4, [4, 4]],
    [5, 4, [3, 2]],
    [13, 4, [4, 3, 3, 3]],
    [3, 2, [3]],
    [9, 2, [3, 2, 2, 2]],
    [16, 2, Array(8).fill(2)],
    [1, 3, []],
    [6, 5, []],
  ];
  it.each(cases)('a pool of %i in groups of %i is %j', (pool, size, expected) => {
    expect(groupSizes(pool, size)).toEqual(expected);
  });
  it('never makes a group of one, and never a group larger than 4', () => {
    for (let pool = 2; pool <= 60; pool += 1) {
      for (const size of [2, 3, 4]) {
        const sizes = groupSizes(pool, size);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(pool);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the setup form', () => {
  it('starts off, with groups of 3, no cap and Round 1 feeding it', () => {
    expect(redemptionForm(null)).toEqual({ on: false, groupSize: 3, cap: 0, feed: [1] });
  });
  it('reads what is saved', () => {
    expect(redemptionForm({ group_size: 4, cap: 2, feed: [1, 2] })).toEqual({
      on: true,
      groupSize: 4,
      cap: 2,
      feed: [1, 2],
    });
  });
  it('stores nothing when off, and exactly group_size, cap and a sorted distinct feed when on', () => {
    expect(redemptionModuleFromForm({ on: false, groupSize: 3, cap: 0, feed: [1] })).toEqual({});
    expect(redemptionModuleFromForm({ on: true, groupSize: 2, cap: 3, feed: [2, 1, 2] })).toEqual({
      redemption: { group_size: 2, cap: 3, feed: [1, 2] },
    });
  });
  it('names a problem in a form that the database would refuse', () => {
    const ok = { on: true, groupSize: 3, cap: 0, feed: [1] };
    expect(redemptionProblem(ok)).toBeNull();
    expect(redemptionProblem({ ...ok, on: false, feed: [] })).toBeNull();
    expect(redemptionProblem({ ...ok, groupSize: 5 })).toBe('group_size');
    expect(redemptionProblem({ ...ok, groupSize: 1 })).toBe('group_size');
    expect(redemptionProblem({ ...ok, cap: -1 })).toBe('cap');
    expect(redemptionProblem({ ...ok, cap: Number.NaN })).toBe('cap');
    expect(redemptionProblem({ ...ok, cap: 1.5 })).toBe('cap');
    expect(redemptionProblem({ ...ok, feed: [] })).toBe('feed');
    expect(redemptionProblem({ ...ok, feed: [5] })).toBe('feed');
  });
  it('says the feeding rounds and the saved setup in words', () => {
    expect(feedWords([1])).toBe('after Round 1');
    expect(feedWords([2, 1])).toBe('after Rounds 1 and 2');
    expect(feedWords([1, 2, 3])).toBe('after Rounds 1, 2 and 3');
    expect(redemptionSummary(null)).toBeNull();
    expect(redemptionSummary({ group_size: 3, cap: 0, feed: [1] })).toBe(
      'Redemption after Round 1: groups of 3, everyone who wins a group comes back.',
    );
    expect(redemptionSummary({ group_size: 2, cap: 4, feed: [1, 2] })).toContain(
      'at most 4 come back',
    );
  });
  it('is a registered module with the Per-event key, and "on" is read from the saved setup', () => {
    expect(MODULES.find((m) => m.key === 'redemption')).toMatchObject({
      entitlementKey: 'throwdown_redemption',
      requires: [],
    });
    expect(redemptionOn({ modules: { redemption: { feed: [1] } } })).toBe(true);
    expect(redemptionOn({ modules: {} })).toBe(false);
    expect(redemptionOn(null)).toBe(false);
  });
});

// two redemption rounds in one event: Round 1 (4 matches), Redemption 1 (two groups), Round 2, Redemption 2
function twice() {
  const description = {
    names: namesUpTo(8),
    rounds: [
      {
        phase: 'main',
        matches: [
          { a: 'P1', b: 'P2', result: [2, 1] },
          { a: 'P3', b: 'P4', result: [2, 1] },
        ],
      },
      {
        phase: 'redemption',
        kind: 'pool',
        matches: [{ sides: ['P2', 'P4'], result: [2, 1] }],
      },
      {
        phase: 'main',
        matches: [
          { a: 'P1', b: 'P3', result: [1, 2] },
          { a: 'P2', b: 'P5' },
        ],
      },
      { phase: 'redemption', kind: 'pool', matches: [{ sides: ['P1', 'P4', 'P5'] }] },
    ],
  };
  return deriveBracket({ ...bracketRows(description), redemptionRounds: 2 });
}

describe('the redemption page model', () => {
  it('lists the redemption rounds in order, with the round that fed each and who is in', () => {
    const rounds = redemptionRounds(twice());
    expect(rounds.map((r) => [r.label, r.feedLabel, r.status, r.groupCount])).toEqual([
      ['Redemption 1', 'Semi-finals', 'done', 1],
      ['Redemption 2', 'Semi-finals', 'drawn', 1],
    ]);
    expect(rounds[0].entrants).toEqual(['P2', 'P4']);
    expect(rounds[0].returning).toEqual(['P2']);
    expect(rounds[1].returning).toEqual([]);
    expect(rounds[1].entrants).toEqual(['P1', 'P4', 'P5']);
  });
  it('numbers the rounds when the event can have more than one, and not otherwise', () => {
    const single = deriveBracket(
      bracketRows({
        names: namesUpTo(4),
        rounds: [
          { phase: 'main', matches: [{ a: 'P1', b: 'P2', result: [2, 1] }] },
          { phase: 'redemption', kind: 'pool', matches: [{ sides: ['P2', 'P3'] }] },
        ],
      }),
    );
    expect(single.rounds[1].label).toBe('Redemption');
    expect(
      twice()
        .rounds.filter((r) => r.phase === 'redemption')
        .map((r) => r.label),
    ).toEqual(['Redemption 1', 'Redemption 2']);
  });
  it('counts how many times a brewer has been brought back, never blocking anyone', () => {
    const counts = revivedCounts(twice());
    expect(counts.get('eP2')).toBe(1);
    expect(counts.has('eP4')).toBe(false);
  });
  it('says how far a round has got, in words', () => {
    const [done, drawn] = redemptionRounds(twice());
    expect(redemptionRoundWords(done)).toBe(
      '2 brewers in 1 group. Every group is decided: 1 winner goes back into the bracket.',
    );
    expect(redemptionRoundWords(drawn)).toBe('3 brewers drawn into 1 group. No votes yet.');
    expect(hasRedemptionRound(twice())).toBe(true);
  });
});

describe('voting a group (the same cases as pgTAP 095)', () => {
  const slots = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, position: i + 1, entryId: `e${id}` }));
  const tally = (...counts) =>
    tallyVotes(
      slots.slice(0, counts.length),
      counts.flatMap((n, i) => Array(n).fill({ slotId: slots[i].id })),
    );

  it('names who is tied at the top, and nobody before the first vote', () => {
    expect(tiedSlotIds(tally(0, 0, 0))).toEqual([]);
    expect(tiedSlotIds(tally(2, 1, 0))).toEqual(['a']);
    expect(tiedSlotIds(tally(2, 2, 0, 0))).toEqual(['a', 'b']);
    expect(tiedSlotIds(tally(1, 1, 1))).toEqual(['a', 'b', 'c']);
  });
  it('a three-way tie of an odd panel (1-1-1 of three judges) opens ONE tie-break vote', () => {
    const state = voteState(tally(1, 1, 1), 3);
    expect(state).toMatchObject({ total: 3, open: true, tieBreakOpen: true, tieBreakUsed: false });
  });
  it('after the tie-break vote the group is full, and decided', () => {
    const state = voteState(tally(2, 1, 1), 3);
    expect(state).toMatchObject({ total: 4, open: false, tieBreakOpen: false, tieBreakUsed: true });
    expect(leadOf(tally(2, 1, 1)).leaderSlotId).toBe('a');
  });
  it('a group where one brewer has strictly the most votes is decided without a tie-break', () => {
    expect(voteState(tally(2, 1, 0), 3)).toMatchObject({ open: false, tieBreakOpen: false });
    expect(leadOf(tally(2, 1, 0)).level).toBe(false);
  });
  it('four judges, 2-2-0-0: level, tie-break open for the two tied only', () => {
    const t = tally(2, 2, 0, 0);
    expect(voteState(t, 4).tieBreakOpen).toBe(true);
    expect(tiedSlotIds(t)).toEqual(['a', 'b']);
    expect(leadOf(t).level).toBe(true);
  });
  it('more taps than the rule allows is "over", pair or group', () => {
    expect(voteState(tally(2, 2, 1), 3).over).toBe(true);
    expect(voteState(tally(2, 1, 1, 1), 3).over).toBe(true);
  });
  it('a pair keeps the old rule: the tie-break exists only for an even panel', () => {
    const pair = tallyVotes(slots.slice(0, 2), [{ slotId: 'a' }, { slotId: 'b' }]);
    expect(voteState(pair, 2).tieBreakOpen).toBe(true);
    const three = tallyVotes(slots.slice(0, 2), [
      { slotId: 'a' },
      { slotId: 'a' },
      { slotId: 'b' },
    ]);
    expect(voteState(three, 3)).toMatchObject({ open: false, tieBreakUsed: false });
  });
});

describe('words for a group', () => {
  const group = {
    isPool: true,
    isBye: false,
    position: 2,
    resultKind: 'votes',
    sides: [
      { entryId: 'a', name: 'Ana', votes: 1 },
      { entryId: 'b', name: 'Bima', votes: 2 },
      { entryId: 'c', name: 'Citra', votes: 0 },
    ],
  };
  it('titles a group "Group n: A, B and C", never as a duel', () => {
    expect(matchTitle(group)).toBe('Group 2: Ana, Bima and Citra');
    expect(matchTitle({ ...group, isPool: false, sides: group.sides.slice(0, 2) })).toBe(
      'Ana vs Bima',
    );
  });
  it("words a group result as every brewer's votes, most first", () => {
    expect(resultLine(group)).toBe('2 to 1 to 0');
    expect(resultLine({ ...group, sides: group.sides.slice(0, 2) })).toBe('1 to 2');
  });
  it('lists names', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['A'])).toBe('A');
    expect(listWords(['A', 'B'])).toBe('A and B');
    expect(listWords(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('undoing a result around a redemption round (the same rule as td_reopen_match)', () => {
  const bracket = () =>
    deriveBracket(
      bracketRows({
        names: namesUpTo(4),
        rounds: [
          {
            phase: 'main',
            matches: [
              { a: 'P1', b: 'P2', result: [2, 1] },
              { a: 'P3', b: 'P4', result: [2, 1] },
            ],
          },
          { phase: 'redemption', kind: 'pool', matches: [{ sides: ['P2', 'P4'], result: [2, 1] }] },
          {
            phase: 'main',
            matches: [
              { a: 'P1', b: 'P3' },
              { a: 'P2', b: 'P5' },
            ],
          },
        ],
      }),
    );
  it('a decided group can be undone while the next round has not started, and removes the rounds after it', () => {
    const b = bracket();
    const group = b.rounds[1].matches[0].id;
    const state = reopenState(b, group);
    expect(state.allowed).toBe(true);
    expect(state.later.map((r) => r.position)).toEqual([3]);
  });
  it('is refused once a later round has a vote', () => {
    const b = bracket();
    b.rounds[2].matches[0].sides[0].votes = 1;
    expect(reopenState(b, b.rounds[1].matches[0].id)).toMatchObject({
      allowed: false,
      reason: 'next_round_started',
    });
  });
  it('an undo of a group waiting on this device hides the rounds after it', () => {
    const b = bracket();
    const group = b.rounds[1].matches[0].id;
    const pending = new Map([[group, { reopenQueued: true }]]);
    expect([...matchesAwaitingUndo(b, pending)]).toEqual(b.rounds[2].matches.map((m) => m.id));
  });
});
