// One audience surface, whichever format is live. core/viewer-shell.js tells `hasContent` and `renderBody` the
// format of the live_sessions row it is showing; this picks that format's body and hands the call to it.
// Format-agnostic: the composition root passes `{ [format]: () => body }`, a body being the
// `{ renderBody, hasContent, destroy? }` shape a surface already mounts (core/stageBody.js makes one).
//
// Only one body is alive at a time. When the live row's format changes (an organiser publishes a different
// event) the previous body is destroyed, so a display's timers never keep running behind the new one, and a
// format returning later starts clean. A format with no body (not built yet, or a slug nobody registered) has
// no content: the shell shows its "not published yet" card, never another format's screens fed this payload.
//
// The shell calls these on every realtime refresh, so neither a body whose `destroy()` throws nor a factory
// that throws may wedge the surface: both are logged and the format simply has no content until it recovers.
// `destroy()` is final. A shell whose mount failed can still receive a late realtime event, and that must not
// build a new display (with timers) behind a surface nobody will unmount.
export function createFormatBody(factories) {
  let current = null; // { format, body }
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

  function select(format) {
    if (destroyed) return null;
    if (current && current.format === format) return current.body;
    releaseCurrent();
    if (!Object.hasOwn(factories, format)) return null;
    try {
      current = { format, body: factories[format]() };
    } catch (err) {
      console.error(`formatBody: could not build the "${format}" body`, err);
      return null;
    }
    return current.body;
  }

  return {
    hasContent(payload, { format } = {}) {
      const body = select(format);
      return body ? body.hasContent(payload) : false;
    },
    renderBody(container, payload, meta = {}) {
      const body = select(meta.format);
      return body ? body.renderBody(container, payload, meta) : undefined;
    },
    destroy() {
      destroyed = true;
      releaseCurrent();
    },
  };
}
