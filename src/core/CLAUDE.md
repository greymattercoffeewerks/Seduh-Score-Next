# src/core/ — shared, format-agnostic modules

Root non-negotiables apply here unconditionally, especially the module boundary: nothing
in this directory may import from `src/formats/`, and nothing here should encode
Cup-Taster-specific (or any other format's) assumptions. See
[the repo root CLAUDE.md](../../CLAUDE.md) for the full non-negotiables list and the
delegation table — this file only adds core-specific history and conventions.

## Module history

Done: partition, ranking, advancement, countdown, timeclamp, entitlements (Phase 2);
registry, supabaseClient (T3.1); db, outbox (T3.2); syncState (T3.3); events,
registry.registerEntry (T4.1); dom, errors (T4.3), duration (T4.4) — all three extracted
from a cup-taster screen file on their 2nd verbatim use; export (T4.8 — table spec → CSV;
PDF is the browser's own Print → Save as PDF, not a generated file, deliberately no new
dependency).

`registry` gained `findEntryForPerson`/`setEntryWithdrawn` and `registerEntry` became
idempotent + race-recovering, `dom` gained `labeledField` (extracted from
`setupScreen.js` on its 2nd verbatim use), `errors` gained `UNIQUE_VIOLATION` (hoisted
from `formats/cup-taster/setup.js` so `core/registry.js` could reuse the same
race-recovery shape) — all 2026-08-27, the roster-registration screen's follow-up.

`publish` (T5.1, 2026-08-27) — `publishSession()` enqueues + flushes a `publish_session`
RPC through `outbox.js` exactly like `scoring.js`'s `submitConfirmHeat`; logic-module
only, nothing calls it yet — payload shape/call cadence are T5.2+ decisions.

`viewer-shell` (T5.2, 2026-08-28) — `mountViewerShell()` watches `live_sessions` per-org
via Supabase Realtime, the project's first realtime usage; renders every holding state
itself, mounts a caller-supplied `renderBody` only once real content exists, same
inversion-of-control shape as `outbox.js`'s handler map; also the first CSS file living
in `core/` rather than a format directory. Gained a `renderBody` cleanup-lifecycle
contract, T5.3 — an optional returned function, called before every re-render's
`body.replaceChildren()` and again on `unmount()`, so a ticking display (`viewerBody.js`'s
live countdown) never outlives the DOM node it mutates. Gained `hasEvent` and
`raceTimeout()`, 2026-08-28 follow-up — distinguishes the `noEvent` holding card from the
renamed `notStarted` one, formerly both collapsed into a single `empty` phase since this
module never read events, only `live_sessions`. `viewer-shell` now has two real consumers
(T5.3's `projectorSurface`, T5.4's `phoneSummary` — see
[src/formats/cup-taster/CLAUDE.md](../formats/cup-taster/CLAUDE.md)) but its own preview
harness's `renderBody` stays a stub, deliberately — that harness proves the shell alone,
not the real content.

`events` gained `findLatestEventForOrg` in that same 2026-08-28 follow-up —
existence-only, since `events.status` exists in the schema but nothing writes it yet.
`renderChrome()`'s identity name is a real `<h1>`, not a `<span>`, 2026-08-28
heading-hierarchy follow-up — a visually-hidden equivalent `<h1>` covers
`showChrome:false` (the projector), which has no chrome band to host a visible one in;
both reference one `APP_NAME` constant.

`outbox` gained `buildRpcHandler(client, type)` and `publish` gained
`publishHandlers(client)`, 2026-08-29 follow-up — closing the cross-module handler-map
composition gap surfaced by the T4.3/T4.4 outbox-wiring review. `buildRpcHandler` is pure
RPC-wrapping mechanics (dedups 3 near-identical blocks formerly hand-rolled in
`timing.js`/`scoring.js`/`publish.js`), format-agnostic by design, so it lives here
rather than in a format; `publish.js` stays here too — `publish_session` carries its own
`p_format` parameter, genuinely format-agnostic — see
[src/formats/cup-taster/CLAUDE.md](../formats/cup-taster/CLAUDE.md)'s `outboxHandlers.js`
entry for the actual composition point.

`timeout` (2026-08-29 follow-up) — `raceTimeout(promise, ms)` + `DEFAULT_LOAD_TIMEOUT_MS`,
extracted from `viewer-shell.js`'s own private identical implementation on its 2nd
verbatim use, closing the `setupScreen.js`/`rosterScreen.js` hung-initial-load gap;
`viewer-shell.js` now imports it instead of keeping its own copy.

`router` (2026-08-30 app-wiring pass) — hand-rolled, hash-based
(`createRouter`/`matchRoute`); no opinion about screens/chrome/format (`route.outlet` and
`onNavigate` are its only two extension points), client resolved once and threaded into
every mount as the single chokepoint every screen gets it through; own `resolveSeq`
staleness guard (mirrors `viewer-shell.js`'s `requestSeq`) protects its own `current`
bookkeeping only. Also does the navigation focus-move (moves focus to the new screen's
own heading, but only if nothing inside that screen's own mount already claimed focus
itself — found missing in `ui-accessibility-reviewer`'s own pass). Gained an
`AbortController`/`signal` mechanism, 2026-09-04 — `resolve()` aborts the PREVIOUS
navigation's controller the instant a newer one starts (not once the stale mount's own
promise settles), threading `signal` into every `route.mount()` call — closes the real
gap `resolveSeq` alone couldn't: a discarded-but-still-in-flight screen's own DOM writes
landing after a newer screen already mounted. Every screen this app ships now checks
`signal?.aborted` before writing to its outlet; see
[src/formats/cup-taster/CLAUDE.md](../formats/cup-taster/CLAUDE.md) for the full
four-reviewer account of closing this across `main.js` and all 13 screens (plus
`viewer-shell.js`, brought in mid-task once review found its own local `mounted` flag
didn't actually cover this case either).

`appShell` (same pass) — `mountAppShell()`: persistent organiser header (app name — a
`<p>`, not an `<h1>`, since every routed screen already owns the page's real `<h1>`; a
different tradeoff than `viewer-shell.js`'s own `renderChrome()`, which IS a real `<h1>`
since nothing else on that audience-facing surface competes with it), an event-name
breadcrumb cached by event id with its own staleness guard, nav links, and a `<main>`
content outlet; the second CSS file living in `core/` rather than a format directory,
after `viewer-shell.css`. Gained a reactive "signed in as {email}" + Sign out control,
2026-08-30 (temporary login screen pass) — subscribed via `client.auth.onAuthStateChange`
rather than a one-time fetch, since the shell mounts once per app lifetime but a sign-in
can happen well after that (the login screen mounts inside THIS shell's own outlet);
unsubscribes in the shell's own `unmount()`. Its breadcrumb fetch (`setNav` ->
`findEvent`) is deliberately NOT gated by `main.js`'s `requireAuth` — RLS, not this UI
gate, is what actually protects that read (found in security review; documented with a
comment at the call site rather than restructured).

`config` (same pass) — `getDefaultOrgId()` reads `VITE_DEFAULT_ORG_ID`, throwing loudly
if unset; the explicit, trivially-swappable placeholder for "which org" until real
per-session org derivation exists — no auth is being added now (D-scoped with the user).

`eventsScreen` (same pass) — events list/create; lives in `core/`, not
`formats/cup-taster/`, since `core/events.js` already treats `format` as caller-supplied
input (`defaultFormat` is a prop, `main.js` is the one file allowed to pass `'cup_taster'`
in) — the "This is test data" checkbox defaults unchecked (D9), the one place in the app
that actually SETS `is_test` rather than just displaying it. `events.js` gained
`listEventsForOrg(orgId, client)`.

`loginScreen` (2026-08-30, temporary login screen pass) — `mountLoginScreen()`: a plain
sign-in form against `auth.signInWithPassword`, explicitly scoped as temporary ahead of
D14's real access control. No sign-up, no password reset, no tier/role gating. Gated in
front of every organiser route by a `requireAuth()` wrapper confined to `main.js` itself
(NOT added to `router.js`, which stays reusable unedited by a future format) —
`#/live/projector` and `#/live/phone` stay unwrapped, since the audience never
authenticates. Both `requireAuth`'s `getSession()` call and `loginScreen`'s own
`signInWithPassword` call race against `core/timeout.js`'s `raceTimeout`/
`DEFAULT_LOAD_TIMEOUT_MS` (found missing in review — without it, a hung connection left
the whole app, or the login form itself, stuck forever with no feedback).

## `main.js` (composition root)

Not physically under `core/`, but its conventions live here since it's the wiring that
ties `core/` and the active format together. 2026-08-30 app-wiring pass — was the Phase 0
placeholder until this. The one file allowed to know both "this app is Cup Taster"
(`defaultFormat: 'cup_taster'` passed into `core/eventsScreen.js`) and the full route
table connecting every screen. `mountApp(root, {client, orgId})` builds a
shellRoot/bareRoot split so the two `chrome:false` audience routes (`#/live/projector`,
`#/live/phone`) get the entire root for their own full-bleed styling and never show
organiser nav to an audience. Gained `requireAuth()` (temporary login screen pass,
2026-08-30) — see `loginScreen` above for the full account; `routerRef` is a mutable box
(still null when `buildRoutes()` runs, since `createRouter()` needs the routes it returns
first) read lazily by `requireAuth`'s own `onSignedIn`/retry callbacks, which only ever
fire after `mountApp` has set it.

**When a second format (Throwdown/Liga Seduh/BBTC) starts wiring in**: `main.js` is where
the `defaultFormat` assumption gets revisited — currently hardcoded to `'cup_taster'`.
That's expected to change into something route- or event-driven once a second format
exists; it isn't a bug today, just a placeholder scoped to "only one format exists yet."
