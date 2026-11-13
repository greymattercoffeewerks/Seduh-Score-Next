// Seduh ID country pages (spec SEDUH-ID-COUNTRY-PAGES, T-CTY.3): /id/country/ (the hub) and /id/country/<iso2>/ (one
// country's record at the Barista Team Championship). Nobody claims a page and nobody logs in: it fills from the two
// anonymous doors (core/countryRecord.js), and every result says where it came from ("From the organiser's records").
//
// The pages are noindex and linked from nowhere on the public site until the owner decides (core/countryPages.js,
// COUNTRY_PAGES_PUBLIC). The pages draw only what the doors return; they invent no stat, rank or claim about a country.
// Every state is designed: loading, a failed read (with Try again), a record that is empty, and a code that is not a
// country. Text goes in through textContent only (el()).
import { el } from '../core/dom.js';
import { countryName, isCountryCode } from '../core/country.js';
import { loadFlagUrl } from '../core/countryFlag.js';
import { COUNTRY_HUB_PATH, countryPagePath, countryPageUrl } from '../core/countryPages.js';
import { fetchCountryIndex, fetchCountryRecord, provenanceLabel } from '../core/countryRecord.js';
import { renderStoryCard, shareStoryCard, storyThemeFrom } from '../core/storyCard.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { CONTACT_EMAIL } from './trustContent.js';
import {
  addressText,
  finishText,
  groupCountries,
  plural,
  roundsSpoken,
  roundsText,
  yearsText,
} from './countryFormat.js';

const nameOf = (code) => countryName(code) ?? code;

// ---- shared pieces ----

// The flag as a tile. The code is always text beside it, so nothing depends on seeing the picture.
function flagTile(code, { large = false } = {}) {
  const img = el('img', {
    className: 'country-tile-flag',
    attrs: { alt: '', 'aria-hidden': 'true', decoding: 'async', hidden: '' },
  });
  loadFlagUrl(code)
    .then((url) => {
      if (!url) return;
      img.src = url;
      img.hidden = false;
    })
    .catch(() => {});
  return el('span', { className: `country-tile${large ? ' country-tile-large' : ''}` }, [
    img,
    el('span', { className: 'country-tile-code', text: code }),
  ]);
}

function pageShell(root, active, ...children) {
  root.replaceChildren(
    el('main', { className: 'country-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({ active }),
      ...children.filter(Boolean),
      buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
    ]),
  );
}

function hero({ kicker, title, intro, titleId }) {
  return el(
    'section',
    { className: 'country-hero page-hero', attrs: { 'aria-labelledby': titleId } },
    [
      el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'page-hero-kicker', text: kicker }),
      el('h1', { id: titleId, attrs: { tabindex: '-1' } }, title),
      intro ? el('p', { className: 'page-hero-intro', text: intro }) : null,
    ].filter(Boolean),
  );
}

function stateCard({ title, message, actions = [], role = 'status' }) {
  return el('section', { className: 'country-body country-state' }, [
    el(
      'div',
      { className: 'country-state-card panel', attrs: { role } },
      [
        el('h2', { text: title }),
        el('p', { text: message }),
        actions.length ? el('div', { className: 'country-state-actions' }, actions) : null,
      ].filter(Boolean),
    ),
  ]);
}

const hubLink = (text = 'See every country') =>
  el('a', { className: 'action action-outline', text, attrs: { href: COUNTRY_HUB_PATH } });

// ---- the hub ----

function countryTile(row) {
  const name = nameOf(row.code);
  return el('li', {}, [
    el('a', { className: 'country-card panel', attrs: { href: countryPagePath(row.code) } }, [
      flagTile(row.code),
      el('span', { className: 'country-card-name', text: name }),
      el('span', {
        className: 'country-card-counts tabular-nums',
        text: `${plural(row.teams, 'team')} · ${plural(row.championships, 'championship')}`,
      }),
    ]),
  ]);
}

function countryGrid(heading, rows, id) {
  if (rows.length === 0) return null;
  return el('section', { className: 'country-body', attrs: { 'aria-labelledby': id } }, [
    el('h2', { id, className: 'country-section-title', text: heading }),
    el('ul', { className: 'country-grid', attrs: { role: 'list' } }, rows.map(countryTile)),
  ]);
}

