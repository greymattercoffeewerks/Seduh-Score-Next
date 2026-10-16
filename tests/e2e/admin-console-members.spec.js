import { test } from '@playwright/test';
import { addMember, createLoneUser, createTenant } from './support/tenants.js';
import { nextCode, createPlatformAdmin, removePlatformAdmin } from './support/admins.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// T-ADM.D4 and D5: attaching an existing account to an organisation, changing a member's role, and the Audit log
// screen, against the real page and a real local Supabase stack. Everything the panel asks is answered by the real
// admin_find_user / admin_add_member / admin_set_role / admin_list_audit: the refusals (the last owner, an
// attestation) are the database's own.

const uniq = Date.now().toString(36);

// The message region of the Add a member form (the page's own region above it holds notices after a change).
const addFeedback = (page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Add a member' }) })
    .locator('.screen-feedback');

async function openDetail(page, { admin, tenant, secret, enrolFirst = false }) {
  await signIn(page, admin);
  if (enrolFirst) {
    secret = await enrol(page);
  } else {
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
  }
  await page.goto(`/admin/#/orgs/${tenant.orgId}`);
  await expect(heading(page)).toHaveText(tenant.orgName);
  return secret;
}

async function addExisting(page, email, { role = 'Organiser' } = {}) {
  await page.getByLabel('Account email').fill(email);
  await page.getByRole('button', { name: 'Look up account' }).click();
  await expect(page.locator('.adm-lookup')).toContainText(`Found: ${email}`);
  await page.getByLabel('Role').selectOption({ label: role });
}

test.describe('Members and the Audit log (real page, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let admin;
  let tenant;
  let other;
  let secret;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('members-admin');
    tenant = await createTenant({
      label: 'mem-main',
      format: 'cup_taster',
      payload: {},
      eventName: 'Members Cup',
    });
    other = await createTenant({
      label: 'mem-other',
      format: 'cup_taster',
      payload: {},
      eventName: 'Other Cup',
    });
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
    await tenant?.cleanUp();
    await other?.cleanUp();
  });

  test('an existing account is added as an organiser, appears in the list, and the Audit log shows who did it', async ({
    page,
  }) => {
    const person = await createLoneUser('members-added');
    secret = await openDetail(page, { admin, tenant, enrolFirst: true });
    await expect(page.locator('.adm-member')).toHaveCount(1);

    await addExisting(page, person.email);
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.locator('#admin-main .screen-feedback').first()).toHaveText(
      `${person.email} was added as Organiser.`,
    );
    await expect(page.locator('.adm-member')).toHaveCount(2);
    await expect(page.locator('.adm-member').filter({ hasText: person.email })).toContainText(
      'Organiser',
    );
    await expect(heading(page)).toBeFocused();

    // the organisation's own recent changes, and then the Audit log screen, both read the database's row
    await expect(page.locator('.adm-audit-item').first()).toContainText(
      'Member added as Organiser',
    );
    await page.locator('nav').getByRole('link', { name: 'Audit log' }).click();
    await expect(heading(page)).toHaveText('Audit log');
    const entry = page.locator('.adm-audit-item').filter({ hasText: person.email }).first();
    await expect(entry).toContainText('Member added as Organiser');
    await expect(entry).toContainText(`by ${admin.email}`);
    await expect(entry.getByRole('link', { name: tenant.slug })).toHaveAttribute(
      'href',
      `#/orgs/${tenant.orgId}`,
    );
  });

  test('an account whose password someone else may know is added only with the box ticked, and the log says so', async ({
    page,
  }) => {
    const person = await createLoneUser('members-attested');
    await addMember(other, person, 'organiser');
    await openDetail(page, { admin, tenant, secret });
    await addExisting(page, person.email);
    await expect(page.locator('.adm-lookup')).toContainText('already in 1 organisation');

    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(addFeedback(page)).toHaveText(
      'Tick the box to confirm that this person set their own password.',
    );
    await expect(page.locator('.adm-member').filter({ hasText: person.email })).toHaveCount(0);

    await page.getByLabel('I have confirmed that this person set their own password.').check();
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.locator('.adm-member').filter({ hasText: person.email })).toHaveCount(1);
    await expect(page.locator('.adm-audit-item').first()).toContainText(
      'Member added as Organiser, after confirming their own password',
    );
  });

  test('the database refuses what the page cannot know: an account already in this organisation, or none at all', async ({
    page,
  }) => {
    const person = await createLoneUser('members-twice');
    await openDetail(page, { admin, tenant, secret });
    await addExisting(page, person.email);
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.locator('.adm-member').filter({ hasText: person.email })).toHaveCount(1);

    // the same account again: the page is looking at a fresh form, the database says it is already a member
    await addExisting(page, person.email);
    // (it now belongs to an organisation, so the database asks for the confirmation first)
    await page.getByLabel('I have confirmed that this person set their own password.').check();
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(addFeedback(page)).toContainText('That account is already in this organisation.');

    await page.getByLabel('Account email').fill(`nobody-${uniq}@local.test`);
    await page.getByRole('button', { name: 'Look up account' }).click();
    await expect(page.locator('#adm-member-email-error')).toHaveText(
      'No active account matches that. Check the email.',
    );
  });

  test('a role is changed after a confirmation, shows at once, and the Audit log has from and to', async ({
    page,
  }) => {
    await openDetail(page, { admin, tenant, secret });
    const row = page.locator('.adm-member').filter({ hasText: 'members-added' });
    await row.getByRole('button', { name: /^Make .* an owner$/ }).click();
    await expect(row).toContainText('from Organiser to Owner?');
    // cancelling changes nothing
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toContainText('Organiser');
    await row.getByRole('button', { name: /^Make .* an owner$/ }).click();
    await row.getByRole('button', { name: /^Confirm/ }).click();

    await expect(page.locator('#admin-main .screen-feedback').first()).toContainText(
      'is now Owner.',
    );
    await expect(page.locator('.adm-member').filter({ hasText: 'members-added' })).toContainText(
      'Owner',
    );
    await expect(page.locator('.adm-audit-item').first()).toContainText(
      'Role changed from Organiser to Owner',
    );
  });

  test('the last owner cannot be demoted: the database says so, and the role is unchanged', async ({
    page,
  }) => {
    // `other` has exactly one member, its owner
    await signIn(page, admin);
    await expect(heading(page)).toHaveText('Verify it is you');
    await page.locator('[data-field="code"]').fill(await nextCode(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('header')).toContainText('Verified (AAL2)');
    await page.goto(`/admin/#/orgs/${other.orgId}`);
    await expect(heading(page)).toHaveText(other.orgName);
    // `other` has its owner and one organiser (added in the attestation test): the owner is the ONLY owner
    const owner = page.locator('.adm-member').filter({ hasText: other.email });
    await owner.getByRole('button', { name: /^Make .* an organiser$/ }).click();
    await owner.getByRole('button', { name: /^Confirm/ }).click();
    await expect(owner).toContainText(
      'An organisation must keep at least one owner. Promote another member first.',
    );
    await expect(owner).toContainText('Owner');
  });
});

