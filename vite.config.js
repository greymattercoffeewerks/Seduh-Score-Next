import { defineConfig } from 'vitest/config';

// Single config file for both Vite (dev/build) and Vitest (test) — vitest/config
// re-exports Vite's defineConfig with the `test` key merged in. Importing
// `defineConfig` from `vite` instead silently drops the whole `test` block
// (handoff §10).
export default defineConfig({
  server: {
    // Bind explicitly to IPv4 loopback — on Windows, Vite's default host
    // resolves to the IPv6 loopback first, which some local tooling can't
    // reach at 127.0.0.1.
    host: '127.0.0.1',
  },
  preview: {
    // Same reasoning as `server.host` above — Playwright's webServer
    // readiness check hits 127.0.0.1 specifically.
    host: '127.0.0.1',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'supabase/functions/**/*.test.js'],
    setupFiles: ['./src/testSetup.js'],
  },
});
