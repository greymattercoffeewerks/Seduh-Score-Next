// The one renderer for a community tool's card. The Community hub (a big card with a number, an icon and a status tag)
// and every tool's "More free community tools" strip (toolChrome.js, a compact card) both call it, so a tool's eyebrow,
// name, pitch and link are written once. The two variants keep their own class names (communityHub.css and
// toolChrome.css each style theirs); what they share is the content and its order: eyebrow, name, pitch, the link.
import { el } from '../core/dom.js';

const VARIANTS = {
  hub: {
    eyebrow: 'community-card-eyebrow',
    textTag: 'p',
    title: 'community-card-title',
    titleTag: 'h2',
    body: 'community-card-body',
    arrow: 'community-card-arrow',
  },
  strip: {
    eyebrow: 'ct-tool-eyebrow',
    textTag: 'span',
    title: 'ct-tool-title',
    titleTag: 'span',
    body: 'ct-tool-body',
    arrow: 'ct-tool-open',
  },
};

/**
 * @param {object} tool     an entry of COMMUNITY_TOOLS (communityTools.js)
 * @param {object} options
 * @param {'hub'|'strip'} options.variant
 * @param {Node} [options.instrument]  hub only: the card's icon
 */
export function communityToolCard(tool, { variant, instrument } = {}) {
  const cls = VARIANTS[variant];
  if (!cls) throw new Error(`communityToolCard: unknown variant "${variant}"`);
  const { number, title, eyebrow, body, href, meta, arrowText, external } = tool;
  const eyebrowEl = el(cls.textTag, { className: cls.eyebrow, text: eyebrow });
  const titleEl = el(cls.titleTag, { className: cls.title, text: title });
  const bodyEl = el(cls.textTag, { className: cls.body, text: body });
  const attrs = { href, ...(external ? { rel: 'noopener' } : {}) };

  if (variant === 'strip') {
    // The shape class sits in the same literal as the card's own class (tokenDrift.test.js reads it from here).
    return el('a', { className: 'ct-tool panel', attrs }, [
      eyebrowEl,
      titleEl,
      bodyEl,
      el('span', { className: cls.arrow, text: arrowText ?? `Open ${title} →` }),
    ]);
  }
  return el('a', { className: 'community-tool-card panel', attrs }, [
    el('div', { className: 'community-card-top' }, [
      el('span', { className: 'community-tool-number', text: number }),
      el('span', { className: 'community-tool-status tag', text: 'Available now' }),
    ]),
    el('div', { className: 'community-instrument icon-frame', attrs: { 'aria-hidden': 'true' } }, [
      instrument ?? document.createElement('span'),
    ]),
    el('div', { className: 'community-card-copy' }, [eyebrowEl, titleEl, bodyEl]),
    el('div', { className: 'community-card-bottom' }, [
      el('span', { className: 'community-tool-meta', text: meta }),
      el('span', { className: cls.arrow, text: arrowText ?? 'Open tool →' }),
    ]),
  ]);
}
