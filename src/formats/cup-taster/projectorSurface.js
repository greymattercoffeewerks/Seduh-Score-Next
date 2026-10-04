// Projector surface (handoff §14 T5.3). The thin, format-specific
// composition of core/viewer-shell.js + this format's own viewerBody.js —
// showChrome: false (no identity band/status badge; the legacy reference
// app's own projector precedent — T5.4's phone surface is the one that
// shows it), data-surface="stage" set here on the caller's own root (per
// viewer-shell.js's own module comment: that token mode is the caller's
// concern, not the shell's, and viewerBody.js/viewerBody.css already repaint
// correctly for it with zero rules of their own).
//
// The handoff's §8.3 expected "no scale-to-fit stage" for Cup Taster, on the
// theory that a standings table needs nothing more than clamp()-bounded
// typography. The 2026-10-03 rehearsal disproved it: 17 prelim cuppers plus
// recent heats measured 1,837px tall on a 1920×1080 projector, so the audience
// view needed scrolling — which a projector can't do. Two fixes, both
// projector-only (the phone surface still scrolls normally):
//   1. projectorSurface.css lays viewerBody's main and side groups out side by
//      side on a landscape screen, using the width instead of a long column.
//   2. core/dom.js's fitToScreen() scales the whole view down (never up) whenever its
//      content is still taller than the screen — more cuppers, a running heat,
//      or a low-resolution projector — so nothing is ever cut off or scrolled.
//
// viewerBody.js's live countdown (added alongside this task) is what
// actually answers the handoff's cross-surface AC — "prove organiser,
// projector, and phone all agree on remaining time" — since this module
// itself contributes no time-display logic of its own; it only mounts the
// shared body unedited.
import { mountViewerShell } from '../../core/viewer-shell.js';
import { fitToScreen } from '../../core/dom.js';
import { mountViewerBody, hasViewableContent } from './viewerBody.js';

export async function mountProjectorSurface(root, { orgId, client, signal } = {}) {
  // This route shares its outlet (bareRoot, main.js) with #/live/splash and
  // #/live/phone; main.js's buildRoutes() resets the shared root's class/
  // data-surface residue before calling this mount function, so this screen
  // only ever needs to apply its own.
  root.classList.add('projector-surface');
  root.setAttribute('data-surface', 'stage');

  // The audience routes share this root, and the router mounts the NEXT screen
  // before unmounting this one — so while the next screen loads, its own
  // .viewer-shell can appear here with this observer still connected. The
  // first shell seen is this mount's own (mountViewerShell clears the root and
  // appends it before anything else can); it's remembered, and fitting stops
  // once it leaves the root, so this screen never resizes another screen's view.
  let shell = null;
  let frame = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      shell ??= root.querySelector(':scope > .viewer-shell');
      if (shell?.parentNode === root) fitToScreen(root, shell);
    });
  };
  // Every re-render (new payload, holding state, a countdown tick) changes the
  // DOM; a resize or a web font finishing loading changes the measurements.
  // `loadingdone`, not `document.fonts.ready`: ready resolves at mount, before
  // any text has asked for the display/mono fonts — the fonts then load later
  // and make the text taller with no DOM change (found verifying in a browser).
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  document.fonts?.addEventListener?.('loadingdone', schedule);
  const stopFitting = () => {
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    document.fonts?.removeEventListener?.('loadingdone', schedule);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  let handle;
  try {
    handle = await mountViewerShell(root, {
      orgId,
      renderBody: mountViewerBody,
      hasContent: hasViewableContent,
      showChrome: false,
      client,
      signal,
    });
  } catch (err) {
    stopFitting();
    throw err;
  }
  schedule();
  return {
    ...handle,
    unmount() {
      stopFitting();
      handle.unmount();
    },
  };
}
