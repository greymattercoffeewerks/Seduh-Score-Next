import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUND_ROLES, roundRole, scoredCups } from './roundRole.js';

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'supabase', 'tests', 'fixtures', 'scoresheet-parity.json'),
    'utf8',
  ),
);

describe('roundRole (owner decision D4), over the fixture the database is also held to', () => {
  for (const c of fixture.roles) {
    it(`${c.phase} round of ${c.matches} match(es) is ${c.role}`, () => {
      expect(roundRole(c.phase, c.matches)).toBe(c.role);
    });
  }

  it('only ever answers one of the four roles, or null', () => {
    for (const phase of ['main', 'third_place', 'redemption', 'x']) {
      for (let n = 0; n <= 20; n += 1) {
        const role = roundRole(phase, n);
        expect(role === null || ROUND_ROLES.includes(role)).toBe(true);
      }
    }
  });
});

describe('scoredCups', () => {
  const sheet = { preset: 'latte_art_v1', cups: { final: 2, third_place: 1 } };
  it('gives the cups of a round whose role the setup names', () => {
    expect(scoredCups(sheet, 'main', 1)).toBe(2);
    expect(scoredCups(sheet, 'third_place', 1)).toBe(1);
  });
  it('is null (tap-voted) for a role the setup leaves out, or with the module off', () => {
    expect(scoredCups(sheet, 'main', 2)).toBeNull();
    expect(scoredCups(sheet, 'main', 8)).toBeNull();
    expect(scoredCups(undefined, 'main', 1)).toBeNull();
  });
});
