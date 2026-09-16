import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Single config file for both Vite (dev/build) and Vitest (test) — vitest/config
// re-exports Vite's defineConfig with the `test` key merged in. Importing
// `defineConfig` from `vite` instead silently drops the whole `test` block
// (handoff §10).
export default defineConfig({
  build: {
    rollupOptions: {
      // Seven HTML entries: the marketing landing page at root (index.html),
      // the console SPA at /app/ (app/index.html — moved out of root
      // 2026-09-07 so the bare domain serves the landing page instead of
      // booting straight into the console), the standalone Timer tool at
      // /tools/timer/ (2026-09-12 — a free community tool, not wired into
      // any event/heat, same "new territory outside the core/formats
      // boundary" precedent as src/marketing/ — see src/tools/CLAUDE.md),
      // Guess the Bean's own organiser entry at /guess-the-bean/ (2026-09-14
      // — a THIRD kind of outside-the-boundary surface: unlike Timer, it has
      // real auth+Supabase, so it lives in src/community/, not src/tools/ —
      // see src/community/guess-the-bean/CLAUDE.md), its PARTICIPANT
      // entry at /guess-the-bean/play/ (2026-09-15, Phase 4 — a separate,
      // unauthenticated page, not a route within the organiser page), and a
      // /community/ hub (2026-09-14, built 2026-09-15) — the landing page's
      // old "Timer" nav link points here instead of straight to /tools/timer/.
      // It is a public link-out shelf for Timer, Guess the Bean, and future
      // community resources; it deliberately imports neither tool itself.
      // Vite's dev
      // server serves all seven by filesystem path with no config needed;
      // only the production build needs to be told about entries beyond the
      // first, or `vite build` silently drops them from dist/.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
        toolsTimer: fileURLToPath(new URL('./tools/timer/index.html', import.meta.url)),
        guessTheBean: fileURLToPath(new URL('./guess-the-bean/index.html', import.meta.url)),
        guessTheBeanPlay: fileURLToPath(
          new URL('./guess-the-bean/play/index.html', import.meta.url),
        ),
        guessTheBeanDisplay: fileURLToPath(
          new URL('./guess-the-bean/display/index.html', import.meta.url),
        ),
        community: fileURLToPath(new URL('./community/index.html', import.meta.url)),
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