export async function mountCountryHub(root, { client, fetchIndex = fetchCountryIndex } = {}) {
  const heroNode = hero({
    titleId: 'country-title',
    kicker: 'Seduh Score / Seduh ID',
    title: [document.createTextNode('Every country’s '), el('span', { text: 'record.' })],
    intro:
      'Each country’s teams at the ASEAN Barista Team Championship, built from the organiser’s official results. Nobody claims these pages.',
  });
  const show = (...nodes) => pageShell(root, 'records', heroNode, ...nodes);
  document.title = 'Countries — Seduh Score';

  async function load() {
    show(stateCard({ title: 'Loading the records…', message: 'One moment.' }));
    let rows;
    try {
      rows = await raceTimeout(fetchIndex(client), DEFAULT_LOAD_TIMEOUT_MS);
    } catch (err) {
      show(failureCard(err, load));
      return;
    }
    if (rows.length === 0) {
      show(
        stateCard({
          title: 'No records yet',
          message: 'No country has a listed record yet. Check back soon.',
        }),
      );
      return;
    }
    const { members, guests } = groupCountries(rows, nameOf);
    show(
      ...[
        countryGrid('ASEAN members', members, 'country-members'),
        countryGrid('Guest countries', guests, 'country-guests'),
        sourceNote(),
      ].filter(Boolean),
    );
  }
  await load();
}

function failureCard(err, retry) {
  const text = err?.timedOut
    ? 'This is taking longer than expected — check your connection and try again.'
    : 'Something went wrong loading the record — please try again.';
  return stateCard({
    title: 'Could not load the record',
    message: text,
    role: 'alert',
    actions: [
      el('button', {
        className: 'action action-primary',
        text: 'Try again',
        attrs: { type: 'button' },
      }),
    ].map((button) => {
      // The button is replaced by the loading card, so focus would fall to the page: after the new state is drawn it
      // goes to the page's heading, where a keyboard or screen-reader user starts reading.
      button.addEventListener('click', () =>
        Promise.resolve(retry()).then(() => document.querySelector('.country-page h1')?.focus()),
      );
      return button;
    }),
  });
}

function sourceNote(suppliers = []) {
  const from =
    suppliers.length > 0
      ? `Results supplied by ${suppliers.join(' and ')}.`
      : 'Results are supplied by the competition’s organiser.';
  return el(
    'section',
    {
      className: 'country-body country-source',
      attrs: { 'aria-labelledby': 'country-source-title' },
    },
    [
      el('h2', {
        id: 'country-source-title',
        className: 'country-section-title',
        text: 'Where this comes from',
      }),
      el('p', {
        text: `${from} Every result here is labelled “From the organiser’s records”: Seduh Score did not score those championships.`,
      }),
      el('p', {}, [
        document.createTextNode('To ask for a correction or a removal, write to '),
        el('a', { text: CONTACT_EMAIL, attrs: { href: `mailto:${CONTACT_EMAIL}` } }),
        document.createTextNode('. We acknowledge within 10 days and finish within 30.'),
      ]),
    ],
  );
}

// ---- one country ----

function statBlock(value, label) {
  return el('div', { className: 'country-stat' }, [
    el('b', { className: 'tabular-nums', text: String(value) }),
    el('span', { text: label }),
  ]);
}

// Matches won and lost are NOT shown (owner decision, 2026-11-13): the organiser publishes opponents only for the two
// final matches, so the door's matches_won/matches_lost badly understate every country. The figure can return once full
// pairings exist (public_country_record is unchanged and still returns it).
function statsRow(record) {
  const { stats } = record;
  const blocks = [
    statBlock(stats.championships, stats.championships === 1 ? 'championship' : 'championships'),
    statBlock(stats.teams, stats.teams === 1 ? 'team sent' : 'teams sent'),
    statBlock(stats.entries, stats.entries === 1 ? 'entry' : 'entries'),
  ];
  return el(
    'div',
    { className: 'country-stats', attrs: { role: 'group', 'aria-label': 'Totals' } },
    blocks,
  );
}

function bestFinishCard(best) {
  if (!best) return null;
  return el(
    'section',
    { className: 'country-body', attrs: { 'aria-labelledby': 'country-best-title' } },
    [
      el('div', { className: 'country-best panel' }, [
        el('h2', {
          id: 'country-best-title',
          className: 'country-best-label',
          text: 'Best finish',
        }),
        el('p', { className: 'country-best-finish', text: finishText(best.stage, best.placement) }),
        el('p', { className: 'country-best-detail', text: `${best.teamName} · ${best.year}` }),
      ]),
    ],
  );
}

