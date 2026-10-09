// The two audience surfaces (projector, phone) composed from every format's body. Like main.js this is a
// composition file, outside core/, so it may know the formats while core/ stays format-agnostic and a format
// never imports another. Each surface asks the live row for its format (core/formatBody.js) and shows that
// format's body; adding a format's projector or phone is one entry in the maps below.
//
// A format with no entry shows the shell's "Event not published yet" card, not another format's screens.
// The maps are parameters (defaulting to the real ones) so a test can mount a body that has resources to release.
import { mountStageSurface } from './core/stageSurface.js';
import { mountViewerShell } from './core/viewer-shell.js';
import { createFormatBody } from './core/formatBody.js';
import { createProjectorBody } from './formats/cup-taster/projectorBody.js';
import { createBtcProjectorBody } from './formats/btc/projectorBody.js';
import { createBtcViewerBody } from './formats/btc/viewerBody.js';
import { mountViewerBody, hasViewableContent } from './formats/cup-taster/viewerBody.js';

export const PROJECTOR_BODIES = {
  cup_taster: () => createProjectorBody(),
  btc: () => createBtcProjectorBody(),
};

export const PHONE_BODIES = {
  cup_taster: () => ({ renderBody: mountViewerBody, hasContent: hasViewableContent }),
  btc: () => createBtcViewerBody(),
};

export function mountProjector(root, { orgId, client, signal, bodies = PROJECTOR_BODIES } = {}) {
  return mountStageSurface(root, {
    body: createFormatBody(bodies),
    orgId,
    client,
    signal,
  });
}

// Mirrors mountStageSurface: the format body is destroyed when the mount fails and when the surface unmounts,
// and released when the live session goes away.
// (Cup Taster's phone body returns its cleanup from renderBody, which the shell calls, but a body may have a
// destroy() of its own.)
export async function mountPhone(root, { orgId, client, signal, bodies = PHONE_BODIES } = {}) {
  const body = createFormatBody(bodies);
  let handle;
  try {
    handle = await mountViewerShell(root, {
      orgId,
      renderBody: body.renderBody,
      hasContent: body.hasContent,
      onNoContent: () => body.release(),
      showChrome: true,
      client,
      signal,
    });
  } catch (err) {
    body.destroy();
    throw err;
  }
  return {
    ...handle,
    unmount() {
      body.destroy();
      handle.unmount();
    },
  };
}
