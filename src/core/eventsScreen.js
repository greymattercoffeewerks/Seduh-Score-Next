// The organiser's home (2026-08-29 app-wiring pass; rebuilt 2026-11-17 as the "Organiser home", the approved design
// canvas of that date): the organisation's live event (or the one coming up next), its events grouped as coming up
// and in setup / finished with a format filter, and a right rail of what needs attention across events, the audience
// links and the organisation's own links. Creating an event is its own screen (core/newEventScreen.js, `+ New event`).
//
// Lives in `core/`, not in a format: `core/events.js` treats `format` as plain caller-supplied input, so this screen
// is the same kind of module. It never names a format. What a format's count means ("4 heats drawn", "no judges
// yet"), its names, descriptions and progress arrive from the composition root (src/organiserHome.js, through
// main.js) as `formatOptions` and `describeEvent`; the pure grouping is core/eventHome.js. The per-event facts come
// from ONE read for the organisation (`org_event_summaries`), and if that read fails the home still lists every
// event, with the state lines left out.
import { getSupabase } from './supabaseClient.js';
import { el, setBusyDisabled } from './dom.js';
import { describeError } from './errors.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';
import { listEventsForOrg, listEventSummaries, deleteTestEvent, finishEvent } from './events.js';
import { buildEventWarnings } from './eventWarnings.js';
import { buildMeter, statusMark } from './vocabulary.js';
import { buildHome, countsLine, describeSafely, eventMeta, rowTags } from './eventHome.js';
import { countOperationsInOrg } from './outbox.js';
import { buildAudienceLinksCard } from './audienceLinksCard.js';
import { createArchiveController } from './archivePanel.js';

// Delete is only ever offered for is_test events — matches
// delete_test_event's own server-side guard (supabase/migrations/
// 20260905130000_delete_test_event_rpc.sql) exactly, so the button is never
// shown somewhere it could only ever fail. `deleteState` is one of
// undefined | 'checking' | 'confirming' | 'deleting' ('checking', the brief
// unsynced-writes read, renders like undefined), keyed by event id in the caller's
// own closure state — only ever one row's own delete action is mid-flow at
// a time in practice, but this is per-row, not a single shared value, so a
// stale confirm on one row never bleeds into another's.
//
// Short: the count is a local IndexedDB read that normally takes
// milliseconds; this only bounds a hung open.
const UNSYNCED_CHECK_TIMEOUT_MS = 2000;

// `unsyncedWrites` is this device's outbox size when Delete was clicked
// (null if it couldn't be read). Deleting a test event with writes still
// queued turns its leftovers into "N writes lost" on the sync panel — a
// false alarm on event day (offline-sync-auditor D1, 2026-09-27) — so the
// confirm step says so. It counts every queued write on this device, not
// just this event's: the outbox is format-agnostic and doesn't know which
// event a payload belongs to.
//
// The advice points at re-clicking Delete, which re-reads the count, not at
// the sync panel: with no event open the panel never says "Synced" (an empty
// queue renders blank), and once any write is lost it stays on that notice
// (ui-accessibility-reviewer + offline-sync-auditor, 2026-09-27).
function unsyncedWritesWarning(unsyncedWrites) {
  if (unsyncedWrites === 0 || unsyncedWrites === undefined) return null;
  if (unsyncedWrites === null) {
    return "Couldn't check this device for writes that haven't synced yet. Cancel, then click Delete again to re-check.";
  }
  const [writes, them] =
    unsyncedWrites === 1
      ? ["1 write on this device hasn't", 'it']
      : [`${unsyncedWrites} writes on this device haven't`, 'them'];
  return `${writes} synced yet. Deleting now can make ${them} show as lost on the sync panel until this tab is closed. Cancel, wait a moment, then click Delete again to re-check.`;
}

