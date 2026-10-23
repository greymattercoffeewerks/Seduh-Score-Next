import { describe, it, expect } from 'vitest';
import {
  WINDOW_CACHE_MS,
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
    expect(
      windowStateOf(snap({ ends_at: hours(edge + 1), locked: false, enforced: true }), NOW).kind,
    ).toBe('open');
    expect(
      windowStateOf(snap({ ends_at: hours(edge), locked: false, enforced: true }), NOW).kind,
    ).toBe('ending');
    expect(
      windowStateOf(snap({ ends_at: hours(1), locked: false, enforced: true }), NOW).kind,
    ).toBe('ending');
  });

  it('shows nothing for a window that has passed while the database says it is not locked (key off)', () => {
    expect(windowStateOf(snap({ ends_at: hours(-5), locked: false }), NOW).kind).toBe('open');
  });

  it('announces nothing while the key is switched off (enforced false or absent)', () => {
    expect(
      windowStateOf(snap({ ends_at: hours(1), locked: false, enforced: false }), NOW).kind,
    ).toBe('open');
    expect(windowStateOf(snap({ ends_at: hours(1), locked: false }), NOW).kind).toBe('open');
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
    const c = client({
      data: snap({ ends_at: hours(10), locked: false, enforced: true }),
      error: null,
    });
    expect((await loadWindowState('o', 'e', c, { now: NOW, cache: new Map() })).kind).toBe(
      'ending',
    );
  });

  it('remembers an answer for a moment, then asks again, and never remembers a failure', async () => {
    let calls = 0;
    const c = {
      rpc: () => {
        calls += 1;
        return Promise.resolve({
          data: snap({ ends_at: hours(10), locked: false, enforced: true }),
          error: null,
        });
      },
    };
    const cache = new Map();
    await loadWindowState('o', 'e', c, { now: NOW, cache });
    await loadWindowState('o', 'e', c, { now: NOW + 1000, cache });
    expect(calls).toBe(1);
    await loadWindowState('o', 'e2', c, { now: NOW + 1000, cache });
    expect(calls).toBe(2);
    await loadWindowState('o', 'e', c, { now: NOW + WINDOW_CACHE_MS + 1, cache });
    expect(calls).toBe(3);
    const failing = { rpc: () => Promise.reject(new Error('offline')) };
    const cache2 = new Map();
    await loadWindowState('o', 'e', failing, { now: NOW, cache: cache2 });
    expect(cache2.size).toBe(0);
  });

  it('fails open: a refusal, an error or a hang is no window', async () => {
    const refused = client({ data: null, error: { code: '42501' } });
    expect((await loadWindowState('o', 'e', refused, { cache: new Map() })).kind).toBe('none');
    const offline = client(new Error('offline'));
    expect((await loadWindowState('o', 'e', offline, { cache: new Map() })).kind).toBe('none');
    const hang = { rpc: () => new Promise(() => {}) };
    expect((await loadWindowState('o', 'e', hang, { timeoutMs: 20, cache: new Map() })).kind).toBe(
      'none',
    );
  });
});
