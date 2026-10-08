// Projector surface (handoff §14 T5.3, redesigned 2026-10-08 for live-event finding #5): Cup Taster's venue
// display. Just this format's body (projectorBody.js: the screens) on core's generic surface
// (core/stageSurface.js: the dark `stage` mode, a chrome-less viewer shell, teardown). The `projector-surface`
// class is this format's own hook (projectorScreens.css sizes the countdown under it).
//
// History: the projector first reused the phone's dense viewerBody. The 2026-10-03 rehearsal showed 17
// cuppers measuring 1,837px tall on a 1920×1080 screen, and the first fix scaled the whole view DOWN until it
// fit (core/dom.js's fitToScreen, since removed) — which at the 2026-10-04 event meant small type and "too
// much at once" with "not enough event feel". It now shows one screen per moment (the heat on stage, being
// scored, an idle loop of up-next and the standings in pages, the champion), sized to the screen so nothing
// is scaled or scrolled. The PHONE surface still mounts viewerBody and still scrolls normally.
//
// The heat screen renders the shared countdown element (`.viewer-countdown`, core/countdownDisplay.js), the
// same math as the organiser and the phone, so the handoff's cross-surface AC — "organiser, projector and
// phone all agree on remaining time" — is still checked on every surface.
import { mountStageSurface } from '../../core/stageSurface.js';
import { createProjectorBody } from './projectorBody.js';

export function mountProjectorSurface(root, { orgId, client, signal } = {}) {
  return mountStageSurface(root, {
    body: createProjectorBody(),
    surfaceClass: 'projector-surface',
    orgId,
    client,
    signal,
  });
}
