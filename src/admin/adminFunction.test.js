import { describe, it, expect, vi } from 'vitest';
import { invokeAdminFunction } from './adminFunction.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const responseOf = (status, body, { json } = {}) => ({
  status,
  json: json ?? (async () => body),
});

const clientWith = (invoke) => ({ functions: { invoke: vi.fn(invoke) } });

describe('invokeAdminFunction', () => {
  it('sends the body to the named function and returns its data untouched', async () => {
    const client = clientWith(async () => ({
      data: { userId: USER_ID, password: 'pw' },
      error: null,
    }));
    const result = await invokeAdminFunction(client, 'admin-accounts', { action: 'create_owner' });
    expect(client.functions.invoke).toHaveBeenCalledWith('admin-accounts', {
      body: { action: 'create_owner' },
    });
    expect(result).toEqual({ data: { userId: USER_ID, password: 'pw' }, error: null });
  });

  it('an answer with no data is null data, not undefined', async () => {
    const result = await invokeAdminFunction(
      clientWith(async () => ({ data: undefined, error: null })),
      'f',
      {},
    );
    expect(result).toEqual({ data: null, error: null });
  });

  it('a refusal carries the status, the stable hint and a stranded user id, and nothing else', async () => {
    const result = await invokeAdminFunction(
      clientWith(async () => ({
        data: null,
        error: {
          message: 'Edge Function returned a non-2xx status code',
          context: responseOf(500, {
            error: 'The login was created but could not be recorded or removed: secret text',
            hint: 'account_stranded',
            userId: USER_ID,
            password: 'must-never-pass',
          }),
        },
      })),
      'admin-accounts',
      {},
    );
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ status: 500, hint: 'account_stranded', userId: USER_ID });
    expect(JSON.stringify(result)).not.toContain('secret text');
    expect(JSON.stringify(result)).not.toContain('must-never-pass');
  });

  it('refuses a hint or a user id that is not the shape the function sends', async () => {
    const result = await invokeAdminFunction(
      clientWith(async () => ({
        data: null,
        error: {
          context: responseOf(409, { hint: '<script>alert(1)</script>', userId: 'not-a-uuid' }),
        },
      })),
      'f',
      {},
    );
    expect(result.error).toEqual({ status: 409, hint: undefined, userId: undefined });
  });

  it('an answer that is not JSON still reports its status', async () => {
    const result = await invokeAdminFunction(
      clientWith(async () => ({
        data: null,
        error: {
          context: responseOf(502, null, {
            json: async () => {
              throw new SyntaxError('Unexpected token <');
            },
          }),
        },
      })),
      'f',
      {},
    );
    expect(result.error).toEqual({ status: 502, hint: undefined, userId: undefined });
  });

  it('an error with no response at all is "offline": the request got no answer', async () => {
    const result = await invokeAdminFunction(
      clientWith(async () => ({ data: null, error: { message: 'Failed to send a request' } })),
      'f',
      {},
    );
    expect(result.error).toEqual({ offline: true });
  });

  it('a call that throws is offline, and never rejects', async () => {
    const result = await invokeAdminFunction(
      clientWith(() => Promise.reject(new TypeError('Failed to fetch'))),
      'f',
      {},
    );
    expect(result.error).toEqual({ timedOut: false, offline: true });
  });

  it('a call that never answers ends as timed out at the limit', async () => {
    vi.useFakeTimers();
    try {
      const pending = invokeAdminFunction(
        clientWith(() => new Promise(() => {})),
        'f',
        {},
        { timeoutMs: 5000 },
      );
      await vi.advanceTimersByTimeAsync(5001);
      expect(await pending).toEqual({ data: null, error: { timedOut: true, offline: false } });
    } finally {
      vi.useRealTimers();
    }
  });
});
