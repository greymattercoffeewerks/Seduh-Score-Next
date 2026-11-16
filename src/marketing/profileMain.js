// Entry for the Seduh ID person pages (/id/<handle>/). One shell serves every handle (worker/index.js); the page reads
// its handle from the path and asks the anonymous profile door.
import { mountProfileFromLocation } from './profileScreen.js';

mountProfileFromLocation(document.querySelector('#app'));
