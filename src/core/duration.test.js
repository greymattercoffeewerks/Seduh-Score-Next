import { describe, it, expect } from 'vitest';
import { formatDuration } from './duration.js';

describe('formatDuration', () => {
  it('formats as M:SS', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(480)).toBe('8:00');
  });

  it('clamps a negative value to 0 rather than showing a negative duration', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
});
