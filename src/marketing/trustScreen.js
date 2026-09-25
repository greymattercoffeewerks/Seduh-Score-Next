// The public trust pages: About, Contact, Privacy, Terms, Neutrality. Static,
// text-only, no auth or Supabase — same posture as the Tour. The wording lives
// in trustContent.js; this module only renders it.
import { el } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { TRUST_PAGES } from './trustContent.js';

// Only same-site paths and mailto: links are rendered as links. Content is
// authored in this repo, but a link that could be `javascript:` is not worth
// having a code path for.
function isSafeHref(href) {
  return (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('mailto:');
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

// Turns the small inline markup used in trustContent.js (**bold** and
// [text](href)) into DOM nodes with createElement/textContent only — never
// innerHTML. Bold may wrap a link; nothing else nests.
export function renderInline(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)));
    const [, boldText, linkText, href] = match;
    if (boldText != null) {
      nodes.push(el('strong', {}, renderInline(boldText)));
    } else if (isSafeHref(href)) {
      nodes.push(el('a', { className: 'trust-link', text: linkText, attrs: { href } }));
    } else {
      nodes.push(document.createTextNode(linkText));
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

function renderBlock(block) {
  if (block.type === 'h2') return el('h2', { className: 'trust-h2', text: block.text });
  if (block.type === 'p') return el('p', { className: 'trust-p' }, renderInline(block.text));
  const tag = block.type === 'ol' ? 'ol' : 'ul';
  return el(
    tag,
    { className: 'trust-list' },
    block.items.map((item) => el('li', {}, renderInline(item))),
  );
}

export function mountTrustScreen(root, slug) {
  const page = TRUST_PAGES.find((candidate) => candidate.slug === slug);
  if (!page) throw new Error(`mountTrustScreen: unknown trust page "${slug}"`);
  document.title = page.title;

  const header = [
    el('h1', { className: 'trust-title', text: page.name }),
    el('p', { className: 'trust-lede', text: page.lede }),
  ];
  if (page.updated) {
    header.push(el('p', { className: 'trust-updated', text: `Last updated ${page.updated}` }));
  }

  root.replaceChildren(
    // The page wrapper is a div, not <main>: the header and footer must stay outside
    // <main> to keep their banner/contentinfo landmark roles.
    el('div', { className: 'trust-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({ active: `trust-${slug}` }),
      el('main', { className: 'trust-article' }, [
        el('header', { className: 'trust-header' }, header),
        ...page.blocks.map(renderBlock),
      ]),
      buildPublicFooter({
        companionHref: '/',
        companionText: 'Home →',
        currentSlug: slug,
      }),
    ]),
  );
}
