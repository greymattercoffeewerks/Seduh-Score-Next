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

`registry` gained `listPeopleByIds` (chunked by 100) and `updateRosterEntry` (T-HARDEN.roster-edit, 2026-10-07) — the latter calls the format-agnostic `update_roster_entry` RPC (migration `20261007100000`); any format's roster screen can reuse both unedited.

`publish` (T5.1, 2026-08-27) — originally held the generic `publish_session` write
path; its superseded write helpers were removed on 2026-10-11 once both formats used
`publishIntent.js`. It now keeps only the format-agnostic active-session lookup.

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
(the projector and phone surfaces, mounted through `src/liveSurfaces.js` since T-BTC.live-routing, 2026-10-09 — see
[src/formats/cup-taster/CLAUDE.md](../formats/cup-taster/CLAUDE.md)) but its own preview
harness's `renderBody` stays a stub, deliberately — that harness proves the shell alone,
not the real content.

`events` gained `findLatestEventForOrg` in that same 2026-08-28 follow-up —
existence-only, since `events.status` exists in the schema but nothing writes it yet.
`renderChrome()`'s identity name is a real `<h1>`, not a `<span>`, 2026-08-28
heading-hierarchy follow-up — a visually-hidden equivalent `<h1>` covers
`showChrome:false` (the projector), which has no chrome band to host a visible one in;
both reference one `APP_NAME` constant.

`outbox` gained `buildRpcHandler(client, type)`, 2026-08-29, closing the cross-module
handler-map composition gap surfaced by the T4.3/T4.4 outbox-wiring review. It is pure
RPC-wrapping mechanics (deduplicating near-identical blocks formerly hand-rolled in
write modules), format-agnostic by design, so it lives here rather than in a format; see
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

`config` (same pass) — originally `getDefaultOrgId()`, which read `VITE_DEFAULT_ORG_ID` and threw if
unset. Since T-TEN.C2 (2026-10-11) the organiser console takes its organisation from the signed-in person's
memberships (`orgContext`), and `config` only offers `getLegacyAudienceOrgId()`: the one organisation the
anonymous `/live/*` routes still show until T-TEN.D1. It never throws; unset means those routes show an
"out of date" card and the app still boots.

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

`loginScreen` gained a Show/Hide password toggle (in place, no re-render), submit-time reading of the form (iOS autofill), a one-time retry without surrounding whitespace after an `invalid_credentials` rejection, and clearer wrong-password text (T-HARDEN.login-hardening, 2026-10-07) — see CHANGELOG.md for the account and the unconfirmed root cause.

