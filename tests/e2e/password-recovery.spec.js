import { test, expect } from '@playwright/test';
import { createTenant, localStack } from './support/tenants.js';

// D-PW1: password recovery for the organiser console, end to end against the real app, the real local Auth
// server and the local stack's mail catcher (Mailpit, `[local_smtp]` in supabase/config.toml, port 54424):
// request a link from the sign-in screen, read the email, open the link, choose a new password, and prove the
// old password and the other session are dead.
//
// What this does NOT prove, and why:
//  * Where the link lands. The local allow-list (`additional_redirect_urls` in config.toml) holds the site root
//    only, so Auth redirects a recovery link to the root, not to `/app/`. The spec follows the link itself
//    (no redirect followed), takes the fragment from the Location header, and opens `/app/` with it: exactly
//    what a browser has after the real redirect to `/app/`. In production, `https://www.seduhscore.com/app/`
//    must be on the project's redirect allow-list (a dashboard setting) or the link lands on the home page.
//  * Delivery from the real sender (D-PW2): the local mail catcher accepts anything.
const MAILPIT = process.env.MAILPIT_URL || 'http://127.0.0.1:54424';
const { api, anonKey } = localStack();

async function authCall(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function messagesTo(email) {
  const response = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  return (await response.json()).messages ?? [];
}

// The recovery link in the newest message to `email`, once it has arrived.
async function recoveryLinkFor(email) {
  await expect
    .poll(async () => (await messagesTo(email)).length, {
      timeout: 20000,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThan(0);
  const [newest] = await messagesTo(email);
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json();
  const body = `${message.HTML ?? ''}\n${message.Text ?? ''}`;
  const match = body.match(/https?:\/\/[^\s"'<>]+type=recovery[^\s"'<>]*/);
  if (!match) throw new Error('no recovery link in the email');
  return match[0].replaceAll('&amp;', '&');
}

// Opens the link the way a mail client would, without following the redirect, and returns the fragment Auth
// puts on it: a session on success, an error once the one-time code is spent.
async function fragmentOfLink(link) {
  const response = await fetch(link, { redirect: 'manual' });
  const location = response.headers.get('location') ?? '';
  const hash = new URL(location).hash;
  if (!hash) throw new Error(`the link redirected without a fragment (status ${response.status})`);
  return hash;
}

test.describe('password recovery (D-PW1)', () => {
  let tenant;
  const NEW_PASSWORD = 'a-brand-new-password-1';

  test.beforeAll(async () => {
    test.setTimeout(120000);
    tenant = await createTenant({
      label: 'recovery',
      format: 'cup_taster',
      eventName: 'Recovery e2e event',
      payload: { stage: null, standings: [], eventName: 'Recovery e2e event' },
    });
  });
  test.afterAll(async () => {
    await tenant?.cleanUp();
  });

  test('asks for a link, follows it, chooses a new password, and ends the old password and other sessions', async ({
    page,
  }) => {
    test.setTimeout(120000);
    // A second session of the same login, to be ended by the reset.
    const other = await authCall('/auth/v1/token?grant_type=password', {
      email: tenant.email,
      password: tenant.password,
    });
    expect(other.status).toBe(200);

    // 1. From the sign-in screen: Forgot password? -> the request screen -> the one answer.
    await page.goto('/app/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeFocused();
    await page.getByLabel('Email').fill(tenant.email);
    await page.getByRole('button', { name: 'Send link' }).click();
    const answer = page.getByRole('status').filter({ hasText: 'If that address has an account' });
    await expect(answer).toHaveText('If that address has an account, we sent a link.');

    // 2. The same words for an address that has no account, and no mail goes to it.
    const stranger = `nobody-${Date.now()}@local.test`;
    await page.getByRole('button', { name: 'Use a different address' }).click();
    await page.getByLabel('Email').fill(stranger);
    await page.getByRole('button', { name: 'Send link' }).click();
    await expect(answer).toHaveText('If that address has an account, we sent a link.');
    expect(await messagesTo(stranger)).toHaveLength(0);

    // 3. Open the emailed link: the form replaces the console, and the token is out of the address bar.
    const link = await recoveryLinkFor(tenant.email);
    const hash = await fragmentOfLink(link);
    expect(hash).toContain('access_token=');
    // A full page load, as a mail client's browser makes (not a hash change inside the open tab).
    await page.goto('about:blank');
    await page.goto(`/app/${hash}`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeFocused();
    expect(page.url()).not.toContain('access_token');
    expect(page.url()).not.toContain('#');
    await expect(page.getByRole('heading', { name: /Events in/ })).toHaveCount(0);

    // 4. Choose the password; the console follows Continue.
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: /Events in/ })).toBeVisible();

    // 5. A reload never brings the form or the token back (the address was cleaned in place: no history entry holds it).
    await page.reload();
    await expect(page.getByRole('heading', { name: /Events in/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);

    // 6. The old password is dead, the new one works, and the other session was ended.
    const old = await authCall('/auth/v1/token?grant_type=password', {
      email: tenant.email,
      password: tenant.password,
    });
    expect(old.status).toBe(400);
    const fresh = await authCall('/auth/v1/token?grant_type=password', {
      email: tenant.email,
      password: NEW_PASSWORD,
    });
    expect(fresh.status).toBe(200);
    const refresh = await authCall('/auth/v1/token?grant_type=refresh_token', {
      refresh_token: other.body.refresh_token,
    });
    expect(refresh.status).toBe(400);

    // 7. The link is spent: opening it again says so, in words, with a way to ask for a new one.
    const spent = await fragmentOfLink(link);
    expect(spent).toContain('error_code=otp_expired');
    await page.goto('about:blank');
    await page.goto(`/app/${spent}`);
    await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
    expect(page.url()).not.toContain('error');
    await page.getByRole('link', { name: 'Request a new link' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  });

  // The cloud project requires the current password to set a new one; the local stack does not, so this proves
  // the screen works with the field filled and that GoTrue ignores `current_password` when the setting is off
  // (the case before the cloud setting was switched on). It does NOT prove the setting-on refusal: that needs a
  // GoTrue with the option on (see the PR's manual check list).
  test('Change password asks for the current password and changes it', async ({ page }) => {
    test.setTimeout(120000);
    const own = await createTenant({
      label: 'change-password',
      format: 'cup_taster',
      eventName: 'Change password e2e event',
      payload: { stage: null, standings: [], eventName: 'Change password e2e event' },
    });
    try {
      const NEXT = 'another-new-password-2';
      await page.goto('/app/');
      await page.getByLabel('Email').fill(own.email);
      await page.getByLabel('Password', { exact: true }).fill(own.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.goto('/app/#/account/password');
      await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
      await page.getByLabel('Current password').fill(own.password);
      await page.getByLabel('New password', { exact: true }).fill('too-short-1');
      await page.getByLabel('Confirm password').fill('too-short-1');
      await page.getByRole('button', { name: 'Save password' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'at least 12' })).toBeVisible();
      await page.getByLabel('New password', { exact: true }).fill(NEXT);
      await page.getByLabel('Confirm password').fill(NEXT);
      await page.getByRole('button', { name: 'Save password' }).click();
      await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();
      const old = await authCall('/auth/v1/token?grant_type=password', {
        email: own.email,
        password: own.password,
      });
      expect(old.status).toBe(400);
      const fresh = await authCall('/auth/v1/token?grant_type=password', {
        email: own.email,
        password: NEXT,
      });
      expect(fresh.status).toBe(200);
    } finally {
      await own.cleanUp();
    }
  });
});
