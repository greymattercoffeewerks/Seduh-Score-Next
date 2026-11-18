import { randomInt, randomUUID } from 'node:crypto';
import { test, expect as baseExpect } from '@playwright/test';
import { sqlAsOwner } from './support/admins.js';

// T-ID2.C5: Seduh ID discovery in a real browser against the dev server and the real local Supabase stack.
// The ONE database switch (app.seduh_discovery_switch) is flipped by owner SQL, the way the owner will, and put back OFF at
// the end (it is global to the local database, so this file runs serially and last in its project).
//   - OFF: /id/ says search is not open and has no search box, the landing page has no "Find a competitor", and a results
//     sheet shows plain names;
//   - ON: the hub at 360px (no horizontal scroll) finds a claimed, public person by name and by country, and never finds a
//     person who turned "Show me in Seduh ID search" off or who hides their name; a result opens the person's page;
//   - the landing page shows the "Find a competitor" box, and submitting it lands on the hub with the results;
//   - a claimed competitor's name on the results sheet links to their page, an unclaimed one is plain text.

const expect = baseExpect.configure({ timeout: 20000 });
test.describe.configure({ mode: 'serial' });

const unique = () => randomUUID().replaceAll('-', '').slice(0, 10);
const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const NL = String.fromCharCode(10);

const run = unique();
// a word that appears in every fixture name of this run and in no other
const WORD = `Zephyrine${run}`;

function seedClaimed({ name, handle, search = true, nameVisible = true, event = null }) {
  const [userId, identityId, accountId, orgId, personId] = Array.from({ length: 5 }, randomUUID);
  const number = phone();
  const stmts = [
    `insert into auth.users (id, email) values ('${userId}', ${q(`${handle}@discovery-proof.seduh-next`)})`,
    `insert into orgs (id, name, slug) values ('${orgId}', ${q(`Discovery Org ${handle}`)}, ${q(`org-${handle}`)})`,
    `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${number}', ${q(name)}, 'organiser_roster', 'BN')`,
    `insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values ('${accountId}', '${identityId}', '${userId}', ${q(handle)}, 'organiser_link', now())`,
    `update app.seduh_profile_settings set listed_in_search = ${search}, vis_identity = ${q(nameVisible ? 'public' : 'hidden')} where account_id = '${accountId}'`,
    `insert into people (id, org_id, display_name, phone) values ('${personId}', '${orgId}', ${q(name)}, '${number}')`,
    `select set_config('app.seduh_link_write', 'on', true)`,
    `update people set global_person_id = '${identityId}' where id = '${personId}'`,
  ];
  let eventId = null;
  if (event) {
    eventId = randomUUID();
    const rival = randomUUID();
    stmts.push(
      `insert into people (id, org_id, display_name, phone) values ('${rival}', '${orgId}', 'Unclaimed Rival', '${phone()}')`,
      `insert into events (id, org_id, format, name, event_date) values ('${eventId}', '${orgId}', 'cup_taster', ${q(event)}, '2026-10-10')`,
      `insert into event_entries (id, event_id, person_id, display_name, cafe) values ('${randomUUID()}', '${eventId}', '${personId}', ${q(name)}, 'Proof Cafe')`,
      `insert into event_entries (id, event_id, person_id, display_name, cafe) values ('${randomUUID()}', '${eventId}', '${rival}', 'Unclaimed Rival', 'Other Cafe')`,
      `insert into public.public_results (id, org_id, event_id, payload) values ('${randomUUID()}', '${orgId}', '${eventId}', jsonb_build_object('format', 'cup_taster', 'eventName', ${q(event)}, 'eventDate', '2026-10-10', 'standings', jsonb_build_array(jsonb_build_object('place', 1, 'name', ${q(name)}, 'cafe', 'Proof Cafe', 'round', 'Final', 'correct', 6, 'total', 6, 'timeSecs', 100), jsonb_build_object('place', 2, 'name', 'Unclaimed Rival', 'cafe', 'Other Cafe', 'round', 'Final', 'correct', 5, 'total', 6, 'timeSecs', 110))))`,
    );
  }
  sqlAsOwner(`${stmts.join(`;${NL}`)};`);
  return { handle, eventId };
}

const setSwitch = (on) =>
  sqlAsOwner(`update app.seduh_discovery_switch set enabled = ${on}, changed_at = now();`);
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let withResult;

