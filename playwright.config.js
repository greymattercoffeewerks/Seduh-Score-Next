import { defineConfig } from '@playwright/test';

// Two servers, two projects — not one. `npm run build` only outputs
// index.html (confirmed directly: `dist/` has no `.preview.html` files);
// the format demo harnesses (timingScreen.preview.html and friends) are
// dev-server-only by design, per every one of their own header comments
// ("not part of the shipped module graph"). smoke.spec.js keeps testing
// the real production build unchanged; cross-surface-countdown.spec.js
// needs the dev server instead, since it drives those harnesses directly.
//
// `webServer` only exists as a TOP-LEVEL config field in this Playwright
// version (confirmed against node_modules/playwright/types/test.d.ts —
// the per-project `Project` type has no `webServer` field at all; only the
// internal, Playwright-populated `FullProject` result type does). A
// per-project `webServer` entry is silently ignored, not an error — found
// the hard way: both projects broke (neither server started) when this was
// first tried. So both servers DO start for either project, even though
// 'dev-harnesses' never touches port 4173 — an incidental coupling, not a
// real dependency, but not avoidable at this Playwright version.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  webServer: [
    {
      command: 'npm run preview',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      port: 5273,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'built-app',
      testMatch: /smoke\.spec\.js/,
      use: { baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'dev-harnesses',
      testMatch: /cross-surface-countdown\.spec\.js/,
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
    {
      // organiser-flow.spec.js (2026-08-29 app-wiring pass) — the real
      // app (main.js/index.html), not a demo harness, so it shares
      // 'dev-harnesses' own dev-server baseURL rather than 'built-app''s
      // preview server. Needs a real local Supabase stack + supabase/
      // seed.sql's fixed org/login to be running alongside it (see
      // ci.yml's 'playwright' job); a plain local dev machine already has
      // both if `supabase start` has been run.
      //
      // `dependencies: ['dev-harnesses']` — found running the full suite:
      // fullyParallel means every project runs concurrently by default,
      // and cross-surface-countdown.spec.js's own ~25s real-time test
      // (three browser contexts) contending with this project's real
      // Supabase Realtime connection on the SAME shared dev server made
      // organiser-flow.spec.js's own live-route assertions intermittently
      // miss their timeout — real resource contention, not an app bug
      // (each project passes reliably alone). Since both projects share
      // the one dev server AND the one local Supabase stack, running them
      // sequentially is the actual fix, not a longer timeout that would
      // just move the flake threshold.
      name: 'dev-app',
      testMatch: /organiser-flow\.spec\.js/,
      dependencies: ['dev-harnesses'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
  ],
});
