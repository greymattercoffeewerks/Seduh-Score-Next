// Words and order for the country pages: pure, no DOM. Names of stages and rounds, how a team's rounds read
// ("Prelims 42+31=73 · QF 26"), the best finish in words, and which countries come first in the hub.
import { countryName } from '../core/country.js';

export const STAGE_LABELS = {
  champion: 'Champion',
  final: 'Finalist',
  semi_final: 'Semi-final',
  quarter_final: 'Quarter-final',
  preliminary: 'Preliminaries',
  entered: 'Entered',
};

const ROUND_LABELS = {
  preliminary: 'Prelims',
  quarter_final: 'QF',
  semi_final: 'SF',
  final_champion: 'Final',
  final_runner_up: 'Final',
};

export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** "Champion", "Runner-up", "4th place", or the stage's own words when no number was published. */
export function finishText(stage, placement) {
  if (stage === 'champion') return 'Champion';
  if (stage === 'final') return 'Runner-up';
  if (placement) return `${ordinal(placement)} place`;
  return STAGE_LABELS[stage] ?? stage;
}

/** "Prelims 42+31=73 · QF 26": a team's published scores, in playing order. Empty string when it has none. */
export function roundsText(rounds) {
  return rounds
    .map((round) => {
      const label = ROUND_LABELS[round.round] ?? round.round;
      return round.r1 !== null && round.r2 !== null
        ? `${label} ${round.r1}+${round.r2}=${round.score}`
        : `${label} ${round.score}`;
    })
    .join(' · ');
}

/** The same, for a screen reader: words, not symbols. */
export function roundsSpoken(rounds) {
  return rounds
    .map((round) => {
      const label =
        ROUND_LABELS[round.round] === 'QF'
          ? 'Quarter-final'
          : ROUND_LABELS[round.round] === 'SF'
            ? 'Semi-final'
            : (ROUND_LABELS[round.round] ?? round.round);
      const base =
        round.r1 !== null && round.r2 !== null
          ? `${label}: ${round.r1} plus ${round.r2}, total ${round.score}`
          : `${label}: ${round.score}`;
      return base; // what the screen shows: opponents are not on the page, so they are not read out either
    })
    .join('. ');
}

/** The years a team entered: "2023, 2024 and 2026". */
export function yearsText(years) {
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.join('');
  return `${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

// ASEAN's members (Timor-Leste joined in 2025). Other countries are guests: the competition has invited teams from
// further afield (Hong Kong and Taiwan so far).
export const ASEAN_MEMBERS = new Set([
  'BN',
  'KH',
  'ID',
  'LA',
  'MY',
  'MM',
  'PH',
  'SG',
  'TH',
  'TL',
  'VN',
]);

/**
 * Pure. Splits the hub's rows into ASEAN members and guests, each by name. `nameOf` is injectable for tests.
 * @returns {{ members: object[], guests: object[] }}
 */
export function groupCountries(rows, nameOf = (code) => countryName(code) ?? code) {
  const byName = (a, b) => nameOf(a.code).localeCompare(nameOf(b.code), 'en');
  return {
    members: rows.filter((row) => ASEAN_MEMBERS.has(row.code)).sort(byName),
    guests: rows.filter((row) => !ASEAN_MEMBERS.has(row.code)).sort(byName),
  };
}

/** The share card's address as printed: no scheme, no "www.", no trailing slash. */
export function addressText(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}
