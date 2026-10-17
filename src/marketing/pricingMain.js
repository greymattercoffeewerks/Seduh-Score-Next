// Composition root for the public pricing page. It is static: no router, auth, or
// Supabase is imported here.
import { mountPricingScreen } from './pricingScreen.js';

mountPricingScreen(document.querySelector('#app'));
