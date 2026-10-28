# Admin console: password change and recovery (design proposal)

_Status: PROPOSAL for the owner's decision, written 2026-10-28. No code, no migration, no dashboard change, nothing against the cloud. Nothing here is built until the owner answers section 8. The admin gate (`app.require_platform_admin`) is not touched by any option._

Companions: `ADMIN-CONSOLE-SPEC.md` (gate, D-A5, D-A14, D-A15; local), `PASSWORD-RECOVERY-SPEC.md` (D-PW1 to D-PW8, D-PW3 is this document's subject; local), `src/admin/CLAUDE.md`, `src/core/passwordForm.js`, `passwordChange.js`, `passwordRecovery.js`, `recoveryScreen.js`, `changePasswordScreen.js`.

Legend: **[V]** verified against code or a cited source in this session; **[U]** unverified, with what would verify it.

---

## 1. The current gap and its real risk

**What exists.** `/admin/` has sign-in, the authenticator (TOTP) enrol and challenge, four panels, and "Sign out" / "Sign out everywhere". It has no change-password screen and no recovery [V: `src/admin/panels.js`, `shell.js`]. The first admin's password is the random temporary password set by SQL at rollout (CLAUDE.md, "Add the first or another admin", step d). CLAUDE.md says it "stays until it is rotated from the Supabase dashboard (send a password recovery email)".

**Three findings that sharpen the picture:**

1. **The documented rotation route does not work for an admin with an authenticator.** A dashboard "send recovery email" link signs the person in at `aal1`. The login has a verified factor, so GoTrue refuses a password change from an `aal1` session. Confirmed in GoTrue's source: `if user.HasMFAEnabled() && !session.IsAAL2()` on a password or email change returns `insufficient_aal`, "AAL2 session is required to update email or password when MFA is enabled." [V: `supabase/auth` `internal/api/user.go` on master, fetched 2026-10-28; the version deployed to the cloud project is **[U]**]. On top of that, the link lands on `site_url`, a page with nothing listening (the 2026-10-22 incident, PASSWORD-RECOVERY-SPEC section 1) [V]. So today the only working rotation is the one the runbook already uses for the temporary password: the Auth admin API with the service key, or SQL `encrypted_password` (CLAUDE.md step a) [V: documented, used at rollout]. "Dashboard-only rotation" should read "service-key or SQL rotation only".
2. **The missing screen does not stop an `aal2` session changing the password.** `PUT /auth/v1/user` is GoTrue's, not ours. A live `aal2` session (the operator's, or a stolen one) can already change the password by calling it directly; the console just has no button. **Option (a) therefore adds no server capability.** It adds a UI to a capability that already exists [V by the same source]. Consequence for the threat model in section 4: the attack a "Change password" screen could enable is already available to anyone holding such a session.
3. **D-A14's 60-minute window does not apply to a password change.** The freshness rule lives in our database function; GoTrue only asks "is this session `aal2`". A stolen refresh token that is older than 60 minutes since its TOTP verification can no longer call an admin function but can still change the password (and with `scope: 'others'` sign the owner out). This is existing behaviour, not caused by any option here [V by the source above; **[U]** that no cloud setting changes it, see 5.3].

**Risk of the long-lived temporary password.** The password alone gives an `aal1` session: it can call `am_i_platform_admin()` and nothing else, cannot enrol a second factor while a verified one exists (pinned: `tests/e2e/admin-console-adversarial.spec.js` ~706 to 712, `admin-accounts-e2e.mjs` ~319 to 328) [V], and cannot change the password (finding 1). So a leaked temporary password costs the second factor's independence (the admin is protected by TOTP alone) and a stalking foothold, not a takeover. Where the temporary password has been (a chat transcript, a shell, an MCP tool result, the Auth log of a service-key `PUT`) is **[U]**; CLAUDE.md says the first admin replaced it with a long random one kept in a password manager, which this document cannot confirm. Severity: **low to medium, hygiene rather than emergency**, but it should not stay open indefinitely, and it recurs with every new admin.

