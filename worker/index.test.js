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
