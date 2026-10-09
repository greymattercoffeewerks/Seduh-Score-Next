// The binding between core/viewer-shell.js and a stage display: the `renderBody` and `hasContent` a shell
// mounts a venue display through. Format-agnostic — a format hands it its selector, band and content test
// (see core/stageDisplay.js) and gets the two functions back.
//
// viewer-shell clears its body and calls renderBody again on EVERY live payload, so a display built inside
// renderBody would be torn down and rebuilt on each one (a page loop restarting, a ring resetting, a countdown
// flickering). Instead ONE stage display is kept per body and re-attached to the fresh body each time; its
// screens and timers keep running across payloads, and only a real change in what the payload wants changes
// the screen (core/screenDirector.js). The display is built on first use.
//
// `release()` ends the display (its timers stop, and with it its memory of the last snapshot); the next
// payload builds a new one. The surface calls it when the live session goes away, so a body used on its own
// (not through core/formatBody.js) honours that too. `destroy()` is final: it ends the display for good, when
// the surface unmounts.
import { createStageDisplay } from './stageDisplay.js';

export function createStageBody({ selectScreen, bandFor, hasContent, ...displayOptions }) {
  let display = null;
  let destroyed = false;

  function release() {
    display?.destroy();
    display = null;
  }

  return {
    renderBody(body, payload) {
      if (destroyed) return;
      display ??= createStageDisplay({ selectScreen, bandFor, ...displayOptions });
      display.update(payload);
      body.appendChild(display.el);
    },
    hasContent,
    release,
    destroy() {
      destroyed = true;
      release();
    },
  };
}
