// Cup Taster's venue-display screens (the projector, finding #5 of the 2026-10-04 event: "too much at once,
// not enough event feel"). One screen per moment, each readable from across a room, instead of the phone's
// dense page stretched to a projector: the heat on stage with its countdown, "being scored", an idle loop of
// "up next" and the standings in pages, and the champion.
//
// All the machinery — the band, when to change screen, paging, the page-change ring — is format-agnostic and
// lives in core/ (stageDisplay, screenDirector, pageRotator, progressRing); this module is only what is
// Cup Taster: which payload wants which screen, and what each screen says. A second format's projector is
// its own selector and screens on the same core pieces.
//
// The payload is viewerBody.js's documented contract plus two additive fields (liveSession.js): `eventName`
// and `upNext` ({ heatNumber, stageKind, cuppers: [{ displayName, station }] }). Both may be missing (a payload
// published before they existed): the band then has no event name and the idle loop has no "up next" page.
import { el, withSrExpansion } from '../../core/dom.js';
import { renderScreenFrame } from '../../core/stageDisplay.js';
import { renderCountdown } from '../../core/countdownDisplay.js';
import { formatDuration, formatDurationLong } from '../../core/duration.js';
import { paginate, pageRange, createPageRotator } from '../../core/pageRotator.js';
import { createProgressRing } from '../../core/progressRing.js';
import { stageKindLabel } from './setup.js';
import { formatHeatName } from './heats.js';
import { isNoClockHeat, showsCountdown, cupperStatus } from './viewerBody.js';

// Eight rows of standings are readable from the back of a 1080p room; more is the old shrunk table again.
export const STANDINGS_PAGE_SIZE = 8;
// Long enough to find your name and read the row, short enough that the loop is not a wait.
export const PAGE_DWELL_MS = 10_000;
// More stations than this in one heat take the compact three-column layout (projectorScreens.css), so two rows
// of cards still fit under the title and the clock on any screen.
export const MAX_ROOMY_STATIONS = 4;
// A "being scored" card is held at least this long, so it is not flashed past by the next update.
const SCORING_MIN_DWELL_MS = 8_000;
// The champion stays up; only a running heat (urgent) replaces it sooner than this.
const CHAMPION_MIN_DWELL_MS = 60_000;

// ---------- what the band says ----------

export function projectorBand(payload) {
  return {
    eventName: payload?.eventName ?? null,
    sectionLabel: payload?.stage ? stageKindLabel(payload.stage.kind) : null,
    live: true,
  };
}

// ---------- small shared pieces ----------

function kicker(text) {
  return el('p', { className: 'projector-kicker', text });
}

function bigTitle(text) {
  return el('h2', { className: 'projector-title', text });
}

function standingLine(row, stage) {
  if (!row) return null;
  const correct =
    stage?.setCount != null ? `${row.numCorrect}/${stage.setCount}` : `${row.numCorrect}`;
  return `${correct} · ${row.totalElapsedSecs == null ? '—' : formatDuration(row.totalElapsedSecs)}`;
}

// One cupper's card: the station, the name, and how they are getting on, in words (never colour alone).
function stationCard(cupper) {
  return el(
    'li',
    { className: 'projector-station', attrs: { 'data-status': cupper.status ?? '' } },
    [
      el('span', {
        className: 'projector-station-label',
        text: cupper.station ? `Station ${cupper.station}` : 'Station',
      }),
      el('span', { className: 'projector-station-name', text: cupper.displayName }),
      cupper.note ? el('span', { className: 'projector-station-note', text: cupper.note }) : null,
    ].filter(Boolean),
  );
}

function upNextLine(payload) {
  return payload?.upNext
    ? `Up next: ${formatHeatName(payload.upNext.heatNumber, payload.upNext.kind)}`
    : '';
}

// ---------- screens ----------

