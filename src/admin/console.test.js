import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  boot,
  button,
  cleanup,
  field,
  flush,
  heading,
  lastHandle,
  makeClient,
  submit,
  type,
} from './consoleHarness.js';

// The whole console against a fake client: every screen the gate can produce, and the moves between them.
// (The harness, consoleHarness.js, explains the fake.)

afterEach(cleanup);

describe('signed out', () => {
  it('shows the admin sign-in and asks the database nothing', async () => {
    const client = makeClient();
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Admin sign in');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('refuses an empty form without a request', async () => {
    const client = makeClient();
    const root = boot(client);
    await flush();
    await submit(root);
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/required/i);
  });

  it('reports wrong credentials in the shared words, and stays on the form', async () => {
    const client = makeClient({
      signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'wrong');
    await submit(root);
    expect(heading(root)).toBe('Admin sign in');
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/do not match/);
    expect(field(root, 'email').value).toBe('ops@example.test');
  });

  it('sends the password exactly as typed (surrounding spaces included)', async () => {
    const client = makeClient();
    const root = boot(client);
    await flush();
    await type(root, 'email', '  ops@example.test ');
    await type(root, 'password', ' pw with spaces ');
    await submit(root);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ops@example.test',
      password: ' pw with spaces ',
    });
  });

  it('a successful sign-in moves straight on to the access check', async () => {
    const client = makeClient();
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'pw');
    await submit(root);
    await flush();
    expect(heading(root)).toBe('Verify it is you');
  });

  it('after a refused sign-in the form works again (a retry is sent)', async () => {
    const client = makeClient({
      signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'wrong');
    await submit(root);
    await submit(root);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it('a double submit while signing in sends one request', async () => {
    let release;
    const client = makeClient();
    client.auth.signInWithPassword = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => {
            client.state.signedIn = true;
            resolve({ error: null });
          };
        }),
    );
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'pw');
    const form = root.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it('shows the session-ended notice after a refused token', async () => {
    const client = makeClient({
      signedIn: true,
      aal: 'aal2',
      gate: () => ({ data: null, error: { hint: 'admin_session_ended' } }),
    });
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Admin sign in');
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'Your session ended. Sign in again.',
    );
  });
});

