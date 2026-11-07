# Backlog: Cup Taster and pre-event hardening

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from T-HARDEN.results-sheet (Cup Taster public results sheet)

- **Published figures come from the report as loaded when the page was opened**
  (hint says reload first; Update does not re-fetch) and a retroactive 'withdrawn' flag
  changes a published result on the next Update.
- **Order of tied rows within a tie is not meaningful.**
- **The sheet downloads every published payload to show one** (fine at current size). **CLOSED (triage 2026-11-07):** the sheet now reads only its own event's row by id via `findPublishedResultForEvent(eventId)` (src/marketing/resultsSheet.js:350-357, src/core/publicResults.js:53-62).
- **The shared public header's brand link is under 44px tall** (pre-existing). **CLOSED (triage 2026-11-07):** `.public-header-brand` now has `min-height: var(--tap-target-min)` (44px) (src/marketing/publicHeader.css:21-27; CHANGELOG 2026-10-H1 "44px brand link").
- **No test feeds the real `buildResultsPayload` output into `buildResultsSheet`**
  (payload keys are duplicated as fixtures — the key set is pinned on both sides) and
  `resultsMain.js`'s `?sheet=` routing has no test.
- **'/results/' is still noindex and not in the sitemap** (separate decision).
- **The user still must republish the live event** (currently podium-only) after this
  ships if they want the sheet to include everyone.

---

## Known open items carried into Phase 4 (Cup Taster)

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

- **T6.hardening.a11y — Cup Taster organiser screens focus-loss on state change, PARTIALLY CLOSED
  (2026-09-15).** Same WCAG 2.1.1 focus-management gap across three screens — every `render()`
  does a full `root.innerHTML = ''` teardown-and-rebuild, dropping focus from `disabled` controls
  to `<body>` with no restoration — was closed (2026-09-15) for `src/core/loginScreen.js`,
  `src/community/guess-the-bean/authScreen.js`, and `setupScreen.js` via new reusable helpers
  (`setBusyDisabled()` and `withFocusPreservation()` in `core/dom.js`, plus updated CSS rules
  for `[aria-disabled='true']`). Four reviewers (code-reviewer, test-auditor, module-boundary-checker,
  ui-accessibility-reviewer) all signed off clean after fixes. Identical bug pattern remains
  live (unfixed, deliberately) across the rest of the Cup Taster organiser suite: ~24 `.disabled =`
  assignments in `eventsScreen.js`, `heatsScreen.js`, `rosterScreen.js`, `scoringScreen.js`,
  `standingsScreen.js`, `timingScreen.js`, `timingManualScreen.js`. Spawned as a separate
  follow-up task (not yet started) prioritizing the judge-facing, tap-under-time-pressure surfaces
  (timingScreen, timingManualScreen, scoringScreen) over the organiser-setup surfaces. See
  CHANGELOG.md's 2026-09-15 entry for the full account. Flagged by: `ui-accessibility-reviewer`
  (multiple Phase 2/3 reviews, addressed cross-module 2026-09-15).

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
  if a self-serve org-setup flow is ever needed. **SUPERSEDED (triage 2026-11-07):** the operator's admin console now creates organisations and adds/changes members through `admin_*` RPCs (supabase/migrations/20261014130000_admin_write_rpcs.sql; src/admin/; CHANGELOG-INDEX "T-ADM cloud rollout").
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
- **`anon`'s TRUNCATE/REFERENCES/TRIGGER/MAINTAIN grant on every table — CLOSED 2026-09-25.**
  Migration `20260925090000_revoke_excess_table_privileges.sql` revoked these from `anon` and
  `authenticated` on all 19 affected tables + the `ct_standings` view, and `alter default privileges`
  so tables created by later migrations do not receive them again. PostgREST never issues TRUNCATE,
  and no API-reachable path exists, so was not exploitable; this is defense-in-depth. Applied to
  the cloud project 2026-09-25. See CHANGELOG.md for the full account.
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

## Known open items from pre-event hardening (T-HARDEN.nav-hamburger-breakpoint, 2026-09-29)

_Deferred findings from T-HARDEN.nav-hamburger-breakpoint, now closed by T-HARDEN.nav-menu-polish._

- **CLOSED (2026-09-29, T-HARDEN.nav-menu-polish): Open menu at tablet widths is now a wrapping
  row instead of a full-width stack.** At 640–1365px, the open panel wraps as a flex row (nav
  links left, auth cluster right via margin-left:auto). Measured at 900px: panel height reduced
  from ~250px to ~61px, compact sticky header across tablet widths.

