// What the Plan panel's forms share. Same guarantees as memberActions.js: a control is taken once (it stops while its request
// is out), a request that may have been carried out is never reported as "nothing changed", a gate refusal is not drawn here
// (the console is checking access again), and the database decides every refusal (this code only translates the hint).
import { el, setBusyDisabled } from '../core/dom.js';
import { describeAdminError, ADMIN_ERROR_COPY } from './adminErrors.js';
import { isGateRefusal } from './gate.js';
import { ask } from './panelRequest.js';
import { feedbackRegion, setFeedback } from './screenParts.js';
import { field } from './formParts.js';

export const WRITE_IN_FLIGHT =
  'Another change is still being made. Wait for it to finish, then try again.';

// A failure with no hint, a timeout, or a hint this console has no words for leaves it unknown whether the change was made.
export function failureMessage(error, unknown) {
  return error?.timedOut || !error?.hint || !Object.hasOwn(ADMIN_ERROR_COPY, error.hint)
    ? unknown
    : describeAdminError(error);
}

// One change at a time per page: the default (a lone control, in a test) always allows it.
export const ALWAYS = Object.freeze({ begin: () => true, end: () => {} });

let counter = 0;
export const nextId = (prefix) => `${prefix}-${(counter += 1)}`;

export function selectInput(id, options, extra = {}) {
  return el(
    'select',
    { className: 'field-input', id, attrs: extra },
    options.map(({ value, label }) =>
      el('option', { text: label, attrs: { value: String(value) } }),
    ),
  );
}

export function plainInput(id, type, extra = {}) {
  return el('input', {
    className: 'field-input',
    id,
    attrs: { type, autocomplete: 'off', ...extra },
  });
}

// A labelled field built from an input. `required: false` leaves aria-required off (the shared `field` sets it).
export function labelled(id, label, input, { hint, required = true } = {}) {
  const built = field({ id, label, hint, input });
  if (!required) input.removeAttribute('aria-required');
  return built;
}

// A small form that runs ONE admin write. `build()` returns { fields: [{wrapper}...], values() -> args | { problem, focus } };
// `run(args)` returns the answer of `ask`. On success `onDone(message)` runs (the caller reloads the page from the database);
// on a refusal the message is shown beside the button and focus moves to it.
export function writeForm({
  title,
  intro,
  submitLabel,
  workingLabel,
  unknown,
  fields,
  collect,
  run,
  onDone,
  onGateRefused,
  mayTakeFocus,
  writes = ALWAYS,
  successMessage,
}) {
  const feedback = feedbackRegion();
  const submit = el('button', {
    className: 'btn btn-primary tap-target',
    text: submitLabel,
    attrs: { type: 'submit' },
  });
  const form = el('form', { className: 'adm-form', attrs: { novalidate: 'novalidate' } }, [
    ...fields.map((f) => f.wrapper),
    submit,
  ]);
  let busy = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const collected = collect();
    if (collected.problem) {
      setFeedback(feedback, collected.problem, 'error', { focus: false });
      collected.focus?.focus();
      return;
    }
    if (!writes.begin()) {
      setFeedback(feedback, WRITE_IN_FLIGHT, 'error', { focus: false });
      return;
    }
    busy = true;
    setFeedback(feedback, '');
    for (const control of form.querySelectorAll('input, select')) control.disabled = true;
    setBusyDisabled(submit, true);
    submit.textContent = workingLabel;
    const answer = await run(collected.args);
    // the page moved on while the request was out: its claim ends with its answer
    if (!form.isConnected) return writes.end();
    if (answer.error) {
      if (isGateRefusal(answer.error)) return onGateRefused();
      busy = false;
      writes.end();
      for (const control of form.querySelectorAll('input, select')) control.disabled = false;
      setBusyDisabled(submit, false);
      submit.textContent = submitLabel;
      setFeedback(feedback, failureMessage(answer.error, unknown), 'error', {
        focus: mayTakeFocus(),
      });
      return;
    }
    onDone(
      typeof successMessage === 'function'
        ? successMessage(collected.args, answer.data)
        : successMessage,
    );
  });

  const headingId = nextId('adm-plan-form');
  return {
    node: el(
      'section',
      { className: 'adm-section adm-plan-form', attrs: { 'aria-labelledby': headingId } },
      [
        el('h3', { text: title, id: headingId }),
        intro ? el('p', { className: 'adm-muted', text: intro }) : null,
        feedback,
        form,
      ].filter(Boolean),
    ),
  };
}

// A button that asks a question before it does a consequential thing: the button says what it would do, then the question
// with Confirm and Cancel. `run()` returns the answer of `ask`; `onDone(message)` runs on success.
export function confirmAction({
  label,
  ariaLabel,
  question,
  confirmLabel = 'Confirm',
  workingLabel = 'Working…',
  unknown,
  run,
  onDone,
  onGateRefused,
  mayTakeFocus,
  writes = ALWAYS,
  successMessage,
  className = 'btn btn-outline tap-target',
}) {
  const holder = el('div', { className: 'adm-role-control' });
  const message = el('p', {
    className: 'adm-field-error',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  let busy = false;

  function showButton({ focus = false } = {}) {
    const button = el('button', {
      className,
      text: label,
      attrs: { type: 'button', ...(ariaLabel ? { 'aria-label': ariaLabel } : {}) },
    });
    button.addEventListener('click', showQuestion);
    holder.replaceChildren(button, message);
    if (focus) button.focus();
  }

  function showQuestion() {
    const q = el('p', { text: question, attrs: { tabindex: '-1' } });
    const confirm = el('button', {
      className: 'btn btn-primary tap-target',
      text: confirmLabel,
      attrs: { type: 'button' },
    });
    const cancel = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    cancel.addEventListener('click', () => {
      if (busy) return;
      message.textContent = '';
      showButton({ focus: true });
    });
    confirm.addEventListener('click', async () => {
      if (busy) return;
      if (!writes.begin()) {
        message.textContent = WRITE_IN_FLIGHT;
        return;
      }
      busy = true;
      message.textContent = '';
      for (const control of [confirm, cancel]) setBusyDisabled(control, true);
      confirm.textContent = workingLabel;
      const answer = await run();
      if (!holder.isConnected) return writes.end();
      if (answer.error) {
        if (isGateRefusal(answer.error)) return onGateRefused();
        busy = false;
        writes.end();
        for (const control of [confirm, cancel]) setBusyDisabled(control, false);
        confirm.textContent = confirmLabel;
        message.textContent = failureMessage(answer.error, unknown);
        if (mayTakeFocus()) message.focus();
        return;
      }
      onDone(successMessage);
    });
    holder.replaceChildren(q, el('div', { className: 'adm-actions' }, [confirm, cancel]), message);
    q.focus();
  }

  showButton();
  return holder;
}

export { ask };
