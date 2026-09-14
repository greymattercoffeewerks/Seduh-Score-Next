import { describe, it, expect, vi } from 'vitest';
import {
  createSession,
  listMySessions,
  updateSession,
  resetSessionData,
  endSession,
  buildParticipantUrl,
  fetchSessionExport,
} from './sessions.js';

describe('createSession', () => {
  it('inserts with the given creator_id/name/bean_count and returns the created row', async () => {
    // insert() returns an object exposing ONLY .select (not .single
    // directly) — mirrors the real supabase-js chain shape, so a regression
    // that dropped `.select()` before `.single()` (sessions.js's own
    // `.insert(row).select().single()`) would throw here (`.single is not a
    // function`) the same way it would against the real client, rather than
    // passing silently the way a permissive chainable() stub would.
    // test-auditor.
    const calls = [];
    const client = {
      from: (table) => {
        calls.push(['from', table]);
        return {
          insert: (row) => {
            calls.push(['insert', row]);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 's1', ...row }, error: null }),
              }),
            };
          },
        };
      },
    };
    const result = await createSession(
      { creatorId: 'u1', name: 'My Session', beanCount: 428 },
      client,
    );
    expect(calls).toEqual([
      ['from', 'sessions'],
      ['insert', { creator_id: 'u1', name: 'My Session', bean_count: 428 }],
    ]);
    expect(result).toEqual({ id: 's1', creator_id: 'u1', name: 'My Session', bean_count: 428 });
  });

  it('throws the raw error on failure', async () => {
    const client = {
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('boom') }) }) }),
      }),
    };
    await expect(createSession({ creatorId: 'u1', name: 'x', beanCount: 1 }, client)).rejects.toThrow(
      'boom',
    );
  });
});

describe('listMySessions', () => {
  it('queries the sessions table, ordered newest-first', async () => {
    // Captures `table`/`order` args directly rather than handing off to the
    // generic chainable() helper — test-auditor: a bare chainable() never
    // checked which table was queried or whether ordering was applied at
    // all, so a regression that queried the wrong table or dropped ordering
    // (breaking the "newest first" contract this module's own comment
    // names) would have passed unnoticed.
    const calls = [];
    const client = {
      from: (table) => {
        calls.push(['from', table]);
        return {
          select: (cols) => {
            calls.push(['select', cols]);
            return {
              order: (col, opts) => {
                calls.push(['order', col, opts]);
                return Promise.resolve({ data: [{ id: 's1' }, { id: 's2' }], error: null });
              },
            };
          },
        };
      },
    };
    const result = await listMySessions(client);
    expect(calls).toEqual([
      ['from', 'sessions'],
      ['select', '*'],
      ['order', 'created_at', { ascending: false }],
    ]);
    expect(result).toEqual([{ id: 's1' }, { id: 's2' }]);
  });
});

describe('updateSession', () => {
  it('patches the exact row matching the given id, on the sessions table', async () => {
    const calls = [];
    const client = {
      from: (table) => {
        calls.push(['from', table]);
        return {
          update: (patch) => {
            calls.push(['update', patch]);
            return {
              eq: (col, val) => {
                calls.push(['eq', col, val]);
                return { select: () => ({ single: () => Promise.resolve({ data: { id: val, ...patch }, error: null }) }) };
              },
            };
          },
        };
      },
    };
    const result = await updateSession('s1', { revealed: true }, client);
    expect(calls).toEqual([
      ['from', 'sessions'],
      ['update', { revealed: true }],
      ['eq', 'id', 's1'],
    ]);
    expect(result).toEqual({ id: 's1', revealed: true });
  });
});

describe('resetSessionData', () => {
  it('calls the reset_guess_session_data RPC with the session id', async () => {
    const rpc = vi.fn(() => Promise.resolve({ error: null }));
    await resetSessionData('s1', { rpc });
    expect(rpc).toHaveBeenCalledWith('reset_guess_session_data', { p_session_id: 's1' });
  });

  it('throws on RPC failure', async () => {
    const client = { rpc: () => Promise.resolve({ error: new Error('not the creator') }) };
    await expect(resetSessionData('s1', client)).rejects.toThrow('not the creator');
  });
});

describe('endSession', () => {
  it('deletes the exact row matching the given id, on the sessions table (never guesses/contacts directly)', async () => {
    const calls = [];
    const client = {
      from: (table) => {
        calls.push(['from', table]);
        return {
          delete: () => ({
            eq: (col, val) => {
              calls.push(['eq', col, val]);
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
    };
    await endSession('s1', client);
    expect(calls).toEqual([
      ['from', 'sessions'],
      ['eq', 'id', 's1'],
    ]);
  });
});

describe('buildParticipantUrl', () => {
  it('builds a /guess-the-bean/play/?session=<id> URL against the given origin', () => {
    expect(buildParticipantUrl('abc-123', 'https://example.com')).toBe(
      'https://example.com/guess-the-bean/play/?session=abc-123',
    );
  });

  it('URL-encodes the session id', () => {
    expect(buildParticipantUrl('a b', 'https://example.com')).toBe(
      'https://example.com/guess-the-bean/play/?session=a%20b',
    );
  });
});

describe('fetchSessionExport', () => {
  it('rejoins guesses with their paired contact by guess_id', async () => {
    const client = {
      from: (table) => {
        if (table === 'guesses') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { id: 'g1', name: 'Alice', guess: 100, created_at: 't1' },
                    { id: 'g2', name: 'Bob', guess: 200, created_at: 't2' },
                  ],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'contacts') {
          return {
            select: () => ({
              // Reversed order relative to guesses, AND both guesses have a
              // contact — a positional (index-based) zip would pair Alice
              // with Bob's phone and vice versa; only a genuinely
              // guess_id-keyed lookup (sessions.js's own Map) produces the
              // correct pairing below. test-auditor: the original single-
              // contact fixture couldn't distinguish keyed from positional
              // matching, since both produce the same result on one row.
              in: () =>
                Promise.resolve({
                  data: [
                    { guess_id: 'g2', phone: 'bob-phone', instagram: null },
                    { guess_id: 'g1', phone: 'alice-phone', instagram: null },
                  ],
                  error: null,
                }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await fetchSessionExport('s1', client);
    expect(result).toEqual([
      { name: 'Alice', guess: 100, phone: 'alice-phone', instagram: '', createdAt: 't1' },
      { name: 'Bob', guess: 200, phone: 'bob-phone', instagram: '', createdAt: 't2' },
    ]);
  });

  it('skips the contacts query entirely for a session with zero guesses', async () => {
    const contactsQuery = vi.fn();
    const client = {
      from: (table) => {
        if (table === 'guesses') {
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
        }
        if (table === 'contacts') {
          contactsQuery();
          return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const result = await fetchSessionExport('s1', client);
    expect(result).toEqual([]);
    expect(contactsQuery).not.toHaveBeenCalled();
  });
});
