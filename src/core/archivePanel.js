// The organiser's archive panel (T-ARC.4), format-agnostic: one block under an event in the Events list with the status
// line, the "List the podium" tick box (Per-event and Annual), the early "Publish now" link and, on Community, the soft
// unpublish (owner decision 7). It is INERT while the key is not enforced (archiveStatus.js): no markup, and nothing is
// asked of the database beyond the entitlement snapshot. All words are in archiveStatus.js; the database decides everything,
// and what it decided is read from public.archive_event_status (T-ARC.4c): nothing is remembered per device.
import { el, setBusyDisabled } from './dom.js';
import { loadEntitlements } from './entitlements.js';
import { raceTimeout } from './timeout.js';
import {
  archiveModeOf,
  archiveStateOf,
  normalizeArchiveStatus,
  statusText,
  listingHelpText,
  describeListingError,
  finishArchiveNote,
  finishedArchiveNote,
  LISTING_LABEL,
  UNPUBLISH_CONFIRM_TEXT,
} from './archiveStatus.js';
import {
  ARCHIVE_STATUS_MAX,
  getArchiveEventStatus,
  listPublishedResultsForEvents,
  setArchiveListing,
  unpublishEventResults,
} from './publicResults.js';

export const ARCHIVE_LOOKUP_TIMEOUT_MS = 2500;
const PER_EVENT_LOOKUPS = 10;
const PUBLISH_NOW_STATES = [
  'scheduled',
  'scheduled_named_only',
  'overdue',
  'unscheduled',
  'retrying',
  'failed',
  'listed_named_only',
  'taken_down',
];
// Once the ledger row has left 'pending' the tick box is closed (set_archive_listing: archive_listing_closed); a published,
// failed, overdue or unscheduled event is not worth offering (an overdue pending row would still accept it, but by then
// the entry is about to be decided).
const NO_LISTING_STATES = [
  'test',
  'published',
  'listed_named_only',
  'taken_down',
  'overdue',
  'unscheduled',
  'failed',
];

