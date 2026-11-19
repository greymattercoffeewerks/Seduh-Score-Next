import { randomUUID, randomInt } from 'node:crypto';
import { test, expect as baseExpect } from '@playwright/test';
import { createLoneUser } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';

// T-ID2.NM: "This isn't mine" on a recorded result, in a real browser at 360px against the real app and local Supabase.
// A fictional claimed person has one recorded result (a published Cup Taster event whose roster links them). They sign in with the
// emailed code, open "Recorded results", say it is not theirs (with a reason), and the PUBLIC page /id/<handle>/ drops it at once
// while the event's own results payload is untouched; "Show it again" brings it back. Everything is fictional.

const expect = baseExpect.configure({ timeout: 20000 });
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const unique = () => randomUUID().replaceAll('-', '').slice(0, 10);
const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

test.use({ viewport: { width: 360, height: 780 } });
test.describe.configure({ mode: 'serial' });

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function codeFor(email) {
  const search = async () =>
    (
      await (
        await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
      ).json()
    ).messages ?? [];
  await expect
    .poll(async () => (await search()).length, { intervals: [250, 500, 1000] })
    .toBeGreaterThan(0);
  const [newest] = await search();
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
  const match = `${message.Text ?? ''}\n${message.HTML ?? ''}`.match(/\b(\d{6})\b/);
  if (!match) throw new Error('no six-digit code in the email');
  return match[1];
}

const run = unique();
const handle = `notmine${run}`;
const eventName = `Not Mine Cup ${run}`;
const personName = `Nm Person ${run}`;
let email;
let eventId;

test.beforeAll(async () => {
  const user = await createLoneUser('notmine');
  email = user.email;
  const [identityId, accountId, orgId, personId] = Array.from({ length: 4 }, randomUUID);
  eventId = randomUUID();
  const number = phone();
  sqlAsOwner(
    [
      `insert into orgs (id, name, slug) values ('${orgId}', ${q(`Nm Org ${run}`)}, ${q(`nm-org-${run}`)})`,
      `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${number}', ${q(personName)}, 'organiser_roster', 'BN')`,
      `insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values ('${accountId}', '${identityId}', '${user.userId}', ${q(handle)}, 'organiser_link', now())`,
      `insert into people (id, org_id, display_name, phone) values ('${personId}', '${orgId}', ${q(personName)}, '${number}')`,
      `select set_config('app.seduh_link_write', 'on', true)`,
      `update people set global_person_id = '${identityId}' where id = '${personId}'`,
      `insert into events (id, org_id, format, name, event_date) values ('${eventId}', '${orgId}', 'cup_taster', ${q(eventName)}, '2026-10-10')`,
      `insert into event_entries (id, event_id, person_id, display_name, cafe) values ('${randomUUID()}', '${eventId}', '${personId}', ${q(personName)}, 'Proof Cafe')`,
      `insert into public.public_results (id, org_id, event_id, payload) values ('${randomUUID()}', '${orgId}', '${eventId}', jsonb_build_object('format', 'cup_taster', 'eventName', ${q(eventName)}, 'eventDate', '2026-10-10', 'standings', jsonb_build_array(jsonb_build_object('place', 1, 'name', ${q(personName)}, 'cafe', 'Proof Cafe', 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 100))))`,
    ].join(';\n') + ';',
  );
});

async function signIn(page) {
  await page.goto('/id/me/');
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('6-digit code').fill(await codeFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#me-record-title')).toBeVisible();
}

const publicText = async (page) => {
  await page.goto(`/id/${handle}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(personName);
  return page.locator('main').innerText();
};

test('"This isn’t mine" hides the result at once, and "Show it again" restores it', async ({
  page,
}) => {
  expect(await publicText(page)).toContain(eventName);

  await signIn(page);
  await page.getByRole('button', { name: 'Recorded results' }).click();
  await expect(page.locator('#me-recorded-title')).toBeVisible();
  const row = page.locator('.me-entry', { hasText: eventName });
  await expect(row).toContainText('1st place');
  expect(await overflow(page)).toBe(0);

  // the confirm step asks first; "Keep it" changes nothing
  await row.getByRole('button', { name: /This isn’t mine/ }).click();
  await expect(row).toContainText('The event’s own results page does not change');
  expect(await overflow(page)).toBe(0);
  await row.getByRole('button', { name: /^Keep / }).click();
  await expect(row.getByRole('button', { name: /This isn’t mine/ })).toBeFocused();

  await row.getByRole('button', { name: /This isn’t mine/ }).click();
  await row.getByLabel('Why? (optional)').fill('Wrong phone number');
  await row.getByRole('button', { name: /^Yes, hide / }).click();
  await expect(page.locator('#me-status')).toContainText('Hidden from your page');
  await expect(row).toContainText('Hidden from your public page while we check it');
  expect(await overflow(page)).toBe(0);

  // at once on the public page; the organiser's published payload is unchanged
  expect(await publicText(page)).not.toContain(eventName);
  const payload = sqlAsOwner(
    `select payload::text from public.public_results where event_id = '${eventId}'`,
  );
  expect(String(payload)).toContain(personName);

  // the owner's queue sees it
  const queue = sqlAsOwner(
    `select status || '/' || reason from app.seduh_disputes_overview() where handle = ${q(handle)}`,
  );
  expect(String(queue)).toContain('pending/Wrong phone number');

  // undo (the session survives in this tab's storage)
  await page.goto('/id/me/');
  await expect(page.locator('#me-record-title')).toBeVisible();
  await page.getByRole('button', { name: 'Recorded results' }).click();
  await page
    .locator('.me-entry', { hasText: eventName })
    .getByRole('button', { name: 'Show it again' })
    .click();
  await expect(page.locator('#me-status')).toContainText('back on your page');
  expect(await publicText(page)).toContain(eventName);
});
