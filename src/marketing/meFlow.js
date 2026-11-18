// "My Seduh ID" (/id/me/), the pure half (T-ID2.D-b): what a person typed, checked the way the database will check it, every
// refusal turned into plain words, the settings in plain words, and the record the door returns rebuilt from known keys.
// No DOM, no network, no clock beyond the year: unit-tested directly.
//
// Every refusal reaches the page as a stable snake_case HINT (CONVENTIONS.md "Seduh ID: a person's own record"); the page
// shows the words here and never the server's own text. An unknown hint gets the generic sentence.
import { normaliseCode, normaliseEmail } from './claimFlow.js';
import { ENTRY_KINDS, cleanPhotoUrl, teamResultWords } from '../core/seduhProfile.js';

export { normaliseCode, normaliseEmail };

export const ENTRY_LIMIT = 200;
export const TEAM_LINK_LIMIT = 40;
export const COURSE_LIMIT = 60;
export const MIN_YEAR = 1980;

// the database's own text limits (app.seduh_clean_text)
export const LIMITS = {
  competition_name: 120,
  location: 80,
  role: 60,
  result_text: 80,
  note: 500,
  maxPlacement: 500,
  // courses and certificates (app.seduh_course_clean)
  course_title: 120,
  course_provider: 80,
  course_level: 40,
  course_note: 300,
};

export const KIND_CHOICES = [
  ['competed', 'Competed'],
  ['judged', 'Judged'],
  ['organised', 'Organised'],
  ['coached', 'Coached'],
  ['volunteered', 'Volunteered'],
];

export const TEAM_ROLE_CHOICES = [
  ['member', 'Member'],
  ['captain', 'Captain'],
  ['coach', 'Coach'],
  ['reserve', 'Reserve'],
];
export const teamRoleWord = (role) =>
  TEAM_ROLE_CHOICES.find(([key]) => key === role)?.[1] ?? 'Member';

const GENERIC = 'Something went wrong. Check your connection and try again.';

const TEXT = {
  // signing in
  bad_email: 'Enter a valid email address.',
  bad_code: 'Enter the 6 digits from the email.',
  otp_invalid: 'That code is not right, or it has expired. Check it, or ask for a new code.',
  too_many_attempts: 'Too many attempts. Wait a minute and try again.',
  signed_out: 'Your sign-in ended. Sign in again with your email address.',
  no_account:
    'This sign-in has no Seduh ID. Use the email address you claimed your Seduh ID with, or ask the organiser who sent your claim link.',
  // an entry
  bad_year: `Enter a year from ${MIN_YEAR} to this year.`,
  bad_kind: 'Choose what you did: competed, judged, organised, coached or volunteered.',
  bad_competition: `Enter the competition's name (up to ${LIMITS.competition_name} characters, plain text).`,
  bad_location: `The place can be up to ${LIMITS.location} characters of plain text.`,
  bad_role: `Your role can be up to ${LIMITS.role} characters of plain text.`,
  bad_result: `The result can be up to ${LIMITS.result_text} characters of plain text, for example “2nd” or “Finalist”.`,
  bad_placement: `A placing is a whole number from 1 to ${LIMITS.maxPlacement}, or leave it empty.`,
  bad_note: `The note can be up to ${LIMITS.note} characters for an entry, or ${LIMITS.course_note} for a course, of plain text on one line (no line breaks).`,
  too_many_entries: `You have reached the limit of ${ENTRY_LIMIT} entries. Delete one to add another.`,
  // a course or certificate
  bad_title: `Enter the course's title (up to ${LIMITS.course_title} characters, plain text).`,
  bad_provider: `Enter who ran it (up to ${LIMITS.course_provider} characters, plain text).`,
  bad_valid_until: 'The “valid until” year cannot be before the year you completed it.',
  bad_level: `The level can be up to ${LIMITS.course_level} characters of plain text, for example “Intermediate”.`,
  too_many_courses: `You have reached the limit of ${COURSE_LIMIT} courses. Delete one to add another.`,
  not_current: 'That certificate has expired, so it cannot be shown on your card.',
  not_found: 'That item is not there any more. Reload the page to see your current record.',
  // teams
  team_not_found: 'That team is no longer available to link.',
  already_linked: 'You have already linked that team.',
  too_many_links: `You have reached the limit of ${TEAM_LINK_LIMIT} team links. Remove one to add another.`,
  bad_input: 'That country is not valid. Choose one from the list.',
  // the photo
  photo_not_image: 'That file is not a picture we can use. Choose a JPEG, PNG or WebP photo.',
  photo_input_too_big: 'That file is larger than 10 MB. Choose a smaller photo.',
  photo_unreadable: 'We could not open that picture. Try another one.',
  photo_too_big: 'That photo is still too large after shrinking it. Try a simpler picture.',
  photo_bad_type: 'That photo is not a type we accept. Choose a JPEG, PNG or WebP photo.',
  photo_upload_failed: 'The photo could not be uploaded. Check your connection and try again.',
  bad_path: 'That photo could not be saved. Try again.',
  no_object: 'The upload did not finish. Try again.',
  // settings
  bad_setting: 'That setting could not be saved. Reload the page and try again.',
  // no answer
  offline: 'We could not reach Seduh Score. Check your connection and try again.',
  timeout:
    'That is taking longer than expected. Check your connection and try again. If you already pressed a button, wait a moment before trying again.',
  server_error: 'Something went wrong on our side. Try again in a moment.',
};

