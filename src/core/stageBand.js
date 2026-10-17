// The permanent band along the top of a venue display: who it is (the Seduh Score lockup), which event, and
// where in it (a section label) with a Live marker. ("Stage" in these names means the venue stage — the
// screen on show — not a stage of any competition; the section label is whatever the format calls its phase.) It stays put while the screens below it change, which is
// what gives a venue display its "event feel" — a room that glances up always knows what it is looking at.
// Format-agnostic: the caller supplies the strings (a stage label is its own format's vocabulary).
// Styled in core/stageDisplay.css.
//
// Branding (BR-D2): with a `brand` (core/brandSlot.js) the organiser's logo and display name take the left slot
// where the Seduh Score lockup was, and "Powered by Seduh Score" takes the right, after the Live marker, so the
// platform is credited on every branded display. Without one the band is exactly what it always was.
import { el, brandLockup } from './dom.js';
import { normaliseBrand, renderBrandIdentity } from './brandSlot.js';
import { renderPoweredBy } from './poweredBy.js';

// `eventName` and `sectionLabel` are optional (a payload published before the name was included simply has
// neither) and the band degrades to the lockup and the Live marker rather than showing blanks.
export function renderStageBand({
  eventName = null,
  sectionLabel = null,
  live = true,
  brand = null,
} = {}) {
  const branded = normaliseBrand(brand);
  const identity = branded
    ? el('span', { className: 'stage-band-brand stage-band-brand-custom' }, [
        // The credit on this band carries the Seduh Score lockup, so a failed logo does not add a second one.
        renderBrandIdentity(branded, { lockupFallback: false }),
      ])
    : el('span', { className: 'stage-band-brand' }, [brandLockup()]);
  const left = [identity];
  if (eventName) left.push(el('span', { className: 'stage-band-event', text: eventName }));

  const right = [];
  if (sectionLabel) right.push(el('span', { className: 'stage-band-section', text: sectionLabel }));
  if (live) {
    right.push(
      el('span', { className: 'stage-band-live' }, [
        el('span', { className: 'stage-band-live-dot', attrs: { 'aria-hidden': 'true' } }),
        document.createTextNode('Live'),
      ]),
    );
  }
  // After the Live marker, outside anything an organiser can set: see core/poweredBy.js.
  if (branded) {
    const credit = renderPoweredBy('powered-by-band');
    if (credit) right.push(credit);
  }

  return el('header', { className: 'stage-band' }, [
    el('div', { className: 'stage-band-left' }, left),
    el('div', { className: 'stage-band-right' }, right),
  ]);
}
