// Mounts a venue display (core/stageBody.js) as a full-screen audience surface: the dark `stage` token mode,
// a chrome-less core/viewer-shell, and clean teardown. Format-agnostic — a format hands it its body and, if it
// wants a hook of its own, a class for the root; everything a second format's projector would otherwise copy
// (the root classes, `data-surface`, the shell with `showChrome: false`, destroying the body when the mount
// fails and when the surface unmounts) lives here. Its stylesheet is core/stageSurface.css.
//
// The audience routes share one root (main.js's bareRoot) and reset its class and data-surface before each
// mount (resetBareSurface), so a surface only ever applies its own.
import { mountViewerShell } from './viewer-shell.js';

export async function mountStageSurface(
  root,
  { body, surfaceClass = '', orgId, client, signal } = {},
) {
  root.classList.add('stage-surface');
  if (surfaceClass) root.classList.add(surfaceClass);
  root.setAttribute('data-surface', 'stage');

  let handle;
  try {
    handle = await mountViewerShell(root, {
      orgId,
      renderBody: body.renderBody,
      hasContent: body.hasContent,
      showChrome: false,
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