function renderDeleteAction(
  event,
  deleteState,
  { onDeleteClick, onConfirmDelete, onCancelDelete },
  unsyncedWrites,
) {
  if (!event.is_test) return null;

  if (deleteState === 'deleting') {
    return el('span', { className: 'stage-meta', text: 'Deleting…' });
  }
  if (deleteState === 'confirming') {
    const warning = unsyncedWritesWarning(unsyncedWrites);
    const warningId = `delete-warning-${event.id}`;
    const confirmButton = el('button', {
      className: 'btn btn-outline tap-target',
      id: `confirm-delete-${event.id}`,
      text: 'Confirm delete',
      attrs: {
        type: 'button',
        'aria-label': `Confirm deleting "${event.name}" — this cannot be undone`,
        // Focus lands on this button, so the warning must reach it too.
        ...(warning ? { 'aria-describedby': warningId } : {}),
      },
    });
    confirmButton.addEventListener('click', () => onConfirmDelete(event.id));
    const cancelButton = el('button', {
      className: 'btn btn-outline tap-target',
      id: `cancel-delete-${event.id}`,
      text: 'Cancel',
      attrs: { type: 'button', 'aria-label': `Cancel deleting "${event.name}"` },
    });
    cancelButton.addEventListener('click', () => onCancelDelete(event.id));
    return el('span', { className: 'event-delete-confirm' }, [
      el('span', { text: 'Delete this test event? This cannot be undone.' }),
      ...(warning
        ? [el('span', { className: 'event-delete-warning', id: warningId, text: warning })]
        : []),
      confirmButton,
      cancelButton,
    ]);
  }

  const deleteButton = el('button', {
    className: 'btn btn-outline tap-target',
    id: `delete-event-${event.id}`,
    text: 'Delete',
    attrs: { type: 'button', 'aria-label': `Delete "${event.name}"` },
  });
  deleteButton.addEventListener('click', () => onDeleteClick(event.id));
  return deleteButton;
}

function renderFinishAction(
  event,
  finishState,
  finishError,
  { onFinishClick, onConfirmFinish, onCancelFinish },
  finishNote = null,
) {
  if (event.ended_at) return el('span', { className: 'stage-meta', text: 'Finished' });
  if (finishState === 'finishing') {
    const finishingButton = el('button', {
      className: 'btn btn-outline tap-target',
      id: `finish-event-${event.id}`,
      text: 'Finishing…',
      attrs: {
        type: 'button',
        'aria-label': `Finishing "${event.name}"`,
        'data-focus-key': `finish-event-${event.id}`,
      },
    });
    setBusyDisabled(finishingButton, true);
    finishingButton.addEventListener('click', () => onFinishClick(event.id));
    return finishingButton;
  }
  if (finishState === 'confirming') {
    const copyId = `finish-copy-${event.id}`;
    const confirmButton = el('button', {
      className: 'btn btn-outline tap-target',
      id: `confirm-finish-${event.id}`,
      text: 'Confirm finish',
      attrs: {
        type: 'button',
        'aria-label': `Confirm finishing "${event.name}"`,
        // Focus lands here, so the irreversible consequence must reach it too.
        'aria-describedby': copyId,
        'data-focus-key': `confirm-finish-${event.id}`,
      },
    });
    confirmButton.addEventListener('click', () => onConfirmFinish(event.id));
    const cancelButton = el('button', {
      className: 'btn btn-outline tap-target',
      id: `cancel-finish-${event.id}`,
      text: 'Cancel',
      attrs: { type: 'button', 'aria-label': `Cancel finishing "${event.name}"` },
    });
    cancelButton.addEventListener('click', () => onCancelFinish(event.id));
    return el('span', { className: 'event-finish-confirm' }, [
      el('span', {
        id: copyId,
        text:
          'Finish this event? It stops counting as open. Results and audience links stay available, but organisers cannot reopen it.' +
          (event.is_test || !finishNote ? '' : ` ${finishNote}`),
      }),
      confirmButton,
      cancelButton,
    ]);
  }
  const finishButton = el('button', {
    className: 'btn btn-outline tap-target',
    id: `finish-event-${event.id}`,
    text: 'Finish event',
    attrs: {
      type: 'button',
      // The accessible name must contain the visible label (WCAG 2.5.3).
      'aria-label': `Finish event "${event.name}"`,
      'data-focus-key': `finish-event-${event.id}`,
    },
  });
  finishButton.addEventListener('click', () => onFinishClick(event.id));
  return el('span', { className: 'event-finish-action' }, [
    finishButton,
    ...(finishError ? [el('span', { text: finishError, attrs: { role: 'alert' } })] : []),
  ]);
}

// How many "Needs attention" items the rail lists before saying how many more there are.
const MAX_ATTENTION = 8;

// The summary read is a second, softer read: it must never hold the landing page up for as long as the event list may.
const SUMMARIES_TIMEOUT_MS = 4000;

const formatLabelFor = (formatOptions, formatValue) =>
  formatOptions?.find((option) => option.value === formatValue)?.label ?? formatValue;

// What a row needs to draw an event it has no summary for (a bare list, or a failed summary read).
function bareView(event) {
  return { event, isLive: false, info: describeSafely(null, event, null) };
}

