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
  it('sets data-input-modality to "pointer" on pointerdown', () => {
    const root = fakeRoot();
    trackInputModality(root);
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

  // Both event types, not just pointerdown — found in review (test-auditor):
  // a mutation that removed only the keydown listener's removeEventListener
  // call (or mismatched its capture flag, which silently fails to
  // deregister a real DOM listener) would still pass a cleanup test that
  // only re-dispatched pointerdown afterward.
  it('stops updating for either event type once the returned cleanup function is called', () => {
    const root = fakeRoot();
    const stop = trackInputModality(root);
    stop();
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(root.dataset.inputModality).toBeUndefined();
    root.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(root.dataset.inputModality).toBeUndefined();
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

    child.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(root.dataset.inputModality).toBe('pointer');
  });
});
