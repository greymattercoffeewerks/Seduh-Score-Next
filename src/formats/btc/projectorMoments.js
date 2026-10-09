// BTC's "what just happened" screens for the venue display: when a match is confirmed the room sees its result,
// and in the preliminary round what it did to the top of the table. They are moments in core/momentPlayer.js's
// sense: found by comparing each live snapshot with the one before it, played one after another, each with a
// ring counting down to the change back to the ordinary screens. The generic parts (the queue, the movement
// rows, the rise-in, the ring) are core/; this module is only what is BTC: which snapshot change is news and
// what the two screens say.
//
// BTC's projector is sent snapshots, never events, so a "new result" is an entry in `recentResults` that the
// previous snapshot did not have. An entry is keyed by its match AND when it was last confirmed (liveSession.js:
// `confirmedAt` is the match row's updated_at), so a match re-scored, or one the organiser then decided by
// tie-break, is announced again with its new facts: that is news. Nothing is announced when:
//   - there is no earlier snapshot (the display was just opened: nothing is known to have happened; and
//     core/formatBody.js starts a new event's display with none, so one event's results are never compared
//     with another's);
//   - the snapshot only repeats what was already shown.
// A rank-impact screen follows only a PRELIMINARY result: in the knockout a result moves a team round the
// bracket, not up the table, and the bracket page says so. A result that is not the newest in its snapshot gets
// no rank screen of its own (the standings only show the end state).
import { el } from '../../core/dom.js';
import { renderScreenFrame, mountFooterRing } from '../../core/stageDisplay.js';
import { revealOnMount } from '../../core/stageReveal.js';
import { renderMovementRows } from '../../core/rankMovementRows.js';
import { rankImpactRows, leadMovement, topMover } from '../../core/rankImpact.js';
import { ordinalLabel } from '../../core/ordinal.js';
import { stageKicker } from '../../core/stageVocabulary.js';
import { renderSide, renderVs, matchLine } from './projectorScreens.js';

// Long enough to read the points and what they were made of, short enough that the room is not waiting.
export const RESULT_HOLD_MS = 8_000;
export const RANK_HOLD_MS = 8_000;

// ---------- reading two snapshots ----------

const resultKey = (result) => `${result.matchId}|${result.confirmedAt}`;
const hasPlayed = (row) => row.played > 0;
const byConfirmedAt = (a, b) =>
  Date.parse(a.confirmedAt) - Date.parse(b.confirmedAt) || (a.matchId < b.matchId ? -1 : 1);

// What the movement means, in the room's words (a team name is plural: "Grind House climb"). The lead first,
// but only when the lead changed: a lead that did not move is not news; then the biggest climb; then a newcomer.
function headlineFor(previous, next, rows) {
  const lead = leadMovement(previous.standings, next.standings, {
    keyOf: (row) => row.teamName,
    positionOf: (row) => row.position,
    labelOf: (row) => row.teamName,
    isRanked: hasPlayed,
  });
  if (lead && !lead.unchanged) {
    if (lead.kind === 'sole') return `${lead.label} take the lead`;
    return lead.namedTogether
      ? `${lead.labels[0]} and ${lead.labels[1]} share the lead`
      : `${lead.count} teams share the lead`;
  }
  // A shared place is said to be shared: "climb to joint 2nd", as the row's own "(tied)" says it.
  const placeOf = (row) => `${row.tied ? 'joint ' : ''}${ordinalLabel(row.position)}`;
  const climber = topMover(rows, 'up');
  if (climber) return `${climber.label} climb to ${placeOf(climber)}`;
  const newcomer = topMover(rows, 'entered');
  if (newcomer) return `${newcomer.label} join the table in ${placeOf(newcomer)}`;
  return null;
}

// `after` says what the movement followed: one match ("A vs B"), or how many results arrived together (a table
// that moved on several results cannot be pinned on the newest).
function rankImpact(previous, next, after) {
  const impact = rankImpactRows(previous.standings, next.standings, {
    keyOf: (row) => row.teamName,
    positionOf: (row) => row.position,
    labelOf: (row) => row.teamName,
    isRanked: hasPlayed,
  });
  if (!impact) return null;
  const headline = headlineFor(previous, next, impact.rows);
  // A match that did not touch the top of the table has nothing to say about it.
  if (!headline || !impact.moved) return null;
  return { headline, afterMatch: after, rows: impact.rows, more: impact.more };
}

