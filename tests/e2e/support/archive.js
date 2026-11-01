// The archive pipeline's owner-only edges, for the live proof (archive-pipeline-live.spec.js). The tick
// (app.archive_tick) and the ledger (app.archive_events) are reachable by no API role on purpose, so the scheduler's part is
// played here the way production plays it: SQL as the database owner, through the local container (support/admins.js,
// which refuses any container that is not a Supabase CLI database on this machine). Everything an ORGANISER does goes
// over real PostgREST with a real sign-in instead; only the clock and the scheduler are the owner's.
import { sqlAsOwner } from './admins.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function id(value) {
  if (!UUID.test(value)) throw new Error('not a uuid');
  return value;
}

/** Runs a query as the owner and returns its single text value (psql's table format, header and footer stripped). */
function scalar(query) {
  const lines = sqlAsOwner(`select (${query})::text as v`)
    .split('\n')
    .map((line) => line.trim());
  const at = lines.findIndex((line) => /^-+$/.test(line));
  if (at === -1 || /^\(\d+ rows?\)$/.test(lines[at + 1])) return null;
  return lines[at + 1];
}

/** The database's own clock (the local stack runs in a VM whose clock can differ from this machine's). */
export function dbNow() {
  return new Date(scalar('clock_timestamp()').replace(' ', 'T').replace(/\+00$/, 'Z'));
}

/** Runs `app.archive_tick(floor)` as the owner and returns its JSON answer. `floor` is an ISO string or null. */
export function runTick(floor = null) {
  const arg = floor === null ? 'null' : `'${new Date(floor).toISOString()}'::timestamptz`;
  return JSON.parse(scalar(`app.archive_tick(${arg})`));
}

/** The ledger row of one event as the owner sees it, or null when there is none. */
export function ledgerRow(eventId) {
  const json = scalar(
    `select to_jsonb(a) - 'created_at' - 'updated_at' from app.archive_events a where a.event_id = '${id(eventId)}'`,
  );
  return json ? JSON.parse(json) : null;
}

/**
 * Makes a pending ledger row due: its stored due time moves to one second ago. One second, not more, so the due time
 * stays after the moment a plan was granted (the optional-listing check is evaluated AT the due time).
 */
export function makeDue(eventId) {
  sqlAsOwner(
    `update app.archive_events set due_at = clock_timestamp() - interval '1 second' where event_id = '${id(eventId)}'`,
  );
}

/** The number of public_results rows for an event, as the owner (not through the API). */
export function resultCount(eventId) {
  return Number(
    scalar(`select count(*) from public.public_results where event_id = '${id(eventId)}'`),
  );
}
