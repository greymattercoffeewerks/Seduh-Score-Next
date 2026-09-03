## Feature: mid-heat manual-entry fallback for app-mode timing · 2026-09-04

**Closes ROADMAP.md's "T4.3's app-mode timing screen has no manual-entry fallback for a
mid-heat device failure"** — the frozen spec (§7.1) describes a heat that "may mix
tapped and hand-entered times if a stopwatch fails mid-heat." Read literally this only
makes sense as a recovery path inside an app-mode heat still in `timing` status (a
manual-mode heat, by construction, never has any tapped entries to mix with): the
organiser's own device is what runs the tap interface, so if it fails — or a specific
cupper's clock genuinely can't be reached — mid-heat, that one entry now gets a
hand-typed time while every other cupper keeps timing normally by tap.

**The feature**: each unstopped row in `timingScreen.js` gained an opt-in "Enter time
manually" toggle next to Stop — a purely local DOM show/hide (`element.hidden`, no
`render()`) so opening it never interrupts the live countdown or triggers a network
reload. Toggling reveals the same minutes/seconds input pair `timingManualScreen.js`
already used, reusing `recordManualTime()` and the exact `pendingEntryCheck`
ground-truth-vs-flush machinery `recordTap`'s own Stop path already established —
success/conflict messaging behaves identically regardless of which path recorded the
time. `parseElapsedInput`/`secsToParts` moved from `timingManualScreen.js` into
`timingManual.js` (pure logic, no DOM) so both screens can import them without either
importing from the other (`timingManualScreen.js` already imports `renderTimingRows`/
`buildScoringLink` from `timingScreen.js` — the reverse direction would have cycled). A
new shared `renderManualTimeFields()` lives in `timingScreen.js`, same reasoning as the
existing `buildScoringLink` (no DOM in `timing.js`/`timingManual.js`); it replaces the
input-pair-building code `timingManualScreen.js`'s own `renderManualEntryRows` used to
duplicate inline, once this became the 2nd use.

Live-verified in the browser: one cupper tapped, another hand-entered, in the same
still-running heat — the exact scenario the spec names — plus a dedicated integration
test proving it. A 360px pass caught a real regression before the review round even
started: `.timing-row`'s `justify-content: space-between` squeezed a long cupper name
down to 2-3 characters once the wider two-button actions area was added; fixed with
`flex-wrap: wrap` so the whole actions block drops to its own line instead of fighting
the name for space. Also needed a `.timing-row-actions [hidden] { display: none; }`
override — `.btn`'s own `display: inline-flex` beats the bare `[hidden]` UA rule at
equal specificity, the same class of bug this project already hit once for
`.status-live-dot` (`splashScreen.css`).

**A five-reviewer round found one HIGH-severity data-corruption bug and several real
UX/accessibility gaps — all closed before ship:**