`team`, `teamScreen`, `setPasswordScreen` (T-HARDEN.team-accounts, 2026-10-08) — owner-managed team logins: `team.js` wraps `team_can_manage`/`team_list_members`/`team_remove_member` and the `team-accounts` Edge Function (create/reset a login with a one-time password); T-HARDEN.team-restore (same day) added `listRemovedTeamMembers`/`restoreTeamMember` (`team_list_removed_members` and the Edge Function's `restore` action; the database keeps a marker per org of who its owner removed, written only by `team_remove_member`, and only a person with a marker for that org and in no org can be restored) and the Team screen's "Removed members" section; `teamScreen.js` is the owner's `#/team` screen; `setPasswordScreen.js` is the gate in front of every console route for anyone signed in with a one-time password (`user_metadata.must_change_password`, checked by `sessionGate.js`'s `mustChangePassword` and enforced in `main.js`'s `requireAuth` — a prompt, not a lock). Authority lives in SQL (migration `20261007120000`), not here. `dom.js` gained `passwordToggle` (Show/Hide, extracted on its second use). `main.js` gained the `/team` route and a Team nav link for owners, asked of the database on every auth event (deliberately not awaited inside `onAuthStateChange`, where supabase-js holds its auth lock). See CHANGELOG.md.

`scrollReveal` (2026-09-13, Petrol marketing rework) — `revealOnScroll(el, opts)`, a
one-shot `IntersectionObserver` wrapper (adds a class the first time an element scrolls
into view, disconnects, never reverts). Its first consumer is
`src/marketing/landingScreen.js`'s scroll-reveal sections, but nothing in it assumes
marketing-page specifics — format-agnostic by the same test every other `core/` module
is held to. Skips attaching an observer entirely under `prefers-reduced-motion: reduce`
(reveals immediately instead); the caller's own CSS is expected to gate the actual
transition under the matching `no-preference` query, same discipline as every other
animation in this codebase.

`brandLockup` (T-HARDEN.brand-lockup, 2026-10-08) in `dom.js` — the mark and the wordmark as ONE shared lockup, styled only in `src/ui/tokens/brand.css` (display face, bold, wide-tracked; the mark stands on the wordmark baseline; em sizing via `--brand-lockup-size`). The console header (`appShell`), the phone/projector chrome (`viewer-shell`), the public header and the landing nav all build it; a surface wraps it (home link, `<h1>`) and sets the size, never restyles it. Before this the console set the wordmark in Hanken Grotesk and the public pages in Chakra Petch, with the mark hanging 1-4px low on both. See CHANGELOG.md.

The sync status in the header (T-HARDEN.header-sync-chip, 2026-10-08) is a short **one-line chip** (`.app-shell-sync-chip`: "Synced", "Not synced (3)", "Sync failing (3)", "2 writes lost"), so the sticky header's height never depends on the status; it used to be a reserved full-width row that kept the header two rows tall. The full sentence is the persistent `role=status` node (`.app-shell-sync`), clipped away until a problem chip (a button) is tapped, then an overlay panel that takes no layout space. Keep chip labels short and single-line, never let a status variant change what sets the chip's height, and never put the chip or the panel back in flow — `appShell.test.js` guards the stylesheet. Pending vs stuck must differ in words, not just colour. See CHANGELOG.md.

`stageSurface`, `stageDisplay`, `stageBody`, `stageBand`, `screenDirector`, `pageRotator`, `progressRing`, `countdownDisplay` (T-HARDEN.projector-redesign, 2026-10-08) — the reusable parts of a venue display, all format-agnostic and token-only: `stageSurface.js` (+ `.css`) mounts a body as a full-screen audience surface (`mountStageSurface(root, { body, surfaceClass, orgId, client, signal })`: the dark `stage` mode, a chrome-less `viewer-shell`, teardown; the format's own class goes in `surfaceClass`); `stageDisplay.js` is the frame (a permanent band from `stageBand.js`, one screen from the caller's `selectScreen(payload)`, a footer; `renderScreenFrame()` gives each screen its main area and footer slots) and `stageBody.js` binds it to `viewer-shell`'s `renderBody`/`hasContent` (one display kept across payloads, re-attached to the shell's body each time); `screenDirector.js` decides when to change screen (minimum dwell per screen, `urgent` screens cut in, coalesces to the latest request, updates the same screen in place, `onShown` reports what is actually on show so the band follows it); `pageRotator.js` has `paginate` (keeps a tie together), `pageRange` and the rotator; `progressRing.js` is the page-change ring (wall-clock driven, stepped under reduced motion); `countdownDisplay.js` + `countdownDisplay.css` are the live countdown moved out of Cup Taster's `viewerBody` (its urgent outline lives here so a second format cannot lose it). Sizes come from `--stage-unit` (1% of the screen height, `dvh` where available) for the band and footer and `--stage-fit` (1% of the screen AREA's height, a size container) for what a format puts in the area — a format's screens must use `--stage-fit`, not `vh`, or a banner/odd aspect crops them. A second format's projector is its own `selectScreen`, band and screens on these; nothing here is edited. `dom.js` lost `fitToScreen`. See CHANGELOG.md.

