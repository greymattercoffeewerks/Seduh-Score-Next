# src/community/guess-the-bean/ — Guess the Bean (Supabase port)

Root non-negotiables apply here too. This is a **third kind of surface**, distinct from
both existing "outside the core/formats boundary" precedents:

| Directory                       | Auth/Supabase?                                    | Roster/scoring/advancement? | Fits                      |
| ------------------------------- | ------------------------------------------------- | --------------------------- | ------------------------- |
| `src/tools/` (e.g. Timer)       | No (`src/tools/CLAUDE.md` explicitly excludes it) | No                          | standalone utility        |
| `src/formats/<format>/`         | Yes, org-scoped                                   | Yes                         | a full competition format |
| `src/community/guess-the-bean/` | **Yes**, but per-user, not org-scoped             | **No**                      | neither of the above      |

Guess the Bean is a **free Community-tier tool** (per
`Handoffs and Specs/guess-the-bean-next-port-SPEC.md`) with real auth and a real Supabase
backend — disqualifying it from `src/tools/` — but it has no roster, no heats, no scoring,
no advancement, and isn't org-scoped at all (`sessions.creator_id` anchors directly to
`auth.users(id)`, not `orgs`/`org_members`) — disqualifying it from `src/formats/`. Hence
`src/community/` as a new sibling to `core/`, `marketing/`, `tools/`, and `formats/`.

The module-boundary test still applies in spirit: this directory may import from
`src/core/` (format-agnostic engine logic — `supabaseClient`, `dom`, `timeout`, etc.,
same direction `src/marketing/`/`src/tools/` already import in), but must never import
from `src/formats/`, and `src/core/` must never import from here.

## Why it isn't org-scoped (locked spec decision, do not re-litigate)

Unlike Cup Taster, there is no "one organiser, one org" model here — any Community-tier
account can create a session. `sessions.creator_id → auth.users(id)` is the identity
anchor; a future Seduh ID system attaches additively to that same UUID (a
`seduh_id_profiles` table, not built yet — explicitly out of scope per the spec's own
do-not-touch list). See `supabase/migrations/20260914120000_guess_the_bean_tables.sql`'s
own comment for the full reasoning.

## Auth: a SEPARATE stub from `core/loginScreen.js`

`core/loginScreen.js` is the organiser CONSOLE's temporary `signInWithPassword` login —
scoped to the single-org Cup Taster app, ahead of D14's real entitlements. This tool's
own `authScreen.js` is a genuinely different, LOCKED spec decision: Supabase magic-link
(`signInWithOtp`) only, email-only, no password field anywhere, no sign-up flow, no
password reset (Phase 2 pass/fail: "No password storage or password-reset flow exists in
the codebase"). Do not consolidate these two — they serve different account models
(one org vs. many independent creators) and different UX (organiser-provisioned vs.
self-serve).

`mountAuthScreen()` subscribes to `client.auth.onAuthStateChange` (not a one-time
`getSession()` poll) specifically because a magic link's own redirect lands back on this
same page with the session established asynchronously, well after `mountAuthScreen`
itself has already returned — same reactive-subscription shape as `appShell.js`'s own
sign-in/sign-out control.

## Own CSS, never a format's

Same "never load `formats/cup-taster/heatsScreen.css`" rule `src/tools/timer/timer.css`
already established — `shared.css` (this directory's own `.gtb-*` primitives: card,
input, button, feedback, plus a self-contained `.form-field`/`.form-field-label` pair for
`core/dom.js`'s `labeledField()`, which ships unstyled) and per-screen CSS files (starting
with `authScreen.css`) are the only styling this tool loads, beyond the genuinely
surface-agnostic `src/ui/tokens/`.

## Own Vite entry, own route

`/guess-the-bean/` (`guess-the-bean/index.html` at the repo root, alongside
`tools/timer/index.html`'s own precedent) — a new `vite.config.js` build entry
(`guessTheBean`) was required for the production build to include it, same note every
other multi-entry addition here carries.

## Phase history

**Phase 1 (2026-09-14)** — schema + RLS. See
`supabase/migrations/20260914120000_guess_the_bean_tables.sql` and
`20260914121000_guess_the_bean_rls.sql`'s own comments for the full account (deliberately
NOT org-scoped, four `app.session_*` SECURITY DEFINER resolver functions, the
`sessions_select`/`sessions_select_own` role-split). CHANGELOG.md has the dated full
account including what `schema-guardian`/`security-reviewer` found across 3 review
rounds.

**Known constraint for later phases**: `INSERT ... RETURNING` requires the inserting role
to also satisfy the target table's SELECT policy — a pre-reveal `anon` guess insert with
`RETURNING` throws an RLS violation even though the insert itself succeeds (Postgres's own
documented behavior, not a bug here). Phase 4's participant client MUST generate the
guess's UUID client-side before inserting; never rely on `RETURNING` or Supabase JS's
`.insert().select()` for this table.

**Phase 2 (2026-09-14)** — magic-link auth stub (`authScreen.js`/`authScreen.css`,
`main.js`, `guess-the-bean/index.html`). Pass/fail per the spec: a new user can sign in
via magic link and `auth.uid()` resolves correctly in an RLS-protected query; no password
storage or reset flow exists anywhere in this directory. Verified live end-to-end via the
local stack's Mailpit. 4 reviewers (code-reviewer, module-boundary-checker,
ui-accessibility-reviewer, test-auditor) found and fixed real issues, including an
`onAuthStateChange` subscription leak in `main.js` and two test gaps around the
"no password" claim.

