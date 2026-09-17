// Public format tour. It states the current truth: Cup Taster is live,
// the remaining competition formats are planned, and Community tools are
// separate link-out utilities.
import { el, svgEl } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';

function icon(children, label) {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'square',
    'stroke-linejoin': 'miter',
    role: 'img',
    'aria-label': label,
  });
  svg.append(...children);
  return svg;
}

const ICONS = {
  cup: () =>
    icon(
      [
        svgEl('path', { d: 'M5 7h12v7a6 6 0 0 1-12 0z' }),
        svgEl('path', { d: 'M17 9h1a3 3 0 0 1 0 6h-1M8 21h6M11 20v-3' }),
      ],
      'Coffee cup',
    ),
  bracket: () =>
    icon(
      [
        svgEl('path', { d: 'M4 4h5v4H4M4 16h5v4H4M15 10h5v4h-5' }),
        svgEl('path', { d: 'M9 6h3v6h3M9 18h3v-6' }),
      ],
      'Competition bracket',
    ),
  league: () =>
    icon([svgEl('path', { d: 'M4 5h16M4 10h16M4 15h16M4 20h16M9 5v15' })], 'League table'),
  team: () =>
    icon(
      [
        svgEl('circle', { cx: '9', cy: '8', r: '3' }),
        svgEl('circle', { cx: '17', cy: '9', r: '2.5' }),
        svgEl('path', { d: 'M3 20v-2a6 6 0 0 1 12 0v2M14 20v-2a5 5 0 0 1 7-4.58' }),
      ],
      'Team members',
    ),
  timer: () =>
    icon(
      [
        svgEl('circle', { cx: '12', cy: '14', r: '7' }),
        svgEl('path', { d: 'M12 3v4M9 3h6M12 14l3-2M5 7 3 5M19 7l2-2' }),
      ],
      'Competition timer',
    ),
  beans: () =>
    icon(
      [
        svgEl('path', { d: 'M7 5h10l2 15H5zM8 5V3h8v2M7 10h10' }),
        svgEl('ellipse', { cx: '10', cy: '14', rx: '1.7', ry: '2.2' }),
        svgEl('ellipse', { cx: '15', cy: '17', rx: '1.7', ry: '2.2' }),
      ],
      'Jar of coffee beans',
    ),
};

function arrow() {
  return el('span', { className: 'tour-arrow', text: '→', attrs: { 'aria-hidden': 'true' } });
}

function buildHero() {
  return el('section', { className: 'tour-hero', attrs: { 'aria-labelledby': 'tour-title' } }, [
    el('div', { className: 'tour-hero-grid', attrs: { 'aria-hidden': 'true' } }),
    el('p', { className: 'tour-kicker', text: 'Seduh Score / The tour' }),
    el('h1', { id: 'tour-title' }, [
      document.createTextNode('A better way to '),
      el('span', { text: 'run the floor.' }),
    ]),
    el('p', {
      className: 'tour-hero-intro',
      text: 'Competition formats for the serious work, plus small Community tools for everything around it.',
    }),
    el('div', { className: 'tour-hero-status' }, [
      el('span', { className: 'tour-status-mark', text: '01' }),
      el('span', { text: 'Cup Taster is live now. More formats are on the way.' }),
    ]),
  ]);
}

function setBoard() {
  return el('div', { className: 'tour-set-board', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { className: 'tour-board-label', text: 'Blind set / set 04' }),
    el(
      'div',
      { className: 'tour-set-cups' },
      ['A', 'B', 'C'].map((letter) => el('span', { text: letter })),
    ),
    el('div', { className: 'tour-board-result' }, [
      el('span', { text: 'Odd cup' }),
      el('strong', { text: 'B' }),
      el('span', { text: '12.4 sec' }),
    ]),
  ]);
}

function buildCupTaster() {
  return el(
    'section',
    { className: 'tour-cup', attrs: { id: 'cup-taster', 'aria-labelledby': 'cup-title' } },
    [
      el('div', { className: 'tour-section-label' }, [
        el('span', { text: '01' }),
        el('span', { text: 'Live format' }),
      ]),
      el('div', { className: 'tour-cup-grid' }, [
        el('div', { className: 'tour-cup-copy' }, [
          el('div', { className: 'tour-icon', attrs: { 'aria-hidden': 'true' } }, [ICONS.cup()]),
          el('p', { className: 'tour-kicker', text: 'Blind set sensory' }),
          el('h2', { id: 'cup-title', text: 'Cup Taster.' }),
          el('p', {
            className: 'tour-copy',
            text: 'Three cups. Two the same. Find the odd one before the clock runs out. Seduh Score keeps the heat moving, scores accuracy, and handles time as the tiebreaker.',
          }),
          el('p', {
            className: 'tour-note',
            text: 'Live in the organiser console. Sign in to set up and run an event.',
          }),
          el('a', { className: 'tour-primary-link cut-sm', attrs: { href: '/app/#/events' } }, [
            el('span', { text: 'Open Cup Taster' }),
            arrow(),
          ]),
        ]),
        el('div', { className: 'tour-cup-media' }, [
          el('img', {
            attrs: {
              src: '/marketing/hero-cupping-bowls.jpg',
              alt: 'Three cups of coffee on a wooden table.',
              loading: 'eager',
            },
          }),
          setBoard(),
        ]),
      ]),
    ],
  );
}

