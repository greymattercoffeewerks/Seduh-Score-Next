// Composition root for the public Tour. It is static: no router, auth, or
// competition implementation is imported here.
import { mountTourScreen } from './tourScreen.js';

mountTourScreen(document.querySelector('#app'));