test.describe('Members and the Audit log at 360px', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test.describe.configure({ mode: 'serial' });

  let admin;
  let tenant;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('members-narrow');
    tenant = await createTenant({
      label: 'mem-narrow-wide',
      format: 'cup_taster',
      payload: {},
      eventName: 'Narrow Cup',
    });
  });

  test.afterAll(async () => {
    if (admin) removePlatformAdmin(admin);
    await tenant?.cleanUp();
  });

  test('the detail with the add form and a role question, and the Audit log, fit the screen and every control is tappable', async ({
    page,
  }) => {
    const person = await createLoneUser('members-narrow-person');
    await openDetail(page, { admin, tenant, enrolFirst: true });
    await expectFitsAndTappable(page);

    await addExisting(page, person.email);
    await expectFitsAndTappable(page);
    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.locator('.adm-member')).toHaveCount(2);

    await page
      .locator('.adm-member')
      .filter({ hasText: person.email })
      .getByRole('button', { name: /an owner$/ })
      .click();
    await expect(page.getByRole('button', { name: /^Confirm/ })).toBeVisible();
    await expectFitsAndTappable(page);

    await page.locator('nav').getByRole('link', { name: 'Audit log' }).click();
    await expect(page.locator('.adm-audit-item').first()).toBeVisible();
    await expectFitsAndTappable(page);
  });
});
