import { describe, expect, it } from 'vitest';
import { BRACKET_ROUND_LABELS } from './bracket.js';
import { BRACKET_COLUMNS } from './projectorScreens.js';
import { roundHeading, roundLabel } from './roundNames.js';

describe('BTC round names', () => {
  it('keeps the organiser bracket, projector columns, and phone heading vocabulary aligned', () => {
    const rounds = ['quarterfinal', 'semifinal', 'final', 'third_place'];
    const expectedHeadings = rounds.map(roundHeading);

    expect(expectedHeadings).toEqual(['Quarter-finals', 'Semi-finals', 'Final', 'Third place']);
    expect(rounds.map(roundLabel)).toEqual(['Quarter-final', 'Semi-final', 'Final', 'Third place']);
    // The organiser renders BRACKET_ROUND_LABELS; the phone calls roundHeading directly.
    expect(rounds.map((round) => BRACKET_ROUND_LABELS[round])).toEqual(expectedHeadings);
    // The projector's last column combines the two singular labels used for its slot labels.
    expect(BRACKET_COLUMNS.map(({ head }) => head)).toEqual([
      expectedHeadings[0],
      expectedHeadings[1],
      `${roundLabel('final')} and ${roundLabel('third_place').toLowerCase()}`,
    ]);
  });
});
