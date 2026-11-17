// The anonymous read behind a Seduh ID person page: public.public_seduh_profile(p_handle) (migration 20261116100000,
// contract in CONVENTIONS.md "Seduh ID profile door"). The door never errors on input and answers `has_profile: false`
// for every non-page (unknown, closed, reserved, malformed), so "no page" is an answer, distinct from a failed request
// (a thrown error).
//
// The JSON comes from a database function, but this is a public page: every field is rebuilt here from known keys and
// type-checked, so a malformed or future-shaped answer shows less, never throws, and reaches the DOM only as text.
// Pure shaping (normaliseProfile) is split from the read (fetchSeduhProfile) so tests need no client.
//
// The four record lists of the door (recorded_results, organiser_records, self_reported, judging_roles) are folded into
// ONE list of entries, each carrying its provenance, so the screen never branches on which list a row came from: a
// seam that starts returning rows (Phase C) appears with no change to the page. recorded_results has a fixed shape
// (CONVENTIONS.md); `self_reported` and `organiser_records` (team links) are pinned since T-ID2.D-b; `judging_roles` is still an
// empty seam whose row shape is PROVISIONAL and tolerant. When it is built, pin its shape here and in seduhProfile.test.js.
import { formatDuration } from './duration.js';
import { ordinalLabel } from './ordinal.js';
import { getSupabase } from './supabaseClient.js';

export const PROVENANCE_SEDUH_SCORE = 'seduh_score';
export const PROVENANCE_ORGANISER = 'organiser_archive';
export const PROVENANCE_SELF = 'self_reported';

// Words for where a row came from. An unknown value is treated as the cautious one (self-reported): never claim more
// than we know.
export const PROVENANCE_LABELS = {
  [PROVENANCE_SEDUH_SCORE]: 'Recorded by Seduh Score',
  [PROVENANCE_ORGANISER]: 'From the organiser’s records',
  [PROVENANCE_SELF]: 'Self-reported, not verified by Seduh',
};
/** The words for a team link's membership: the person's own claim until the platform confirms it. */
export function membershipLabel(membership) {
  return membership === 'confirmed' ? 'Membership confirmed' : 'Membership self-reported';
}
export const TEAM_RESULT_LABEL = 'Team result from the organiser’s records';
export function profileProvenanceLabel(provenance) {
  return PROVENANCE_LABELS[provenance] ?? PROVENANCE_LABELS[PROVENANCE_SELF];
}

export const ENTRY_KINDS = ['competed', 'judged', 'organised', 'coached', 'volunteered'];

const text = (value, max = 200) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);
const int = (value) => (Number.isFinite(value) ? Math.trunc(value) : null);
const list = (value) => (Array.isArray(value) ? value : []);
const isoDate = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
// The year always follows the date when there is one, so sorting (by date) and grouping (by year) cannot disagree.
const yearOf = (rawYear, date) => {
  if (date) return Number(date.slice(0, 4));
  const y = int(rawYear);
  return y !== null && y >= 1900 && y <= 2200 ? y : null;
};

