// Demo harness only (not shipped): the organiser kit as on the approved "BTC Organiser UX" canvas, fed with
// fictional BTC-shaped data. See organiserKit.preview.html for the query options.
import { el } from './dom.js';
import { renderStatusBand } from './statusBand.js';
import { renderCountryFlag } from './countryFlag.js';
import { buildRunSheet } from './runSheet.js';
import { buildEventWarnings } from './eventWarnings.js';
import { buildLiveCard } from './liveCard.js';
import { buildRecordsCard } from './recordsCard.js';

const params = new URLSearchParams(location.search);
const frame = params.get('frame') ?? 'both';
const band = params.get('band') ?? 'beta';
const state = params.get('state') ?? 'mid';
const surface = params.get('surface');
if (surface === 'stage') document.documentElement.setAttribute('data-surface', 'stage');

const root = document.getElementById('root');

function phasesFor(which) {
  if (which === 'empty') {
    return [
      {
        id: 'setup',
        label: 'Setup',
        status: 'in_progress',
        count: '0 teams · 0 judges',
        nextAction: { label: 'Add teams', href: '#/setup' },
      },
      { id: 'r1', label: 'Round 1', status: 'not_started', count: '0 of 0 confirmed' },
      { id: 'r2', label: 'Round 2', status: 'not_started' },
      { id: 'cut', label: 'The cut', status: 'not_started' },
      { id: 'ko', label: 'Knockout', status: 'not_started' },
      { id: 'podium', label: 'Podium', status: 'not_started' },
    ];
  }
  if (which === 'done') {
    return ['Setup', 'Round 1', 'Round 2', 'The cut', 'Knockout', 'Podium'].map((label) => ({
      id: label,
      label,
      status: 'done',
    }));
  }
  return [
    {
      id: 'setup',
      label: 'Setup',
      status: 'blocked',
      count: '20 teams · 9 judges · 2 without a country',
      blockedReason: '2 teams have no country: set them in Setup.',
      nextAction: { label: 'Set countries', href: '#/setup' },
    },
    {
      id: 'r1',
      label: 'Round 1',
      status: 'in_progress',
      count: '7 of 10 confirmed',
      progress: { done: 7, active: 1, total: 10 },
      nextAction: { label: 'Score next', href: '#/matches' },
    },
    {
      id: 'r2',
      label: 'Round 2',
      status: 'waiting',
      count: '0 of 10 confirmed',
      blockedReason: 'Round 2 waits for round 1: 3 matches not confirmed.',
    },
    { id: 'cut', label: 'The cut', status: 'not_started', count: '2 ties to settle' },
    { id: 'ko', label: 'Knockout', status: 'not_started', count: 'QF 0 of 4 · SF 0 of 2' },
    { id: 'podium', label: 'Podium', status: 'not_started' },
  ];
}

function dashboard() {
  const event = {
    name: 'ABTC Rehearsal 1',
    is_test: band === 'test',
    is_shadow: band === 'beta',
  };
  const page = el('div', { className: 'harness-page' });
  const bandNode = renderStatusBand(event);
  if (bandNode) page.appendChild(bandNode);
  page.appendChild(el('h1', { className: 'harness-title', text: event.name }));
  page.appendChild(
    el('div', { className: 'harness-teams' }, [
      ...['BN', 'MY', 'SG', 'ID', 'PH', 'TH', 'VN', 'JP', 'KR', 'AU'].map((code) =>
        renderCountryFlag(code),
      ),
    ]),
  );

  const live = buildLiveCard(
    {
      isLive: false,
      urls: {
        phone: 'https://www.seduhscore.com/app/#/live/grey-matter/phone',
        projector: 'https://www.seduhscore.com/app/#/live/grey-matter/projector',
        splash: 'https://www.seduhscore.com/app/#/live/grey-matter/splash',
      },
      takeOver: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 600)),
    },
    { copy: async () => {} },
  );
  const records = buildRecordsCard(
    [
      {
        label: 'Download the record',
        filename: 'abtc-record.json',
        build: async () => ({ demo: true }),
      },
      {
        label: 'Download scores',
        filename: 'abtc-scores.csv',
        build: async () => 'match,cup\r\n1,A',
      },
    ],
    { save: () => {} },
  );
  const warnings = buildEventWarnings(
    state === 'mid'
      ? [
          {
            id: 'country',
            severity: 'error',
            text: '2 teams have no country.',
            href: '#/setup',
            actionLabel: 'Set countries',
          },
          {
            id: 'times',
            severity: 'warning',
            text: '3 matches have no finish times.',
            href: '#/matches',
            actionLabel: 'Add times',
          },
          { id: 'unsent', severity: 'info', text: '1 write is queued, not yet sent.' },
        ]
      : [],
  );
  const nav = el(
    'nav',
    { className: 'harness-nav', attrs: { 'aria-label': 'Event' } },
    ['Setup', 'Matches', 'Standings', 'Bracket'].map((label) =>
      el('a', {
        className: 'btn btn-outline tap-target',
        text: label,
        attrs: { href: `#/${label.toLowerCase()}` },
      }),
    ),
  );

  page.appendChild(
    el('div', { className: 'ok-dashboard' }, [
      el('div', { className: 'ok-dashboard-main' }, [buildRunSheet(phasesFor(state)), nav]),
      el('div', { className: 'ok-dashboard-rail' }, [warnings, live.element, records]),
    ]),
  );
  return page;
}

function framed(label, width, height, src) {
  const iframe = el('iframe', {
    attrs: { src, title: label, width: String(width), height: String(height) },
  });
  return el('figure', { className: 'harness-frame', attrs: { style: 'margin:0' } }, [
    el('figcaption', { text: `${label} · ${width} × ${height}` }),
    iframe,
  ]);
}

if (frame === 'raw') {
  root.appendChild(dashboard());
} else {
  const q = new URLSearchParams(location.search);
  q.set('frame', 'raw');
  const src = `${location.pathname}?${q.toString()}`;
  root.appendChild(
    el('div', { className: 'harness-frames' }, [
      framed('Tablet landscape', 1180, 820, src),
      framed('Phone 360', 360, 820, src),
    ]),
  );
}
