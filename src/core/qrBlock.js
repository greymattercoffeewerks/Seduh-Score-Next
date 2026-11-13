// A QR code with the address beside it as text, for a screen or a printed page. Format-agnostic: the caller passes
// the URL and a caption. The code is library-generated SVG made from the URL alone (never from anything a person typed),
// loaded on demand (core/audienceLinksCard.js's loader) so it is not in any page's first load, and hidden from assistive
// technology: the address is on the page as text, so nothing is only reachable by scanning. A code that cannot be made
// leaves the text, which is the real thing.
import { el } from './dom.js';
import { loadQrFactory, qrSvg } from './audienceLinksCard.js';

/**
 * @param {{ url: string, caption: string, label?: string }} spec `label` is the address as shown (default: the URL
 *   without its scheme).
 * @param {{ loadQr?: () => Promise<Function> }} [options] injectable for tests
 */
export function buildQrBlock({ url, caption, label }, { loadQr = loadQrFactory } = {}) {
  const host = el('div', { className: 'qr-block-code', attrs: { 'aria-hidden': 'true' } });
  const block = el('div', { className: 'qr-block' }, [
    host,
    el('p', { className: 'qr-block-caption', text: caption }),
    el('p', { className: 'qr-block-url', text: label ?? url.replace(/^https?:\/\//, '') }),
  ]);
  loadQr()
    .then((qrcode) => {
      const svg = qrSvg(qrcode, url);
      // Library-generated SVG made from the URL (the one deliberate innerHTML use, as in audienceLinksCard.js).
      if (svg) host.innerHTML = svg;
      else host.hidden = true;
    })
    .catch(() => {
      host.hidden = true;
    });
  return block;
}
