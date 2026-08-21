import { describe, it, expect } from 'vitest';
import { clampElapsed } from './timeclamp.js';

describe('clampElapsed', () => {
  it('below duration: passes through unmaxed, elapsed equals raw', () => {
    expect(clampElapsed(200, 480)).toEqual({ elapsed: 200, raw: 200, maxed: false });
  });

  it('at duration: maxed, elapsed clamps to durationSecs, raw preserves the input', () => {
    expect(clampElapsed(480, 480)).toEqual({ elapsed: 480, raw: 480, maxed: true });
  });

  it('beyond duration: maxed, elapsed clamps to durationSecs, raw preserves the actual input', () => {
    expect(clampElapsed(511, 480)).toEqual({ elapsed: 480, raw: 511, maxed: true });
  });

  it('zero elapsed on a real duration: unmaxed', () => {
    expect(clampElapsed(0, 480)).toEqual({ elapsed: 0, raw: 0, maxed: false });
  });
});
