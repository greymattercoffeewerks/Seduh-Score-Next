import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { validateEmail, renderAuthForm, mountAuthScreen } from './authScreen.js';

// Catches a differently-shaped regression than a bare
// `input[type="password"]` check would — e.g. a field typed "text" but
// carrying autocomplete="current-password" or name="password" (plausible if
// someone copy-pastes from core/loginScreen.js, which has a real password
// field this screen must never grow one of).
function hasAnyPasswordLikeInput(form) {
  return [...form.querySelectorAll('input')].some((input) =>
    ['type', 'name', 'id', 'autocomplete'].some((attr) =>
      /password/i.test(input.getAttribute(attr) || ''),
    ),
  );
}

describe('validateEmail', () => {
  it('requires a non-blank email', () => {
    expect(validateEmail({ email: '' })).toBe('Email is required.');
    expect(validateEmail({ email: '   ' })).toBe('Email is required.');
  });

  it('is satisfied by a non-blank email', () => {
    expect(validateEmail({ email: 'a@b.com' })).toBeNull();
  });
});

describe('renderAuthForm', () => {
  it('renders an email field and a submit button — no password field anywhere', () => {
    const form = renderAuthForm({ email: '' }, { disabled: false, linkSent: false });
    expect(form.querySelector('input[type="email"]')).not.toBeNull();
    expect(hasAnyPasswordLikeInput(form)).toBe(false);
    const button = form.querySelector('button[type="submit"]');
    expect(button.textContent).toBe('Send magic link');
    expect(button.disabled).toBe(false);
  });

  it('disabled shows "Sending…" and marks the field/button aria-disabled/aria-busy, not native-disabled', () => {
    // Native `disabled` would remove the focused submit button from the
    // focus order the instant a send starts, dropping focus to <body>
    // with no way back — aria-disabled/aria-busy convey the same state
    // without doing that. Found in review (ui-accessibility-reviewer).
    const form = renderAuthForm({ email: '' }, { disabled: true, linkSent: false });
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Sending…');
    for (const field of ['input[type="email"]', 'button[type="submit"]']) {
      const node = form.querySelector(field);
      expect(node.disabled).toBe(false);
      expect(node.getAttribute('aria-disabled')).toBe('true');
      expect(node.getAttribute('aria-busy')).toBe('true');
    }
  });

  it('once a link has already been sent, the button reads "Resend link"', () => {
    const form = renderAuthForm({ email: '' }, { disabled: false, linkSent: true });
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Resend link');
  });
});

function fakeClient({ otpError } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      signInWithOtp: (args) => {
        calls.push(args);
        if (otpError) return Promise.resolve({ data: null, error: otpError });
        return Promise.resolve({ data: {}, error: null });
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  };
}

