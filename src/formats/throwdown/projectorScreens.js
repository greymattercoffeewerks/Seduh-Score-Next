// Throwdown's venue display (the projector), on BTC's model: a loop of pages held 10 seconds each with a ring counting
// down to the change, "what just happened" moments on a confirmed result (projectorMoments.js), and a champion
// screen. All the machinery is core (the loop screen, the champion screen, the match card, the page loop, the band);
// this module is only what is Throwdown: which pages there are and what they say.
//
//   before Round 1 (phase `setup`):  Meet the competitors (names only) and How it works
//   once it is under way:            Up next, the round page(s), Still in, Path to the final, Latest results
//
// A page with nothing to say is left out of the loop. The loop never draws a round that has not been earned: only
// rounds that exist are drawn, a future round is one sentence ("Drawn when the Round of 16 is complete"), never
// slots or names. A decided vote match shows its split; a match decided by scoresheets shows its winner only
// (D8): nothing on this surface can say a point total, a judge count or the deciding rule, because the payload
// (liveSession.js) never carries one.
//
// The TEST marker is the shell's (viewer-shell, from the live row's is_test), so it is on this surface from the first
// publish. Meaning is carried by words ("Wins", "Walkover", "Bye", "Judging"), never colour alone.
import { el } from '../../core/dom.js';
import { paginate, pageRange } from '../../core/pageRotator.js';
import { createLoopScreen } from '../../core/stageLoopScreen.js';
import { createChampionScreen } from '../../core/stageChampionScreen.js';
import { renderSide, renderVs } from '../../core/stageMatchCard.js';
import { stageKicker, stageTitle } from '../../core/stageVocabulary.js';
import { hasThrowdownPublicContent } from './viewerBody.js';

export const hasThrowdownProjectorContent = hasThrowdownPublicContent;

// Long enough to find your name and read the row, short enough that the loop is not a wait.
export const PAGE_DWELL_MS = 10_000;
export const MATCHES_PER_PAGE = 8;
export const NAMES_PER_PAGE = 16;
// A round of more than this many matches is not drawn as a bracket column: it is one line ("Round of 32 · complete").
export const MAX_DRAWN_MATCHES = 8;

export function throwdownBand(payload) {
  const section =
    payload.phase === 'complete'
      ? 'Final result'
      : payload.phase === 'live'
        ? 'Live bracket'
        : 'Starting soon';
  return { eventName: payload.eventName, sectionLabel: section, live: true };
}

// ---------- words (shared with the moments) ----------

export const TO_BE_DECIDED = 'To be decided';
const nameOf = (side) => side?.name ?? TO_BE_DECIDED;

// "2 to 1", winner's votes first, or '' (a walkover, a bye, or a scoresheet match, which has no numbers to say).
export function splitText(match) {
  if (match.resultKind !== 'votes') return '';
  const counts = match.sides.map((s) => s.votes);
  if (!counts.every((n) => typeof n === 'number')) return '';
  return [...counts].sort((a, b) => b - a).join(' to ');
}

// What a match says about itself, in words: how it was decided, or where it stands.
export function matchStatus(match, { upNextId = null } = {}) {
  if (match.decided) {
    if (match.resultKind === 'walkover') return 'Walkover';
    if (match.resultKind === 'bye') return 'Bye';
    return splitText(match);
  }
  if (match.judging) return 'Judging';
  if (match.id === upNextId) return 'Up next';
  return 'Not played yet';
}

const matchesOf = (round) => round.matches ?? [];
const numberOf = (match, index) => match.number ?? index + 1;
const isMain = (round) => round.phase === 'main';
const roundName = (round) => round.roundLabel ?? round.label;

// ---------- match boxes (the round page and the path) ----------

