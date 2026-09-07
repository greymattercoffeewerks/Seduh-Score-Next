import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Single config file for both Vite (dev/build) and Vitest (test) — vitest/config
// re-exports Vite's defineConfig with the `test` key merged in. Importing
// `defineConfig` from `vite` instead silently drops the whole `test` block
// (handoff §10).
export default defineConfig({
  build: {
    rollupOptions: {
      // Two HTML entries, not one: the marketing landing page at root
      // (index.html) and the console SPA at /app/ (app/index.html — moved
      // out of root 2026-09-07 so the bare domain serves the landing page
      // instead of booting straight into the console). Vite's dev server
      // serves both by filesystem path with no config needed; only the
      // production build needs to be told about the second entry, or
      // `vite build` silently drops it from dist/.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      },
    },
  },
  server: {
    // Bind explicitly to IPv4 loopback — on Windows, Vite's default host
    // resolves to the IPv6 loopback first, which some local tooling can't
    // reach at 127.0.0.1.
    host: '127.0.0.1',
    // Pinned off Vite's own default (5173), +100 — same offset convention
    // supabase/config.toml already uses for this project's whole local
    // stack, for the same reason: this machine also runs the sibling
    // Kira-Kira repo's own dev server, which defaults to 5173 unedited.
    // Negotiated directly with that project (2026-09-04) rather than
    // guessed — see .claude/launch.json's own `autoPort: true` as the
    // belt-and-suspenders fallback if a third project ever lands on this
    // exact port too.
    port: 5273,
  },
  preview: {
    // Same reasoning as `server.host` above — Playwright's webServer
    // readiness check hits 127.0.0.1 specifically.
    host: '127.0.0.1',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'supabase/functions/**/*.test.js', 'eslint-rules/**/*.test.js'],
    setupFiles: ['./src/testSetup.js'],
  },
});