- **CLOSED (2026-09-29, T-HARDEN.nav-menu-polish): Focus preserved when viewport crosses 1366px
  with menu open.** A matchMedia('(min-width: 1366px)') listener closes the menu and relocates
  focus: link/Sign out → toggle when collapsing, toggle → first nav link (fallback: Sign out)
  when expanding inline. Focus no longer drops to body. Verified in real Chromium.

- **CLOSED (2026-09-29, T-HARDEN.nav-menu-polish): Toggle now has visible 'Menu' label from 640px
  up.** Label spans `.app-shell-nav-toggle-label` (aria-hidden) with icon, matching button's
  aria-label (WCAG 2.5.3 label-in-name). Phone (<640px) remains icon-only. Inherits color and
  font from button.

- **CLOSED (2026-09-29, T-HARDEN.nav-menu-polish): Router-level test for screen switching
  (projector/phone/splash) over shared root now exists.** New `src/main.audienceRoutes.test.js`
  tests real router mount/unmount order: projector→phone→splash→projector and splash→phone
  →projector. Verifies one-child, no "Connecting…", channel cleanup, no stale unmounts. Mutation-
  verified to catch unmount-first order and missing channel release.

---

## Known open items from pre-event hardening (2026-09-26)

_Deferred findings from T-HARDEN.outbox-transient, flagged and documented but not blocking the 4 Oct
Cup Taster event._

- **CLOSED (2026-09-27, branch `fix/btc-event-delete-fk`): BTC event deletion now succeeds; constraint collision fixed.**
  A BEFORE DELETE trigger on events calls a new `app.btc_delete_event_children()` function
  to clear btc_bracket_slots and btc_matches before their RESTRICT foreign keys block the
  cascade. Direct deletion of a real BTC event now works (matching Cup Taster semantics);
  test-event deletion via `delete_test_event` still refuses real events. Cascades now log
  score_change_log rows for the event's matches and slots (extra history, documented change).
  Migration pending cloud-project push via Supabase MCP. See CHANGELOG.md for full account.
  Flagged by: `schema-guardian`, `security-reviewer`, `test-auditor`, `code-reviewer`.

- **CLOSED 2026-10-11 by T-TEN.B6** (`20261011130000_tenancy_resolver_disclosure`, in the cloud; `app.org_id_for_event` returns NULL for a non-member and `034_resolver_disclosure.sql` asserts a stranger gets the same 'not found' whether the org id is true or wrong; checked again 2026-11-02). Original finding: **`delete_test_event` leaks which org owns an event (pre-existing, found by
  `security-reviewer` during T-HARDEN.btc-event-delete-fk).** Not an RLS bypass — nothing is
  deleted or read. A non-member passing an event's true org_id gets a silent success (RLS
  hides the row, so the is_test refusal never fires and the DELETE matches 0 rows), while a
  wrong org_id raises "not found" — contradicting the RPC's own "not found and not yours are
  indistinguishable" claim. Separately, `app.org_id_for_event` is callable by any
  authenticated user and returns another org's id. Track as its own task.

- **No attempt cap / discard for an operation that stays transient forever (persistent 429/503).**
  A persistent rate limiter or service overload stays classified as transient (will retry forever).
  By design, now reachable via more outbox paths. Not a data-loss defect — the operation never
  leaves the queue — but an organiser with a stuck operation has no manual discard path except
  editing the browser's IndexedDB directly. Flagged by: `code-reviewer`.

- **P0002 → HTTP 500 mapping not verified against a live stack.** The fix relies on PostgREST's
  documented error-code mapping, not empirical verification (Docker off this session). One-off
  check once Docker is up. Flagged by: `test-auditor`.

