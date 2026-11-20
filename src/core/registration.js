// Registering a person into an event from an organiser's form, the parts every format shares (Cup Taster's roster,
// Throwdown's competitors). Each format keeps its own fields and words; the caps, the phone rule and the
// register-then-link step live here once, so the formats cannot drift apart (module-boundary review, 2026-11-20).
import { parsePhone, phoneErrorMessage, isPhoneErrorCode, DEFAULT_COUNTRY } from './phone.js';
import { describeError } from './errors.js';
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
// it is. A blank phone is the caller's own "required" check, with its own words. `storedPhone` is the edit rule: an
// unchanged value on file is checked for SHAPE only, so an old number never blocks saving another field.
export function phoneProblem(phone, country = DEFAULT_COUNTRY, storedPhone = null) {
  const parsed = parsePhone(phone, { country: country ?? DEFAULT_COUNTRY, storedPhone });
  return parsed.ok ? null : { field: 'phone', message: phoneErrorMessage(parsed.code) };
}

// { field, message } for the first draft field over its cap, or null. `labels` is the caller's own words for the
// fields it has ({ displayName: 'Name', cafe: 'Cafe' }); a field not in it is not checked, so each form checks
// exactly the boxes it shows. Caps come from REGISTRATION_LIMITS, in its order.
export function tooLongProblem(draft, labels) {
  for (const [key, max] of Object.entries(REGISTRATION_LIMITS)) {
    if (!labels[key]) continue;
    if ((draft[key] ?? '').trim().length > max) {
      return { field: key, message: `${labels[key]} is too long (${max} characters at most).` };
    }
  }
  return null;
}

// The edit form's checks, shared by every format's row editor. `linked` is whether the entry has a profile to carry a
// phone (a walk-up entry has none). `messages` = { name, phone } are the caller's "required" words; `labels` as above.
// Returns { field, message } for the first problem, or null.
export function validateEdit(draft, { linked, storedPhone = null, messages, labels }) {
  if (!draft.displayName.trim()) return { field: 'displayName', message: messages.name };
  if (linked) {
    if (!draft.phone.trim()) return { field: 'phone', message: messages.phone };
    const problem = phoneProblem(draft.phone, draft.phoneCountry, storedPhone);
    if (problem) return problem;
  }
  return tooLongProblem(draft, labels);
}

// What core/registry.updateRosterEntry takes: trimmed, blanks as null; the phone as typed with its country and the
// value on file (registry interprets it, applying the edit rule). The RPC REPLACES email and bib with what it is
// sent, so a form that does not show one must carry the stored value in its draft (draft.email / draft.bib), never
// leave it out.
export function buildEditFields(draft, { linked, storedPhone = null }) {
  return {
    displayName: draft.displayName.trim(),
    phone: linked ? draft.phone.trim() : null,
    phoneCountry: linked ? (draft.phoneCountry ?? DEFAULT_COUNTRY) : null,
    storedPhone: linked ? storedPhone : null,
    email: linked ? (draft.email ?? '').trim() || null : null,
    cafe: (draft.cafe ?? '').trim() || null,
    bib: (draft.bib ?? '').trim() || null,
  };
}

// A phone/email clash arrives as a P0002 whose details name the field and the person who already has it; a phone
// refusal carries a stable code in `hint` (core/registry's PhoneError or the database's 'phone_invalid'), read by
// code, never by text. Anything else is described generically. `field` says which input to point at.
export function describeRegistrationEditError(err) {
  if (isPhoneErrorCode(err?.hint)) {
    return { field: 'phone', message: phoneErrorMessage(err.hint) };
  }
  if (err?.code === 'P0002') {
    let detail = null;
    try {
      detail = JSON.parse(err.details ?? err.detail ?? 'null');
    } catch {
      // Malformed/missing details: fall through to the generic conflict message.
    }
    const who = detail?.existing_display_name ?? 'another person';
    if (detail?.field === 'phone') {
      return {
        field: 'phone',
        message: `That phone number already belongs to ${who}. Check the number.`,
      };
    }
    if (detail?.field === 'email') {
      return {
        field: 'email',
        message: `That email already belongs to ${who}. Check the address.`,
      };
    }
    return {
      field: null,
      message:
        'That phone number or email already belongs to another person. Check them and try again.',
    };
  }
  return { field: null, message: describeError(err) };
}

// Seduh ID matches a published result to a person by the entry's trimmed name and café (the public payload carries no
// ids), so editing either of them on an entry that is NAMED in the published results drops that result from the
// person's profile until the results are published again (T-ID2.B2, fix 3). `payload` is a public_results payload (or
// null); true when its podium or standings name this entry exactly. A stub, an unpublished event and an entry the
// published results do not name are all false.
export function isEntryInPublishedResults(payload, entry) {
  if (!payload || !entry) return false;
  const name = (entry.display_name ?? '').trim();
  const cafe = (entry.cafe ?? '').trim();
  return ['podium', 'standings'].some(
    (key) =>
      Array.isArray(payload[key]) &&
      payload[key].some(
        (row) =>
          row &&
          typeof row.name === 'string' &&
          row.name.trim() === name &&
          (typeof row.cafe === 'string' ? row.cafe.trim() : '') === cafe,
      ),
  );
}

// True when the draft's name or café differs from the entry's saved one (compared trimmed, as the match is).
export function matchFieldsChanged(draft, entry) {
  return (
    (draft.displayName ?? '').trim() !== (entry.display_name ?? '').trim() ||
    (draft.cafe ?? '').trim() !== (entry.cafe ?? '').trim()
  );
}

// The edit form's starting values: this event's entry for name, café and bib, the person's profile for phone and email
// (an entry with no profile, a walk-up, has none). The country a number typed without + is read in starts at the default.
export function initialEditDraft(entry, person) {
  return {
    displayName: entry.display_name ?? '',
    phone: person?.phone ?? '',
    phoneCountry: DEFAULT_COUNTRY,
    email: person?.email ?? '',
    cafe: entry.cafe ?? '',
    bib: entry.bib ?? '',
  };
}

// The sentence after a saved edit, one wording for every format. `dropsPublishedResult`: the entry is named in the
// published results and its name or café changed (so it is off their Seduh ID profile until the organiser republishes);
// `detailsChanged`: name or café changed (compare with matchFieldsChanged, trimmed, as the match is).
export function savedEditSentence(name, { detailsChanged, dropsPublishedResult }) {
  if (dropsPublishedResult) {
    return `${name} updated. Their published result still shows the old name or café, so it is not on their Seduh ID profile until you republish.`;
  }
  if (detailsChanged) {
    return `${name} updated. The audience view and any published results show the new details the next time they are published.`;
  }
  return `${name} updated.`;
}

export const PUBLISHED_EDIT_ADVISORY =
  'This person is in the published results. Their Seduh ID record is matched by name and café, so if you change either, republish the results afterwards.';
export const PUBLISHED_EDIT_WARNING =
  'Changing the name or café drops this person’s result from their Seduh ID profile until you republish the results.';

// Finds or creates the person by phone, enters them (an existing entry is returned unchanged), then asks for the
// Seduh ID link: best-effort, online only, never awaited, silent on failure, not in the outbox (core/identity.js).
export async function registerAndLink(orgId, eventId, person, client) {
  const entry = await registerEntry(orgId, eventId, person, client);
  if (entry.person_id) requestPersonLink(orgId, entry.person_id, client);
  return entry;
}