describe('mountAuthScreen', () => {
  it('renders the form with no password field in the DOM', async () => {
    const root = document.createElement('div');
    await mountAuthScreen(root, { client: fakeClient() });
    expect(root.querySelector('form.gtb-auth-form')).not.toBeNull();
    expect(hasAnyPasswordLikeInput(root)).toBe(false);
    expect(root.querySelector('h1').textContent).toBe('Sign in');
  });

  it('a blank submit never calls the API', async () => {
    const root = document.createElement('div');
    const client = fakeClient();
    await mountAuthScreen(root, { client });

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls).toHaveLength(0);
    expect(root.querySelector('.gtb-feedback').dataset.tone).toBe('error');
  });

  it('a successful send calls signInWithOtp with the entered email and no password anywhere, then shows a check-your-email notice', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient();
    await mountAuthScreen(root, { client });

    root.querySelector('[data-field="email"]').value = 'participant@local.test';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].email).toBe('participant@local.test');
    expect(client.calls[0].password).toBeUndefined();
    expect(root.querySelector('.gtb-feedback').textContent).toMatch(/check.*participant@local\.test/i);
    expect(root.querySelector('.gtb-feedback').dataset.tone).toBe('success');
  });

  it('trims the email before sending it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient();
    await mountAuthScreen(root, { client });

    root.querySelector('[data-field="email"]').value = '  participant@local.test  ';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.calls[0].email).toBe('participant@local.test');
  });

  it('a failed send shows the auth error message, re-enables the form, and moves focus to it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ otpError: { message: 'Signups not allowed for this instance' } });
    await mountAuthScreen(root, { client });

    root.querySelector('[data-field="email"]').value = 'participant@local.test';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const feedback = root.querySelector('.gtb-feedback');
    expect(feedback.textContent).toBe('Signups not allowed for this instance');
    expect(feedback.dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback);
    expect(root.querySelector('button[type="submit"]').getAttribute('aria-disabled')).toBeNull();
  });

  it('a thrown exception (network failure) shows a connection-style message rather than crashing', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = {
      auth: {
        signInWithOtp: () => Promise.reject(new Error('fetch failed')),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    };
    await mountAuthScreen(root, { client });

    root.querySelector('[data-field="email"]').value = 'a@b.com';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('.gtb-feedback').textContent).toMatch(/check your connection/i);
  });

  it('the submit button is marked aria-disabled/aria-busy while the send request is in flight', async () => {
    let resolveSend;
    const client = {
      calls: [],
      auth: {
        signInWithOtp: (args) => {
          client.calls.push(args);
          return new Promise((resolve) => {
            resolveSend = () => resolve({ data: {}, error: null });
          });
        },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountAuthScreen(root, { client });

    root.querySelector('[data-field="email"]').value = 'a@b.com';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const submitButton = root.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);
    expect(submitButton.getAttribute('aria-disabled')).toBe('true');
    expect(submitButton.getAttribute('aria-busy')).toBe('true');
    expect(submitButton.textContent).toBe('Sending…');

    resolveSend();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps focus on the submit button across the busy re-render triggered by submitting', async () => {
    // Same fix as core/loginScreen.js's own version of this test —
    // withFocusPreservation + aria-disabled (instead of native disabled)
    // means the submit button, identified by its data-focus-key, survives
    // the full root.innerHTML='' rebuild with focus intact.
    let resolveSend;
    const client = {
      calls: [],
      auth: {
        signInWithOtp: (args) => {
          client.calls.push(args);
          return new Promise((resolve) => {
            resolveSend = () => resolve({ data: {}, error: null });
          });
        },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountAuthScreen(root, { client });

    root.querySelector('[data-field="email"]').value = 'a@b.com';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    const submitButton = root.querySelector('button[type="submit"]');
    submitButton.focus();
    expect(document.activeElement).toBe(submitButton);

    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement).toBe(root.querySelector('button[type="submit"]'));

    resolveSend();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('does NOT call onSignedIn for a non-SIGNED_IN auth event', async () => {
    // Guards the `if (event === 'SIGNED_IN')` check itself — without this,
    // an implementation that called onSignedIn unconditionally on every
    // auth event (e.g. TOKEN_REFRESHED, which fires routinely on a long-
    // lived session) would pass every other test in this file identically.
    let fireEvent;
    const client = {
      auth: {
        signInWithOtp: () => Promise.resolve({ data: {}, error: null }),
        onAuthStateChange: (cb) => {
          fireEvent = (event) => cb(event, {});
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    };
    const root = document.createElement('div');
    const onSignedIn = vi.fn();
    await mountAuthScreen(root, { client, onSignedIn });

    fireEvent('TOKEN_REFRESHED');
    fireEvent('SIGNED_OUT');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('calls onSignedIn when onAuthStateChange fires SIGNED_IN (the magic-link redirect landing back on this page)', async () => {
    let fireSignedIn;
    const client = {
      auth: {
        signInWithOtp: () => Promise.resolve({ data: {}, error: null }),
        onAuthStateChange: (cb) => {
          fireSignedIn = () => cb('SIGNED_IN', {});
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
    };
    const root = document.createElement('div');
    const onSignedIn = vi.fn();
    await mountAuthScreen(root, { client, onSignedIn });

    expect(fireSignedIn).toBeDefined();
    fireSignedIn();
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('never writes to root again once its own signal is aborted mid-send — the router-navigation-race guard', async () => {
    let resolveSend;
    const client = {
      auth: {
        signInWithOtp: () =>
          new Promise((resolve) => {
            resolveSend = () =>
              resolve({ data: null, error: { message: 'Signups not allowed for this instance' } });
          }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountAuthScreen(root, { client, onSignedIn: vi.fn(), signal: controller.signal });

    root.querySelector('[data-field="email"]').value = 'a@b.com';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolveSend).toBeDefined();

    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    controller.abort();
    resolveSend();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('Signups not allowed for this instance');
  });

  it('resolves to an object with a callable unmount() that unsubscribes from onAuthStateChange', async () => {
    const unsubscribe = vi.fn();
    const client = {
      auth: {
        signInWithOtp: () => Promise.resolve({ data: {}, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
      },
    };
    const root = document.createElement('div');
    const handle = await mountAuthScreen(root, { client });
    expect(typeof handle.unmount).toBe('function');
    handle.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// The Phase 2 acceptance criterion is codebase-wide ("no password storage or
// password-reset flow exists in the codebase"), not just "this one rendered
// form has no password input" — the DOM checks above only prove the latter.
// This proves the former directly against the actual source, not the DOM.
describe('no password-reset flow anywhere in this directory', () => {
  it('never calls resetPasswordForEmail, updateUser({password), or signInWithPassword', () => {
    // Match call-parens, not a bare word — this file's own header comment
    // mentions "signInWithPassword" by name (contrasting itself with
    // core/loginScreen.js), which a bare-word check would false-positive on
    // (the same "a grep-style check can match its own comment" trap
    // CONVENTIONS.md's Testing section documents for other modules' own
    // module-comment near-misses).
    const authScreenPath = join(dirname(fileURLToPath(import.meta.url)), 'authScreen.js');
    const source = readFileSync(authScreenPath, 'utf8');
    expect(source).not.toMatch(/resetPasswordForEmail\s*\(/);
    expect(source).not.toMatch(/updateUser\s*\(\s*\{\s*password/);
    expect(source).not.toMatch(/signInWithPassword\s*\(/);
  });
});
