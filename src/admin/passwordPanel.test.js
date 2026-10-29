import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// The Change password panel (ADMIN-PASSWORD-DESIGN section 9, U-1 to U-10). The throwaway client that checks the
// current password is replaced by a fake; the real auth client is used for U-7.
const check = vi.hoisted(() => ({ current: null }));
vi.mock('./adminClient.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getCheckClient: () => check.current,
}));

import { PANELS } from './panels.js';
import { createAdminClient } from './adminClient.js';
import {
  mountPasswordPanel,
  describePasswordPanelError,
  ADMIN_MIN_PASSWORD_LENGTH,
  SAVED_MESSAGE,
  OTHERS_NOT_ENDED_MESSAGE,
} from './passwordPanel.js';
import { boot, flush, makeClient, heading } from './consoleHarness.js';

const OLD = 'old-password-1234';
const NEW = 'brand-new-password-99';

function fakeClient({
  updateUser = () => Promise.resolve({ data: {}, error: null }),
  signOut = () => Promise.resolve({ error: null }),
} = {}) {
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { email: 'ops@example.test' } } },
      })),
      updateUser: vi.fn(updateUser),
      signOut: vi.fn(signOut),
    },
  };
}

// The throwaway client: signs in (or not) and records that its session was ended.
function fakeCheckClient({ signIn } = {}) {
  return {
    auth: {
      signInWithPassword: vi.fn(
        signIn ?? (async () => ({ data: { session: { access_token: 't' } }, error: null })),
      ),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
}

let host;
let handle;
function mount(client = fakeClient(), ctx = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  handle = mountPasswordPanel(host, { client, onGateRefused: vi.fn(), ...ctx });
  return client;
}
const field = (name) => host.querySelector(`[data-field="${name}"]`);
const feedback = () => host.querySelector('.screen-feedback').textContent;
async function fill({ current = OLD, password = NEW, confirmation = password } = {}) {
  for (const [name, value] of Object.entries({ current, password, confirmation })) {
    field(name).value = value;
    field(name).dispatchEvent(new Event('input', { bubbles: true }));
  }
}
async function send() {
  host
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

beforeEach(() => {
  check.current = fakeCheckClient();
});
afterEach(() => {
  handle?.unmount();
  host?.remove();
  handle = host = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('U-1 the registry', () => {
  it('has the panel at route password, labelled Change password, after the existing four', () => {
    expect(PANELS.map((p) => p.route)).toEqual(['orgs', 'new-org', 'plan', 'audit', 'password']);
    const entry = PANELS.find((p) => p.id === 'password');
    expect(entry.label).toBe('Change password');
    expect(entry.route).toBe('password');
    expect(entry.mount).toBe(mountPasswordPanel);
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

describe('U-2 the panel is behind the gate', () => {
  it('an aal1 admin is challenged and the route never shows the panel; aal2 shows it', async () => {
    window.location.hash = '#/password';
    const aal1 = makeClient({ signedIn: true });
    const challenged = boot(aal1);
    await flush();
    expect(heading(challenged)).toBe('Verify it is you');
    expect(challenged.querySelector('[data-field="password"]')).toBeNull();
    expect(challenged.textContent).not.toContain('Change password');

    window.location.hash = '#/password';
    const aal2 = makeClient({ signedIn: true, aal: 'aal2' });
    const open = boot(aal2);
    await flush();
    expect(open.querySelector('h1').textContent).toBe('Change password');
    expect(open.querySelector('[data-field="current"]')).not.toBeNull();
  });
});

describe('U-3 the checks before any request', () => {
  it('empty, short, mismatched and a missing current password each give their own message and send nothing', async () => {
    const client = mount();
    await fill({ current: '' });
    await send();
    expect(feedback()).toBe('Enter your current password.');
    await fill({ password: '', confirmation: '' });
    await send();
    expect(feedback()).toBe('Choose a password.');
    await fill({ password: 'a'.repeat(ADMIN_MIN_PASSWORD_LENGTH - 1) });
    await send();
    expect(feedback()).toBe('Use at least 12 characters.');
    await fill({ password: NEW, confirmation: `${NEW}x` });
    await send();
    expect(feedback()).toBe('The two passwords do not match.');
    expect(check.current.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('exactly 12 characters passes', async () => {
    const client = mount();
    await fill({ password: 'a'.repeat(12) });
    await send();
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
  });
});

describe('U-4 every refusal is worded, never the server text', () => {
  const server = 'SERVER TEXT: Auth session missing!';
  const cases = [
    ['insufficient_aal', /authenticator/i],
    ['same_password', /different password/],
    ['weak_password', /too easy to guess/],
    ['over_request_rate_limit', /Too many attempts/],
    ['current_password_mismatch', /not your current password/],
    ['session_not_found', /session ended/],
    ['something_else', /Could not save/],
  ];

  it.each(cases)('%s', async (code, words) => {
    mount(
      fakeClient({
        updateUser: () => Promise.resolve({ data: null, error: { code, message: server } }),
      }),
    );
    await fill();
    await send();
    expect(feedback()).toMatch(words);
    expect(feedback()).not.toContain('SERVER TEXT');
  });

  it('insufficient_aal never says "ask the team" (the operator is the team)', () => {
    for (const code of ['insufficient_aal', 'same_password', 'weak_password', 'x']) {
      expect(describePasswordPanelError({ code })).not.toMatch(/team/i);
    }
  });

  it('a rate limit with only an HTTP status is still worded as one', () => {
    expect(describePasswordPanelError({ status: 429 })).toMatch(/Too many attempts/);
  });

  it('a timeout while saving says the password MAY be saved; a timeout while checking says nothing changed', async () => {
    vi.useFakeTimers();
    mount(fakeClient({ updateUser: () => new Promise(() => {}) }));
    await fill();
    const pending = send();
    await vi.advanceTimersByTimeAsync(10001);
    await pending;
    expect(feedback()).toMatch(/may have been saved/);

    handle.unmount();
    host.remove();
    check.current = fakeCheckClient({ signIn: () => new Promise(() => {}) });
    const client = mount();
    await fill();
    const pendingCheck = send();
    await vi.advanceTimersByTimeAsync(10001);
    await pendingCheck;
    expect(feedback()).toMatch(/Nothing was changed/);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('offline while saving and while checking are worded apart', async () => {
    mount(fakeClient({ updateUser: () => Promise.reject(new TypeError('Failed to fetch')) }));
    await fill();
    await send();
    expect(feedback()).toMatch(/connection dropped.*may have been saved/);
    expect(feedback()).not.toContain('Failed to fetch');

    handle.unmount();
    host.remove();
    check.current = fakeCheckClient({
      signIn: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const client = mount();
    await fill();
    await send();
    expect(feedback()).toMatch(/Could not check your current password. Nothing was changed/);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('after a save that may have committed, a retry that fails on the old password says so', async () => {
    mount(fakeClient({ updateUser: () => Promise.reject(new TypeError('Failed to fetch')) }));
    await fill();
    await send();
    check.current = fakeCheckClient({
      signIn: async () => ({ data: null, error: { code: 'invalid_credentials' } }),
    });
    await send();
    expect(feedback()).toMatch(/not your current password.*may already be in effect/);
  });

  it('a session that is gone sends the console back through the access check', async () => {
    const onGateRefused = vi.fn();
    mount(
      fakeClient({
        updateUser: () => Promise.resolve({ data: null, error: { code: 'session_not_found' } }),
      }),
      { onGateRefused },
    );
    await fill();
    await send();
    expect(onGateRefused).toHaveBeenCalledTimes(1);
  });
});

describe('U-5 the save', () => {
  it('calls updateUser once with the current password, then ends the OTHER sessions once', async () => {
    const client = mount();
    await fill();
    await send();
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(client.auth.updateUser).toHaveBeenCalledWith({
      password: NEW,
      current_password: OLD,
      data: { must_change_password: false },
    });
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    // the order matters: a refused save must never end the other sessions
    expect(client.auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      client.auth.signOut.mock.invocationCallOrder[0],
    );
    expect(host.querySelector('h1').textContent).toBe('Password changed');
    expect(host.textContent).toContain(SAVED_MESSAGE);
  });

  it('a double submit sends one request', async () => {
    const client = mount();
    await fill();
    host
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    host
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(check.current.auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe('U-6 other sessions that could not be ended', () => {
  it('says so and names Sign out everywhere', async () => {
    mount(fakeClient({ signOut: () => Promise.resolve({ error: { status: 500 } }) }));
    await fill();
    await send();
    expect(host.querySelector('h1').textContent).toBe('Password changed');
    expect(host.textContent).toContain(OTHERS_NOT_ENDED_MESSAGE);
    expect(host.textContent).toContain('"Sign out everywhere"');
    expect(host.textContent).not.toMatch(/ask the team/i);
  });
});

// ---- U-7: the real auth client ----
const b64 = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
const NOW = Math.floor(Date.now() / 1000);
const TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u', aal: 'aal2', session_id: 's', exp: NOW + 3000 })}.sig`;
function realClient() {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const client = createAdminClient({ url: 'http://127.0.0.1:1', anonKey: 'anon', storage });
  store.set(
    'seduh-admin-auth',
    JSON.stringify({
      access_token: TOKEN,
      refresh_token: 'r',
      expires_in: 3000,
      expires_at: NOW + 3000,
      token_type: 'bearer',
      user: {
        id: 'u',
        aud: 'authenticated',
        email: 'ops@example.test',
        app_metadata: {},
        user_metadata: {},
        created_at: '',
      },
    }),
  );
  return { client, store };
}

describe('U-7 the real auth client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signOut({ scope: "others" }) keeps this tab’s session on success AND on failure; "local" drops it', async () => {
    let down = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (down) throw new TypeError('fetch failed');
        return new Response(null, { status: 204 });
      }),
    );
    const { client, store } = realClient();
    expect((await client.auth.signOut({ scope: 'others' })).error).toBeNull();
    expect(store.has('seduh-admin-auth')).toBe(true);

    down = true;
    await client.auth.signOut({ scope: 'others' }).catch(() => {});
    expect(store.has('seduh-admin-auth')).toBe(true);

    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    expect(store.has('seduh-admin-auth')).toBe(false);
  });
});

describe('U-8 the password goes nowhere but the request', () => {
  it('is in no attribute, console call or storage, before, during or after a save', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m));
    mount();
    await fill();
    const typedHtml = host.outerHTML;
    await send();
    const secrets = [OLD, NEW];
    const html = host.outerHTML;
    for (const secret of secrets) {
      expect(typedHtml).not.toContain(secret);
      expect(html).not.toContain(secret);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
      for (const store of [window.localStorage, window.sessionStorage]) {
        expect(JSON.stringify({ ...store })).not.toContain(secret);
      }
      expect(window.location.href).not.toContain(secret);
    }
  });

  it('a refused attempt leaves the password out of every attribute too', async () => {
    mount(
      fakeClient({
        updateUser: () => Promise.resolve({ data: null, error: { code: 'weak_password' } }),
      }),
    );
    await fill();
    await send();
    for (const node of host.querySelectorAll('*')) {
      for (const attr of node.attributes) {
        expect(attr.value).not.toContain(NEW);
        expect(attr.value).not.toContain(OLD);
      }
    }
  });
});

describe('U-10 the current password', () => {
  it('a wrong one sends no update, ends nothing, and the message reveals nothing else', async () => {
    check.current = fakeCheckClient({
      signIn: async () => ({
        data: null,
        error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 },
      }),
    });
    const client = mount();
    await fill();
    await send();
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(feedback()).toBe('That is not your current password.');
    expect(host.querySelector('h1').textContent).toBe('Change password');
  });

  it('a right one is checked with a throwaway client whose session is then ended locally', async () => {
    mount();
    await fill();
    await send();
    expect(check.current.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ops@example.test',
      password: OLD,
    });
    expect(check.current.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('a rate limit on the check is worded as one and changes nothing', async () => {
    check.current = fakeCheckClient({
      signIn: async () => ({ data: null, error: { code: 'over_request_rate_limit', status: 429 } }),
    });
    const client = mount();
    await fill();
    await send();
    expect(feedback()).toMatch(/Too many attempts/);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('U-11 no native bubble, the box at fault is marked, one toggle covers every password box', () => {
  it('novalidate, aria-invalid on the box at fault, and one toggle for all three', async () => {
    mount();
    await fill({ current: '' });
    await send();
    const form = host.querySelector('form');
    expect(form.hasAttribute('novalidate')).toBe(true);
    const current = host.querySelector('[data-field="current"]');
    expect(current.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`#${current.getAttribute('aria-describedby')}`).textContent).toBe(
      'Enter your current password.',
    );
    host.querySelector('.password-toggle').click();
    for (const name of ['current', 'password', 'confirmation']) {
      expect(host.querySelector(`[data-field="${name}"]`).type).toBe('text');
    }
  });
});
