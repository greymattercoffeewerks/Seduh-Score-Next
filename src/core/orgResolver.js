// Which organisation does an audience link mean? (T-TEN.D1)
//
// The audience screens (projector, phone, splash) are anonymous: nobody is signed in to ask. A link now carries
// the organiser's slug (#/live/<slug>/projector), and this turns that slug into the organisation the surfaces
// already work with, through the one narrow door the database offers for it (public_org_by_slug, T-TEN.B7:
// one organisation or nothing, no listing, no pattern matching).
//
// THREE distinct outcomes, never collapsed into one, because the person looking at a projector must never be
// told "no event tonight" for a mistyped link, nor "we couldn't find that organiser" for a dropped connection:
//   { status: 'found', org: { id, name, slug } }
//   { status: 'not_found' }              the database answered, and there is no such organiser
//   { status: 'error', error }           it could not be asked (offline, slow, a server fault)
//
// A found answer is remembered for the rest of the page's life (a slug does not move between organisations
// within a session, and the projector asks again on every surface it shows). "Not found" and errors are never
// remembered: a link that did not work a moment ago may work now.
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

const found = new Map();

// What the database accepts as a slug, read the way it reads it (public_org_by_slug, T-TEN.B7): ASCII
// whitespace trimmed, at most 100 characters, letters and digits with single hyphens between, and only
// THEN case-folded. A link that cannot be a slug is "not found" without asking, and is never remembered:
// the cache must not accept what the database would refuse (a look-alike such as the Kelvin sign would
// otherwise be served the real organiser's answer from memory).
const SLUG_SHAPE = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;
function normalise(slug) {
  const trimmed = String(slug).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  return trimmed.length <= 100 && SLUG_SHAPE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export async function resolveOrgBySlug(slug, client, { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  const key = normalise(slug);
  if (key === null) return { status: 'not_found' };
  if (found.has(key)) return { status: 'found', org: { ...found.get(key) } };
  let response;
  try {
    response = await raceTimeout(client.rpc('public_org_by_slug', { p_slug: slug }), timeoutMs);
  } catch (error) {
    return { status: 'error', error };
  }
  if (response?.error) return { status: 'error', error: response.error };
  const row = Array.isArray(response?.data) ? response.data[0] : null;
  if (!row?.id) return { status: 'not_found' };
  const org = { id: row.id, name: row.name ?? null, slug: row.slug ?? key };
  found.set(key, org);
  return { status: 'found', org: { ...org } };
}

// Test-only: forget what was remembered.
export function _clearOrgResolverForTests() {
  found.clear();
}
