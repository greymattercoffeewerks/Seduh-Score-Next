// Phone summary surface (handoff §14 T5.4). The thin, format-specific
// composition of core/viewer-shell.js + this format's own viewerBody.js —
// showChrome: true (the identity band + status badge, per the legacy
// reference app's own phone-surface precedent — the projector, T5.3,
// deliberately omits this same chrome), the default (paper) token surface,
// no `data-surface` attribute set here since that's the caller's own root
// concern, not this module's.
import { mountViewerShell } from '../../core/viewer-shell.js';
import { mountViewerBody, hasViewableContent } from './viewerBody.js';

export function mountPhoneSummary(root, { orgId, client } = {}) {
  return mountViewerShell(root, {
    orgId,
    renderBody: mountViewerBody,
    hasContent: hasViewableContent,
    showChrome: true,
    client,
  });
}
