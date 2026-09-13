# Seduh Score Next — Roadmap

_State: Phase 0 done; Phase 1 done (T1.1–T1.4); Phase 2 done (T2.1–T2.6); Phase 3 done
(T3.1–T3.3); Phase 4 done (T4.1–T4.8, plus two 2026-08-27 follow-ups closing T4.1's
stage-plan UI gap and its roster-registration UI gap, a 2026-08-29 follow-up closing
T4.3/T4.4's direct-write gap, a further 2026-08-29 follow-up closing T4.2's DB-level
station-uniqueness gap, a further 2026-08-29 follow-up closing the cross-module outbox
handler-map composition gap, a further 2026-08-29 follow-up closing the
setupScreen/rosterScreen hung-load timeout/retry gap, and a further 2026-08-29 follow-up
closing T4.2's heat-generation resumability gap); Phase 5 done (T5.1, T5.2, T5.3, T5.4,
the 2026-08-28 holding-state follow-up, and the cross-surface Playwright AC); app wiring
done (2026-08-30, not tied to a phase task — router, organiser shell, event management,
`#/live/*` routes connecting every already-built screen into one navigable app for the
first time); temporary login screen done (2026-08-30, also not tied to a phase task — a
plain sign-in form, explicitly scoped as temporary ahead of D14's real access control) —
matches CHANGELOG.md as of 2026-08-30_

The living tracker for the handoff's build plan (§14). The handoff itself stays frozen
as the original spec — this file is what's actually shipped, updated as tasks and phases
close. If the two ever disagree, this file is right about status; the handoff is right
about original design intent.

---

## Current state

| Phase                          | Status  | What it covers                                                                                            |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------- |
| Phase 0 — Foundation           | ✅ Done | Scaffold, Claude Code tooling, Supabase local stack + CI, doc seed                                        |
| Phase 1 — Schema and security  | ✅ Done | Core tables, Cup Taster tables, RLS, `WITH CHECK` gate                                                    |
| Phase 2 — Core libraries       | ✅ Done | `partition`, `ranking`, `advancement`, `countdown`, `timeclamp`, `entitlements`                           |
| Phase 3 — Registry and offline | ✅ Done | `registry`, IndexedDB mirror + outbox, sync state panel                                                   |
| Phase 4 — Cup Taster           | ✅ Done | Setup, heat generation, timing (app + manual), scoring, standings/advancement, report, export             |
| Phase 5 — Live surfaces        | ✅ Done | `publish`, `viewer-shell`, projector, phone summary, automatic publishing on heat actions                 |
| Phase 6 — Hardening            | ✅ Done | Accessibility pass, offline soak, dry run (local + production) — **Guess the Bean (descoped, see below)** |

**Deadline: 4 October 2026, Cup Tasters event.**

**2026-08-23, user decision: Guess the Bean will NOT be rebuilt in this codebase.** The
original v4.x implementation is booth-only, temporary, and already has zero contact with
the identity core (D17) — the user decided reusing the working v4.x game as-is is the
right call rather than reinventing it here, since none of this project's reasons for
rebuilding Cup Taster (fixed advancement, `is_test` visibility, the outbox/atomic-write
discipline, etc.) apply to a standalone booth game with no roster/scoring/advancement
surface. Phase 6 narrows to just the hardening pass (accessibility, offline soak, dry
run against the real roster) — §5.4/§14's "spec written at the start of the phase" for
Guess the Bean is moot; there's no spec to write because there's no rebuild. Revisit only
if the v4.x game turns out not to actually work at the venue.

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

| Version | Place        | Ships when…                                                                                                                                                                                                            | Meaning (echoing legacy's own, where it genuinely fits)                                                                                                                                                                                                                                                                  |
| ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1.x    | **Kiulap**   | Cup Taster + Phase 6 hardening, through the Oct 4, 2026 event                                                                                                                                                          | Legacy's own urban core, "where the very first bracket ran." Same meaning here: the first format Next actually shipped, on the new foundation.                                                                                                                                                                           |
| v2.0    | **Berakas**  | ✅ **Shipped 2026-09-07** — the public marketing landing page (`src/marketing/`), console moved to `/app/`. Jumped the queue ahead of the original plan below since it shipped first — not originally planned as v2.0. | Legacy: "the front door — seduhscore.com, an organiser zone... quietly turning a personal tool into something a stranger could actually sign into." Near-exact match: Next's own first real public front door.                                                                                                           |
| v3.0    | **Gadong**   | Throwdown ships (2nd format) — shifted one cycle later by Berakas landing ahead of it                                                                                                                                  | Legacy: "realising one format was never going to be enough." Literally true again — Next's own second format arriving.                                                                                                                                                                                                   |
| v4.0    | **Kiarong**  | Liga Seduh ships (3rd format)                                                                                                                                                                                          | Legacy: "Liga Seduh — a league, not a knockout... the platform starting to have opinions of its own." An exact match both times — same format, same place.                                                                                                                                                               |
| v5.0    | **Menglait** | BBTC ships (4th format)                                                                                                                                                                                                | Legacy's own Menglait was a stress-test milestone (Girls Got Drip Vol. 0), not a format ship — the thematic fit is weaker here, flagged rather than forced. Revisit this pairing once BBTC's actual shape is scoped; a stress-test cycle (first live BBTC event) may fit the name better than the format's initial ship. |
| v6.0+   | not named    | Whatever comes after all four formats exist — a major cross-cutting relaunch, not a fixed date                                                                                                                         | Per CONVENTIONS.md's own rule: a cycle's name is picked when it actually starts, not before. `Jerudong`/`Seria` remain unused and unassigned.                                                                                                                                                                            |

**This table is a plan, not a commitment** — per CONVENTIONS.md, the nameplate only
actually moves once the triggering milestone lands, and the specific pairing (especially
v5.0/Menglait, flagged above) should be revisited against the real shape of each format
as it's scoped, not locked in now. Update this table (and CONVENTIONS.md's "Versioning"
section) at the moment each cycle actually starts, not preemptively. **Proof this
discipline works in practice**: v2.0/Berakas above is the first cycle to actually land,
and it landed as a genuine reordering (a landing page nobody had planned for jumped ahead
of the planned Gadong/Throwdown slot) rather than forcing the pre-written plan to hold —
exactly the "plan, not a commitment" caveat this paragraph existed to make.

Per handoff §14.

| Task                     | Verifier          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0.1 Scaffold            | `code-reviewer`   | ✅ Done — all six AC commands (`dev`, `build`, `test`, `test:e2e`, `lint`, `format:check`) verified passing; no Firebase references; no framework in `package.json`. Found and fixed a real Windows IPv6/IPv4 loopback bug in Vite's dev/preview server that broke Playwright's readiness check. **Amended 2026-08-21** (Handoff Correction 001, applied between Phase 2 and 3): Cloudflare Workers Static Assets configured (`wrangler.jsonc`), not Cloudflare Pages — a pre-existing gap this closed, since Cloudflare Pages config had never actually been built despite §15.4 referring to it. Not deployed, not connected |
| T0.2 Claude Code tooling | `code-reviewer`   | ✅ Done — 9 subagents, the PostToolUse hook, 4 custom ESLint rules. Every AC check demonstrated live: `trioCount` blocked by both the rule and the hook; a `core/`→`formats/` import caught by both the rule and a live `module-boundary-checker` run; an assertion-free test caught by a live `test-auditor` run. Caught and fixed a real word-boundary bug in `no-trio-vocabulary` during verification                                                                                                                                                                                                                       |
| T0.3 Supabase local + CI | `schema-guardian` | ✅ Done — local stack verified working (migrations apply from empty, pgTAP suite runs), CI confirmed green on real GitHub Actions runs (not just locally), `dev`/`main` with `main` protected — verified genuinely: a direct push to `main` was rejected (`GH006`) after fixing an `enforce_admins` gap that had let the first proof attempt silently bypass the rule. Required making the repo public (branch protection needs GitHub Pro for private repos on the free plan)                                                                                                                                                 |
| T0.4 Doc seed            | `code-reviewer`   | ✅ Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## Phase 1 — Schema and security

Per handoff §14.

| Task                   | Verifier            | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1.1 Core tables       | `schema-guardian`   | ✅ Done — `orgs`, `org_members`, `people`, `person_merges`, `events`, `event_entries`. Applies cleanly from empty, rollback verified live. Both named negative cases proven: duplicate phone within one org rejected (allowed across orgs); a merge (unlink losing entry → ledger row → delete merged person) succeeds, both entries survive. Review found the handoff's own §5.1 comment stated an incorrect technical rationale for the partial index (a table-level UNIQUE would _not_ actually have broken the merge case — proven empirically); corrected in the migration, the test, and — with the user's go-ahead — the handoff document itself |
| T1.2 Cup Taster tables | `schema-guardian`   | ✅ Done — `ct_stages`, `ct_sets`, `ct_stage_entries`, `ct_heats`, `ct_heat_entries`, `ct_results`, plus `ct_standings`. Applies cleanly, rollback verified. `correct` proven nowhere a stored tally column; negative `elapsed_secs` proven rejected. Review caught two real bugs before either shipped: `ct_standings` silently blending tiebreak-heat results into the primary tally (fixed with a `kind = 'normal'` filter + regression test), and the view missing `security_invoker` (a PG15+/17 RLS-bypass-via-view bug, fixed and confirmed via `pg_class.reloptions`)                                                                            |
| T1.3 RLS               | `security-reviewer` | ✅ Done — policies on all 13 tables, `live_sessions` open-read/org-write. Non-member proven to read zero rows from all 12 org-scoped tables; anon proven to read `live_sessions` but not write it. A missing-GRANTs gap found during my own testing (RLS alone insufficient without table privileges) fixed before review. Review (2 passes) caught a live-exploitable cross-org bug in `live_sessions` (org_id/event_id had no enforced relationship — fixed with a trigger + regression test) and flagged that every write policy being `FOR ALL` means `pg_policies.cmd = 'ALL'`, never `'INSERT'`/`'UPDATE'` — directly informed T1.4's gate query  |
| T1.4 `WITH CHECK` gate | `security-reviewer` | ✅ Done — `supabase/tests/000_with_check_gate.sql`, replacing the Phase 0 `000_sanity.sql` placeholder. AC proven directly: removed one `WITH CHECK` from the live schema, confirmed the gate fails (suite exit 1), restored via `supabase db reset`, confirmed green again                                                                                                                                                                                                                                                                                                                                                                             |

**28 pgTAP assertions total** across the Phase 1 suite (`000`–`003`), all passing.

---

## Phase 2 — Core libraries

Per handoff §14. No UI, no I/O — pure logic in `src/core/`.

| Task                | Verifier                           | Status                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T2.1 `partition`    | `scoring-auditor` + `test-auditor` | ✅ Done — exact `N=2..12` table (11 individual cases), invariants across `N=2..64`, `n < min` throws. Fuzzed 2,796 combinations beyond the AC, zero failures                                                                                                                                                             |
| T2.2 `ranking`      | `scoring-auditor` + `test-auditor` | ✅ Done — three-way tie and a non-first tie both tested separately (the AC's own guard against a tie-at-position-1-only test passing with the classic off-by-one present); non-mutation proven by value and reference                                                                                                    |
| T2.3 `advancement`  | `scoring-auditor` + `test-auditor` | ✅ Done — exact-cutoff, tie-wholly-above (no tiebreak), tie-straddling (tiebreak, exact membership), and the "not the whole tie group when it starts above the line" case all proven separately. Fuzzed 20,000 combinations against four invariants; unbreakable                                                         |
| T2.4 `countdown`    | `scoring-auditor` + `test-auditor` | ✅ Done — engine-purity proven by reading the module's own source (hit and fixed the same self-referential-comment trap as Phase 0's `no-trio-vocabulary` rule); clamp-at-zero, background-gap resume, cross-reader agreement all proven with a fake clock. One misleading test title/assertion mismatch found and fixed |
| T2.5 `timeclamp`    | `scoring-auditor`                  | ✅ Done — exact `maxed`/`raw` boundary proven. AC's second clause (prove `no-raw-elapsed-write` fires) had only been a one-off manual check — caught independently by both reviewers, closed with a permanent `Linter`-based test                                                                                        |
| T2.6 `entitlements` | `module-boundary-checker`          | ✅ Done — all five D14 keys present with `minTier: null` and an intent comment; zero `canAccess()` call sites outside its own file/test, confirmed live                                                                                                                                                                  |

**116 tests total** across the whole suite, all passing.

---

## Phase 3 — Registry and offline

Per handoff §14. Verifier: `offline-sync-auditor` throughout.

| Task                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T3.1 `registry`                | ✅ Done — `findPersonByPhone/Email`, `createPerson`, `registerPerson` (phone-then-email dedup), `createEntry` (snapshotting), `mergePeople` (atomic RPC). `security-reviewer` found and closed a **live-exploited cross-org bug**: `merge_people` didn't validate `p_kept_id`'s org, exploitable both via the RPC (when the merged-away person had zero event entries) and via a direct `insert into person_merges` bypassing the RPC entirely. Both closed, re-verified by re-attempting the live exploit. `offline-sync-auditor` independently caught a real contradiction between `registerPerson`'s dedup comment and the frozen schema's own email-uniqueness index, plus an unescaped `ilike` wildcard risk — both fixed |
| T3.2 IndexedDB mirror + outbox | ✅ Done — `db.js`/`outbox.js` (generic FIFO queue engine, injectable handlers — deliberately not hard-coded, since a Cup-Taster-specific handler in `src/core/` would fail §6's boundary test), `confirm_heat` RPC (one atomic transaction, `processed_operations` idempotency ledger, `P0002` conflict exception carrying both versions). All 3 AC clauses proven directly against the real database (53 pgTAP assertions). `security-reviewer` (2 rounds) found and closed a missing `GRANT` that would have broken every real call in production, a `ct_results.set_id`/stage gap matching two earlier precedents, and a test-methodology gap (superuser bypass) that had let both slip past the first review pass          |
| T3.3 Sync state panel          | ✅ Done — `computeSyncState()`, the pure off/live/not-synced derivation (no UI exists yet to render it into — that's Phase 4/5). `stuckOperation` closes T3.2's deferred "poison operation surfaces to a human" gap. `offline-sync-auditor` (2 rounds) found `enabled` was checked before real outbox state — a fail-open violation letting "off" mask genuinely pending/failed work — plus a **real bug in already-merged T3.2 code**: a missing outbox handler bypassed attempts/lastError persistence entirely, fixed in `outbox.js` alongside this task                                                                                                                                                                    |

---

## Phase 4 — Cup Taster

Per handoff §14. Verifiers: `scoring-auditor` + `ui-accessibility-reviewer` on every
task (T4.1 had no UI, so only `scoring-auditor` applied that task), plus
`module-boundary-checker`/`test-auditor`/`code-reviewer` per `CLAUDE.md`'s delegation
strategy.

| Task                                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T4.1 Setup: stage plan, sets, roster                        | ✅ Done — `core/events.createEvent` (format-agnostic), `core/registry.registerEntry` (composes existing registerPerson+createEntry), `formats/cup-taster/setup.js` (`validateStagePlan`, idempotent `createStage`/`ensureSetsForStage`/`createStagePlan`). Deliberately no UI this task (decided with the user — a real screen lands once more of Phase 4 exists to build one against). Not a clean pass across three review rounds: a blocking config-drift bug in `createStage` (a legitimate cutoff correction would be silently discarded as if it were a retry), missing cutoff-monotonicity and canonical-stage-order validation, a concurrent-caller race surfacing raw Postgres errors, six test-quality gaps, and — found in re-verification of the race fix — a bounded-retry loop that itself had an asymmetry (didn't recognize a race resolved in its favor on the final attempt). All closed; see CHANGELOG.md for the full account. **2026-08-27 follow-up (closing the "no UI" gap below):** `validateStagePlan` generalized from the fixed two-sequence allowlist to a rank-based kind-ordering check (an arbitrary chain — repeats, skips, a single stage — is now real), and `setupScreen.js`/`.css` (new) shipped the screen itself, with `saveStagePlan` reconciling add/remove/reorder/edit against whatever's persisted, refusing the whole save if it would touch a stage that already has heats. One review round (all four reviewers found something real, including a CSS-comment corruption bug that silently dropped `.stage-rows`'s layout and a data-corruption bug in unvalidated duplicate stage ids) — see CHANGELOG.md's own dated entry for the full account. **2026-08-27, a second same-day follow-up (closing the roster half of the "no UI" gap):** `rosterScreen.js`/`.css` (new) — register a cupper, list the roster, withdraw/reinstate an entry. `registry.js`'s `registerEntry` is now idempotent AND race-recovering (adopts the winner on a genuinely concurrent duplicate registration, closing a real gap `code-reviewer` found — the sequential-retry case was covered, a truly concurrent one wasn't); `UNIQUE_VIOLATION` hoisted from `setup.js` into `core/errors.js` so `core/registry.js` could reuse the same race-recovery shape without violating the core/formats boundary. `core/dom.js` gained a shared `labeledField()`, extracted from `setupScreen.js`'s own local helper on its 2nd verbatim use. One review round (all four reviewers found something real, most notably an opacity-based withdrawn-row style that dropped two text colors below the AA contrast floor, and a successful registration's confirmation living only in a live region with no focus-move to guarantee it's announced) — see CHANGELOG.md's own dated entry for the full account. **Both of T4.1's original "no UI" gaps are now closed.** |
| T4.2 Heat generation: seeding, random \| manual             | ✅ Done — `formats/cup-taster/heats.js` (stage-entry seeding, random + manual heat/station generation, reusing T4.1's idempotent-write patterns) and `heatsScreen.js`/`.css` — the first real UI screen in the project, live-verified at 375px via a demo harness (`heatsScreen.preview.html`). Not a clean pass across three review rounds: the most significant finding was a genuine partial-generation-failure risk (an incomplete result could be silently shown as "done," and — closed in the third round — a same-session retry after a failure could double-place a cupper across two heats before the UI caught up). Also fixed: raw DB errors leaking into user-facing feedback, `is_test` not rendered anywhere (fixed now rather than deferred to T5.3/T5.4, per D9 and `DESIGN.md`'s "every surface"), no scroll/focus on error feedback, and several test-quality gaps including two closed only after mutation testing proved the original fixes insufficient. See CHANGELOG.md for the full three-round account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| T4.3 Timing surface, app mode                               | ✅ Done — `formats/cup-taster/timing.js` (full lifecycle: start → tap → auto-max at expiry → advance to scoring, direct writes rather than the outbox — a deliberate, documented gap) and `timingScreen.js`/`.css` — the first live, ticking screen in the project, live-verified via a demo harness (`timingScreen.preview.html`, 20s duration). Two review rounds, both with real findings: round 1's most significant was `scoring-auditor`'s catch that a pre-clamp in `timing.js` was floating negative elapsed values to 0 before `clampElapsed()` ever saw them, splitting the sole-writer authority the function exists to hold and losing the true skew value the audit trail promises to keep — fixed by moving both bounds (negative floor + duration ceiling) into `clampElapsed()` itself, plus a new `MAX_NEGATIVE_SKEW_SECS` rejection threshold. Round 1 also closed a blocking D9 gap (`is_test` banner entirely missing), incomplete rebuild-then-refocus/live-announcement coverage, a conflated heading structure, and duplicated container CSS. Round 2 closed a 360px overflow risk, an unmanaged-focus edge case in the auto-max retry path, and a real latent bug `code-reviewer` found in the new `unmount()`/render-generation-counter pair (`unmount()` didn't abandon a render already in flight — verified via a deliberate revert-and-rerun showing the regression test fails against the unfixed code). See CHANGELOG.md for the full two-round account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T4.4 Timing surface, manual mode                            | ✅ Done — `formats/cup-taster/timingManual.js` (`recordManualTime`: a manual-mode heat skips `timing` entirely and advances straight from `pending` to `scoring`; corrections allowed by re-saving, unlike a real tap, given the project's single-writer assumption) and `timingManualScreen.js`/`.css` — every row editable the whole time the heat is `pending`, live-verified via a demo harness (`timingManualScreen.preview.html`). `timing.js` gained three newly-exported helpers (`buildClampedUpdate`, `findHeatEntry`, `tryAdvanceToScoring`) reused here rather than duplicated, and its `maybeAdvanceToScoring` status filter generalized to cover both modes' source states. `formatCountdown` extracted to `src/core/duration.js` as `formatDuration` on its 2nd verbatim use. One review round (four of five reviewers found something; `module-boundary-checker` clean), with one finding needing two attempts to actually close: a 360px overflow bug (the same class T4.3 hit) where the first fix attempt — removing a conflicting `align-items` override — only fell back to the base class's own equally-broken value; the real fix explicitly sets `align-items: stretch`, independently re-verified with computed layout at both 360px and 320px. Also closed: ambiguous Save/Update button accessible names (a regression against T4.3's own established per-cupper `aria-label` pattern), a missing heat-completion announcement (added, then strengthened after `test-auditor` found the first version's test didn't prove the announcement stayed silent on a non-completing save), dead code, a stale comment, an inaccurate module comment, and an untested `parseElapsedInput` boundary (confirmed via real mutation testing). See CHANGELOG.md for the full account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T4.5 Scoring surface: toggle, confirm, mark-wrong           | ✅ Done — `formats/cup-taster/scoring.js` (three-state toggle logic, IndexedDB-backed draft, `buildConfirmEntries`/`submitConfirmHeat` routing the whole heat through the existing `confirm_heat` RPC as ONE outbox operation — a deliberate, user-chosen local-accumulate write model, unlike T4.3/T4.4's direct writes) and `scoringScreen.js`/`.css`, live-verified via a demo harness (`scoringScreen.preview.html`, the first screen needing a fake `.rpc()`). `core/outbox.js` gained a generic `.permanent` error-flag contract on `runFlush` (format-agnostic; `scoring.js` is the one caller that tags a P0002 conflict this way). Three review rounds: round 1 found a real lost-update race (closed by moving draft mutation to synchronous closure-level state), dead-code strict-confirm validation (an explicit `null` tripped a raw constraint before the RPC's own check could fire), and two outbox/confirm-flow bugs (a permanent failure blocking the whole queue forever; no double-click guard on Confirm). Round 2 found narrower gaps in those fixes (a `permanentFailure` consistency gap in `runFlush`'s return shape, an ambiguous message on a re-fetch failure, unlocked buttons during an in-flight confirm, and a confirmed-view contrast regression from inheriting a project-wide `.btn:disabled` opacity rule). Round 3 (scoped to round 2's fixes only) came back clean on correctness, with two small closed items (a dead conditional guard, a test-coverage gap). See CHANGELOG.md for the full three-round account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| T4.6 Standings and advancement, including the tiebreak flow | ✅ Done — `formats/cup-taster/standings.js` (ranking via `core/ranking`, advancement via `core/advancement` unmodified, tiebreak heat creation/outcome reading, and a `commitStageResolution` write with `advanced`/`tiebreak_won`/`coin_toss` provenance) and `standingsScreen.js`/`.css` (a 7-state resolution machine ending in one atomic commit), live-verified via a demo harness (`standingsScreen.preview.html`) walking the full tie → tiebreak-heat → coin-toss → commit path. `heats.js` generalized `kind` through its heat-creation primitives rather than a parallel implementation. Two review rounds: round 1's most significant finding was a real data-correctness bug (a cupper ranked distinctly below a coin-toss subgroup was left with no `final_position` forever, since `core/advancement`'s break-without-visiting loop never forms a group for them — fixed by deriving eliminations from the tiebreak heat's full ranking minus advancers, not ad-hoc loser lists), plus a leftover `isTerminal` inconsistency in the coin-toss card, missing tap-target/token styling on the coin-toss note field, focus jumping to the heading instead of the error region on any failed action, and four test-quality gaps. Round 2 (scoped to round 1's fixes) came back fully clean across all three re-invoked reviewers. See CHANGELOG.md for the full account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T4.7 Report and analytics                                   | ✅ Done — `formats/cup-taster/analytics.js` (`isEventComplete` gates the whole screen on the terminal stage being resolved — user-scoped decision, no partial-data report; `computeSetDifficulty`, `computeScoreDistribution`, `computeStageReport`, composing `standings.js`'s `fetchStandingsForStage` unmodified) and `reportScreen.js`/`.css` (two states only, no actions, renders once; reuses `standingsScreen.css`'s `.standings-table` for all three of its tables rather than a third copy of that pattern). Live-verified via a demo harness (`reportScreen.preview.html`) with hand-checked arithmetic. One review round: `scoring-auditor` and `module-boundary-checker` came back clean; `ui-accessibility-reviewer` + `code-reviewer` independently converged on a real error-handling gap (only `loadState()` was wrapped in try/catch, leaving render-path failures uncaught and the error branch missing a heading/focus move — fixed by wrapping the whole render body); also fixed a `data-label` collision between two tables' differently-scaled "Correct" columns, ambiguous duplicate headings across stages in a screen reader's flat list, a dead pass-through field wired into the outcome text, and two test-quality gaps (an exclusion claim that was never actually proven at the data level, and a terminal-stage check indistinguishable from a "last array element" bug in every existing fixture). Fixes verified directly (tests + live browser) rather than a second review round, given their mechanical nature. See CHANGELOG.md for the full account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T4.8 Export — Phase 4's last task                           | ✅ Done — `core/export.js` (new, genuinely core: `buildCsv`/`buildCsvForTables`/`downloadCsv`, zero Cup-Taster vocabulary, PDF is the browser's own Print → Save as PDF rather than a generated file — the one non-Supabase dependency this would have required, deliberately not added) and `reportScreen.js`/`.css` extended with `buildReportTables`/two export buttons/a `@media print` block. One review round: `module-boundary-checker` came back clean (a future format can call the same core functions unedited). `ui-accessibility-reviewer` found the most significant issue — the exported CSV carried no `is_test` marker at all (D9), fixed with a filename prefix and a CSV-body first line — plus a bare, un-tokenized `.btn` on both new buttons, fixed by porting the design system's own documented `.btn-outline` variant into real use for the first time. `code-reviewer` found the two export actions had no failure-reporting path, unlike every other action in this project — fixed with a local feedback region. `test-auditor` found four real test-quality gaps (a Blob-content/link-state check that only verified mocks were called, loose content assertions that couldn't catch a dropped table, an escaping path never proven end-to-end through the real pipeline, and a sanitization claim never proven wired into the live download call) — all closed. Fixes verified directly (tests + live browser). See CHANGELOG.md for the full account. **Phase 4 is done.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## Phase 5 — Live surfaces

Per handoff §14. Sequential-with-one-flexible-swap: T5.1 (data write path) must land
before T5.2/T5.3/T5.4 read from it; T5.2 (`viewer-shell`) is shared infrastructure both
T5.3 (projector) and T5.4 (phone) build on; T5.3/T5.4 themselves are order-independent —
two consumers of the same shell/data. Verifiers per task, `code-reviewer` always.

| Task                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T5.1 `publish` + `live_sessions` write path | ✅ Done — `publish_session` RPC (new migration `20260827200000_publish_session_rpc.sql`) atomically activates a session for an event, deactivating any other active session for the org first — the `live_sessions_one_active_per_org` partial-unique-index invariant a client-side check-then-write can't guarantee, closed the same way `confirm_heat`/`merge_people` already close the equivalent problem elsewhere. `core/publish.js` (new): `publishSession()`, the format-agnostic JS write path, enqueuing + flushing through `core/outbox.js` as ONE operation exactly like `scoring.js`'s `submitConfirmHeat`. Deliberately logic-module-only (scoped with the user in advance, matching T4.1's own `setup.js` precedent) — nothing calls it from any existing screen yet; the payload shape and call cadence (D7's "split publish cadence": timing live, results publish-gated) are format-specific decisions deferred until T5.2's `viewer-shell` exists to build real wiring against. Five reviewers in parallel (`schema-guardian`, `security-reviewer`, `module-boundary-checker`, `test-auditor`, `code-reviewer` — no UI this task); `module-boundary-checker` clean, the other four found real issues — most notably a NULL-unsafe ownership check that silently let a fabricated event id fall through to a raw foreign-key error (two fix attempts: the first introduced a NEW bug, an RLS-filtered pre-check that masked the real check for legitimate wrong-org callers too, caught by re-running the full pgTAP suite; the real fix is a single NULL-safe `is distinct from` comparison), and a missing negative test proving the RLS backstop itself (not just the RPC's own application-level guard) actually rejects a non-member. See CHANGELOG.md for the full account.                                                                                                                                                                                                                                                                                                                                               |
| T5.2 `viewer-shell` + holding states        | ✅ Done — `src/core/viewer-shell.js`/`.css` (new; the first CSS file placed inside `src/core/` rather than a format directory, since no format "owns" this module) — `mountViewerShell()` watches `live_sessions` for an org via Supabase Realtime (the first table this project streams; new migration `20260828120000_live_sessions_realtime.sql` enables it, no RLS change needed), renders every holding state itself, and mounts a caller-supplied `renderBody` only once real content exists (same inversion-of-control shape as `core/outbox.js`'s handler map). Scoped with the user in advance on two real decisions: Realtime over polling, and matching the legacy app's identity-band split (phone shows chrome, projector doesn't) via a `showChrome` option. Six reviewers in parallel, two rounds — round 1: `module-boundary-checker`/`security-reviewer` clean (the latter live-tested the realtime enablement itself, including a negative control), the other four found real issues — most notably a full `innerHTML` rebuild on every render defeating `aria-live` change detection (fixed with a genuine persistent-node restructure) and the realtime subscription being registered AFTER the initial read rather than before (a real race, fixed by reordering). Round 2 (scoped to the round-1 fixes, given their size) verified all seven held up, but caught one new bug the fix pass itself introduced — `connectionLost` could get stuck forever if entered via a query error/timeout rather than a channel drop, since only the channel's own reconnect handler cleared it — plus a WCAG contrast failure in a brand-new badge state and a minor over-announcement gap, all closed. See CHANGELOG.md for the full two-round account. Deliberately shell-only — the preview harness's `renderBody` is an explicit stub; T5.3/T5.4 build the real Cup Taster content against this shell unedited.                                                                                                                                                                                                                    |
| T5.3 Projector surface                      | ✅ Done — `src/formats/cup-taster/projectorSurface.js`/`.css` (new) — the thin projector-specific composition of `viewer-shell` + `viewerBody`, `showChrome: false`, `data-surface="stage"`; `viewerBody.js` reused completely unedited, per the handoff's own module table. Also extended `viewerBody.js`/`.css` with a live countdown for an active app-mode heat (`core/countdown.js` + `core/duration.js`, mirroring `timingScreen.js`'s own tick pattern) — the concrete answer to the handoff's cross-surface "organiser/projector/phone all agree on remaining time" AC, scoped into the SHARED module so T5.4's already-shipped phone surface gets it too from one change. Required extending `core/viewer-shell.js` (already-shipped T5.2 code) with a `renderBody` cleanup-lifecycle contract so a ticking interval never outlives its DOM node. Found and fixed live, before any review ran: `.viewer-shell-body` was flex-row by default, completely untested since a holding card was always its only child — real multi-section content laid out side-by-side instead of stacked until fixed. Four reviewers in parallel (no migration/RLS/scoring-module change, so `schema-guardian`/`security-reviewer`/`scoring-auditor` didn't apply); `module-boundary-checker` clean. The other three found real issues, most notably a countdown accessibility gap (the ticking digits are correctly `aria-live="off"`, but nothing announced crossing into the urgent window or the heat expiring — fixed with a separate one-shot `aria-live="polite"` node), an `is_test` banner that didn't scale for `data-surface="stage"` (the smallest text on an otherwise room-legible screen), a `NaN:NaN` display bug when `durationSecs` is missing, and two test-quality gaps where the tests proved a call happened but not that it happened in the right order/for the right reason (both re-verified via temporary mutation testing). See CHANGELOG.md for the full account. This task built the shared display logic the handoff's cross-surface Playwright AC needs; the AC's own e2e proof is a separate row below, closed 2026-08-28. |
| T5.4 Phone summary surface                  | ✅ Done — `src/formats/cup-taster/viewerBody.js`/`.css` (new; the `renderBody` callback T5.2's shell plugs in — standings table, active-heat panel with per-cupper status chips, recent-results list; content shape ported from the legacy v4.x app's own never-shipped-standalone audience view) and `phoneSummary.js` (new; the thin phone-specific composition, `showChrome: true`). Deliberately Cup-Taster-specific, meant to be shared unedited by T5.3's projector. Scoped logic/renderer-only like T5.1/T5.2 — no screen calls `publishSession()` yet. Four reviewers in parallel (no migration/RLS/scoring change, so `schema-guardian`/`security-reviewer`/`scoring-auditor` didn't apply); `module-boundary-checker` clean. The other three found real issues, all fixed — most notably (both directly against this task's own AC) a no-clock heat's heading reading "Timing…" directly above its own "not yet started" message, and the "running" cupper status having no non-color signal at all unlike its two sibling states. Also fixed: two stage-mode CSS gaps (missed selectors, a thin-margin contrast repeat of a pairing this project already rejected once), an undocumented `payload.stage`-optional gap that could've rendered a blank body under live standings, a hand-rolled sort where `core/ranking.js`'s `chainComparators` should have been reused, and two test proof gaps. See CHANGELOG.md for the full account.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cross-surface Playwright AC                 | ✅ Done — `tests/e2e/cross-surface-countdown.spec.js` (new): three separate Playwright browser contexts driving the existing demo harnesses directly (organiser's `timingScreen.preview.html`, `projectorSurface.preview.html`, `phoneSummary.preview.html`), starting a real heat, reading back its REAL `started_at`/`duration_secs`, publishing those exact values to the other two contexts, and proving agreement (±2s) at mid-heat, the urgent window, and past expiry — including numerically tying the organiser's own auto-max-at-expiry state back to `core/countdown.js`'s own `isExpired()`. `playwright.config.js` gained a second project targeting the dev server (`vite build` doesn't output the format demo harnesses at all — confirmed directly). Three reviewers in parallel (no UI/migration/RLS/scoring change); `module-boundary-checker` clean. The other two found real issues: a browser-context leak risk on partial creation failure (context creation was outside try/finally), `buildActiveHeatPayload` duplicated verbatim across two harness files (extracted to `demoActiveHeatPayload.js`), and — the most significant — the past-expiry checkpoint proving two disconnected facts ("organiser shows 'Timing complete'" and "viewers freeze at 0:00") rather than tying them to the same zero-crossing event. Also closed a pre-existing gap this task's own DoD depends on: `.github/workflows/ci.yml` never ran Playwright tests at all — added a dedicated CI job. See CHANGELOG.md for the full account. **This was the last open item on Phase 5's own Definition of Done.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## Known open items carried into Phase 4

- **T4.3/T4.4's direct-write gap is closed (2026-08-29 follow-up)** — `timing.js`/
  `timingManual.js` now route every write (start a heat, a real tap, a manual entry/
  correction, an auto-max sweep) through the outbox, via three new RPCs
  (`start_heat`/`record_heat_time`/`auto_max_heat`, migration
  20260828150000_timing_outbox_rpcs.sql) mirroring `confirm_heat`'s idempotent,
  org-scoped shape. A real concurrency bug (two concurrent taps for a heat's last two
  entries could both miss flipping the heat to `scoring`; a fix's own first attempt then
  left a narrower but real stale-read gap under lock contention) was found and closed
  during review, verified with real concurrent `psql` sessions, not just pgTAP — see
  CHANGELOG.md's dated entry for the full account. **The related handler-map composition
  gap this review surfaced is now closed too (2026-08-29, separate follow-up)** —
  `core/outbox.js` gained an exported `buildRpcHandler(client, type)` (deduping three
  near-identical RPC-wrapping blocks that used to live independently in `timing.js`,
  `scoring.js`, and `publish.js`); each of those three now exports a named handler-builder
  (`timingHandlers`, new `confirmHandlers`, new `publishHandlers`); a new
  `formats/cup-taster/outboxHandlers.js` composes all three into
  `cupTasterOutboxHandlers(client)`, which every real screen call site (`timingScreen.js`,
  `timingManualScreen.js`, `scoringScreen.js`) now passes into its write function via a
  new optional `handlers` override — so a flush triggered from any of these screens can
  process ANY queued Cup Taster operation type, not just its own, closing the primary
  offline workflow's stall risk. `offline-sync-auditor` found one residual, currently
  latent gap in review: `flushOutbox`'s reentrancy guard discards a losing concurrent
  caller's `handlers` argument entirely — harmless today since every real call site passes
  the same composed map, but documented with a comment on `core/outbox.js`'s own
  `inFlightFlush` so a future narrower-map call site doesn't silently reintroduce this
  exact stall. `test-auditor` found three test-quality gaps (a composition test that
  proved key presence but not that the values were real handlers; only 2 of 5 composed
  operation types actually exercised through a real flush; a fragile double-invocation
  assertion) — all closed. See CHANGELOG.md's dated entry for the full account.
- **T4.3's app-mode timing screen's mid-heat device-failure manual-entry fallback is
  CLOSED (2026-09-04).** The spec (§7.1) describes a heat that "may mix tapped and
  hand-entered times if a stopwatch fails mid-heat" — read literally, this only makes
  sense as a recovery path inside an app-mode heat still in `timing` status (a
  manual-mode heat, by construction, never has any tapped entries to mix with). Each
  unstopped row in `timingScreen.js` now offers an opt-in "Enter time manually" toggle
  next to Stop — a purely local DOM show/hide (no `render()`, so it never interrupts the
  live countdown or triggers a network reload), revealing the same minutes/seconds
  input pair `timingManualScreen.js` already used, reusing `recordManualTime` and the
  exact same `pendingEntryCheck` ground-truth-vs-flush machinery `recordTap`'s own
  Stop path already established — success/conflict messaging behaves identically
  regardless of which path recorded the time. A heat can now genuinely mix
  `time_source: 'tapped'` and `time_source: 'manual'` entries, exactly as the spec
  describes, verified live in the browser (one cupper tapped, another hand-entered, in
  the same still-running heat) and in a dedicated integration test. `parseElapsedInput`/
  `secsToParts` moved from `timingManualScreen.js` into `timingManual.js` (the shared
  pure logic module) so both screens can import them without either screen importing
  from the other — `timingManualScreen.js` already imported `renderTimingRows`/
  `buildScoringLink` from `timingScreen.js`, so the reverse direction would have created
  a cycle. A new shared `renderManualTimeFields()` (in `timingScreen.js`, alongside
  `buildScoringLink`, for the same "no DOM in timing.js/timingManual.js" reasoning)
  replaces the input-pair-building code that used to be duplicated once this became the
  2nd use. Live-verifying at 360px (this project's own "verify at 360px first" convention) caught
  a real regression before ship: the row's own `justify-content: space-between`
  squeezed a long cupper name down to 2-3 characters once the wider two-button actions
  area was added — fixed by letting `.timing-row` wrap, dropping the whole actions block
  to its own line rather than fighting the name for space.

  **A five-reviewer round (scoring-auditor, module-boundary-checker, code-reviewer,
  test-auditor, ui-accessibility-reviewer) found a real, HIGH-severity data-corruption
  bug plus several genuine UX/accessibility gaps, all closed before ship:**
  `scoring-auditor` found that reusing `record_heat_time`'s existing `'overwrite'`
  conflict policy (originally safe only because `timingManualScreen.js` was its one
  caller, on manual-only heats nothing else could ever write) broke once this fallback
  made it reachable from an app-mode heat too — a real tap and a manual guess for the
  SAME cupper can both queue offline and flush tap-then-manual, silently clobbering the
  accurate tapped time with a hand-typed guess, no conflict raised, false success
  reported. Closed with a new migration
  (`20260904120000_record_heat_time_overwrite_scoped_to_manual.sql`) scoping
  `'overwrite'` to only succeed when the entry is unset or already `time_source:
'manual'` — `schema-guardian` and `security-reviewer` both signed off clean.
  `ui-accessibility-reviewer` found the toggle dropped focus to nowhere on open/Cancel
  and gave a screen reader zero signal new content appeared (no `aria-expanded`, no
  announcement) — fixed with explicit focus moves and `aria-expanded`.
  `code-reviewer` found a validation error was routed through a full `render()`,
  silently closing the toggle and discarding whatever the organiser had already typed
  in the OTHER, valid field — fixed by validating locally (a new `.manual-time-fields`
  onSave wrapper) so a bad typo never triggers `render()` at all, only a real write
  does. `test-auditor` found `toContain('2:00')`-style assertions couldn't actually
  distinguish a real time from a mislabeled "Max time" one (confirmed via mutation
  testing) — strengthened across every affected test. See CHANGELOG.md's dated entry
  for the full seven-reviewer account.

- **T4.1's stage-plan UI gap is closed (2026-08-27 follow-up)** — `setupScreen.js`/`.css`
  now let an organiser build the stage plan itself (add/remove/reorder, generalized
  validation), see CHANGELOG.md's dated entry.
- **T4.1's roster-registration UI gap is also closed (2026-08-27, same day, separate
  follow-up)** — `rosterScreen.js`/`.css` (new) let an organiser register cuppers
  (name + phone required, email/cafe/bib optional) and withdraw/reinstate an entry;
  `core/registry.js` gained `findEntryForPerson`/`setEntryWithdrawn` and `registerEntry`
  is now idempotent AND race-recovering (adopts the winner on a genuinely concurrent
  duplicate registration, same shape as `setup.js`'s `createStage`). See CHANGELOG.md's
  dated entry for the full review account. Both of T4.1's original "no UI" gaps are now
  closed.
- **Two screens shared an unaddressed gap, found while reviewing the roster screen above:
  no timeout/failure state for a hung initial load — closed (2026-08-29 follow-up).**
  `setupScreen.js` and `rosterScreen.js` both render a literal "Loading…" state correctly
  (no spinner-as-resting-state), but `loadPersisted()` had no timeout in either — on this
  project's own "unreliable venue wifi" design target, a request that neither resolves
  nor rejects left the organiser stuck indefinitely, with no retry affordance. New
  `core/timeout.js` (`raceTimeout`/`DEFAULT_LOAD_TIMEOUT_MS`) is the shared primitive this
  note originally called for — extracted from `core/viewer-shell.js`'s own private
  identical implementation on its 2nd verbatim use, not written fresh. Both screens gained
  an `attemptLoad()` racing `loadPersisted()` against a 10s timeout, and their
  `renderLoadError()` gained a real Retry button. Four parallel reviews
  (`module-boundary-checker`, `ui-accessibility-reviewer`, `test-auditor`, `code-reviewer`)
  found real issues: `ui-accessibility-reviewer` caught a successful Retry silently
  dropping focus to `<body>` (fixed — matches the existing `focusAfterRender` pattern
  every other action on these screens already uses) plus two minor consistency gaps
  (Retry missing `type="button"`, the loading state itself not taking focus during a
  retry-triggered wait); `test-auditor` caught the "Retry re-attempts" tests not actually
  proving a reload happened (a no-op retry handler would have passed both) and the
  timeout tests not pinning the shared constant specifically — both closed. Live-verified
  in a real browser, including a genuine unmocked 10-second timeout actually firing. See
  CHANGELOG.md's dated entry for the full account.
- **No resumability for a partial heat-generation failure — closed (2026-08-29
  follow-up).** T4.2's screen correctly detects and honestly reports an incomplete
  generation (see CHANGELOG.md), but used to offer no repair path — `generateHeatsRandom`
  reshuffles the whole roster fresh on every call and isn't safe to retry once some heats
  exist, so a stuck stage meant manual intervention outside the app (Studio). The fix
  turned out to need zero changes to `heats.js` itself: `generateHeatsManual`/
  `buildHeatPlansFromAssignments` were already idempotent and conflict-checked, and the
  manual-assignment form was already safe to use on a partial stage — it was just never
  _shown_ there. `renderManualAssignmentForm` (`heatsScreen.js`) gained an optional
  `existingAssignments` map: an already-placed cupper renders as fixed text ("Heat N ·
  Station X (already placed)"), not an editable input, so the organiser only fills in
  what's actually missing, and a new `buildManualForm` closure re-attaches each
  already-placed cupper's real assignment before calling `generateHeatsManual`,
  satisfying its "every stage entry assigned exactly once" check without asking anyone
  to re-type what's already correct. The unsafe "Generate heats (random)" button stays
  absent from the incomplete state, unchanged. Four parallel reviews
  (`module-boundary-checker`, `ui-accessibility-reviewer` at 360px, `test-auditor`,
  `code-reviewer`); `module-boundary-checker` came back clean (confirmed `heats.js` is
  genuinely untouched). The other three found real issues, all closed: a formatting gap
  (`code-reviewer`), the "finish assigning" heading structurally disconnected from the
  card explaining why fewer inputs are needed than the roster count (`ui-accessibility-reviewer`
  — fixed by repeating the remaining count directly in the heading), and two real
  test-quality gaps (`test-auditor` — the "doesn't disturb the already-placed cupper"
  test didn't actually check the already-placed cupper's final assignment, and no test
  covered a missing cupper's station colliding with an already-placed one — both closed,
  the latter with a new test proving `buildHeatPlansFromAssignments`'s existing
  station-uniqueness check fails safely through this new UI path). Live-verified in a
  real browser against a realistic fake Supabase client: a stuck stage (1 of 4 cuppers
  placed) resumed cleanly, the already-placed cupper was undisturbed, and the final state
  matched the normal "generation complete" view exactly. See CHANGELOG.md's dated entry
  for the full account.
- **No DB-level `unique(heat_id, station)` constraint — closed (2026-08-29 follow-up).**
  Migration `20260829100000_ct_heat_entries_station_unique.sql` adds
  `ct_heat_entries_heat_station_unique unique (heat_id, station)` plus `alter column
station set not null`, named explicitly so `ensureHeatEntries` (`heats.js`) can tell
  it apart from the pre-existing `unique(heat_id, entry_id)` constraint's own violation —
  the two need different handling: an `entry_id` collision is a safe-to-retry race (the
  next attempt's `diffAgainst` sees the row and moves on), but a `station` collision
  means two different cuppers are racing for the same station and retrying the identical
  insert would just fail identically every time, so a new `isStationConflict()` helper
  fails fast with a clear message instead of quietly burning through the bounded-retry
  budget. Verified empirically against the real local Postgres instance (`docker exec` +
  concurrent `psql`) that a genuine violation's error DETAIL and constraint name both
  contain the word "station", confirming the string-match discriminator is reliable.
  **`schema-guardian` caught a real gap in review**: a plain `unique` constraint alone
  gives zero protection when `station IS NULL` (Postgres treats every NULL as distinct),
  so the `NOT NULL` addition is what actually closes the gap, not the `unique` alone —
  fixing this broke five pre-existing pgTAP fixtures across the test suite that inserted
  `ct_heat_entries` without a station, all repaired. Three new pgTAP assertions
  (`002_cup_taster_tables.sql`, plan grown to 9, one strengthened per `test-auditor` to
  check the exact error message) plus a new Vitest case proving the fail-fast path
  issues exactly one insert attempt, never retries. See CHANGELOG.md's dated entry for
  the full account.
- **Supabase cloud project not yet linked.** Phases 0–3 only set up and verified the
  local stack. Linking a cloud project (and the `supabase db push` step CLAUDE.md's Git
  section refers to) is Phase 4+ work, once the schema is stable enough to push.
- **Design tokens shipped 2026-08-22, ahead of Phase 4** (`src/ui/tokens/`: colors,
  typography, spacing, base styles, self-hosted fonts, `DESIGN.md`, `preview.html`) —
  see CHANGELOG.md's "Design system foundation" entry for what shipped and what the
  three parallel reviews (`module-boundary-checker`, `ui-accessibility-reviewer`,
  `code-reviewer`) found and fixed. `heatsScreen.js`/`.css` (T4.2) is the first real
  screen consuming it now, alongside `preview.html` and `index.html`'s stylesheet
  `<link>`.
- **T6.hardening.a11y — Success-message focus/announcement inconsistency, DEFERRED.**
  `focusAfterRender` moves focus to a screen's own heading on a successful write, not to
  the `.screen-feedback` region holding the success text, so screen-reader users get no
  reliable announcement. Found reviewing core wiring (eventsScreen.js) but confirmed
  identical across setupScreen.js/rosterScreen.js/standingsScreen.js/scoringScreen.js/
  timingScreen.js too — deliberately NOT fixed in only one file, since that would create
  a NEW inconsistency rather than resolve one. Needs a dedicated, app-wide pass (likely a
  persistent, non-recreated live-announcer region shared across screens), not a per-screen
  patch — out of scope for the grouped accessibility pass. Flagged by:
  `ui-accessibility-reviewer` (core wiring group).

- **T6.hardening.a11y — Disabled-button contrast ratio, NEW GAP (2026-09-11).**
  `.btn:disabled`'s existing `opacity: 0.6` treatment (in `heatsScreen.css`, loaded globally)
  computes to roughly 3.4:1 contrast on a colored `.btn-primary` with white text — below the
  4.5:1 AA floor. Pre-existing on read-only toggles elsewhere in the codebase (which is why
  `scoringScreen.css` already documented a separate `data-readonly` override with `opacity: 1`);
  this task substantially increases exposure to the gap by adding many new "…ing" labels that
  render in the disabled state on timing/scoring surfaces judges read under time pressure. Not
  fixed here (would require either extending the `data-readonly` override to the new in-flight
  case, or a documented accepted-exception decision). Flagged as a separate, whole-app pass.
  Flagged by: `ui-accessibility-reviewer` (heats/timing group).

- **T6.hardening.a11y — `viewerBody.js` countdown `[data-urgent='true']` color-alone signal,
  CLOSED (2026-09-12).** Both the organiser-side `timingScreen.css`'s
  `.countdown-display[data-urgent='true']` and audience-side `viewerBody.css`'s
  `.viewer-countdown[data-urgent='true']` gained `font-weight: var(--font-weight-bold)` and
  `outline: var(--border-strong) solid var(--color-danger); outline-offset: var(--space-3);`
  to provide non-color-dependent urgency signals (bold weight and bordered outline ring).
  Outline deliberately chosen over border to prevent layout shift on transition. Pre-existing
  screen-reader announcement ("Less than 10 seconds remaining") was already in place and
  remains untouched. `viewerBody.css`'s margin-top on `.viewer-heat-chips` bumped from 12px
  to 16px to maintain clearance from the countdown's outline-offset ring (outline-offset 12px
  - outline width 2px = 14px total extension). All three review rounds (module-boundary-checker,
    ui-accessibility-reviewer, code-reviewer) found zero blocking issues; the margin-overlap
    risk itself was caught during review and fixed. Verified live at 360px+ and in both paper/stage
    color modes. Flagged by: `ui-accessibility-reviewer` (audience/live surfaces group, 2026-08-28).

- **T6.hardening.a11y — No button-disable during in-flight async writes, CLOSED (2026-09-11).**
  Every action button across all four affected screens (`heatsScreen.js`, `timingScreen.js`,
  `timingManualScreen.js`, `standingsScreen.js`) now disables synchronously before its first
  `await`, preventing double-clicks and maintaining correct user feedback throughout the
  round-trip. Implementation uses direct DOM mutation (`button.disabled = true; button.textContent
= '...ing…'`) at the start of each click handler, before any await, with a restore callback
  mechanism gating the post-write `render()` so buttons re-enable with their original label if
  the render itself throws (fixing a regression the initial fix would have introduced). A second
  real defect in `standingsScreen.js` was uncovered and fixed: the pre-existing `actionInFlight`
  guard was only ever evaluated during render, never actually applying the disabled state to the
  DOM. All 7 affected buttons (seed roster, generate heats random, generate heats manual submit,
  start heat, per-row stop, manual-entry save, and standingsScreen's 4 write buttons) now have
  synchronous "disables immediately" tests proving the disable happens before the first await.
  Two additional regression tests prove button restoration on render() failure. Three files
  gained synchronous test coverage for this exact synchronous-before-await guarantee
  (`heatsScreen.test.js`, `standingsScreen.test.js`), and two files use dedicated code-reviewer
  re-read verification in place of live tests due to fixture complexity (`timingScreen.js`,
  `timingManualScreen.js`). npm run lint clean, full JS suite 1060/1060 passing. Module-boundary
  clean; ui-accessibility found three items (missing synchronous tests for 5 buttons — fixed;
  Stop-button mid-flight focus-loss — documented as accepted tradeoff; disabled-button contrast
  gap — flagged as new separate follow-up). Code-reviewer (2 rounds) found and fixed: render()
  failure regression, fragile selector lookups (now direct element references), confirmed all
  restore callbacks are correct. Flagged by: `ui-accessibility-reviewer` (heats/timing group).

- **T6.hardening.a11y — `viewer-shell.js` render() churn during persistent-h1 fix,
  NON_BLOCKING.** The persistent-h1 fix (real, tested, correct) left `render()` calling
  `renderChrome()` in full on every re-render just to discard everything except the status
  badge (`.lastElementChild`) — not a bug, just avoidable churn. Not a blocking issue,
  just optional cleanup. Flagged by: `code-reviewer`.

- **T6.hardening.offline-soak — main.js's hasSession tracking uses a second, separate client.auth.onAuthStateChange subscription alongside appShell.js's own pre-existing one, NON_BLOCKING.** Functionally correct (supabase-js supports multiple listeners fine) but a discretionary duplication. A smaller fix would have mountAppShell() accept an onSessionChange callback (or expose current session reactively) so main.js could reuse appShell's subscription instead of adding its own. Code-reviewer flagged this as discretionary, not required — the duplication is a consequence of appShell.js's returned handle not exposing session state to its caller, not carelessness. Worth a look if appShell.js's own API is revisited for other reasons. Flagged by: `code-reviewer`.

- **T6.hardening.offline-soak — hasSession (main.js) only checks session existence at flush-start time, CLOSED (2026-09-12).** Gapped fixed at the core shared layer (`src/core/outbox.js`'s `buildRpcHandler`), not just at main.js's call site — closing the gap for all 8 RPC call sites (timing.js/scoring.js/standings.js/liveSession.js/publish.js) that share this handler-builder. Added `export function isAuthStatus(status) { return status === 401; }` and changed `err.permanent = Boolean(status)` to `err.permanent = Boolean(status) && !isAuthStatus(status)`, treating 401 as blanket-retryable (PostgREST's own JWT-layer response, never a business-logic rejection) while preserving permanent classification for genuine application errors (400+ non-401 statuses). Confirmed empirically against real local Postgres/PostgREST: expired JWT = exactly `401 {"code":"PGRST303"}`, malformed JWT = `401 {"code":"PGRST301"}`, application-level rejection = `400 {"code":"P0001"}` (verified across all 8 RPCs this app calls). A second, real gap found in code-reviewer's first pass: `src/formats/cup-taster/liveSession.js`'s own `publishLiveSessionHandlers` hand-rolls a duplicate error-to-permanent mapping (can't reuse `buildRpcHandler` directly — stored payload is only a small intent, not the full RPC payload). First draft updated only the core handler, missing this second call site. Fixed by exporting `isAuthStatus` and reusing it in liveSession.js too, with its doc comment corrected. Also fixed a non-discriminating test in liveSession.test.js (fakeClient's synchronous reads meant the before/after window would pass regardless — added artificial delay to fakeClient's read, verified by mutation testing the real capture point can move). Tests: 2 new in outbox.test.js (401 → permanent: false; 400 → permanent: true), 2 new in liveSession.test.js for the same cases in publishLiveSessionHandlers, plus corrected snapshot-timing test. npm run lint clean, full JS suite 1065/1065 passing. `offline-sync-auditor` confirmed 401 is safe to treat as blanket-retryable across all 8 RPCs, and verified no new gap introduced with FIFO-blocking retry mechanics. `code-reviewer` ran twice (first pass found the missed second call site, follow-up pass confirmed all fixes). Flagged by: `code-reviewer` (raised on `offline-sync-auditor`'s behalf).

- **No org/membership management UI or RPC exists.** `orgs`/`org_members` are
  deliberately read-only at the RLS+GRANT layer; provisioning the single org for
  October happens via `service_role` outside the app, not through a built flow. Revisit
  if a self-serve org-setup flow is ever needed.
- **Cloudflare Workers is now connected and auto-deploying** (2026-08-22, user action —
  ahead of §15.4's "not before Phase 5 at the earliest" default). The GitHub repo has the
  official "Cloudflare Workers and Pages" App installed; every push gets a Workers Build
  check and a live preview URL, and pushes to `main` build the production script. This
  happened between T3.2's PR being opened and merged — noticed via an unexpected third CI
  check, confirmed intentional with the user before merging. Real app code now deployed
  (2026-08-30+). **2026-08-31 follow-up: Cloudflare Workers build-time env vars were
  missing from the dashboard's Settings → Builds → Variables and secrets box, causing a
  "supabaseUrl is required" crash at startup** — fixed via a manual `wrangler deploy` with
  the real values (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_DEFAULT_ORG_ID) fetched
  from Supabase. CRITICAL: those three vars must be added to the dashboard's own Builds
  Variables box by the user so future auto-triggered builds (e.g. from merging PR #42) don't
  regress to the same crash — the wrangler deploy was one-time, but the dashboard setup is
  permanent. **Confirmed done and holding (2026-09-04).** The dashboard vars were in place
  by PR #42's merge — its own auto-triggered Cloudflare build reproduced the identical,
  correctly-configured bundle, not a crash. PR #45 and PR #46 have both auto-built since
  with no reported regression, and a direct live check today (page load + console) shows
  the real sign-in form rendering with zero errors. No action needed unless the dashboard
  vars are ever cleared again.
- **The handoff's own cross-surface AC for T5.3/T5.4 is closed (2026-08-28)** —
  `tests/e2e/cross-surface-countdown.spec.js` drives three separate Playwright browser
  contexts (organiser's `timingScreen.preview.html`, `projectorSurface.preview.html`,
  `phoneSummary.preview.html`) against a real started heat, proving agreement within ±2s
  at mid-heat, the urgent window, and past expiry — including numerically tying the
  organiser's own auto-max-at-expiry state back to `core/countdown.js`'s own `isExpired()`,
  not just two correct-looking but uncorrelated proxies. Needed its own second Playwright
  project (`playwright.config.js`) targeting the dev server, since `vite build` doesn't
  output the format demo harnesses at all, and a new CI job (`.github/workflows/ci.yml`)
  since this AC-closing test previously had no continuous verification at all. See
  CHANGELOG.md's dated entry for the full review account. **This was the last open item on
  Phase 5's own Definition of Done — Phase 5 is now fully done.**
- **T5.3's accessibility-flagged holding-state gap is closed (2026-08-28 follow-up)** —
  `viewer-shell.js`'s `computePhase()` used to collapse two of the handoff's own four named
  states (§8.4: "no event, not started, started-but-nothing-published, connection lost")
  into one generic card, since it only ever read `live_sessions`, never `events`.
  `core/events.js` gained `findLatestEventForOrg(orgId, client)` (existence-only —
  `events.status` exists in the schema but nothing writes it yet, so it isn't a reliable
  "started" signal); `viewer-shell.js` gained a `hasEvent` flag distinguishing the new
  `'noEvent'` card from the renamed `'notStarted'` one (was `'empty'`). See CHANGELOG.md's
  dated entry for the full review account, including a sequential-timeout compounding bug
  the review caught (fixed with the event check's own shorter timeout) and a
  staleness-guard ordering fix.
- **T5.4's missing `<h1>` is closed (2026-08-28 follow-up)** — `core/viewer-shell.js`'s
  chrome name (showChrome:true, the phone surface) is now a real `<h1>`, not a `<span>`;
  the projector (showChrome:false, no chrome band to host one) gets an equivalent
  visually-hidden `<h1>` instead. Both reference one `APP_NAME` constant. Four parallel
  reviews found three real issues in the first pass, all fixed in a second pass — see
  CHANGELOG.md's dated entry for the full account, including a mutation-tested proof that
  the new symmetric `showChrome:true` re-render test actually catches the regression it
  targets.
- **T4.6's round-1 accessibility review flagged three non-blocking items, deliberately
  left as-is rather than fixed inline:** (1) `standingsScreen.css`'s 480px table-stacking
  rule is copy-pasted from `heatsScreen.css`'s `.assignment-table` pattern rather than
  shared — sits against `CONVENTIONS.md`'s own "extract on 2nd verbatim occurrence" rule;
  a future fix to that pattern (e.g. real screen-reader label text instead of CSS
  `::before` content) has to land in two places until centralized. (2) `standingsScreen.js`'s
  initial `await render()` on mount has no try/catch, so a `loadState()` failure on first
  load surfaces as an unhandled rejection rather than an in-screen message — inherited
  unchanged from `heatsScreen.js`'s own identical pattern, not new to this task. (3) No
  visible "in progress" affordance between a tap and its re-render (no spinner, though
  re-entrancy is safely guarded) — worth revisiting given this project's "unreliable venue
  wifi" design target. None block Phase 4; revisit if either becomes a real field issue.
- **App wiring shipped (2026-08-30, not tied to a phase task)** — `core/router.js`,
  `core/appShell.js`, `core/config.js`, `core/eventsScreen.js`,
  `formats/cup-taster/eventDashboardScreen.js`, `formats/cup-taster/timingRouteScreen.js`,
  and a rewritten `main.js` connect every already-built screen into one real, navigable
  app. See CHANGELOG.md's dated entry for the full review account (five reviewers in
  parallel — real findings from all but `module-boundary-checker`, all closed).
- **Stage-plan setup scoping: "another stage" vs "more heats in this stage" — CLOSED
  (2026-09-03).** User hit a real product-model confusion live-testing: built a "prelims"
  as two separate same-kind stage ROWS, expecting one pooled prelim with shared
  standings/cutoff, but the schema treats multiple same-kind stage rows as genuine
  sequential elimination rounds (each needs its own cutoff, survivors carry forward).
  Confirmed the user's actual workflow is ALREADY fully built (one stage row split into
  station-limited heats via `partition.js`, aggregated back in `standings.js`, one cutoff
  via `advancement.js` — all tested and shipping), so the gap was narrower:
  `setupScreen.js`'s "Add stage" button gave no indication adding a SECOND same-kind row
  means "a real second elimination round," not "more capacity for this round." Closed by
  adding an inline advisory hint matching the existing terminal-stage cutoff hint pattern
  in `renderStageRow`, clarifying "adding another stage means another round" before the
  user commits to the structure. Also found and fixed a real staleness bug: the kind
  `<select>`'s change handler wasn't re-rendering, leaving stale hint text on screen until
  an unrelated action triggered a rebuild. See CHANGELOG.md's dated entry for the full
  account (four parallel reviewers, all found real issues).
- **PR #42 (fix: confirm_heat entry_id misidentification + Score-this-heat UX) is MERGED
  (2026-08-31).** Two linked fixes: root cause was `scoring.js`'s `buildConfirmEntries()`
  passing the wrong id field to the RPC, silently breaking every real confirm attempt; the
  secondary UX addition added a "Score this heat" link from the timing-complete view.
  Already verified live in production (deployed via `wrangler deploy` ahead of the PR
  merging, then re-verified after merge that Cloudflare's own auto-build reproduced the
  identical, correctly-configured bundle). See CHANGELOG.md's dated entry for the full
  review account (five parallel reviews, including a second code-reviewer pass that caught
  a high-severity gap in the first pass's own focus-move fix, and a CI-only prettier
  format:check failure neither local eslint nor the review passes caught).
- **The DOM-write race between the router and a slow-resolving screen is CLOSED
  (2026-09-04).** `router.js`'s `resolveSeq` staleness guard alone only ever protected
  its own `current` bookkeeping; it couldn't stop a discarded-but-still-in-flight
  screen's own internal `root.innerHTML = ''`/`appendChild()` writes made while ITS OWN
  promise was still resolving — even during a screen's very first mount, before it had
  returned a handle the router could call `unmount()` on. Closed via an `AbortController`
  `resolve()` creates per navigation, aborting the PREVIOUS one synchronously the
  instant a newer navigation starts (not once the stale mount's own promise happens to
  settle) — the resulting `signal` is threaded into every screen's mount call, and each
  screen checks `signal?.aborted` before writing to `root` in its own post-await
  continuation. Retrofitted across all 13 screens with the gap
  (`core/eventsScreen.js`/`splashScreen.js`/`loginScreen.js`, all 10
  `formats/cup-taster/*Screen.js` files), plus `main.js`'s `buildRoutes()` (found, mid-task,
  to be silently dropping `signal` before it ever reached a screen — every route's own
  params-reconstruction lambda needed its own fix) and `requireAuth()`'s own extra async
  hop (`getSession()`). `core/viewer-shell.js` (and its two consumers,
  `projectorSurface.js`/`phoneSummary.js`) was initially scoped OUT as "already guarded by
  its own local `mounted` flag" — `code-reviewer` caught that this claim was false
  (`mounted` is set `true` _before_ the initial `refresh()`'s own network await, so it only
  ever protects a callback firing after a legitimate `unmount()`, never the still-in-flight
  first load) — closed too, in the same pass, once the gap was confirmed real. 18 new
  regression tests across `router.test.js`/`main.test.js`/13 screen test files, every one
  hand-mutation-tested (guard disabled, confirmed the exact right test failed, restored).
  One real mutation-testing-leftover bug (a guard left disabled in `eventsScreen.js`
  after a manual test pass) was independently caught by two parallel reviewers
  (`test-auditor`, `ui-accessibility-reviewer`) before merge — fixed. See CHANGELOG.md's
  dated entry for the full four-reviewer account.
- **Supabase cloud project linked, real organiser provisioned (2026-08-30)** — the
  project "Seduh Score Next" (`wxzwanprluqmgoagbkpv`) already existed (created before
  this session) but had zero migrations; all 11 are now applied and verified, plus a
  follow-up migration (`20260830130000_rpc_search_path_pin.sql`) closing a
  `get_advisors` finding on six write RPCs. See CHANGELOG.md's two dated entries.
- **`anon`'s default-`PUBLIC` EXECUTE on all six write RPCs is closed (2026-08-30
  follow-up)** — migration `20260830140000_revoke_public_execute_on_write_rpcs.sql`
  revokes `EXECUTE` from `PUBLIC` on `merge_people`/`confirm_heat`/`publish_session`/
  `start_heat`/`record_heat_time`/`auto_max_heat`, leaving each function's existing
  `authenticated` grant untouched. `security-reviewer` found a real gap in the first
  draft before approving it: `service_role` isn't a Postgres superuser in this project
  (only `BYPASSRLS`, which never bypasses GRANT checks) and isn't a member of
  `authenticated` either, so it was _also_ silently losing EXECUTE by the same
  PUBLIC-default mechanism — confirmed dormant (nothing in this codebase calls these
  RPCs as `service_role` today) but a real footgun for future server-side tooling. Fixed
  in the same migration with an explicit `grant execute ... to service_role` alongside
  each revoke. `schema-guardian` flagged one adjacent, still-open observation: the ten
  `app.*` helper functions have the identical never-revoked PUBLIC default, currently
  inert only because `app` isn't in `config.toml`'s exposed `api.schemas` — not fixed,
  noted for a future audit pass. Pushed to both local and the cloud project; see
  CHANGELOG.md's dated entry for the full account.
- **Leaked-password protection cannot be enabled — Supabase free-tier limitation, not a
  fix left undone.** A `get_advisors` finding, unrelated to any migration (a dashboard
  toggle under Authentication → Settings on the cloud project, not a schema change).
  Confirmed with the user (2026-09-04): the toggle is gated to paid Supabase plans, and
  the linked cloud project is on the free tier. Revisit only if/when the project
  upgrades tiers — no action available today.
- **`anon`'s TRUNCATE/REFERENCES/TRIGGER/MAINTAIN grant on every table — not closed,
  found while diagnosing the anon-safe events-read migration
  (`20260831100000_events_anon_safe_read.sql`).** Every table in this schema carries a
  default `anon=...Dxtm` grant regardless of RLS — TRUNCATE in particular is not
  governed by RLS at all in Postgres, so it's a full bypass wherever it's reachable.
  Confirmed NOT currently exploitable (PostgREST never issues TRUNCATE, and no other
  anon-reachable raw-SQL path exists in this app), so — same shape as the write-RPC
  EXECUTE gap above — this is defense-in-depth, not a live hole. Schema-wide, not
  specific to `events`; deliberately left as its own follow-up rather than folded into
  that migration's already-large scope.
- **Production feedback (2026-09-04): `reportScreen.js`'s new `renderDifficultyCell()` has
  only one call site today, NON_BLOCKING.** Code-reviewer assessed this as a reasonable
  readability extraction (keeps `renderDifficultyTable`'s own `.map()` body scannable), not
  premature abstraction — the project's convention targets copy-pasted logic across files,
  not single-use helpers. Flagged only so the user can confirm the reading matches intent.

---

## Known open items from Phase 5 (T5.gap.automatic-publish)

- **Manual timing screen not wired to automatic publishing, DELIBERATE SCOPE BOUNDARY.**
  A manual heat has no `started_at`/clock to publish early; it only surfaces once
  confirmed, same as any other heat. A manual heat mid-entry won't show as "in progress"
  on the audience view. Not a bug, not a to-do — this is the intended behavior. Flagged by:
  `code-reviewer`.

- **A third automatic-publish trigger at stage-resolution is CLOSED (2026-09-06).**
  `standingsScreen.js`'s `commit()` now calls `publishLiveSession` right after a
  successful `commitStageResolution`, on every resolution (not just the terminal one) —
  built as part of the "champion declared" audience-view feature, which needed this
  trigger to exist at all (a champion declared at the terminal stage would otherwise
  never reach the live payload, since there's no heat left afterward to publish from).
  See CHANGELOG.md's "Audience live view: stage-kind labels + champion hero" entry.
  **`standings` rows compute and publish `tieStatus`, PRODUCT/SCORING DECISION CLOSED
  (2026-09-11).** Matched `standingsScreen.js`'s existing convention exactly:
  `tieStatus` stays 'tied'/'advancing' right up through a confirmed tiebreak heat, only
  clearing once the organiser actually commits the stage resolution (not clearing as soon
  as the tiebreak heat itself is confirmed, which was rejected). Implementation in
  `buildLiveSessionPayload` calls `resolveAdvancement(ranked, stage.cutoff ?? 1)` using
  the same `ranked` list already fetched for standings rows (zero new DB reads), gated to
  skip computation once `stage.status === 'complete'` (since `ct_standings` is never
  updated by tiebreak/coin-toss outcomes, post-completion computation would incorrectly
  show ties already broken). New `tieStatusFor` exported from `standings.js` and shared
  by both `standingsScreen.js` and `liveSession.js` instead of duplicated (found in
  review). Three tests: base case (existing fixture, cutoff now correct), genuine 3-cupper
  border-tie at position 2, and complete-stage gate suppresses tieStatus even when
  underlying data would compute tie. All reviewers clean: `scoring-auditor` verified
  identical call to `standingsScreen.js`, gate safety, stageEntryId consistency; zero
  `core/` boundary violations; tests prove invariants. See CHANGELOG.md for full account.
  Flagged by: `code-reviewer`.

- **Generic three-state sync panel never names WHICH operation type is stuck, MINOR
  DIAGNOSTIC GAP.** An organiser can't tell a stuck `publish_live_session` apart from a
  stuck `start_heat`/`confirm_heat` from the panel alone. Non-blocking (the panel never
  lies, just isn't specific). Flagged by: `offline-sync-auditor`.
  **CLOSED 2026-09-11:** `src/core/appShell.js` gained an optional `operationLabels` parameter
  passed from `src/main.js` (the one file allowed to know both "core" and "this format"),
  `src/formats/cup-taster/outboxHandlers.js` exports `cupTasterOperationLabels` mapping
  the 6 operation types to short labels ("starting a heat", "recording a time", etc.),
  and `renderSync` now renders operation-specific messages like "Not synced — confirming
  a heat failed" instead of generic "retrying failed." Zero core/format boundary violation
  — a future format supplies its own label map unedited. All three reviewers (ui-accessibility,
  module-boundary, code-reviewer) confirmed clean; consistency tests (every handler has a
  label, every label maps to a handler) newly added. npm run lint clean, 1047/1047 tests
  passing.

- **`buildLiveSessionPayload` does N+1 sequential DB reads, OPTIMIZATION DEFERRED.** One
  query per heat via `listHeatsForStage`, more per surfaced heat's roster/results. This
  fires automatically on every heat start/confirm (more frequent than the `heats.js`
  precedent it cites, which fires only on occasional manual setup). Worth batching via
  `.in('heat_id', heatIds)` in a follow-up, especially for stages with many heats.
  Non-blocking, deferred. Flagged by: `code-reviewer`.

- **No ordering guard on `live_sessions`'s upsert, CLOSED (2026-09-12).** New migration `supabase/migrations/20260912090000_live_sessions_snapshot_ordering_guard.sql` adds `snapshot_at timestamptz not null default now()` column and rebuilds `publish_session` (6 → 7 args) adding `p_snapshot_at timestamptz default now()`. Staleness is checked UP FRONT before any mutation: if an incoming publish's snapshot is older than the target event's already-stored snapshot, the function records it as processed and returns immediately (untouched). Only once staleness is ruled out does the original deactivate-then-upsert sequence run. `src/formats/cup-taster/liveSession.js`'s `publishLiveSessionHandlers` now captures `const snapshotAt = new Date().toISOString()` BEFORE calling `buildLiveSessionPayload` (not after), threading it through as `p_snapshot_at` — the real fix, making the DB-side guard meaningful. **Two real, serious issues found in review and fixed before shipping:** (1) PostgreSQL's `CREATE OR REPLACE FUNCTION` cannot change a function's argument list — the old 6-arg would have remained callable, and the new 7-arg would have started from Postgres's own insecure defaults (no EXECUTE revoke-from-PUBLIC, no search_path pin), regressing two prior hardening migrations. Fixed by explicitly dropping the old 6-arg and reproducing all three hardening properties (`search_path = ''` pin, fully-qualified table references, `grant execute ... to service_role` with PUBLIC revoke), verified live via `has_function_privilege()` against local Postgres. (2) `security-reviewer`'s first pass caught the actual blocking finding: first draft kept the pre-existing unconditional deactivate-others UPDATE running BEFORE the staleness-guarded ON CONFLICT WHERE clause. When staleness guard evaluated false, the UPDATE had ALREADY silently blanked the org's active live sessions, worse than the stale-payload failure mode being fixed (would leave audience view blank until an unrelated publish arrived). Closed by moving staleness check up front (before any mutation, short-circuiting with early return if stale). Two new pgTAP assertions in `supabase/tests/006_publish_session.sql` (plan bumped 18→23→25) prove post-stale-call the session is still active and exactly one session is active for the org — checked immediately, not masking an intermediate all-inactive window. `schema-guardian` ran twice (independently reproduced the zero-active-sessions bug via three methods, then confirmed the fix closes it; executed rollback block in transaction, confirmed byte-for-byte restoration). `security-reviewer` ran twice (first pass found the blocking issue, second pass re-verified search_path/grants/org-ownership-gate and org-ownership edge case). pgTAP suite: 177/177 passing, applied cleanly from empty database. `offline-sync-auditor` clean. Flagged by: `offline-sync-auditor`.

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

## Versioning system (2026-09-05) — closed

All four applicable reviewers ran clean: `code-reviewer` (2 findings, both fixed —
a stale cross-reference this very section existed to correct, and a duplicated-literal
test risk), `ui-accessibility-reviewer` (clean; one non-blocking note on the footer's
untested border-hairline contrast), `module-boundary-checker` (clean — confirmed a
future format can call `mountAppShell` unedited and get the same footer). No
schema/RLS/scoring/offline-sync change, so `schema-guardian`/`security-reviewer`/
`scoring-auditor`/`offline-sync-auditor` don't apply. See CHANGELOG.md's "Versioning
system: nameplate + semver footer" entry for the full account. **Definition of Done
met.**
