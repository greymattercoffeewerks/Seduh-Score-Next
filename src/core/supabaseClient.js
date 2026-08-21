import { createClient } from '@supabase/supabase-js';

// Constructed lazily, on first real call — not at module import time. This
// means importing registry.js (directly or transitively) never requires
// VITE_SUPABASE_URL/ANON_KEY on its own; only an actual network call does, and
// a test that always passes its own injectable client never triggers this at
// all (see registry.js's `client = getSupabase()` default-parameter pattern).
let client;

export function getSupabase() {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
    );
  }
  return client;
}
