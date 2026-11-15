// Entry for the Seduh ID person pages (/id/<handle>/). One shell serves every handle (worker/index.js); this placeholder
// reads nothing from the path yet.
import { mountProfilePlaceholder } from './profileScreen.js';

mountProfilePlaceholder(document.querySelector('#app'));
