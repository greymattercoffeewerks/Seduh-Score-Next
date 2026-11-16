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
// (CONVENTIONS.md); the other three are still empty seams, so their row shape here is PROVISIONAL and tolerant. When a
// seam is built, pin its shape in this file and in seduhProfile.test.js.
import { formatDuration } from './duration.js';
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

// PROVISIONAL shape for the three seams (see the header). `provenance` is forced by seam: self_reported rows are always
// self-reported, whatever the row claims.
function seamEntry(raw, { defaultKind, provenance, allowSeduhScore = false }) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.title ?? raw.event_name ?? raw.competition ?? raw.name, 120);
  if (!title) return null;
  const date = isoDate(raw.event_date ?? raw.date);
  const kind = ENTRY_KINDS.includes(raw.kind) ? raw.kind : defaultKind;
  let prov = provenance;
  if (allowSeduhScore && [PROVENANCE_SEDUH_SCORE, PROVENANCE_ORGANISER].includes(raw.provenance))
    prov = raw.provenance;
  const placing = int(raw.placing);
  return {
    kind,
    provenance: prov,
    title,
    organiser: text(raw.organiser_name, 80),
    format: null,
    team: text(raw.team_name ?? raw.team, 80),
    location: text(raw.location, 80),
    detail: [text(raw.role, 60), text(raw.detail ?? raw.note, 160)].filter(Boolean).join(' · '),
    date,
    year: yearOf(raw.year, date),
    placing: placing !== null && placing >= 1 ? placing : null,
    correct: null,
    total: null,
    timeSecs: null,
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
    ...list(raw.organiser_records).map((r) =>
      seamEntry(r, { defaultKind: 'competed', provenance: PROVENANCE_ORGANISER }),
    ),
    ...list(raw.self_reported).map((r) =>
      seamEntry(r, { defaultKind: 'competed', provenance: PROVENANCE_SELF }),
    ),
    ...list(raw.judging_roles).map((r) =>
      seamEntry(r, { defaultKind: 'judged', provenance: PROVENANCE_SELF, allowSeduhScore: true }),
    ),
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
          // SEAM Phase C2: photo_url is null today and ignored; C2 validates and draws it.
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