---

## 2. Facts the options rest on

| Fact | Status |
| --- | --- |
| The admin client is `createClient(..., { storageKey: 'seduh-admin-auth', storage: sessionStorage, detectSessionInUrl: false })`; `flowType` is not set, so auth-js's default (implicit) applies. | [V: `src/admin/adminClient.js`] |
| `src/admin/` may import `src/core/` and itself; nothing outside may import it; `boundary.test.js` enforces. `core/passwordForm.js`, `passwordChange.js`, `passwordRecovery.js`, `signOutRequest.js`, `timeout.js` are all core and format-agnostic. | [V: `src/admin/CLAUDE.md`] |
| The admin page already loads `src/core/loginScreen.css` (the `.login-form` / `.login-screen` classes `mountPasswordFormScreen` uses) and `components.css`. | [V: `admin/index.html`] |
| `mountPasswordFormScreen` accepts `heading`, `intro`, `save`, `onSaved`, `describeError`, `footer`. Its checks (`validateNewPassword`, minimum **8**) are fixed inside it, not a parameter. Its default `describeError` words `insufficient_aal` as "Ask the Seduh Score team to help you", which is wrong for an admin (the operator IS the team). The admin screen must pass its own `describeError`. | [V: `passwordForm.js`] |
| `savePasswordAndEndOtherSessions(client, password)` does `updateUser({ password, data: { must_change_password: false } })` then `signOut({ scope: 'others' })`; a failed sign-out of others is reported as `othersSignedOut: false`, not as a failed save. | [V: `passwordChange.js`] |
| auth-js (installed 2.112.3) does **not** remove the local session after `signOut({ scope: 'others' })`, success or failure; it does for `local` and `global`. | [V: `GoTrueClient.js` ~3427 to 3436] |
| The installed client's `UserAttributes` type has `current_password`. GoTrue enforces it only if the project setting "require current password" is on, and skips it for a recovery session. Whether that setting exists on this project's plan, and whether sending the field with the setting off is ignored, is **[U]**. | type [V: `types.d.ts:423`]; source [V: user.go]; plan/behaviour [U] |
| `secure_password_change` ("reauthentication"): when on, a password change from a session older than 24 hours needs an emailed nonce (`reauthenticate()`), which needs working email. Local config has it off. Cloud value **[U]**. | [V: user.go, `config.toml:236`, Supabase docs "Password security"]; cloud [U] |
| The recovery email template is **one per project**, shared by the organiser console and any admin flow; `{{ .RedirectTo }}`, `{{ .TokenHash }}`, `{{ .SiteURL }}` exist as template variables, so one button-gated template (D-PW4) can serve both consoles by passing a different `redirectTo`. | [V: Supabase docs "Customizing email templates"] |
| Built-in sender: low limits, "delivers only to your team's addresses" per Supabase docs; the cloud limit is **[U]**. The owner's admin address is an Outlook mailbox, the very scanner case in the 2026-10-22 incident. | [V: PASSWORD-RECOVERY-SPEC]; cloud limit [U] |
| The organiser console already implements the recovery arrival (`takeRecoveryArrival` strips the hash before routing; `createRecoveryFlow` verifies, detects the authenticator case and ends the aal1 session). It refuses MFA accounts and points to the operator runbook. | [V: `core/passwordRecovery.js`] |
| `ready` in the admin gate needs `admin_can_provision()` true (aal2, TOTP within 60 minutes, live aal2 session row). Nothing in the gate knows how a session was created (password, recovery link) or whether `amr` contains `password`. | [V: `gate.js`, spec D-A14] |
| An `aal1` session cannot enrol or unenrol a factor when a verified one exists. | [V: adversarial spec, manual script] |

---

## 3. Options

### Option (a): Change password screen inside the console, for a signed-in `aal2` admin

