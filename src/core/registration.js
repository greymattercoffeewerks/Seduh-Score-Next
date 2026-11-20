// Registering a person into an event from an organiser's form, the parts every format shares (Cup Taster's roster,
// Throwdown's competitors). Each format keeps its own fields and words; the caps, the phone rule and the
// register-then-link step live here once, so the formats cannot drift apart (module-boundary review, 2026-11-20).
import { parsePhone, phoneErrorMessage, DEFAULT_COUNTRY } from './phone.js';
import { registerEntry } from './registry.js';
import { requestPersonLink } from './identity.js';

// The registration RPC's caps (migration 20261007100000). JS counts UTF-16 units, the RPC code points, so a form
// that enforces these is never more lenient than the database, and a value it accepts can always be edited later.
export const REGISTRATION_LIMITS = Object.freeze({
  displayName: 200,
  email: 254,
  cafe: 200,
  bib: 50,
});

// { field: 'phone', message } when the phone, read in `country`, is not a number core/phone.js accepts; null when
// it is. A blank phone is the caller's own "required" check, with its own words.
export function phoneProblem(phone, country = DEFAULT_COUNTRY) {
  const parsed = parsePhone(phone, { country: country ?? DEFAULT_COUNTRY });
  return parsed.ok ? null : { field: 'phone', message: phoneErrorMessage(parsed.code) };
}

// Finds or creates the person by phone, enters them (an existing entry is returned unchanged), then asks for the
// Seduh ID link: best-effort, online only, never awaited, silent on failure, not in the outbox (core/identity.js).
export async function registerAndLink(orgId, eventId, person, client) {
  const entry = await registerEntry(orgId, eventId, person, client);
  if (entry.person_id) requestPersonLink(orgId, entry.person_id, client);
  return entry;
}
