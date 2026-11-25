# Backlog: Public site (landing page)

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from the landing page cleanup (stage 1, 2026-10-29)

Stage 1 (format rows on a phone, the proof cards removed) is in the CHANGELOG entry of the same date. Stage 2 (the latest-event card wired to the published-results archive) is built, see its CHANGELOG entry of the same date; stage 3 (a live info bar behind a per-event opt-in) is built too, see the CHANGELOG entry of 2026-10-30 and "Known open items from the landing page cleanup (stage 3, 2026-10-30)" below.

- **Contrast fails on the format numbers.** `.petrol-format-index` uses `--clr-petrol-500` (#4a5a57), 2.67:1 on the stage canvas. That fails 4.5:1 for the number at normal size, and 3:1 for the large-text size on desktop. Pre-existing, found by `ui-accessibility-reviewer`; not changed in stage 1. (landing page cleanup) **CLOSED (2026-11-14):** now `--color-text-secondary` (petrol-300 on the stage page), 7.2:1 on the canvas and 7.0:1 on the even-row tint (`src/marketing/landing.css`; CHANGELOG "Public site: three small backlog fixes").
- **Screen readers hear the tier last on a phone.** The DOM order is index, main, status, but at 640px and below the tier pill is visually first. Fixing it means reordering the DOM, which also changes the desktop grid. Sequencing only, raised by `ui-accessibility-reviewer`; not changed in stage 1. (landing page cleanup)

## Known open items from the landing page cleanup (stage 3, 2026-10-30)

Stage 3 (the live now bar behind a per-event opt-in) is in the CHANGELOG entry of the same date. Its migration `20261029100000_homepage_live_listing.sql` is not yet pushed to the cloud project. Not verified in a real browser: the organiser opt-in card. (landing page cleanup, stage 3)

- **Browser check of the organiser opt-in card, and a Playwright test that mounts both dashboards.** The card (`src/core/homepageListingCard.js`) is on the Cup Taster and BTC event dashboards and has unit tests only: not rendered in a browser, not traversed by keyboard or screen reader. Owed before the task is closed. (landing page cleanup, stage 3)
- **Privacy page wording for the homepage listing.** The bar publishes an event name and an organiser name for any event the organiser opted in. The Privacy page does not say so yet. (landing page cleanup, stage 3) **CLOSED (2026-11-14):** a "live now" bullet under "Who can see it" in `src/marketing/trustContent.js` and `design/copy/privacy-page-draft.md`, quoting the opt-in label (pinned by `trustScreen.test.js`); owner sign-off of the wording owed at PR review.
- **Registration rows on the bar.** Needs the D-G16 "Competitor login and claim, registration page" spec and its own security pass. The typed `kind` column in `public_live_now()` leaves room for a `registration` kind; nothing claims registration today. (landing page cleanup, stage 3)
- **Admin override and moderation of listed names.** Organiser-controlled names appear on a public homepage, rendered as text and capped, with no moderation. An admin cannot unlist an event or rename it today (the console cannot change events). (landing page cleanup, stage 3; `security-reviewer` nit)
- **Heartbeat or explicit end signal instead of the 12 hour window.** `public_live_now()` treats a live session as live while `live_sessions.updated_at` is within 12 hours, because there is no heartbeat. A stale but still active session is hidden only after 12 hours, and an organiser touching their own session keeps the bar up. (landing page cleanup, stage 3)
- **Per-row window-lock check.** `public_live_now()` calls `app.event_window_locked` per row. Fine at one active session per organisation; a `window_locked_events` set pattern would avoid it if traffic grows. (landing page cleanup, stage 3; `security-reviewer` nit)
- **Edge caching of `public_live_now` if traffic grows.** It is a POST RPC, so nothing caches it. (landing page cleanup, stage 3)
- **A test that walks marketing's static imports** to keep the Supabase client out of the landing page bundle graph. (landing page cleanup, stage 3; `module-boundary-checker` suggestion)
- **Test gaps, logged not fixed** (`test-auditor`): a failed unlist; `orgName` null wording; a loader that never resolves; `main.js` passing `loadLive`. (landing page cleanup, stage 3)
- **Accessibility nits, logged not fixed** (`ui-accessibility-reviewer`): the raw rgba border on the card has no design token; clamped long names have no visible full text. (landing page cleanup, stage 3)
- **Pre-existing, logged only:** `tidy()` in `src/core/publicLiveNow.js` resembles the `text()` helper in brandSlot. Not extracted; a third caller would justify it. (landing page cleanup, stage 3; `module-boundary-checker`)

## Known open items from the landing proof photo (full bleed, 2026-10-30)

The proof section's photo now runs edge to edge (CHANGELOG entry of the same date). Two items came out of it.

- **Phone copy card covers the photo's subject.** On phones (640px and below) the proof copy card is opaque, so it covers the bowls the photo is of, and the photo is barely visible. Pre-existing: the card's opacity on phones predates the full-bleed change. Owner design decision: make the card translucent, move the copy so the photo shows, or accept it. (landing page; `ui-accessibility-reviewer` finding, not fixed)
- **Wider source for the full-bleed slot.** `public/marketing/hero-cupping-bowls.jpg` is 1100px wide, so it upscales about 1.7x on 1830px screens and looks soft on large desktops. Replace it with a source at least 1830px wide for the full-bleed proof slot. The file is also used by the Tour page (`tourScreen.js`), so check that page when swapping it. (landing page; `ui-accessibility-reviewer` nit)

## Known open items from the Behind the Seduh reader rebuild (v4.0.0, 2026-11-09)

The `/bts/` page is now a one-chapter reader (CHANGELOG entry of the same date). Round 2 of the accessibility review raised one 🟣 item; the screen-reader check was not run.

- **Keyboard focus can sit off-screen below 860px.** In the horizontal chapter rail, a keyboard-focused chapter is not scrolled into view, so it can sit off-screen. Seen in headless Chromium only; the cause is not established. Pre-existing, found by `ui-accessibility-reviewer`; not changed in v4.0.0. (Behind the Seduh reader)
- **Screen reader not run on `/bts/`.** The reader's focus handling, status region and `aria-current` rail are checked by tests and a browser probe only. Owed before the page is called checked for assistive technology. (Behind the Seduh reader)

## Known open items from the public page hero (2026-11-09)

The shared `.page-hero` on Tour, Community hub, Pricing and Results (CHANGELOG entry of the same date). One item came out of it.

- **Results loading and error states have no `<h1>`.** While `/results/` is loading or when it fails, the page shows no headline, so a screen reader gets no page title there. Pre-existing: the loading and error markup predates the shared hero. Found by `ui-accessibility-reviewer`; logged, not fixed in that change. **CLOSED (2026-11-14):** both states now carry `<h1 id="results-title">Results</h1>` with the section `aria-labelledby` it (`src/marketing/resultsScreen.js`, two tests in `resultsScreen.test.js`).
- **The results error state says "please try again" but has no retry control.** The only recovery is a reload, and its `tabindex="-1"` status region is never focused. Pre-existing, found by `ui-accessibility-reviewer` (2026-11-14); logged, not fixed.

## Known open items from the public header links fix (2026-11-14)

The shared public header and the landing nav now read one list (CHANGELOG entry of the same date). One item came out of it.

- **The shared header's mobile menu has no Escape handler.** The landing page's mobile toggle closes on Escape; the shared header's toggle (Tour, Pricing, Community, Results, trust pages, country pages) does not. Pre-existing: the shared header's toggle predates this change. Found by `ui-accessibility-reviewer`; logged, not fixed in that change. **CLOSED (2026-11-15):** the panel already closed on Escape; the toggle now does too (`src/marketing/publicHeader.js`, tests in `publicHeader.test.js`).

## Known open items from the Menu bars forced-colors fix (4.17.2, 2026-11-17)

The console's Menu button bars were fixed under forced colours (CHANGELOG entry of the same date). One item came out of it.

- **The brand lockup's SVG mark under forced colours is unverified.** The fix covers the Menu button's CSS bars only. The lockup's mark is an SVG, which Windows high-contrast may or may not repaint, on the public header and the console header alike. Found by `ui-accessibility-reviewer`; not reproducible here (forced colours cannot be emulated in this environment). Check it in Windows high-contrast on the public header and the console header, and fix the mark's fill with `forced-color-adjust` or a system colour if it vanishes.

## Known open items from the community chrome rollout (2026-11-19)

- **Timer countdown mode has no h1 and no visible tool name.** The h1 was already `display: none` there; the frame's breadcrumb, which also named the tool, is now hidden too. Decide whether to keep a visually hidden h1. Found by `ui-accessibility-reviewer` (pre-existing).
- **The Guess the Bean organiser page has no `<main>` landmark** (it had none before). Wrap the screen host in one. Found by `ui-accessibility-reviewer` (pre-existing).
- **The Timer's breadcrumb and footer say "Competition Timer", its h1 says "Seduh Timer".** Align one of them if the owner wants them to match (nit).
- **`toolChrome.css` is outside the `tokenDrift.test.js` public-sheet scan** (`PUBLIC_CSS` covers `src/marketing/` and `communityHub.css`). Pre-existing, found by `test-auditor`.

## Known open items from the Random Selector Tier 1 redesign (unreleased, 2026-11-19)

The free Random Selector was redesigned and adopted the shared community chrome (CHANGELOG entry of the same date). These came out of its review, and were logged, not fixed.

- **The reduced-motion sweep assertion is weak.** It predates this change; `test-auditor` flagged it. It should assert the animation is removed under `prefers-reduced-motion`, not only that the rule exists.
- **Two function declarations sit after a `return` in `randomSelector.js`.** They are hoisted and work. `code-reviewer` left the style call to the owner.

## Known open items from the share images fix (4.21.1, 2026-11-19)

The four public tool and Community pages gained an `og:image` and a touch icon (CHANGELOG entry of the same date). Two items came out of it.

- **Real WhatsApp preview not checked.** The tags are in the built HTML and the test pins them, but no live share was made. WhatsApp caches previews, so a link shared before the deploy may keep the old thumbnail. Owed: a fresh share, or Facebook's Sharing Debugger, after the deploy. (share images fix)
- **Pages shared with no share tags.** `results/`, `id/`, `id/country/`, the `/id/<handle>/` shell, `guess-the-bean/play/` and the app's audience links have `og:title` or no tags at all, so a shared link falls back to the upscaled favicon. Pre-existing; `shareImages.test.js` covers only the pages that set `og:title`. Add the tags to each, reusing `share-mark.png`. (share images fix, `code-reviewer`)

## Known open items from the history-intake skill (tooling, no version change, 2026-11-25)

The country-history intake skill (`/history-intake`, CHANGELOG entry of the same date) left one item.

- **Importer accepts any non-empty `permission_ref`.** `scripts/country-history/lib.mjs` (line 256) checks only that the reference is non-empty and at most 300 characters, so a `PENDING` placeholder passes and `--write-sql` would write load SQL. The skill forbids `--write-sql` while pending, but that is a rule in the skill's text, not a guard. Owed: refuse a `PENDING` (or empty) reference in the importer, with a test in `scripts/country-history/lib.test.js`.
