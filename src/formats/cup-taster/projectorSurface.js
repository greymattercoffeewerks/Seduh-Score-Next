// Projector surface (handoff §14 T5.3). The thin, format-specific
// composition of core/viewer-shell.js + this format's own viewerBody.js —
// showChrome: false (no identity band/status badge; the legacy reference
// app's own projector precedent — T5.4's phone surface is the one that
// shows it), data-surface="stage" set here on the caller's own root (per
// viewer-shell.js's own module comment: that token mode is the caller's
// concern, not the shell's, and viewerBody.js/viewerBody.css already repaint
// correctly for it with zero rules of their own).
//
// Per the handoff's own §8.3: "Cup Taster's payload is a standings table, so
// the projector is far simpler than Throwdown's — no tree renderer, no
// scale-to-fit stage." This is a plain full-viewport page (see
// projectorSurface.css), not a fixed-logical-resolution canvas with a
// JS-driven scale wrapper — data-surface="stage"'s own clamp()-bounded
// typography (viewer-shell.css, viewerBody.css) is the only sizing
// mechanism this surface needs.
//
// viewerBody.js's live countdown (added alongside this task) is what
// actually answers the handoff's cross-surface AC — "prove organiser,
// projector, and phone all agree on remaining time" — since this module
// itself contributes no time-display logic of its own; it only mounts the
// shared body unedited.
import { mountViewerShell } from '../../core/viewer-shell.js';
import { mountViewerBody, hasViewableContent } from './viewerBody.js';

export function mountProjectorSurface(root, { orgId, client, signal } = {}) {
  // This route shares its outlet (bareRoot, main.js) with #/live/splash and
  // #/live/phone; main.js's buildRoutes() resets the shared root's class/
  // data-surface residue before calling this mount function, so this screen
  // only ever needs to apply its own.
  root.classList.add('projector-surface');
  root.setAttribute('data-surface', 'stage');
  return mountViewerShell(root, {
    orgId,
    renderBody: mountViewerBody,
    hasContent: hasViewableContent,
    showChrome: false,
    client,
    signal,
  });
}
