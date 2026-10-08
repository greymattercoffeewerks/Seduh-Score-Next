// The permanent band along the top of a venue display: who it is (the Seduh Score lockup), which event, and
// where in it (a section label) with a Live marker. ("Stage" in these names means the venue stage — the
// screen on show — not a stage of any competition; the section label is whatever the format calls its phase.) It stays put while the screens below it change, which is
// what gives a venue display its "event feel" — a room that glances up always knows what it is looking at.
// Format-agnostic: the caller supplies the strings (a stage label is its own format's vocabulary).
// Styled in core/stageDisplay.css.
import { el, brandLockup } from './dom.js';

// `eventName` and `sectionLabel` are optional (a payload published before the name was included simply has
// neither) and the band degrades to the lockup and the Live marker rather than showing blanks.
export function renderStageBand({ eventName = null, sectionLabel = null, live = true } = {}) {
  const left = [el('span', { className: 'stage-band-brand' }, [brandLockup()])];
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

  return el('header', { className: 'stage-band' }, [
    el('div', { className: 'stage-band-left' }, left),
    el('div', { className: 'stage-band-right' }, right),
  ]);
}