- **CLOSED (2026-09-27, PR #127): `publish_live_session` read-chain errors are now classified.**
  The read path errors are wrapped in `buildPayloadOrClassify`: PGRST116 on a test event is
  a no-op success (nothing to publish), on a real event is permanent + reported (RLS/wrong
  account). Network/timeout/expired JWT/transient SQLSTATE: retryable. Everything else:
  permanent. Flagged by: `offline-sync-auditor`.

- **Lost-write report persists per tab via sessionStorage (2026-09-27), but lost when the tab
  closes, invisible to a second console tab, and there is no Acknowledge control.** The count now
  survives a reload of the same tab — and usually the browser restoring a tab the OS discarded
  (common on venue phones and tablets) — instead of losing the only record. A device restart or a
  closed tab still clears it. Still open: persisting
  across tab close (IndexedDB), cross-tab visibility (BroadcastChannel relay), and acknowledging
  the notice (explicit-dismiss button). Also open: sticky inflation — a rehearsal morning's stray
  drops accumulate and show as "N writes lost" all day (runbook: re-open in a fresh tab); a
  duplicated tab copies the count. Full fix: persisted IndexedDB list with explicit Acknowledge,
  which should REPLACE the sessionStorage key (not sit beside it). The sticky count can't be
  cleared after a successful retry, and an enqueue failure on a loud caller (confirm/tap/resolve)
  is reported by the screen AND as a sticky lost write, each failed retry adding one. Also still
  open: sign-out in the same tab keeps the notice (documented as deliberate, untested). Flagged by:
  `offline-sync-auditor`, `ui-accessibility-reviewer`.

- **Lost-write notice doesn't name the operation type.** The data now exists (2026-09-27): the
  onOperationDropped listener receives the operation (with `type`) and flush results carry
  `dropped[].type` — only the panel doesn't render it yet. Render it via `operationLabels`, so a
  dropped live-view publish doesn't read the same as a lost heat confirm. Flagged by:
  `offline-sync-auditor`.

- **360px/200% zoom/screen-reader verification of lost-write pill not done.** Playwright run
  needed. Flagged by: `ui-accessibility-reviewer`.

- **A permanently-dropped `publish_live_session` still shows the sticky "1 write lost" notice**
  on reconnect, though the next publish rebuilds everything. Product decision: should
  live-view publishes count as lost writes for the outbox report? Flagged by: `code-reviewer`.

- **CLOSED (2026-09-27, branch `fix/screen-flush-drop-reporting`): Every permanently-dropped operation now reaches the sync panel.**
  core/outbox.js onOperationDropped announces every drop; appShell holds rendering with "Not synced"
  until the flush ends (capped 5s), covers every flush caller (scoringScreen, standingsScreen,
  timingScreen, main.js, BTC). Dropped live-view publishes now count as lost writes (no later repair
  trigger). See CHANGELOG.md for full account. Flagged by: `offline-sync-auditor`.

- **Misattribution in remaining screens** (post-screen-flush-drops, lower impact now every drop reaches
  panel): scoringScreen/standingsScreen (Cup Taster) and btc/scoringScreen still render the whole flush
  error rather than droppedErrorFor. Confirm/commit paths need to return operationId. Flagged by:
  `self`, `code-reviewer`, `test-auditor`.

- **Drop announcements are same-tab only.** A drop in organiser tab A leaves tab B green 'Synced';
  B's own dropped tap shows only 'not synced yet'. Fix: BroadcastChannel relay deduped by operation id
  (no-Web-Locks fallback can drop the same op in two tabs). Flagged by: `offline-sync-auditor`,
  `ui-accessibility-reviewer`.

- **Pre-existing: if listPendingOperations fails, refreshSync keeps the last state (may show green
  'Synced').** Flagged by: `offline-sync-auditor`.

- **CLOSED (2026-09-27, branch `fix/sync-panel-360-no-shift`): At 360px the sticky header no longer grows when the lost-write notice appears.** The sync status now sits in its own full-width header row at every width, with min-height reserved for the tallest notice (two lines below 1024px, one above). Measured with the real header and worst-case text: header constant at 320/360/640/800/1024/1280px across all status states; Stop buttons never shift. See CHANGELOG.md for full account. Flagged by: `ui-accessibility-reviewer`.

- _(Superseded 2026-10-08: the reserved row is gone, see T-HARDEN.header-sync-chip.)_ **At 200% text/zoom the reserved header still takes ~55–73% of a phone viewport.** Not a WCAG 1.4.4 failure (no content is lost), but a real usability problem for a low-vision judge. Fix: un-stick the sync row or cap with max-height below a viewport-height threshold. Flagged by: `ui-accessibility-reviewer`.

- **Residual 3-line wraps at 320px with 130% text and Verdana.** The shortened wording still wraps to 3 lines at 320px with 130% text, and with Verdana at 130%. Primary target (360px, Hanken self-hosted) holds at 2 lines. Flagged by: `ui-accessibility-reviewer`.

- **Reserve sized for the current longest operationLabels entry.** The reserve is fitted for "publishing to the live view"; a future format adding a longer label silently re-opens the 360px shift. Re-measure when adding labels. Flagged by: `code-reviewer`.

- **No automated browser height check.** A dev-harness page (mountAppShell + fake client + status drivers) and a Playwright spec asserting constant header height at 320/360/1024px would pin the measurement against accidental drift. Flagged by: `test-auditor`.

- _(Superseded 2026-10-08: the reserved row is gone, see T-HARDEN.header-sync-chip.)_ **Header is always ~29px (phones) / up to ~50px taller on event screens from the start.** "Synced" sits centred in the reserved row. Accepted as the price of zero shift mid-heat. Flagged by: `ui-accessibility-reviewer`.

- **Lost and stuck wording is inconsistent.** The same loss is worded two ways: "1 write lost — not saved and not retried" alone vs "1 write lost, not retried; …" with a stuck op. Unify on the short form (touches many test expectations; re-measure). Flagged by: `ui-accessibility-reviewer`.

- **Combined notice reads as final rather than retrying.** "…; publishing to the live view failed" lacks a "retrying" cue, so the organiser reading it thinks the retry has stopped, though it's still running (pre-existing). E.g. "…failed, retrying" — must still fit two lines at 360px; re-measure. Flagged by: `ui-accessibility-reviewer`.

- **Off → active announcement risk.** Switching the wrapper from `display: contents` to `flex` in the same task that fills the text may not announce the content appearing. Browsers building AT objects from layout frames may miss the first frame. Unverified without NVDA+Firefox / VoiceOver+Safari; timing/scoring screens are never 'off'. Flagged by: `ui-accessibility-reviewer`.

- **Older appShell tests mount shells without unmounting, leaking drop listeners/intervals** across
  tests. Harmless to current assertions. Flagged by: `offline-sync-auditor`.

- **The tap 'saved, not synced yet — don't tap again' message uses the danger 'error' tone** (no
  pending/warning tone), and the row still shows an enabled Stop button the message says not to tap.
  A row-level 'Pending sync' state would be sturdier. Flagged by: `ui-accessibility-reviewer`.

