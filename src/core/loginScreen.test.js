import { describe, it, expect, vi } from 'vitest';
import { validateCredentials, renderLoginForm, mountLoginScreen } from './loginScreen.js';

describe('validateCredentials', () => {
  it('requires a non-blank email', () => {
    expect(validateCredentials({ email: '', password: 'x' })).toBe('Email is required.');
    expect(validateCredentials({ email: '   ', password: 'x' })).toBe('Email is required.');
  });

  it('requires a non-blank password', () => {
    expect(validateCredentials({ email: 'a@b.com', password: '' })).toBe('Password is required.');
  });

  it('is satisfied by both fields present', () => {
    expect(validateCredentials({ email: 'a@b.com', password: 'x' })).toBeNull();
  });
});

describe('renderLoginForm', () => {
  it('renders email and password fields plus a submit button', () => {
    const form = renderLoginForm({ email: '', password: '' }, { disabled: false });
    expect(form.querySelector('input[type="email"]')).not.toBeNull();
    expect(form.querySelector('input[type="password"]')).not.toBeNull();
    const button = form.querySelector('button[type="submit"]');
    expect(button.textContent).toBe('Sign in');
    expect(button.disabled).toBe(false);
  });

  it('disabled shows "Signing in…" and disables every field', () => {
    const form = renderLoginForm({ email: '', password: '' }, { disabled: true });
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Signing in…');
    expect(form.querySelector('input[type="email"]').disabled).toBe(true);
    expect(form.querySelector('input[type="password"]').disabled).toBe(true);
  });
});

function fakeClient({ signInResult, signInError } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      signInWithPassword: (creds) => {
        calls.push(creds);
        if (signInError) return Promise.resolve({ data: null, error: signInError });
        return Promise.resolve({ data: signInResult ?? { session: {} }, error: null });
      },
    },
  };
}

describe('mountLoginScreen', () => {
  it('renders the form', async () => {
    const root = document.createElement('div');
    await mountLoginScreen(root, { client: fakeClient() });
    expect(root.querySelector('form.login-form')).not.toBeNull();
    expect(root.querySelector('h1').textContent).toBe('Sign in');
  });

  it('a blank submit never calls the API', async () => {
    const root = document.createElement('div');
    const client = fakeClient();
    await mountLoginScreen(root, { client });

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls).toHaveLength(0);
    expect(root.querySelector('.screen-feedback').dataset.tone).toBe('error');
  });

  it('a successful sign-in calls signInWithPassword with the entered credentials and then onSignedIn()', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient();
    const onSignedIn = vi.fn();
    await mountLoginScreen(root, { client, onSignedIn });

    root.querySelector('[data-field="email"]').value = 'organiser@local.test';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="password"]').value = 'local-dev-password';
    root
      .querySelector('[data-field="password"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls).toEqual([
      { email: 'organiser@local.test', password: 'local-dev-password' },
    ]);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('trims the email before sending it, but not the password', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient();
    await mountLoginScreen(root, { client, onSignedIn: vi.fn() });

    root.querySelector('[data-field="email"]').value = '  organiser@local.test  ';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="password"]').value = 'local-dev-password';
    root
      .querySelector('[data-field="password"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls[0]).toEqual({
      email: 'organiser@local.test',
      password: 'local-dev-password',
    });
  });

  it('a failed sign-in shows the auth error message, re-enables the form, moves focus to the error, and never calls onSignedIn', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ signInError: { message: 'Invalid login credentials' } });
    const onSignedIn = vi.fn();
    await mountLoginScreen(root, { client, onSignedIn });

    root.querySelector('[data-field="email"]').value = 'organiser@local.test';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="password"]').value = 'wrong-password';
    root
      .querySelector('[data-field="password"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const feedback = root.querySelector('.screen-feedback');
    expect(feedback.textContent).toBe('Invalid login credentials');
    expect(feedback.dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback);
    expect(root.querySelector('button[type="submit"]').disabled).toBe(false);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('a thrown exception (network failure) shows a connection-style message rather than crashing', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = {
      auth: { signInWithPassword: () => Promise.reject(new Error('fetch failed')) },
    };
    await mountLoginScreen(root, { client, onSignedIn: vi.fn() });

    root.querySelector('[data-field="email"]').value = 'a@b.com';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="password"]').value = 'x';
    root
      .querySelector('[data-field="password"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.screen-feedback').textContent).toMatch(/check your connection/i);
  });

  it('the submit button is disabled while the sign-in request is in flight', async () => {
    let resolveSignIn;
    const client = {
      calls: [],
      auth: {
        signInWithPassword: (creds) => {
          client.calls.push(creds);
          return new Promise((resolve) => {
            resolveSignIn = () => resolve({ data: {}, error: null });
          });
        },
      },
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountLoginScreen(root, { client, onSignedIn: vi.fn() });

    root.querySelector('[data-field="email"]').value = 'a@b.com';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="password"]').value = 'x';
    root
      .querySelector('[data-field="password"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('button[type="submit"]').disabled).toBe(true);
    expect(root.querySelector('button[type="submit"]').textContent).toBe('Signing in…');

    resolveSignIn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('resolves to an object with a callable unmount()', async () => {
    const root = document.createElement('div');
    const handle = await mountLoginScreen(root, { client: fakeClient() });
    expect(typeof handle.unmount).toBe('function');
    expect(() => handle.unmount()).not.toThrow();
  });
});
