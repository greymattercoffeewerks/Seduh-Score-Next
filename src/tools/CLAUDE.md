# src/tools/ — standalone free community tools

Root non-negotiables apply here too, but — same as `src/marketing/` — this directory
sits outside the module boundary the rest of them are written around: it isn't a format,
and it isn't part of the console app. Treat the boundary rule's _spirit_ (don't leak
assumptions between things that shouldn't share them) as binding; the letter of
"core vs. formats" doesn't map cleanly onto a third kind of surface.

## What this is, and isn't

Small, self-contained, general-purpose utilities — no auth, no Supabase, no event/heat/org
concept, no router, and deliberately not scoped to any one activity (cupping, brewing,
competitions — whatever someone needs it for). Same principle as the legacy Seduh-Score
site: some tools are free-standing gifts to the community, not gated behind the product.
Each tool gets its own subdirectory here and its own HTML entry under `tools/<name>/` at
the repo root (see `vite.config.js`'s `build.rollupOptions.input` — a new entry there is
required for the production build to include it, same as `src/marketing/`'s own routing
note).

A tool here MAY import from `src/core/` when a piece of it is genuinely format-agnostic
engine logic (e.g. `core/countdown.js`, `core/dom.js`, `core/duration.js`) — that's the
same direction `src/marketing/` already imports in, and `core/` has no reverse
dependency on either. A tool here must never import from `src/formats/` — pulling in a
format's UI classes (e.g. Cup Taster's `.btn`/`.card` in `heatsScreen.css`) would tie a
supposedly standalone tool to one format's presentation, so each tool keeps its own
self-contained CSS instead.

## Tools

- `timer/` (`timer.js` pure state/logic, `timerScreen.js` DOM/wiring, `timer.css`),
  2026-09-12 — a standalone, general-purpose countdown timer (duration presets + custom
  duration, optional label) for anything someone is timing, not scoped to cupping.
  Originally built and named as a "Cupping Timer" with cupping-specific presets and copy;
  renamed the same day (user decision) — "Cupping Timer" read narrower than intended to
  anyone encountering it cold, and this is meant as a general free tool, usable for a
  competition heat, a brew, or anything else, same as it's usable for cupping. Files,
  identifiers, CSS class prefixes (`timer-*`, was `cupping-timer-*`), and the
  `localStorage` key (`seduh-timer-v1`, was `seduh-cupping-timer-v1`) were all renamed
  together in that pass — no "cupping" left in code or copy, only in this history note.
  Built in response to a real gap in the console's own
  `formats/cup-taster/timingScreen.js`: that screen's countdown is correct
  (`core/countdown.js` recomputes from wall-clock time, so a backgrounded tab never
  actually drifts) but LOOKS frozen while backgrounded, since `setInterval` itself is
  throttled by the browser — this tool adds what that screen didn't have: a Wake Lock
  request while running (keeps the screen from sleeping while it's counting down;
  feature-detected, degrades silently where unsupported — Wake Lock auto-releases when
  the tab hides per spec, so `timerScreen.js`'s `visibilitychange` handler re-requests it
  on return, not just re-syncing the display), a `document.title` update while hidden so
  the remaining time is visible from the tab bar without switching back, a blinking
  `[data-urgent]` state in the final 10 seconds (gated on `prefers-reduced-motion`, same
  "layer motion on top of a static base state" pattern `src/ui/tokens/base.css`'s
  `.status-live-dot` already established — color is never the only urgency signal here
  either, matching `timingScreen.css`'s own precedent), and a WebAudio beep at zero (no
  audio asset shipped; the `AudioContext` is created/unlocked from the real Start-button
  click to satisfy browser autoplay-gesture policies, then reused for the later,
  gesture-less expiry beep). A persistent visible "Time's up" banner (`role="alert"`,
  focus moved to it) and a sustained (non-blinking) strong visual state carry the same
  signal for anyone who can't hear the beep — sound is never the only cue. State
  (title/duration/running-or-paused/expired) persists to `localStorage`, so a reload
  resumes correctly for the same reason a backgrounded tab does — it's just
  `(startedAt, durationSecs)` recomputed against `Date.now()` again, the identical trick
  `core/countdown.js` already proves drift-free. Linked from the marketing landing page's
  nav and footer (`src/marketing/landingScreen.js`, same 2026-09-12 pass) — Seduh Score's
  own brand mark + wordmark render at the top of the timer page itself, linking back to
  `/`, since a free public tool is deliberate promotion for the product, not an
  anonymous utility. Deliberately NOT integrated into
  `formats/cup-taster/timingScreen.js` — revisit once this tool has proven itself
  standalone; the console's own timing screen still uses its original, RPC-driven,
  real-clock-derived countdown untouched.
