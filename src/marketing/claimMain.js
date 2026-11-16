// Entry for the claim page (/id/claim/#<token>). The token is in the URL FRAGMENT, so it never reached a server. It is taken
// out of the address bar at once (replaceState) and kept in memory only: it is not put in storage, not logged and not sent
// anywhere but the two calls that redeem it. A reload therefore asks the person to open their link again, which is safe
// (the link is valid until used, for 72 hours).
//
// A second link opened in the SAME tab (a new link pasted in after an old one failed) changes only the fragment, so the page
// does not reload: it hears `hashchange` and starts again with the new token.
import { createClaimApi } from './claimApi.js';
import { readClaimToken } from './claimFlow.js';
import { mountClaimScreen } from './claimScreen.js';

const root = document.querySelector('#app');
const api = createClaimApi();
let screen = null;

function start() {
  const token = readClaimToken(window.location.hash);
  const hadHash = window.location.hash !== '';
  if (hadHash) {
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // an address bar that cannot be changed is not a reason to stop
    }
  }
  // Nothing in the fragment (our own replaceState above does not fire hashchange): keep the screen the person is on.
  if (!hadHash && screen) return;
  screen?.unmount();
  screen = mountClaimScreen(root, { api, token });
}

window.addEventListener('hashchange', start);
start();