export function createArchiveController({
  orgId,
  client,
  signal,
  onChange,
  publishHrefFor = () => null,
  timeoutMs = ARCHIVE_LOOKUP_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  let mode = 'off';
  // The database decides per EVENT (an event grant makes one event optional on a Community organisation), so when the
  // organisation reads as compulsory the newest events are asked about individually.
  const eventModes = new Map();
  const modeFor = (event) => eventModes.get(event.id) ?? mode;
  const results = new Map();
  // event id -> the normalized archive_event_status row (an event absent from the map has no panel)
  const statuses = new Map();
  const saving = new Set();
  const unpublishing = new Set();
  const confirming = new Set();
  const errors = new Map();

  async function readStatuses(events) {
    const ids = events
      .filter((e) => !e.is_test)
      .slice(0, ARCHIVE_STATUS_MAX)
      .map((e) => e.id);
    const rows = await raceTimeout(getArchiveEventStatus(orgId, ids, client), timeoutMs);
    return new Map(rows.map((row) => [row.event_id, normalizeArchiveStatus(row)]));
  }

  // After a write the database is asked again for that one event; if it cannot answer, the local patch stands.
  async function refreshStatus(event, patch) {
    const before = statuses.get(event.id);
    if (before) statuses.set(event.id, { ...before, ...patch });
    try {
      const fresh = await readStatuses([event]);
      if (fresh.get(event.id)) statuses.set(event.id, fresh.get(event.id));
    } catch {
      /* the patched row stays until the next load */
    }
  }

  // Fail-open for the UI: any failure to find out leaves the mode 'off' and the screen as it always was.
  async function load(events) {
    mode = 'off';
    try {
      const snapshot = await raceTimeout(loadEntitlements(orgId, null, client), timeoutMs);
      const next = archiveModeOf(snapshot);
      if (next === 'off') return;
      eventModes.clear();
      if (next === 'compulsory') {
        await Promise.all(
          events
            .filter((e) => !e.is_test)
            .slice(0, PER_EVENT_LOOKUPS)
            .map(async (e) => {
              const one = await raceTimeout(loadEntitlements(orgId, e.id, client), timeoutMs);
              const eventMode = archiveModeOf(one);
              if (eventMode !== 'off') eventModes.set(e.id, eventMode);
            }),
        );
      }
      const ids = events.filter((e) => e.ended_at && !e.is_test).map((e) => e.id);
      const rows = await raceTimeout(listPublishedResultsForEvents(ids, client), timeoutMs);
      const fresh = await readStatuses(events);
      results.clear();
      for (const row of rows) results.set(row.event_id, row);
      statuses.clear();
      for (const [id, status] of fresh) if (status) statuses.set(id, status);
      mode = next;
    } catch {
      mode = 'off';
    }
  }

  function stateOf(event) {
    return archiveStateOf({
      mode: modeFor(event),
      event,
      result: results.get(event.id) ?? null,
      status: statuses.get(event.id) ?? null,
      now: now(),
    });
  }

  async function toggleListing(event, list) {
    if (saving.has(event.id) || signal?.aborted) return;
    saving.add(event.id);
    errors.delete(event.id);
    onChange(`#archive-listing-${event.id}`);
    // shown at once so the box does not snap back while the save and the re-read run; undone if the save is refused
    const before = statuses.get(event.id);
    if (before) statuses.set(event.id, { ...before, listingChoice: list ? 'list' : 'named_only' });
    try {
      await setArchiveListing(orgId, event.id, list, client);
      await refreshStatus(event, { listingChoice: list ? 'list' : 'named_only' });
    } catch (error) {
      if (before) statuses.set(event.id, before);
      errors.set(event.id, describeListingError(error));
    }
    saving.delete(event.id);
    onChange(`#archive-listing-${event.id}`);
  }

  async function takeDown(event) {
    if (unpublishing.has(event.id) || signal?.aborted) return;
    unpublishing.add(event.id);
    errors.delete(event.id);
    onChange(`#archive-confirm-unpublish-${event.id}`);
    try {
      await unpublishEventResults(orgId, event.id, client);
      results.delete(event.id);
      await refreshStatus(event, { removed: true, published: false });
    } catch {
      errors.set(event.id, "Couldn't take it down. Please try again.");
    }
    unpublishing.delete(event.id);
    confirming.delete(event.id);
    onChange(`#archive-panel-${event.id}`);
  }

  function listingControl(event) {
    const listed = statuses.get(event.id)?.listingChoice === 'list';
    const helpId = `archive-listing-help-${event.id}`;
    const input = el('input', {
      id: `archive-listing-${event.id}`,
      attrs: { type: 'checkbox', 'aria-describedby': helpId },
    });
    input.checked = listed;
    setBusyDisabled(input, saving.has(event.id));
    input.addEventListener('change', () => toggleListing(event, input.checked));
    return el('div', { className: 'archive-listing' }, [
      el('div', { className: 'checkbox-field' }, [
        input,
        el('label', { text: LISTING_LABEL, attrs: { for: input.id } }),
      ]),
      el('p', { id: helpId, className: 'stage-meta', text: listingHelpText(listed) }),
    ]);
  }

  function confirmUnpublish(event) {
    const copyId = `archive-unpublish-copy-${event.id}`;
    const busy = unpublishing.has(event.id);
    const confirm = el('button', {
      id: `archive-confirm-unpublish-${event.id}`,
      className: 'btn btn-outline tap-target',
      text: busy ? 'Taking down…' : 'Take it down',
      attrs: {
        type: 'button',
        'aria-describedby': copyId,
        'aria-label': busy ? 'Taking down…' : `Take it down: results of "${event.name}"`,
      },
    });
    setBusyDisabled(confirm, busy);
    confirm.addEventListener('click', () => takeDown(event));
    const cancel = el('button', {
      id: `archive-cancel-unpublish-${event.id}`,
      className: 'btn btn-outline tap-target',
      text: 'Keep it published',
      attrs: { type: 'button' },
    });
    cancel.disabled = busy;
    cancel.addEventListener('click', () => {
      confirming.delete(event.id);
      onChange(`#archive-unpublish-${event.id}`);
    });
    return el('div', { className: 'archive-actions' }, [
      el('p', { id: copyId, text: UNPUBLISH_CONFIRM_TEXT }),
      confirm,
      cancel,
    ]);
  }

  function unpublishButton(event) {
    const button = el('button', {
      id: `archive-unpublish-${event.id}`,
      className: 'btn btn-outline tap-target',
      text: 'Take down results',
      attrs: { type: 'button', 'aria-label': `Take down results: "${event.name}"` },
    });
    button.addEventListener('click', () => {
      confirming.add(event.id);
      onChange(`#archive-confirm-unpublish-${event.id}`);
    });
    return button;
  }

  // The panel for one event, or null when there is nothing to say (dark, or nothing useful yet).
  function renderFor(event) {
    const state = stateOf(event);
    if (state.kind === 'off') return null;
    // Community's running event needs no panel: the Finish step says what follows.
    const eventMode = modeFor(event);
    if (state.kind === 'open' && eventMode === 'compulsory') return null;
    const children = [];
    const text = statusText(state);
    if (text) children.push(el('p', { className: 'archive-status', text }));
    if (eventMode === 'choice' && !NO_LISTING_STATES.includes(state.kind)) {
      children.push(listingControl(event));
    }
    const publishHref = publishHrefFor(event);
    const actions = [];
    if (publishHref && PUBLISH_NOW_STATES.includes(state.kind)) {
      actions.push(
        el('a', {
          id: `archive-publish-now-${event.id}`,
          className: 'btn btn-outline tap-target',
          text: 'Publish now',
          attrs: { href: publishHref, 'aria-label': `Publish now: results of "${event.name}"` },
        }),
      );
    }
    const canTakeDown = eventMode === 'compulsory' && state.kind === 'published';
    if (canTakeDown && !confirming.has(event.id)) actions.push(unpublishButton(event));
    if (actions.length > 0) children.push(el('div', { className: 'archive-actions' }, actions));
    if (canTakeDown && confirming.has(event.id)) children.push(confirmUnpublish(event));
    if (errors.has(event.id)) {
      children.push(
        el('p', {
          className: 'archive-error',
          text: errors.get(event.id),
          attrs: { role: 'alert' },
        }),
      );
    }
    return el(
      'div',
      {
        className: 'archive-panel',
        id: `archive-panel-${event.id}`,
        attrs: {
          role: 'group',
          tabindex: '-1',
          'aria-label': `Public archive for "${event.name}"`,
          'data-archive-state': state.kind,
          'data-archive-mode': eventMode,
        },
      },
      children,
    );
  }

  return {
    load,
    renderFor,
    mode: () => mode,
    finishNote: (event) => finishArchiveNote(event ? modeFor(event) : mode),
    finishedNote: (event) => finishedArchiveNote(modeFor(event), event),
  };
}
