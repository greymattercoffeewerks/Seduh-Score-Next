// The admin console's OWN Supabase client (spec D-A15). core/supabaseClient.js builds its client with no
// `storageKey` and the default localStorage, so /app/, /guess-the-bean/ and anything else on this origin share
// one session: signing in at /admin/ with that client would replace the operator's organiser session, and
// signing out here would sign them out there. This client keeps its session under its own key, in
// sessionStorage (one tab, gone when the tab closes): an admin session is short-lived by intent, and a
// second factor is asked for again after about an hour anyway (D-A14).
//
// Constructed lazily, on first real call, like core/supabaseClient.js: importing this module never needs
// VITE_SUPABASE_URL, and a test passes its own client.
import { createClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from '../core/supabaseClient.js';

export const ADMIN_STORAGE_KEY = 'seduh-admin-auth';

// A private, in-memory stand-in for the places where sessionStorage is unavailable or throws (some private
// windows). The console still works; the session just does not survive a reload.
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
    const probe = `${ADMIN_STORAGE_KEY}-probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStorage();
  }
}

export function createAdminClient({ url, anonKey, storage = tabStorage() }) {
  return createClient(url, anonKey, {
    auth: {
      storageKey: ADMIN_STORAGE_KEY,
      storage,
      persistSession: true,
      autoRefreshToken: true,
      // Nothing here arrives through a link (no magic link, no OAuth), and the console's own routes live in
      // the URL hash.
      detectSessionInUrl: false,
    },
    global: { fetch: (input, init) => fetchWithTimeout(input, init) },
  });
}

export const CHECK_STORAGE_KEY = 'seduh-admin-check';

// A throwaway client for ONE job: checking that a typed password is the login's current one (the Change password
// panel, currentPassword.js). It keeps nothing (`persistSession: false`, so the session lives only in this object
// and is never written to storage), refreshes nothing and reads nothing from the URL. It never shares the console
// client's storage key, so signing in with it cannot replace the operator's real session.
export function createCheckClient({ url, anonKey }) {
  return createClient(url, anonKey, {
    auth: {
      storageKey: CHECK_STORAGE_KEY,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: (input, init) => fetchWithTimeout(input, init) },
  });
}

let client;

export function getAdminClient() {
  if (!client) {
    client = createAdminClient({
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    });
  }
  return client;
}

export function getCheckClient() {
  return createCheckClient({
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
}