function teamRow(team) {
  const rounds = roundsText(team.rounds);
  return el(
    'li',
    { className: 'country-team' },
    [
      el('span', { className: 'country-team-name', text: team.teamName }),
      el('span', {
        className: 'country-team-stage tag',
        text: finishText(team.stage, team.placement),
      }),
      rounds
        ? el('span', { className: 'country-team-rounds tabular-nums' }, [
            el('span', { attrs: { 'aria-hidden': 'true' }, text: rounds }),
            el('span', { className: 'sr-only', text: roundsSpoken(team.rounds) }),
          ])
        : null,
    ].filter(Boolean),
  );
}

function championshipSection(champ, index) {
  const where = [champ.hostCity, champ.hostCountryCode ? nameOf(champ.hostCountryCode) : null]
    .filter(Boolean)
    .join(', ');
  const id = `country-champ-${index}`;
  return el('section', { className: 'country-champ panel', attrs: { 'aria-labelledby': id } }, [
    el(
      'div',
      { className: 'country-champ-head' },
      [
        el('h3', { id, text: `${champ.name}` }),
        where ? el('p', { className: 'country-champ-where', text: where }) : null,
        el('p', { className: 'country-provenance tag', text: provenanceLabel(champ.provenance) }),
      ].filter(Boolean),
    ),
    el('ul', { className: 'country-team-list', attrs: { role: 'list' } }, champ.teams.map(teamRow)),
  ]);
}

function teamsSummary(teams) {
  if (teams.length === 0) return null;
  return el(
    'section',
    { className: 'country-body', attrs: { 'aria-labelledby': 'country-teams-title' } },
    [
      el('h2', { id: 'country-teams-title', className: 'country-section-title', text: 'Teams' }),
      el(
        'ul',
        { className: 'country-summary-list', attrs: { role: 'list' } },
        teams.map((team) =>
          el('li', {}, [
            el('span', { className: 'country-team-name', text: team.teamName }),
            el('span', {
              className: 'country-summary-meta',
              text: `${plural(team.years.length, 'year')}: ${yearsText(team.years)} · best: ${finishText(team.bestStage, team.bestPlacement)}`,
            }),
          ]),
        ),
      ),
    ],
  );
}

function otherCountries(rows, code) {
  const others = rows.filter((row) => row.code !== code);
  if (others.length === 0) return null;
  const { members, guests } = groupCountries(others, nameOf);
  return el(
    'nav',
    { className: 'country-body', attrs: { 'aria-labelledby': 'country-others-title' } },
    [
      el('h2', {
        id: 'country-others-title',
        className: 'country-section-title',
        text: 'Other countries',
      }),
      el(
        'ul',
        { className: 'country-others', attrs: { role: 'list' } },
        [...members, ...guests].map((row) =>
          el('li', {}, [
            el('a', { text: nameOf(row.code), attrs: { href: countryPagePath(row.code) } }),
          ]),
        ),
      ),
    ],
  );
}

// "Share to story": draws the 1080 x 1920 card (core/storyCard.js), shows it, and lets the person share or save it.
function storySpec(record, code) {
  const name = nameOf(code);
  const { stats } = record;
  return {
    eyebrow: 'Barista Team Championship',
    tile: code,
    title: name,
    subtitle: 'Built from official results.',
    stats: [
      {
        value: String(stats.championships),
        label: stats.championships === 1 ? 'championship' : 'championships',
      },
      { value: String(stats.teams), label: stats.teams === 1 ? 'team sent' : 'teams sent' },
      { value: String(stats.entries), label: stats.entries === 1 ? 'entry' : 'entries' },
    ],
    highlight: stats.bestFinish
      ? {
          label: 'Best finish',
          text: finishText(stats.bestFinish.stage, stats.bestFinish.placement),
          detail: `${stats.bestFinish.teamName} · ${stats.bestFinish.year}`,
        }
      : null,
    address: addressText(countryPageUrl(code)),
    provenance: 'From the organiser’s records. Scan to see the full record.',
  };
}

