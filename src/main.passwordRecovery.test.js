import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Drives the REAL router, the REAL sign-in / forgot-password / recovery / change-password screens and the
// REAL recovery flow through mountApp (D-PW1). main.test.js stubs every screen; this file exists because the
// recovery link is a clash BETWEEN modules (the address bar's hash is read by the Supabase client, by the
// router, and by the recovery flow) that no single module's test can show. Only what jsdom cannot do (the
// outbox's IndexedDB) and the screens unrelated to sign-in are replaced.
const mountEventsScreen = vi.fn(async (root) => {
  root.innerHTML = '';
  const heading = document.createElement('h1');
  heading.textContent = 'EVENTS_SCREEN';
  root.appendChild(heading);
  return { unmount() {} };
});
vi.mock('./core/eventsScreen.js', () => ({
  mountEventsScreen: (...args) => mountEventsScreen(...args),
}));
vi.mock('./core/outbox.js', () => ({
  flushOutbox: () => Promise.resolve({ processed: 0, stopped: false, permanentFailure: false }),
  listPendingOperations: () => Promise.resolve([]),
  listOtherOperations: () => Promise.resolve({ otherOrg: [], otherAccount: [] }),
  listAccountOperations: () => Promise.resolve([]),
  payloadOrgId: () => null,
  partitionOperations: () => Promise.resolve({ own: [], otherOrg: [], otherAccount: [] }),
  getOutboxOwner: () => undefined,
  setOutboxOwner: () => {},
  isFlushInProgress: () => false,
  onOperationDropped: () => () => {},
}));
vi.mock('./formats/cup-taster/outboxHandlers.js', () => ({
  cupTasterOutboxHandlers: () => ({}),
  cupTasterOperationLabels: {},
}));
vi.mock('./formats/btc/outboxHandlers.js', () => ({
  btcOutboxHandlers: () => ({}),
  btcOperationLabels: {},
}));
vi.mock('./core/team.js', () => ({ canManageTeam: () => Promise.resolve(false) }));
// The real client is built lazily by getSupabase(); this records what the address bar held at that moment
// (only the one test that gives mountApp no client of its own uses it).
const clientBuilt = { hashes: [], client: null };
vi.mock('./core/supabaseClient.js', () => ({
  getSupabase: () => {
    clientBuilt.hashes.push(location.hash);
    return clientBuilt.client;
  },
}));

const { mountApp } = await import('./main.js');

const USER = { id: 'user-1', email: 'organiser@test.com', user_metadata: {} };
const TOKEN_HASH =
  '#access_token=AT-secret&expires_in=3600&refresh_token=RT-secret&token_type=bearer&type=recovery';
const EXPIRED_HASH =
  '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

// A client that behaves like supabase-js for the parts this flow touches: a session that setSession creates
// and signOut removes, auth events delivered to subscribers, and an organisation for the signed-in person.
function fakeClient({
  signedIn = false,
  aal = { currentLevel: 'aal1', nextLevel: 'aal1' },
  setSessionError = null,
  userMetadata = {},
  // A stored session the client found revoked at start-up: its SIGNED_OUT reaches subscribers while the
  // link's own session is still being established.
  staleSignedOutFirst = false,
} = {}) {
  let user = { ...USER, user_metadata: userMetadata };
  let session = signedIn ? { user } : null;
  const listeners = new Set();
  const emit = (event) => {
    for (const listener of listeners) listener(event, session);
  };
  const client = {
    calls: { updateUser: [], signOut: [], setSession: [], reset: [] },
    rpc: (name) =>
      Promise.resolve(
        name === 'my_orgs'
          ? {
              data: [{ org_id: 'org1', name: 'Org One', slug: 'org-one', role: 'owner' }],
              error: null,
            }
          : { data: null, error: { code: 'unexpected rpc: ' + name } },
      ),
    auth: {
      getSession: () => Promise.resolve({ data: { session } }),
      onAuthStateChange: (listener) => {
        listeners.add(listener);
        // supabase-js reports the session it already holds to a new subscriber, a moment later.
        setTimeout(() => {
          if (listeners.has(listener)) listener('INITIAL_SESSION', session);
        }, 0);
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
      },
      setSession: vi.fn((tokens) => {
        client.calls.setSession.push(tokens);
        if (staleSignedOutFirst) emit('SIGNED_OUT');
        if (setSessionError)
          return Promise.resolve({ data: { session: null, user: null }, error: setSessionError });
        session = { user };
        emit('SIGNED_IN');
        return Promise.resolve({ data: { session, user }, error: null });
      }),
      updateUser: vi.fn((args) => {
        client.calls.updateUser.push(args);
        // Like Auth: `data` is merged into the user's metadata.
        user = { ...user, user_metadata: { ...user.user_metadata, ...args.data } };
        session = { user };
        emit('USER_UPDATED');
        return Promise.resolve({ data: { user }, error: null });
      }),
      signOut: vi.fn((options) => {
        client.calls.signOut.push(options);
        if (options?.scope === 'local' || options === undefined) {
          session = null;
          emit('SIGNED_OUT');
        }
        return Promise.resolve({ error: null });
      }),
      resetPasswordForEmail: vi.fn((email, options) => {
        client.calls.reset.push({ email, options });
        return Promise.resolve({ data: {}, error: null });
      }),
      signInWithPassword: vi.fn(() => Promise.resolve({ error: { code: 'invalid_credentials' } })),
      mfa: { getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: aal, error: null }) },
    },
  };
  return client;
}

