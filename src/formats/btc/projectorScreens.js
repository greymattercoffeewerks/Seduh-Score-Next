// BTC's venue-display screens (the projector, stage 3 of the BTC live surfaces). One screen per moment, each
// readable from across a room: an idle loop of "up next", the bracket and the standings in pages, and the
// champion. The "what just happened" screens (a result recorded, the table moving) are projectorMoments.js.
//
// All the machinery (the band, when to change screen, paging, the ring, the standings table, the champion
// block) is format-agnostic and lives in core/ (stageDisplay, screenDirector, stagePageLoop, stageVocabulary);
// this module is only what is BTC: which payload wants which screen, and what each screen says. The payload is
// formats/btc/liveSession.js's: eventName, phase, progress, standings, upNext / thenNext, recentResults,
// bracket and podium. Every field may be missing (a payload published before it existed): a screen that has
// nothing to draw is simply not part of the loop.
//
// There is no "urgent" screen: BTC has no running clock on the venue display (a round timer is a later
// feature), so nothing ever pre-empts the loop or a champion except news (a moment).
import { el } from '../../core/dom.js';
import { renderScreenFrame } from '../../core/stageDisplay.js';
import { paginate, pageRange } from '../../core/pageRotator.js';
import { createStagePageLoop } from '../../core/stagePageLoop.js';
import { sharedPositions } from '../../core/rankMovement.js';
import { ordinalLabel } from '../../core/ordinal.js';
import {
  stageKicker,
  stageTitle,
  renderStandingsHead,
  standingsRangeText,
  renderStandingsTable,
  renderChampion,
} from '../../core/stageVocabulary.js';

// Eight rows of standings are readable from the back of a 1080p room; more is a table nobody can read.
export const STANDINGS_PAGE_SIZE = 8;
// Long enough to find your team and read the row, short enough that the loop is not a wait.
export const PAGE_DWELL_MS = 10_000;
// The preliminary round's top eight reach the quarterfinals (generate_btc_bracket seeds eight, and refuses to
// until a tie across the cut-off is settled, so the standings say "qualify", never "go through", while it is open).
export const KNOCKOUT_PLACES = 8;
// The champion stays up; only news (a moment) replaces it sooner than this.
const CHAMPION_MIN_DWELL_MS = 60_000;

// ---------- what the band says ----------

const SECTION_LABELS = {
  preliminary: 'Preliminary round',
  knockout: 'Knockout',
  complete: 'Final result',
};

export function btcBand(payload) {
  return {
    eventName: payload?.eventName ?? null,
    sectionLabel: SECTION_LABELS[payload?.phase] ?? null,
    live: true,
  };
}

// ---------- small shared pieces (also used by the moments) ----------

export const matchLine = (match) => `${match.teams[0].name} vs ${match.teams[1].name}`;

// One side of a match card: a label (in words: "3rd in the table", "Goes through"), the team's name, and for a result its
// points and the chips that explain them. `winner` is true, false, or null when there is no winner to show
// (a match not yet played, or a tie nobody has decided).
export function renderSide({ label = null, name, winner = null, points = null, chips = [] }) {
  return el(
    'div',
    {
      className: 'btc-stage-side',
      attrs: winner === null ? {} : { 'data-winner': String(winner) },
    },
    [
      label ? el('span', { className: 'btc-stage-side-label', text: label }) : null,
      el('p', { className: 'btc-stage-side-name', text: name }),
      points === null ? null : el('p', { className: 'btc-stage-points', text: String(points) }),
      chips.length
        ? el(
            'div',
            { className: 'btc-stage-chips' },
            chips.map((chip) =>
              el('span', {
                className: 'btc-stage-chip',
                text: chip.text,
                attrs: chip.kind ? { 'data-kind': chip.kind } : {},
              }),
            ),
          )
        : null,
    ].filter(Boolean),
  );
}

export function renderVs(left, right) {
  return el('div', { className: 'btc-stage-vs' }, [
    left,
    el('span', { className: 'btc-stage-vs-mark', text: 'VS', attrs: { 'aria-hidden': 'true' } }),
    right,
  ]);
}

// ---------- idle loop pages ----------

function renderUpNextPage(match) {
  const [a, b] = match.teams;
  const knockout = match.round !== 'preliminary';
  // In the knockout a team's standings place says who it is, in the table's own words. It is not called a seed:
  // the bracket breaks a tie between teams with one place into distinct seeds, which this payload does not carry.
  const placeOf = (team) =>
    knockout && team.place ? `${ordinalLabel(team.place)} in the table` : null;
  const title =
    knockout && a.place && b.place
      ? `${ordinalLabel(a.place)} meets ${ordinalLabel(b.place)}`
      : match.roundLabel;
  return [
    stageKicker(`Up next · ${match.roundLabel}`),
    stageTitle(title),
    renderVs(
      renderSide({ label: placeOf(a), name: a.name }),
      renderSide({ label: placeOf(b), name: b.name }),
    ),
    match.judges?.length
      ? el('p', { className: 'btc-stage-judges', text: `Judges: ${match.judges.join(' · ')}` })
      : null,
  ].filter(Boolean);
}

