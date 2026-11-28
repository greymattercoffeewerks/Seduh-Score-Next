import { describe, it, expect } from 'vitest';
import { MODULES, moduleKeys, moduleProblems, enabledModules, isSetupLocked } from './modules.js';

const demo = [
  { key: 'a', requires: [] },
  { key: 'b', requires: ['a'] },
];

describe('the module toggle mechanism', () => {
  it('registers the scoresheet and redemption modules with no dependencies (the database holds the same registry)', () => {
    expect(moduleKeys()).toEqual(['scoresheet', 'redemption']);
    expect(MODULES[0]).toMatchObject({ requires: [], entitlementKey: 'throwdown_scoresheet' });
    expect(MODULES[1]).toMatchObject({ requires: [], entitlementKey: 'throwdown_redemption' });
    expect(moduleProblems({ scoresheet: true, redemption: true })).toEqual([]);
  });

  it('refuses any module that is not registered, with a reason', () => {
    expect(moduleProblems({ lucky_loser: true })).toEqual([
      { code: 'unknown', module: 'lucky_loser' },
    ]);
  });

  it('ignores a toggle that is off', () => {
    expect(moduleProblems({ lucky_loser: false })).toEqual([]);
    expect(enabledModules({ redemption: false, x: true })).toEqual({ x: true });
  });

  it('enforces declared dependencies instead of silently doing nothing', () => {
    expect(moduleProblems({ b: true }, demo)).toEqual([
      { code: 'dependency', module: 'b', needs: 'a' },
    ]);
    expect(moduleProblems({ a: true, b: true }, demo)).toEqual([]);
  });

  it('locks setup as soon as any round exists', () => {
    expect(isSetupLocked([])).toBe(false);
    expect(isSetupLocked([{ id: 'r1' }])).toBe(true);
  });
});
