import { test } from '@playwright/test';
import { createLoneUser } from './support/tenants.js';
import { nextCode, createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// T-ADM.D1: the admin console's sign-in and second-factor gate, against the real built page (served by the dev
// server) and a real local Supabase stack with TOTP switched on. Every account here is real; the admin is made
// by SQL (support/admins.js), the way one is made in production.
//
// What this proves that the unit tests (src/admin/*.test.js, with a fake client) cannot: the real GoTrue
// enrolment and challenge, a real TOTP code accepted by the real server, the real database gate refusing a
// session that was signed out elsewhere, and the admin session living apart from the organiser console's.

test.describe('the admin console (real page, real local Supabase)', () => {
  // Serial: one shared stack, and the later tests build on the admin the first ones enrol.
  test.describe.configure({ mode: 'serial' });

  let admin;
  let organiser;
  let secret;

  test.beforeAll(async () => {
    test.setTimeout(60000);
    admin = await createPlatformAdmin('console-admin');
    organiser = await createLoneUser('console-organiser');
  });

  test.afterAll(() => {
    if (admin) removePlatformAdmin(admin);
  });

  test('is unlinked and noindex, and asks for a sign-in', async ({ page }) => {
    await page.goto('/admin/');
    await expect(heading(page)).toHaveText('Admin sign in');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    // Nothing on the public pages points here.
    for (const path of ['/', '/community/', '/tour/']) {
      await page.goto(path);
      const hrefs = await page
        .locator('a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      expect(hrefs.filter((href) => /(^|\/)admin(\/|$)/.test(href ?? ''))).toEqual([]);
    }
  });

  test('a login that is not an admin gets "No access" and nothing else', async ({ page }) => {
    await signIn(page, organiser);
    await expect(heading(page)).toHaveText('No access');
    await expect(page.locator('body')).toContainText('does not have access to the admin console');
    await expect(page.locator('nav')).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(heading(page)).toHaveText('Admin sign in');
  });

  test('a wrong password is refused and the form stays', async ({ page }) => {
    await signIn(page, { email: admin.email, password: 'definitely-not-it' });
    await expect(page.locator('.screen-feedback')).toContainText('do not match');
    await expect(heading(page)).toHaveText('Admin sign in');
  });

  test('first sign-in enrols an authenticator app, and the console opens at aal2', async ({
    page,
  }) => {
    await signIn(page, admin);
    secret = await enrol(page);
    await expect(page.locator('header')).toContainText(admin.email);
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('Organisations');
    // The whole gate agrees, not just the token: the console only opens after the database said yes.
    await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toBeVisible();
  });

  test('a later sign-in is challenged; a wrong code is refused; the right one opens the console', async ({
    page,
  }) => {
    await signIn(page, admin);
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('.screen-feedback')).toContainText('did not work');
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
  });

  test('a reload keeps the session (this tab), and Sign out ends it', async ({ page }) => {
    await signIn(page, admin);
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    await page.reload();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(heading(page)).toHaveText('Admin sign in');
    await page.reload();
    await expect(heading(page)).toHaveText('Admin sign in');
  });

  test("the admin session is its own: nothing lands in the organiser console's storage", async ({
    page,
  }) => {
    await signIn(page, admin);
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(storage.session).toContain('seduh-admin-auth');
    expect(storage.local.filter((key) => key.startsWith('sb-') || key.includes('auth'))).toEqual(
      [],
    );
    // And the organiser console sees no session from it.
    await page.goto('/app/');
    await expect(page.locator('input[data-field="email"]')).toBeVisible();
  });

  test('"Sign out everywhere" ends the OTHER tab\'s session too, and that tab is told so', async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const first = await (await browser.newContext()).newPage();
    const second = await (await browser.newContext()).newPage();
    try {
      await signIn(first, admin);
      await first.locator('[data-field="code"]').fill(await nextCode(secret));
      await first.getByRole('button', { name: 'Verify' }).click();
      await expect(first.locator('header')).toContainText('Verified (AAL2)');

      await signIn(second, admin);
      await second.locator('[data-field="code"]').fill(await nextCode(secret));
      await second.getByRole('button', { name: 'Verify' }).click();
      await expect(second.locator('header')).toContainText('Verified (AAL2)');

      await first.getByRole('button', { name: 'Sign out everywhere' }).click();
      await expect(heading(first)).toHaveText('Admin sign in');

      // The second tab still holds a token that says "admin, aal2" and has not expired. The console must not
      // take that for a live session: the database refuses it, and the console says so.
      await second.reload();
      await expect(heading(second)).toHaveText('Admin sign in');
      await expect(second.locator('.screen-feedback')).toContainText('Your session ended');
      await expect(second.locator('header')).toHaveCount(0);
    } finally {
      await first.context().close();
      await second.context().close();
    }
  });
});

test.describe('the admin console at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.describe.configure({ mode: 'serial' });

  let admin;

  test.beforeAll(async () => {
    test.setTimeout(60000);
    // A long address: the header and the "signed in as" line must wrap it, not push the page sideways.
    admin = await createPlatformAdmin('a-rather-long-label-to-stress-the-narrow-header-layout');
  });

  test.afterAll(() => {
    if (admin) removePlatformAdmin(admin);
  });

  test('the sign-in screen needs no sideways scrolling and its controls are tappable', async ({
    page,
  }) => {
    await page.goto('/admin/');
    await expect(heading(page)).toHaveText('Admin sign in');
    await expectFitsAndTappable(page);
  });

  test('keyboard users still get a visible focus ring (only pointer users lose it)', async ({
    page,
  }) => {
    await page.goto('/admin/');
    await expect(heading(page)).toHaveText('Admin sign in');
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-field="email"]')).toBeFocused();
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);
  });

  test('the enrolment screen (QR code, key, code field) fits, and so does the console with a long email', async ({
    page,
  }) => {
    await signIn(page, admin);
    await expect(heading(page)).toHaveText('Set up your authenticator app');
    await expect(page.locator('img.adm-qr')).toBeVisible();
    await expectFitsAndTappable(page);

    const secret = (await page.locator('[data-field="secret"]').textContent()).replace(/\s/g, '');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    await expectFitsAndTappable(page);
    const headerOverflow = await page
      .locator('header')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(headerOverflow).toBeLessThanOrEqual(0);
  });
});
