// What the pending-work helpers do when the outbox itself cannot be read. Its own file because
// it replaces listPendingOperations for every test in it.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core/outbox.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    listPendingOperations: vi.fn(() => Promise.reject(new Error('IndexedDB is unavailable'))),
  };
});
vi.spyOn(console, 'warn').mockImplementation(() => {});

const { isStillQueued, loadPendingWork } = await import('./timeCorrection.js');

describe('loadPendingWork with an unreadable outbox', () => {
  it('resolves to "nothing pending" instead of throwing — an unreadable outbox must not stop a screen rendering', async () => {
    const work = await loadPendingWork('h1');
    expect(work.queuedEntryIds.size).toBe(0);
    expect(work.confirmQueued).toBe(false);
  });
});

describe('isStillQueued with an unreadable outbox', () => {
  it('falls back to the flush result: stopped and not dropped means still queued', async () => {
    expect(await isStillQueued({ operationId: 'op1', flushResult: { stopped: true } })).toBe(true);
  });

  it('…a flush that did not stop means it went through', async () => {
    expect(await isStillQueued({ operationId: 'op1', flushResult: { stopped: false } })).toBe(
      false,
    );
  });

  it('…and an operation the flush dropped is not queued', async () => {
    const flushResult = {
      stopped: true,
      dropped: [{ operationId: 'op1', error: { message: 'x' } }],
    };
    expect(await isStillQueued({ operationId: 'op1', flushResult })).toBe(false);
  });
});
