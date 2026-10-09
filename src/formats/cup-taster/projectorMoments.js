// Cup Taster's "what just happened" screens for the venue display: when a heat's result is recorded, the room
// sees that heat's result, then what it did to the top of the table. They are moments in core/momentPlayer.js's
// sense — found by comparing each live snapshot with the one before it, played one after another, each with a
// ring counting down to the change back to the ordinary screens. The generic parts (the queue, the movement
// rows, the rise-in, the ring) are core/; this module is only what is Cup Taster: which snapshot change is news
// and what the two screens say.
//
// Cup Taster's projector is sent snapshots, never events, so a "new result" is a heat in `recentHeats` that
// the previous snapshot did not have, and a "rank impact" is the standings before against the standings after
// (core/rankMovement.js). Both are skipped, never guessed at, when the snapshots cannot be compared safely:
//   - a different stage (the lists are about different cuppers);
//   - two ranked cuppers with one display name (a movement could be pinned on the wrong person);
//   - no earlier snapshot (the display was just opened: nothing is known to have happened).
// A tiebreak heat's result is announced but never gets a rank screen: standings ignore tiebreak outcomes, so
// the table would read as still tied right after the room was shown who won. A heat reaches `recentHeats` only
// while it is among the three newest confirmed heats (in running order), so a heat confirmed out of order below
// those is not announced (it is in the standings regardless).
//
// "Played" below means the standings show a time or a correct answer for the cupper. A time is written when a
// cupper's timer stops, before the heat is confirmed, so with two heats in flight at once a cupper who has
// stopped but not been confirmed already counts as ranked.
import { el } from '../../core/dom.js';
import { renderScreenFrame, mountFooterRing } from '../../core/stageDisplay.js';
import { revealOnMount } from '../../core/stageReveal.js';
import { renderMovementRows } from '../../core/rankMovementRows.js';
import { rank } from '../../core/ranking.js';
import { rankMovement, sharedPositions } from '../../core/rankMovement.js';
import { ordinalLabel } from '../../core/ordinal.js';
import { formatDuration } from '../../core/duration.js';
import { formatHeatName, byRunningOrder } from './heats.js';
import { compareRecentHeatResults } from './viewerBody.js';
import { stageKicker, stageTitle } from '../../core/stageVocabulary.js';
import { upNextLine, MAX_ROOMY_STATIONS } from './projectorScreens.js';

// Long enough to read a heat's results, short enough that the room is not waiting on the screen.
export const RESULT_HOLD_MS = 6_000;
export const RANK_HOLD_MS = 8_000;
// The rank screen is about the top of the table: places up to this one, ties included, capped by the maximum.
const RANK_TOP_PLACE = 5;
const RANK_MAX_ROWS = 8;
// Two co-leaders' names together longer than this are not strung into one headline (it would not fit the
// screen): the headline says how many share the lead instead.
const HEADLINE_NAMES_MAX_CHARS = 40;

// ---------- reading two snapshots ----------

const heatKey = (heat) => `${heat.stageKind}|${heat.kind ?? 'normal'}|${heat.heatNumber}`;
const sameStage = (a, b) => Boolean(a && b && a.kind === b.kind && a.ordinal === b.ordinal);
// A cupper who has no result yet sits tied at the bottom of the standings: they have not earned a place.
const hasPlayed = (row) => row.totalElapsedSecs != null || row.numCorrect > 0;
const inRunningOrder = (a, b) =>
  byRunningOrder(
    { kind: a.kind, heat_number: a.heatNumber },
    { kind: b.kind, heat_number: b.heatNumber },
  );

function headlineFor(previous, next) {
  const leadersOf = (standings) =>
    (standings ?? []).filter((row) => row.position === 1 && hasPlayed(row));
  const leaders = leadersOf(next.standings);
  if (leaders.length === 0) return null;
  if (leaders.length === 1) {
    const [leader] = leaders;
    const before = leadersOf(previous.standings);
    const stays = before.length === 1 && before[0].displayName === leader.displayName;
    return stays ? `${leader.displayName} stays in front` : `${leader.displayName} takes the lead`;
  }
  const names = leaders.map((row) => row.displayName);
  return leaders.length === 2 && names.join('').length <= HEADLINE_NAMES_MAX_CHARS
    ? `${names[0]} and ${names[1]} share the lead`
    : `${leaders.length} cuppers share the lead`;
}

