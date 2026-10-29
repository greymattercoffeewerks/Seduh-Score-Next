import { test } from '@playwright/test';
import { nextCode, createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import { signInPassword } from './support/api.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// The Change password panel (ADMIN-PASSWORD-DESIGN section 9, A1 to A6), against the real page and the real local
// stack: a real TOTP enrolment, a real GoTrue password change, a real second browser context for the other session.

const NEW_1 = 'first-new-password-7391';
const NEW_2 = 'second-new-password-5528';

test.describe('the admin console: Change password (real page, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let admin;
  let secret;
  let password; // the admin's password right now (the tests below change it)

  test.beforeAll(async () => {
    test.setTimeout(60000);
    admin = await createPlatformAdmin('console-password');
    password = admin.password;
  });

  test.afterAll(() => {
    if (admin) removePlatformAdmin(admin);
  });

  // A sign-in through the challenge, to the open console.
  async function open(page) {
    await signIn(page, { email: admin.email, password });
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
  }

  async function fillForm(page, { current, next, confirmation = next }) {
    await page.locator('[data-field="current"]').fill(current);
    await page.locator('[data-field="password"]').fill(next);
    await page.locator('[data-field="confirmation"]').fill(confirmation);
    await page.getByRole('button', { name: 'Save password' }).click();
  }

  test('setup: first sign-in enrols the authenticator app', async ({ page }) => {
    await signIn(page, admin);
    secret = await enrol(page);
  });

  test('A5: an aal1 session cannot open the route; the hash shows the challenge, not the panel', async ({
    page,
  }) => {
    await signIn(page, { email: admin.email, password });
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.goto('/admin/#/password');
    await expect(heading(page)).toHaveText('Verify it is you');
    await expect(page.locator('[data-field="current"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Change password' })).toHaveCount(0);
  });

  test('A4: at 360px the panel fits, focus lands on the heading, every control is 44px tall', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page);
    await page.getByRole('link', { name: 'Change password' }).click();
    await expect(heading(page)).toHaveText('Change password');
    await expect(page.locator('h1')).toBeFocused();
    await expectFitsAndTappable(page);
    const toggle = page.locator('.password-toggle');
    await expect(toggle).toBeVisible();
    expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(43.5);
    await expect(page.getByRole('button', { name: 'Save password' })).toBeVisible();
  });

  test('A7: empty boxes get its own message, not the native bubble, the box at fault is invalid and focused; one toggle shows all three', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page);
    await page.goto('/admin/#/password');
    await expect(heading(page)).toHaveText('Change password');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.locator('main .screen-feedback')).toHaveText('Enter your current password.');
    const current = page.locator('[data-field="current"]');
    await expect(current).toHaveAttribute('aria-invalid', 'true');
    await expect(current).toBeFocused();
    await current.fill('x');
    await expect(current).not.toHaveAttribute('aria-invalid', 'true');
    await page.locator('.password-toggle').click();
    for (const name of ['current', 'password', 'confirmation']) {
      await expect(page.locator(`[data-field="${name}"]`)).toHaveAttribute('type', 'text');
    }
    await expect(page.locator('.password-toggle')).toBeFocused();
    // the intro is styled (--text-sm), not left at body size
    const size = (selector) =>
      page
        .locator(selector)
        .first()
        .evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    expect(await size('.stage-meta')).toBeLessThan(await size('[data-field="password"]'));
  });

  test('A6: a wrong current password is refused, nothing changes, and the old one still signs in', async ({
    page,
  }) => {
    await open(page);
    await page.goto('/admin/#/password');
    await expect(heading(page)).toHaveText('Change password');
    await fillForm(page, { current: 'not-the-password-1', next: NEW_1 });
    await expect(page.locator('main .screen-feedback')).toHaveText(
      'That is not your current password.',
    );
    await expect(heading(page)).toHaveText('Change password');
    // unchanged: the old password still signs in, the new one does not
    await expect(signInPassword({ email: admin.email, password })).resolves.toBeTruthy();
    await expect(signInPassword({ email: admin.email, password: NEW_1 })).rejects.toThrow();
  });

  test('the admin minimum is 12 characters (the form says so before any request)', async ({
    page,
  }) => {
    await open(page);
    await page.goto('/admin/#/password');
    await fillForm(page, { current: password, next: 'elevenchars' });
    await expect(page.locator('main .screen-feedback')).toHaveText('Use at least 12 characters.');
    await expect(signInPassword({ email: admin.email, password })).resolves.toBeTruthy();
  });

  test('A1 and A3: an aal2 admin changes the password; old refused, new works, the factor survived, the gate is unaffected', async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('link', { name: 'Change password' }).click();
    await fillForm(page, { current: password, next: NEW_1 });
    await expect(heading(page)).toHaveText('Password changed');
    await expect(page.locator('main')).toContainText('your other sessions were signed out');
    // A3: this session is still ready: the header says so and an admin function still answers
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.locator('h1')).toHaveText('Audit log');
    await page.reload();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    const old = password;
    password = NEW_1;
    // the old password no longer signs in; the new one does
    await expect(signInPassword({ email: admin.email, password: old })).rejects.toThrow();
    await expect(signInPassword({ email: admin.email, password })).resolves.toBeTruthy();
  });

  test('A1 (cont.): a fresh sign-in with the new password is challenged, not asked to enrol again', async ({
    page,
  }) => {
    await signIn(page, { email: admin.email, password });
    await expect(heading(page)).toHaveText('Verify it is you');
    await expect(page.locator('[data-field="secret"]')).toHaveCount(0);
  });

  test('A2: a second session of the same login is refused on its next call; the first stays ready', async ({
    browser,
  }) => {
    const first = await (await browser.newContext()).newPage();
    const second = await (await browser.newContext()).newPage();
    try {
      await open(first);
      await open(second);
      await second.getByRole('link', { name: 'Audit log' }).click();
      await expect(second.locator('h1')).toHaveText('Audit log');

      await first.getByRole('link', { name: 'Change password' }).click();
      await fillForm(first, { current: password, next: NEW_2 });
      await expect(heading(first)).toHaveText('Password changed');
      password = NEW_2;

      // the second session's next admin call is refused and the console takes it back to sign-in
      await second.getByRole('link', { name: 'Organisations' }).click();
      await expect(heading(second)).toHaveText('Admin sign in');

      // the first stays ready and can still call an admin function
      await first.getByRole('link', { name: 'Organisations' }).click();
      await expect(first.locator('header')).toContainText('Verified (AAL2)');
      await expect(first.locator('main h1')).toBeVisible();
      await first.getByRole('link', { name: 'Audit log' }).click();
      await expect(first.locator('h1')).toHaveText('Audit log');
    } finally {
      await first.context().close();
      await second.context().close();
    }
  });
});