/** Pure. The words for a refusal hint; an unknown or missing hint gets the generic sentence. */
export function describeMeHint(hint) {
  return Object.hasOwn(TEXT, hint) ? TEXT[hint] : GENERIC;
}

/** Pure. True when the person has to sign in again (the session is gone, or it has no Seduh ID). */
export const isSignedOutHint = (hint) => hint === 'signed_out' || hint === 'no_account';

// ---- the entry form ----

// no control, invisible or direction-override characters (the database refuses them too: a name that reads backwards)
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const clean = (raw) => String(raw ?? '').trim();

/**
 * Pure. Checks an entry form the way the database will. `form` holds strings as typed. Returns
 * `{ ok: true, params }` (the arguments of seduh_add_entry / seduh_update_entry, empty optional fields as null) or
 * `{ ok: false, errors }`: `{ field: hint }` for every field that is wrong, so each one can say so beside itself.
 */
export function validateEntryForm(form, { thisYear = new Date().getUTCFullYear() } = {}) {
  const errors = {};
  const year = clean(form.year);
  const yearNumber = Number(year);
  if (!/^\d{4}$/.test(year) || yearNumber < MIN_YEAR || yearNumber > thisYear + 1) {
    errors.year = 'bad_year';
  }
  const kind = clean(form.kind);
  if (!ENTRY_KINDS.includes(kind)) errors.kind = 'bad_kind';
  const text = (key, hint, required) => {
    const value = clean(form[key]);
    if (value === '') {
      if (required) errors[key] = hint;
      return null;
    }
    if ([...value].length > LIMITS[key] || BAD_CHARS.test(value)) errors[key] = hint;
    return value;
  };
  const competition = text('competition_name', 'bad_competition', true);
  const location = text('location', 'bad_location', false);
  const role = text('role', 'bad_role', false);
  const result = text('result_text', 'bad_result', false);
  const note = text('note', 'bad_note', false);
  const placingRaw = clean(form.placement);
  let placement = null;
  if (placingRaw !== '') {
    placement = Number(placingRaw);
    if (!/^\d{1,3}$/.test(placingRaw) || placement < 1 || placement > LIMITS.maxPlacement) {
      errors.placement = 'bad_placement';
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      p_year: yearNumber,
      p_competition_name: competition,
      p_kind: kind,
      p_location: location,
      p_role: role,
      p_result_text: result,
      p_placement: placement,
      p_note: note,
    },
  };
}

/** Pure. Which form field a refusal hint belongs to (so the page can mark that field), or null. */
export function fieldForHint(hint) {
  return (
    {
      bad_year: 'year',
      bad_kind: 'kind',
      bad_competition: 'competition_name',
      bad_location: 'location',
      bad_role: 'role',
      bad_result: 'result_text',
      bad_placement: 'placement',
      bad_note: 'note',
      bad_title: 'title',
      bad_provider: 'provider',
      bad_valid_until: 'valid_until_year',
      bad_level: 'level',
    }[hint] ?? null
  );
}

/**
 * Pure. Checks a course form the way the database will: `{ ok: true, params }` (the arguments of seduh_add_course /
 * seduh_update_course) or `{ ok: false, errors }`. Fields: title, provider, year (completed), valid_until_year, level, note.
 */
