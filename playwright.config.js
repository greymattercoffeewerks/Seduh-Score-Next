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
      port: 5173,
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
      use: { baseURL: 'http://127.0.0.1:5173' },
    },
  ],
});
