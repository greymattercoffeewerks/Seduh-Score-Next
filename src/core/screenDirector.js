// Decides WHEN a display changes screen, not what is on it. A venue display follows a live feed; the feed can
// change twice in a few seconds (one round ends and the next begins), and a screen swapped the instant the
// data changes gets pulled out from under a room that is still reading it. The director holds a screen for
// its own minimum dwell before replacing it, coalesces whatever arrives meanwhile into the latest wish, and
// lets an `urgent` screen (a running countdown) through at once. Format-agnostic: a screen is any object
//
//   { key, minDwellMs?, urgent?, mount(host, payload) -> { update?(payload), destroy() } }
//
// and what makes a payload want which screen is the caller's business (see core/stageDisplay.js).
// `onShown(payload)` (optional) reports the payload whose screen is actually on show — after a mount or an
// in-place update, never for a request that is still waiting out a hold, and with null when nothing is shown —
// so anything that must agree with the screen (the band above it) follows what is on screen, not what was
// asked for.
//
// Rules:
//   - the same screen asked for again is updated in place (never remounted, so a ticking countdown or a
//     rotating page keeps its place);
//   - a different screen replaces the current one once the current has been shown for ITS minDwellMs, or
//     immediately if the incoming one is urgent;
//   - until then the newest request waits, and asking for the current screen again cancels the wait;
//   - destroy() ends everything: no timer survives it.
export function createScreenDirector({
  host,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onShown = () => {},
}) {
  let current = null; // { screen, handle, shownAt }
  let pending = null; // { screen, payload }
  let timer = null;
  let destroyed = false;

  function cancelWait() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    pending = null;
  }

  function switchTo(screen, payload) {
    cancelWait();
    current?.handle.destroy();
    // Cleared before mounting: if the new screen throws while mounting, nothing may be left pointing at the
    // destroyed one (a later request for its key would otherwise update a dead handle).
    current = null;
    host.replaceChildren();
    current = { screen, handle: screen.mount(host, payload), shownAt: now() };
    onShown(payload);
  }

  return {
    // Asks for `screen` (or, with null, for nothing: the current screen is torn down at once).
    show(screen, payload) {
      if (destroyed) return;
      if (!screen) {
        cancelWait();
        current?.handle.destroy();
        host.replaceChildren();
        current = null;
        onShown(null);
        return;
      }
      if (!current) {
        switchTo(screen, payload);
        return;
      }
      if (current.screen.key === screen.key) {
        cancelWait();
        current.handle.update?.(payload);
        onShown(payload);
        return;
      }
      const heldFor = now() - current.shownAt;
      const minDwellMs = current.screen.minDwellMs ?? 0;
      if (screen.urgent || heldFor >= minDwellMs) {
        switchTo(screen, payload);
        return;
      }
      // Hold the current screen to its minimum, then show whatever was asked for last.
      pending = { screen, payload };
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (next && !destroyed) switchTo(next.screen, next.payload);
      }, minDwellMs - heldFor);
    },
    currentKey: () => current?.screen.key ?? null,
    destroy() {
      destroyed = true;
      cancelWait();
      current?.handle.destroy();
      current = null;
    },
  };
}
