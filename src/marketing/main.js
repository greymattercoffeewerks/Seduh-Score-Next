// Composition root for the marketing landing page — parallel to src/main.js
// for the console, but far simpler: one static page, no router, no auth.
import { mountLandingScreen } from './landingScreen.js';

mountLandingScreen(document.getElementById('app'));
