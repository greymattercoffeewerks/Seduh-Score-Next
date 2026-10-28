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
