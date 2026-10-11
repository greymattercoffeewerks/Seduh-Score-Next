// Moving the console to a route from code, in one place. The router listens for `hashchange`, and the
// browser only fires one when the hash actually changes, so "go to #/events" has to cope with being
// there already (signing out while on the events list, or a change of organisation underneath it).
// Both helpers cause the router to re-resolve exactly once, which also aborts whatever screen is still
// loading for the previous state through the router's own AbortSignal.

// Go to `hash`, adding a history entry. Assigning a different hash makes the browser fire `hashchange`
// itself; assigning the same one fires none, so then dispatch one. The router's listener only reads
// `location.hash` fresh, never anything off the event, so a plain Event is enough.
export function goToHash(hash) {
  if (location.hash !== hash) {
    location.hash = hash;
    return;
  }
  window.dispatchEvent(new Event('hashchange'));
}

// Go to `hash`, replacing the current history entry, for a move the person did not choose (their
// organisation changed underneath them): Back should not return to a URL that belongs to the old
// state. replaceState fires no `hashchange`, so always dispatch one.
export function replaceHash(hash) {
  history.replaceState(history.state, '', hash);
  window.dispatchEvent(new Event('hashchange'));
}
