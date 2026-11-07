# Roadmap archive: the "Current state" narrative (2026-08 to 2026-09)

Moved verbatim out of `ROADMAP.md`'s "Current state" section on 2026-11-07: the dated, not-tied-to-a-phase paragraphs (app wiring, login, delete event, landing page, design-system reworks, Timer, Guess the Bean phases, results publishing and more). All shipped; the live table stays in `ROADMAP.md`.

## The Gating row as it stood before it was shortened

| Gating and entitlements (T-GATE) | Spec steps 1 to 3 built, reviewed and merged to `dev` (B1 to B5 as #300, #301, #304, #305, #307; the admin Plan panel, T-GATE.C, as #309). **Three keys enforced in the cloud since 2026-11-02 (Brunei):** `cup_taster_participants`, `events_open` and `results_archive_optional`, flipped one at a time from the admin console (audit rows 20 to 22); the other eight stay off. The six gating migrations (`20261023100000` to `20261023150000`) were pushed to the cloud project on 2026-10-26 after a green local `db:reset` and pgTAP run, and every key was confirmed `enforced = false` there; now on `main` too (verified in git 2026-10-28). These are the first gating keys ever enforced in the cloud for real (the one earlier flip, `cup_taster_participants` on and off again on 2026-10-27, was a rehearsal on a test organisation: audit rows 16 and 17). Runbooks, local only: `Handoffs and Specs/FIRST-KEY-FLIP-RUNBOOK.md`, `ARCHIVE-KEY-FLIP-RUNBOOK.md`. Next is the remaining eight keys' flips and the open decisions in "Known open items from the Plan panel", "...B5" and "...B4" | the entitlement tables, resolvers, catalog, client snapshot reader (B1), the audited admin grant writers and key switch (B2), the enforcement hooks (B3: events gate, format freeze, participant cap, go-live snapshot, admin resnapshot), the Community one-open-event rule with finish and release, and BTC gated at first go-live (B4), and the Per-event 5-day window lock (B5: restrictive row-level-security locks on the event's workspace and live displays, the locked screen, the warning before the end), and the admin Plan panel (T-GATE.C: the Keys section with preview before flip, organisation plans, grants, the manual payment confirmation, event re-snapshot and release; metadata only, no event names); eight keys are still off (`audience_branding`, `btc_format`, `cup_taster_analytics`, `cup_taster_report`, `event_window_lock`, `guess_the_bean_create`, `registration_page`, `season_history`) — see "Known open items from T-GATE.B1", "...B2", "...B3", "...B4", "...B5" and "the Plan panel", and CHANGELOG `T-GATE.B1`/`T-GATE.B2`/`T-GATE.B3`/`T-GATE.B4`/`T-GATE.B5`/`T-GATE.C` |

---

**Deadline: 4 October 2026, Cup Tasters event.**

**2026-08-23, user decision: Guess the Bean will NOT be rebuilt in this codebase** —
the v4.x implementation is booth-only, temporary, already zero contact with the identity
core, reuse it as-is. **2026-09-14, user decision reversal: Guess the Bean WILL be
ported to Supabase** per `Handoffs and Specs/guess-the-bean-next-port-SPEC.md` (a new
spec, locked decisions on identity anchoring and identity-ID attaching). Phase 1
(schema + RLS) complete; Phases 2–5 carry client, session UI, gameplay, hardening. See
CHANGELOG.md for Phase 1's full account.

**Not tied to a phase task**: the `src/ui/tokens/` design system (colors, typography,
spacing, base styles, self-hosted fonts, `DESIGN.md`, `preview.html`) shipped
2026-08-22, ahead of Phase 4 — see CHANGELOG.md's "Design system foundation" entry.
Closes the open item that used to sit below. `heatsScreen.js`/`.css` (T4.2) is the first
real screen consuming it. **2026-08-28 follow-up**: the display and mono typefaces
refreshed — Erode → Cabinet Grotesk, Tabular → JetBrains Mono; Switzer unchanged — see
CHANGELOG.md's "Design system type refresh" entry. **2026-09-05 follow-up**: production
UI/UX feedback pass — mobile hamburger nav, renamed audience-surface links, active-pill
contrast fix, feedback-region placement (eventsScreen.js only; other screens still
pending), event-card CTA — see CHANGELOG.md's "Production UI/UX feedback pass" entry,
including the two items deliberately not done (D9's is_test visibility, the native
date-input placeholder).

**App wiring (2026-08-30), also not tied to a phase task**: every organiser screen and
both audience surfaces already existed, fully built and reviewed through Phase 4/5, but
nothing connected them — `src/main.js` was still the Phase 0 placeholder. `core/router.js`
(hash-based, hand-rolled), `core/appShell.js` (organiser chrome), `core/eventsScreen.js`
(events list/create), `formats/cup-taster/eventDashboardScreen.js` (per-event hub),
`formats/cup-taster/timingRouteScreen.js` (timing-mode dispatcher), and a rewritten
`main.js` connect them into one real, navigable app for the first time. Also closed two
real gaps found during scoping: `heatsScreen.js` had no `unmount()` return at all, and its
"generation complete" heats list had no links into Timing or Scoring. See CHANGELOG.md's
dated entry for the full account, including a real, deliberately-not-fixed-here race
condition found live-testing (a slow-resolving screen's own DOM write isn't gated by the
router's staleness guard) — see "Known open items" below.

**Temporary login screen (2026-08-30), also not tied to a phase task**: closes the gap
the app-wiring pass above left open — every organiser table is `authenticated`-only, and
there was still no way for a human to sign in outside devtools. `core/loginScreen.js`
(new) + a `requireAuth()` gate confined to `main.js` (not `core/router.js`) + a reactive
sign-in/sign-out control in `appShell.js`. Explicitly scoped as temporary: plain
`auth.signInWithPassword`, no sign-up, no tier/role gating — real access control is D14
entitlements, future work. Five reviewers in parallel found and fixed real issues,
including a hung-network gap (neither the session check nor the sign-in call had a
timeout, unlike every other initial-load boundary call in this codebase) and a real,
reproducible jsdom test-isolation bug found and fixed while writing the tests. See
CHANGELOG.md's dated entry for the full account.

**Delete event feature (2026-09-05), also not tied to a phase task**: closes a production
gap where test events from verification runs accumulated indefinitely with no cleanup
path. User's explicit request: "We need a real way to delete test events." `core/events.js`
gained `deleteTestEvent(orgId, eventId, client)`, a thin wrapper around a new
`delete_test_event(p_org_id, p_event_id)` RPC (migration `20260905130000_delete_test_event_rpc.sql`)
that validates `is_test: true` and org ownership before cascading the deletion through all
child tables (which have pre-existing `on delete cascade`). `eventsScreen.js` gained a
per-row Delete action (shown only for test events), a two-step confirmation UI, and an
explicit re-entrancy guard. Six reviewers in parallel found and fixed real issues,
including a critical accessibility gap where the in-flight "Deleting…" render silently
dropped keyboard focus to `<body>`, and a test fixture gap where a single-event deletion
test couldn't distinguish "removed by id" from "removed the only element." See
CHANGELOG.md's dated entry for the full account.

**Marketing landing page (2026-09-07), out of scope per handoff §1 but user-requested**:
a customer-facing landing page deployed to the root `index.html`, with the console SPA
relocated to `/app/index.html` (unchanged content, route-only). Includes design-canvas
exploration (three directions → "Editorial Nights" variant with palette re-hierarchy),
production build for Cloudflare (two-entry Vite config), automatic day/night theme
(7pm-7am = night) with manual toggle persistence. New `src/marketing/` module (format-agnostic
sibling to `src/core/` and `src/formats/`, built with `core/dom.js` utilities), new
`src/marketing/CLAUDE.md` (scoped conventions), and public assets. Three reviewers found
and fixed real issues (FOUC-prevention script fallback contradiction, opacity-based
contrast failure, undersize tap targets, dead code, fabricated-data accessibility leak).
Build/lint/test suite all passing (996 tests). Cloudflare deployment not connected — a
separate decision per `wrangler.jsonc`. See CHANGELOG.md for the full account.

**Design System rework: Editorial → Cherry (2026-09-11), whole-product visual identity
refresh**: User feedback on the landing page converged to pitch a new visual direction
(Cherry — bottle-green neutrals, unripe-cherry chartreuse accent, Bricolage Grotesque/IBM
Plex fonts, replacing Editorial's warm-brown clay/orange accent/Cabinet Grotesk/Switzer/
JetBrains Mono stack). Complete rework of `src/ui/tokens/` (colors, fonts, typography,
DESIGN.md, base.css, preview.html), `src/marketing/` landing redesign (hero section, new
tokens, accessibility fixes), plus a follow-up pass that confirmed the entire console
(organiser app, Cup Taster surfaces) renders correctly with the new palette automatically
(zero code changes needed, all screens already consume only semantic tokens), and closed two
pre-existing gaps discovered during the audit (eventsScreen.js link color, landing.css
hardcoded hex). Three reviewers (module-boundary-checker, code-reviewer, ui-accessibility-
reviewer) found and fixed real issues including a critical deuteranopia accessibility
failure in the danger color and six other serious a11y gaps. Build/lint/test passing
(1019 tests). See CHANGELOG.md for the full account.

**Standalone Timer tool (2026-09-12), out of scope per handoff §1 but
user-requested**: a new third product surface (`src/tools/timer/`) shipping at route
`/tools/timer/`, built on legacy-Seduh precedent of free community tools alongside the
organiser console. Standalone countdown timer with presets (5/10/15 min) + custom
duration, localStorage persistence, optional title label, wake-lock enabled (prevents
device sleep), beep + visual alert on expiry, accessible urgency signals (bold + outline,
not color-alone), full focus management on all state transitions. Deliberately outside the
core/formats module boundary (same architectural precedent as `src/marketing/`). Four
reviewers in parallel found and fixed real issues: 2 BLOCKING accessibility gaps (audio-only
expiry signal, focus-dropping on every render), 1 HIGH code issue (wake-lock async race),
2 HIGH test gaps (missing assertions for accessible features). All fixed and verified live
at 360px and 1024px. 35 new tests (1100 total repo-wide). **2026-09-12 follow-up 1**: cosmetic
rebrand pass — renamed from "Cupping Timer" to "Timer" (generic-purpose, not activity-specific),
removed cupping-session language, added Seduh Score branding to the tool itself and landing-page
nav links, fixed two BLOCKING tap-target-size regressions in the new links. **2026-09-12 follow-up 2**:
visual/spacing fix pass — user feedback on four cosmetic items (bigger/bolder countdown, spacing gap
between labels and inputs, hiding description while running, larger labels). Root cause: `.form-field-label`
class had zero CSS styling in this tool because the tool deliberately doesn't load the format-specific
heatsScreen.css stylesheet (module-boundary rule). Fixed by adding self-contained `.form-field` and
`.form-field-label` rules to timer.css, enlarging countdown font, conditionally hiding tagline, and fixing
a pre-existing title-field width issue found during review. ui-accessibility-reviewer signed off clean.
Known gap: not yet integrated into formats/cup-taster/timingScreen — that screen untouched, integration is
future work. See CHANGELOG.md for the full account.

**Design System rework: Cherry → Petrol (2026-09-13), second visual identity refresh**: User
decision to adopt an externally-produced design handoff (petrol-teal accent, graphite neutrals,
zero border-radius/angular cuts) as both the marketing landing-page identity AND the
app-wide design-token system — reversing every previous landing page's rule of NOT importing
shared tokens. Complete `src/ui/tokens/` replacement (colors, typography, spacing, base,
fonts; self-hosted Chakra Petch + Hanken Grotesk), `src/marketing/` landing redesign
(nav, hero slideshow, ticker, problem/proof/pricing sections, footer), new `src/core/scrollReveal.js`
(reusable scroll-reveal helper), and `public/bts/` reskinning. Two real bugs fixed while
porting: format name corrected from "BTC" to "BBTC", and nested `<a>` inside `<a>` on
format row fixed to `<span>`. Multiple accessibility regressions identified and fixed
(contrast on dark bands, opacity stacking, tap targets). Three reviewers signed off clean:
module-boundary-checker (no violations, scrollReveal confirmed reusable), ui-accessibility-
reviewer (2 BLOCKING + multiple HIGH findings found and fixed), code-reviewer (1 BLOCKING
nesting bug found and fixed). Build/lint/test passing (1100 tests). Console screens
(other than Login/Setup) still pending restyling pass against angular shape language, but
already inherit correct tokens automatically. See CHANGELOG.md for the full account.

**Guess the Bean Phase 5 (2026-09-15) — done**: Display/stage mode added at
`/guess-the-bean/display/`, with persisted session orientation, polling-based live
arrival feed, reveal animation, confetti, and a stable earliest-arrival winner tie
break. Numeric guesses remain hidden from anonymous readers until reveal through a
column-grant + narrowly scoped RPC design. Built by Codex (handoff document, this
session's usage limit), then verified live and given a follow-up manual review pass by
Claude Code, which found and fixed three real issues: a missing busy/revealed guard on
the new winner-lookup button, a `[hidden]`-vs-`display` CSS cascade bug hiding neither
the pre-reveal "?" nor the post-reveal QR footer, and a `@media (orientation: portrait)`
gate that silently ignored the organiser's persisted orientation setting on a
mismatched-shape window. See CHANGELOG.md for the full account.

**Guess the Bean Phase 6 (2026-09-15) — partial**: the organiser-facing "find the
winner's contact without touching the Supabase dashboard" piece is done (a card in
`setupScreen.js`, gated to post-reveal). **Not done, and not something an agent can
complete alone**: a real end-to-end session with actual phone submissions, and formally
marking legacy's `booth/guess`, `booth/display/guess`, `booth/setup` pages retired in
that repo's own CHANGELOG. Both need the user's own real-world action before Phase 6 can
be marked fully done.

**Guess the Bean display contrast correction (2026-09-15) — done**: participant names
in the stage live feed and winner spotlight now explicitly resolve the stage-surface text
token. This prevents the paper-surface dark text colour inherited from `body` from making
names illegible against the dark display surface. Focused display tests, lint, formatting,
and the production build all passed.

**Community tools hub (2026-09-15) — done**: `/community/` now provides a public,
design-system-native landing page for Competition Timer and Guess the Bean. It remains a
link-out shelf, not a router or a new shared tool abstraction, and reserves a factual
extension area for future downloadable guides, templates, and community tools.

**Behind the Seduh progress refresh (2026-09-16) — done**: the public `/bts/` history now
names the current Berakas work accurately at v2.0.17, including the Community shelf and
the Guess the Bean Supabase port; it no longer claims Guess the Bean remains legacy-only.

**Organiser wordmark home link (2026-09-16) — done**: the persistent top-left Seduh Score
wordmark in `/app/` now returns to the public main page, including from the sign-in screen.

**Cup Taster public results publishing (2026-09-17), not tied to a phase task**: User-
requested feature. Adds an organiser-controlled publish pipeline so the public `/results/`
archive page (previously showing only fabricated sample data) can show real Cup Taster
event results. New `events.city` column (alongside existing `venue`), new `public_results`
table with RLS and publish/unpublish RPCs, real `resultsPublishing.js` logic composing
existing `analytics.js` output, and `resultsScreen.js` re-wired to show real published
events instead of static samples. Schema-guardian and security-reviewer independently
caught and fixed a critical raw-insert bypass vulnerability (missing per-row org/event-id
trigger + overly-permissive table grants). Ui-accessibility-reviewer and code-reviewer
found and fixed five real issues: focus-drop on publish/unpublish clicks (fixed via
withFocusPreservation), missing load timeout (fixed via raceTimeout), aria-live region
rebuilt alongside siblings (fixed), missing CSS, and missing signal?.aborted guard. Code-
reviewer also caught format-agnostic results page hard-coded `'Cup Taster'` string and
null-crashes on missing event dates/cafe info — all fixed with format threading and
guards. Test-auditor strengthened an under-differentiating stats test fixture. Final
state: 1238/1238 Vitest tests, 252/252 pgTAP tests, lint clean, migrations apply from
empty and rollback verified live, live-verified against both local and cloud Supabase.
Deployed to main via PR #95, migration pushed to cloud project `wxzwanprluqmgoagbkpv`.
Known open items (not blocking): `/results/` deliberately unlinked/noindexed — nav
wiring is a separate, later decision once real event content exists; no real Cup Taster
event published yet. _Update 2026-10-05: Grey Matter Cup Taster Competition 2026 was
published and `/results/` is now linked from the nav; it is still `noindex` and not in the
sitemap/prerender list (separate decision)._

**Guess the Bean Supabase port (2026-09-14+), not tied to a phase task**: New spec, new
Supabase port. Reverses the 2026-08-23 descope decision; user confirmed the new port spec
supersedes that call.

**Phase 1: Schema + RLS** — database schema (three tables: sessions/guesses/contacts,
deliberately NOT org-scoped), RLS policies + resolver functions (two blocking security
findings found and fixed by security-reviewer), and the test suite (30 assertions, all
pgTAP). Fixed two real schema gaps: missing unique constraint on contacts.guess_id, and
sessions.creator_id FK lacked on-delete-cascade behavior. Discovered and documented a
Phase 4 implementation constraint: INSERT...RETURNING throws an RLS violation for
pre-reveal guesses; Phase 4 must generate guess UUIDs client-side. Both migrations apply
cleanly from empty, rollback blocks verified live, all 207 tests pass. Schema-guardian and
security-reviewer both signed off clean.

**Phase 2: Magic-link auth stub (2026-09-14)** — NEW architectural decision: created
`src/community/` as a third top-level module category (parallel to `src/core/` and
`src/formats/`) for format-agnostic community/standalone games with real auth +
Supabase. Guess the Bean now lives in `src/community/guess-the-bean/` with its own
scoped CLAUDE.md. Built `authScreen.js` (magic-link via signInWithOtp, 17 new tests),
separate from organiser console's `core/loginScreen.js` (temporary password for single
org). Real production auth flow verified LIVE twice in browser: magic link sent via
Mailpit's REST API, verified session establishment and `auth.uid()` resolution in
RLS-protected insert. New Vite entry for standalone game. Code-reviewer found 2 real
issues (subscription leak + URL construction), test-auditor found 2 test gaps (DOM check
depth + unconditional event test), all fixed and re-verified live. Module-boundary-checker
clean, ui-accessibility-reviewer clean (one non-blocking gap spawned as task_cb9d63b0:
aria-live "sending" state + focus recovery, shared with core/loginScreen.js). Test suite:
1100 → 1117 (17 new). All four reviewers signed off clean.

**Phase 3: Session management, organiser flow (2026-09-14)** — Discovered two real Phase 1
schema gaps by reading actual legacy source code (`booth/setup.html` and `booth/guess.html`
via `gh api` + base64 decode) rather than inferring from the spec alone: missing
`sessions.bean_count` (needed for Phase 5's winner-spotlight / closest-guess requirement,
now required + immutable via trigger, post-reveal-only read via new `app.session_bean_count()`
resolver), and RLS conflict (legacy's Reset Data / End Session danger-zone actions require
new `sessions_delete` policy + `reset_guess_session_data` SECURITY DEFINER RPC to match
existing `delete_test_event` pattern). Two new migrations: `20260914130000_guess_the_bean_
bean_count.sql` and `20260914131000_guess_the_bean_session_lifecycle.sql`. Schema-guardian
found and fixed real TOCTOU gap (reset RPC's guard wasn't repeated on mutating statements)
and advisory integrity gap (bean_count mutable post-reveal; fixed with trigger). Built UI:
`setupScreen.js` (create-session form → session list → detail view with toggles, Reveal
button, real QR code via zero-dependency `qrcode-generator@2.0.4` npm module, danger zone
with Export/Reset/End actions + native confirm dialogs + toast notifications). Data layer:
`sessions.js` with `createSession`, `listMySessions`, `updateSession`, `fetchSessionExport`,
`endSession`. Verified LIVE end-to-end twice in real browser: toggled guess-enabled and
orientation (DB persistence verified), Reveal persisted, QR code rendered as genuine ~23KB
SVG compound path (not placeholder), Reset/End actions worked. Deliberate UX departure from
legacy documented: shows list + detail (per-user sessions) vs. legacy's single localStorage
slot. Code-reviewer found 3 real issues (unmount leak in main.js, double-click race on
danger-zone buttons, permanent error banner never cleared); module-boundary-checker clean;
ui-accessibility-reviewer found 3 BLOCKING WCAG 4.1.2 gaps (checkbox label text not wrapped,
select had no accessible name, toast had no role/aria-live) + spawned broader follow-up
task_8aad08ec for cross-screen focus-loss-on-render gap (superseding task_cb9d63b0);
test-auditor found 4 test-strength gaps (chainable() too permissive, rejoin fixture couldn't
distinguish keyed vs. positional, zero error-path coverage, two vacuous tests). All fixed
and re-verified. Test suite: 1117 → 1149 JS (32 new); pgTAP: 207 → 222 (15 new covering
bean_count constraints/immutability, session_bean_count resolver, sessions_delete policy,
reset_guess_session_data RPC). Migrations apply cleanly from empty, rollback blocks verified
live. Six reviewers signed off clean. See CHANGELOG.md for full account.

**Known gaps carried to Phase 4**: Phase 3's pass/fail list includes a `?demo=1`-equivalent
criterion (verified in legacy: this lives in `booth/guess/index.html`, Phase 4's participant
entry page, not Phase 3's booth/setup). Deferred to Phase 4 where it actually belongs. See
CHANGELOG.md for the full account.

**Phase 4: Participant entry flow (2026-09-15)** — Ported the participant-entry screen from
legacy `booth/guess/index.html`: 7 view states (loading/no-session/not-found/not-active/
closed/form/confirmed), validation rules (name ≤80, guess 1–100000000, phone ≤30 / instagram
≤50 with one required), demo mode (`?demo=1`), and guess_enabled/revealed precedence.
New submit_guess() SECURITY DEFINER RPC (migration 20260915100000) handling atomic
inserts to both guesses + contacts (satisfying spec's atomicity requirement), generating
guess UUID server-side. Fixed real enumeration-oracle bug in `app.session_is_open()`: returned
NULL instead of false for nonexistent session_id via `coalesce(scalar_expr, false)` over a
zero-row subquery; fixed by switching to `EXISTS(...)`. Full accessibility retrofit
(setBusyDisabled/withFocusPreservation, role="alert" on errors, aria-invalid/aria-describedby,
explicit focus management). Originally built against Supabase Realtime (postgres_changes) for
the close-watch, but live-testing proved Realtime does not reliably deliver events for
newly-added-to-publication tables on this project's LOCAL dev stack; switched to 4-second
polling. New Vite entry for participant page (`guess-the-bean/play/`). Six reviewers clean:
schema-guardian + security-reviewer both independently caught and fixed the enumeration-oracle
bug (BLOCKING), code-reviewer found loading-state blank-screen gap (fixed), module-boundary-
checker clean, ui-accessibility-reviewer confirmed all 3 WCAG gaps closed (focus restoration,
error announcements, explicit focus moves), test-auditor found vacuous poll test + zero focus-
assertion coverage (both fixed). Test suite: 1162 → 1188 JS, 207 → 230 pgTAP. Verified live
3 times: demo-mode RPC write, end-to-end reveal-triggered close via polling, nonexistent-
session resolution. See CHANGELOG.md for full account.
