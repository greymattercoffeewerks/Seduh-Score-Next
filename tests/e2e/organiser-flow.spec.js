import { test, expect } from '@playwright/test';

// Proves the routing skeleton wired up in the 2026-08-29 app-wiring pass
// actually connects, end to end, against the REAL app (main.js/index.html)
// and a REAL local Supabase stack — not a mocked screen (src/main.test.js's
// own job) and not a demo harness with a fake client
// (cross-surface-countdown.spec.js's own job). Every organiser table is
// `authenticated`-only (20260821240000_grants.sql), so this signs in first,
// using supabase/seed.sql's fixed local-dev-only login — see that file's
// own header comment for why it exists.
//
// A fresh, uniquely-named event per run (not a fixed id) keeps this
// re-runnable against a persistent local stack without colliding with a
// previous run's leftover rows — this project deliberately has no
// `db reset`-per-test-run harness yet.

async function signIn(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const mod = await import('/src/core/supabaseClient.js');
    const client = mod.getSupabase();
    const { error } = await client.auth.signInWithPassword({
      email: 'organiser@local.test',
      password: 'local-dev-password',
    });
    if (error) throw new Error(`seed login failed: ${error.message}`);
  });
  await page.reload();
}

// A second/third `page.goto('/#/...')` call for a hash-only change from the
// SAME page proved unreliable in this environment (found running this file
// repeatedly: two live router/mountApp instances ended up racing for the
// same window's hashchange listener, and the DOM occasionally settled back
// on the wrong screen — not something the router's own resolveSeq staleness
// guard can fix, since that's scoped to ONE router instance, not two). A
// real user never triggers navigation this way either — they click a link
// or the app calls `location.hash =` — so driving further navigation the
// same way here, after ONE real page load, is both the reliable choice and
// the one that matches production usage.
async function navigateHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

test.describe('organiser flow (real app, real local Supabase)', () => {
  // Serial, not parallel: these tests share one real, stateful local
  // Supabase stack (Realtime included) — found running this file with
  // Playwright's default parallel workers: three concurrent browser
  // contexts connecting to the same local Realtime service made the
  // live-routes test's own "NOT LIVE" badge intermittently miss its
  // default 5s expect timeout, purely from resource contention, not a
  // real app bug (confirmed: reliably passes alone). A shared backend
  // being hammered by concurrent test contexts is a real risk in CI too
  // (constrained runners), not just a local dev quirk.
  test.describe.configure({ mode: 'serial' });

  test('create an event, build a stage plan, register a roster, generate heats, and reach Timing', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signIn(page);

    const eventName = `E2E Wiring Test ${Date.now()}`;

    // --- Events screen: create ---
    await expect(page.locator('.app-shell-name')).toHaveText('Seduh Score');
    await page.getByLabel('Event name').fill(eventName);
    await page.getByRole('button', { name: 'Create event' }).click();
    const eventLink = page.getByRole('link', { name: eventName });
    await expect(eventLink).toBeVisible();

    // --- Event dashboard ---
    await eventLink.click();
    await expect(page.getByRole('heading', { name: eventName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('No stage plan yet.')).toBeVisible();

    // --- Setup: build a one-stage plan ---
    await page.getByRole('link', { name: 'Setup' }).click();
    await expect(page.getByRole('heading', { name: 'Stage plan' })).toBeVisible();
    await page.getByRole('button', { name: 'Add stage' }).click();
    await page.getByRole('button', { name: 'Save stage plan' }).click();
    await expect(page.getByText('Stage plan saved.')).toBeVisible();

    // --- Overview reflects the new stage ---
    await page.getByRole('link', { name: 'Overview' }).click();
    await expect(page.getByText(/1st .* prelims/)).toBeVisible();
    const generateHeatsLink = page.getByRole('link', { name: 'Generate heats' });
    await expect(generateHeatsLink).toBeVisible();

    // --- Roster: register two cuppers ---
    await page.getByRole('link', { name: 'Roster' }).click();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
    for (const [name, phone] of [
      ['E2E Cupper One', '555-1001'],
      ['E2E Cupper Two', '555-1002'],
    ]) {
      await page.getByLabel('Name').fill(name);
      await page.getByLabel('Phone').fill(phone);
      await page.getByRole('button', { name: 'Register' }).click();
      await expect(page.getByText(`${name} registered.`)).toBeVisible();
    }

    // --- Heats: seed roster into the stage, generate, and reach Timing ---
    await page.getByRole('link', { name: 'Overview' }).click();
    await page.getByRole('link', { name: 'Generate heats' }).click();
    await expect(page.getByRole('heading', { name: /Heat generation/ })).toBeVisible();
    await page.getByRole('button', { name: 'Seed roster into this stage' }).click();
    await expect(page.getByText('E2E Cupper One').first()).toBeVisible();
    await page.getByRole('button', { name: 'Generate heats (random)' }).click();
    await expect(page.getByRole('heading', { name: 'Heat 1' })).toBeVisible();

    const timingLink = page.getByRole('link', { name: 'Time this heat' });
    await expect(timingLink).toBeVisible();
    await timingLink.click();
    await expect(page.getByRole('heading', { name: /^Timing — Heat 1$/ })).toBeVisible();
    // Proves timingRouteScreen.js's dispatch actually ran (not a dead
    // route/blank outlet) — the app-mode timing screen renders the full
    // roster it was handed, same as the manual QA pass this test mirrors.
    await expect(page.getByText('E2E Cupper One').first()).toBeVisible();
    await expect(page.getByText('E2E Cupper Two').first()).toBeVisible();
  });

  test('the projector and phone live routes render their own chrome, not the organiser shell', async ({
    page,
  }) => {
    await signIn(page);

    await navigateHash(page, '#/live/projector');
    await expect(page.locator('.app-shell-root')).toBeHidden();
    await expect(page.locator('.app-bare-root')).toBeVisible();

    await navigateHash(page, '#/live/phone');
    await expect(page.locator('.app-shell-root')).toBeHidden();
    await expect(page.getByText('NOT LIVE')).toBeVisible();
  });

  test('an unknown route shows an inline "Page not found" with a link back to events', async ({
    page,
  }) => {
    await signIn(page);
    // Wait for the events screen's own async load to fully settle before
    // navigating away — see navigateHash()'s sibling finding below;
    // navigating before it settles hits a real, separately-tracked race
    // (a slow-resolving screen's OWN internal render() isn't gated by the
    // router's staleness guard, only the router's `current` bookkeeping
    // is), not something this route-dispatch test is meant to exercise.
    await expect(page.locator('form.create-event-form')).toBeVisible();
    await navigateHash(page, '#/this/route/does/not/exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to events' })).toBeVisible();
  });
});
