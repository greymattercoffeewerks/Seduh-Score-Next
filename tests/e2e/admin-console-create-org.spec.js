import { test } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';
import { nextCode, createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// T-ADM.D3: the New organisation panel against the real page and a real local Supabase stack. The ORGANISATION step
// is always real: admin_create_org, admin_find_user and the audit list answer from the database. The Edge Function
// that makes a new login (admin-accounts) is not served by `supabase start`, which is all CI runs (the real function
// is exercised by supabase/tests/manual/admin-accounts-e2e.mjs before rollout), so the new-login path answers it at
// the network edge with what the function documents and attaches a REAL account made through the Auth API.

const uniq = Date.now().toString(36);
const NEW_PASSWORD = 'Pw-e2e-Zk2-Qm9x';

// The function's answers, with CORS (the page is on another origin than the API, so a preflight comes first).
function stubAdminAccounts(page, respond) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  return page.route('**/functions/v1/admin-accounts', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const { status, body } = respond(route.request().postDataJSON());
    await route.fulfill({
      status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  });
}

async function openNewOrganisation(page, { secret, enrolFirst = false, admin }) {
  await signIn(page, admin);
  if (enrolFirst) {
    secret = await enrol(page);
  } else {
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
  }
  await page.locator('nav').getByRole('link', { name: 'New organisation' }).click();
  await expect(heading(page)).toHaveText('New organisation');
  return secret;
}

const fillOrg = async (page, name, slug) => {
  await page.getByLabel('Organisation name').fill(name);
  await page.getByLabel('Link name').fill(slug);
};

async function lookUp(page, email) {
  await page.getByLabel('Owner’s email').fill(email);
  await page.getByRole('button', { name: 'Look up account' }).click();
}

test.describe('the New organisation panel (real page, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let admin;
  let other;
  let secret;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('create-org-admin');
    other = await createTenant({
      label: 'create-org-other',
      format: 'cup_taster',
      payload: {},
      eventName: 'Other Cup',
    });
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
    await other?.cleanUp();
  });

  test('an existing account with no organisation becomes the owner of a new one, and the detail and the audit show it', async ({
    page,
  }) => {
    const owner = await createLoneUser('create-org-owner');
    secret = await openNewOrganisation(page, { enrolFirst: true, admin });
    const slug = `d10-${uniq}-a`;
    await fillOrg(page, `Create Org A ${uniq}`, slug.toUpperCase());
    // a link name typed in capitals is shown as it will be saved
    await expect(page.locator('#adm-org-slug-input-preview')).toHaveText(
      `It will be saved as ${slug}.`,
    );

    await page.getByLabel('Use an existing account').check();
    await lookUp(page, owner.email);
    await expect(page.locator('.adm-lookup')).toContainText(`Found: ${owner.email}`);
    await expect(page.locator('.adm-lookup')).toContainText('not in any organisation yet');
    await expect(
      page.getByLabel('I have confirmed that this person set their own password.'),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(heading(page)).toHaveText('Organisation created');
    await expect(page.locator('body')).toContainText(
      `Create Org A ${uniq} was created. Its link name is ${slug}.`,
    );
    // an existing account has no one-time password to show
    await expect(page.locator('.adm-password')).toHaveCount(0);

    await page.getByRole('link', { name: 'View organisation' }).click();
    await expect(heading(page)).toHaveText(`Create Org A ${uniq}`);
    await expect(page.locator('.adm-member')).toHaveCount(1);
    await expect(page.locator('.adm-member')).toContainText(owner.email);
    await expect(page.locator('.adm-member')).toContainText('Owner');
    // the database wrote the audit row, and the detail screen reads it
    const entry = page.locator('.adm-audit-item').first();
    await expect(entry).toContainText('Organisation created');
    await expect(entry).toContainText(`by ${admin.email}`);
    await expect(entry).toContainText(owner.email);
  });

  test('the database refuses what the page cannot know: a taken link name, a missing account, the operator themselves', async ({
    page,
  }) => {
    const lone = await createLoneUser('create-org-refused');
    await openNewOrganisation(page, { secret, admin });
    await page.getByLabel('Use an existing account').check();

    // a taken link name: the page cannot know, the database says
    await fillOrg(page, `Refused ${uniq}`, other.slug);
    await lookUp(page, lone.email);
    await expect(page.locator('.adm-lookup')).toContainText(`Found: ${lone.email}`);
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(page.locator('#admin-main .screen-feedback')).toHaveText(
      'That link name is already used by another organisation.',
    );
    // and nothing was made: the form is still here, and the organisation is not
    await expect(heading(page)).toHaveText('New organisation');

    // a reserved word is caught by the page before it asks
    await page.getByLabel('Link name').fill('admin');
    await page.getByLabel('Link name').blur();
    await expect(page.locator('#adm-org-slug-input-error')).toHaveText(
      'That link name is reserved. Choose another.',
    );

    // an address with no account
    await page.getByLabel('Owner’s email').fill(`nobody-${uniq}@local.test`);
    await page.getByRole('button', { name: 'Look up account' }).click();
    await expect(page.locator('#admin-main .screen-feedback')).toHaveText(
      'No active account matches that. Check the email.',
    );

    // the operator's own account: the database refuses to make them an owner here
    await page.getByLabel('Link name').fill(`d10-${uniq}-self`);
    await lookUp(page, admin.email);
    await expect(page.locator('.adm-lookup')).toContainText(`Found: ${admin.email}`);
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(page.locator('#admin-main .screen-feedback')).toHaveText(
      'You cannot change your own access here. Use SQL if you really need to.',
    );
  });

  test('an account whose password someone else may know needs the box ticked, and the box is what lets it through', async ({
    page,
  }) => {
    const member = await createLoneUser('create-org-member');
    await addMember(other, member, 'organiser');
    await openNewOrganisation(page, { secret, admin });
    await page.getByLabel('Use an existing account').check();
    await fillOrg(page, `Create Org B ${uniq}`, `d10-${uniq}-b`);
    await lookUp(page, member.email);
    await expect(page.locator('.adm-lookup')).toContainText('already in 1 organisation');
    const box = page.getByLabel('I have confirmed that this person set their own password.');
    await expect(box).not.toBeChecked();

    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(page.locator('#admin-main .screen-feedback')).toHaveText(
      'Tick the box to confirm that this person set their own password.',
    );
    await expect(heading(page)).toHaveText('New organisation');

    await box.check();
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(heading(page)).toHaveText('Organisation created');
  });

  test('a new login: the password is shown once with its warning, goes on Done, and is not shown again after a reload', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const login = await createLoneUser('create-org-new-login');
    let sent;
    await stubAdminAccounts(page, (body) => {
      sent = body;
      return {
        status: 201,
        body: { userId: login.userId, email: login.email, password: NEW_PASSWORD },
      };
    });
    await openNewOrganisation(page, { secret, admin });
    await fillOrg(page, `Create Org C ${uniq}`, `d10-${uniq}-c`);
    await page.getByLabel('Owner’s email').fill(login.email);
    await page.getByRole('button', { name: 'Create organisation' }).click();

    await expect(heading(page)).toHaveText('Organisation created');
    expect(sent).toEqual({ action: 'create_owner', email: login.email });
    await expect(page.locator('.adm-password')).toHaveText(NEW_PASSWORD);
    await expect(page.locator('#adm-issued-warning')).toHaveText(
      'This is the only time this password is shown.',
    );
    await expect(page.getByRole('link', { name: 'View organisation' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('body')).not.toContainText(NEW_PASSWORD);
    await page.getByRole('link', { name: 'View organisation' }).click();
    await expect(page.locator('.adm-member')).toContainText(login.email);

    // a reload shows nothing of it: not in the page, not in this tab's storage
    await page.reload();
    await expect(page.locator('body')).not.toContainText(NEW_PASSWORD);
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...window.sessionStorage, ...window.localStorage }),
    );
    expect(stored).not.toContain(NEW_PASSWORD);
  });

  test('a new login whose email already has an account says so and offers the existing-account path', async ({
    page,
  }) => {
    await stubAdminAccounts(page, () => ({
      status: 409,
      body: { error: 'That email already has an account.', hint: 'email_taken' },
    }));
    await openNewOrganisation(page, { secret, admin });
    await fillOrg(page, `Create Org D ${uniq}`, `d10-${uniq}-d`);
    await page.getByLabel('Owner’s email').fill(`taken-${uniq}@local.test`);
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(page.locator('#admin-main .screen-feedback')).toContainText(
      'That email already has an account. Choose "Use an existing account" instead.',
    );
    await page.getByRole('button', { name: 'Use an existing account instead' }).click();
    await expect(page.getByLabel('Use an existing account')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Look up account' })).toBeFocused();
  });

  test('a login that was made but whose organisation was refused stays on screen and is attached on the next try, not made again', async ({
    page,
  }) => {
    const login = await createLoneUser('create-org-retry');
    let calls = 0;
    await stubAdminAccounts(page, () => {
      calls += 1;
      return {
        status: 201,
        body: { userId: login.userId, email: login.email, password: NEW_PASSWORD },
      };
    });
    await openNewOrganisation(page, { secret, admin });
    // the first try uses a link name that is taken
    await fillOrg(page, `Create Org E ${uniq}`, other.slug);
    await page.getByLabel('Owner’s email').fill(login.email);
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(page.locator('#admin-main .screen-feedback')).toHaveText(
      'That link name is already used by another organisation.',
    );
    await expect(page.locator('.adm-password')).toHaveText(NEW_PASSWORD);

    await page.getByLabel('Link name').fill(`d10-${uniq}-e`);
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(heading(page)).toHaveText('Organisation created');
    expect(calls).toBe(1);
    await expect(page.locator('.adm-password')).toHaveText(NEW_PASSWORD);
  });
});

