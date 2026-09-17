// Shared public-site footer. This keeps standalone public pages tied to the
// landing page's version trail and avoids each surface inventing a new footer.
import { el, svgEl } from '../core/dom.js';
import { APP_VERSION } from '../core/version.js';

// Inline SVG rather than the 🇧🇳 regional-indicator emoji — confirmed live
// that Chrome on Windows has no color-flag-emoji font and falls back to
// rendering the literal letters "BN", which reads as a typo instead of a
// flag. An SVG renders identically on every platform, same reasoning as
// dom.js's own brandMark(). Simplified (no crest) at this size — the yellow
// field + white/black diagonal bands read as Brunei's flag without needing
// the full coat of arms at ~20px wide.
function bruneiFlag() {
  const svg = svgEl('svg', {
    viewBox: '0 0 60 40',
    class: 'public-footer-flag-icon',
    role: 'img',
    'aria-label': 'Brunei',
  });
  svg.append(
    svgEl('rect', { x: '0', y: '0', width: '60', height: '40', fill: '#FCD116' }),
    svgEl('polygon', { points: '0,0 60,26 60,34 0,8', fill: '#FFFFFF' }),
    svgEl('polygon', { points: '0,8 60,34 60,40 0,14', fill: '#000000' }),
  );
  return svg;
}

export function buildPublicFooter({ companionHref, companionText }) {
  return el('div', { className: 'public-footer-wrap' }, [
    el('footer', { className: 'public-footer' }, [
      el('span', { className: 'public-footer-credit' }, [
        document.createTextNode('Built by Grey Matter Coffee Werks '),
        bruneiFlag(),
      ]),
      el('div', { className: 'public-footer-links' }, [
        el('a', {
          className: 'public-footer-link',
          text: companionText,
          attrs: { href: companionHref },
        }),
        el('a', {
          className: 'public-footer-version',
          text: `v${APP_VERSION}`,
          attrs: { href: '/bts/' },
        }),
      ]),
    ]),
  ]);
}
