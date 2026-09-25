// Composition root for the public trust pages. Each page's HTML entry names its
// page in `data-page`, so one module serves About, Contact, Privacy, Terms and
// Neutrality. Static: no router, auth, or Supabase.
import { mountTrustScreen } from './trustScreen.js';

const root = document.querySelector('#app');
mountTrustScreen(root, root.dataset.page);