- **A tap dropped by another tab's flush still shows 'saved… don't tap again' here** (same-tab
  listeners; see the cross-tab drop-announcement entry). Flagged by: `ui-accessibility-reviewer`.

- **timingScreen.test.js 'announces once' under countdown-urgent-threshold failed once under load,
  then passed 3/3.** Real 1s interval timing; looks like a pre-existing flake. Flagged by: `self`.

- **Pre-existing: two refreshSync calls can resolve out of order,** so an older stuck-operation suffix
  briefly overwrites a newer one (never green — lastFlushError wins). A requestSeq guard like
  viewer-shell.js would close it. Flagged by: `offline-sync-auditor`.

- **Latent production hang in core/db.js withStore:** tx.onabort/onerror/oncomplete attached only
  after `await fn(store)`, so a transaction completing before await resumes never settles the promise.
  Attach handlers before awaiting the request. Flagged by: `test-auditor`.

- **timingScreen.test.js (file-wide, pre-existing): document.body.removeChild(root) not in a finally,**
  so one failing test leaves its root attached and cascades into later focus/activeElement assertions.
  Sweep with an afterEach that clears document.body. Flagged by: `test-auditor`.

- **Non-JSON 4xx gateway body (no `code` field) on a read is treated as transient** by the
  read classifier since read helpers drop HTTP status. Real fix: carry HTTP status through
  the read helpers. Flagged by: `code-reviewer`.

- **postgrest-js retries GETs 3× (1/2/4s each) up to the 30s timeout — one stalled read
  can hold a flush ~2 min.** Consider `retry: false` on the read or a read-chain total
  timeout. Flagged by: `offline-sync-auditor`.

- **CLOSED (2026-09-27, branch `fix/lost-write-persistence-and-delete-guard`): Deleting a test event now warns about unsynced writes.**
  Clicking Delete reads `countPendingOperations()` (bounded at 2s; a failure or hang shows
  "Couldn't check") before the Confirm step renders, showing how many writes on this device
  haven't synced yet. If non-zero, the
  warning notes that deleting now can make them "show as lost on the sync panel until this tab is
  closed" and advises canceling, waiting, and re-clicking Delete to re-check. Warns rather than
  refuses because leftovers for a deleted event can never sync back — refusing would block the
  delete forever. See CHANGELOG.md for full account. Flagged by: `offline-sync-auditor`.

