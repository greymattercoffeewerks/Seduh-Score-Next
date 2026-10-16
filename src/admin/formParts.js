// The small form builders the admin panels share: a labelled field with an optional hint and an error line, a text
// input with the attributes an admin form wants, and the one function that puts a problem on a field (the message
// beside it, `aria-invalid` on it) or takes it away.
import { el } from '../core/dom.js';

// `live` makes the error line announce itself: for a field whose problem can arrive without the person typing in it
// (a lookup that found nothing), where moving focus is not always possible.
export function field({ id, label, hint, input, live = false }) {
  const errorLine = el('p', {
    className: 'adm-field-error',
    id: `${id}-error`,
    attrs: { 'data-for': id, ...(live ? { 'aria-live': 'polite' } : {}) },
  });
  input.setAttribute('aria-required', 'true');
  const describedBy = [hint ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(' ');
  input.setAttribute('aria-describedby', describedBy);
  const wrapper = el(
    'div',
    { className: 'form-field' },
    [
      el('label', { className: 'form-field-label', text: label, attrs: { for: id } }),
      hint ? el('p', { className: 'form-field-hint', id: `${id}-hint`, text: hint }) : null,
      input,
      errorLine,
    ].filter(Boolean),
  );
  return { wrapper, errorLine };
}

export function textInput(id, extra = {}) {
  return el('input', {
    className: 'field-input',
    id,
    attrs: {
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      ...extra,
    },
  });
}

export function showFieldError(input, errorLine, message) {
  errorLine.textContent = message ?? '';
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}
