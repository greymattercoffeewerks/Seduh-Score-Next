// Composition root for the public Results archive. Static: no router, auth,
// or Supabase — see resultsScreen.js's own header comment for the full plan.
import { mountResultsScreen } from './resultsScreen.js';

mountResultsScreen(document.querySelector('#app'));
