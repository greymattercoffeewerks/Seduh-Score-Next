import { describe, it, expect, vi } from 'vitest';
import {
  validateCredentials,
  renderLoginForm,
  mountLoginScreen,
  isInvalidCredentials,
  INVALID_CREDENTIALS_MESSAGE,
} from './loginScreen.js';

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
    for (const field of [
      'input[type="email"]',
      'input[type="password"]',
      'button[type="submit"]',
    ]) {
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

    // type=email strips surrounding space on assignment (browsers and jsdom alike), which would hide
    // a missing .trim() — so the field is made a plain text box for this test.
    root.querySelector('[data-field="email"]').type = 'text';
    root.querySelector('[data-field="email"]').value = '  Organiser@Local.test  ';
    root.querySelector('[data-field="email"]').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-field="password"]').value = 'local-dev-password';
    root
      .querySelector('[data-field="password"]')
      .dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // trimmed, but sent in the case typed (the server compares case-insensitively)
    expect(client.calls[0]).toEqual({
      email: 'Organiser@Local.test',
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
    expect(feedback.textContent).toBe(INVALID_CREDENTIALS_MESSAGE);
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

// ---- 2026-10-07 hardening (live-event finding #2) ----

// A client whose signInWithPassword answers from a script, one answer per call, recording every call.
function scriptedClient(answers) {
  const calls = [];
  return {
    calls,
    auth: {
      signInWithPassword: (creds) => {
        calls.push(creds);
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
        return Promise.resolve(
          answer === 'ok' ? { data: { session: {} }, error: null } : { data: null, error: answer },
        );
      },
    },
  };
}
const BAD = { code: 'invalid_credentials', message: 'Invalid login credentials' };

async function mountAttached(client, onSignedIn = vi.fn()) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  await mountLoginScreen(root, { client, onSignedIn });
  return { root, onSignedIn };
}
function typeInto(root, field, value) {
  const input = root.querySelector(`[data-field="${field}"]`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function submit(root) {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('isInvalidCredentials', () => {
  it('recognises the error code, and the message for older supabase-js versions', () => {
    expect(isInvalidCredentials({ code: 'invalid_credentials', message: 'x' })).toBe(true);
    expect(isInvalidCredentials({ message: 'Invalid login credentials' })).toBe(true);
  });

  it('does not mistake any other failure for a wrong password', () => {
    expect(
      isInvalidCredentials({ code: 'email_not_confirmed', message: 'Email not confirmed' }),
    ).toBe(false);
    expect(isInvalidCredentials({ code: 'over_request_rate_limit', message: 'Too many' })).toBe(
      false,
    );
    expect(isInvalidCredentials(null)).toBe(false);
  });
});

describe('renderLoginForm — show/hide and iOS-friendly attributes', () => {
  it('hides the password by default, with a Show button', () => {
    const form = renderLoginForm({ email: '', password: 'secret' }, { disabled: false });
    expect(form.querySelector('[data-field="password"]').type).toBe('password');
    const toggle = form.querySelector('.password-toggle');
    expect(toggle.type).toBe('button'); // it must not submit the form
    expect(toggle.textContent).toBe('Show');
    expect(toggle.getAttribute('aria-label')).toBe('Show password');
    // A changing label OR aria-pressed, never both ("Hide password, pressed" is ambiguous).
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
  });

  it('shows the typed password as text, with a Hide button, when asked', () => {
    const form = renderLoginForm(
      { email: '', password: 'secret' },
      { disabled: false, showPassword: true },
    );
    const input = form.querySelector('[data-field="password"]');
    expect(input.type).toBe('text');
    expect(input.value).toBe('secret');
    const toggle = form.querySelector('.password-toggle');
    expect(toggle.textContent).toBe('Hide');
    expect(toggle.getAttribute('aria-label')).toBe('Hide password');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
  });

  it('tells iOS not to capitalise or autocorrect either field', () => {
    const form = renderLoginForm({ email: '', password: '' }, { disabled: false });
    for (const field of ['email', 'password']) {
      const input = form.querySelector(`[data-field="${field}"]`);
      expect(input.getAttribute('autocapitalize')).toBe('none');
      expect(input.getAttribute('autocorrect')).toBe('off');
      expect(input.getAttribute('spellcheck')).toBe('false');
    }
  });

  it('flips the field, the button and a polite status line in place, and tells the caller', () => {
    const onTogglePassword = vi.fn();
    const form = renderLoginForm(
      { email: '', password: '' },
      { disabled: false, onTogglePassword },
    );
    const input = form.querySelector('[data-field="password"]');
    const toggle = form.querySelector('.password-toggle');
    const status = form.querySelector('[role="status"]');
    const nodes = [input, toggle, status];
    input.value = 'typed';

    toggle.click();
    expect(input.type).toBe('text');
    expect(toggle.textContent).toBe('Hide');
    expect(toggle.getAttribute('aria-label')).toBe('Hide password');
    expect(status.textContent).toBe('Password is shown');
    expect(onTogglePassword).toHaveBeenLastCalledWith(true);

    toggle.click();
    expect(input.type).toBe('password');
    expect(toggle.textContent).toBe('Show');
    expect(toggle.getAttribute('aria-label')).toBe('Show password');
    expect(status.textContent).toBe('Password is hidden');
    expect(onTogglePassword).toHaveBeenLastCalledWith(false);

    // Nothing was rebuilt: the same nodes, so the value, caret and a screen reader's live region
    // all survive.
    // (toBe, not toEqual: toEqual compares DOM nodes structurally, so a clone would pass)
    expect(form.querySelector('[data-field="password"]')).toBe(nodes[0]);
    expect(form.querySelector('.password-toggle')).toBe(nodes[1]);
    expect(form.querySelector('[role="status"]')).toBe(nodes[2]);
    expect(input.value).toBe('typed');
  });
});

describe('mountLoginScreen — hardening', () => {
  it('toggling Show reveals the typed password, keeps it, keeps focus on the toggle, and does not sign in', async () => {
    const client = scriptedClient(['ok']);
    const { root } = await mountAttached(client);
    typeInto(root, 'password', 'Secret-1');
    root.querySelector('.password-toggle').focus();
    root.querySelector('.password-toggle').click();
    const input = root.querySelector('[data-field="password"]');
    expect(input.type).toBe('text');
    expect(input.value).toBe('Secret-1');
    expect(document.activeElement).toBe(root.querySelector('.password-toggle'));
    expect(client.calls).toHaveLength(0);
    root.querySelector('.password-toggle').click();
    expect(root.querySelector('[data-field="password"]').type).toBe('password');
    expect(root.querySelector('[data-field="password"]').value).toBe('Secret-1');
  });

  it('keeps the password visible after a failed attempt, so it can be checked and corrected', async () => {
    const { root } = await mountAttached(scriptedClient([BAD]));
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', 'wrong');
    root.querySelector('.password-toggle').click();
    await submit(root);
    expect(root.querySelector('[data-field="password"]').type).toBe('text');
    expect(root.querySelector('[data-field="password"]').value).toBe('wrong');
  });

  it('submits what the fields show even when no input event reported it (iOS autofill)', async () => {
    const client = scriptedClient(['ok']);
    const { root } = await mountAttached(client);
    root.querySelector('[data-field="email"]').value = 'autofilled@example.com';
    root.querySelector('[data-field="password"]').value = 'autofilled-secret';
    await submit(root); // no input event was ever dispatched
    expect(client.calls).toEqual([
      { email: 'autofilled@example.com', password: 'autofilled-secret' },
    ]);
  });

  it('also follows a change event (how autofill usually reports itself)', async () => {
    const root = document.createElement('div');
    const draft = { email: '', password: '' };
    const form = renderLoginForm(draft, { disabled: false });
    root.appendChild(form);
    const email = form.querySelector('[data-field="email"]');
    email.value = 'a@b.com';
    email.dispatchEvent(new Event('change', { bubbles: true }));
    const password = form.querySelector('[data-field="password"]');
    password.value = 'pw';
    password.dispatchEvent(new Event('change', { bubbles: true }));
    expect(draft).toEqual({ email: 'a@b.com', password: 'pw' });
  });

  it('tries a password exactly as typed first, then once more without surrounding space if that was refused', async () => {
    const client = scriptedClient([BAD, 'ok']);
    const { root, onSignedIn } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', '  Secret-1 ');
    await submit(root);
    expect(client.calls).toEqual([
      { email: 'a@b.com', password: '  Secret-1 ' },
      { email: 'a@b.com', password: 'Secret-1' },
    ]);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('a password that really contains the spaces still works on the first try — nothing is trimmed up front', async () => {
    const client = scriptedClient(['ok']);
    const { root, onSignedIn } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', ' spaced password ');
    await submit(root);
    expect(client.calls).toEqual([{ email: 'a@b.com', password: ' spaced password ' }]);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('does not retry a password with no surrounding space', async () => {
    const client = scriptedClient([BAD]);
    const { root } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', 'wrong');
    await submit(root);
    expect(client.calls).toHaveLength(1);
  });

  it('does not retry a refusal that is not a wrong password (rate limit, unconfirmed email)', async () => {
    const client = scriptedClient([
      { code: 'over_request_rate_limit', message: 'Too many requests' },
    ]);
    const { root } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', ' pw ');
    await submit(root);
    expect(client.calls).toHaveLength(1);
    expect(root.querySelector('.screen-feedback').textContent).toBe('Too many requests');
  });

  it('does not retry an all-space password with an empty one', async () => {
    const client = scriptedClient([BAD]);
    const { root } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', '   ');
    await submit(root);
    expect(client.calls).toEqual([{ email: 'a@b.com', password: '   ' }]);
  });

  it('when both tries are refused, says so once, in words about what to check, and stays signed out', async () => {
    const client = scriptedClient([BAD, BAD]);
    const { root, onSignedIn } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', ' wrong ');
    await submit(root);
    expect(client.calls).toHaveLength(2);
    expect(root.querySelector('.screen-feedback').textContent).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(onSignedIn).not.toHaveBeenCalled();
    // what was typed stays exactly as typed (the retry's trimmed copy never lands in the box)
    expect(root.querySelector('[data-field="password"]').value).toBe(' wrong ');
  });

  it('the wrong-password message is not the bare API text, and points at the Show/Hide button', () => {
    expect(INVALID_CREDENTIALS_MESSAGE).not.toMatch(/^invalid login credentials$/i);
    expect(INVALID_CREDENTIALS_MESSAGE).toMatch(/Show\/Hide/);
  });

  it('shows any other sign-in error exactly as the API words it', async () => {
    const { root } = await mountAttached(
      scriptedClient([{ code: 'email_not_confirmed', message: 'Email not confirmed' }]),
    );
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', 'pw');
    await submit(root);
    expect(root.querySelector('.screen-feedback').textContent).toBe('Email not confirmed');
  });
});

describe('mountLoginScreen — show/hide does not redraw the screen', () => {
  it('keeps an email that autofill never reported, and the error message, when Show is tapped', async () => {
    const client = scriptedClient([BAD]);
    const { root } = await mountAttached(client);
    root.querySelector('[data-field="email"]').value = 'autofilled@example.com';
    root.querySelector('[data-field="password"]').value = 'wrong';
    await submit(root);
    expect(root.querySelector('.screen-feedback').textContent).toBe(INVALID_CREDENTIALS_MESSAGE);

    // iOS fills the email again without an event, then the user taps Show.
    root.querySelector('[data-field="email"]').value = 'other@example.com';
    root.querySelector('.password-toggle').click();

    expect(root.querySelector('[data-field="email"]').value).toBe('other@example.com');
    expect(root.querySelector('.screen-feedback').textContent).toBe(INVALID_CREDENTIALS_MESSAGE);
  });

  it('remembers the choice through the busy re-render of a sign-in', async () => {
    const client = scriptedClient([BAD]);
    const { root } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', 'wrong');
    root.querySelector('.password-toggle').click(); // shown
    await submit(root); // the screen is rebuilt twice (busy, then the error)
    expect(root.querySelector('[data-field="password"]').type).toBe('text');
    expect(root.querySelector('.password-toggle').textContent).toBe('Hide');
  });

  it('retries the password that was submitted, not whatever was typed while the request was in flight', async () => {
    const calls = [];
    let release;
    const client = {
      auth: {
        signInWithPassword: (creds) => {
          calls.push(creds);
          if (calls.length === 1) {
            return new Promise((resolve) => {
              release = () => resolve({ data: null, error: BAD });
            });
          }
          return Promise.resolve({ data: { session: {} }, error: null });
        },
      },
    };
    const { root } = await mountAttached(client);
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', '  pw ');
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    typeInto(root, 'password', 'pw'); // edited, while the first request is out, to the trimmed value
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.map((c) => c.password)).toEqual(['  pw ', 'pw']);
  });

  it('does not fire the retry once the screen has been left', async () => {
    const calls = [];
    const controller = new AbortController();
    const client = {
      auth: {
        signInWithPassword: (creds) => {
          calls.push(creds);
          controller.abort(); // the router navigated away while the first request was out
          return Promise.resolve({ data: null, error: BAD });
        },
      },
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    await mountLoginScreen(root, { client, onSignedIn: vi.fn(), signal: controller.signal });
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', ' pw ');
    await submit(root);
    expect(calls).toHaveLength(1);
  });
});

describe('mountLoginScreen — retry and attribute contracts', () => {
  it('retries when only the error code says wrong password, or only the message does (older supabase-js)', async () => {
    for (const first of [
      { code: 'invalid_credentials' },
      { message: 'Invalid login credentials' },
    ]) {
      const client = scriptedClient([first, 'ok']);
      const { root } = await mountAttached(client);
      typeInto(root, 'email', 'a@b.com');
      typeInto(root, 'password', ' pw ');
      await submit(root);
      expect(client.calls).toHaveLength(2);
    }
  });

  it('the retry has the same timeout as the first try: a hung retry ends in the connection message, not "Signing in…" forever', async () => {
    vi.useFakeTimers();
    try {
      const calls = [];
      const client = {
        auth: {
          signInWithPassword: (creds) => {
            calls.push(creds);
            return calls.length === 1
              ? Promise.resolve({ data: null, error: BAD })
              : new Promise(() => {}); // never settles
          },
        },
      };
      const root = document.createElement('div');
      document.body.appendChild(root);
      await mountLoginScreen(root, { client, onSignedIn: vi.fn() });
      typeInto(root, 'email', 'a@b.com');
      typeInto(root, 'password', ' pw ');
      root
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(10001);
      expect(calls).toHaveLength(2);
      expect(root.querySelector('.screen-feedback').textContent).toMatch(/taking longer/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembers Show then Hide through the sign-in re-renders: back to hidden', async () => {
    const { root } = await mountAttached(scriptedClient([BAD]));
    typeInto(root, 'email', 'a@b.com');
    typeInto(root, 'password', 'wrong');
    root.querySelector('.password-toggle').click(); // shown
    root.querySelector('.password-toggle').click(); // hidden again
    await submit(root);
    expect(root.querySelector('[data-field="password"]').type).toBe('password');
    expect(root.querySelector('.password-toggle').textContent).toBe('Show');
  });

  it('keeps the attributes iOS Keychain needs to offer the saved login, and requires both fields', () => {
    const form = renderLoginForm({ email: '', password: '' }, { disabled: false });
    const email = form.querySelector('[data-field="email"]');
    const password = form.querySelector('[data-field="password"]');
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(email.required).toBe(true);
    expect(password.required).toBe(true);
  });

  it('follows typing as well as change events', () => {
    const draft = { email: '', password: '' };
    const form = renderLoginForm(draft, { disabled: false });
    const email = form.querySelector('[data-field="email"]');
    const password = form.querySelector('[data-field="password"]');
    email.value = 'a@b.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'pw';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    expect(draft).toEqual({ email: 'a@b.com', password: 'pw' });
  });
});