function sideRow(side, { showVotes = true } = {}) {
  return el(
    'div',
    {
      className: 'td-stage-side',
      attrs:
        side.winner === null || side.winner === undefined
          ? {}
          : { 'data-winner': String(side.winner) },
    },
    [
      el('span', { className: 'td-stage-name', text: nameOf(side) }),
      side.winner ? el('span', { className: 'td-stage-chip', text: 'Wins' }) : null,
      showVotes && typeof side.votes === 'number'
        ? el('span', { className: 'td-stage-votes', text: String(side.votes) })
        : null,
    ].filter(Boolean),
  );
}

function matchBox(match, index, { upNextId, numbered = true } = {}) {
  const status = matchStatus(match, { upNextId });
  return el('li', { className: 'td-stage-match' }, [
    el(
      'div',
      { className: 'td-stage-sides' },
      match.sides.map((side) => sideRow(side)),
    ),
    el(
      'div',
      { className: 'td-stage-aside' },
      [
        numbered
          ? el('span', { className: 'td-stage-num', text: `Match ${numberOf(match, index)}` })
          : null,
        status ? el('span', { className: 'td-stage-note', text: status }) : null,
      ].filter(Boolean),
    ),
  ]);
}

// ---------- pages before Round 1 ----------

function meetPages(payload) {
  const names = [...(payload.competitorNames ?? [])].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  if (names.length === 0) return [];
  const pages = paginate(names, NAMES_PER_PAGE);
  return pages.map((page, i) => ({
    kind: 'meet',
    label:
      pages.length > 1
        ? `Meet the competitors · page ${i + 1} of ${pages.length}`
        : 'Meet the competitors',
    render: () => [
      stageKicker(
        pages.length > 1
          ? `Starting soon · ${pageRange(pages, i).first} to ${pageRange(pages, i).last} of ${names.length}`
          : `Starting soon · ${names.length} ${names.length === 1 ? 'competitor' : 'competitors'}`,
      ),
      stageTitle('Meet the competitors'),
      el(
        'ul',
        { className: 'td-stage-roster' },
        page.map((name) => el('li', { className: 'td-stage-roster-name', text: name })),
      ),
    ],
  }));
}

function howItWorksPage(payload) {
  const steps = [
    'Head to head: two competitors, one match at a time.',
    'The judges point to the cup they prefer. The majority goes through.',
    'Win and you are into the next round, until one competitor is left.',
  ];
  return {
    kind: 'how',
    label: 'How it works',
    render: () =>
      [
        stageKicker('Starting soon'),
        stageTitle('How it works'),
        el(
          'ol',
          { className: 'td-stage-steps' },
          steps.map((text) => el('li', { className: 'td-stage-step', text })),
        ),
        payload.judgedRounds
          ? el('p', {
              className: 'td-stage-card',
              text: 'In some rounds the judges fill in scoresheets instead. The winner is announced once every sheet is counted.',
            })
          : null,
      ].filter(Boolean),
  };
}

// ---------- live pages ----------

function sideCard(side) {
  return renderSide({ label: side.route ?? null, name: nameOf(side) });
}

