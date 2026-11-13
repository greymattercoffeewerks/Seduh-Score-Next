// Public format tour. It states the current truth: Cup Taster, BTC and Throwdown are live, the rest is on the way,
// and Community tools are separate link-out utilities.
//
// Refresh (2026-11-13, owner-approved draft v4): a format picker in the hero, a comparison table, a section per live
// format, a shared "Built for the room" strip, an "On the way" pipeline and all four Community tools. Everything
// format-shaped is read from ONE list (tourFormats.js), so a new format or mode is a list entry, not a page edit:
// `mountTourScreen(root, { formats })` takes a different list for the tests. Only MEDIA below names a format (and the illustration data beside it).
//
// Fabricated content stays hidden from assistive tech (src/marketing/CLAUDE.md): the BTC and Throwdown boards are
// illustrations with invented team and competitor names, labelled "Illustration" and `aria-hidden` on their outermost
// element. Cup Taster's photo is a genuine event photo (Girls Got Drip Vol. 0); its set board is presentational.
// BTC and Throwdown have no real event photography, so they get a board, never a photo.
//
// Static: no router, auth or Supabase, and nothing from src/formats/ or src/core/ beyond dom.js.
import { el, svgEl } from '../core/dom.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import {
  COMPARE_ROWS,
  FORMATS,
  STATUS_LABELS,
  countLine,
  countWord,
  liveFormats,
  onTheWay,
  pickerFormats,
  waysToPlay,
} from './tourFormats.js';

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
  brew: () =>
    icon([svgEl('path', { d: 'M6 3h12l-3 7H9zM9 10v8a3 3 0 0 0 6 0v-8M4 21h16' })], 'Brew'),
  draw: () =>
    icon(
      [
        svgEl('rect', { x: '3', y: '5', width: '8', height: '14' }),
        svgEl('rect', { x: '13', y: '5', width: '8', height: '14' }),
        svgEl('path', { d: 'M3 12h18' }),
      ],
      'Split-flap draw',
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

// A format with an icon name the table does not know still renders (a plain frame), never throws.
const iconFor = (name) => (ICONS[name] ?? ICONS.cup)();

function arrow() {
  return el('span', { className: 'tour-arrow', text: '→', attrs: { 'aria-hidden': 'true' } });
}

// The shared .tag, recoloured by status through --tag-edge/--tag-ink (tour.css); planned is the shared dashed tag.
function stateTag(status) {
  return el('span', {
    className: `tag tour-state tour-state-${status}${status === 'planned' ? ' tag-dashed' : ''}${
      status === 'live' ? ' tag-solid' : ''
    }`,
    text: STATUS_LABELS[status] ?? status,
  });
}

function sectionLabel(number, text) {
  return el('div', { className: 'tour-section-label' }, [
    el('span', { className: 'icon-frame', text: number, attrs: { 'aria-hidden': 'true' } }),
    el('span', { text }),
  ]);
}

const pad = (n) => String(n).padStart(2, '0');

// ---------- hero and picker ----------

function pickCard(format) {
  const live = format.status === 'live';
  return el(
    'a',
    {
      className: `tour-pick panel${live ? '' : ' tour-pick-future'}`,
      attrs: { href: live ? `#${format.id}` : '#next', 'data-format': format.id },
    },
    [
      el('span', { className: 'tour-pick-top' }, [
        stateTag(format.status),
        el('span', { className: 'tour-pick-kind', text: format.kind }),
      ]),
      el('b', { className: 'tour-pick-name', text: format.name }),
      el('small', { text: format.description }),
      format.modes.length
        ? el(
            'span',
            { className: 'tour-pick-modes' },
            format.modes.map((mode) =>
              el('span', {
                className: `tag tour-mode-tag${mode.status === 'testing' ? ' tour-state-testing' : ''}`,
                text:
                  mode.status === 'live'
                    ? mode.name
                    : `${mode.name} · ${STATUS_LABELS[mode.status]}`,
              }),
            ),
          )
        : null,
    ].filter(Boolean),
  );
}

function buildHero(formats) {
  const liveCount = liveFormats(formats).length;
  return el(
    'section',
    { className: 'tour-hero page-hero', attrs: { 'aria-labelledby': 'tour-title' } },
    [
      el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'page-hero-kicker', text: 'Seduh Score / The tour' }),
      el('h1', { id: 'tour-title' }, [
        document.createTextNode('A better way to '),
        el('span', { text: 'run the floor.' }),
      ]),
      el('p', {
        className: 'page-hero-intro',
        text: `${countWord(liveCount)} live competition formats in one organiser console, with live audience screens built in. Plus free Community tools for everything around the competition.`,
      }),
      el('div', { className: 'tour-picker-head' }, [
        el('span', { text: 'The formats' }),
        el('span', { className: 'tour-picker-count', text: countLine(formats) }),
      ]),
      el(
        'nav',
        { className: 'tour-picker', attrs: { 'aria-label': 'Formats' } },
        pickerFormats(formats).map(pickCard),
      ),
    ],
  );
}

