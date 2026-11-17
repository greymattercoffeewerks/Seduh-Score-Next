// The pure half of the organiser's Events home (core/eventsScreen.js): what is live, what is next, how the rest
// group, which tags a row wears and what needs attention across events. No DOM, no clock of its own (`now` and
// `today` are arguments), and no format knowledge: what a count MEANS (heats drawn, no judges yet) is the
// format's wording and arrives through the caller's `describeEvent(event, facts, { isLive })`, which main.js
// composes (src/organiserHome.js). This module only knows the shape of its answer:
//
//   { summary: string|null,      the row's short state line ("16 cuppers · 4 heats drawn")
//     ready: boolean|null,       true = ready to run, false = still in setup, null = not known
//     phase: string|null,        the live card's first line ("Round 2")
//     next: string|null,         the live card's next step ("next: score match 17")
//     progress: { done, total, active, text }|null,
//     action: { label, href }|null,   an optional second button on the live card
//     attention: [{ id, severity, text, href, actionLabel }] }   the kit's warning shape (core/eventWarnings.js)
import { normaliseWarnings } from './eventWarnings.js';
import { safeHref } from './kitLink.js';

const MAX_TEXT = 200;

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, MAX_TEXT);
}

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);

// Pure. Whatever a caller's describeEvent returned (or threw, or forgot to return) as the one safe shape. A throw
// is the caller's: it is caught here so one format's bug cannot blank the organiser's landing page.
export function describeSafely(describeEvent, event, summary) {
  let raw = null;
  if (typeof describeEvent === 'function') {
    try {
      raw = describeEvent(event, summary?.facts ?? null, { isLive: summary?.isLive === true });
    } catch (err) {
      console.error('eventHome: describeEvent failed', err);
    }
  }
  const progressRaw = raw?.progress;
  const total = count(progressRaw?.total);
  const progress =
    progressRaw && total > 0
      ? {
          done: Math.min(count(progressRaw.done), total),
          total,
          active: count(progressRaw.active),
          text: cleanText(progressRaw.text),
        }
      : null;
  const actionHref = safeHref(raw?.action?.href);
  const actionLabel = cleanText(raw?.action?.label);
  return {
    summary: cleanText(raw?.summary),
    ready: typeof raw?.ready === 'boolean' ? raw.ready : null,
    phase: cleanText(raw?.phase),
    next: cleanText(raw?.next),
    progress,
    action: actionHref && actionLabel ? { label: actionLabel, href: actionHref } : null,
    attention: Array.isArray(raw?.attention) ? raw.attention : [],
  };
}

// Pure. "Sat 21 Nov" for a date this year, "Sat 5 Dec 2027" otherwise; the date is a calendar day (no time zone),
// so it is read and written in UTC. Anything that is not a YYYY-MM-DD date comes back as null.
export function formatEventDate(iso, now = new Date()) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(date)
    .replace(',', '');
}

// Pure. "Sat 21 Nov · The Roastery · Gadong": the date, venue and city that are set, in that order.
export function eventMeta(event, now = new Date()) {
  return [formatEventDate(event?.event_date, now), event?.venue, event?.city]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(' · ');
}

// Pure. The one event an organisation shows as "Live now": the open event whose live session is active. The database
// allows one active session per organisation, so the first is the only; a finished event is never live.
export function findLiveEvent(events, summariesById) {
  return (
    events.find((event) => !event.ended_at && summariesById.get(event.id)?.isLive === true) ?? null
  );
}

// Pure. The event to feature when nothing is live: the open event dated soonest from `today` (YYYY-MM-DD) on, else
// the open event with no date or only past dates that was made most recently (the list is newest first).
export function findNextEvent(events, today) {
  const open = events.filter((event) => !event.ended_at);
  const dated = open
    .filter(
      (event) => typeof event.event_date === 'string' && event.event_date.slice(0, 10) >= today,
    )
    .sort((a, b) => a.event_date.slice(0, 10).localeCompare(b.event_date.slice(0, 10)));
  return dated[0] ?? open[0] ?? null;
}

