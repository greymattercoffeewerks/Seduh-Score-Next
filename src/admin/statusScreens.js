// The gate's non-form screens: checking, no access, and "could not check".
import { el, setBusyDisabled } from '../core/dom.js';
import { frame, signedInStrip } from './screenParts.js';
import { ADMIN_ERROR_COPY } from './adminErrors.js';

export function mountCheckingScreen(root) {
  const { container } = frame('Checking access');
  container.appendChild(
    el('p', { className: 'adm-muted', text: 'One moment…', attrs: { role: 'status' } }),
  );
  root.appendChild(container);
  return { unmount() {} };
}

// Says nothing about WHY (a wrong organisation, no admin row): the same words for every non-admin, so the
// screen tells a curious organiser nothing about how the console works.
export function mountNoAccessScreen(root, { email, onSignOut }) {
  const { container, feedback } = frame('No access');
  container.append(
    el('p', { text: ADMIN_ERROR_COPY.admin_required }),
    feedback,
    signedInStrip({ email, onSignOut, feedback }),
  );
  root.appendChild(container);
  return { unmount() {} };
}

export function mountCheckFailedScreen(root, { email, message, onRetry, onSignOut }) {
  const { container, feedback } = frame('Could not check your access');
  const retry = el('button', {
    className: 'btn btn-primary tap-target',
    text: 'Retry',
    attrs: { type: 'button' },
  });
  let retrying = false;
  retry.addEventListener('click', () => {
    if (retrying) return;
    retrying = true;
    setBusyDisabled(retry, true);
    onRetry();
  });
  container.append(
    el('p', { text: message }),
    retry,
    feedback,
    signedInStrip({ email, onSignOut, feedback }),
  );
  root.appendChild(container);
  return { unmount() {} };
}