`momentPlayer`, `rankMovement`, `rankMovementRows`, `stageReveal`, `ordinal`, `mountFooterRing` (T-HARDEN.projector-moments, 2026-10-09) — the "what just happened" half of a venue display, format-agnostic: `momentPlayer.js` plays short moment screens found by a caller's `detectMoments(previous, next)` (a display is sent snapshots, never events, so news is a comparison; `createStageDisplay`/`createStageBody` take it as an optional `detectMoments` and `maxQueuedMoments`) — the first snapshot is only a baseline, a moment pre-empts a held screen and is mounted fresh each play, an `urgent` screen drops the queue (and a snapshot that already shows one is not mined for moments), only the newest `maxQueued` (4) wait, a moment that throws or a detector that throws is skipped and logged and never leaves the display blank; `rankMovement.js` compares two ranked lists by caller-supplied key and position (`entered`/`up`/`down`/`same`; `isRanked` keeps entrants who have not competed out of it; null when two ranked rows share a key) and has `sharedPositions`; `rankMovementRows.js` + `stageMoments.css` draw the rows (New, Up 2, Down 1, Holds, "(tied)", "+N more") in words, with the one-time rise-in, which `stageReveal.js` switches off after the last item so the display's per-payload re-attach cannot replay it; `ordinal.js` is `ordinalLabel` moved out of Cup Taster's `reportScreen`; `mountFooterRing(frame, ms)` in `stageDisplay.js` is the countdown ring in a screen's footer. A second format's projector passes its own detector and screens; nothing here is edited. See CHANGELOG.md.