**What.** A panel `password` (route `#/password`, nav label "Change password") in `panels.js`, mounted only when the gate is `ready`. It uses `mountPasswordFormScreen` and `savePasswordAndEndOtherSessions` from core with the admin client (`ctx.client`), with its own `describeError` (admin wording for `insufficient_aal`, `same_password`, `weak_password`, `over_request_rate_limit`, `session_not_found` etc.) and its own success message. It is not an admin function, so it does not use `ctx.callAdmin`; the console's existing five-minute and on-visible gate re-check covers a session that ended.

**Behaviour.**
1. The form asks for the new password twice (and the current password, see decision D3).
2. Save: `updateUser({ password })`, then `signOut({ scope: 'others' })` exactly as D-PW1/D-PW6. A failed others-sign-out is told in words and points to the existing "Sign out everywhere" button (global, which also ends this session) as the remedy. The existing `gate.js signOut` revocation-retry covers that button.
3. Success leaves the person signed in (this session is the one that proved password-and-authenticator a moment ago).

**Security properties.**
- No new server capability (section 1, finding 2). The new surface is one more form on a page with a strict CSP and no inline code (`headers.test.js`); no new connection origin, so the CSP is unchanged.
- The new password lives only in the form's input and the request; not stored, not logged. `autocomplete="new-password"` from the shared form.
- The other sessions are ended, so a thief holding the old session loses it if the change is made after theft.

**Threat-model changes.**
| Threat | Effect of (a) |
| --- | --- |
| Stolen live admin session (`aal2`) | Unchanged: the thief could already call `PUT /user`. The screen makes no difference to what they can do. Real mitigations are server-side and only partly available: the dashboard's "require current password" setting if the plan offers it (D3; the form-only fallback does not help here), and D-PW7's notification email later. Not in this option. Existing response is unchanged: ban the account, "Sign out everywhere". |
| Walk-up at an unlocked console | New convenience for the attacker (a form). Mitigated by asking for the current password (D3; works for the UI path in either variant). Without it, an unlocked console lets someone set a password they know; they would still need the authenticator for a fresh sign-in, but the owner is locked out until SQL rotation. |
| Lost authenticator | Unchanged: runbook only. Option (a) cannot help (needs `aal2`). |
| Phishing of a recovery link | Not applicable: (a) has no link. |
| Leaked temporary password | **Closed once the admin uses the screen.** |

**What the database gate sees.** Nothing. The change goes to GoTrue, not to PostgREST; `require_platform_admin()` is not called and not changed. The session stays `aal2`, `amr` keeps its TOTP entry, so the gate stays `ready` [V reasoning from `gate.js`; to be pinned by the acceptance test A3]. **No audit row** is written: `admin_audit_log` is written only by `admin_*` functions in their own transaction (D-A6). The record is GoTrue's own Auth log (`user_updated_password`/`user_modified` style events; exact action names **[U]**). An admin-audited password change needs a function and a migration: out of scope here (decision D6).

**Tests.**
- Vitest, fake client: panel mounts only at `ready`; wording for each error code; the others-sign-out failure message; double submit; no password in any DOM attribute, log or storage; the real-auth-js check in the style of `gateSessions.test.js` that `scope: 'others'` keeps the local session on success and on failure.
- `boundary.test.js` keeps passing (core imports only).
- Playwright `dev-admin`: see the acceptance list (section 9). The attack list (`admin-console-adversarial.spec.js`) gains these rows: (1) an `aal1` session of an admin with a verified factor calling `PUT /auth/v1/user {password}` gets 403 `insufficient_aal` and the password is unchanged (not pinned today: only enrol and unenrol are); (2) a stale-TOTP `aal2` session (older than 60 minutes) calling the same endpoint **succeeds**, recorded as documented behaviour so nobody mistakes the D-A14 window for covering it; (3) after the change the old password no longer signs in and a second session of the same login is refused on its next call.
- `admin-accounts` Edge Function manual script: not touched, no re-run needed.
- pgTAP: none (no function or policy changes).
- `npm run check:admin-leak`: "Change password" already exists in the organiser bundle, so it is not an admin-only string and needs no entry in the leak list; any admin-only string introduced (for example an admin-specific heading) gets one.

