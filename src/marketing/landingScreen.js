import { brandMark, el } from '../core/dom.js';
import { APP_VERSION } from '../core/version.js';

const a = (className, text, href = '#') => el('a', { className, text, attrs: { href } });
const button = (text, primary = false) =>
  a(`kinetic-action${primary ? ' kinetic-action-primary' : ''}`, text);

function scoreCard() {
  return el(
    'section',
    { className: 'kinetic-live', attrs: { 'aria-label': 'Cup Taster projector view' } },
    [
      el('div', { className: 'kinetic-dots', attrs: { 'aria-hidden': 'true' } }),
      el('div', { className: 'kinetic-meta' }, [
        el('span', { text: 'Grey Matter Coffee Werks' }),
        el('span', { text: 'Brunei / 2026' }),
      ]),
      el('h2', { className: 'kinetic-live-title' }, [
        document.createTextNode('The result'),
        el('br'),
        el('em', { text: "doesn't hide." }),
      ]),
      el('article', { className: 'kinetic-score-card' }, [
        el('div', { className: 'kinetic-score-meta' }, [
          el('span', { text: 'Grey Matter Cup Taster' }),
          el('span', { text: 'Live' }),
        ]),
        el('div', { className: 'kinetic-players' }, [
          el('div', { className: 'kinetic-player' }, [
            el('span', { text: 'Audrey' }),
            el('b', { text: '02' }),
          ]),
          el('strong', { className: 'kinetic-vs', text: 'VS' }),
          el('div', { className: 'kinetic-player' }, [
            el('span', { text: 'Jun' }),
            el('b', { text: '01' }),
          ]),
        ]),
      ]),
      el('p', { className: 'kinetic-live-status' }, [
        el('i', { attrs: { 'aria-hidden': 'true' } }),
        document.createTextNode('Judging right now'),
      ]),
    ],
  );
}

function hero() {
  return el('section', { className: 'kinetic-hero' }, [
    el('div', { className: 'kinetic-copy' }, [
      el('p', { className: 'kinetic-kicker', text: 'Competitions, kept alive' }),
      el('h1', { className: 'kinetic-display' }, [
        document.createTextNode('Let the'),
        el('br'),
        document.createTextNode('whole room'),
        el('br'),
        el('span', { text: 'see it.' }),
      ]),
      el('p', {
        className: 'kinetic-sub',
        text: 'Create a Cup Taster, set up its roster and stages, run the heats, then put the same live event on a splash screen, projector, and phone.',
      }),
      el('div', { className: 'kinetic-actions' }, [
        button('Start free - no account', true),
        button('Take the tour'),
      ]),
      el('p', { className: 'kinetic-note' }, [
        el('b', { text: '01' }),
        document.createTextNode(' tablet / 01 projector'),
      ]),
      el('div', { className: 'kinetic-orbit', attrs: { 'aria-hidden': 'true' } }),
    ]),
    scoreCard(),
  ]);
}

function ticker() {
  const words = [
    'Roster',
    'Heats',
    'Live projector',
    'Standings',
    'Roster',
    'Heats',
    'Live projector',
    'Standings',
  ];
  return el(
    'div',
    { className: 'kinetic-ticker', attrs: { 'aria-label': 'Product capabilities' } },
    [
      el(
        'div',
        { className: 'kinetic-track' },
        words.map((word) => el('span', { text: `${word} /` })),
      ),
    ],
  );
}

function formatSection() {
  return el('section', { className: 'kinetic-format' }, [
    el('div', { className: 'kinetic-format-copy' }, [
      el('span', { className: 'kinetic-badge', text: 'Format 01 / available now' }),
      el('h2', { text: 'Find the odd cup.' }),
      el('p', {
        text: 'Cup Taster is live now. Create the event, add the roster, build its stages, run each heat, and let the room follow the same outcome on every display.',
      }),
      el('div', { className: 'kinetic-chips' }, [
        el('span', { text: 'Setup' }),
        el('span', { text: 'Roster' }),
        el('span', { text: 'Heats' }),
        el('span', { text: 'Standings' }),
      ]),
    ]),
    el('div', { className: 'kinetic-stage' }, [
      el('span', {
        className: 'kinetic-stage-number',
        text: '03',
        attrs: { 'aria-hidden': 'true' },
      }),
      el('div', { className: 'kinetic-mini-score' }, [
        el('p', { text: 'Same event: splash / projector / phone' }),
        el('b', { text: 'Audrey 02  /  Jun 01' }),
        el('span', { text: 'Judging live' }),
      ]),
    ]),
  ]);
}

function fact(value, copy, accent = false) {
  return el('article', { className: `kinetic-fact${accent ? ' kinetic-fact-accent' : ''}` }, [
    el('b', { text: value }),
    el('p', { text: copy }),
  ]);
}
function pricing(label, price, copy) {
  return el('article', { className: 'kinetic-tier' }, [
    el('span', { text: label }),
    el('b', { text: price }),
    el('p', { text: copy }),
  ]);
}

export function mountLandingScreen(root) {
  const mark = brandMark();
  mark.classList.add('kinetic-brand-mark');
  mark.setAttribute('aria-hidden', 'true');
  root.replaceChildren(
    el('div', { className: 'kinetic-page' }, [
      el('div', { className: 'kinetic-wrap' }, [
        el('nav', { className: 'kinetic-nav', attrs: { 'aria-label': 'Primary' } }, [
          el('div', { className: 'kinetic-brand' }, [mark, el('span', { text: 'Seduh Score' })]),
          el('div', { className: 'kinetic-nav-links' }, [
            a('kinetic-nav-link', 'Formats'),
            a('kinetic-nav-link', 'Event archive'),
            a('kinetic-nav-link', 'Free Timer', '/tools/timer/'),
            button('Run an event', true),
          ]),
        ]),
        hero(),
        ticker(),
        formatSection(),
        el('section', { className: 'kinetic-proof' }, [
          fact('0', 'installs. Pure web, open it on the day.'),
          fact('1', 'event flow: setup, roster, stages, then heats.'),
          fact('3', 'live surfaces: splash screen, projector, and phone.'),
          fact('1', 'format live today: Cup Taster. More are coming.', true),
        ]),
        el('section', { className: 'kinetic-pricing' }, [
          el('div', { className: 'kinetic-pricing-intro' }, [
            el('h2', { text: 'No secret pricing.' }),
            el('p', {
              text: 'Start free, pay once for an event, or keep the whole platform for the year.',
            }),
          ]),
          el('div', { className: 'kinetic-tiers' }, [
            pricing('Community', 'Free', 'For a small event. No account needed.'),
            pricing('Per event', 'BND $18', 'Branding and PDF reports, one time.'),
            pricing('Full platform', 'BND $100', 'All formats and persistent history, yearly.'),
          ]),
        ]),
        el('footer', { className: 'kinetic-footer' }, [
          el('span', { text: 'Built by Grey Matter Coffee Werks, Brunei' }),
          el('span', { text: `v${APP_VERSION} / One competition at a time` }),
        ]),
      ]),
    ]),
  );
}
