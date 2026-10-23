// How the Plan panel writes tiers, windows and states. Pure functions, nothing here touches the page. Times of a Per-event
// window are shown in Brunei time (Asia/Brunei, UTC+8), the zone the window is counted in (spec D-G15, D-G26); every
// other date in the console stays UTC (format.js).
const MISSING = '—';
const BRUNEI_TZ = 'Asia/Brunei';

const TIER_LABELS = Object.freeze({
  community: 'Community',
  per_event: 'Per-event',
  annual: 'Annual',
});
const SOURCE_LABELS = Object.freeze({
  manual: 'Granted by hand',
  default: 'Default grant',
  payment: 'Payment confirmed',
});

export function tierLabel(tier) {
  return typeof tier === 'string' && Object.hasOwn(TIER_LABELS, tier)
    ? TIER_LABELS[tier]
    : String(tier ?? MISSING);
}

export function sourceLabel(source) {
  return typeof source === 'string' && Object.hasOwn(SOURCE_LABELS, source)
    ? SOURCE_LABELS[source]
    : String(source ?? MISSING);
}

function parts(value) {
  const date = new Date(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(date.getTime()))
    return null;
  const found = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BRUNEI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  // some engines print midnight as 24
  return { ...found, hour: found.hour === '24' ? '00' : found.hour };
}

// "2026-12-08 00:00" in Brunei time, or an em dash.
export function bruneiDateTime(value) {
  const p = parts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : MISSING;
}

// "2026-12-08" in Brunei time, or an em dash.
export function bruneiDay(value) {
  const p = parts(value);
  return p ? `${p.year}-${p.month}-${p.day}` : MISSING;
}

// "2026-12-08 00:00 to 2026-12-13 00:00 Brunei time", or "from ... with no end".
export function windowText(grant) {
  if (!grant?.valid_until) return `from ${bruneiDateTime(grant?.valid_from)} Brunei time, no end`;
  return `${bruneiDateTime(grant.valid_from)} to ${bruneiDateTime(grant.valid_until)} Brunei time`;
}

// The five Brunei calendar days a start offset (-4 to 0, counted from the event date) gives, as two YYYY-MM-DD strings:
// "T-2 to T+2" for an event on the 10th and offset -2 is the 8th to the 12th. null for a date or offset that cannot be one.
export function windowDays(eventDate, offset) {
  if (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  if (!Number.isInteger(offset) || offset < -4 || offset > 0) return null;
  const base = Date.parse(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  const day = (n) => new Date(base + n * 86400000).toISOString().slice(0, 10);
  return { first: day(offset), last: day(offset + 4) };
}

// The label of an offset: -2 is "T-2 to T+2" (T is the competition date).
export function offsetLabel(offset) {
  const sign = (n) => (n === 0 ? 'T' : n > 0 ? `T+${n}` : `T${n}`);
  return `${sign(offset)} to ${sign(offset + 4)}`;
}

// The instant a window ends when it is "extended to the end of <YYYY-MM-DD>": 00:00 Brunei time on the next day, which
// is how the five-day windows end. null for anything that is not a date.
export function endOfBruneiDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const base = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  const next = new Date(base + 86400000).toISOString().slice(0, 10);
  return `${next}T00:00:00+08:00`;
}

// What state an event is in, in words: how it ended, or that it is still open.
export function eventStateText(event) {
  switch (event?.ended_via) {
    case 'organiser':
      return 'Finished by the organiser';
    case 'concluded':
      return 'Finished (the champion was declared)';
    case 'admin_release':
      return 'Released by an admin';
    default:
      return 'Open';
  }
}

// A Per-event window in words, for an event row.
export function eventWindowText(event) {
  if (!event?.has_window) return 'No Per-event plan';
  const ends = bruneiDateTime(event.window_ends_at);
  return event.window_ended
    ? `Per-event plan ended ${ends} Brunei time`
    : `Per-event plan ends ${ends} Brunei time`;
}

// The most an input can say: a short stable form of an id for a line of text ("granted by 3f2a91c0").
export function shortId(id) {
  return typeof id === 'string' && id.length >= 8 ? id.slice(0, 8) : MISSING;
}

// What a key needs and what it limits, in one line.
export function keyRuleText(key) {
  if (key?.kind === 'cap') {
    const caps = key.caps && typeof key.caps === 'object' ? key.caps : {};
    const rows = Object.keys(TIER_LABELS)
      .filter((tier) => Object.hasOwn(caps, tier))
      .map((tier) => `${tierLabel(tier)} ${caps[tier] === null ? 'no limit' : caps[tier]}`);
    return `Limit: ${rows.join(', ')}`;
  }
  return key?.min_tier ? `Needs ${tierLabel(key.min_tier)} or above` : 'Open to every tier';
}
