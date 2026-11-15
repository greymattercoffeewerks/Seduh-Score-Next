// Seduh ID person page, placeholder (Layer 2 routing spike). Served for every /id/<handle>/ path by the edge Worker
// (worker/index.js). It makes NO data call and shows nothing derived from the path: a real handle and an unknown one
// must look the same until the real page exists, so a stranger learns nothing about which handles are taken.
import { el } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';

export function mountProfilePlaceholder(root) {
  const titleId = 'profile-title';
  root.replaceChildren(
    // The header and footer sit beside <main>, not inside it, so they are the page's banner and contentinfo landmarks.
    el('div', { className: 'profile-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({}),
      el('main', {}, [
        el(
          'section',
          { className: 'profile-hero page-hero', attrs: { 'aria-labelledby': titleId } },
          [
            el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
            el('p', { className: 'page-hero-kicker', text: 'Seduh ID' }),
            el('h1', { id: titleId, text: 'Seduh ID profile' }),
            el('p', { className: 'page-hero-intro', text: 'Coming soon.' }),
          ],
        ),
      ]),
      buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
    ]),
  );
}