// previous, next: two live payloads. Returns the moments for core/momentPlayer.js: [{ screen, payload }].
export function detectBtcMoments(previous, next) {
  if (!previous || !next) return [];
  const seen = new Set((previous.recentResults ?? []).map(resultKey));
  const fresh = (next.recentResults ?? []).filter(
    (result) => result.teams?.length === 2 && !seen.has(resultKey(result)),
  );
  if (fresh.length === 0) return [];
  fresh.sort(byConfirmedAt);

  const moments = fresh.map((result) => ({
    screen: resultMoment,
    payload: { ...next, moment: { result } },
  }));
  const newest = fresh[fresh.length - 1];
  if (newest.round === 'preliminary') {
    const after = fresh.length > 1 ? `${fresh.length} new results` : matchLine(newest);
    const impact = rankImpact(previous, next, after);
    if (impact) moments.push({ screen: rankMoment, payload: { ...next, moment: impact } });
  }
  return moments;
}

// ---------- the screens ----------

// Words, never colour alone: what each side is called says whether it went through.
const WINNER_LABELS = {
  preliminary: 'Winner',
  final: 'Champion',
  third_place: 'Third place',
};
// A semifinal's loser is not out: the loser plays for third place.
const LOSER_LABELS = {
  preliminary: 'Lost',
  semifinal: 'Plays for third place',
  final: 'Runner-up',
  third_place: 'Fourth place',
};

function sideLabel(result, winner) {
  if (winner === null) return 'Level';
  return winner
    ? (WINNER_LABELS[result.round] ?? 'Goes through')
    : (LOSER_LABELS[result.round] ?? 'Out');
}

function chipsFor(team, result) {
  const chips = [{ text: `${team.tokens} ${team.tokens === 1 ? 'token' : 'tokens'}` }];
  if (team.bonuses?.win) chips.push({ text: '+5 won the match' });
  if (team.bonuses?.fastest) chips.push({ text: '+2 fastest' });
  if (team.bonuses?.signature) chips.push({ text: '+2 signature beverage' });
  if (team.winner && result.tiebreak) {
    chips.push({ text: `Tie-break: ${result.tiebreak.reason}`, kind: 'tiebreak' });
  }
  return chips;
}

// Level on points with nobody chosen. Only a knockout can be decided by the organiser (a tie-break is recorded
// for a knockout match alone), so the preliminary round just says it is level; a final or third place has
// nobody to "go through", it has someone who takes the title or the place.
const LEVEL_NOTES = {
  final: 'The organiser decides who takes the title.',
  third_place: 'The organiser decides who takes third place.',
};
function levelNote(result) {
  if (result.round === 'preliminary') return null;
  return LEVEL_NOTES[result.round] ?? 'The organiser decides who goes through.';
}

function footerForResult(result) {
  const winner = result.teams.find((team) => team.winner);
  if (!winner) {
    return result.round === 'preliminary'
      ? 'Level on points'
      : 'Level on points: waiting for the organiser’s decision';
  }
  switch (result.round) {
    case 'preliminary':
      return `${winner.name} win`;
    case 'final':
      return `${winner.name} are the champions`;
    case 'third_place':
      return `${winner.name} take third place`;
    default:
      return `${winner.name} go through`;
  }
}

const resultMoment = {
  key: 'result',
  minDwellMs: RESULT_HOLD_MS,
  mount(host, payload) {
    const { result } = payload.moment;
    const frame = renderScreenFrame();
    host.append(frame.el);
    const anyWinner = result.teams.some((team) => team.winner);
    const sideOf = (team) =>
      renderSide({
        label: sideLabel(result, anyWinner ? team.winner : null),
        name: team.name,
        winner: anyWinner ? team.winner : null,
        points: team.total,
        chips: chipsFor(team, result),
      });
    frame.main.replaceChildren(
      stageKicker(
        `Result recorded · ${result.roundLabel}${result.level && !anyWinner ? ' · level on points' : ''}`,
      ),
      renderVs(sideOf(result.teams[0]), sideOf(result.teams[1])),
    );
    const note = result.level && !anyWinner ? levelNote(result) : null;
    if (note) frame.main.append(el('p', { className: 'btc-stage-note', text: note }));
    frame.footerStart.textContent = footerForResult(result);
    frame.footerEnd.textContent = '';
    const ring = mountFooterRing(frame, RESULT_HOLD_MS);
    return { destroy: () => ring.destroy() };
  },
};

const rankMoment = {
  key: 'rank',
  minDwellMs: RANK_HOLD_MS,
  mount(host, payload) {
    const { headline, afterMatch, rows, more } = payload.moment;
    const frame = renderScreenFrame();
    host.append(frame.el);
    frame.main.replaceChildren(
      stageKicker(`Rank impact · ${afterMatch}`),
      el('h2', { className: 'stage-title stage-move-title', text: headline }),
      revealOnMount(renderMovementRows(rows, { more })),
    );
    frame.footerStart.textContent = `Standings after ${afterMatch}`;
    const ring = mountFooterRing(frame, RANK_HOLD_MS);
    return { destroy: () => ring.destroy() };
  },
};
