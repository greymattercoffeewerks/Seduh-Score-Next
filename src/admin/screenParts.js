// Small pieces every admin screen shares: the page frame (one h1, one live feedback region), the feedback
// setter, the "signed in as" strip with its Sign out button, and a busy toggle for a form.
import { el, setBusyDisabled } from '../core/dom.js';

export const SIGN_OUT_FAILED = 'Could not sign out. Check your connection and try again.';

// One <section> with the screen's heading and its feedback region. The console moves focus to the heading
// when a screen replaces the last one (a changed screen is announced, not silent); `feedback` is focusable so
// an error can be announced by moving focus to it.
export function frame(title) {
  const heading = el('h1', { text: title, attrs: { tabindex: '-1', 'data-heading': 'true' } });
  const feedback = el('div', {
    className: 'screen-feedback',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });
  const container = el('section', { className: 'adm-screen' }, [heading]);
  return { container, heading, feedback };
}

export function setFeedback(feedback, message, tone) {
  feedback.textContent = message ?? '';
  if (message && tone) feedback.dataset.tone = tone;
  else delete feedback.dataset.tone;
  if (message && tone === 'error') {
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }
}

// Disables a form's controls the accessible way (aria-disabled, see core/dom.js setBusyDisabled) and swaps
// the submit button's label. The submit handler still guards against a second submit itself.
export function setFormBusy(form, busy, { idle, working }) {
  for (const control of form.querySelectorAll('input, select')) setBusyDisabled(control, busy);
  const submit = form.querySelector('button[type="submit"]');
  if (submit) {
    setBusyDisabled(submit, busy);
    submit.textContent = busy ? working : idle;
  }
}

// "Signed in as <email>" and a Sign out button, for the screens that stand between sign-in and the console.
// `onSignOut()` resolves { ok }; a failed sign-out is reported in `feedback`, never silent.
export function signedInStrip({ email, onSignOut, feedback }) {
  const button = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Sign out',
    attrs: { type: 'button' },
  });
  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    setBusyDisabled(button, true);
    const result = await onSignOut();
    // A successful sign-out replaces this whole screen; only a failure comes back here.
    if (!result?.ok) {
      busy = false;
      setBusyDisabled(button, false);
      setFeedback(feedback, SIGN_OUT_FAILED, 'error');
    }
  });
  return el('div', { className: 'adm-strip' }, [
    el('p', { className: 'adm-strip-who', text: email ? `Signed in as ${email}` : 'Signed in' }),
    button,
  ]);
}
