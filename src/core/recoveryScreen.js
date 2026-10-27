// The screen a password-recovery email link opens (D-PW1), shown INSTEAD of the console for as long as the
// arrival's flow is open (main.js's requireAuth asks `flow.isOpen()` first). Which state it shows comes
// from the flow (passwordRecovery.js), not from this screen, because the router rebuilds screens: a
// rebuilt screen must show "Password changed" again, never a fresh form.
//
// States: checking the link · the new-password form · password saved · the link no longer works ·
// the account has an authenticator app · could not reach the server.
import { el, withFocusPreservation } from './dom.js';
import {
  mountPasswordFormScreen,
  describePasswordError,
  AUTHENTICATOR_REQUIRED_MESSAGE,
  savedMessage,
} from './passwordForm.js';

export const LINK_INVALID_MESSAGE =
  'This link has expired or was already used. A link works once, and some email apps open it before you do. Request a new one and open it yourself.';
export const LINK_UNREACHABLE_MESSAGE =
  'Could not check your link — check your connection and try again.';

export function mountRecoveryScreen(root, { flow, onFinished, signal }) {
  let unmounted = false;

  const alive = () => !unmounted && !signal?.aborted;

  // A card for the states that are only words: a heading (focused), a paragraph, and the ways on.
  function renderCard({
    heading,
    headingId,
    message,
    actions,
    status = false,
    focusMessage = false,
  }) {
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container login-screen' });
      const headingNode = el('h1', {
        id: headingId,
        text: heading,
        attrs: { tabindex: '-1' },
      });
      container.appendChild(headingNode);
      // `status`: the words are a progress or an error line, so they sit in a polite live region.
      const messageNode = el(
        'p',
        status
          ? {
              className: 'stage-meta',
              text: message,
              attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
            }
          : { className: 'stage-meta', text: message },
      );
      container.appendChild(messageNode);
      if (actions.length) {
        container.appendChild(el('div', { className: 'login-form' }, actions));
      }
      root.appendChild(container);
      // The words of a result (a saved password, and the warning that other devices stayed signed in) are the
      // point of the screen: focus them, not just the heading, so a screen reader reads them.
      (focusMessage ? messageNode : headingNode).focus();
      return true;
    });
  }

  const linkAction = (text, href) => {
    const link = el('a', {
      className: 'btn btn-primary tap-target',
      text,
      attrs: { href },
    });
    // Leaving for another screen ends the flow, so Back or a later visit to the console does not
    // come back to a dead end.
    link.addEventListener('click', () => flow.close());
    return link;
  };
  const buttonAction = (text, onClick, className = 'btn btn-primary tap-target') => {
    const button = el('button', { className, text, attrs: { type: 'button' } });
    button.addEventListener('click', onClick);
    return button;
  };

  function finish() {
    flow.close();
    onFinished?.();
  }

  async function render() {
    if (!alive()) return;
    const { phase, othersSignedOut } = flow.getState();
    if (phase === 'verifying') {
      renderCard({
        heading: 'Checking your link…',
        headingId: 'recovery-heading',
        message: 'One moment.',
        actions: [],
        status: true,
      });
      await flow.establish();
      if (!alive()) return;
      render();
      return;
    }
    if (phase === 'ready') {
      mountPasswordFormScreen(root, {
        heading: 'Choose a new password',
        headingId: 'recovery-heading',
        intro: 'Choose a new password for your account. Your other devices will be signed out.',
        signal,
        save: (password) => flow.save(password),
        describeError: (error) => describePasswordError(error, { context: 'current' }),
        onSaved: () => {
          if (alive()) render();
        },
      });
      return;
    }
    if (phase === 'done') {
      renderCard({
        heading: 'Password changed',
        headingId: 'recovery-heading',
        message: savedMessage(othersSignedOut),
        actions: [buttonAction('Continue', finish)],
        status: true,
        focusMessage: true,
      });
      return;
    }
    if (phase === 'unreachable') {
      renderCard({
        heading: 'Could not check your link',
        headingId: 'recovery-heading',
        message: LINK_UNREACHABLE_MESSAGE,
        actions: [
          buttonAction('Try again', () => {
            // Starts the check again (the flow moves from 'unreachable' back to 'verifying' at once);
            // a second press while it runs joins the same check.
            flow.establish();
            render();
          }),
        ],
        status: true,
      });
      return;
    }
    if (phase === 'mfa') {
      renderCard({
        heading: 'This account has an authenticator app',
        headingId: 'recovery-heading',
        message: AUTHENTICATOR_REQUIRED_MESSAGE,
        actions: [buttonAction('Back to sign in', finish)],
      });
      return;
    }
    // 'invalid' (and 'closed', which the gate never mounts this screen for).
    renderCard({
      heading: 'This link no longer works',
      headingId: 'recovery-heading',
      message: LINK_INVALID_MESSAGE,
      actions: [
        linkAction('Request a new link', '#/forgot-password'),
        buttonAction('Back to sign in', finish, 'btn btn-outline tap-target'),
      ],
    });
  }

  render();

  return {
    unmount() {
      unmounted = true;
    },
  };
}
