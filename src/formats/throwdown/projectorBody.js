// Throwdown's projector body: a thin binding of its screens to core/stageBody.js (one display kept across payloads,
// released when the session ends). `options` ({ brand }) must be passed through (core/brandDoor.js).
import { createStageBody } from '../../core/stageBody.js';
import {
  selectThrowdownScreen,
  throwdownBand,
  hasThrowdownProjectorContent,
} from './projectorScreens.js';

export function createThrowdownProjectorBody(options = {}) {
  return createStageBody({
    selectScreen: selectThrowdownScreen,
    bandFor: throwdownBand,
    hasContent: hasThrowdownProjectorContent,
    ...options,
  });
}
