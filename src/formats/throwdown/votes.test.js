import { describe, it, expect } from 'vitest';
import { tallyVotes, leadOf, canConfirm, voteState } from './votes.js';

const slots = [
  { id: 's2', position: 2, entryId: 'e2' },
  { id: 's1', position: 1, entryId: 'e1' },
];
const taps = (...ids) => ids.map((slotId) => ({ slotId }));

describe('tallyVotes', () => {
  it('counts vote rows per slot, in slot order, and ignores rows for slots that are not in the match', () => {
    expect(tallyVotes(slots, taps('s1', 's2', 's1', 'other'))).toEqual([
      { slotId: 's1', position: 1, votes: 2 },
      { slotId: 's2', position: 2, votes: 1 },
    ]);
  });

  it('gives zero for a slot nobody voted for, and leaves out an empty slot (the opponent of a bye)', () => {
    const withBye = [...slots, { id: 's3', position: 3, entryId: null }];
    expect(tallyVotes(withBye, [])).toEqual([
      { slotId: 's1', position: 1, votes: 0 },
      { slotId: 's2', position: 2, votes: 0 },
    ]);
  });
});

describe('leadOf and canConfirm', () => {
  const lead = (...ids) => leadOf(tallyVotes(slots, taps(...ids)));

  it('names the slot with strictly the most votes as the leader', () => {
    expect(lead('s1', 's1', 's2')).toMatchObject({ leaderSlotId: 's1', level: false, total: 3 });
    expect(lead('s2', 's2', 's2')).toMatchObject({ leaderSlotId: 's2', level: false });
  });

  it('is level, with no leader, when the votes are equal (including 1-1 and 2-2)', () => {
    expect(lead('s1', 's2')).toMatchObject({ leaderSlotId: null, level: true });
    expect(lead('s1', 's1', 's2', 's2')).toMatchObject({ leaderSlotId: null, level: true });
  });

  it('is level before anyone has voted (0-0), so nothing can be confirmed on no evidence', () => {
    expect(lead()).toMatchObject({ leaderSlotId: null, level: true, total: 0 });
  });

  it('enables confirm only while there is a strict leader', () => {
    const can = (...ids) => canConfirm(tallyVotes(slots, taps(...ids)));
    expect(can()).toBe(false);
    expect(can('s1', 's2')).toBe(false);
    expect(can('s1')).toBe(true);
    expect(can('s1', 's2', 's2')).toBe(true);
    // an even panel that splits and is then broken by one extra tap
    expect(can('s1', 's1', 's2', 's2')).toBe(false);
    expect(can('s1', 's1', 's2', 's2', 's1')).toBe(true);
  });

  it('cannot confirm a match with fewer than two competitors', () => {
    expect(canConfirm(tallyVotes([slots[0]], taps('s1')))).toBe(false);
  });
});

// The same cases as pgTAP 072's judge-cap sections: the screen and td_cast_vote must agree on every one.
describe('voteState: the judge cap and the one tie-break vote', () => {
  const state = (judges, ...ids) => voteState(tallyVotes(slots, taps(...ids)), judges);

  it('stays open while judges are still voting, level or not', () => {
    expect(state(3).open).toBe(true);
    expect(state(3, 's1', 's2')).toMatchObject({ open: true, tieBreakOpen: false, over: false });
  });

  it('closes an odd panel once every judge is in (it can never be level there)', () => {
    expect(state(3, 's1', 's1', 's2')).toMatchObject({
      open: false,
      tieBreakOpen: false,
      tieBreakUsed: false,
      over: false,
    });
  });

  it('closes an even panel that is NOT level once every judge is in (2-0 takes no tie-break)', () => {
    expect(state(2, 's1', 's1')).toMatchObject({ open: false, tieBreakOpen: false, over: false });
  });

  it('opens exactly one tie-break vote when an even panel is level, then closes', () => {
    expect(state(2, 's1', 's2')).toMatchObject({ open: true, tieBreakOpen: true });
    expect(state(4, 's1', 's1', 's2', 's2')).toMatchObject({ open: true, tieBreakOpen: true });
    expect(state(2, 's1', 's2', 's1')).toMatchObject({
      open: false,
      tieBreakUsed: true,
      over: false,
    });
  });

  it('calls anything past that over the cap, and never reopens it, level or not', () => {
    expect(state(3, 's1', 's1', 's1', 's2')).toMatchObject({
      open: false,
      tieBreakUsed: false,
      over: true,
    });
    expect(state(2, 's1', 's2', 's1', 's2')).toMatchObject({
      open: false,
      tieBreakOpen: false,
      over: true,
    });
    expect(state(2, 's1', 's1', 's1')).toMatchObject({
      open: false,
      tieBreakUsed: false,
      over: true,
    });
  });

  it('agrees with the database rule for every split of every panel size', () => {
    // td_cast_vote: open iff total < judges, or total = judges and more than one competitor shares the top count
    for (let judges = 1; judges <= 15; judges += 1) {
      for (let a = 0; a <= judges + 2; a += 1) {
        for (let b = 0; b <= judges + 2; b += 1) {
          const total = a + b;
          const sqlOpen = total < judges || (total === judges && a === b);
          const ids = [...Array(a).fill('s1'), ...Array(b).fill('s2')];
          expect(state(judges, ...ids).open, `${judges} judges at ${a}-${b}`).toBe(sqlOpen);
        }
      }
    }
  });
});
