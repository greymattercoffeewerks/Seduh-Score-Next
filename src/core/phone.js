// Phone normalization/validation — the single place this happens, so every
// entry path writes the same shape to `people.phone` (the eventual Seduh ID
// cross-org matching key; see Handoffs and Specs/MULTI-TENANCY-AND-SEDUHID-
// SCOPING.md §7). Hand-rolled E.164 shape check, not a full per-country
// validator (no libphonenumber-js dependency) — a deliberate scope choice,
// 2026-09-06; upgrading to a library for accurate per-country length/format
// is the noted roadmap item if this hand-rolled version proves insufficient.

// This project's home market — assumed when a number is typed without a
// leading '+'. Doesn't attempt to strip a domestic trunk prefix (Brunei has
// none), so a number typed with one will normalize wrong; not handled here.
export const DEFAULT_COUNTRY_CODE = '+673';

// E.164's own bounds: '+' followed by 8-15 digits total, first digit non-zero.
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// Pure. Strips everything but digits (and a leading '+'), then assumes
// `defaultCountryCode` when no country code was typed. A leading '00' (the
// common alternative to '+' for dialing internationally) is treated the
// same as a leading '+' — without this, "0065 8123 4567" would silently
// become the wrong, but still shape-valid, number "+6730065..." instead of
// being recognized as already carrying its own country code. Returns '' for
// a blank/unparseable input — callers that require a phone check that
// separately (see rosterScreen.js's validateDraft, which checks presence
// before shape).
export function normalizePhone(raw, defaultCountryCode = DEFAULT_COUNTRY_CODE) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  return `${defaultCountryCode}${digits}`;
}

// Pure. Expects an already-normalized value (see normalizePhone). Returns a
// user-facing message, or null when `phone` is a valid E.164 shape.
export function validatePhoneShape(phone) {
  if (!E164_PATTERN.test(phone)) {
    return 'Phone must be a valid international number, starting with your country code — e.g. +673 7123456 for Brunei.';
  }
  return null;
}