`formatBody` (T-BTC.live-routing, 2026-10-09) — `createFormatBody({ [format]: () => body })`: one audience surface for whichever format the active `live_sessions` row has. `viewer-shell.js` now tells `hasContent(payload, { format })` and `renderBody(container, payload, { isTest, format })` the row's `format`; `formatBody` builds that format's body lazily, keeps ONE alive, destroys the previous one when the format changes (so a display's timers never run behind another format's screens), and treats a format with no body as having no content (the shell shows "Event not published yet", never another format's screens fed this payload). A factory or `destroy()` that throws is logged, not allowed to wedge the shell; `destroy()` is final (a late realtime event after a failed mount builds nothing). Format slugs are matched with `Object.hasOwn`, so `toString`/`constructor` are not formats. It never names a format; `src/liveSurfaces.js` (outside core, beside `main.js`) is the composition file that registers each format's projector and phone body. `stageSurface.js`'s `surfaceClass` is now unused by production (no format-named class on the shared root).

`publishIntent` (T-BTC.live-publish, 2026-10-09) — `publishIntentHandler(client, buildPayload)`, `enqueuePublishIntent(type, intent)` and `submitPublishIntent(type, intent, handlers)`: the publish-from-an-intent machinery extracted from Cup Taster's `liveSession.js` when BTC became its second user, and now the way every live payload is published. The original direct-payload write helpers were removed from `publish.js` on 2026-10-11; its active-session lookup remains. A format enqueues a small intent (`{ orgId, eventId, format, isTest, ...}`) FIRST, so an offline device still queues it; the format's own `buildPayload(intent)` runs at flush time from fresh state (return `null` for "nothing left to publish"); a snapshot clock taken before the reads is sent as `p_snapshot_at` (publish_session's staleness guard); a failed read is classified (a network drop, an expired session (42501) or a transient SQLSTATE is retried; a missing row, a malformed id or a bug is permanent); a deleted TEST event (PGRST116 on an `isTest` intent) is a no-op while a real event's is reported; the RPC goes through `buildRpcHandler`, with a fresh operation id per attempt. `isTest` is required and boolean (D9). A caller that needs the intent durable before a flush it does not control uses `enqueuePublishIntent` alone. It never names a format.

`stageVocabulary`, `stagePageLoop` (T-BTC.venue-vocabulary, 2026-10-09) — the rest of a venue display's shared vocabulary, extracted from Cup Taster's projector screens when BTC became the second format to need it (a pure refactor, verified markup-for-markup and layout-for-layout): `stageVocabulary.js` (+ `.css`, classes `stage-*`) is `stageKicker`, `stageTitle`, `stageSupport`, the standings page (`renderStandingsHead`, `standingsRangeText`, `renderStandingsTable` taking rows of `{ position, name, suffix, cells }` and columns of `{ className, width }`) and `renderChampion`; `stagePageLoop.js` is `createStagePageLoop(frame, { dwellMs })`, whose `show(pages, { footerFor, onPage })` paints a page's content, its footer label and the ring, rotates by `core/pageRotator.js` (drawing the ring through `mountFooterRing`) and restarts from the first page when shown new ones. All their text is set as text, never markup (a cell may be a node array), a value column's width is set on the cell by the format, `show([])` empties the frame, and neither names a format. Link `stageVocabulary.css` before a format's own screen CSS (a format rule may refine a shared one).

`rankImpact` (T-BTC.projector-screens, 2026-10-09) — the rank-impact logic extracted from Cup Taster's projector moments when BTC became the second user, format-agnostic (it knows rows, keys and positions, never what is ranked): `rankImpactRows(previous, next, { keyOf, positionOf, labelOf, isRanked, topPlace = 5, maxRows = 8 })` gives the rows ranked at `topPlace` or better (ties kept, capped, `more` counting the rest, `moved` saying whether any row changed place; null when two ranked rows share a key); `leadMovement(...)` gives the ranked leaders and whether the lead is the same as before (`{ kind: 'sole' | 'shared', label(s), count, unchanged, namedTogether }`, two names strung together only up to `maxNamesChars`, 40); `topMover(rows, 'up' | 'entered')` picks the biggest climb or the highest newcomer deterministically. The format supplies the words ("takes the lead", "share the lead", "climb to"). `stageMoments.css` gained `.stage-title.stage-move-title` (a two-line headline clamp for the rank screen, two classes so it beats `.stage-title` whatever the load order).

**TEST banner stays in view (T-BTC.phone-view, 2026-10-10)** — `viewer-shell.css` makes `.viewer-banner-host:not(:empty)` sticky at the top (D9: a long phone page scrolls, and a banner that scrolls away leaves nothing saying the data is not real). A real event has no banner, so nothing is reserved; the projector does not scroll. A stylesheet guard in `viewer-shell.test.js` pins it.

**Display lifecycle (T-BTC.display-lifecycle, 2026-10-09)** — a display belongs to ONE event's session. `viewer-shell` tells `hasContent` and `renderBody` the live row's `eventId` as well as its `format`, and calls its optional `onNoContent(phase)` (idempotently; a throwing callback is logged) when it paints "no live session" (`noEvent`, `notStarted`; not `connecting`, not a lost connection, not `pending`). `formatBody` keys its one live body on format AND event id, so moving to another event, with or without a gap, destroys the old body and builds a fresh one, and `release()` destroys it when the session goes away (not final; `destroy()` is). `stageBody` builds its display on first use and has its own `release()`, so a body used without `formatBody` honours the same contract. `mountStageSurface` and `mountPhone` call `body.release` from `onNoContent`. The point is that a display compares each payload with the previous one to find what just happened, and that must never cross two events.

**Wordmark home link (2026-09-16)** — the header mark and name are now one root-relative
`/` link with the accessible name “Seduh Score home.” The organiser app is served from
`/app/`, so this keeps an explicit exit route available even at sign-in; do not split the
icon and name into separate destinations or leave either as a non-interactive faux brand.

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

**BTC app-wiring pass (2026-09-23)** — `main.js` added `mountEventHomeScreen(outlet, eventId,
signal, client)`, a format-aware dispatcher that reads `event.format` and mounts either
`formats/cup-taster/eventDashboardScreen.js` or `formats/btc/eventDashboardScreen.js`. Added
`formatOptions = ['cup_taster', 'btc']` list passed into `core/eventsScreen.js` so organisers
can actually create BTC events through the UI (previously hardcoded `cup_taster` in the create
form, making BTC events impossible to create by hand). Wired all 5 BTC routes
(`/events/:eventId/btc/setup`, `/matches`, `/standings`, `/bracket`,
`/matches/:matchId/scoring`), reusing the same `allOutboxHandlers(client)` composition
`src/formats/cup-taster/outboxHandlers.js` and `src/formats/btc/outboxHandlers.js` already
export. Both scoring routes now pass `allOutboxHandlers` (fixes Cup Taster scoring route,
which was hardcoded to Cup-Taster-only handlers — when a BTC operation queued ahead of a Cup
Taster one, the flush would throw "no handler" and silently stop, head-of-line blocking the
organiser's own Cup Taster operation). `eventsScreen.js` gained optional `formatOptions` prop
(renders `<select>` in create form only when `>1` option; every pre-existing call omitting it
renders byte-identical to before; all tests pass unmodified). See CHANGELOG.md's "BTC
app-wiring pass" entry for full review account.

`orgContext` and `noOrgScreen` (T-TEN.C1, 2026-10-11) — `createOrgContext()` holds which orgs the signed-in
person belongs to (from the `my_orgs()` RPC) and which one the console acts in; `noOrgScreen` is the "this
account isn't part of an organisation" screen. Format-agnostic: no role vocabulary, no format knowledge. Built
as a factory, not a singleton, with an injected client and storage. Two rules worth knowing before editing:
only an empty list or the database's `22P02` means "no organisation" (any other failure keeps the last known
answer), and `refresh()` and every subscriber call are deferred a tick so a call from `onAuthStateChange`
cannot deadlock behind the auth lock. Wired into `main.js` by T-TEN.C2 (below).

T-TEN.C2 (2026-10-11) — the wiring, and what it added to core:

- `main.js`'s `requireAuth` now resolves the organisation (`resolveOrg`: settled answers cost nothing, an
  answer in flight is waited for, a missing or failed one is asked again) before any console route mounts,
  shows the no-organisation screen or a Retry card instead of the console when there is no organisation or
  no answer, and hands each route its `orgId` at mount. An org-context subscriber replaces the console
  (`#/events`, history entry replaced) whenever the person or organisation it was mounted for is no longer in
  force. `mountApp` returns `switchOrg(orgId)` (refused while this device has unsynced operations) and
  `orgContext`. Operations queued on the device are not flushed for a signed-in person who belongs to no
  organisation.
- `orgContext` gained `whenSettled()`, `retry()` and a remembered org list per user (`seduh.orgs.<userId>`,
  used as a `stale` stand-in only when the first question of a visit fails and nothing is known).
- `sessionGate.js` (`mustChangePassword(session)`), `signOut.js` (`signOutWithTimeout`) and `navigation.js`
  (`goToHash`, `replaceHash`) are the one home of what used to be copied across `main.js`, `appShell.js` and
  `orgContext.js`. The header's Sign out reports its failure in a polite status line. `viewer-shell.css` gained
  `.out-of-date-link`, the audience "out of date" card's wrapper.
- See ROADMAP.md's "Known open items from T-TEN.C2" for what C3, C6 and C7 pick up.

T-TEN.C3 (2026-10-11) — the organisation in the header. `appShell` gained an organisation slot in the
header's main row (between the brand and the Menu button; never inside the collapsing panel) and two methods,
`setOrganisation({ orgs, activeOrgId, onSelect })` and `announceOrganisation(text)`. The shell stays
format-agnostic and never decides what a switch means: it is handed the list and a callback that resolves to
`{ ok, message }`, and renders a plain label for one organisation or ONE persistent native select for several
(replacing it would drop a keyboard user's focus; its options are only rebuilt when the list really changed). A
refusal and a quiet announcement share one persistent live region (`#app-shell-org-notice`): a refusal opens as an
overlay under the header (the same recipe as the sync detail, so the header never grows) and is cleared by
Escape, leaving the control, a tap anywhere, or the next choice; an announcement is NEVER cleared by focus
moving, because a successful switch re-mounts the console and the new screen takes focus within milliseconds
(clearing on blur wiped it about 2ms after it was written). `orgLabel.js` names an organisation for places a
person must tell two apart (slug added when a name is shared). `main.js` keeps the slot in step in its org-context
subscriber and announces a deliberate switch ("Now working in …") differently from a change nobody asked for. See
ROADMAP.md's "Known open items from T-TEN.C3".

T-TEN.C4 (2026-10-12) — the Team screen follows the active organisation. `mountTeamScreen` gained `orgName` (the
heading is `teamHeading(orgName)`, "Team for <name>"; the opening text `teamIntro(orgName)` says these are managed
accounts that belong only to this organisation, decision D-T6) and `onLeaveGuard(active)`, told whenever leaving the
screen would lose a one-time password (on show, or its request still in flight); `main.js` refuses `switchOrg`
while it is on (reason `team_open`) and resets it whenever any console screen mounts. `main.js` takes the name from
the SAME snapshot that supplied the id, never from live state. `orgLabel` now trims names and removes invisible
text-direction controls (an unclosed right-to-left override scrambles a sentence the name sits in). The Team link's
own re-ask per organisation is T-TEN.C2's. See ROADMAP.md's "Known open items from T-TEN.C4".

T-TEN.C5 (2026-10-12) — events follow the active organisation. `mountEventsScreen` gained `orgName` (the list
heading is `eventsListHeading(orgName)`, "Events in <name>", the create form's `createEventHeading(orgName)`,
"Create an event in <name>"; plain "Your events" / "Create event" with no name). Create, list and delete already
used the `orgId` the screen was mounted with (T-TEN.C2); publishing deliberately uses the EVENT's own `org_id`,
not the active organisation; the event hub reads live status from the event's own `org_id`. A superseded screen (its signal aborted) does not send create or delete. See ROADMAP.md's "Known open items from T-TEN.C5".

T-TEN.C6 (2026-10-12) — the outbox has an owner. `core/outbox.js` tags every operation with `userId` and `orgId`
at enqueue (the payload's own `p_org_id`/`orgId` wins) and only ever replays, counts (`listPendingOperations`,
`countPendingOperations`) or lists for the sync panel the SIGNED-IN account's operations in the ACTIVE
organisation; everything else is left untouched and reported (`partitionOperations`, one read split three ways).
`main.js` sets the owner (`setOutboxOwner`) on every auth event and organisation change, before the flush that
change may start; `undefined` (never set) is "ownership not in use" (bare tests), `null` is signed out. A question
about one of your OWN just-queued writes ("is it still queued?") must use `listAllOperations()`, never the
filtered list. Signing out with changes waiting is two-step (`signOut.js`'s `unsyncedSignOutWarning`, shown in
the header's overlay notice; the no-organisation screen has its own copy of the flow). See ROADMAP.md's "Known
open items from T-TEN.C6".

T-TEN.C7 (2026-10-12) — a link into another organisation's event. `main.js` (the one file allowed to know both
core and the formats) guards every event-keyed console route for a person in two or more organisations: it
reads the event's `org_id` (`core/events.js`'s `findEventOrgId`; for a BTC match, `formats/btc/matches.js`'s
`findMatchEventId` first), switches the console to it with the ordinary `switchOrg`, and shows the info
notice (`appShell.showNotice`, `dismissNotice`, `clearEventContext`) once the event's screen has focus; not a
member or not there is "Page not found". A found answer is remembered on the device (`cacheGet`/`cacheSet`,
keys `eventOrg:`/`matchEvent:`) and used first, because an event never changes organisation. A new
event-keyed route needs nothing: any route with `:eventId` or `:matchId` goes through `requireAuth`. See
ROADMAP.md's "Known open items from T-TEN.C7".

T-TEN.D1 (2026-10-12) — audience links name the organiser. `core/orgResolver.js`'s `resolveOrgBySlug(slug,
client)` turns a slug into `{ status: 'found', org } | { status: 'not_found' } | { status: 'error', error }` through
`public_org_by_slug`; the three outcomes must stay distinct (an audience must never read "no event tonight" for a
mistyped link, nor "not found" for a dropped connection). It follows the database's own slug rules before asking
(a link that cannot be a slug is "not found" without a request) and remembers only found answers. The routes
(`#/live/:orgSlug/projector|phone|splash`) and the retry card live in `main.js` (`mountAudienceBySlug`: the one
file that knows both core and the formats); the old slug-less links are the legacy shim (`config.js`:
`getLegacyAudienceOrgSlug` first, else `getLegacyAudienceOrgId`). `core/router.js`'s `matchRoute` treats an
undecodable segment as no match. See ROADMAP.md's "Known open items from T-TEN.D1".