// A heat is running (or its judges are timing it by hand): the one thing the room needs.
const heatScreen = {
  key: 'heat',
  urgent: true,
  minDwellMs: 0,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    let cleanup = null;
    let signature = null;

    function paint(next) {
      // The live feed republishes without anything on screen having changed; rebuilding the countdown then
      // would re-arm its one-time "under 10 seconds" and "time is up" announcements.
      const nextSignature = JSON.stringify([
        next.activeHeat,
        next.upNext ?? null,
        next.standings?.[0] ?? null,
        next.stage ?? null,
      ]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      cleanup?.();
      cleanup = null;
      const heat = next.activeHeat;
      const head = el('div', { className: 'projector-heat-head' }, [
        el('div', {}, [
          kicker('On stage now'),
          bigTitle(formatHeatName(heat.heatNumber, heat.kind)),
        ]),
      ]);
      if (showsCountdown(heat)) {
        const countdown = renderCountdown(heat, { className: 'projector-countdown' });
        cleanup = countdown.cleanup;
        head.append(
          el('div', { className: 'projector-clock' }, [
            el('span', { className: 'projector-clock-label', text: 'Time remaining' }),
            ...countdown.elements,
          ]),
        );
      } else if (isNoClockHeat(heat)) {
        head.append(
          el('div', { className: 'projector-clock' }, [
            el('span', { className: 'projector-clock-label', text: 'Timed by hand' }),
          ]),
        );
      }
      const cards = heat.cuppers.map((cupper) => {
        const status = cupperStatus(cupper);
        const note =
          status === 'done'
            ? `Finished ${formatDuration(cupper.totalElapsedSecs)}`
            : status === 'maxed'
              ? 'Max time'
              : 'Timing';
        return stationCard({ ...cupper, status, note });
      });
      frame.main.classList.toggle('projector-many', heat.cuppers.length > MAX_ROOMY_STATIONS);
      frame.main.replaceChildren(head, el('ul', { className: 'projector-stations' }, cards));
      frame.footerStart.textContent = upNextLine(next);
      const leader = next.standings?.[0];
      frame.footerEnd.textContent = leader
        ? `Leading: ${leader.displayName} · ${standingLine(leader, next.stage)}`
        : '';
    }

    paint(payload);
    return {
      update: paint,
      destroy() {
        cleanup?.();
        cleanup = null;
      },
    };
  },
};

// The clock has run out and the judges are confirming scores.
const scoringScreen = {
  key: 'scoring',
  urgent: false,
  minDwellMs: SCORING_MIN_DWELL_MS,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    function paint(next) {
      frame.main.replaceChildren(
        kicker('Time is up'),
        bigTitle(
          `${formatHeatName(next.activeHeat.heatNumber, next.activeHeat.kind)} is being scored`,
        ),
        el('p', {
          className: 'projector-support',
          text: 'Results appear here as soon as the judges confirm.',
        }),
      );
      frame.footerStart.textContent = upNextLine(next);
      frame.footerEnd.textContent = 'Standings update after scoring';
    }
    paint(payload);
    return { update: paint, destroy() {} };
  },
};

function renderNextPage(upNext) {
  return [
    kicker('Up next'),
    bigTitle(`${formatHeatName(upNext.heatNumber, upNext.kind)} starts soon`),
    el(
      'ul',
      { className: 'projector-stations' },
      upNext.cuppers.map((cupper) => stationCard(cupper)),
    ),
  ];
}

function renderStandingsPage(stage, page, range, pageCount) {
  const rows = page.map((row) => {
    // Words, never colour alone: a tie or an advancing place says so in the row itself. The suffix is its own
    // element so a long name is cut with an ellipsis and the suffix is never the part that goes.
    const suffix =
      row.tieStatus === 'tied' ? ' (tied)' : row.tieStatus === 'advancing' ? ' (advancing)' : '';
    return el('tr', { className: 'projector-standing-row' }, [
      el('td', { className: 'projector-standing-pos', text: String(row.position) }),
      el('td', { className: 'projector-standing-name' }, [
        el(
          'div',
          { className: 'projector-name-row' },
          [
            el('span', { className: 'projector-name-text', text: row.displayName }),
            suffix ? el('span', { className: 'projector-name-suffix', text: suffix }) : null,
          ].filter(Boolean),
        ),
      ]),
      el('td', {
        className: 'projector-standing-score',
        text:
          stage?.setCount != null ? `${row.numCorrect}/${stage.setCount}` : String(row.numCorrect),
      }),
      el(
        'td',
        { className: 'projector-standing-time' },
        row.totalElapsedSecs == null
          ? [document.createTextNode('—')]
          : withSrExpansion(
              formatDuration(row.totalElapsedSecs),
              formatDurationLong(row.totalElapsedSecs),
            ),
      ),
    ]);
  });
  return [
    el('div', { className: 'projector-standings-head' }, [
      bigTitle(`${stage ? stageKindLabel(stage.kind) : ''} standings`.trim()),
      el('span', {
        className: 'projector-range',
        text:
          pageCount === 1
            ? `${range.total} cuppers`
            : range.first === range.last
              ? `${range.first} of ${range.total}`
              : `${range.first} to ${range.last} of ${range.total}`,
      }),
    ]),
    el('table', { className: 'projector-standings' }, [el('tbody', {}, rows)]),
  ];
}

