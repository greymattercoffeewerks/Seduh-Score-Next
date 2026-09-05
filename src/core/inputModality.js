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
export function trackInputModality(root = document.documentElement) {
  function setModality(value) {
    if (root.dataset.inputModality !== value) root.dataset.inputModality = value;
  }
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
