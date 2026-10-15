// How the admin console writes dates and counts. Dates are always UTC and always year-month-day: an operator
// reading "2026-10-12" cannot mistake it for a different day in another time zone, and a created-at stamp from the
// database means the same thing on every machine. Pure functions, nothing here touches the page.

const MISSING = '—';

// A timestamp or a date ("2026-10-12" from a `date` column) as YYYY-MM-DD; an em dash when there is none.
export function formatDate(value) {
  if (value === null || value === undefined || value === '') return MISSING;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? MISSING : date.toISOString().slice(0, 10);
}

// A timestamp as "YYYY-MM-DD HH:mm UTC".
export function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return MISSING;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return MISSING;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

// "1 member", "3 members", "0 events". A count that is not a whole number reads as 0 (a missing count must
// never print "undefined members").
export function plural(count, singular, pluralForm = `${singular}s`) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
