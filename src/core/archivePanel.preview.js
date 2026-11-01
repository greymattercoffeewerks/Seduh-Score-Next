// Demo harness only: mounts the real Events screen against an in-memory client so every archive state can be seen.
import { mountEventsScreen } from './eventsScreen.js';

const mode = new URLSearchParams(location.search).get('mode') ?? 'compulsory';
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const row = (id, name, extra) => ({
  id,
  org_id: 'org1',
  format: 'cup_taster',
  name,
  event_date: '2026-11-01',
  venue: 'Grey Matter',
  city: 'Bandar',
  is_test: false,
  ended_at: null,
  ...extra,
});
const events = [
  row('scheduled', 'Scheduled Cup', { ended_at: hoursAgo(1) }),
  row('overdue', 'Overdue Cup', { ended_at: hoursAgo(30) }),
  row('retrying', 'Retrying Cup', { ended_at: hoursAgo(30) }),
  row('failed', 'Failed Cup', { ended_at: hoursAgo(30) }),
  row('removed', 'Taken Down Cup', { ended_at: hoursAgo(40) }),
  row('published', 'Published Cup', { ended_at: hoursAgo(40) }),
  row('stub', 'Named Only Cup', { ended_at: hoursAgo(40) }),
  row('running', 'Running Cup'),
  row('test', 'Test Cup', { ended_at: hoursAgo(2), is_test: true }),
];
let results = [
  { event_id: 'published', payload: { podium: [{ name: 'A' }] }, published_at: hoursAgo(10) },
  { event_id: 'stub', payload: { listing: 'named_only' }, published_at: hoursAgo(10) },
];
// What archive_event_status would answer (a small ledger the harness keeps).
const ledger = {
  overdue: { state: 'pending' },
  retrying: { state: 'pending', retrying: true, reason: 'processing_error' },
  failed: { state: 'failed', reason: 'processing_error' },
  removed: { state: 'removed', removed: true },
  published: { state: 'published', published: true },
  stub: { state: 'stubbed', published: true, reason: 'no_snapshot' },
};
const entry = mode === 'off' ? { allowed: true } : { allowed: mode === 'choice', enforced: true };

const client = {
  rpc(name, args) {
    if (name === 'my_entitlements') {
      return Promise.resolve({ data: { keys: { results_archive_optional: entry } }, error: null });
    }
    if (name === 'archive_event_status') {
      return Promise.resolve({
        data: args.p_event_ids.map((id) => ({
          event_id: id,
          state: 'none',
          due_at: null,
          published: false,
          listing_choice: null,
          removed: false,
          retrying: false,
          reason: null,
          ...ledger[id],
        })),
        error: null,
      });
    }
    if (name === 'set_archive_listing') {
      if (args.p_event_id === 'overdue') {
        return Promise.resolve({
          data: null,
          error: { code: 'P0001', hint: 'archive_listing_closed' },
        });
      }
      return new Promise((resolve) =>
        setTimeout(() => {
          ledger[args.p_event_id] = {
            ...ledger[args.p_event_id],
            listing_choice: args.p_list ? 'list' : 'named_only',
          };
          resolve({ data: {}, error: null });
        }, 400),
      );
    }
    if (name === 'unpublish_event_results') {
      results = results.filter((r) => r.event_id !== args.p_event_id);
      ledger[args.p_event_id] = { state: 'removed', removed: true };
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
  from(table) {
    const builder = {
      select: () => builder,
      in: () => builder,
      eq: () => builder,
      order: () => builder,
      then: (resolve, reject) =>
        Promise.resolve({ data: table === 'events' ? events : results, error: null }).then(
          resolve,
          reject,
        ),
    };
    return builder;
  },
};

mountEventsScreen(document.getElementById('root'), {
  orgId: 'org1',
  client,
  defaultFormat: 'cup_taster',
  archivePublishHrefFor: (event) => `#/events/${event.id}/report`,
});