function upNextPage(payload) {
  const match = payload.upNext;
  if (!match || (match.sides ?? []).length < 2) return null;
  const [a, b] = match.sides;
  const kicker = [
    'Up next',
    match.roundLabel,
    match.roundSize > 1 ? `Match ${match.number} of ${match.roundSize}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const then = payload.thenNext?.sides?.length === 2 ? payload.thenNext.sides : null;
  return {
    kind: 'next',
    label: 'Up next',
    footer: then ? `Then: ${nameOf(then[0])} vs ${nameOf(then[1])}` : 'Up next',
    render: () =>
      [
        stageKicker(kicker),
        renderVs(sideCard(a), sideCard(b)),
        match.judging
          ? el('div', { className: 'stage-chips td-stage-judging' }, [
              el('span', { className: 'stage-chip', text: 'Judging' }),
            ])
          : null,
      ].filter(Boolean),
  };
}

// The rounds with a match still to play: the main round under way, and the 3rd place round once it exists.
function roundsUnderWay(payload) {
  return (payload.rounds ?? []).filter((round) => matchesOf(round).some((m) => !m.decided));
}

function roundPages(payload) {
  const upNextId = payload.upNext?.id ?? null;
  return roundsUnderWay(payload).flatMap((round) => {
    const pages = paginate(matchesOf(round), MATCHES_PER_PAGE);
    return pages.map((page, i) => {
      const offset = i * MATCHES_PER_PAGE;
      const name = roundName(round);
      const suffix = pages.length > 1 ? ` · page ${i + 1} of ${pages.length}` : '';
      return {
        kind: 'round',
        label: `${name}${suffix}`,
        render: () => [
          stageKicker(`${name}${suffix}`),
          el(
            'ul',
            { className: 'td-stage-list' },
            page.map((match, j) =>
              matchBox(match, offset + j, { upNextId, numbered: round.matches.length > 1 }),
            ),
          ),
        ],
      };
    });
  });
}

function stillInPages(payload) {
  const still = payload.stillIn;
  if (!still || !Array.isArray(still.names) || still.names.length < 2) return [];
  const count = still.names.length;
  const title =
    count === 4
      ? 'The final four'
      : count === 2
        ? 'The finalists'
        : `${count} of ${still.of} still in`;
  const pages = paginate(still.names, NAMES_PER_PAGE);
  return pages.map((page, i) => ({
    kind: 'still',
    label: pages.length > 1 ? `Still in · page ${i + 1} of ${pages.length}` : 'Still in',
    render: () => [
      stageKicker(pages.length > 1 ? `Still in · page ${i + 1} of ${pages.length}` : 'Still in'),
      stageTitle(title),
      el(
        'ul',
        { className: 'td-stage-roster' },
        page.map((entry) =>
          el(
            'li',
            { className: 'td-stage-roster-name' },
            [
              el('span', { className: 'td-stage-roster-text', text: entry.name }),
              entry.next ? el('span', { className: 'td-stage-chip', text: 'Up next' }) : null,
            ].filter(Boolean),
          ),
        ),
      ),
    ],
  }));
}

// The path to the final: the last two main rounds before the Final, then the Final and the 3rd place match: only rounds
// that exist. A round of more than MAX_DRAWN_MATCHES is one line, not a column. What has not been earned is one
// sentence at the end; it is never drawn with slots or names.
function pathBox(match) {
  // Compact: who is in it and who won. How a match stands is the round page's job.
  return el('li', { className: 'td-stage-match td-stage-path-match' }, [
    el(
      'div',
      { className: 'td-stage-sides' },
      match.sides.map((side) => sideRow(side)),
    ),
  ]);
}

const verbFor = (label) => (/s$/.test(label) ? 'are' : 'is');

function pathPage(payload) {
  const rounds = payload.rounds ?? [];
  if (rounds.length === 0) return null;
  const main = rounds.filter(isMain);
  const finalRound = main.find((r) => matchesOf(r).length === 1) ?? null;
  const before = main.filter((r) => r !== finalRound).slice(-2);
  const third = rounds.find((r) => r.phase === 'third_place') ?? null;
  const shown = [...before, finalRound, third].filter(Boolean);
  const columns = shown.filter((r) => matchesOf(r).length <= MAX_DRAWN_MATCHES);
  const collapsed = shown.filter((r) => matchesOf(r).length > MAX_DRAWN_MATCHES);
  const lastMain = main[main.length - 1];
  const futureNote =
    lastMain && matchesOf(lastMain).length > 1
      ? `Drawn when the ${roundName(lastMain)} ${verbFor(roundName(lastMain))} complete`
      : null;
  return {
    kind: 'path',
    label: 'Path to the final',
    render: () =>
      [
        stageKicker('Path to the final'),
        collapsed.length
          ? el('p', {
              className: 'td-stage-collapsed',
              text: collapsed
                .map(
                  (r) =>
                    `${roundName(r)} · ${matchesOf(r).every((m) => m.decided) ? 'complete' : 'under way'}`,
                )
                .join('   ·   '),
            })
          : null,
        el(
          'div',
          { className: 'td-stage-rounds' },
          [
            ...columns.map((round) =>
              el(
                'section',
                { className: 'td-stage-round', attrs: { 'aria-label': roundName(round) } },
                [
                  el('h3', { className: 'td-stage-round-title', text: roundName(round) }),
                  el(
                    'ul',
                    {
                      className: 'td-stage-list td-stage-path-list',
                      attrs: matchesOf(round).length > 4 ? { 'data-dense': 'true' } : {},
                    },
                    matchesOf(round).map(pathBox),
                  ),
                ],
              ),
            ),
            futureNote ? el('p', { className: 'td-stage-future', text: futureNote }) : null,
          ].filter(Boolean),
        ),
      ].filter(Boolean),
  };
}

function latestPage(payload) {
  const recent = (payload.recent ?? []).filter((m) => m.sides?.length === 2);
  if (recent.length === 0) return null;
  return {
    kind: 'latest',
    label: 'Latest results',
    render: () => [
      stageKicker('Latest results'),
      el(
        'ul',
        { className: 'td-stage-latest' },
        recent.map((match) => {
          const winner = match.sides.find((s) => s.winner);
          const loser = match.sides.find((s) => !s.winner);
          const split = matchStatus(match);
          return el(
            'li',
            { className: 'td-stage-latest-row' },
            [
              el('span', {
                className: 'td-stage-latest-line',
                text: `${nameOf(winner)} beat ${nameOf(loser)}${split ? ` · ${split}` : ''}`,
              }),
              match.roundLabel
                ? el('span', { className: 'td-stage-latest-round', text: match.roundLabel })
                : null,
            ].filter(Boolean),
          );
        }),
      ),
    ],
  };
}

export function throwdownPages(payload) {
  if (payload.phase === 'setup' || !(payload.rounds ?? []).length) {
    return [...meetPages(payload), howItWorksPage(payload)];
  }
  const pages = [
    upNextPage(payload),
    ...roundPages(payload),
    ...stillInPages(payload),
    pathPage(payload),
    latestPage(payload),
  ].filter(Boolean);
  return pages.length
    ? pages
    : [
        {
          kind: 'between',
          label: 'Between matches',
          render: () => [stageKicker('Between matches')],
        },
      ];
}

// Everything the pages say, and nothing they do not: a republish that changes none of it never restarts the loop.
function pagesSignature(payload) {
  return JSON.stringify([
    payload.phase,
    payload.competitorNames ?? null,
    payload.judgedRounds ?? null,
    payload.rounds ?? null,
    payload.upNext ?? null,
    payload.thenNext ?? null,
    payload.stillIn ?? null,
    payload.recent ?? null,
  ]);
}

const loopScreen = createLoopScreen({
  key: 'loop',
  pagesFor: throwdownPages,
  signatureOf: pagesSignature,
  dwellMs: PAGE_DWELL_MS,
  footerFor(page, _index, payload) {
    if (page.footer) return page.footer;
    const next = payload.upNext?.sides;
    return next?.length === 2 && page.kind !== 'next'
      ? `${page.label} · Up next: ${nameOf(next[0])} vs ${nameOf(next[1])}`
      : page.label;
  },
});

// ---------- the champion ----------

const championScreen = createChampionScreen({
  paint(payload) {
    const c = payload.champion;
    const podium = [
      c.runnerUp ? `Runner-up ${c.runnerUp}` : null,
      c.thirdPlace ? `3rd place ${c.thirdPlace}` : null,
    ]
      .filter(Boolean)
      .join('   ·   ');
    return {
      name: c.name,
      podiumLine: podium || null,
      footerStart: payload.competitors
        ? `Congratulations to all ${payload.competitors} competitors`
        : 'Congratulations to all competitors',
      footerEnd: 'Results stay on screen',
    };
  },
});

// Which screen this payload wants (null: nothing to show yet, the shell's own holding card covers that). A decided
// champion wins over the loop; the precedence is the whole logic.
export function selectThrowdownScreen(payload) {
  if (!hasThrowdownPublicContent(payload)) return null;
  return payload.champion ? championScreen : loopScreen;
}
