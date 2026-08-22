import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheGet,
  cacheSet,
  outboxListAll,
  outboxPut,
  outboxRemove,
  _clearAllForTests,
} from './db.js';

beforeEach(async () => {
  await _clearAllForTests();
});

describe('cache', () => {
  it('returns null for a key that was never cached', async () => {
    expect(await cacheGet('nope')).toBeNull();
  });

  it('round-trips a plain-object value', async () => {
    await cacheSet('entries:ev1', [{ id: 'e1', display_name: 'Cupper One' }]);
    expect(await cacheGet('entries:ev1')).toEqual([{ id: 'e1', display_name: 'Cupper One' }]);
  });

  it('overwrites the previous value for the same key', async () => {
    await cacheSet('k', 'first');
    await cacheSet('k', 'second');
    expect(await cacheGet('k')).toBe('second');
  });

  it('keeps different keys independent', async () => {
    await cacheSet('a', 1);
    await cacheSet('b', 2);
    expect(await cacheGet('a')).toBe(1);
    expect(await cacheGet('b')).toBe(2);
  });
});

describe('outbox', () => {
  it('returns an empty array when nothing is queued', async () => {
    expect(await outboxListAll()).toEqual([]);
  });

  it('round-trips a queued operation', async () => {
    const operation = { id: 'op1', type: 'confirm_heat', payload: {}, createdAt: 1, attempts: 0 };
    await outboxPut(operation);
    expect(await outboxListAll()).toEqual([operation]);
  });

  it('lists queued operations ordered by createdAt, not insertion order', async () => {
    await outboxPut({ id: 'op-later', type: 'x', payload: {}, createdAt: 200, attempts: 0 });
    await outboxPut({ id: 'op-earlier', type: 'x', payload: {}, createdAt: 100, attempts: 0 });
    const all = await outboxListAll();
    expect(all.map((op) => op.id)).toEqual(['op-earlier', 'op-later']);
  });

  it('removes a queued operation by id', async () => {
    await outboxPut({ id: 'op1', type: 'x', payload: {}, createdAt: 1, attempts: 0 });
    await outboxRemove('op1');
    expect(await outboxListAll()).toEqual([]);
  });

  it('put overwrites an existing operation with the same id (used for attempt-count updates)', async () => {
    await outboxPut({ id: 'op1', type: 'x', payload: {}, createdAt: 1, attempts: 0 });
    await outboxPut({
      id: 'op1',
      type: 'x',
      payload: {},
      createdAt: 1,
      attempts: 1,
      lastError: 'boom',
    });
    const all = await outboxListAll();
    expect(all).toHaveLength(1);
    expect(all[0].attempts).toBe(1);
    expect(all[0].lastError).toBe('boom');
  });
});
