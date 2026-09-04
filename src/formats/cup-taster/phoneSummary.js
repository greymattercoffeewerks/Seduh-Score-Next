// Phone summary surface (handoff §14 T5.4). The thin, format-specific
// composition of core/viewer-shell.js + this format's own viewerBody.js —
// showChrome: true (the identity band + status badge, per the legacy
// reference app's own phone-surface precedent — the projector, T5.3,
// deliberately omits this same chrome), the default (paper) token surface,
// no `data-surface` attribute set here since that's the caller's own root
// concern, not this module's.
import { mountViewerShell } from '../../core/viewer-shell.js';
import { mountViewerBody, hasViewableContent } from './viewerBody.js';

export function mountPhoneSummary(root, { orgId, client, signal } = {}) {
  // This route shares its outlet (bareRoot, main.js) with #/live/splash and
  // #/live/projector. Unlike those two, this surface's own paper mode IS
  // the absence of a data-surface attribute/either sibling's class — found
  // in review (cross-screen consistency pass): without a reset somewhere, a
  // direct #/live/projector -> #/live/phone navigation left the dark,
  // oversized stage-mode palette applied to what's supposed to be the plain
  // paper-mode phone surface. main.js's buildRoutes() now does that reset
  // before calling this mount function (this screen has nothing of its own
  // to apply, so nothing is needed here beyond the shell mount below).
  return mountViewerShell(root, {
    orgId,
    renderBody: mountViewerBody,
    hasContent: hasViewableContent,
    showChrome: true,
    client,
    signal,
  });
}
