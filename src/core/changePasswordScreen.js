// "Change password" — the signed-in person chooses a new password (D-PW1), reached from the account area
// of the header menu at #/account/password (behind the same sign-in gate as every console route, so a person
// who still has a one-time password to replace sees that screen first). Supabase does not ask for the current
// password; what protects a borrowed, unlocked session is that a save ends every OTHER session of the login
// (passwordChange.js).
//
// An account with an authenticator app is told so BEFORE a form is shown, because Supabase would refuse the
// save (`insufficient_aal`) and this app has no code step outside the operator's console.
import { getSupabase } from './supabaseClient.js';
import { el, withFocusPreservation } from './dom.js';
import {
  mountPasswordFormScreen,
  describePasswordError,
  AUTHENTICATOR_REQUIRED_MESSAGE,
  savedMessage,
} from './passwordForm.js';
import {
  savePasswordAndEndOtherSessions,
  passwordChangeBlockedByAuthenticator,
} from './passwordChange.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

export async function mountChangePasswordScreen(root, { client = getSupabase(), signal } = {}) {
  let unmounted = false;
  const alive = () => !unmounted && !signal?.aborted;

  function renderCard({ heading, message, role, focusMessage = false }) {
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container login-screen' });
      const headingNode = el('h1', {
        id: 'change-password-heading',
        text: heading,
        attrs: { tabindex: '-1' },
      });
      const messageNode = el('p', {
        className: 'stage-meta',
        text: message,
        attrs: role ? { role, 'aria-live': 'polite', tabindex: '-1' } : {},
      });
      container.append(
        headingNode,
        messageNode,
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Back to events',
          attrs: { href: '#/events' },
        }),
      );
      root.appendChild(container);
      (focusMessage ? messageNode : headingNode).focus();
      return true;
    });
  }

  // Asked before the form is drawn. It reads the session the client holds, which can mean refreshing an expired
  // token over the network, so the heading is up first and the wait is bounded: past the timeout the form is
  // shown and the server's own refusal is the backstop.
  if (!alive()) return { unmount() {} };
  renderCard({ heading: 'Change password', message: 'One moment…', role: 'status' });
  let blocked = false;
  try {
    blocked = await raceTimeout(
      passwordChangeBlockedByAuthenticator(client),
      DEFAULT_LOAD_TIMEOUT_MS,
    );
  } catch {
    blocked = false;
  }
  if (!alive()) return { unmount() {} };

  if (blocked) {
    renderCard({ heading: 'Change password', message: AUTHENTICATOR_REQUIRED_MESSAGE });
  } else {
    mountPasswordFormScreen(root, {
      heading: 'Change password',
      headingId: 'change-password-heading',
      intro: 'Choose a new password. Your other devices will be signed out.',
      signal,
      save: (password) => savePasswordAndEndOtherSessions(client, password),
      describeError: (error) => describePasswordError(error, { context: 'current' }),
      onSaved: (result) => {
        if (!alive()) return;
        renderCard({
          heading: 'Password changed',
          message: savedMessage(result.othersSignedOut),
          role: 'status',
          focusMessage: true,
        });
      },
      footer: () => [
        el('a', {
          className: 'login-secondary-link tap-target',
          text: 'Cancel',
          attrs: { href: '#/events' },
        }),
      ],
    });
  }

  return {
    unmount() {
      unmounted = true;
    },
  };
}
