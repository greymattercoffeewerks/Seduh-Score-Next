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

  it('disabled shows "Signing in…" and marks every field aria-disabled/aria-busy, not native-disabled', () => {
    // Native `disabled` removes an element from the focus order the
    // instant it's set — if the field that state applies to currently HAS
    // focus (e.g. the submit button mid-click), that drops focus to
    // <body> with no way back. aria-disabled/aria-busy convey the same
    // "unavailable, in progress" state to assistive tech without doing
    // that. Found in review (ui-accessibility-reviewer).
    const form = renderLoginForm({ email: '', password: '' }, { disabled: true });
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Signing in…');
    for (const field of ['input[type="email"]', 'input[type="password"]', 'button[type="submit"]']) {
      const node = form.querySelector(field);
      expect(node.disabled).toBe(false);
      expect(node.getAttribute('aria-disabled')).toBe('true');
      expect(node.getAttribute('aria-busy')).toBe('true');
    }
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
    expect(root.querySelector('button[type="submit"]').getAttribute('aria-disabled')).toBeNull();
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

  it('the submit button is marked aria-disabled/aria-busy while the sign-in request is in flight', async () => {
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

    const submitButton = root.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.getAttribute('aria-disabled')).toBe('true');
    expect(submitButton.getAttribute('aria-busy')).toBe('true');
    expect(submitButton.textContent).toBe('Signing in…');

    resolveSignIn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps focus on the submit button across the busy re-render triggered by submitting', async () => {
    // The specific bug this task closes: root.innerHTML='' on every
    // render() destroys the previously-focused node outright, and a
    // native `disabled` attribute on the new one would make it
    // unfocusable even if something tried to restore focus. With
    // aria-disabled instead, plus core/dom.js's withFocusPreservation,
    // the submit button (identified by its stable data-focus-key) should
    // still hold focus after the busy re-render, not <body>.
    let resolveSignIn;
    const client = {
      auth: {
        signInWithPassword: () =>
          new Promise((resolve) => {
            resolveSignIn = () => resolve({ data: {}, error: null });
          }),
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
    const submitButton = root.querySelector('button[type="submit"]');
    submitButton.focus();
    expect(document.activeElement).toBe(submitButton);

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(root.querySelector('button[type="submit"]'));

    resolveSignIn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('never writes to root again once its own signal is aborted mid-signIn — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): a signIn attempt is still in flight when the router (in
    // production) decides a newer navigation has superseded this screen and
    // aborts its signal, well before this screen's own handleSubmit
    // continuation gets a chance to run.
    let resolveSignIn;
    const client = {
      auth: {
        signInWithPassword: () =>
          new Promise((resolve) => {
            resolveSignIn = () =>
              resolve({ data: null, error: { message: 'Invalid login credentials' } });
          }),
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountLoginScreen(root, { client, onSignedIn: vi.fn(), signal: controller.signal });

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
    expect(resolveSignIn).toBeDefined();

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-signing-in screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    controller.abort();
    resolveSignIn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own error re-render.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('Invalid login credentials');
  });

  it('resolves to an object with a callable unmount()', async () => {
    const root = document.createElement('div');
    const handle = await mountLoginScreen(root, { client: fakeClient() });
    expect(typeof handle.unmount).toBe('function');
    expect(() => handle.unmount()).not.toThrow();
  });
});
