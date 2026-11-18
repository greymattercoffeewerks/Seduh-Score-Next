import { randomUUID, randomInt } from 'node:crypto';
import { test, expect as baseExpect } from '@playwright/test';
import { createLoneUser } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';

// T-ID2.C6a/C6b: courses and certificates in a real browser against the real app and the real local Supabase stack, at 360px.
// A fictional claimed person signs in with the emailed code (Mailpit), adds a current and an expired course, edits one, picks the
// card certificate, hides and shows courses in Privacy, and deletes one; the PUBLIC page /id/<handle>/ reflects each change:
// the sub-section sits inside the record, is labelled self-reported, shows the expired one in muted text, never counts as entries,
// and disappears (with the card choice) when the person hides courses. Everything is fictional.

const expect = baseExpect.configure({ timeout: 20000 });
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const unique = () => randomUUID().replaceAll('-', '').slice(0, 10);
const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;

test.use({ viewport: { width: 360, height: 780 } });

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

async function claimedPerson(label) {
  const handle = `${label}${unique()}`;
  const user = await createLoneUser(label);
  const [identityId, accountId] = [randomUUID(), randomUUID()];
  sqlAsOwner(
    `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${phone()}', ${sqlText(`Course Proof ${label}`)}, 'organiser_roster', 'BN');` +
      `insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values ('${accountId}', '${identityId}', '${user.userId}', ${sqlText(handle)}, 'organiser_link', now());`,
  );
  return { handle, email: user.email };
}

async function signIn(page, email) {
  await page.goto('/id/me/');
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(
    page.getByText(`If that email has a Seduh ID, we sent a code to ${email}`),
  ).toBeVisible();
  await page.getByLabel('6-digit code').fill(await codeFor(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#me-record-title')).toBeVisible();
}

async function addCourse(page, { title, provider, year, until }) {
  await page.locator('#me-add-course').click();
  const form = page.locator('form.me-entry-form');
  await form.locator('[name="title"]').fill(title);
  await form.locator('[name="provider"]').fill(provider);
  await form.locator('[name="year"]').fill(String(year));
  if (until) await form.locator('[name="valid_until_year"]').fill(String(until));
  await form.getByRole('button', { name: 'Add course' }).click();
  await expect(page.locator('#me-status')).toHaveText('Course added.');
}

test.describe('Courses and certificates (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let person;
  test.beforeAll(async () => {
    person = await claimedPerson('crs');
  });

  test('add a current and an expired course; the public page shows them in the record, self-reported, not as entries', async ({
    page,
  }) => {
    await signIn(page, person.email);
    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    await expect(page.locator('#me-courses-title')).toBeVisible();
    await expect(page.getByText('You have not added any courses yet.')).toBeVisible();

    // a refusal in words, nothing saved
    await page.locator('#me-add-course').click();
    await page.locator('form.me-entry-form').getByRole('button', { name: 'Add course' }).click();
    await expect(page.locator('form.me-entry-form')).toContainText('Enter the course');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await addCourse(page, {
      title: 'Proof Barista Skills',
      provider: 'Proof Academy',
      year: 2024,
      until: 2099,
    });
    await addCourse(page, {
      title: 'Proof Old Licence',
      provider: 'Proof Institute',
      year: 2018,
      until: 2020,
    });
    await expect(page.getByText('2 of 60 courses')).toBeVisible();
    await expect(page.getByText('Completed 2018 · expired 2020')).toBeVisible();
    // only a current course can be put on the card
    await expect(page.getByRole('button', { name: /Show on my card/ })).toHaveCount(1);
    expect(await overflow(page)).toBe(0);

    await page.goto(`/id/${person.handle}/`);
    const block = page.locator('.profile-courses');
    await expect(block).toBeVisible();
    await expect(block.locator('h3')).toHaveText('Courses and certificates · 2');
    await expect(block).toContainText('Self-reported, not verified by Seduh');
    await expect(block).toContainText('Valid until 2099');
    await expect(block).toContainText('Expired 2020');
    await expect(block.locator('.is-expired')).toHaveCount(1);
    // courses sit INSIDE the record section and never count as entries
    await expect(
      page.locator('[aria-labelledby="profile-record-title"] .profile-courses'),
    ).toHaveCount(1);
    await expect(page.locator('.profile-year')).toHaveCount(0);
    expect(await overflow(page)).toBe(0);
  });

  test('edit a course, choose the card certificate, then hide and show courses in Privacy', async ({
    page,
  }) => {
    await signIn(page, person.email);
    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Proof Barista Skills' }).click();
    const form = page.locator('form.me-entry-form');
    await form.locator('[name="level"]').fill('Intermediate');
    await form.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#me-status')).toHaveText('Course saved.');
    await expect(page.getByText('Proof Academy · Intermediate')).toBeVisible();

    await page.getByRole('button', { name: /Show on my card: Proof Barista Skills/ }).click();
    await expect(page.getByText('Shown on your card')).toBeVisible();
    await expect(page.getByRole('button', { name: /Remove from my card/ })).toBeVisible();

    // hide courses: the public page shows none
    await page.getByRole('button', { name: 'Privacy', exact: true }).click();
    await page.locator('input[name="vis_courses"][value="hidden"]').check();
    await expect(page.locator('#me-status')).toContainText(
      'Courses and certificates: Hidden. Saved.',
    );
    await page.goto(`/id/${person.handle}/`);
    await expect(page.locator('.profile-courses')).toHaveCount(0);

    // the person still sees all of theirs
    await page.goto('/id/me/');
    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    await expect(page.getByText('2 of 60 courses')).toBeVisible();
    await expect(page.getByText('Your courses are hidden')).toBeVisible();

    await page.getByRole('button', { name: 'Privacy', exact: true }).click();
    await page.locator('input[name="vis_courses"][value="public"]').check();
    await expect(page.locator('#me-status')).toContainText(
      'Courses and certificates: Public. Saved.',
    );
    await page.goto(`/id/${person.handle}/`);
    await expect(page.locator('.profile-courses')).toBeVisible();
  });

  test('the database never reports a certificate on the card once it has expired, and delete removes the course', async ({
    page,
  }) => {
    // an owner-side expiry behind the doors' back: the public door must still say it is not on the card
    sqlAsOwner(
      `update app.seduh_courses set valid_until_year = 2024 where title = 'Proof Barista Skills' and account_id = (select id from app.seduh_accounts where handle = ${sqlText(person.handle)});`,
    );
    await signIn(page, person.email);
    await page.getByRole('button', { name: 'Courses', exact: true }).click();
    await expect(page.getByRole('button', { name: /Show on my card/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete Proof Old Licence' }).click();
    await expect(page.getByText('This cannot be undone')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, delete it' }).click();
    await expect(page.locator('#me-status')).toHaveText('Course deleted.');
    await expect(page.getByText('1 of 60 courses')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.goto(`/id/${person.handle}/`);
    await expect(page.locator('.profile-courses h3')).toHaveText('Courses and certificates · 1');
  });
});