function buildShareControl(
  record,
  code,
  { render = renderStoryCard, share = shareStoryCard } = {},
) {
  const status = el('p', {
    className: 'country-share-note',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const button = el('button', {
    className: 'action action-primary',
    text: 'Share to story',
    attrs: { type: 'button' },
  });
  let busy = false;

  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = 'Making the picture…';
    try {
      const theme = storyThemeFrom(button.closest('[data-surface]') ?? document.body);
      // A stalled flag or font fetch must not leave the button busy for ever: after the usual load budget it is a failure.
      const blob = await raceTimeout(
        loadFlagUrl(code)
          .catch(() => null)
          .then((flagUrl) =>
            render(storySpec(record, code), { theme, flagUrl, qrUrl: countryPageUrl(code) }),
          ),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      const filename = `seduh-id-${code.toLowerCase()}-story.png`;
      const result = await share(blob, {
        filename,
        title: `${nameOf(code)} at the Barista Team Championship`,
        text: countryPageUrl(code),
      });
      status.textContent =
        result === 'saved'
          ? 'Picture saved. Add it to your story from your photos.'
          : result === 'shared'
            ? 'Shared.'
            : '';
    } catch {
      status.textContent = 'Could not make the picture. Please try again.';
    } finally {
      busy = false;
      button.removeAttribute('aria-busy');
    }
  });
  return el('div', { className: 'country-share' }, [button, status]);
}

function countryHero(code, name, share) {
  return el(
    'section',
    {
      className: 'country-hero page-hero country-hero-one',
      attrs: { 'aria-labelledby': 'country-title' },
    },
    [
      el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'page-hero-kicker', text: 'Seduh Score / Seduh ID / Country' }),
      el('div', { className: 'country-identity' }, [
        flagTile(code, { large: true }),
        el('h1', { id: 'country-title', text: name, attrs: { tabindex: '-1' } }),
      ]),
      el('ul', { className: 'country-labels', attrs: { role: 'list' } }, [
        el('li', { className: 'tag tag-solid', text: 'Built from official results' }),
        el('li', { className: 'tag', text: 'Nobody claims this page' }),
      ]),
      share,
    ].filter(Boolean),
  );
}

export async function mountCountryPage(
  root,
  code,
  { client, fetchRecord = fetchCountryRecord, fetchIndex = fetchCountryIndex, share } = {},
) {
  const upper = String(code ?? '').toUpperCase();
  const name = isCountryCode(upper) ? nameOf(upper) : null;

  // A code that is not a country at all: say so, and do not call the database.
  if (!name) {
    document.title = 'Country not found — Seduh Score';
    pageShell(
      root,
      'records',
      hero({
        titleId: 'country-title',
        kicker: 'Seduh Score / Seduh ID / Country',
        title: [document.createTextNode('Not a country we know.')],
      }),
      stateCard({
        title: 'We do not know that country code',
        message: 'Country pages use the two-letter code, such as bn for Brunei.',
        actions: [hubLink()],
      }),
    );
    return;
  }

  document.title = `${name} — Seduh ID — Seduh Score`;
  const loadingHero = countryHero(upper, name);

  async function load() {
    pageShell(
      root,
      'records',
      loadingHero,
      stateCard({ title: 'Loading the record…', message: 'One moment.' }),
    );
    let record;
    let index = [];
    try {
      // The other countries are a courtesy: their failure never takes the page down.
      const [rec, idx] = await raceTimeout(
        Promise.all([fetchRecord(upper, client), fetchIndex(client).catch(() => [])]),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      record = rec;
      index = idx;
    } catch (err) {
      pageShell(root, 'records', loadingHero, failureCard(err, load));
      return;
    }

    if (!record.hasRecord) {
      pageShell(
        root,
        'records',
        loadingHero,
        stateCard({
          title: 'No record here yet',
          message: `${name} has no results listed yet. It will appear here once an organiser’s results for ${name} are added.`,
          actions: [hubLink()],
        }),
      );
      return;
    }

    const suppliers = [...new Set(record.championships.map((c) => c.suppliedBy).filter(Boolean))];
    pageShell(
      root,
      'records',
      countryHero(upper, name, buildShareControl(record, upper, share)),
      el('section', { className: 'country-body', attrs: { 'aria-label': 'Totals' } }, [
        statsRow(record),
      ]),
      bestFinishCard(record.stats.bestFinish),
      el(
        'section',
        { className: 'country-body', attrs: { 'aria-labelledby': 'country-champs-title' } },
        [
          el('h2', {
            id: 'country-champs-title',
            className: 'country-section-title',
            text: 'By championship',
          }),
          ...record.championships.map(championshipSection),
        ],
      ),
      teamsSummary(record.teams),
      otherCountries(index, upper),
      sourceNote(suppliers),
    );
  }
  await load();
}