// ---------- comparison table ----------

function buildCompare(formats) {
  const cols = liveFormats(formats).filter((f) => f.compare);
  if (!cols.length) return null;
  return el(
    'section',
    { className: 'tour-compare', attrs: { 'aria-labelledby': 'compare-title' } },
    [
      sectionLabel('?', 'Which format'),
      el('h2', { id: 'compare-title', text: 'Pick the format for your day.' }),
      el('p', {
        className: 'tour-lede',
        text: `All ${countWord(cols.length).toLowerCase()} run from the same console on a tablet or laptop. The difference is who competes and how a winner is decided.`,
      }),
      el(
        'div',
        {
          className: 'tour-table-scroll panel',
          attrs: { tabindex: '0', role: 'region', 'aria-labelledby': 'compare-title' },
        },
        [
          el('table', { className: 'tour-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { attrs: { scope: 'col' }, text: 'At a glance' }),
                ...cols.map((f) => el('th', { attrs: { scope: 'col' }, text: f.name })),
              ]),
            ]),
            el(
              'tbody',
              {},
              COMPARE_ROWS.map((row) =>
                el('tr', {}, [
                  el('th', { attrs: { scope: 'row' }, text: row.label }),
                  ...cols.map((f) => el('td', { text: f.compare[row.key] ?? '' })),
                ]),
              ),
            ),
          ]),
        ],
      ),
    ],
  );
}

// ---------- illustrations (media) ----------

function setBoard() {
  return el('div', { className: 'tour-set-board panel', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { className: 'tour-board-label', text: 'Blind set / set 04' }),
    el(
      'div',
      { className: 'tour-set-cups' },
      ['A', 'B', 'C'].map((letter) => el('span', { className: 'icon-frame', text: letter })),
    ),
    el('div', { className: 'tour-board-result' }, [
      el('span', { text: 'Odd cup' }),
      el('strong', { text: 'B' }),
      el('span', { text: '12.4 sec' }),
    ]),
  ]);
}

function cupTasterMedia() {
  return el('div', { className: 'tour-cup-media panel' }, [
    el('img', {
      attrs: {
        src: '/marketing/hero-cupping-bowls.jpg',
        alt: 'Three cups of coffee on a wooden table.',
        loading: 'eager',
      },
    }),
    setBoard(),
  ]);
}

// The BTC illustration follows the real scoring (src/formats/btc/scoring.js, not imported here): 15 preliminary
// cups, each split from three tokens between the teams; the team with more tokens earns +5, the fastest team +2.
// Fictional teams. The numbers are derived below, so the board cannot show a split that is not three tokens.
export const BTC_BOARD = Object.freeze({
  teams: ['Kopi Kaki', 'Roast Rangers'],
  cups: [
    [2, 1],
    [3, 0],
    [1, 2],
    [2, 1],
    [2, 1],
    [3, 0],
    [1, 2],
    [2, 1],
    [2, 1],
    [1, 2],
    [2, 1],
    [1, 2],
    [2, 1],
    [1, 2],
    [1, 2],
  ],
  moreTokensBonus: 5,
  fastestBonus: 2,
  fastestTeam: 1,
});

export function btcBoardTotals(board = BTC_BOARD) {
  const tokens = [0, 0];
  for (const [a, b] of board.cups) {
    tokens[0] += a;
    tokens[1] += b;
  }
  const moreTokens = tokens[0] === tokens[1] ? -1 : tokens[0] > tokens[1] ? 0 : 1;
  const total = [...tokens];
  if (moreTokens >= 0) total[moreTokens] += board.moreTokensBonus;
  total[board.fastestTeam] += board.fastestBonus;
  return { tokens, total, moreTokens };
}

