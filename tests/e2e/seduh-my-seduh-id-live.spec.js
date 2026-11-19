import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { test, expect as baseExpect } from '@playwright/test';
import { createLoneUser } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';

// T-ID2.D-b: "My Seduh ID" (/id/me/) in a real browser against the real app and the real local Supabase stack. A fictional claimed
// person signs in with the emailed 6-digit code (Mailpit), adds, edits and deletes an entry, links and unlinks a team, changes
// privacy settings, and the PUBLIC page /id/<handle>/ reflects each change. Also: a signed-out visit shows sign-in; an unknown
// email gets the same words as a known one; the claim page, a person page and a country page still answer. Everything is
// fictional (an invented handle, login and team). The team is in the invented country XA, which is not in the app's country list, so the
// picker is read with "Any country"; the team is the newest year so it is inside the picker's 300 newest rows.
// ME_SHOTS=<dir> also saves screenshots at 360px and desktop (local only; not committed).

const expect = baseExpect.configure({ timeout: 20000 });
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const unique = () => randomUUID().replaceAll('-', '').slice(0, 10);
const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;
const shotDir = process.env.ME_SHOTS;
if (shotDir) mkdirSync(shotDir, { recursive: true });

test.use({ viewport: { width: 360, height: 780 } });

async function shot(page, name) {
  if (!shotDir) return;
  await page.screenshot({ path: join(shotDir, `${name}-360.png`), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: join(shotDir, `${name}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 360, height: 780 });
}

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
    `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${phone()}', ${sqlText(`Me Proof ${label}`)}, 'organiser_roster', 'BN');` +
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

test.describe('My Seduh ID (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let person;
  const teamName = `Me Proof Team ${unique()}`;

  test.beforeAll(async () => {
    person = await claimedPerson('mine');
    sqlAsOwner(
      `insert into app.historical_results (competition, competition_name, edition_year, team_name, country_code, stage_reached, source_ref, supplied_by, supplied_on, permission_ref) values ` +
        `('btc', 'Me Proof Championship', 2026, ${sqlText(teamName)}, 'XA', 'quarter_final', 'x', 'x', '2026-11-01', 'test');`,
    );
  });

  // The seeded team row is removed afterwards (memberships first: they restrict the delete), so a long-lived local database does
  // not push a later run's row out of the picker's 300 newest.
  test.afterAll(() => {
    sqlAsOwner(
      `delete from app.seduh_team_memberships where result_id in (select id from app.historical_results where team_name = ${sqlText(teamName)});` +
        `delete from app.historical_results where team_name = ${sqlText(teamName)};`,
    );
  });

  test('signed out: sign-in is shown, no horizontal scroll, and an unknown email gets the same words as a known one', async ({
    page,
  }) => {
    await page.goto('/id/me/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My Seduh ID');
    expect(await overflow(page)).toBe(0);
    await shot(page, 'signin');
    await page.getByLabel('Your email address').fill(`nobody-${unique()}@local.test`);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    const unknownText = await page.locator('#me-code-sent').textContent();
    expect(unknownText).toMatch(/^If that email has a Seduh ID, we sent a code to nobody-/);
    await shot(page, 'code');
    // routing neighbours
    await page.goto('/id/claim/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link is incomplete');
    await page.goto('/id/country/bn/');
    await expect(page.locator('main.country-page')).toBeVisible();
  });

  test('a wrong code is refused in words; the right code signs in and shows my header', async ({
    page,
  }) => {
    await page.goto('/id/me/');
    await page.getByLabel('Your email address').fill(person.email);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#me-code-status')).toContainText('not right');
    await page.getByLabel('6-digit code').fill(await codeFor(person.email));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Me Proof mine`);
    await expect(page.locator('#me-public-link')).toHaveAttribute('href', `/id/${person.handle}/`);
    expect(await overflow(page)).toBe(0);
    // the session survives a reload in this tab, and signing out returns to sign-in
    await page.reload();
    await expect(page.locator('#me-record-title')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Your email address')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Your email address')).toBeVisible();
  });

  test('entries: add, edit, delete, each reflected on the public page', async ({ page }) => {
    await signIn(page, person.email);
    await expect(page.getByText('You have not added any entries yet')).toBeVisible();
    // a bad form is refused in words and nothing is saved
    await page.getByRole('button', { name: 'Add an entry' }).click();
    await page.getByLabel('Year').fill('1900');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.getByText('Enter a year from 1980 to this year')).toBeVisible();
    await shot(page, 'add-error');
    // a good one
    await page.getByLabel('Year').fill('2025');
    await page.getByLabel('Competition').fill('Me Proof Open');
    await page.getByLabel('Where (optional)').fill('Proofville');
    await page.getByLabel('Result (optional)').fill('2nd');
    await page.getByLabel('Place as a number (optional)').fill('2');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.locator('#me-status')).toHaveText('Entry added.');
    await expect(page.getByText('1 of 200 entries')).toBeVisible();
    await shot(page, 'record');

    const pub = await page.context().newPage();
    await pub.goto(`/id/${person.handle}/`);
    await expect(pub.locator('.profile-entry', { hasText: 'Me Proof Open' })).toContainText(
      'Self-reported, not verified by Seduh',
    );
    // edit
    await page.getByRole('button', { name: 'Edit Me Proof Open' }).click();
    await page.getByLabel('Competition').fill('Me Proof Open Renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#me-status')).toHaveText('Entry saved.');
    await pub.reload();
    // the same entry is also the best-result card (a placing of 2), by design: the list is the scoped place to look
    await expect(pub.locator('.profile-entry', { hasText: 'Me Proof Open Renamed' })).toBeVisible();
    // delete asks first
    await page.getByRole('button', { name: 'Delete Me Proof Open Renamed' }).click();
    await expect(page.getByText('This cannot be undone.')).toBeVisible();
    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.locator('.me-entry', { hasText: 'Me Proof Open Renamed' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Me Proof Open Renamed' }).click();
    await page.getByRole('button', { name: 'Yes, delete it' }).click();
    await expect(page.locator('#me-status')).toHaveText('Entry deleted.');
    await pub.reload();
    await expect(pub.getByText('Me Proof Open Renamed')).toHaveCount(0); // nowhere on the page, the best-result card included
    await pub.close();
  });

  // Owner-reported 2026-11-19: at desktop width the form is two columns, and a hint above one box ("From 1980 to this year.")
  // pushed that box below its neighbour; the dropdown was also taller than the text boxes. Side-by-side boxes must share a top
  // edge and a height, with or without a hint, and still after an error message appears under one of them.
  test('the entry form at desktop width: boxes side by side line up and are the same height', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, person.email);
    await page.getByRole('button', { name: 'Add an entry' }).click();
    const box = async (label) => page.getByLabel(label, { exact: true }).boundingBox();
    const pairs = [
      ['Year', 'What you did'],
      ['Competition', 'Where (optional)'],
      ['Your role (optional)', 'Result (optional)'],
    ];
    const check = async () => {
      for (const [left, right] of pairs) {
        const [a, b] = [await box(left), await box(right)];
        expect(Math.abs(a.y - b.y), `${left} / ${right} top`).toBeLessThanOrEqual(1);
        expect(Math.abs(a.height - b.height), `${left} / ${right} height`).toBeLessThanOrEqual(1);
        expect(b.x, `${right} is in the second column`).toBeGreaterThan(a.x + a.width);
      }
    };
    await check();
    // a field without a hint keeps its box close under its label (no empty hint row in between)
    const label = await page.locator('label[for$="-competition_name"]').boundingBox();
    const input = await box('Competition');
    expect(input.y - (label.y + label.height)).toBeLessThanOrEqual(12);
    // an error under one box keeps the row lined up
    await page.getByLabel('Year', { exact: true }).fill('1900');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.getByText('Enter a year from 1980 to this year')).toBeVisible();
    await check();
    expect(await overflow(page)).toBe(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('teams: link a team-year as self-reported, see it publicly with both labels, then unlink', async ({
    page,
  }) => {
    await signIn(page, person.email);
    await page.getByRole('button', { name: 'My teams', exact: true }).click();
    // XA is not an option of the country select (it lists real countries), so ask for any country and find the team by name
    await expect(page.locator('#me-country')).toBeEnabled();
    // the select narrows through the door: a real country with no listed team says so
    await page.locator('#me-country').selectOption('AD');
    await expect(page.getByText(/No team results for .* are available to link yet/)).toBeVisible();
    await page.locator('#me-country').selectOption({ label: 'Any country' });
    const row = page.locator('.me-picker .me-entry', { hasText: teamName });
    await expect(row).toBeVisible();
    await row.getByRole('combobox').selectOption('captain');
    await row.getByRole('button', { name: /^Link me/ }).click();
    await expect(page.locator('#me-status')).toContainText('self-reported until it is confirmed');
    await expect(page.getByText('Membership self-reported').first()).toBeVisible();
    await shot(page, 'teams');

    const pub = await page.context().newPage();
    await pub.goto(`/id/${person.handle}/`);
    const entry = pub.locator('.profile-entry', { hasText: teamName });
    await expect(entry).toContainText('Me Proof Championship');
    await expect(entry).toContainText('Team result from the organiser’s records');
    await expect(entry).toContainText('Membership self-reported');
    await expect(entry).toContainText('Captain');

    await page.getByRole('button', { name: new RegExp(`^Remove ${teamName}`) }).click();
    await page.getByRole('button', { name: 'Yes, remove it' }).click();
    await expect(page.locator('#me-status')).toHaveText('Team link removed.');
    await pub.reload();
    await expect(pub.getByText(teamName)).toHaveCount(0);
    await pub.close();
  });

  test('privacy: each setting saves at once and the public page follows; the country listing is off by default', async ({
    page,
  }) => {
    await signIn(page, person.email);
    await page.getByRole('button', { name: 'Add an entry' }).click();
    await page.getByLabel('Year').fill('2024');
    await page.getByLabel('Competition').fill('Me Proof Hidden Test');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.locator('#me-status')).toHaveText('Entry added.');

    await page.getByRole('button', { name: 'Privacy', exact: true }).click();
    await expect(page.locator('#me-set-listed')).not.toBeChecked();
    await shot(page, 'privacy');
    const pub = await page.context().newPage();
    await pub.goto(`/id/${person.handle}/`);
    await expect(pub.locator('.profile-entry', { hasText: 'Me Proof Hidden Test' })).toBeVisible();

    await page
      .getByRole('group', { name: 'Results you added yourself' })
      .getByLabel('Hidden')
      .check();
    await expect(page.locator('#me-status')).toContainText(
      'Results you added yourself: Hidden. Saved.',
    );
    await pub.reload();
    await expect(pub.getByText('Me Proof Hidden Test')).toHaveCount(0);

    await page
      .getByRole('group', { name: 'Results you added yourself' })
      .getByLabel('Public')
      .check();
    await expect(page.locator('#me-status')).toContainText('Public. Saved.');
    await pub.reload();
    await expect(pub.getByText('Me Proof Hidden Test')).toBeVisible();

    // hiding the name and country leaves the page, with only its address
    await page.getByRole('group', { name: 'Your name and country' }).getByLabel('Hidden').check();
    await expect(page.locator('#me-status')).toContainText('Saved.');
    await pub.reload();
    await expect(pub.getByRole('heading', { level: 1 })).not.toHaveText('Me Proof mine');
    await page.getByRole('group', { name: 'Your name and country' }).getByLabel('Public').check();
    await expect(page.locator('#me-status')).toContainText('Public. Saved.');

    // the listing switch saves and survives a reload
    await page.locator('#me-set-listed').check();
    await expect(page.locator('#me-status')).toContainText('on. Saved.');
    await page.reload();
    await page.getByRole('button', { name: 'Privacy', exact: true }).click();
    await expect(page.locator('#me-set-listed')).toBeChecked();
    await page.locator('#me-set-listed').uncheck();
    await expect(page.locator('#me-status')).toContainText('off. Saved.');
    await pub.close();
  });
});