describe('after sign-in', () => {
  it('a login that is not an admin sees "No access" and nothing about why', async () => {
    const client = makeClient({ signedIn: true, isAdmin: false });
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('No access');
    expect(root.querySelector('p').textContent).toBe(
      'This account does not have access to the admin console.',
    );
    expect(root.textContent).not.toMatch(/platform_admins|aal|factor/i);
    expect(root.textContent).toContain('ops@example.test');
    expect(root.querySelector('nav')).toBeNull();
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled();
  });

  it('a failed sign-out from the no-access screen is reported, not silent', async () => {
    const client = makeClient({ signedIn: true, isAdmin: false, signOutError: { message: 'x' } });
    const root = boot(client);
    await flush();
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sign out').click();
    await flush();
    expect(heading(root)).toBe('No access');
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/Could not sign out/);
  });

  it('an admin with a factor is challenged, and a wrong code stays on the challenge', async () => {
    const client = makeClient({
      signedIn: true,
      verifyError: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
    });
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Verify it is you');
    await type(root, 'code', '000000');
    await submit(root);
    expect(heading(root)).toBe('Verify it is you');
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/That code did not work/);
    expect(root.querySelector('nav')).toBeNull();
  });

  it('after a wrong code the form works again (a second attempt is sent)', async () => {
    const client = makeClient({
      signedIn: true,
      verifyError: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
    });
    const root = boot(client);
    await flush();
    await type(root, 'code', '000000');
    await submit(root);
    await type(root, 'code', '111111');
    await submit(root);
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(2);
  });

  it('a malformed code is refused before any request', async () => {
    const client = makeClient({ signedIn: true });
    const root = boot(client);
    await flush();
    await type(root, 'code', '12');
    await submit(root);
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/6-digit/);
  });

  it('a right code opens the console, which shows who and Verified (AAL2)', async () => {
    const client = makeClient({ signedIn: true });
    const root = boot(client);
    await flush();
    await type(root, 'code', '123456');
    await submit(root);
    await flush();
    expect(root.querySelector('header').textContent).toContain('ops@example.test');
    expect(root.querySelector('header').textContent).toContain('Verified (AAL2)');
    expect(root.querySelector('nav a[aria-current="page"]').textContent).toBe('Organisations');
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      code: '123456',
    });
  });

  it('a double submit of the code verifies once', async () => {
    const client = makeClient({ signedIn: true });
    let release;
    client.auth.mfa.challengeAndVerify = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => {
            client.state.aal = 'aal2';
            resolve({ error: null });
          };
        }),
    );
    const root = boot(client);
    await flush();
    await type(root, 'code', '123456');
    const form = root.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it('an admin with no factor enrols: stale attempts are cleared, the key and QR are shown', async () => {
    const client = makeClient({ signedIn: true, hasFactor: false });
    client.state.stale = [{ id: 'stale-1', factor_type: 'totp', status: 'unverified' }];
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Set up your authenticator app');
    expect(client.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale-1' });
    expect(root.querySelector('img.adm-qr').getAttribute('alt')).toMatch(/QR code/);
    expect(root.querySelector('[data-field="secret"]').textContent.replace(/\s/g, '')).toBe(
      'ABCDEFGHIJKLMNOP',
    );
    await type(root, 'code', '123456');
    await submit(root);
    await flush();
    expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: 'factor-new',
      code: '123456',
    });
    expect(root.querySelector('header')).not.toBeNull();
  });

  it('a failed enrolment offers a retry and does not show a QR code', async () => {
    const client = makeClient({ signedIn: true, hasFactor: false });
    client.auth.mfa.enroll = vi.fn(async () => ({
      data: null,
      error: { code: 'x', message: 'x' },
    }));
    const root = boot(client);
    await flush();
    expect(root.querySelector('img.adm-qr')).toBeNull();
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/Something went wrong/);
    const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    expect(retry).toBeTruthy();
    client.auth.mfa.enroll = vi.fn(async () => ({
      data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ZZZZ' } },
      error: null,
    }));
    retry.click();
    await flush();
    expect(root.querySelector('img.adm-qr')).not.toBeNull();
  });

  it('even a token that claims aal2 is not "ready" until the full gate says so', async () => {
    // The refreshed-an-hour-ago case: aal2 in the token, but the TOTP verification is stale.
    const client = makeClient({
      signedIn: true,
      aal: 'aal2',
      gate: () => ({ data: null, error: { hint: 'admin_mfa_required' } }),
    });
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Verify it is you');
    expect(root.querySelector('header')).toBeNull();
  });

  it('a check that fails shows a retry, and retrying asks again', async () => {
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    client.rpc = vi.fn(async (name) => {
      if (name === 'am_i_platform_admin')
        return { data: null, error: { message: 'down' }, status: 500 };
      return { data: true, error: null };
    });
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Could not check your access');
    client.rpc = vi.fn(async (name) =>
      name === 'am_i_platform_admin'
        ? { data: { is_admin: true, aal: 'aal2' }, error: null }
        : { data: true, error: null },
    );
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Retry').click();
    await flush();
    expect(root.querySelector('header')).not.toBeNull();
  });
});

