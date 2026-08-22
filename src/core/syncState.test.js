import { describe, it, expect } from 'vitest';
import { computeSyncState } from './syncState.js';

describe('computeSyncState', () => {
  it('is "off" when sync is not enabled, regardless of anything else', () => {
    expect(computeSyncState({ enabled: false })).toEqual({
      status: 'off',
      pendingCount: 0,
      stuckOperation: null,
      lastFlushError: null,
    });
  });

  it('reports "not synced", never "off", when disabled but real work is still pending — fail-open takes priority over the enabled flag', () => {
    // A caller might set enabled:false (e.g. no event currently selected)
    // while the outbox still holds unflushed work from before — "off" reads
    // as an unalarming, expected state, which is exactly the kind of lie
    // "fail-open never lies about a write that failed" exists to prevent.
    const result = computeSyncState({
      enabled: false,
      operations: [{ id: 'op1', attempts: 5 }],
      lastFlushError: 'boom',
    });
    expect(result.status).toBe('not synced');
    expect(result.stuckOperation.id).toBe('op1');
  });

  it('is "live" when enabled, nothing pending, and no error', () => {
    expect(computeSyncState({ enabled: true, operations: [], lastFlushError: null })).toEqual({
      status: 'live',
      pendingCount: 0,
      stuckOperation: null,
      lastFlushError: null,
    });
  });

  it('is "not synced" when operations are pending', () => {
    const operations = [
      { id: 'op1', attempts: 0 },
      { id: 'op2', attempts: 0 },
    ];
    const result = computeSyncState({ enabled: true, operations });
    expect(result.status).toBe('not synced');
    expect(result.pendingCount).toBe(2);
  });

  it('is "not synced" when the last flush errored, even with an empty queue', () => {
    // A flush can fail (network drop mid-request) after the outbox already
    // believes an operation succeeded in some edge case — trust the error
    // signal even if pendingCount alone would look clean.
    const result = computeSyncState({ enabled: true, operations: [], lastFlushError: 'timeout' });
    expect(result.status).toBe('not synced');
    expect(result.lastFlushError).toBe('timeout');
  });

  it('surfaces the first operation with attempts > 0 as stuckOperation', () => {
    const operations = [
      { id: 'fresh', attempts: 0 },
      { id: 'retried-once', attempts: 1 },
      { id: 'retried-many', attempts: 5 },
    ];
    const result = computeSyncState({ enabled: true, operations });
    expect(result.stuckOperation.id).toBe('retried-once');
  });

  it('stuckOperation is null when every pending operation is fresh (never retried)', () => {
    const operations = [
      { id: 'fresh1', attempts: 0 },
      { id: 'fresh2', attempts: 0 },
    ];
    const result = computeSyncState({ enabled: true, operations });
    expect(result.status).toBe('not synced');
    expect(result.stuckOperation).toBeNull();
  });

  it('degrades to "off" rather than throwing when operations is null/undefined and nothing else is wrong', () => {
    expect(computeSyncState({ enabled: true, operations: null }).status).toBe('live');
    expect(computeSyncState({ enabled: false, operations: undefined }).status).toBe('off');
  });

  it('does not throw when the operations array itself contains a null/undefined entry', () => {
    const result = computeSyncState({
      enabled: true,
      operations: [null, { id: 'x', attempts: 1 }, undefined],
    });
    expect(result.status).toBe('not synced');
    expect(result.stuckOperation.id).toBe('x');
  });

  it('treats an empty-string lastFlushError as still an error, not "no error"', () => {
    // A handler throwing something other than a well-formed Error can leave
    // error.message as '' — a bare truthy check would misread that as "no
    // error" and could return "live" with a real failure sitting unreported.
    const result = computeSyncState({ enabled: true, operations: [], lastFlushError: '' });
    expect(result.status).toBe('not synced');
  });

  it('fail-open: never returns "live" while any pending operation or error exists', () => {
    // Exhaustive-ish sweep over the inputs that must never produce "live".
    const notSyncedCases = [
      { enabled: true, operations: [{ id: '1', attempts: 0 }] },
      { enabled: true, operations: [{ id: '1', attempts: 9 }] },
      { enabled: true, operations: [], lastFlushError: 'any error' },
      { enabled: true, operations: [{ id: '1', attempts: 0 }], lastFlushError: 'any error' },
    ];
    for (const input of notSyncedCases) {
      expect(computeSyncState(input).status).toBe('not synced');
    }
  });
});
