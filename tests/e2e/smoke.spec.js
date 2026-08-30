import { test, expect } from '@playwright/test';

// Proves the real production bundle boots — app shell chrome + routing to
// the default (events) screen — without depending on a real Supabase
// backend being reachable (this job runs no local Supabase stack; see
// ci.yml's own 'playwright' job). Asserting on the chrome rather than the
// events list itself is deliberate: the chrome mounts synchronously before
// any network call, so this stays fast and backend-independent, matching
// what a boot smoke test is actually meant to prove.
test('home page mounts the real app shell and routes to the events screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell-name')).toHaveText('Seduh Score');
  await expect(page.getByRole('link', { name: 'Events' })).toBeVisible();
});
