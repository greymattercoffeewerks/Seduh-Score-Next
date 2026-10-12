// "This account isn't part of an organisation" (T-TEN.C1) — shown, in front of every console route,
// to someone who signed in fine but belongs to no organisation. That is a real state, not an
// error: an account made for a different product signs in with the same logins, and an owner can also
// remove someone from their org. Showing an empty Events list instead would look like "you have no events", and an
// organiser who was just removed would not know why. Format-agnostic, like loginScreen.js.
//
// The one thing the person can do from here is sign out and use a different account, so that is the
// one action. The shell header carries a Sign out button too; this one is here so the screen is
// complete on its own, and it behaves the same way: a failed attempt (a dropped connection) says so
// and leaves the button ready to try again, rather than the person believing they signed out.
//
// Styled by `.no-org-message` in noOrgScreen.css (every stylesheet is loaded globally by
// app/index.html).
import { getSupabase } from './supabaseClient.js';
import { el, setBusyDisabled } from './dom.js';
import { signOutWithTimeout, unsyncedSignOutWarning } from './signOut.js';
import { listAccountOperations } from './outbox.js';

export const NO_ORG_HEADING = "This account isn't part of an organisation";

export function mountNoOrgScreen(
  outlet,
  {
    client = getSupabase(),
    email = null,
    onSignedOut,
    signal,
    // Injectable like `client`; and how long after the warning appears a press is ignored (a double tap).
    accountOperations = listAccountOperations,
    armGraceMs = 600,
  } = {},
) {
  outlet.innerHTML = '';
  let signingOut = false;
  // Changes this account made earlier may still be waiting on this device: the first press says so (as
  // the header's Sign out does), and the next press signs out.
  let armed = false;
  let armedAt = 0;
  let checking = false;
  let unmounted = false;

  const container = el('section', { className: 'screen-container' });
  // tabindex -1 so the heading can take focus: the router only does that itself when nothing has
  // focus, and a click on a header link leaves focus outside this screen.
  const heading = el('h1', { text: NO_ORG_HEADING, attrs: { tabindex: '-1' } });
  container.appendChild(heading);

  // What is true, then what to do about it. A person removed from their organisation and an account
  // that never belonged to one both land here, so neither paragraph assumes which they are.
  container.appendChild(
    el('p', {
      className: 'no-org-message',
      text:
        (email ? `You are signed in as ${email}. This` : 'This') +
        ' account is not a member of any organisation, so there are no events to show.',
    }),
  );
  container.appendChild(
    el('p', {
      className: 'no-org-message',
      text:
        'If you work with an organisation, ask its owner to add you, then sign out and sign in ' +
        'again. If you meant to use a different account, sign out and sign in with that one.',
    }),
  );

  const feedback = el('div', {
    className: 'screen-feedback',
    attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
  });

  const signOutButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: 'Sign out',
    attrs: { type: 'button' },
  });

  signOutButton.addEventListener('click', async () => {
    if (signingOut || checking) return;
    if (armed && Date.now() - armedAt < armGraceMs) return;
    feedback.textContent = '';
    delete feedback.dataset.tone;
    if (!armed) {
      checking = true;
      let warning;
      try {
        warning = await unsyncedSignOutWarning(email, accountOperations);
      } finally {
        checking = false;
      }
      if (unmounted || signal?.aborted) return;
      if (warning) {
        armed = true;
        armedAt = Date.now();
        feedback.textContent = warning;
        return;
      }
    }
    signingOut = true;
    setBusyDisabled(signOutButton, true);
    signOutButton.textContent = 'Signing out…';
    feedback.textContent = '';

    const failure = await signOutWithTimeout(client);

    // The screen was replaced (a newer navigation, or this one unmounted) while the request was in
    // flight: it must not write to a node that is no longer on screen.
    if (unmounted || signal?.aborted) return;
    if (failure) {
      signingOut = false;
      setBusyDisabled(signOutButton, false);
      signOutButton.textContent = 'Sign out';
      // The live region announces this; focus stays on the button so a keyboard user can retry
      // without tabbing back.
      feedback.textContent = failure;
      feedback.dataset.tone = 'error';
      return;
    }
    // Signed out: the button stays busy until the caller replaces this screen with the sign-in one.
    try {
      onSignedOut?.();
    } catch (err) {
      console.error('noOrgScreen: onSignedOut threw', err);
    }
  });

  container.append(signOutButton, feedback);
  outlet.appendChild(container);
  if (!signal?.aborted) heading.focus();

  return {
    unmount() {
      unmounted = true;
    },
  };
}
