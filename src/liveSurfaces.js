// The three audience surfaces (projector, phone, splash) composed from every format's body. Like main.js this is a
// composition file, outside core/, so it may know the formats while core/ stays format-agnostic and a format
// never imports another. Each surface asks the live row for its format (core/formatBody.js) and shows that
// format's body; adding a format's projector or phone is one entry in the maps below.
//
// A format with no entry shows the shell's "Event not published yet" card, not another format's screens.
// The maps are parameters (defaulting to the real ones) so a test can mount a body that has resources to release.
//
// Every surface is also branded from here (BR-E1, core/brandDoor.js): it is mounted unbranded at once, and the
// organiser's brand is asked for beside it and applied when it arrives, if it ever does. Branding never blocks or
// delays a surface, and every failure leaves the surface as it was.
import { mountStageSurface } from './core/stageSurface.js';
import { mountViewerShell } from './core/viewer-shell.js';
import { mountSplashScreen } from './core/splashScreen.js';
import { createFormatBody } from './core/formatBody.js';
import { createBrandSource } from './core/brandDoor.js';
import { createProjectorBody } from './formats/cup-taster/projectorBody.js';
import { createBtcProjectorBody } from './formats/btc/projectorBody.js';
import { createBtcViewerBody } from './formats/btc/viewerBody.js';
import { mountViewerBody, hasViewableContent } from './formats/cup-taster/viewerBody.js';

// A projector body factory is handed `{ brand }` (core/formatBody.js), so a body built after the brand arrived, for
// the next event say, starts branded and a brand that arrives later reaches it through its `setBrand`.
export const PROJECTOR_BODIES = {
  cup_taster: (options) => createProjectorBody(options),
  btc: (options) => createBtcProjectorBody(options),
};

export const PHONE_BODIES = {
  cup_taster: () => ({ renderBody: mountViewerBody, hasContent: hasViewableContent }),
  btc: () => createBtcViewerBody(),
};

// Puts a brand that arrived while a surface was still mounting on it. A fault here must not turn a mounted surface
// into a failed mount (its source would keep asking and the router would mount a second one on top of it).
export function applyLateBrand(handle, brand) {
  if (!brand) return;
  try {
    handle.setBrand(brand);
  } catch (err) {
    console.error('liveSurfaces: the brand could not be applied', err);
  }
}

// Asks for the organiser's brand beside a mounting surface. `apply(brand | null)` is how the surface takes it. The
// returned source's `setEventId` is for the surface to say which event it shows; `stop()` ends the asking.
function watchBrand({ client, orgId, signal, apply }) {
  const source = createBrandSource({ client, orgId, onBrand: apply });
  if (signal?.aborted) {
    source.stop();
    return source;
  }
  signal?.addEventListener('abort', () => source.stop(), { once: true });
  source.start();
  return source;
}

export async function mountProjector(
  root,
  { orgId, client, signal, bodies = PROJECTOR_BODIES } = {},
) {
  const body = createFormatBody(bodies);
  // The brand can arrive before the surface has finished mounting; the latest is applied once it has.
  let handle = null;
  let brand = null;
  const source = watchBrand({
    client,
    orgId,
    signal,
    apply(next) {
      brand = next;
      body.setBrand(next);
      handle?.setBrand(next);
    },
  });
  try {
    handle = await mountStageSurface(root, {
      body,
      orgId,
      client,
      signal,
      onEventChange: (eventId) => source.setEventId(eventId),
    });
  } catch (err) {
    source.stop();
    throw err;
  }
  applyLateBrand(handle, brand);
  return {
    ...handle,
    unmount() {
      source.stop();
      handle.unmount();
    },
  };
}

// Mirrors mountStageSurface: the format body is destroyed when the mount fails and when the surface unmounts,
// and released when the live session goes away.
// (Cup Taster's phone body returns its cleanup from renderBody, which the shell calls, but a body may have a
// destroy() of its own.)
export async function mountPhone(root, { orgId, client, signal, bodies = PHONE_BODIES } = {}) {
  const body = createFormatBody(bodies);
  let handle = null;
  let brand = null;
  const source = watchBrand({
    client,
    orgId,
    signal,
    apply(next) {
      brand = next;
      handle?.setBrand(next);
    },
  });
  try {
    handle = await mountViewerShell(root, {
      orgId,
      renderBody: body.renderBody,
      hasContent: body.hasContent,
      onNoContent: () => body.release(),
      onEventChange: (eventId) => source.setEventId(eventId),
      showChrome: true,
      client,
      signal,
    });
  } catch (err) {
    source.stop();
    body.destroy();
    throw err;
  }
  applyLateBrand(handle, brand);
  return {
    ...handle,
    unmount() {
      source.stop();
      body.destroy();
      handle.unmount();
    },
  };
}

// The splash screen. It is synchronous (it never waits for anything), and so is this: the screen exists before the
// first answer can possibly arrive, so unlike the other two there is no brand to catch up on after mounting.
export function mountSplash(root, { orgId, client, signal } = {}) {
  let handle = null;
  const source = watchBrand({
    client,
    orgId,
    signal,
    apply: (next) => handle?.setBrand(next),
  });
  try {
    handle = mountSplashScreen(root, {
      orgId,
      client,
      signal,
      onEvent: (event) => source.setEventId(event?.id),
    });
  } catch (err) {
    source.stop();
    throw err;
  }
  return {
    ...handle,
    unmount() {
      source.stop();
      handle.unmount();
    },
  };
}
