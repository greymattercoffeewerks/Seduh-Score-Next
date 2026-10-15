import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ fake: true })) }));

import { createClient } from '@supabase/supabase-js';
import { createAdminClient, tabStorage, ADMIN_STORAGE_KEY } from './adminClient.js';

beforeEach(() => {
  createClient.mockClear();
});

describe("createAdminClient (spec D-A15: its own session, not the organiser console's)", () => {
  it('stores its session under its own key, in the storage it was given', () => {
    const storage = { getItem() {}, setItem() {}, removeItem() {} };
    createAdminClient({ url: 'http://x.test', anonKey: 'k', storage });
    const [url, key, options] = createClient.mock.calls[0];
    expect(url).toBe('http://x.test');
    expect(key).toBe('k');
    expect(options.auth.storageKey).toBe(ADMIN_STORAGE_KEY);
    expect(options.auth.storage).toBe(storage);
  });

  it("its key is not the default one the organiser console's client uses", () => {
    // core/supabaseClient.js passes no storageKey, so supabase-js derives sb-<project>-auth-token from the
    // URL. A fixed, different name is what keeps the two sessions apart.
    expect(ADMIN_STORAGE_KEY).toBe('seduh-admin-auth');
    expect(ADMIN_STORAGE_KEY).not.toMatch(/^sb-/);
  });

  it("does not read a session from the URL (the hash holds the console's own routes)", () => {
    createAdminClient({ url: 'http://x.test', anonKey: 'k', storage: {} });
    expect(createClient.mock.calls[0][2].auth.detectSessionInUrl).toBe(false);
  });

  it('keeps its default storage in this tab (sessionStorage), never localStorage', () => {
    createAdminClient({ url: 'http://x.test', anonKey: 'k' });
    expect(createClient.mock.calls[0][2].auth.storage).toBe(window.sessionStorage);
    expect(createClient.mock.calls[0][2].auth.storage).not.toBe(window.localStorage);
  });
});

describe('tabStorage', () => {
  it('falls back to a working in-memory store when sessionStorage throws', () => {
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const storage = tabStorage();
      storage.setItem('a', 1);
      expect(storage.getItem('a')).toBe('1');
      // Checked while the value is stored: it must be nowhere in localStorage (the organiser console's).
      expect(window.localStorage.getItem('a')).toBeNull();
      expect(window.localStorage).toHaveLength(0);
      storage.removeItem('a');
      expect(storage.getItem('a')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('createAdminClient keeps the session across reloads and refreshes it', () => {
  it('persists the session and refreshes the token (a reload keeps the sign-in; an hour does not end it)', () => {
    createAdminClient({ url: 'http://x.test', anonKey: 'k', storage: {} });
    const { auth } = createClient.mock.calls[0][2];
    expect(auth.persistSession).toBe(true);
    expect(auth.autoRefreshToken).toBe(true);
  });
});

describe('getAdminClient', () => {
  it('builds one client from the build variables, in sessionStorage, and reuses it', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example-ref.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-test');
    try {
      const fresh = await import('./adminClient.js');
      createClient.mockClear();
      const first = fresh.getAdminClient();
      const second = fresh.getAdminClient();
      expect(second).toBe(first);
      expect(createClient).toHaveBeenCalledTimes(1);
      const [url, key, options] = createClient.mock.calls[0];
      expect(url).toBe('https://example-ref.supabase.co');
      expect(key).toBe('anon-key-for-test');
      expect(options.auth.storage).toBe(window.sessionStorage);
      expect(options.auth.storage).not.toBe(window.localStorage);
      expect(options.auth.storageKey).toBe('seduh-admin-auth');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
