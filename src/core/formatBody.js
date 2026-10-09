// One audience surface, whichever format is live. core/viewer-shell.js tells `hasContent` and `renderBody` the
// format of the live_sessions row it is showing; this picks that format's body and hands the call to it.
// Format-agnostic: the composition root passes `{ [format]: () => body }`, a body being the
// `{ renderBody, hasContent, destroy? }` shape a surface already mounts (core/stageBody.js makes one).
//
// Only one body is alive at a time, and it belongs to ONE event's session: it is keyed on the live row's
// format AND event id. When either changes (an organiser publishes a different event, even in the same
// format, which swaps the live row in one step with no gap) the previous body is destroyed, so a display's
// timers never keep running behind the new one, and the new event starts from a fresh body with no memory of
// the last event's snapshot (a display compares each payload with the one before it to find what just
// happened; that must never cross two events). A format with no body (not built yet, or a slug nobody
// registered) has no content: the shell shows its "not published yet" card, never another format's screens
// fed this payload.
//
// When the live session goes away (no event, none active) the shell calls its `onNoContent` and the surface
// calls this module's `release()`: the body is destroyed, and a later session builds a fresh one. Release is
// not final (destroy() is); a body created by this module's factories is the only thing it releases, so a body
// used without this wrapper must be releasable itself (core/stageBody.js's `release()`).
//
// The shell calls these on every realtime refresh, so neither a body whose `destroy()` throws nor a factory
// that throws may wedge the surface: both are logged and the format simply has no content until it recovers.
// `destroy()` is final. A shell whose mount failed can still receive a late realtime event, and that must not
// build a new display (with timers) behind a surface nobody will unmount.
export function createFormatBody(factories) {
  let current = null; // { format, eventId, body }
  let destroyed = false;

  function releaseCurrent() {
    const previous = current;
    current = null;
    try {
      previous?.body.destroy?.();
    } catch (err) {
      console.error('formatBody: a format body failed to clean up', err);
    }
  }

  function select(format, eventId) {
    if (destroyed) return null;
    if (current && current.format === format && current.eventId === eventId) return current.body;
    releaseCurrent();
    if (!Object.hasOwn(factories, format)) return null;
    try {
      current = { format, eventId, body: factories[format]() };
    } catch (err) {
      console.error(`formatBody: could not build the "${format}" body`, err);
      return null;
    }
    return current.body;
  }

  return {
    hasContent(payload, { format, eventId } = {}) {
      const body = select(format, eventId);
      return body ? body.hasContent(payload) : false;
    },
    renderBody(container, payload, meta = {}) {
      const body = select(meta.format, meta.eventId);
      return body ? body.renderBody(container, payload, meta) : undefined;
    },
    // The live session ended (or has nothing to show): drop the body, destroying it, so its timers stop and the
    // next session starts from a fresh one with no memory of the last snapshot. Unlike destroy() this is not
    // final: a session that comes back builds a new body.
    release: releaseCurrent,
    destroy() {
      destroyed = true;
      releaseCurrent();
    },
  };
}
