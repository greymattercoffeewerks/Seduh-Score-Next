// A flush that REJECTS after the correction was already saved to the outbox (an
// IndexedDB hiccup, a lock failure). Its own file because it replaces the outbox's
// flushOutbox for every test in it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/outbox.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    flushOutbox: vi.fn(() => Promise.reject(new Error('IndexedDB went away'))),
  };
});

const { attemptCorrection, isStillQueued } = await import('./timeCorrection.js');
const { _clearAllForTests } = await import('../../core/db.js');
const { countPendingOperations } = await import('../../core/outbox.js');

beforeEach(async () => {
  await _clearAllForTests();
});

const heat = { id: 'h1', status: 'scoring', duration_secs: 480 };
const entry = { id: 'he1', entry_id: 'e1', displayName: 'Cupper One', elapsed_secs: 200 };

describe('a flush that rejects after the correction was saved', () => {
  it('is reported as a stopped flush, not a thrown error — the screen must not say "try again" for a write that is queued', async () => {
    const outcome = await attemptCorrection(heat, entry, 190, 'Missed the stop', 'org1', {}, {});
    expect(outcome.error).toBeUndefined();
    expect(outcome.inputError).toBeUndefined();
    expect(outcome.check.flushResult).toMatchObject({ processed: 0, stopped: true });
    expect(outcome.check.flushResult.error.message).toBe('IndexedDB went away');
    // …because it IS queued, and the outbox says so.
    expect(await countPendingOperations()).toBe(1);
    expect(await isStillQueued(outcome.check)).toBe(true);
  });
});
