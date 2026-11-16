// Entry for "My Seduh ID" (/id/me/). Served from its own built page by the edge Worker (worker/index.js), never as a person
// page: `me` is a reserved handle. It uses the competitor's own Supabase client (claimClient.js), never an organiser's or the
// admin console's session.
import { createMeApi } from './meApi.js';
import { mountMeScreen } from './meScreen.js';

mountMeScreen(document.querySelector('#app'), { api: createMeApi() });
