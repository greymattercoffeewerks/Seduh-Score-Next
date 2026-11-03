import { describe, it, expect } from 'vitest';
import { MODULES, moduleKeys, moduleProblems, enabledModules, isSetupLocked } from './modules.js';

const demo = [
  { key: 'a', requires: [] },
  { key: 'b', requires: ['a'] },
];

describe('the module toggle mechanism', () => {
  it('ships with NO module enabled or registered in TD.1', () => {
    expect(MODULES).toEqual([]);
    expect(moduleKeys()).toEqual([]);
  });

  it('refuses any module that is not registered, with a reason', () => {
    expect(moduleProblems({ redemption: true })).toEqual([
      { code: 'unknown', module: 'redemption' },
    ]);
  });

  it('ignores a toggle that is off', () => {
    expect(moduleProblems({ redemption: false })).toEqual([]);
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
