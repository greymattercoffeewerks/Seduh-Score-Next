// Countries, as the one list the whole app uses (the phone picker and any format's country field). ISO 3166-1
// alpha-2 codes, from libphonenumber's metadata (the same list the phone checker reads), names from `Intl.DisplayNames`
// at render time: no country name is ever stored. Pure: no DOM, no clock, no network.
import { getCountries } from 'libphonenumber-js/min';

// The project's home market: listed first, so the common choice is at the top of a long select.
export const HOME_COUNTRY = 'BN';

function displayNames(locale) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

// Pure. The countries a person can choose, Brunei first and the rest by name: [{ iso, name }]. A name is the
// ISO code itself when Intl has none.
export function countryOptions(locale = 'en') {
  const names = displayNames(locale);
  const rows = getCountries().map((iso) => ({ iso, name: safeName(names, iso) }));
  rows.sort((a, b) => a.name.localeCompare(b.name, locale));
  const home = rows.findIndex((row) => row.iso === HOME_COUNTRY);
  if (home > 0) rows.unshift(...rows.splice(home, 1));
  return rows;
}

function safeName(names, iso) {
  try {
    return names?.of(iso) ?? iso;
  } catch {
    return iso;
  }
}

const KNOWN = new Set(getCountries());

// Pure. The display name of a country code, the code itself when Intl has no name (or throws), null for no country.
export function countryName(iso, locale = 'en') {
  if (iso == null || iso === '') return null;
  // A code outside the list (the database checks only the shape) is shown as the code: Intl would call it
  // "Unknown Region", which says less.
  if (!KNOWN.has(iso)) return iso;
  return safeName(displayNames(locale), iso);
}

// Pure. Whether the code is one of the countries in the list.
export function isCountryCode(iso) {
  return typeof iso === 'string' && KNOWN.has(iso);
}
