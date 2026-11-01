// The organiser's archive panel (T-ARC.4), format-agnostic: one block under an event in the Events list with the status
// line, the "List the podium" tick box (Per-event and Annual), the early "Publish now" link and, on Community, the soft
// unpublish (owner decision 7). It is INERT while the key is not enforced (archiveStatus.js): no markup, and nothing is
// asked of the database beyond the entitlement snapshot. All words are in archiveStatus.js; the database decides everything.
import { el, setBusyDisabled } from './dom.js';
import { loadEntitlements } from './entitlements.js';
import { raceTimeout } from './timeout.js';
import {
  archiveModeOf,
  archiveStateOf,
  statusText,
  listingHelpText,
  describeListingError,
  finishArchiveNote,
  finishedArchiveNote,
  LISTING_LABEL,
  UNPUBLISH_CONFIRM_TEXT,
} from './archiveStatus.js';
import {
  listPublishedResultsForEvents,
  setArchiveListing,
  unpublishEventResults,
} from './publicResults.js';

export const ARCHIVE_LOOKUP_TIMEOUT_MS = 2500;
const CHOICE_KEY = (eventId) => `seduh.archiveListing.${eventId}`;
const PUBLISH_NOW_STATES = [
  'scheduled',
  'scheduled_named_only',
  'overdue',
  'listed_named_only',
  'taken_down',
];
const NO_LISTING_STATES = ['test', 'published', 'listed_named_only', 'taken_down'];

export function createArchiveController({
  orgId,
  client,
  signal,
  onChange,
  publishHrefFor = () => null,
  storage = globalThis.localStorage ?? null,
  timeoutMs = ARCHIVE_LOOKUP_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  let mode = 'off';
  const results = new Map();
  const choices = new Map();
  const saving = new Set();
  const unpublishing = new Set();
  const confirming = new Set();
  const takenDown = new Set();
  const errors = new Map();

  // The tick box's saved value is not readable by a member (the ledger is owner-only), so the last choice made on this
  // device is shown. A different device starts unticked. Logged as a finding.
  function remembered(eventId) {
    try {
      return storage?.getItem(CHOICE_KEY(eventId)) === 'list';
    } catch {
      return false;
    }
  }
  function remember(eventId, list) {
    try {
      storage?.setItem(CHOICE_KEY(eventId), list ? 'list' : 'named_only');
    } catch {
      /* the tick box still works; it starts unticked next visit */
    }
  }

  // Fail-open for the UI: any failure to find out leaves the mode 'off' and the screen as it always was.
  async function load(events) {
    mode = 'off';
    try {
      const snapshot = await raceTimeout(loadEntitlements(orgId, null, client), timeoutMs);
      const next = archiveModeOf(snapshot);
      if (next === 'off') return;
      const ids = events.filter((e) => e.ended_at && !e.is_test).map((e) => e.id);
      const rows = await raceTimeout(listPublishedResultsForEvents(ids, client), timeoutMs);
      results.clear();
      for (const row of rows) results.set(row.event_id, row);
      for (const event of events) choices.set(event.id, remembered(event.id));
      mode = next;
    } catch {
      mode = 'off';
    }
  }

  function stateOf(event) {
    return archiveStateOf({
      mode,
      event,
      result: results.get(event.id) ?? null,
      listed: choices.get(event.id) === true,
      takenDown: takenDown.has(event.id),
      now: now(),
    });
  }

  async function toggleListing(event, list) {
    if (saving.has(event.id) || signal?.aborted) return;
    saving.add(event.id);
    errors.delete(event.id);
    onChange(`#archive-listing-${event.id}`);
    try {
      await setArchiveListing(orgId, event.id, list, client);
      choices.set(event.id, list);
      remember(event.id, list);
    } catch (error) {
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
      takenDown.add(event.id);
    } catch {
      errors.set(event.id, "Couldn't take it down. Please try again.");
    }
    unpublishing.delete(event.id);
    confirming.delete(event.id);
    onChange(`#archive-panel-${event.id}`);
  }

  function listingControl(event) {
    const listed = choices.get(event.id) === true;
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
        'aria-label': busy ? 'Taking down' : `Take down the results of "${event.name}"`,
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
      attrs: { type: 'button', 'aria-label': `Take down the results of "${event.name}"` },
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
    if (state.kind === 'open' && mode === 'compulsory') return null;
    const children = [];
    const text = statusText(state);
    if (text) children.push(el('p', { className: 'archive-status', text }));
    if (mode === 'choice' && !NO_LISTING_STATES.includes(state.kind)) {
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
          attrs: { href: publishHref, 'aria-label': `Publish the results of "${event.name}" now` },
        }),
      );
    }
    const canTakeDown = mode === 'compulsory' && state.kind === 'published';
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
          'data-archive-mode': mode,
        },
      },
      children,
    );
  }

  return {
    load,
    renderFor,
    mode: () => mode,
    finishNote: () => finishArchiveNote(mode),
    finishedNote: (event) => finishedArchiveNote(mode, event),
  };
}