- **Delete warning's count is a snapshot, shared across rows.** It's read once per Delete click
  and doesn't update while the confirm step is open (the wording tells the organiser to re-click
  Delete to re-check); it counts the whole device's queue, not the one event's. Flagged by:
  `code-reviewer`, `offline-sync-auditor`.

- **A poison operation keeps the delete warning's count above zero forever.** "Wait, then click
  Delete again" then repeats indefinitely and the organiser deletes through the warning. Runbook:
  if the count doesn't drop after a wait, check the sync panel for a failed operation before
  deleting. Flagged by: `offline-sync-auditor`.

- **No visible state while Delete checks for unsynced writes** (normally milliseconds, capped at
  2s). Add a "Checking…" label like the existing "Deleting…" if slow IndexedDB opens show up in
  practice. Flagged by: `ui-accessibility-reviewer`.

- **CLOSED (2026-09-29, branch `harden/viewer-shell-channel-topic`): Navigating between audience views in one tab no longer stuck on "Connecting".**
  Fixed by per-mount channel topic `live_sessions:${orgId}:${mountSeq}` (module-level counter);
  channel reuse within a tab never happens now. Callbacks guarded with `!mounted` so a leaked
  channel stays inert. See CHANGELOG.md for full account. Flagged by: `code-reviewer`, `test-auditor`,
  `module-boundary-checker`.

- **Viewer-shell hardening: edge cases deferred (low-priority, not blocking).**
  unmount() would throw if a stub client's removeChannel threw synchronously (supabase-js is async,
  unrealistic); double unmount() calls removeChannel twice (pre-existing, router unmounts once);
  splash screen doesn't use viewer-shell (was not in the reproduction). Production verification
  complete (2026-09-29): projector ↔ phone ↔ splash ↔ projector in one tab all render correctly,
  no console errors, fix confirmed in live environment.

- **Test Cupper rows deleted from people table (2026-09-29).** Three 'Test Cupper A/B/C' rows
  (fake phones +6738000001-3) were deleted at the user's request on 2026-09-29 after a "Prod Smoke
  Test" is_test event was deleted via the app's Delete button. People table count: 25 → 22, no
  'Test Cupper' rows remain. Cleanup complete per user decision.

- **T-HARDEN.resolve-stage-concludes-event — closed, deferred items (2026-10-04).** The first live
  event ran end-to-end (3 complete stages, 8 confirmed heats, 169 results) but `events.status` stayed
  `'draft'` because nothing ever wrote it. Migration `20261004100000_resolve_stage_concludes_event.sql`
  makes `resolve_stage`'s terminal branch (null next stage and a null-cutoff stage) set it to
  `'concluded'`, with a backfill. Deferred: **(1)** `'running'` is never written (nothing reads
  `events.status` yet); **(2)** re-opening a completed final won't revert `'concluded'`; **(3)** optional
  hardening so "terminal" also requires no higher-ordinal stage; **(4)** no test for replaying the
  champion call after conclusion; **(5)** the event's `live_sessions` row stays `active = true` until the
  organiser deactivates it. See CHANGELOG.md for the full account.

---

## Known open items from T-HARDEN.correct-heat-time (2026-10-06)

_Deferred findings from T-HARDEN.correct-heat-time, flagged and documented, not blocking._

- **Deploy:** push migrations `20261006100000` then `20261006110000` to the cloud project (apply_migration, then list_migrations) before or with the release to `main`; without them every correction call fails permanently. **CLOSED (triage 2026-11-07):** Both migrations are in the cloud: the T-ID.Z reconciliation found 93 repo migrations and 93 cloud migrations matching name for name (CHANGELOG entry "Seduh ID Layer 1 closed out: C4 wording drafts and T-ID.Z verification").
- **Modal or bottom-sheet editor** — editor is 314px tall at 360px; pushes later Stop buttons down; ship compact version first, build modal later.
- **Correction handler copied in three screens** — ~45 lines per screen; extract to shared handler.
- **Save in flight when another action re-renders** — busy editor not carried over; covered by test on scoring screen only (not timing/manual).
- **Test fidelity** — the stateful fake does not mirror the RPC's reason/duration validation or `confirm_heat`'s completeness check; the failed-reload and in-flight-save cases are covered on the scoring screen only.
- **Correction compare-and-set on elapsed only** — ABA scenario (200→150→200 lets stale edit through).
- **No-raw-elapsed-write lint rule cannot see payload keys** — same gap as `record_heat_time`.
- **Reason blank-space edge case** — non-breaking or zero-width spaces count as non-blank.
- **'Waiting to sync' per-device** — IndexedDB outbox is per-device; fails safe through the compare-and-set.
- **`confirm_heat` org comparison** uses `<>` and gives different messages for 'not found' and 'does not belong' — a weak existence oracle (pre-existing).
- **Pre-existing: scoring screen 'Cuppers' card overflow at 360px** — very long competitor names; not part of this task.