T-TEN.D2 (2026-10-12) — the audience screens no longer read the `events` table. `findLatestEventForOrg`
(core/events.js) calls the RPC `public_event_summary(p_org_id)` and returns its first row (id, name, event_date,
is_test) or null; an answer that is not a list is a failure to ask, never "no event". A new anonymous screen must
use it (or another narrow door), never `from('events')`: T-TEN.D6 removes the anon read. Test fakes for the
audience surfaces should answer `rpc('public_event_summary')` and RECORD a table read as a violation instead of
throwing (the callers swallow errors as "no event"). See ROADMAP.md's "Known open items from T-TEN.D2".

T-TEN.D3 (2026-10-12) — whose result is it. `publishedOrgName(payload)` (core/publicResults.js) reads the `org_name`
the database stamps into every published result and cleans it with `cleanOrgName` (core/orgLabel.js: the one
place that strips invisible text-direction controls from an organisation's name). Anything public that shows
an organisation's name uses these two, as text. The results sheet asks for one event
(`findPublishedResultForEvent`); the archive page still downloads every payload (ROADMAP: threshold). See
ROADMAP.md's "Known open items from T-TEN.D3".

T-TEN.D4 (2026-10-13) — audience links. `audienceHash(slug, surface)` and `audienceLinksFor(slug)` (main.js) build
the slug-qualified `#/live/<slug>/<surface>` links, absolute for the page served; the organiser's menu and the
Events screen's "Share with your audience" card (`core/audienceLinksCard.js`, with a lazily loaded QR on the phone
view) both use them, for any organisation with a slug. The card is built once and re-appended across redraws so
its live status line is never replaced. See ROADMAP.md's "Known open items from T-TEN.D4".

