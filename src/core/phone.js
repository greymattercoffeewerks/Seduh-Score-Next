// Phone interpretation — the single place a typed phone number becomes a canonical `+` E.164
// string (or a stable error code), so every entry path writes the same shape to `people.phone`,
// the cross-organisation Seduh ID key. Design: Handoffs and Specs/PHONE-CHECKER-DESIGN.md
// (local only). The split of work:
//   - libphonenumber-js (`/min` metadata, MIT, version pinned by the lockfile) owns the per-country
//     facts: trunk prefixes (strips the 0 in `+44 (0)7911`, keeps Italy's real leading 0), national
//     lengths and patterns, extensions. It is a deliberate exception to the repo's habit of no new
//     dependencies, because a hand-kept table would make us the maintainers of other countries'
//     number plans. It runs on the CLIENT ONLY: the database stays shape-only (E164_PATTERN below is
//     the same text as the SQL CHECK) and never interprets a number.
//   - This file owns the POLICY: Brunei first, and a bare number is never guessed into a country.
//     With no country chosen a bare number is accepted only as a complete Brunei number; with one
//     chosen it is read in that country. Only `+` and `00` mean "international"; other exit codes
//     (011, 0011, 001) are never stripped: a number typed with one is read as `00` plus what follows
//     and accepted only if THAT is a valid number (`0011 61 ...` is not; `001 415 555 2671` reads as
//     +1 415 ..., because `00 1 415` and `001 415` cannot be told apart by digits).
// Pure: no DOM, no clock, no network. Callers map the codes to words (`phoneErrorMessage`).
import {
  parsePhoneNumberWithError,
  parseIncompletePhoneNumber,
  getCountries,
  getCountryCallingCode,
} from 'libphonenumber-js/min';

// The project's home market. A bare number with no chosen country is read as Brunei only when it
// is a complete Brunei number (see BRUNEI_LOCAL); this no longer means "assume it for anything".
export const DEFAULT_COUNTRY_CODE = '+673';
export const DEFAULT_COUNTRY = 'BN';

// E.164's own bounds: '+' followed by 8-15 digits total, first digit non-zero. Textually equal to
// the pattern in the database's `app.is_e164` and `people` CHECK (a pgTAP test compares them).
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

// Brunei (libphonenumber metadata): calling code 673, exactly 7 digits starting 2, 3, 4, 5, 7 or 8,
// no trunk prefix.
const BRUNEI_LOCAL = /^[2-578]\d{6}$/;
const BRUNEI_WITH_CODE = /^673[2-578]\d{6}$/;

// The stable vocabulary. A test pins this list; add to it deliberately.
export const PHONE_ERROR_CODES = Object.freeze([
  'blank',
  'needs_country_code',
  'invalid_country',
  'not_a_number',
  'too_short',
  'too_long',
  'invalid_number',
  'extension_not_supported',
  'multiple_numbers',
  'invalid_shape',
]);

const COUNTRY_HINT = 'for example +65 for Singapore or +673 for Brunei';

const MESSAGES = {
  blank: 'Phone is required.',
  needs_country_code: `Add your country code, ${COUNTRY_HINT}. Or pick the country next to the phone box.`,
  invalid_country: 'That country is not supported. Pick another country.',
  not_a_number: 'That does not look like a phone number. Use digits only.',
  too_short: 'That phone number is too short.',
  too_long: 'That phone number is too long.',
  invalid_number: 'That is not a valid phone number. Check the country code and the digits.',
  extension_not_supported:
    'Leave out the extension: enter one phone number the person can be reached on directly.',
  multiple_numbers: 'Enter one phone number only.',
  invalid_shape: `Phone must be a valid international number, starting with your country code, ${COUNTRY_HINT}.`,
};

// The database refuses a phone that is not canonical with the hint `phone_invalid`.
const DB_HINT_CODE = 'phone_invalid';

// Pure. The words for an error code (or for the database's `phone_invalid` hint); unknown codes
// get the generic shape message.
export function phoneErrorMessage(code) {
  if (code === DB_HINT_CODE) return MESSAGES.invalid_shape;
  return MESSAGES[code] ?? MESSAGES.invalid_shape;
}

// Pure. True for a code this module can return, or the database's hint for the same problem.
export function isPhoneErrorCode(code) {
  return code === DB_HINT_CODE || PHONE_ERROR_CODES.includes(code);
}

const fail = (code) => ({ ok: false, code });

const LIBRARY_ERRORS = {
  INVALID_COUNTRY: 'invalid_country',
  NOT_A_NUMBER: 'not_a_number',
  TOO_SHORT: 'too_short',
  TOO_LONG: 'too_long',
};

// Parse with the library, answering { ok, phone } or { ok: false, code }. `country` is an ISO
// region for a number typed without an international prefix; null for one that carries its own.
function parseWithLibrary(text, country) {
  let parsed;
  try {
    parsed = parsePhoneNumberWithError(text, country ?? undefined);
  } catch (error) {
    return fail(LIBRARY_ERRORS[error?.message] ?? 'not_a_number');
  }
  if (parsed.ext) return fail('extension_not_supported');
  if (!parsed.isValid()) return fail('invalid_number');
  const phone = parsed.number;
  return E164_PATTERN.test(phone) ? { ok: true, phone, parsed } : fail('invalid_number');
}