// Pure. The events a format filter keeps ('all' keeps everything; a format nobody has keeps nothing).
export function filterByFormat(events, formatFilter) {
  if (!formatFilter || formatFilter === 'all') return events;
  return events.filter((event) => event.format === formatFilter);
}

// Pure. Everything the home draws, decided in one place. `summariesById` is a Map of event id to
// `{ isLive, facts }` (empty when the summary read failed). The featured event (live, else next) is not repeated in
// the list; the format filter narrows the list only, never the live card, the counts or the attention list (an
// organiser who filters to Throwdown must still see that a BTC event is live).
export function buildHome({ events, summariesById, describeEvent, formatFilter = 'all', today }) {
  const views = new Map();
  for (const event of events) {
    views.set(event.id, {
      event,
      isLive: summariesById.get(event.id)?.isLive === true && !event.ended_at,
      info: describeSafely(describeEvent, event, summariesById.get(event.id)),
    });
  }
  const live = findLiveEvent(events, summariesById);
  const featured = live ?? findNextEvent(events, today);
  const open = events.filter((event) => !event.ended_at);
  const finished = events.filter((event) => event.ended_at);
  const listed = (list) =>
    filterByFormat(list, formatFilter)
      .filter((event) => event.id !== featured?.id)
      .map((event) => views.get(event.id));
  return {
    views,
    liveView: live ? views.get(live.id) : null,
    nextView: !live && featured ? views.get(featured.id) : null,
    upcoming: listed(open),
    finished: listed(finished),
    counts: {
      live: live ? 1 : 0,
      comingUp: open.length - (live ? 1 : 0),
      finished: finished.length,
      total: events.length,
    },
    attention: collectAttention(events.map((event) => views.get(event.id))),
  };
}

// Pure. "1 live · 3 coming up · 9 finished", leaving out a part that is 0 ("No events yet" when there are none).
export function countsLine({ live, comingUp, finished, total }) {
  if (total === 0) return 'No events yet';
  return [
    live > 0 ? `${live} live` : null,
    comingUp > 0 ? `${comingUp} coming up` : null,
    finished > 0 ? `${finished} finished` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Pure. The tags a row wears, in the order they read: [{ state, label }] with `state` a core/vocabulary.js status
// state. Test data is ALWAYS tagged (D9), whatever else is true of the event.
export function rowTags(view) {
  const { event, isLive, info } = view;
  const tags = [];
  if (event.ended_at) tags.push({ state: 'done', label: 'Finished' });
  else if (isLive) tags.push({ state: 'live', label: 'Live' });
  else if (info.ready === true) tags.push({ state: 'done', label: 'Ready' });
  else if (info.ready === false) tags.push({ state: 'queued', label: 'In setup' });
  if (event.is_test) tags.push({ state: 'test', label: 'Test data' });
  return tags;
}

const hrefFor = (event) => `#/events/${encodeURIComponent(event.id)}`;

// Pure. What needs attention across every event, in the kit's warning shape (core/eventWarnings.js orders and
// draws it). The format's own items come from describeEvent and are named for their event so two events can warn
// the same thing; what is true of ANY event is here: an open event with no venue, and test data left behind (a
// finished or live test event is not nagged about: only one that is waiting).
export function collectAttention(views) {
  const items = [];
  for (const view of views) {
    const { event, info } = view;
    const name = event.name;
    if (!event.ended_at && !view.isLive && event.is_test) {
      items.push({
        id: `${event.id}:test`,
        severity: 'info',
        text: `${name} is test data: delete it when you are done.`,
        href: hrefFor(event),
        actionLabel: 'Open',
      });
    }
    if (!event.ended_at && !event.is_test && (event.venue ?? '').trim() === '') {
      items.push({
        id: `${event.id}:venue`,
        severity: 'info',
        text: `${name} has no venue yet.`,
        href: hrefFor(event),
        actionLabel: 'Open',
      });
    }
    if (event.ended_at) continue;
    for (const item of normaliseWarnings(info.attention)) {
      items.push({
        ...item,
        id: `${event.id}:${item.id}`,
        text: `${name}: ${item.text}`,
        href: item.href ?? hrefFor(event),
      });
    }
  }
  return normaliseWarnings(items);
}
