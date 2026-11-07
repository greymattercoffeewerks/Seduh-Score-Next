# Seduh Score Next — Roadmap

> **Where things live.** This file holds only the **live programme**: current state, the nameplate plan and the
> phases still in flight. Everything else was moved verbatim, nothing summarised away:
>
> | What                                                                                                                     | Where                                                                                        |
> | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
> | Open-items backlog, by area (Cup Taster and hardening, BTC, Guess the Bean, tenancy, admin/gating/branding, public site) | [`docs/backlog/`](docs/backlog/README.md) (new deferred findings go there, not here)         |
> | Dated status banners and finished Phases 1 to 5                                                                          | [`docs/archive/roadmap/`](docs/archive/roadmap/status-banners-and-finished-phases.md)        |
> | What shipped, newest first                                                                                               | [`CHANGELOG.md`](CHANGELOG.md); older entries via [`CHANGELOG-INDEX.md`](CHANGELOG-INDEX.md) |
> | Orientation for a session                                                                                                | [`STATUS.md`](STATUS.md)                                                                     |

## Current state

| Phase                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 — Foundation              | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Scaffold, Claude Code tooling, Supabase local stack + CI, doc seed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Phase 1 — Schema and security     | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Core tables, Cup Taster tables, RLS, `WITH CHECK` gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Phase 2 — Core libraries          | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `partition`, `ranking`, `advancement`, `countdown`, `timeclamp`, `entitlements`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Phase 3 — Registry and offline    | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `registry`, IndexedDB mirror + outbox, sync state panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Phase 4 — Cup Taster              | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Setup, heat generation, timing (app + manual), scoring, standings/advancement, report, export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Phase 5 — Live surfaces           | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `publish`, `viewer-shell`, projector, phone summary, automatic publishing on heat actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Phase 6 — Hardening               | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Accessibility pass, offline soak, dry run (local + production)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Tenancy core (A+B)                | ✅ Done 2026-10-14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Multi-org hardening, `my_orgs()`, org context + switcher, slug-addressed audience surfaces — see "Tenancy core" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Admin console v1 (T-ADM)          | Live in the cloud 2026-10-17 (v3.4.0); every console write path proven live 2026-10-22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | the platform operator's MFA-gated, audited console at /admin/ (create organisations, add members, change roles, audit log) — see "Admin console v1" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Gating and entitlements (T-GATE)  | Spec steps 1 to 3 built, reviewed and merged to `dev` (B1 to B5 as #300, #301, #304, #305, #307; the admin Plan panel, T-GATE.C, as #309). **Three keys enforced in the cloud since 2026-11-02 (Brunei):** `cup_taster_participants`, `events_open` and `results_archive_optional`, flipped one at a time from the admin console (audit rows 20 to 22); the other eight stay off. The six gating migrations (`20261023100000` to `20261023150000`) were pushed to the cloud project on 2026-10-26 after a green local `db:reset` and pgTAP run, and every key was confirmed `enforced = false` there; now on `main` too (verified in git 2026-10-28). These are the first gating keys ever enforced in the cloud for real (the one earlier flip, `cup_taster_participants` on and off again on 2026-10-27, was a rehearsal on a test organisation: audit rows 16 and 17). Runbooks, local only: `Handoffs and Specs/FIRST-KEY-FLIP-RUNBOOK.md`, `ARCHIVE-KEY-FLIP-RUNBOOK.md`. Next is the remaining eight keys' flips and the open decisions in "Known open items from the Plan panel", "...B5" and "...B4" | the entitlement tables, resolvers, catalog, client snapshot reader (B1), the audited admin grant writers and key switch (B2), the enforcement hooks (B3: events gate, format freeze, participant cap, go-live snapshot, admin resnapshot), the Community one-open-event rule with finish and release, and BTC gated at first go-live (B4), and the Per-event 5-day window lock (B5: restrictive row-level-security locks on the event's workspace and live displays, the locked screen, the warning before the end), and the admin Plan panel (T-GATE.C: the Keys section with preview before flip, organisation plans, grants, the manual payment confirmation, event re-snapshot and release; metadata only, no event names); eight keys are still off (`audience_branding`, `btc_format`, `cup_taster_analytics`, `cup_taster_report`, `event_window_lock`, `guess_the_bean_create`, `registration_page`, `season_history`) — see "Known open items from T-GATE.B1", "...B2", "...B3", "...B4", "...B5" and "the Plan panel", and CHANGELOG `T-GATE.B1`/`T-GATE.B2`/`T-GATE.B3`/`T-GATE.B4`/`T-GATE.B5`/`T-GATE.C` |
| Organiser branding (BR) (Level 2) | BR-D1, BR-D2 merged; BR-E1 in PR #297; no database door yet, so no brand shows; the rest is KIV                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | the brand accent colour engine, the "Powered by Seduh Score" credit and the brand slot on the audience surfaces; BR-E1 wires a brand to the surfaces — see "Organiser branding (BR)" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Password recovery (D-PW)          | D-PW1 (organiser self-service recovery and Change password) built and reviewed; PR into `dev` not merged; D-PW2 to D-PW8 NOT started, they wait for the owner's instruction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | forgot password by email, the recovery link, setting a new password, and a Change password screen for a signed-in organiser (no migration) — see "Known open items from D-PW1" and CHANGELOG `D-PW1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

---

## Version cycle plan (nameplate roadmap)

Per CONVENTIONS.md's "Versioning" section: patch/minor bumps happen on every closed
task (current: v1.0.x); a **major bump moves the nameplate to the next point in the
spiral**, and — same discipline as the handoff itself — that only happens at a genuine
capability-era boundary (a new format shipping, or a major cross-cutting relaunch), not
on a fixed schedule. This section plans those boundaries and their names in advance, so
each name's meaning is decided deliberately rather than picked in the moment.

**Deliberately retraces the legacy Seduh Score site's own spiral, same order, same
places** (`seduhscore.com/bts/`: Kiulap → Gadong → Kiarong → Menglait → Berakas →
Jerudong → Seria) — not because Next continues that site's numbering (it doesn't; see
CONVENTIONS.md, this is a separate v1.0 lineage), but because the legacy site's own
"reading the map" already assigned each place a meaning almost exactly matching what
Next's own build order needs. Retracing the same physical journey, on the new
foundation, is the point.