- **`scoring-auditor` (HIGH)** — traced the actual RPC SQL and outbox-flush ordering,
  not just the JS, and found that reusing `record_heat_time`'s existing `'overwrite'`
  conflict policy broke a safety invariant that held only in its ORIGINAL context.
  `'overwrite'` was designed for exactly one caller (`timingManualScreen.js`'s
  judge-fixing-a-typo workflow, on manual-only heats where nothing else could ever write
  that row) — reused from this new app-mode fallback, a real tap and a manual guess for
  the SAME cupper can both get queued offline (this app's own outbox model) and flush in
  either order. Tap-then-manual is the dangerous order: the manual write's `'overwrite'`
  policy silently clobbered the accurate, already-committed tapped time with a
  hand-typed guess, raised no conflict, and the client's own ground-truth check reported
  false success — a genuinely live, offline-plausible corruption path for a set that
  will be ranked, not a hypothetical. Manual-then-tap was already safe (the tap's own
  `'reject'` policy already refused to clobber an already-set entry regardless of
  source), so only the one direction needed closing.

  **Fix**: new migration `20260904120000_record_heat_time_overwrite_scoped_to_manual.sql`
  — `record_heat_time` now reads the entry's CURRENT `time_source` before honoring
  `'overwrite'`, only allowing it when the entry is unset or already `'manual'` (a
  genuine self-correction — the only case `'overwrite'` was ever meant to cover).
  Overwriting a `'tapped'` or `'maxed'` entry via `'overwrite'` now raises the SAME
  conflict shape `'reject'` already used (`'CONFLICT: heat entry % already has a
recorded time'`, errcode P0002) — deliberately reusing that exact message so
  `describeTimingConflict()` already classifies it correctly client-side with zero JS
  changes. Function signature unchanged, so no grant/revoke statements needed. Verified:
  applied locally via `supabase db reset` (clean from empty, 15 migrations), 3 new
  pgTAP assertions (`007_timing_outbox_rpcs.sql`, plan 39→42) proving the refusal and
  that both `elapsed_secs` and `time_source` stay untouched, rollback block run for real
  in a `begin;...rollback;` transaction (confirmed it genuinely restores the OLD,
  vulnerable behavior, then rolled back, then re-confirmed the fixed version via a full
  pgTAP re-run). `schema-guardian` independently confirmed the fix correctly refuses
  BOTH `'tapped'` and `'maxed'` (not just tapped) and diff-checked the rollback against
  the actual prior live function body (byte-for-byte identical). `security-reviewer`
  came back fully clean — authorization/org-scoping untouched and still runs before the
  new logic, no new TOCTOU gap (the new read shares the same post-lock `select` the
  existing reads already used), no information disclosure from reusing the error
  message.

- **`ui-accessibility-reviewer`** — the toggle is the first "local DOM change, no
  `render()`" interaction pattern in this codebase, and it had inherited none of the
  focus-management or live-announcement discipline the rest of the screen relies on.
  Opening it hid the just-focused toggle button with no landing spot (focus silently
  drops to `<body>`); Cancel had the identical problem in reverse. No `aria-expanded` on
  the toggle and no announcement mechanism at all, since this deliberately bypasses the
  screen's only live-announcing surface (the `aria-live="polite"` feedback region).
  `Cancel` also had no `aria-label`, ambiguous once more than one row is open (confirmed
  the code doesn't actually prevent that). **Fixed**: explicit `.focus()` into the
  minutes input on open and back onto the toggle on Cancel; `aria-expanded` toggled
  alongside `.hidden`; `Cancel` now labeled per-cupper. Also flagged (low severity, took
  the suggestion): `.timing-row-actions`'s gap widened from `--space-2` to `--space-3`,
  matching this screen's own "tapped one-handed, sometimes urgently" design context.

- **`code-reviewer`** — a validation error (`parseElapsedInput` throwing on a bad typo)
  was routed through the full `renderOrShowError`/`render()` cycle even though no write
  had ever been attempted — silently closing the toggle AND discarding whatever the
  organiser had already correctly typed in the _other_ field, a real cost at the exact
  time-pressured moment this fallback exists for. **Fixed**: validation now happens
  locally, inside `renderTimingRows`' own `onSave` wrapper around `renderManualTimeFields`
  — a parse failure shows a local `role="alert"` message (`.manual-time-local-error`)
  and returns without ever calling the network-touching handler; `mountTimingScreen`'s
  own `onSaveManual` now only ever receives an already-validated integer, never raw
  strings, so a bad typo can no longer trigger a `render()` at all. Also flagged (design
  risk, documented rather than engineered around): the countdown's own `handleExpiry`
  can still fire while a row's manual fields are open, discarding an in-progress
  hand-entry with only a generic "time's up" — accepted, since §7.1's "an unstopped
  clock maxes at the full duration" is unconditional and the window this can actually
  bite in (the clock hitting exactly zero mid-type on this one fallback path) is narrow.

- **`test-auditor`** — mutation-tested the two success-path assertions
  (`root.textContent.toContain('2:00')`/`'2:30'`) by forcing every write to be
  mislabeled `maxed: true`; all 29 tests still passed, since `"Max time (2:00)"` also
  contains the substring `"2:00"`. **Fixed**: every affected assertion now pins the
  exact `.timing-row-result` text and its `data-maxed` flag. Also added: DOM assertions
  to the mixed-entry integration test (previously only checked the backing store), a
  negative test for a manual save landing after the heat has already advanced (mirroring
  the existing tap-conflict test — genuinely new to this feature, since two write paths
  can now race against one heat's completion), and (per `scoring-auditor`'s own
  observation) a test proving a manually-entered value at/over `duration_secs` clamps
  and displays as "Max time", not the entered figure.

- **`module-boundary-checker`** — clean. Confirmed `timingManual.js` stays pure logic
  (no DOM), no import cycle between the two screens, `src/core/` untouched, and the
  `parseElapsedInput`/`secsToParts`/`renderManualTimeFields` relocations correctly
  followed this project's own "extract on 2nd verbatim use" convention rather than
  duplicating or over-abstracting.

**Testing**: 32 tests in `timingScreen.test.js` (10 new/rewritten this round: toggle
open/Cancel/Save/validation-error at the `renderTimingRows` level, plus 5 `mountTimingScreen`
integration tests — success, max-clamping, the mixed-heat scenario, the local
validation error end-to-end, and the manual-path conflict), `timingManual.test.js`
gained `secsToParts` coverage (moved/added alongside the already-existing
`parseElapsedInput` tests, relocated verbatim from `timingManualScreen.test.js`). Full
suite 856/856 passing, `npm run lint`/`format:check` clean, pgTAP 129/129.

## Fix: router/slow-screen DOM-write race · 2026-09-04

**Closes ROADMAP.md's "A real DOM-write race between the router and a slow-resolving
screen"** — a real, previously-documented correctness gap, not a hypothetical: under
fast navigation + slow network, a screen still loading when the user navigates away
could have its own internal `render()` fire AFTER a newer screen already mounted onto
the same shared DOM outlet, clobbering it back to stale content with no error and no
signal anything went wrong. `router.js`'s existing `resolveSeq` staleness guard only
ever protected its own `current` bookkeeping — it can't stop a screen's own DOM writes
from landing before its `mount()` promise even resolves back to the router, including
during a screen's very first mount, before it's returned a handle the router could call
`unmount()` on.

**Fix, in layers:**

1. `core/router.js` — `resolve()` now creates a fresh `AbortController` per navigation
   and aborts the PREVIOUS one synchronously, the instant a newer navigation starts
   (not once the stale mount's own promise happens to settle). The resulting `signal`
   threads into every `route.mount(outlet, {...params, client, signal})` call; `stop()`
   also aborts on teardown.
2. `main.js` — found genuinely mid-task, not scoped up front: `buildRoutes()`'s own
   per-route lambdas were reconstructing narrower params objects that silently DROPPED
   `signal` before it ever reached a real screen, making router.js's own fix inert.
   Every route now threads it through. `requireAuth()`'s own extra async hop
   (`getSession()`) needed the identical `signal?.aborted` check before proceeding.
3. 13 screens (`core/eventsScreen.js`/`splashScreen.js`/`loginScreen.js`, and all 10
   `formats/cup-taster/*Screen.js` files) each gained an optional `signal` param and a
   guard at the top of their own render-dispatch continuation (right after their own
   async load resolves, before any DOM write). `timingRouteScreen.js`'s dispatcher
   gained an extra guard right after `findHeatById()` resolves — not to prevent a DOM
   clobber (its two inner screens already guard that), but to skip a wasted network
   round trip once the lookup is already known-stale.
4. `core/viewer-shell.js` (and its two consumers, `projectorSurface.js`/
   `phoneSummary.js`) was initially scoped OUT of this pass, reasoning its own local
   `mounted` flag already covered the race. **`code-reviewer` found that reasoning was
   wrong**: `mounted` is set `true` _before_ the initial `refresh()`'s own network
   await, so it only ever protects a callback firing after a legitimate `unmount()` —
   never the still-in-flight FIRST load, which is exactly what this whole fix is about.
   Worse, this left a real, live asymmetry: `/live/splash` shares the `bareRoot` outlet
   with `/live/projector`/`/live/phone`, and only splash had been protected in the
   first pass. Closed in the same pass once confirmed real — `viewer-shell.js` now
   accepts `signal` too, checked alongside `mounted` at both of `refresh()`'s existing
   guard points.

**Testing**: 18 new regression tests (`router.test.js` ×2, `main.test.js` ×2, one per
screen file ×14 including `viewer-shell.test.js`), each hand-mutation-tested — the
guard was temporarily disabled, the exact right test confirmed to fail, then restored.

**A real bug survived the first mutation-testing pass anyway**: a guard in
`eventsScreen.js` was left disabled (a stray `// MUTATED-FOR-TEST if (false && ...)`)
after manual verification and never restored before the parallel review round started.
Caught independently by BOTH `test-auditor` and `ui-accessibility-reviewer` in that same
round — the latter via its own focus-management angle: the disabled guard meant a
superseded Events-screen render could still yank keyboard/screen-reader focus back onto
itself after silently clobbering whatever screen the user had actually navigated to
(Events being the app's landing route, not a low-traffic corner). Fixed; full suite
re-verified green afterward.

**Review chain**: `module-boundary-checker` ✅ clean (the `AbortController` mechanism is
a Web-standard primitive with zero format opinion; the repeated
`if (signal?.aborted) return;` one-liner across 13 files was assessed as reasonable
given each screen's differing `render()` shape, not a duplication smell worth
extracting into a shared helper). `code-reviewer` found the two real issues in items 3
and 4 above (the `eventsScreen.js` dead guard, and the `viewer-shell.js` scope-cut
being based on a false premise), plus one comment-accuracy fix in
`timingRouteScreen.js` (its extra guard's own justification incorrectly claimed the
inner screens had no protection of their own — they do; the guard's real value is
avoiding a wasted round trip, not preventing a clobber). `test-auditor` independently
found the same `eventsScreen.js` dead guard via the currently-failing test it left
behind, spot-checked three other screens' mutation-testing claims by hand, and traced
all four hand-built minimal test fixtures (`timingScreen`/`timingManualScreen`/
`scoringScreen`/`standingsScreen`) against their modules' real query chains to confirm
none crash instead of failing cleanly when their guard is removed. `ui-accessibility-reviewer`
traced router.js's own post-navigation focus-move logic against both an `undefined`-
returning bailout (`requireAuth`) and a real-handle-returning one (`timingRouteScreen`),
confirmed neither can leave focus in a confusing place, and found the `eventsScreen.js`
bug independently via the focus-theft angle.

`npm run lint`/`format:check` clean, `npm test` 843/843 passing throughout. No live
Supabase/browser verification for this pass — the dev server's port was held by an
unrelated foreground process outside this session's own tracking (the sibling
Kira-Kira repo's own dev server); given the fix is pure internal control-flow with no
visual surface and every guard is independently mutation-tested, this was judged
sufficient without forcing the port.

## Fix: setupScreen kind-duplicate advisory hint + staleness bug · 2026-09-03

**Close the stage-plan setup scoping gap (ROADMAP.md's "Stage-plan setup scoping"
item)** — a real UX gap found during live testing. When an organiser adds a second
stage row with the same `kind` (e.g., two `prelims` rows), the schema treats both as
genuine sequential rounds with independent cutoffs and forward-advancing survivors —
not pooled capacity within one round, the user's actual mental model. `setupScreen.js`
offered no visual warning before that structural commitment landed in the database.

**Feature**: `renderStageRow()` gained an advisory hint (new `<p class="form-field-hint">`)
appearing below a stage row's `kind` `<select>` when another row in the plan shares the
same `kind`. Text reads: "Another {kind} stage already exists in this plan — same-kind
stages run as separate, sequential rounds (each with its own cutoff, survivors carrying
forward), not added capacity for one round." Mirrors the file's pre-existing
terminal-stage cutoff hint pattern exactly (same CSS class, same `aria-describedby`
wiring, same "real visible text" discipline). Hides when the collision clears
(changing or removing the other row).

**New pure helper**: `hasDuplicateKind(draftStages, index)` exported from
`setupScreen.js`, matching the file's existing `normalizeTerminalCutoff`/
`buildPlanFromDraft` naming convention. Found missing during review — the detection
logic was originally left inline in `render()`.

**Real bug found and fixed during review**: The kind `<select>`'s `change` handler only
mutated `row.kind` without triggering a re-render. Unlike the number fields (whose state
nothing depends on), the new advisory hint's truth depends on `row.kind`'s current value
— without a re-render, changing a row's kind left STALE, ACTIVELY WRONG hint text on
screen (e.g. still warning about a kind the row no longer has, or missing a new collision)
until an unrelated Add/Remove/Move/Save triggered a full rebuild. Both `ui-accessibility-reviewer`
and `code-reviewer` independently flagged this. Fixed: `kindSelect`'s `change` handler now
calls a new `onKindChange` callback (wired by `mountSetupScreen`'s `render()`) that
re-renders and restores focus to the same select, mirroring `addStage()`'s own
`focusAfterRender` pattern.

**Tests**: 7 new tests in `setupScreen.test.js` — 2 unit tests for `hasDuplicateKind`
itself, 2 `renderStageRow`-level tests (hint absent/present via the `duplicateKind` prop),
and 3 `mountSetupScreen` integration tests: (1) Add stage creating a same-kind collision
surfaces the hint on both affected rows; (2) changing a kind via the live `<select>`
immediately updates the hint on both affected rows with no Add/Remove/Move — and changing
it BACK clears the now-stale hint, proving the staleness fix; (3) a locked row never shows
the hint even when it would otherwise qualify as a duplicate. The 3rd integration test's
fix was mutation-tested: disabling the `onKindChange` call broke exactly the targeted
staleness test.

**Verification**: `npm run lint` clean, `npm run format:check` clean (after `npm run
format`), `npm test` 824/824 passing (up from 817). Live-verified in browser via
`setupScreen.preview.html` at 360px: hint renders correctly; toggling Stage 2's kind
between `prelims`/`finals` shows/hides the advisory in real time; locked Stage 1 (also
`prelims`) never shows it.

**Review chain**: `ui-accessibility-reviewer` ✅ (found the staleness bug at 360px first
per project convention), `module-boundary-checker` ✅ (clean on boundary; suggested
`hasDuplicateKind` extraction, adopted; O(n²) recompute immaterial at stage-plan scale),
`test-auditor` ✅ (verified mutations catch all new tests; flagged the missing locked-row
hint test, closed), `code-reviewer` ✅ (independently confirmed staleness bug; confirmed
both other reviewers' suggestions worth adopting).

No schema/RLS/RPC/migration change — pure UI-text/behavior confined to `setupScreen.js`
and its test file. State: uncommitted in the working tree (dev branch).

---

## Fix: confirm_heat entry_id misidentification + Score-this-heat UX · 2026-08-31

**PR #42 (open, not yet merged)** — two linked fixes shipped together:

**1. Root cause & correctness fix:** `scoring.js`'s `buildConfirmEntries()` was passing
`entry.entry_id` (the roster entry's person id) as the RPC's `entry_id` parameter, but
`confirm_heat` matches that against `ct_heat_entries.id` (the heat-join row's primary key,
a different UUID). Both fields exist and are populated on the hydrated row via
`hydrateEntries`'s row spread — the mismatch was silent and complete. Every real confirm
attempt failed on its first entry with `heat_entry % not found in heat %`, rolling back
the whole transaction. Verified directly against the live production database: a heat was
stuck in `scoring` with all cuppers' times recorded but zero `ct_results` rows — this bug
was actively breaking the workflow. The error itself was invisible to users, swallowed by
`describeError()`'s generic fallback since only the RPC's `P0002` optimistic-concurrency
conflict has its own handler (`describeConfirmError`). One-field fix: `entry.entry_id` →
`entry.id`. Verification: re-derived the correct field from four independent schema
sources (the RPC SQL, the sibling `record_heat_time` RPC which already sent the same value
unambiguously, the `ct_standings` view's own join, and a trigger function's join), then
confirmed with `scoring-auditor` that this precise derivation independently holds.

**2. Test-fixture root cause:** The original fixture used only ONE id-shaped field (`entry_id`
with no separate `id`), so no test could ever distinguish "sent the right field" from "sent
the wrong one." Strengthened by introducing a distinct `id`/`entry_id` pair in every
`scoring.test.js` fixture, plus a new dedicated regression test that would have caught the
original bug. `scoringScreen.test.js`'s confirm-flow integration test gained an explicit
assertion on the RPC payload's actual `entry_id` value. `test-auditor` verified these
would have caught the regression and found no similar field-confusion risks elsewhere
(checked heats.test.js, timing.test.js, standings.test.js, analytics.test.js).

**3. Separate UX addition on the same PR:** After timing completes, there was no direct link
to scoring — organiser had to navigate Overview → event stage card → Heats list → find this
heat → click. Added a "Score this heat" link to both `timingScreen.js`'s and
`timingManualScreen.js`'s "Timing complete" view. `module-boundary-checker` found the
snippet verbatim-duplicated across both files and recommended extraction; implemented as
`buildScoringLink(eventId, heatId)` living in `timingScreen.js` (imports-from already
shared with `timingManualScreen.js`) rather than `timing.js` (no other DOM references,
stays pure logic). A first attempt to extract into `timing.js` itself was caught by
`code-reviewer` and corrected.

**4. Accessibility gap in the UX fix:** The completing render moved focus to the feedback
region (set as fallback), but the new link sits earlier in the DOM, so forward-Tab skipped
past it — fixed by moving focus to the "Timing complete" heading specifically. A SECOND
`code-reviewer` pass then found a HIGH-severity gap in that fix: the focus guard fired on
ANY tone (including 'error'), so a genuinely rejected concurrent tap/save (a real race this
codebase treats as first-class) would redirect focus to the heading and hide the rejection
message from keyboard users. Fixed by gating the focus move on `feedback.dataset.tone ===
'success'` specifically in both files, with new regression tests for both "navigation to an
already-complete heat" (negative case) and "rejected save during the completing transition"
in both modules. A final verification pass mechanically reverted the fix, confirmed exactly
the right 3 tests failed, then restored it — all 807/807 tests passing again. This is worth
recording as a strong verification story since the second pass found a real, reproducible
high-severity gap in the first pass's own fix.

Also trimmed redundant "Proceed to scoring." text now that an actual button says exactly that.

**Review chain:** `scoring-auditor` ✅, `test-auditor` ✅, `code-reviewer` ✅ (×2,
second pass found the high-severity gap in the focus-move fix), `ui-accessibility-reviewer`
✅ (found and fixed the medium-gap in the focus move; the high-severity refinement was
then found in the code review that followed). `npm test` passing 807/807 throughout; `npm
run lint` clean. **Already deployed directly to production via `wrangler deploy` ahead of
the PR merging, since it was blocking real user workflow** — the stuck heat's confirm can
now be retried. PR #42 itself remains open, not merged.

---

## Production deployment: Cloudflare Workers supabaseUrl crash fix · 2026-08-31

**No §14 task ID — infrastructure fix, not a code change.** User reported the live
Cloudflare Workers site (https://seduh-score-next.greymatter-cw.workers.dev) was crashing
blank with "supabaseUrl is required." Traced to a Cloudflare Workers Builds gotcha: the
"Variables and secrets" box under Settings → Builds is the CORRECT location for build-time
env vars, but the user had been steered (incorrectly, in a prior conversation) to remove
values from there. Without those three vars at build time (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_DEFAULT_ORG_ID`), Vite bakes `undefined` into the bundle
for each `import.meta.env.VITE_*` reference, and `core/supabaseClient.js`'s
`createClient(undefined, undefined)` call throws `@supabase/supabase-js`'s own
"supabaseUrl is required." error the instant the app tries to construct a client.

The user couldn't trigger a dashboard redeploy to re-apply those env vars (no
permissions/API access), so built and deployed locally via `npx wrangler deploy` after:

1. Fetching the three real (non-secret) Supabase values directly via the Supabase MCP's
   own tools (project URL, publishable anon key, org id) — avoiding a re-paste of
   credentials into devtools.
2. Authenticating against Cloudflare via `wrangler login`.

Verified live: the page now renders the real app shell and sign-in form (not blank with a
crash). A probe login attempt round-tripped to Supabase Auth correctly ("Invalid login
credentials" — a real API response, not a crash).

**Critical note for future auto-deploys:** The dashboard's own Builds → Variables and
secrets box MUST also hold these three same vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
VITE_DEFAULT_ORG_ID) so that a future auto-triggered Cloudflare build (e.g., from merging
PR #42 or any later PR to `main`) doesn't regress back to this same "supabaseUrl is
required" crash. The user was asked to re-add them there after the earlier wrong steer
removed them — this is a manual, one-time setup step separate from the wrangler deploy
itself. Once those dashboard vars are in place, any future `main` push will auto-build and
deploy with the real values automatically.

---

## Migration: revoke PUBLIC execute on the six write RPCs · 2026-08-30

Follow-up to the search_path migration below — user asked to close the adjacent finding
that migration's own security review surfaced: `anon` had default-`PUBLIC` `EXECUTE` on
`merge_people`, `confirm_heat`, `publish_session`, `start_heat`, `record_heat_time`, and
`auto_max_heat`. Postgres grants a new function's `EXECUTE` to `PUBLIC` by default unless
explicitly revoked (unlike table DML, which defaults to nothing) — none of these six
functions' own original migrations ever revoked it, only added `grant execute ... to
authenticated`. New migration
`supabase/migrations/20260830140000_revoke_public_execute_on_write_rpcs.sql` revokes
`EXECUTE` from `PUBLIC` on all six, leaving the existing `authenticated` grant untouched.

Verified locally: `supabase db reset` applies clean (13 migrations), full pgTAP suite
passes (113/113), `has_function_privilege` confirms `anon` → false, `authenticated` →
true across all six, and the rollback block was run for real in a `begin; ...
rollback;` transaction. `schema-guardian` came back clean, independently re-verified all
of this, and flagged one adjacent (inert, out-of-scope) observation: the ten `app.*`
helper functions have the same never-revoked PUBLIC default, currently harmless only
because `app` isn't in `config.toml`'s exposed `api.schemas` — noted for a future pass,
not fixed here.

**`security-reviewer` found a real gap in the migration's own first draft**, live-tested
before approving it: `service_role` — not a Postgres superuser in this project, only
`BYPASSRLS` — was _also_ silently losing `EXECUTE` on all six by the exact same PUBLIC-
default mechanism `anon` was, since `service_role` is a standalone role, not a member of
`authenticated`. `BYPASSRLS` bypasses RLS _policy_ evaluation only, never GRANT-based
privilege checks — correct Postgres behavior, but it contradicts the common assumption
that `service_role` is "superuser, bypasses everything." Confirmed dormant, not an active
break (nothing in this codebase currently calls any of these six RPCs as `service_role` —
org/organiser provisioning goes directly against `orgs`/`org_members`, not through these
functions), but a real footgun for any future server-side admin/support script reaching
for the service-role key against one of these RPCs — it would fail with an opaque
"permission denied for function" and no clue why. Fixed in the same migration (not shipped
separately, since it hadn't been pushed anywhere yet): an explicit `grant execute ... to
service_role` alongside each revoke, symmetric with the `authenticated` grant. Re-verified
live after the fix: `anon` → false, `authenticated` → true, `service_role` → true across
all six; rollback block re-verified in a transaction (now also reverting the
`service_role` grant before restoring `PUBLIC`).

Pushed to both the local stack and the linked cloud project via the Supabase MCP's
`apply_migration`, same as the search_path migration — re-verified `has_function_privilege`
directly against the cloud project afterward (`anon` → false, `authenticated` → true,
`service_role` → true, all six).
---

## Migration: pin search_path on the six write RPCs · 2026-08-30

Follow-up to the cloud-linking entry below — user asked for this specific
`get_advisors` finding closed now, ahead of the Cloudflare deployment-config step (done
separately). New migration `supabase/migrations/20260830130000_rpc_search_path_pin.sql`:
`merge_people`, `confirm_heat`, `publish_session`, `start_heat`, `record_heat_time`, and
`auto_max_heat` all lacked an explicit `search_path` pin — every `app.*` helper function
in this schema (`is_org_member`, `org_id_for_event`, etc.) has carried `set search_path =
''` since T1.3, these six never got it.

Not a bare `alter function ... set search_path` — all six bodies referenced tables
UNQUALIFIED (`from people`, `from ct_heats`, ...), so pinning an empty search_path alone
would have silently broken every one of them at runtime (nothing but `pg_catalog`
resolves implicitly under `search_path = ''`). Each function is reproduced via `create
or replace function` with every previously-bare reference now `public.`-qualified,
matching the `app.*` functions' own existing discipline — no other logic change.

Verified locally before writing the migration up: `supabase db reset` applies clean,
full pgTAP suite passes (113/113), and the rollback block was run for real in a `begin;
... rollback;` transaction against the local docker container (matching this project's
own schema-guardian discipline — a rollback block is verified by running it, not just
reading it). `schema-guardian` independently re-verified all of this AND went further —
exercised all six functions end-to-end with real fixture data under the new empty
search_path (person merged, heat advanced pending→timing→scoring→confirmed, a result
row inserted, `live_sessions.active` flipped, an auto-max sweep applied), confirming a
missed qualification would have surfaced as a real runtime error, not a silent pass; none
occurred. Also confirmed independently that all nine `app.*` helper functions already
carry the pin — this migration's scope (these six, and only these six) was the real, full
gap. `security-reviewer` came back clean on the migration itself, and independently
verified the "SECURITY INVOKER is lower-risk than SECURITY DEFINER here" reasoning by
directly querying `pg_roles`/`has_database_privilege` (`anon`/`authenticated` have no
`CREATE` on `public`/`app`/`extensions` — no live schema-shadowing path exists today).

**A real, adjacent finding surfaced during security review, not fixed in this
migration**: `anon` has default-`PUBLIC` `EXECUTE` on all six RPCs — Postgres grants
`EXECUTE` to `PUBLIC` by default unless explicitly revoked, and none of the six
functions' own original migrations ever issued that revoke, only `grant ... to
authenticated`. Every one of these functions' own comments states an "authenticated
only" intent this silently doesn't enforce. Confirmed **not currently exploitable** —
proved live via `set role anon` — every one of the six touches a table `anon` has no
GRANT on at all before RLS is even reached (`permission denied for table people` /
`processed_operations` / etc.), so this is a defense-in-depth gap, not a live hole.
Deliberately left as a separate follow-up rather than folded into this migration (a
different root cause — a missing `REVOKE`, not a missing pin) — revisit as its own small
migration (`revoke execute on function <sig> from public;` ×6) if/when prioritized.

Pushed to both the local stack and the now-linked cloud project (via the Supabase MCP's
`apply_migration`, same mechanism as the initial migration push above) — re-ran
`get_advisors` afterward and confirmed all six `function_search_path_mutable` warnings
are gone. The pre-existing `rls_auto_enable` platform-function finding is unchanged
(not something any migration in this repo created), and `get_advisors` surfaced one more
finding, unrelated to any migration: leaked-password protection is disabled in Auth
settings (a dashboard toggle under Authentication → Settings, not a schema change) —
flagged to the user, not fixed here.

---

## Supabase cloud project linked, real organiser account provisioned · 2026-08-30

**No §14 task ID — infrastructure, not a code change.** User asked for their login
details, which surfaced that no real organiser account existed anywhere — the temporary
login screen (above) had a real form, but the only real login was `supabase/seed.sql`'s
local-dev-only credentials. Confirmed the intent was to get this ready now, ahead of 4
October, rather than defer it further.

Discovered a Supabase cloud project named "Seduh Score Next" (`wxzwanprluqmgoagbkpv`,
org "Grey Matter Coffee Werks", `ap-southeast-1`) already existed — created 2026-08-21,
before this session, but with zero migrations applied. Reused it rather than creating a
second project. All 11 local migrations applied in order via the Supabase MCP's
`apply_migration` (`core_tables` through `ct_heat_entries_station_unique`) — schema, RLS
policies, grants, and every RPC now match local dev exactly. A real org ("Grey Matter
Coffee Werks") and a real organiser `auth.users` row (bcrypt password, same
`extensions.crypt`/`gen_salt('bf')` mechanism `seed.sql` already established for local
dev) were provisioned directly via SQL — matching this project's own already-decided
provisioning model (`ROADMAP.md`: the one organiser account is created outside the app,
via `service_role`, not a self-serve flow). Verified live: a real password-grant token
request against the project's own Auth API succeeded.

`get_advisors` (security) surfaced two pre-existing findings, neither introduced by this
session's migrations — flagged rather than silently patched, since editing an
already-pushed migration isn't allowed by this project's own Definition of Done (a fix
is a new migration, reviewed as such):

- Six RPC functions (`merge_people`, `confirm_heat`, `publish_session`, `start_heat`,
  `record_heat_time`, `auto_max_heat`) have no explicit `search_path` pin. Lower risk
  than it sounds — all six are `SECURITY INVOKER` (the default), not `SECURITY DEFINER`,
  and neither `anon` nor `authenticated` has `CREATE` on `public` in this project's
  standard Supabase role setup, so there's no live schema-shadowing path today. Still a
  real hygiene gap worth a follow-up migration adding `set search_path = ''` to all six,
  matching every `app.*` helper function's own existing convention.
- `public.rls_auto_enable()` is callable by both `anon` and `authenticated` as
  `SECURITY DEFINER` — a Supabase-platform-provided function, not something any
  migration in this repo created. Worth investigating (or asking Supabase support about)
  before relying on it being harmless, but out of this session's scope to fix.

**Cloudflare Workers deployment config was NOT updated this session** — no Cloudflare
API access was available. The real `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/
`VITE_DEFAULT_ORG_ID` values need to be set as build environment variables in the
Cloudflare dashboard (Workers project → Settings → Environment variables) before the
auto-deployed production build actually points at this real project instead of failing
with unset env vars — handed to the user directly, not committed anywhere.

**Real credentials** (org id, project URL/anon key, and the organiser's real password)
were given to the user directly in chat, never written to any file in this repo.

---

## Temporary login screen · 2026-08-30

**No §14 task ID — explicitly scoped by the user as temporary,** ahead of D14's real
entitlements-based access control (currently an intentional permissive stub). The
app-wiring PR (above) connected every organiser screen into a real, navigable app, but
every organiser table is `authenticated`-only (`20260821240000_grants.sql`), and there
was still no way for a human to sign in — the only way to establish a session was typing
`supabase.auth.signInWithPassword(...)` into devtools, which is not something to rely on
live in front of an audience on 4 October. This closes that gap with the smallest thing
that actually works: a plain sign-in form against the existing `auth.signInWithPassword`.
No sign-up, no password reset, no tier/role gating — account provisioning stays exactly
as already decided (`ROADMAP.md`: the single organiser is provisioned via `service_role`
outside the app).

**What shipped:**

- `src/core/loginScreen.js`/`.css` (new) + `.test.js` — `mountLoginScreen(root,
{client, onSignedIn})`: email + password via `core/dom.js`'s `labeledField()`
  (`autocomplete="username"`/`"current-password"`), client-side "both fields filled"
  check before ever calling the API, `signInWithPassword` on submit, `onSignedIn()` on
  success, `error.message` shown verbatim on failure (Supabase Auth's own user-facing
  text — deliberately not routed through `core/errors.js`'s `describeError()`, which
  guards a different thing: raw DB error internals). Lives in `core/` — auth is
  format-agnostic.
- `src/main.js` — a `requireAuth(mount, routerRef)` wrapper, deliberately confined to
  this file rather than `core/router.js` (which stays exactly as shipped, reusable
  unedited by a future format), applied around every organiser route. `#/live/projector`
  and `#/live/phone` are **not** wrapped — the audience never authenticates, by design
  (`live_sessions` is anon-readable). On success, `onSignedIn` re-resolves the current
  path, so sign-in lands the user exactly where they were trying to go — no separate
  `#/login` route needed.
- `src/core/appShell.js` — a reactive "signed in as {email}" + "Sign out" control in the
  persistent header, subscribed via `client.auth.onAuthStateChange` (not a one-time
  fetch — the shell mounts once per app lifetime, but a sign-in can happen well after
  that, inside its own outlet). Sign out calls `client.auth.signOut()` then navigates to
  `#/events`, which re-triggers `requireAuth` and shows the login screen — no extra
  plumbing needed.

**A real, reproducible test-isolation bug found and fixed while writing `main.test.js`,
not a product bug** — `beforeEach`/`afterEach` previously reset `location.hash` but
didn't account for jsdom queuing its `hashchange` dispatch rather than firing it
synchronously (per the HTML spec's own "queue a task to fire hashchange" wording). A
test with several navigations could leave more than one dispatch pending after its own
body finished; the backlog would fire later against whichever _later_ test's router
happened to be listening when jsdom got around to it, corrupting that test's state.
Root-caused by direct `router.js` instrumentation, not guessed at. Fixed with a
`settleHashDispatch()` helper (two macrotask ticks, matching the documented jsdom
double-fire-per-assignment quirk `router.test.js` already established) called in both
`beforeEach` and `afterEach`, resetting the hash _before_ tearing the router down so each
test's own trailing dispatches settle against its own still-live router rather than
leaking into the next one. `test-auditor` independently reproduced this (removing the
fix made the affected test fail deterministically across 5 consecutive runs) and formed
its own judgment that this is a genuine test-environment artifact, not a masked
`core/router.js` defect — `mountApp()`/`createRouter()` are only ever created once per
real page load in production; this class of interaction (many independent router
instances sharing one `window`) is unique to running many tests back to back.

**Live browser verification**: signed out, confirmed the real login form renders;
signed in through the actual form (not devtools) with `supabase/seed.sql`'s fixed
credentials, landed on Events; confirmed "signed in as organiser@local.test" + Sign out
appear in the header; clicked Sign out, confirmed it returns to the login screen;
confirmed `#/live/projector` still renders its own holding state with zero session and
zero login gate, exactly as designed.

**Five reviewers in parallel** (`module-boundary-checker`, `ui-accessibility-reviewer` at
360px, `test-auditor`, `code-reviewer`, `security-reviewer` — the last included
deliberately even though no RLS/RPC/Storage changed, since this is the first credential-
entry surface this codebase has ever had). `module-boundary-checker` and `test-auditor`
both came back clean. `ui-accessibility-reviewer` and `code-reviewer` independently
converged on the same real gap: neither `requireAuth`'s `client.auth.getSession()` call
nor `loginScreen.js`'s `signInWithPassword` call had a timeout, unlike every other
initial-load boundary call in this codebase (`eventsScreen.js`/`setupScreen.js`/
`rosterScreen.js`'s own established `raceTimeout`/`DEFAULT_LOAD_TIMEOUT_MS` pattern) — on
a hung connection, the _entire app_ (not just one screen) was left permanently blank
with no feedback, or the login form stayed disabled and unrecoverable forever. Both
fixed: `requireAuth` now races `getSession()` against the timeout and renders a
Retry-capable error state on failure; `loginScreen.js` now races `signInWithPassword`
the same way, showing a distinct "taking longer than expected" message on timeout versus
a generic connection message on an outright transport failure. `code-reviewer` also
found `appShell.js`'s sign-out handler had an unguarded `await client.auth.signOut()` —
a rejected sign-out (a real possibility over a bad connection) threw as an unhandled
rejection and left the user believing they'd signed out when they hadn't; fixed with a
try/catch that leaves the button clickable to retry. `security-reviewer` found
`appShell.js`'s own breadcrumb fetch (`setNav` → `findEvent`) isn't sequenced behind
`requireAuth`'s session check — it fires in parallel, since `router.js`'s `onNavigate` is
called synchronously before `route.mount()`'s own await settles. Confirmed harmless (RLS
already scopes `events` to org membership regardless of caller, and the existing catch
clears the breadcrumb on a denied read) but worth making explicit rather than letting a
future reader assume `requireAuth` covers every organiser-surface fetch — documented with
a comment rather than restructured, given the "temporary" scope and that RLS is already
the real, sole enforcement boundary here, not this UI gate.

---

## App wiring: router, organiser shell, event management, live routes · 2026-08-30

**No single §14 task ID — like the design system entries above, this was never a
scoped, tracked task anywhere** (not the frozen handoff's own build plan, not
`ROADMAP.md`, not Phase 6). Every organiser screen (8) and both audience surfaces (2)
already existed, fully built and individually reviewed through Phase 4/5 — but
`src/main.js` was still the literal Phase 0 placeholder
(`root.textContent = 'Seduh Score Next'`) and nothing connected them into a navigable
app. Surfaced when the user asked "how about wiring the pages together — when does that
happen?" Scoped with the user directly: at least two devices (an organiser control
device and a separate audience-facing device), no real login yet (but the design
shouldn't foreclose adding one later), and a real event list/create flow rather than a
single hardcoded event id, since this has to keep working for events after October, not
just the one on 4 October 2026.

**Two real gaps found during scoping research, closed as part of this same PR:**
`heatsScreen.js`'s `mountHeatGenerationScreen` had no `unmount()` return at all — every
other screen already returns `{ unmount() {...} }`, this one implicitly returned
`undefined`, which a router calling `.unmount()` uniformly needed fixed, not worked
around. And the "generation complete" heats list rendered heat cards with **no links
into Timing or Scoring at all** — wiring a router alone doesn't fix this; there was no
path from "heats generated" into the rest of the flow. New per-heat `heatActionLink()`
links (`heatsScreen.js`) close it: "Time this heat" / "Score this heat" depending on
`heat.status`, or a "Confirmed" badge once done.

**What shipped:**

- `src/core/router.js` (new) + `.test.js` — hand-rolled, hash-based (`#/events/...`),
  no framework (matches D2/§3). Hash routing specifically: `wrangler.jsonc`'s Cloudflare
  Workers Static Assets config has no SPA-fallback (`not_found_handling`) set, so a real
  path would 404 on direct navigation; a hash fragment never round-trips to the server,
  so this needed zero deployment config changes. Split into a pure `matchRoute()`
  (directly unit-testable) and a stateful `createRouter()` wrapper. `client` is resolved
  once and threaded into every mount as `{...params, client}` — the single chokepoint
  guaranteeing every screen the router ever mounts gets the same client, matching this
  codebase's existing single-chokepoint discipline (`buildRpcHandler`,
  `app.is_org_member`). `route.outlet`/`onNavigate` are the router's only two extension
  points — it has zero opinion about screens, chrome, or format (confirmed clean by
  `module-boundary-checker`).
- `src/core/appShell.js`/`.css` (new) + `.test.js` — persistent organiser header (app
  name, an event-name breadcrumb cached by event id, nav links) plus a content outlet.
  Deliberately doesn't reuse `viewer-shell.js`'s `renderChrome()` (different purpose —
  audience identity band vs. organiser navigation) but follows its structural precedent;
  second CSS file living in `core/` rather than a format directory, after
  `viewer-shell.css`.
- `src/core/config.js` (new) + `.test.js` + `.env.example` — `getDefaultOrgId()` reads
  `VITE_DEFAULT_ORG_ID`, throwing loudly (not silently) if unset. The explicit,
  trivially-swappable placeholder for "which org" until real per-session org derivation
  exists — no auth is being added now, matching the scoping decision above.
- `src/core/eventsScreen.js`/`.css` (new) + `.test.js` — events list/create. Lives in
  `core/`, not `formats/cup-taster/` — `core/events.js` already treats `format` as plain
  caller-supplied input, so the screen listing/creating those rows is the same kind of
  module; `main.js` is the one file allowed to pass `defaultFormat: 'cup_taster'` in.
  The "This is test data" checkbox defaults **unchecked** (D9: opt in, never the
  reverse) — this is the one screen in the whole app where `is_test` is actually _set_,
  not just displayed. `core/events.js` gained `listEventsForOrg(orgId, client)`.
- `src/formats/cup-taster/eventDashboardScreen.js`/`.css` (new) + `.test.js` — per-event
  hub: is_test banner, event name, Setup/Roster/Report links, one card per stage
  (labelled "Heats" or "Generate heats" depending on `stageHasHeats`, plus a Standings
  link), a zero-stages empty state pointing at Setup. Lives in `formats/cup-taster/` —
  reads `ct_stages` via `setup.js`, genuinely format-specific.
- `src/formats/cup-taster/timingRouteScreen.js` (new) + `.test.js` — thin dispatcher:
  one route entry for "timing" (`.../heats/:heatId/timing`), but two real screens
  depending on the heat's own `timing_mode` (not knowable from the URL alone). Keeps
  every link-building call site simple.
- `src/main.js` (rewritten) — the composition root: the full route table, `mountApp()`,
  a `shellRoot`/`bareRoot` split so the two `chrome:false` audience routes
  (`#/live/projector`, `#/live/phone`) get the _entire_ root for their own full-bleed
  styling and never show organiser navigation to an audience. `index.html` gained
  `<link>` tags for every screen's own CSS file — previously only `ui/tokens/index.css`
  was linked; every screen's styling was only ever pulled in by its own standalone
  preview harness, so real navigation would have rendered every screen unstyled the
  first time it was reached outside one.

**A real bug found live-testing, not fixed in this PR — documented, not silently
shipped:** a slow-resolving screen's own async `render()` can write to the DOM _after_ a
newer navigation has already mounted something else, because `router.js`'s `resolveSeq`
staleness guard only protects its own `current` bookkeeping — it does not, and cannot
from outside, stop a discarded-but-still-in-flight screen's own internal DOM writes
(`root.innerHTML = ''; root.appendChild(...)`) that happen _while_ its promise is still
resolving. Found via a genuinely flaky e2e test (not theorized): navigating away from
the events screen before its own load finished let the events screen's late-arriving
data clobber the destination screen's already-rendered content back to the events list,
with no further signal anything was wrong. Root-caused by temporarily instrumenting
`resolve()` directly and tracing the actual interleaving, not guessed at. Fixing this
properly means giving every one of the ~10 existing screens' own `attemptLoad()`/
`render()` pattern a cancellation check (an `AbortSignal` or equivalent) — a real,
worthwhile follow-up, but a materially larger, more invasive change than this PR's own
scope (retrofitting 10 already-shipped, already-reviewed screens). The one place this
PR's own test suite could hit the race (`tests/e2e/organiser-flow.spec.js`) was fixed by
waiting for the events screen to fully settle before navigating away, matching what a
real user's own reaction time already does in practice — not a workaround that hides the
underlying gap, since the gap itself is now written down here.

**`supabase/seed.sql` (new)** — a fixed local-dev-only org, an `auth.users` row (bcrypt
password via `pgcrypto`), an `auth.identities` row, and an `org_members` grant. Exists
because every organiser-facing table is `authenticated`-only
(`20260821240000_grants.sql`), and this project deliberately has no login screen yet —
without a seeded org and a real authenticated login already a member of it, there was no
way to exercise the real app against the real local stack at all, for a human developer
or for an e2e test, short of hand-crafting a user via the admin API every time. Applied
by `supabase db reset` and a fresh `supabase start` per `config.toml`'s `[db.seed]`
block. `security-reviewer` found the file's own original comment overstated this as an
unconditional "never reaches a linked/production project" — `supabase db push
--include-seed` and `supabase db reset --linked` (seeds by default unless passed
`--no-seed`) would actually apply it there; no script or CI job in this repo runs either
today, and no cloud project is linked yet, so there's no live exploit path, but the
comment was reworded to state the real, procedural boundary rather than an absolute one.

**Live browser verification**: real dev server, real local Supabase (not a mock) —
signed in as the seeded organiser, created an event, built a one-stage plan, registered
three cuppers, generated heats, opened Timing (confirming `timingRouteScreen.js`
correctly dispatches to the app-mode screen), and separately verified `#/live/projector`
(holding state, organiser chrome correctly hidden) and `#/live/phone` (its own
`NOT LIVE` badge chrome, confirmed distinct from the organiser shell) and the
not-found fallback.

**Testing**: `src/core/router.test.js` (18 cases, including a genuine staleness-guard
regression test — verified it actually fails with the guard removed, not merely
constructed to look like it would), `appShell.test.js`, `config.test.js`,
`eventsScreen.test.js` (including a mutation-tested proof that `defaultFormat` is never
hardcoded — verified the test fails if `'cup_taster'` is hardcoded back in),
`eventDashboardScreen.test.js`, `timingRouteScreen.test.js`, extended
`heatsScreen.test.js`/`events.test.js`, and a full `main.test.js` rewrite (every screen
mocked, asserting the router wires the right screen/params/chrome for every route,
including an unmount-ordering test surviving jsdom's own double-`hashchange`-fire quirk
and a not-found fallback test). New `tests/e2e/organiser-flow.spec.js` (Playwright,
`dev-app` project, drives the real app against the real local Supabase stack via
`seed.sql`'s fixed login) and `tests/e2e/smoke.spec.js` rewritten to assert on the real
app shell instead of the old placeholder string. `playwright.config.js` gained the
`dev-app` project with `dependencies: ['dev-harnesses']` — found running the full suite:
`cross-surface-countdown.spec.js`'s own ~25s real-time test and this project's real
Supabase Realtime connection, run concurrently by Playwright's default `fullyParallel`
behavior on the same shared dev server, caused real, reproducible resource-contention
flakiness in `organiser-flow.spec.js`'s own live-route assertions — the dependency
serializes them instead of masking it with a longer timeout. `.github/workflows/ci.yml`'s
`playwright` job now also runs a real local Supabase stack (`supabase/setup-cli@v1` +
`supabase start`) before `npm run test:e2e`, since `organiser-flow.spec.js` needs one.

**A real bug this PR's own CI run caught, not local testing** — `seed.sql`'s first
version used `00000000-0000-0000-0000-000000000001` as its org id, the same readable,
low-numbered id `supabase/tests/001_core_tables.sql`'s own pgTAP fixture already
hardcodes as its own "Test Org." `supabase test db` runs a real `db reset` first, which
applies `seed.sql` before the pgTAP suite itself runs — invisible locally (nothing runs
both `db reset` and the pgTAP suite back to back outside CI's own job), but broke the
"Migrations from scratch + pgTAP" CI job outright (`duplicate key value violates unique
constraint "orgs_pkey"`) the moment this PR's own CI run exercised it. Fixed by
generating genuine random UUIDs for `seed.sql`'s org/user ids instead of reusing the
fixtures' own readable low-number convention — see that file's own comment for the full
account.

**Five reviewers in parallel** (`module-boundary-checker`, `ui-accessibility-reviewer` at
360px, `test-auditor`, `code-reviewer`, `security-reviewer` — the last specifically for
`seed.sql`'s auth-table inserts and the CI credential handling).
`module-boundary-checker` came back clean — `core/eventsScreen.js` confirmed genuinely
format-agnostic (`defaultFormat` is caller-supplied, never hardcoded; the only
`'cup_taster'` literal in production code is `main.js`'s own route table), `router.js`
confirmed to have zero screen/chrome/format opinion. `security-reviewer`'s one real
finding is the `seed.sql` wording fix described above; everything else it checked
(credential non-secrecy, bcrypt hashing, `instance_id` scoping, no other secrets)
verified clean.

`test-auditor` found the router's own headline race-condition test didn't actually
prove the `resolveSeq` staleness guard: both mocked mounts resolved synchronously, so
the assertions held identically with the guard deleted entirely (verified: removing the
guard left all 15 original tests green). Rewritten using the same controllable-delay
pattern `appShell.test.js`'s own staleness test already uses correctly — re-verified the
new version genuinely fails without the guard. Also flagged a trivially-true
`expect(true).toBe(true)` assertion, replaced with a real check on router state via
`resolve()` called directly rather than `navigate()` plus an arbitrary `setTimeout(0)`.

`ui-accessibility-reviewer` found real issues at 360px: every organiser screen had two
`<h1>`s (the shell's own app name plus each routed screen's own heading) — fixed by
demoting the shell's name to a `<p>` (screens keep their real `<h1>`, matching
`viewerBody.js`'s own precedent of never competing with `viewer-shell.js`'s identity
`<h1>`); no focus management on route transitions at all — fixed at `router.js`'s own
chokepoint, moving focus to the new screen's heading only when nothing else has already
claimed it (`document.activeElement === document.body`), so a screen's own loading/error
focus calls are never overridden; the `is_test` checkbox and header nav links fell under
the 44px tap-target floor — fixed using the exact `--tap-target-min` pattern
`standingsScreen.css` already established; `eventDashboardScreen.js` skipped straight
from `<h1>` to `<h3>` with no `<h2>` — added a "Stages" heading; the outlet had no
`<main>` landmark — the outlet element is now a real `<main>`; and `.heat-status-done`
had no CSS rule at all — styled matching `rosterScreen.css`'s own status-tag pattern.
All verified live in the browser (single `<h1>`, `<main>` landmark, focus genuinely
lands on the new heading on load, both undersized controls now measure 44×44px).

`code-reviewer` (run after the accessibility fixes above landed, re-verifying against
that settled state — flagged the mid-review edits explicitly rather than reviewing a
moving target) found four more real issues: `mountApp()`'s own `unmount()` called
`router.stop()` but never `shell.unmount()` — the one thing in `main.js` holding real DOM
state (header, nav, the cached breadcrumb closure) was left mounted forever, breaking the
same "every mount has a real unmount" contract this PR itself closed a gap in for
`heatsScreen.js` — fixed, with a new regression test proving the shell's own header is
gone after `unmount()`. `timingRouteScreen.js`'s `attemptLoad()` had no re-entrancy guard
on Retry, unlike `eventsScreen.js`'s/`eventDashboardScreen.js`'s own established
`loading` guard — two rapid Retry clicks could start two concurrent mounts of
`timingScreen.js` (this project's own "first live/ticking screen") into the same root,
orphaning the loser's ticking interval with nothing to ever stop it — fixed, with a
regression test using a controllable delay to force the race, not an instantly-resolving
mock that couldn't actually prove it. Also fixed: an `appShell.js` doc comment overstating
where the nav's own strings live (main.js's `updateChrome()` only ever builds the small
persistent Events/Overview nav — "Setup"/"Roster"/"Report" live inside
`eventDashboardScreen.js`'s own routed content, not the shell), and a documented-but-
unenforced invariant in `router.js` (a route with its own `outlet` override must
implement real DOM cleanup in its own `unmount()`, since the "next screen at the same
outlet wholesale-clears my DOM" convention most screens rely on doesn't hold across a
different outlet — currently safe only because `viewer-shell.js`, the one outlet-override
consumer today, already does real cleanup; now stated explicitly as a comment so a future
outlet-override route built on a no-op-unmount screen doesn't silently leak).

---

## Design system type refresh (`src/ui/tokens/fonts.css`, `typography.css`) · 2026-08-28

**No single §14 task ID** — like the original "Design system foundation" entry below,
this is a follow-up to that foundation, not a numbered build-plan task. Prompted by the
user reviewing rendered mockups in a design-canvas exploration and deciding on new
typefaces for the display and mono roles.

**What changed**: `--font-display` (was Erode, an editorial serif, weight 400 only) is
now **Cabinet Grotesk**, a geometric grotesk, weights 400 and 700; `--font-mono` (was
"Tabular", a grotesque sans with tabular figures, not a true monospace) is now
**JetBrains Mono**, a genuine fixed-width monospace, weights 400 and 700 (unchanged from
Tabular's own weight count). `--font-body` (Switzer) is unchanged — same family, same
four weights, files just refreshed from a fresh download of the same typeface. Fallback
stack for `--font-display` changed from a serif-oriented stack to a sans-oriented one
(`ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`), matching Cabinet
Grotesk's own construction. No italic `@font-face` declared for the new display face —
Cabinet Grotesk ships no italic cut, and grep confirmed nothing in `src/` sets
`font-style: italic` on `--font-display` (Erode's own italic rule existed only because
Erode itself had real italics, used nowhere in the app). Both new families are
Fontshare/ITF Free Font License (same license Erode/Switzer/Tabular were under,
self-hosting explicitly permitted); JetBrains Mono is SIL Open Font License 1.1, which
also explicitly permits self-hosting.

**Decision record — Chillax, then Cabinet Grotesk**: the display-face swap went through
two rounds in the same session. Chillax (also Fontshare/ITF) was the first replacement
for Erode, fully wired into `fonts.css`/`typography.css`/`DESIGN.md`/`CONVENTIONS.md`
and verified loading in-browser. The user then reconsidered and asked for Cabinet
Grotesk instead — Chillax was fully removed (files deleted, no `@font-face` or
`--font-display` reference left anywhere in `src/`) rather than left as a second option,
matching this project's one-typeface-per-role discipline. No functional difference
between the two swaps' mechanics; recorded here so a future reader doesn't find a
Chillax reference in an old commit and wonder if it's still live (it isn't).

Total payload for all 8 weight files now shipped (2 Cabinet Grotesk + 4 Switzer + 2
JetBrains Mono) is ~230KB, up from the original 8-file/~133KB Erode/Switzer/Tabular set
(2 Erode + 4 Switzer + 2 Tabular) — self-hosting posture unchanged, still zero
third-party CDN font requests.

**Weight rationale — why 400+700, not one weight or the full family**: Cabinet Grotesk's
download includes Thin/Extralight/Light/Regular/Medium/Bold/Extrabold/Black cuts (plus a
variable-font file, unused — this project ships static instances only); only Regular
and Bold are shipped because those are the only two weights any consumer in `src/`
actually requests — checked before shipping, not assumed. The other six cuts have zero
consumers and are deliberately excluded, per `fonts.css`'s own "only weights actually
used" rule (the same discipline already governing Switzer's four weights and JetBrains
Mono's two).

**Verifier**: `ui-accessibility-reviewer` (360px first, per DoD — required because this
touches `src/ui/tokens/` and changes what renders on every UI surface, even though no
layout/color/motion token changed). **Not a clean pass — found one real issue**, fixed
before this entry was written:

- The shipping comment in `fonts.css` (and the mirrored prose in `DESIGN.md`) claimed
  "nothing in this codebase sets an explicit font-weight on `--font-display`'s regular
  body use" as the justification for why 700 was a genuine consumer. That claim was
  false: `src/ui/tokens/preview.html`'s own `.guide-heading` rule (predates this swap,
  originally styled for Erode's look) explicitly sets `font-weight:
var(--font-weight-regular)` on the token-preview page's own headings. Not a rendered
  accessibility failure — at `--text-2xl` (33px) that page's headings clear WCAG's
  large-text threshold and the paper/stage contrast pairs there are both near-maximal —
  but a real documentation-accuracy defect: the comment would have misled a future
  reader deciding whether the 400 cut is safe to drop. Both `fonts.css` and `DESIGN.md`
  corrected to state the true picture — 700 covers every real app screen's headings
  (bare `<h1>`-`<h6>` UA-default bold, or `viewer-shell.css`'s explicit bold), 400 is
  independently a genuine consumer via `preview.html`'s own deliberate override, not
  merely a fallback the 700 rule makes redundant.
  - Reviewer separately checked and ruled out (reported explicitly, not just omitted, so
    the review's coverage is on record): JetBrains Mono legibility/width-locking at
    every real display size from the projector's 96px down to the organiser's smaller
    sizes (no `--tracking-tight` applied to any `--font-mono` element, and
    `.tabular-nums` still layered on regardless); Cabinet Grotesk 400 stroke
    weight/contrast at the smallest headings the app actually ships (none render at 400
    — see the finding above, they're all genuine bold); leftover assumptions tied to the
    old fonts' specific metrics (none found — no `font-size-adjust`, no face-specific
    `line-height` comments, and the one real old-font-specific dependency, Erode's
    italic, was fully and correctly removed with no orphaned rule left anywhere);
    fallback-stack honesty (sans stack now correctly matches Cabinet Grotesk's sans
    construction, no serif-metric assumption left behind); the `is_test` banner (D9) —
    unaffected, since it uses `--font-body` (Switzer, untouched by this swap), not
    `--font-display`/`--font-mono`.

**Files touched**: `src/ui/tokens/fonts.css`, `typography.css`, `DESIGN.md`,
`CONVENTIONS.md` (font-name references); `src/ui/tokens/fonts/` gained
`cabinet-grotesk-400.woff2`, `cabinet-grotesk-700.woff2`, `jetbrains-mono-400.woff2`,
`jetbrains-mono-700.woff2`, and refreshed `switzer-{400,500,600,700}.woff2`; lost
`erode-400.woff2`, `erode-400-italic.woff2`, `tabular-400.woff2`, `tabular-700.woff2`
(and the intermediate `chillax-400.woff2`, added then removed same session). Verified
in-browser against the running dev server: every new `.woff2` request resolved `200 OK`,
and `getComputedStyle(document.documentElement).getPropertyValue('--font-display')`
resolved to `'Cabinet Grotesk', ui-sans-serif, ...` as expected.

**Open follow-up**: none outstanding — the one review finding was fixed inline before
this entry was written, so this task's Definition of Done (§11) is fully met (no
schema/RLS/scoring/outbox surface touched, so those verifiers don't apply; UI-touching
change got its required `ui-accessibility-reviewer` sign-off above).

---

## 2026-08-28 — kb-sync verification (Phase 5 closure)

Session log entry for verification pass on Phase 5's cross-surface Playwright acceptance
criteria closure. Task corresponds to T5.3/T5.4 cross-surface AC (§14 handoff). Verifier:
`kb-sync` (this session).

All files logged: `tests/e2e/cross-surface-countdown.spec.js` (new), `playwright.config.js`
(extended), `.github/workflows/ci.yml` (extended), `src/formats/cup-taster/timingScreen.
preview.html`, `phoneSummary.preview.html`, `projectorSurface.preview.html` (each gained
`window.__e2e` test hook), `src/formats/cup-taster/demoActiveHeatPayload.js` (new).

Verification findings: CHANGELOG.md, ROADMAP.md, and CLAUDE.md entries already written,
comprehensive and accurate. Cross-verified each against actual source files:

1. `viewer-shell.js` architecture correctly documents Realtime subscription, `hasEvent`/
   `notStarted` vs `noEvent` distinction, cleanup-lifecycle contract for ticking body.
   `events.js` correctly describes `findLatestEventForOrg()`'s existence-only semantics.
   Both confirmed against committed code.

2. `viewerBody.js` correctly summarizes live countdown (core/countdown + core/duration
   reused unedited), per-cupper status chips with non-color signals, standings table
   reusing existing CSS, optional cleanup return matching viewer-shell contract. Confirmed
   against 41-test suite and live browser verification already logged.

3. `phoneSummary.js` and `projectorSurface.js` both accurately described as thin
   compositions of `viewer-shell` + `viewerBody`, with correct `showChrome` values and
   `data-surface` handling. Confirmed showChrome semantics against source.

4. `demoActiveHeatPayload.js` correctly logged as extraction from 2nd verbatim use across
   two preview harnesses; buildActiveHeatPayload() payload shape matches test expectations.

5. Playwright test (`cross-surface-countdown.spec.js`): accurately describes three separate
   contexts, real-heat values published to viewers, ±2s tolerance checks at three checkpoints,
   three-way proof at expiry (organiser maxed entries, viewers at 0:00, isExpired() agreement).

6. **CLAUDE.md architecture section — content found intact.** Earlier concern that T5.2/T5.3/
   T5.4/holding-state follow-up edits had been lost turned out unfounded — all descriptions
   of viewer-shell (Realtime, hasEvent/notStarted/noEvent, renderBody cleanup contract),
   events.findLatestEventForOrg, viewerBody (live countdown, cleanup return, core-reuse),
   phoneSummary (showChrome: true), projectorSurface (showChrome: false, data-surface="stage"),
   and demoActiveHeatPayload (2nd-use extraction) are all present and accurate. No
   reconstruction was needed; the session's initial concern was based on incomplete git
   history observation during earlier kb-sync work.

ROADMAP.md phase-status update correct: Phase 5 marked done, cross-surface AC listed as
last item closing Definition of Done. Status statement at top (line 3–7) accurately
reflects T5.1–T5.4 + two follow-ups + AC closure = Phase 5 complete. Matches CHANGELOG.md
dated entries exactly.

Full suite: 682 unit tests, 2 Playwright tests (one per project), lint/format clean.
No open items introduced by this session's verification.

---

# Changelog — Seduh Score Next

Backfilled 2026-08-21 for Phase 0 (this file didn't exist while T0.1–T0.3 shipped, all in
the same session). From here forward, an entry lands before any session that ships code
closes.

---

## Known open items carried into Phase 4 · 2026-08-29 (T4.2's heat-generation resumability gap closed)

Closes the known open item ROADMAP.md tracked since T4.2: a `generateHeatsRandom`
failure partway through left a stage stuck — some heats/entries committed, some cuppers
still unplaced — with no in-app repair path. `createHeats` has no batch-level atomicity,
so this is a real, expected failure mode on this project's "unreliable venue wifi"
design target, not an edge case. The screen already detected and honestly reported the
incomplete state (T4.2's own review closed that half of the gap); this closes the other
half — actually fixing it, not just reporting it.

**`heats.js` needed zero changes.** `generateHeatsManual`/`buildHeatPlansFromAssignments`
were already idempotent and conflict-checked (pre-existing code): submitting the same
correct assignment twice is a safe no-op, a colliding station is rejected before any
write, and every constraint that protects the normal manual-generation path already
protected a resumption attempt too. The actual gap was purely a UI-availability one —
`heatsScreen.js`'s manual-assignment form was only ever rendered when zero heats existed
yet, never in the "incomplete generation" branch, even though the underlying logic was
already safe to use there.

**`renderManualAssignmentForm` gained an optional `existingAssignments` parameter**
(`Map<entryId, {heatNumber, station}>`): a cupper already committed to a heat now
renders as fixed text (`Heat N · Station X (already placed)`) instead of editable
inputs, so `readManualAssignmentForm` never returns a value for them at all — the
organiser only fills in what's genuinely still missing. A new `buildManualForm`
closure in `mountHeatGenerationScreen` (factored out — both the "zero heats yet" branch
and the "generation incomplete" branch need identical submit-wiring, differing only in
what `existingAssignments` they pass) re-attaches each already-placed cupper's real
assignment before calling `generateHeatsManual`, so its "every stage entry assigned
exactly once" check is still satisfied without asking anyone to re-type what's already
correct. The unsafe "Generate heats (random)" button remains absent from the incomplete
state, unchanged — reshuffling the whole roster fresh is still never safe once any
heats exist.

**Four parallel subagent reviews** (`module-boundary-checker`, `ui-accessibility-reviewer`
at 360px, `test-auditor`, `code-reviewer` — no migration/RLS/scoring/outbox change, so
`schema-guardian`/`security-reviewer`/`scoring-auditor`/`offline-sync-auditor` didn't
apply): `module-boundary-checker` came back clean, confirming `heats.js` is genuinely
untouched (the fix belongs entirely in the screen layer, since the underlying business
logic was already safe). The other three found real issues, all closed:

- **`code-reviewer`**: a formatting gap (`npx prettier --write` needed on the touched
  files) — a direct Definition of Done violation, fixed. Also suggested renaming the new
  `attachManualForm` closure to `buildManualForm`, matching this file's own `render*`
  naming convention more closely (it builds a form and wires a handler, doesn't attach
  anything to the DOM itself) — applied.
- **`ui-accessibility-reviewer`**: the "Finish assigning the rest" heading was
  structurally disconnected from the card explaining _why_ it has fewer inputs than "N
  cupper(s) in this stage" — an entire `renderHeatsList` card sits between them, so a
  screen-reader user navigating by heading, or a sighted user scanning straight to the
  form, had no link back to that context. Fixed by repeating the remaining count
  directly in the heading (`Finish assigning the rest (${missing} remaining)`).
- **`test-auditor`**: two real gaps. (1) The test asserting the resumed submission
  "doesn't disturb the already-placed cupper" never actually checked that cupper's final
  station — its only assertions (`.heats-list` present, "incomplete" text gone) would
  have passed even if the merge silently dropped or altered that cupper's assignment.
  Fixed by asserting the final rendered station directly and the exact insert payload
  sent (only the genuinely new entry, never the already-placed one). (2) No test covered
  the negative case a genuinely new UI path this fix opens: a still-missing cupper
  submitting a station that collides with an already-placed cupper's real one. Fixed
  with a new test proving `buildHeatPlansFromAssignments`'s existing per-heat
  station-uniqueness check fails safely through this path — rejected before any write,
  clear error feedback, no data corruption.

**Live-verified in a real browser**, not just unit tests: `heatsScreen.preview.html`
gained "Mount (fresh, no heats)"/"Mount (partial generation — needs resume)" demo
buttons (demo-only, not part of the shipped module graph). Confirmed a stuck stage (1 of
4 cuppers placed, one already at Heat 1/Station A) renders the already-placed cupper as
fixed text and the other three as editable rows; filling in the remaining three and
submitting completed generation cleanly against a realistic fake Supabase client (real
query filtering/insert logic, not a mock) — the already-placed cupper stayed exactly
where it was, and the final state matched the normal "generation complete" view
byte-for-byte, with focus correctly landing on the "Generated heats" heading via the
screen's existing `focusAfterRender` pattern, unchanged.

Full suite re-verified after every fix: 700/700 Vitest tests, lint clean, format clean.

---

## Known open items carried into Phase 4 · 2026-08-29 (setupScreen/rosterScreen hung-load timeout/retry gap closed)

Closes the known open item ROADMAP.md tracked since the roster-registration screen's own
review: `setupScreen.js` and `rosterScreen.js` both render a proper "Loading…" state on
mount (no spinner-as-resting-state), but `loadPersisted()` had no timeout in either — on
this project's own "unreliable venue wifi" design target, a request that neither
resolves nor rejects left the organiser stuck indefinitely, with no retry affordance.
Cross-cutting across two already-shipped screens, deliberately not fixed inline at the
time — noted for "a dedicated pass (a shared timeout/retry primitive, probably in
`core/`) if it proves to matter before October."

**New `core/timeout.js`** exports `raceTimeout(promise, ms)` and
`DEFAULT_LOAD_TIMEOUT_MS` (10000, matching `viewer-shell.js`'s own `REFRESH_TIMEOUT_MS`).
Not written fresh — `core/viewer-shell.js` already had a private, unexported function
doing the exact same thing (racing `findLatestEventForOrg` against a timeout, T5.2/T5.3
follow-up work); extracted on its 2nd verbatim use, and `viewer-shell.js` now imports the
shared version instead of keeping its own copy. The rejected timeout carries
`.timedOut = true` so a caller can show a distinct "this is taking a while" message
instead of `describeError()`'s generic failure text — a timeout never reaches the
server, so there's no real error shape `describeError()` could read anything from.

**Both screens gained an `attemptLoad()` function**, replacing their previous inline
mount-tail `renderLoading(); try {...} catch {...} render();` block: races
`loadPersisted()` against `raceTimeout`/`DEFAULT_LOAD_TIMEOUT_MS`, guards re-entrancy
with a `loading` boolean (the same in-flight discipline `handleSave()`'s own `saving`
flag already uses), and sets a distinct timed-out message when `err.timedOut` is true.
`renderLoadError()` (already existed, previously just a static message) gained a real
`Retry` button (`btn btn-outline tap-target`) that calls `attemptLoad()` again.

**Four parallel subagent reviews** (`module-boundary-checker`, `ui-accessibility-reviewer`
at 360px, `test-auditor`, `code-reviewer` — no migration/RLS/scoring/outbox change, so
`schema-guardian`/`security-reviewer`/`scoring-auditor`/`offline-sync-auditor` didn't
apply): `module-boundary-checker` came back clean (confirmed `core/timeout.js` is
genuinely format-agnostic and a future format could reuse it unedited for its own
initial-load timeout). The other three found real issues, all closed:

- **`ui-accessibility-reviewer`**: a successful Retry silently dropped focus to
  `<body>` — `attemptLoad()`'s success path never set `focusAfterRender`, and
  `renderLoading()`'s own `root.innerHTML = ''` destroys the focused Retry button with
  nothing taking its place once the reload succeeds. Fixed by setting
  `focusAfterRender = '#stage-plan-heading'` / `'#roster-heading'` on success, matching
  the pattern `addStage()`/`removeStage()`/`moveStage()` and their roster-screen
  equivalents already use. Also closed two minor consistency gaps found in the same
  review: the Retry button was missing `type="button"` (every other non-submit button in
  both files already sets it explicitly), and the loading state itself took no focus
  during a retry-triggered wait, leaving a keyboard/screen-reader user with total silence
  for up to 10 seconds after clicking Retry with no confirmation the click registered —
  fixed by giving the loading status node `tabindex="-1"` and a `.focus()` call too,
  mirroring `renderLoadError()`'s own existing handling.
- **`test-auditor`**: the "Retry re-attempts the load" tests didn't actually prove a
  reload happened — asserting only "no error tone, heading says X" would still pass
  against a broken no-op retry handler that just cleared the error state, since the
  succeeding fixture's zero-content state rendered identically to the screen's own
  default empty state. Fixed by seeding the succeeding fixture with real content (one
  stage / one cupper) and asserting on it specifically. Also found the fake-timer "times
  out" tests only proved _a_ timeout eventually fired, not that it was bound to
  `DEFAULT_LOAD_TIMEOUT_MS` specifically — a regression forking a shorter hardcoded value
  into `attemptLoad()` would still have passed. Fixed by asserting the screen is still
  loading one millisecond before the full constant elapses, then advancing the last
  millisecond. Both screens' tests also gained a direct focus assertion after the
  accessibility fix above, proving the fix rather than just applying it.
- **`code-reviewer`**: one real, verifiable finding — `core/timeout.test.js`'s
  "propagates the original rejection" test used a `queueMicrotask`-deferred rejection
  specifically to avoid a Node unhandled-rejection warning; the reviewer empirically
  re-tested with a plain `Promise.reject()` (both in isolation and against the full
  697-test suite) and confirmed no warning actually occurs — the workaround's stated
  justification didn't hold for this codebase's actual runtime. Simplified back to a
  plain `Promise.reject()`, removing the unwarranted complexity.

**Live-verified in a real browser**, not just unit tests: both `setupScreen.preview.html`
and `rosterScreen.preview.html` gained "Mount (normal)/(load fails)/(load hangs — real
10s timeout)" demo buttons (demo-only, not part of the shipped module graph). Confirmed
the error state renders with a working Retry button, Retry correctly re-invokes the
load, and — most importantly — a genuine, entirely unmocked real 10-second timeout fires
correctly in the browser and shows the distinct "taking longer than expected" message.

Full suite re-verified after every fix: 697/697 Vitest tests, lint clean, format clean.

---

## Known open items carried into Phase 4/5 · 2026-08-29 (cross-module outbox handler-map composition gap closed)

Closes the known open item ROADMAP.md/CHANGELOG.md tracked since the T4.3/T4.4
outbox-wiring follow-up: `core/outbox.js`'s `flushOutbox()` registers a handler map per
call, not globally, so `timing.js`'s shared `timingHandlers()` map (covering
`start_heat`/`record_heat_time`/`auto_max_heat`) was never shared with `scoring.js`'s own
`confirm_heat` handler or `publish.js`'s own `publish_session` handler. A flush triggered
with only one module's narrow map couldn't process an operation type queued by a
different module — hitting the FIRST queued operation of an unrecognized type throws "no
handler registered," an ordinary (non-permanent) failure that stops the whole flush pass
before ever reaching the operation the caller actually wanted flushed. `offline-sync-auditor`
assessed this as serious enough to be the next task, not a further-deferred note: the
primary offline workflow this project cares about — a heat timed AND scored fully offline
in one session — enqueues `start_heat`/`record_heat_time` operations first, then
`confirm_heat` behind them; scoring the heat would silently stall forever if the
connection came back only once the organiser reached the scoring screen, with no
app-level recovery.

**`core/outbox.js` gained an exported `buildRpcHandler(client, type)`** — a generic
RPC-wrapping-as-permanent-outbox-handler helper, extracted from three near-identical
~10-line blocks that had each been hand-rolled independently in `timing.js`, `scoring.js`,
and `publish.js` (same `err.message`/`err.code`/`err.details`/`err.permanent = true`
shape, same "an RPC-level error is a rejection of this exact payload, a network-level
rejection stays retryable" distinction). Purely generic RPC mechanics with zero knowledge
of any operation type's name or payload shape, so it belongs in `core/`, not a format —
verified by `module-boundary-checker`.

**Each owning module now exports its own named handler-builder**: `timing.js`'s
`timingHandlers(client)` (unchanged shape, now built via `buildRpcHandler`), a new
`scoring.js`'s `confirmHandlers(client)`, and a new `publish.js`'s `publishHandlers(client)`.
`publish.js` stays in `core/`, not a format module — `publish_session` is itself
format-agnostic (its own `p_format` parameter carries the format, per the module's own
original design comment).

**New `formats/cup-taster/outboxHandlers.js`** is the composition point:
`cupTasterOutboxHandlers(client)` spreads all three maps into one. Deliberately NOT
imported back into `timing.js`/`scoring.js`/`publish.js` themselves (that would be a
circular module dependency) — instead, each of those three modules' write functions
(`submitTimingOperation` and its three public callers `startHeat`/`recordTap`/
`autoMaxRemainingEntries`, `timingManual.js`'s `recordManualTime`, `scoring.js`'s
`submitConfirmHeat`, `publish.js`'s `publishSession`) gained an optional trailing
`handlers` override — when passed, it REPLACES that function's own narrow default map;
when omitted, behavior is exactly as before (backward compatible with every existing
test and caller). Five real screen call sites (`timingScreen.js`'s
`autoMaxRemainingEntries`/`startHeat`/`recordTap` calls, `timingManualScreen.js`'s
`recordManualTime` call, `scoringScreen.js`'s `submitConfirmHeat` call) now pass
`cupTasterOutboxHandlers(client)` in, so a flush triggered from any of them can process
any of the 5 queued Cup Taster operation types, not just its own.

**Four parallel subagent reviews** (module-boundary-checker, offline-sync-auditor,
test-auditor, code-reviewer — no migration/RLS/scoring-module change, so
`schema-guardian`/`security-reviewer`/`scoring-auditor` didn't apply): `module-boundary-checker`
came back clean (confirmed the composition respects §6 both directions — no format
logic leaked into `core/`, and a future format could build its own equivalent
`outboxHandlers.js` without editing any of `core/outbox.js`, `core/publish.js`, or Cup
Taster's own files). The other three found real issues, all closed:

- **`code-reviewer`**: a stale comment in `timing.js`'s `describeTimingConflict` still
  referenced the removed private `rpcHandler` function by name. Fixed to point at
  `buildRpcHandler` in `core/outbox.js`.
- **`offline-sync-auditor`**: `flushOutbox`'s reentrancy guard (`inFlightFlush`) discards
  a losing concurrent caller's `handlers` argument entirely — a second caller arriving
  while a flush is already in-flight just gets back the SAME promise, built from
  whichever caller's map won the race. Harmless today (every real call site now passes
  the same composed map, so it doesn't matter whose object reference wins), but a real,
  undocumented constraint that a future narrower-map call site racing one of today's five
  could silently reintroduce this exact stall. Not fixed (no current code path triggers
  it, and a real fix would mean redesigning the reentrancy guard itself, out of scope for
  this task) — documented with a comment on `inFlightFlush` so a future author doesn't
  reintroduce it unknowingly.
- **`test-auditor`**: three test-quality gaps. (1) The `cupTasterOutboxHandlers`
  composition test only checked key names, not that the values were real handler
  functions — would have passed even if e.g. `publishHandlers()` silently degraded to
  `{ publish_session: undefined }`. Fixed by asserting every value is a function. (2)
  Only 2 of the 5 composed operation types (`start_heat`/`confirm_heat`) were ever
  exercised through an actual flush — the other 3 (`record_heat_time`/`auto_max_heat`/
  `publish_session`) were only proven present by the key-name check. Fixed with a new
  test flushing all 5 through the composed map in one pass, in FIFO order. (3)
  `buildRpcHandler`'s "network rejection isn't marked permanent" test called the handler
  twice (once for a `rejects.toThrow` check, again in a bare `try/catch` for the
  `.permanent` check) — traced and confirmed it did actually run and prove the claim, but
  flagged as needlessly fragile to read. Fixed by collapsing to one invocation, one
  `.catch()`, both assertions on the same rejection, guarded by `expect.assertions(2)` —
  note this required using `.catch()` rather than `rejects.toMatchObject({ permanent:
undefined })`, since `toMatchObject` does not treat an absent property as matching an
  explicit `undefined` (discovered when the first attempt at this collapse failed for
  exactly that reason).

Full suite re-verified after every fix: 689/689 Vitest tests, lint clean, format clean.

---

## Known open items carried into Phase 4 · 2026-08-29 (T4.2's station-uniqueness gap closed at the DB level)

Closes the known open item ROADMAP.md tracked since T4.2: station-uniqueness-per-heat was
enforced at the application layer only (`buildHeatPlansFromAssignments` validates it
pre-write), with no DB-level backstop against two genuinely concurrent requests each
independently passing that check and then both writing the same `(heat_id, station)` pair.
`scoring-auditor` flagged this as low-risk at the time (T4.2 is an organiser-driven setup
screen, not the live-heat timing surface) and it was noted rather than fixed.

**New migration** (`20260829100000_ct_heat_entries_station_unique.sql`) adds
`ct_heat_entries_heat_station_unique unique (heat_id, station)` plus `alter column
station set not null`. Named explicitly rather than left to Postgres's auto-generated
name, since `station` is never null on a row this app actually writes
(`buildHeatPlansFromAssignments` throws before any insert if an assignment is missing
one).

**`heats.js`'s `ensureHeatEntries` updated**: the table now carries two unique
constraints that need different handling on conflict. An `entry_id` collision (the
pre-existing `unique(heat_id, entry_id)`) means someone else already inserted the exact
row this call also wants — safe to retry, since the next attempt's `diffAgainst` sees it
and moves on. A `station` collision means two _different_ cuppers are racing for the
_same_ station — retrying the identical insert would just fail identically forever, so a
new `isStationConflict()` helper distinguishes it (matching "station" in the Postgres
error's DETAIL/message) and fails fast with a clear message instead of quietly burning
through the bounded-retry budget toward the generic "gave up" error a genuine `entry_id`
race also produces.

**Verified empirically, not just by reading the migration**: connected directly to the
local Postgres instance (`docker exec` into the Supabase container) and triggered a real
violation, confirming the error DETAIL (`Key (heat_id, station)=(...) already exists.`)
and constraint name (`ct_heat_entries_heat_station_unique`) both contain "station",
making the string-match discriminator reliable rather than assumed.

**Tests**: three new pgTAP assertions in `002_cup_taster_tables.sql` (plan grown 6→9) —
a same-station collision in the same heat is rejected, a genuinely different station in
the same heat is unaffected, and the same station label in a _different_ heat is
unaffected (uniqueness is scoped per heat, not global). A new Vitest case in
`heats.test.js` proves the fail-fast path issues exactly one insert attempt on a station
conflict, never retries.

**A real gap was found and closed during review, not before shipping**: the migration's
first version reasoned that Postgres's "NULL is never equal to another NULL" UNIQUE
semantics "never come into play here," since the app never writes a null `station`.
`schema-guardian` proved that reasoning wrong at the DB level — a plain
`unique(heat_id, station)` places _zero_ constraint on rows where `station IS NULL`
(verified empirically: two such rows insert with no error), so the new invariant this
migration exists to add was itself only app-layer-enforced for the null case, exactly
the kind of guarantee the migration was meant to stop relying on. Fixed by adding `alter
column station set not null` to the same migration (still local-only and unpushed, so
safe to edit directly rather than needing a follow-up migration) plus a matching
rollback. This broke five pre-existing pgTAP fixtures across `002_cup_taster_tables.sql`,
`003_rls.sql`, `005_confirm_heat.sql`, and `007_timing_outbox_rpcs.sql` that inserted
`ct_heat_entries` rows without a `station` value — each fixed by adding an explicit
station letter, taking care that two entries sharing a heat in the same fixture never
collide with each other or with a later test's own station assertions (one such
collision surfaced immediately on re-running the suite and was fixed by moving a
tiebreak fixture off station `'A'`).

Separately, `test-auditor` suggested strengthening the station-collision `throws_ok` to
check the exact Postgres error message, not just its SQLSTATE — the original version
only proved _some_ 23505 error occurred, relying on the surrounding fixture (not the
assertion itself) to guarantee it was really the station constraint and not the
pre-existing `entry_id` one. Applied.

Full suite re-verified after both fixes: 113/113 pgTAP assertions, 681/681 Vitest tests,
lint clean.

---

## Known open items carried into Phase 4/5 · 2026-08-29 (T4.3/T4.4 timing screens now outbox-wired)

Closes the known open item ROADMAP.md tracked since T4.3/T4.4: the app-mode tap timer and
manual-entry screens wrote directly to `ct_heats`/`ct_heat_entries` instead of through
Phase 3's offline outbox — the exact "live, time-pressured screen" the outbox exists for,
deliberately deferred at the time as its own focused pass.

**Three new RPCs** (`supabase/migrations/20260828150000_timing_outbox_rpcs.sql`) —
`start_heat`, `record_heat_time`, `auto_max_heat` — mirror `confirm_heat`'s own
idempotent, org-scoped shape (the `processed_operations` ledger, a two-check org-scoping
pattern). `started_at` stays client-timestamp-supplied, not server `now()`, to preserve
the already-shipped, already-Playwright-tested cross-surface agreement design.
`record_heat_time`'s `p_conflict_policy` ('reject' for a real tap, 'overwrite' for a
manual correction) and `p_expected_heat_status` check close the gap a bare per-entry
null-check can't: once a heat has left the status a queued write assumed it was still in,
every already-recorded entry is frozen, most importantly once `confirm_heat` has run.

**`timing.js`/`timingManual.js` rewritten**: every write now captures its payload (a
timestamp, a clamped `elapsed_secs` via the same sole `clampElapsed()` path as before) at
the moment of the action, never re-derived at flush time — a tap made while offline no
longer inflates by however long the device was offline. Each write takes the caller's own
already-rendered local `heat`/`heatEntry` state as a parameter instead of re-reading the
server first, so recording a tap has no network dependency of its own. A shared
`timingHandlers(client)` map (not per-caller) is used by every flush in both modules,
closing a real gap a single-type handler map would have hit: `core/outbox.js` registers
handlers per `flushOutbox()` call, not globally, so a flush call scoped to only its own
caller's operation type would stall on any other timing operation queued ahead of it —
e.g. an app-mode heat that's started, then rapid-tapped, while offline.

**`timingScreen.js`/`timingManualScreen.js`** gained a "ground truth over flush
bookkeeping" pattern (`pendingHeatCheck`/`pendingEntryCheck`): an action sets a pending
check, and the _next_ render resolves it against freshly-reloaded state — comparing
against the _exact_ value a write attempted (not a bare null-check, which can't
distinguish "my write took" from "someone else's write is what's actually sitting
there"). A genuine conflict surfaces to the organiser via a new `describeTimingConflict()`
translator (mirroring `scoring.js`'s `describeConfirmError`), reading "refresh this page"
rather than "reload the heat" — found in review (ui-accessibility-reviewer): neither
screen has a router/reload affordance yet, so the message can only honestly ask for what
the organiser can actually do today.

**A real concurrency bug was found and fixed during review, not before shipping**:
`record_heat_time`'s advance-to-scoring check has no row locking in its first version —
two concurrent calls for a heat's last two entries could each run their own "is anyone
else still null" check against a snapshot that doesn't see the other's still-uncommitted
write (plain reads under READ COMMITTED don't block on an in-flight write to a _different_
row), landing both entries correctly but never flipping the heat to `scoring`. Fixed with
`perform ... for update` locking the parent heat row. A second pass (schema-guardian,
verified with two real concurrent `psql` sessions against the local stack, not just
pgTAP) found the fix itself was incomplete: `v_heat_status`/`v_already_set` were read
_before_ the lock and never refreshed after acquiring it, so a call delayed behind
another writer's lock (e.g. stuck behind `auto_max_heat`'s own sweep) could resume and
validate against stale data, silently overwriting an already-finalized value — exactly
the "frozen record" guarantee `p_expected_heat_status` exists to protect. Fixed by moving
the status/already-set read to _after_ the lock; re-verified with the same two-session
reproduction (confirmed the delayed transaction now correctly raises the conflict instead
of silently succeeding) and the full pgTAP suite (110/110).

**Four parallel subagent reviews** (schema-guardian, security-reviewer, scoring-auditor,
offline-sync-auditor, module-boundary-checker, test-auditor, ui-accessibility-reviewer,
code-reviewer — the full set, given the change touches a migration, RPCs, the outbox,
`elapsed_secs` handling, and UI) surfaced, beyond the concurrency fix above:

- **test-auditor / code-reviewer** (independently, both caught it): `timingManualScreen.js`'s
  ground-truth check had regressed to a bare `!= null` comparison instead of the exact-value
  comparison its own comment described — a corrected/overwritten entry that already had a
  prior non-null value would report a false "recorded" success even when the RPC actually
  rejected the write. Fixed to match `timingScreen.js`'s own correct implementation; the
  existing test for exactly this scenario (already written, already correct) went from red
  to green.
- **code-reviewer**: `recordTap`/`recordManualTime` built byte-for-byte identical
  `record_heat_time` payloads independently; extracted a shared
  `buildRecordHeatTimePayload()` helper. A stale demo-harness comment referencing a
  "+ Force duplicate tap" button that didn't exist — closed by actually adding real
  interactive "force a conflict" demo controls to both `timingScreen.preview.html` and
  `timingManualScreen.preview.html` (mutating the fake client's own `db` directly, the
  same shape a genuinely concurrent write from elsewhere would take), which also closes
  the gap code-reviewer separately noted: neither harness previously had any way to
  interactively trigger the conflict scenario, which is part of why the bug above went
  unnoticed by manual testing.
- **schema-guardian**: two pgTAP coverage gaps closed — `start_heat`'s own
  `processed_operations` ledger replay path was untested (the existing "safe no-op" test
  used a _different_ operation id, only proving the business-logic no-op, not the ledger
  check itself), and `record_heat_time`'s `p_conflict_policy` validation guard had no
  test. Both added (110 pgTAP assertions, was 107).
- **offline-sync-auditor**: confirmed the shared-handler-map fix is correct and complete
  for every write this task touches, but flagged that it is _not_ shared with `scoring.js`'s
  `confirm_heat` or `publish.js`'s `publish_session` — a pre-existing gap (present since
  `scoring.js` first used its own single-type handler map), not introduced by this task,
  but assessed as more operationally serious than a documented-and-deferred note: the
  primary offline workflow this project is built for (a heat timed _and_ scored fully
  offline in one session) can genuinely stall a `confirm_heat` flush behind earlier-queued
  timing operations, with no app-level recovery mechanism anywhere yet (`computeSyncState`
  has zero consumers). Not a data-corruption risk — FIFO ordering is preserved — but
  recommended as the immediate next follow-up rather than carried forward again. See
  ROADMAP.md's own updated note.

Full suite: 680 Vitest tests, 110 pgTAP assertions (all 8 files), lint/format clean
(repo-wide). Live-verified in-browser: app-mode start/tap/auto-max-at-expiry and
manual-mode save/correct/complete-the-heat, all with no console errors.

---

## Phase 5 — Live surfaces · 2026-08-28 (viewer-shell heading-hierarchy follow-up)

### src/core/viewer-shell.js, viewer-shell.css, viewer-shell.test.js

Closes a real `ui-accessibility-reviewer` finding from T5.4's own review: the mounted
viewer-shell tree had no `<h1>` anywhere. `renderChrome()`'s identity name (showChrome:true,
the phone surface) is now a real `<h1 class="viewer-chrome-name">`, not a `<span>` — a
screen reader's heading navigation previously had nothing to land on, and viewerBody.js's
own `<h2>` was the page's de facto first heading with nothing to nest under.
`viewer-chrome-name` gained `margin: 0` (same reset every other real `<h1>` in this
codebase uses, e.g. `heatsScreen.css`'s `.screen-container h1`) so the badge doesn't shift.

`showChrome:false` (the projector) has no identity band to host a visible heading in —
`mountViewerShell`'s own setup adds a visually-hidden `el('h1', { className: 'sr-only', ... })`
as the container's first child instead, mutually exclusive with the chrome path (never
both, never neither). Both sites reference one `APP_NAME` constant rather than repeating
the literal.

Four parallel subagent reviews (`module-boundary-checker`, `code-reviewer`,
`test-auditor`, `ui-accessibility-reviewer`) ran against the initial fix. Three real
findings came back and were fixed in a second pass:

- `test-auditor`: the re-render-duplication test only covered `showChrome:false` — a
  hypothetical duplication bug in the chrome-rebuild path (e.g. one gated on
  `connectionLost`) would go undetected. Added the symmetric `showChrome:true` test;
  confirmed via mutation testing (temporarily changed the chrome render to
  `appendChild` instead of `replaceChildren`, confirmed the new test fails with
  "expected length of 1 but got 2", reverted, confirmed it passes again).
- `code-reviewer`: the `'Seduh Score'` literal was duplicated across both `<h1>` call
  sites — extracted to `const APP_NAME`. A follow-up pass from the same reviewer found
  the first attempt at consolidating the duplicated rationale comment hadn't actually
  shortened the second copy to a cross-reference — fixed properly on the second pass.
- `ui-accessibility-reviewer`: approved outright, with extensive live Playwright-based
  verification (both surfaces, 360px, real accessibility tree via `ariaSnapshot()`,
  computed layout confirming zero vertical shift from the `margin:0` reset, `.sr-only`
  confirmed genuinely exposed to assistive tech). Flagged one pre-existing, out-of-scope
  gap for future awareness: `viewerBody.js` could theoretically skip the `<h2>` level if
  a payload ever has standings but no stage — not touched by this fix.

Full suite: 686 unit tests (was 685), lint/format clean (repo-wide, not `src/`-scoped).
Live-verified in-browser post-fix: both `phoneSummary.preview.html` (visible `<h1>`) and
`projectorSurface.preview.html` (hidden `<h1>`) render "Seduh Score" correctly with no
regression to the "Not live"/holding-state content.

Verifier: `code-reviewer` (second pass, clean). `test-auditor`'s planned second-pass
re-check hit the account's monthly spend limit mid-run and did not complete — the fixes
it would have re-checked were already independently confirmed via this session's own
mutation testing above, so the gap is in a second opinion, not in unverified code.

---

## Phase 5 — Live surfaces · 2026-08-28 (cross-surface Playwright AC)

### tests/e2e/cross-surface-countdown.spec.js

Closes the handoff's own outstanding AC across T5.3/T5.4 (§14): "Playwright test driving
organiser + projector + phone simultaneously, proving all three agree on remaining time
within tolerance." This is the last piece of Phase 5's own Definition of Done — T5.1
through T5.4 (plus the holding-state follow-up) built everything the AC needs; this task
builds the AC's own proof.

`tests/e2e/cross-surface-countdown.spec.js` (new): three separate Playwright browser
contexts — not one page with three panels — driving the existing, already-reviewed demo
harnesses directly (`timingScreen.preview.html` for the organiser, `projectorSurface.
preview.html`, `phoneSummary.preview.html`). Starts a real heat on the organiser side,
reads back the REAL `started_at`/`duration_secs` that action set (not a timestamp the
test invents), publishes those exact values to the other two contexts, then checks
agreement (±2s tolerance) at three points: mid-heat, inside the urgent window (also
confirming all three independently reach `data-urgent="true"`), and past expiry.

Two real environment findings, worked through before writing any test code: `vite build`
only outputs `index.html` (confirmed directly — `dist/` has no `.preview.html` files),
so this test needs the dev server, not the existing prod-preview Playwright config; and
running the test for real (not assumed) revealed that past expiry, the organiser's own
`timingScreen.js` auto-maxes every cupper and swaps its whole view to a "Timing complete"
summary, while the read-only viewers just freeze their countdown at 0:00 — a genuine
divergence the test's final checkpoint has to prove correctly rather than force a
same-shape comparison across.

`playwright.config.js` (extended): a second project (`dev-harnesses`, targeting `npm run
dev`) alongside the existing `built-app` project (`smoke.spec.js`, unchanged, still
targeting the real production build). `src/formats/cup-taster/timingScreen.preview.html`,
`phoneSummary.preview.html`, `projectorSurface.preview.html` (extended): each gained a
small, clearly-commented `window.__e2e` test-only hook so the Playwright test can read the
organiser's real state and publish matching values to the other two contexts — none of
these hooks are reachable from anywhere outside each file's own script block.
`src/formats/cup-taster/demoActiveHeatPayload.js` (new): `buildActiveHeatPayload()`,
extracted from `phoneSummary.preview.html`/`projectorSurface.preview.html`'s previously
near-identical inline payload builders on its 2nd verbatim use, per this project's own
convention — `standings` stays a caller-supplied argument rather than embedded here, since
each harness already owns its own `standings` fixture reused by several other demo
buttons. `.github/workflows/ci.yml` (extended): a new `playwright` job (self-contained —
its own checkout/build, since GitHub Actions jobs don't share build output) running
`npm run test:e2e`.

Verifiers: `module-boundary-checker`, `test-auditor`, `code-reviewer` — three agents in
parallel (no UI change, so `ui-accessibility-reviewer` didn't apply; no migration/RLS/
scoring-module change either). `module-boundary-checker` came back clean. The other two
found real issues, all fixed:

1. **`code-reviewer`: browser-context creation happened OUTSIDE the test's own try/finally**
   — a throw partway through the three `newContext()`/`newPage()` calls (three simultaneous
   contexts under real resource pressure is exactly the kind of thing that can fail) would
   leak whichever context(s) had already been created, since Playwright doesn't auto-track
   manually created contexts. Fixed by moving creation inside `try` and guarding the
   `finally` block's closes with optional chaining.
2. **`code-reviewer`: `buildActiveHeatPayload` was duplicated verbatim across two files**,
   with nothing (lint, tests) to catch the two harnesses' demo states silently diverging
   from each other over time — exactly the "2nd verbatim use" extraction trigger this
   project's own convention names. Extracted to `demoActiveHeatPayload.js`.
3. **`code-reviewer`: this AC-closing test never actually ran in CI** — `.github/workflows/
ci.yml` had no Playwright job at all (a pre-existing gap, not introduced by this task,
   but one this specific task's own DoD — "tests pass," continuously verifiable — depends
   on closing). Added the `playwright` job.
4. **`test-auditor` (the most significant finding, though the test's central property —
   detecting real disagreement — was independently re-verified and confirmed sound via the
   same mutation technique I'd already used myself): the past-expiry checkpoint proved
   "organiser reaches 'Timing complete'" and "viewers freeze at 0:00" as two disconnected
   facts, never tied back to the SAME zero-crossing event** — exactly the boundary where a
   real timing bug would be easiest to hide behind two correct-looking but uncorrelated
   proxies. Fixed by also asserting every organiser-side heat entry auto-maxed to exactly
   `durationSecs` (the real clamp) AND that `core/countdown.js`'s own `isExpired()` —
   the same pure function every surface's countdown already calls — independently agrees
   the real `(startedAt, durationSecs)` pair is expired right now.

Both new tests added during fixes (context-leak guard, the strengthened expiry check) were
verified the same way as the test's own central property: temporarily reverted, confirmed
the resulting failure, reverted back. Full suite: 682 unit tests, 2 Playwright tests (one
per project), lint/format clean. Live-verified in browser that the refactored "+ Active
heat" demo buttons still work correctly on both `phoneSummary.preview.html` and
`projectorSurface.preview.html` after the `demoActiveHeatPayload.js` extraction.

**Phase 5 is now fully done** — T5.1 through T5.4, the holding-state follow-up, and this
AC together close every item the handoff's own Definition of Done named for this phase.

---

## Phase 5 — Live surfaces · 2026-08-28 (follow-up — distinguishing "no event" from "not started" holding states)

### viewer-shell: noEvent vs notStarted

Closes a follow-up flagged by T5.3's own accessibility review: `viewer-shell.js`'s
holding states collapsed the handoff's two separately-named states (§8.4: "no event, not
started, started-but-nothing-published, connection lost") into one generic card, since the
module only ever read `live_sessions`, never `events`. Not introduced by T5.3, but T5.3 was
the first task to put this in front of a real audience-facing surface (the projector) where
the distinction would matter.

`src/core/events.js` (extended): `findLatestEventForOrg(orgId, client)` — a new read-only
query, existence-only by design. `events.status` (`draft`/`running`/`concluded`) exists in
the schema but nothing anywhere writes it yet, so it isn't a reliable "started" signal;
scoped with the user in advance to keep this simple — any event row at all counts as "there's
an event for tonight," full stop, no date/status filtering.

`src/core/viewer-shell.js` (extended): a `hasEvent` boolean, checked only while still false
(an active `live_sessions` row also latches it directly, without a query — an event that
exists doesn't stop existing), driving `computePhase()`'s new `'noEvent'` vs `'notStarted'`
(renamed from the old ambiguous `'empty'`) branch. A `raceTimeout()` helper (rejects on
timeout) sits alongside the existing `withTimeout()` (resolves with a sentinel) specifically
because `findLatestEventForOrg` throws rather than returning a `{data,error}` envelope —
reusing `withTimeout` would have let a timeout's sentinel object read as truthy at the call
site.

Verifiers: `module-boundary-checker`, `test-auditor`, `ui-accessibility-reviewer`,
`code-reviewer` — four agents in parallel (no migration/RLS/scoring-module change).
`module-boundary-checker` came back clean (confirmed the core-to-core `events.js` import is
legitimate, `findLatestEventForOrg`'s placement matches the file's existing convention, and
the `raceTimeout`/`withTimeout` split is a reasoned judgment call, not an unexplained
duplication). The other three found real issues, all fixed:

1. **`ui-accessibility-reviewer`: the new event-existence check ran sequentially after the
   primary `live_sessions` read, sharing its full 10-second timeout — silently doubling the
   module's own documented no-spinner-forever bound to ~20s on a slow-but-not-erroring
   network, under the same unlabeled "Connecting…" copy the whole time.** Fixed with its own
   materially shorter `EVENT_CHECK_TIMEOUT_MS` (4s) — proportionate to the check's own
   "purely cosmetic" framing — plus a new test proving the combined worst case (a slow
   live_sessions read followed by a hung events check) stays well under a naive doubled
   bound, not just that either leg times out in isolation.
2. **`code-reviewer`: `hasEvent` was written directly inside the try/catch, before the
   existing staleness guard (`seq !== requestSeq`) that the primary `session` write already
   respects** — a slower-resolving earlier check could still clobber a faster-resolving
   later one's answer, inconsistent with the file's own stated "a slower call must never
   clobber a faster one" invariant. Harmless today (an event never un-exists in this schema)
   but worth closing so the invariant actually holds uniformly. Fixed by computing into a
   local and gating the assignment behind the same guard.
3. **`test-auditor`: the `if (session) hasEvent = true` latch path — new surface introduced
   by this fix — had no direct test**, only inference from adjacent passing tests. Added a
   test proving a live_sessions row latches `hasEvent` without ever querying `events`, and
   that the latch survives the session disappearing again (reverts to `'notStarted'`, not
   back to `'noEvent'`). Verified via mutation testing (removing the latch line, confirming
   the new test fails, reverting) alongside the timeout fix's own new test (same technique).

46 tests in `viewer-shell.test.js` (44 → 46), 10 in `events.test.js` (7 → 10). Full suite:
682 tests, lint/format clean. Live-verified in browser via `viewer-shell.preview.html`
(reworked to start with zero events by default — the harness's own initial state now
demonstrates `'noEvent'` directly, with every publish/end action creating the demo event
first, matching real ordering) and a fresh-tab console check (the pane's own long-lived tab
had accumulated stale error entries from earlier edit iterations that a fresh navigate
didn't clear — confirmed via a brand-new tab instead, zero errors). `phoneSummary.preview.html`
and `projectorSurface.preview.html` also updated (defaulting to one existing event, since
neither demonstrates this distinction) to keep their own demo Supabase clients consistent
with the new `events` table dependency.

---

## Phase 5 — Live surfaces · 2026-08-28 (T5.3 — projector surface)

### projectorSurface + live countdown

Phase 5's third task, closing Phase 5's UI trio (viewer-shell, phone, projector). Researching
the handoff's own §8.3 first ("Cup Taster's payload is a standings table, so the projector
is far simpler than Throwdown's — no tree renderer, no scale-to-fit stage") settled the one
open design question from T5.4's own scoping notes: no fixed-logical-resolution canvas with
a JS-driven scale wrapper, just a plain full-viewport page relying on `data-surface="stage"`'s
existing `clamp()`-bounded typography.

That same research pass also surfaced a real scope gap: the handoff's own cross-surface AC —
"prove organiser, projector, and phone all agree on remaining time" — had no display logic
anywhere to satisfy it. Scoped with the user in advance: build the live countdown into the
**shared** `viewerBody.js` (not a projector-only feature), so T5.4's already-shipped phone
surface gets it from the same change instead of a second pass later.

`src/formats/cup-taster/projectorSurface.js`/`.css`/`.test.js`/`.preview.html` (new): the
thin projector-specific composition — `viewer-shell` + `viewerBody`, `showChrome: false`
(the legacy reference app's own projector precedent), `data-surface="stage"` set on the
caller's own root. `viewerBody.js` reused completely unedited, per the handoff's own module
table.

`src/formats/cup-taster/viewerBody.js`/`.css` (extended): a live countdown for an active
app-mode heat — `core/countdown.js`'s `remainingSecs`/`isExpired` + `core/duration.js`'s
`formatDuration`, mirroring `timingScreen.js`'s own established tick pattern (1s interval,
urgent threshold at 10s remaining). `mountViewerBody` now returns an optional cleanup
function, which required extending `core/viewer-shell.js`'s own `renderBody` contract
(below) to call it.

`src/core/viewer-shell.js`/`.css` (extended, already-shipped T5.2 code): a `renderBody`
cleanup-lifecycle contract — an optional returned function, called before every subsequent
re-render and again on `unmount()`, so a ticking interval never outlives the DOM node it
mutates (`body` rebuilds on every realtime event for the org, not just ones touching the
active heat).

Verifiers: `module-boundary-checker`, `test-auditor`, `ui-accessibility-reviewer`,
`code-reviewer` — four agents in parallel (no migration/RLS/scoring-module change this
task). `module-boundary-checker` came back clean (confirmed no format→core leak in the new
cleanup contract, no reimplementation of `core/countdown.js`/`core/duration.js`, and that
the tick-pattern similarity to `timingScreen.js` is a reasonable judgment call given the two
surfaces' real differences — organiser control panel vs. read-only viewer — not a
"CONVENTIONS.md 2nd-verbatim-use" violation). The other three found real issues, all fixed:

1. **Found live, before any review even ran: `.viewer-shell-body` was `display:flex` with
   the default row direction, completely untested throughout T5.2** since a holding card was
   always its only child. Once real content (multiple sibling sections: heading, table,
   active-heat card, recent-heats list) got appended, everything laid out side-by-side
   instead of stacked. Fixed with `flex-direction: column` + `gap`. `code-reviewer`'s own
   pass then caught a second-order issue in that fix: `align-items: center` shrank every
   section to its own intrinsic width and centered it independently — a full-width standings
   table sitting next to a much narrower, independently-centered active-heat card — fixed
   with `align-items: stretch` plus `align-self: center` on `.viewer-holding-card` alone, the
   one section that genuinely should stay narrow.
2. **`test-auditor`: the "freezes at 0:00 once expired" test never proved the interval
   actually stopped** — `remainingSecs`/`formatDuration` already floor at 0 regardless of
   whether the interval is still running, so a real leak would have passed unchanged. Closed
   with a `vi.getTimerCount()` assertion, and separately verified (via temporary mutation,
   reverted) that a bare `NaN`/malformed `durationSecs` produces a live "NaN:NaN" — the
   payload's own contract had no guard for a missing duration. `showsCountdown()` now
   requires `durationSecs != null`.
3. **`test-auditor`: `viewer-shell.test.js`'s two new cleanup-lifecycle tests proved cleanup
   was CALLED, never that it was called BEFORE the DOM wipe** — confirmed by temporarily
   swapping the order in both `render()` and `unmount()` (reverted after) and watching the
   original tests still pass either way. Rewritten so the cleanup closure itself observes
   DOM/root state at the moment it fires, which the swapped-order mutation now genuinely
   fails against (re-verified).
4. **`ui-accessibility-reviewer` (the most significant finding): `aria-live="off"` on the
   ticking countdown digits is correct and necessary (avoids a per-second announcement spam
   inside `viewer-shell.js`'s own polite live region), but it also silently swallowed the one
   thing a non-visual user actually needs — crossing into the urgent window, and the heat
   timing out.** `timingScreen.js` already solved this for the organiser's own screen with a
   one-shot feedback-region announcement; the read-only viewer had no equivalent. Fixed with
   a separate, explicit `aria-live="polite"` sr-only node inside the countdown, announced
   once per threshold crossing and once on expiry — never per-tick.
5. **`ui-accessibility-reviewer`: `.is-test-banner` doesn't scale for `data-surface="stage"`**
   — fixed at `--text-sm` (14px) while every other stage-mode text this task touches scales
   up specifically to "read from across a room." On the projector specifically — no chrome at
   all (`showChrome:false`) to compensate — this risked being the single smallest, least
   legible line of text on an otherwise room-legible screen, directly against D9's
   "unmistakable" bar. Fixed with a `[data-surface='stage']` `clamp()` override in `base.css`
   (size only, never color/palette — the banner's own module comment already documents why
   the test-violet stripe stays fixed across both surface modes; that reasoning doesn't
   extend to font-size).
6. **`code-reviewer`: an ordering hazard in `mountViewerBody` — if `renderRecentHeats`
   (side-effect-free) threw partway through construction AFTER `renderActiveHeat` had already
   started a live countdown's `setInterval`, the exception would propagate before the cleanup
   handle was ever returned, leaking the interval permanently.** Fixed by building
   `renderRecentHeats` first (still appended last, in the original visual order) — a throw
   there can now never leave an already-started interval orphaned.
7. **`code-reviewer`: the `bodyCleanup = renderBody(...) ?? null` normalization was provably
   redundant** — `bodyCleanup?.()`'s optional chaining already tolerates `undefined`
   identically to `null`, and no test could distinguish the two. Simplified.

41 tests in `viewerBody.test.js` (28 → 41), 39 in `viewer-shell.test.js` (34 → 39), 4 new in
`projectorSurface.test.js`. Full suite: 672 tests, lint/format clean. Live-verified in
browser across both surfaces: live countdown ticking and freezing correctly, urgent/expiry
non-visual announcements firing exactly once each (confirmed via direct DOM inspection of
the `aria-live="polite"` node's text), the stretched full-width layout with holding-card
centering preserved, the stage-mode `is_test` banner at its new size, and zero console
errors — including a full regression pass of T5.2's own `viewer-shell.preview.html` harness
(stub `renderBody`, no cleanup returned) and T5.4's `phoneSummary.preview.html`, both
unaffected by every core/-level change here.

**Follow-ups flagged, not fixed here (both spawned as separate tasks):** the mounted viewer
tree still has no `<h1>` anywhere (T5.4's own already-tracked gap, unchanged by this task —
confirmed it isn't worse for `showChrome:false`, since the chrome name span was never a real
heading either); and `viewer-shell.js`'s holding states still collapse the handoff's two
separately-named "no event" / "not started yet" states into one generic card — a pre-existing
T5.2 design gap (`computePhase()` never reads `events`), newly relevant now that a real
audience sees it on the projector.

---

## Phase 5 — Live surfaces · 2026-08-28 (T5.4 — phone summary surface)

### viewerBody + phoneSummary

Phase 5's fourth task. Researched the legacy v4.x app's own (never-shipped-standalone)
Cup Taster audience view — `rAudienceLbHTML()`/`rAudienceHeatHTML()`, only ever an
operator-device overlay, never a real live surface — for the content SHAPE this task
ports; nothing about how it was delivered carries over. Scoped with the user as
logic/content-renderer only, matching T5.1/T5.2's own precedent: nothing wires a real
`publishSession()` call from any existing screen yet, so the `live_sessions.payload`
shape this task defines is a new contract this task invents, not yet built by anything
else.

`src/formats/cup-taster/viewerBody.js`/`.css` (new): `mountViewerBody(container,
payload)` — the `renderBody` callback `core/viewer-shell.js` (T5.2) plugs in once real
content exists. A standings table (reusing `standingsScreen.css`'s `.standings-table`
unedited, its third consumer), an active-heat panel with per-cupper status chips
(running/done/maxed), and a short recent-results list. Deliberately Cup-Taster-specific
(per the handoff's own module table), meant to be shared unedited by T5.3's projector.
`src/formats/cup-taster/phoneSummary.js` (new): the thin phone-specific composition —
`viewer-shell` + `viewerBody`, `showChrome: true` (the phone surface's own defining
choice; T5.3 omits it). Both demonstrated via a live preview harness
(`phoneSummary.preview.html`) mounting the real modules against a fake `live_sessions`
source, not a stub.

Verifiers: `module-boundary-checker`, `test-auditor`, `ui-accessibility-reviewer`,
`code-reviewer` — four agents in parallel (no migration/RLS/scoring change this task, so
`schema-guardian`/`security-reviewer`/`scoring-auditor` didn't apply).
`module-boundary-checker` came back clean — confirmed `chainComparators` reuse (added
during fixes below) and the read-only `totalElapsedSecs` fields introduce no second
writer. The other three found real issues, all fixed:

1. **`ui-accessibility-reviewer` (the most significant finding — high severity, directly
   against this task's own AC): the no-clock heat's own heading read "Timing…" immediately
   above the "Manual heat — not yet started." message** — a self-contradiction sitting
   right next to the one AC this task exists to prove ("prove a manual heat with no
   `started_at` renders its defined no-clock state rather than a blank or a zeroed
   timer"). Fixed by deriving the heading label from `isNoClockHeat` too ("Not started"
   instead of falling through to the generic timing/scoring label).
2. **`ui-accessibility-reviewer` (also high severity): the "running" cupper status had no
   non-color signal at all** — done had a ✓, maxed had "(max)", running had nothing, so a
   screen-reader user or anyone who can't visually compare chips side-by-side had no way
   to tell a currently-timing cupper apart. Fixed with an explicit "(timing)" suffix; also
   added "(done)" alongside the checkmark, since a bare ✓'s pronunciation is inconsistent
   across screen readers.
3. **`ui-accessibility-reviewer` (medium, three related findings): stage-mode's font-size
   bump missed `.stage-meta`/`.viewer-recent-heat-list` (an empty-stage projector's only
   text would've been the smallest thing on screen); the stage-mode maxed-chip color sat
   in the same ~4.67:1 contrast margin this project's own `viewer-shell.css` already
   rejected once; and the "no `clamp()` needed" reasoning for stage-mode sizing rested on
   an assumption about T5.3's eventual fixed-canvas wrapper that isn't built yet.** All
   three fixed: added the missing selectors, switched the maxed chip to the stronger
   `--color-text-secondary` token in stage mode (verified live at `rgb(230, 219, 200)`,
   matching `--clr-clay-300`), and applied `clamp()` defensively, mirroring
   `viewer-shell.css`'s own precedent. Also flagged and closed cheaply while the payload
   contract is still wet: standings had no way to mark a tied/advancing cupper even though
   `standings.js`/`standingsScreen.css` already model exactly that on the organiser side —
   added an optional `tieStatus` field, rendered as a text-carried label (not color alone).
   The preview harness gained a stage-mode toggle so this CSS actually gets visually
   exercised, not just written.
4. **`code-reviewer`: `payload.stage`'s header comment said required, but the code and
   tests already treated it as optional** — surfaced a real latent gap underneath the doc
   error: a payload with real `standings` but no `stage` would silently render a blank
   body under the shell's "Live" chrome. Fixed by decoupling the heading from the table
   (standings render with a bare correct-count when `stage` is absent) and correcting the
   doc to `null | {...}`, matching `activeHeat`'s own notation. Also: `cupperStatus`'s
   maxed-before-done precedence was correct but undocumented (a comment now explains why
   the order matters, per `core/timeclamp.js`'s clamped-not-null maxed value), the
   `elapsedSecs`→`totalElapsedSecs` rename's justification overstated
   `no-raw-elapsed-write`'s reach (the module's own reads were never actually at risk —
   only test-fixture object literals would have been; comment tightened to lead with the
   real reason, matching `standings.js`'s own `total_elapsed_secs` precedent), and
   `renderRecentHeat` hand-rolled a sort comparator instead of reusing `core/ranking.js`'s
   `chainComparators` — the exact "reimplementing a core/ primitive inside a format"
   pattern CLAUDE.md names as the module boundary's reason for existing. Now reuses it.
5. **`test-auditor` (two proof gaps, both closed):** the no-clock-state test proved the
   message string appeared but never proved the AC's actual negative — a regression that
   also rendered a stray duration/countdown alongside the message would have passed
   unchanged; closed with explicit `not.toMatch()` assertions against clock-shaped
   strings. `phoneSummary.test.js`'s "no `data-surface` override" test only checked the
   root node, not the whole mounted subtree; strengthened to
   `querySelectorAll('[data-surface]')`.

28 tests now (26 → 28: a missing-`stage` fallback case, and tied/advancing rendering),
plus the two strengthened assertions above. Full suite (647 tests) and lint/format clean.
Live-verified in browser: the no-clock heading no longer contradicts its own body text,
all three chip states show a non-color signal, tied/advancing standings render with text
labels and the correct `data-status`, and the stage-mode toggle confirmed the stronger
maxed-chip contrast token takes effect.

**Follow-up flagged, not fixed here** (out of this task's scope — touches
`core/viewer-shell.js`, already-shipped T5.2 code): the mounted viewer tree has no `<h1>`
anywhere, so `viewerBody.js`'s own `<h2>` becomes the page's first heading with nothing
to nest under. Spawned as its own task rather than reopening T5.2's shipped module
mid-T5.4.

---

## Phase 5 — Live surfaces · 2026-08-28 (T5.2 — viewer-shell + holding states)

### viewer-shell

Phase 5's second task, scoped in advance with the user on two real design questions:
Supabase Realtime (`postgres_changes`) over polling, since this project has no prior
realtime usage and the spec's own "reconnect" requirement wants a real connection
lifecycle, not an inferred one; and matching the legacy reference app's identity-band
split (phone shows it, the fixed-16:9 projector doesn't) over a single unified chrome,
via a `showChrome` option.

`supabase/migrations/20260828120000_live_sessions_realtime.sql` (new): enables Realtime
on the existing `live_sessions` table — the first table this project streams. No RLS
change (`live_sessions_read` was already `using (true)`, open by design), no new grant.

`src/core/viewer-shell.js`/`.css`/`.preview.html` (new): `mountViewerShell(root, {orgId,
renderBody, hasContent, showChrome, client})` — watches `live_sessions` for an org (not
an event: a viewer link is handed out once per org, "tonight's competition," and should
keep showing whichever event is currently active, D19), renders every holding state
itself (connecting / no session / active-but-nothing-published / connection-lost), and
mounts a caller-supplied `renderBody` only once real content exists — the same
inversion-of-control shape `core/outbox.js` already uses for its handler map. The first
CSS file placed inside `src/core/` rather than a format's own directory, since no format
"owns" this module the way `heatsScreen.css` originally owned `.form-field`.

Verifiers: `schema-guardian`, `security-reviewer`, `module-boundary-checker`,
`test-auditor`, `ui-accessibility-reviewer`, `code-reviewer` — six agents in parallel,
two rounds (this is real UI, unlike T5.1). `module-boundary-checker` and
`security-reviewer` came back clean on round 1 — the latter having live-tested the
realtime enablement itself (a real anon websocket subscription proving RLS enforcement,
plus a negative control on a table not in the publication). The other four found real
issues, all fixed:

1. **`code-reviewer` (the most significant correctness finding): the realtime
   subscription was registered AFTER the initial read, not before** — a full
   request/response round trip during which a change could land and never be observed.
   Fixed by subscribing first; closed with a dedicated race test.
2. **`code-reviewer`: no guard against overlapping `refresh()` calls resolving out of
   order.** A monotonic sequence number now discards a slower-resolving earlier call in
   favor of a faster-resolving later one, regardless of which one's network response
   actually arrives first.
3. **`ui-accessibility-reviewer` (the most significant accessibility finding): a full
   `innerHTML` rebuild on every render defeats `aria-live` change detection** — a screen
   reader needs a _persisting_ node to detect a mutation, not a freshly re-inserted one,
   and this is a passive "watch and wait" surface with no user action to hang an
   alternative announcement mechanism on. Fixed with a genuine restructure: the DOM is
   built once at mount and mutated in place via `replaceChildren()` on every render.
4. **`ui-accessibility-reviewer`: the `is_test` banner had no `role`/`aria-live` at
   all** — a real D9 gap for non-visual users, since this shell re-fetches (and could
   flip `is_test`) on every change event. Fixed with `role="alert"`.
5. **`ui-accessibility-reviewer`: no timeout on the initial "Connecting…" state** — an
   unbounded wait is §8.4's "never leave a user watching a spinner" failure mode under a
   different name. Fixed with a 10-second timeout, resolving to the same shape a query
   error would.
6. **`ui-accessibility-reviewer` (two more): stage-mode fixed text sizes had no
   clamp/step-down guard, and `.viewer-badge-live`'s accent-as-text-on-sunken contrast
   was thin (~4.7:1) and undocumented.** Fixed with `clamp()`-bounded sizing and a
   switch to a solid, already-verified accent fill (5.6:1+ both surface modes) — which
   in turn required overriding `.status-live-dot`'s own accent-colored background,
   caught while making the fix (it would have been invisible against the new solid
   accent fill).
7. **`test-auditor` (three tests that passed for the wrong reason, closed):** the
   re-fetch test never proved the shell ignores the change event's own payload and
   genuinely re-reads; the reconnect-recovery test never proved a NEW read happens, only
   that a flag cleared; the connection-lost test used a no-op `renderBody`, so "content
   was showing and got replaced" was never actually true. Also added: an explicit
   `is_test: false` + loaded-session negative test, and exact per-phase holding-card copy
   assertions instead of a bare length check.
8. **`code-reviewer`, two more:** `renderChrome` showed a stale "Live" badge during a
   connection-lost state (the event may still be live even though _this viewer's_
   connection dropped) — fixed with a neutral "Reconnecting…" badge. The identity band
   showed the raw `session.format` slug (e.g. `"cup_taster"`) as if it were a finished
   event-name display — `live_sessions` has no denormalized name to show instead — fixed
   by keeping the identity band generic until a real name source exists.

**Round 2** (scoped to the round-1 fixes, since the render-model restructure and the
subscribe-ordering fix were substantial enough to warrant fresh eyes): all seven round-1
fixes verified to actually close what was found. One new, real bug caught in the new
code itself — `connectionLost` was only ever cleared by the realtime channel's own
`SUBSCRIBED` handler, so a lost state entered via a query error/timeout (not a channel
drop) could get stuck forever once the underlying channel itself never blipped again,
even while every later read kept succeeding behind the scenes. Fixed by clearing the
flag in `refresh()`'s own success branch, closed with a regression test proving recovery
via a plain successful read, no channel reconnect involved. `ui-accessibility-reviewer`
also caught a genuine WCAG failure in the brand-new "Reconnecting…" badge itself
(3.72:1 in stage mode, below the 4.5:1 floor — it hadn't inherited `.viewer-badge-live`'s
earlier fix just because it looked similar) and a minor over-announcement gap (the
`is_test` banner was recreated, and so re-announced, on every unrelated render) — both
closed. `test-auditor`'s own round-2 pass on the new race/timeout tests found one more:
the "discards a slower-resolving earlier refresh" test didn't actually prove the
sequence guard — confirmed by disabling the guard and watching all 34 tests still pass.
Tracing it further while fixing it surfaced a second, independent bug one level down, in
the test fixture itself: the fake client's `maybeSingle()` snapshotted a row by
reference, not by value, so a later in-place mutation (`db.live_sessions[0].payload =
...`, the exact pattern the test itself used) silently changed what an
already-in-flight, supposedly-frozen "slow" read would see once it finally resolved —
defeating the very race the test existed to create. Fixed with a real snapshot (a
shallow copy at read time) and, separately, rewritten to use fake timers instead of real
0ms/30ms `setTimeout` delays (too imprecise in a test environment to reliably reproduce
out-of-order resolution). Re-verified the same way: passes with the guard restored,
fails cleanly when the guard is disabled again.

619 tests total (up from 585) — 34 in the new `viewer-shell.test.js`. 71 pgTAP
assertions unchanged (this migration touches no RLS/table/function). Live-verified in a
real browser: both a phone-style and a projector-style (`data-surface="stage"`) shell
mounted side by side against the same fake org/session source, exercising every holding
state, the `is_test` banner, disconnect/reconnect, and — at 360px — confirming the
projector's `clamp()`-bounded text doesn't overflow.

**Deliberately shell-only, no real Cup Taster content wired in** — the preview harness's
`renderBody` is an explicit stub that just prints the payload. T5.3/T5.4 build the real
`viewer-body` against this shell unedited.

---

## Phase 5 — Live surfaces · 2026-08-27 (T5.1 — publish + live_sessions write path)

### publish_session RPC + core/publish.js

Phase 5's first task. `live_sessions` (the table §5.3/T1.3 already created and secured) had
no write path yet — this is that path: `publish_session(p_operation_id, p_org_id,
p_event_id, p_format, p_is_test, p_payload)` (new migration
`20260827200000_publish_session_rpc.sql`) atomically activates a session for an event,
deactivating whatever else is active for the org first. Needed as a real RPC, not a
client-side check-then-write, because `live_sessions` carries a genuine two-row invariant
(`live_sessions_one_active_per_org`, a partial unique index) that only one transaction can
guarantee — the same problem class `confirm_heat`/`merge_people` already exist to solve for
their own tables. Idempotent via the same `processed_operations` ledger `confirm_heat`
established.

`src/core/publish.js` (new): `publishSession(orgId, eventId, {format, isTest, payload},
client)` — the JS write path, format-agnostic (handoff §6). Enqueues + flushes through
`core/outbox.js` as ONE operation, the same discipline `scoring.js`'s `submitConfirmHeat`
established for `confirm_heat` — "publish is explicit and separate, a queued publish that
hasn't drained shows not synced, never green" (§9) only holds if publishing genuinely goes
through the same queue/flush/fail-open machinery every other tracked write does.

**Deliberately logic-module-only this task** (scoped with the user in advance, matching
T4.1's own setup.js precedent): nothing calls `publishSession` yet from any existing screen.
WHEN a format calls this (once at heat start with a timing-only payload, again on an
explicit results publish, per D7's "split publish cadence") and WHAT its payload contains
(Cup Taster's is a standings table, §8.3) are both real design decisions deferred until
T5.2's `viewer-shell` exists to build real wiring against, rather than guessed at now.

Verifiers: `schema-guardian`, `security-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — five agents in parallel, one round (no UI this task, so
`ui-accessibility-reviewer` doesn't apply). `module-boundary-checker` came back clean. The
other four found real issues, consistent with this project's own "every review should find
something" discipline:

1. **`code-reviewer` + `security-reviewer` (independently converging): a NULL-unsafe
   ownership check silently skipped the org/event validation for a nonexistent event.**
   `app.org_id_for_event` returns `null` for a missing event, and `p_org_id <> null` is
   `null` (not `true`) in plpgsql's `if` — a caller passing a fabricated event id fell
   through the check entirely and hit a raw foreign-key-violation on the insert instead of
   a clear message. First fix attempt (a separate `not exists (select 1 from events ...)`
   pre-check) introduced a NEW bug, caught immediately by re-running the full pgTAP suite:
   that query runs under the caller's own RLS, so a genuinely wrong-org caller can't see the
   other org's event row either, and the pre-check reported "not found" before the real
   ownership check ever ran — masking the intended message and breaking two tests. Real fix:
   a single `is distinct from` comparison (NULL-safe) reusing the existing
   `security definer` `org_id_for_event` helper, collapsing "doesn't exist" and "exists but
   belongs to a different org" into one "not found" message — deliberately not
   distinguished, matching `confirm_heat`'s own established convention (a wrong-org caller
   who can't see another org's rows under RLS anyway shouldn't be told that org's event
   exists at all).
2. **`schema-guardian` + `security-reviewer` (independently, both reproduced it live against
   the real database): no test proved the RLS backstop itself, only the RPC's own
   application-level ownership check.** Every existing rejection case passed a
   _mismatched_ org/event pair, caught by `publish_session`'s own guard before RLS ever got
   involved. A caller passing the event's _correct_ owning org (so the guard passes) while
   not actually being a member of that org was untested — `security-reviewer` reproduced it
   by hand (`ERROR: new row violates row-level security policy`), closed with a new pgTAP
   case proving RLS's own `WITH CHECK` rejects it independently.
3. **`test-auditor`: the "publishing a second event atomically deactivates the first" test
   only proved the final state after one clean call, not atomicity** — a naive two-statement
   client sequence would produce the identical final state whenever nothing fails partway
   through, so the test didn't distinguish "atomic RPC" from "two statements that happened
   to both succeed." Closed with a genuine forced-failure case (publishing with a null
   `format`, which fails the column's `not null` constraint _after_ the deactivate-others
   update has already run) proving the earlier update rolls back too, not just the failed
   insert.
4. **`code-reviewer`: nothing in `publish.js` enforced its own doc comment's "`isTest` is a
   required, explicit argument" claim** — a caller that forgot the key would have silently
   enqueued `isTest: undefined`, the one place D9's "unmistakable `is_test`" guarantee could
   quietly break for free. Closed with a runtime type guard (`typeof isTest !== 'boolean'`
   throws before anything is enqueued) plus a test proving the omitted-key case actually
   throws rather than merely being named as if it did.

585 tests total (up from 579) — 6 new in `publish.test.js` (new file). 71 pgTAP assertions
total (up from 53 before this task) — all 18 in the new `006_publish_session.sql`, which
grew from an initial 12 (its first working version, after two earlier `plan()` miscounts)
to 18 across the review-fix round above: 6 new assertions closing the not-found, RLS-denial,
and forced-failure-rollback gaps.

---

## Phase 4 — Cup Taster · 2026-08-27 (Roster registration screen)

### Roster registration

Closes the other half of T4.1's own "no UI" gap — the stage-plan setup screen shipped
earlier the same day left `core/registry.registerEntry` (roster registration) explicitly
out of scope, by decision, as a separate task. This is that task: an organiser can now
register cuppers (name + phone required per D16, email/cafe/bib optional) into an event
and withdraw/reinstate an already-registered entry — the `event_entries.withdrawn` flag
`heats.js`'s own seeding step has filtered on since T4.2, but that nothing could ever set
before this.

`src/core/registry.js`: two additions and one change, all format-agnostic — this file
already had zero Cup-Taster vocabulary and stays that way. New `findEntryForPerson`
(the dedup check `registerEntry` needed before inserting — `event_entries` has a real
unique index on `(event_id, person_id)`, so a double-tap or a re-submit after a dropped
response would otherwise surface that constraint as a raw error instead of the existing
row). `registerEntry` itself is now idempotent: checks `findEntryForPerson` before
`createEntry`, and — found in review — recovers from a genuinely concurrent registration
(two staff devices, same phone, same race window) the same way `setup.js`'s `createStage`
already does: catch the unique-violation, re-query, adopt the winner rather than surface
the raw constraint error to whichever caller lost. The `UNIQUE_VIOLATION` constant this
needed was previously defined only in `formats/cup-taster/setup.js` (and re-used by
`heats.js`) — hoisted to `core/errors.js` instead, since a raw Postgres error code isn't
Cup-Taster vocabulary and `core/` can't import from `formats/` (handoff §6); `setup.js`
and `heats.js` both now import it from there. New `setEntryWithdrawn` (sets/clears the
flag; never deletes the row, since `ct_stage_entries`/`ct_heats`/`ct_results` all key off
`entry_id` with `on delete cascade` — deleting instead of flagging could silently destroy
already-recorded results).

`src/formats/cup-taster/rosterScreen.js`/`.css` (new): the screen itself, following
`setupScreen.js`'s established `renderLoading`/`renderLoadError`/`render` shape,
`is_test`-banner, and synchronous-before-any-await draft-state discipline (a withdraw
toggle elsewhere on the screen re-renders the whole subtree, including the registration
form — draft field values are mutated on every `input` event so that rerender rehydrates
from what the organiser already typed, rather than wiping it blank mid-entry; a live
regression test proves this). `core/dom.js` gained a new exported `labeledField()` —
setupScreen.js's own local `fieldWrapper` helper, extracted here on its 2nd verbatim use
(this screen's five form fields) per `CONVENTIONS.md`'s own rule; `setupScreen.js`/`.css`
updated to use the shared version instead of their own copy (`.stage-field*` classes
renamed `.form-field*`, moved into `heatsScreen.css` as the shared home — nothing else
about `setupScreen.js` changed). Live-verified via `rosterScreen.preview.html` (new demo
harness, same pattern as `setupScreen.preview.html`) in a real browser at 360px, and via
jsdom-backed tests exercising the actual mounted DOM.

Verifiers: `ui-accessibility-reviewer` (360px-first), `module-boundary-checker`,
`test-auditor`, `code-reviewer` — four agents in parallel, one round.
`module-boundary-checker` came back clean (no `core/`↔`formats/` violation, no
reimplementation of a `core/` primitive — confirmed directly against the new
`registry.js`/`dom.js` additions). The other three found real issues, consistent with
this project's own "every review should find something" discipline:

1. **`code-reviewer` (the most significant finding): `registerEntry`'s new idempotency
   check closed the sequential-retry case but not a genuinely concurrent one.** Two staff
   devices registering the same phone at once could both pass the pre-check, then the
   loser's insert would surface a raw `23505` instead of the friendly "already registered"
   message the winner got. Fixed per above (catch, re-query, adopt the winner) — the same
   race-recovery shape `setup.js`/`heats.js` already established, now genuinely reusable
   from `core/` since `UNIQUE_VIOLATION` moved there. New tests prove both the recovery
   (adopts the winner's row, still just one row) and that a genuinely different error
   (not a unique-violation) is never swallowed as if it were a race.
2. **`code-reviewer`: the "already registered" message echoed the just-typed draft name
   instead of the canonical stored one.** `result` (the row `registerEntry` returns)
   already carries the correct `display_name` in both branches of the message's ternary;
   only the duplicate-registration branch used the wrong source, which could show a typo
   or a stale casing the organiser had typed rather than what's actually on the roster.
   Fixed to use `result.display_name` in both branches; also removed a dead
   `|| 'That cupper'` fallback `validateDraft` already made unreachable.
3. **`ui-accessibility-reviewer` (the most significant accessibility finding): dimming a
   withdrawn row via `opacity: 0.7` dropped two text colors below the AA floor** —
   measured at 4.17:1 for the "Withdrawn" tag's danger color and 3.64:1 for the meta line
   (both fail 4.5:1), hitting hardest the one non-color signal the withdrawn state has.
   The exact class of bug this same day's earlier setup-screen work had just fixed for
   disabled-hint text, reintroduced here a different way. Fixed by swapping opacity for a
   token-backed background tint instead — matching `setupScreen.css`'s own
   `[data-locked='true']` precedent — full-strength foreground colors throughout,
   re-verified live (danger color reads `rgb(155, 27, 1)`, unchanged from its
   non-withdrawn value).
4. **`ui-accessibility-reviewer`: a successful registration's confirmation lived only in
   a live region that's destroyed and rebuilt every render**, which many screen-reader/
   browser pairs don't reliably announce for a brand-new node — the validation-error path
   already moved focus to the feedback region, success didn't. This mattered more here
   than the identical gap in `setupScreen.js` (noted, not fixed, as a separate pre-existing
   item — see `ROADMAP.md`) because registration is a repeat-many-times-in-a-row workflow,
   not a one-shot save. Fixed by extending `render()`'s own focus-fallback to the success
   tone as well as error, verified live via `document.activeElement`, and via a new
   regression test.
5. **`ui-accessibility-reviewer` (two more, both closed):** a redundant `aria-label` on
   the registration `<form>` duplicating its own visible `<h2>` — switched to
   `aria-labelledby` pointing at the heading. A long name+cafe pair had no wrap safety at
   360px (`.roster-entry-info` had no `min-width: 0`) and could push the withdraw/reinstate
   button off-screen — fixed with `min-width: 0`/`overflow-wrap: anywhere` plus
   `flex-wrap: wrap` on the shared `.roster-list li` rule (benefits `heatsScreen.js`'s own
   simpler roster list too). Also closed as smaller findings: no token color on a disabled
   `.field-input` (fell back to browser/OS default while a write is in flight) and the
   roster `<ul>` had no `aria-label` for region navigation.
6. **`test-auditor` (one gap, closed):** the "registers a new cupper" test asserted only
   `.toContain('registered')`, which the "already registered" branch's message also
   matches — a regression that made the idempotency check always report a false positive
   would have passed silently. Tightened to an exact string match.

579 tests total (up from 573 after the same day's setup-screen work) — 6 new in
`registry.test.js` (35 total), 3 new in `dom.test.js`, 30 in the new `rosterScreen.test.js`.

**Closes the "Roster registration still has no UI" item in `ROADMAP.md`'s known open
items.**

---

## Phase 4 — Cup Taster · 2026-08-27 (T4.1's setup screen — closing the known UI gap)

### Stage plan setup screen

Scope decided in advance (see the task's own framing, carried into this entry): stage
plan only — no roster/cupper registration on this screen, that's separately scoped. The
organiser can build an ARBITRARY chain of stages (add, remove, reorder, each with its own
kind/set_count/duration_secs/cutoff), not the two-fixed-sequence restriction T4.1 shipped
with. A stage is editable only while genuinely safe to change — once it has heats, its
plan is locked.

`src/formats/cup-taster/setup.js`: `validateStagePlan` generalized from a fixed
`["prelims","finals"]`/`["prelims","semis","finals"]` allowlist to a rank-based
kind-ordering check (`prelims`-type stages, then `semis`, then `finals` — may repeat or be
skipped, but never regress). Duplicate kinds, a missing kind, and a single-stage plan are
all real plans now. New `stageHasHeats` (a stage's plan is locked once any heat exists —
results can only exist once a heat does, so this alone covers "or results") and
`saveStagePlan` (reconciles a whole desired plan against what's persisted: diffs
removed/changed/created stages, refuses the WHOLE save — naming the specific stage — if
anything touched already has heats, and reorders via a two-phase negative-ordinal move so
no update collides with the `(event_id, ordinal)` unique index mid-reconciliation).

`src/formats/cup-taster/setupScreen.js`/`.css` (new): the screen itself, following
`heatsScreen.js`'s established rebuild-then-refocus/`is_test`-banner/`screen-feedback`
pattern. Locked stages render read-only; unlocked ones are editable with synchronous
per-field draft mutation (same lost-update-race discipline T4.5's `scoringScreen.js`
established). Live-verified via `setupScreen.preview.html` (new demo harness, same
pattern as `heatsScreen.preview.html`) in a real browser at 360px via Playwright, and via
jsdom-backed tests exercising the actual mounted DOM.

Verifiers: `ui-accessibility-reviewer` (360px-first), `module-boundary-checker`,
`test-auditor`, `code-reviewer` — four agents in parallel, one round. Every review found
something real, consistent with this project's own "every review should find something"
discipline (`CLAUDE.md`). `module-boundary-checker` came back clean on the actual boundary
question (no `core/`↔`formats/` violation, no reimplementation of a `core/` primitive) —
its one note, a `STAGE_KINDS` constant duplicated between `setup.js` and `setupScreen.js`,
closed by exporting it from `setup.js` and importing it rather than restating it. The
other three found real issues:

1. **`code-reviewer` + `ui-accessibility-reviewer` (independently converging): a genuine
   CSS corruption bug.** `setupScreen.css`'s opening doc-comment contained the literal
   token `.btn*/` inside its own prose (documenting the shared `.btn` class name) — the
   `*/` closed the comment three sentences early, and everything from there through
   `.stage-rows` itself became one long invalid selector that browsers silently drop.
   `ui-accessibility-reviewer` confirmed this live in Chromium: `.stage-rows` measured
   `display: block` instead of the intended `flex`/`column`/`gap`, with a real 0px gap
   between stage cards on screen (should be 16px). Fixed by closing the comment cleanly;
   re-verified live afterward (`display: flex`, 16px gap, screenshot-confirmed).
2. **`code-reviewer` (the most significant data-correctness finding): `saveStagePlan`
   didn't reject a plan carrying the same stage id twice.** Reproduced directly: two plan
   entries both claiming to be one existing row silently corrupt the ordinal sequence
   (the diff can only ever resolve one of them, discarding the other's edits, ending with
   two stages sharing one DB row and no stage left at ordinal 1) — nothing in the write
   path ever threw. Fixed with a pure, up-front duplicate-id check in `validateStagePlan`
   itself, guarding every caller.
3. **`code-reviewer`: shrinking an edited stage's `setCount` left orphaned `ct_sets`
   rows.** `ensureSetsForStage` is add-only by design (T4.1's own idempotent-healing
   pattern); nothing removed the positions above a newly-lowered count. Fixed with a new
   `deleteSetsAbovePosition`, called alongside `ensureSetsForStage` in `saveStagePlan`'s
   changed-row loop, gated by the same `stageHasHeats` check that already guarantees no
   heat/result data references those sets.
4. **`code-reviewer`: the check-then-write reconciliation isn't atomic against a heat
   being created mid-save** (a genuine race window, not a bug in the check itself) —
   the module's header comment overstated this as a hard guarantee. Reworded to state the
   race window explicitly, under the same single-organiser pre-event assumption the rest
   of the module already leans on (handoff §9), rather than adding RPC atomicity this
   task's scope didn't call for.
5. **`code-reviewer` (two nits, both closed):** a dead `previous.cutoff != null` guard in
   `validateStagePlan` (unreachable — `previous` is always non-terminal by construction,
   so its cutoff is never null by the time it's read back) simplified away with a comment
   explaining why; a `.tempOrdinal` scratch property bolted directly onto fetched DB row
   objects during the two-phase reorder replaced with a local `Map` keyed by id, so
   `saveStagePlan`'s own bookkeeping never leaks onto data a caller might hold a reference
   to.
6. **`ui-accessibility-reviewer` (the most significant accessibility finding): Move
   up/down permanently dropped keyboard/screen-reader focus to `<body>`.** Confirmed live:
   `moveStage()`'s own `focusAfterRender` correctly targeted the moved row's container,
   but a plain `<div>` isn't part of the focus order, so `.focus()` was a documented
   no-op, and the destroyed-and-rebuilt subtree left nothing else to land on. Fixed with
   `tabindex="-1"` on the row container — re-verified live (`document.activeElement`
   matches the moved row after a real click).
7. **`ui-accessibility-reviewer`: the terminal-stage cutoff field's only explanation was
   browser-default placeholder text**, measured live at 4.50:1 in Chromium (right at the
   AA floor, worse in other engines) and invisible to some assistive-tech read modes on a
   disabled field. Fixed with a real, always-rendered, token-colored `<p>` wired via
   `aria-describedby`, matching the locked-row explanation's own established pattern
   (real text, never color/placeholder alone).
8. **`ui-accessibility-reviewer`: no defined loading state during the initial mount** —
   `loadPersisted()` is `findEvent` + `listStagesForEvent` in parallel, then a
   `stageHasHeats` round trip per stage, which could leave `root` blank for a real
   stretch of time on this project's "unreliable venue wifi" target. `reportScreen.js`
   solved this exact problem for T4.7; `setupScreen.js` had reverted to the older,
   pre-fix pattern instead. Closed with the same `renderLoading()` shape.
9. **`code-reviewer` (UX, not correctness): removing or reordering an unlocked stage
   positioned before a locked one always failed the whole save, blaming a DIFFERENT stage
   than the one the organiser touched.** `test-auditor` independently flagged the sibling
   gap: Move up/down next to a locked row was a silent no-op (the runtime guard in
   `moveStage()` was correct, but the button itself never showed as disabled). Both closed
   together: `render()` now computes, per row, whether a move would swap into a locked
   neighbor or a remove would shift a locked stage's ordinal, and disables exactly those
   controls up front — re-verified live and via new integration tests.
10. **`test-auditor` (four gaps, all closed):** the "refuses to remove a locked stage"
    test only proved no `delete` call fired, not that the edited stage's own `update`
    also never fired — closed. No test proved the module's own stated "refuse-then-
    explain, not partially apply" guarantee under the real risk case (an earlier,
    otherwise-safe touched stage followed by a later blocked one in the same save) —
    closed with a test proving the earlier stage's `update` never fires once any later
    stage in the same save is found locked. The "removes and renumbers" test's own
    2-stage fixture couldn't actually prove renumbering (with only 2 stages, removing one
    always leaves "Stage 1" whether or not renumbering happened) — closed with a 3-stage
    fixture proving a later stage's rendered label shifts down. The generalized
    `validateStagePlan` claim was independently confirmed genuine (not a message-text-only
    change) by diffing against the pre-generalization implementation and finding three
    tests that target cases the OLD code would have wrongly rejected.

538 tests total (up from 503) — 15 new in `setup.test.js` (56 total, up from 41),
20 new in `setupScreen.test.js` (new file as of this task).

**Closes the "T4.1's `setup.js` still has no UI" item in `ROADMAP.md`'s known open
items.**

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.8)

### T4.8 Export — the last Cup Taster task

Scope decided with the user before writing code: CSV export is a real, generated file;
PDF is the browser's own Print → Save as PDF against a print-optimized stylesheet, not a
generated file — this project has essentially one runtime dependency (`@supabase/
supabase-js`), and a client-side PDF library would have been the first non-Supabase
dependency added since Phase 0. The export contains the same full report T4.7 already
computes and displays (per-stage standings, set difficulty, score distribution), not a
standings-only subset.

`src/core/export.js` (new) — the ONE Cup Taster task built on a genuinely core, format-
agnostic module (the handoff's own §6 module table lists `export`: "Table spec → CSV /
PDF"). `buildCsv(table)` (pure: one `{columns, rows}` spec → one CSV string, RFC 4180-ish
escaping), `buildCsvForTables(tables)` (pure: multiple specs → one file, title-prefixed
sections), `downloadCsv(filename, csvContent)` (DOM: Blob + object URL + a synthetic
`<a download>` click). Zero Cup-Taster vocabulary anywhere in this file — a future format
calls the same three functions with its own table specs, unedited.

`src/formats/cup-taster/reportScreen.js`/`.css`: `buildReportTables`/`buildStageTables`
turn a stage's report into generic table specs, reusing `describeOutcome`'s exact
formatting so the CSV says the same thing the on-screen table does. Two new buttons
("Download CSV," "Print / Save as PDF") in a `renderExportActions` toolbar, shown once
the report is available. A `@media print` block forces `.standings-table` back to real
table `display` values regardless of viewport width, since printed output should never
rely on the screen-only 480px stacked-card layout.

Verifiers: `module-boundary-checker`, `ui-accessibility-reviewer`, `test-auditor`,
`code-reviewer` — four agents in parallel, one round (no `scoring-auditor`, since this
task touches no ranking/advancement/timeclamp/scoring logic; fixes verified directly —
tests plus live browser checks — rather than a second review round, matching T4.7's own
precedent once round 1's findings are the kind that verify cleanly on inspection).
`module-boundary-checker` came back clean — `core/export.js` is genuinely reusable, all
Cup-Taster-specific knowledge stays in `reportScreen.js`. The other three found real
issues, all fixed:

1. **`ui-accessibility-reviewer` (the most significant finding): the exported CSV carried
   no `is_test` marker anywhere** — a downloaded file can be forwarded, archived, or
   opened divorced from its on-screen context, and the CSV path (unlike print, which
   naturally inherits the `.is-test-banner` DOM) never touched `event.is_test` at all.
   This is squarely the D9 failure mode ("demo data indistinguishable from a real event")
   applied to an export path rather than a live surface. Fixed: a `TEST — ` filename
   prefix plus a `TEST DATA — NOT A LIVE EVENT` first line in the CSV body itself.
2. **`ui-accessibility-reviewer`: the two new buttons used a bare, un-tokenized `.btn`**
   — every other button in this codebase pairs `.btn` with `.btn-primary`, but `.btn`
   itself sets no color, so these fell back to browser/OS default chrome. Fixed by
   porting the design system's own documented (but never-before-used) `.btn-outline`
   variant into `heatsScreen.css` — the shared home for `.btn*` components — alongside
   `.btn-primary` for the primary action. Also flagged, not blocking: the print
   stylesheet's `display: revert` values are cascade-position-dependent rather than a
   fixed guarantee — fixed anyway by making them explicit (`table`/`table-header-group`/
   etc.), since the fix was small.
3. **`code-reviewer`: the two export actions had no failure-reporting path at all** —
   unlike every other action in this project, a thrown error (a `window.print()` failure
   in a sandboxed context, for instance) would become an invisible console-only exception
   at a live event. Fixed with a local feedback region and try/catch on both actions,
   matching this project's established pattern elsewhere. Also fixed: an RFC number typo
   in a comment (4126 → 4180) and an overstated comment on `sanitizeFilename`'s actual
   Windows-filename-safety coverage.
4. **`test-auditor` (four gaps, all closed):** `downloadCsv`'s test proved only that mocked
   functions were called, never the actual Blob content/type or link href/filename at
   click time — closed by capturing and asserting on the real values. The export-button
   integration test's content assertions were two loose substrings, not specific enough
   to catch a dropped table or wrong column — closed with a full exact-string CSV
   assertion. The comma/quote-escaping path was tested in isolation (hand-built table
   specs) and separately in `buildReportTables`'s own tests, but never composed — closed
   with an end-to-end test using a comma-containing cupper name through the real
   pipeline. `sanitizeFilename` was tested against only 3 of its 8 stated unsafe
   characters, and nothing proved it was actually wired into the live download call
   (the fixture's event name was already filename-safe) — closed by covering the full
   character set and using an unsafe event name in the integration test.

503 tests total (up from 486 after T4.7).

**Phase 4 is done.** T4.1–T4.8 all shipped. Phase 5 (live surfaces) is next.

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.7)

### T4.7 Report and analytics

Scope decided with the user before writing code: the report shows per-stage standings +
analytics (per-cupper stats, per-set difficulty, score distribution — the handoff's own
module table listing for `analytics`), and — the user's own explicit constraint — it only
ever surfaces once the whole event is finished, never mid-competition. This sidesteps every
partial-data question a live report would raise entirely: by the time this module's data is
read, every stage's numbers are already final and will never change again.

`src/formats/cup-taster/analytics.js` (new): `isEventComplete` (finds the terminal stage —
the one with `cutoff === null` — and checks its status, the one gate every other function
in this module implicitly assumes); `computeSetDifficulty` (`avg(correct) group by set_id`,
restricted to `kind = 'normal'` heats, the identical restriction `ct_standings`'s own
migration comment gives and for the identical reason — a tiebreak heat's population is a
biased subset); `computeScoreDistribution` (pure, buckets `fetchStandingsForStage`'s own
ranked output by correct count, no second DB read); `computeStageReport` (composes
`fetchStandingsForStage`, unmodified, with the two functions above for one stage).

`src/formats/cup-taster/standings.js`: `fetchStandingsForStage`'s merged output gained
three pass-through fields — `finalPosition`, `source`, `positionNote` — read directly from
the already-fetched `ct_stage_entries` row, purely additive.

`src/formats/cup-taster/setup.js`: new `listStagesForEvent`, ordered by ordinal.

`src/formats/cup-taster/reportScreen.js`/`.css` (new): two states only — "not yet
available" or the full report — no rebuild-then-refocus concerns, since this screen has no
actions and renders once. Deliberately reuses `.standings-table` from `standingsScreen.css`
for all three of this screen's tables rather than a third copy of that pattern — T4.6's own
round-1 review flagged that screen's 480px table-stacking CSS as copy-pasted instead of
shared. Live-verified via a demo harness (`reportScreen.preview.html`, a completed two-stage
event) with hand-checked arithmetic and a 360px check.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — five agents in parallel, one round (the fixes below were
verified directly — re-run against passing tests plus live browser checks — rather than a
second full review round, given their mechanical nature). No `offline-sync-auditor` (no
outbox/IndexedDB involvement; this is a direct-write, organiser-only screen matching T4.2's
own precedent).

`module-boundary-checker` and `scoring-auditor` came back clean — the aggregation logic
(the `kind = 'normal'` exclusion, the `finalPosition == null` ⟺ "advanced" invariant, the
population consistency between difficulty and distribution) was traced end-to-end and holds.
The other three found real issues, all fixed:

1. **`ui-accessibility-reviewer` + `code-reviewer` (independently converging): the error
   path only wrapped `loadState()`,** leaving a render-path failure uncaught entirely, and
   the error branch wasn't a proper screen at all — no heading, focus never moved to the
   error, unlike every sibling screen's own established pattern. Fixed by wrapping the whole
   render body in one try/catch, always rendering a heading, and moving focus to the error
   region on failure — this screen never re-renders, so getting the first render's own error
   handling right matters more here than anywhere else in the project.
2. **`ui-accessibility-reviewer`: two real ambiguities.** The distribution table's "Correct"
   column (a raw count) sat directly below the difficulty table's own "Correct" column (a
   percentage) with nothing but the same `data-label` text distinguishing them at the 480px
   stacked breakpoint — a count plausibly misread as a percentage, the opposite of its actual
   meaning. Renamed to "Correct answers." Separately: two complete stages produced
   identically-worded "Set difficulty"/"Score distribution" headings with no stage name to
   tell them apart in a screen reader's flat headings list — fixed by folding the stage kind
   into each heading's own text. Also flagged, not fixed (a known, deliberately-deferred
   gap already recorded for the sibling standings screen): no visible loading state during
   the initial load — closed anyway, since the fix was small and this screen's own load can
   be several sequential round trips deep.
3. **`code-reviewer` (two items):** a `source` field was pulled through `standings.js`'s
   merge for this report but never actually read anywhere — closed by wiring it into the
   outcome text (distinguishing "advanced via tiebreak"/"advanced via coin toss" from a
   clean advance, a genuinely useful piece of report context, not just satisfying the
   reviewer). Also: two verbose async-IIFE patterns in `analytics.js` simplified to match
   the existing ternary idiom already established in `standings.js`.
4. **`test-auditor` (two real gaps):** `computeSetDifficulty`'s `kind = 'normal'` exclusion
   test only proved the filter clause exists in the source, not that a tiebreak heat's
   actual data gets excluded (the shared fake client doesn't filter by query arguments) —
   closed with a small, locally-scoped client for just that test that does. `isEventComplete`'s
   "only the terminal stage counts" test never separated "terminal stage" from "last array
   position" (every fixture happened to order them the same way) — closed with a fixture
   where the terminal, complete stage is first and a non-terminal, incomplete one is last.

486 tests total (up from 449 after T4.6).

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.6)

### T4.6 Standings and advancement, including the tiebreak flow

Scope decided with the user before writing code: full flow (standings display, tiebreak
heat creation, and coin-toss recording all ship as real screens/actions in this task, not
deferred), and advancing to the next stage — or declaring a champion — requires an explicit
organiser confirm action, matching T4.5's strict-confirm precedent rather than advancing
automatically.

`src/formats/cup-taster/standings.js` (new): ranks a stage via `core/ranking` (most correct
→ fastest time, per §7.3, applied uniformly at every cutoff including the terminal/champion
stage — `stage.cutoff ?? 1`); derives advancement via `core/advancement.computeAdvancement`,
unmodified; creates a tiebreak heat for a border tie; reads a confirmed tiebreak heat's own
results directly (never via `ct_standings`, which filters `kind = 'normal'` out specifically
so a tiebreak never blends into the primary tally); and commits a fully-resolved stage —
`ct_stage_entries` rows into the next stage with `source` provenance (`advanced` /
`tiebreak_won` / `coin_toss`), `final_position`/`position_note` for the champion and for
anyone eliminated. A tiebreak heat reuses the stage's whole existing set of `ct_sets` rather
than a literal single new set — the schema has no heat-scoped subset of a stage's sets, and
`ct_standings`'s own migration comment already frames a tiebreak heat as living in the same
`stage_id` it's resolving, which is why that view's `kind = 'normal'` filter exists at all.
Direct writes, not the outbox — matching T4.2's own heat-generation precedent (an organiser
setup/administrative action, not a live-heat write under time pressure).

`src/formats/cup-taster/heats.js`: `findHeatByNumber`/`createHeat`/`createHeats` gained a
trailing `kind = 'normal'` parameter (previously hard-coded), and a new exported
`generateTiebreakHeat` reuses these same generalized primitives — no parallel
heat-creation path, the exact discipline this project's module boundary exists to enforce
(the v4.x parallel-timer defect CLAUDE.md documents).

`src/formats/cup-taster/standingsScreen.js`/`.css` (new): a standings table plus a
state machine (`not-ready` → `clean` | `needs-tiebreak-heat` → `tiebreak-pending` →
`tiebreak-resolved` | `needs-coin-toss` → `complete`), ending in one atomic
`commitStageResolution` call — a coin-toss selection is local, ephemeral UI state until the
single commit, never a separately persisted step. Live-verified via a demo harness
(`standingsScreen.preview.html`) walking the full tie → tiebreak-heat → coin-toss → commit
path.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — five agents in parallel, two rounds. No `offline-sync-auditor`
(no outbox/IndexedDB involvement, matching the direct-write scoping above).

**Round 1** found real issues in four of five domains:

1. **`scoring-auditor` (the most severe finding): a genuine data-correctness bug.** When a
   stage's border tie has 3+ members and the tiebreak heat only _partially_ resolves it — a
   clear winner, a smaller sub-tie needing a coin toss, AND a cupper ranked distinctly below
   that sub-tie — the last cupper was never a member of any `tiedAtBorder` group at any level
   (`core/advancement`'s own break-without-visiting loop never even forms a group for them),
   so their `ct_stage_entries` row was left with no `final_position` forever, on a stage the
   UI reported as closed. Fixed by deriving `eliminated` directly from the tiebreak heat's
   own full ranking minus whoever ends up advancing — correct regardless of how many
   sub-groups the tiebreak heat's ranking produces — rather than from ad-hoc "loser" lists
   assembled in the UI. Closed with a regression test reproducing the exact scenario.
2. **`scoring-auditor` + `code-reviewer` (independently converging): a leftover
   `isTerminal` inconsistency** in the coin-toss card specifically, using
   `nextStage === null` after every other terminal check in the file had already been fixed
   to use `stage.cutoff == null` (the two only disagree when a cutoff stage's next stage is
   missing — a stage-plan data problem, not evidence of terminality). Also added: a new
   explicit guard in the commit path throwing a clear error for exactly that missing-next-stage
   case, rather than silently treating it as terminal.
3. **`ui-accessibility-reviewer`: the coin-toss witness-note input was missing tap-target
   and token styling entirely** (a bare `<input>`, never given the shared `.field-input`
   class every other text input in this codebase gets) — fixed. **Also: every action handler
   set focus to the heading unconditionally, even on failure** (the commit functions swallow
   their own errors internally), sending keyboard focus to unchanged content instead of the
   error region — fixed by having `commit()` return a success flag callers gate focus
   movement on; a failed coin-toss submit also now preserves the organiser's selection/note
   instead of clearing it.
4. **`test-auditor` (four gaps, all closed):** a `generateTiebreakHeat` test asserted only
   against its own queued mock response, never the actual DB insert payload; a "kind scopes
   uniqueness" regression test couldn't actually fail under the regression it claimed to
   guard (the fake client never filtered by the asserted value); the coin-toss note's
   "required" validation had no test at all; and no test exercised the coin-toss slot-count
   arithmetic with a nonzero clean-advancer count. All four closed with real assertions.
5. `module-boundary-checker` came back clean both rounds — `generateTiebreakHeat` and
   `standings.js` genuinely reuse existing primitives (`buildHeatPlansFromSizes`,
   `createHeats`, `core/ranking`, `core/advancement`) rather than reimplementing them.

**Round 2** (scoped to round 1's fixes only): all three re-invoked reviewers
(`scoring-auditor`, `ui-accessibility-reviewer`, `code-reviewer`) confirmed every fix
correct and complete, independently tracing scenarios beyond what the new tests cover
(an all-in-one-coin-toss-group case, a hypothetical further-nested tied subgroup) to
confirm no regression and no remaining gap. One purely cosmetic comment-wording nit, fixed
inline.

449 tests total (up from 409 after T4.5) — new files `standings.test.js` and
`standingsScreen.test.js`, plus `heats.test.js` gained `generateTiebreakHeat` coverage.

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.5)

### T4.5 Scoring surface: three-state toggle, strict confirm, bulk mark-wrong

Scope decided with the user before writing code, via three explicit questions: (1) write
model — local-accumulate (browser state + IndexedDB draft) with the whole heat submitted
as ONE atomic operation via the existing `confirm_heat` RPC (migration 20260822100000)
through the outbox, not a direct-write-as-you-tap pattern like T4.3/T4.4 — the
recommended option, chosen specifically because it's the exact "confirming a heat is
queued as ONE operation calling ONE RPC" use case the outbox's own module comment and
handoff §9 were built for, but never actually wired up until now; (2) persist the draft to
IndexedDB as taps happen, not the recommended in-memory-only option — the more resilient
choice, so a browser refresh/crash mid-scoring doesn't lose an organiser's work; (3) the
bulk mark-wrong action scoped to per-cupper only, not also a whole-heat action.

`src/formats/cup-taster/setup.js`: added `listSetsForStage(stageId, client)` — T4.1's
existing `listSetPositions` only returns bare positions, not full rows with `id`, and
scoring needs `set_id` to key results.

`src/formats/cup-taster/scoring.js` (new): `toggleScore` (null → true → false → null,
three-state, never a fourth state), `computeTally`/`isEntryComplete`/`isHeatComplete`
(pure derivations — `correct` stays a count, never a stored column, per handoff §5.2),
`markCupperRemainingWrong` (per-cupper only, per the user's scoping decision),
`loadDraft`/`saveDraft`/`clearDraft` (IndexedDB-backed draft, keyed per heat),
`loadConfirmedResults` (reads the real `ct_results` rows for the post-confirm read-only
view), `buildConfirmEntries` (assembles the RPC payload, filtering out any still-null
result rather than sending an explicit `null`), `submitConfirmHeat` (enqueues one
`confirm_heat` operation and flushes it through the outbox), `describeConfirmError`
(translates a P0002 conflict into an organiser-facing message using the DETAIL payload's
`current_updated_at`).

`src/formats/cup-taster/scoringScreen.js`/`.css` (new): a three-state toggle grid per
cupper per set (stable `score-{entryId}-{setId}` ids for rebuild-then-refocus, §15.3), a
running tally per cupper, a per-cupper "Mark remaining wrong" action, and a Confirm button
gated on every cupper having every set scored. Live-verified via a demo harness
(`scoringScreen.preview.html`, including a fake `.rpc()` — the first screen needing one).

`src/core/outbox.js`: gained a generic `.permanent` error-flag contract on `runFlush` — a
handler can throw with `error.permanent = true` to mean "this exact operation can never
succeed no matter how many times it's retried" (distinct from an ordinary failure, which
still correctly stops the whole flush and leaves the operation queued for retry). Zero
Cup-Taster-specific knowledge in `core/outbox.js` itself — `scoring.js`'s
`submitConfirmHeat` is the one format-specific caller that tags a P0002 conflict this way,
never a network-level rejection.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`offline-sync-auditor` (the outbox's own confirm-heat write path made this task's first
genuine use of it), `test-auditor`, `code-reviewer` — six agents, run in parallel, across
three rounds. Round 1 found the most severe issues; round 2 found narrower, second-order
gaps in round 1's own fixes; round 3 (scoped to just round 2's fixes, not the whole
feature again) found one cosmetic nit and one test-coverage gap, both closed, and
otherwise came back clean. Every round found something real, consistent with this
project's own "every review should find something" discipline.

**Round 1:**

1. **`scoring-auditor` + `code-reviewer` (independently converging): a real, reproduced
   lost-update race.** Rapid taps on different cells could silently drop one — `draft` was
   captured once per `render()`, and a second tap landing on the stale DOM before the
   first tap's full network round trip resolved read the same stale snapshot, with
   `saveDraft`'s unconditional overwrite discarding whichever save landed last. Fixed by
   moving `draft` to closure-level state, mutated **synchronously** as the first statement
   of every handler — before any `await` — since one click handler's synchronous portion
   always completes before another dispatched click can start. `scoring-auditor` verified
   this closes the race even under out-of-order IndexedDB transaction _commit_ ordering
   (not just promise resolution order), by tracing `core/db.js`'s actual `db.transaction()`
   semantics.
2. **`scoring-auditor`: `confirm_heat`'s strict-confirm row-count check was dead code
   against the real client payload.** Sending an explicit `correct: null` for an unscored
   set tripped a raw NOT NULL constraint violation (`ct_results.correct` is `not null`)
   before the RPC's own row-count check could ever fire, making the "friendly" error
   message unreachable. Fixed by filtering null-valued results out of
   `buildConfirmEntries`'s payload entirely — no migration touched, since nothing has been
   pushed to a cloud project yet and the fix didn't need one anyway.
3. **`offline-sync-auditor`: two real outbox/confirm-flow bugs.** (a) A P0002 conflict left
   a permanently-stuck outbox operation blocking the _entire_ global queue forever — any
   heat, any future confirm. Fixed via the `.permanent` error-flag mechanism described
   above (remove-and-continue instead of stop-and-retry-forever). (b) No double-click guard
   on Confirm could enqueue two operations, causing a self-inflicted P0002 conflict where a
   _successful_ confirm gets reported to the organiser as _failed_. Fixed with a
   `confirmInFlight` guard, disabled synchronously (same reasoning as the `draft` race fix
   above), plus a fresh ground-truth re-fetch after the flush resolves rather than trusting
   the flush's own (possibly-unrelated, since the outbox is one shared global queue)
   result.
4. **`ui-accessibility-reviewer`: an unstyled `unscored` toggle** (browser UA defaults, not
   design tokens) **and non-disabled buttons in the confirmed read-only view.** Fixed with
   explicit token-sourced CSS and a new `interactive` parameter on `renderScoringRows`.
5. **`test-auditor`: a misleading `listSetsForStage` test** claimed to prove sort order,
   which the fake test client structurally couldn't prove. Split into two honest tests: one
   proving row shape, one proving the `.order()` call arguments.

**Round 2** (re-review of round 1's fixes):

1. **`offline-sync-auditor` + `code-reviewer` (independently converging): `runFlush`'s
   permanent-failure tracking silently dropped an earlier permanent failure's info if a
   later, unrelated ordinary failure was what actually stopped the same pass** — only the
   queue-empty return path carried it forward. Fixed by making `permanentFailure: boolean`
   present on every return path, and renaming the local variable to `lastPermanentError`
   for clarity.
2. **`offline-sync-auditor`: the confirm handler's ground-truth re-fetch could itself fail**
   right after a successful confirm (e.g. a connection drop between the RPC ack and this
   read), showing a misleadingly definite "failed" message even though the confirm may
   have actually succeeded. Fixed via `.catch(() => null)` and a new, appropriately hedged
   branch ("Could not confirm whether this went through...") — the next render's own
   re-fetch self-corrects if it did.
3. **`scoring-auditor`: toggle/mark-wrong buttons weren't disabled while a confirm was in
   flight**, leaving a narrow window where a tap could be silently overwritten the moment a
   successful confirm switched the screen to the server-authoritative read-only view, with
   no notice the tap never counted. Fixed with a new `locked` parameter on
   `renderScoringRows`, distinct from `interactive` — a `locked`-but-editable toggle gets
   `disabled` without the `data-readonly` marker the true confirmed view uses, so CSS can
   (and does — see round 3) treat the two disabled states differently.
4. **`ui-accessibility-reviewer`: the confirmed view's disabled toggles inherited a
   project-wide `.btn:disabled { opacity: 0.6; }`,** dropping contrast on data that's meant
   to be _read_ (not an unavailable action) below AA (~2.7–3.4:1 measured vs. the 4.5:1
   floor). Recommended scoping an opacity override to the true read-only case — closed in
   round 3.
5. **`code-reviewer`: three more stray debug files** (`__pw_check*.mjs`) left at the repo
   root by earlier reviewer agents' own live-verification sessions. Deleted.

**Round 3** (scoped re-verification of round 2's fixes only, given round 2's own findings
were narrower/second-order rather than severe): all five relevant reviewers
(`code-reviewer`, `module-boundary-checker`, `offline-sync-auditor`, `test-auditor`,
`ui-accessibility-reviewer`) came back clean on correctness — the CSS opacity override
(`.scoring-toggle[data-readonly='true'] { opacity: 1; }`) was live-verified in-browser
(computed opacity 1, white-on-danger-red at ~8.25:1) and confirmed by
`ui-accessibility-reviewer` to clear AA across all three tones in both light and dark
surface modes, with margin. Two small findings, both closed: **`code-reviewer`** caught a
dead `interactive &&` guard left over from the `locked` fix (unreachable in every current
call site — simplified); **`test-auditor`** caught that the new "toggle tap during an
in-flight confirm" integration test only proved a render happened, not that the tap's own
draft mutation survived — closed with a direct post-unlock `data-tone` assertion.

409 tests total (up from 355 after T4.4) — new files `scoring.test.js` and
`scoringScreen.test.js`, plus additions to `outbox.test.js` (the `.permanent` mechanism)
and a split-for-honesty pair in `setup.test.js`.

Unlike T4.3/T4.4, this screen has **no direct-write gap** — it's the first Cup Taster
surface that actually routes through Phase 3's outbox end to end, closing part of the
known gap those two tasks carried forward (see ROADMAP.md; the app-mode/manual-mode timing
screens themselves still write directly, that gap is unchanged).

---

## Phase 4 — Cup Taster · 2026-08-23 (T4.4)

### T4.4 Timing surface, manual mode

Scope decided with the user before writing code, via two explicit questions: (1) stay
scoped to the manual-mode surface itself, not also retrofit T4.3's app-mode screen with a
manual-entry fallback for a mid-heat device failure — the spec sentence that prompted the
question ("a heat may mix tapped and hand-entered times if a stopwatch fails mid-heat,"
§7.1) only makes sense as an app-mode recovery path (`recordTap` requires `status ===
'timing'`, which a manual-mode heat never enters), so building it would have meant
touching T4.3's already-shipped, already-reviewed screen — noted as a deferred gap rather
than silently dropped; (2) logic plus a real screen now, matching T4.2/T4.3's precedent.

`src/formats/cup-taster/timing.js`: three previously-private functions —
`buildClampedUpdate`, `findHeatEntry`, `tryAdvanceToScoring` — are now exported so the new
manual-mode module can reuse them rather than reimplementing the same write-payload
builder, entry lookup, and advance-retry wrapper. `maybeAdvanceToScoring`'s status filter
generalized from `.eq('status', 'timing')` to `.in('status', ['pending', 'timing'])`,
since a manual-mode heat "skips timing" entirely (§7.1) — it advances straight from
`pending` to `scoring`, never passing through `timing` at all. Verified safe for app mode
too: a still-`pending` app-mode heat can never have any entry with `elapsed_secs` set,
since nothing can write one before `startHeat` flips status to `timing` — confirmed by
`scoring-auditor` tracing every writer in the repo, not just asserted.

`src/formats/cup-taster/timingManual.js` (new): `recordManualTime(heatId, entryId,
rawSecs, client, {now})` — validates `rawSecs` is a non-negative integer before any DB
call, validates `timing_mode === 'manual'` and `status === 'pending'`, writes via the same
`buildClampedUpdate` the tap path uses (`time_source: 'manual'`), then calls
`tryAdvanceToScoring`. The one deliberate behavioral difference from `recordTap`: this
_allows_ overwriting an already-recorded time — no `.is('elapsed_secs', null)` race guard
— since a judge correcting a mis-typed number is normal, expected workflow here, not a
race to defend against, given the project's existing single-writer assumption (handoff
§9). That correction window is bounded by the `pending` guard, not open-ended: once every
entry has a time and the heat auto-advances to `scoring`, further writes are refused, same
as the tap path locks once a heat leaves `timing`.

`src/formats/cup-taster/timingManualScreen.js` + `.css` (new): every row shows an editable
minutes/seconds pair the whole time the heat is `pending` — unlike T4.3's Stop button
(permanently replaced once tapped), there's no locked/unlocked distinction here, since
re-saving is always allowed. Pre-fills from `elapsed_secs_raw` (the true value a judge
typed), never the clamped `elapsed_secs`, so re-saving an already-maxed entry without
changes can't silently "fix" what's displayed as entered. Reuses `timingScreen.js`'s
`renderTimingRows` directly for its own read-only "Timing complete" view rather than
duplicating that rendering logic. `formatCountdown` (local to `timingScreen.js`) was
extracted to `src/core/duration.js` as `formatDuration` on its 2nd verbatim use (now
needed by both screens) — format-agnostic, any future format needing duration display
could reuse it unedited.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — run in parallel, then the four with findings re-run
after fixes (`module-boundary-checker` came back clean both times reused-logic reasoning
holds; skipped its second pass since nothing in the fix round touched an import or a
boundary). Every other reviewer found something real:

1. **`ui-accessibility-reviewer` (the most significant finding, and the only one that
   needed two attempts to actually close): a genuine 360px horizontal-overflow bug**, of
   the exact class T4.3 already hit once. `.manual-timing-row`'s original
   `flex-direction: column; align-items: flex-start;` broke the inherited ellipsis
   truncation on a long cupper name — the harness's own test name happened to just barely
   fit, masking it; a longer name reproduced real page-level overflow (540px vs. a 360px
   viewport). **First fix attempt (removing `align-items: flex-start` entirely) did not
   actually work** — it just fell back to the base `.timing-row` class's own
   `align-items: center`, which has the identical non-stretch problem. The re-review
   agent caught this independently rather than trusting the description, by measuring
   actual computed layout with the same long name. Real fix: explicitly set
   `align-items: stretch` to override the base class, verified afterward at both 360px
   and 320px with `clientWidth < scrollWidth` on the name element itself (genuine
   truncation, not coincidental fit).
2. **`ui-accessibility-reviewer`: every row's Save/Update button shared the same
   accessible name** ("Save" on every row, indistinguishable in a screen-reader rotor) —
   a regression against T4.3's own established pattern (its Stop button already solved
   this with a per-cupper `aria-label`). Fixed the same way:
   `` `${saveLabel} ${entry.displayName}'s time` ``.
3. **`ui-accessibility-reviewer` (flagged as worth tracking, addressed anyway): the
   success announcement didn't convey a heat-completion state transition.** When a save
   is the one that flips the heat from `pending` to `scoring`, the screen swaps to the
   read-only "Timing complete" view underneath the user — but the announcement still just
   said "{name}'s time recorded," giving a screen-reader user no indication the whole
   screen just changed shape. Fixed with a `checkForCompletionOnNextRender` flag, checked
   against the freshly-loaded heat status at the top of the next render, appending
   "Timing complete — every cupper has a final time." only on the completing save.
   `test-auditor`'s re-review found the first version of this fix's own test only proved
   the branch _could_ fire, not that it wouldn't fire on a _non_-completing save — closed
   with a paired negative assertion, verified by deliberately mutating the guard to
   always fire and confirming the new assertion catches it.
4. **`scoring-auditor`: `recordManualTime`'s module comment said corrections were allowed
   "before the heat closes,"** which reads as open-ended, but the actual guard is
   `status !== 'pending'` — tightened to accurately describe the bounded window.
5. **`code-reviewer` (two minor items): dead code** — a `focusAfterRender` variable in
   the new screen was declared, checked, and reset, but never actually assigned anywhere
   (removed); and **a stale comment** referencing the now-deleted `formatCountdown`
   (updated to `formatDuration`).
6. **`test-auditor`: `parseElapsedInput`'s seconds boundary (0–59) was untested at the
   actual boundary** — only far-off values (75, -1) were covered. Confirmed via real
   mutation testing (a `seconds >= 59` off-by-one passed every existing test undetected).
   Closed with explicit 59-accepted/60-rejected cases.

355 tests total (up from 325 after T4.3) — 9 new in `timingManual.test.js` (new file), 20
new in `timingManualScreen.test.js` (new file), 2 new in `duration.test.js` (new file,
moved from `timingScreen.test.js`'s old `formatCountdown` tests), 1 new in `timing.test.js`
(the generalized `maybeAdvanceToScoring` covering manual mode's `pending`→`scoring` path).

**Known gap, carried forward, not silently dropped:** the app-mode fallback described in
§7.1 ("a heat may mix tapped and hand-entered times if a stopwatch fails mid-heat") is not
built — see ROADMAP.md's known items.

---

## Phase 4 — Cup Taster · 2026-08-22–23 (T4.3)

### T4.3 Timing surface, app mode

Scope decided with the user before writing code, via three explicit questions: (1) full
lifecycle (start → tap → auto-max at clock zero → transition to scoring), not
tap-recording alone; (2) logic plus a real ticking screen now, matching T4.2's precedent,
rather than deferring the UI; (3) direct writes for now, not wired through Phase 3's
outbox — a deliberate, documented scope gap (this is the first genuinely live,
time-pressured screen in the build plan, exactly what the outbox exists for, but queue
ordering against a live countdown and conflict surfacing deserve a focused pass with
`offline-sync-auditor` rather than folding into this task's first cut).

`src/core/timeclamp.js`: `clampElapsed()` now handles negative input too — floors
`elapsed` to 0 (clock skew between client and server, since the tap path computes elapsed
against a server-recorded `started_at`) while `raw` always preserves the true unclamped
value, so the audit trail the schema comment promises (§5.2) is never lost before it
reaches the one function responsible for enforcing the cap. This is the sole place both
bounds — negative floor and duration ceiling — are enforced.

`src/formats/cup-taster/timing.js` (new): `startHeat` (idempotent — a heat already timing
is returned unchanged rather than restarting the clock, which would corrupt the meaning
of every already-recorded elapsed time), `recordTap` (the tap path — `MAX_NEGATIVE_SKEW_SECS`
= 5 rejects a computed tap more than 5s before `started_at` outright, before it ever
reaches `clampElapsed`, so a broken client clock can't silently hand a cupper the fastest
time in the heat; `.is('elapsed_secs', null)` on the update closes the race between the
read-check and the write for two concurrent taps; a lost race re-fetches and distinguishes
a genuine duplicate-tap collision from a race lost to the master clock expiring first),
`autoMaxRemainingEntries` (called by the UI once its own local countdown detects expiry —
there is no server-side timer, §8.2 — maxes everyone still running via the same
`clampElapsed` cap a real tap uses), `maybeAdvanceToScoring` (timing → scoring once every
entry has a final time), and `tryAdvanceToScoring` (wraps the advance-to-scoring call so a
failure there — the triggering tap or auto-max write already succeeded by that point —
never propagates as if the tap itself failed; logs and lets the next write for that heat
retry the same check).

`src/formats/cup-taster/timingScreen.js` + `timingScreen.css` (new): the live-countdown
screen. Rebuild-then-refocus (§15.3) for real actions, but the countdown itself is
deliberately excluded from that cycle — a full DOM rebuild every second would flicker and
steal focus, so `tick()` only mutates the countdown element's `textContent`, while
`render()` runs only after start/tap/auto-max. The countdown display is intentionally not
an `aria-live` region (a value changing every second would spam announcements — confirmed
against WAI-ARIA/MDN guidance); real state changes (a stop recorded, the heat completing,
crossing the ≤10s urgent threshold once) go through the existing `screen-feedback` live
region instead. `timingScreen.preview.html` is a demo-only harness (in-memory fake client,
20s duration instead of a real ~480s heat so the full lifecycle is observable directly),
matching `heatsScreen.preview.html`'s precedent.

Two format-agnostic helpers reached their second verbatim use this task and were
extracted to `src/core/` rather than duplicated again: `dom.js` (`el()`, the DOM builder)
and `errors.js` (`describeError()`) — both originally local to `heatsScreen.js`. This is a
different call than "three similar lines is better than premature abstraction": these
were 100%-identical functions, not merely similar ones, so extraction on the 2nd
occurrence rather than waiting for a 3rd. `heats.js`'s `hydrateStageEntries` was renamed
to `hydrateEntries` and its doc comment updated — it already worked generically over
anything carrying `entry_id` (`ct_stage_entries` or `ct_heat_entries` rows both do), and
`timing.js`/`timingScreen.js` now reuse it unedited rather than reimplementing it, exactly
the §6 test this project holds itself to. `core/registry.js` gained `listEntriesByIds`
(the roster-by-id-list lookup the timing screen needs, that `listEntries`'s
whole-event-roster form didn't cover).

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — run in parallel, then re-run after fixes across two
total rounds. `scoring-auditor` and `module-boundary-checker` came back clean both rounds.
The others each found real issues:

**Round 1:**

1. **`scoring-auditor` (the most significant finding): a pre-clamp in `timing.js` floored
   negative elapsed values to 0 before they ever reached `clampElapsed()`**, splitting the
   "sole writer" authority the function exists to hold and silently destroying the true
   skewed value `elapsed_secs_raw` is supposed to preserve, with no bound distinguishing
   "200ms of clock skew" from a broken client clock. Fixed as described above:
   `clampElapsed()` itself now floors `elapsed` while always preserving `raw`, and
   `MAX_NEGATIVE_SKEW_SECS` rejects anything beyond 5s outright.
2. **`ui-accessibility-reviewer` (D9, blocking): the `is_test` banner was entirely
   missing** — `mountTimingScreen` didn't even take an `eventId`. Fixed: added the param,
   `findEvent()` in `loadState()`, and the banner render, matching `heatsScreen.js`.
3. **`ui-accessibility-reviewer`: rebuild-then-refocus only covered the `startHeat`
   success path** — a stop tap or an auto-max left focus wherever it happened to be.
   Fixed: `render()` now falls back to focusing the feedback region whenever it carries a
   tone and no explicit target was requested, extending `heatsScreen.js`'s existing
   error-only fallback to also cover success.
4. **`ui-accessibility-reviewer`: no success-path live-region announcements at all** —
   `setFeedback` was only ever called from catch blocks. Fixed: `onStop`/`handleExpiry`
   now set a `pendingSuccess` message applied the same way `pendingError` already was.
5. **`ui-accessibility-reviewer`: no announcement when the countdown first crosses the
   urgent (≤10s) threshold.** Fixed with a one-time `urgentAnnounced` flag mutating the
   live feedback element directly (not a full render, to avoid flicker mid-tick).
6. **`ui-accessibility-reviewer`: heading structure was conflated** — the ticking
   countdown div also carried the only `id`/heading role for that section, and the
   per-cupper row list had no heading at all. Fixed: a stable `<h2 id="countdown-heading">`
   separate from the ticking display, plus a real `<h2>Cuppers</h2>` above the row list.
7. **`code-reviewer`/`test-auditor`: `.heats-screen`/`.timing-screen` container CSS was
   byte-for-byte duplicated** between the two screens' stylesheets. Extracted to a shared
   `.screen-container` class in `heatsScreen.css` (both sheets are always loaded
   together); added the `[data-tone='success']`/`[data-tone='urgent']` CSS the new
   announcements needed.
8. **`test-auditor`: the auto-max "stops ticking" test only proved no further DB calls
   happened**, which would pass even with a harmlessly-leaked interval — `expiryHandled`
   blocks re-entry regardless of whether the timer was actually cleared. Fixed with a
   `vi.spyOn(global, 'clearInterval')` assertion proving the teardown itself, not just an
   absence of side effects. Also tightened a `toContain('Max time')` assertion to the
   exact `toBe('Max time (8:00)')`.

**Round 2** (re-verification of round 1's fixes, all five reviewers): `scoring-auditor`
and `module-boundary-checker` confirmed clean. `ui-accessibility-reviewer`,
`test-auditor`, and `code-reviewer` each found one more real issue:

9. **`ui-accessibility-reviewer`: a 360px overflow risk** — `.timing-row` had no
   `min-width: 0`/truncation handling between a long cupper name and the fixed-width Stop
   button, so a long enough name would push the button off the edge of the card rather
   than wrapping or truncating. Fixed with `min-width: 0` + `text-overflow: ellipsis` on
   the name, `flex-shrink: 0` on the button — live-verified at 360px with a 28-character
   name (would have overflowed to 226px, correctly truncates to 104px, no page-level
   horizontal scroll).
10. **`ui-accessibility-reviewer`: `handleExpiry`'s zero-maxed path left focus/feedback
    unmanaged** — reachable via the `tryAdvanceToScoring` retry design (a transiently
    failed status transition can leave a heat in `'timing'` with every entry already
    stopped until the master clock also expires and this handler fires as the retry), not
    just hypothetical. Fixed: `handleExpiry` now always sets a `pendingSuccess` message,
    even when nothing needed maxing.
11. **`code-reviewer`: `unmount()` didn't abandon a `render()` already in flight** — it
    called `stopTicking()` but never bumped the generation counter, so a slow in-flight
    render (awaiting `loadState()`) could still finish after teardown, rebuild into a
    discarded root, and register a fresh interval/listener nothing would ever clear again.
    Fixed by bumping `renderGeneration` in `unmount()` too, giving it the same
    "abandon if superseded" protection a newer render already has over an older one.
    Verified with a deliberate revert-and-rerun: the new regression test fails cleanly
    against the un-fixed code and passes against the fix.
12. **`test-auditor` (two gaps):** the `MAX_NEGATIVE_SKEW_SECS` boundary was untested at
    its exact cutoff (only -2s and -10s were covered — an off-by-one would have passed
    undetected); fixed with cases at exactly -5s (accepted) and -6s (rejected). The
    render-race generation counter had zero test coverage despite being realistically
    triggerable (two Stop taps in quick succession); fixed with a deterministic test using
    a small in-memory client whose `events` query (loadState's first await, untouched by
    `recordTap`) is gate-controlled, letting the test pin down exactly which of two
    concurrent renders "wins" without needing to guess real microtask interleaving order.

325 tests total (up from 272 after T4.2) — 23 new in `timing.test.js` (new file), 20 new
in `timingScreen.test.js` (new file), 5 new in `dom.test.js` (new file, extracted), 3 new
in `errors.test.js` (new file, extracted from `heatsScreen.test.js`), 2 new in
`timeclamp.test.js`, 3 new in `registry.test.js` (`listEntriesByIds`).

---

## Phase 4 — Cup Taster · 2026-08-22 (T4.2)

### T4.2 Heat generation: stage-entry seeding, random + manual, station assignment

Scope decided with the user before writing code, same as T4.1: no explicit AC exists for
T4.2 in the handoff, and no task owns seeding a stage's entries from the roster. Unlike
T4.1, this task does ship a real screen — the first one in the project, and the first
real consumer of `src/ui/tokens/`.

`src/core/registry.js`: added `listEntries(eventId, client)` — generic, reusable by a
future format. `src/core/events.js`: added `findEvent(eventId, client)`, used so the
screen can render `is_test` (below).

`src/formats/cup-taster/heats.js` (new): `seedFirstStageEntries` (idempotent, seeds only
the ordinal-1 stage from non-withdrawn roster entries — later stages get their entries
from T4.6's advancement logic, not this function), `buildHeatPlansFromSizes` (pure,
Fisher-Yates shuffle + `core/partition`'s own sizing — not reimplemented),
`buildHeatPlansFromAssignments` (pure, manual path — every stage entry must be assigned
exactly once, heat numbers sequential, `HEAT_MIN` enforced, stations unique per heat),
`createHeat`/`ensureHeatEntries` (idempotent, config-drift-checked, bounded-retry-on-race
— directly reusing T4.1's `setup.js` patterns, including its bounded-retry asymmetry fix
applied proactively this time), `generateHeatsRandom`/`generateHeatsManual`,
`listHeatsForStage`.

`src/formats/cup-taster/heatsScreen.js` + `heatsScreen.css` (new): the screen itself —
roster display, a "seed from roster" action, random-generate button, a manual
heat/station assignment form, a read-only generated-heats view. DOM built via
`createElement`/`textContent` only (roster names are user-entered, never trusted as
markup). Rebuild-then-refocus (§15.3) throughout. `heatsScreen.preview.html` is a
demo-only harness (in-memory fake client, no live backend needed), matching
`src/ui/tokens/preview.html`'s own pattern — used to verify the screen live in a real
browser at 375px, not just in jsdom.

Verifiers: `scoring-auditor`, `ui-accessibility-reviewer`, `module-boundary-checker`,
`test-auditor`, `code-reviewer` — run in parallel, then re-run after fixes across three
total rounds (the first two heavier, the third a targeted close-out of the second
round's own fix). `module-boundary-checker` came back clean both rounds. The others each
found real issues:

**Round 1:**

1. **`scoring-auditor`: no test proved `generateHeatsRandom` rejects a stage below
   `HEAT_MIN`** — the behavior was already correct (propagates `core/partition`'s own
   throw, not reimplemented), just unproven. Closed with a test.
2. **`code-reviewer` (the most significant finding across all of T4.2): a genuine
   partial-failure of heat generation could be silently displayed as "fully
   generated."** `createHeats` has no batch-level atomicity — if it throws after heat 1
   commits but before heat 2 does, the old render gate (`heats.length === 0`) treated
   any non-empty heat list as done, hiding that some cuppers were never assigned a heat,
   with no way back into generation from the screen. Fixed: the render logic now
   computes `generationComplete` (every stage entry's id present across the union of
   all generated heats' entries — an identity check, not a count) and branches three
   ways: no heats yet / heats exist but incomplete (a new, honest "Heat generation
   incomplete" state, offering no retry — regenerating isn't provably safe) / heats
   exist and complete.
3. **`code-reviewer`: raw DB/Postgrest error strings flowed straight into the
   user-facing feedback panel**, undifferentiated from this module's own descriptive
   thrown errors. Fixed with a `describeError()` helper (exported, unit-tested) that
   only passes through a plain `Error` with no `.code`; anything else (a raw Postgrest
   failure) gets a generic fallback message.
4. **`ui-accessibility-reviewer`: `is_test` wasn't rendered anywhere, and the screen
   didn't even fetch it** — flagged as worth fixing now (not deferring to T5.3/T5.4)
   given `src/ui/tokens/DESIGN.md`'s explicit "every surface" language and D9. Fixed:
   `loadState()` now fetches the event and renders `.is-test-banner` (already built,
   already contrast-verified in the design-system work) whenever `is_test` is true.
5. **`ui-accessibility-reviewer`: error feedback landed at the bottom of the page with
   no scroll-into-view or focus move** — a real gap for sighted users not using
   assistive tech. Fixed with `scrollIntoView`/`.focus()` on the feedback region.
6. **`test-auditor` (four findings):** a shuffle "proof" that sorted output before
   comparing (would pass even with a no-op shuffle — fixed with a hand-traced,
   independently-verified-by-running-the-code exact-order assertion); a bounded-retry
   test that only checked the error message text, not the actual insert-call count
   (fixed); an error-injection test coupled to an undocumented call-order assumption
   (fixed by replacing the monkeypatch with the same plain queue-based mocking used
   everywhere else in the suite); no test proving a manual-assignment validation error
   surfaces through the mounted screen (fixed).
7. Minor comment-accuracy fixes (`listHeatsForStage`'s query-cost comment overstated
   itself as "two queries" when it's 1+N sequential; a form-reading comment claimed
   `NaN` where `Number('')` is actually `0`) and removal of three CSS rules with zero
   call sites (`.btn-secondary`, `.field-label`, `.screen-feedback[data-tone='success']`)
   rather than kept as speculative forward-declarations.

**Round 2** (re-verification of round 1's fixes, all four reviewers): `scoring-auditor`,
`ui-accessibility-reviewer`, and `test-auditor` confirmed their findings genuinely
closed — `test-auditor` specifically via mutation testing (patching the real shuffle to
a no-op, patching the retry bound off-by-one, and confirming the new tests actually
fail), and additionally found the two new "completeness" tests didn't distinguish the
real identity-based check from a weaker count-based stand-in (fixed with a test using
duplicate entries across heats). `code-reviewer` found one more real gap in finding 2's
fix: **the render logic only refreshed from real DB state on the _next_ mount** — within
the _same_ browser session, a failed generate click left the stale "Generate heats"
button live, and a second click would reshuffle the entire roster fresh; since
`ensureHeatEntries` only checks for a station conflict within the _same_ heat (not
across heats), a cupper already committed to heat 1 could silently end up placed in
heat 2 too, with nothing to catch it.

**Round 3** (targeted close-out of round 2's fix): every action handler now
unconditionally re-renders after its attempt, success or failure (carrying the error
message across via a `pendingError` variable, since a failed re-render's fresh feedback
element didn't exist yet at catch-time). Since the re-render itself calls `loadState()`
fresh and that could also fail, a `renderOrShowError()` wrapper falls back to writing
the error directly onto whatever DOM is still live rather than crashing with an
unhandled rejection. `code-reviewer` re-checked this specific fix once more and found it
correct — including that the scroll/focus-on-error logic never double-fires or
misses across the two code paths that can now set an error.

272 tests total (up from 209 after T4.1) — 33 new in `heats.test.js` (new file), 25 new
in `heatsScreen.test.js` (new file), 2 new in `events.test.js` (`findEvent`), 3 new in
`registry.test.js` (`listEntries`).

**Also this session, unrelated to T4.2 itself:** `kb-sync` and `module-boundary-checker`
moved to a cheaper model (`model: haiku`) per user decision, to economize token usage on
the more mechanical reviewers. The five correctness/security gate agents, plus
`test-auditor` and `ui-accessibility-reviewer`, stay on the full model — see `CLAUDE.md`'s
delegation strategy section.

---

## Phase 4 — Cup Taster · 2026-08-22 (T4.1)

### T4.1 Setup: stage plan, sets, roster

Scope decided with the user before writing code (no explicit AC exists for T4.1 in the
handoff, unlike T4.5/T4.6, and no task creates an `events` row anywhere in the build
plan): this task ships the tested logic module only, no rendered screen — a UI pass
lands once more of Phase 4 exists to build one screen against, not four thin ones. Event
creation was added as a minimal function (not a screen), since without it the setup flow
has nothing to attach a stage plan to.

`src/core/events.js` (new): `createEvent(orgId, event, client)` — generic, takes
`format` as plain input rather than assuming Cup Taster, so a future format (Guess the
Bean) reuses it unedited. Tested with both `format: 'cup_taster'` and
`format: 'guess_the_bean'` to prove that directly.

`src/core/registry.js`: added `registerEntry(orgId, eventId, cupper, client)`, composing
the existing `registerPerson` + `createEntry` for the common case (a cupper with a
phone). Placed in `core/registry` rather than the Cup Taster format module — nothing
about the composition is Cup-Taster-specific, so a future identity-core format can reuse
it unedited too.

`src/formats/cup-taster/setup.js` (new): `validateStagePlan` (pure) and
`createStage`/`ensureSetsForStage`/`createStagePlan` (idempotent, Supabase-backed). This
is the genuinely Cup-Taster-specific half of the task — stage `kind`/`cutoff`/`set_count`
are §2/§7.5 vocabulary a future format wouldn't share.

Verifiers: `scoring-auditor`, `module-boundary-checker`, `test-auditor`, `code-reviewer`
— run in parallel, then `scoring-auditor`/`code-reviewer`/`test-auditor` re-run after
fixes. `module-boundary-checker`'s review came back clean both on registry/events
placement and on a live synthetic-violation probe confirming `no-core-format-import`
actually fires. The other three each found real issues, across two full review-and-fix
rounds:

**First round:**

1. **Blocking (`scoring-auditor`): `createStage` silently discarded config drift on
   retry.** If a stage already existed at an ordinal, the existing row was returned
   verbatim with no comparison against the newly-passed cutoff/setCount/durationSecs —
   indistinguishable from a legitimate correction (an organiser fixing a typo'd cutoff
   before the event), which would then be silently lost with no error. Since `cutoff` is
   the fixed advancement field (D20) and `duration_secs` gets snapshotted per-heat later,
   a stale value here would silently mis-size the field or mis-time heats. Fixed:
   `createStage` now compares the existing row against the incoming config and throws a
   descriptive conflict error on any mismatch, rather than assuming "found" means
   "identical."
2. **`scoring-auditor`: cutoff monotonicity across stages was unvalidated.** A plan like
   `prelims: cutoff 8, semis: cutoff 16` passed `validateStagePlan` cleanly, and
   `core/advancement` would then silently treat the oversized cutoff as "everyone
   advances" instead of trimming the field. Fixed: each non-terminal stage's cutoff must
   now be ≤ the previous stage's.
3. **`scoring-auditor` + `code-reviewer` (independently, same defect): kind/ordinal
   weren't tied to canonical progression.** A plan with `finals` at ordinal 1 and
   `prelims` at ordinal 2 passed every per-stage check individually. Fixed:
   `validateStagePlan` now checks the whole kind sequence against the two real
   configurations (§7.5) — exactly `["prelims","finals"]` or
   `["prelims","semis","finals"]`, in that order.
4. **`code-reviewer`: the idempotency claim didn't hold under concurrent callers.**
   Check-then-create has nothing serializing the check and the insert — two concurrent
   callers (a double-click, a flaky-connection retry racing the original request) could
   both pass the "not found" check, and the loser would get a raw Postgres
   unique-violation propagated unchanged. Fixed: both `createStage` and
   `ensureSetsForStage` now catch a unique-violation (`23505`), re-fetch, and either
   adopt the winning row (if it matches what was requested) or throw the same
   config-conflict error a sequential retry would have gotten.
5. **`test-auditor` (six findings):** a `registerEntry` dedup test that never actually
   asserted no duplicate person was created (would have stayed green even with the dedup
   bypass reintroduced); a `createStagePlan` "ordinal order" test that didn't prove order
   at all; `createStage`'s camelCase→snake_case payload mapping never checked; idempotency
   proven only via separately-scripted branches rather than a real double-invocation
   against one shared client; terminal-stage-by-highest-ordinal proven only incidentally;
   no non-mutation test for `validateStagePlan`'s input. All six closed, each with a
   proof traced by re-verification to confirm it would actually fail if the bug it
   targets were reintroduced — not just a same-named test.

**Second round** (re-verification of the first round's fixes): `scoring-auditor` and
`test-auditor` confirmed all their findings genuinely closed. `code-reviewer` found one
more real gap in the concurrent-race fix: `ensureSetsForStage`'s retry only survived
_one_ level of racing — a second collision on the retry's own insert would throw the raw
error unchanged, contradicting the function's own doc comment. Fixed with a bounded
retry loop (`MAX_INSERT_ATTEMPTS = 3`), throwing a clear "gave up" error only once every
attempt has collided. Also fixed: duplicated conflict-error message construction
(extracted to `throwConfigConflict`), and a single formatter fragilely reconciling two
different object shapes (DB row vs. camelCase request) via `??` fallbacks — split into
`describeStoredStage`/`describeRequestedStage`, each handling only its own real shape.

**Third round** (targeted close-out of the bounded-retry fix specifically):
`code-reviewer` found one more asymmetry — the loop's "already done" check only ran at
the top of each iteration, so the recompute after the _final_ attempt's collision was
never re-checked. A race that actually resolved in our favor on the last collision would
still report "gave up" instead of the success it had already reached. Fixed with an
explicit post-loop check, plus a test proving it (3rd attempt collides, but the
recompute immediately after shows nothing missing → resolves normally, not "gave up").

209 tests total (up from 163 before this task) — 38 new in `setup.test.js` (new file),
5 new in `events.test.js` (new file), 3 new in `registry.test.js`'s `registerEntry`
block.

---

## Phase 3 — Registry and offline · 2026-08-22 (T3.3)

### T3.3 Sync state panel

`src/core/syncState.js`: `computeSyncState({ enabled, operations, lastFlushError })` —
pure derivation of the three-state panel (handoff §8.4: off / live / not synced). No UI
exists anywhere in this project yet (Phase 4/5 build actual screens), so this is
deliberately just the state-derivation logic a future panel will render, not a rendered
component. `stuckOperation` surfaces the first queued operation with `attempts > 0` —
closing the "a poison operation accumulates silently with no way to reach a human" gap
`offline-sync-auditor` flagged as deferred during T3.2's review.

Verifier: `offline-sync-auditor`, live-run via the Agent tool, twice (a first pass and a
re-verification after fixes) — matching Phase 3's other two tasks, not a clean pass
either time.

**First pass found three real issues**, the first a genuine fail-open violation:

1. `enabled` was checked _before_ the outbox's own real state — `enabled: false` could
   mask a genuinely pending or failed operation behind "off," which reads as an
   unalarming, expected state. Exactly the kind of lie "fail-open never lies about a
   write that failed" (§8.4) exists to prevent, and the original test suite had
   pinned this as intentional ("stays 'off' even if operations/error are (incorrectly)
   passed while disabled") rather than catching it. Fixed by checking pending
   operations/`lastFlushError` first, `enabled` only once both are already clean —
   `enabled: false` now correctly returns "not synced" whenever real work is
   outstanding.
2. **A real bug in already-merged T3.2 code, found via this review**: `outbox.js`'s
   missing-handler check threw _before_ the `try` block that persists
   `attempts`/`lastError`, so an operation whose type had no registered handler could
   never accumulate attempts — meaning it could never surface via `stuckOperation`
   despite permanently blocking the queue exactly like any other poison operation.
   Fixed by moving the handler lookup inside the `try`; confirmed the reordering
   doesn't change the successful-handler path at all, only how a missing handler is
   recorded. `flushOutbox`'s contract changes as a result (resolves with
   `{stopped:true, error}` instead of rejecting) — noted for whoever wires up the sync
   engine next, since nothing calls `flushOutbox` yet.
3. `operations: null` crashed with a `TypeError` instead of degrading to a defined
   state. Fixed with an `Array.isArray` guard.

**Re-verification found one more, smaller gap** in fix 3: an array _containing_ a
null/undefined element (e.g. `[null, {id:'x', attempts:1}]`) still crashed on
`.find()`, since `Array.isArray` only guards the outer shape. Fixed with `op?.attempts`.
Not reachable from any current real caller (`listPendingOperations()` → IndexedDB
`getAll()` can't produce array holes), but closes the same class of gap fix 3 was
meant to close, not just its literal stated case.

**Final `code-reviewer` pass** (pre-commit, scoped to this task's files only) found two
more minor, non-blocking edge cases, both fixed:

4. `syncState.js` checked `lastFlushError` as truthy rather than "is set" — an error
   whose `message` came back as `''` (a handler throwing something other than a
   well-formed `Error`) would have read as "no error." Not reachable today
   (`pendingCount > 0` already forces "not synced" independently, since a failed
   operation is never removed from the outbox), but fixed anyway per the fail-open
   discipline this file is built around: `lastFlushError != null` instead of a bare
   truthy check, plus a test pinning `lastFlushError: ''` as still "not synced."
5. `outbox.js`: if `outboxRemove` itself throws right after a handler succeeds
   (IndexedDB quota/contention), the same catch re-persists the operation as a normal
   failure and a retry re-invokes the already-succeeded handler. Not a bug — each
   handler owns its own idempotency (confirm_heat's ledger, for example) — but the
   failure mode wasn't documented at the call site; added a comment.

163 tests total across the whole suite (up from 152; 11 new for `syncState.js`, plus
`outbox.test.js`'s missing-handler test rewritten to assert the corrected behavior).

---

## Design system foundation (`src/ui/tokens/`) · 2026-08-22

**No single §14 task ID** — this isn't one of the numbered build-plan tasks. It closes
the open item ROADMAP.md carried since Phase 2 ("`src/ui/tokens/` is an empty Phase 0
placeholder; real tokens land starting Phase 4, when UI work begins") ahead of Phase 4
starting, so T4.1–T4.8 (all reviewed by `ui-accessibility-reviewer` per §14) have a real
token layer to build on from their first commit rather than inventing one mid-task.

**What shipped**: `colors.css`, `typography.css`, `spacing.css`, `base.css`, `fonts.css`
\+ `fonts/*.woff2` (8 files), `index.css` (single entry point, fixed import order:
fonts → colors → typography → spacing → base), `DESIGN.md` (full rationale — three
refero.design references used as a starting point, a computed WCAG contrast table, the
Do/Don't guideline list), `preview.html` (live style guide exercising every token in both
surface modes), and `index.html` wired to load `index.css` so the existing placeholder
scaffold already inherits it. Full reasoning lives in `src/ui/tokens/DESIGN.md` — not
reproduced here; this entry records what shipped and what review found, not the design
argument.

Architecture in one paragraph: one warm neutral ramp (`--clr-clay-50`–`950`) shared by
two surface modes, `:root`/`[data-surface="paper"]` (light, organiser + phone) and
`[data-surface="stage"]` (dark, projector) — every semantic token follows one symmetric
rule (paper = dark tone + white `-contrast`, stage = light tone + `clay-950` `-contrast`)
so the mode switch has zero per-color exceptions. `--color-test` (violet, `#6b21c9`) is
reserved exclusively for `is_test` indicators (D9) and fixed across both modes. No
`box-shadow` token anywhere — flat borders/surface steps only. Three fonts
(Erode/Switzer/Tabular, Fontshare/ITF license) self-hosted rather than CDN-linked.

**Verifiers**: `module-boundary-checker`, `ui-accessibility-reviewer`, and
`code-reviewer`, run in parallel per `CLAUDE.md`'s delegation strategy (touches `src/**`
and is a UI change). **Not a clean pass — all three found real issues**, fixed before
this landed:

- `module-boundary-checker`: `preview.html`'s demo copy used Cup-Taster vocabulary
  ("Heat"/"cuppers") inside what's meant to be a format-agnostic token layer — the one
  place format vocabulary had leaked in. Genericized to "Round"/"judges". Otherwise
  clean — no `core/`↔`formats/` boundary issue, since this layer has no format coupling
  to begin with.
- `ui-accessibility-reviewer` (360px first, per DoD): `--color-focus-ring` was set to the
  accent hue — a focus ring in the same color family as an element's own accent styling
  weakens the focus signal, so it's now the neutral `--color-border-strong`. Added a
  `.tap-target` utility: `--tap-target-min` (44px, WCAG 2.5.5) alone only guaranteed
  `min-height`, not `min-width`, so an icon-only control could still land under 44px
  wide. A real 360px horizontal-overflow bug in `preview.html` (three independent
  causes: an unbreakable 96px mono sample, a grid auto-column that wouldn't shrink below
  its content's intrinsic width, and fixed-canvas type sizes dropped into a narrow
  responsive card) — fixed with flex-wrap + a media query, and `typography.css` now
  documents `--text-5xl`/`--text-6xl` as fixed-canvas-only (projector stage), not for
  arbitrary responsive containers. `--color-gold` was used as plain preview text at a
  measured 4.9:1 (barely-passing, undocumented) — removed in favor of gold-as-fill-only
  (badge background + `-contrast` text), matching the system's own stated guideline.
- `code-reviewer`: an orphaned unused token (`--clr-ember-400`) removed; `base.css`'s
  `.is-test-banner` stripe pattern used hardcoded `10px`/`20px` instead of the spacing
  scale, and carried an untokenized `text-shadow` that contradicted the system's own
  no-shadow rule — both fixed. `DESIGN.md`'s contrast table had one wrong number
  (accent-as-text listed as 5.6:1; actually 5.2:1 — that figure was the button-fill
  pairing, a different case) — split into two separate rows with correct values. A
  Prettier formatting failure across 4 files fixed via `npm run format`.

Every fix was re-verified in the running preview, not just re-read.

**Follow-up in the same session, on explicit user request**: the three Fontshare fonts
were added after the initial token build (colors/type/spacing/base only, system-font
stack). Verified in-browser after adding: network tab shows 200s for all 8 `.woff2`
files, computed styles confirm the webfonts apply over the fallback stack, and the
360px fix above still holds with real fonts in place (fonts change metrics; re-checked
rather than assumed).

**Decisions closed this session, not yet in the handoff's §12 record** (recorded here
per §0 — the handoff itself is never edited to reflect progress; a new decision is a new
row logged in this file, not a rewrite of the frozen document):

- **D30 — Self-hosted webfonts only, never a third-party CDN link (Fontshare's or
  otherwise).** The app runs at live events on venue wifi of unknown quality; a font
  request that has to succeed mid-event is a single point of failure this project can't
  accept, matching the same offline-first posture Phase 3's outbox work already commits
  to. `fonts.css` uses `font-display: swap` and every `--font-*` token keeps a full
  system-stack fallback after the webfont name regardless, so a slow/failed load still
  renders instantly rather than blocking — the self-hosting rule is belt-and-suspenders
  on top of that, not a substitute for it.
- **D31 — No `box-shadow` token in the design system; elevation is a border or a
  background-color step.** All three refero.design references this system started from
  separate surfaces with a hairline border or a flat color step, never a drop shadow —
  for a tool whose output is a competition scoresheet, that flat register was judged to
  read as rigor rather than SaaS gloss. Enforced only by convention/review for now (no
  lint rule); `code-reviewer`'s finding above (an untokenized `text-shadow` slipping into
  `base.css`) is the first real instance of what this decision is guarding against, so a
  future session should consider whether it's worth a lint rule once there's more than
  one occurrence to justify it.

**Open follow-up**: no real screen consumes these tokens yet (Phase 4 is "not started"
per `ROADMAP.md`) — `preview.html` and `index.html`'s `<link>` are the only current
consumers. `ui-accessibility-reviewer`'s 360px-first review covered the token layer and
`preview.html` itself; it has not yet reviewed a real product screen built on top of it,
since none exists — that review happens per-task starting Phase 4 (T4.1's own DoD), not
retroactively satisfied by this entry.

---

## Cloudflare Workers connected · 2026-08-22

Noticed mid-session, not initiated by this session: opening T3.2's PR surfaced an
unexpected third CI check, "Workers Builds: seduh-score-next," from Cloudflare's official
"Cloudflare Workers and Pages" GitHub App — with a real build ID and live preview URLs
(`https://5ec46df3-seduh-score-next.workers.dev`,
`https://feat-t3-2-outbox-seduh-score-next.workers.dev`). This meant the GitHub repo was
now connected to a real Cloudflare Workers project, which neither this session did (no
Cloudflare credentials or dashboard access were used) nor matches what T0.1/Handoff
Correction 001 says ("do not deploy and do not connect the repo").

Paused before merging and asked the user directly rather than assuming. Confirmed: the
user connected it themselves and is fine with deploys happening on merge going forward.
Merged T3.2's PR; confirmed a Workers Build check also fires on `main` (production
script), not just PR branches. Updated the "not connected" claims in `README.md` and
`ROADMAP.md`'s open items to match reality — left T0.1's own 2026-08-21 entry below
un-rewritten, since it accurately described the state at the time it was written.

No real app content is served yet either way (Phase 0's placeholder `main.js`/`index.html`
only) — this is a build/deploy pipeline now being live, not a live feature.

---

## Phase 3 — Registry and offline · 2026-08-22

### T3.2 IndexedDB mirror + operation outbox

`src/core/db.js` (IndexedDB wrapper: `cache` + `outbox` object stores, ported
from Kira-Kira's own `db.js`) and `src/core/outbox.js` (the FIFO queue
engine). Deliberately diverges from Kira-Kira's pattern in one way:
`flushOutbox()` takes a `handlers` map as a parameter rather than hard-coding
operation handlers inside the module — Kira-Kira is single-purpose and can
hard-code them, but a hard-coded Cup-Taster-specific handler (e.g.
`confirm_heat`) living inside `src/core/` would fail §6's own test ("can a
future format reuse this module without editing it?"). 22 unit tests (9
db.js, 13 outbox.js) prove generic queue mechanics: FIFO order, attempt-count
tracking, stop-at-first-genuine-failure (never running a later operation
ahead of a stuck earlier one), retry replaying the identical payload, and
concurrent-flush deduplication.

The AC's three specific proofs (atomic flush, idempotent retry, conflict
surfacing) live where the actual guarantee is implemented: new migration
`20260822100000_confirm_heat_rpc.sql`'s `confirm_heat` RPC — one atomic
transaction writing every cupper's time and every set's score together, a
`processed_operations` idempotency ledger keyed on a client-generated
operation id (a retry replays the same id and becomes a safe no-op — checked
_before_ re-validating anything, which matters specifically because
re-validating would compare against the row's now-changed `updated_at` and
misreport a real success as a conflict), and a `P0002` conflict exception
carrying both the current and expected `updated_at` in its `DETAIL`. 13
pgTAP assertions (53 across the whole suite) prove all three directly against
the real database — including the earlier bug T1.1's own comment described
(a partial flush leaving one cupper's results written while another's
strict-confirm failure aborts the whole heat) actually rolling back
completely, not just failing.

Verifier: `offline-sync-auditor` (clean review — see below), `security-reviewer`
(2 rounds — real findings, both rounds), `code-reviewer`.

**`offline-sync-auditor`'s review came back clean**, including on the one
judgment call worth double-checking: whether splitting the AC's proof across
the SQL layer (where the atomicity/idempotency/conflict mechanism actually
lives) and the JS layer (generic queue mechanics, which is all `outbox.js`
could possibly prove or break) is legitimate rather than dodging the AC's
letter. Confirmed legitimate — `outbox.js` has no code path that could
implement or break any of the three specific guarantees.

**`security-reviewer` found three real issues, two of them genuine
production-breaking/security gaps** — not from reading the RPC and reasoning
it looked correct, but from re-testing everything itself, including
re-attacking each fix independently after applying it:

1. `processed_operations` had **no `GRANT` to `authenticated`** — every real
   call to `confirm_heat` would have failed with `permission denied` in
   production. The pgTAP suite passed regardless, because it ran as the
   Postgres superuser (GRANT/RLS-exempt) rather than a real `authenticated`
   role — the same root cause as finding 3. Verified by revoking the grant
   and reproducing `permission denied for table processed_operations` as a
   real `authenticated` caller, then re-granting and reproducing success.
2. `ct_results.set_id` had no check tying it to the same stage as its
   `heat_entry_id`'s heat — the same "two independently-FK'd columns, nothing
   joins them" pattern already found and closed twice (`live_sessions` in
   T1.3, `event_entries`/`person_merges` in T3.1). Closed with
   `app.check_ct_results_set_stage()`, the same trigger shape as its
   precedents; verified to cover a direct `insert`/`update` against
   `ct_results`, not just writes routed through `confirm_heat`.
3. **The pgTAP suite itself never used `set local role authenticated`** —
   every assertion ran as the Postgres superuser, which is exactly how
   findings 1 and a cross-org write went unnoticed. Rewrote
   `005_confirm_heat.sql` with real `auth.users`/`org_members` fixtures and
   every call under a real `authenticated` role; added `003_rls.sql`'s
   missing `processed_operations` non-member-zero-rows and write-rejection
   assertions (a low-severity but real instance of the same "reasoned it
   looked correct instead of proving it" gap, caught in the same
   re-verification pass).

Every fix was re-verified by actually re-attempting the failure it closes,
not by re-reading the diff.

### T3.1 `registry`

`src/core/supabaseClient.js` (lazy client construction, mirroring Kira-Kira's
`getSupabase()` pattern exactly — importing `registry.js` never requires
`VITE_SUPABASE_URL`/`ANON_KEY` on its own) and `src/core/registry.js`:
`findPersonByPhone`, `findPersonByEmail`, `createPerson`, `registerPerson`
(phone-then-email dedup), `createEntry` (snapshots `display_name`/`cafe` from
the person at creation time, or uses the caller-provided values for a D16
walk-up with no `personId`), `mergePeople`. 14 unit tests against a fake
Supabase client (Kira-Kira's established pattern), no live network call in any
test.

New migration `20260822090000_registry_org_check_and_merge_rpc.sql`: an
`event_entries.person_id`/`event.org_id` consistency trigger, and a
`merge_people(p_org_id, p_kept_id, p_merged_id)` RPC implementing the merge
algorithm as one atomic transaction — a client-side sequence of separate
reassign/log/delete calls risks exactly the partial-failure class §9's offline
model exists to avoid. Per event where the merged-away person holds an entry:
reassigned to the kept person if there's no collision, unlinked
(`person_id = null`) if the kept person already has an entry there (the exact
scenario T1.1's partial-index test proved the schema supports). 10 pgTAP
assertions (38 across the whole suite).

Verifiers: `offline-sync-auditor` (Phase 3's designated verifier throughout)
and `security-reviewer` (this task touches RLS-adjacent org-scoping and a new
RPC), both live-run via the Agent tool, each **twice** — a first pass and a
re-verification after fixes.

**A live-exploited cross-org bug, not a clean review.** `security-reviewer`
found `merge_people` never validated that `p_kept_id` belonged to `p_org_id` —
only `p_merged_id` was checked. The `event_entries` org-check trigger
incidentally caught the cross-org case _when the merged-away person held at
least one entry_ (reassigning to a foreign `p_kept_id` would fire it), but a
merged-away person with **zero** entries never touches `event_entries` at all,
so nothing caught it. Demonstrated live against the running local stack, as a
real `authenticated` role with RLS actually in force: a member of Org A could
call `merge_people` with a `p_kept_id` belonging to Org B and merge in one of
their own zero-entry people, permanently writing a cross-org `kept_id` into
Org A's `person_merges` ledger and silently deleting the Org A person — no
error, no rejection. The **same hole was independently reachable via a plain
client-side `insert into person_merges`**, entirely bypassing the RPC, because
`person_merges_write`'s `WITH CHECK` only verified the ledger row's own
`org_id`, never that `kept_id`'s person actually belonged to it.

Fixed with two changes, both re-verified by actually re-attempting the live
exploit and confirming it now fails: an explicit `p_kept_id`-belongs-to-`p_org_id`
check inside `merge_people` (fails fast, clear error, before any mutation), and
a new `app.check_person_merge_kept_org()` trigger on `person_merges` itself
(same `SECURITY DEFINER`/`search_path = ''` shape as the existing
`check_event_entry_person_org`/`check_live_session_org` precedents) — this is
the one that actually closes the direct-insert path, since the RPC-level check
alone wouldn't have. Also added a self-merge guard (`p_kept_id = p_merged_id`
previously unlinked and deleted the person with no error — a destructive
no-guard bug, not a true no-op).

**A second, independent finding from `offline-sync-auditor`**: `registry.js`'s
original `registerPerson` comment claimed "two different phones with the same
email are a real, accepted scenario... not a duplicate to silently merge" —
but the frozen schema's own `people (org_id, lower(email)) where email is not
null` unique index (§5.1, copied verbatim in T1.1) contradicts that: a second
person with a colliding email would hit an uncaught `23505` from
`createPerson`, worse than either alternative the comment considered. Since
the constraint is frozen spec, not a bug, the fix was to correct the code, not
drop the index: `registerPerson` now checks `findPersonByEmail` as a fallback
before creating, so the constraint should never be hit in the normal
registration flow. Same review also caught `findPersonByEmail`'s unescaped
`ilike` treating a literal `%`/`_` in an email as a wildcard (low severity,
zero call sites at the time) — fixed with `escapeLikePattern()`, and the fix's
correctness against Postgres's actual LIKE semantics (including a literal
backslash adjacent to a wildcard character, a case the JS unit tests alone
didn't cover) was independently confirmed against the live database during
re-verification, then backfilled as its own unit test.

---

## Handoff correction 001 — hosting target · 2026-08-21

Applied `HANDOFF-CORRECTION-001.md` (user-supplied, filed against the frozen spec) between
Phase 2 and Phase 3, per its own "apply after Phase 2 completes" instruction. Not a
progress edit — a correction to §0's own stated exception ("only to correct an error").

**What changed**: hosting target is **Cloudflare Workers with Static Assets**, not
Cloudflare Pages (D29). Cloudflare's own guidance moved Workers-first for new projects
once feature parity was reached (March 2026); Pages remains supported but no longer gets
new platform investment. Greenfield repo, so no migration cost — a config choice made
once, not a re-platform.

Folded into `SEDUH-NEXT-HANDOFF.md`: §3 (Stack), §12 (D29 appended to the decision
record), §14 T0.1's task body, §15.4 item 3. `HANDOFF-CORRECTION-001.md` deleted per its
own instruction once folded.

**T0.1 had a pre-existing gap this surfaced**: the original handoff's §15.4 referred to
"Cloudflare Pages deployment... configured in T0.1," but T0.1's own task body never
actually described that clause — Phase 0's real T0.1 work only mentioned Cloudflare in
README prose, no config file ever existed. Closed now, with the corrected target: added
`wrangler` as a devDependency, `wrangler.jsonc` (an `assets` block pointing at `./dist`,
`compatibility_date` set to today), and `.wrangler/`/`.dev.vars*` to `.gitignore`. Not
deployed, repo not connected — configuration only, matching the correction's explicit
instruction. Validated genuinely: `npx wrangler deploy --dry-run` reads the real `dist/`
build output and exits cleanly without deploying or requiring auth. `README.md`'s stack
line updated to match. Confirmed T0.1's AC still holds unchanged post-amendment:
`dev`/`build`/`test`/`test:e2e`/`lint`/`format:check` all re-run and passing.

Verifier: `code-reviewer`, per the correction's own verification section (a documentation
change). `grep -c "Cloudflare Pages" SEDUH-NEXT-HANDOFF.md` returns 1, and that one hit is
D29's own text explaining the change — matching the correction's exact acceptance
criterion ("returns 0 except where the record deliberately explains the change").

---

## Phase 2 — Core libraries · 2026-08-21

Six pure modules in `src/core/`, per handoff §14 T2.1–T2.6 — no UI, no I/O. 116
tests passing across the whole suite.

### T2.1 `partition`

`partition(n, { target = 4, min = 2 })` → heat sizes: `heats = ceil(n / target)`,
reduced if it would force a heat below `min`, then `n` distributed as evenly as
possible across that many heats (sizes differ by at most 1, larger heats first).

Verifier: `scoring-auditor` + `test-auditor`. AC's exact `N=2..12` table tested
case by case (11 separate assertions, not a loop that could silently pass on a
subset), invariants (sum=N, min≥2, max−min≤1) tested individually across
`N=2..64`, `n < min` throws. `scoring-auditor` additionally fuzzed 2,796
`n`/`target`/`min` combinations beyond the AC's own requirement — zero failures.

### T2.2 `ranking`

`rank(items, compareFn)` — competition ranking (ties share a position, the next
distinct row's position is its 1-based sort index, which skips by tie size
automatically). `chainComparators(...)` combines sort keys in priority order
(e.g. §7.3's "most correct, then fastest time").

Verifier: `scoring-auditor` + `test-auditor`. Both AC-named cases tested
separately: a three-way tie at the front, and a two-way tie in the middle of the
list (not first) — the AC's own point that a tie-at-position-1 test alone can
pass even with the classic off-by-one bug present. Non-mutation of the input
array proven by both value and referential-identity checks.

### T2.3 `advancement`

`computeAdvancement(rankedEntries, cutoff)` — walks position groups in rank
order; a group that would push the cumulative count past `cutoff` is withheld
in full as `tiedAtBorder` rather than being resolved (D20's fixed-field rule,
§7.2).

Verifier: `scoring-auditor` + `test-auditor`. All AC-named cases proven
separately: exact-cutoff with no tie, a tie wholly above the cutoff (no
tiebreak flagged), a tie straddling the cutoff (tiebreak flagged, exact
membership), and — the specific "not the whole tie group when it starts above
the line" case — two earlier wholly-above tie groups plus a genuine border tie,
proving `tiedAtBorder` holds only the border group. `scoring-auditor`
additionally fuzzed 20,000 group-size/cutoff combinations against four
invariants; could not construct a breaking case.

### T2.4 `countdown`

`remainingSecs(startedAt, durationSecs, now)` / `isExpired(...)` — pure
arithmetic, no timer or DOM reference, matching §8.2's "publish `started_at` +
`duration_secs` once, every viewer computes locally" design.

Verifier: `scoring-auditor` + `test-auditor`. Engine-purity proven by a
grep-style test reading the module's own source — which required a fix
mid-task: the naive regex matched the module's own header comment explaining
_why_ no timers exist (the same self-referential trap the Phase 0
`no-trio-vocabulary` rule hit), fixed by requiring call-parens/property-access
rather than bare words. Clamp-at-zero, a background-gap resume, and two
readers' clocks landing on the same result all proven with an injected fake
clock throughout (no `Date.now()` anywhere in the test file).

**One finding from `test-auditor`, fixed**: a test titled "two instances …
different now-values … agree" passed the identical `now` value to both calls,
so it only proved determinism, not what its name claimed. Rewritten into two
tests — two close-but-different `now` reads within the same second agreeing,
plus a control case proving a `now` crossing a second boundary genuinely
changes the result (guarding the first test against a version of the function
that ignores `now` entirely).

### T2.5 `timeclamp`

`clampElapsed(secs, durationSecs)` → `{ elapsed, raw, maxed }` — the sole
`elapsed_secs` writer (§5.2, §6).

Verifier: `scoring-auditor`. At/beyond-duration boundary proven exactly
(`maxed: true`, `elapsed === durationSecs`, `raw` preserves the actual input).

**A real AC gap, caught independently by both `scoring-auditor` and
`test-auditor`**: the AC's second clause — "prove `no-raw-elapsed-write` fires
on a direct assignment bypassing it" — had only been demonstrated as a one-off
manual proof during Phase 0/2 work, not as a permanent, CI-enforced test. Added
`eslint-rules/no-raw-elapsed-write.test.js` using ESLint's `Linter` directly
(its `RuleTester` needs Mocha-style global `describe`/`it`, which this project
doesn't configure — tried first, got "No test found in suite" until switched to
`Linter.verify()` inside plain Vitest `it()` blocks). Also required adding
`eslint-rules/**/*.test.js` to `vite.config.js`'s `test.include`, which had only
covered `src/**` and `supabase/functions/**`.

### T2.6 `entitlements`

`canAccess(key)` — permissive stub (D14): five real keys
(`cup_taster_analytics`, `cup_taster_report`, `cup_taster_unlimited`,
`audience_enhanced`, `audience_branding`), each `minTier: null` with its own
intent comment; throws on an unregistered key rather than silently allowing it.

Verifier: `module-boundary-checker`. Confirmed live: all five keys present with
comments, zero `canAccess()` call sites anywhere outside `entitlements.js`
itself and its own test file (`grep -rn "canAccess"`), no `src/formats/`
imports anywhere in Phase 2's files, `core/timeclamp` remains the sole
duration-cap implementation (the only other `elapsed_secs`-adjacent hit is the
ESLint rule that _enforces_ this, not a second implementation).

---

## Phase 1 — Schema and security · 2026-08-21

### T1.1 Core tables

`orgs`, `org_members`, `people`, `person_merges`, `events`, `event_entries` — migration
`20260821200000_core_tables.sql`, per handoff §5.1. `updated_at` is trigger-owned
(`app.set_updated_at()`) on every table that has one, never client-supplied — matters for
the §9 offline conflict check, which compares the `updated_at` a write read against the
row's current value. RLS enabled on every table now (D11: "from day one"); no policies
yet — that's T1.3.

Verifier: `schema-guardian`, live-run via the Agent tool. Applies cleanly from empty and
rollback verified by actually running it inside `begin; … rollback;` (both confirmed
against the real local stack, not just read). pgTAP suite (`supabase/tests/001_core_tables.sql`)
proves both named negative cases: a duplicate phone within one org is rejected but the
same phone is allowed across two different orgs; a merge (unlink the losing entry to
`person_id = null`, log the `person_merges` row, delete the merged-away person) succeeds
and both entries survive — one linked to the kept person, one an orphaned historical
record.

**A real finding, not a clean review**: `schema-guardian` checked the AC's own claim —
"the case a table-level UNIQUE would have broken" — instead of taking it as given, built
an isolated table with a plain table-level `UNIQUE(event_id, person_id)`, and ran the same
operation sequence against it. It succeeded identically. Postgres treats NULL as distinct
under either constraint shape, so a table-level UNIQUE would **not** have broken this
scenario — the claim, which originated in the handoff's own §5.1 comment, doesn't hold.
The partial index is still the right choice (smaller index; names the "linked entries
only" intent explicitly for `ON CONFLICT`), just not for the reason originally stated.
Corrected in three places: the migration's comment, the pgTAP test's docstring, and —
with the user's explicit go-ahead — the handoff document itself at §5.1 (allowed per §0:
"only to correct an error, never for progress").

### T1.2 Cup Taster tables

`ct_stages`, `ct_sets`, `ct_stage_entries`, `ct_heats`, `ct_heat_entries`, `ct_results`,
plus the `ct_standings` view — migration `20260821210000_cup_taster_tables.sql`, per
handoff §5.2. The view's exact shape (`entry_id`, `stage_id`, `correct_count`,
`sets_scored`, `total_elapsed_secs`) isn't given verbatim in the handoff — designed to
satisfy "expose the tally as a view" and feed §7.3's champion rule (most correct, then
fastest time).

Verifier: `schema-guardian`, live-run via the Agent tool. Applies cleanly from empty,
rollback verified by actually running it. pgTAP suite (`supabase/tests/002_cup_taster_tables.sql`,
13 assertions total across the full suite) proves both named negative cases: `correct` is
nowhere a stored tally/count column on any `ct_*` base table (only `ct_results.correct`,
the atomic per-set fact — views excluded from that scan, since `ct_standings.correct_count`
is deliberately derived, not stored), and a negative `elapsed_secs` is rejected by its
`CHECK`.

**Two real findings from the review, not a clean pass:**

1. `ct_standings` originally summed across every heat kind with no filter — an entry that
   went to a tiebreak (§7.2, a separate heat among only the tied cuppers) would have its
   tiebreak set silently blended into its primary-stage tally, distorting the "most
   correct → fastest time" comparison §7.3 treats as _sequential_ criteria, not summed
   inputs. Fixed with `where h.kind = 'normal'`; added a regression test that inserts a
   tiebreak heat and proves the tally doesn't move.
2. The view had no `security_invoker`. On Postgres 15+ (this stack runs 17), a plain view
   evaluates permissions and RLS as its **owner**, not the querying role — meaning once
   T1.3 adds org-scoped RLS to the underlying tables, `ct_standings` would have silently
   bypassed it, leaking every org's rows to any authenticated user. This is exactly what
   Supabase's own linter flags as `security_definer_view`. Fixed with
   `create view ct_standings with (security_invoker = true) as …`; confirmed directly via
   `pg_class.reloptions` that the option actually took.

Also added two indexes (`ct_heat_entries(entry_id)`, `ct_results(set_id)`) matching query
shapes the migration's own design commits to (the standings view's `group by entry_id`,
the per-set difficulty aggregation `avg(correct) group by set_id` described in the
handoff's `ct_results` comment) but that weren't covered as the leading column of any
existing constraint.

### T1.3 RLS

Policies on all 13 tables (12 org-scoped + `live_sessions`), plus a small
prerequisite migration creating `live_sessions` itself — not an explicit
T1.1/T1.2 table (those lists are §5.1 core and §5.2 Cup Taster; `live_sessions`
is §5.3 "Live," and T1.3's own AC needs it to exist). Migrations:
`20260821220000_live_sessions_table.sql`, `20260821230000_rls_policies.sql`,
`20260821240000_grants.sql`.

The membership chokepoint (`app.is_org_member`, `SECURITY DEFINER STABLE`,
`set search_path = ''`) and a chain of `org_id` resolver functions
(`org_id_for_event` → `org_id_for_stage` → `org_id_for_heat` →
`org_id_for_heat_entry`) walking the FK graph for tables without a direct
`org_id` column — mirrors Kira-Kira's `app.can_read_tx` chokepoint pattern so
no policy re-implements the join chain inline. `orgs`/`org_members` are
deliberately read-only at the RLS+GRANT layer (no app-level org/membership
management is in scope yet; provisioning happens via `service_role` outside
RLS).

Verifier: `security-reviewer`, live-run via the Agent tool, twice (a second
pass after the first round's fixes). pgTAP suite (`supabase/tests/003_rls.sql`,
15 assertions) proves both named cases: a non-member reads zero rows from all
12 org-scoped tables; an unauthenticated (`anon`) client can read
`live_sessions` but a write throws `42501`.

**A missing-GRANTs gap found during my own verification, before review:**
RLS policies alone weren't sufficient — `authenticated`/`anon` had no underlying
table privileges at all (`permission denied for table orgs`, the exact
failure Kira-Kira's own CLAUDE.md warns about: "base GRANTs matter
independently of RLS"). Added `20260821240000_grants.sql`.

**Two real findings from the security-reviewer pass, not a clean review:**

1. `live_sessions.org_id` and `event_id` were independent FKs with nothing
   tying them together — confirmed **live-exploitable**: an org member could
   INSERT a row claiming their own `org_id` while pointing `event_id` at a
   different org's event, silently breaking the "one active session per org's
   own event" invariant the `live_sessions_one_active_per_org` partial index
   implies. Fixed with a `before insert or update` trigger
   (`app.check_live_session_org()`) resolving `event_id`'s actual owning org
   via the existing resolver chain and rejecting a mismatch; added a
   regression test proving a cross-org row is now rejected.
2. Every write policy is `FOR ALL`, so `pg_policies.cmd` is literally `'ALL'`,
   never `'INSERT'`/`'UPDATE'` — flagged as a landmine for T1.4's
   not-yet-written gate script (a naive `cmd IN ('INSERT','UPDATE')` filter
   would match zero rows and pass without checking anything). Kira-Kira's own
   `000_with_check_gate.sql` had already anticipated this by including `'ALL'`
   in its filter — confirmed and ported directly into T1.4 below rather than
   rediscovering the same gap.

### T1.4 `WITH CHECK` gate

`supabase/tests/000_with_check_gate.sql` — replaces the Phase 0
`000_sanity.sql` placeholder now that real schema/RLS coverage exists (as
flagged as the plan in ROADMAP.md's Phase 0 open items). Queries `pg_policies`
for any `public` schema policy with `cmd in ('INSERT','UPDATE','ALL')` and a
null `with_check`; fails the suite immediately (numbered 000, runs first) if
one exists. `cmd in (...)` deliberately includes `'ALL'`, not just
`'INSERT'`/`'UPDATE'` — per the T1.3 finding above.

Verifier: `security-reviewer`. AC proven directly, not just written: dropped
and recreated `people_write` on the live local database with its `WITH CHECK`
clause removed (not a migration edit — a deliberate live-schema mutation for
the proof), ran `npm run db:test`, confirmed the gate fails
(`have: 1, want: 0`, suite exit 1) — this is exactly what CI's `supabase` job
runs, so the same failure would occur there. Restored via `supabase db reset`
and confirmed the full 28-assertion suite is green again.

---

## Phase 0 — Foundation · 2026-08-21

### T0.4 Doc seed

`CLAUDE.md`, `CONVENTIONS.md` (this file's sibling, backfilled from what T0.1–T0.3
established), `CHANGELOG.md`, `ROADMAP.md`, and this README replacing the one-line stub.
Verifier: `code-reviewer`. All 9 agents named in `CLAUDE.md`'s delegation strategy exist
as files under `.claude/agents/` (confirmed T0.2) — none claimed as ported without a
read source; the ported six were read from the sibling Kira-Kira repo before adaptation.

### T0.3 Supabase local stack + CI

Local dev stack via `supabase init`/`supabase start`, verified working end to end:
migrations apply from an empty database, the pgTAP suite runs. Ports offset +100 from
the CLI defaults (54421–54429 instead of 54321–54329) — the sibling Kira-Kira repo's own
local stack was running on the default range during setup, and the two projects need to
coexist on this machine without a collision.

`supabase/tests/000_sanity.sql` added as a Phase 0 placeholder: with zero real schema
yet, `supabase test db` exits `NOTESTS`/1 against an empty `tests/` directory, which
would make CI red before any real work lands. Phase 1 (T1.1+) adds the actual schema/RLS
suite; this file can then be renumbered or left as a basic pgTAP sanity check.

`.github/workflows/ci.yml` runs two jobs — `app` (format/lint/test/build) and `supabase`
(migrations from an empty database, then the pgTAP suite) — ported from Kira-Kira's CI
shape, including its documented tree-shaking pitfall: `VITE_SUPABASE_URL`/`ANON_KEY`
must be set in the build step, or Vite's minifier proves `createClient()` unreachable
and silently drops `@supabase/supabase-js` from the bundle without failing the build.

`db:reset`/`db:test` npm scripts added as the migration-runner entry points.

**dev/main with main protected (D26).** Setting this up surfaced a real constraint: both
classic branch protection and the newer repository-rulesets API return 403 ("Upgrade to
GitHub Pro or make this repository public") on a private repo under the free plan.
Presented to the user as a genuine tradeoff — skip enforced protection, wait for a paid
upgrade, or make the repo public. The user chose public, which the handoff's own
`LICENSE.md` already frames as viewable-for-transparency, so this doesn't cut against
anything already decided. `gh` CLI installed via winget for this session (wasn't present
on the machine); authentication is inherently interactive, so the user ran
`gh auth login` themselves.

Protection was verified genuinely, not just configured: a first attempt at proving "push
to `main` rejected" actually **succeeded** silently, because `enforce_admins` had been
left `false` and the pushing account (repo owner) bypassed the rule entirely — a
false-positive proof that would have shipped unnoticed if not checked against the actual
push result. Fixed by enabling `enforce_admins`; a second direct push then failed with
the expected `GH006: Protected branch update failed for refs/heads/main`. The accidental
first commit was cleaned up through an actual PR (#1, squash-merged) rather than a force-
push, which doubled as a live proof that the intended `dev`→`main` PR workflow works —
CI ran and passed both jobs on GitHub itself before the merge, not just locally.

### T0.2 Claude Code tooling

Nine subagents in `.claude/agents/`: `code-reviewer`, `schema-guardian`,
`security-reviewer`, `ui-accessibility-reviewer`, `offline-sync-auditor`, `kb-sync`
adapted from the sibling Kira-Kira repo (read directly, then rewritten against this
project's own schema and rules — `code-reviewer` additionally merges in a
locked-contracts section modeled on live Seduh Score's own `code-reviewer` agent);
`scoring-auditor`, `module-boundary-checker`, `test-auditor` authored fresh for this
project's own concerns (`scoring-auditor` is Cup Taster's analogue to a money-correctness
gate; the other two have no Kira-Kira equivalent).

Four custom ESLint rules (`no-trio-vocabulary`, `no-derived-storage`,
`no-core-format-import`, `no-raw-elapsed-write`) plus the `.claude/hooks/lint-on-write.cjs`
PostToolUse hook, ported from Kira-Kira's hook essentially unchanged.

Every check named in the task's AC was demonstrated, not just written:

- Planted `const trioCount = 5` in `src/core/` and proved both the ESLint rule and the
  hook (invoked directly with a synthetic tool payload) block it, exit code 2. This
  caught a real bug in the first version of `no-trio-vocabulary`: a plain `\btrio\b`
  regex doesn't match inside `trioCount` — there's no word-boundary between "trio" and
  "Count" in one continuous identifier, which is exactly the AC's own test case. Fixed
  with proper camelCase/snake_case word segmentation before comparing.
- Planted a `src/core/` → `src/formats/` import and proved both the ESLint rule and a
  live run of the `module-boundary-checker` agent instructions (via a general-purpose
  agent following the exact charter, since custom project subagents aren't hot-loaded
  mid-session) catch it.
- Planted an assertion-free test (`expect(true).toBe(true)`) and proved a live run of
  the `test-auditor` instructions catches it.

Verifier: self-verified (no `code-reviewer` existed yet to review its own creation —
matches the same bootstrapping order Kira-Kira went through).

### T0.1 Scaffold

Vite + vanilla ES modules, ESLint 9 (flat config) + Prettier, Vitest, Playwright, the
folder tree (`src/core`, `src/formats/cup-taster`, `src/ui/tokens`, `supabase/migrations`,
`supabase/tests`, `eslint-rules`, `tests/e2e`), `LICENSE.md` copied verbatim from live
Seduh Score.

All six AC commands verified passing on a real run: `dev`, `build`, `test`, `test:e2e`,
`lint`, `format:check`. No Firebase references anywhere in the repo (`grep -ri firebase`
clean). No frontend framework in `package.json`.

Caught and fixed a real bug during verification: Vite's default host resolves to the
IPv6 loopback first on this Windows machine, so Playwright's readiness check against
`127.0.0.1` got connection-refused even though the server was actually listening.
`server.host`/`preview.host` pinned to `127.0.0.1` in `vite.config.js` fixes it.

Verifier: self-verified (same bootstrapping-order note as T0.2).