T-TEN event-link guard (2026-10-13) — a person with ONE organisation is asked too (`placeOwnOrgEventRoute` in main.js):
an event (or BTC match) link that is not theirs, or not there, is "Page not found" instead of a screen that fails to
load with a Retry that cannot work. Gentler than the several-organisation path, because there is nothing to switch to:
the whole question has one 2.5-second budget and ANY failure (offline, error, timeout, a stand-in organisation list)
opens the screen as it always did; answers are remembered on the device, a match's event first. See ROADMAP.md's "Known
open items from the event-link guard".

T-TEN.D5 (2026-10-13) — the audience-isolation Playwright project (`dev-audience`): `tests/e2e/audience-isolation.spec.js`
and `tests/e2e/support/tenants.js` (`createTenant`, `localStack`, `addMember`, `createLoneUser`; the helpers sign a
service-role token with the published LOCAL secret and refuse anything that is not localhost). Two organisations
with live events, anonymous browsers on slug links: each sees only its own organiser's event.

T-TEN.D6 (2026-10-13) — the anonymous contract (`20261013100000_tenancy_anon_contract.sql`): `events_read_public` and
anon's `events` privileges are gone; `live_sessions` reads only ACTIVE rows to anon and authenticated, and writes are
authenticated-only. Anything an audience screen needs about an event comes through a narrow door; a test fake that
queries `events` as anon is a bug, not a missing mock. The splash prefers the LIVE event
(`public_event_summary`: live, non-test, newest).

