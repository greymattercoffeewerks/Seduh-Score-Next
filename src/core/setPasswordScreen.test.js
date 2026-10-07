import { describe, it, expect, vi } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
  describePasswordError,
  renderSetPasswordForm,
  mountSetPasswordScreen,
} from './setPasswordScreen.js';

describe('validateNewPassword', () => {
  it('needs a password', () => {
    expect(validateNewPassword('', '')).toBe('Choose a password.');
  });

  it('needs the minimum length, and counts exactly at it as long enough', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(validateNewPassword('1234567', '1234567')).toBe('Use at least 8 characters.');
    expect(validateNewPassword('12345678', '12345678')).toBeNull();
  });

  it('needs both boxes to agree, exactly', () => {
    expect(validateNewPassword('correct-horse', 'correct-horsE')).toBe(
      'The two passwords do not match.',
    );
    expect(validateNewPassword('correct-horse', 'correct-horse ')).toBe(
      'The two passwords do not match.',
    );
    expect(validateNewPassword('correct-horse', 'correct-horse')).toBeNull();
  });

  it('does not trim: a password may contain spaces', () => {
    expect(validateNewPassword(' spaced out ', ' spaced out ')).toBeNull();
  });
});

describe('describePasswordError', () => {
  it('says what to do when the new password equals the one-time one', () => {
    expect(describePasswordError({ code: 'same_password', message: 'raw' })).toBe(
      'Choose a different password from the one-time password you were given.',
    );
  });

  it('says what to do about a weak password', () => {
    expect(describePasswordError({ code: 'weak_password', message: 'raw' })).toMatch(
      /too easy to guess/,
    );
  });

  it('shows any other API message as it is, and has a fallback', () => {
    expect(describePasswordError({ message: 'Some other API words' })).toBe('Some other API words');
    expect(describePasswordError({})).toBe('Could not save your password. Try again.');
    expect(describePasswordError(null)).toBe('Could not save your password. Try again.');
  });
});

describe('renderSetPasswordForm', () => {
  const draft = () => ({ password: '', confirmation: '' });

  it('has a new-password and a confirm box, asks the browser to offer a NEW password, and requires both', () => {
    const form = renderSetPasswordForm(draft(), { disabled: false });
    for (const field of ['password', 'confirmation']) {
      const input = form.querySelector(`[data-field="${field}"]`);
      expect(input.type).toBe('password');
      expect(input.getAttribute('autocomplete')).toBe('new-password');
      expect(input.getAttribute('autocapitalize')).toBe('none');
      expect(input.required).toBe(true);
    }
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Save password');
  });

  it('one Show/Hide flips BOTH boxes in place and announces it', () => {
    const onTogglePassword = vi.fn();
    const form = renderSetPasswordForm(draft(), { disabled: false, onTogglePassword });
    const first = form.querySelector('[data-field="password"]');
    const second = form.querySelector('[data-field="confirmation"]');
    first.value = 'typed-1';
    second.value = 'typed-2';
    form.querySelector('.password-toggle').click();
    expect(first.type).toBe('text');
    expect(second.type).toBe('text');
    expect(first.value).toBe('typed-1');
    expect(second.value).toBe('typed-2');
    expect(form.querySelector('[role="status"]').textContent).toBe('Password is shown');
    expect(onTogglePassword).toHaveBeenLastCalledWith(true);
    form.querySelector('.password-toggle').click();
    expect(first.type).toBe('password');
    expect(second.type).toBe('password');
  });

  it('starts shown when asked, and while saving marks everything aria-disabled, not native-disabled', () => {
    const form = renderSetPasswordForm(draft(), { disabled: true, showPassword: true });
    expect(form.querySelector('[data-field="password"]').type).toBe('text');
    expect(form.querySelector('button[type="submit"]').textContent).toBe('Saving…');
    for (const selector of [
      '[data-field="password"]',
      '[data-field="confirmation"]',
      'button[type="submit"]',
    ]) {
      const node = form.querySelector(selector);
      expect(node.disabled).toBe(false);
      expect(node.getAttribute('aria-disabled')).toBe('true');
      expect(node.getAttribute('aria-busy')).toBe('true');
    }
  });

  it('keeps the draft in step with typing and with change events (autofill)', () => {
    const d = draft();
    const form = renderSetPasswordForm(d, { disabled: false });
    const first = form.querySelector('[data-field="password"]');
    first.value = 'abc';
    first.dispatchEvent(new Event('input', { bubbles: true }));
    expect(d.password).toBe('abc');
    const second = form.querySelector('[data-field="confirmation"]');
    second.value = 'abd';
    second.dispatchEvent(new Event('change', { bubbles: true }));
    expect(d.confirmation).toBe('abd');
  });
});

