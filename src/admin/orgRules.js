// What the database will accept as an organisation's name and link name, so the form can say so while a person
// types instead of after a round trip. The DATABASE IS THE AUTHORITY: `create_org` (migration 20261011160000)
// checks all of this again and its stable hint is what the form shows when it refuses (an organisation name that
// passes here and fails there is a drift to fix in this file, never a reason to trust the page).
//
// `orgRules.test.js` reads that migration and fails when the reserved list below stops matching it.
import { ADMIN_ERROR_COPY } from './adminErrors.js';

// The words a link name may not be (they are routes, or will be). Same words, same order as `v_reserved`.
export const RESERVED_SLUGS = Object.freeze([
  'app',
  'admin',
  'api',
  'www',
  'live',
  'results',
  'tour',
  'community',
  'tools',
  'guess-the-bean',
  'about',
  'contact',
  'privacy',
  'terms',
  'neutrality',
  'login',
  'signup',
  'auth',
  'assets',
  'bts',
  'marketing',
  'events',
  'team',
  'projector',
  'phone',
  'splash',
  'help',
  'docs',
  'support',
  'pricing',
  'status',
  'static',
  'settings',
  'dashboard',
]);

// The database trims space, tab, carriage return and line feed (and nothing else) before it judges.
export const trimmed = (value) => String(value ?? '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

const NAME_MAX = 80;
const SLUG_MIN = 3;
const SLUG_MAX = 40;
// What the database's name check refuses: control characters, bidirectional overrides, and a name made only of
// space-like characters (including no-break and zero-width ones).
const CONTROL = /\p{Cc}/u;
// Code point ranges, named by number so no invisible character is typed into this file.
const BIDI_RANGES = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
const SPACE_LIKE_RANGES = [
  [0x00a0, 0x00a0],
  [0x200b, 0x200d],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];
const inRanges = (character, ranges) => {
  const code = character.codePointAt(0);
  return ranges.some(([low, high]) => code >= low && code <= high);
};
const isSpaceLike = (character) => /\s/u.test(character) || inRanges(character, SPACE_LIKE_RANGES);
// Letters and digits, with a single hyphen allowed between two of them (case is folded to lower by the database).
const SLUG_SHAPE = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;

// The hint the database would answer with for this name, or null when it would accept it.
export function nameProblem(raw) {
  const name = trimmed(raw);
  // Postgres counts characters, not UTF-16 units: an emoji is one.
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX) return 'org_name_invalid';
  const characters = [...name];
  if (CONTROL.test(name) || characters.some((c) => inRanges(c, BIDI_RANGES)))
    return 'org_name_invalid';
  if (characters.every(isSpaceLike)) return 'org_name_invalid';
  return null;
}

// The hint the database would answer with for this link name, or null. Taken is only the database's to say.
export function slugProblem(raw) {
  const slug = trimmed(raw);
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_SHAPE.test(slug)) {
    return 'org_slug_invalid';
  }
  if (RESERVED_SLUGS.includes(slug.toLowerCase())) return 'org_slug_reserved';
  return null;
}

// The link name as the database will store it (trimmed and lower-cased), for showing the person what they will get.
export const normalisedSlug = (raw) => trimmed(raw).toLowerCase();

export const nameMessage = (raw) => {
  const hint = nameProblem(raw);
  return hint ? ADMIN_ERROR_COPY[hint] : null;
};

export const slugMessage = (raw) => {
  const hint = slugProblem(raw);
  return hint ? ADMIN_ERROR_COPY[hint] : null;
};

// A plausible email, enough to catch a typo before a request. The server (Auth) decides what is deliverable.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmailShaped = (raw) => EMAIL_SHAPE.test(String(raw ?? '').trim());
