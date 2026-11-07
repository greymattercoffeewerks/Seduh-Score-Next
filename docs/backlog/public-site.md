# Backlog: Public site (landing page)

The "Known open items" sections for this area, moved verbatim out of `ROADMAP.md` (nothing edited; original order). Each
section is a task's own deferred findings, with CLOSED/Resolved marks where an item was later done. **Add new deferred
findings for this area here, not to `ROADMAP.md`.** Section index: [`README.md`](README.md).

## Known open items from the landing page cleanup (stage 1, 2026-10-29)

Stage 1 (format rows on a phone, the proof cards removed) is in the CHANGELOG entry of the same date. Stage 2 (the latest-event card wired to the published-results archive) is built, see its CHANGELOG entry of the same date; stage 3 (a live info bar behind a per-event opt-in) is built too, see the CHANGELOG entry of 2026-10-30 and "Known open items from the landing page cleanup (stage 3, 2026-10-30)" below.

- **Contrast fails on the format numbers.** `.petrol-format-index` uses `--clr-petrol-500` (#4a5a57), 2.67:1 on the stage canvas. That fails 4.5:1 for the number at normal size, and 3:1 for the large-text size on desktop. Pre-existing, found by `ui-accessibility-reviewer`; not changed in stage 1. (landing page cleanup)
- **Screen readers hear the tier last on a phone.** The DOM order is index, main, status, but at 640px and below the tier pill is visually first. Fixing it means reordering the DOM, which also changes the desktop grid. Sequencing only, raised by `ui-accessibility-reviewer`; not changed in stage 1. (landing page cleanup)

## Known open items from the landing page cleanup (stage 3, 2026-10-30)

Stage 3 (the live now bar behind a per-event opt-in) is in the CHANGELOG entry of the same date. Its migration `20261029100000_homepage_live_listing.sql` is not yet pushed to the cloud project. Not verified in a real browser: the organiser opt-in card. (landing page cleanup, stage 3)

- **Browser check of the organiser opt-in card, and a Playwright test that mounts both dashboards.** The card (`src/core/homepageListingCard.js`) is on the Cup Taster and BTC event dashboards and has unit tests only: not rendered in a browser, not traversed by keyboard or screen reader. Owed before the task is closed. (landing page cleanup, stage 3)
- **Privacy page wording for the homepage listing.** The bar publishes an event name and an organiser name for any event the organiser opted in. The Privacy page does not say so yet. (landing page cleanup, stage 3)
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