describe('the console', () => {
  async function ready(options) {
    const client = makeClient({ signedIn: true, aal: 'aal2', ...options });
    const root = boot(client);
    await flush();
    return { client, root };
  }
  const button = (root, label) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === label);

  it("Sign out ends this tab's session only and returns to the sign-in", async () => {
    const { client, root } = await ready();
    button(root, 'Sign out').click();
    await flush();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(heading(root)).toBe('Admin sign in');
  });

  it('Sign out everywhere ends every session', async () => {
    const { client, root } = await ready();
    button(root, 'Sign out everywhere').click();
    await flush();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(heading(root)).toBe('Admin sign in');
  });

  it('a failed sign-out is reported and the console stays', async () => {
    const { root } = await ready({ signOutError: { message: 'x' } });
    button(root, 'Sign out').click();
    await flush();
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('.adm-header-feedback').textContent).toMatch(/Could not sign out/);
    // And it can be tried again.
    expect(button(root, 'Sign out').getAttribute('aria-disabled')).toBeNull();
  });

  it('a panel that is refused by the gate sends the console back through the check', async () => {
    const calls = [];
    const panels = [
      {
        id: 'p',
        label: 'P',
        route: 'p',
        mount: (host, ctx) => {
          calls.push(ctx);
          host.textContent = 'panel';
          return { unmount() {} };
        },
      },
    ];
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client, { panels });
    await flush();
    expect(root.querySelector('main').textContent).toBe('panel');
    // The next gate answer is "second factor stale"; the panel reports the refusal it got from a call.
    client.rpc = vi.fn(async (name) =>
      name === 'am_i_platform_admin'
        ? { data: { is_admin: true, aal: 'aal2' }, error: null }
        : { data: null, error: { hint: 'admin_mfa_required' } },
    );
    calls[0].onGateRefused();
    await flush();
    expect(heading(root)).toBe('Verify it is you');
  });

  it('routes by hash to a registered panel, and an unknown hash shows the first', async () => {
    const mount = (label) => (host) => {
      host.textContent = label;
      return { unmount() {} };
    };
    const panels = [
      { id: 'a', label: 'A', route: 'a', mount: mount('panel a') },
      { id: 'b', label: 'B', route: 'b', mount: mount('panel b') },
    ];
    window.location.hash = '#/b';
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client, { panels });
    await flush();
    expect(root.querySelector('main').textContent).toBe('panel b');
    window.location.hash = '#/nowhere';
    window.dispatchEvent(new Event('hashchange'));
    expect(root.querySelector('main').textContent).toBe('panel a');
    expect(root.querySelector('nav a[aria-current="page"]').textContent).toBe('A');
  });

  it('a check superseded by a newer one never paints', async () => {
    let askPanel;
    const panels = [
      {
        id: 'p',
        label: 'P',
        route: 'p',
        mount: (host, ctx) => {
          askPanel = ctx;
          host.textContent = 'panel';
          return { unmount() {} };
        },
      },
    ];
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client, { panels });
    await flush();
    expect(root.querySelector('header')).not.toBeNull();

    // The next two checks are held open; the SECOND one (the newer) answers first.
    const held = [];
    client.auth.getSession = vi.fn(
      () =>
        new Promise((resolve) => {
          held.push(resolve);
        }),
    );
    askPanel.onGateRefused();
    askPanel.onGateRefused();
    expect(held).toHaveLength(2);
    held[1]({ data: { session: null }, error: null });
    await flush();
    expect(heading(root)).toBe('Admin sign in');
    // The older one now answers "signed in and ready"; it must be thrown away.
    held[0]({ data: { session: { user: { email: 'late@example.test' } } }, error: null });
    await flush();
    expect(heading(root)).toBe('Admin sign in');
    expect(root.querySelector('header')).toBeNull();
  });

  it('a check still pending when the console is unmounted never paints', async () => {
    const client = makeClient({ signedIn: false });
    let slow;
    client.auth.getSession = vi.fn(
      () =>
        new Promise((resolve) => {
          slow = resolve;
        }),
    );
    const root = boot(client);
    lastHandle().unmount();
    slow({ data: { session: { user: { email: 'a@b.test' } } }, error: null });
    await flush();
    expect(root.querySelector('h1')).toBeNull();
  });

  it('a sign-in still in flight when the console is unmounted does not start a new check', async () => {
    const client = makeClient();
    let finish;
    client.auth.signInWithPassword = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: null });
        }),
    );
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'pw');
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    lastHandle().unmount();
    const callsBefore = client.auth.getSession.mock.calls.length;
    finish();
    await flush();
    expect(root.childNodes).toHaveLength(0);
    expect(client.auth.getSession.mock.calls.length).toBe(callsBefore);
  });

  it('a sign-out still in flight when the console is unmounted does not paint afterwards', async () => {
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client);
    await flush();
    let finish;
    client.auth.signOut = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ error: null });
        }),
    );
    button(root, 'Sign out').click();
    await flush();
    lastHandle().unmount();
    finish();
    await flush();
    expect(root.childNodes).toHaveLength(0);
  });

  describe('signing out when the request fails', () => {
    async function readyShell(options) {
      const client = makeClient({ signedIn: true, aal: 'aal2', ...options });
      const root = boot(client);
      await flush();
      return { client, root };
    }

    it('keeps the token and the next attempt revokes THAT token on the server', async () => {
      const { client, root } = await readyShell({ signOutError: { message: 'network' } });
      button(root, 'Sign out').click();
      await flush();
      expect(root.querySelector('.adm-header-feedback').textContent).toMatch(/Could not sign out/);
      // The local session is already gone (as with the real client), so a naive retry would find nothing to do.
      expect(client.auth.admin.signOut).not.toHaveBeenCalled();

      button(root, 'Sign out').click();
      await flush();
      expect(client.auth.admin.signOut).toHaveBeenCalledWith('token-1', 'local');
      expect(heading(root)).toBe('Admin sign in');
    });

    it('a retry as "everywhere" revokes with the wider scope', async () => {
      const { client, root } = await readyShell({ signOutError: { message: 'network' } });
      button(root, 'Sign out').click();
      await flush();
      button(root, 'Sign out everywhere').click();
      await flush();
      expect(client.auth.admin.signOut).toHaveBeenCalledWith('token-1', 'global');
    });

    it('a revocation the server refuses is reported and can be tried again', async () => {
      const { client, root } = await readyShell({
        signOutError: { message: 'network' },
        revokeError: { status: 500, message: 'down' },
      });
      button(root, 'Sign out').click();
      await flush();
      button(root, 'Sign out').click();
      await flush();
      expect(root.querySelector('.adm-header-feedback').textContent).toMatch(/Could not sign out/);
      expect(root.querySelector('header')).not.toBeNull();
      button(root, 'Sign out').click();
      await flush();
      expect(client.auth.admin.signOut).toHaveBeenCalledTimes(2);
    });

    it('"the session is already gone" (401, 403, 404) counts as signed out', async () => {
      for (const status of [401, 403, 404]) {
        const { client, root } = await readyShell({
          signOutError: { message: 'network' },
          revokeError: { status, message: 'gone' },
        });
        button(root, 'Sign out').click();
        await flush();
        button(root, 'Sign out').click();
        await flush();
        expect(client.auth.admin.signOut).toHaveBeenCalledTimes(1);
        expect(heading(root)).toBe('Admin sign in');
        cleanup();
      }
    });

    it('both header buttons are out while either is working, and one click sends one request', async () => {
      const { client, root } = await readyShell();
      let finish;
      client.auth.signOut = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ error: null });
          }),
      );
      const first = button(root, 'Sign out');
      const second = button(root, 'Sign out everywhere');
      first.click();
      first.click();
      second.click();
      await flush();
      expect(client.auth.signOut).toHaveBeenCalledTimes(1);
      expect(first.getAttribute('aria-disabled')).toBe('true');
      expect(second.getAttribute('aria-disabled')).toBe('true');
      finish();
      await flush();
    });
  });

  it('a failed sign-out then a retry both reach the server for the same token', async () => {
    const client = makeClient({ signedIn: true, isAdmin: false, signOutError: { message: 'x' } });
    const root = boot(client);
    await flush();
    button(root, 'Sign out').click();
    await flush();
    button(root, 'Sign out').click();
    await flush();
    expect(client.auth.admin.signOut).toHaveBeenCalledWith('token-1', 'local');
  });
});