---

## Known open items from T-HARDEN.projector-redesign (2026-10-08)

_Deferred findings from T-HARDEN.projector-redesign, flagged and documented, not blocking._

- ~~Result reveal + rank-change screens~~ — built 2026-10-09 (T-HARDEN.projector-moments, below).
- **Podium after a top tie:** omitted unless places 1-3 are each held by exactly one cupper; carrying `finalPosition` on the standings rows would allow "2nd" after a tiebreak (scoring-auditor: small, additive, rare).
- **Real-venue check:** look at the display on the real projector from the back of the room, and on the iPad (`dvh` with the toolbar showing); tune type sizes if needed (one `--stage-unit`/`--stage-fit` per file).
- **Pre-existing, found by the boundary review:** `formats/cup-taster/timingScreen.js` still runs its own countdown tick, urgent threshold and one-shot announcements instead of `core/countdownDisplay.js` (the math is shared via `core/countdown.js`); `timing.js` re-derives elapsed seconds the same way. Unify when next touching the organiser timing screen.
- `projectorScreens.js` reads `cupperStatus`/`showsCountdown`/`isNoClockHeat` from the PHONE's `viewerBody.js` (intra-format, fine); they belong in a small format rules module. The idle loop's page assembly and "skip a republish with nothing changed" signature would be copied by a second format (a core primitive candidate).
- `core/stageBody.js`/`stageDisplay.js` take no `countdownDisplay` hooks; `countdownDisplay.js` uses a real `setInterval`/`Date.now` (not injectable like the ring and director).
- **Hold/pause for the organiser**, sponsor interstitials, an "ambient" idle variant: not built (the user chose fully automatic).
- The held "being scored" card keeps its footer from the payload that started it for up to 8 seconds (cosmetic).
- The idle loop restarts at page 1 whenever the standings change; pages are not balanced (a last page can hold one row).

---

## Known open items from T-HARDEN.team-restore (2026-10-08)

_Deferred findings from T-HARDEN.team-restore, flagged and documented, not blocking._

- **Pre-migration removals:** people removed before the migration are not listed and cannot be restored; insert a `team_removed_members` row by hand for any that matter (which org, who removed them).
- **Marker expiry:** markers never expire; add a TTL if teams grow (also the one-time password's own missing expiry, from T-HARDEN.team-accounts).
- **Sessions:** restoring (like Reset password) does not revoke the person's existing sessions.
- **No Retry** on the removed list's "could not be loaded" text (the page must be reloaded).
- The two-session race on the restore's row lock cannot be proven in pgTAP (single session); it is covered by the advisory lock and by reasoning.

---

## Known open items from T-HARDEN.header-sync-chip (2026-10-08)

_Deferred findings from T-HARDEN.header-sync-chip, flagged and documented, not blocking. This supersedes the two 2026-09-27 items about the reserved header row below (the row is gone)._

- **200% text-size scaling at tablet width (768px):** the header grows ~112px when a long chip ("123 writes lost") appears and wraps. Consider shortening the chip or letting the event name give way earlier.
- **Chip and panel placement:** at 360px the Tab order is brand, chip, Menu while the chip sits visually on the second row; the open panel is anchored to the header's bottom edge, so with the nav menu open it can sit far from its chip (consider closing the menu when the chip opens).
- **Event name truncation at 1366px** happens even with room to spare (the breadcrumb shares the leftover with the chip).
- **Forced-colors mode:** the Menu button's three bars (background fills) vanish.
- **Flaky e2e:** "keyboard focus survives crossing the 1366px breakpoint" fails on the first run after other activity and passes on re-run (also on the unchanged code); find the timing.
- The brand-lockup item "check the header lockup on the real iPad / Safari" is **done** (user confirmed, 2026-10-08).

---

## Known open items from T-HARDEN.brand-lockup (2026-10-08)

_Deferred findings from T-HARDEN.brand-lockup, flagged and documented, not blocking._

- **Check the lockup on the real iPad / Safari:** the mark's baseline alignment is verified in Chromium only (WebKit's flex baseline for a replaced element has differed historically). Console header, public header, phone chrome.
- **200% text size:** the public/landing header grows ~56px because the lockup now scales with text size; decide whether to cap it.
- **Splash screen** still builds its stacked mark-above-wordmark by hand (`splash-mark`, `splash-wordmark`), and the timer / brew-planner headers show the mark alone: fold into `brand.css` if a stacked or mark-only variant is wanted.
- **Optical weight:** the console wordmark is lighter than before (18px Chakra Petch vs 21px Hanken); adjust `--brand-lockup-size` on `.app-shell-brand` if it feels small.
- **Phone chrome at 320px / 200% text (pre-existing):** the wordmark shrinks to a single letter beside the "NOT LIVE" badge; let the badge shrink or wrap.