function plannedFormat({ number, title, label, description, icon: iconName }) {
  return el('article', { className: 'tour-planned-card' }, [
    el('div', { className: 'tour-planned-top' }, [
      el('span', { text: number }),
      el('span', { className: 'tour-planned-status', text: 'Coming soon' }),
    ]),
    el('div', { className: 'tour-icon tour-icon-muted', attrs: { 'aria-hidden': 'true' } }, [
      ICONS[iconName](),
    ]),
    el('p', { className: 'tour-kicker', text: label }),
    el('h3', { text: title }),
    el('p', { text: description }),
  ]);
}

function buildPlannedFormats() {
  return el(
    'section',
    { className: 'tour-planned', attrs: { 'aria-labelledby': 'planned-title' } },
    [
      el('div', { className: 'tour-planned-intro' }, [
        el('div', {}, [
          el('div', { className: 'tour-section-label' }, [
            el('span', { text: '02' }),
            el('span', { text: 'The format map' }),
          ]),
          el('h2', { id: 'planned-title', text: 'The next rounds.' }),
        ]),
        el('p', {
          text: 'These formats are part of the direction, not yet live in Seduh Score Next. Their legacy ideas are here as a clear map of what is being carried forward.',
        }),
      ]),
      el('div', { className: 'tour-planned-grid' }, [
        plannedFormat({
          number: '02',
          title: 'Throwdown',
          label: '1v1 knockout',
          description:
            'A focused head-to-head bracket built for decisive rounds, randomised seeding and a room following every result.',
          icon: 'bracket',
        }),
        plannedFormat({
          number: '03',
          title: 'Liga Seduh',
          label: 'Round robin league',
          description:
            'A league format where a small field brews across rounds and the standings evolve as each result lands.',
          icon: 'league',
        }),
        plannedFormat({
          number: '04',
          title: 'BTC',
          label: 'Barista Team Competition',
          description:
            'A team head-to-head format with cup-by-cup scoring and the scale for a season, not just one afternoon.',
          icon: 'team',
        }),
      ]),
    ],
  );
}

function communityCard({ title, label, description, href, icon: iconName }) {
  return el('a', { className: 'tour-community-card', attrs: { href } }, [
    el('div', { className: 'tour-icon', attrs: { 'aria-hidden': 'true' } }, [ICONS[iconName]()]),
    el('p', { className: 'tour-kicker', text: label }),
    el('h3', { text: title }),
    el('p', { text: description }),
    el('span', { className: 'tour-text-link', text: 'Open tool →' }),
  ]);
}

function buildCommunity() {
  return el(
    'section',
    {
      className: 'tour-community',
      attrs: { id: 'community', 'aria-labelledby': 'community-title' },
    },
    [
      el('div', { className: 'tour-section-label' }, [
        el('span', { text: '03' }),
        el('span', { text: 'Community tools' }),
      ]),
      el('div', { className: 'tour-community-heading' }, [
        el('div', {}, [
          el('p', { className: 'tour-kicker', text: 'For the rest of the day' }),
          el('h2', { id: 'community-title', text: 'Useful beyond the heat.' }),
        ]),
        el('p', {
          text: 'The Community shelf is where the simple, useful extras live: the things you reach for while setting up a room, running a booth, or bringing people in.',
        }),
      ]),
      el('div', { className: 'tour-community-grid' }, [
        communityCard({
          title: 'Competition Timer',
          label: 'Keep the room moving',
          description:
            'A clear, full-screen timer for heats, routines, brews and the moments everyone needs to see at once.',
          href: '/tools/timer/',
          icon: 'timer',
        }),
        communityCard({
          title: 'Guess the Bean',
          label: 'A little friendly suspense',
          description:
            'Set the jar, share the link, and let the room guess with a live display built in.',
          href: '/guess-the-bean/',
          icon: 'beans',
        }),
      ]),
      el('a', { className: 'tour-community-link', attrs: { href: '/community/' } }, [
        el('span', { text: 'Explore all Community tools' }),
        arrow(),
      ]),
    ],
  );
}

export function mountTourScreen(root) {
  root.replaceChildren(
    el('main', { className: 'tour-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({ active: 'tour' }),
      buildHero(),
      buildCupTaster(),
      buildPlannedFormats(),
      buildCommunity(),
      buildPublicFooter({
        companionHref: '/community/',
        companionText: 'Community Tools →',
      }),
    ]),
  );
}
