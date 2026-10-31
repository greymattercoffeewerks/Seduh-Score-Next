import { test } from '@playwright/test';
import { createPlatformAdmin, removePlatformAdmin, sqlAsOwner } from './support/admins.js';
import { expect, heading, signIn, enrol, expectFitsAndTappable } from './support/adminUi.js';

// T-ID.C3: the Seduh ID screen (owner decision 7a: counts only) against the real page and the real local Supabase
// stack. The numbers on screen come from the database's own function; a row added behind the page's back shows up on
// Refresh; and the page and every admin response carry no name and no phone (D-A4).

test.describe('the Seduh ID screen (real page, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  const uniq = Date.now().toString(36);
  const NAME = `Hidden Identity ${uniq}`;
  // a number that no other spec uses: +673 9 then seven digits derived from the clock
  const PHONE = `+6739${String(Date.now()).slice(-7)}`;
  let admin;

  test.beforeAll(async () => {
    test.setTimeout(90000);
    admin = await createPlatformAdmin('seduh-id-admin');
  });

  test.afterAll(async () => {
    sqlAsOwner(`delete from app.seduh_identities where phone_e164 = '${PHONE}'`);
    if (admin) removePlatformAdmin(admin);
  });

  test('the numbers are drawn at 360px, Refresh picks up a new identity, and no name or phone is ever on the page', async ({
    page,
  }) => {
    test.setTimeout(90000);
    const responses = [];
    page.on('response', (response) => {
      if (!response.url().includes('/rest/v1/rpc/admin_')) return;
      responses.push(response.text().catch(() => ''));
    });
    await signIn(page, admin);
    await enrol(page);
    await page.setViewportSize({ width: 360, height: 800 });

    await page.locator('nav').getByRole('link', { name: 'Seduh ID' }).click();
    await expect(heading(page)).toHaveText('Seduh ID');
    await expect(page.getByText(/Numbers only: this screen never shows a name/)).toBeVisible();
    await expect(page.getByText(/Merges and unlinks are done by the owner in SQL/)).toBeVisible();
    const total = page.locator('.adm-fact', { hasText: 'Identities in total' }).locator('dd');
    const people = page
      .locator('.adm-fact', { hasText: 'People in all organisations' })
      .locator('dd');
    await expect(people).toBeVisible();
    // a fresh stack can hold no identity (the empty state) or some; either way the people group is drawn
    const before = (await total.count()) ? Number(await total.innerText()) : 0;
    await expectFitsAndTappable(page);

    sqlAsOwner(
      `insert into app.seduh_identities (phone_e164, display_name, source) values ('${PHONE}', '${NAME}', 'archive')`,
    );
    await page.getByRole('button', { name: 'Refresh numbers' }).click();
    await expect(total).toHaveText(String(before + 1));
    await expect(page.getByRole('button', { name: 'Refresh numbers' })).toBeFocused();
    await expectFitsAndTappable(page);

    const body = await page.locator('body').innerText();
    expect(body).not.toContain(NAME);
    expect(body).not.toContain(PHONE);
    for (const text of await Promise.all(responses)) {
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(PHONE);
    }
  });
});
