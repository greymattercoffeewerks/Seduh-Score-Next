// What BTC's audience surfaces (the projector and the phone) say about a match, a table and a slot, in one place,
// so the two can never word the same fact differently. Pure strings from the published payload
// (formats/btc/liveSession.js); nothing here recomputes who won: a team's `winner` flag, a match's `level` and
// `tiebreak` and a standings row's `position` are the payload's own.
import { ordinalLabel } from '../../core/ordinal.js';

// The preliminary round's top eight reach the quarterfinals (generate_btc_bracket seeds eight, and refuses to
// until a tie across the cut-off is settled, so the surfaces say "qualify", never "go through", while it is open).
export const KNOCKOUT_PLACES = 8;

export const matchLine = (match) => `${match.teams[0].name} vs ${match.teams[1].name}`;

export function winsText(wins) {
  return `${wins} ${wins === 1 ? 'win' : 'wins'}`;
}

// "top 8 qualify", or what is still undecided when teams with results share the place at the cut-off.
export function qualifyingNote(standings) {
  const last = standings[KNOCKOUT_PLACES - 1];
  const after = standings[KNOCKOUT_PLACES];
  if (last && after && last.position === after.position && last.played > 0 && after.played > 0) {
    return `top ${KNOCKOUT_PLACES} qualify · tie for ${ordinalLabel(last.position)}`;
  }
  return `top ${KNOCKOUT_PLACES} qualify`;
}

// What a win means in each round, with the team named: the preliminary round is won, a knockout match sends a
// team through, the final makes a champion and third place is taken.
export function winnerPhrase(round, name) {
  switch (round) {
    case 'preliminary':
      return `${name} win`;
    case 'final':
      return `${name} are the champions`;
    case 'third_place':
      return `${name} take third place`;
    default:
      return `${name} go through`;
  }
}

// Level on points with nobody chosen. Only a knockout can be decided by the organiser (a tie-break is recorded
// for a knockout match alone), so the preliminary round just says it is level.
export function levelPhrase(round) {
  return round === 'preliminary'
    ? 'Level on points'
    : 'Level on points: waiting for the organiser’s decision';
}

// One result card's outcome, in a sentence: "Bean Scene go through", "Level on points: ...".
export function outcomeLine(result) {
  const winner = result.teams.find((team) => team.winner);
  return winner ? winnerPhrase(result.round, winner.name) : levelPhrase(result.round);
}

// A bracket slot's outcome, or null when it has not been played: who went through (and that the organiser
// decided it, with the typed reason), or that it is level and waiting.
export function slotOutcome(slot, round) {
  if (slot.status !== 'confirmed') return null;
  const winner = slot.teams.find((team) => team.winner === true);
  if (!winner) return slot.level ? levelPhrase(round) : null;
  const phrase = winnerPhrase(round, winner.name);
  return withTiebreak(phrase, slot.tiebreak);
}

export const podiumPlace = (payload, key) =>
  payload.podium?.places?.find((place) => place.key === key);

// "Final 52 – 44", from the final's slot in the bracket (the champion's total first), plus how it was decided
// when the organiser had to. null when the totals are not there.
export function finalScoreLine(payload) {
  const slot = payload.bracket?.rounds
    ?.find((round) => round.round === 'final')
    ?.slots?.find((candidate) => candidate.status === 'confirmed');
  if (!slot || slot.teams.some((team) => team.total === null)) return null;
  const ordered = [...slot.teams].sort((a, b) => Number(b.winner) - Number(a.winner));
  const line = `Final ${ordered[0].total} – ${ordered[1].total}`;
  return podiumPlace(payload, 'champion')?.viaTiebreak ? `${line}, decided by tie-break` : line;
}

// ---------- the band, and what counts as something to show ----------

const SECTION_LABELS = {
  preliminary: 'Preliminary round',
  knockout: 'Knockout',
  complete: 'Final result',
};

// What the permanent header of an audience surface says: the event, and which part of the competition this is.
export function btcBand(payload) {
  return {
    eventName: payload?.eventName ?? null,
    sectionLabel: SECTION_LABELS[payload?.phase] ?? null,
    live: true,
  };
}

// Whether a payload has anything to show an audience (the projector's screen selector and the phone's shell
// predicate both ask this, so the two can never disagree about "not published yet"): a decided champion, or,
// once the event is past setup, an up-next match, a bracket or standings.
export function hasBtcPublicContent(payload) {
  if (!payload) return false;
  if (podiumPlace(payload, 'champion')?.state === 'decided') return true;
  if (payload.phase === 'setup') return false;
  return Boolean(payload.upNext || payload.bracket || payload.standings?.length > 0);
}

// ---------- phrases both surfaces use ----------

export const TO_BE_DECIDED = 'To be decided';

export const upNextKicker = (roundLabel) => `Up next · ${roundLabel}`;
export const judgesLine = (judges) => (judges?.length ? `Judges: ${judges.join(' · ')}` : null);
export const thenLine = (match) => `Then: ${match.roundLabel} · ${matchLine(match)}`;
export const matchesPlayedLine = (progress) =>
  progress?.total > 0 ? `${progress.played} of ${progress.total} matches played` : null;
export const standingsHeading = (phase) =>
  phase === 'preliminary' ? 'Standings' : 'Preliminary standings';

// " (tied)" for a team whose place is shared with another team that has a result: a field with no results yet is
// level with itself, which is not news. `shared` is core/rankMovement.js's sharedPositions of the standings.
export const tiedSuffix = (row, shared) =>
  row.played > 0 && shared.has(row.position) ? ' (tied)' : '';

// The podium places that are decided (never a guess), runner-up then third.
export const decidedPodiumPlaces = (payload) =>
  ['runnerUp', 'third']
    .map((key) => podiumPlace(payload, key))
    .filter((place) => place?.state === 'decided');

// The organiser's recorded tie-break, as text: "Tie-break: Sudden-death cup".
export const tiebreakText = (tiebreak) => `Tie-break: ${tiebreak.reason}`;
export const withTiebreak = (phrase, tiebreak) =>
  tiebreak ? `${phrase} · ${tiebreakText(tiebreak)}` : phrase;

// ---------- who a knockout team is ----------

// A knockout match's two teams are introduced by their seeds, the ones the bracket gave them (the payload's
// `seed`), when BOTH have one: never one seed beside one table place. Otherwise (a payload from before seeds
// were published, or a team the bracket never seeded) by where each stands in the table (`place`): tied teams
// share a place, so a place is never called a seed. The preliminary round has no knockout tags (a place there is
// only "so far"). Returns [tagA, tagB]; a tag is null when nothing is known about that team.
export function knockoutTags(match) {
  if (match.round === 'preliminary') return [null, null];
  const [a, b] = match.teams;
  if (a.seed && b.seed) return [`Seed ${a.seed}`, `Seed ${b.seed}`];
  return match.teams.map((team) =>
    team.place ? `${ordinalLabel(team.place)} in the table` : null,
  );
}

// "Seed 1 meets seed 8" ("1st meets 8th" without seeds); null for the preliminary round and when either team has
// neither a seed nor a place.
export function knockoutMeeting(match) {
  if (match.round === 'preliminary') return null;
  const [a, b] = match.teams;
  if (a.seed && b.seed) return `Seed ${a.seed} meets seed ${b.seed}`;
  if (a.place && b.place) return `${ordinalLabel(a.place)} meets ${ordinalLabel(b.place)}`;
  return null;
}
