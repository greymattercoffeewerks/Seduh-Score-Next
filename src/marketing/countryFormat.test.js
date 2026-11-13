import { describe, expect, it } from 'vitest';
import {
  ASEAN_MEMBERS,
  addressText,
  finishText,
  groupCountries,
  ordinal,
  plural,
  roundsSpoken,
  roundsText,
  yearsText,
} from './countryFormat.js';

describe('roundsText', () => {
  it('writes preliminaries as two summed rounds and knockout rounds as one score, in the order given', () => {
    expect(
      roundsText([
        { round: 'preliminary', r1: 42, r2: 31, score: 73 },
        { round: 'quarter_final', r1: null, r2: null, score: 26 },
      ]),
    ).toBe('Prelims 42+31=73 · QF 26');
  });
  it('is empty for no rounds, and names the final whichever side it was', () => {
    expect(roundsText([])).toBe('');
    expect(roundsText([{ round: 'final_runner_up', r1: null, r2: null, score: 19 }])).toBe(
      'Final 19',
    );
  });
  it('speaks in words, and says only what the screen shows (no opponent)', () => {
    const text = roundsSpoken([
      { round: 'preliminary', r1: 42, r2: 31, score: 73, opponentTeamName: null },
      {
        round: 'quarter_final',
        r1: null,
        r2: null,
        score: 26,
        opponentTeamName: 'Rival',
        opponentScore: 20,
      },
    ]);
    expect(text).toBe('Prelims: 42 plus 31, total 73. Quarter-final: 26');
  });
});

describe('words', () => {
  it('says the finish with the published number where there is one', () => {
    expect(finishText('champion', 1)).toBe('Champion');
    expect(finishText('final', 2)).toBe('Runner-up');
    expect(finishText('semi_final', 4)).toBe('4th place');
    expect(finishText('semi_final', null)).toBe('Semi-final');
    expect(finishText('preliminary', null)).toBe('Preliminaries');
  });
  it('writes ordinals, including 11th to 13th', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
    ]);
  });
  it('lists years and plurals', () => {
    expect(yearsText([2026, 2023, 2024])).toBe('2023, 2024 and 2026');
    expect(yearsText([2025])).toBe('2025');
    expect(plural(1, 'team')).toBe('1 team');
    expect(plural(2, 'team')).toBe('2 teams');
    expect(addressText('https://www.seduhscore.com/id/country/bn/')).toBe(
      'seduhscore.com/id/country/bn',
    );
  });
});

describe('groupCountries', () => {
  it('knows all eleven ASEAN members', () => {
    expect([...ASEAN_MEMBERS].sort()).toEqual([
      'BN',
      'ID',
      'KH',
      'LA',
      'MM',
      'MY',
      'PH',
      'SG',
      'TH',
      'TL',
      'VN',
    ]);
  });
  it('puts ASEAN members first and guests after, each by name', () => {
    const rows = ['TW', 'TH', 'BN', 'HK', 'ID'].map((code) => ({ code }));
    const { members, guests } = groupCountries(rows);
    expect(members.map((r) => r.code)).toEqual(['BN', 'ID', 'TH']);
    expect(guests.map((r) => r.code)).toEqual(['HK', 'TW']);
  });
});
