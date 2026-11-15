import { test, expect } from '@playwright/test';

// Seduh ID person-page routing, against the BUILT site run by `wrangler dev` (the real Worker in front of dist/, not
// `vite preview`, which cannot run a Worker). Needs `npm run build` first, like smoke.spec.js. See worker/index.js.

test('any /id/<handle>/ path serves the person-page shell with 200 and noindex', async ({
  page,
  baseURL,
}) => {
  const calls = [];
  page.on('request', (r) => calls.push(new URL(r.url())));
  for (const path of ['/id/someone/', '/id/someone', '/id/No-Such-Person_1/', '/id/ab/', '/id/']) {
    const res = await page.goto(path);
    expect(res.status(), path).toBe(200);
    // /id/ itself comes straight from the assets (no Worker), so it carries the meta tag only.
    if (path !== '/id/') expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seduh ID profile');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  }
  // The placeholder makes no data call: every request is this origin's page, its bundle, or its icons (nothing
  // cross-origin, and no same-origin API path either).
  const origin = new URL(baseURL).origin;
  const stray = calls.filter(
    (u) =>
      u.origin !== origin ||
      !(
        u.pathname.startsWith('/id/') ||
        u.pathname.startsWith('/assets/') ||
        u.pathname.startsWith('/favicon')
      ),
  );
  expect(stray.map((u) => u.href)).toEqual([]);
});

test('the person-page shell does not overflow a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/id/someone/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('/id/country/ and /id/country/<iso2>/ still serve the country page, not the person shell', async ({
  page,
  request,
}) => {
  for (const path of ['/id/country/', '/id/country/bn/']) {
    const res = await page.goto(path);
    expect(res.status(), path).toBe(200);
    await expect(page).toHaveTitle(/Countries|Seduh ID — Seduh Score/);
    await expect(page.locator('main.country-page')).toBeVisible();
  }
  // No trailing slash: the assets' own redirect, never a person page called "country".
  const bare = await request.get('/id/country', { maxRedirects: 0 });
  expect(bare.status()).toBe(307);
  expect(bare.headers().location).toBe('/id/country/');
});

test('paths that are not a person page still behave as before: a real 404', async ({ request }) => {
  for (const path of ['/nope/', '/nope', '/id/a/b/', '/id/favicon.ico']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
  }
  expect((await request.get('/')).status()).toBe(200);
});