function rankImpact(previous, next, afterHeat) {
  const standings = next.standings ?? [];
  const movement = rankMovement(previous.standings, standings, {
    keyOf: (row) => row.displayName,
    positionOf: (row) => row.position,
    isRanked: hasPlayed,
  });
  if (!movement) return null;
  const headline = headlineFor(previous, next);
  const ranked = standings.filter(hasPlayed);
  const shared = sharedPositions(ranked, (row) => row.position);
  const top = ranked.filter((row) => row.position <= RANK_TOP_PLACE);
  const rows = top.slice(0, RANK_MAX_ROWS).map((row) => ({
    position: row.position,
    displayName: row.displayName,
    tied: shared.has(row.position),
    ...movement.get(row.displayName),
  }));
  // A heat that did not touch the top of the table has nothing to say about it.
  if (!headline || !rows.some((row) => row.change !== 'same')) return null;
  return { headline, afterHeat, rows, more: top.length - rows.length };
}

// previous, next: two live payloads. Returns the moments for core/momentPlayer.js: [{ screen, payload }].
export function detectProjectorMoments(previous, next) {
  if (!previous || !next || !sameStage(previous.stage, next.stage)) return [];
  const seen = new Set((previous.recentHeats ?? []).map(heatKey));
  const fresh = (next.recentHeats ?? []).filter(
    (heat) => !seen.has(heatKey(heat)) && heat.results?.length > 0,
  );
  if (fresh.length === 0) return [];
  fresh.sort(inRunningOrder);

  const moments = fresh.map((heat) => ({
    screen: resultMoment,
    payload: { ...next, moment: { heat } },
  }));
  if (fresh.some((heat) => heat.kind === 'tiebreak')) return moments;
  const newest = fresh[fresh.length - 1];
  const impact = rankImpact(previous, next, formatHeatName(newest.heatNumber, newest.kind));
  if (impact) moments.push({ screen: rankMoment, payload: { ...next, moment: impact } });
  return moments;
}

// ---------- the screens ----------

function resultLine(result, setCount) {
  const correct =
    setCount != null
      ? `${result.numCorrect} of ${setCount} correct`
      : `${result.numCorrect} correct`;
  // A timed-out entry says so (D22) rather than showing the capped figure as if they had finished on it.
  const time = result.maxed
    ? 'Max time'
    : result.totalElapsedSecs == null
      ? 'no time'
      : formatDuration(result.totalElapsedSecs);
  return `${correct} · ${time}`;
}

// Words, never colour alone: the place is written out, and a shared place says so.
function resultCard({ item, position }, tied, setCount) {
  return el('li', { className: 'projector-station stage-reveal-item' }, [
    el('span', {
      className: 'projector-station-label',
      text: tied ? `Joint ${ordinalLabel(position)}` : ordinalLabel(position),
    }),
    el('span', { className: 'projector-station-name', text: item.displayName }),
    el('span', { className: 'projector-station-note', text: resultLine(item, setCount) }),
  ]);
}

const resultMoment = {
  key: 'result',
  minDwellMs: RESULT_HOLD_MS,
  mount(host, payload) {
    const { heat } = payload.moment;
    const frame = renderScreenFrame();
    host.append(frame.el);
    const placed = rank(heat.results ?? [], compareRecentHeatResults);
    const shared = sharedPositions(placed, (entry) => entry.position);
    const cards = placed.map((entry) =>
      resultCard(entry, shared.has(entry.position), payload.stage?.setCount),
    );
    frame.main.classList.toggle('projector-many', cards.length > MAX_ROOMY_STATIONS);
    frame.main.replaceChildren(
      stageKicker('Result recorded'),
      stageTitle(formatHeatName(heat.heatNumber, heat.kind)),
      revealOnMount(el('ul', { className: 'projector-stations projector-results' }, cards)),
    );
    frame.footerStart.textContent = upNextLine(payload);
    const ring = mountFooterRing(frame, RESULT_HOLD_MS);
    return { destroy: () => ring.destroy() };
  },
};

const rankMoment = {
  key: 'rank',
  minDwellMs: RANK_HOLD_MS,
  mount(host, payload) {
    const { headline, afterHeat, rows, more } = payload.moment;
    const frame = renderScreenFrame();
    host.append(frame.el);
    frame.main.replaceChildren(
      stageKicker('Rank impact'),
      el('h2', { className: 'stage-title projector-move-title', text: headline }),
      revealOnMount(
        renderMovementRows(
          rows.map((row) => ({ ...row, label: row.displayName })),
          { more },
        ),
      ),
    );
    frame.footerStart.textContent = `Standings after ${afterHeat}`;
    const ring = mountFooterRing(frame, RANK_HOLD_MS);
    return { destroy: () => ring.destroy() };
  },
};