function btcMedia() {
  const { tokens, total, moreTokens } = btcBoardTotals();
  const [teamA, teamB] = BTC_BOARD.teams;
  return el('div', { className: 'tour-fmt-media' }, [
    el('div', { className: 'tour-board panel', attrs: { 'aria-hidden': 'true' } }, [
      el('div', { className: 'tour-board-head' }, [
        el('span', { text: `Round 2 / match 3 · ${BTC_BOARD.cups.length} cups` }),
        el('span', { className: 'tag', text: 'Illustration' }),
      ]),
      el('div', { className: 'tour-teams' }, [
        el('div', { className: 'tour-team' }, [
          el('b', { text: teamA }),
          el('small', { text: 'Team A' }),
        ]),
        el('div', { className: 'tour-score' }, [
          el('span', { text: String(total[0]) }),
          el('em', { text: ':' }),
          el('span', { text: String(total[1]) }),
        ]),
        el('div', { className: 'tour-team tour-team-right' }, [
          el('b', { text: teamB }),
          el('small', { text: 'Team B' }),
        ]),
      ]),
      el(
        'div',
        { className: 'tour-cuprow' },
        BTC_BOARD.cups.map(([a, b], i) =>
          el('div', { className: `tour-cupcell${a > b ? ' tour-cupcell-a' : ''}` }, [
            el('span', { text: `C${i + 1}` }),
            el('b', { text: `${a}–${b}` }),
          ]),
        ),
      ),
      el('div', { className: 'tour-board-result tour-board-result-wide' }, [
        el('span', {
          text: `Tokens ${tokens[0]}–${tokens[1]} · more tokens +${BTC_BOARD.moreTokensBonus} ${
            moreTokens === 0 ? 'A' : 'B'
          }`,
        }),
        el('span', {
          text: `Fastest +${BTC_BOARD.fastestBonus} ${BTC_BOARD.fastestTeam === 0 ? 'A' : 'B'}`,
        }),
      ]),
      el(
        'div',
        { className: 'tour-path' },
        ['Round 1', 'Round 2', 'The cut', 'Top 8', 'Final'].map((step, i) =>
          el('span', { className: i < 2 ? 'tour-path-on' : '', text: step }),
        ),
      ),
    ]),
  ]);
}

// Fictional competitors. Each match: [name, score] for the winner first, then the loser.
const BRACKET = Object.freeze({
  quarters: [
    [
      ['Aina', 3],
      ['Rizal', 0],
    ],
    [
      ['Dino', 2],
      ['Hana', 1],
    ],
    [
      ['Wei', 2],
      ['Syaf', 1],
    ],
    [
      ['Iqbal', 3],
      ['Nur', 0],
    ],
  ],
  semis: [
    [
      ['Aina', 2],
      ['Dino', 1],
    ],
    [
      ['Iqbal', 2],
      ['Wei', 1],
    ],
  ],
  final: ['Aina', 'Iqbal'],
  third: 'Dino v Wei',
});

function matchBox([winner, loser], extra = '') {
  return el('div', { className: `tour-match${extra}` }, [
    el('div', { className: 'tour-match-w' }, [
      el('span', { text: winner[0] }),
      el('span', { text: String(winner[1]) }),
    ]),
    el('div', { className: 'tour-match-l' }, [
      el('span', { text: loser[0] }),
      el('span', { text: String(loser[1]) }),
    ]),
  ]);
}

function throwdownMedia() {
  return el('div', { className: 'tour-fmt-media' }, [
    el('div', { className: 'tour-board panel', attrs: { 'aria-hidden': 'true' } }, [
      el('div', { className: 'tour-board-head' }, [
        el('span', { text: 'Bracket / 8 competitors' }),
        el('span', { className: 'tag', text: 'Illustration' }),
      ]),
      el('div', { className: 'tour-bracket' }, [
        el(
          'div',
          { className: 'tour-col tour-col-qf' },
          BRACKET.quarters.map((m) => matchBox(m)),
        ),
        el(
          'div',
          { className: 'tour-col tour-col-sf' },
          BRACKET.semis.map((m) => matchBox(m)),
        ),
        el('div', { className: 'tour-col' }, [
          el('div', { className: 'tour-match tour-match-final' }, [
            el('div', { className: 'tour-match-w' }, [
              el('span', { text: BRACKET.final[0] }),
              el('span', { text: '·' }),
            ]),
            el('div', {}, [el('span', { text: BRACKET.final[1] }), el('span', { text: '·' })]),
          ]),
          el('div', { className: 'tour-third', text: BRACKET.third }),
        ]),
      ]),
    ]),
  ]);
}