export function validateCourseForm(form, { thisYear = new Date().getUTCFullYear() } = {}) {
  const errors = {};
  const year = clean(form.year);
  const yearNumber = Number(year);
  if (!/^\d{4}$/.test(year) || yearNumber < MIN_YEAR || yearNumber > thisYear + 1)
    errors.year = 'bad_year';
  const until = clean(form.valid_until_year);
  let untilNumber = null;
  if (until !== '') {
    untilNumber = Number(until);
    if (
      !/^\d{4}$/.test(until) ||
      untilNumber > 2100 ||
      (!errors.year && untilNumber < yearNumber)
    ) {
      errors.valid_until_year = 'bad_valid_until';
    }
  }
  const text = (key, limit, hint, required) => {
    const value = clean(form[key]);
    if (value === '') {
      if (required) errors[key] = hint;
      return null;
    }
    if ([...value].length > limit || BAD_CHARS.test(value)) errors[key] = hint;
    return value;
  };
  const title = text('title', LIMITS.course_title, 'bad_title', true);
  const provider = text('provider', LIMITS.course_provider, 'bad_provider', true);
  const level = text('level', LIMITS.course_level, 'bad_level', false);
  const note = text('note', LIMITS.course_note, 'bad_note', false);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      p_title: title,
      p_provider: provider,
      p_completed_year: yearNumber,
      p_valid_until_year: untilNumber,
      p_level: level,
      p_note: note,
    },
  };
}

// ---- the settings, in plain words ----

const VIS3 = [
  ['public', 'Public'],
  ['organisers', 'Only organisers I competed for'],
  ['hidden', 'Hidden'],
];
const VIS2 = [
  ['public', 'Public'],
  ['hidden', 'Hidden'],
];

export const ORGANISERS_EXPLAINED =
  '“Only organisers I competed for” keeps it off your public page. Organisers do not have a view of it yet, so for now it works like Hidden.';

export const SETTINGS = [
  {
    key: 'vis_identity',
    label: 'Your name and country',
    help: 'Hidden: your page still exists (a printed QR code never breaks) but shows only its address, not your name or country.',
    choices: VIS2,
  },
  {
    key: 'vis_recorded_results',
    label: 'Results recorded by Seduh Score',
    help: 'Results from events run on Seduh Score.',
    choices: VIS3,
  },
  {
    key: 'vis_organiser_results',
    label: 'Results and teams from organisers’ records',
    help: 'Team results supplied by organisers, such as championships held before Seduh Score, and the teams you linked yourself to.',
    choices: VIS3,
  },
  {
    key: 'vis_self_reported_results',
    label: 'Results you added yourself',
    help: 'Shown labelled “Self-reported, not verified by Seduh”.',
    choices: VIS3,
  },
  {
    key: 'vis_judging_roles',
    label: 'Judging roles',
    help: 'Events where you judged.',
    choices: VIS3,
  },
  {
    key: 'vis_courses',
    label: 'Courses and certificates',
    help: 'Training you listed yourself, shown in your record labelled “Self-reported, not verified by Seduh”. Hidden also takes the “Certified” line off your story card.',
    choices: VIS2,
  },
  {
    key: 'vis_cafe_affiliations',
    label: 'Cafe links',
    help: 'Cafes you work with, once the cafe has confirmed it too.',
    choices: VIS2,
  },
  {
    key: 'vis_knockout_record',
    label: 'Knockout wins and losses',
    help: 'Your record in knockout rounds. An opponent is named only if they are public too.',
    choices: VIS2,
  },
];

export const COUNTRY_LISTING = {
  key: 'listed_on_country_pages',
  label: 'Show me on my country’s page',
  help: 'Off unless you switch it on. When on, your name is listed among the members of your teams on the country page. It only shows while your name and your organisers’ results are public. You can switch it off at any time.',
};

// "Show me in Seduh ID search" (T-ID2.C5): ON by default. It only has an effect once the owner opens discovery, and it never
// makes anyone appear who is hidden: a person is found only while their name is public.
export const SEARCH_LISTING = {
  key: 'listed_in_search',
  label: 'Show me in Seduh ID search',
  help: 'On unless you switch it off. When on, people can find your page by searching for your name, handle or café, or by browsing a country’s list of people (separate from the team members on a country page). It only works while your name is public. Your page itself stays open to anyone with the link.',
};

const VIS_VALUES = new Set(['public', 'organisers', 'hidden']);
const VIS_DEFAULTS = {
  vis_identity: 'public',
  vis_recorded_results: 'public',
  vis_organiser_results: 'public',
  vis_self_reported_results: 'public',
  vis_judging_roles: 'public',
  vis_courses: 'public',
  vis_cafe_affiliations: 'public',
  vis_knockout_record: 'public',
};

/** Pure. The words for one choice of one setting ("Hidden"), or null. */
export function choiceWord(key, value) {
  const setting = SETTINGS.find((s) => s.key === key);
  return setting?.choices.find(([v]) => v === value)?.[1] ?? null;
}

// ---- the record the door returns ----

const text = (value, max) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
const intOrNull = (value) => (Number.isInteger(value) ? value : null);