describe('the sign-in screen when the request itself fails', () => {
  it('a rejected request says the connection failed and the form works again', async () => {
    const client = makeClient();
    client.auth.signInWithPassword = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'pw');
    await submit(root);
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/Check your connection/);
    const submitButton = root.querySelector('button[type="submit"]');
    expect(submitButton.getAttribute('aria-disabled')).toBeNull();
    expect(submitButton.textContent).toBe('Sign in');
    expect(field(root, 'email').getAttribute('aria-disabled')).toBeNull();
  });

  it('a request that never answers ends in the slow message after ten seconds', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      client.auth.signInWithPassword = vi.fn(() => new Promise(() => {}));
      const root = boot(client);
      await vi.advanceTimersByTimeAsync(10);
      await type(root, 'email', 'ops@example.test');
      await type(root, 'password', 'pw');
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(10001);
      expect(root.querySelector('.screen-feedback').textContent).toMatch(/longer than expected/);
      expect(root.querySelector('button[type="submit"]').textContent).toBe('Sign in');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rate-limited sign-in says to wait, not that the connection failed', async () => {
    for (const error of [{ code: 'over_request_rate_limit', status: 429 }, { status: 429 }]) {
      const client = makeClient({ signInError: error });
      const root = boot(client);
      await flush();
      await type(root, 'email', 'ops@example.test');
      await type(root, 'password', 'pw');
      await submit(root);
      expect(root.querySelector('.screen-feedback').textContent).toMatch(/Too many attempts/);
      cleanup();
    }
  });
});