// "top 8 qualify", or what is still undecided when teams with results share the place at the cut-off.
function qualifyingNote(standings) {
  const last = standings[KNOCKOUT_PLACES - 1];
  const after = standings[KNOCKOUT_PLACES];
  if (last && after && last.position === after.position && last.played > 0 && after.played > 0) {
    return `top ${KNOCKOUT_PLACES} qualify · tie for ${ordinalLabel(last.position)}`;
  }
  return `top ${KNOCKOUT_PLACES} qualify`;
}

function winsText(wins) {
  return `${wins} ${wins === 1 ? 'win' : 'wins'}`;
}

function renderStandingsPage(payload, page, range, pageCount) {
  const shared = sharedPositions(payload.standings, (row) => row.position);
  const rows = page.map((row) => ({
    position: row.position,
    name: row.teamName,
    // Words, never colour alone. A team that has not played yet is level with every other such team, which
    // is not news, so only a tie among teams with results is written in the row.
    suffix: row.played > 0 && shared.has(row.position) ? ' (tied)' : '',
    cells: [winsText(row.wins), `${row.points} pts`],
  }));
  const preliminary = payload.phase === 'preliminary';
  const progress = payload.progress;
  return [
    preliminary && progress?.total > 0
      ? stageKicker(`${progress.played} of ${progress.total} matches played`)
      : null,
    renderStandingsHead(
      preliminary ? 'Standings' : 'Preliminary standings',
      standingsRangeText(range, pageCount, 'teams'),
    ),
    renderStandingsTable(rows, [{ width: '12vw' }, { width: '14vw' }]),
  ].filter(Boolean);
}

const BRACKET_COLUMNS = [
  { head: 'Quarterfinals', rounds: ['quarterfinal'] },
  { head: 'Semifinals', rounds: ['semifinal'] },
  { head: 'Final and third place', rounds: ['final', 'third_place'] },
];
const SLOT_LABELS = { final: 'Final', third_place: 'Third place' };
// What the team that won a slot is written as, in words (the weight and outline only add emphasis).
const WINNER_MARKS = { final: 'Champion', third_place: 'Third' };

const hasWinner = (slot) => slot.teams.some((team) => team.winner === true);
// A confirmed slot whose totals are level and which the organiser has not yet decided.
const isLevelUndecided = (slot) => slot.level === true && !hasWinner(slot);

// The word beside a team in a slot, or null: who went through (and that the organiser decided it), or that the
// match is level. In the row, never under it, so a slot's height never depends on what it says.
function slotMark(slot, team, round) {
  if (team.winner === true) {
    const word = WINNER_MARKS[round] ?? 'Through';
    return slot.tiebreak
      ? { text: `${word} · tie-break`, kind: 'tiebreak' }
      : { text: word, kind: 'through' };
  }
  if (team.name !== null && isLevelUndecided(slot)) return { text: 'Level', kind: 'level' };
  return null;
}

function renderSlot(slot, round, label) {
  const played = slot.status === 'confirmed';
  return el(
    'div',
    { className: 'btc-stage-slot', attrs: { 'data-played': String(played) } },
    [
      label ? el('span', { className: 'btc-stage-slot-label', text: label }) : null,
      ...slot.teams.map((team) => {
        const mark = slotMark(slot, team, round);
        return el(
          'div',
          {
            className: 'btc-stage-slot-team',
            attrs: {
              'data-winner': String(team.winner === true),
              ...(team.name === null ? { 'data-tbd': 'true' } : {}),
            },
          },
          [
            el('span', { text: team.name ?? 'To be decided' }),
            mark
              ? el('span', {
                  className: 'btc-stage-slot-mark',
                  text: mark.text,
                  attrs: { 'data-kind': mark.kind },
                })
              : null,
            el('span', { text: team.total === null ? '' : String(team.total) }),
          ].filter(Boolean),
        );
      }),
    ].filter(Boolean),
  );
}

function renderBracketPage(bracket) {
  const roundsByKey = new Map(bracket.rounds.map((round) => [round.round, round]));
  const columns = BRACKET_COLUMNS.map(({ head, rounds }) => {
    const slots = rounds.flatMap((key) =>
      (roundsByKey.get(key)?.slots ?? []).map((slot) =>
        renderSlot(slot, key, rounds.length > 1 ? SLOT_LABELS[key] : null),
      ),
    );
    return el('div', { className: 'btc-stage-round' }, [
      el('span', { className: 'btc-stage-round-head', text: head }),
      ...slots,
    ]);
  });
  const levelCount = bracket.rounds.flatMap((round) => round.slots).filter(isLevelUndecided).length;
  return [
    stageKicker(
      levelCount > 0 ? `Bracket · ${levelCount} level, awaiting the organiser` : 'Bracket',
    ),
    el('div', { className: 'btc-stage-bracket' }, columns),
  ];
}

function bracketProgress(bracket) {
  const slots = bracket.rounds.flatMap((round) => round.slots);
  return `${slots.filter((slot) => slot.status === 'confirmed').length} of ${slots.length} played`;
}

// ---------- the idle loop ----------

