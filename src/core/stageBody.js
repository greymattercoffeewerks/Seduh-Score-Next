// The binding between core/viewer-shell.js and a stage display: the `renderBody` and `hasContent` a shell
// mounts a venue display through. Format-agnostic — a format hands it its selector, band and content test
// (see core/stageDisplay.js) and gets the two functions back.
//
// viewer-shell clears its body and calls renderBody again on EVERY live payload, so a display built inside
// renderBody would be torn down and rebuilt on each one (a page loop restarting, a ring resetting, a countdown
// flickering). Instead ONE stage display is created per body and re-attached to the fresh body each time; its
// screens and timers keep running across payloads, and only a real change in what the payload wants changes
// the screen (core/screenDirector.js). `destroy()` ends its timers when the surface unmounts.
import { createStageDisplay } from './stageDisplay.js';

export function createStageBody({ selectScreen, bandFor, hasContent, ...displayOptions }) {
  const display = createStageDisplay({ selectScreen, bandFor, ...displayOptions });
  return {
    renderBody(body, payload) {
      display.update(payload);
      body.appendChild(display.el);
    },
    hasContent,
    destroy: () => display.destroy(),
  };
}
