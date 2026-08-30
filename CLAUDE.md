# Seduh Score Next — Claude Code orientation

_State: Phase 0 done; Phase 1 done (T1.1–T1.4); Phase 2 done (T2.1–T2.6); Phase 3 done
(T3.1–T3.3); Phase 4 done (T4.1–T4.8, plus two 2026-08-27 follow-ups closing T4.1's
stage-plan UI gap and its roster-registration UI gap, a 2026-08-29 follow-up closing
T4.3/T4.4's direct-write gap, a further 2026-08-29 follow-up closing T4.2's DB-level
station-uniqueness gap, a further 2026-08-29 follow-up closing the cross-module outbox
handler-map composition gap, a further 2026-08-29 follow-up closing the
setupScreen/rosterScreen hung-load timeout/retry gap, and a further 2026-08-29 follow-up
closing T4.2's heat-generation resumability gap — see below); Phase 5 done (T5.1–T5.4,
the 2026-08-28 holding-state follow-up, the cross-surface Playwright AC, and the
2026-08-28 viewer-shell
`<h1>`/heading-hierarchy follow-up); design-system type refresh (2026-08-28, not tied to
a phase — Erode/Tabular → Cabinet Grotesk/JetBrains Mono); app wiring done (2026-08-30,
not tied to a phase task — router, organiser shell, event management, `#/live/*`
routes — see below); temporary login screen done (2026-08-30, also not tied to a phase
task — see below) — matches CHANGELOG.md as of 2026-08-30_

Read these before touching anything:

1. `Handoffs and Specs/SEDUH-NEXT-HANDOFF.md` — the frozen spec. Vocabulary, schema,
   permission model, the full build plan (§14, T0.1–T6.x), Definition of Done (§11). This
   never gets edited to reflect progress (§0) — it's the original brief.
2. `CONVENTIONS.md` — how this codebase actually builds things, backfilled from what's
   shipped.
3. `CHANGELOG.md` — what's shipped, in what order, and why. The ground truth for "where
   are we."
4. `ROADMAP.md` — living phase-status tracker (the handoff's build plan, kept current —
   unlike the handoff itself).

---

## Delegation strategy

The 9 subagents in `.claude/agents/` per handoff §13:

- **After any migration/schema change** → `schema-guardian` (constraints, indexes,
  rollback blocks — and _verify_ the rollback by actually running it in a transaction,
  not just reading it).
- **After any RLS policy, RPC, or Storage change** → `security-reviewer`. Blocking, per
  the Definition of Done — never skip it.
- **After `core/ranking`, `core/advancement`, `core/timeclamp`, or `formats/*/scoring`
  changes** → `scoring-auditor`. Nothing in Phase 4 may start before these three pass
  this review (handoff §14).
- **After any change under `src/**`** → `module-boundary-checker` — the §6 test is "can
  a future format reuse this module without editing it?"
- **After any test file changes** → `test-auditor` — checks that tests assert the
  invariant, not merely pass.
- **After any UI change** → `ui-accessibility-reviewer`, verified at 360px first, before
  wider breakpoints.
- **After outbox/IndexedDB/sync changes** (Phase 3 onward) → `offline-sync-auditor`.
- **After any code change, any file** → `code-reviewer`.
- **End of every task** → `kb-sync`.

Run the relevant reviewers in parallel (single message, multiple Agent calls) when a
change touches more than one concern — e.g. a migration that's both schema and RLS gets
`schema-guardian` + `security-reviewer` together.

**Every review this project runs should be expected to find something** (handoff §13).
Treat a clean review as the surprising outcome, not the expected one.

**Cost note (2026-08-22, user decision):** `kb-sync` and `module-boundary-checker` run
on a cheaper model (`model: haiku` in their `.claude/agents/*.md` frontmatter) — both are
comparatively mechanical (session-log writing; import-path/grep-based boundary checks).
`schema-guardian`, `security-reviewer`, `scoring-auditor`, `offline-sync-auditor`, and
`code-reviewer` stay on the full model deliberately — these are the correctness/security
gates the "every review should find something" discipline above depends on, and Phase 4's
own review cycles (T4.1, T4.2) already surfaced real bugs on second and third passes that
a weaker reviewer could plausibly have missed. `test-auditor` and `ui-accessibility-reviewer`
were considered and kept on the full model too.

