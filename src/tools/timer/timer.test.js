import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialState,
  getStatus,
  computeRemaining,
  isRunExpired,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  markExpired,
  parseCustomDuration,
  loadState,
  saveState,
  STORAGE_KEY,
  PRESETS,
} from './timer.js';

const NOW = 1_000_000_000;

describe('status transitions', () => {
  it('starts idle', () => {
    expect(getStatus(createInitialState())).toBe('idle');
  });

  it('start -> running', () => {
    const state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    expect(getStatus(state)).toBe('running');
    expect(computeRemaining(state, NOW)).toBe(480);
  });

  it('pause -> paused, freezing the exact remaining count', () => {
    let state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    state = pauseTimer(state, NOW + 100_000);
    expect(getStatus(state)).toBe('paused');
    expect(computeRemaining(state, NOW + 999_999_000)).toBe(380); // frozen regardless of `now`
  });

  it('resume continues counting down from exactly the paused value, not from full duration', () => {
    let state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    state = pauseTimer(state, NOW + 100_000); // 380s left
    state = resumeTimer(state, NOW + 500_000); // resume at some later wall-clock instant
    expect(getStatus(state)).toBe('running');
    expect(computeRemaining(state, NOW + 500_000)).toBe(380);
    expect(computeRemaining(state, NOW + 500_000 + 50_000)).toBe(330);
  });

  it('a reload (fresh now, same persisted startedAt) resumes correctly with no drift', () => {
    const state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    // Simulate a page reload 60s later purely by reading with a later `now` —
    // no re-tick, no accumulator, same wall-clock-recompute guarantee
    // core/countdown.js already proves.
    expect(computeRemaining(state, NOW + 60_000)).toBe(420);
  });

  it('reset clears to idle, showing the full duration again', () => {
    let state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    state = pauseTimer(state, NOW + 100_000);
    state = resetTimer(state);
    expect(getStatus(state)).toBe('idle');
    expect(computeRemaining(state, NOW + 999_000)).toBe(480);
  });

  it('pause/resume are no-ops from the wrong state', () => {
    const idle = createInitialState();
    expect(pauseTimer(idle, NOW)).toBe(idle);
    expect(resumeTimer(idle, NOW)).toBe(idle);
  });
});

describe('expiry', () => {
  it('isRunExpired is false before duration elapses', () => {
    const state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    expect(isRunExpired(state, NOW + 100_000)).toBe(false);
  });

  it('isRunExpired is true once duration elapses while running', () => {
    const state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    expect(isRunExpired(state, NOW + 480_000)).toBe(true);
  });

  it('markExpired flips status to expired and computeRemaining clamps to 0', () => {
    let state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    state = markExpired(state, NOW + 480_000);
    expect(getStatus(state)).toBe('expired');
    expect(computeRemaining(state, NOW + 999_999_000)).toBe(0);
  });

  it('markExpired is idempotent — a second call does not move expiredAt', () => {
    let state = startTimer(createInitialState(), { title: '', durationSecs: 480, now: NOW });
    state = markExpired(state, NOW + 480_000);
    const again = markExpired(state, NOW + 999_000_000);
    expect(again.expiredAt).toBe(state.expiredAt);
  });
});

describe('parseCustomDuration', () => {
  it('combines minutes and seconds into a total', () => {
    expect(parseCustomDuration('2', '30')).toBe(150);
  });

  it('rejects a zero total', () => {
    expect(parseCustomDuration('0', '0')).toBeNull();
  });

  it('rejects a negative total', () => {
    expect(parseCustomDuration('-1', '0')).toBeNull();
  });

  it('treats an out-of-range seconds value (60+) as 0 rather than overflowing into minutes', () => {
    expect(parseCustomDuration('1', '75')).toBe(60); // seconds clamped to 0, not 1:75 -> 2:15
  });

  it('treats non-numeric input as 0 for that field rather than throwing', () => {
    expect(parseCustomDuration('abc', '30')).toBe(30);
    expect(parseCustomDuration('2', 'xyz')).toBe(120);
  });

  it('rejects when both fields are non-numeric', () => {
    expect(parseCustomDuration('abc', 'xyz')).toBeNull();
  });
});

describe('persistence', () => {
  function fakeStorage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
    };
  }

  let storage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it('round-trips a running state through save/load', () => {
    const state = startTimer(createInitialState(), {
      title: 'Round 1',
      durationSecs: 300,
      now: NOW,
    });
    saveState(state, storage);
    const loaded = loadState(storage);
    expect(loaded.title).toBe('Round 1');
    expect(loaded.startedAt).toBe(NOW);
    expect(computeRemaining(loaded, NOW + 60_000)).toBe(240);
  });

  it('round-trips a PAUSED state, preserving the frozen remaining value distinct from durationSecs', () => {
    let state = startTimer(createInitialState(), { title: 'Round 1', durationSecs: 300, now: NOW });
    state = pauseTimer(state, NOW + 220_000); // 80s left
    saveState(state, storage);
    const loaded = loadState(storage);
    expect(getStatus(loaded)).toBe('paused');
    expect(loaded.startedAt).toBeNull();
    expect(loaded.pausedRemainingSecs).toBe(80);
    // Frozen regardless of how much later it's read back, exactly like the
    // in-memory pause behavior this mirrors.
    expect(computeRemaining(loaded, NOW + 999_999_000)).toBe(80);
  });

  it('returns null when nothing is stored yet', () => {
    expect(loadState(storage)).toBeNull();
  });

  it('degrades to null rather than throwing on corrupted JSON', () => {
    storage.setItem(STORAGE_KEY, '{not json');
    expect(loadState(storage)).toBeNull();
  });

  it('degrades to null on a parseable-but-non-object value rather than spreading junk keys', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify('just a string'));
    expect(loadState(storage)).toBeNull();
    storage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadState(storage)).toBeNull();
  });

  it('degrades to a no-op rather than throwing when storage.setItem throws (e.g. quota/private mode)', () => {
    storage.setItem = () => {
      throw new Error('quota exceeded');
    };
    expect(() => saveState(createInitialState(), storage)).not.toThrow();
  });
});

describe('presets', () => {
  it('exposes at least one preset and every preset has a positive duration', () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    for (const preset of PRESETS) {
      expect(preset.secs).toBeGreaterThan(0);
      expect(typeof preset.label).toBe('string');
    }
  });
});
