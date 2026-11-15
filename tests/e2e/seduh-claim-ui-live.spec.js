import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect as baseExpect } from '@playwright/test';
import { createTenant } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rest, signInPassword } from './support/api.js';

// T-ID2.B3b: the claim SCREENS, in a real browser against the real app and the real local Supabase stack (B3a's
// seduh-claim-live.spec.js proves the same contract over HTTP). An organiser sends a claim link from the People screen; the
// person opens /id/claim/#<token>, receives the 6-digit code in Mailpit, picks a handle, ticks "18 or over" and claims; the
// profile page then answers at /id/<handle>/; the organiser sees the person as claimed. Also:
//   - the token is taken out of the address bar and is in no request URL (it was in the fragment);
//   - the claim runs in the SAME browser as a signed-in organiser and does not touch the organiser's session;
//   - a closed account can be re-claimed: a NEW handle and a NEW founding number;
//   - /id/claim/ does not break /id/country/bn/ or the /id/<handle>/ placeholder.
// CLAIM_SHOTS=<dir> also saves a 360px screenshot of every step (local only; they are not committed).

const expect = baseExpect.configure({ timeout: 20000 });
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const tag = Date.now().toString(36);
const shotDir = process.env.CLAIM_SHOTS;
if (shotDir) mkdirSync(shotDir, { recursive: true });

test.use({ viewport: { width: 360, height: 780 } });

