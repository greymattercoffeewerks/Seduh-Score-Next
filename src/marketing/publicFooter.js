// Shared public-site footer. This keeps standalone public pages tied to the
// landing page's version trail and avoids each surface inventing a new footer.
import { el } from '../core/dom.js';
import { APP_VERSION } from '../core/version.js';

export function buildPublicFooter({ companionHref, companionText }) {
  return el('div', { className: 'public-footer-wrap' }, [
    el('footer', { className: 'public-footer' }, [
      el('span', { text: 'Built by Firdaus Omar · Grey Matter Coffee Werks, Brunei' }),
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
