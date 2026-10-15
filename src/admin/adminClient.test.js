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
      storage.removeItem('a');
      expect(storage.getItem('a')).toBeNull();
      expect(window.localStorage.getItem('a')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