describe('the second-factor screens', () => {
  it('shows the QR code GoTrue returned, not anything else', async () => {
    const client = makeClient({ signedIn: true, hasFactor: false });
    const root = boot(client);
    await flush();
    expect(root.querySelector('img.adm-qr').getAttribute('src')).toBe(
      'data:image/svg+xml;utf-8,<svg/>',
    );
  });

  it('Try again enrols once per click, and focus goes to the code field afterwards', async () => {
    const client = makeClient({ signedIn: true, hasFactor: false });
    const realEnrol = client.auth.mfa.enroll;
    client.auth.mfa.enroll = vi.fn(async () => ({
      data: null,
      error: { code: 'x', message: 'x' },
    }));
    const root = boot(client);
    await flush();
    client.auth.mfa.enroll = realEnrol;
    const retry = button(root, 'Try again');
    retry.click();
    retry.click();
    await flush();
    expect(realEnrol).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(field(root, 'code'));
  });

  it('a wrong code keeps focus in the code field and announces the message in the live region', async () => {
    const client = makeClient({
      signedIn: true,
      verifyError: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
    });
    const root = boot(client);
    await flush();
    await type(root, 'code', '000000');
    await submit(root);
    expect(document.activeElement).toBe(field(root, 'code'));
    const live = root.querySelector('.screen-feedback');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toMatch(/did not work/);
  });

  it('the code field has a real label', async () => {
    const root = boot(makeClient({ signedIn: true }));
    await flush();
    const label = root.querySelector('label[for="adm-code"]');
    expect(label.textContent).toBe('6-digit code');
    expect(root.querySelector('#adm-code')).toBe(field(root, 'code'));
  });
});

describe('every screen before the console', () => {
  const screens = [
    ['sign-in', () => makeClient()],
    ['no access', () => makeClient({ signedIn: true, isAdmin: false })],
    ['challenge', () => makeClient({ signedIn: true })],
    ['enrol', () => makeClient({ signedIn: true, hasFactor: false })],
    [
      'check failed',
      () => {
        const client = makeClient({ signedIn: true });
        client.rpc = vi.fn(async () => ({ data: null, error: { message: 'down' }, status: 500 }));
        return client;
      },
    ],
  ];

  it.each(screens)(
    '%s: one main landmark, the message region right under the heading',
    async (_name, make) => {
      const root = boot(make());
      await flush();
      const mains = root.querySelectorAll('main');
      expect(mains).toHaveLength(1);
      const h1 = mains[0].querySelector('h1');
      // A focused error must be followed, in Tab order, by the form (or button) it is about, not by the page's end.
      expect(h1.nextElementSibling.classList.contains('screen-feedback')).toBe(true);
      expect(mains[0].querySelectorAll('h1')).toHaveLength(1);
    },
  );

  it('the forms leave the checking to the page (their own messages), not to the browser', async () => {
    for (const make of [() => makeClient(), () => makeClient({ signedIn: true })]) {
      const root = boot(make());
      await flush();
      expect(root.querySelector('form').noValidate).toBe(true);
      cleanup();
    }
  });

  it('opens on the notice, not the heading, when there is one to read', async () => {
    const client = makeClient({
      signedIn: true,
      aal: 'aal2',
      gate: () => ({ data: null, error: { hint: 'admin_session_ended' } }),
    });
    const root = boot(client);
    await flush();
    expect(document.activeElement).toBe(root.querySelector('.screen-feedback'));
    expect(document.activeElement.textContent).toBe('Your session ended. Sign in again.');
  });

  it('opens on the heading when there is no notice', async () => {
    const root = boot(makeClient());
    await flush();
    expect(document.activeElement).toBe(root.querySelector('h1'));
  });
});

