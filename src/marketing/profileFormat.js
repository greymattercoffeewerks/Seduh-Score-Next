// Words and order for a Seduh ID person page: pure, no DOM. Everything here works on the normalised entries from
// core/seduhProfile.js, so a new record source (self-reported, the organiser's records) needs no change in this file.
import { ENTRY_KINDS, PROVENANCE_SELF } from '../core/seduhProfile.js';
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
    entry.organiser,
    entry.team,
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

// Totals and the best result count only what Seduh Score or an organiser vouches for: a self-reported entry is never
// counted in a "recorded" total (spec 14.4), so a person cannot raise their own numbers.
const vouched = (entries) => entries.filter((e) => e.provenance !== PROVENANCE_SELF);

/** The stats row: results, podiums, organisers, best placing. Empty when nothing vouched-for was competed. */
export function computeStats(entries) {
  const competed = vouched(entries).filter((e) => e.kind === 'competed');
  if (competed.length === 0) return [];
  const placings = competed.map((e) => e.placing).filter((p) => p !== null);
  const organisers = new Set(competed.map((e) => e.organiser).filter(Boolean));
  const stats = [
    { value: String(competed.length), label: competed.length === 1 ? 'result' : 'results' },
    { value: String(placings.filter((p) => p <= 3).length), label: 'podiums' },
  ];
  if (organisers.size > 0)
    stats.push({
      value: String(organisers.size),
      label: organisers.size === 1 ? 'organiser' : 'organisers',
    });
  if (placings.length > 0)
    stats.push({ value: ordinal(Math.min(...placings)), label: 'best place' });
  return stats;
}

/** The best vouched-for competed result: lowest placing, newest on a tie. Null when none has a placing. */
export function bestResult(entries) {
  const ranked = sortEntries(
    vouched(entries).filter((e) => e.kind === 'competed' && e.placing !== null),
  );
  let best = null;
  for (const entry of ranked) if (best === null || entry.placing < best.placing) best = entry;
  return best;
}

/** One entry's detail line for the card: "8 / 8 correct · 2:13" style text is already in `detail`; this adds the date. */
export function bestDetail(entry) {
  return [entry.organiser, dateText(entry)].filter(Boolean).join(' · ');
}

/** The right-hand cell of an entry: "1st", or the role word when there is no placing. */
export function placeText(entry) {
  if (entry.placing !== null) return ordinal(entry.placing);
  return entry.kind === 'competed' ? '' : KIND_LABELS[entry.kind];
}

/** Knockout record in words, or null when there is none (the section is then hidden). */
export function knockoutText(knockout) {
  const played = knockout.won + knockout.lost;
  if (played === 0) return null;
  return `${knockout.won} won · ${knockout.lost} lost`;
}
