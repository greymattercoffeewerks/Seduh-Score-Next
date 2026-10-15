# src/admin/ — the platform operator's console (`/admin/`)

Root non-negotiables apply here too. The spec is `Handoffs and Specs/ADMIN-CONSOLE-SPEC.md` (local, not in
git); the database half is described in `CONVENTIONS.md` ("Platform tables and admin functions").

This is a **fourth kind of surface**, beside `src/tools/`, `src/community/` and `src/formats/`: for the
person who runs the platform, not for an organisation. It reads and writes **no organisation's data**. It
shows organisation metadata (name, slug, members, an event count) and makes organisations and memberships,
all through `SECURITY DEFINER` admin functions that the database gates itself.

## The boundary (enforced by `boundary.test.js`, which fails CI)

- `src/admin/` may import `src/core/` and itself. **Never** a format, never another surface.
- **Nothing outside `src/admin/` may import from it.** The organiser console and the audience pages ship to
  people who must never receive admin code; one stray import from `main.js` would put it in their bundle.
- It does **not** use `core/supabaseClient.js`'s `getSupabase()` (that client shares one localStorage session
  with `/app/` and `/guess-the-bean/`). It builds its own in `adminClient.js` (spec D-A15): its own
  `storageKey`, **sessionStorage** (this tab only), no session read from the URL. It never touches
  `localStorage`. `fetchWithTimeout` from core is reused.
- `core/loginScreen.js` supplies the sign-in **form** (`renderLoginForm`, `validateCredentials`,
  `isInvalidCredentials`). Its `mountLoginScreen` is not used (it is wired to the shared client).

## How the gate works (do not shortcut it)

`gate.js` `checkAccess(client)` answers one of six states; the screens draw it and never decide it.

- **`ready` needs `admin_can_provision()` to return true.** `am_i_platform_admin()` reads the signed token
  only: it still says `{ is_admin: true, aal: 'aal2' }` for a session that was signed out everywhere or whose
  second factor is over an hour old. It is used to learn "admin?" and "which level?", never as proof of a live
  session. A refusal from any later admin call (`isGateRefusal`: `admin_required`, `admin_mfa_required`,
  `admin_session_ended`) is the same signal: a panel calls `ctx.onGateRefused()` and the console runs the check
  again, instead of showing it as an error.
- The database is the authority on who is an admin and whether the second factor is fresh
  (`app.require_platform_admin()`: aal2, a TOTP verification in the last 60 minutes, a live aal2 session row).
  The UI only translates (`adminErrors.js`: hint → words, never matching on a message).
- Enrolment (`mfa.js`) first removes **unverified** factors (they count against `max_enrolled_factors`), and
  only runs for a login with no verified factor: with one present an aal1 session may not unenrol anything.

## Adding a panel (Batches 9 to 11, and gating's "Plan" panel later)

An entry in `panels.js` (`{ id, label, route, mount(host, ctx) }`) plus a screen module. `shell.js` draws the
navigation from the registry and routes by hash; nothing in it changes. A panel that creates something must
**disable its submit control after the first click** and keep the result on screen (the Edge Function answers
a double submit with `[500, 500, 201]`, and the 201 carries the one-time password, which is shown once).

## Tests

Vitest with a fake client (`console.test.js`, `gate.test.js`, `mfa.test.js`) and a real browser against the real
local stack (`tests/e2e/admin-console.spec.js`, Playwright project `dev-admin`). The e2e admin is made by SQL
(`tests/e2e/support/admins.js`), never by the seed. TOTP codes come from `otplib` (dev dependency).

## Headers

`public/_headers` (Workers Static Assets) gives `/admin` and `/admin/*` `X-Robots-Tag: noindex`, `no-store`,
`frame-ancestors 'none'` and `Referrer-Policy: no-referrer`. `admin/index.html` carries the `robots` meta tag
too, which is the guarantee if the headers file ever does not take effect. `robots.txt` deliberately does NOT
list `/admin/`: it would announce the path, and `noindex` is the control.
