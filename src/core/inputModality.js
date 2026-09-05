// Tracks whether the most recent user interaction was pointer- or
// keyboard-driven, exposed as `data-input-modality` ('pointer' | 'keyboard')
// on the root element — base.css keys off it to suppress the global
// `:focus-visible` ring specifically while the user is interacting by mouse/
// touch/pen (user-reported, 2026-09-05: a visible focus box appearing around
// a screen's own heading after an ordinary link click).
//
// This exists because native `:focus-visible` heuristics don't reliably
// suppress the ring for a whole category of scripted focus this app relies
// on: any `element.focus()` call following a mouse click, targeting an
// element that only just became focusable by script (a fresh `tabindex="-1"`
// on something not naturally interactive) rather than a naturally-focusable
// element with an existing click-to-focus affordance a browser can correlate
// the input device against. router.js's post-navigation heading focus is the
// case that surfaced this, but it's not the only one in this app — every
// screen's own `feedback.focus()` on an error/validation region after a
// form-submit click has the identical shape, and this fix applies uniformly
// to all of them, not narrowly to router.js's own case (found in review,
// ui-accessibility-reviewer). This module doesn't change WHERE focus goes
// (that stays unconditional — a screen reader user benefits from it
// regardless of input device); it only lets CSS distinguish the two cases
// for the VISUAL ring.
//
// A `keydown` immediately flips modality back to 'keyboard', so a Tab press
// (or Enter/Space activating a link right after a mouse click elsewhere)
// still shows the ring normally on whatever receives focus next — this is
// the standard, well-established "what-input" pattern used ahead of (and
// still needed alongside) native `:focus-visible` for exactly this scripted-
// focus edge case. Known, accepted limitation shared by every implementation
// of this pattern (found in review, ui-accessibility-reviewer): assistive
// tech that dispatches synthetic pointer events (switch access, an
// on-screen keyboard, a screen reader's own virtual cursor) reads as
// 'pointer' here, same as it already does for native `:focus-visible`
// everywhere else in this app — not a regression this module introduces.
// Also known and accepted (found in review, ui-accessibility-reviewer): a
// SIGHTED keyboard-only user who activates a target="_blank" link via
// Enter/Space lands in a fresh tab whose own first scripted focus-move
// (below) has the ring suppressed until their next real keydown — a false
// negative trading places with the false positive this module exists to
// fix. There is no signal available to tell the two cases apart (see
// below), so this is a deliberate "most likely case wins" call, not an
// oversight; the exposure is self-limiting (one screen, until their very
// next keydown).
//
// Defaults to 'pointer' immediately, before any real event has fired —
// found still reproducing live, 2026-09-05, after the first version of this
// fix shipped: every audience-facing link in this app (Splash screen,
// Audience — projector/phone) opens its target in a brand-new tab/window
// (`target="_blank"`), and a brand-new tab starts with NO interaction
// history of its own — its `data-input-modality` was simply absent on
// first paint, so the CSS override couldn't match and native
// `:focus-visible` showed the ring anyway, on router.js's very first
// post-navigation focus-move in that tab. Nothing in the OPENER tab's own
// click can cross into the new tab's separate document/JS realm to signal
// "this came from a mouse" — so rather than trying to track that
// (impossible across a real `window.open()` boundary), this defaults every
// fresh page load to the pointer assumption instead: a brand-new tab is
// overwhelmingly more likely to have been opened by a click than reached by
// a keyboard user who's about to immediately Tab around in it, and the
// very first real keydown (if one comes) flips this back to 'keyboard'
// immediately, same as any other case.
//
// This default applies to EVERY app mount, not just the two target="_blank"
// cases above — `trackInputModality()` is called exactly once, in
// main.js's `mountApp()`, before any routing happens. Found in review
// (code-reviewer): a cold load of the organiser dashboard itself (a typed
// URL, a bookmark, an ordinary same-tab external link, an F5 refresh) hits
// the identical "no interaction history yet" starting point a new tab
// does, so this same trade-off — the ring suppressed on that very first
// post-navigation heading focus, until the first real keydown — applies
// there too, not only to the audience-facing surfaces that originally
// surfaced the bug. Accepted for the same reason: there's no way to
// distinguish "freshly opened by a click" from "freshly opened by a
// keyboard user about to Tab" at mount time, for either case.
export function trackInputModality(root = document.documentElement) {
  function setModality(value) {
    if (root.dataset.inputModality !== value) root.dataset.inputModality = value;
  }
  setModality('pointer');
  // `pointerdown`, not `mousedown` alone — covers touch and pen too, all of
  // which are equally "not keyboard" for this purpose.
  function onPointerDown() {
    setModality('pointer');
  }
  function onKeyDown() {
    setModality('keyboard');
  }
  // Capture phase — must still flip the modality even if some descendant's
  // own handler calls stopPropagation() on pointerdown/keydown before it
  // would otherwise bubble up to root (found in review, code-reviewer: the
  // one choice in this file that shipped with no rationale comment).
  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('keydown', onKeyDown, true);
  return function stopTrackingInputModality() {
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('keydown', onKeyDown, true);
  };
}