// The Finish / Delete actions of one row, kept off its main line: behind a "Manage" toggle, in a panel that stays
// in the DOM (hidden) so a flow in progress never loses its buttons.
function renderManage(event, view, ctx) {
  const actions = [];
  const deleteAction = renderDeleteAction(
    event,
    ctx.deleteStates?.[event.id],
    ctx.deleteHandlers ?? {},
    ctx.unsyncedWrites,
  );
  if (deleteAction) actions.push(deleteAction);
  if (!event.ended_at) {
    actions.push(
      renderFinishAction(
        event,
        ctx.finishStates?.[event.id],
        ctx.finishErrors?.[event.id],
        ctx.finishHandlers ?? {},
        ctx.archiveFinishNoteFor?.(event) ?? null,
      ),
    );
  }
  if (actions.length === 0) return null;
  const panelId = `manage-panel-${event.id}`;
  const toggleId = `manage-${event.id}`;
  const open =
    Boolean(ctx.openRows?.has(event.id)) ||
    Boolean(ctx.deleteStates?.[event.id]) ||
    Boolean(ctx.finishStates?.[event.id]) ||
    Boolean(ctx.finishErrors?.[event.id]);
  const toggle = el('button', {
    className: 'btn btn-outline tap-target events-manage-toggle',
    id: toggleId,
    text: 'Manage',
    attrs: {
      type: 'button',
      // The accessible name must contain the visible label (WCAG 2.5.3).
      'aria-label': `Manage "${event.name}"`,
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': panelId,
    },
  });
  toggle.addEventListener('click', () => ctx.onToggleManage?.(event.id));
  const panel = el('div', { className: 'events-row-panel', id: panelId }, actions);
  panel.hidden = !open;
  return { toggle, panel };
}

function renderRow(view, ctx) {
  const { event, info } = view;
  const children = [];
  const main = el('div', { className: 'events-row-main' });
  if (ctx.formatOptions) {
    main.appendChild(
      el('span', {
        className: 'events-format-tag',
        text: formatLabelFor(ctx.formatOptions, event.format),
      }),
    );
  }
  const title = el('div', { className: 'events-row-title' }, [
    el('a', { text: event.name, attrs: { href: `#/events/${event.id}` } }),
  ]);
  const meta = eventMeta(event, ctx.now);
  if (meta) title.appendChild(el('span', { className: 'stage-meta', text: meta }));
  main.appendChild(title);
  children.push(main);
  if (info.summary) {
    children.push(el('span', { className: 'events-row-summary', text: info.summary }));
  }
  const tags = rowTags(view).map((tag) =>
    statusMark(tag.state, tag.label, { light: tag.state !== 'test' }),
  );
  if (tags.length) children.push(el('span', { className: 'events-row-tags' }, tags));
  const manage = renderManage(event, view, ctx);
  if (manage) children.push(manage.toggle, manage.panel);
  const archivePanel = ctx.archivePanelFor?.(event) ?? null;
  if (archivePanel) children.push(archivePanel);
  return el('li', { className: 'events-row', attrs: { 'data-event-id': event.id } }, children);
}

// One group's rows. `viewsById` (event id to its view) is optional: a caller with no summaries gets plain rows.
export function renderEventsList(
  events,
  {
    viewsById = new Map(),
    deleteStates = {},
    deleteHandlers = {},
    finishStates = {},
    finishErrors = {},
    finishHandlers = {},
    openRows = new Set(),
    onToggleManage,
    // T-ARC.4: the archive sentence for the Finish confirmation, and the panel under a row (both null while dark).
    archiveFinishNoteFor = () => null,
    archivePanelFor = () => null,
    formatOptions,
    unsyncedWrites,
    now = new Date(),
  } = {},
) {
  if (events.length === 0) {
    return el('p', { className: 'stage-meta', text: 'No events yet. Create your first event.' });
  }
  const ctx = {
    deleteStates,
    deleteHandlers,
    finishStates,
    finishErrors,
    finishHandlers,
    openRows,
    onToggleManage,
    archiveFinishNoteFor,
    archivePanelFor,
    formatOptions,
    unsyncedWrites,
    now,
  };
  return el(
    'ul',
    { className: 'events-list' },
    events.map((event) => renderRow(viewsById.get(event.id) ?? bareView(event), ctx)),
  );
}

