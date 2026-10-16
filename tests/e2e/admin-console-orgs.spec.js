import { test } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';
import { nextCode, createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// T-ADM.D2: the Organisations panel (list and detail) against the real page and a real local Supabase stack. The
// organisations, their members and their event are made through the doors production uses (support/tenants.js);
// the admin is made by SQL (support/admins.js).
//
// What this proves that the unit tests (src/admin/orgsPanel.test.js, with a fake ctx) cannot: the real
// admin_list_orgs / admin_org_detail / admin_list_audit answers drawn on the real page, and that the event the
// organisation ran is NEVER on the page or in any admin response (spec D-A4: metadata only).

test.describe('the Organisations panel (real page, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  const uniq = Date.now().toString(36);
  const EVENT_NAME = `Hidden Cup ${uniq}`;
  let admin;
  let tenant;
  let staff;
  let adminResponses;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('orgs-admin');
    tenant = await createTenant({
      label: 'orgs-panel',
      format: 'cup_taster',
      payload: {},
      eventName: EVENT_NAME,
    });
    staff = await createLoneUser('orgs-staff');
    await addMember(tenant, staff, 'organiser');
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
    await tenant?.cleanUp();
  });

  // Every body the console receives from an admin function, to prove none of them carries the event's name.
  function recordAdminResponses(page) {
    adminResponses = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/rest/v1/rpc/admin_')) return;
      adminResponses.push({ url: response.url(), body: await response.text().catch(() => '') });
    });
  }

  async function open(page, { enrolFirst = false, secret } = {}) {
    recordAdminResponses(page);
    await signIn(page, admin);
    if (enrolFirst) return enrol(page);
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    return secret;
  }

  let secret;

  test('after the first sign-in the console opens on the Organisations list, with the counts for each organisation', async ({
    page,
  }) => {
    secret = await open(page, { enrolFirst: true });
    await expect(heading(page)).toHaveText('Organisations');
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('Organisations');
    // found by its own link name: other specs add organisations to the same list at the same time
    const card = page.locator('li.adm-org').filter({ hasText: tenant.slug });
    await expect(card).toHaveCount(1);
    await expect(card.locator('a')).toHaveText(tenant.orgName);
    await expect(card.locator('code')).toHaveText(tenant.slug);
    await expect(card).toContainText('2 members · 1 event · last event');
    // The event this organisation ran is nowhere on the page.
    await expect(page.locator('body')).not.toContainText(EVENT_NAME);
  });

  test('the detail shows the members with their roles, and still never the event', async ({
    page,
  }) => {
    await open(page, { secret });
    await expect(heading(page)).toHaveText('Organisations');
    await page.locator('li.adm-org').filter({ hasText: tenant.slug }).locator('a').click();
    await expect(heading(page)).toHaveText(tenant.orgName);
    await expect(page).toHaveURL(new RegExp(`#/orgs/${tenant.orgId}$`));
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('Organisations');

    const facts = page.locator('.adm-fact');
    await expect(facts.nth(0)).toContainText(tenant.slug);
    await expect(facts.nth(2)).toContainText('1 event');

    await expect(page.getByRole('heading', { name: 'Members (2)' })).toBeVisible();
    const members = page.locator('.adm-member');
    await expect(members.filter({ hasText: tenant.email })).toContainText('Owner');
    await expect(members.filter({ hasText: staff.email })).toContainText('Organiser');

    // Created through the service role, not the console, so there is nothing in the console's own change log.
    await expect(
      page.getByText('No changes have been made here through the console yet.'),
    ).toBeVisible();

    await expect(page.locator('body')).not.toContainText(EVENT_NAME);
    // And no admin function ever sent it: not the list, not the detail, not the change log.
    expect(adminResponses.length).toBeGreaterThanOrEqual(3);
    for (const { url, body } of adminResponses) {
      expect(body, url).not.toContain(EVENT_NAME);
    }
  });

  test('the way back, a reload on a detail, and the browser back button all work', async ({
    page,
  }) => {
    await open(page, { secret });
    await page.goto(`/admin/#/orgs/${tenant.orgId}`);
    await page.reload();
    // a reload keeps the session (this tab) and lands on the same organisation
    await expect(heading(page)).toHaveText(tenant.orgName);
    await page.locator('a.adm-back').click();
    await expect(heading(page)).toHaveText('Organisations');
    await page.goBack();
    await expect(heading(page)).toHaveText(tenant.orgName);
  });

  test('an organisation that does not exist, and an id that cannot be one, say so', async ({
    page,
  }) => {
    await open(page, { secret });
    await page.goto('/admin/#/orgs/00000000-0000-4000-8000-000000000000');
    await page.reload();
    await expect(page.locator('#admin-main .screen-feedback')).toContainText(
      'That organisation no longer exists.',
    );
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);

    // the panel's own data calls (a reload also runs the access check, which is a different function)
    const panelCalls = () =>
      adminResponses.filter(({ url }) => /admin_(org_detail|list_orgs|list_audit)/.test(url))
        .length;
    const before = panelCalls();
    await page.goto('/admin/#/orgs/not-an-id');
    await page.reload();
    await expect(heading(page)).toHaveText('Organisation not found');
    // nothing is asked of the database for an id that cannot be one
    expect(panelCalls()).toBe(before);
  });

  test('an address that names no panel is rewritten to the Organisations list, so Back does not strand the page', async ({
    page,
  }) => {
    await open(page, { secret });
    await page.goto('/admin/#/nowhere');
    await page.reload();
    await expect(heading(page)).toHaveText('Organisations');
    await expect(page).toHaveURL(/\/admin\/#\/orgs$/);
  });

  test('the skip button takes the keyboard straight to the content', async ({ page }) => {
    await open(page, { secret });
    await expect(heading(page)).toHaveText('Organisations');
    // Keyboard position back at the very top of the document (the console has moved focus to the heading).
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press('Tab');
    const skip = page.getByRole('button', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#admin-main')).toBeFocused();
  });
});

test.describe('the Organisations panel at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.describe.configure({ mode: 'serial' });

  let admin;
  let tenant;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('orgs-narrow-admin');
    // a long name and link name (the slug is capped at 40 characters, so the label is as long as it can be): the
    // cards must wrap them, not scroll the page sideways
    tenant = await createTenant({
      label: 'long-organisation-label',
      format: 'cup_taster',
      payload: {},
      eventName: 'Narrow Cup',
    });
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
    await tenant?.cleanUp();
  });

  test('the list and a detail fit the screen and every control is tappable', async ({ page }) => {
    await signIn(page, admin);
    await enrol(page);
    await expect(heading(page)).toHaveText('Organisations');
    const card = page.locator('li.adm-org').filter({ hasText: tenant.slug });
    await expect(card).toHaveCount(1);
    await expectFitsAndTappable(page);

    await card.locator('a').click();
    await expect(heading(page)).toHaveText(tenant.orgName);
    await expect(page.locator('.adm-member').first()).toBeVisible();
    await expectFitsAndTappable(page);
  });
});
