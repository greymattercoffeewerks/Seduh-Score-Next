import { describe, it, expect, vi } from 'vitest';
import {
  mountRecoveryScreen,
  LINK_INVALID_MESSAGE,
  LINK_UNREACHABLE_MESSAGE,
} from './recoveryScreen.js';
import { createRecoveryFlow } from './passwordRecovery.js';
import { AUTHENTICATOR_REQUIRED_MESSAGE, OTHERS_NOT_SIGNED_OUT_MESSAGE } from './passwordForm.js';

const tokenArrival = { kind: 'token', accessToken: 'AT-secret', refreshToken: 'RT-secret' };

function fakeClient({
  setSession = () => Promise.resolve({ data: { session: { user: {} } }, error: null }),
  aal = { currentLevel: 'aal1', nextLevel: 'aal1' },
  updateUser = () => Promise.resolve({ data: {}, error: null }),
  signOut = () => Promise.resolve({ error: null }),
} = {}) {
  return {
    auth: {
      setSession: vi.fn(setSession),
      updateUser: vi.fn(updateUser),
      signOut: vi.fn(signOut),
      mfa: { getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: aal, error: null }) },
    },
  };
}

async function mount(client, { arrival = tokenArrival, flow, ...extra } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const theFlow = flow ?? createRecoveryFlow({ client, arrival });
  const onFinished = vi.fn();
  const screen = mountRecoveryScreen(root, { flow: theFlow, onFinished, ...extra });
  return { root, flow: theFlow, onFinished, screen };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const heading = (root) => root.querySelector('h1').textContent;
function typeInto(root, field, value) {
  const input = root.querySelector(`[data-field="${field}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function submit(root) {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}
const button = (root, text) =>
  [...root.querySelectorAll('button, a')].find((n) => n.textContent === text);

describe('mountRecoveryScreen — a link that works', () => {
  it('says it is checking the link, then shows the new-password form with focus on its heading', async () => {
    let release;
    const client = fakeClient({
      setSession: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { session: { user: {} } }, error: null });
        }),
    });
    const { root } = await mount(client);
    expect(heading(root)).toBe('Checking your link…');
    expect(root.querySelector('[role="status"]').textContent).toBeTruthy();
    release();
    await settle();
    expect(heading(root)).toBe('Choose a new password');
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(root.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });

  it('saving signs out every OTHER session, then offers Continue; Continue leaves the flow and hands on to the console', async () => {
    const client = fakeClient();
    const { root, flow, onFinished } = await mount(client);
    await settle();
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(client.auth.updateUser).toHaveBeenCalledWith({
      password: 'correct-horse',
      data: { must_change_password: false },
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(heading(root)).toBe('Password changed');
    expect(root.textContent).toContain('your other devices were signed out');
    // the words of the result take focus (a screen reader reads them, including a warning that other devices stayed signed in)
    expect(document.activeElement).toBe(root.querySelector('[role="status"]'));
    expect(root.querySelector('form')).toBeNull();
    expect(onFinished).not.toHaveBeenCalled();
    button(root, 'Continue').click();
    expect(flow.isOpen()).toBe(false);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('a screen rebuilt after the save (the router resolves again) shows "Password changed", not a fresh form', async () => {
    const client = fakeClient();
    const first = await mount(client);
    await settle();
    typeInto(first.root, 'password', 'correct-horse');
    typeInto(first.root, 'confirmation', 'correct-horse');
    await submit(first.root);
    first.screen.unmount();
    const second = await mount(client, { flow: first.flow });
    await settle();
    expect(heading(second.root)).toBe('Password changed');
    expect(second.root.querySelector('form')).toBeNull();
    expect(client.auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('says so when the other devices could not be signed out (the password IS saved)', async () => {
    const client = fakeClient({ signOut: () => Promise.resolve({ error: { message: 'x' } }) });
    const { root } = await mount(client);
    await settle();
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(heading(root)).toBe('Password changed');
    expect(root.textContent).toContain(OTHERS_NOT_SIGNED_OUT_MESSAGE);
  });

  it('a refused password keeps the form, words the refusal for a current password, and signs nobody out', async () => {
    const client = fakeClient({
      updateUser: () =>
        Promise.resolve({ data: null, error: { code: 'same_password', message: 'raw' } }),
    });
    const { root } = await mount(client);
    await settle();
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(root.querySelector('.screen-feedback').textContent).toBe(
      'Choose a different password from your current one.',
    );
    expect(root.querySelector('form')).not.toBeNull();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('a second submit while the save is in flight saves once', async () => {
    let release;
    const client = fakeClient({
      updateUser: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    });
    const { root } = await mount(client);
    await settle();
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(root.querySelector('button[type="submit"]').textContent).toBe('Saving…');
    await submit(root);
    release();
    await settle();
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('mountRecoveryScreen — a link that does not work', () => {
  it('an expired or used link says so in words and offers a new request and the way back', async () => {
    const client = fakeClient({
      setSession: () =>
        Promise.resolve({ data: { session: null, user: null }, error: { status: 401 } }),
    });
    const { root, flow, onFinished } = await mount(client);
    await settle();
    expect(heading(root)).toBe('This link no longer works');
    expect(root.textContent).toContain(LINK_INVALID_MESSAGE);
    expect(root.querySelector('form')).toBeNull();
    const request = button(root, 'Request a new link');
    expect(request.getAttribute('href')).toBe('#/forgot-password');
    request.addEventListener('click', (event) => event.preventDefault());
    request.click();
    expect(flow.isOpen()).toBe(false);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('an error fragment in the address (no token at all) is the same screen, with no request made', async () => {
    const client = fakeClient();
    const { root } = await mount(client, { arrival: { kind: 'link_error' } });
    expect(heading(root)).toBe('This link no longer works');
    expect(client.auth.setSession).not.toHaveBeenCalled();
  });

  it('Back to sign in leaves the flow and hands on', async () => {
    const { root, flow, onFinished } = await mount(fakeClient(), {
      arrival: { kind: 'link_error' },
    });
    button(root, 'Back to sign in').click();
    expect(flow.isOpen()).toBe(false);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('no connection: says so, and Try again checks the same link again', async () => {
    let attempt = 0;
    const client = fakeClient({
      setSession: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve({ data: { session: { user: {} } }, error: null });
      },
    });
    const { root } = await mount(client);
    await settle();
    expect(heading(root)).toBe('Could not check your link');
    expect(root.textContent).toContain(LINK_UNREACHABLE_MESSAGE);
    button(root, 'Try again').click();
    await settle();
    expect(heading(root)).toBe('Choose a new password');
    expect(client.auth.setSession).toHaveBeenCalledTimes(2);
  });
});

describe('mountRecoveryScreen — an account with an authenticator app', () => {
  it('says so in plain words, shows no form that would fail, and ends the link’s session', async () => {
    const client = fakeClient({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } });
    const { root, onFinished } = await mount(client);
    await settle();
    expect(heading(root)).toBe('This account has an authenticator app');
    expect(root.textContent).toContain(AUTHENTICATOR_REQUIRED_MESSAGE);
    expect(root.textContent).toMatch(/Seduh Score team/);
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    button(root, 'Back to sign in').click();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});

describe('mountRecoveryScreen — lifecycle', () => {
  it('never writes to the page again once unmounted or aborted', async () => {
    let release;
    const client = fakeClient({
      setSession: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: { session: { user: {} } }, error: null });
        }),
    });
    const controller = new AbortController();
    const { root } = await mount(client, { signal: controller.signal });
    const before = root.innerHTML;
    controller.abort();
    release();
    await settle();
    expect(root.innerHTML).toBe(before);
  });

  it('unmount() is callable', async () => {
    const { screen } = await mount(fakeClient());
    expect(() => screen.unmount()).not.toThrow();
  });

  it('keeps the token out of the page', async () => {
    const { root } = await mount(fakeClient());
    await settle();
    expect(root.innerHTML).not.toContain('AT-secret');
    expect(document.body.innerHTML).not.toContain('AT-secret');
    expect(document.body.innerHTML).not.toContain('RT-secret');
  });
});
