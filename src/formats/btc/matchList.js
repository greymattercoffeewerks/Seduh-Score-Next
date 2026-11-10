// What the matches screen says about one preliminary match, as pure functions (Organiser UX S3, spec item U2). The
// grouping and the row layout are core/groupedMatchList.js's; this file is only what BTC means by a status, a score
// and "can this still be removed". No DOM, no database.
import { parseDuration } from '../../core/duration.js';

// A row's status as the list draws it. An unknown or missing status reads as pending (a database default; older
// fixtures have none).
export function matchStatusView(match) {
  if (match.status === 'confirmed') return { label: 'Confirmed', tone: 'done' };
  if (match.status === 'scoring') return { label: 'Scoring', tone: 'in_progress' };
  return { label: 'Scheduled', tone: 'not_started' };
}

// `score` is the match's btc_match_scores row ({ match_id, team1_tokens, team2_tokens, team1_total, team2_total })
// or undefined. Cups have been voted when the tokens add up to more than 0 (each cup carries exactly 3).
export function hasCupScores(score) {
  return (Number(score?.team1_tokens) || 0) + (Number(score?.team2_tokens) || 0) > 0;
}

// Q7: Remove exists to undo a duplicate or a wrong pairing, so it shows only while the match is pending and nothing
// is scored. `scoresKnown` is false when the scores could not be read: then the screen cannot prove "no scores", so
// it does not offer Remove (the database still decides, and a later policy refuses it too: P1). A screen rule only.
export function canRemoveMatch(match, score, scoresKnown = true) {
  if (!scoresKnown) return false;
  const status = match.status ?? 'pending';
  return status === 'pending' && !hasCupScores(score);
}

// "34 – 28" once confirmed, else null. Totals are the bonus-inclusive ones the standings use.
export function matchScoreText(match, score) {
  if (match.status !== 'confirmed' || !score) return null;
  const a = score.team1_total;
  const b = score.team2_total;
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return `${a} – ${b}`;
}

// A confirmed preliminary match with either finish time missing or unusable (the same rule as the dashboard's count).
export function missingTime(match) {
  if (match.status !== 'confirmed') return false;
  const usable = (note) => (parseDuration(note) ?? 0) > 0;
  return !usable(match.team1_time_note) || !usable(match.team2_time_note);
}