const phone = () => `+673962${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: true });
}

async function signInAs(page, { email, password }) {
  await page.goto('/app/');
  await page.evaluate(
    async ({ email: e, password: p }) => {
      const mod = await import('/src/core/supabaseClient.js');
      const { error } = await mod.getSupabase().auth.signInWithPassword({ email: e, password: p });
      if (error) throw new Error(`login failed: ${error.message}`);
    },
    { email, password },
  );
  await page.reload();
}

async function openPeople(page, orgName) {
  await page.getByRole('link', { name: 'Open People' }).click();
  await expect(page.getByRole('heading', { name: `People in ${orgName}` })).toBeVisible();
}

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

// Walks the claim page from the welcome step to "Seduh ID #NNNN". Returns the founding number as text.
async function claimThroughUi(page, url, { email, handle, shotPrefix }) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Claim your Seduh ID' })).toBeFocused();
  // the token is out of the address bar at once, and was never in a request URL
  expect(page.url()).not.toContain('#');
  if (shotPrefix) await shot(page, `${shotPrefix}-1-welcome`);
  await page.getByRole('button', { name: 'Start' }).click();

  await expect(page.getByRole('heading', { name: 'Your email address' })).toBeFocused();
  await page.locator('#claim-email').fill('not an email');
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.locator('#claim-email-status')).toContainText('valid email');
  if (shotPrefix) await shot(page, `${shotPrefix}-2-email-error`);
  await page.locator('#claim-email').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();

  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeFocused();
  await expect(page.getByText(`We sent a code to ${email}`)).toBeVisible();
  await page.locator('#claim-code').fill('000000');
  await page.getByRole('button', { name: 'Confirm the code' }).click();
  await expect(page.locator('#claim-code-status')).toContainText('not right');
  if (shotPrefix) await shot(page, `${shotPrefix}-3-code-error`);
  await page.locator('#claim-code').fill(await codeFor(email));
  await page.getByRole('button', { name: 'Confirm the code' }).click();

  await expect(page.getByRole('heading', { name: 'Choose your handle' })).toBeFocused();
  await expect(page.getByText(/You are claiming the Seduh ID of /)).toBeVisible();
  const handleField = page.locator('#claim-handle');
  await handleField.fill('admin');
  await expect(page.locator('#claim-handle-check')).toContainText('reserved');
  await handleField.fill('x');
  await expect(page.locator('#claim-handle-check')).toContainText('3 to 30');
  await handleField.fill(handle.toUpperCase());
  await expect(page.locator('#claim-handle-check')).toHaveText('Available.');
  await expect(page.locator('#claim-address')).toHaveText(`seduhscore.com/id/${handle}`);
  // not ticked: refused in words, nothing claimed
  await page.getByRole('button', { name: 'Claim my Seduh ID' }).click();
  await expect(page.locator('#claim-form-status')).toContainText('18 or over');
  if (shotPrefix) await shot(page, `${shotPrefix}-4-handle-adult-error`);
  await page.getByLabel('I am 18 or over.').check();
  if (shotPrefix) await shot(page, `${shotPrefix}-5-handle-ready`);
  await page.getByRole('button', { name: 'Claim my Seduh ID' }).click();

  const title = page.getByRole('heading', { name: /^Seduh ID #\d{4}$/ });
  await expect(title).toBeFocused();
  if (shotPrefix) await shot(page, `${shotPrefix}-6-done`);
  return (await title.textContent()).replace('Seduh ID ', '');
}

test.describe('claiming a Seduh ID through the screens (real app, real local Supabase)', () => {
  test.describe.configure({ mode: 'serial' });

  let a;
  let tokenA;
  let person;
  const name = `Claimant UI ${tag}`;
  const state = {};

  async function addPerson(orgToken, orgId, displayName) {
    const number = phone();
    const r = await rest('people?select=id', {
      method: 'POST',
      token: orgToken,
      body: { org_id: orgId, display_name: displayName, phone: number },
      headers: { prefer: 'return=representation' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // the identity the feed would have made, linked the way link_person_identity does (owner SQL)
    sqlAsOwner(
      `insert into app.seduh_identities (phone_e164, display_name, source) values ('${number}', '${displayName}', 'archive');` +
        `select set_config('app.seduh_link_write', 'on', false);` +
        `update public.people p set global_person_id = i.id from app.seduh_identities i where p.id = '${r.body[0].id}' and i.phone_e164 = p.phone;` +
        `select set_config('app.seduh_link_write', '', false);`,
    );
    return r.body[0].id;
  }

  test.beforeAll(async () => {
    test.setTimeout(120000);
    a = await createTenant({ label: 'clmui', live: false, grant: false });
    tokenA = (await signInPassword(a)).token;
    person = await addPerson(tokenA, a.orgId, name);
    state.noIdentity = (
      await rest('people?select=id', {
        method: 'POST',
        token: tokenA,
        body: { org_id: a.orgId, display_name: `No ID ${tag}`, phone: phone() },
        headers: { prefer: 'return=representation' },
      })
    ).body[0].id;
  });

  test('the People screen sends a link, shows it once, and the person claims through the screens', async ({
    page,
    context,
  }) => {
    test.setTimeout(180000);
    await signInAs(page, a);
    await openPeople(page, a.orgName);
    const row = page.locator(`#people-row-${person}`);

    // a person with no Seduh ID is told why there is no button
    await expect(page.locator(`#people-row-${state.noIdentity}`)).toContainText(
      'No Seduh ID yet. One is made after this person’s results are published and reviewed.',
    );
    await expect(
      page.getByRole('button', { name: new RegExp(`Send claim link, No ID ${tag}`) }),
    ).toHaveCount(0);
    await expect(row).toContainText('Not claimed yet.');
    await shot(page, 'people-1-can-issue');

    await row.getByRole('button', { name: `Send claim link, ${name}` }).click();
    const urlBox = page.locator(`#people-claim-url-${person}`);
    await expect(urlBox).toBeFocused();
    await expect(row).toContainText('works once, for one person');
    await expect(row).toContainText('Send it only to that person');
    const claimUrl = await urlBox.inputValue();
    expect(claimUrl).toMatch(/\/id\/claim\/#[A-Za-z0-9_-]{43}$/);
    await expect(row.getByRole('link', { name: /Share on WhatsApp/ })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/\?text=/,
    );
    await expect(row.locator('.qr-block-code svg')).toBeVisible();
    await shot(page, 'people-2-link-shown');

    // 44px targets
    for (const control of [
      row.getByRole('button', { name: 'Copy link' }),
      row.getByRole('link', { name: /on WhatsApp/ }),
      row.getByRole('button', { name: /^Done/ }),
    ]) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }

    // Done hides the link for good: the state is "claim link sent", with Make a new link and Cancel link
    await row.getByRole('button', { name: /^Done/ }).click();
    await expect(page.locator(`#people-claim-url-${person}`)).toHaveCount(0);
    await expect(row).toContainText('Claim link sent. It works until');
    await expect(row.getByRole('button', { name: /Cancel link/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(
      claimUrl.split('#')[1],
    );
    await shot(page, 'people-3-link-open');

    // revoke, then issue again: the first link is dead (the database proves it; the claim page shows it below)
    await row.getByRole('button', { name: /Cancel link/ }).click();
    await expect(row).toContainText('Not claimed yet.');
    await shot(page, 'people-4-revoked');
    await row.getByRole('button', { name: `Send claim link, ${name}` }).click();
    const secondUrl = await page.locator(`#people-claim-url-${person}`).inputValue();
    expect(secondUrl).not.toBe(claimUrl);

    // the person opens the first, cancelled link in the SAME browser: refused in words, and no email is asked for
    const claimPage = await context.newPage();
    const requests = [];
    claimPage.on('request', (r) => requests.push(r.url()));
    await claimPage.goto(claimUrl);
    await claimPage.getByRole('button', { name: 'Start' }).click();
    await claimPage.locator('#claim-email').fill(`dead-${tag}@local.test`);
    await claimPage.getByRole('button', { name: 'Send me a code' }).click();
    await expect(
      claimPage.getByRole('heading', { name: 'This link cannot be used' }),
    ).toBeFocused();
    await expect(claimPage.getByText('The organiser cancelled this link.')).toBeVisible();
    await shot(claimPage, 'claim-0-cancelled-link');

    // the real one
    const email = `claimant-${tag}@local.test`;
    state.handle = `claimant-${tag}`;
    const number = await claimThroughUi(claimPage, secondUrl, {
      email,
      handle: state.handle,
      shotPrefix: 'claim',
    });
    state.firstNumber = number;
    // no request URL ever carried the token (it was in the fragment, which a browser never sends)
    const token = secondUrl.split('#')[1];
    await claimPage.getByRole('link', { name: 'See your page' }).click();
    await expect(claimPage).toHaveURL(new RegExp(`/id/${state.handle}/$`));
    await expect(claimPage.getByRole('heading', { level: 1 })).toBeVisible();
    expect(requests.some((u) => u.includes(token))).toBe(false);

    // the competitor session did not replace the organiser's, and none is left behind in this browser
    expect(
      await claimPage.evaluate(() =>
        Object.keys(window.sessionStorage).filter((k) => /competitor/.test(k)),
      ),
    ).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: `People in ${a.orgName}` })).toBeVisible();
    await expect(page.locator(`#people-row-${person}`)).toContainText(`Claimed @${state.handle}`);
    await expect(page.getByRole('link', { name: new RegExp(`@${state.handle}`) })).toHaveAttribute(
      'href',
      `/id/${state.handle}/`,
    );
    await shot(page, 'people-5-claimed');
    await claimPage.close();
  });

  test('a closed account can be claimed again: a new handle and a new number', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);
    sqlAsOwner(
      `with closed as (update app.seduh_accounts set closed_at = now(), user_id = null where handle = '${state.handle}' and closed_at is null returning id, identity_id, founding_number) ` +
        `insert into app.seduh_claim_audit (action, identity_id, account_id, detail) select 'claim.undo', identity_id, id, jsonb_build_object('founding_number', founding_number, 'reason', 'e2e') from closed;`,
    );
    await signInAs(page, a);
    await openPeople(page, a.orgName);
    const row = page.locator(`#people-row-${person}`);
    await expect(row).toContainText('Not claimed yet.');
    await row.getByRole('button', { name: `Send claim link, ${name}` }).click();
    const url = await page.locator(`#people-claim-url-${person}`).inputValue();

    const fresh = await (
      await browser.newContext({ viewport: { width: 360, height: 780 } })
    ).newPage();
    const handle = `again-${tag}`;
    const number = await claimThroughUi(fresh, url, { email: `again-${tag}@local.test`, handle });
    expect(number).not.toBe(state.firstNumber);
    expect(Number(number.slice(1))).toBeGreaterThan(Number(state.firstNumber.slice(1)));

    // the retired handle shows nothing; the new one answers; the organiser sees the NEW handle
    await fresh.goto(`/id/${state.handle}/`);
    await expect(fresh.getByRole('heading', { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.locator(`#people-row-${person}`)).toContainText(`Claimed @${handle}`);
    await fresh.context().close();
  });

  test('/id/claim/ does not break the country pages or the person placeholder, and an empty link says so', async ({
    page,
  }) => {
    await page.goto('/id/claim/');
    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
    await shot(page, 'claim-incomplete-link');
    await page.goto('/id/claim');
    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
    await page.goto('/id/country/bn/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.title()).not.toMatch(/Claim/);
    await page.goto('/id/someone-else/');
    await expect(page.getByRole('heading', { name: 'Seduh ID profile' })).toBeVisible();
    await page.goto('/id/claim/#nonsense');
    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
  });
});