// The only place a format id is named: its picture. A live format with no entry here is a text-only section.
const MEDIA = { 'cup-taster': cupTasterMedia, btc: btcMedia, throwdown: throwdownMedia };

// ---------- live format sections ----------

function modesList(format) {
  const modes = waysToPlay(format);
  if (!modes.length) return null;
  return el('div', { className: 'tour-modes' }, [
    el('span', { className: 'tour-modes-title', text: 'Ways to play' }),
    el(
      'ul',
      { className: 'tour-modes-list' },
      modes.map((mode) =>
        el('li', { className: `tour-mode panel tour-mode-${mode.status}` }, [
          el('b', { text: mode.name }),
          stateTag(mode.status),
          el('p', { text: mode.description }),
        ]),
      ),
    ),
  ]);
}

function buildFormat(format, number, index) {
  const { section } = format;
  const media = MEDIA[format.id]?.() ?? null;
  const copy = el(
    'div',
    { className: 'tour-cup-copy' },
    [
      el('div', { className: 'tour-icon icon-frame', attrs: { 'aria-hidden': 'true' } }, [
        iconFor(format.icon),
      ]),
      el('p', { className: 'tour-kicker', text: section.kicker }),
      el('h2', { id: `${format.id}-title`, text: `${format.name}.` }),
      el('p', { className: 'tour-copy', text: section.copy }),
      section.gets?.length
        ? el(
            'ul',
            { className: 'tour-gets' },
            section.gets.map((line) => el('li', { text: line })),
          )
        : null,
      modesList(format),
      section.note ? el('p', { className: 'tour-note', text: section.note }) : null,
      el(
        'a',
        {
          className: 'tour-primary-link action action-primary btn-bevel',
          attrs: { href: '/app/#/events' },
        },
        [el('span', { text: `Open ${format.name}` }), arrow()],
      ),
    ].filter(Boolean),
  );
  return el(
    'section',
    {
      className: 'tour-cup',
      attrs: { id: format.id, 'aria-labelledby': `${format.id}-title` },
    },
    [
      sectionLabel(pad(number), 'Live format'),
      media
        ? el('div', { className: `tour-cup-grid${index % 2 ? ' tour-flip' : ''}` }, [copy, media])
        : el('div', { className: 'tour-cup-solo' }, [copy]),
    ],
  );
}

// ---------- built for the room ----------

// Each claim holds for all three live formats (checked in code 2026-11-13): both audience views (liveSurfaces.js),
// the offline outbox, the TEST marking on the live payloads, and the organisation's team logins (core/team.js).
const SHARED = [
  {
    title: 'Audience screens',
    text: "A projector view for the venue and a phone view for the crowd, both with your organisation's link.",
  },
  {
    title: 'Patchy Wi-Fi is fine',
    text: 'Scores are saved on the device first and sent when the connection comes back.',
  },
  {
    title: 'Test events look like tests',
    text: 'A practice run is clearly marked TEST on the audience screens, so nobody mistakes it for the real thing.',
  },
  {
    title: 'A team at the table',
    text: 'Give each helper their own login for your organisation.',
  },
];

function buildShared() {
  return el('section', { className: 'tour-shared', attrs: { 'aria-labelledby': 'shared-title' } }, [
    sectionLabel('+', 'In every format'),
    el('h2', { id: 'shared-title', text: 'Built for the room.' }),
    el(
      'div',
      { className: 'tour-shared-grid' },
      SHARED.map((item) =>
        el('article', {}, [el('h3', { text: item.title }), el('p', { text: item.text })]),
      ),
    ),
  ]);
}

// ---------- on the way ----------