**Phase 3 (2026-09-14)** — session management, organiser flow. Port of legacy's
`booth/setup/index.html` (github.com/greymattercoffee/Seduh-Score, dev branch — fetched
and read via `gh api` for real parity, not inferred from the spec's prose alone).
`sessions.js` (data layer: create/list/update/reset/end/export, `buildParticipantUrl`),
`setupScreen.js`/`.css` (create form → session list → detail view with guess_enabled
toggle, orientation select, Reveal, participant URL + QR code via the new `qrcode-generator`
dependency, and a danger zone — Export/Reset/End — with native `confirm()` dialogs and a
toast notification). Deliberately shows a LIST of sessions rather than legacy's
single-localStorage-slot model, since this port's sessions are per-user-account, not
per-browser-per-shared-operator-login — see `setupScreen.js`'s own header comment.

Fetching the real legacy source surfaced two genuine gaps in the already-shipped Phase 1
schema, both closed this phase (new migrations `20260914130000_guess_the_bean_bean_count.sql`,
`20260914131000_guess_the_bean_session_lifecycle.sql`, both reviewed clean by
schema-guardian + security-reviewer after real fixes — a TOCTOU gap in
`reset_guess_session_data`'s creator check, and `bean_count` being mutable post-reveal
until a trigger locked it):

- `sessions.bean_count` — the real answer, needed for Phase 5's winner-spotlight
  calculation, which Phase 1's schema never carried at all. Required, immutable after
  creation (enforced by a trigger, not just client-side), never exposed via anon's
  column-scoped grant — only readable post-reveal via `app.session_bean_count()`.
- `reset_guess_session_data` (SECURITY DEFINER RPC) + `sessions_delete` (creator-only RLS
  policy) — legacy's Reset Data/End Session danger-zone actions delete guesses/contacts,
  which this port's own locked checklist forbids via plain client DELETE. The RPC is the
  sanctioned path, matching `delete_test_event`'s own precedent for Cup Taster.

**Known deferred item, not this phase's scope**: the spec's own Phase 3 pass/fail list
names a "`?demo=1`-equivalent" criterion, but the actual legacy `booth/setup/index.html`
has no such code at all — verified directly. It belongs to `booth/guess/index.html`
(Phase 4's participant entry page, confirmed via the same `gh api` read), and is deferred
there rather than built here against the wrong page.

4 reviewers (code-reviewer, module-boundary-checker, ui-accessibility-reviewer,
test-auditor) found and fixed real issues this phase too: an asymmetric unmount-discipline
gap in `main.js` (authScreen's handle was captured/unmounted, setupScreen's wasn't), a
missing busy-guard on the two danger-zone handlers (a double-click race), a permanent
error banner that never cleared across view changes, three blocking accessibility gaps
(the `guess_enabled` checkbox's label wrapped only the control, not its text — no
accessible name; the orientation `<select>` had no accessible name at all; the toast had
no `aria-live`), and several real test-strength gaps (a too-permissive mock chain, a
rejoin test that couldn't distinguish keyed from positional matching, zero error-path
coverage across 15 tests, a "disabled" assertion that never proved a click was actually
suppressed). All fixed and re-verified, including live in a browser a second time after
the fixes. A broader, still-open accessibility gap (focus loss on every re-render, not
just the disabled-control case) was spawned as a separate follow-up task rather than
fixed inline — see ROADMAP.md's known-open-items.

**Phase 5 (2026-09-15)** — display/stage mode (`displayScreen.js`/`.css`,
`displayMain.js`, `/guess-the-bean/display/`). The display polls every four seconds
rather than using Supabase Realtime, for the same locally verified delivery and
column-grant reasons documented for Phase 4. It uses the persisted
`sessions.orientation` setting as the source of truth, with a dedicated portrait
layout and 96px QR (landscape remains 112px), rather than requiring every venue URL
to carry an orientation query parameter. This is a deliberate divergence from the
legacy presentation-only URL switch: the organiser configures the session once.

Pre-reveal `anon` access is deliberately limited to the arrival-safe
`id`/`name`/`created_at` fields. `20260915110000_guess_the_bean_display_feed.sql`
adds a narrow post-reveal RPC for numeric guesses, preserving legacy's live
name-and-flavour-text feed without allowing a raw REST read of numeric guesses before
the reveal. Equal-distance winners retain arrival order, so the earliest arrival wins.
A poll during countdown/flying updates the shared guesses array without interruption;
a poll after results recomputes the winner banner.

Built by Codex from a handoff document (this session's usage-limit gap), without this
project's custom subagents available. Follow-up manual review (Claude Code) found and
fixed three real issues before this shipped, all live-verified in a browser, not just
caught by the automated suite:

- `app.session_bean_count()` (Phase 3) and the new `app.session_display_guesses()` both
  live in the `app` schema, but `supabase/config.toml` only exposes `public`/
  `graphql_public` to PostgREST — `client.rpc('session_bean_count', ...)` was never
  actually reachable from a browser since Phase 3 shipped it, just never exercised.
  `20260915120000_guess_the_bean_display_rpc_wrappers.sql` adds thin `public.*`
  pass-through wrappers. **Any future `app.*` resolver meant to be called directly via
  `.rpc(...)` needs one of these** — a resolver only ever called from inside another SQL
  function or an RLS policy doesn't.
- `.gtb-display-question`/`.gtb-display-number`/`.gtb-display-qr-wrap` each declared
  their own `display` value at equal specificity to the browser's `[hidden] { display:
none }` rule, so `displayScreen.js`'s own `.hidden` toggles silently didn't hide either
  — same bug class as `core/splashScreen.css`'s documented `.status-live-dot[hidden]`
  fix, fixed the same way (an `[hidden]`-qualified override rule).
- The portrait CSS was wrapped in `@media (orientation: portrait)`, which ignored the
  organiser's persisted `sessions.orientation` setting whenever the actual window/monitor
  shape didn't independently happen to match — reintroducing the exact viewport
  dependency the persisted-column design was meant to avoid (an organiser previewing
  their own portrait Display URL from a landscape laptop would have seen the wrong
  layout). Removed the media-query gate; the `[data-orientation='portrait']` attribute
  selector alone decides now, unconditionally, same as legacy's own CSS.
- The new "Show winner contact" button (Phase 6, `setupScreen.js`) was missing the
  explicit `state.busy`/`!session.revealed` re-check every other danger-zone handler in
  that file already has (`aria-disabled` doesn't block a click) — fixed with the same
  guard `handleReveal` uses, plus a regression test.

**Phase 4 (2026-09-15)** — participant entry flow, public and fully unauthenticated. Port
of legacy's `booth/guess/index.html` (github.com/greymattercoffee/Seduh-Score, dev branch
— fetched via `gh api`, same discipline as Phase 3). `entryScreen.js`/`.css`, `playMain.js`
(new entry point), a new Vite build entry (`guessTheBeanPlay` → `/guess-the-bean/play/`,
a SEPARATE page from the organiser's own `/guess-the-bean/` — never the same route).
Seven view states (loading/no-session/not-found/not-active/closed/form/confirmed —
`guess_enabled = false` wins over `revealed = true` when both are true, ported
byte-for-byte from legacy's own precedence), exact validation parity with legacy (name
≤80, guess 1–100,000,000 via a `\d+` regex — matches the DB's own CHECK constraints
exactly), `?demo=1` mode (session id defaults to `'demo'`, skips both the existence check
and the actual RPC call), and a small CSS confetti burst on the participant's own
confirmation screen (Phase 5 gets its own, separate, bigger reveal-time confetti on the
display surface — these are not the same animation).

**Atomicity**: a new `submit_guess` SECURITY DEFINER RPC
(`supabase/migrations/20260915100000_guess_the_bean_submit_guess_rpc.sql`) replaces what
would otherwise be two sequential client inserts — the spec's own Phase 4 AC requires no
orphaned guess if the network drops mid-submit, which two separate calls can't guarantee.
Also closes Phase 1's own documented `INSERT ... RETURNING`/RLS constraint outright: the
RPC's return value isn't a table `SELECT`, so it was never subject to that policy in the
first place. `schema-guardian` and `security-reviewer` independently found the SAME real
bug during review — `app.session_is_open()` (a Phase 1 resolver, reused here) returned
`NULL`, not `false`, for a nonexistent `session_id`, letting an anonymous caller
distinguish "session exists but closed" from "session never existed" (an enumeration
oracle) via different error shapes. Fixed at the root
(`20260914121000_guess_the_bean_rls.sql`, switched to `EXISTS(...)`), not just at
`submit_guess`'s own call site, since the same function backs `guesses_insert`/
`contacts_insert` too.

**Realtime → polling, a real mid-phase pivot, not the original design**: `entryScreen.js`
was FIRST built with a Supabase Realtime `postgres_changes` subscription (the same shape
`core/viewer-shell.js` already uses for `live_sessions`) to close an open form the instant
a session reveals/closes. Live-testing against this project's local Supabase stack found
it never delivers a single event for this table — `realtime.subscription` never gains a
row despite the client reporting `SUBSCRIBED`, reproduced across a full `supabase stop`/
`start` cycle, a `docker restart` of the realtime container, and a brand-new, uniquely-
named, trivially-public test table (ruling out a `public.sessions`/`auth.sessions` name
collision) — while the pre-existing `live_sessions` channel kept working correctly side
by side on the identical stack. Root cause not conclusively found. A SECOND, independent
reason not to ship it even if delivery had worked: `sessions`' anon grant is
column-scoped, and Postgres logical replication (what `postgres_changes` is built on)
reads the WAL directly, which has no concept of column-level GRANTs — whether a working
subscription would leak the withheld columns (`creator_id`/`name`/`bean_count`) to `anon`
was never actually verified, since delivery failed first. `entryScreen.js` now polls
`fetchSessionStatus` (the SAME anon-safe REST call its own initial load already uses)
every 4 seconds via `pollStatus()`/`setInterval` instead — works everywhere, carries none
of either open question. See `pollStatus()`'s own module comment for the full account.
**If a future phase or format wants real `postgres_changes` Realtime on a newly-enabled
table, verify it actually works in whatever environment it targets — don't assume the
`live_sessions` precedent generalizes.**

Retrofitted with the same `setBusyDisabled`/`withFocusPreservation` (`core/dom.js`)
accessibility pattern already applied to `authScreen.js`/`setupScreen.js` — this file was
written after that fix landed on its siblings but didn't inherit it automatically.
6 reviewer rounds (schema-guardian, security-reviewer, code-reviewer,
module-boundary-checker, ui-accessibility-reviewer, test-auditor — the latter 4 run twice,
since the realtime→polling rewrite and the accessibility retrofit both happened mid-review)
found and fixed real issues: the enumeration oracle above; a dormant post-unmount-write
race in the original realtime handler (fixed, then the whole mechanism was replaced
anyway); 3 blocking WCAG 4.1.2 gaps (no accessible name on two form fields' error
association, no live-region announcement of validation/submit errors) plus a genuinely
missing 'loading' render (every path in `boot()` reassigned `view` away from `'loading'`
before its first `render()` call, so real participants saw a blank screen during the
network round-trip instead of the coded spinner); and several test-strength gaps (a
too-permissive RPC-args test missing the reverse null-coercion direction, a vacuous
abort-mid-load test, a poll test that would pass identically with polling deleted, zero
focus-assertion coverage across the whole file despite a substantial focus-management
block). All fixed and re-verified, including live in a browser twice (once via `?demo=1`
confirming zero network calls, once against a real session confirming the atomic RPC
write and the polling close-watch, including focus landing on the new heading).
