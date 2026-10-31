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
  // A desktop-width default, above the organiser header's 1366px hamburger
  // cut-over (appShell.css): Playwright's own 1280x720 default would put the
  // nav links behind the hamburger and break every test that clicks one.
  // organiser-flow.spec.js's header test sets its own widths on both sides.
  use: { viewport: { width: 1440, height: 900 } },
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
    {
      // audience-isolation.spec.js (T-TEN.D5): anonymous audiences of TWO organisations against the same real
      // local stack and dev server, so it runs after 'dev-app' for the same shared-backend reason (its own
      // organisations and live sessions are created and removed by the spec, but one organiser's live session
      // per organisation is all it needs, and a concurrent organiser-flow run would only add Realtime load).
      name: 'dev-audience',
      testMatch: /audience-isolation\.spec\.js/,
      dependencies: ['dev-app'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
    {
      // organiser-tenancy.spec.js (T-TEN.E2): the organiser console with two REAL organisations and real people in
      // them (organiser-flow.spec.js fakes the second organisation's answer). Same shared stack, so it runs last.
      name: 'dev-tenancy',
      testMatch: /organiser-tenancy\.spec\.js/,
      dependencies: ['dev-audience'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
    {
      // Puts btc_format back off if an earlier run was killed with it on (see gating-reset.setup.js). Before dev-admin.
      name: 'gating-reset',
      testMatch: /gating-reset\.setup\.js/,
      dependencies: ['dev-tenancy'],
    },
    {
      // admin-console.spec.js (T-ADM.D1): the platform operator's console at /admin/ with a real platform admin
      // (made by SQL, support/admins.js), real TOTP enrolment and challenge, and the database gate. Last, for the
      // same shared-backend reason as the projects above; it also needs the local stack's TOTP switched on
      // (supabase/config.toml [auth.mfa.totp]).
      name: 'dev-admin',
      testMatch: /admin-console.*\.spec\.js/,
      dependencies: ['dev-tenancy', 'gating-reset'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
    {
      // password-recovery.spec.js (D-PW1): the organiser's forgot-password flow through the local stack's mail
      // catcher (Mailpit, port 54424, `[local_smtp]` in supabase/config.toml, which `supabase start` brings up
      // by default). Run it alone with `npx playwright test --project=dev-recovery`. Last, for the same
      // shared-backend reason as the projects above.
      name: 'dev-recovery',
      testMatch: /password-recovery\.spec\.js/,
      dependencies: ['dev-admin'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
    {
      // btc-entitlement.spec.js (T-GATE, the first-flip fixture): btc_format switched on locally through the audited
      // admin key switch with a real platform-admin session (support/grants.js). While the key is on, a BTC go-live for
      // an organisation without a plan is refused, so this runs last and alone; the spec puts the key back off.
      name: 'dev-gating',
      testMatch: /btc-entitlement\.spec\.js/,
      dependencies: ['dev-recovery'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
    {
      // identity-link-live.spec.js (T-ID.B2) , affiliations-live.spec.js and people-screen-live.spec.js (T-ID.C2): the Seduh ID link, the staff/affiliate roster and the People screen over the real local PostgREST with real JWTs (no
      // browser). Last, for the same shared-backend reason; it creates its own organisations and identities.
      name: 'dev-identity',
      testMatch: /(identity-link-live|affiliations-live|people-screen-live)\.spec\.js/,
      dependencies: ['dev-gating'],
      use: { baseURL: 'http://127.0.0.1:5273' },
    },
  ],
});