function recordedEntry(raw) {
  const title = text(raw?.event_name, 120);
  if (!title) return null;
  const date = isoDate(raw.event_date);
  const correct = int(raw.correct);
  const total = int(raw.total);
  const detail = [
    text(raw.stage, 60),
    correct !== null && total !== null ? `${correct} / ${total} correct` : null,
    int(raw.time_secs) !== null && raw.time_secs >= 0 ? formatDuration(int(raw.time_secs)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const placing = int(raw.placing);
  return {
    kind: 'competed',
    provenance: PROVENANCE_SEDUH_SCORE,
    title,
    organiser: text(raw.organiser_name, 80),
    // The format key is passed on raw: core never names a format. The page words it (marketing/profileFormat.js).
    format: text(raw.format, 40),
    team: null,
    country: null,
    membership: null,
    location: null,
    detail,
    date,
    year: yearOf(null, date),
    placing: placing !== null && placing >= 1 ? placing : null,
    correct,
    total,
    timeSecs: int(raw.time_secs),
  };
}

// The two record shapes the door returns for a person's own record (T-ID2.D-a, pinned by D-b). Both rebuild every field from
// known keys; provenance is forced by the list a row came from, never by what the row claims.
//
// A self-reported ENTRY (`self_reported`): {year, competition_name, location, kind, role, result_text, placement, note}.
const STAGE_WORDS = {
  champion: 'Champion',
  final: 'Runner-up',
  semi_final: 'Semi-final',
  quarter_final: 'Quarter-final',
  preliminary: 'Preliminaries',
  entered: 'Entered',
};
/** Pure. A team result in words, ONE wording for the person page and My Seduh ID: "Champion", "Runner-up", "4th place", or the stage. */
export function teamResultWords({ placement, stage_reached: stage }) {
  if (stage === 'champion') return 'Champion';
  if (stage === 'final') return 'Runner-up';
  if (Number.isInteger(placement) && placement >= 1) return `${ordinalLabel(placement)} place`;
  return STAGE_WORDS[stage] ?? '';
}
const ROLE_WORDS = { member: 'Member', captain: 'Captain', coach: 'Coach', reserve: 'Reserve' };

const emptyEntry = {
  organiser: null,
  format: null,
  team: null,
  country: null,
  location: null,
  membership: null,
  detail: '',
  date: null,
  correct: null,
  total: null,
  timeSecs: null,
};

function selfEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.competition_name ?? raw.title ?? raw.event_name, 120);
  if (!title) return null;
  const kind = ENTRY_KINDS.includes(raw.kind) ? raw.kind : 'competed';
  const placing = int(raw.placement ?? raw.placing);
  return {
    ...emptyEntry,
    kind,
    provenance: PROVENANCE_SELF,
    title,
    location: text(raw.location, 80),
    detail: [text(raw.role, 60), text(raw.result_text, 80), text(raw.note ?? raw.detail, 160)]
      .filter(Boolean)
      .join(' · '),
    year: yearOf(raw.year, null),
    placing: placing !== null && placing >= 1 ? placing : null,
  };
}

// A team link (`organiser_records`): {competition, competition_name, edition_year, team_name, country_code, stage_reached,
// placement, role, membership}. The TEAM RESULT is the organiser's; the MEMBERSHIP is the person's until it is confirmed:
// `membership` is 'self_reported' (also for any value we do not know: never claim more than we know) or 'confirmed'.
function teamEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.competition_name, 120);
  if (!title) return null;
  const stage = typeof raw.stage_reached === 'string' ? raw.stage_reached : null;
  let placing = int(raw.placement);
  if (placing === null || placing < 1) {
    placing = stage === 'champion' ? 1 : stage === 'final' ? 2 : null;
  }
  const result = teamResultWords({ placement: placing, stage_reached: stage }) || null;
  const country = typeof raw.country_code === 'string' ? raw.country_code.trim().toUpperCase() : '';
  return {
    ...emptyEntry,
    kind: 'competed',
    provenance: PROVENANCE_ORGANISER,
    title,
    team: text(raw.team_name, 80),
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    membership: raw.membership === 'confirmed' ? 'confirmed' : 'self_reported',
    detail: [ROLE_WORDS[raw.role] ?? null, result].filter(Boolean).join(' · '),
    year: yearOf(raw.edition_year, null),
    placing: placing !== null && placing >= 1 ? placing : null,
  };
}

// A judging role (`judging_roles`) is still an empty seam: a tolerant, PROVISIONAL shape, forced to self-reported unless the
// row says the organiser or Seduh Score vouches for it.
function judgingEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.title ?? raw.event_name ?? raw.competition_name ?? raw.name, 120);
  if (!title) return null;
  const date = isoDate(raw.event_date ?? raw.date);
  const vouched = [PROVENANCE_SEDUH_SCORE, PROVENANCE_ORGANISER].includes(raw.provenance);
  return {
    ...emptyEntry,
    kind: 'judged',
    provenance: vouched ? raw.provenance : PROVENANCE_SELF,
    title,
    organiser: text(raw.organiser_name, 80),
    location: text(raw.location, 80),
    detail: [text(raw.role, 60), text(raw.detail ?? raw.note, 160)].filter(Boolean).join(' · '),
    date,
    year: yearOf(raw.year, date),
    placing: null,
  };
}

function normaliseOpponent(raw) {
  const displayName = text(raw?.display_name, 80);
  if (!displayName) return null;
  return {
    displayName,
    matches: count(raw.matches),
    won: count(raw.won),
    lost: count(raw.lost),
  };
}

