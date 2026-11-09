import { describe, it, expect } from 'vitest';
import { formatDuration, formatDurationLong, parseDuration } from './duration.js';

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

describe('formatDurationLong', () => {
  it("spells out minutes and seconds in words, matching formatDuration's own M:SS split", () => {
    expect(formatDurationLong(0)).toBe('0 minutes 0 seconds');
    expect(formatDurationLong(65)).toBe('1 minute 5 seconds');
    expect(formatDurationLong(480)).toBe('8 minutes 0 seconds');
  });

  it('uses the singular word for exactly 1 minute and/or 1 second, plural otherwise', () => {
    expect(formatDurationLong(61)).toBe('1 minute 1 second');
    expect(formatDurationLong(60)).toBe('1 minute 0 seconds');
    expect(formatDurationLong(1)).toBe('0 minutes 1 second');
    expect(formatDurationLong(2)).toBe('0 minutes 2 seconds');
  });

  it("clamps a negative value to 0, matching formatDuration's own behavior", () => {
    expect(formatDurationLong(-5)).toBe('0 minutes 0 seconds');
  });
});

describe('parseDuration', () => {
  it.each([
    ['8:42', 522],
    ['08:42', 522],
    ['12:05', 725],
    ['0:00', 0],
    ['59:59', 3599],
    [' 8:42 ', 522],
  ])('reads %s as %i seconds', (text, secs) => {
    expect(parseDuration(text)).toBe(secs);
  });

  it.each([
    '8.42',
    '8:60',
    '842',
    '8 min',
    '8:4',
    '8:420',
    '1:2:03',
    '-1:30',
    ':30',
    '8:',
    '',
    '  ',
    '123:00',
  ])('refuses %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });

  it.each([undefined, null, 522, {}, ['8:42']])('refuses the non-string %j', (value) => {
    expect(parseDuration(value)).toBeNull();
  });

  it.each([1, 59, 60, 61, 599, 600, 3599, 5999])(
    'round-trips formatDuration for %i seconds',
    (secs) => {
      expect(parseDuration(formatDuration(secs))).toBe(secs);
    },
  );
});
