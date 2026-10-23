import { describe, it, expect } from 'vitest';
import {
  bruneiDateTime,
  bruneiDay,
  endOfBruneiDay,
  eventStateText,
  eventWindowText,
  keyRuleText,
  offsetLabel,
  shortId,
  sourceLabel,
  tierLabel,
  windowDays,
  windowText,
} from './planFormat.js';

describe('labels', () => {
  it('names the tiers and sources, and shows an unknown one as it is (never undefined)', () => {
    expect(tierLabel('per_event')).toBe('Per-event');
    expect(tierLabel('annual')).toBe('Annual');
    expect(tierLabel('gold')).toBe('gold');
    expect(tierLabel(null)).toBe('—');
    expect(tierLabel('constructor')).toBe('constructor');
    expect(sourceLabel('payment')).toBe('Payment confirmed');
    expect(sourceLabel('manual')).toBe('Granted by hand');
    expect(sourceLabel('toString')).toBe('toString');
  });
});

describe('Brunei time', () => {
  it('writes an instant in Brunei time, midnight as 00:00', () => {
    // 2026-12-07 16:00 UTC is 2026-12-08 00:00 in Brunei
    expect(bruneiDateTime('2026-12-07T16:00:00Z')).toBe('2026-12-08 00:00');
    expect(bruneiDay('2026-12-07T16:00:00Z')).toBe('2026-12-08');
    expect(bruneiDateTime('2026-12-08T10:30:00Z')).toBe('2026-12-08 18:30');
  });

  it('shows an em dash for nothing or nonsense', () => {
    for (const v of [null, undefined, '', 'nope']) {
      expect(bruneiDateTime(v)).toBe('—');
      expect(bruneiDay(v)).toBe('—');
    }
  });

  it('describes a window, closed or open-ended', () => {
    expect(
      windowText({ valid_from: '2026-12-07T16:00:00Z', valid_until: '2026-12-12T16:00:00Z' }),
    ).toBe('2026-12-08 00:00 to 2026-12-13 00:00 Brunei time');
    expect(windowText({ valid_from: '2026-12-07T16:00:00Z', valid_until: null })).toMatch(
      /no end$/,
    );
  });
});

describe('the five-day window', () => {
  it('gives the first and last day for every legal offset, always containing the event date', () => {
    for (const offset of [-4, -3, -2, -1, 0]) {
      const days = windowDays('2026-12-10', offset);
      expect(days.first <= '2026-12-10' && '2026-12-10' <= days.last).toBe(true);
      expect((Date.parse(days.last) - Date.parse(days.first)) / 86400000).toBe(4);
    }
    expect(windowDays('2026-12-10', -2)).toEqual({ first: '2026-12-08', last: '2026-12-12' });
    expect(windowDays('2026-12-31', 0)).toEqual({ first: '2026-12-31', last: '2027-01-04' });
  });

  it('refuses an offset or a date that cannot be one', () => {
    expect(windowDays('2026-12-10', 1)).toBeNull();
    expect(windowDays('2026-12-10', -5)).toBeNull();
    expect(windowDays('2026-12-10', 1.5)).toBeNull();
    expect(windowDays('soon', -2)).toBeNull();
    expect(windowDays(null, -2)).toBeNull();
  });

  it('labels an offset relative to the competition date', () => {
    expect(offsetLabel(-2)).toBe('T-2 to T+2');
    expect(offsetLabel(-4)).toBe('T-4 to T');
    expect(offsetLabel(0)).toBe('T to T+4');
  });

  it('ends an extension at midnight after the chosen day, Brunei time', () => {
    expect(endOfBruneiDay('2026-12-12')).toBe('2026-12-13T00:00:00+08:00');
    expect(endOfBruneiDay('2026-12-31')).toBe('2027-01-01T00:00:00+08:00');
    expect(endOfBruneiDay('')).toBeNull();
    expect(endOfBruneiDay('12/12/2026')).toBeNull();
  });
});

describe('events and keys', () => {
  it('says how an event ended and where its plan stands', () => {
    expect(eventStateText({ ended_via: 'organiser' })).toMatch(/organiser/);
    expect(eventStateText({ ended_via: 'concluded' })).toMatch(/champion/);
    expect(eventStateText({ ended_via: 'admin_release' })).toMatch(/admin/);
    expect(eventStateText({ ended_via: null })).toBe('Open');
    expect(eventWindowText({ has_window: false })).toBe('No Per-event plan');
    expect(
      eventWindowText({
        has_window: true,
        window_ended: true,
        window_ends_at: '2026-12-12T16:00:00Z',
      }),
    ).toMatch(/ended 2026-12-13 00:00 Brunei time/);
    expect(
      eventWindowText({
        has_window: true,
        window_ended: false,
        window_ends_at: '2026-12-12T16:00:00Z',
      }),
    ).toMatch(/ends 2026-12-13/);
  });

  it('writes what a key needs or limits', () => {
    expect(keyRuleText({ kind: 'flag', min_tier: 'per_event' })).toBe('Needs Per-event or above');
    expect(keyRuleText({ kind: 'flag', min_tier: null })).toBe('Open to every tier');
    expect(
      keyRuleText({ kind: 'cap', caps: { community: 8, per_event: null, annual: null } }),
    ).toBe('Limit: Community 8, Per-event no limit, Annual no limit');
  });

  it('shortens an id, or shows a dash', () => {
    expect(shortId('3f2a91c0-aaaa-4bbb-8ccc-000000000000')).toBe('3f2a91c0');
    expect(shortId(null)).toBe('—');
  });
});
