import { describe, it, expect, vi, afterEach } from 'vitest';
import { mountAdminConsole } from './console.js';

// The whole console against a fake client: every screen the gate can produce, and the moves between them.
// The fake keeps one piece of state (who is signed in, at which level) so a sign-in, a verified code or a
// sign-out genuinely changes the next answer, as it does on the real server.

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

function makeClient({
  isAdmin = true,
  aal = 'aal1',
  hasFactor = true,
  signedIn = false,
  gate = null,
  verifyError = null,
  signInError = null,
  signOutError = null,
} = {}) {
  const state = { signedIn, aal, hasFactor, stale: [] };
  const client = {
    state,
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: state.signedIn ? { user: { email: 'ops@example.test' } } : null },
        error: null,
      })),
      signInWithPassword: vi.fn(async () => {
        if (signInError) return { error: signInError };
        state.signedIn = true;
        return { error: null };
      }),
      signOut: vi.fn(async ({ scope }) => {
        if (signOutError) return { error: signOutError };
        state.signedIn = false;
        state.aal = 'aal1';
        state.lastScope = scope;
        return { error: null };
      }),
      mfa: {
        listFactors: vi.fn(async () => ({
          data: {
            totp: state.hasFactor ? [{ id: 'factor-1', status: 'verified' }] : [],
            all: [
              ...(state.hasFactor
                ? [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }]
                : []),
              ...state.stale,
            ],
          },
          error: null,
        })),
        unenroll: vi.fn(async ({ factorId }) => {
          state.stale = state.stale.filter((f) => f.id !== factorId);
          return { error: null };
        }),
        enroll: vi.fn(async () => ({
          data: {
            id: 'factor-new',
            totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEFGHIJKLMNOP' },
          },
          error: null,
        })),
        challengeAndVerify: vi.fn(async () => {
          if (verifyError) return { error: verifyError };
          state.aal = 'aal2';
          state.hasFactor = true;
          return { error: null };
        }),
      },
    },
    rpc: vi.fn(async (name) => {
      if (name === 'am_i_platform_admin') {
        return { data: { is_admin: isAdmin, aal: state.aal }, error: null };
      }
      if (name === 'admin_can_provision') {
        if (gate) return gate(state);
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }),
  };
  return client;
}

const mounted = [];
function boot(client, options = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = mountAdminConsole(root, { client, ...options });
  mounted.push({ root, handle });
  return root;
}

afterEach(() => {
  for (const { root, handle } of mounted.splice(0)) {
    handle.unmount();
    root.remove();
  }
  window.location.hash = '';
});

const heading = (root) => root.querySelector('h1')?.textContent;
const field = (root, name) => root.querySelector(`[data-field="${name}"]`);

async function type(root, name, value) {
  const input = field(root, name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit(root) {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

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
    expect(root.querySelector('nav a[aria-current="page"]').textContent).toBe('Overview');
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
    expect(heading(root) ?? '').not.toBe('Verify it is you');
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

  it('a late answer from a check that was superseded never paints', async () => {
    const client = makeClient({ signedIn: false });
    let slow;
    client.auth.getSession = vi.fn(
      () =>
        new Promise((resolve) => {
          slow = resolve;
        }),
    );
    const root = boot(client);
    const handle = mounted.at(-1).handle;
    handle.unmount();
    slow({ data: { session: { user: { email: 'a@b.test' } } }, error: null });
    await flush();
    expect(root.querySelector('h1')).toBeNull();
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
