import { describe, it, expect, vi } from 'vitest';
import {
  validateNewPassword,
  mountPasswordFormScreen,
  MIN_PASSWORD_LENGTH,
} from './passwordForm.js';

describe('validateNewPassword minLength', () => {
  it('defaults to 12 (the project minimum), and a caller can still pass its own', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(validateNewPassword('12345678901', '12345678901')).toBe('Use at least 12 characters.');
    expect(validateNewPassword('123456789012', '123456789012')).toBeNull();
  });

  it('takes a longer minimum from the caller and names it', () => {
    expect(validateNewPassword('12345678', '12345678', 8)).toBeNull();
    expect(validateNewPassword('1234567', '1234567', 8)).toBe('Use at least 8 characters.');
    expect(validateNewPassword('123456789012', '123456789012', 14)).toBe(
      'Use at least 14 characters.',
    );
  });
});

describe('mountPasswordFormScreen askCurrent', () => {
  function mount(options) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountPasswordFormScreen(root, { heading: 'H', headingId: 'h', intro: 'i', ...options });
    return root;
  }
  const set = (root, name, value) => {
    root.querySelector(`[data-field="${name}"]`).value = value;
  };
  const send = async (root) => {
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('has no current-password box by default', () => {
    const root = mount({ save: vi.fn() });
    expect(root.querySelector('[data-field="current"]')).toBeNull();
    expect(root.querySelectorAll('input')).toHaveLength(2);
  });

  it('with it: a current-password box first, required, and handed to save as the second argument', async () => {
    const save = vi.fn(async () => ({ error: null }));
    const root = mount({ save, askCurrent: true, minLength: 12 });
    const inputs = [...root.querySelectorAll('input')];
    expect(inputs.map((i) => i.dataset.field)).toEqual(['current', 'password', 'confirmation']);
    expect(inputs[0].getAttribute('autocomplete')).toBe('current-password');
    expect(inputs[0].getAttribute('aria-label')).toBe('Current password');

    set(root, 'password', 'long-enough-pass');
    set(root, 'confirmation', 'long-enough-pass');
    await send(root);
    expect(save).not.toHaveBeenCalled();
    expect(root.querySelector('.screen-feedback').textContent).toBe('Enter your current password.');

    set(root, 'current', 'the-old-one');
    await send(root);
    expect(save).toHaveBeenCalledWith('long-enough-pass', 'the-old-one');
  });
});

describe('mountPasswordFormScreen inlineErrors / toggleCurrent (opt-in)', () => {
  function mount(options) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountPasswordFormScreen(root, {
      heading: 'H',
      headingId: 'pf',
      intro: 'i',
      save: vi.fn(async () => ({ error: null })),
      askCurrent: true,
      ...options,
    });
    return root;
  }
  const set = (root, name, value) => {
    const input = root.querySelector(`[data-field="${name}"]`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const send = async (root) => {
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const field = (root, name) => root.querySelector(`[data-field="${name}"]`);

  it('default: native validation stays, nothing is marked invalid, toggle skips the current box, focus goes to the message', async () => {
    const root = mount({});
    expect(root.querySelector('form').hasAttribute('novalidate')).toBe(false);
    set(root, 'password', 'long-enough-pass');
    set(root, 'confirmation', 'long-enough-pass');
    await send(root);
    expect(root.querySelector('[aria-invalid]')).toBeNull();
    expect(root.querySelector('.screen-feedback').hasAttribute('id')).toBe(false);
    expect(document.activeElement).toBe(root.querySelector('.screen-feedback'));
    root.querySelector('.password-toggle').click();
    expect(field(root, 'password').type).toBe('text');
    expect(field(root, 'current').type).toBe('password');
  });

  it('inlineErrors: novalidate, and the box at fault is aria-invalid, described by the message, focused', async () => {
    const root = mount({ inlineErrors: true });
    expect(root.querySelector('form').hasAttribute('novalidate')).toBe(true);
    // required stays for assistive technology
    expect(field(root, 'current').required).toBe(true);

    await send(root);
    const message = root.querySelector('.screen-feedback');
    expect(message.textContent).toBe('Enter your current password.');
    expect(field(root, 'current').getAttribute('aria-invalid')).toBe('true');
    expect(field(root, 'current').getAttribute('aria-describedby')).toBe(message.id);
    expect(field(root, 'password').hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).toBe(field(root, 'current'));

    set(root, 'current', 'old');
    expect(field(root, 'current').hasAttribute('aria-invalid')).toBe(false);

    // empty new-password boxes: the new-password box is the one at fault
    await send(root);
    expect(field(root, 'password').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field(root, 'password'));
    expect(field(root, 'current').hasAttribute('aria-describedby')).toBe(false);

    set(root, 'password', 'short');
    set(root, 'confirmation', 'short');
    await send(root);
    expect(field(root, 'password').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field(root, 'password'));

    set(root, 'password', 'long-enough-pass');
    set(root, 'confirmation', 'different-pass-x');
    await send(root);
    expect(field(root, 'confirmation').getAttribute('aria-invalid')).toBe('true');
    expect(field(root, 'password').hasAttribute('aria-invalid')).toBe(false);
  });

  it('toggleCurrent: one toggle shows and hides all three boxes', () => {
    const root = mount({ toggleCurrent: true });
    const toggle = root.querySelector('.password-toggle');
    toggle.click();
    for (const name of ['current', 'password', 'confirmation']) {
      expect(field(root, name).type).toBe('text');
    }
    expect(toggle.textContent).toBe('Hide');
    toggle.click();
    for (const name of ['current', 'password', 'confirmation']) {
      expect(field(root, name).type).toBe('password');
    }
  });
});
