import { describe, it, expect } from 'vitest';
import { loadDemo, describeDemoError, describeDemoLoaded } from './demo.js';

describe('loadDemo', () => {
  function clientReturning(result) {
    const calls = [];
    return {
      calls,
      rpc: (name, args) => {
        calls.push([name, args]);
        return Promise.resolve(result);
      },
    };
  }

  it('asks for the scored field by default and returns the counts', async () => {
    const client = clientReturning({ data: { teams: 8, judges: 5, matches: 28 }, error: null });
    await expect(loadDemo('org1', 'ev1', undefined, client)).resolves.toEqual({
      teams: 8,
      judges: 5,
      matches: 28,
    });
    expect(client.calls).toEqual([
      ['load_btc_demo', { p_org_id: 'org1', p_event_id: 'ev1', p_scored: true }],
    ]);
  });

  it('asks for the roster only when scored is false', async () => {
    const client = clientReturning({ data: { teams: 8, judges: 5, matches: 0 }, error: null });
    await loadDemo('org1', 'ev1', { scored: false }, client);
    expect(client.calls[0][1].p_scored).toBe(false);
  });

  it('throws the raw RPC error rather than swallowing it', async () => {
    const error = { code: 'P0001', hint: 'demo_not_test', message: 'x' };
    const client = clientReturning({ data: null, error });
    await expect(loadDemo('org1', 'ev1', {}, client)).rejects.toBe(error);
  });
});

describe('describeDemoError', () => {
  it('explains each refusal the database can give, keyed on the hint', () => {
    expect(describeDemoError({ code: 'P0001', hint: 'demo_not_test', message: 'x' })).toMatch(
      /only be loaded into a test event/i,
    );
    expect(describeDemoError({ code: 'P0001', hint: 'demo_not_btc', message: 'x' })).toMatch(
      /only available for BTC/i,
    );
    expect(
      describeDemoError({ code: 'P0001', hint: 'demo_event_not_found', message: 'x' }),
    ).toMatch(/could not be found/i);
  });

  it('does not depend on the wording: the message text without a hint is a generic failure', () => {
    expect(
      describeDemoError({
        code: 'P0001',
        message: 'load_btc_demo: demo data can only be loaded into a test event',
      }),
    ).toMatch(/something went wrong/i);
  });

  it("falls back to the generic message for an unknown hint, and keeps a plain Error's own text", () => {
    expect(describeDemoError({ code: 'P0001', hint: 'something_new', message: 'x' })).toMatch(
      /something went wrong/i,
    );
    expect(describeDemoError(new Error('Own message.'))).toBe('Own message.');
  });
});

describe('describeDemoLoaded', () => {
  it('says matches were loaded and scored, and what to do next', () => {
    expect(describeDemoLoaded({ teams: 8, judges: 5, matches: 28 })).toBe(
      'Demo loaded: 8 teams, 5 judges and 28 scored preliminary matches. Generate the bracket when you are ready.',
    );
  });

  it('says plainly when only the roster was loaded', () => {
    expect(describeDemoLoaded({ teams: 8, judges: 5, matches: 0 })).toBe(
      'Demo roster loaded: 8 teams and 5 judges, no matches.',
    );
  });
});
