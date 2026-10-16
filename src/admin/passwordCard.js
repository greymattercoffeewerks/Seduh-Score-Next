// The one-time password, shown once: the heading names the login it belongs to, then the password, a Copy button and the warning that
// it will not be shown again. The password lives only in this node (never an attribute, a label, a log or storage)
// and goes when the node does. Used by the create-organisation panel for a login the console has just made.
import { el } from '../core/dom.js';

const ONLY_TIME_WARNING = 'This is the only time this password is shown.';
const COPIED = 'Copied.';
const COPY_FAILED = 'Could not copy. Select the password and copy it yourself.';

// `heading` names the card; `help` is the instruction under the password; `onDone` (optional) adds a Done button
// that the caller uses to hide the card once the person says the password has been passed on.
export function oneTimePasswordCard({ idPrefix, heading, password, help, onDone }) {
  const status = el('span', {
    className: 'adm-muted',
    id: `${idPrefix}-copy-status`,
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  // Copy is the main action; Done throws the only copy away, so it is the quieter button and sits apart from Copy.
  const copy = el('button', {
    className: 'btn btn-primary tap-target',
    text: 'Copy',
    attrs: { type: 'button', 'aria-label': 'Copy the one-time password' },
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(password);
      status.textContent = COPIED;
    } catch {
      status.textContent = COPY_FAILED;
    }
  });
  const actions = el('div', { className: 'adm-actions' }, [copy]);
  if (onDone) {
    const done = el('button', {
      className: 'btn btn-outline tap-target adm-done',
      text: 'Done',
      attrs: { type: 'button', 'aria-label': 'Done: hide the one-time password' },
    });
    done.addEventListener('click', onDone);
    actions.appendChild(done);
  }
  return el(
    'section',
    {
      className: 'card adm-password-card',
      id: `${idPrefix}-card`,
      attrs: {
        'aria-labelledby': `${idPrefix}-heading`,
        'aria-describedby': `${idPrefix}-password ${idPrefix}-warning`,
      },
    },
    [
      el('h2', { id: `${idPrefix}-heading`, text: heading }),
      el('p', { className: 'adm-muted', text: 'One-time password:' }),
      el('code', { id: `${idPrefix}-password`, className: 'adm-password', text: password }),
      el('p', { id: `${idPrefix}-warning`, className: 'adm-warning', text: ONLY_TIME_WARNING }),
      help ? el('p', { text: help }) : null,
      actions,
      status,
    ].filter(Boolean),
  );
}
