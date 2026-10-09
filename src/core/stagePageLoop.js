// An idle loop for a venue display's frame (core/stageDisplay.js): a list of pages shown one after another,
// each held for `dwellMs`, with the page's label in the footer and a ring counting down to the change.
// Extracted from Cup Taster's idle screen when BTC needed the same loop (the second-use rule). Format-agnostic:
// a page is { render() -> nodes, label }; the format decides what the pages say and when to rebuild them.
//
// `show(pages, { footerFor, onPage })` (re)starts the loop on the new pages, from the first. `onPage(page,
// index)` runs just before a page is painted, for a format's own per-page layout class; `footerFor(page,
// index)` is the footer's start text (default: the page's label). One page does not rotate and has no ring.
import { createPageRotator } from './pageRotator.js';
import { createProgressRing } from './progressRing.js';
import { mountFooterRing } from './stageDisplay.js';

export function createStagePageLoop(frame, { dwellMs }) {
  const ring = createProgressRing();
  let rotator = null;

  function clear() {
    ring.stop();
    frame.main.replaceChildren();
    frame.footerStart.textContent = '';
    frame.footerEnd.replaceChildren();
  }

  return {
    // No pages empties the frame (and stops the ring), so an old page is never left on screen.
    show(pages, { footerFor = (page) => page.label, onPage } = {}) {
      rotator?.stop();
      if (pages.length === 0) {
        rotator = null;
        clear();
        return;
      }
      rotator = createPageRotator({
        pageCount: pages.length,
        dwellMs,
        onPage(index, { dwellMs: heldMs, startedAt }) {
          const page = pages[index];
          onPage?.(page, index);
          frame.main.replaceChildren(...page.render());
          frame.footerStart.textContent = footerFor(page, index);
          if (pages.length > 1) {
            mountFooterRing(frame, heldMs, { ring, startedAt });
          } else {
            ring.stop();
            frame.footerEnd.replaceChildren();
          }
        },
      });
      rotator.start();
    },
    destroy() {
      rotator?.stop();
      ring.destroy();
    },
  };
}
