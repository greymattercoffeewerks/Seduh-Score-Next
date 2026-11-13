import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

// Every page the build wrote (read from dist/, so a new page is covered without editing this list), except the country
// pages themselves and the two consoles (/app/, /admin/: not public pages, they draw no site links): '/', '/tour/', '/tools/timer/' and so on.
function builtPublicPaths(dir = 'dist', prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === 'assets' || (prefix === '' && ['id', 'admin', 'app'].includes(name))
        ? []
        : builtPublicPaths(full, `${prefix}/${name}`);
    }
    return name === 'index.html' ? [`${prefix || ''}/`] : [];
  });
}

// Proves the real production bundle boots — app shell chrome + routing to
// the default (events) screen — without depending on a real Supabase
// backend being reachable (this job runs no local Supabase stack; see
// ci.yml's own 'playwright' job). Asserting on the chrome rather than the
// events list itself is deliberate: the chrome mounts synchronously before
// any network call, so this stays fast and backend-independent, matching
// what a boot smoke test is actually meant to prove.
test('app entry mounts the real app shell and routes to the events screen', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.locator('.app-shell-name')).toHaveText('Seduh Score');
  await expect(page.getByRole('link', { name: 'Events' })).toBeVisible();
});

test('public pages ship meaningful HTML before client JavaScript runs', async ({ page }) => {
  const pages = [
    ['/', '<div class="petrol-page"', 'Every cup brewed.'],
    ['/tour/', '<main class="tour-page"', 'A better way to '],
    ['/pricing/', '<div class="pricing-page"', 'Pricing, stated '],
    ['/community/', '<main class="community-hub"', 'Useful on the '],
    ['/tools/timer/', '<main class="timer"', 'Seduh Timer'],
    ['/tools/brew-planner/', '<main class="bp"', 'Seduh Brew Planner'],
    ['/tools/random-selector/', '<main class="random-selector"', 'SPLIT-FLAP EDITION'],
    ['/about/', '<main class="trust-article"', 'Scoring for coffee competitions'],
    ['/contact/', '<main class="trust-article"', 'Get in touch.'],
    ['/privacy/', '<main class="trust-article"', 'What we hold, who can see it'],
    ['/terms/', '<main class="trust-article"', 'The ground rules for using'],
    ['/neutrality/', '<main class="trust-article"', 'We run the platform.'],
  ];

  for (const [path, element, copy] of pages) {
    const response = await page.request.get(path);
    const html = await response.text();

    expect(response.ok()).toBe(true);
    expect(html).toContain(element);
    expect(html).toContain(copy);
  }
});

// Seduh ID country pages (T-CTY.3): one shell, copied by the build to a real index.html per ISO code, so a printed or QR
// link works on plain static hosting. Every page is noindex and nothing public links to them (spec CP4). The record itself
// is covered by the unit tests; here the doors are answered with FICTIONAL counts, or refused.
test('country pages: every path is a real noindex page on static hosting, linked from nowhere', async ({
  page,
}) => {
  for (const path of ['/id/country/', '/id/country/bn/', '/id/country/tw/', '/id/country/hk/']) {
    const response = await page.request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(await response.text(), path).toContain('content="noindex, nofollow"');
  }
  // Nothing on the public site points at them while the pages are not public: checked on the RENDERED page (the header
  // and footer are drawn by script, so the raw HTML cannot show them).
  const paths = builtPublicPaths();
  // the scan cannot silently shrink: the landing page, tour, pricing, results, community, trust pages, tools and more
  expect(paths.length).toBeGreaterThanOrEqual(12);
  let withLinks = 0;
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    // some pages (a display, a login) draw no links at all; the floor below proves the scan saw real chrome
    if ((await page.locator('a').count()) > 0) withLinks += 1;
    await expect(page.locator('a[href*="/id/country"]'), path).toHaveCount(0);
  }
  // a page that never mounted would draw no links and pass vacuously: most pages must have drawn some
  expect(withLinks).toBeGreaterThanOrEqual(10);
});

test('country pages: the hub lists countries as links at 360px, with no horizontal scroll', async ({
  page,
}) => {
  await page.route('**/rest/v1/rpc/public_country_index', (route) =>
    route.fulfill({
      json: {
        countries: [
          { country_code: 'BN', championships: 2, entries: 3, teams: 2 },
          { country_code: 'TW', championships: 1, entries: 1, teams: 1 },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/id/country/');
  await expect(page.getByRole('link', { name: /Brunei/ })).toHaveAttribute(
    'href',
    '/id/country/bn/',
  );
  await expect(page.getByRole('heading', { name: 'Guest countries' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('country pages: a country page names the country and shows Try again when the record cannot load', async ({
  page,
}) => {
  await page.route('**/rest/v1/rpc/**', (route) => route.abort());
  await page.goto('/id/country/bn/');
  await expect(page.getByRole('heading', { level: 1, name: 'Brunei' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
