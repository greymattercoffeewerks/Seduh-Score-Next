import { describe, it, expect } from 'vitest';
import {
  WINDOW_WARNING_HOURS,
  describeWindowEnd,
  loadWindowState,
  windowLockedText,
  windowStateOf,
  windowWarningText,
} from './eventWindow.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const hours = (h) => new Date(NOW + h * 3600 * 1000).toISOString();
const snap = (win) => ({ tier: 'community', keys: {}, window: win });

describe('windowStateOf', () => {
  it('is none without a window object (no plan, key off, older database)', () => {
    expect(windowStateOf(null, NOW).kind).toBe('none');
    expect(windowStateOf({ tier: 'community', keys: {} }, NOW).kind).toBe('none');
    expect(windowStateOf(snap(null), NOW).kind).toBe('none');
    expect(windowStateOf(snap('nonsense'), NOW).kind).toBe('none');
  });

  it('follows the database for locked, whatever the clock says', () => {
    expect(windowStateOf(snap({ ends_at: hours(100), locked: true }), NOW).kind).toBe('locked');
    expect(windowStateOf(snap({ ends_at: null, locked: true }), NOW).kind).toBe('locked');
  });

  it('is open well before the end and ending inside the warning period', () => {
    const edge = WINDOW_WARNING_HOURS;
    expect(windowStateOf(snap({ ends_at: hours(edge + 1), locked: false }), NOW).kind).toBe('open');
    expect(windowStateOf(snap({ ends_at: hours(edge), locked: false }), NOW).kind).toBe('ending');
    expect(windowStateOf(snap({ ends_at: hours(1), locked: false }), NOW).kind).toBe('ending');
  });

  it('shows nothing for a window that has passed while the database says it is not locked (key off)', () => {
    expect(windowStateOf(snap({ ends_at: hours(-5), locked: false }), NOW).kind).toBe('open');
  });

  it('ignores a malformed end date', () => {
    expect(windowStateOf(snap({ ends_at: 'not a date', locked: false }), NOW).kind).toBe('none');
  });
});

describe('describeWindowEnd (Brunei time)', () => {
  it('names the last day for a window ending at midnight Brunei time', () => {
    // 2026-11-13 00:00 Brunei = 2026-11-12 16:00 UTC: the window's last day is 12 November
    expect(describeWindowEnd(new Date('2026-11-12T16:00:00Z'))).toBe('the end of 12 November 2026');
  });

  it('gives the time for any other end (an extension)', () => {
    expect(describeWindowEnd(new Date('2026-11-12T10:30:00Z'))).toBe('12 November 2026 at 18:30');
  });
});

describe('texts', () => {
  const ending = { kind: 'ending', endsAt: new Date('2026-11-12T16:00:00Z') };
  it('warns only while the window is ending', () => {
    expect(windowWarningText(ending)).toMatch(
      /ends at the end of 12 November 2026 \(Brunei time\)/,
    );
    expect(windowWarningText(ending)).toMatch(/extend/);
    expect(windowWarningText({ kind: 'open', endsAt: ending.endsAt })).toBeNull();
    expect(windowWarningText({ kind: 'locked', endsAt: ending.endsAt })).toBeNull();
    expect(windowWarningText(null)).toBeNull();
  });

  it('explains the locked state and says what stays', () => {
    const text = windowLockedText({ kind: 'locked', endsAt: ending.endsAt });
    expect(text).toMatch(/closed/);
    expect(text).toMatch(/ended at the end of 12 November 2026/);
    expect(text).toMatch(/public results page/);
    expect(windowLockedText({ kind: 'locked', endsAt: null })).not.toMatch(/ended at/);
  });
});

describe('loadWindowState', () => {
  const client = (result) => ({
    rpc: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  });

  it('reads the window from my_entitlements', async () => {
    const c = client({ data: snap({ ends_at: hours(10), locked: false }), error: null });
    expect((await loadWindowState('o', 'e', c, { now: NOW })).kind).toBe('ending');
  });

  it('fails open: a refusal, an error or a hang is no window', async () => {
    expect(
      (await loadWindowState('o', 'e', client({ data: null, error: { code: '42501' } }))).kind,
    ).toBe('none');
    expect((await loadWindowState('o', 'e', client(new Error('offline')))).kind).toBe('none');
    const hang = { rpc: () => new Promise(() => {}) };
    expect((await loadWindowState('o', 'e', hang, { timeoutMs: 20 })).kind).toBe('none');
  });
});