**Size.** One panel module (~150 lines), one `describeError` map, an error-translation test, plus the e2e and adversarial rows: about **one working day** including review. One optional core edit (decision D5: `minLength` parameter in `passwordForm.js`, default 8, which does not change the organiser console).

**Reviewers.** `code-reviewer`, `module-boundary-checker`, `test-auditor`, `ui-accessibility-reviewer` (360px first), `security-reviewer` (a security-relevant surface, though no policy changes; the Definition of Done gate is for RLS/RPC/Storage so this is a judgement call, recommended).

### Option (b): (a) plus "Forgot password" recovery for the admin (D-PW3)

**What.** On the sign-in page a "Forgot password?" request (`resetPasswordForEmail(email, { redirectTo: '<origin>/admin/' })` from the admin client), an arrival handler for the link, a step that requires the authenticator code, then the new-password form.

**The hard parts, each checked against the code:**

1. **Implicit flow and the hash.** The link redirects to `/admin/#access_token=…&refresh_token=…&type=recovery`. The console routes by the URL hash, so `takeRecoveryArrival` (core, already used by `/app/`) must run first, before the router and before anything reads the address, and `history.replaceState` removes the token so it is not left in history or a `Referer` [V: `passwordRecovery.js`]. Because the admin client has `detectSessionInUrl: false` (and must keep it: spec risk 3), the client will not read the hash; the arrival handler calls `client.auth.setSession(tokens)` itself, explicitly, into the admin client's own sessionStorage. The admin client is **not loosened**.
2. **The recovery session is `aal1`.** For an admin with a verified factor it cannot change the password (`insufficient_aal`, finding 1) and the database gate refuses every admin function (D-A5). The admin flow therefore differs from the organiser flow: the organiser flow ends the session and says "ask the team" when it sees `aal1 → aal2`; the admin flow must instead **show the authenticator challenge** (reuse `mfa.js` / `mfaScreens.js`) and only after `aal2` show the form. `insufficient_aal` must never reach the person as a failed form.
3. **Why a recovery link must NOT grant admin access without TOTP.** (i) The link proves only control of the mailbox, which is weaker than, and independent of, the second factor. (ii) The database enforces it, not the UI: the recovery session is `aal1`, so `admin_can_provision()` refuses it and the console cannot reach `ready`; `gate.js checkAccess` already routes `aal1` admins to the challenge. The recovery code must not add any path that treats the arrival as an admin session, must not call `checkAccess` to mean "ready" before the challenge, and the e2e spec proves an `aal1` recovery session cannot call any admin function. (iii) A login with **no** verified factor (the window between steps 2 and 3 of the lost-authenticator runbook) must be refused by the recovery flow: an `aal1` session of a login with no factor can enrol its own, so a mailbox thief would become the second factor. The flow checks `getAuthenticatorAssuranceLevel()` (`nextLevel === 'aal2'`) and otherwise ends the session and refers to the runbook.
4. **After TOTP, the session is a full admin session** that never typed the password (the gate does not require `password` in `amr`). That is the intended trade of recovery (mailbox plus authenticator replaces password plus authenticator) and it should be accepted explicitly (D4). To keep the property "an admin session always followed a password", the flow can, after the save, end this session (`local`) and send the person back to sign-in with the new password. Recommended in D4.
5. **Scanner spends the link.** The owner's mailbox is Outlook; 2026-10-22 showed HEAD scans (answered 405, harmless) and warns about GET scanners. A one-click implicit link is spendable by any scanner that follows GETs. The fix is D-PW4: a dashboard email template whose link goes to our page with a `token_hash`, with a **button** that calls `verifyOtp({ token_hash, type: 'recovery' })`. That template is project-wide and also changes the organiser recovery, so (b) cannot ship before the organiser flow is moved to the same pattern, and it needs the owner in the dashboard. The `token_hash` pattern works across devices (unlike PKCE).
6. **Email delivery and limits.** The built-in sender may not deliver to the admin address reliably, and its project-wide hourly limit means anyone can exhaust it by repeatedly requesting resets for any address, locking real organisers out of recovery as well [limit value U]. A custom sender (D-PW2) is a prerequisite.
6b. **Link abuse, two more points.** (i) Anyone can trigger a genuine recovery mail to the admin address at will, a phishing pretext, and a new request may replace the earlier token so an attacker could keep invalidating the admin's real link **[U: replacement not confirmed]**. (ii) The button-gated `token_hash` link puts the token in a query string, so edge request logs would hold a token usable until spent; the implicit flow's hash fragment avoided that. State it as a trade-off. Also add `/admin/` to the redirect allow-list as the exact URL, not a wildcard.
7. **Enumeration.** The request form on `/admin/` must answer identically for every address (`requestPasswordReset` already does, with a minimum answer time), but `/admin/` is unlinked and `noindex`; adding a public request form to it announces the surface and invites probing of the admin address. A form that only an admin knows to look for is still a form.
8. **`insufficient_aal` and the recovery session after TOTP.** Whether a recovery-origin session upgraded to `aal2` can `updateUser({password})` without a current password (GoTrue skips the current-password check for recovery sessions) is **[U]** for the exact deployed version; the R3 test (end of section 9) proves it before any wording is written.