---

## Known open items from T-HARDEN.heats-roster-fold (2026-10-08)

_Deferred findings from T-HARDEN.heats-roster-fold, flagged and documented, not blocking._

- **Many-heat events** may still be a long scroll: fold confirmed heats to one line, heat jump chips, and two columns on wide screens were offered and not chosen. Revisit after the next live event.
- **Sticky header covers a focused link at 200% zoom** — add `scroll-padding-top: var(--app-shell-header-height)` once at the shell level (affects every screen, not just this one).
- **A "Roster" heading no longer exists once heats exist** (fold-out summary instead); acceptable, revisit if screen-reader users miss it.
- **200% root font-size makes the heats page ~14px wider than the viewport** (pre-existing; source not isolated).
- **Check on the real iPad** that the Up next button and the fold-out feel right with touch.

---

## Known open items from T-HARDEN.team-accounts (2026-10-08)

_Deferred findings from T-HARDEN.team-accounts, flagged and documented, not blocking._

- **Deploy:** migration `20261007120000` to the cloud project, then the `team-accounts` Edge Function (`verify_jwt` true), then release; check `select role, count(*) from org_members group by 1` before pushing.
- **Re-adding a removed member** is impossible with the same email (account kept → 409). A "restore" path needs a marker only the function can set (e.g. `team_removed_org` in `app_metadata`) and a `team_restore_member` service-role function.
- **One-time passwords never expire** and the must-change flag is user-editable: add a TTL / server-side check at sign-in if teams grow.
- **Owner-recovery:** no promote/demote function; an org that loses its only owner needs SQL. **CLOSED (triage 2026-11-07):** `org_set_role` (service role) promotes or demotes a member and a trigger refuses to leave an org with no owner (supabase/migrations/20261011120000_tenancy_last_owner.sql).
- **Function hardening:** rate limit / body-size cap; align the server's `minimum_password_length` (6) with the screen's 8; consider proof of email ownership (an emailed confirmation) if/when SMTP exists.
- **Nav focus:** the Team link arriving asynchronously rebuilds the nav and can drop focus from a link the keyboard user is on.
- **Check on the real iPad** that the Team screen, the copied one-time password and the choose-a-password screen behave (keyboard, autofill, paste).
- **A third copy of the Show/Hide logic** does not exist yet; `src/community/guess-the-bean/authScreen.js` has no toggle. If it grows one, use `dom.passwordToggle`.

---

## Known open items from T-HARDEN.login-hardening (2026-10-07)

_Deferred findings from T-HARDEN.login-hardening, flagged and documented, not blocking._

- **Check on the real iPad** (Safari, desktop-site mode): Show/Hide with the keyboard up, autofill from iCloud Keychain, and signing in with a password pasted with a trailing space.
- **Root cause of the 4 Oct failure is unconfirmed**; the auth logs only keep 24h and never record what was typed.
- **Shared login is still the real problem** — per-person accounts are the team-accounts task (owner-managed, one-time password).
- **Pre-existing: `setBusyDisabled` only sets `aria-disabled`/`aria-busy`**, so Sign in (and the new toggle) can still be activated while a sign-in is in flight; the `signingIn` guard stops a second request.

---

## Known open items from T-HARDEN.roster-edit (2026-10-07)

_Deferred findings from T-HARDEN.roster-edit, flagged and documented, not blocking._

