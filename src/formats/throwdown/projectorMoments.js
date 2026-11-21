// Throwdown's "what just happened" screens for the venue display, in core/momentPlayer.js's sense: found by comparing
// each live snapshot with the one before it, played one after another for 8 seconds each with a ring counting down
// to the change back to the loop.
//
//   Result recorded  a match was confirmed: both competitors, who goes through (or out), the vote split for a tap
//                    round, the winner only for a scoresheet round (D8: the payload carries no score, total, judge count or rule for one; "Match 2" is its place in the round), and
//                    a "Walkover" chip. The Final says Champion and Runner-up; a semi-final loser plays for third
//                    place when that match exists; the 3rd place match says Third place and Fourth place.
//   Round is set     a new main round appeared between two snapshots: "The quarter-finals are set", the pairings
//                    revealed one by one (instantly under reduced motion).
//
// Nothing is announced without an earlier snapshot (a display just opened has nothing to say happened), and a
// republish that only repeats what was shown is not news: a result is keyed by its match AND when it was confirmed
// (`confirmedAt`), a round by its id. The generic parts (the queue, the diff, the match card, the rise-in, the ring)
// are core/.
import { el } from '../../core/dom.js';
import { renderScreenFrame, mountFooterRing } from '../../core/stageDisplay.js';
import { revealOnMount } from '../../core/stageReveal.js';
import { detectNewResults } from '../../core/stageNewResults.js';
import { renderSide, renderVs } from '../../core/stageMatchCard.js';
import { stageKicker, stageTitle } from '../../core/stageVocabulary.js';
import { splitText, TO_BE_DECIDED } from './projectorScreens.js';

export const RESULT_HOLD_MS = 8_000;
export const ROUND_SET_HOLD_MS = 8_000;
// A round of more pairings than this reveals the first of them and says how many more there are.
export const MAX_PAIRINGS = 8;

const resultKey = (result) => `${result.id}|${result.confirmedAt}`;

// previous, next: two live payloads. Returns the moments for core/momentPlayer.js: [{ screen, payload }].
export function detectThrowdownMoments(previous, next) {
  if (!previous || !next) return [];
  // A snapshot published before rounds had ids cannot be compared: nothing is announced from it.
  if ((previous.rounds ?? []).some((round) => !round.id)) return [];
  const moments = detectNewResults(previous, next, {
    listOf: (snapshot) => snapshot.recent,
    keyOf: resultKey,
    orderBy: (result) => result.confirmedAt ?? '',
  })
    .filter((result) => result.sides?.length === 2)
    .map((result) => ({ screen: resultMoment, payload: { ...next, moment: { result } } }));

  // A round that was not there before: the pairings, after the result that earned it.
  if (Array.isArray(previous.rounds) && Array.isArray(next.rounds)) {
    const known = new Set(previous.rounds.map((round) => round.id));
    for (const round of next.rounds) {
      if (round.phase !== 'main' || !round.id || known.has(round.id)) continue;
      if (!(round.matches ?? []).some((match) => match.sides?.length)) continue;
      moments.push({ screen: roundSetMoment, payload: { ...next, moment: { round } } });
    }
  }
  return moments;
}

// ---------- the result screen ----------

const hasThirdPlace = (payload) => (payload.rounds ?? []).some((r) => r.phase === 'third_place');

// Words, never colour alone: what each side is called says whether it went through.
function sideLabel(result, won, third) {
  if (won) {
    if (result.role === 'final') return 'Champion';
    if (result.role === 'third_place') return 'Third place';
    return 'Goes through';
  }
  if (result.role === 'final') return 'Runner-up';
  if (result.role === 'third_place') return 'Fourth place';
  if (result.role === 'semi_final') return third ? 'Plays for third place' : 'Semi-finalist';
  return 'Out';
}

const resultMoment = {
  key: 'result',
  minDwellMs: RESULT_HOLD_MS,
  mount(host, payload) {
    const { result } = payload.moment;
    const third = hasThirdPlace(payload);
    const frame = renderScreenFrame();
    host.append(frame.el);
    const sideOf = (side) =>
      renderSide({
        label: sideLabel(result, side.winner === true, third),
        name: side.name ?? TO_BE_DECIDED,
        winner: side.winner === null || side.winner === undefined ? null : side.winner === true,
        // a tap round says its split; a scoresheet round has no number to say, and a walkover has no votes
        points: result.resultKind === 'votes' && typeof side.votes === 'number' ? side.votes : null,
        chips: side.winner && result.resultKind === 'walkover' ? [{ text: 'Walkover' }] : [],
      });
    const winner = result.sides.find((s) => s.winner);
    const loser = result.sides.find((s) => !s.winner);
    frame.main.replaceChildren(
      stageKicker(
        [
          'Result recorded',
          result.roundLabel,
          result.roundSize > 1 ? `Match ${result.number}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      renderVs(sideOf(result.sides[0]), sideOf(result.sides[1])),
    );
    const split = splitText(result);
    frame.footerStart.textContent = `${winner?.name ?? TO_BE_DECIDED} beat ${loser?.name ?? TO_BE_DECIDED}${
      split ? ` · ${split}` : result.resultKind === 'walkover' ? ' · Walkover' : ''
    }`;
    const ring = mountFooterRing(frame, RESULT_HOLD_MS);
    return { destroy: () => ring.destroy() };
  },
};

// ---------- the round-is-set screen ----------

const plural = (label) => /s$/.test(label);

export function roundSetTitle(label) {
  if (/^Round of /.test(label)) return `${label} is set`;
  const lower = label.toLowerCase();
  return plural(label) ? `The ${lower} are set` : `The ${lower} is set`;
}

function pairingText(match) {
  const [a, b] = match.sides;
  return b
    ? `${a.name ?? TO_BE_DECIDED} vs ${b.name ?? TO_BE_DECIDED}`
    : `${a.name ?? TO_BE_DECIDED} · Bye`;
}

const roundSetMoment = {
  key: 'round-set',
  minDwellMs: ROUND_SET_HOLD_MS,
  mount(host, payload) {
    const { round } = payload.moment;
    const label = round.roundLabel ?? round.label;
    const matches = round.matches ?? [];
    const frame = renderScreenFrame();
    host.append(frame.el);
    const shown = matches.slice(0, MAX_PAIRINGS);
    const body =
      matches.length === 1 && matches[0].sides.length === 2
        ? renderVs(
            renderSide({ name: matches[0].sides[0].name ?? TO_BE_DECIDED }),
            renderSide({ name: matches[0].sides[1].name ?? TO_BE_DECIDED }),
          )
        : revealOnMount(
            el(
              'ul',
              { className: 'td-stage-pairs' },
              [
                ...shown.map((match) =>
                  el('li', {
                    className: 'td-stage-pair stage-reveal-item',
                    text: pairingText(match),
                  }),
                ),
                matches.length > shown.length
                  ? el('li', {
                      className: 'td-stage-pair-more',
                      text: `+${matches.length - shown.length} more matches`,
                    })
                  : null,
              ].filter(Boolean),
            ),
          );
    frame.main.replaceChildren(
      stageKicker(`Round is set · ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`),
      stageTitle(roundSetTitle(label)),
      body,
    );
    frame.footerStart.textContent = label;
    const ring = mountFooterRing(frame, ROUND_SET_HOLD_MS);
    return { destroy: () => ring.destroy() };
  },
};