**Threat-model changes.** The admin account's recoverable-factor set becomes mailbox plus authenticator (previously password plus authenticator, with recovery by operator SQL only). A compromised admin mailbox plus a phished or stolen TOTP code is a takeover with no password; the same attacker with only the mailbox gets an `aal1` session that can read `{is_admin: true}` and nothing else. A lost authenticator is still **not** recoverable by email (D-PW3 as accepted): that stays the runbook. The dashboard "send recovery email" button stays available to anyone with dashboard access and becomes a working route into the same flow; note it as a path to include in the audit of who can reach the dashboard.

**What the database gate sees.** An `aal1` session until the TOTP is verified, then an ordinary `aal2` session with a fresh `totp` `amr` entry. No change to the function. No audit row (as (a)).

**Tests.** Everything in (a), plus: unit tests for the admin arrival handler (token present, `error=` fragment, a console route `#/orgs` is never an arrival, the hash is stripped before `setSession`, tokens never stored or logged, `detectSessionInUrl` still false); Playwright `dev-recovery` style with the local mail catcher (Mailpit), adapted to `/admin/`: scanner GET leaves the token usable (needs D-PW4's button), link then TOTP then new password then old password refused; no-factor login refuses the flow; expired and reused link; back/refresh after success does not re-show a form; enumeration timing and wording; the adversarial list gains "aal1 recovery session calls every admin function: refused" and "aal1 recovery session of a no-factor login cannot enrol" (the latter documents why the flow must refuse first). Manual `admin-accounts` script: untouched.

**Size.** Roughly **three to four working days** plus the owner-side work (custom sender, DNS, redirect allow-list for `/admin/`, template edit) and a retrofit of the organiser recovery to the button-gated link. It cannot be released before D-PW2 and D-PW4, which the spec already marks as the gate to the whole feature.

### Option (c): Do nothing and document the route

**What.** No code. Correct the documentation: rotation of an admin password is by service-key (`PUT /auth/v1/admin/users/<id> {password}`) or SQL (CLAUDE.md step a), not by the dashboard's recovery email, and after rotating, the admin checks the login still shows the challenge screen (not enrolment). Add one line to the runbook saying the long-term password is changed the same way and that the dashboard recovery email will not work for an admin with a factor.

**Properties.** Zero new surface. Every rotation is operator-driven and the new password is, by construction, known to whoever ran it (the service key holder), so the password is never wholly the admin's own: the problem this task exists to fix. The temporary password cannot be replaced by the person it protects. Threat model unchanged. Size: a paragraph. Tests: none.

**Verdict.** Acceptable only as a short bridge. With one operator and a working runbook it is not unsafe, but it keeps the temporary-password gap open indefinitely and makes the operator's own password a thing the operator's tools generate and see.

---

## 4. Comparison

| | (a) Change screen | (b) (a) + recovery | (c) Document only |
| --- | --- | --- | --- |
| Closes the temporary-password gap | Yes, on first use | Yes | No (re-keys it by hand) |
| New server capability | None | None, but a mail-driven entry path | None |
| Recovery of a forgotten password | No (runbook) | Yes (mailbox + TOTP) | No (runbook) |
| Lost authenticator | Runbook | Runbook | Runbook |
| Needs owner dashboard work | Optional settings (D3) | Sender, DNS, allow-list, template | None |
| Touches organiser flow | No (optional `minLength`) | Yes (template is shared) | No |
| Gate / database change | None | None | None |
| Size | ~1 day | ~3 to 4 days plus owner tasks | minutes |

---

## 5. Recommendation

1. **Build (a) now** as its own small task: a "Change password" panel at `aal2`, current password asked (D3), others signed out, no new database or gate work. It closes the real gap, adds no server capability, and is reversible by deleting one registry entry.
2. **Do not build (b) yet.** With one operator, a documented SQL/service-key runbook that already works, and a prerequisite chain (custom sender, button-gated template shared with the organiser console, retrofit) that is the owner's calendar and DNS rather than code, recovery by email is cost without a customer. Revisit when a second admin exists, or when D-PW2 and D-PW4 are done for the organiser console anyway. Until then, keep D-PW3's rule that a lost authenticator is never recoverable by email.
3. **Do (c)'s documentation fix at the same time**: correct CLAUDE.md and ROADMAP.md so "rotate from the Supabase dashboard" no longer reads as a route that works for an admin with an authenticator.

### 5.1 Rotating the live temporary password before (a) exists
If the owner is unsure the first admin's password was replaced: use the service-key `PUT` from CLAUDE.md step a, then confirm the next sign-in shows the **challenge** screen. Do not use the dashboard recovery email for this (finding 1). A rotation by the Auth admin API or SQL does not necessarily end existing sessions, and the premise for rotating is that the old password may have leaked: follow it with "Sign out everywhere" (or the lost-session runbook's step 1, a global sign-out through the Auth admin API) and re-check the challenge screen. Rotating by service key means the operator's tooling sees the new value, the problem option (c) describes: set a random value this way, then replace it through the new screen once it exists.

