import { describe, it, expect, afterEach } from 'vitest';
import { trackInputModality } from './inputModality.js';

// Matches this codebase's own convention (appShell.test.js, router.test.js,
// etc.) of pairing an appendChild fixture with real teardown — without this,
// three of these tests' own `root` elements (the ones that never call their
// returned cleanup) would keep live pointerdown/keydown listeners attached
// to real DOM nodes for the rest of this file's run.
const liveRoots = [];
function fakeRoot() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  liveRoots.push(el);
  return el;
}
afterEach(() => {
  for (const root of liveRoots.splice(0)) {
    document.body.removeChild(root);
  }
});

describe('trackInputModality', () => {
  // The fix for the real, live-reproducing gap (2026-09-05): every
  // audience-facing link in this app opens a brand-new tab
  // (target="_blank"), which starts with no interaction history of its
  // own — nothing from the opener tab's own click can cross into it. A
  // fresh tab defaulting to 'keyboard' (or staying unset, which the CSS
  // override can't match at all) would show the ring on that tab's very
  // first paint regardless of how it was opened.
  it('defaults to "pointer" immediately on mount, before any real event fires', () => {
    const root = fakeRoot();
    trackInputModality(root);
    expect(root.dataset.inputModality).toBe('pointer');
  });

  it('sets data-input-modality to "pointer" on pointerdown', () => {
    const root = fakeRoot();
    trackInputModality(root);
    // Disambiguated from the post-mount default (also 'pointer') via a real
    // keydown first — found in review (test-auditor): without this, the
    // assertion below would pass even if the pointerdown listener never
    // fired at all, since mount already leaves the value at 'pointer'.
    root.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('keyboard');
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('pointer');
  });

  it('sets data-input-modality to "keyboard" on keydown', () => {
    const root = fakeRoot();
    trackInputModality(root);
    root.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('keyboard');
  });

  it('flips back to "keyboard" after a pointerdown, proving a Tab press right after a click still shows the ring', () => {
    const root = fakeRoot();
    trackInputModality(root);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('pointer');
    root.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('keyboard');
  });

  // Split into two mirror-image tests, one per listener — found in review
  // (test-auditor, a real gap that shipped once already): a single test
  // that starts from 'keyboard', stops, dispatches pointerdown (proving
  // that listener is gone, since a live one would flip the value to
  // 'pointer'), then re-dispatches keydown and re-asserts 'keyboard' proves
  // NOTHING about the keydown listener specifically — setModality() is
  // idempotent, so a still-attached keydown listener firing and a removed
  // one both leave the value at 'keyboard' either way. Confirmed live via
  // mutation testing: deleting the keydown removeEventListener call from
  // inputModality.js's own cleanup function left that combined test green.
  // Each test below instead starts from the OPPOSITE value its own event
  // would produce, so only a genuinely-still-attached listener can flip it.
  it('stops updating on pointerdown once the returned cleanup function is called', () => {
    const root = fakeRoot();
    const stop = trackInputModality(root);
    root.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('keyboard');
    stop();
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('keyboard');
  });

  it('stops updating on keydown once the returned cleanup function is called', () => {
    const root = fakeRoot();
    const stop = trackInputModality(root);
    // Starts at 'pointer' — the post-mount default — so a subsequent
    // keydown flipping it to 'keyboard' is unambiguous proof the listener
    // is still live; the mirror image of the pointerdown test above.
    expect(root.dataset.inputModality).toBe('pointer');
    stop();
    root.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(root.dataset.inputModality).toBe('pointer');
  });

  // The module's actual reason for existing (found in review, test-auditor:
  // this was the one property none of the other tests exercised) — capture
  // phase specifically so modality still flips even if some descendant's own
  // handler calls stopPropagation() before the event would otherwise bubble
  // up to root. A regression that dropped the `true` argument from both
  // addEventListener calls would pass every other test here (dispatching
  // directly ON root never touches phase at all) but would fail this one.
  it('still updates modality even when a descendant stops the event from bubbling', () => {
    const root = fakeRoot();
    const child = document.createElement('button');
    root.appendChild(child);
    child.addEventListener('pointerdown', (event) => event.stopPropagation());
    trackInputModality(root);
    // Prove the CAPTURE-phase listener still fires despite the descendant's
    // stopPropagation() — set to 'keyboard' first so a pointerdown reaching
    // root is unambiguous, not indistinguishable from the post-mount default.
    root.dataset.inputModality = 'keyboard';

    child.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(root.dataset.inputModality).toBe('pointer');
  });
});
