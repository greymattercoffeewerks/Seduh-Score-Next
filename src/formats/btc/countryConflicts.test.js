import { describe, it, expect } from 'vitest';
import { judgeCountryConflicts } from './countryConflicts.js';

const teams = [
  { id: 't1', country_code: 'BN' },
  { id: 't2', country_code: 'BN' },
  { id: 't3', country_code: 'SG' },
  { id: 't4', country_code: null },
];
const judges = [
  { id: 'j1', country_code: 'BN' },
  { id: 'j2', country_code: 'SG' },
  { id: 'j3', country_code: 'MY' },
  { id: 'j4', country_code: null },
];

describe('judgeCountryConflicts', () => {
  it('is empty when no judge shares a country', () => {
    expect(
      judgeCountryConflicts({
        judges,
        teams,
        team1Id: 't3',
        team2Id: 't4',
        judgeIds: ['j1', 'j3'],
      }),
    ).toEqual([]);
  });

  it('names the judge and the team that share a country', () => {
    expect(
      judgeCountryConflicts({
        judges,
        teams,
        team1Id: 't1',
        team2Id: 't3',
        judgeIds: ['j1', 'j3'],
      }),
    ).toEqual([{ judgeId: 'j1', teamId: 't1' }]);
  });

  it('gives two entries for a judge from the country of both teams', () => {
    expect(
      judgeCountryConflicts({ judges, teams, team1Id: 't1', team2Id: 't2', judgeIds: ['j1'] }),
    ).toEqual([
      { judgeId: 'j1', teamId: 't1' },
      { judgeId: 'j1', teamId: 't2' },
    ]);
  });

  it('never conflicts when either side has no country', () => {
    expect(
      judgeCountryConflicts({
        judges,
        teams,
        team1Id: 't4',
        team2Id: 't4',
        judgeIds: ['j4', 'j1'],
      }),
    ).toEqual([]);
    expect(
      judgeCountryConflicts({ judges, teams, team1Id: 't1', team2Id: 't2', judgeIds: ['j4'] }),
    ).toEqual([]);
  });

  it('counts only the selected judges', () => {
    expect(
      judgeCountryConflicts({ judges, teams, team1Id: 't1', team2Id: 't3', judgeIds: ['j3'] }),
    ).toEqual([]);
  });

  it('ignores an unknown id and an unchosen team', () => {
    expect(
      judgeCountryConflicts({
        judges,
        teams,
        team1Id: 'nope',
        team2Id: '',
        judgeIds: ['j1', 'ghost'],
      }),
    ).toEqual([]);
    expect(
      judgeCountryConflicts({
        judges,
        teams,
        team1Id: 't1',
        team2Id: '',
        judgeIds: ['j1', 'ghost'],
      }),
    ).toEqual([{ judgeId: 'j1', teamId: 't1' }]);
  });

  it('does not double-count the same team chosen twice', () => {
    expect(
      judgeCountryConflicts({ judges, teams, team1Id: 't1', team2Id: 't1', judgeIds: ['j1'] }),
    ).toEqual([{ judgeId: 'j1', teamId: 't1' }]);
  });
});