### 5.2 What (a) must not do
Not import `main.js` or `core/supabaseClient.js`'s shared client; not read the URL; not add an admin function or any database object; not touch `detectSessionInUrl`; not store the password anywhere; not show `insufficient_aal` as "ask the team".

### 5.3 Dashboard settings worth the owner's look (read-only checks, nothing changes unless the owner says)
Cloud minimum password length (form says 8; local config says 6); "require reauthentication to change password" (`secure_password_change`: with it on, a session older than 24 hours cannot change the password without an email nonce, which needs a working sender); "require current password when changing password" (whether the project's plan offers it is **[U]**); note leaked-password protection is Pro-only and is not suggested here.

---

## 6. Constraints and risks to design around

1. **`scope: 'others'` is not `global`.** It keeps this tab's session; failure is reported, never silent. [V]
2. **The panel needs the console to be `ready`.** It lives in the registry, so it is only mounted by `shell.js` after the gate says `ready`; an `aal1` session reaches the challenge, not this screen. [V: `console.js`/`shell.js` structure]
3. **Same-password after a timed-out save.** Re-submitting the same password after a save that committed answers `same_password`; the wording must make that sound like success-or-different-password, as D-PW1's does. [V: `passwordForm.js` and ROADMAP note]
4. **`must_change_password: false` is written by the shared save.** Harmless for the admin (`admin_find_user` reads it for any account to compute `needs_attestation`, but `admin_self_target` blocks an admin targeting their own account) but it is a `user_metadata` write; user metadata is user-writable and must never be copied into `aal` or `amr` by any hook (spec amendment). Reuse unchanged, or add a flag to skip it (D5). [V]
5. **Admin-only strings and the leak check.** New admin-only wording needs an entry in `tools/check-admin-bundle-leak.mjs`.
6. **Retry/timeouts.** Every request races `core/timeout.js`; a timeout that may have committed says "may have changed", not "nothing changed", as the Batch 10/11 panels do.
7. **The 2026-10-22 lesson.** Any recovery link must be treated as spendable by a scanner. Never design a flow where one GET spends the only copy.

---

## 7. Open verification items (could not be verified from here)

| ID | Item | How to verify |
| --- | --- | --- |
| U1 | The cloud GoTrue version matches master's `insufficient_aal` rule and recovery-session handling | Run the X1, X2 and A3 tests against the local stack (same GoTrue as CI) and one probe on the cloud with a throwaway admin, owner present |
| U2 | Cloud settings: minimum password length, `secure_password_change`, "require current password" availability on this plan, built-in sender limit | Owner: Authentication, Providers/Policies/Email in the dashboard; read only |
| U3 | Whether sending `current_password` with the setting off is ignored, accepted or an error | U-10 test locally, then the cloud |
| U4 | The exact Auth log action names for a password change (for the runbook line "check the Auth log") | Local stack logs |
| U5 | Whether a recovery-origin session upgraded to `aal2` can change the password without a current password (relevant to (b) only) | Test R3 |
| U6 | Whether the first admin's temporary password was ever replaced, and where it was shown | Owner |
| U7 | The dashboard recovery-email route's exact behaviour for an MFA admin today (inferred from source and the 2026-10-22 log, not retried) | Not worth a live test; (a) removes the need |

---

## 8. Decisions the owner must make

| ID | Decision | Recommended answer |
| --- | --- | --- |
| D1 | Build option (a) now? | **Yes**, as its own task. |
| D2 | Build admin recovery (b) now? | **No.** Revisit when a second admin exists or when D-PW2 and D-PW4 are done for organisers. Keep "lost authenticator is never recoverable by email". If built later: button-gated `token_hash` link only, only for logins with a verified factor, TOTP before the form, session ended after the save. |
| D3 | Ask for the current password on the form? | **Yes.** If the dashboard offers "require current password" on this plan, switch it on and send `current_password` (server-enforced). If it does not, check it in the form with a short-lived second client (`persistSession: false`, `signInWithPassword`, then `signOut({ scope: 'local' })` so the throwaway aal1 session is revoked on the server, not just dropped). **This fallback is UI-enforced only**: the password check is made by browser code, so anyone holding an `aal2` token can call `PUT /auth/v1/user` directly and skip it. It protects a walk-up at an unlocked console and nothing else; **stolen-session protection is unchanged unless the server setting is on**. It also gives the aal2 UI one more password-guessing path against the admin login, bounded by the shared sign-in rate limit. Not asking is acceptable only if the owner accepts the walk-up risk. |
| D4 | After a successful change, stay signed in? (and, if (b) is ever built: end the recovery session after the save?) | Stay signed in for (a). For (b), end the session and require a normal sign-in. |
| D5 | Admin minimum password length, and skip the `must_change_password` write? | Minimum **12** for the admin form via an optional `minLength` argument in `passwordForm.js` (default 8, so the organiser console is unchanged); keep the metadata write (harmless). If the owner prefers no core edit, accept 8 and the server's policy. |
| D6 | Audit trail for a password change | **None in v1** (the Auth log is the record). If wanted later: a new `admin_record_password_change` function and migration, its own task with `security-reviewer` and the cross-org and adversarial matrices; the admin console cannot see GoTrue events otherwise. |
| D7 | Rotate the first admin's password now | **Yes, today, by the service-key route** (section 5.1), and again through the new screen once built. Say whether it was already replaced (U6). |
| D8 | Correct the docs (CLAUDE.md, ROADMAP.md) so the dashboard recovery route is no longer given as the rotation method | **Yes**, in the build task's PR or a docs PR. |
| D9 | Dashboard checks (U2): read-only look, and set "require current password" if available | **Yes**, read first, change nothing without a separate decision. |

---

## 9. Draft acceptance tests for the recommended option (a)

Unit (vitest, fake client unless noted):
- U-1 The panel is registered in `PANELS`, route `password`, label "Change password"; nothing else in the registry changes.
- U-2 The form is shown only after the gate is `ready`; an `aal1` admin session reaches the challenge screen and never this panel (console test).
- U-3 `validateNewPassword`/min-length (12 if D5): empty, short, mismatch each give their message and send no request.
- U-4 Each error code is worded and none shows the server's own text: `insufficient_aal` (admin wording, not "ask the team"), `same_password`, `weak_password`, `over_request_rate_limit`, a timeout, offline.
- U-5 Success calls `updateUser` once, then `signOut({ scope: 'others' })` once; double submit sends one request.
- U-6 A failed others-sign-out shows the "could not sign out your other devices" sentence and names "Sign out everywhere".
- U-7 Real auth-js client: `signOut({ scope: 'others' })` leaves the local session in place on success and on failure (same style as `gateSessions.test.js`).
- U-8 No password in any DOM attribute, any `console` call, or any storage (spy and assert).
- U-9 `boundary.test.js` and `headers.test.js` pass unchanged; `npm run check:admin-leak` passes with any new admin-only string listed.
- U-10 (D3) with the current password required, a wrong current password sends no update and the message does not reveal anything else.

End to end (Playwright `dev-admin`, real local stack, TOTP from `otplib`):
- A1 An admin at `aal2` changes the password: old password no longer signs in, the new one does, and the console still shows the challenge screen afterwards (the factor survived).
- A2 A second session of the same login (another browser context) is refused on its next call after the change (`session_not_found`/401) and the first stays `ready` and can still call an admin function.
- A3 After the change the same session still passes `admin_can_provision()` (the gate is unaffected).
- A4 360px: the panel is usable, focus lands on the heading, the Show/Hide toggle and Save are at least 44px tall.
- A5 An `aal1` session cannot open the route (the hash `#/password` is shown the gate state, not the panel).
- A6 (D3 variant) the wrong current password is refused and the password is unchanged.

Adversarial list (`admin-console-adversarial.spec.js`, over HTTP):
- X1 `aal1` admin with a verified factor: `PUT /auth/v1/user {password}` returns 403 `insufficient_aal`; password unchanged.
- X2 (a clearly named **known-gap** test, not a passing guarantee) `aal2` session with a stale TOTP (over 60 minutes): the same request succeeds today; the test records this and asserts every admin function still refuses that session. The gap itself belongs in ROADMAP.md as an open risk with an owner decision (finding 3, and D6's missing audit row makes it worse: a locked-out admin has no in-console record).
- X3 No token / anon key / organiser token: refused; an organiser changing their own password does not touch an admin's.
- X4 After a change, a token replayed from before the change on another session is refused once `scope: 'others'` has run.

Manual: none for the Edge Function (untouched). One cloud probe after release by the owner: change the password from the console and sign in again with the new password and the authenticator.

Not in (a), but written now for (b) if it is ever built: R1 a GET to the link leaves the token usable (needs the button-gated template); R2 the arrival hash is stripped before the router and `detectSessionInUrl` stays false; R3 a recovery-origin `aal1` session cannot call any admin function and cannot save a password until TOTP is verified; R4 a login with no verified factor is refused the flow; R5 enumeration: identical answer and minimum time for an unknown address; R6 the session is ended after the save and the old password is refused.
