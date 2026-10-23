import { test } from '@playwright/test';
import { createTenant } from './support/tenants.js';
import { createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// The Plan panel against the real page and a real local Supabase stack: the keys are listed (all dark), a key can be
// PREVIEWED (and is never turned on here), an organisation's plan is drawn, a plan is given and revoked through the
// real audited functions, and the event the organisation ran is never named on the page or in any admin response (D-A4).

test.describe('the Plan panel (real page, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  const uniq = Date.now().toString(36);
  const EVENT_NAME = `Hidden Plan Cup ${uniq}`;
  let admin;
  let tenant;
  let responses;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('plan-admin');
    tenant = await createTenant({
      label: 'plan-panel',
      format: 'cup_taster',
      payload: {},
      eventName: EVENT_NAME,
    });
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
    await tenant?.cleanUp();
  });

  test('keys are dark, a preview changes nothing, and the organisation plan can be given and revoked', async ({
    page,
  }) => {
    test.setTimeout(90000);
    responses = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/rest/v1/rpc/admin_')) return;
      responses.push({ url: response.url(), body: await response.text().catch(() => '') });
    });
    await signIn(page, admin);
    await enrol(page);
    await page.setViewportSize({ width: 360, height: 800 });

    await page.getByRole('link', { name: 'Plans and keys' }).click();
    await expect(heading(page)).toHaveText('Plans and keys');
    // every key is dark in a fresh stack, and none is turned on by looking
    await expect(page.locator('li.adm-key').first()).toBeVisible();
    expect(await page.locator('li.adm-key .adm-badge', { hasText: /^Enforced$/ }).count()).toBe(0);
    const first = page.locator('li.adm-key').first();
    await first.getByRole('button', { name: /^Preview turning it on/ }).click();
    await expect(first.locator('.adm-key-preview')).toContainText('Turn on');
    await expect(first.locator('.adm-key-preview')).toContainText('would take it away from');
    expect(await page.locator('li.adm-key .adm-badge', { hasText: /^Enforced$/ }).count()).toBe(0);
    await expectFitsAndTappable(page);

    // the organisation, found by its own link name
    const card = page.locator('li.adm-org').filter({ hasText: tenant.orgName });
    await card.locator('a').first().click();
    await expect(heading(page)).toContainText(`Plan: ${tenant.orgName}`);
    await expect(page.locator('.adm-facts')).toContainText('Community');
    await expect(page.locator('body')).not.toContainText(EVENT_NAME);
    await expectFitsAndTappable(page);

    // give an Annual plan by hand
    const form = page.locator('form').filter({ hasText: 'Give the plan' });
    await form.locator('select').selectOption('annual');
    await form.getByRole('button', { name: 'Give the plan' }).click();
    await expect(page.locator('.adm-main > .screen-feedback')).toContainText('Annual plan given.');
    await expect(page.locator('.adm-facts')).toContainText('Annual');
    await expect(page.locator('li.adm-grant')).toContainText('Granted by hand');

    // revoke it (a question first)
    await page.locator('li.adm-grant').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.locator('li.adm-grant')).toContainText('Revoke this Annual plan?');
    await page.locator('li.adm-grant').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.locator('.adm-main > .screen-feedback')).toContainText(
      'The plan was revoked.',
    );
    await expect(page.locator('.adm-facts')).toContainText('Community');
    await expectFitsAndTappable(page);

    // the audit log names both changes
    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.locator('ol.adm-audit')).toContainText('Plan given');
    await expect(page.locator('ol.adm-audit')).toContainText('Plan revoked');

    // the event the organisation ran appears in no admin response and not on any page seen
    for (const r of responses) expect(r.body).not.toContain(EVENT_NAME);
  });
});
