import { describe, it, expect } from 'vitest';
import {
  canRemoveMatch,
  hasCupScores,
  matchScoreText,
  matchStatusView,
  missingTime,
} from './matchList.js';

const scored = { team1_tokens: 6, team2_tokens: 6, team1_total: 11, team2_total: 6 };
const unscored = { team1_tokens: 0, team2_tokens: 0, team1_total: 0, team2_total: 0 };

describe('canRemoveMatch (Q7: only before scoring starts)', () => {
  it('allows a pending match with no cup scores', () => {
    expect(canRemoveMatch({ status: 'pending' }, undefined)).toBe(true);
    expect(canRemoveMatch({ status: 'pending' }, unscored)).toBe(true);
  });

  it('treats a match with no status as pending (the database default)', () => {
    expect(canRemoveMatch({}, undefined)).toBe(true);
  });

  it('refuses a match that is in scoring', () => {
    expect(canRemoveMatch({ status: 'scoring' }, undefined)).toBe(false);
  });

  it('refuses a confirmed match', () => {
    expect(canRemoveMatch({ status: 'confirmed' }, scored)).toBe(false);
  });

  it('refuses a pending match that already holds cup scores', () => {
    expect(canRemoveMatch({ status: 'pending' }, scored)).toBe(false);
  });

  it('refuses when the scores could not be read (cannot prove there are none)', () => {
    expect(canRemoveMatch({ status: 'pending' }, undefined, false)).toBe(false);
  });
});

describe('hasCupScores', () => {
  it('is true once any cup token is recorded', () => {
    expect(hasCupScores(scored)).toBe(true);
    expect(hasCupScores({ team1_tokens: 0, team2_tokens: 3 })).toBe(true);
    expect(hasCupScores(unscored)).toBe(false);
    expect(hasCupScores(undefined)).toBe(false);
  });
});

describe('matchStatusView', () => {
  it('maps the three database statuses to words and a tone', () => {
    expect(matchStatusView({ status: 'pending' })).toEqual({
      label: 'Scheduled',
      tone: 'not_started',
    });
    expect(matchStatusView({ status: 'scoring' })).toEqual({
      label: 'Scoring',
      tone: 'in_progress',
    });
    expect(matchStatusView({ status: 'confirmed' })).toEqual({ label: 'Confirmed', tone: 'done' });
    expect(matchStatusView({})).toEqual({ label: 'Scheduled', tone: 'not_started' });
  });
});

describe('matchScoreText', () => {
  it('shows the bonus-inclusive totals only once confirmed', () => {
    expect(matchScoreText({ status: 'confirmed' }, scored)).toBe('11 – 6');
    expect(matchScoreText({ status: 'pending' }, scored)).toBeNull();
    expect(matchScoreText({ status: 'confirmed' }, undefined)).toBeNull();
    expect(
      matchScoreText({ status: 'confirmed' }, { team1_total: null, team2_total: 3 }),
    ).toBeNull();
  });
});

describe('missingTime', () => {
  it('flags a confirmed match with a blank or unusable time, not a pending one', () => {
    const ok = { status: 'confirmed', team1_time_note: '4:10', team2_time_note: '5:02' };
    expect(missingTime(ok)).toBe(false);
    expect(missingTime({ ...ok, team2_time_note: '' })).toBe(true);
    expect(missingTime({ ...ok, team1_time_note: 'abc' })).toBe(true);
    expect(missingTime({ ...ok, team1_time_note: '0:00' })).toBe(true);
    expect(missingTime({ status: 'pending' })).toBe(false);
  });
});
