// A venue display's idle loop as a ready-made screen for core/screenDirector.js: pages shown one after another,
// each held for `dwellMs`, the page's words in the footer and a ring counting down to the change. It is what a
// format's `idleScreen` kept re-writing (a frame, a core/stagePageLoop.js, a rebuild guard); a new format only
// says what its pages are.
//
//   createLoopScreen({ key, pagesFor, signatureOf, dwellMs, footerFor, minDwellMs, urgent })
//     pagesFor(payload)       -> [{ render() -> nodes, label, ...anything footerFor wants }]; an empty list shows
//                                nothing (the frame is emptied, an old page never lingers)
//     signatureOf(payload)    -> a string naming everything the pages depend on; the loop is rebuilt (restarted
//                                from page one) ONLY when it changes. The live feed republishes without anything
//                                on screen having changed, and a restart then keeps sending the room back to the
//                                first page. Default: JSON of the whole payload.
//     footerFor(page, index, payload) -> the footer's start text (default: the page's label)
//
// The format leaves out of `pagesFor` any page with nothing to say. A throwing `pagesFor` is the caller's bug and
// is not hidden here. Format-agnostic: it never looks inside a page or a payload.
import { renderScreenFrame } from './stageDisplay.js';
import { createStagePageLoop } from './stagePageLoop.js';

export function createLoopScreen({
  key,
  pagesFor,
  signatureOf = (payload) => JSON.stringify(payload),
  dwellMs,
  footerFor,
  minDwellMs = 0,
  urgent = false,
  onPage,
}) {
  return {
    key,
    urgent,
    minDwellMs,
    mount(host, payload) {
      const frame = renderScreenFrame();
      host.append(frame.el);
      const loop = createStagePageLoop(frame, { dwellMs });
      let signature = null;
      function update(next) {
        const nextSignature = signatureOf(next);
        if (nextSignature === signature) return;
        signature = nextSignature;
        loop.show(pagesFor(next), {
          footerFor: footerFor ? (page, index) => footerFor(page, index, next) : undefined,
          onPage,
        });
      }
      update(payload);
      return { update, destroy: () => loop.destroy() };
    },
  };
}