// Anything other than digits (any script), `+`, spaces and the usual separators is not part of one
// phone number. Letters are dealt with first (an extension, or junk).
const EXTENSION = /(?:ext(?:ension)?|x|#|;)\s*\.?\s*\p{Nd}+\s*$/iu;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;
const NUMBER_SEPARATORS = /[/,;&\n\r|]|\bor\b|\band\b/iu;
const FORMATTING = /^[\p{Nd}+\s\-.()\u00a0\u2010-\u2015\u2212\uff0b\uff0d]*$/u;

// Two or more pieces that each carry a real run of digits, split by a separator people use between
// numbers ("7123456 / 8123456"). A lone "n/a" is not several numbers; it falls through to not_a_number.
function looksLikeSeveralNumbers(text) {
  const pieces = text.split(NUMBER_SEPARATORS).filter((piece) => {
    const digitCount = parseIncompletePhoneNumber(piece).replace(/\D/g, '').length;
    return digitCount >= 5;
  });
  return pieces.length >= 2;
}

// Pure. The one entry point. `raw` is what a person typed. Options:
//   country      ISO region (e.g. 'SG') the person chose for a number typed without `+` or `00`;
//                omit for "none chosen".
//   storedPhone  the value already on file. When `raw` is that value unchanged it is checked for
//                SHAPE only, so an old number that fails today's stricter country rules never blocks
//                saving another field (the edit rule).
// Answers { ok: true, phone } with a canonical `+` E.164 string, or { ok: false, code } with a code
// from PHONE_ERROR_CODES. Idempotent: parsing its own output returns it unchanged.
export function parsePhone(raw, { country = null, storedPhone = null } = {}) {
  // Invisible direction marks and zero-width characters ride along when a number is pasted from a
  // contact card or chat; they carry no digits, so they are dropped, not refused.
  const text = typeof raw === 'string' ? raw.replace(INVISIBLE, '').trim() : '';
  if (!text) return fail('blank');

  if (typeof storedPhone === 'string' && storedPhone && text === storedPhone) {
    return E164_PATTERN.test(text) ? { ok: true, phone: text } : fail('invalid_shape');
  }

  if (EXTENSION.test(text) && /\p{L}|#/u.test(text)) return fail('extension_not_supported');
  if (looksLikeSeveralNumbers(text)) return fail('multiple_numbers');
  if (!FORMATTING.test(text)) return fail('not_a_number');
  // `+` marks an international number when only brackets or spaces precede it (`(+65) 8123 4567`);
  // a `+` after digits (`673+7123456`), or a second `+`, is another number.
  const firstPlus = text.search(/[+\uff0b]/u);
  const leading = firstPlus !== -1 && !/\p{Nd}/u.test(text.slice(0, firstPlus));
  if (firstPlus !== -1 && (!leading || /[+\uff0b]/u.test(text.slice(firstPlus + 1)))) {
    return fail('multiple_numbers');
  }

  // Digits of any script to ASCII; `parseIncompletePhoneNumber` also keeps a leading '+'.
  const digits = parseIncompletePhoneNumber(text.replace(/\uff0b/gu, '+')).replace(/\D/g, '');
  if (!digits) return fail('not_a_number');

  if (leading) return fromInternational(digits);
  if (digits.startsWith('00')) return fromInternational(digits.slice(2));
  return fromBare(digits, country);
}

function fromInternational(digits) {
  if (!digits) return fail('not_a_number');
  const result = parseWithLibrary(`+${digits}`, null);
  return result.ok ? { ok: true, phone: result.phone } : result;
}

// A number typed with no international prefix.
function fromBare(digits, country) {
  if (!country) {
    // No country chosen: only a complete Brunei number, with or without its own 673.
    if (BRUNEI_LOCAL.test(digits)) return { ok: true, phone: `+673${digits}` };
    if (BRUNEI_WITH_CODE.test(digits)) return { ok: true, phone: `+${digits}` };
    return fail('needs_country_code');
  }
  if (!getCountries().includes(country)) return fail('invalid_country');

  const own = String(getCountryCallingCode(country));
  const national = parseWithLibrary(digits, country);
  if (national.ok) {
    // The library also applies the country's own exit code (011 in the US). Only `+` and `00` mean
    // international here, so a result in another calling code is refused, not accepted.
    return String(national.parsed.countryCallingCode) === own
      ? { ok: true, phone: national.phone }
      : fail('needs_country_code');
  }
  // Typed with the country's own code but no plus (`65 8123 4567` with Singapore chosen): read it
  // as international, and only trust it if it comes out in the chosen country's calling code.
  if (digits.startsWith(own)) {
    const withCode = parseWithLibrary(`+${digits}`, null);
    if (withCode.ok && String(withCode.parsed.countryCallingCode) === own) {
      return { ok: true, phone: withCode.phone };
    }
  }
  return national;
}

// Pure. The canonical phone, or '' for a blank or refused input (the callers that need to know
// WHY use parsePhone). Kept for callers that only want the string.
export function normalizePhone(raw, options) {
  const result = parsePhone(raw, options);
  return result.ok ? result.phone : '';
}

// Pure. Expects an already-canonical value. Returns a user-facing message, or null when `phone` is
// a valid E.164 shape.
export function validatePhoneShape(phone) {
  return E164_PATTERN.test(phone) ? null : MESSAGES.invalid_shape;
}

// Pure. The countries a person can choose, Brunei first and the rest by name, for a select:
// [{ iso, callingCode, name }]. Names come from Intl when it has them, else the ISO code.
export function phoneCountryOptions(locale = 'en') {
  let names = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  const rows = getCountries().map((iso) => ({
    iso,
    callingCode: String(getCountryCallingCode(iso)),
    name: names?.of(iso) ?? iso,
  }));
  rows.sort((a, b) => a.name.localeCompare(b.name, locale));
  const home = rows.findIndex((row) => row.iso === DEFAULT_COUNTRY);
  if (home > 0) rows.unshift(...rows.splice(home, 1));
  return rows;
}
