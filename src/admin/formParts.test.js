import { describe, it, expect } from 'vitest';
import { field, textInput, showFieldError } from './formParts.js';

describe('field', () => {
  it('labels the input, and describes it by its hint and its error line, in that order', () => {
    const input = textInput('x');
    const { wrapper, errorLine } = field({ id: 'x', label: 'Name', hint: 'Help', input });
    document.body.appendChild(wrapper);
    expect(wrapper.querySelector('label[for="x"]').textContent).toBe('Name');
    expect(wrapper.querySelector('#x-hint').textContent).toBe('Help');
    expect(input.getAttribute('aria-describedby')).toBe('x-hint x-error');
    expect(errorLine.id).toBe('x-error');
    expect(input.getAttribute('aria-required')).toBe('true');
    wrapper.remove();
  });

  it('without a hint it is described by its error line alone', () => {
    const input = textInput('y');
    field({ id: 'y', label: 'Y', input });
    expect(input.getAttribute('aria-describedby')).toBe('y-error');
  });

  it('an error line is a live region only when asked to be', () => {
    const quiet = field({ id: 'a', label: 'A', input: textInput('a') });
    const live = field({ id: 'b', label: 'B', input: textInput('b'), live: true });
    expect(quiet.errorLine.hasAttribute('aria-live')).toBe(false);
    expect(live.errorLine.getAttribute('aria-live')).toBe('polite');
  });
});

describe('textInput', () => {
  it('is a plain text field that is not autofilled, capitalised or spell-checked unless told to be', () => {
    const input = textInput('t');
    expect(input.type).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    const email = textInput('e', { type: 'email', spellcheck: 'true' });
    expect(email.type).toBe('email');
    expect(email.getAttribute('spellcheck')).toBe('true');
  });
});

describe('showFieldError', () => {
  it('puts the message beside the field and marks it invalid, and takes both away again', () => {
    const input = textInput('z');
    const { errorLine } = field({ id: 'z', label: 'Z', input });
    showFieldError(input, errorLine, 'Too short');
    expect(errorLine.textContent).toBe('Too short');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    showFieldError(input, errorLine, null);
    expect(errorLine.textContent).toBe('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    showFieldError(input, errorLine, '');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });
});
