// The frame of a venue display: a permanent band on top, one screen below it, and a footer row, fed by a live
// payload. It composes core/stageBand.js (the band), core/screenDirector.js (when to change screen) and the
// caller's own screens; it knows nothing about any format. A format supplies two functions —
//
//   selectScreen(payload) -> screen | null      which screen this payload wants (see screenDirector.js)
//   bandFor(payload)      -> { eventName, sectionLabel, live } | null     what the band says
//
// — and gets back an element to mount and an `update(payload)` to call whenever the live payload changes.
// A second format's projector is a new pair of those functions plus its screens; nothing here is edited.
//
// Every screen draws inside a "frame" from renderScreenFrame(): the main area, and a footer with a start side
// (what is next) and an end side (a page counter and the ring). Screens put their content in those slots.
import { el } from './dom.js';
import { createScreenDirector } from './screenDirector.js';
import { createMomentPlayer } from './momentPlayer.js';
import { createProgressRing } from './progressRing.js';
import { renderStageBand } from './stageBand.js';

// Returns { el, main, footerStart, footerEnd }. Screens mount their own frame into the director's host.
export function renderScreenFrame() {
  const main = el('div', { className: 'stage-main' });
  const footerStart = el('div', { className: 'stage-footer-start' });
  const footerEnd = el('div', { className: 'stage-footer-end' });
  const frame = el('div', { className: 'stage-screen' }, [
    main,
    el('footer', { className: 'stage-footer' }, [footerStart, footerEnd]),
  ]);
  return { el: frame, main, footerStart, footerEnd };
}

// Puts a page-change ring in a screen's footer, counting down `durationMs` from now: the room's cue that this
// screen is about to give way. Returns the ring; the screen calls its `destroy()` when it is torn down.
export function mountFooterRing(frame, durationMs) {
  const ring = createProgressRing();
  frame.footerEnd.replaceChildren(ring.el);
  ring.run({ durationMs, startedAt: Date.now() });
  return ring;
}

// `detectMoments(previous, next)` (optional) turns a change between two snapshots into short "what just
// happened" screens played before the ordinary one — see core/momentPlayer.js. Without it the display only ever
// shows what `selectScreen` asks for. `maxQueuedMoments` caps how many wait their turn.
export function createStageDisplay({
  selectScreen,
  bandFor,
  detectMoments,
  maxQueuedMoments,
  ...directorOptions
}) {
  const bandHost = el('div', { className: 'stage-band-host' });
  // Not a live region: the shell's body is polite, and without this a republish or a page change would read the
  // whole screen aloud again. (A countdown's one-shot announcements are live regions of their own, and the
  // format provides the accessible companion to a venue display.)
  const screenHost = el('div', { className: 'stage-screen-host', attrs: { 'aria-live': 'off' } });
  const root = el('div', { className: 'stage-display' }, [bandHost, screenHost]);

  let lastBandKey = null;
  // The band says what the payload ON SCREEN says, not what the newest payload says: while the director is
  // holding a screen for its minimum dwell, a band that raced ahead would name the next stage over the last
  // one's screen. It is only rebuilt when its words change — it is on screen the whole event.
  function showBand(payload) {
    const band = payload ? bandFor(payload) : null;
    const bandKey = band ? JSON.stringify(band) : '';
    if (bandKey !== lastBandKey) {
      bandHost.replaceChildren(...(band ? [renderStageBand(band)] : []));
      lastBandKey = bandKey;
    }
  }
  const director = createScreenDirector({
    ...directorOptions,
    host: screenHost,
    // The band follows what is on screen; a caller's own onShown is still told too.
    onShown(payload) {
      showBand(payload);
      directorOptions.onShown?.(payload);
    },
  });

  const player = detectMoments
    ? createMomentPlayer({
        director,
        selectScreen,
        detectMoments,
        maxQueued: maxQueuedMoments,
        setTimer: directorOptions.setTimer,
        clearTimer: directorOptions.clearTimer,
      })
    : null;

  return {
    el: root,
    update(payload) {
      if (player) player.update(payload);
      else director.show(selectScreen(payload), payload);
    },
    currentKey: () => director.currentKey(),
    destroy() {
      player?.destroy();
      director.destroy();
    },
  };
}
