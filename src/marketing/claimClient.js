// The COMPETITOR's own Supabase client (T-ID2.B3b), the same idea as the admin console's (src/admin/adminClient.js, D-A15).
// core/supabaseClient.js builds its client with the default storage key in localStorage, so the console, Guess the Bean and
// anything else on this origin share one session: signing in here with that client would REPLACE an organiser's session
// (a person who is also an organiser, on the same browser). This client keeps its session under its own key, in
// sessionStorage (one tab, gone when it closes), and never reads a session out of the URL. It is not the admin client and
// shares nothing with it: a competitor login has no organisation and no admin rights.
//
// Constructed lazily, on the first real call, like core/supabaseClient.js: importing this module never needs the
// VITE_SUPABASE_* variables, and a test passes its own client.
import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from '../core/supabaseClient.js';

export const COMPETITOR_STORAGE_KEY = 'seduh-competitor-auth';

// A private in-memory stand-in for the places where sessionStorage is unavailable or throws (some private windows). The
// claim still works; the session just does not survive a reload.
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function tabStorage() {
  try {
    const storage = window.sessionStorage;
    const probe = `${COMPETITOR_STORAGE_KEY}-probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}

export function createCompetitorClient({ url, anonKey, storage = tabStorage() }) {
  return createClient(url, anonKey, {
    auth: {
      storageKey: COMPETITOR_STORAGE_KEY,
      storage,
      persistSession: true,
      autoRefreshToken: true,
      // The claim token lives in the URL fragment and is the page's own business; Auth must never read a session from it.
      detectSessionInUrl: false,
    },
    global: { fetch: (input, init) => fetchWithTimeout(input, init) },
  });
}

let client;

export function getClaimClient() {
  if (!client) {
    client = createCompetitorClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    });
  }
  return client;
}