Event-selection guards (2026-10-13) — `core/publish.js`'s `findLiveElsewhere` (fail-open, 2.5 s) and `takeOverWarning`:
starting a heat (Cup Taster `timingScreen`) or confirming a match (BTC `scoringScreen`) while another event of the
organisation is live shows a warning card with a two-tap "Replace it and start heat" and a Cancel, and publishing
replaces the one active live session an organisation can have. The warning never blocks on a slow or failed check.
Accessibility patterns that bit here: a live region is never `display:none` (collapse it instead), a `.btn` needs its
own `[hidden]` rule, and the warning is linked with `aria-describedby`.

T-TEN.E1 (2026-10-13) — the cross-organisation negative matrices (`supabase/tests/040`, `041`) and the freeze on the
remaining parents (`20261013140000`, `042`). They run as side-effect-free probes (sentinel-rollback sub-transactions)
and must hold on a database with narrow privileges (production) AND broad ones (CI's default).

T-TEN.E2 (2026-10-13) — the console Playwright project (`dev-tenancy`, `tests/e2e/organiser-tenancy.spec.js`): real
organisations A, B and C and people in one, two or no organisation drive the switcher, event-link guard, team screen
and take-over warning in a real browser.

T-TEN.E3 (2026-10-13) — security and performance pass: advisors classified, the cheap findings migrated
(`20261013150000`), and the full-surface security review's first finding closed by `20261013160000` (the membership gate
on six cross-reference triggers, test `045`). Measured: every query the app asks takes 0.3 to 4 ms at 5,000 events and
160,000 heat entries; an UNFILTERED read of a leaf table costs about 0.2 ms per row (33 s for all heat entries), so a
new report or export reads through a `SECURITY DEFINER` function that checks the caller once (as `get_dispute_pack`
does). See ROADMAP.md's "Known open items from T-TEN.E3".
