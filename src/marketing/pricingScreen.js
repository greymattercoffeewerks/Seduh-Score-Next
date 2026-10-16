// Public pricing page (/pricing/). Static: no router, auth or Supabase. The landing
// page's pricing section links here ("Learn more") for the full tier-by-feature
// comparison. All copy and the matrix live in pricingContent.js; this file only
// builds the DOM (textContent only, like every screen here).
import { el } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { FAQ, FEATURE_GROUPS, STATE_WORDS, TIERS } from './pricingContent.js';

const GLYPHS = { yes: '✓', no: '—', soon: '○' };

function buildHero() {
  return el(
    'section',
    { className: 'pricing-hero', attrs: { 'aria-labelledby': 'pricing-title' } },
    [
      el('p', { className: 'pricing-kicker', text: 'Seduh Score / Pricing' }),
      el('h1', { id: 'pricing-title' }, [
        document.createTextNode('Pricing, stated '),
        el('span', { text: 'plainly.' }),
      ]),
      el('p', {
        className: 'pricing-hero-intro',
        text: 'Three tiers. Start free, pay once for a single competition, or take the year. Every price is in Brunei dollars.',
      }),
    ],
  );
}

function tierCard(tier) {
  const priceLine = [document.createTextNode(tier.price)];
  if (tier.suffix) {
    priceLine.push(
      document.createTextNode(' '),
      el('span', { className: 'pricing-price-suffix', text: tier.suffix }),
    );
  }
  const headingId = `pricing-tier-${tier.id}`;
  return el(
    'article',
    {
      className: `pricing-card${tier.featured ? ' pricing-card-featured' : ''}`,
      attrs: { 'aria-labelledby': headingId },
    },
    [
      el('h3', { className: 'pricing-tier-name', id: headingId, text: tier.name }),
      el('p', { className: 'pricing-tier-price tabular-nums' }, priceLine),
      el('p', { className: 'pricing-tier-summary', text: tier.summary }),
      el('p', { className: 'pricing-tier-note', text: tier.note }),
      el('a', { className: 'pricing-cta cut-sm', attrs: { href: tier.cta.href } }, [
        document.createTextNode(tier.cta.text),
        el('span', { className: 'sr-only', text: ` — ${tier.name}` }),
      ]),
    ],
  );
}

function buildTiers() {
  return el(
    'section',
    { className: 'pricing-tiers', attrs: { 'aria-labelledby': 'pricing-tiers-title' } },
    [
      el('h2', { className: 'sr-only', id: 'pricing-tiers-title', text: 'The three tiers' }),
      el('div', { className: 'pricing-card-grid' }, TIERS.map(tierCard)),
      el('p', {
        className: 'pricing-footnote',
        text: 'All prices in Brunei dollars · billed through Grey Matter Coffee Werks.',
      }),
    ],
  );
}

function stateCell(cell, tier) {
  const td = el('td', {
    className: `pricing-cell pricing-cell-${cell.state}`,
    attrs: { role: 'cell', 'data-label': tier.name },
  });
  if (cell.state === 'text') {
    td.append(el('span', { className: 'pricing-cell-text', text: cell.text }));
    return td;
  }
  td.append(
    el('span', {
      className: 'pricing-glyph',
      text: GLYPHS[cell.state],
      attrs: { 'aria-hidden': 'true' },
    }),
    el('span', { className: 'pricing-cell-word', text: STATE_WORDS[cell.state] }),
  );
  return td;
}

function featureRow([name, description, cells]) {
  const nameBlock = [el('span', { className: 'pricing-feature-name', text: name })];
  if (description) {
    nameBlock.push(el('span', { className: 'pricing-feature-desc', text: description }));
  }
  return el('tr', { className: 'pricing-row', attrs: { role: 'row' } }, [
    el(
      'th',
      { className: 'pricing-feature', attrs: { scope: 'row', role: 'rowheader' } },
      nameBlock,
    ),
    ...cells.map((cell, i) => stateCell(cell, TIERS[i])),
  ]);
}

function groupBody(group) {
  return el('tbody', { className: 'pricing-group', attrs: { role: 'rowgroup' } }, [
    el('tr', { className: 'pricing-group-row', attrs: { role: 'row' } }, [
      el('th', {
        className: 'pricing-group-title',
        text: group.title,
        attrs: { colspan: String(TIERS.length + 1), scope: 'rowgroup', role: 'rowheader' },
      }),
    ]),
    ...group.rows.map(featureRow),
  ]);
}

function buildMatrix() {
  const head = el('thead', { attrs: { role: 'rowgroup' } }, [
    el('tr', { className: 'pricing-head-row', attrs: { role: 'row' } }, [
      el('th', {
        className: 'pricing-head-feature',
        attrs: { scope: 'col', role: 'columnheader' },
        text: 'Feature',
      }),
      ...TIERS.map((tier) =>
        el('th', {
          className: `pricing-head-tier${tier.featured ? ' pricing-head-tier-featured' : ''}`,
          attrs: { scope: 'col', role: 'columnheader' },
          text: tier.name,
        }),
      ),
    ]),
  ]);
  const table = el(
    'table',
    { className: 'pricing-table', attrs: { role: 'table', 'aria-label': 'Features by tier' } },
    [head, ...FEATURE_GROUPS.map(groupBody)],
  );
  return el(
    'section',
    { className: 'pricing-compare', attrs: { 'aria-labelledby': 'pricing-compare-title' } },
    [
      el('p', { className: 'pricing-kicker', text: 'Every feature, every tier' }),
      el('h2', { id: 'pricing-compare-title', text: 'Compare the tiers.' }),
      el('p', {
        className: 'pricing-lede',
        text: 'This is how each tier is set out, and we are switching the limits on step by step. Included means it works in the product today. Planned means it is not built yet.',
      }),
      el('div', { className: 'pricing-table-wrap' }, [table]),
    ],
  );
}

function buildFaq() {
  return el(
    'section',
    { className: 'pricing-faq', attrs: { 'aria-labelledby': 'pricing-faq-title' } },
    [
      el('p', { className: 'pricing-kicker', text: 'Good to know' }),
      el('h2', { id: 'pricing-faq-title', text: 'Questions.' }),
      el(
        'div',
        { className: 'pricing-faq-list' },
        FAQ.map(({ question, answer }) =>
          el('div', { className: 'pricing-faq-item' }, [
            el('h3', { text: question }),
            el('p', { text: answer }),
          ]),
        ),
      ),
    ],
  );
}

function buildClosing() {
  return el(
    'section',
    { className: 'pricing-closing', attrs: { 'aria-labelledby': 'pricing-closing-title' } },
    [
      el('h2', { id: 'pricing-closing-title', text: 'Not sure which tier fits?' }),
      el('p', { text: 'Tell us about your event and we will point you at the right one.' }),
      el('a', {
        className: 'pricing-cta cut-sm',
        attrs: { href: '/contact/' },
        text: 'Get in touch',
      }),
    ],
  );
}

export function mountPricingScreen(root) {
  root.replaceChildren(
    // The header and footer sit beside <main>, not inside it, so they are the page's
    // banner and contentinfo landmarks.
    el('div', { className: 'pricing-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({ active: 'pricing' }),
      el('main', { className: 'pricing-main' }, [
        buildHero(),
        buildTiers(),
        buildMatrix(),
        buildFaq(),
        buildClosing(),
      ]),
      buildPublicFooter({
        companionHref: '/community/',
        companionText: 'Community Tools →',
      }),
    ]),
  );
}
