import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { test, expect as baseExpect } from '@playwright/test';
import { sqlAsOwner } from './support/admins.js';

// T-ID2.C1: the Seduh ID person page /id/<handle>/ in a real browser, against the dev server and the real local
// Supabase stack. A fictional claimed person is made by owner SQL (the way the pgTAP door test makes one) with results
// published from three events in two years; the page must draw them from the real door `public_seduh_profile`.
//   - a seeded profile with results renders at 360px with no horizontal scroll, with the founding chip, the stats, the best
//     result and every entry labelled "Recorded by Seduh Score";
//   - a claimed person with no results shows the friendly empty-record line;
//   - an unknown handle shows the empty "No Seduh ID here" page, with nothing about why;
//   - the page makes exactly one data call, to the one door.
// PROFILE_SHOTS=<dir> also saves 360px and desktop screenshots (local only; they are not committed).

const expect = baseExpect.configure({ timeout: 20000 });
// Every seed makes its own unique handle, login, organisation and phone (a random id, not the clock: parallel workers
// and retries each evaluate this file again, and a shared tag made two seeds collide).
const unique = () => randomUUID().replaceAll('-', '').slice(0, 12);
const shotDir = process.env.PROFILE_SHOTS;
if (shotDir) mkdirSync(shotDir, { recursive: true });

const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;

// Makes one claimed account (login, identity, account) and returns its handle. `events` are published Cup Taster events
// the person finished in, as [name, date, place] with the person in the full standings.
function seedClaimed({ prefix, name, events }) {
  const handle = `${prefix}${unique()}`; // 3 to 30 characters, lower case letters and digits: never a reserved word
  const [userId, identityId, accountId, orgId, personId] = Array.from({ length: 5 }, randomUUID);
  const number = phone();
  const statements = [
    `insert into auth.users (id, email) values ('${userId}', ${sqlText(`${handle}@profile-proof.seduh-next`)})`,
    `insert into orgs (id, name, slug) values ('${orgId}', ${sqlText(`Proof Org ${handle}`)}, ${sqlText(`org-${handle}`)})`,
    `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${number}', ${sqlText(name)}, 'organiser_roster', 'BN')`,
    `insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values ('${accountId}', '${identityId}', '${userId}', ${sqlText(handle)}, 'organiser_link', now())`,
    `insert into people (id, org_id, display_name, phone) values ('${personId}', '${orgId}', ${sqlText(name)}, '${number}')`,
    `select set_config('app.seduh_link_write', 'on', true)`,
    `update people set global_person_id = '${identityId}' where id = '${personId}'`,
  ];
  sqlAsOwner(`${statements.join(';' + String.fromCharCode(10))};`);
  // events in small batches: one long statement would pass the command-line length limit on Windows
  for (let from = 0; from < events.length; from += 8) {
    const batch = [];
    events.slice(from, from + 8).forEach(([eventName, date, place], k) => {
      const i = from + k;
      const eventId = randomUUID();
      batch.push(
        `insert into events (id, org_id, format, name, event_date) values ('${eventId}', '${orgId}', 'cup_taster', ${sqlText(eventName)}, '${date}')`,
        `insert into event_entries (id, event_id, person_id, display_name, cafe) values ('${randomUUID()}', '${eventId}', '${personId}', ${sqlText(name)}, 'Proof Cafe')`,
        `insert into public.public_results (id, org_id, event_id, payload) values ('${randomUUID()}', '${orgId}', '${eventId}', jsonb_build_object('format', 'cup_taster', 'eventName', ${sqlText(eventName)}, 'eventDate', '${date}', 'standings', jsonb_build_array(jsonb_build_object('place', ${place}, 'name', ${sqlText(name)}, 'cafe', 'Proof Cafe', 'round', 'Final', 'correct', ${9 - (i % 9)}, 'total', 9, 'timeSecs', ${120 + i}))))`,
      );
    });
    sqlAsOwner(`${batch.join(';' + String.fromCharCode(10))};`);
  }
  return handle;
}

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}
const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('a claimed person with published results renders at 360px with no horizontal scroll', async ({
  page,
}) => {
  const full = seedClaimed({
    prefix: 'proof',
    name: 'Profile Proof Person',
    events: [
      ['Proof Open 2026', '2026-11-02', 1],
      ['Proof Weekend 2026', '2026-05-10', 3],
      ['Proof Classic 2025', '2025-08-01', 5],
    ],
  });
  await page.setViewportSize({ width: 360, height: 780 });
  const calls = [];
  page.on('request', (r) => calls.push(r.url()));
  await page.goto(`/id/${full.toUpperCase()}/`); // the handle is lower-cased from the path
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profile Proof Person');
  await expect(page.getByText(/^Seduh ID #\d{4}$/)).toBeVisible();
  await expect(page.locator('.profile-entry')).toHaveCount(3);
  await expect(page.locator('.profile-provenance')).toHaveText([
    'Recorded by Seduh Score',
    'Recorded by Seduh Score',
    'Recorded by Seduh Score',
  ]);
  await expect(page.locator('.profile-best-finish')).toHaveText('1st · Proof Open 2026');
  await expect(page.locator('.profile-stats')).toContainText('3results');
  // only the newest year is open
  await expect(page.locator('.profile-year[open]')).toHaveCount(1);
  expect(await overflow(page)).toBe(0);
  // exactly one data call, to the one door
  expect(calls.filter((u) => u.includes('/rest/v1/')).map((u) => new URL(u).pathname)).toEqual([
    '/rest/v1/rpc/public_seduh_profile',
  ]);
  // no phone number anywhere on the page
  await expect(page.locator('body')).not.toContainText('+673');
  await shot(page, 'full-360');
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await overflow(page)).toBe(0);
  await shot(page, 'full-desktop');
});

test('a 60-entry record renders at 360px with no horizontal scroll, newest year open', async ({
  page,
}) => {
  // 60 published results across 2019 to 2026: the long record (spec 14.5)
  const long = seedClaimed({
    prefix: 'long',
    name: 'Long Record Person',
    events: Array.from({ length: 60 }, (_, i) => [
      `Long Cup ${i}`,
      `${2019 + (i % 8)}-0${1 + (i % 9)}-15`,
      (i % 6) + 1,
    ]),
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/id/${long}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Long Record Person');
  await expect(page.locator('.profile-entry')).toHaveCount(60);
  await expect(page.locator('.profile-year')).toHaveCount(8);
  await expect(page.locator('.profile-year[open]')).toHaveCount(1);
  expect(await overflow(page)).toBe(0);
  await shot(page, 'long-360');
});

test('a claimed person with no results shows the friendly empty-record line', async ({ page }) => {
  const empty = seedClaimed({ prefix: 'quiet', name: 'Quiet Claimed Person', events: [] });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/id/${empty}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quiet Claimed Person');
  await expect(page.getByText('No results on Seduh Score yet.')).toBeVisible();
  await expect(page.locator('.profile-stats, .profile-best')).toHaveCount(0);
  expect(await overflow(page)).toBe(0);
  await shot(page, 'empty-360');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'empty-desktop');
});

test('an unknown handle shows the empty page and says nothing about why', async ({ page }) => {
  const ghost = `nobody-${unique()}`;
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/id/${ghost}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No Seduh ID here.');
  await expect(page.locator('body')).not.toContainText(ghost);
  expect(await overflow(page)).toBe(0);
  await shot(page, 'noprofile-360');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'noprofile-desktop');
  // a too-short handle looks exactly the same
  await page.goto('/id/ab/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No Seduh ID here.');
});
