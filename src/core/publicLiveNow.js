// "Live now" on the public landing page — the client side of public.public_live_now()
// (supabase/migrations/20261029100000_homepage_live_listing.sql). Format-agnostic: the door lists any
// format's live event whose organiser opted in to being listed on the homepage; this only asks and tidies
// the answer. It is anon-safe by construction (the door returns event name, organiser name and slug, format
// and a count; no id, no payload, no person).
//
// Rows are TYPED (`kind`). Only 'live' exists today; a row of any other kind, or one that does not look right,
// is dropped here so the page can be extended with a new kind without a page change breaking on old data.
// A malformed answer is "nothing live". A failed or slow request rejects and is the caller's to swallow (the
// bar is optional).
import { getSupabase } from './supabaseClient.js';
import { callDoor } from './doorCall.js';
import { cleanOrgName } from './orgLabel.js';

const SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;
// Names are typed by organisers and shown in one slim line: control characters out, whitespace collapsed,
// bidi controls out (cleanOrgName), and a hard length cap so one long name cannot take over the page.
const EVENT_NAME_MAX = 80;
const ORG_NAME_MAX = 60;

function tidy(text, max) {
  if (typeof text !== 'string') return '';
  const flat = cleanOrgName(text)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  const chars = Array.from(flat);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : flat;
}

/**
 * The audience page a visitor should open for a live event: the PHONE view, the one made for people
 * watching on their own devices (the projector is a venue display, the splash a before-the-event welcome).
 * Slug-qualified so it names the organiser. null when the slug is not a slug.
 */
export function liveAudienceHref(orgSlug) {
  return typeof orgSlug === 'string' && orgSlug.length <= 100 && SLUG_PATTERN.test(orgSlug)
    ? `/app/#/live/${encodeURIComponent(orgSlug)}/phone`
    : null;
}

/** One door row to a tidy typed row, or null when it is not a usable 'live' row. */
export function liveNowRow(row) {
  if (row?.kind !== 'live') return null;
  const href = liveAudienceHref(row.org_slug);
  const eventName = tidy(row.event_name, EVENT_NAME_MAX);
  if (!href || !eventName) return null;
  return {
    kind: 'live',
    eventName,
    // An organiser with no usable name is left out of the sentence, never guessed at.
    orgName: tidy(row.org_name, ORG_NAME_MAX) || null,
    format: typeof row.format === 'string' ? row.format : null,
    href,
  };
}

/**
 * Everything live and listed right now, as `{ rows, total }`: `rows` the tidy rows (the door caps them at 3),
 * `total` how many are listed in all (>= rows.length). `{ rows: [], total: 0 }` when nothing is live.
 * Rejects on a failed request.
 */
export async function findLiveNow(client = getSupabase()) {
  const response = await callDoor(client, 'public_live_now', {});
  if (response.status !== 'ok') throw response.error;
  if (!Array.isArray(response.data)) throw new Error('public_live_now: unexpected response');
  const rows = response.data.map(liveNowRow).filter(Boolean);
  if (!rows.length) return { rows: [], total: 0 };
  const reported = Number(response.data[0]?.listed_count);
  return {
    rows,
    total: Number.isFinite(reported) ? Math.max(rows.length, Math.floor(reported)) : rows.length,
  };
}