// Between matches: an "up next" page, the bracket once it exists, then the standings in pages, round and round,
// each held for PAGE_DWELL_MS with a ring counting down to the change.
const idleScreen = {
  key: 'idle',
  urgent: false,
  minDwellMs: 0,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    const loop = createStagePageLoop(frame, { dwellMs: PAGE_DWELL_MS });
    let signature = null;

    function build(next) {
      const standings = next.standings ?? [];
      const standingPages = paginate(standings, STANDINGS_PAGE_SIZE, {
        groupOf: (row) => row.position,
      });
      const pages = [];
      if (next.upNext) {
        pages.push({
          kind: 'next',
          render: () => renderUpNextPage(next.upNext),
          label: 'Up next',
          footer: next.thenNext
            ? `Then: ${next.thenNext.roundLabel} · ${matchLine(next.thenNext)}`
            : 'Up next',
        });
      }
      if (next.bracket) {
        pages.push({
          kind: 'bracket',
          render: () => renderBracketPage(next.bracket),
          label: `Bracket · ${bracketProgress(next.bracket)}`,
        });
      }
      standingPages.forEach((page, i) =>
        pages.push({
          kind: 'standings',
          render: () =>
            renderStandingsPage(next, page, pageRange(standingPages, i), standingPages.length),
          label: [
            standingPages.length > 1
              ? `Standings · page ${i + 1} of ${standingPages.length}`
              : 'Standings',
            next.phase === 'preliminary' ? qualifyingNote(standings) : null,
          ]
            .filter(Boolean)
            .join(' · '),
        }),
      );
      loop.show(pages, {
        // The page's own label, plus who plays next while the "up next" page itself is not the one showing.
        footerFor: (page) =>
          page.footer ??
          (next.upNext && page.kind !== 'next'
            ? `${page.label} · Next: ${matchLine(next.upNext)}`
            : page.label),
      });
    }

    function update(next) {
      // The live feed republishes without anything on screen having changed; restarting the loop then would
      // keep sending the room back to the first page.
      const nextSignature = JSON.stringify([
        next.phase ?? null,
        next.progress ?? null,
        next.upNext ?? null,
        next.thenNext ?? null,
        next.standings ?? [],
        next.bracket ?? null,
      ]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      build(next);
    }

    update(payload);
    return {
      update,
      destroy() {
        loop.destroy();
      },
    };
  },
};

// ---------- the champion ----------

const placeOf = (payload, key) => payload.podium?.places?.find((place) => place.key === key);

// "Final 52 – 44", from the final's slot in the bracket (the champion's total first), plus how it was decided
// when the organiser had to. null when the totals are not there.
function finalScoreLine(payload) {
  const slot = payload.bracket?.rounds
    ?.find((round) => round.round === 'final')
    ?.slots?.find((candidate) => candidate.status === 'confirmed');
  if (!slot || slot.teams.some((team) => team.total === null)) return null;
  const ordered = [...slot.teams].sort((a, b) => Number(b.winner) - Number(a.winner));
  const line = `Final ${ordered[0].total} – ${ordered[1].total}`;
  return placeOf(payload, 'champion')?.viaTiebreak ? `${line}, decided by tie-break` : line;
}

// "1st runner-up X   ·   3rd place Y": only the places that are decided, never a guess.
function podiumLine(payload) {
  const parts = ['runnerUp', 'third']
    .map((key) => placeOf(payload, key))
    .filter((place) => place?.state === 'decided')
    .map((place) => `${place.label} ${place.teamName}`);
  return parts.length ? parts.join('   ·   ') : null;
}

const championScreen = {
  key: 'champion',
  urgent: false,
  minDwellMs: CHAMPION_MIN_DWELL_MS,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    function paint(next) {
      const champion = placeOf(next, 'champion');
      frame.main.replaceChildren(
        ...renderChampion({
          name: champion?.teamName ?? '',
          scoreLine: finalScoreLine(next),
          podiumLine: podiumLine(next),
        }),
      );
      const teams = (next.standings ?? []).length;
      frame.footerStart.textContent = teams
        ? `Congratulations to all ${teams} teams`
        : 'Congratulations to all teams';
      frame.footerEnd.textContent = 'Results stay on screen';
    }
    paint(payload);
    return { update: paint, destroy() {} };
  },
};

// ---------- which screen ----------

// Which screen this payload wants (null: nothing to show yet, the shell's own holding card covers that). A
// decided champion wins over everything; otherwise the idle loop, once there is a match to announce, a bracket
// or standings to show. The precedence is the whole logic: what is on screen never depends on what was on
// before it.
export function selectBtcScreen(payload) {
  if (!payload) return null;
  if (placeOf(payload, 'champion')?.state === 'decided') return championScreen;
  if (payload.phase === 'setup') return null;
  if (payload.upNext || payload.bracket || payload.standings?.length > 0) return idleScreen;
  return null;
}

// The shell's hasContent predicate for this display: exactly "is there a screen for this payload", so the two
// can never disagree (a payload the shell calls content but no screen shows would leave a blank display).
export function hasBtcProjectorContent(payload) {
  return selectBtcScreen(payload) !== null;
}