test.beforeAll(() => {
  setSwitch(false);
  seedClaimed({ name: `${WORD} Shown`, handle: `shown${run}` });
  seedClaimed({ name: `${WORD} Optedout`, handle: `optout${run}`, search: false });
  seedClaimed({ name: `${WORD} Hidden`, handle: `hidden${run}`, nameVisible: false });
  withResult = seedClaimed({
    name: `${WORD} Finalist`,
    handle: `final${run}`,
    event: `Discovery Open ${run}`,
  });
});

test.afterAll(() => {
  setSwitch(false);
});

test('switch OFF: the hub offers nothing, the landing page has no search box, results are plain names', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/id/?q=${WORD}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Find a competitor' })).toBeVisible();
  await expect(page.getByText('Seduh ID search is not open yet')).toBeVisible();
  await expect(page.locator('input[type="search"]')).toHaveCount(0);
  await expect(page.getByText(WORD)).toHaveCount(0);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.petrol-find')).toHaveCount(0);
  await expect(page.locator('a[href="/id/"]')).toHaveCount(0);

  await page.goto(`/results/?sheet=${withResult.eventId}`);
  await expect(page.locator('td.results-sheet-name', { hasText: 'Finalist' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('a.results-profile-link')).toHaveCount(0);
});

test('switch ON: the hub at 360px finds only people who can be found, and a result opens the page', async ({
  page,
}) => {
  setSwitch(true);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/id/');
  await expect(page.getByLabel('Name, handle or café')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByLabel('Name, handle or café').fill(WORD);
  await page.getByRole('button', { name: 'Search' }).click();
  const status = page.locator('#hub-note');
  await expect(status).toContainText('2 people found.');
  const links = page.locator('.hub-results a');
  await expect(links).toHaveCount(2);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs.sort()).toEqual([`/id/final${run}/`, `/id/shown${run}/`]);
  // never the person who opted out of search, nor the one who hides their name; by name or by handle
  await expect(page.getByText('Optedout')).toHaveCount(0);
  await expect(page.getByText('Hidden')).toHaveCount(0);
  for (const h of [`optout${run}`, `hidden${run}`]) {
    await page.getByLabel('Name, handle or café').fill(h);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(status).toContainText('No one found');
  }
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // a too-short query is not sent and says so
  await page.getByLabel('Name, handle or café').fill('z');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(status).toContainText('at least 2 letters');

  // browse by country: Brunei lists this run's people among others; the chip is a pressed button
  await page.getByLabel('Name, handle or café').fill('');
  const chip = page.locator('.hub-country', { hasText: 'Brunei' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hub-results a').first()).toBeVisible();

  // a result opens the person's page
  await page.goto(`/id/?q=${WORD} Shown`);
  await page.locator('.hub-results a').first().click();
  await expect(page).toHaveURL(new RegExp(`/id/shown${run}/$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Shown');
});

test('switch ON: the landing page shows Find a competitor and the box lands on the hub', async ({
  page,
}) => {
  setSwitch(true);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  const box = page.locator('.petrol-find');
  await expect(box.getByRole('heading', { name: 'Find a competitor' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await box.getByLabel('Name, handle or café').fill(`${WORD} Shown`);
  await box.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/\/id\/\?q=/);
  await expect(page.locator('.hub-results a')).toHaveCount(1);
});

test('switch ON: a claimed competitor links to their page on the results sheet, an unclaimed one does not', async ({
  page,
}) => {
  setSwitch(true);
  await page.goto(`/results/?sheet=${withResult.eventId}`);
  const link = page.locator('td.results-sheet-name a.results-profile-link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', `/id/final${run}/`);
  await expect(link).toContainText('Finalist');
  await expect(
    page.locator('td.results-sheet-name', { hasText: 'Unclaimed Rival' }).locator('a'),
  ).toHaveCount(0);
});

test('switch OFF again: every door is closed', async ({ page }) => {
  setSwitch(false);
  await page.goto(`/id/?q=${WORD}`);
  await expect(page.getByText('Seduh ID search is not open yet')).toBeVisible();
  await page.goto(`/results/?sheet=${withResult.eventId}`);
  await expect(page.locator('td.results-sheet-name', { hasText: 'Finalist' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('a.results-profile-link')).toHaveCount(0);
});
