import { describe, it, expect, vi } from 'vitest';
import { formatDate, formatDateTime, plural } from './format.js';

describe('formatDate', () => {
  it('writes a timestamp or a date as YYYY-MM-DD in UTC', () => {
    expect(formatDate('2026-10-12T09:30:00Z')).toBe('2026-10-12');
    expect(formatDate('2026-10-12')).toBe('2026-10-12');
    // late evening UTC stays that day, whatever the machine's time zone is
    expect(formatDate('2026-10-12T23:59:59Z')).toBe('2026-10-12');
    expect(formatDate('2026-10-13T00:00:00+08:00')).toBe('2026-10-12');
  });

  it('writes a dash for nothing and for rubbish, never "Invalid Date"', () => {
    for (const value of [null, undefined, '', 'not a date', {}]) {
      expect(formatDate(value)).toBe('—');
    }
  });
});

describe('formatDateTime', () => {
  it('writes date, hour and minute in UTC, and says it is UTC', () => {
    expect(formatDateTime('2026-10-12T09:05:59Z')).toBe('2026-10-12 09:05 UTC');
    expect(formatDateTime('2026-10-13T00:00:00+08:00')).toBe('2026-10-12 16:00 UTC');
  });

  it('writes a dash for nothing and for rubbish', () => {
    for (const value of [null, undefined, '', 'nope']) expect(formatDateTime(value)).toBe('—');
  });
});

describe('plural', () => {
  it('agrees with the count, including zero', () => {
    expect(plural(0, 'member')).toBe('0 members');
    expect(plural(1, 'member')).toBe('1 member');
    expect(plural(2, 'member')).toBe('2 members');
    expect(plural(12, 'event')).toBe('12 events');
  });

  it('takes an irregular plural', () => {
    expect(plural(1, 'person', 'people')).toBe('1 person');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });

  it('reads a missing or odd count as zero, never "undefined members"', () => {
    for (const value of [undefined, null, NaN, -4, 2.5, '3']) {
      expect(plural(value, 'member')).toBe('0 members');
    }
  });
});

describe('independence from the machine', () => {
  it('never reads the local time zone or locale: the same input prints the same on every machine', () => {
    const forbidden = [
      'toLocaleDateString',
      'toLocaleString',
      'toLocaleTimeString',
      'getFullYear',
      'getMonth',
      'getDate',
      'getHours',
      'getMinutes',
      'getTimezoneOffset',
    ];
    const spies = forbidden.map((name) =>
      vi.spyOn(Date.prototype, name).mockImplementation(() => {
        throw new Error(`${name} depends on the machine`);
      }),
    );
    try {
      expect(formatDate('2026-10-12T23:59:59Z')).toBe('2026-10-12');
      expect(formatDateTime('2026-10-12T23:59:59Z')).toBe('2026-10-12 23:59 UTC');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
