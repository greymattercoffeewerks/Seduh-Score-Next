// The Worker with a stand-in for the static assets binding. This proves the Worker's own decisions (what it serves and
// what it hands back untouched); that Cloudflare sends ONLY /id/* to it is wrangler.jsonc's run_worker_first, checked
// against `wrangler dev` by tests/e2e/id-routing.spec.js and re-read here in the config test below.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

function fakeAssets() {
  const seen = [];
  return {
    seen,
    ASSETS: {
      async fetch(input) {
        const request = input instanceof Request ? input : new Request(input);
        seen.push({ url: new URL(request.url).pathname, method: request.method });
        const { pathname } = new URL(request.url);
        if (pathname === '/id/') return new Response('<title>shell</title>', { status: 200 });
        if (pathname === '/id/claim/') return new Response('<title>claim</title>', { status: 200 });
        return new Response('from assets', { status: 404 });
      },
    },
  };
}
const call = (env, path, init) =>
  worker.fetch(new Request(`https://example.test${path}`, init), env);

afterEach(() => vi.unstubAllGlobals());

describe('worker', () => {
  it('serves the one shell with status 200 and noindex for any person-page path', async () => {
    for (const path of ['/id/syafiqah/', '/id/syafiqah', '/id/nobody-at-all', '/id/AB']) {
      const env = fakeAssets();
      const res = await call(env, path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe('<title>shell</title>');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(env.seen.map((s) => s.url)).toEqual(['/id/']);
    }
  });

  it('serves the claim page from its own built page, never as a person page, with no index, no cache and no referrer', async () => {
    for (const path of ['/id/claim/', '/id/claim', '/id/Claim/']) {
      const env = fakeAssets();
      const res = await call(env, path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe('<title>claim</title>');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(env.seen.map((s) => s.url)).toEqual(['/id/claim/']);
    }
  });

  it('hands a write method on the claim page back untouched, and still serves a person page and the country pages as before', async () => {
    const env = fakeAssets();
    const res = await call(env, '/id/claim/', { method: 'POST', body: 'x' });
    // handed to the assets untouched (the Worker adds nothing of its own to a write)
    expect(env.seen).toEqual([{ url: '/id/claim/', method: 'POST' }]);
    expect(res.headers.get('referrer-policy')).toBeNull();
    const person = await call(fakeAssets(), '/id/syafiqah/');
    expect(await person.text()).toBe('<title>shell</title>');
    const country = fakeAssets();
    expect((await call(country, '/id/country/bn/')).status).toBe(404);
    expect(country.seen.map((s) => s.url)).toEqual(['/id/country/bn/']);
  });

  it('answers a 301 to /id/mfosa/ for the firdaus alias, in any case, with the query string kept, before any asset is read', async () => {
    const { ASSETS, seen } = fakeAssets();
    for (const path of ['/id/firdaus', '/id/firdaus/', '/id/FirDaus/']) {
      const res = await call({ ASSETS }, path);
      expect(res.status, path).toBe(301);
      expect(res.headers.get('location'), path).toBe('/id/mfosa/');
    }
    const withQuery = await call({ ASSETS }, '/id/firdaus/?ref=card&x=1');
    expect(withQuery.status).toBe(301);
    expect(withQuery.headers.get('location')).toBe('/id/mfosa/?ref=card&x=1');
    const head = await call({ ASSETS }, '/id/firdaus', { method: 'HEAD' });
    expect(head.status).toBe(301);
    expect(seen).toEqual([]);
  });

  it('does not redirect the target, other handles, country or claim, and does not answer a write method on the alias', async () => {
    const { ASSETS, seen } = fakeAssets();
    for (const path of ['/id/mfosa/', '/id/someone/', '/id/country', '/id/claim/']) {
      const res = await call({ ASSETS }, path);
      expect(res.status, path).not.toBe(301);
    }
    const post = await call({ ASSETS }, '/id/firdaus/', { method: 'POST' });
    expect(post.status).not.toBe(301);
    expect(seen.at(-1)).toEqual({ url: '/id/firdaus/', method: 'POST' });
  });

  it('makes no outbound call and gives every handle the same status and body', async () => {
    // The Worker must not look a handle up anywhere: a status that depended on existence would leak it.
    const outbound = vi.fn(() => {
      throw new Error('no outbound call');
    });
    vi.stubGlobal('fetch', outbound);
    const answers = [];
    for (const path of ['/id/real-person/', '/id/nobody-here/', '/id/x/']) {
      const env = fakeAssets();
      const res = await call(env, path);
      answers.push([res.status, await res.text()]);
      expect(env.seen.map((s) => s.url)).toEqual(['/id/']);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('hands everything else back to the assets untouched', async () => {
    for (const path of ['/id/country', '/id/country/bn', '/id/favicon.ico', '/id/a/b', '/nope/']) {
      const env = fakeAssets();
      const res = await call(env, path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).toBe('from assets');
      expect(env.seen.map((s) => s.url)).toEqual([path]);
    }
  });

  it('does not answer a write method on a person page', async () => {
    const env = fakeAssets();
    const res = await call(env, '/id/someone/', { method: 'POST', body: 'x' });
    expect(res.status).toBe(404);
    expect(env.seen[0].method).toBe('POST');
  });

  it('passes an assets failure through instead of dressing it as a profile', async () => {
    const env = { ASSETS: { fetch: async () => new Response('gone', { status: 500 }) } };
    expect((await call(env, '/id/someone/')).status).toBe(500);
  });
});

describe('wrangler.jsonc', () => {
  // The routing contract lives in config, so pin it: only /id/* runs the Worker, and the country pages are excluded
  // (negative patterns win), with no single-page fallback for every other path.
  const text = readFileSync('wrangler.jsonc', 'utf8');
  const config = JSON.parse(
    text
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .replace(/,(\s*[}\]])/g, '$1'),
  );
  it('runs the Worker first for /id/* minus the country pages, and keeps the default 404 handling', () => {
    expect(config.main).toBe('worker/index.js');
    expect(config.assets.binding).toBe('ASSETS');
    expect(config.assets.run_worker_first).toEqual(['/id/*', '!/id/country', '!/id/country/*']);
    expect(config.assets.not_found_handling).toBeUndefined();
  });
});