function normaliseAffiliation(raw) {
  const name = text(raw?.name ?? raw?.cafe_name ?? raw?.cafe, 100);
  return name ? { name, role: text(raw.role, 60) } : null;
}

// ---- the profile photo (T-ID2.C2) ----
// The door returns a RELATIVE path under the project's public Storage (the database cannot know the project's address). Only that
// exact shape is accepted, so a malformed value can never become an <img src>; the page adds its own Supabase origin.
export const AVATAR_BUCKET = 'seduh-avatars';
const AVATAR_URL =
  /^\/storage\/v1\/object\/public\/seduh-avatars\/([a-z0-9](?:-?[a-z0-9])*)\/([0-9a-f]{32}\.(?:webp|jpg))$/;
/** Pure. The photo's relative URL when it has the one accepted shape (and, when a handle is given, is in that handle's folder), else null. */
export function cleanPhotoUrl(value, handle = null) {
  if (typeof value !== 'string' || value.length > 160) return null;
  const match = AVATAR_URL.exec(value);
  if (!match) return null;
  return handle && match[1] !== handle ? null : value;
}
/** Pure. 'folder/file.ext' (the Storage object name) from a cleaned relative URL, or null. */
export function photoObjectName(photoUrl) {
  const match = AVATAR_URL.exec(String(photoUrl ?? ''));
  return match ? `${match[1]}/${match[2]}` : null;
}
/** Pure. The absolute address of a cleaned photo URL on the given Supabase origin, or null (https, or http on this machine only). */
export function photoSrc(photoUrl, supabaseUrl) {
  if (!cleanPhotoUrl(photoUrl)) return null;
  try {
    const base = new URL(String(supabaseUrl));
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local)) return null;
    return base.origin + photoUrl;
  } catch {
    return null;
  }
}

export const EMPTY_PROFILE = Object.freeze({
  hasProfile: false,
  handle: null,
  identity: null,
  entries: [],
  knockout: { won: 0, lost: 0, opponents: [] },
  affiliations: [],
});

/** Pure. Rebuilds the door's answer; anything malformed becomes the "no page" shape. */
export function normaliseProfile(raw) {
  if (!raw || typeof raw !== 'object' || raw.has_profile !== true) return { ...EMPTY_PROFILE };
  const handle = text(raw.handle, 40);
  if (!handle) return { ...EMPTY_PROFILE };
  const id = raw.identity && typeof raw.identity === 'object' ? raw.identity : {};
  const displayName = text(id.display_name, 120);
  const country = typeof id.country_code === 'string' ? id.country_code.trim().toUpperCase() : '';
  const founding = int(id.founding_number);
  const entries = [
    ...list(raw.recorded_results).map(recordedEntry),
    ...list(raw.organiser_records).map(teamEntry),
    ...list(raw.self_reported).map(selfEntry),
    ...list(raw.judging_roles).map(judgingEntry),
  ].filter(Boolean);
  const ko =
    raw.knockout_record && typeof raw.knockout_record === 'object' ? raw.knockout_record : {};
  return {
    hasProfile: true,
    handle,
    // null when the person hides their identity block (every key null): the page then shows the handle.
    identity: displayName
      ? {
          displayName,
          countryCode: /^[A-Z]{2}$/.test(country) ? country : null,
          foundingNumber: founding !== null && founding >= 1 ? founding : null,
          // null unless the door sent the one accepted relative shape (a hidden identity never gets here: displayName is null).
          photoUrl: cleanPhotoUrl(id.photo_url, handle),
        }
      : null,
    entries,
    knockout: {
      won: count(ko.won),
      lost: count(ko.lost),
      opponents: list(ko.opponents).map(normaliseOpponent).filter(Boolean).slice(0, 10),
    },
    affiliations: list(raw.cafe_affiliations).map(normaliseAffiliation).filter(Boolean),
  };
}

/** The handle a path names, lower-cased, or null: only /id/<one segment>/ is a person page. */
export function handleFromPath(pathname) {
  const match = /^\/id\/([A-Za-z0-9_-]{1,64})\/?$/.exec(String(pathname ?? ''));
  return match ? match[1].toLowerCase() : null;
}

export async function fetchSeduhProfile(handle, client = getSupabase()) {
  const { data, error } = await client.rpc('public_seduh_profile', { p_handle: handle });
  if (error) throw error;
  return normaliseProfile(data);
}
