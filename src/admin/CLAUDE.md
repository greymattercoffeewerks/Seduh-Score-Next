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
  only runs for a login with no verified factor (it refuses outright when one exists: with one present an aal1
  session may not unenrol anything). What GoTrue returns is validated before it is drawn.
- **`ready` is not a snapshot.** While the console is open the gate is asked again when the tab becomes visible
  and every five minutes (`console.js`); a changed answer replaces the console, an unchanged one leaves it alone.
- **Sign-out is retried against the server.** auth-js drops the local session even when its logout request
  fails, so `gate.js signOut` keeps the token in memory after a failure and the next attempt revokes THAT token
  on the server (`auth.admin.signOut(token, scope)`), never reporting success on its own. "Sign out everywhere"
  is the stolen-token response; do not "simplify" this back to `auth.signOut()`.

## The Organisations panel (`orgsPanel.js`, Batch 9)

`#/orgs` is the list, `#/orgs/<organisation id>` one organisation (members, counts, its recent audit
entries). The shell routes by the FIRST segment of the hash; this panel listens for hash changes itself to move
between its two views and ignores a hash that does not change what it shows (a `hashchange` can arrive for a hash
set just before it mounted). An id that is not a UUID is "not found" without asking the database.

- It draws **only the fields it names** (name, link name, dates, counts, member email and role, audit action and
  actor): never an event name, a score, or a person who is not a member (spec D-A4). The functions do not return
  them (pgTAP 048); `tests/e2e/admin-console-orgs.spec.js` proves, against the real database, that an event the
  organisation ran appears neither on the page nor in any admin response. Keep it that way: a new field is a
  deliberate edit here, not something that appears because a function started returning it.
- Every request goes through `ctx.callAdmin` and every failure is translated by `adminErrors.js`; a gate refusal
  draws nothing of its own (the console is re-checking access and replaces the panel). A failed audit load does
  not hide the organisation.
- Text only (`el()`), never `innerHTML`; dates are UTC `YYYY-MM-DD` (`format.js`), so they read the same on every
  machine.

## The New organisation panel (`createOrgPanel.js`, Batch 10)

`#/new-org`: a name, a link name and an owner, where the owner is a NEW login (the `admin-accounts` Edge Function,
through `ctx.callFunction`) or an EXISTING account (`admin_find_user`, then a confirmation). It ends in
`admin_create_org`. Things that must stay true:

