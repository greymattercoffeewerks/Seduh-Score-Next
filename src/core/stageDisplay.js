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
import { applyBrandColors, normaliseBrand } from './brandSlot.js';

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
// A caller that owns a long-lived ring (core/stagePageLoop.js reuses one across pages) passes it, and the
// instant the hold began, so the ring is drawn the same way everywhere.
export function mountFooterRing(
  frame,
  durationMs,
  { ring = createProgressRing(), startedAt = Date.now() } = {},
) {
  frame.footerEnd.replaceChildren(ring.el);
  ring.run({ durationMs, startedAt });
  return ring;
}

// `detectMoments(previous, next)` (optional) turns a change between two snapshots into short "what just
// happened" screens played before the ordinary one — see core/momentPlayer.js. Without it the display only ever
// shows what `selectScreen` asks for. `maxQueuedMoments` caps how many wait their turn.
//
// `brand` (optional, core/brandSlot.js) is the organiser's identity and accent colour. With one, the band carries
// their logo and name with "Powered by Seduh Score" beside it, and their accent colour is set on this display's root
// (the stage mode's three accent properties only). `setBrand(brand)` changes or clears it later, which is how a
// display picks up branding that arrives after it is shown; it never blocks or delays the display.
export function createStageDisplay({
  selectScreen,
  bandFor,
  detectMoments,
  maxQueuedMoments,
  brand: initialBrand = null,
  ...directorOptions
}) {
  const bandHost = el('div', { className: 'stage-band-host' });
  // Not a live region: the shell's body is polite, and without this a republish or a page change would read the
  // whole screen aloud again. (A countdown's one-shot announcements are live regions of their own, and the
  // format provides the accessible companion to a venue display.)
  const screenHost = el('div', { className: 'stage-screen-host', attrs: { 'aria-live': 'off' } });
  const root = el('div', { className: 'stage-display' }, [bandHost, screenHost]);

  let lastBandKey = null;
  let shownPayload = null;
  let destroyed = false;
  let brand = normaliseBrand(initialBrand);
  applyBrandColors(root, brand, 'stage');
  // The band says what the payload ON SCREEN says, not what the newest payload says: while the director is
  // holding a screen for its minimum dwell, a band that raced ahead would name the next stage over the last
  // one's screen. It is only rebuilt when its words (or the brand) change — it is on screen the whole event.
  function showBand(payload) {
    shownPayload = payload;
    let band = payload ? bandFor(payload) : null;
    // A branded display is credited even when the format published no band words: the brand and the credit still
    // show, so "Powered by Seduh Score" is never missing from a branded screen. The format said it has no band
    // words, so the band does not claim "Live" either.
    if (!band && payload && brand) band = { live: false };
    const bandKey = band ? JSON.stringify({ band, brand }) : '';
    if (bandKey !== lastBandKey) {
      bandHost.replaceChildren(...(band ? [renderStageBand({ ...band, brand })] : []));
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
    // Changes or clears the brand. The band is rebuilt only if something it shows actually changed.
    setBrand(next) {
      if (destroyed) return;
      brand = normaliseBrand(next);
      applyBrandColors(root, brand, 'stage');
      if (shownPayload) showBand(shownPayload);
    },
    currentKey: () => director.currentKey(),
    destroy() {
      destroyed = true;
      player?.destroy();
      director.destroy();
    },
  };
}
