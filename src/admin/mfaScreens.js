// The two second-factor screens: first-time enrolment of an authenticator app, and the challenge for a login
// that already has one. Both end in the same place, a verified code, after which the console asks the gate
// again (it never assumes the verification worked: `ready` needs the database to say so).
import { el, setBusyDisabled } from '../core/dom.js';
import { beginEnrol, verifyCode, CODE_PROMPT } from './mfa.js';
import { frame, setFeedback, setFormBusy, signedInStrip } from './screenParts.js';

// The one-field "6-digit code" form both screens share. `onSubmit(code)` resolves { ok, message }.
function renderCodeForm({ idle, working, onSubmit, feedback }) {
  const input = el('input', {
    className: 'field-input adm-code-input',
    attrs: {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      maxlength: '7',
      'aria-label': '6-digit code',
      'data-field': 'code',
      required: 'required',
    },
  });
  const submit = el('button', {
    className: 'btn btn-primary tap-target',
    text: idle,
    attrs: { type: 'submit' },
  });
  const form = el('form', { className: 'login-form' }, [
    el('div', { className: 'form-field' }, [
      el('span', {
        className: 'form-field-label',
        text: '6-digit code',
        attrs: { 'aria-hidden': 'true' },
      }),
      input,
    ]),
    submit,
  ]);
  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    setFeedback(feedback, '');
    setFormBusy(form, true, { idle, working });
    // The value as displayed, not as last reported by an input event (autofill and some keyboards skip it).
    const result = await onSubmit(input.value);
    // A verified code replaces this whole screen; only a failure comes back here.
    if (!result?.ok) {
      busy = false;
      setFormBusy(form, false, { idle, working });
      setFeedback(feedback, result?.message, 'error');
      input.select?.();
      input.focus();
    }
  });
  return form;
}

export function mountChallengeScreen(root, { client, factorId, email, onVerified, onSignOut }) {
  const { container, feedback } = frame('Verify it is you');
  const form = renderCodeForm({
    idle: 'Verify',
    working: 'Verifying…',
    feedback,
    onSubmit: async (code) => {
      const result = await verifyCode(client, factorId, code);
      if (result.ok) onVerified();
      return result;
    },
  });
  container.append(
    el('p', { text: CODE_PROMPT }),
    el('div', { className: 'card' }, [form]),
    feedback,
    signedInStrip({ email, onSignOut, feedback }),
  );
  root.appendChild(container);
  return { unmount() {} };
}

export function mountEnrolScreen(root, { client, email, onVerified, onSignOut }) {
  const { container, feedback } = frame('Set up your authenticator app');
  const body = el('div', { className: 'adm-enrol-body' });
  container.append(
    el('p', {
      text: 'The console needs a second step every time you sign in. Scan the code with an authenticator app, then enter the 6-digit code it shows.',
    }),
    body,
    feedback,
    signedInStrip({ email, onSignOut, feedback }),
  );
  root.appendChild(container);

  let cancelled = false;

  async function prepare() {
    body.replaceChildren(el('p', { className: 'adm-muted', text: 'Preparing your code…' }));
    const enrolment = await beginEnrol(client);
    if (cancelled) return;
    if (!enrolment.ok) {
      const retry = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Try again',
        attrs: { type: 'button' },
      });
      let retrying = false;
      retry.addEventListener('click', () => {
        if (retrying) return;
        retrying = true;
        setBusyDisabled(retry, true);
        setFeedback(feedback, '');
        prepare();
      });
      body.replaceChildren(retry);
      setFeedback(feedback, enrolment.message, 'error');
      return;
    }
    const qr = el('img', {
      className: 'adm-qr',
      attrs: { alt: 'QR code to scan with your authenticator app', width: '200', height: '200' },
    });
    qr.src = enrolment.qrCode;
    const form = renderCodeForm({
      idle: 'Verify and continue',
      working: 'Verifying…',
      feedback,
      onSubmit: async (code) => {
        const result = await verifyCode(client, enrolment.factorId, code);
        if (result.ok) onVerified();
        return result;
      },
    });
    body.replaceChildren(
      el('div', { className: 'card adm-enrol-card' }, [
        qr,
        el('p', { className: 'adm-muted', text: 'Cannot scan it? Enter this key in your app:' }),
        el('code', {
          className: 'adm-secret',
          text: enrolment.secret.replace(/(.{4})/g, '$1 ').trim(),
          attrs: { 'data-field': 'secret' },
        }),
      ]),
      el('div', { className: 'card' }, [form]),
    );
  }

  prepare();
  return {
    unmount() {
      cancelled = true;
    },
  };
}
