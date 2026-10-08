// The projector's body: what core/viewer-shell.js's `renderBody` mounts once a live session has content, in
// place of the phone's dense viewerBody. A thin binding — the screens are projectorScreens.js, the machinery
// (one display kept across payloads, re-attached to the shell's body each time) is core/stageBody.js.
import { createStageBody } from '../../core/stageBody.js';
import { selectProjectorScreen, projectorBand, hasProjectorContent } from './projectorScreens.js';

export function createProjectorBody(options = {}) {
  return createStageBody({
    selectScreen: selectProjectorScreen,
    bandFor: projectorBand,
    hasContent: hasProjectorContent,
    ...options,
  });
}