- **The database is the authority.** `orgRules.js` says what a name and link name look like while a person types
  (`orgRules.test.js` reads the newest migration and fails when the reserved list drifts from `create_org`'s), but a
  refusal is always shown by its stable hint through `adminErrors.js`, never by a message, and a value the page
  called fine can still be refused (a taken link name, the operator's own account).
- **A login is never made twice.** The login is made first, then the organisation. If the organisation step fails,
  the login and its password stay on screen (`created`), the form stays editable, and the next press attaches THAT
  login. A timeout or a dropped connection on either step is its own sentence ("may exist"), not "nothing was changed".
- **The one-time password lives only in `created` / `done.login` and the node that shows it.** Not in storage, a URL,
  an attribute or a log; dropped (memory and page) on `unmount`, on a gate refusal and on Done; not re-shown after a
  reload. In the real console a gate refusal makes the console unmount the panel before the answer is read, so
  `stepAside` is the same clean-up for when it has not. While the password is the only copy: the browser is asked
  before the page is closed or reloaded (`beforeunload`), and the shell asks before another panel or a sign-out
  replaces the panel (`leaveWarning()` on the mount handle, `shell.js`). If it is lost anyway (a gate refusal, or
  the person said yes), the next opening of the panel says so once, naming the login (`lostPassword`, the email only).
  A login whose organisation was never made is an orphan: attach it with "Use an existing account" and set a password
  for it in the Supabase dashboard.
- **A request that may have been carried out is never reported as "nothing changed".** An error with no hint (a
  dropped connection, a timeout, a gateway error) at either step says the login or organisation MAY exist
  (`loginFailureMessage`, `orgFailureMessage`); only an error the database raised (it has a hint) is "refused". The
  login request waits 30 seconds, not the page-load 10 (`adminFunction.js`): giving up on a request that is still
  running throws away the only copy of the password.
- **Existing accounts:** `needs_attestation` (the SAME predicate the database enforces) decides whether the box to
  tick is shown; the panel also handles the database refusing with `member_password_unset` for an account that gained
  a membership after the lookup (it looks again, so the box appears). A lookup answers for the address it was asked
  about: typing another address, or switching the owner kind, throws the answer (and a request still out) away.
- The owner section is built once and its parts shown or hidden: rebuilding the radios would take keyboard focus away
  from the radio being used.
- `ctx.callFunction(name, body)` is what a panel uses for an Edge Function (`adminFunction.js`): same `{ data, error }`
  shape as `callAdmin`, the error carries only `{ status, hint, userId, timedOut, offline }` (never the function's
  text), and a gate refusal or HTTP 401 sends the whole console back through the access check.
- `tests/e2e/admin-console-create-org.spec.js` runs the organisation step against the real database. CI does not
  serve the Edge Function, so that spec answers `admin-accounts` at the network edge; the real function is covered by
  `supabase/tests/manual/admin-accounts-e2e.mjs` before rollout.

## Members, roles and the Audit log (Batch 11)

- **On an organisation's detail** (`orgsPanel.js`, with `memberActions.js`): "Add a member" attaches an EXISTING
  account (`accountLookup.js`: exact-email `admin_find_user`, a confirmation of what was found, the attestation box
  when `needs_attestation`) with a role, through `admin_add_member`; each member has a role button (the other role,
  after a "Change X from A to B?" confirmation) through `admin_set_role`. Making a NEW login stays in the New
  organisation panel only. After either change the detail is drawn again from the database with a one-line notice,
  so what is shown is what the database now says, not what the page believes it asked for.
- **The database decides every refusal** (the last owner is `last_owner`, the operator's own account is
  `admin_self_target`, an account whose password someone else may know is `member_password_unset`): this code only
  translates the hint (`adminErrors.js`). A request that may have been carried out is never reported as "nothing
  changed": an error with no hint says the member may have been added / the role may have changed
  (`ADD_STATE_UNKNOWN`, `ROLE_STATE_UNKNOWN`).
- **`accountLookup.js` is the lookup the Add member form uses.** The New organisation panel still has its own copy of
  the same logic (a known duplication, to be folded into this module in a follow-up: its tests refer to `#adm-attest`
  where this module's box is `#adm-member-attest`, and the two differ on whether an error clears on every keystroke);
  the four messages are shared, change the rest of both together until they are one.
- **One change at a time on a detail**: `memberActions.js` takes a page-wide claim (`writes.begin()`) so two role
  changes, or one and an add, never run at once; the second is told to wait instead of being dropped when the first
  redraws the page. A failure frees the claim; a success leaves it to the redraw.
- **Labels and focus (reviewed):** the role button's accessible name starts with its visible words ("Make owner:
  <email>", WCAG 2.5.3); empty live error lines stay in the accessibility tree (clipped, never `display:none`); a
  refusal moves focus to its own message, a failed page of the Audit log to its Retry.
- **The Audit log** (`auditPanel.js`, route `#/audit`): newest first, 50 at a time, paged with `p_before` = the
  SMALLEST id shown. A failed page keeps what is shown and retries that same page. `auditView.js` is the one place an
  entry is worded and drawn (shared with the detail's recent changes); it draws only the documented fields (never a
  `detail` value beyond `role`, `from`, `to`, `attested`) and links the organisation only while its link name still
  resolves.
- A role this console does not know (`steward`, `constructor`) gets no role button; role lookups use own properties
  only (`Object.hasOwn`), because a role is data from a server.

## Adding a panel (gating's "Plan" panel is the next)

An entry in `panels.js` (`{ id, label, route, mount(host, ctx) }`) plus a screen module. `shell.js` draws the
navigation from the registry and routes by hash; nothing in it changes (`ctx` also carries `callFunction(name, body)`
for an Edge Function; `panelRequest.js` `ask` wraps `callAdmin` so it never rejects and times out). **A panel calls admin functions through
`ctx.callAdmin(name, args)`, never `ctx.client.rpc`**: a gate refusal in the answer (stale second factor, ended
session) then sends the whole console back through the access check, so no panel has to remember to look for it
(an ordinary refusal such as `org_not_found` is the panel's own business, translated with `adminErrors.js`).
Panels get their own screen module. The shell's skip button already takes a keyboard user to the content. A
panel that creates something must
**disable its submit control after the first click** and keep the result on screen (the Edge Function answers
a double submit with `[500, 500, 201]`, and the 201 carries the one-time password, which is shown once).

## Tests

Vitest with a fake client (`console.test.js`, `gate.test.js`, `mfa.test.js`) and a real browser against the real
local stack (`tests/e2e/admin-console.spec.js`, Playwright project `dev-admin`). The e2e admin is made by SQL
(`tests/e2e/support/admins.js`), never by the seed. TOTP codes come from `otplib` (dev dependency).

## Headers

`public/_headers` (Workers Static Assets) gives `/admin` and `/admin/*` `X-Robots-Tag: noindex`, `no-store`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, and a script-restricting
`Content-Security-Policy` (scripts, styles and fonts from this site only, connections to this site and
`*.supabase.co` only, no inline code: the admin session sits in sessionStorage, readable by any script that runs
on the page). `headers.test.js` pins it. **A change that adds an inline style or script, an off-site resource, or
a Supabase address that is not under `*.supabase.co` must change that policy in the same commit.** The Vite dev
server does not apply the file, so local runs and Playwright never see the policy: check it with `npm run build`
and `npx wrangler dev`. `admin/index.html` carries the `robots` meta tag
too, which is the guarantee if the headers file ever does not take effect. `robots.txt` deliberately does NOT
list `/admin/`: it would announce the path, and `noindex` is the control.

## Duplication closed (was accepted at Batch 8; closed 2026-10-15)

None left of the two that were accepted at Batch 8: the generic `.card`, `.btn*`, `.form-field*`, `.field-input`
and `.screen-feedback` shapes now live once in `src/ui/tokens/components.css` (linked first by `admin/index.html`;
`admin.css` keeps only the three places the console differs, see its "where the admin console differs" block), and
the sign-in and sign-out requests are `src/core/signInRequest.js` and `src/core/signOutRequest.js`, shared with the
organiser console. `gate.js signOut` still adds the server-side revocation retry on top of the shared request.
Proposed for the shared shapes too, and held back so the organiser console does not change: a busy button that
keeps its colour (the dimmed `opacity: 0.6` is about 3:1) and control borders at 3:1 or better (WCAG 1.4.11);
raise it with the owner, then delete the overrides here.
