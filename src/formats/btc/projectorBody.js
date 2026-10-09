// BTC's projector body: what core/viewer-shell.js's `renderBody` mounts once a BTC live session has content. A
// thin binding, like Cup Taster's: the screens are projectorScreens.js, the "what just happened" moments are
// projectorMoments.js, and the machinery (one display kept across payloads, re-attached to the shell's body
// each time; released when the session ends) is core/stageBody.js.
import { createStageBody } from '../../core/stageBody.js';
import { selectBtcScreen, hasBtcProjectorContent } from './projectorScreens.js';
import { btcBand } from './words.js';
import { detectBtcMoments } from './projectorMoments.js';

export function createBtcProjectorBody(options = {}) {
  return createStageBody({
    selectScreen: selectBtcScreen,
    bandFor: btcBand,
    hasContent: hasBtcProjectorContent,
    detectMoments: detectBtcMoments,
    ...options,
  });
}
