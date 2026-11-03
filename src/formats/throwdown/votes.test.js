import { describe, it, expect } from 'vitest';
import { tallyVotes, leadOf, canConfirm } from './votes.js';

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
