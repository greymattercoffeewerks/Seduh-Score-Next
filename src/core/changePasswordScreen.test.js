import { describe, it, expect, vi } from 'vitest';
import { mountChangePasswordScreen } from './changePasswordScreen.js';
import { AUTHENTICATOR_REQUIRED_MESSAGE, OTHERS_NOT_SIGNED_OUT_MESSAGE } from './passwordForm.js';

function fakeClient({
  aal = { currentLevel: 'aal1', nextLevel: 'aal1' },
  updateUser = () => Promise.resolve({ data: {}, error: null }),
  signOut = () => Promise.resolve({ error: null }),
} = {}) {
  return {
    auth: {
      updateUser: vi.fn(updateUser),
      signOut: vi.fn(signOut),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(() => Promise.resolve({ data: aal, error: null })),
      },
    },
  };
}
async function mount(client, extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const screen = await mountChangePasswordScreen(root, { client, ...extra });
  return { root, screen };
}
function typeInto(root, field, value) {
  const input = root.querySelector(`[data-field="${field}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const CURRENT = 'current-pass-1';
// Fills the current-password box (the project requires it) unless a test is about that box being empty.
async function submit(root, { fillCurrent = true } = {}) {
  const box = root.querySelector('[data-field="current"]');
  if (fillCurrent && box && !box.value) typeInto(root, 'current', CURRENT);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const feedback = (root) => root.querySelector('.screen-feedback');

describe('mountChangePasswordScreen', () => {
  it('shows a heading that takes focus and a new-password form with Show/Hide, asking twice', async () => {
    const { root } = await mount(fakeClient());
    expect(root.querySelector('h1').textContent).toBe('Change password');
    expect(document.activeElement).toBe(root.querySelector('h1'));
    const inputs = root.querySelectorAll('input[autocomplete="new-password"]');
    expect(inputs).toHaveLength(2);
    expect(root.querySelector('.password-toggle')).not.toBeNull();
    expect(root.querySelector('a[href="#/events"]').textContent).toBe('Cancel');
  });

  it('every field’s accessible name contains its visible label (speech input says what it sees)', async () => {
    const { root } = await mount(fakeClient());
    const fields = [...root.querySelectorAll('.form-field')];
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const field of fields) {
      const visible = field.querySelector('.form-field-label').textContent;
      const name = field.querySelector('input').getAttribute('aria-label');
      expect(name, visible).toContain(visible);
    }
  });

  it('asks for the current password first (the project requires it), twice-confirming the new one', async () => {
    const { root } = await mount(fakeClient());
    const inputs = [...root.querySelectorAll('input')];
    expect(inputs.map((i) => i.dataset.field)).toEqual(['current', 'password', 'confirmation']);
    expect(inputs[0].getAttribute('autocomplete')).toBe('current-password');
    expect(inputs[0].getAttribute('aria-label')).toBe('Current password');
  });

  it('an empty current password is said before any request', async () => {
    const client = fakeClient();
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root, { fillCurrent: false });
    expect(feedback(root).textContent).toBe('Enter your current password.');
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it.each(['current_password_required', 'current_password_mismatch'])(
    '%s is worded as a wrong current password, not "try again"',
    async (code) => {
      const client = fakeClient({
        updateUser: () => Promise.resolve({ data: null, error: { code, message: 'raw' } }),
      });
      const { root } = await mount(client);
      typeInto(root, 'password', 'correct-horse');
      typeInto(root, 'confirmation', 'correct-horse');
      await submit(root);
      expect(feedback(root).textContent).toBe('That is not your current password.');
      expect(client.auth.signOut).not.toHaveBeenCalled();
    },
  );

  it('saves, clears the one-time flag in the same call, signs out the OTHER sessions, and says so', async () => {
    const client = fakeClient();
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(client.auth.updateUser).toHaveBeenCalledWith({
      password: 'correct-horse',
      current_password: CURRENT,
      data: { must_change_password: false },
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(root.querySelector('h1').textContent).toBe('Password changed');
    expect(root.textContent).toContain('your other devices were signed out');
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('[role="status"]')).not.toBeNull();
    // the result's words take focus, so a screen reader reads them and not just the heading
    expect(document.activeElement).toBe(root.querySelector('[role="status"]'));
    expect(root.querySelector('a[href="#/events"]').textContent).toBe('Back to events');
  });

  it('says so when the other devices could not be signed out', async () => {
    const { root } = await mount(
      fakeClient({ signOut: () => Promise.resolve({ error: { message: 'x' } }) }),
    );
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(root.querySelector('h1').textContent).toBe('Password changed');
    expect(root.textContent).toContain(OTHERS_NOT_SIGNED_OUT_MESSAGE);
  });

  it.each([
    ['nothing typed', '', '', 'Choose a password.'],
    ['too short', 'short', 'short', 'Use at least 12 characters.'],
    [
      'two different passwords',
      'correct-horse',
      'correct-horsf',
      'The two passwords do not match.',
    ],
  ])('%s: says so and never calls the API', async (_label, a, b, message) => {
    const client = fakeClient();
    const { root } = await mount(client);
    typeInto(root, 'password', a);
    typeInto(root, 'confirmation', b);
    await submit(root);
    expect(feedback(root).textContent).toBe(message);
    expect(document.activeElement).toBe(feedback(root));
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('same password as now: says to choose a different one from the current password (not "one-time")', async () => {
    const client = fakeClient({
      updateUser: () => Promise.resolve({ data: null, error: { code: 'same_password' } }),
    });
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(feedback(root).textContent).toBe('Choose a different password from your current one.');
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('a refusal for lack of an authenticator code is worded, not raw', async () => {
    const client = fakeClient({
      updateUser: () =>
        Promise.resolve({ data: null, error: { code: 'insufficient_aal', message: 'raw' } }),
    });
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(feedback(root).textContent).toBe(AUTHENTICATOR_REQUIRED_MESSAGE);
  });

  it('an account with an authenticator app is told so BEFORE any form, and nothing is sent', async () => {
    const client = fakeClient({ aal: { currentLevel: 'aal1', nextLevel: 'aal2' } });
    const { root } = await mount(client);
    expect(root.textContent).toContain(AUTHENTICATOR_REQUIRED_MESSAGE);
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('h1'));
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it('a session that has already passed the second factor gets the form', async () => {
    const { root } = await mount(fakeClient({ aal: { currentLevel: 'aal2', nextLevel: 'aal2' } }));
    expect(root.querySelector('form')).not.toBeNull();
  });

  it('a network failure says so and leaves the form usable', async () => {
    const client = fakeClient({
      updateUser: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(feedback(root).textContent).toBe(
      'Could not save your password — check your connection and try again.',
    );
    expect(root.querySelector('button[type="submit"]').getAttribute('aria-disabled')).toBeNull();
  });

  it('a save that never settles ends in the timeout message', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient({ updateUser: () => new Promise(() => {}) });
      const { root } = await mount(client);
      typeInto(root, 'current', CURRENT);
      typeInto(root, 'password', 'correct-horse');
      typeInto(root, 'confirmation', 'correct-horse');
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(10001);
      expect(feedback(root).textContent).toMatch(/taking longer than expected/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stalled authenticator check does not leave the screen blank: the heading is up at once and the form follows the timeout', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient();
      client.auth.mfa.getAuthenticatorAssuranceLevel = vi.fn(() => new Promise(() => {}));
      const root = document.createElement('div');
      document.body.appendChild(root);
      const mounting = mountChangePasswordScreen(root, { client });
      await vi.advanceTimersByTimeAsync(0);
      expect(root.querySelector('h1').textContent).toBe('Change password');
      expect(root.querySelector('form')).toBeNull();
      await vi.advanceTimersByTimeAsync(10001);
      await mounting;
      expect(root.querySelector('h1').textContent).toBe('Change password');
      expect(root.querySelector('form')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a double submit saves once, with a busy state', async () => {
    let release;
    const client = fakeClient({
      updateUser: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    });
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    const saveButton = root.querySelector('button[type="submit"]');
    expect(saveButton.textContent).toBe('Saving…');
    expect(saveButton.getAttribute('aria-disabled')).toBe('true');
    await submit(root);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.auth.updateUser).toHaveBeenCalledTimes(1);
  });

  it('never writes to the page once its signal is aborted', async () => {
    let release;
    const controller = new AbortController();
    const client = fakeClient({
      updateUser: () =>
        new Promise((resolve) => {
          release = () => resolve({ data: {}, error: null });
        }),
    });
    const { root } = await mount(client, { signal: controller.signal });
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    const before = root.innerHTML;
    controller.abort();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.innerHTML).toBe(before);
  });

  it('resolves to an object with a callable unmount()', async () => {
    const { screen } = await mount(fakeClient());
    expect(() => screen.unmount()).not.toThrow();
  });
});