test.describe('the New organisation panel at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.describe.configure({ mode: 'serial' });

  let admin;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('create-org-narrow');
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
  });

  test('the form, a lookup, and the one-time password all fit the screen and every control is tappable', async ({
    page,
  }) => {
    const login = await createLoneUser('create-org-narrow-login');
    await stubAdminAccounts(page, () => ({
      status: 201,
      body: { userId: login.userId, email: login.email, password: NEW_PASSWORD },
    }));
    await openNewOrganisation(page, { enrolFirst: true, admin });
    await expectFitsAndTappable(page);

    await page.getByLabel('Use an existing account').check();
    await page.getByLabel('Owner’s email').fill(login.email);
    await page.getByRole('button', { name: 'Look up account' }).click();
    await expect(page.locator('.adm-lookup')).toContainText(`Found: ${login.email}`);
    await expectFitsAndTappable(page);

    await page.getByLabel('New login.').check();
    await fillOrg(
      page,
      `Narrow Organisation With A Long Name ${uniq}`,
      `d10-${uniq}-narrow-organisation`,
    );
    await page.getByLabel('Owner’s email').fill(login.email);
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(heading(page)).toHaveText('Organisation created');
    await expect(page.locator('.adm-password')).toHaveText(NEW_PASSWORD);
    await expectFitsAndTappable(page);
  });
});
