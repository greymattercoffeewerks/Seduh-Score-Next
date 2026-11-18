// Entry for the Seduh ID pages under /id/. One shell serves every handle (worker/index.js); the page reads its handle from
// the path and asks the anonymous profile door. The bare /id/ path is the discovery hub (T-ID2.C5): search and browse,
// which the database keeps closed until the owner opens it (core/seduhDiscovery.js).
import { mountHub } from './hubScreen.js';
import { mountProfileFromLocation } from './profileScreen.js';

const root = document.querySelector('#app');
if (/^\/id\/?$/.test(window.location.pathname)) {
  mountHub(root);
} else {
  mountProfileFromLocation(root);
}