function buildOnTheWay(formats, number) {
  const rows = onTheWay(formats);
  if (!rows.length) return null;
  return el(
    'section',
    { className: 'tour-planned', attrs: { id: 'next', 'aria-labelledby': 'next-title' } },
    [
      sectionLabel(pad(number), 'On the way'),
      el('h2', { id: 'next-title', text: "What's coming next." }),
      el('p', {
        className: 'tour-lede',
        text: 'New formats and new ways to play an existing format move from planned, to testing at real events, to live.',
      }),
      el('div', { className: 'tour-pipe' }, [
        el('div', { className: 'tour-pipe-legend', attrs: { 'aria-hidden': 'true' } }, [
          stateTag('planned'),
          el('span', { text: '→' }),
          stateTag('testing'),
          el('span', { text: '→' }),
          stateTag('live'),
        ]),
        ...rows.map((row) =>
          el(
            'article',
            { className: 'tour-planned-card tour-next panel', attrs: { 'data-key': row.key } },
            [
              el(
                'div',
                {
                  className: 'tour-icon icon-frame tour-icon-muted',
                  attrs: { 'aria-hidden': 'true' },
                },
                [iconFor(row.icon)],
              ),
              el('div', {}, [
                el('span', { className: 'tour-family', text: row.family }),
                el('h3', { text: row.name }),
                el('p', { text: row.text }),
              ]),
              stateTag(row.status),
            ],
          ),
        ),
      ]),
    ],
  );
}

// ---------- community ----------

// Descriptions follow each tool's own page (checked 2026-11-13). Guess the Bean keeps its existing line.
const COMMUNITY_TOOLS = [
  {
    title: 'Competition Timer',
    label: 'Keep the room moving',
    description: 'A free timer for heats, brews and cupping rounds.',
    href: '/tools/timer/',
    icon: 'timer',
  },
  {
    title: 'Brew Planner',
    label: 'Plan the brews',
    description:
      'Plan the batches for a triangulation heat: how many, which machine, and when to start brewing.',
    href: '/tools/brew-planner/',
    icon: 'brew',
  },
  {
    title: 'Random Selector',
    label: 'Draw it fairly',
    description: 'A split-flap draw for competition turns, prizes and community events.',
    href: '/tools/random-selector/',
    icon: 'draw',
  },
  {
    title: 'Guess the Bean',
    label: 'A little friendly suspense',
    description:
      'Set the jar, share the link, and let the room guess with a live display built in.',
    href: '/guess-the-bean/',
    icon: 'beans',
  },
];

function communityCard({ title, label, description, href, icon: iconName }) {
  return el('a', { className: 'tour-community-card panel', attrs: { href } }, [
    el('div', { className: 'tour-icon icon-frame', attrs: { 'aria-hidden': 'true' } }, [
      iconFor(iconName),
    ]),
    el('p', { className: 'tour-kicker', text: label }),
    el('h3', { text: title }),
    el('p', { text: description }),
    el('span', { className: 'tour-text-link', text: 'Open tool →' }),
  ]);
}

function buildCommunity(number) {
  return el(
    'section',
    {
      className: 'tour-community',
      attrs: { id: 'community', 'aria-labelledby': 'community-title' },
    },
    [
      sectionLabel(pad(number), 'Community tools'),
      el('div', { className: 'tour-community-heading' }, [
        el('div', {}, [
          el('p', { className: 'tour-kicker', text: 'For the rest of the day' }),
          el('h2', { id: 'community-title', text: 'Useful beyond the heat.' }),
        ]),
        el('p', {
          text: 'Free tools for setting up a room, running a booth or bringing people in.',
        }),
      ]),
      el('div', { className: 'tour-community-grid' }, COMMUNITY_TOOLS.map(communityCard)),
      el(
        'a',
        { className: 'tour-community-link action action-primary', attrs: { href: '/community/' } },
        [el('span', { text: 'Explore all Community tools' }), arrow()],
      ),
    ],
  );
}

export function mountTourScreen(root, { formats = FORMATS } = {}) {
  const live = liveFormats(formats).filter((f) => f.section);
  const hasNext = onTheWay(formats).length > 0;
  root.replaceChildren(
    el(
      'main',
      { className: 'tour-page', attrs: { 'data-surface': 'stage' } },
      [
        buildPublicHeader({ active: 'tour', liveNames: live.map((f) => f.name) }),
        buildHero(formats),
        buildCompare(formats),
        ...live.map((format, i) => buildFormat(format, i + 1, i)),
        buildShared(),
        buildOnTheWay(formats, live.length + 1),
        buildCommunity(live.length + (hasNext ? 2 : 1)),
        buildPublicFooter({
          companionHref: '/community/',
          companionText: 'Community Tools →',
        }),
      ].filter(Boolean),
    ),
  );
}
