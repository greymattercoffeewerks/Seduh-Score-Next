import { createClient } from '@supabase/supabase-js';

// Constructed lazily, on first real call — not at module import time. This
// means importing registry.js (directly or transitively) never requires
// VITE_SUPABASE_URL/ANON_KEY on its own; only an actual network call does, and
// a test that always passes its own injectable client never triggers this at
// all (see registry.js's `client = getSupabase()` default-parameter pattern).
let client;

// Every request gets a hard timeout (2026-09-26, found in review:
// offline-sync-auditor). On flaky venue wifi a half-open connection can
// leave a request pending for minutes; an outbox flush waiting on it never
// settles, and every later flush (a screen's own, the periodic retry) joins
// that same in-flight promise, so nothing drains until the tab reloads. An
// aborted fetch resolves in postgrest-js as `status: 0`, which
// core/outbox.js's isTransientFailure keeps queued. Retrying a write whose
// response was lost is safe: every outbox RPC is idempotent on retry (its
// processed_operations ledger, or publish_session's snapshot_at guard). A
// request aborted here may in principle still be running server-side, but
// the authenticated role's statement timeout (8s) ends it long before 30s.
export const REQUEST_TIMEOUT_MS = 30000;

export function fetchWithTimeout(input, init = {}, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  // Older browsers (Safari < 16) lack AbortSignal.timeout — send the request
  // as before rather than failing every Supabase call outright.
  if (typeof AbortSignal.timeout !== 'function') return fetch(input, init);
  const timeout = AbortSignal.timeout(timeoutMs);
  // A caller's own signal (supabase-js passes one for an explicit abort)
  // still works; without AbortSignal.any (Safari < 17.4) it falls back to
  // the caller's signal alone — no timeout — rather than dropping the
  // caller's abort.
  let signal = timeout;
  if (init.signal) {
    signal =
      typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, timeout]) : init.signal;
  }
  return fetch(input, { ...init, signal });
}

export function getSupabase() {
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      { global: { fetch: (input, init) => fetchWithTimeout(input, init) } },
    );
  }
  return client;
}