// ---- mount ----

function updateClient(answers) {
  const calls = [];
  return {
    calls,
    auth: {
      updateUser: (args) => {
        calls.push(args);
        const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
        return Promise.resolve(
          answer === 'ok' ? { data: { user: {} }, error: null } : { data: null, error: answer },
        );
      },
    },
  };
}

async function mount(client, extra = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const onDone = vi.fn();
  await mountSetPasswordScreen(root, { client, onDone, ...extra });
  return { root, onDone };
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
const feedback = (root) => root.querySelector('.screen-feedback');

describe('mountSetPasswordScreen', () => {
  it('explains why it is here, with a heading', async () => {
    const { root } = await mount(updateClient(['ok']));
    expect(root.querySelector('h1').textContent).toBe('Choose your password');
    expect(root.textContent).toMatch(/signed in with a one-time password/);
  });

  it('saves the password and clears the must-change flag in the same call, then reports done once', async () => {
    const client = updateClient(['ok']);
    const { root, onDone } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(client.calls).toEqual([
      { password: 'correct-horse', data: { must_change_password: false } },
    ]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('submits what the boxes show even when no input event reported it (autofill)', async () => {
    const client = updateClient(['ok']);
    const { root, onDone } = await mount(client);
    root.querySelector('[data-field="password"]').value = 'from-the-manager';
    root.querySelector('[data-field="confirmation"]').value = 'from-the-manager';
    await submit(root);
    expect(client.calls[0].password).toBe('from-the-manager');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['nothing typed', '', '', 'Choose a password.'],
    ['too short', 'short', 'short', 'Use at least 8 characters.'],
    [
      'two different passwords',
      'correct-horse',
      'correct-horsf',
      'The two passwords do not match.',
    ],
  ])('%s: says so, focuses the message, and never calls the API', async (_label, a, b, message) => {
    const client = updateClient(['ok']);
    const { root, onDone } = await mount(client);
    typeInto(root, 'password', a);
    typeInto(root, 'confirmation', b);
    await submit(root);
    expect(feedback(root).textContent).toBe(message);
    expect(feedback(root).dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback(root));
    expect(client.calls).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps what was typed, and the Show choice, after a refusal', async () => {
    const client = updateClient([{ code: 'same_password', message: 'raw' }]);
    const { root, onDone } = await mount(client);
    typeInto(root, 'password', 'one-time-pass');
    typeInto(root, 'confirmation', 'one-time-pass');
    root.querySelector('.password-toggle').click(); // shown
    await submit(root);
    expect(feedback(root).textContent).toBe(
      'Choose a different password from the one-time password you were given.',
    );
    expect(root.querySelector('[data-field="password"]').value).toBe('one-time-pass');
    expect(root.querySelector('[data-field="confirmation"]').value).toBe('one-time-pass');
    expect(root.querySelector('[data-field="password"]').type).toBe('text');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a network failure says so and leaves the form usable', async () => {
    const client = {
      auth: {
        updateUser: () => Promise.reject(new TypeError('Failed to fetch')),
      },
    };
    const { root, onDone } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(feedback(root).textContent).toBe(
      'Could not save your password — check your connection and try again.',
    );
    expect(root.querySelector('button[type="submit"]').getAttribute('aria-disabled')).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a request that never settles ends in the timeout message, not "Saving…" forever', async () => {
    vi.useFakeTimers();
    try {
      const client = { auth: { updateUser: () => new Promise(() => {}) } };
      const { root } = await mount(client);
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

  it('ignores a second submit while the first is in flight', async () => {
    let release;
    const calls = [];
    const client = {
      auth: {
        updateUser: (args) => {
          calls.push(args);
          return new Promise((resolve) => {
            release = () => resolve({ data: {}, error: null });
          });
        },
      },
    };
    const { root, onDone } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(root.querySelector('button[type="submit"]').textContent).toBe('Saving…');
    await submit(root);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('saves the password that was submitted, not what was typed while the request was in flight', async () => {
    let release;
    const calls = [];
    const client = {
      auth: {
        updateUser: (args) => {
          calls.push(args);
          return new Promise((resolve) => {
            release = () => resolve({ data: {}, error: null });
          });
        },
      },
    };
    const { root } = await mount(client);
    typeInto(root, 'password', 'first-choice');
    typeInto(root, 'confirmation', 'first-choice');
    await submit(root);
    typeInto(root, 'password', 'changed-my-mind');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls[0].password).toBe('first-choice');
  });

  it('never writes to the page again once its own signal is aborted', async () => {
    let release;
    const controller = new AbortController();
    const client = {
      auth: {
        updateUser: () =>
          new Promise((resolve) => {
            release = () => resolve({ data: null, error: { message: 'late failure' } });
          }),
      },
    };
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
    const root = document.createElement('div');
    const screen = await mountSetPasswordScreen(root, { client: updateClient(['ok']) });
    expect(() => screen.unmount()).not.toThrow();
  });
});

describe('mountSetPasswordScreen — arriving from the sign-in screen', () => {
  it('lands on the heading, even though the sign-in form’s submit button had focus when this replaced it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // What loginScreen leaves behind: its submit button, focused, carrying the usual focus key.
    const loginSubmit = document.createElement('button');
    loginSubmit.setAttribute('data-focus-key', 'submit');
    root.appendChild(loginSubmit);
    loginSubmit.focus();
    expect(document.activeElement).toBe(loginSubmit);

    await mountSetPasswordScreen(root, { client: updateClient(['ok']) });
    expect(document.activeElement).toBe(root.querySelector('#set-password-heading'));
    expect(root.querySelector('#set-password-heading').getAttribute('tabindex')).toBe('-1');
  });

  it('does not share the sign-in submit button’s focus key', async () => {
    const { root } = await mount(updateClient(['ok']));
    expect(root.querySelector('button[type="submit"]').getAttribute('data-focus-key')).toBe(
      'set-password-submit',
    );
  });

  it('after the first render, focus stays where the person put it across a re-render', async () => {
    const { root } = await mount(updateClient(['ok']));
    const field = root.querySelector('[data-field="password"]');
    field.focus();
    typeInto(root, 'password', 'abc');
    typeInto(root, 'confirmation', 'abd');
    await submit(root); // validation error re-renders and focuses the message
    expect(document.activeElement).toBe(root.querySelector('.screen-feedback'));
  });
});

describe('renderSetPasswordForm — where the toggle sits', () => {
  it('comes after BOTH boxes (it flips both), not between them', () => {
    const form = renderSetPasswordForm({ password: '', confirmation: '' }, { disabled: false });
    const fields = [...form.querySelectorAll('.form-field')];
    expect(fields).toHaveLength(2);
    expect(fields[0].querySelector('.password-toggle')).toBeNull();
    expect(fields[1].querySelector('.password-toggle')).not.toBeNull();
    expect(fields[1].querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('mountSetPasswordScreen — edges the first pass missed', () => {
  it('a password with spaces is sent exactly as typed (no trimming)', async () => {
    const client = updateClient(['ok']);
    const { root } = await mount(client);
    typeInto(root, 'password', ' spaced out ');
    typeInto(root, 'confirmation', ' spaced out ');
    await submit(root);
    expect(client.calls[0].password).toBe(' spaced out ');
  });

  it('after a refusal the form is usable again and a second try goes through', async () => {
    const client = updateClient([{ code: 'weak_password', message: 'x' }, 'ok']);
    const { root, onDone } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    await submit(root);
    expect(onDone).not.toHaveBeenCalled();
    expect(root.querySelector('button[type="submit"]').getAttribute('aria-disabled')).toBeNull();
    await submit(root);
    expect(client.calls).toHaveLength(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('which message wins when several things are wrong', () => {
    expect(validateNewPassword('abc', 'xyz')).toBe('Use at least 8 characters.');
    expect(validateNewPassword('', 'x')).toBe('Choose a password.');
  });

  it('a re-render after the first does not drag focus back to the heading', async () => {
    let release;
    const client = {
      auth: {
        updateUser: () =>
          new Promise((resolve) => {
            release = () => resolve({ data: {}, error: null });
          }),
      },
    };
    const { root } = await mount(client);
    typeInto(root, 'password', 'correct-horse');
    typeInto(root, 'confirmation', 'correct-horse');
    root.querySelector('[data-field="confirmation"]').focus();
    await submit(root); // the "Saving…" re-render
    expect(document.activeElement).not.toBe(root.querySelector('#set-password-heading'));
    release();
  });
});
