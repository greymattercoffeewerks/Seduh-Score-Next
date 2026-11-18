// Seduh ID discovery (T-ID2.C5): the anonymous doors that let a stranger FIND a claimed, public person, and the pure
// shaping of what they return. Nothing here decides who may be found: that is the database's, in SQL
// (migration 20261125100000_seduh_discovery.sql, app.seduh_discovery_people). The ONE on/off switch is a database row
// (app.seduh_discovery_switch); while it is off every door answers `open: false` with nothing, and this module turns any
// such answer, any error and any malformed answer into "closed / nothing" so a page can never show more than the door sent.
//
// Every field is rebuilt from known keys and checked; text is shown as text by the caller, never as markup.
import { cleanPhotoUrl } from './seduhProfile.js';
import { getSupabase } from './supabaseClient.js';

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 40;

const HANDLE = /^[a-z0-9](?:-?[a-z0-9])*$/;

// Control characters and text-direction overrides are dropped (a name is shown as text, but an unclosed override would scramble
// the sentence around it).
const hiddenChar = (c) =>
  c < 32 || c === 127 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

function text(value, max) {
  if (typeof value !== 'string') return '';
  return [...value]
    .filter((ch) => !hiddenChar(ch.codePointAt(0)))
    .join('')
    .trim()
    .slice(0, max);
}

function country(value) {
  const c = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/** Pure. One search result, or null when it is not the door's shape. */
export function normalisePerson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const handle = typeof raw.handle === 'string' ? raw.handle.trim().toLowerCase() : '';
  const name = text(raw.display_name, 120);
  if (!HANDLE.test(handle) || handle.length < 3 || handle.length > 30 || !name) return null;
  return {
    handle,
    name,
    countryCode: country(raw.country_code),
    photoUrl: cleanPhotoUrl(raw.photo_url, handle),
  };
}

const CLOSED_SEARCH = Object.freeze({ open: false, results: [], more: false });

/** Pure. The search door's answer; anything but a clear `open: true` is closed and empty. */
export function normaliseSearch(raw) {
  if (!raw || typeof raw !== 'object' || raw.open !== true) return { ...CLOSED_SEARCH };
  const results = (Array.isArray(raw.results) ? raw.results : [])
    .map(normalisePerson)
    .filter(Boolean)
    .slice(0, 60);
  return { open: true, results, more: raw.more === true };
}

/** Pure. The countries door's answer: `{ open, countries: [{ code, people }] }`. */
export function normaliseCountries(raw) {
  if (!raw || typeof raw !== 'object' || raw.open !== true) return { open: false, countries: [] };
  const countries = (Array.isArray(raw.countries) ? raw.countries : [])
    .map((c) => {
      const code = country(c?.country_code);
      const people = Number.isInteger(c?.people) && c.people > 0 ? c.people : 0;
      return code && people ? { code, people } : null;
    })
    .filter(Boolean)
    .slice(0, 300);
  return { open: true, countries };
}

/** Pure. The results-link door's answer: a list of `{ name, cafe, handle }`, empty when closed. */
export function normaliseLinks(raw) {
  if (!raw || typeof raw !== 'object' || raw.open !== true) return [];
  return (Array.isArray(raw.links) ? raw.links : [])
    .map((l) => {
      const handle = typeof l?.handle === 'string' ? l.handle.trim().toLowerCase() : '';
      const name = text(l?.name, 160);
      if (!HANDLE.test(handle) || handle.length < 3 || handle.length > 30 || !name) return null;
      return { name, cafe: text(l?.cafe, 160), handle };
    })
    .filter(Boolean)
    .slice(0, 500);
}

/** Pure. The query as the door will read it, or null when it is too short or too long to ask. */
export function cleanQuery(raw) {
  const q = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return q.length >= SEARCH_MIN && q.length <= SEARCH_MAX ? q : null;
}

/** Pure. The address of a person's page. */
export const profilePath = (handle) => `/id/${encodeURIComponent(handle)}/`;

// ---- the doors ----

/** True only when the database says discovery is open; an error is "closed". */
export async function fetchDiscoveryOpen(client) {
  try {
    const { data, error } = await (client ?? getSupabase()).rpc('seduh_discovery_open');
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Search by name, handle or cafe and/or browse one country. Throws on a failed call (the caller words it). */
export async function searchSeduhIds(
  { query = null, country: code = null } = {},
  client = getSupabase(),
) {
  const q = query === null || query === '' ? null : cleanQuery(query);
  const cc = code ? country(code) : null;
  if ((query && !q) || (code && !cc) || (!q && !cc))
    return { open: true, results: [], more: false };
  const { data, error } = await client.rpc('seduh_discovery_search', { p_query: q, p_country: cc });
  if (error) throw error;
  return normaliseSearch(data);
}

export async function fetchDiscoveryCountries(client = getSupabase()) {
  const { data, error } = await client.rpc('seduh_discovery_countries');
  if (error) throw error;
  return normaliseCountries(data);
}

/** The claimed competitors on one published event's results (name and cafe as printed there). [] on any problem. */
export async function fetchResultsProfileLinks(eventId, client) {
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) return [];
  try {
    const { data, error } = await (client ?? getSupabase()).rpc('seduh_results_profile_links', {
      p_event_id: eventId,
    });
    return error ? [] : normaliseLinks(data);
  } catch {
    return [];
  }
}

/**
 * DOM. Turns each `[data-profile-name]` element under `root` whose name (and cafe, `data-profile-cafe`) is in `links` into a
 * link to that person's page. The element's text moves into the anchor; an element with no match is left exactly as it was.
 * Returns the number linked.
 */
export function applyProfileLinks(root, links) {
  if (!root || !links?.length) return 0;
  const byKey = new Map(links.map((l) => [`${l.name}\u0000${l.cafe}`, l.handle]));
  let n = 0;
  for (const node of root.querySelectorAll('[data-profile-name]')) {
    if (node.querySelector('a')) continue;
    const handle = byKey.get(
      `${(node.getAttribute('data-profile-name') ?? '').trim()}\u0000${(node.getAttribute('data-profile-cafe') ?? '').trim()}`,
    );
    if (!handle) continue;
    const a = node.ownerDocument.createElement('a');
    a.className = 'results-profile-link';
    a.setAttribute('href', profilePath(handle));
    a.textContent = node.textContent;
    node.replaceChildren(a);
    n += 1;
  }
  return n;
}

/** Asks for the links of one event and applies them; never throws and never waits for the caller. */
export async function linkClaimedNames(root, eventId, client) {
  try {
    return applyProfileLinks(root, await fetchResultsProfileLinks(eventId, client));
  } catch {
    return 0;
  }
}