function normaliseEntry(raw) {
  const id = intOrNull(raw?.id);
  const year = intOrNull(raw?.year);
  const competition = text(raw?.competition_name, LIMITS.competition_name);
  if (id === null || year === null || !competition) return null;
  const placement = intOrNull(raw.placement);
  return {
    id,
    year,
    competition_name: competition,
    kind: ENTRY_KINDS.includes(raw.kind) ? raw.kind : 'competed',
    location: text(raw.location, LIMITS.location),
    role: text(raw.role, LIMITS.role),
    result_text: text(raw.result_text, LIMITS.result_text),
    placement: placement !== null && placement >= 1 ? placement : null,
    note: text(raw.note, LIMITS.note),
  };
}

function normaliseCourse(raw) {
  const id = intOrNull(raw?.id);
  const title = text(raw?.title, LIMITS.course_title);
  const provider = text(raw?.provider, LIMITS.course_provider);
  const year = intOrNull(raw?.completed_year);
  if (id === null || !title || !provider || year === null) return null;
  const until = intOrNull(raw.valid_until_year);
  return {
    id,
    title,
    provider,
    completed_year: year,
    valid_until_year: until !== null && until >= year ? until : null,
    level: text(raw.level, LIMITS.course_level),
    note: text(raw.note, LIMITS.course_note),
    // the database says whether it is current; anything but an exact false is treated as current
    current: raw.current !== false,
    on_card: raw.on_card === true,
    confirmed: raw.status === 'confirmed',
  };
}

function normaliseTeamLink(raw) {
  const id = intOrNull(raw?.id);
  const key = text(raw?.team_key, 64);
  const name = text(raw?.team_name, 80);
  if (id === null || !name) return null;
  const country = typeof raw.country_code === 'string' ? raw.country_code.trim().toUpperCase() : '';
  return {
    id,
    team_key: key,
    team_name: name,
    country_code: /^[A-Z]{2}$/.test(country) ? country : null,
    competition_name: text(raw.competition_name, 120),
    edition_year: intOrNull(raw.edition_year),
    stage_reached: text(raw.stage_reached, 30),
    placement: intOrNull(raw.placement),
    listed: raw.listed !== false,
    role: ['member', 'captain', 'coach', 'reserve'].includes(raw.role) ? raw.role : 'member',
    // never claim more than we know: only the exact word 'confirmed' is confirmed
    membership: raw.membership === 'confirmed' ? 'confirmed' : 'self_reported',
  };
}

/** Pure. Rebuilds the `seduh_my_record` answer from known keys; null when it is not a usable record. */
export function normaliseMyRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const account = raw.account && typeof raw.account === 'object' ? raw.account : null;
  const handle = text(account?.handle, 40);
  if (!handle) return null;
  const settingsRaw = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings = {
    listed_on_country_pages: settingsRaw.listed_on_country_pages === true,
    // on unless the record says exactly false (the database default is on)
    listed_in_search: settingsRaw.listed_in_search !== false,
  };
  for (const [key, fallback] of Object.entries(VIS_DEFAULTS)) {
    settings[key] = VIS_VALUES.has(settingsRaw[key]) ? settingsRaw[key] : fallback;
  }
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    account: {
      handle,
      foundingNumber: intOrNull(account.founding_number),
      displayName: text(account.display_name, 120),
      countryCode: typeof account.country_code === 'string' ? account.country_code : null,
      photoUrl: cleanPhotoUrl(account.photo_url, handle),
    },
    settings,
    entries: list(raw.entries).map(normaliseEntry).filter(Boolean),
    teamLinks: list(raw.team_links).map(normaliseTeamLink).filter(Boolean),
    courses: list(raw.courses).map(normaliseCourse).filter(Boolean),
  };
}

/** Pure. Entries grouped by year, newest first, the entries of a year in the order given (the door sends newest first). */
export function groupEntriesByYear(entries) {
  const groups = new Map();
  for (const entry of [...entries].sort((a, b) => b.year - a.year)) {
    if (!groups.has(entry.year)) groups.set(entry.year, []);
    groups.get(entry.year).push(entry);
  }
  return [...groups].map(([year, rows]) => ({ year, entries: rows }));
}

/** Pure. The picker's answer rebuilt from known keys: `{ teams, truncated }`. */
export function normaliseTeamOptions(raw) {
  const teams = (Array.isArray(raw?.teams) ? raw.teams : [])
    .map((t) => {
      const key = text(t?.team_key, 64);
      const name = text(t?.team_name, 80);
      if (!key || !name) return null;
      return {
        team_key: key,
        team_name: name,
        country_code: typeof t.country_code === 'string' ? t.country_code : null,
        competition_name: text(t.competition_name, 120),
        edition_year: intOrNull(t.edition_year),
        stage_reached: text(t.stage_reached, 30),
        placement: intOrNull(t.placement),
        linked: t.linked === true,
      };
    })
    .filter(Boolean);
  return { teams, truncated: raw?.truncated === true };
}

export { teamResultWords };