let activeApp = null;
async function start(client, { hash = '' } = {}) {
  // Exactly what the browser has when someone opens the link: the page, with the fragment, no history entry of ours.
  history.replaceState(null, '', `/app/${hash}`);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = mountApp(root, { client, legacyAudienceOrgId: 'org1', legacyAudienceOrgSlug: null });
  await app.ready;
  activeApp = app;
  await settle();
  return { root, app };
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const h1 = (root) => root.querySelector('h1')?.textContent;
function typeInto(root, field, value) {
  const input = root.querySelector(`[data-field="${field}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function submitPasswords(root, password = 'correct-horse') {
  typeInto(root, 'password', password);
  typeInto(root, 'confirmation', password);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}
const byText = (root, text) =>
  [...root.querySelectorAll('a, button')].find((n) => n.textContent === text);

beforeEach(async () => {
  history.replaceState(null, '', '/app/');
  sessionStorage.clear();
  await settle();
});
afterEach(async () => {
  await settle();
  await activeApp?.unmount();
  activeApp = null;
  history.replaceState(null, '', '/');
  mountEventsScreen.mockClear();
});

describe('opening a recovery link', () => {
  it('takes the token out of the address bar before anything routes, and does not route the hash as a page', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: TOKEN_HASH });
    expect(location.href).not.toContain('secret');
    expect(location.href).not.toContain('access_token');
    expect(location.hash).toBe('');
    // Not the console, and not the not-found page the router would have shown for an unknown route.
    expect(h1(root)).toBe('Choose a new password');
    expect(root.textContent).not.toContain('Page not found');
    expect(mountEventsScreen).not.toHaveBeenCalled();
    expect(client.calls.setSession).toEqual([
      { access_token: 'AT-secret', refresh_token: 'RT-secret' },
    ]);
  });

  it('keeps the token out of the page and out of the history', async () => {
    const lengthBefore = history.length;
    const { root } = await start(fakeClient(), { hash: TOKEN_HASH });
    expect(document.body.innerHTML).not.toContain('secret');
    // No entry added (a pushState or a hash assignment would have grown it).
    expect(history.length).toBe(lengthBefore);
    expect(root.querySelector('form')).not.toBeNull();
  });

  it('shows the form instead of the console even though the link’s session is a perfectly good one', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: TOKEN_HASH });
    // Another console route does not get past the gate either.
    location.hash = '#/team';
    await settle();
    expect(h1(root)).toBe('Choose a new password');
    expect(mountEventsScreen).not.toHaveBeenCalled();
  });

  it('choosing a password signs out every other session, then Continue opens the console', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: TOKEN_HASH });
    await submitPasswords(root);
    expect(client.calls.updateUser).toEqual([
      { password: 'correct-horse', data: { must_change_password: false } },
    ]);
    expect(client.calls.signOut).toEqual([{ scope: 'others' }]);
    expect(h1(root)).toBe('Password changed');
    byText(root, 'Continue').click();
    await settle();
    expect(h1(root)).toBe('EVENTS_SCREEN');
    expect(mountEventsScreen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org1' }),
    );
  });

  it('after the password is saved, a refresh (a fresh app on the cleaned address) never shows the form again', async () => {
    const client = fakeClient();
    const first = await start(client, { hash: TOKEN_HASH });
    await submitPasswords(first.root);
    byText(first.root, 'Continue').click();
    await settle();
    await activeApp.unmount();
    activeApp = null;
    // The address bar as it is now: no fragment. A refresh is a new page load with the same session.
    expect(location.hash).toBe('');
    const second = await start(client);
    expect(h1(second.root)).toBe('EVENTS_SCREEN');
    expect(second.root.querySelector('form')).toBeNull();
    expect(client.calls.setSession).toHaveLength(1);
  });

  it('and replaying the SAME link finds the code spent, in words, with a way to ask for a new one', async () => {
    const client = fakeClient({
      setSessionError: { name: 'AuthApiError', status: 401, message: 'invalid' },
    });
    const { root } = await start(client, { hash: TOKEN_HASH });
    expect(h1(root)).toBe('This link no longer works');
    expect(root.textContent).toMatch(/expired or was already used/);
    expect(root.querySelector('form')).toBeNull();
    expect(mountEventsScreen).not.toHaveBeenCalled();
  });

  it('an expired link (an error in the hash, no token at all) says so and the fragment is gone', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: EXPIRED_HASH });
    expect(h1(root)).toBe('This link no longer works');
    expect(location.href).not.toContain('error');
    expect(client.calls.setSession).toHaveLength(0);
    byText(root, 'Request a new link').click();
    await settle();
    expect(location.hash).toBe('#/forgot-password');
    expect(h1(root)).toBe('Forgot your password?');
  });

  it('after leaving the dead-end screen, going back to the console is the console (or sign-in), not the dead end', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: EXPIRED_HASH });
    byText(root, 'Back to sign in').click();
    await settle();
    expect(h1(root)).toBe('Sign in');
  });

  it('an account with an authenticator app is told so, gets no form, and the link’s session is ended', async () => {
    const client = fakeClient({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } });
    const { root } = await start(client, { hash: TOKEN_HASH });
    expect(h1(root)).toBe('This account has an authenticator app');
    expect(root.querySelector('form')).toBeNull();
    expect(client.calls.signOut).toEqual([{ scope: 'local' }]);
    expect(client.calls.updateUser).toHaveLength(0);
    byText(root, 'Back to sign in').click();
    await settle();
    expect(h1(root)).toBe('Sign in');
  });

  it('a link opened into a console that is already running is taken the same way', async () => {
    const client = fakeClient({ signedIn: true });
    const { root } = await start(client, { hash: '#/events' });
    expect(h1(root)).toBe('EVENTS_SCREEN');
    location.hash = TOKEN_HASH;
    await vi.waitFor(() => expect(h1(root)).toBe('Choose a new password'));
    expect(location.href).not.toContain('secret');
    expect(location.hash).toBe('#/events');
  });

  it('an ordinary route in the address is left alone', async () => {
    const { root } = await start(fakeClient({ signedIn: true }), { hash: '#/events' });
    expect(h1(root)).toBe('EVENTS_SCREEN');
    expect(location.hash).toBe('#/events');
  });
});

describe('the recovery flow follows the session it needs', () => {
  it('Sign out while the new-password form is showing ends the flow: sign-in, not a form with no session behind it', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: TOKEN_HASH });
    expect(h1(root)).toBe('Choose a new password');
    const signOut = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Sign out',
    );
    signOut.click();
    await vi.waitFor(() => expect(h1(root)).toBe('Sign in'));
    expect(root.querySelector('[data-field="confirmation"]')).toBeNull();
  });

  it('the session ending somewhere else (another tab) does the same', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: TOKEN_HASH });
    expect(h1(root)).toBe('Choose a new password');
    await client.auth.signOut();
    await vi.waitFor(() => expect(h1(root)).toBe('Sign in'));
  });

  it('a stale sign-out from the client’s start-up (a revoked stored session) does not cost the person their link', async () => {
    const client = fakeClient({ staleSignedOutFirst: true });
    const { root } = await start(client, { hash: TOKEN_HASH });
    await settle();
    expect(h1(root)).toBe('Choose a new password');
    expect(root.querySelector('[data-field="confirmation"]')).not.toBeNull();
  });

  it('the authenticator screen is not swept away by the sign-out that the flow itself made', async () => {
    const client = fakeClient({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } });
    const { root } = await start(client, { hash: TOKEN_HASH });
    await settle();
    expect(h1(root)).toBe('This account has an authenticator app');
  });
});

describe('the address bar is read before the client is built', () => {
  it('a mountApp with no client of its own finds no token in the address when the client is made', async () => {
    clientBuilt.hashes.length = 0;
    clientBuilt.client = fakeClient();
    history.replaceState(null, '', `/app/${TOKEN_HASH}`);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = mountApp(root, { legacyAudienceOrgId: 'org1', legacyAudienceOrgSlug: null });
    await app.ready;
    activeApp = app;
    expect(clientBuilt.hashes).toEqual(['']);
  });
});

describe('forgot password', () => {
  it('is reachable by someone who is signed out, and is not the sign-in screen', async () => {
    const client = fakeClient();
    const { root } = await start(client, { hash: '#/forgot-password' });
    expect(h1(root)).toBe('Forgot your password?');
    expect(root.querySelector('[data-field="password"]')).toBeNull();
  });

  it('the sign-in screen links to it, and asking sends this console’s own address as the redirect', async () => {
    const client = fakeClient();
    const { root } = await start(client);
    expect(h1(root)).toBe('Sign in');
    const link = root.querySelector('a[href="#/forgot-password"]');
    location.hash = link.getAttribute('href');
    await vi.waitFor(() => expect(h1(root)).toBe('Forgot your password?'));
    const input = root.querySelector('[data-field="email"]');
    input.value = 'someone@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(h1(root)).toBe('Check your email'), { timeout: 3000 });
    expect(client.calls.reset).toEqual([
      { email: 'someone@example.com', options: { redirectTo: `${location.origin}/app/` } },
    ]);
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'If that address has an account, we sent a link.',
    );
  });
});

describe('change password', () => {
  it('is behind the sign-in gate', async () => {
    const { root } = await start(fakeClient(), { hash: '#/account/password' });
    expect(h1(root)).toBe('Sign in');
    expect(root.querySelector('[data-field="confirmation"]')).toBeNull();
  });

  it('is reached from the account area of the header and works for a signed-in person', async () => {
    const client = fakeClient({ signedIn: true });
    const { root } = await start(client, { hash: '#/events' });
    const link = root.querySelector('.app-shell-auth a[href="#/account/password"]');
    expect(link.textContent).toBe('Change password');
    location.hash = link.getAttribute('href');
    await vi.waitFor(() => expect(h1(root)).toBe('Change password'));
    await submitPasswords(root, 'another-password');
    expect(client.calls.updateUser).toEqual([
      { password: 'another-password', data: { must_change_password: false } },
    ]);
    expect(client.calls.signOut).toEqual([{ scope: 'others' }]);
    expect(h1(root)).toBe('Password changed');
  });

  it('choosing the password on the one-time screen clears the flag, so the console opens (the metadata really changes)', async () => {
    const client = fakeClient({ signedIn: true, userMetadata: { must_change_password: true } });
    const { root } = await start(client, { hash: '#/events' });
    expect(h1(root)).toBe('Choose your password');
    await submitPasswords(root);
    await vi.waitFor(() => expect(h1(root)).toBe('EVENTS_SCREEN'));
  });

  it('a person who still has a one-time password sees that screen first, not this one', async () => {
    const client = fakeClient({ signedIn: true, userMetadata: { must_change_password: true } });
    const { root } = await start(client, { hash: '#/account/password' });
    expect(h1(root)).toBe('Choose your password');
  });
});
