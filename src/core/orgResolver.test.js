import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveOrgBySlug, _clearOrgResolverForTests } from './orgResolver.js';
import { DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const ORG = { id: 'org-1', name: 'Alpha Coffee', slug: 'alpha-coffee' };

function clientAnswering(...answers) {
  const rpc = vi.fn();
  for (const answer of answers) rpc.mockImplementationOnce(() => answer());
  return { rpc };
}
const ok = (data) => () => Promise.resolve({ data, error: null });

beforeEach(() => {
  _clearOrgResolverForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('resolveOrgBySlug', () => {
  it('asks the narrow public door with the slug as typed, and returns that one organisation', async () => {
    const client = clientAnswering(ok([ORG]));
    const result = await resolveOrgBySlug('alpha-coffee', client);
    expect(client.rpc).toHaveBeenCalledWith('public_org_by_slug', { p_slug: 'alpha-coffee' });
    expect(result).toEqual({ status: 'found', org: ORG });
  });

  it('is "not found" when the database answers with no row, never an error', async () => {
    const client = clientAnswering(ok([]));
    expect(await resolveOrgBySlug('nobody', client)).toEqual({ status: 'not_found' });
  });

  it('is "not found" for a null or malformed answer, not a crash', async () => {
    for (const data of [null, undefined, {}, { 0: { id: 'org-9' } }, [{}], [{ id: null }], 'x']) {
      _clearOrgResolverForTests();
      const client = clientAnswering(ok(data));
      expect(await resolveOrgBySlug('x', client)).toEqual({ status: 'not_found' });
    }
  });

  it('is an error, not "not found", when the call comes back with an error', async () => {
    const failure = { message: 'boom', code: '500' };
    const client = clientAnswering(() => Promise.resolve({ data: null, error: failure }));
    expect(await resolveOrgBySlug('alpha-coffee', client)).toEqual({
      status: 'error',
      error: failure,
    });
  });

  it('is an error when the request itself rejects (offline)', async () => {
    const failure = new TypeError('Failed to fetch');
    const client = clientAnswering(() => Promise.reject(failure));
    expect(await resolveOrgBySlug('alpha-coffee', client)).toEqual({
      status: 'error',
      error: failure,
    });
  });

  it('is an error, flagged as a timeout, when the call never answers', async () => {
    vi.useFakeTimers();
    const client = clientAnswering(() => new Promise(() => {}));
    const pending = resolveOrgBySlug('alpha-coffee', client, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(501);
    const result = await pending;
    expect(result.status).toBe('error');
    expect(result.error.timedOut).toBe(true);
  });

  it('remembers a found organisation, and asks no second time (whatever the case or spacing)', async () => {
    const client = clientAnswering(ok([ORG]));
    await resolveOrgBySlug('alpha-coffee', client);
    expect(await resolveOrgBySlug('  ALPHA-Coffee ', client)).toEqual({
      status: 'found',
      org: ORG,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('never remembers "not found": the same link may work a moment later', async () => {
    const client = clientAnswering(ok([]), ok([ORG]));
    expect((await resolveOrgBySlug('alpha-coffee', client)).status).toBe('not_found');
    const second = await resolveOrgBySlug('alpha-coffee', client);
    expect(second).toEqual({ status: 'found', org: ORG });
  });

  it('never remembers an error either', async () => {
    const client = clientAnswering(() => Promise.reject(new Error('offline')), ok([ORG]));
    expect((await resolveOrgBySlug('alpha-coffee', client)).status).toBe('error');
    expect((await resolveOrgBySlug('alpha-coffee', client)).status).toBe('found');
  });

  it('keeps two organisations apart', async () => {
    const other = { id: 'org-2', name: 'Bravo', slug: 'bravo' };
    const client = clientAnswering(ok([ORG]), ok([other]));
    expect((await resolveOrgBySlug('alpha-coffee', client)).org.id).toBe('org-1');
    expect((await resolveOrgBySlug('bravo', client)).org.id).toBe('org-2');
    expect((await resolveOrgBySlug('alpha-coffee', client)).org.id).toBe('org-1');
  });

  it('falls back to the typed slug when the row carries none, and to null for a missing name', async () => {
    const client = clientAnswering(ok([{ id: 'org-3' }]));
    expect(await resolveOrgBySlug('Gamma', client)).toEqual({
      status: 'found',
      org: { id: 'org-3', name: null, slug: 'gamma' },
    });
  });

  it('sends the slug trimmed of ASCII whitespace, in the letters the link had', async () => {
    const client = clientAnswering(ok([ORG]));
    await resolveOrgBySlug('  Alpha-Coffee \n', client);
    expect(client.rpc).toHaveBeenCalledWith('public_org_by_slug', { p_slug: '  Alpha-Coffee \n' });
  });

  it('says "not found" without asking for anything that cannot be a slug, and remembers nothing for it', async () => {
    const client = { rpc: vi.fn() };
    const tooLong = 'a'.repeat(101);
    for (const bad of [
      '',
      '   ',
      '-a',
      'a-',
      'a--b',
      'a b',
      'a_b',
      'a/b',
      tooLong,
      '\u00a0alpha',
    ]) {
      expect(await resolveOrgBySlug(bad, client)).toEqual({ status: 'not_found' });
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 characters', async () => {
    const client = clientAnswering(ok([ORG]));
    expect((await resolveOrgBySlug('a'.repeat(100), client)).status).toBe('found');
  });

  it('does not serve a look-alike of a remembered slug from memory (the Kelvin sign is not a k)', async () => {
    const client = clientAnswering(ok([{ id: 'org-k', name: 'Kelvin', slug: 'kelvin' }]));
    await resolveOrgBySlug('kelvin', client);
    expect(await resolveOrgBySlug('\u212Aelvin', client)).toEqual({ status: 'not_found' });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('hands out copies: changing an answer, first or remembered, does not change the next', async () => {
    const client = clientAnswering(ok([ORG]));
    const first = await resolveOrgBySlug('alpha-coffee', client);
    first.org.id = 'tampered';
    const second = await resolveOrgBySlug('alpha-coffee', client);
    expect(second.org.id).toBe('org-1');
    second.org.id = 'tampered-again';
    expect((await resolveOrgBySlug('alpha-coffee', client)).org.id).toBe('org-1');
  });

  it('gives up at the shared default timeout when none is passed', async () => {
    vi.useFakeTimers();
    const client = clientAnswering(() => new Promise(() => {}));
    const pending = resolveOrgBySlug('alpha-coffee', client);
    await vi.advanceTimersByTimeAsync(DEFAULT_LOAD_TIMEOUT_MS - 1);
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect((await pending).error.timedOut).toBe(true);
  });
});
