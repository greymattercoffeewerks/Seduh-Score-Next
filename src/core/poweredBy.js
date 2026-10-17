// The "Powered by Seduh Score" attribution (BRANDING-SPEC 4.5, task BR-D2). It is shown on every branded audience
// surface, so the platform is credited in every room it is used in.
//
// One function builds it, and every surface (the projector band, the splash, the phone footer) calls that function,
// so there is exactly one place that decides whether it appears and what it looks like. An organiser's branding is
// data (a name, a logo, one accent colour); it has no way to reach this element, to hide it, move it or restyle it:
// brandSlot.css gives it a minimum size and a readable colour, and brand colours only ever replace three accent
// properties, never the text colour it uses.
//
// `shouldShowPoweredBy()` is the single decision point. It returns true, always. A later arrangement that removes
// the credit for one organisation (done only on request, nothing is built for it) would change this one function,
// behind an admin-only flag, and nothing else. There is deliberately no argument, column or setting for it today.
import { el, brandLockup } from './dom.js';

// The credit's words as one string, for everything that shows them as plain text: the splash's ordinary pill
// ("Powered by Seduh Score" and "Live — Powered by Seduh Score") and the tests. The element below builds the same
// words in two pieces only so the lockup can stand where the product name is; a test pins the two to each other.
export const POWERED_BY_TEXT = 'Powered by Seduh Score';

/** Whether a branded surface shows the Seduh Score credit. Always true; see the comment at the top of this file. */
export function shouldShowPoweredBy() {
  return true;
}

/**
 * The credit's words as plain text, or '' when `shouldShowPoweredBy()` says no. For a surface that spells the credit
 * inside its own wording (the splash's ordinary pill), so that surface obeys the same single decision.
 */
export function poweredByText() {
  return shouldShowPoweredBy() ? POWERED_BY_TEXT : '';
}

/**
 * The credit: the words "Powered by" and the Seduh Score lockup. Static text, not a live region (it never changes,
 * so it must not be announced again). Returns null only if `shouldShowPoweredBy()` ever says no.
 * `extraClass` is a layout hook for the surface that places it (never a way to restyle the credit itself).
 */
export function renderPoweredBy(extraClass = '') {
  if (!shouldShowPoweredBy()) return null;
  return el('span', { className: `powered-by${extraClass ? ` ${extraClass}` : ''}` }, [
    document.createTextNode('Powered by '),
    brandLockup({ name: 'Seduh Score' }),
  ]);
}