// Between heats: an "up next" page (when the organiser has a next heat), then the standings in pages,
// round and round, each held for PAGE_DWELL_MS with a ring counting down to the change.
const idleScreen = {
  key: 'idle',
  urgent: false,
  minDwellMs: 0,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    const ring = createProgressRing();
    let rotator = null;
    let signature = null;

    function build(next) {
      rotator?.stop();
      const standings = next.standings ?? [];
      const standingPages = paginate(standings, STANDINGS_PAGE_SIZE, {
        groupOf: (row) => row.position,
      });
      const pages = [];
      if (next.upNext) {
        pages.push({ kind: 'next', render: () => renderNextPage(next.upNext), label: 'Up next' });
      }
      standingPages.forEach((page, i) =>
        pages.push({
          kind: 'standings',
          render: () =>
            renderStandingsPage(
              next.stage,
              page,
              pageRange(standingPages, i),
              standingPages.length,
            ),
          label:
            standingPages.length > 1
              ? `Standings · page ${i + 1} of ${standingPages.length}`
              : 'Standings',
        }),
      );
      rotator = createPageRotator({
        pageCount: pages.length,
        dwellMs: PAGE_DWELL_MS,
        onPage(index, { dwellMs, startedAt }) {
          frame.main.classList.toggle(
            'projector-many',
            pages[index].kind === 'next' && next.upNext.cuppers.length > MAX_ROOMY_STATIONS,
          );
          frame.main.replaceChildren(...pages[index].render());
          // The page's own label, plus who is next while the "up next" page itself is not the one showing.
          frame.footerStart.textContent =
            next.upNext && pages[index].kind !== 'next'
              ? `${pages[index].label} · ${upNextLine(next)}`
              : pages[index].label;
          if (pages.length > 1) {
            frame.footerEnd.replaceChildren(ring.el);
            ring.run({ durationMs: dwellMs, startedAt });
          } else {
            ring.stop();
            frame.footerEnd.replaceChildren();
          }
        },
      });
      rotator.start();
    }

    function update(next) {
      // The live feed republishes without anything on screen having changed; restarting the loop then would
      // keep sending the room back to the first page.
      const nextSignature = JSON.stringify([
        next.upNext ?? null,
        next.standings ?? [],
        next.stage ?? null,
      ]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      build(next);
    }

    update(payload);
    return {
      update,
      destroy() {
        rotator?.stop();
        ring.destroy();
      },
    };
  },
};

// "2nd X · 3rd Y", or null. Standings positions are only ranked by tally, so after a tiebreak two cuppers can
// both read 1st (liveSession.js says why); the podium is shown only when 1st is held by exactly one cupper and
// that cupper is the champion, and each of 2nd and 3rd is named only if exactly one cupper holds it — left out
// whenever it could name the wrong people.
function podiumLine(standings, champion) {
  const at = (position) => standings.filter((r) => r.position === position);
  const [first] = at(1);
  if (at(1).length !== 1 || first.displayName !== champion) return null;
  const places = [
    [2, '2nd'],
    [3, '3rd'],
  ]
    .map(([position, label]) =>
      at(position).length === 1 ? `${label} ${at(position)[0].displayName}` : null,
    )
    .filter(Boolean);
  return places.length ? places.join('   ·   ') : null;
}

// The tournament is decided: the champion, full screen, held.
const championScreen = {
  key: 'champion',
  urgent: false,
  minDwellMs: CHAMPION_MIN_DWELL_MS,
  mount(host, payload) {
    const frame = renderScreenFrame();
    host.append(frame.el);
    function paint(next) {
      const standings = next.standings ?? [];
      // The champion's own row, by name — never a stand-in: with no match the score line is simply left out.
      const row = standings.find((r) => r.displayName === next.champion);
      const children = [
        el('p', { className: 'projector-champion-label', text: 'Champion' }),
        el('h2', { className: 'projector-champion-name', text: next.champion }),
        row
          ? el('p', { className: 'projector-champion-score', text: standingLine(row, next.stage) })
          : null,
        podiumLine(standings, next.champion)
          ? el('p', { className: 'projector-podium', text: podiumLine(standings, next.champion) })
          : null,
      ];
      frame.main.replaceChildren(...children.filter(Boolean));
      frame.footerStart.textContent = `${next.stage ? stageKindLabel(next.stage.kind) : 'Final'} complete`;
      frame.footerEnd.textContent = 'Final standings stay on screen';
    }
    paint(payload);
    return { update: paint, destroy() {} };
  },
};

// Which screen this payload wants (null: nothing to show yet, the shell's own holding card covers that).
// A decided tournament wins over everything; a heat running or being scored comes next; otherwise the idle
// loop. The precedence is the whole logic — what is on screen never depends on what was on before it.
export function selectProjectorScreen(payload) {
  if (!payload) return null;
  if (payload.champion) return championScreen;
  if (payload.activeHeat?.status === 'timing') return heatScreen;
  if (payload.activeHeat?.status === 'scoring') return scoringScreen;
  if (payload.upNext || payload.standings?.length > 0) return idleScreen;
  return null;
}

// The shell's hasContent predicate for this display: exactly "is there a screen for this payload", so the two
// can never disagree (a payload the shell calls content but no screen shows would leave a blank display).
export function hasProjectorContent(payload) {
  return selectProjectorScreen(payload) !== null;
}