| Version | Place        | Ships when…                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Meaning (echoing legacy's own, where it genuinely fits)                                                                                                                                                        |
| ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.x    | **Kiulap**   | Cup Taster + Phase 6 hardening, through the Oct 4, 2026 event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Legacy's own urban core, "where the very first bracket ran." Same meaning here: the first format Next actually shipped, on the new foundation.                                                                 |
| v2.0    | **Berakas**  | ✅ **Shipped 2026-09-07** — the public marketing landing page (`src/marketing/`), console moved to `/app/`. Jumped the queue ahead of the original plan below since it shipped first — not originally planned as v2.0.                                                                                                                                                                                                                                                                                                                                                                | Legacy: "the front door — seduhscore.com, an organiser zone... quietly turning a personal tool into something a stranger could actually sign into." Near-exact match: Next's own first real public front door. |
| v3.0    | **Gadong**   | ✅ **Shipped 2026-09-23** — BTC (Barista Team Championship, renamed from BBTC at the start of Phase T-BTC.2, 2026-09-18 — BBTC is the Brunei-specific instance, not the format's own name) shipped as the platform's second real format: schema, bracket generation/advancement, five organiser screens, and the public marketing site all went live the same day. Not Throwdown, which this row originally assumed — this table tracks ship ORDER, not a specific named format, and BTC beat Throwdown to 2nd place, same class of reordering Berakas already set the precedent for. | Legacy: "realising one format was never going to be enough." Literally true again — Next's own second format arriving, whichever format that turned out to be.                                                 |
| v4.0    | **Kiarong**  | Whichever of Throwdown/Liga Seduh ships 3rd — shifted one cycle later by BTC landing ahead of both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Legacy: "Liga Seduh — a league, not a knockout... the platform starting to have opinions of its own." Exact match if Liga Seduh ships 3rd; revisit this pairing if Throwdown gets there first instead.         |
| v5.0    | **Menglait** | Whichever of Throwdown/Liga Seduh ships 4th (the one that didn't ship 3rd)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Legacy's own Menglait was a stress-test milestone (Girls Got Drip Vol. 0), not a format ship — the thematic fit stays weaker here regardless of which format lands, flagged rather than forced.                |
| v6.0+   | not named    | Whatever comes after all four formats exist — a major cross-cutting relaunch, not a fixed date                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Per CONVENTIONS.md's own rule: a cycle's name is picked when it actually starts, not before. `Jerudong`/`Seria` remain unused and unassigned.                                                                  |

**This table is a plan, not a commitment** — per CONVENTIONS.md, the nameplate only
actually moves once the triggering milestone lands, and the specific pairing (especially
v4.0/v5.0 above, now that only one of Throwdown/Liga Seduh's actual ship order is known)
should be revisited against the real shape of each format as it's scoped, not locked in
now. Update this table (and CONVENTIONS.md's "Versioning" section) at the moment each
cycle actually starts, not preemptively. **Proof this discipline works in practice, a
second time**: v2.0/Berakas was the first cycle to jump the queue (a landing page nobody
had planned for landed ahead of the planned Gadong/Throwdown slot); v3.0/Gadong just did
it again — BTC, not Throwdown, turned out to be the actual second format, caught and
renumbered here rather than left silently wrong (as it briefly was, between BTC's
2026-09-23 ship and this correction) — exactly the "plan, not a commitment" caveat this
paragraph existed to make.

Per handoff §14.

| Task                     | Verifier          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0.1 Scaffold            | `code-reviewer`   | ✅ Done — all six AC commands (`dev`, `build`, `test`, `test:e2e`, `lint`, `format:check`) verified passing; no Firebase references; no framework in `package.json`. Found and fixed a real Windows IPv6/IPv4 loopback bug in Vite's dev/preview server that broke Playwright's readiness check. **Amended 2026-08-21** (Handoff Correction 001, applied between Phase 2 and 3): Cloudflare Workers Static Assets configured (`wrangler.jsonc`), not Cloudflare Pages — a pre-existing gap this closed, since Cloudflare Pages config had never actually been built despite §15.4 referring to it. Not deployed, not connected |
| T0.2 Claude Code tooling | `code-reviewer`   | ✅ Done — 9 subagents, the PostToolUse hook, 4 custom ESLint rules. Every AC check demonstrated live: `trioCount` blocked by both the rule and the hook; a `core/`→`formats/` import caught by both the rule and a live `module-boundary-checker` run; an assertion-free test caught by a live `test-auditor` run. Caught and fixed a real word-boundary bug in `no-trio-vocabulary` during verification                                                                                                                                                                                                                       |
| T0.3 Supabase local + CI | `schema-guardian` | ✅ Done — local stack verified working (migrations apply from empty, pgTAP suite runs), CI confirmed green on real GitHub Actions runs (not just locally), `dev`/`main` with `main` protected — verified genuinely: a direct push to `main` was rejected (`GH006`) after fixing an `enforce_admins` gap that had let the first proof attempt silently bypass the rule. Required making the repo public (branch protection needs GitHub Pro for private repos on the free plan)                                                                                                                                                 |
| T0.4 Doc seed            | `code-reviewer`   | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## Phase 6 — Hardening: dry run (2026-09-06, in progress)

Full end-to-end local dry run against a synthetic 8-cupper roster and a real 3-stage
plan (Preliminary top-4, Semi-Finals top-2, Finals/champion) — every real screen
exercised in sequence: event creation, roster registration, stage plan, heat generation
(both random and manual assignment), timing in both app mode (Start/Stop) and the
2026-09-04 manual-entry mid-heat fallback, the auto-max sweep on timeout, three-state
scoring, heat confirmation, standings/tiebreak/coin-toss resolution (deliberately
engineered both a decisive tiebreak AND a genuine coin-toss draw), champion declaration,
the live audience surfaces (Splash/Projector/Phone, checked live at each stage), the
Report screen + CSV export, and `is_test` event deletion.

- **HIGH-severity, previously-undetected bug FOUND AND FIXED.** `ct_standings`'s
  `total_elapsed_secs` was fanned out by the number of scored sets in a heat — a LEFT
  JOIN from `ct_heat_entries` (one `elapsed_secs` per cupper per heat) to `ct_results`
  (N rows per scored set) multiplies `sum(he.elapsed_secs)` by the fan-out factor. A real
  12s heat in a 3-set stage displayed/ranked as 36s. This is a ranking-correctness bug,
  not merely cosmetic — `core/ranking.js`'s tiebreaker reads `total_elapsed_secs` directly
  for §7.3's "most correct, then fastest time" comparison, so two cuppers with different
  scored-set counts at read time (partial scoring, or a stage-plan `set_count` that
  changed mid-event) could have been ranked against each other's WRONG times. No mocked-
  client unit test could ever have caught this — it's a real SQL join-semantics defect,
  exactly the class of bug a dry run against a real Postgres instance exists to catch.
  Fixed via migration `20260906050000_fix_ct_standings_elapsed_fanout.sql`
  (pre-aggregates `ct_results` per `heat_entry_id` in a subquery before joining to
  `ct_heat_entries`, so that join is 1:1 instead of 1:many). Two new pgTAP assertions
  added to `supabase/tests/002_cup_taster_tables.sql` (`plan(9)` → `plan(11)`), reusing
  that file's own pre-existing fixture (`elapsed_secs=240`, 3 scored sets) — this exact
  fixture would have caught the bug immediately (720, not 240) had the assertion existed
  from the start.

- **A second, self-inflicted regression was caught by the pgTAP suite itself, before
  shipping** — the fix migration's first draft changed `correct_count`/`sets_scored`
  from `bigint` to `numeric` (Postgres promotes `sum(bigint)` to `numeric`, unlike
  `sum(int)`/`sum(smallint)`), silently, with no functional symptom in the app. Closed
  with explicit `::bigint` casts in the same migration before it was ever applied to the
  cloud project. This is exactly why the fix was pgTAP-verified rather than only
  manually spot-checked against the dry run's own live data.

- **Also confirmed correct, NOT a bug**: `standingsScreen.js`'s primary standings table
  keeps showing both members of a border tie as "tied" even after their tiebreak heat is
  confirmed — by design (see that screen's own module comment) — the actual resolution
  only commits once the organiser clicks the state-appropriate "Advance"/"Declare
  champion" button, which reads the tiebreak's own separately-fetched outcome. Verified
  the resulting `ct_stage_entries` rows were correct after commit (right cupper advanced,
  right cupper eliminated, correct provenance note) for both a decisive tiebreak
  (Preliminary) and a tiebreak-that-also-drew, requiring a coin toss (Semi-Finals).

- **pgTAP test scoping fix, CLOSED (2026-09-12).** `supabase/tests/008_delete_test_event.sql`'s final assertion now scopes the count to the fixture's own two known-surviving event ids (`where id in ('...e2', '...e9')`) instead of a bare `count(*) from events`. Eliminates ambient-database-contamination failures when local dev Postgres carries leftover events from other sessions/dev-harness runs (confirmed the "Layout Check" and "E2E Wiring Test..." rows that were sitting in this machine's own instance). pgTAP suite: 170/170 assertions passing before this session's other two fixes, 177/177 after all three. Applies cleanly from empty database via `supabase db reset` (verified multiple times as fixes landed). `schema-guardian` clean.

- **`schema-guardian` PASS** (actually ran the migration from empty, ran the full pgTAP
  suite — 143/143 — and executed the rollback block inside a real transaction to confirm
  it's byte-for-byte correct; grants/`security_invoker` preserved; no dependent DB
  object references `ct_standings`, so the drop/recreate is safe).

- **`scoring-auditor` found a second, real, PRE-EXISTING bug while reviewing the fix**
  (not introduced by this migration): `standings.js`'s `byFastestTime` computed
  `Infinity - Infinity` (`NaN`) whenever two-or-more standing rows both had a `null`
  `total_elapsed_secs` (untimed) and equal `numCorrect` — the everyday state of every
  stage entry before its heat has run, not an exotic edge case. `chainComparators`
  treats a non-zero (`NaN` included) result as "not a tie," so `rank()` assigned
  sequential positions (1, 2, 3) instead of one shared position. `core/ranking.js`
  itself was confirmed clean — it faithfully passes through whatever a comparator
  returns; the defect was entirely `standings.js`'s own null-handling. Fixed by
  comparing nullness explicitly instead of subtracting `?? Infinity` sentinels. New
  test added to `standings.test.js` (3 untimed, equally-scored rows must share position
  1. — full JS suite (989 tests) and pgTAP suite (143 assertions) both green after the
     fix. Both bugs are now closed; this migration + the `standings.js` fix are ready to
     ship together.

- **Production leg of the dry run is CLOSED (2026-09-07, scoped down by user decision to
  a representative smoke test rather than a full repeat).** Signed into the real deployed
  app (`seduh-score-next.greymatter-cw.workers.dev`) via the Claude in Chrome extension
  (password entry stays off-limits regardless of authorization — the user logged in
  themselves), created a separate `is_test: true` event ("Prod Smoke Test", never
  touching the user's own real "Grey Matter Cup Taster" rehearsal event), and ran a
  2-stage plan (Preliminary cutoff-1 → Finals) through a tie + tiebreak + resolution
  against the real cloud Postgres instance. Confirmed against production specifically:
  auth/RLS work end-to-end for a real organiser session, and the `ct_standings` fan-out
  fix (above) displays correct, un-fanned-out elapsed times live in production, not just
  locally. One real side effect caught and fixed: advancing a test event's stage
  auto-publishes it as the org's `live_sessions` row (by design — see T5.gap.automatic-
  publish above), which briefly replaced "Grey Matter Cup Taster" as the org's active
  session; restored via a direct, user-confirmed `UPDATE` once the smoke test's own
  signal was captured. Test event deleted afterward via the app's own Delete-event
  feature. `resolve_stage` itself was NOT re-exercised against production data this pass
  (the smoke test's own stage plan only ever advances one cupper past Preliminary, so
  Finals never ran) — its correctness rests on the pgTAP suite + three reviewer sign-offs
  above, not on a production-specific run; revisit if a genuine production-data
  verification of that RPC specifically is wanted before the Oct 4 event.

---

## BTC (Barista Team Championship) — Out-of-handoff format, prioritized for the November 2026 pitch

Not in the original handoff (§1.2, March decision to leave Throwdown/Liga/BTC in maintenance
mode on live Seduh Score). User decision reversal (2026-09-18): prioritized ahead of
Throwdown for an early-November 2026 pitch presentation on using BTC for next year's
4–8 team regional competition. **Correction (2026-10-10):** the November date is that pitch,
not a live event; earlier wording here called it a regional championship in early November.
Schema and security work
is Phase T-BTC.1 (done); Phases T-BTC.2–5 (setup/matches/scoring/standings/bracket UI, live
surfaces, export/timer, hardening) tracked in a Claude Docs plan artifact and deferred to
the pitch prep schedule.

### Phase T-BTC.1 — Schema and security · Done

**Three migrations deployed:**

- `supabase/migrations/20260918090000_btc_tables.sql` — 7 tables (`btc_teams`, `btc_judges`,
  `btc_matches`, `btc_match_judges`, `btc_cup_votes` fact table, `btc_match_bonuses`,
  `btc_bracket_slots`) plus 2 derived views (`btc_cup_totals`, `btc_match_totals`, `btc_standings`).
- `supabase/migrations/20260918091000_btc_rls_policies.sql` — RLS on all 7 tables via new
  `app.org_id_for_btc_match(uuid)` resolver.
- `supabase/migrations/20260918092000_btc_grants.sql` — explicit `authenticated`-only grants
  (no `anon` yet — live surfaces deferred to T-BTC.3).

**Test coverage:** 23 pgTAP assertions (`supabase/tests/012_btc_tables.sql`).

**Review outcome:** Two-pass schema-guardian run (first pass caught critical stored-column
violation, fixed by replacing with fact table + view-based aggregation); clean security-reviewer
and code-reviewer passes (3 non-blocking naming items fixed). All 275 local tests passing.
Live rollback verification: all 3 migrations apply cleanly from empty and roll back cleanly
in a transaction.

**Not done, carry forward:** Directory not yet renamed (`src/formats/bbtc/` → `src/formats/btc/`);
cloud Supabase project migrations must be pushed manually (via MCP `apply_migration`) after
PR merge, per the 2026-09-05 incident note in CLAUDE.md.

### Phase T-BTC.2 — Setup, match creation, scoring, standings, bracket generation and UI · Done

**All six completed sub-steps (per Claude Docs plan §6):**

- **Setup screen** (teams/judges roster): idempotent CRUD for team and judge registration
  (`teams.js`, `judges.js` with race-recovery on UNIQUE_VIOLATION); organiser UI with `is_test`
  banner, add/remove forms, live counts. Found and fixed during review: aria-label/error mismatch,
  missing focus-visible CSS, three blocking a11y gaps (no focus-preservation, no focus-move on
  success, unassociated error regions), and a real double-render bug where inline toast calls stole
  focus back from a newly-rebuilt success region. 51 tests passing.

- **Preliminary match creation**: new `create_btc_match` RPC (migration
  `20260918100000_btc_create_match_rpc.sql`) atomically creates a `btc_matches` row + exactly-3-judges
  assignment. Found and fixed during first review round: the RPC had no idempotency key, meaning a
  dropped-response retry could create silent duplicates; fixed by adding `removeMatch()` (plain
  DELETE, cascades properly) and a window.confirm-gated Remove button, matching `guess-the-bean/`'s
  precedent. Explicitly added `SECURITY INVOKER` per reviewer nit. 34 new pgTAP assertions covering
  validation branches. 51 JS tests.

- **Scoring** (2026-09-22): per-cup 0–3 token count for each team (not per-judge votes — design
  correction 2026-09-22). Three migrations (bonuses-per-team fix, confirm_btc_match RPC with idempotency,
  cross-event reference integrity) plus two follow-on per-cup-token corrections. Local IndexedDB drafting
  with baseUpdatedAt concurrency; UI with live vote totals, locked states, sr-only announcer, sticky
  legend. Full a11y pass (focus on locked outcomes, live regions). 60 pgTAP (revised fixtures) + 14
  cross-event assertions; 1411 JS tests (post-correction). Round 1: all 8 reviewers, 5+ blocking findings
  (offline-sync, ui-a11y, scoring-auditor, schema, test); all fixed. Round 2: all passed clean, 0 blocking
  after delta review. Design correction same-day (per-judge → per-cup tokens); all 7 reviewers re-ran
  post-correction, passed clean. All 9 BTC migrations pushed to cloud project 2026-09-22. Definition of
  Done met.

- **Preliminary standings** (2026-09-22): read-only ranked table built on `btc_standings` SQL view
  (no new migration), merging all registered teams with their standings (zero-filling unplayed).
  Reuses `core/ranking.js` unedited (points desc, wins desc, no name comparator to preserve ties).
  Does NOT reuse Cup Taster's advancement machinery (bracket generation, sub-step 5, different flow).
  Four reviewers, two blocking findings fixed: dark-mode contrast on pending-status text (4.16:1 →
  6.73:1 via `--color-text-secondary`), and test weakness (fake `.order()` was a no-op; fixed to really
  sort, fixture non-alphabetical, mutation-verified). 1424 JS tests; verified live at 360px.

- **Bracket generation and advancement** (2026-09-22, backend only): four migrations seeding fixed 8-slot
  bracket from top-8 standings (refusing ties at 8th/9th boundary), creating bracket matches, advancing
  winners/losers through downstream slots (QF→SF→final/third_place split), with row-locks preventing
  races. 39 pgTAP assertions; all 6 reviewers found and fixed 7 findings (security-reviewer 2 blocking,
  schema-guardian 2 race-condition fixes, scoring-auditor, code-reviewer, test-auditor — zero blocking
  post-fix). Definition of Done met.

- **Bracket UI screen** (2026-09-23): organiser-facing bracket display and match-creation UI. Pure
  client-side (bracket.js, bracketScreen.js), no migrations — builds on sub-step 5's backend. Shows
  "Generate bracket" action until generated; once generated, bracket tree grouped by round
  (Quarterfinals/Semifinals/Final/Third Place), each slot showing teams/TBD with inline create-match
  form (3-judge picker, capped validation). Status label correctly distinguishes pending/scoring/confirmed.
  Four reviewers: ui-a11y 1 blocking (form open/cancel dropped focus to <body>) — fixed with pendingFocus
  branches; test-auditor 1 finding (4th-judge fixture gap) — fixed; code-reviewer 1 moderate (pending vs
  scoring label collapse) — fixed with third label branch; module-boundary-checker clean. 30 new JS tests
  (1455 total). Definition of Done met.

**Review outcome:** Across all 6 sub-steps, 40+ issues found and fixed across 4+ review rounds; zero
blocking in final state. 360 pgTAP + 1455 JS tests. Rollback verified live. All 9 BTC migrations now live
on cloud project.

**App-wiring pass (2026-09-23) — DONE.** All 5 BTC screens (setup/matches/standings/bracket/scoring)
now routed in `main.js`; `mountEventHomeScreen` dispatcher reads `events.format` and mounts the
right per-event hub (Cup Taster or BTC); organisers can create BTC events through the UI via new
`formatOptions` prop on `core/eventsScreen.js`; the cross-format outbox-handler head-of-line
blocker (Cup Taster scoring route silently dropping BTC operations) is fixed with optional
`handlers` threading. Five reviewers in parallel; zero blocking findings remain; 1475 JS tests;
live-verified in browser. Definition of Done met. See CHANGELOG.md's dated entry for full account.

---

## Trust and transparency

**T-TRUST.1 (2026-09-24) — Append-only score-change log; applied to the cloud project 2026-09-24.**
The platform raised the dispute problem ("a result gets questioned and there's nothing to point
to") without solving it — today it records `time_source` (tap vs manual) but had no append-only
change history. Migration `20260924100000_score_change_log.sql` adds `score_change_log` table
and 10 AFTER row triggers (one per table: ct_heat_entries, ct_results, ct_heats, ct_stages,
ct_stage_entries, btc_cup_votes, btc_match_bonuses, btc_matches, btc_bracket_slots, events),
plus `app.forbid_parent_change()` enforcing immutable parent/identity columns, plus
`app.forbid_score_change_log_mutation()` enforcing insert-only access. Suite `017_score_change_log.sql`
runs 80 assertions across 479 total (all pass). Review rounds: schema-guardian no blocking findings (org_id
index + grants fixed); security-reviewer 5 rounds (B1 is_test-toggle bypass, S1 re-parenting
bypass, S4 identity-column bypass, B1 ct_stages.status unlogged, PASSED); scoring-auditor
no blocking findings (ct_heats status/provenance/bracket coverage added); test-auditor gates passed (medium
gaps closed); code-reviewer no blocking findings (comment accuracy, v_is_test cleanup done). Deferred/non-blocking:
display/registry names unlogged (documented); parent-status read at trigger time for stage_entries/votes/slots
(re-open itself is logged); reason forgeable until an RPC sets it; replace-all BTC re-confirm
churn (txid column lets a reader collapse it). **Do not add copy claiming an audit trail until
the migration is pushed to cloud project AND T-TRUST.2 ships.** The log itself is functional
locally; the platform-level transparency feature depends on both.
Guard `018_score_log_column_coverage.sql` (22 assertions) fails if any column on a logged table is
unclassified as logged / immutable / consciously-metadata, or if those classifications drift from
the live trigger definitions — so a future scoring column cannot silently escape the trail.
Mutation-checked: an added column, a dropped logged key and a loosened immutability trigger each fail it.

**T-TRUST.2a (2026-09-24) — Public "how this was scored" disclosure + API; migrations applied to the cloud project 2026-09-24.**
After T-TRUST.1 shipped the append-only change log, 2a builds the transparency feature: when
results are published, the public results page displays a lazy-loading disclosure "How this was
scored" showing a corrections summary (count, stage/heat, when, who by role, stated reason — NOT
raw scores). Built `get_scoring_record(event_uuid)` SECURITY DEFINER read-time function (anon-readable,
pub-results-only) returning shape-only summaries; maintained via T-TRUST.1's log trigger + a new
`score_change_counts` counter table (O(1) overflow check, avoids log-scan timeout). UI: `src/marketing/
scoringRecord.js` renders disclosure (textContent-only, reason attribution "Reason given by the
Organiser" never "verified"); per-archived-event list below archive table (reflows cleanly at 360px).
Error states: loading/empty/overflow (red flag when >5,000 after-confirm rows triggers fallback
aggregation)/truncated (>200 detail, true total shown)/unavailable/error+retry. Migrations:
`20260924100000_score_change_log.sql` (amended: counter table + value truncation to 500 chars),
`20260924110000_get_scoring_record.sql` (the function; no new table). Suite `019_get_scoring_record.sql` runs
47 assertions; total pgTAP 554 (all pass). Review rounds: security-reviewer 5 rounds (rounds 1–4 each FAILED the gate: quadratic collapse; value
size and a planner-dependent join; cost linear in log rows; the overflow `count(*)` itself linear —
fixed by window functions, 500-char value truncation at write, and the `score_change_counts`
counter; round 5 PASSED); schema-guardian no blocking findings (counter constraints + immutability
verified); code-reviewer no blocking findings (copy fixes: no overclaim of immutability, reason never
"verified"); test-auditor 3 DB rounds (low counter/churn edge cases, PASSED; survivors: ordering tie-break
and heat-number label mutants, deferred low-risk); 2 UI rounds (error-boundary rendering, PASSED with
medium survivors closed); ui-accessibility-reviewer 2 rounds (disclosure table-hiding overflow B1 fixed
by moving list below table, 360px verified, PASSED); module-boundary-checker clean (getScoringRecord
format-agnostic). Deferred/non-blocking: rehearsal-flag-count and summary scan still scale with all
log rows (partial indexes (event_id) where after_confirm future optimization); orphaned counter rows
after event delete (no FK, low risk); table bloat (autovacuum handles); edits during re-open uncounted
as corrections (re-open itself logged; dispute pack will surface this); results page unlinked/noindex
(nav integration later decision); all survivors low-risk, documented. **Both migrations were applied
to the cloud project (`wxzwanprluqmgoagbkpv`) on 2026-09-24 via `apply_migration`, in order (`score_change_log`
then `get_scoring_record`), and verified there: objects and triggers present, RLS on, grants as designed,
the counter unreadable by every API role, writes still work, `list_migrations` matches the repo.** Logging
starts from that moment: events scored before it have no history, and no cloud event is real or published
yet. Definition of Done met; no blocking findings.

**T-TRUST.2b (2026-09-25) — Organiser dispute pack; shipped, migration applied to the cloud 2026-09-25.**
`get_dispute_pack(org, event)` (STABLE SECURITY INVOKER + explicit membership guard, unified "not found",
authenticated only) returns one consistent snapshot of the exact record of an event — entries (no contact
details), Cup Taster and BTC tables, and the change log with old/new values (the oldest 20,000 rows, with
the true total and a truncated flag) — plus a self-describing `about` list of its own limits and a test-event
warning. The Cup Taster report screen has a "Dispute pack" card that downloads it as JSON (file marked
"TEST — " for rehearsal events). Reviews: security PASSED, schema no blocking, module boundary PASS, a11y
PASSED, code review no blocking (two mediums fixed), test-auditor FAILED round 1 then PASSED round 2 after
isolation fixes. pgTAP 021 = 30 assertions; suites at close: pgTAP 594, JS 1,532. **Applied
to the cloud 2026-09-25 and verified (privileges, refusals, ledger).** The public disclosure's "can be requested from the
organiser" line is now backed by this feature (Cup Taster only; BTC needs a button). Deferred (low):
ordering tie-break keys untested; empty live-region `display:none` is a shared pattern; huge-Blob revoke
timing; a third format needs the SQL function extended.

**T-TRUST.3 / T-TRUST.4 — Trust pages (Neutrality, About, Contact, Privacy, Terms): built 2026-09-25.**
Five static public pages at `/neutrality/`, `/about/`, `/contact/`, `/privacy/` and `/terms/`,
linked from every public footer. Copy source: `design/copy/*-page-draft.md`. Open: swap the
temporary contact address for `hello@seduhscore.com` once it exists (`CONTACT_EMAIL` in
`src/marketing/trustContent.js`); the Privacy page must be updated in the same PR as any change
to what personal data is held or who can read it.

Planned (not started) — Pre-event hardening items carried to future tasks

## Tenancy core — multi-org (A+B), started 2026-10-10

Plan: `Handoffs and Specs/TENANCY-WORK-PLAN.md`. Spec: `HANDOFF-CORRECTION-002.md` (supersedes
handoff §4's "one organiser, one org"; locks D-T1…D-T8). Why: `MULTI-TENANCY-AND-SEDUHID-SCOPING.md`
pillars A and B. Not in scope: gating/entitlements (D14 stays a stub), admin console, self-serve
signup, Seduh ID. Rule (lifted 2026-10-11, now that B1, B2 and B6 are in the cloud): a two-org user is created only through the service-role provisioning path (B4).

| Phase | Tasks                                                                                                                                             | Status                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A     | A1 spec lock · A2 tenancy inventory                                                                                                               | Done                                                                                     |
| B     | B1 immutable `org_id` · B2 cross-org reference audit · B5 last owner · B6 resolver disclosure · B3 `my_orgs()` · B4 provisioning · B7 anon expand | Done (B1 to B7 merged and in the cloud project)                                          |
| C     | C1 `orgContext` · C2 `main.js` wiring · C3 header switcher · C4 team follows org · C5 event creation · C6 outbox ownership · C7 deep links        | Done (C1 to C7 merged)                                                                   |
| D     | D1 slug routes + shim · D2 surfaces via resolver/RPC · D3 results attribution · D4 links and QR · D5 audience Playwright · D6 contract migration  | Done (D1 to D6 merged, released to main, and in the cloud project)                       |
| E     | E1 negative matrix · E2 console Playwright · E3 security/perf · E4 docs · E5 rollout · E6 close-out                                               | Done (E5 step 7, the real two-organisation run-through in production, passed 2026-10-14) |

Each D task is re-confirmed with the product owner before it starts (2026-10-10).

---

## Seduh ID (pillar C) — Layer 1 done (1a); 1b and owner items open

Plan and open questions: `Handoffs and Specs/MULTI-TENANCY-AND-SEDUHID-SCOPING.md` (pillar C; §6 open questions; §10 added 2026-10-26 from a review of a reference site). Sequence: tenancy (done) → gating (shipped dark) → admin console → archive + Seduh ID Layer 1 → Throwdown → Liga. Layer 1 task status (specs are local only): **T-ID.A0 to A4 are done**, the **phone checker is done**, and **B1 (identity tables), B3 (staff/affiliate roster) and B2 (the link) are done, pushed to the cloud and released to main** (2026-10-30/31, PRs #370, #372, #373, release #374). **B4 (backfill: 17 identities, 17 links), C1 (People screen), C2 (live proof) and C3 (admin counts) are done and in the cloud where they touch it (#376 to #381, release #378 and #382). C4 (#384, wording drafts, unpublished) and the closing task Z are done (2026-11-01, see CHANGELOG): every Layer 1a scope item is built, tested and in the cloud, and the repo and the cloud agreed on 93 migrations by name at that date (98 after the archive pushes, 2026-11-02).** **1b waits on the Community auto-publish (built and deployed dark, 2026-11-01, see "Archive pipeline") having seen a real publish, and on the legal read.** `people.global_person_id` is now written only by the database (guard trigger, FK to `app.seduh_identities`, `link_person_identity`). Any Seduh ID schema near `seduh_links` or the BNCC pricing and lock needs the owner's sign-off.

| Layer | Scope                                                                                                         | Status                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | Directory (names only), staff/affiliate roster (C3); E.164 phone check first                                  | 1a done (phone check, B1 to B4, C1 to C4, Z); 1b waits, owner items open |
| 2     | Competitor login and claim, cross-org RLS, registration page (D-G16), self-attested entries, provenance label | Not started; its own spec and security pass                              |
| 3     | Professional profile, exportable competition CV, cafe directory (legacy v6.2)                                 | Not started                                                              |

**E.164 phone check (done 2026-10-30; PRs #357, #358, #359, #360, all in `dev`).** `core/phone.js` owns all phone interpretation (libphonenumber-js, Brunei-first policy); `core/registry.js` refuses anything else; the database is shape-only (`app.is_e164`, `update_roster_entry` requires canonical E.164 with hint `phone_invalid`, CHECK `people_phone_e164`) and `supabase/tests/060b_phone_fixture_cases.sql` holds it to the same cases as the client. **Cloud:** the two migrations were pushed 2026-10-30 with `apply_migration` (owner-approved) as cloud versions `20261030005330` and `20261030005349`; the repo files are `20261030100000` and `20261030110000` (the push stamps its own time, as in earlier pushes; same SQL). 23 of 23 people hold a valid E.164 phone and the CHECK is validated. The `059_public_live_now.sql` test 22 flake was fixed 2026-10-30 (test only; see CHANGELOG).

**Stage B (done 2026-10-30/31; PRs #370 B1, #372 B3, #373 B2, all in `dev`, released to `main` by #374).** B1: private `app.seduh_identities` and `app.seduh_identity_merges` (no policy, owner-only ACL). B3: tenant table `public.org_person_affiliations` and `merge_people` carrying roster rows. B2: guard trigger so only the database writes `people.global_person_id`, FK to `app.seduh_identities`, `app.person_link_blocks` (the unlink home; unlink is owner SQL, no admin screen), `public.link_person_identity`; live PostgREST proof in `tests/e2e/identity-link-live.spec.js` (project `dev-identity`). The owner's runbook is in `CONVENTIONS.md`. **Cloud (owner-approved, verified):** `20261030021423` (B1), `20261030221302` (B3), `20261030221321` (B2), in that order; 23 people, 0 linked, 0 identities. Owner decisions: blank-name tombstone accepted as built; `person_link_blocks` accepted; name blanking is a separate explicit step on an erasure request. Residual signals accepted by design: the "published non-test result exists" oracle by phone, and two-organisation uuid correlation.

**Seduh ID Layer 1, still open (closed out 2026-11-01; none of this is build work for Layer 1a):**

- **Owner checks: all three done 2026-11-02.** (a) the live API itself answers `Only the following schemas are exposed: public, graphql_public` (HTTP 406, `PGRST106`) when asked for the `app` profile with the project's public key, and `anon` and `authenticated` hold no SELECT on `app.seduh_identities`; (b) the owner checked the roster country select on the Honor at 360px (fits, easy to tap; the Linked label and People filter label were taken as covered, no complaint); (c) the admin console's Seduh ID counts panel shows 17, matching the backfill's 17 identities and 17 links. Nothing is left for the owner in Layer 1a.
- **Legal read (gates 1b and publishing the C4 wording):** the Personal Data Protection Order, 2025 (the owner's understanding is Part 1 effective 1 January 2025 and Parts 3 to 9 effective 1 January 2026, unconfirmed against the Gazette); who is the controller of the identity table; a data protection officer and contact address; cross-border (Singapore) wording; access and withdrawal timings; the retention rule for orphan identities; minors.
- **Publish the C4 wording** (done as drafts, #384: `design/copy/seduh-id-wording-DRAFT.md`; the owner edits and publishes; the Privacy page is already behind the data).
- **Section 8 sign-offs** (`HANDOFF-CORRECTION-004.md`): anything near `seduh_links`; commercial relationship values or any view showing an affiliation outside its organisation; the A8 statement against the BNCC safeguards; the "Seduh ID is free" claim (dropped from the drafts for now); anything implying a price, tier, lock or module removability.
- **Row-id existence oracle on 24 other tenant tables** (pre-existing, low): the owner's instruction is held in the session "Seduh ID: close row-id existence leak"; `org_person_affiliations` is fixed (#381).
- **1b (archive feed, T-ID.D1): in the cloud and in `queue` mode (2026-11-03); nothing queued or created yet.** Released as v3.5.1 (#412, #413). D1a (queue, mode, fail-open AFTER trigger on `public_results`, podium-only feed, review, undo, `auto` with caps built and off), D1b (four queue counts in the console) and D1c (owner scripts) are live; D1d, the one Privacy sentence, is published (#414). Cloud versions `20261103135639` (`seduh_feed`) and `20261103135702` (`admin_seduh_id_counts_feed`); the mode is `queue`. The only published podium predates the trigger, so `app.seduh_feed_review()` reports `podium_results_not_queued: 1`; the first Community publish after this will put a row on the queue. Owed: review the queue after each publish and run the feed for trusted ids (`CONVENTIONS.md` "Seduh ID feed"). Owner decisions of 2026-11-03: the opt-out promises acknowledgement within 10 days and completion within 30 days (published on the Privacy page); the owner reviews the queue weekly; the feed stays in `queue` mode for now. Still owed: `hello@seduhscore.com` forwarding to the owner's mailbox (Cloudflare Email Routing), then swapping `CONTACT_EMAIL`. `auto` waits on those and on a `pg_cron` job for `app.seduh_feed_auto_run()` (not scheduled by the migration), and is decided again only after several real reviews. The forgery gap (a member can stage a podium naming a chosen phone) is documented, not closed. Layers 2 and 3 have their own specs.
- **Done, for the record:** T-ID.B4 (#376: backfill run in the cloud, 17 identities and 17 links); T-ID.C1 (#377: call `link_person_identity` after registering a person or changing a phone; a phone change clears the link and nothing re-links automatically); C2 (#380); C3 (#379); C4 (#384); Z.
- **Navigation redesign (hamburger at all widths):** logged as a design item; not scheduled.

## Archive pipeline (T-ARC; gating step 4) — built, deployed and switched on (2026-11-02); nothing published yet

Spec and owner answers are local only (`Handoffs and Specs/ARCHIVE-PIPELINE-AND-SEDUH-ID-1B-SPEC-DRAFT.md`, `HANDOFF-CORRECTION-005.md`): the database publishes a Community event's podium about 24 hours after `events.ended_at`, failing open, shipped dark behind `results_archive_optional` and flipped by the owner after `events_open` (switched on 2026-11-02). Decisions 1 to 11 are answered (pg_cron, browser-staged snapshot with a stub fallback, queue-first Seduh ID feed, soft unpublish, in-app warning only); decision 12 (controller/processor, DPO, cross-border wording) stays with the owner and counsel.

| Task     | What                                                                                                                                                    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-ARC.0  | Owner answers recorded                                                                                                                                  | Done (2026-11-01)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T-ARC.1  | `app.archive_events`, `app.archive_tick()`, due-finder, retry, eligibility, idempotency, failure isolation, `is_test` re-check; `050` list; pgTAP `066` | Done: merged to `dev` (#386, 2026-11-01); in the cloud (`20261101082913 archive_tick`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T-ARC.2  | `stage_archive_payload` RPC and the client call; the freshness rule's writer                                                                            | Done: merged to `dev` (#388, 2026-11-01); in the cloud (`20261101082948 stage_archive_payload`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| T-ARC.3  | `set_archive_listing`, soft-unpublish state `removed`, `admin_archive_status` counts                                                                    | Done: merged to `dev` (#389, 2026-11-01); in the cloud (`20261101083027 archive_listing_admin`); no console screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T-ARC.6  | Privacy, Terms, pricing-page and participant-notice wording for the archive                                                                             | Done: Privacy and Terms wording (#397) and pricing wording 3a to 3c (#398) merged to `dev` and live on `main` (release #399, 2026-11-02); drafts #390; item 3d (the "ahead of the code" comment in `pricingContent.js`) removed after the key was flipped; **still held**: participant notice, 1h Seduh ID sentence, 12-month ledger purge sentences, Terms 2c remedy; open legal items flagged, not settled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T-ARC.4  | Organiser panel, tick box, take-down, stub-tolerant results pages                                                                                       | Done: merged to `dev` (#391, 2026-11-01); live inertly on `main` (release #399), cannot light up until the key is flipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| T-ARC.4b | `my_entitlements` reports `enforced` for `results_archive_optional` (migration `20261101150000`, `isEnforced`, pgTAP `069`)                             | Done: merged to `dev` (#392); in the cloud (`20261101083054 my_entitlements_enforced`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T-ARC.4c | `archive_event_status` member-readable ledger status; panel stops guessing per device (migration `20261101160000`, pgTAP `070`)                         | Done: merged to `dev` (#395); in the cloud (`20261101083112 archive_event_status`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T-ARC.5  | Live proof: API-level (`dev-archive`, PR #393) and browser-level at 360px (`dev-archive-ui`)                                                            | Done: API-level (`dev-archive`, #393) and browser-level (`dev-archive-ui`, #396), both merged to `dev`; local stack only; report-screen publish button not driven (needs a complete Cup Taster event)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| T-ARC.7  | Cloud rollout (extension, migration push, schedule, flip)                                                                                               | **Rollout complete 2026-11-02 (Brunei); nothing published yet.** Owner-approved. On 2026-11-01: five migrations pushed (cloud `20261101082913`, `...082948`, `...083027`, `...083054`, `...083112`); `pg_cron` 1.6.4 created; job 1 `archive-tick` (`*/5 * * * *`, as `postgres`, first `select app.archive_tick(null)`, a null floor that creates no ledger rows); release #399 live. **On 2026-11-02 (UTC 2026-11-01), the owner's steps (`ARCHIVE-KEY-FLIP-RUNBOOK.md`, local):** the three keys flipped one at a time, each after a preview: `cup_taster_participants` 01:11:41 Brunei (audit row 20, `would_lose` 0), `events_open` 01:12:56 (row 21, `would_lose` 0), `results_archive_optional` 01:13:56 (row 22, `2026-11-01 17:13:56.149318+00`, `would_lose` 1: Throwaway Org, Community, no events, nothing real lost); then job 1 rescheduled to `select app.archive_tick('2026-11-01 17:13:56.149318+00')`, so the flip moment is the floor and only events that end at or after it are tracked. The 17:30 UTC run succeeded; ledger `app.archive_events` has 0 rows; no event has ended since the floor. **Not yet seen:** a real publish. The first proof is the first Community event that ends after the floor, about 24 hours later (Annual events default to a named-only stub unless the organiser ticks the listing box) |
| T-ARC.8  | BTC ended fact (optional)                                                                                                                               | Deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T-ARC.Z  | Close-out and the version bump                                                                                                                          | Done (2026-11-02): see CHANGELOG; `package.json` 3.5.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Owed after the 2026-11-02 key flips (the archive is switched on and has never published anything in the cloud):** (1) watch the first real publication, about 24 hours after the first Community event that ends after the floor, and check it against `app.archive_events` (`ARCHIVE-KEY-FLIP-RUNBOOK.md`, local); (2) with the owner's say-so, the landing page's "when the event ends" Community prose (`landingScreen.js`, pinned by `landingScreen.test.js`); (3) the pricing-page "if a reliable podium is available" nuance (owner not yet decided); (4) a periodic delete for `cron.job_run_details` (about 288 rows a day, no purge job exists); (5) T-ARC.8 (BTC ended fact) deferred; (6) Seduh ID 1b (D1, brief local in `T-ID-D1-BUILD-BRIEF.md`) not started and held until the pipeline has seen a real publish; (7) KIV legal items (controller or processor, counsel's read, Gazette confirmation of PDPO commencement); the data protection contact is Grey Matter Coffee Werks, D29, Bangunan Lim Eng Ming, Kg Kiulap, Brunei Darussalam, greymatter.cw@outlook.com. Caveat: the confirm value typed for `results_archive_optional` was 1 (`would_lose` 1, the Throwaway Org). Repo versus cloud: all 98 repo migrations are in the cloud as of 2026-11-02. Version 3.5.0.

**KIV (owner, 2026-11-01):** legal advice is not being sought now; basic compliance on the PDPO and the AITI infokit is the plan. Controller vs processor, a lawyer's read of the Privacy/Terms clauses and Gazette confirmation of PDPO commencement are kept in view, not blocking (`design/copy/archive-wording-DRAFT.md`, section 8). Supabase publishes a Data Processing Addendum (v1, 2026-08-01); the owner still confirms it applies to this project's plan.

**T-ARC.1 deviations from the draft, for ARC.2 and ARC.7 to know:** (1) the tick answers `{"dark": true}` and does nothing while `results_archive_optional` is unenforced, because `app.has_entitlement` is TRUE for an unenforced key (the draft's "false means compulsory" would have stubbed every event on day one); (2) the tick takes a `p_enqueue_from` floor and creates rows only for events that ended at or after it, because migration `20261023130000` backfilled `ended_at` for every already-concluded event and an unbounded finder would publish the whole history at the flip; the cron command carries the floor (`select app.archive_tick('<flip moment>')`); (3) `outcome_via` is `auto`, `organiser_early`, `organiser_late`, `admin`; (4) `due_at` is nullable so an organiser RPC can make a row before the event ends; (5) the entitlement is evaluated at `due_at`, not at tick time. Unverified: pg_cron in the CI image (the local stack has it preloaded and a minute job ran successfully in a rolled-back probe; CI was not tried), the `cron` schema grants in the cloud after `create extension`.

**Proposed adoptions from the 2026-10-26 reference review (specialtycoffeecommunity.com, a pre-launch concept).** Each needs the owner's decision; none changes Layer 1 scope or pulls Layer 2 forward.

- **Layer 1, no extra build:** a provenance marker reserved in the identity design (A1); founding numbers, if adopted, assigned on claim and never at passive creation (A3); the affiliation `relationship` text kept extensible (A6); a short public statement of purpose as copy with the directory (A8).
- **Layer 2 candidates, KIV:** provenance label shown (A1), a completeness bar (A2), founding numbers (A3), role breadth (A6), privacy defaults decided before the spec is written (A7). Open questions §6.6 to §6.8.
- **Layer 3 candidates, KIV:** the exportable one-page competition CV (A4) and an "open to opportunities" flag (A5).
- **Considered, not adopted:** employer reviews, a jobs board, ticketing and crowdfunding, and an open-to-all assessor programme (scoping doc §10.3).

---

## Admin console v1 (T-ADM), built 2026-10-15 to 2026-10-16

Plan: `Handoffs and Specs/ADMIN-CONSOLE-WORK-PLAN.md`. Spec: `Handoffs and Specs/ADMIN-CONSOLE-SPEC.md`. Both are local and gitignored, not in git. Why: provisioning an organisation was hand-written service-role SQL. v1 is a separate console at `/admin/` for the platform operator only. It has its own Supabase client, a second-factor gate enforced in the database (`app.require_platform_admin()`: an active platform-admin row, an `aal2` token, a TOTP verification in the last 60 minutes, and a live session), and an append-only audit log. It reads metadata only (organisation names, link names, members with email, role and joined date, counts, dates, the audit log), never participant data. Not in scope: gating and entitlements. D14 stays a stub until that is built; the console's panel registry and audit log are built to take a "Plan" panel.

| Phase | Batches and tasks                                                                                                                                                                                                                                                                                                                               | Status                                                                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Batch 1: spec lock and recon                                                                                                                                                                                                                                                                                                                    | Done. The spec is locked; its decisions D-A9, D-A14 and D-A15 were owner-approved 2026-10-15 (recorded in the T-ADM.B1 entry). No CHANGELOG entry of its own. |
| B     | Batches 2 to 6: platform-admin identity (T-ADM.B1, #271), audit log (B2, #272), admin read RPCs (B3, #273), audited write RPCs (B4, #274), guard proofs and the CONVENTIONS note (B5, #275)                                                                                                                                                     | Done, merged to dev. Migrations `20261014100000` to `20261014130000` pushed to the cloud 2026-10-16.                                                          |
| C     | Batch 7: MFA on, the live-session gate, the `admin-accounts` Edge Function and the account-create audit writer (T-ADM.B6, #276)                                                                                                                                                                                                                 | Done, merged to dev. Migrations `20261014140000` and `20261014150000` pushed to the cloud 2026-10-16; the function deployed 2026-10-16/17.                    |
| D     | Batches 8 to 11: console shell with sign-in and the second-factor gate (T-ADM.D1, #277); shared screen shapes and sign-in and sign-out requests (the refactor, #278); organisation list and detail (D2, #279); create organisation with a new or existing owner (D3, #280); add a member, change a role, the audit log screen (D4 and D5, #282) | Done, merged to dev. The core-sharing refactor (#281) is merged too.                                                                                          |
| E     | Batch 12: the adversarial pass over the admin surface (T-ADM.E1, #283). Batch 13: this docs close-out (T-ADM.E2 and E4)                                                                                                                                                                                                                         | Done, merged to dev (#283 and #284).                                                                                                                          |

**Rolled out 2026-10-16/17 (release PR #285, v3.4.0); next is gating.** The rollout (CLAUDE.md's "Platform administration", the spec's section 8) is done, and the two paths first left unproven (`account.create` and `member.add`) were run live on 2026-10-22 (below). The first platform admin is `greymatter.cw@outlook.com`, with a verified authenticator. Gating and entitlements come next; D14 stays a stub until built. The open items are in "Known open items from T-ADM.\*" below.

---

**First-flip preparation (2026-10-28, local files in `Handoffs and Specs/`, force-added to git).** `FIRST-KEY-FLIP-RUNBOOK.md` is the by-hand runbook for the first key, `cup_taster_participants` (owner steps vs Claude steps, preconditions, preview, watch list, rollback, order of the remaining keys). `WINDOW-LOCK-ANNOUNCEMENT-DRAFT.md` is the unsent draft notice for `event_window_lock` with its surface inventory and ten owner questions. Neither flips or sends anything. See CHANGELOG `First-flip preparation`.

## Admin console: disable or delete (requested by the owner, 2026-10-22)

**Requested, not started, not scheduled (KIV).** The `/admin/` console can create an organisation, add a member and change a role, but it **cannot disable or delete anything**: an organisation, a member, or a login. A throwaway is removed by SQL today (`console-smoke` on 2026-10-17; the "Noice Test" organisation created on 2026-10-22 is the next one), and an orphan login (`account_stranded`) cannot be removed from the console at all. The owner wants a disable and a delete function in the console. It needs its own short spec before any code (the admin console's own rule: `Handoffs and Specs/ADMIN-CONSOLE-SPEC.md`, local), and the points below are the ones the design must settle.

- **Two different things.** **Disable** is reversible (suspend an organisation so its members cannot use it, or ban a login, with an audited reason and a way back). **Delete** is not (an organisation and everything under it, or a login). Build disable first if only one is wanted soon.
- **Every action is the database's.** A `public.admin_*` `SECURITY DEFINER` function that opens with `app.require_platform_admin()`, writes its audit row in the same transaction (`org.disable`, `org.delete`, `member.remove`, `account.disable`, `account.delete`; a **required reason**, and the old and new state in the detail), and is added to the pgTAP guards (`048`, `050`), the admin adversarial list and, as a table function, the `041` exemptions. Never a client-side delete.
- **Deleting an organisation cascades.** It frees the slug for reuse, and a slug sits in printed and QR audience links (CLAUDE.md, T-TEN); it leaves its public results in the global archive (D-T4); and, once branding exists, its Storage objects are not removed by a SQL delete (a known gap, BRANDING-SPEC 4.2). The design must say what happens to each, and refuse or warn when the organisation has real (non-test) events, as `delete_test_event` already does for events.
- **Protect the platform.** No target of self (`admin_self_target`), never the last owner of an organisation (`last_owner`), never another platform admin (the Team screen already refuses admins), and a **typed confirmation** (the slug or the email) with a **count preview** of what would go, the way the gating spec's flips are meant to work.
- **A login is in Supabase Auth, not just in our tables.** Banning or deleting one is an Auth admin call (service role), so it goes through an Edge Function like `admin-accounts`, in two steps, which is how `account.create` can leave an orphan. A **ban only pauses the admin functions and does not end sessions** (CLAUDE.md), so disable must also end the login's sessions. Deleting an account that belongs to a second organisation must not remove it from that one by surprise.
- **Test data.** The cleanest reuse is to let the console delete an organisation flagged as a test organisation freely and require the full confirmation for a real one.
- **Tests that hold it:** a pgTAP file for the functions (including a negative test that a non-admin, an admin without a recent TOTP, and an organiser of that organisation are refused and learn nothing), the admin adversarial Playwright list, and the manual Edge Function script run before rollout.

**Done on 2026-10-22 (live):** the owner created the organisation "Noice Test" (`noice-test`) from the console with a new login: the audit log recorded `account.create` and `org.create` (rows 4 and 5), which proves the Edge Function in the cloud for the first time. Then, the same day, the owner added an existing account (one-time password still unset, so the attestation tick) to a second throwaway organisation, "Noice 2 Test": audit rows 8 (`org.create`, `attested: true`) and 9 (`member.add`, role owner, `attested: true`). **Every console write path has now run against the cloud.**

---

## Organiser branding (BR), Level 2, started 2026-10-17

Spec: `Handoffs and Specs/BRANDING-SPEC.md` (local, gitignored, not in git). Why: an organiser's own accent colour, name and logo on the audience surfaces (projector, phone, splash), with a fixed "Powered by Seduh Score" credit on every branded surface. The screens ask for a brand (BR-E1), but the database door they ask does not exist yet (BR-B1), so no brand reaches a screen.

| Phase | Tasks                                                                                                                                                                                                                 | Status                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D     | BR-D1, the brand accent colour engine (`core/brandColor.js`, PR #289). BR-D2, the credit and the brand slot on the audience surfaces (`core/poweredBy.js`, `brandSlot.js`, PR #291)                                   | Done, merged to `dev` 2026-10-17. Not in production: no release PR yet. 360px checked by `ui-accessibility-reviewer`.    |
| E     | BR-E1, the wiring: `core/brandDoor.js` (the door client and the per-screen source), the brand carried through `formatBody`, `stageSurface`, `viewer-shell`, `splashScreen`, `liveSurfaces.js` and `main.js` (PR #297) | Built and reviewed, 2026-10-18. Not released: it must not reach `main` before the door exists (BR-B1) and the BTC pitch. |

**Status 2026-10-18 (owner): every branding task after BR-E1 is KIV** (kept in view, not scheduled): BR-B1 (tables and the public door), BR-B2 (Storage), BR-C1 (the upload function), BR-F1 (the Branding screen), BR-G1 (admin clear), BR-H1 (final pass and rollout), the banners and the logo on the printed results sheet. BR-B1 needs gating's G-B1 first (the `audience_branding` key); gating's spec is locked and its build is KIV too. A release PR, `dev` to `main`, waits for the door. The open items are in "Known open items from BR-D1 and BR-D2" and "Known open items from BR-E1" below.

---

## Shared draw board: lift the Random Selector's split-flap board into core (requested by the owner, 2026-11-03)

Raised while drafting the Throwdown spec (`Handoffs and Specs/THROWDOWN-SPEC-DRAFT.md`, Q13). Throwdown's lucky loser draw and latte art draw will call the Random Selector. The owner chose to lift only the fair-draw engine (`weightedIndex`, the `crypto.getRandomValues` draw) into `src/core/` first, and to keep the board as a later, separate task.

- **Lift the split-flap board into a shared `src/core/` component that any module can call.** Today the board lives inside `mountRandomSelector` in `src/tools/random-selector/randomSelectorScreen.js` (about 1,100 lines, with the tool's storage, share links, CSV and history), so no other module can use it. Rated 7/10 difficulty on 2026-11-03: split the board out of that function, move its CSS and accessibility tests (no flashing, reduced motion, announcements, focus) with it, and point the free tool at the shared board. A format may not import from `src/tools/`, so this has to go through `core/` with `module-boundary-checker` sign-off, not a copy.
- **Trigger: a third consumer of the board.** Throwdown's two draws can use their own plain reveal on the lifted engine. Do this when a third place needs the split-flap look (for example Liga Seduh heats or Cup Taster running orders), or sooner if the owner wants the free tool and Throwdown to look identical. (Throwdown spec, Q13)
- **When the engine is lifted (Throwdown TD.4), keep it free of the tool's storage and share-link code**, so this later split stays small. (Throwdown spec, Q13)

## Throwdown (third format) — Phase TD.1 Core, started 2026-11-03

Spec: `Handoffs and Specs/THROWDOWN-SPEC-DRAFT.md` (local only). Branch `claude/throwdown-td1-core-d41fad`, PR into `dev`.

**Cross-check (spec section 11): can `core/ranking` / `core/advancement` express a knockout?** No. Both take one
ranked list and a cutoff (positions, border ties); a knockout has no standings, only per-match winners that feed the next
round. Knockout advancement is Throwdown-specific and stays in `src/formats/throwdown/` (and the SQL RPC that writes it).
What is generic and goes to `core/`: a **seeded shuffle** (`core/seededShuffle.js`, recorded seed so a draw can be
explained afterwards; Liga heats and the lucky-loser draw can reuse it). Vote tallying is match-slot shaped and stays in
the format. Bracket layout is Throwdown-only until a second knockout format exists. No `core/` primitive is edited.

**Tasks** (each small, each with tests; reviewers per root `CLAUDE.md`):

- T-TD.1.1 Entitlement keys: `throwdown_participants` cap (Community 8) plus the four module key slots, in the catalog and a `$catalog_add$` migration (first commit).
- T-TD.1.2 Schema: `td_settings`, `td_draws`, `td_rounds` (`kind`, `phase`), `td_matches`, `td_slots` (2..4), `td_votes` (rows, no judge identity), frozen parents, RLS, grants, rollback; `event_entries` cap hook gains the Throwdown branch.
- T-TD.1.3 RPCs: `td_start_event` (draw, byes, lock), `td_confirm_match`, `td_record_walkover`, the single derived-advancement function (next round, 3rd place), idempotent. Matrices `040` / `041`.
- T-TD.1.4 Pure modules: `votes.js` (tally, leader, level), `bracket.js` (derive rounds, names, champion, no projection), `seeding.js` (random + manual validation), `modules.js` (toggle registry, dependencies, lock), `core/seededShuffle.js`.
- T-TD.1.5 Data layer + live payload + outbox handlers (`liveSession.js`, `outboxHandlers.js`).
- T-TD.1.6 Console: dashboard, setup/roster, draw (random + manual), bracket, vote screen, walkover, champion banner; routes in `main.js`; format option.
- T-TD.1.7 Projector + phone bodies registered in `liveSurfaces.js`; `is_test` on every surface.
- T-TD.1.8 Results page, e2e of a full 8-player test event, reviewers, kb-sync, PR.

**Assumed defaults (owner may overrule):** the timer is display-only (no elapsed time stored, no `clampElapsed`); the
random draw stores its shuffle seed; any judge count is accepted and Confirm is disabled while votes are level (an extra
tap resolves an even panel); competitor status is `event_entries.withdrawn` (so Q8b can be settled later without a
schema change); no call site branches on a tier (D14); the 3rd place match is played whenever both semi-final losers exist and are active (decided 2026-11-03, T-TD.1.9).

**TD.1 status (2026-11-03): built, in review.** Follow-ups and owner questions raised by the reviewers (none block TD.1):

- **Decided (owner, 2026-11-03): repeat byes stay as built.** If the random bracket happens to give a competitor two or more byes, so be it. No rule change. (Spec section 5.)
- **3rd place after a walkover or bye: DECIDED 2026-11-03, built as T-TD.1.9.** The 3rd place match is made whenever both semi-final losers exist and are active (`event_entries.withdrawn` is false). A walkover no longer blocks it; a bye (no loser) or a withdrawn loser does. Migration `20261103140000` (new; not yet in the cloud until the main session applies it).
- **Decided (owner, 2026-11-03): judge count stays advisory.** The 1 to 15 range stays; no server refusal of taps beyond the panel size, so an extra tap can still resolve an even panel (Q5).
- **Decided (owner, 2026-11-03): Q8b.** Only active (non-withdrawn) competitors count toward the 8-player Community cap. This is what is built (the cap trigger counts `not withdrawn`); no change.
- **Corrections after a confirm** (an organiser tapped the wrong winner): not in TD.1. A reopen must also undo the next round if nothing in it has started; design with the owner.
- **Draw is recorded, not verified.** The database stores the seed but cannot replay the browser shuffle, so "explain the draw" relies on `randomPairs(entries, seed)` re-run by a person. A recompute check at start is possible client-side only.
- **Ledger scope (pre-existing class).** `processed_operations` lookups are global by id (all RPCs), not scoped to org and kind. Guessing a v4 id is infeasible; scope it in one migration for every RPC.
- **Replay after the Per-event window closes** is reported as a dropped write (the window guard runs before the ledger check).
- **Pool matches (TD.3):** the loser join in `app.td_advance` assumes pair matches; fix when pool rounds land.
- **Focus and live regions (accessibility nits fixed in TD.1):** a 360px and 16:9 browser pass and a screen-reader pass are still owed.
- **Public results and the formatted report** are TD.2 (archive write and PDF). TD.1 ships an organiser-facing printable results page only.