describe('the console keeps asking the gate while it is open', () => {
  async function readyConsole() {
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client);
    await flush();
    expect(root.querySelector('header')).not.toBeNull();
    return { client, root };
  }

  function refuseWith(client, hint) {
    client.rpc = vi.fn(async (name) =>
      name === 'am_i_platform_admin'
        ? { data: { is_admin: true, aal: 'aal2' }, error: null }
        : { data: null, error: { hint } },
    );
  }

  const visible = (state) =>
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

  it('when the tab becomes visible again, a stale second factor sends it back to the challenge', async () => {
    const { client, root } = await readyConsole();
    refuseWith(client, 'admin_mfa_required');
    visible('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(heading(root)).toBe('Verify it is you');
    expect(root.querySelector('header')).toBeNull();
  });

  it('a session ended elsewhere shows the sign-in with the notice', async () => {
    const { client, root } = await readyConsole();
    refuseWith(client, 'admin_session_ended');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(heading(root)).toBe('Admin sign in');
    expect(root.querySelector('.screen-feedback').textContent).toMatch(/session ended/);
  });

  it('a tab that is hidden is not asked, and a console that is still fine is left alone', async () => {
    const { client, root } = await readyConsole();
    const before = client.rpc.mock.calls.length;
    visible('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(client.rpc.mock.calls.length).toBe(before);
    visible('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(client.rpc.mock.calls.length).toBeGreaterThan(before);
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('header')).toBe(root.querySelector('header'));
  });

  it('a recheck does not blank the console while it waits', async () => {
    const { client, root } = await readyConsole();
    const header = root.querySelector('header');
    let answer;
    client.auth.getSession = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(root.querySelector('header')).toBe(header);
    answer({ data: { session: { user: { email: 'ops@example.test' } } }, error: null });
    await flush();
    expect(root.querySelector('header')).toBe(header);
  });

  it('nothing is asked while no one is signed in', async () => {
    const client = makeClient();
    const root = boot(client);
    await flush();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(heading(root)).toBe('Admin sign in');
  });

  it('asks again every five minutes while open, and stops after unmount', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient({ signedIn: true, aal: 'aal2' });
      const root = boot(client);
      await vi.advanceTimersByTimeAsync(10);
      expect(root.querySelector('header')).not.toBeNull();
      refuseWith(client, 'admin_mfa_required');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10);
      expect(heading(root)).toBe('Verify it is you');

      const second = makeClient({ signedIn: true, aal: 'aal2' });
      const other = boot(second);
      await vi.advanceTimersByTimeAsync(10);
      lastHandle().unmount();
      const calls = second.rpc.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
      expect(second.rpc.mock.calls.length).toBe(calls);
      expect(other.childNodes).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('rechecks that overlap, and cleaning up after them', () => {
  it('nothing at all is asked while the sign-in screen is showing (not even the session)', async () => {
    const client = makeClient();
    boot(client);
    await flush();
    const before = client.auth.getSession.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(client.auth.getSession.mock.calls.length).toBe(before);
  });

  it('two rechecks in flight at once do not repaint the sign-in over what the person is typing', async () => {
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client);
    await flush();
    const held = [];
    client.auth.getSession = vi.fn(
      () =>
        new Promise((resolve) => {
          held.push(resolve);
        }),
    );
    // The tab becomes visible and the five-minute timer fires together: two rechecks.
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(held).toHaveLength(2);
    held[0]({ data: { session: null }, error: null });
    await flush();
    expect(heading(root)).toBe('Admin sign in');
    await type(root, 'email', 'half.typed@example.test');
    held[1]({ data: { session: null }, error: null });
    await flush();
    expect(field(root, 'email').value).toBe('half.typed@example.test');
  });

  it('unmounting stops the timer and removes the visibility listener (nothing is left running)', async () => {
    const clearTimer = vi.spyOn(globalThis, 'clearInterval');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    try {
      boot(makeClient({ signedIn: true, aal: 'aal2' }));
      await flush();
      lastHandle().unmount();
      expect(clearTimer).toHaveBeenCalled();
      expect(removeListener.mock.calls.map((call) => call[0])).toContain('visibilitychange');
      const hashListener = vi.spyOn(window, 'removeEventListener');
      boot(makeClient({ signedIn: true, aal: 'aal2' }));
      await flush();
      lastHandle().unmount();
      expect(hashListener.mock.calls.map((call) => call[0])).toContain('hashchange');
      hashListener.mockRestore();
    } finally {
      clearTimer.mockRestore();
      removeListener.mockRestore();
    }
  });
});

describe('where focus goes after a failure', () => {
  it('a wrong code does not move focus to the message (the live region announces it; the field keeps focus)', async () => {
    const client = makeClient({
      signedIn: true,
      verifyError: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
    });
    const root = boot(client);
    await flush();
    const live = root.querySelector('.screen-feedback');
    const focusSpy = vi.spyOn(live, 'focus');
    await type(root, 'code', '000000');
    await submit(root);
    expect(focusSpy).not.toHaveBeenCalled();
    expect(live.textContent).toMatch(/did not work/);
    expect(document.activeElement).toBe(field(root, 'code'));
  });

  it('a refused sign-in DOES move focus to the message (nothing else to retype first)', async () => {
    const client = makeClient({
      signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const root = boot(client);
    await flush();
    const live = root.querySelector('.screen-feedback');
    const focusSpy = vi.spyOn(live, 'focus');
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', 'wrong');
    await submit(root);
    expect(focusSpy).toHaveBeenCalled();
  });

  it('Retry on the "could not check" screen asks once per click', async () => {
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    client.rpc = vi.fn(async () => ({ data: null, error: { message: 'down' }, status: 500 }));
    const root = boot(client);
    await flush();
    expect(heading(root)).toBe('Could not check your access');
    const before = client.auth.getSession.mock.calls.length;
    const retry = button(root, 'Retry');
    retry.click();
    retry.click();
    await flush();
    expect(client.auth.getSession.mock.calls.length - before).toBe(1);
  });
});

describe('ctx.callAdmin (what panels call admin functions through)', () => {
  async function withPanel() {
    let ctx;
    const panels = [
      {
        id: 'p',
        label: 'P',
        route: 'p',
        mount: (host, given) => {
          ctx = given;
          host.textContent = 'panel';
          return { unmount() {} };
        },
      },
    ];
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    const root = boot(client, { panels });
    await flush();
    return { client, root, ctx };
  }

  it('passes the call and the answer through untouched', async () => {
    const { client, ctx, root } = await withPanel();
    client.rpc = vi.fn(async () => ({ data: [{ id: 1 }], error: null }));
    const result = await ctx.callAdmin('admin_list_orgs', { p: 1 });
    expect(client.rpc).toHaveBeenCalledWith('admin_list_orgs', { p: 1 });
    expect(result).toEqual({ data: [{ id: 1 }], error: null });
    expect(root.querySelector('header')).not.toBeNull();
  });

  it('a gate refusal in the answer runs the access check again, without the panel doing anything', async () => {
    const { client, ctx, root } = await withPanel();
    client.rpc = vi.fn(async (name) => {
      if (name === 'admin_list_orgs') return { data: null, error: { hint: 'admin_mfa_required' } };
      if (name === 'am_i_platform_admin')
        return { data: { is_admin: true, aal: 'aal2' }, error: null };
      return { data: null, error: { hint: 'admin_mfa_required' } };
    });
    const result = await ctx.callAdmin('admin_list_orgs', {});
    expect(result.error.hint).toBe('admin_mfa_required');
    await flush();
    expect(heading(root)).toBe('Verify it is you');
  });

  it('a rejected token (HTTP 401, no hint) also runs the access check again', async () => {
    const { client, ctx } = await withPanel();
    client.rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'JWT expired' },
      status: 401,
    }));
    await ctx.callAdmin('admin_list_orgs', {});
    await flush();
    // one call for the panel's own request, one more for the access check the 401 triggered
    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual([
      'admin_list_orgs',
      'am_i_platform_admin',
    ]);
  });

  it("an ordinary refusal is the panel's own business and does not touch the gate", async () => {
    const { client, ctx, root } = await withPanel();
    client.rpc = vi.fn(async () => ({ data: null, error: { hint: 'org_not_found' } }));
    await ctx.callAdmin('admin_org_detail', {});
    await flush();
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(root.querySelector('header')).not.toBeNull();
  });
});