---

## Non-negotiables

### Vocabulary — "trio" is banned

`CUP-TASTER-SPEC.md` v4.0 used "trio" to mean _set_, and "set" to mean the stage's whole
collection of sets — that inversion is not carried forward (handoff §2). Enforced by the
`no-trio-vocabulary` ESLint rule under `src/`, case-insensitive, across identifiers,
strings, and comments.

### The module boundary (handoff §6)

**Can a future format reuse this module without editing it?** `src/core/` must never
import from `src/formats/`, and format-specific logic must never leak into `src/core/`.
Enforced by `no-core-format-import`; `module-boundary-checker` catches the subtler cases
a static rule can't (indirect coupling, reimplementing a `core/` primitive inside a
format). v4.x's parallel timer implementation — one in `shared/timer.js`, a second,
incompatible one hand-rolled inside Cup Taster because the first couldn't be reused — is
the specific defect this boundary exists to prevent from recurring.

### `correct` is a count, never a column (handoff §5.2)

`ct_results` stores one row per cupper per set. Standings positions and tallies are
always derived (a view or a pure function), never persisted as a field. Enforced by
`no-derived-storage`; `scoring-auditor` verifies by reading, since the rule only catches
the obvious property/assignment shapes.

### `elapsed_secs` has exactly one writer: `clampElapsed()`

Both the tap path and the manual-entry path must call it — it's the sole duration cap
(handoff §5.2, §6). Enforced by `no-raw-elapsed-write`.

### Entitlements are a stub, not a system (D14)

`entitlements.js` returns permissive for every key. No call site should branch on a
tier or gate result anywhere in this repo yet — that's explicitly out of scope until a
real entitlement system is built.

### `is_test` renders unmistakably, from the first commit (D9)

Designed in from the first live-surface rendering task, not logged as a defect
afterward. v4.x demo mode was indistinguishable from a real event in the audience view —
that is the failure this project exists to close.

### Definition of Done (handoff §11, restated)

A task is done when: acceptance criteria are demonstrated, not asserted · tests pass
including the negative cases the task names · lint/format clean, hook not firing · no
new TODO without a linked issue · scoring/ranking/timing changes have `scoring-auditor`
sign-off · schema/policy/Storage changes have `security-reviewer` sign-off including a
negative test proving a non-member reads zero rows · UI changes have
`ui-accessibility-reviewer` sign-off at 360px first · outbox/sync changes have
`offline-sync-auditor` sign-off · a session log entry exists (`kb-sync`) · every
migration has a rollback block, applies cleanly from an empty database, and — once
pushed to the linked cloud project — is never edited again (a fix is a new migration).

---

## Git — dev/main, main protected

`dev` is the working branch; `main` is protected (D26) — direct pushes to `main` are
rejected (`GH006`), changes land via PR. This required making the GitHub repo public
(branch protection is a GitHub Pro feature for private repos on the free plan); the
handoff's own `LICENSE.md` already frames this repo as publicly viewable for
transparency/portfolio purposes, so this aligns with that, not against it.

