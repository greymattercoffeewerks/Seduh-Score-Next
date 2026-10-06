// Composition root for the public Results archive. Static: no router, auth, or Supabase client of
// its own — see resultsScreen.js's own header comment for the full plan. `?sheet=<event id>` shows
// that event's printable results sheet (resultsSheet.js) instead of the archive.
import { mountResultsScreen } from './resultsScreen.js';
import { mountResultsSheet } from './resultsSheet.js';

const root = document.querySelector('#app');
const sheetEventId = new URLSearchParams(window.location.search).get('sheet');

if (sheetEventId) mountResultsSheet(root, { eventId: sheetEventId });
else mountResultsScreen(root);