- **Deploy:** push migration `20261007100000` to the cloud project (apply_migration, then list_migrations); without it every roster Save fails. **CLOSED (triage 2026-11-07):** The migration is in the cloud: the T-ID.Z reconciliation found 93 repo migrations and 93 cloud migrations matching name for name (CHANGELOG entry "Seduh ID Layer 1 closed out: C4 wording drafts and T-ID.Z verification").
- **Last write wins** between two organiser devices — optional `p_expected_updated_at` check against `people.updated_at` if it ever matters.
- **Phone uniqueness depends on client-side normalisation** (same as `registerPerson`); a format check or normalisation in the RPC would close it.
- **Pre-existing: `people_write` lets a two-org member move a person to another org** — a trigger on `people.org_id` would close it if multi-org users become real. **CLOSED (triage 2026-11-07):** `trg_people_org_immutable` now freezes `people.org_id` (supabase/migrations/20261011100000_tenancy_org_id_immutable.sql:33, asserted by supabase/tests/033).
- **No audit row for name edits** after an event is published; dispute pack and results read the entry's name.
- **`service_role` grant on `update_roster_entry` is unused** — drop for least privilege.
- **`describeRosterEditError` lives in the Cup Taster screen** — move to core if another format adds roster edit.
- **Escape and Cancel discard typed text without confirmation**; a tap on a parked Edit gives no feedback (accessibility, low).
- **Test fidelity** — the stateful fake does not model the org-ownership check or the `unique_violation` race branch (two real sessions would be needed).

---

## Known open items from pre-event hardening (T-HARDEN.report-print-layout, 2026-10-06)

_Deferred findings from T-HARDEN.report-print-layout, flagged and documented, not blocking._

- **Chart print labels scale down with chart width;** events with many cuppers/rounds get smaller labels, not compensated.
- **14px print axis labels could overprint for events with very few cuppers.**
- **Accuracy tiers and chart bars rely on colour plus printed numbers/legend order in black-and-white print.**
- **`@page` is global, not report-only** — applies to every organiser-print surface, not just the report.
- **Very long names wrap rather than truncate in print.**
- **Edge system print dialog 'Print To PDF' output is image-only** (Edge's Save as PDF gives a text PDF); browser/OS behavior, not fixable here.

---

## Known open items from T-HARDEN.projector-moments (2026-10-09)

_Result-recorded and rank-impact screens shipped; these were flagged and documented, not blocking._

- **Real TV check of the moments:** the projector's ordinary screens were checked on the game-day 55-inch TV; the result and rank screens have not been seen there yet.
- **Moments lost to a running heat:** a snapshot that already shows a running heat is not mined for moments (`core/momentPlayer.js` header). If the confirm of heat N and the start of heat N+1 reach the projector as one snapshot, the room gets no result screen for N. Revisit by detecting on urgent snapshots too and holding the queue until the urgent screen ends, if it is seen on a real event.
- **Out-of-order confirmations:** the venue payload's `recentHeats` is the three newest confirmed heats in running order; a heat confirmed below those is not announced.
- **"Played" before "confirmed":** `ct_standings` carries a time from the moment a timer stops, so with two heats in flight a stopped-but-unconfirmed cupper already counts as ranked and can show as "New" early. Needs a confirmed-based signal in the payload.
- **Phone "Recent results" does not say "Max time"** for a timed-out entry (the payload now carries `maxed`; the venue result screen uses it).
- **Extract the rest of the venue vocabulary when a second format's projector is built** (the project's second-use rule): `kicker`, `bigTitle`, the station/result card and the standings table in `projectorScreens.js`/`.css` are Cup Taster's today (`projector-*` classes); the idle screen's ring wiring duplicates `mountFooterRing`. **CLOSED (T-BTC.venue-vocabulary, 2026-10-09):** the kicker, title, standings page, champion block and the idle loop moved to `core/stageVocabulary.js` and `core/stagePageLoop.js` (classes `stage-*`). The station/result card, the heat and up-next screens, the tie words and the podium and score lines stay Cup Taster's on purpose (their meaning is Cup Taster's and BTC's cards differ: a two-sided match card, not a station); a third format that needs a card grid or the compact many-item layout should extract them then. The idle loop's ring now goes through `mountFooterRing` (one ring mount).
- **Every moment pre-empts a held page** mid-read, and the idle loop restarts from its first page afterwards — accepted for news; a "resume the page" option is possible.
- **No screen-reader announcement** for the moments (a TV surface; the phone view carries recent results as text). A polite `sr-only` line per moment is the option if parity is wanted.
- **Rank rows beyond eight** are summarised as "+N more"; a very long tie at the edge of the top five is not listed in full.

---
