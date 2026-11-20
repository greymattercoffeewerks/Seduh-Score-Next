// Throwdown's "Add a competitor" form, the pure part. A competitor is registered the way Cup Taster registers a
// cupper (core/registry.registerEntry): name and phone are required (D16), the café or team is optional. The phone
// makes a person row, deduplicated by phone within the organisation, and that person is what a Seduh ID links to;
// a name-only entry has nothing to link (2026-11-20, owner request, ahead of the 27 Nov event).
import { DEFAULT_COUNTRY } from '../../core/phone.js';
import {
  phoneProblem,
  tooLongProblem,
  validateEdit,
  buildEditFields,
  describeRegistrationEditError,
  initialEditDraft,
  savedEditSentence,
} from '../../core/registration.js';

const LABELS = { displayName: 'Name', cafe: 'Café or team' };

export function blankCompetitorDraft() {
  return { displayName: '', phone: '', phoneCountry: DEFAULT_COUNTRY, cafe: '' };
}

// Returns { field, message } for the first problem, or null when the draft can be sent. `field` names the input to
// point at (displayName | phone | cafe).
export function validateCompetitorDraft(draft) {
  if (!draft.displayName.trim())
    return { field: 'displayName', message: 'Enter the competitor’s name.' };
  if (!draft.phone.trim())
    return { field: 'phone', message: 'Enter the competitor’s phone number.' };
  return tooLongProblem(draft, LABELS) ?? phoneProblem(draft.phone, draft.phoneCountry);
}

// What core/registry.registerEntry takes. The phone goes on as typed with its country: core/registry interprets it
// (core/phone.js), the one place that happens.
export function buildCompetitor(draft) {
  return {
    displayName: draft.displayName.trim(),
    phone: draft.phone.trim(),
    phoneCountry: draft.phoneCountry ?? DEFAULT_COUNTRY,
    cafe: draft.cafe.trim() || null,
  };
}

// The words after a registration. `alreadyIn` is whether the entry was on the roster before: registering a phone
// that is already a competitor returns that entry unchanged, withdrawn or not. The stored name is used, never what
// was typed (an existing person keeps their own name).
export function addedWords(entry, alreadyIn) {
  if (!alreadyIn) return `${entry.display_name} added.`;
  return entry.withdrawn
    ? `${entry.display_name} is already on the list, withdrawn. Use Restore to bring them back.`
    : `${entry.display_name} is already a competitor.`;
}

// ---------- Edit (2026-11-20) ----------
// The same capability Cup Taster's roster has had since v3.0.19, on core/registration.js's shared edit rules. Name,
// phone (with its country) and café or team can be corrected; the phone and email live on the person, not the entry.
// The RPC REPLACES email and bib with what it is sent, and this form shows neither, so they ride in the draft untouched
// (a person who is also in a Cup Taster event in the same organisation keeps their email).
const EDIT_MESSAGES = {
  name: 'Enter the competitor’s name.',
  phone: 'Enter the competitor’s phone number.',
};

export function validateCompetitorEdit(draft, { linked, storedPhone = null }) {
  return validateEdit(draft, { linked, storedPhone, messages: EDIT_MESSAGES, labels: LABELS });
}

export {
  initialEditDraft,
  buildEditFields as buildCompetitorEdit,
  describeRegistrationEditError as describeCompetitorEditError,
  savedEditSentence as editedWords,
};
