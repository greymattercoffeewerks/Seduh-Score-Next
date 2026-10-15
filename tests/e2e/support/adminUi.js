// Page helpers shared by the admin console's end-to-end specs: sign in, enrol an authenticator app, and check that a
// screen fits 360px with tappable controls. They drive the real page; nothing here fakes a response.
import { expect as baseExpect } from '@playwright/test';
import { nextCode } from './admins.js';

export const expect = baseExpect.configure({ timeout: 10000 });

export const heading = (page) => page.locator('h1');

export async function signIn(page, { email, password }) {
  await page.goto('/admin/');
  await expect(heading(page)).toHaveText('Admin sign in');
  await page.locator('[data-field="email"]').fill(email);
  await page.locator('[data-field="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// The enrolment screen: reads the manual-entry key the page shows (what a person with no camera types into
// their app), makes the code an authenticator app would show, and verifies it.
export async function enrol(page) {
  await expect(heading(page)).toHaveText('Set up your authenticator app');
  const key = await page.locator('[data-field="secret"]').textContent();
  const secret = key.replace(/\s/g, '');
  await expect(page.locator('img.adm-qr')).toBeVisible();
  await page.locator('[data-field="code"]').fill(await nextCode(secret));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.locator('header')).toContainText('Verified (AAL2)');
  return secret;
}

// 360px is the first width these screens are designed and checked at.
export async function expectFitsAndTappable(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const control of await page.locator('button, input, a').all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360.5);
  }
}
