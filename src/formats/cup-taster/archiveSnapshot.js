// The Cup Taster archive snapshot (T-ARC.2): what the organiser's browser stages for the database's archive tick to
// publish 24 hours after the event ends. It is the SAME payload the manual "Publish to results archive" button sends,
// podium scope, built by the same reviewed code (computeEventSummary -> buildResultsPayload), so nothing here ranks anyone
// or decides who won. The database whitelists it again (stage time and publish time) and refuses it when stale.
//
// Called at champion resolve (standingsScreen) and whenever the finished report opens (reportScreen), through the outbox
// (core/archiveStaging.js), so it works offline and builds AFTER the resolve_stage that declared the champion has synced.
import { findEvent } from '../../core/events.js';
import { listEntriesByIds } from '../../core/registry.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { archiveStagingHandler, submitArchiveStaging } from '../../core/archiveStaging.js';
import { listStagesForEvent } from './setup.js';
import { isEventComplete, computeStageReport, computeEventSummary } from './analytics.js';
import { buildResultsPayload, podiumRowsOf } from './resultsPublishing.js';

const MAX_PODIUM_ROWS = 8; // app.archive_snapshot_payload's own limit

// The snapshot for an intent ({ orgId, eventId }), or null when there is nothing to stage: a test event, an event whose
// terminal stage is not complete yet, or one with nobody ranked.
export async function buildArchiveSnapshot(intent, client = getSupabase()) {
  const event = await findEvent(intent.eventId, client);
  if (event.is_test) return null;
  if (!(await isEventComplete(intent.eventId, client))) return null;

  const stages = await listStagesForEvent(intent.eventId, client);
  const stageReports = [];
  for (const stage of stages) {
    stageReports.push(await computeStageReport(stage.id, client));
  }
  const summary = computeEventSummary(stageReports);
  if (summary.length === 0) return null;

  // only the podium's cafés are looked up, in chunks so a large tie never makes one request URL long
  const podiumIds = podiumRowsOf(summary).map((row) => row.entryId);
  const entries = [];
  for (let start = 0; start < podiumIds.length; start += 50) {
    entries.push(...(await listEntriesByIds(podiumIds.slice(start, start + 50), client)));
  }
  const payload = buildResultsPayload({
    event,
    stageReports,
    summary,
    cafeByEntryId: new Map(entries.map((entry) => [entry.id, entry.cafe ?? null])),
    scope: 'podium',
  });
  // a tie at third place can make more than the eight rows the archive accepts: nothing to stage, the tick publishes a stub
  return payload.podium.length > MAX_PODIUM_ROWS ? null : payload;
}

export function archiveStagingHandlers(client) {
  return {
    stage_archive_payload: archiveStagingHandler(client, (i) => buildArchiveSnapshot(i, client)),
  };
}

// Enqueues the intent, then tries to flush. `event` is the caller's already-loaded event row (org_id, id, is_test).
// Best-effort by design: the archive is fail-open and nothing here may block or fail the organiser's own work, so a
// failure is logged, never thrown (an intent that could not even be queued is announced by the outbox itself).
export async function stageArchiveSnapshot(event, handlers) {
  try {
    await submitArchiveStaging(
      { orgId: event.org_id, eventId: event.id, isTest: event.is_test === true },
      handlers,
    );
  } catch (error) {
    console.error('archive snapshot staging failed (may still be queued)', error);
  }
}