describe('ctx.callFunction (what panels call an Edge Function through)', () => {
  async function withPanel() {
    let ctx;
    const panels = [
      {
        id: 'p',
        label: 'P',
        route: 'p',
        mount: (host, given) => {
          ctx = given;
          host.textContent = 'panel';
          return { unmount() {} };
        },
      },
    ];
    const client = makeClient({ signedIn: true, aal: 'aal2' });
    client.functions = { invoke: vi.fn() };
    const root = boot(client, { panels });
    await flush();
    return { client, root, ctx };
  }

  const refusal = (status, body) => ({
    data: null,
    error: { context: { status, json: async () => body } },
  });

  it('sends the body to the named function and returns { data, error } like callAdmin', async () => {
    const { client, ctx, root } = await withPanel();
    client.functions.invoke.mockResolvedValue({
      data: { userId: 'u', password: 'pw' },
      error: null,
    });
    const result = await ctx.callFunction('admin-accounts', { action: 'create_owner' });
    expect(client.functions.invoke).toHaveBeenCalledWith('admin-accounts', {
      body: { action: 'create_owner' },
    });
    expect(result).toEqual({ data: { userId: 'u', password: 'pw' }, error: null });
    expect(root.querySelector('header')).not.toBeNull();
  });

  it('a gate refusal from the function runs the access check again', async () => {
    const { client, ctx, root } = await withPanel();
    client.functions.invoke.mockResolvedValue(refusal(403, { hint: 'admin_mfa_required' }));
    client.rpc = vi.fn(async (name) =>
      name === 'am_i_platform_admin'
        ? { data: { is_admin: true, aal: 'aal2' }, error: null }
        : { data: null, error: { hint: 'admin_mfa_required' } },
    );
    const result = await ctx.callFunction('admin-accounts', {});
    expect(result.error.hint).toBe('admin_mfa_required');
    await flush();
    expect(heading(root)).toBe('Verify it is you');
  });

  it('a rejected token (HTTP 401, even with no hint) also runs the access check again', async () => {
    const { client, ctx } = await withPanel();
    client.functions.invoke.mockResolvedValue(refusal(401, { error: 'Sign in again.' }));
    client.rpc = vi.fn(async () => ({ data: null, error: { hint: 'admin_session_ended' } }));
    await ctx.callFunction('admin-accounts', {});
    await flush();
    expect(client.rpc.mock.calls.map(([name]) => name)).toContain('am_i_platform_admin');
  });

  it("an ordinary refusal (a taken email) is the panel's own business and does not touch the gate", async () => {
    const { client, ctx, root } = await withPanel();
    client.functions.invoke.mockResolvedValue(refusal(409, { hint: 'email_taken' }));
    client.rpc = vi.fn();
    const result = await ctx.callFunction('admin-accounts', {});
    await flush();
    expect(result.error).toEqual({ status: 409, hint: 'email_taken', userId: undefined });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(root.querySelector('header')).not.toBeNull();
  });
});

describe('what the console never does', () => {
  it('never reads or writes localStorage (the organiser session lives there)', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const client = makeClient({ signedIn: true });
    boot(client);
    await flush();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('the admin sign-in does not spend a second attempt on a trimmed password', () => {
  it('a refused password with surrounding spaces is sent exactly once, as typed', async () => {
    const client = makeClient({
      signInError: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const root = boot(client);
    await flush();
    await type(root, 'email', 'ops@example.test');
    await type(root, 'password', ' pasted from a chat ');
    await submit(root);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ops@example.test',
      password: ' pasted from a chat ',
    });
  });
});
