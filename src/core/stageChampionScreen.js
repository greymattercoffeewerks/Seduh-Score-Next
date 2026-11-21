// The decided-event screen every venue display ends on: the champion's name large under a "Champion" label, an
// optional score line and podium line, and a footer. Built on core/stageVocabulary.js's `renderChampion`. It
// holds for `minDwellMs` (60 s by default) so only news (a moment) replaces it sooner.
//
//   createChampionScreen({ paint(payload) -> { name, scoreLine?, podiumLine?, footerStart?, footerEnd? },
//                          minDwellMs = 60000, key = 'champion', label })
//
// The format decides every word; this decides the shape. Updated in place on each snapshot (never remounted), so
// a republish never replays anything. Format-agnostic.
import { renderScreenFrame } from './stageDisplay.js';
import { renderChampion } from './stageVocabulary.js';

export const CHAMPION_MIN_DWELL_MS = 60_000;

export function createChampionScreen({
  paint,
  minDwellMs = CHAMPION_MIN_DWELL_MS,
  key = 'champion',
  label,
}) {
  return {
    key,
    urgent: false,
    minDwellMs,
    mount(host, payload) {
      const frame = renderScreenFrame();
      host.append(frame.el);
      function draw(next) {
        const view = paint(next);
        frame.main.replaceChildren(
          ...renderChampion({
            ...(label ? { label } : {}),
            name: view.name,
            scoreLine: view.scoreLine ?? null,
            podiumLine: view.podiumLine ?? null,
          }),
        );
        frame.footerStart.textContent = view.footerStart ?? '';
        frame.footerEnd.textContent = view.footerEnd ?? '';
      }
      draw(payload);
      return { update: draw, destroy() {} };
    },
  };
}