// The format filter: chips from 40rem up, a select below it (both drawn, one shown by CSS, kept in step by the one
// `formatFilter` state). Only drawn when more than one format is configured.
export function renderFormatFilter(formatOptions, current, onChange) {
  if (!(formatOptions?.length > 1)) return null;
  const options = [{ value: 'all', label: 'All' }, ...formatOptions];
  const chips = el(
    'div',
    { className: 'events-filter-group', attrs: { role: 'group', 'aria-label': 'Show formats' } },
    options.map((option) => {
      const on = option.value === current;
      const chip = el('button', {
        className: `btn btn-outline tap-target events-choice${on ? ' is-selected' : ''}`,
        id: `events-filter-chip-${option.value}`,
        text: option.label,
        attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false' },
      });
      chip.addEventListener('click', () =>
        onChange(option.value, `#events-filter-chip-${option.value}`),
      );
      return chip;
    }),
  );
  const select = el('select', {
    className: 'field-input',
    id: 'events-filter-select',
    attrs: { 'aria-label': 'Show formats' },
  });
  for (const option of options) {
    const optionEl = el('option', {
      text: option.value === 'all' ? 'All formats' : option.label,
      attrs: { value: option.value },
    });
    if (option.value === current) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  select.addEventListener('change', () => onChange(select.value, '#events-filter-select'));
  return el('div', { className: 'events-filter' }, [
    chips,
    el('div', { className: 'events-filter-select' }, [
      el('label', {
        className: 'stage-meta',
        text: 'Show',
        attrs: { for: 'events-filter-select' },
      }),
      select,
    ]),
  ]);
}

// "Live now" (with the progress and the next step) or "Coming up next". A test event says so here too (D9).
function renderFeaturedCard(view, { live, formatOptions, now, formatLabel, rowCtx }) {
  const { event, info } = view;
  const headingId = `events-featured-heading`;
  const kicker = el('div', { className: 'events-featured-kicker' }, [
    live
      ? statusMark('live', 'Live now')
      : el('span', { className: 'events-featured-eyebrow', text: 'Coming up next' }),
  ]);
  if (formatOptions) {
    kicker.appendChild(el('span', { className: 'events-format-tag', text: formatLabel }));
  }
  if (event.is_test) kicker.appendChild(statusMark('test', 'Test data'));
  const meta = eventMeta(event, now);
  if (meta) kicker.appendChild(el('span', { className: 'events-featured-meta', text: meta }));

  const body = el('div', { className: 'events-featured-body' }, [
    el('h2', {
      id: headingId,
      className: 'ok-card-heading events-featured-title',
      text: event.name,
    }),
  ]);
  const stateLine = [info.phase, info.next ?? (live ? null : info.summary)]
    .filter(Boolean)
    .join(' · ');
  if (stateLine) body.appendChild(el('p', { className: 'events-featured-state', text: stateLine }));
  if (info.progress) {
    body.appendChild(
      buildMeter({
        label: `Progress of "${event.name}"`,
        done: info.progress.done,
        total: info.progress.total,
        active: info.progress.active,
        valueText: info.progress.text ?? undefined,
      }),
    );
    if (info.progress.text) {
      body.appendChild(el('p', { className: 'events-featured-figures', text: info.progress.text }));
    }
  }
  const actions = el('div', { className: 'events-featured-actions' }, [
    el('a', {
      className: 'btn btn-primary tap-target',
      text: 'Open event',
      attrs: { href: `#/events/${event.id}`, 'aria-label': `Open event "${event.name}"` },
    }),
  ]);
  if (info.action) {
    actions.appendChild(
      el('a', {
        className: 'btn btn-outline tap-target',
        text: info.action.label,
        attrs: { href: info.action.href },
      }),
    );
  }
  // The featured event is left out of the list below, so its Finish / Delete live here, behind the same toggle.
  const manage = renderManage(event, view, rowCtx);
  if (manage) actions.appendChild(manage.toggle);
  return el(
    'section',
    {
      className: `ok-card events-featured${live ? ' events-featured--live' : ''}`,
      attrs: { 'aria-labelledby': headingId },
    },
    [
      kicker,
      el('div', { className: 'events-featured-row' }, [body, actions]),
      ...(manage ? [manage.panel] : []),
    ],
  );
}

export async function mountEventsScreen(
  root,
  {
    orgId,
    // What to call the organisation above the heading (the caller knows it; this screen only receives the id).
    orgName = null,
    // The audience links for this organisation ({ phone, projector, splash }: absolute, slug-qualified), or
    // null when there are none to show. Built by the caller, which knows the routes.
    audienceLinks = null,
    // The organisation's own links ([{ label, href, meta? }]: People, Team for owners, Published results), or a
    // function returning them (asked at every draw). The header has no room for them (it must stay one row), so
    // this screen is the organisation-level way in.
    orgLinks = [],
    // (callback) => unsubscribe, for links that arrive after the screen is up (whether the person owns the
    // organisation is asked of the database a moment after sign-in). The screen redraws when they really change.
    subscribeOrgLinks = null,
    // Where "+ New event" goes.
    newEventHref = '#/events/new',
    client = getSupabase(),
    // [{ value, label }] for every configured format: the format tag on a row, and the filter (drawn only when
    // more than one). Supplied by the composition root; this file never names one.
    formatOptions,
    // (event, facts, { isLive }) => the row/card words (see core/eventHome.js). Optional: without it the home
    // lists events with no state lines.
    describeEvent = null,
    signal,
    // How long Delete waits for the unsynced-writes count before falling
    // back to "Couldn't check" — overridable for tests.
    unsyncedCheckTimeoutMs = UNSYNCED_CHECK_TIMEOUT_MS,
    // Where an event's manual publish lives (a hash link), or null. The format owns that screen, so the caller says.
    archivePublishHrefFor = () => null,
    // The clock, for "today" and the dates (a test passes a fixed one).
    now = () => new Date(),
  } = {},
) {
  let events = [];
  let summariesById = new Map();
  let formatFilter = 'all';
  let finishedOpen = false;
  let openRows = new Set();
  let loading = false;
  let pendingError = null;
  let pendingSuccess = null;
  let loadFailedMessage = null;
  let focusAfterRender = null;
  // Per-event-id delete state ('checking' | 'confirming' | 'deleting') —
  // see renderEventsList's own comment for why this is keyed by id rather
  // than a single shared value.
  let deleteStates = {};
  let finishStates = {};
  let finishErrors = {};
  // How many queued changes on this device are for THIS organisation (any account's), as of the last
  // Delete click — see unsyncedWritesWarning. Deliberately one value, not per row: it counts the
  // organisation's whole queue, so the latest read is the right one for any row.
  let unsyncedWrites;
  // T-ARC.4: the public-archive panel. Inert (no markup, no request beyond the plan snapshot) until the database says the
  // key is enforced. Re-renders the screen and moves focus to the element the controller names.
  const archive = createArchiveController({
    orgId,
    client,
    signal,
    publishHrefFor: archivePublishHrefFor,
    onChange(focus) {
      if (focus) focusAfterRender = focus;
      render();
    },
  });
  // Built once: the card keeps its QR code and its "copied" line across the screen's own re-renders.
  const audienceCard = audienceLinks ? buildAudienceLinksCard(audienceLinks, { orgName }) : null;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  // The event list is the read that matters; the summaries are an extra that never fails the screen.
  async function loadPersisted() {
    const summariesRead = raceTimeout(
      Promise.resolve().then(() => listEventSummaries(orgId, client)),
      SUMMARIES_TIMEOUT_MS,
    ).catch((err) => {
      console.error('eventsScreen: event summaries unavailable', err);
      return null;
    });
    const list = await listEventsForOrg(orgId, client);
    summariesById = (await summariesRead) ?? new Map();
    return list;
  }

  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container events-screen' });
    container.appendChild(el('h1', { text: 'Events' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: 'Loading events…',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.focus();
  }

  function renderLoadError() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container events-screen' });
    container.appendChild(el('h1', { text: 'Events' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    const retryButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retryButton.addEventListener('click', () => {
      attemptLoad();
    });
    container.appendChild(retryButton);
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  // Races loadPersisted() against a timeout so a hung request never leaves
  // this, the organiser's real landing page, stuck on "Loading…" forever —
  // same pattern setupScreen.js/rosterScreen.js already established.
  async function attemptLoad() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      events = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      loadFailedMessage = null;
    } catch (err) {
      loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    loading = false;
    render();
    // After the list is on screen, never before: the archive panel must not delay the organiser's landing page.
    if (!loadFailedMessage && !signal?.aborted) {
      archive.load(events).then(() => {
        if (archive.mode() === 'off' || signal?.aborted) return;
        // The panel arrives after the list is on screen: keep a keyboard user's place across the redraw.
        const active = document.activeElement;
        if (!focusAfterRender && active?.id && root.contains(active)) {
          focusAfterRender = `[id="${active.id.replace(/["\\]/g, '\\$&')}"]`;
        }
        render();
      });
    }
  }

  function handleFilter(value, focusSelector) {
    formatFilter = value;
    focusAfterRender = focusSelector;
    render();
  }

  function handleToggleManage(eventId) {
    const next = new Set(openRows);
    if (next.has(eventId)) next.delete(eventId);
    else next.add(eventId);
    openRows = next;
    focusAfterRender = `#manage-${eventId}`;
    render();
  }

  function handleToggleFinished() {
    finishedOpen = !finishedOpen;
    focusAfterRender = '#events-finished-toggle';
    render();
  }

  // Two-step confirm (matches scoringScreen.js's own "strict confirm"
  // discipline for an irreversible action) — a bare click can never delete
  // anything by itself. `deleteStates` is mutated per id, never wholesale
  // reset, so a confirm/cancel/delete on one row never disturbs another
  // row's own independent state.
  async function handleDeleteClick(eventId) {
    // A second click while the count is still being read (a double-click)
    // does nothing: without this, a late read could reopen the confirm step
    // over a delete already in flight (code-reviewer, 2026-09-27).
    if (deleteStates[eventId]) return;
    openRows = new Set(openRows).add(eventId);
    deleteStates = { ...deleteStates, [eventId]: 'checking' };
    // Read before showing the confirm step so its warning is in place when
    // focus lands on "Confirm delete" (see unsyncedWritesWarning). Bounded:
    // a hung IndexedDB open must degrade to "Couldn't check", not leave
    // Delete doing nothing.
    const count = await raceTimeout(countOperationsInOrg(orgId), unsyncedCheckTimeoutMs).catch(
      (err) => {
        console.error('eventsScreen: unsynced-writes count failed', err);
        return null;
      },
    );
    if (deleteStates[eventId] !== 'checking') return;
    unsyncedWrites = count;
    deleteStates = { ...deleteStates, [eventId]: 'confirming' };
    focusAfterRender = `#confirm-delete-${eventId}`;
    render();
  }

  function handleCancelDelete(eventId) {
    deleteStates = { ...deleteStates, [eventId]: undefined };
    focusAfterRender = `#delete-event-${eventId}`;
    render();
  }

  async function handleConfirmDelete(eventId) {
    if (signal?.aborted) return;
    // Explicit re-entrancy guard — found in review (code-reviewer): without
    // this, only an accident of full-DOM-rebuild-per-render (the confirm
    // button node being gone by the time a second click could physically
    // land) protected against a double-click enqueueing two delete attempts;
    // matches scoringScreen.js's own confirmInFlight/rosterScreen.js's own
    // busy guard for this exact class of problem, rather than relying on an
    // implicit side effect that would silently stop protecting anything if
    // render() ever moved toward incremental DOM patching.
    if (deleteStates[eventId] === 'deleting') return;
    deleteStates = { ...deleteStates, [eventId]: 'deleting' };
    // Found in review (ui-accessibility-reviewer, BLOCKING): the render()
    // right below swaps the just-focused "Confirm delete" button out for a
    // plain, non-focusable "Deleting…" span — with no explicit
    // focusAfterRender set here, focus silently reverts to <body> for the
    // whole (untimed) duration of the RPC call, with no announcement a
    // delete is even in progress. Moving focus to the heading (already a
    // real, always-present, tabindex="-1" target) keeps it somewhere real
    // and announced instead.
    focusAfterRender = '#events-heading';
    render();
    try {
      await deleteTestEvent(orgId, eventId, client);
      events = events.filter((event) => event.id !== eventId);
      pendingSuccess = 'Event deleted.';
      focusAfterRender = '#events-heading';
    } catch (err) {
      pendingError = describeError(err);
      focusAfterRender = null;
    }
    // Matches handleCancelDelete's own one-line idiom — found in review
    // (code-reviewer): this used to be a three-line rest/delete/reassign
    // block, the only place in this file clearing a deleteStates key
    // differently from every other call site.
    deleteStates = { ...deleteStates, [eventId]: undefined };
    render();
  }

  function handleFinishClick(eventId) {
    if (finishStates[eventId]) return;
    openRows = new Set(openRows).add(eventId);
    finishErrors = { ...finishErrors, [eventId]: undefined };
    finishStates = { ...finishStates, [eventId]: 'confirming' };
    focusAfterRender = `#confirm-finish-${eventId}`;
    render();
  }

  function handleCancelFinish(eventId) {
    finishStates = { ...finishStates, [eventId]: undefined };
    focusAfterRender = `#finish-event-${eventId}`;
    render();
  }

  async function handleConfirmFinish(eventId) {
    if (signal?.aborted || finishStates[eventId] === 'finishing') return;
    finishStates = { ...finishStates, [eventId]: 'finishing' };
    focusAfterRender = '#events-heading';
    render();
    try {
      await finishEvent(orgId, eventId, client);
      events = events.map((event) =>
        event.id === eventId ? { ...event, ended_at: new Date().toISOString() } : event,
      );
      const finished = events.find((event) => event.id === eventId);
      const archiveNote = finished && !finished.is_test ? archive.finishedNote(finished) : null;
      pendingSuccess = archiveNote ? `Event finished. ${archiveNote}` : 'Event finished.';
      focusAfterRender = '#events-heading';
    } catch {
      finishErrors = {
        ...finishErrors,
        [eventId]: "Couldn't finish this event. Please try again.",
      };
      focusAfterRender = `#finish-event-${eventId}`;
    }
    finishStates = { ...finishStates, [eventId]: undefined };
    render();
  }

  // A flow in progress on a row inside the collapsed Finished group (Delete on a finished test event) must show.
  function flowOpenOn(eventId) {
    return Boolean(deleteStates[eventId] || finishStates[eventId] || finishErrors[eventId]);
  }

  function renderListCard(home, rowCtx) {
    const card = el('section', {
      className: 'ok-card events-list-card',
      attrs: { 'aria-labelledby': 'events-list-heading' },
    });
    card.appendChild(
      el(
        'div',
        { className: 'events-list-head' },
        [
          el('h2', {
            id: 'events-list-heading',
            className: 'ok-card-heading',
            text: 'Your events',
          }),
          renderFormatFilter(formatOptions, formatFilter, handleFilter),
        ].filter(Boolean),
      ),
    );

    const filterLabel = formatFilter === 'all' ? null : formatLabelFor(formatOptions, formatFilter);
    const upcomingEvents = home.upcoming.map((view) => view.event);
    card.appendChild(
      el('h3', {
        className: 'events-group-heading',
        text: `Coming up and in setup · ${upcomingEvents.length}`,
      }),
    );
    card.appendChild(
      upcomingEvents.length === 0
        ? el('p', {
            className: 'stage-meta events-group-none',
            text: filterLabel ? `No ${filterLabel} events coming up.` : 'Nothing else coming up.',
          })
        : renderEventsList(upcomingEvents, rowCtx),
    );

    const finishedEvents = home.finished.map((view) => view.event);
    if (finishedEvents.length > 0) {
      const mustShow = finishedEvents.some((event) => flowOpenOn(event.id));
      const open = finishedOpen || mustShow;
      const listId = 'events-finished-list';
      const latest = finishedEvents[0];
      const toggle = el(
        'button',
        {
          className: 'events-finished-toggle',
          id: 'events-finished-toggle',
          attrs: {
            type: 'button',
            'aria-expanded': open ? 'true' : 'false',
            'aria-controls': listId,
          },
        },
        [
          el('span', {
            className: 'events-finished-label',
            text: `Finished · ${finishedEvents.length}`,
          }),
          el('span', {
            className: 'events-finished-hint',
            text: open ? 'Hide' : `Latest: ${latest.name}`,
          }),
        ],
      );
      toggle.addEventListener('click', handleToggleFinished);
      const finishedList = el('div', { id: listId, className: 'events-finished-list' }, [
        renderEventsList(finishedEvents, rowCtx),
      ]);
      finishedList.hidden = !open;
      card.appendChild(toggle);
      card.appendChild(finishedList);
    }
    return card;
  }

  const currentOrgLinks = () =>
    (typeof orgLinks === 'function' ? orgLinks() : orgLinks).filter(
      (link) => typeof link?.href === 'string' && link.label,
    );
  const orgLinksKey = (links) =>
    JSON.stringify(links.map((link) => [link.label, link.href, link.meta]));
  let drawnOrgLinks = orgLinksKey(currentOrgLinks());

  function renderOrgLinks() {
    const links = currentOrgLinks();
    drawnOrgLinks = orgLinksKey(links);
    if (links.length === 0) return null;
    return el(
      'section',
      { className: 'ok-card events-org', attrs: { 'aria-labelledby': 'events-org-heading' } },
      [
        el('h2', {
          id: 'events-org-heading',
          className: 'ok-card-heading',
          text: 'Your organisation',
        }),
        el(
          'ul',
          { className: 'events-org-links', attrs: { role: 'list' } },
          links.map((link) =>
            el('li', {}, [
              el('a', { className: 'events-org-link', attrs: { href: link.href } }, [
                el('span', { text: link.label }),
                ...(link.meta
                  ? [el('span', { className: 'events-org-meta', text: link.meta })]
                  : []),
              ]),
            ]),
          ),
        ),
      ],
    );
  }

  function renderAttention(home) {
    const shown = home.attention.slice(0, MAX_ATTENTION);
    const card = buildEventWarnings(shown, {
      heading: 'Needs attention',
      emptyText: 'Nothing needs attention.',
    });
    const rest = home.attention.length - shown.length;
    if (rest > 0) {
      card.appendChild(
        el('p', { className: 'stage-meta', text: `and ${rest} more across your events.` }),
      );
    }
    return card;
  }

  function render() {
    // A discarded-but-still-in-flight mount (this screen's OWN attemptLoad
    // or a post-await handler like handleConfirmDelete, still resolving after the
    // router already navigated elsewhere) must never write to `root` again
    // — router.js aborts `signal` the instant a newer navigation starts,
    // well before this screen's own promise chain gets a chance to
    // finish. Single guard at render()'s own entry point covers every
    // call site (initial load, Retry, create) in one place. See
    // ROADMAP.md's "A real DOM-write race between the router..." entry.
    if (signal?.aborted) return;
    if (loadFailedMessage) {
      renderLoadError();
      return;
    }

    const clock = now();
    const home = buildHome({
      events,
      summariesById,
      describeEvent,
      formatFilter,
      today: [
        clock.getFullYear(),
        String(clock.getMonth() + 1).padStart(2, '0'),
        String(clock.getDate()).padStart(2, '0'),
      ].join('-'),
    });

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container events-screen' });

    const newEventLink = (variant) =>
      el('a', {
        className: `btn btn-primary btn-lg tap-target events-new events-new--${variant}`,
        text: '+ New event',
        attrs: {
          href: newEventHref,
          'aria-label': orgName?.trim() ? `New event in ${orgName.trim()}` : 'New event',
        },
      });

    const heading = el('div', { className: 'events-heading-block' }, [
      ...(orgName?.trim()
        ? [el('p', { className: 'events-org-eyebrow', text: orgName.trim() })]
        : []),
      el('h1', { id: 'events-heading', text: 'Events', attrs: { tabindex: '-1' } }),
      el('p', { className: 'events-counts', text: countsLine(home.counts) }),
    ]);
    container.appendChild(
      el('div', { className: 'events-header' }, [heading, newEventLink('header')]),
    );

    const feedback = el('div', {
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      setFeedback(feedback, pendingError, 'error');
      pendingError = null;
    } else if (pendingSuccess) {
      setFeedback(feedback, pendingSuccess, 'success');
      pendingSuccess = null;
    }
    // Appended right after the heading, not at the bottom (found in production UI/UX feedback: a message at the
    // very bottom of the page was easy to miss). `.screen-feedback:empty` takes no room when there is nothing to show.
    container.appendChild(feedback);

    const rowCtx = {
      viewsById: home.views,
      deleteStates,
      deleteHandlers: {
        onDeleteClick: handleDeleteClick,
        onConfirmDelete: handleConfirmDelete,
        onCancelDelete: handleCancelDelete,
      },
      finishStates,
      finishErrors,
      finishHandlers: {
        onFinishClick: handleFinishClick,
        onConfirmFinish: handleConfirmFinish,
        onCancelFinish: handleCancelFinish,
      },
      openRows,
      onToggleManage: handleToggleManage,
      archiveFinishNoteFor: (event) => archive.finishNote(event),
      archivePanelFor: (event) => archive.renderFor(event),
      formatOptions,
      unsyncedWrites,
      now: clock,
    };

    const main = el('div', { className: 'ok-dashboard-main events-home-main' });
    const rail = el('div', { className: 'ok-dashboard-rail events-home-rail' });

    const featuredView = home.liveView ?? home.nextView;
    if (featuredView) {
      const featured = renderFeaturedCard(featuredView, {
        live: Boolean(home.liveView),
        formatOptions,
        now: clock,
        formatLabel: formatLabelFor(formatOptions, featuredView.event.format),
        rowCtx,
      });
      featured.classList.add('events-slot-featured');
      main.appendChild(featured);
    }
    if (events.length === 0) {
      main.appendChild(
        el(
          'section',
          {
            className: 'ok-card events-none',
            attrs: { 'aria-labelledby': 'events-none-heading' },
          },
          [
            el('h2', {
              id: 'events-none-heading',
              className: 'ok-card-heading',
              text: 'No events yet',
            }),
            el('p', {
              className: 'stage-meta',
              text: orgName?.trim()
                ? `Create the first event for ${orgName.trim()}.`
                : 'Create your first event.',
            }),
          ],
        ),
      );
    } else {
      const listCard = renderListCard(home, rowCtx);
      listCard.classList.add('events-slot-list');
      main.appendChild(listCard);
    }
    main.appendChild(newEventLink('foot'));

    const attentionCard = renderAttention(home);
    attentionCard.classList.add('events-slot-attention');
    rail.appendChild(attentionCard);
    if (audienceCard) {
      audienceCard.classList.add('events-slot-audience');
      rail.appendChild(audienceCard);
    }
    const orgCard = renderOrgLinks();
    if (orgCard) {
      orgCard.classList.add('events-slot-org');
      rail.appendChild(orgCard);
    }

    container.appendChild(el('div', { className: 'ok-dashboard events-home' }, [main, rail]));
    root.appendChild(container);

    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone === 'error') {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  // Redraw only when the links really changed and the screen is showing its list (not loading, not failed), so a
  // late answer never steals the place of someone already working on the page.
  const unsubscribeOrgLinks = subscribeOrgLinks?.(() => {
    if (signal?.aborted || loading || loadFailedMessage) return;
    if (orgLinksKey(currentOrgLinks()) === drawnOrgLinks) return;
    render();
  });

  await attemptLoad();

  return {
    unmount() {
      unsubscribeOrgLinks?.();
    },
  };
}
