// Words and order for a Seduh ID person page: pure, no DOM. Everything here works on the normalised entries from
// core/seduhProfile.js, so a new record source (self-reported, the organiser's records) needs no change in this file.
import {
  ENTRY_KINDS,
  PROVENANCE_SELF,
  TEAM_RESULT_LABEL,
  membershipLabel,
  profileProvenanceLabel,
} from '../core/seduhProfile.js';
import { ordinalLabel as ordinal } from '../core/ordinal.js';
import { formatLabel } from './resultsScreen.js';

export { ordinal };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const KIND_LABELS = {
  competed: 'Competed',
  judged: 'Judged',
  organised: 'Organised',
  coached: 'Coached',
  volunteered: 'Volunteered',
};
// The summary line's wording ("11 competed").
const KIND_VERBS = {
  competed: 'competed',
  judged: 'judged',
  organised: 'organised',
  coached: 'coached',
  volunteered: 'volunteered',
};

/** "0001": the founding number padded to four digits, or null. */
export function foundingText(n) {
  if (!Number.isInteger(n) || n < 1) return null;
  return String(n).padStart(4, '0');
}

/** The line under an entry's title: organiser, team, place, and the format in words. */
export function metaText(entry) {
  return [
    entry.kind !== 'competed' ? KIND_LABELS[entry.kind] : null,
    entry.organiser,
    entry.team ? (entry.country ? `${entry.team} (${entry.country})` : entry.team) : null,
    entry.location,
    entry.format ? formatLabel(entry.format) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Up to two capital letters from a name, for the avatar until photos exist. "?" when there is nothing usable. */
export function initialsOf(name) {
  const words = String(name ?? '')
    .split(/\s+/)
    .map((w) => [...w].find((c) => /\p{L}|\p{N}/u.test(c)))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked.join('').toUpperCase();
}

/** "Mar 2026" from an ISO date, "2026" from a bare year, "" from nothing. */
export function dateText(entry) {
  if (entry.date) {
    const month = Number(entry.date.slice(5, 7));
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${entry.date.slice(0, 4)}`;
  }
  return entry.year ? String(entry.year) : '';
}

/** Newest first: by date, then year; undated last; the input order is kept for equals (the door sends newest first). */
export function sortEntries(entries) {
  const key = (e) => e.date ?? (e.year ? `${e.year}-00-00` : '');
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ka = key(a.entry);
      const kb = key(b.entry);
      if (ka !== kb) return ka === '' ? 1 : kb === '' ? -1 : ka < kb ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** Which kinds are present, in the fixed display order. */
export function kindsPresent(entries) {
  const seen = new Set(entries.map((e) => e.kind));
  return ENTRY_KINDS.filter((kind) => seen.has(kind));
}

export function filterEntries(entries, kind) {
  return kind === 'all' ? entries : entries.filter((e) => e.kind === kind);
}

/** "18 entries: 11 competed, 3 judged, 4 organised". */
export function summaryLine(entries) {
  if (entries.length === 0) return '';
  const total = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
  const parts = kindsPresent(entries).map(
    (kind) => `${entries.filter((e) => e.kind === kind).length} ${KIND_VERBS[kind]}`,
  );
  return parts.length > 1
    ? `${total}: ${parts.join(', ')}`
    : `${total}, all ${KIND_VERBS[kindsPresent(entries)[0]]}`;
}

/** Groups by year, newest first, undated last. `entries` is sorted first. The newest group is the one to open. */
export function groupByYear(entries) {
  const groups = [];
  for (const entry of sortEntries(entries)) {
    const label = entry.year ? String(entry.year) : 'Undated';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

const isVouched = (e) => e.provenance !== PROVENANCE_SELF;
// VERIFIED (owner decision 2026-11-17): recorded by Seduh Score, or an organiser's team result whose membership is confirmed
// (a team link the person made themselves is their own claim until the owner confirms it; a missing membership is not confirmed).
const isVerified = (e) =>
  e.provenance === 'seduh_score' || (isVouched(e) && e.membership === 'confirmed');

/**
 * The stats row. It counts EVERYTHING on the page (self-reported too) by kind, and podiums among competed entries, so it
 * always agrees with the record below it; the screen says that self-reported entries are included. Only kinds that
 * occur are shown. Empty when the page has no entries.
 */
export function computeStats(entries) {
  if (entries.length === 0) return [];
  const stats = [];
  for (const kind of ENTRY_KINDS) {
    const n = entries.filter((e) => e.kind === kind).length;
    if (n > 0) stats.push({ value: String(n), label: KIND_VERBS[kind] });
  }
  const podiums = entries.filter(
    (e) => e.kind === 'competed' && e.placing !== null && e.placing <= 3,
  ).length;
  if (entries.some((e) => e.kind === 'competed')) {
    stats.push({ value: String(podiums), label: podiums === 1 ? 'podium' : 'podiums' });
  }
  return stats;
}

/** True when any entry in the list is self-reported (the stats note says so). */
// (a team link's membership is the person's own claim until it is confirmed, so it counts as reported by them too)
export const hasSelfReported = (entries) =>
  entries.some((e) => !isVouched(e) || e.membership === 'self_reported');

const bestOf = (candidates) => {
  let best = null;
  for (const entry of sortEntries(candidates)) {
    if (best === null || entry.placing < best.placing) best = entry;
  }
  return best;
};

/**
 * The best-result card's entry, from the first of three tiers that has a placed competed entry: (1) VERIFIED (recorded by
 * Seduh Score, or a team result with a confirmed membership; Seduh Score's own record first on a tie of placing), (2) an
 * organiser's team result whose membership is still self-reported, (3) the person's own entries. Within a tier the lowest
 * placing wins, the newest on a tie. Returns `{ entry, verified }` or null; only tier 1 is `verified`, and the card shows
 * the entry's own labels either way, so nothing is mixed silently.
 */
export function bestResult(entries) {
  const placed = entries.filter((e) => e.kind === 'competed' && e.placing !== null);
  const verified = placed.filter(isVerified);
  if (verified.length > 0) {
    const recorded = bestOf(verified.filter((e) => e.provenance === 'seduh_score'));
    const organiser = bestOf(verified.filter((e) => e.provenance !== 'seduh_score'));
    const entry =
      recorded && (!organiser || recorded.placing <= organiser.placing) ? recorded : organiser;
    return { entry, verified: true };
  }
  const team = bestOf(placed.filter((e) => isVouched(e) && !isVerified(e)));
  if (team) return { entry: team, verified: false };
  const own = bestOf(placed);
  return own ? { entry: own, verified: false } : null;
}

/** One entry's detail line for the card: "8 / 8 correct · 2:13" style text is already in `detail`; this adds the date. */
export function bestDetail(entry) {
  return [entry.organiser, entry.team, dateText(entry)].filter(Boolean).join(' · ');
}

/** The labels under an entry. A team link has TWO (the team result is the organiser's, the membership the person's). */
export function provenanceLabels(entry) {
  if (entry.membership) return [TEAM_RESULT_LABEL, membershipLabel(entry.membership)];
  return [profileProvenanceLabel(entry.provenance)];
}

/** The right-hand cell of an entry: a real placing ("1st"), or nothing. The kind of an entry is a small label in its meta line. */
export function placeText(entry) {
  return entry.placing !== null ? ordinal(entry.placing) : '';
}

/** Knockout record in words, or null when there is none (the section is then hidden). */
export function knockoutText(knockout) {
  const played = knockout.won + knockout.lost;
  if (played === 0) return null;
  return `${knockout.won} won · ${knockout.lost} lost`;
}
