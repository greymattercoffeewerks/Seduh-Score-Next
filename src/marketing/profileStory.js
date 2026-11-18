// What a Seduh ID person's share-to-story card says (T-ID2.C3): pure, no DOM. It turns the profile door's normalised answer
// into the spec `core/storyCard.js` draws. HIGHLIGHTS ONLY (spec 14.5): the name, the founding number, the country, the
// headline counts, ONE result and the page address; never the record. Nothing is invented: every number is the page's own
// (`computeStats`), and the result's provenance words are the entry's own labels, so a self-reported result says so on the
// card. Nothing is called "verified" unless the page's own rule says so (recorded by Seduh Score, or a confirmed membership).
import { countryName } from '../core/country.js';
import { PUBLIC_SITE_ORIGIN } from '../core/countryPages.js';
import { cardCourse, photoSrc } from '../core/seduhProfile.js';
import {
  bestDetail,
  bestResult,
  computeStats,
  foundingText,
  hasSelfReported,
  initialsOf,
  ordinal,
  provenanceLabels,
  sortEntries,
} from './profileFormat.js';

export const STORY_STYLES = [
  { key: 'record', label: 'Whole record' },
  { key: 'latest', label: 'Latest result' },
];

// The counts that headline a card, in order (coached and volunteered are on the page, not the card).
const HEADLINE = new Set(['competed', 'judged', 'organised', 'podium', 'podiums']);

/** The page address, no scheme: "seduhscore.com/id/<handle>". */
export const personAddress = (handle) =>
  `${PUBLIC_SITE_ORIGIN.replace(/^https?:\/\/(www\.)?/, '')}/id/${handle}`;
/** The address the QR code opens. */
export const personUrl = (handle) => `${PUBLIC_SITE_ORIGIN}/id/${handle}`;

/** True when this profile may have a card: a name is public (a hidden name means no identity, so nothing to put on a card). */
export const canMakeStoryCard = (profile) => Boolean(profile?.identity?.displayName);

/** The newest competed entry that has a placing, else the newest competed one, else null. Undated entries sort last. */
export function latestResult(entries) {
  const competed = sortEntries(entries.filter((e) => e.kind === 'competed'));
  return competed.find((e) => e.placing !== null) ?? competed[0] ?? null;
}

/** Which styles the card offers: "Latest result" only when there is a competed entry to show. */
export function availableStyles(profile) {
  if (!canMakeStoryCard(profile)) return [];
  return STORY_STYLES.filter((s) => s.key === 'record' || latestResult(profile.entries) !== null);
}

const resultText = (entry) =>
  entry.placing !== null ? `${ordinal(entry.placing)} · ${entry.title}` : entry.title;

function provenanceLine(entry, entries) {
  const parts = [];
  if (entry) parts.push(provenanceLabels(entry).join(' · ') + '.');
  if (hasSelfReported(entries)) parts.push('Totals include self-reported entries.');
  return parts.join(' ');
}

/** "Certified: <title>" for the card's one chosen current certificate, or null. */
export function certifiedLine(profile) {
  const course = cardCourse(profile?.courses);
  return course ? `Certified: ${course.title}` : null;
}

/**
 * The spec for one style, or null when the profile has no public name.
 * @param {object} profile  a normalised, non-empty profile (core/seduhProfile.js)
 * @param {'record'|'latest'} style
 */
export function personStorySpec(profile, style = 'record') {
  if (!canMakeStoryCard(profile)) return null;
  const { identity, handle, entries } = profile;
  const name = identity.displayName;
  const founding = foundingText(identity.foundingNumber ?? null);
  const country = identity.countryCode
    ? (countryName(identity.countryCode) ?? identity.countryCode)
    : null;

  const latest = style === 'latest' ? latestResult(entries) : null;
  const best = style === 'latest' ? null : bestResult(entries);
  const shown = latest ?? best?.entry ?? null;
  const highlight = shown
    ? {
        label: latest ? 'Latest result' : best.verified ? 'Best verified result' : 'Best result',
        text: resultText(shown),
        detail: bestDetail(shown),
      }
    : null;

  // Both styles carry the headline counts; they differ in the eyebrow and in which one result is highlighted.
  const stats = computeStats(entries)
    .filter((s) => HEADLINE.has(s.label))
    .slice(0, 4);
  return {
    eyebrow: style === 'latest' ? 'Latest result' : 'Whole record',
    tile: founding ? `#${founding}` : '',
    tileWidth: 240,
    tileInitials: initialsOf(name),
    title: name,
    subtitle: country ?? '',
    // One optional short line under the name (C6b): "Certified: <title>", only for the ONE current certificate the person chose
    // (the door sends `on_card` only while courses are public and the certificate is current). Self-reported, so the provenance
    // line says so. Nothing is drawn when there is none.
    tagline: certifiedLine(profile),
    stats,
    highlight,
    provenance:
      [
        provenanceLine(shown, entries),
        cardCourse(profile.courses) ? 'Certificate self-reported.' : '',
      ]
        .filter(Boolean)
        .join(' ') || 'Scan to see the full record.',
    address: personAddress(handle),
  };
}

/** The photo address for the card, or null (the card then shows initials). Same rule as the page's own avatar. */
export const cardPhotoUrl = (profile, supabaseUrl) =>
  photoSrc(profile?.identity?.photoUrl ?? null, supabaseUrl);