Migrations: local dev (`npm run db:reset`) first, then push to the linked cloud project
once verified — see the Repo section below for the project details and how the first
push (2026-08-30) was actually done (the Supabase MCP's `apply_migration`, not
`supabase db push` — this machine isn't `supabase link`-ed to the cloud project yet).

---

## Architecture

```
Handoffs and Specs/SEDUH-NEXT-HANDOFF.md   ← frozen spec, never edited for progress
src/
  core/                         ← shared, format-agnostic. Done: partition, ranking,
                                   advancement, countdown, timeclamp, entitlements
                                   (Phase 2); registry, supabaseClient (T3.1); db, outbox
                                   (T3.2); syncState (T3.3); events, registry.registerEntry
                                   (T4.1); dom, errors (T4.3), duration (T4.4) — all three
                                   extracted from a cup-taster screen file on their 2nd
                                   verbatim use; export (T4.8 — table spec → CSV; PDF is
                                   the browser's own Print → Save as PDF, not a generated
                                   file, deliberately no new dependency); registry gained
                                   findEntryForPerson/setEntryWithdrawn and registerEntry
                                   became idempotent + race-recovering, dom gained
                                   labeledField (extracted from setupScreen.js on its 2nd
                                   verbatim use), errors gained UNIQUE_VIOLATION (hoisted
                                   from formats/cup-taster/setup.js so core/registry.js
                                   could reuse the same race-recovery shape) — all
                                   2026-08-27, the roster-registration screen's follow-up;
                                   publish (T5.1, 2026-08-27 — publishSession() enqueues +
                                   flushes a publish_session RPC through outbox.js exactly
                                   like scoring.js's submitConfirmHeat; logic-module only,
                                   nothing calls it yet — payload shape/call cadence are
                                   T5.2+ decisions); viewer-shell (T5.2, 2026-08-28 —
                                   mountViewerShell() watches live_sessions per-org via
                                   Supabase Realtime, the project's first realtime usage;
                                   renders every holding state itself, mounts a
                                   caller-supplied renderBody only once real content
                                   exists, same inversion-of-control shape as outbox.js's
                                   handler map; also the first CSS file living in core/
                                   rather than a format directory; gained a renderBody
                                   cleanup-lifecycle contract, T5.3 — an optional returned
                                   function, called before every re-render's
                                   body.replaceChildren() and again on unmount(), so a
                                   ticking display (viewerBody.js's live countdown) never
                                   outlives the DOM node it mutates; gained hasEvent and
                                   raceTimeout(), 2026-08-28 follow-up — distinguishes the
                                   'noEvent' holding card from the renamed 'notStarted' one,
                                   formerly both collapsed into a single 'empty' phase since
                                   this module never read events, only live_sessions).
                                   viewer-shell now has two real consumers (T5.3's
                                   projectorSurface, T5.4's phoneSummary, below) but its own
                                   preview harness's renderBody stays a stub, deliberately —
                                   that harness proves the shell alone, not the real
                                   content; events gained findLatestEventForOrg in that same
                                   2026-08-28 follow-up — existence-only, since
                                   events.status exists in the schema but nothing writes it
                                   yet; renderChrome()'s identity name is a real <h1>, not a
                                   <span>, 2026-08-28 heading-hierarchy follow-up — a
                                   visually-hidden equivalent <h1> covers showChrome:false
                                   (the projector), which has no chrome band to host a
                                   visible one in; both reference one APP_NAME constant.
                                   outbox gained buildRpcHandler(client, type) and publish
                                   gained publishHandlers(client), 2026-08-29 follow-up —
                                   closing the cross-module handler-map composition gap
                                   surfaced by the T4.3/T4.4 outbox-wiring review;
                                   buildRpcHandler is pure RPC-wrapping mechanics (dedups
                                   3 near-identical blocks formerly hand-rolled in
                                   timing.js/scoring.js/publish.js), format-agnostic by
                                   design, so it lives here rather than in a format;
                                   publish.js stays here too — publish_session carries its
                                   own p_format parameter, genuinely format-agnostic — see
                                   formats/cup-taster's own outboxHandlers.js entry below
                                   for the actual composition point. timeout (new,
                                   2026-08-29 follow-up) — raceTimeout(promise, ms) +
                                   DEFAULT_LOAD_TIMEOUT_MS, extracted from
                                   viewer-shell.js's own private identical implementation
                                   on its 2nd verbatim use, closing the setupScreen.js/
                                   rosterScreen.js hung-initial-load gap; viewer-shell.js
                                   now imports it instead of keeping its own copy.
                                   router (new, 2026-08-30 app-wiring pass) —
                                   hand-rolled, hash-based (createRouter/matchRoute); no
                                   opinion about screens/chrome/format (route.outlet and
                                   onNavigate are its only two extension points), client
                                   resolved once and threaded into every mount as the
                                   single chokepoint every screen gets it through; own
                                   resolveSeq staleness guard (mirrors viewer-shell.js's
                                   requestSeq) protects its own `current` bookkeeping
                                   only — see formats/cup-taster's own entry below for a
                                   real, deliberately-unfixed gap this does NOT close;
                                   also does the navigation focus-move (moves focus to
                                   the new screen's own heading, but only if nothing
                                   inside that screen's own mount already claimed focus
                                   itself — found missing in ui-accessibility-reviewer's
                                   own pass). appShell (new, same pass) —
                                   mountAppShell(): persistent organiser header (app
                                   name — a <p>, not an <h1>, since every routed screen
                                   already owns the page's real <h1>; a different
                                   tradeoff than viewer-shell.js's own renderChrome(),
                                   which IS a real <h1> since nothing else on that
                                   audience-facing surface competes with it), an
                                   event-name breadcrumb cached by event id with its own
                                   staleness guard, nav links, and a <main> content
                                   outlet; the second CSS file living in core/ rather
                                   than a format directory, after viewer-shell.css.
                                   Gained a reactive "signed in as {email}" + Sign out
                                   control, 2026-08-30 (temporary login screen pass) —
                                   subscribed via client.auth.onAuthStateChange rather
                                   than a one-time fetch, since the shell mounts once per
                                   app lifetime but a sign-in can happen well after that
                                   (the login screen mounts inside THIS shell's own
                                   outlet); unsubscribes in the shell's own unmount().
                                   Its breadcrumb fetch (setNav -> findEvent) is
                                   deliberately NOT gated by main.js's requireAuth — RLS,
                                   not this UI gate, is what actually protects that read
                                   (found in security review; documented with a comment
                                   at the call site rather than restructured).
                                   config (new, same pass) — getDefaultOrgId() reads
                                   VITE_DEFAULT_ORG_ID, throwing loudly if unset; the
                                   explicit, trivially-swappable placeholder for "which
                                   org" until real per-session org derivation exists —
                                   no auth is being added now (D-scoped with the user).
                                   eventsScreen (new, same pass) — events list/create;
                                   lives in core/, not formats/cup-taster/, since
                                   core/events.js already treats `format` as
                                   caller-supplied input (defaultFormat is a prop,
                                   main.js is the one file allowed to pass 'cup_taster'
                                   in) — the "This is test data" checkbox defaults
                                   unchecked (D9), the one place in the app that
                                   actually SETS is_test rather than just displaying it.
                                   events.js gained listEventsForOrg(orgId, client).
                                   loginScreen (new, 2026-08-30, temporary login screen
                                   pass) — mountLoginScreen(): a plain sign-in form
                                   against auth.signInWithPassword, explicitly scoped as
                                   temporary ahead of D14's real access control. No
                                   sign-up, no password reset, no tier/role gating.
                                   Gated in front of every organiser route by a
                                   requireAuth() wrapper confined to main.js itself (NOT
                                   added to router.js, which stays reusable unedited by a
                                   future format) — #/live/projector and #/live/phone
                                   stay unwrapped, since the audience never
                                   authenticates. Both requireAuth's getSession() call
                                   and loginScreen's own signInWithPassword call race
                                   against core/timeout.js's raceTimeout/
                                   DEFAULT_LOAD_TIMEOUT_MS (found missing in review —
                                   without it, a hung connection left the whole app, or
                                   the login form itself, stuck forever with no
                                   feedback).
  formats/
    cup-taster/                 ← scoring, timing-surface, entry-surface, viewer-body,
                                   analytics — Cup Taster-specific, built on core/. Done:
                                   setup, setupScreen (T4.1 — validateStagePlan generalized
                                   to an arbitrary stage-kind chain rather than two fixed
                                   sequences; saveStagePlan reconciles add/remove/reorder/
                                   edit against what's persisted, refusing the whole save
                                   if it would touch a stage that already has heats; the
                                   screen itself shipped 2026-08-27, closing T4.1's own
                                   original no-UI gap — see CHANGELOG.md); rosterScreen
                                   (also 2026-08-27, same day, separate follow-up — closes
                                   T4.1's OTHER no-UI gap: register/list/withdraw cuppers,
                                   built on core/registry.js unedited); heats, heatsScreen
                                   (T4.2 — first real UI screen in the project);
                                   heatsScreen gained a resumability follow-up (2026-08-29,
                                   closing a known ROADMAP.md gap) — heats.js itself is
                                   untouched (generateHeatsManual/
                                   buildHeatPlansFromAssignments were already idempotent
                                   and conflict-checked); renderManualAssignmentForm gained
                                   an optional existingAssignments map (an already-placed
                                   cupper renders as fixed text, not an editable input) and
                                   a new buildManualForm closure re-attaches each
                                   already-placed cupper's real assignment before calling
                                   generateHeatsManual, so its "every stage entry assigned
                                   exactly once" check still passes without asking the
                                   organiser to re-type anything; the manual form is now
                                   also shown when generation is incomplete, closing the
                                   "no repair path" gap purely as a UI-availability fix;
                                   timing,
                                   timingScreen (T4.3 — first live/ticking screen);
                                   timingManual, timingManualScreen (T4.4 — manual mode,
                                   timing.js exports shared helpers both timing modes
                                   reuse); both were direct-write until a 2026-08-29
                                   follow-up routed every write (start a heat, a real tap,
                                   a manual entry/correction, an auto-max sweep) through
                                   the outbox via three new RPCs (start_heat/
                                   record_heat_time/auto_max_heat, migration
                                   20260828150000) mirroring confirm_heat's idempotent,
                                   org-scoped shape — timing.js gained a shared
                                   timingHandlers(client) map (used by every flush in both
                                   modules, since core/outbox.js registers handlers per
                                   flushOutbox() call, not globally) and a
                                   buildRecordHeatTimePayload() helper shared by
                                   recordTap/recordManualTime; timingScreen.js/
                                   timingManualScreen.js gained a "ground truth over flush
                                   bookkeeping" pattern (pendingHeatCheck/
                                   pendingEntryCheck) comparing a fresh reload against the
                                   exact value a write attempted, not a bare null-check —
                                   a real concurrency bug (two concurrent taps for a
                                   heat's last two entries could both miss the
                                   advance-to-scoring flip; a first fix attempt then left
                                   a narrower stale-read gap under lock contention) was
                                   found and closed during review, verified with real
                                   concurrent psql sessions, not just pgTAP — see
                                   CHANGELOG.md/ROADMAP.md for the full account, including
                                   a related gap the same review surfaced, closed in a
                                   separate 2026-08-29 follow-up — see outbox and
                                   formats/cup-taster's own entries below for
                                   buildRpcHandler/cupTasterOutboxHandlers; heats.js gained a
                                   DB-level unique(heat_id, station) constraint follow-up
                                   (2026-08-29, migration 20260829100000) closing a known
                                   ROADMAP.md gap — ensureHeatEntries's new
                                   isStationConflict() helper distinguishes a station
                                   collision (two different cuppers racing for the same
                                   station — fails fast, never retries) from an entry_id
                                   collision (the pre-existing, safe-to-retry race
                                   recovery path, unchanged), told apart by matching
                                   "station" in the Postgres error's DETAIL/message,
                                   verified against a real violation via docker exec;
                                   schema-guardian caught the migration's own first
                                   version relying on a plain unique alone, which gives
                                   zero protection when station IS NULL — the added
                                   `alter column station set not null` is what actually
                                   closes the gap, fixed in the same migration since it
                                   was still local-only and unpushed;
                                   scoring, scoringScreen
                                   (T4.5 — three-state toggle + strict confirm; the whole
                                   heat is submitted as ONE outbox operation through the
                                   existing confirm_heat RPC — first format module to use
                                   core/outbox.js's `.permanent` error-flag contract, and
                                   the pattern T4.3/T4.4 followed above; gained an exported
                                   confirmHandlers(client), 2026-08-29 follow-up, mirroring
                                   timing.js's own timingHandlers — see outboxHandlers.js
                                   below); outboxHandlers (new, 2026-08-29 — the composition
                                   point closing the cross-module handler-map gap: exports
                                   cupTasterOutboxHandlers(client), spreading
                                   timingHandlers/confirmHandlers/core's publishHandlers
                                   into one map every real screen call site now passes as
                                   an optional `handlers` override, so a flush triggered
                                   from any of timingScreen.js/timingManualScreen.js/
                                   scoringScreen.js can process any of the 5 queued Cup
                                   Taster operation types, not just its own; deliberately
                                   not imported back into timing.js/scoring.js themselves,
                                   which would be circular — see CHANGELOG.md/ROADMAP.md
                                   for the full four-reviewer account); standings,
                                   standingsScreen (T4.6 — ranking/advancement/tiebreak/
                                   coin-toss, direct writes like T4.2; heats.js gained a
                                   generalized `kind` parameter for tiebreak heat creation);
                                   analytics, reportScreen (T4.7 — per-stage difficulty/
                                   distribution, gated on the whole event being complete;
                                   no partial-data report) — reportScreen.js also gained
                                   T4.8's export actions (CSV download + print);
                                   viewerBody, phoneSummary (T5.4 — the shared renderBody
                                   core/viewer-shell.js mounts once real content exists:
                                   standings table, active-heat panel with per-cupper
                                   status chips, recent-results list; content shape ported
                                   from the legacy v4.x app's own never-shipped-standalone
                                   audience view. Deliberately Cup-Taster-specific per the
                                   handoff's own module table, meant to be shared unedited
                                   by T5.3's projector. phoneSummary.js is the thin
                                   phone-specific composition, showChrome: true); viewerBody
                                   extended with a live countdown for an active app-mode
                                   heat, T5.3 — core/countdown.js + core/duration.js,
                                   mirroring timingScreen.js's own tick pattern; reuses
                                   core/ranking.js's chainComparators for the recent-heats
                                   sort rather than hand-rolling one; mountViewerBody
                                   returns an optional cleanup function per
                                   viewer-shell.js's own contract above; projectorSurface
                                   (T5.3 — the thin projector-specific composition,
                                   showChrome: false, data-surface="stage" set on the
                                   caller's own root; reuses viewerBody.js completely
                                   unedited, per the handoff's own module table);
                                   demoActiveHeatPayload (2026-08-28, closing the handoff's
                                   cross-surface Playwright AC — buildActiveHeatPayload(),
                                   extracted from phoneSummary.preview.html/
                                   projectorSurface.preview.html's near-identical inline
                                   demo builders on its 2nd verbatim use; demo-only, not
                                   part of the shipped module graph, imported only by those
                                   two *.preview.html files and by nothing else).
                                   eventDashboardScreen (new, 2026-08-30 app-wiring
                                   pass) — per-event hub the organiser lands on after
                                   picking an event: is_test banner, Setup/Roster/Report
                                   links, one card per stage (labelled "Heats" or
                                   "Generate heats" per stageHasHeats, plus Standings),
                                   a zero-stages empty state pointing at Setup. Lives
                                   here not core/ — reads ct_stages via setup.js,
                                   genuinely format-specific. timingRouteScreen (new,
                                   same pass) — thin dispatcher: one route entry for
                                   "timing" but two real screens depending on the
                                   heat's own timing_mode (not knowable from the URL
                                   alone), so every heat-timing link stays simple.
                                   heatsScreen.js gained the fix for two real gaps found
                                   scoping this pass: mountHeatGenerationScreen was
                                   missing its `unmount()` return entirely (every other
                                   screen already had one), and its "generation
                                   complete" heats list had no links into Timing/Scoring
                                   at all — new heatActionLink() closes both. **A real
                                   gap found live-testing this same pass, NOT closed
                                   here**: core/router.js's resolveSeq staleness guard
                                   protects its own `current` bookkeeping only — it
                                   cannot stop a discarded-but-still-in-flight screen's
                                   OWN internal DOM writes (every screen here's own
                                   attemptLoad()/render() pattern) from landing after a
                                   newer navigation already mounted something else.
                                   Closing it means retrofitting every one of these ~10
                                   screens' own load pattern with a cancellation check —
                                   out of scope for the app-wiring pass that found it;
                                   see ROADMAP.md's "Known open items" for the account.
  ui/
    tokens/                     ← design tokens (plain CSS custom properties)
  main.js                       ← composition root (2026-08-30 app-wiring pass — was the
                                   Phase 0 placeholder until this). The one file allowed
                                   to know both "this app is Cup Taster"
                                   (defaultFormat: 'cup_taster' passed into
                                   core/eventsScreen.js) and the full route table
                                   connecting every screen above. mountApp(root,
                                   {client, orgId}) builds a shellRoot/bareRoot split so
                                   the two chrome:false audience routes (#/live/projector,
                                   #/live/phone) get the entire root for their own
                                   full-bleed styling and never show organiser nav to an
                                   audience. Gained requireAuth() (temporary login screen
                                   pass, 2026-08-30) — see core/loginScreen.js's own
                                   entry above for the full account; routerRef is a
                                   mutable box (still null when buildRoutes() runs, since
                                   createRouter() needs the routes it returns first) read
                                   lazily by requireAuth's own onSignedIn/retry callbacks,
                                   which only ever fire after mountApp has set it.
supabase/
  migrations/                   ← forward-only, each with a tested -- rollback: block
  seed.sql                      ← (new, 2026-08-30) local-dev/CI-only: a fixed org + an
                                   authenticated login (bcrypt via pgcrypto), since every
                                   organiser table is authenticated-only and this project
                                   has no login screen yet. Applied by `db reset`/a fresh
                                   `start`, never by a bare `db push` — see the file's own
                                   header comment for exactly which CLI flags WOULD carry
                                   it to a linked project (none run anywhere in this repo
                                   today).
  tests/                        ← pgTAP, one file per concern, numbered
                                   (000_with_check_gate.sql runs first, per T1.4)
  config.toml                   ← local stack, ports offset +100 (5442x) from the CLI
                                   default so this project's stack can run alongside
                                   the sibling Kira-Kira repo's stack
eslint-rules/                   ← the 4 custom rules enforcing this project's contracts
                                   (no-raw-elapsed-write has its own Linter-based test)
tests/e2e/                      ← Playwright. smoke.spec.js (Phase 0, rewritten
                                   2026-08-30 for the real app shell) targets the real
                                   production build; cross-surface-countdown.spec.js
                                   (2026-08-28, closing the handoff's own cross-surface
                                   AC) targets the dev server instead, driving the format
                                   demo harnesses directly with a fake client, since vite
                                   build doesn't output those at all; organiser-flow.spec.js
                                   (new, 2026-08-30) also targets the dev server but drives
                                   the REAL app (main.js) against a REAL local Supabase
                                   stack via seed.sql's fixed login — three live surfaces
                                   (organiser, projector, phone) proven to agree, and the
                                   full create-event→timing click-through proven for real.
                                   See playwright.config.js's three projects — 'dev-app'
                                   depends on 'dev-harnesses' finishing first, since both
                                   share one dev server and running them concurrently
                                   caused real resource-contention flakiness.
.claude/
  agents/                       ← the 9 subagents
  hooks/lint-on-write.cjs       ← PostToolUse: ESLint on every .js write
```

## Repo

Local: `C:\Users\mfosa\OneDrive\Documents\seduh-score-next`
GitHub: `github.com/greymattercoffeewerks/Seduh-Score-Next` (public)
Supabase project: **linked, 2026-08-30** — cloud project "Seduh Score Next"
(`wxzwanprluqmgoagbkpv`, org "Grey Matter Coffee Werks", region `ap-southeast-1`), all 11
migrations pushed via the Supabase MCP's `apply_migration` (not yet linked locally via
`supabase link` — that needs the project's DB password from the dashboard, not set up
this session; pushing further migrations can keep using the MCP, or `supabase link` once
that password is in hand). A real org + organiser login were provisioned directly (see
CHANGELOG.md's dated entry) — credentials given to the user in chat, not committed
anywhere. Local dev still defaults to the local stack (`npm run supabase -- start`,
Studio at `http://127.0.0.1:54423`) — nothing about local dev changed.
Current phase: check `ROADMAP.md`.
