// Community is a small public hub, not a format or a router destination. It
// deliberately links out to self-contained tools rather than importing either
// tool's logic or styling; future community gifts can be added as another card.
import { el, svgEl } from '../core/dom.js';
import { COMMUNITY_TOOLS } from './communityTools.js';
import { buildPublicFooter } from '../marketing/publicFooter.js';
import { buildPublicHeader } from '../marketing/publicHeader.js';

function icon(paths, label) {
  const svg = svgEl('svg', {
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.4',
    'stroke-linecap': 'square',
    'stroke-linejoin': 'miter',
    role: 'img',
    'aria-label': label,
  });
  paths.forEach((attrs) => svg.append(svgEl(attrs.tag, attrs)));
  return svg;
}

function timerInstrument() {
  return icon(
    [
      { tag: 'circle', cx: '24', cy: '26', r: '14' },
      { tag: 'path', d: 'M24 5v7M19 5h10M24 26l8-5M24 26v8' },
      { tag: 'path', d: 'M11 15l-4-4M37 15l4-4' },
    ],
    'Stopwatch',
  );
}

function beanInstrument() {
  return icon(
    [
      { tag: 'path', d: 'M14 10h20l3 30H11z' },
      { tag: 'path', d: 'M17 10V6h14v4M15 18h18' },
      { tag: 'ellipse', cx: '19', cy: '26', rx: '3', ry: '4' },
      { tag: 'ellipse', cx: '27', cy: '31', rx: '3', ry: '4' },
      { tag: 'ellipse', cx: '30', cy: '23', rx: '3', ry: '4' },
    ],
    'Jar of coffee beans',
  );
}

function widgetInstrument() {
  return icon(
    [
      { tag: 'rect', x: '13', y: '5', width: '22', height: '38', rx: '3' },
      { tag: 'rect', x: '17', y: '13', width: '14', height: '11', rx: '1' },
      { tag: 'path', d: 'M20 17h8M20 20h5' },
      { tag: 'circle', cx: '24', cy: '33', r: '2' },
    ],
    'Phone showing the widget on its home screen',
  );
}

function brewerInstrument() {
  return icon(
    [
      { tag: 'path', d: 'M10 8h28M14 8v6h20V8' },
      { tag: 'path', d: 'M18 14v6M30 14v6M24 14v6' },
      { tag: 'path', d: 'M13 24h22l-2 16H15z' },
      { tag: 'path', d: 'M35 28h4a3 3 0 0 1 0 8h-4' },
    ],
    'Batch brewer over a carafe',
  );
}

function selectorInstrument() {
  return icon(
    [
      { tag: 'rect', x: '7', y: '9', width: '34', height: '30' },
      { tag: 'path', d: 'M10 18h28M10 29h28M16 9v30M24 9v30M32 9v30' },
    ],
    'Split-flap display',
  );
}

const INSTRUMENTS = {
  timer: timerInstrument,
  'guess-the-bean': beanInstrument,
  'guess-the-bean-widget': widgetInstrument,
  'brew-planner': brewerInstrument,
  'random-selector': selectorInstrument,
};

function arrow(text) {
  return el('span', { className: 'community-card-arrow', text: text ?? 'Open tool →' });
}

function toolCard({ number, title, eyebrow, body, href, meta, instrument, arrowText, attrs }) {
  return el('a', { className: 'community-tool-card panel', attrs: { href, ...attrs } }, [
    el('div', { className: 'community-card-top' }, [
      el('span', { className: 'community-tool-number', text: number }),
      el('span', { className: 'community-tool-status tag', text: 'Available now' }),
    ]),
    el('div', { className: 'community-instrument icon-frame', attrs: { 'aria-hidden': 'true' } }, [
      instrument,
    ]),
    el('div', { className: 'community-card-copy' }, [
      el('p', { className: 'community-card-eyebrow', text: eyebrow }),
      el('h2', { text: title }),
      el('p', { className: 'community-card-body', text: body }),
    ]),
    el('div', { className: 'community-card-bottom' }, [
      el('span', { className: 'community-tool-meta', text: meta }),
      arrow(arrowText),
    ]),
  ]);
}

function buildHero() {
  return el(
    'section',
    { className: 'community-hero page-hero', attrs: { 'aria-labelledby': 'community-title' } },
    [
      el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
      el('div', {
        className: 'community-hero-orbit community-hero-orbit-one',
        attrs: { 'aria-hidden': 'true' },
      }),
      el('div', {
        className: 'community-hero-orbit community-hero-orbit-two',
        attrs: { 'aria-hidden': 'true' },
      }),
      el('p', { className: 'page-hero-kicker', text: 'Seduh Score / Community shelf' }),
      el('h1', { id: 'community-title' }, [
        document.createTextNode('Useful on the '),
        el('span', { text: 'day of.' }),
      ]),
      el('p', {
        className: 'page-hero-intro',
        text: 'A growing collection of practical tools for coffee people running things, making things, and bringing a room together.',
      }),
      el('div', { className: 'community-hero-note' }, [
        el('span', { className: 'community-note-mark icon-frame', text: '02' }),
        el('span', { text: 'Free tools, built in Brunei.' }),
      ]),
    ],
  );
}

function buildShelf() {
  return el(
    'section',
    { className: 'community-shelf', attrs: { 'aria-labelledby': 'tools-title' } },
    [
      el('div', { className: 'community-section-heading' }, [
        el('p', { className: 'community-kicker', text: 'On the shelf now' }),
        el('h2', { id: 'tools-title', text: 'Pick up a tool.' }),
        el('p', {
          text: 'No clutter, no feature maze. Just a good thing to open when you need it.',
        }),
      ]),
      el(
        'div',
        { className: 'community-tool-grid' },
        COMMUNITY_TOOLS.map((tool) =>
          toolCard({
            ...tool,
            instrument: INSTRUMENTS[tool.id]?.() ?? document.createElement('span'),
            attrs: tool.external ? { rel: 'noopener' } : undefined,
          }),
        ),
      ),
    ],
  );
}

function buildFuture() {
  return el(
    'section',
    { className: 'community-future', attrs: { 'aria-labelledby': 'future-title' } },
    [
      el('div', { className: 'community-future-index', text: '03' }),
      el('div', { className: 'community-future-copy' }, [
        el('p', { className: 'community-kicker', text: 'More to share' }),
        el('h2', { id: 'future-title', text: 'A home for the useful extras.' }),
        el('p', {
          text: 'As Seduh Score grows, this shelf will make room for downloadable guides, templates and more small tools worth passing around.',
        }),
      ]),
      el(
        'div',
        { className: 'community-future-list', attrs: { 'aria-label': 'Planned additions' } },
        [
          el('span', { text: 'GUIDES' }),
          el('span', { text: 'TEMPLATES' }),
          el('span', { text: 'TOOLS' }),
        ],
      ),
    ],
  );
}

function mountCommunityHub(root) {
  root.replaceChildren(
    el('main', { className: 'community-hub', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({ active: 'community' }),
      buildHero(),
      buildShelf(),
      buildFuture(),
      buildPublicFooter({ companionHref: '/tour/', companionText: 'Take the tour →' }),
    ]),
  );
}

mountCommunityHub(document.querySelector('#app'));
