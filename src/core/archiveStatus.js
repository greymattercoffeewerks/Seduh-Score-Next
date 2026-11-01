// What the organiser is told about the public archive (T-ARC.4), format-agnostic and pure. UX only: the database
// decides everything (the archive tick, set_archive_listing, the soft unpublish record); this module turns what a member
// CAN read into words and decides nothing the database would not also do.
//
// What the panel reads (T-ARC.4c): `events.ended_at`, the event's own `public_results` row (the payload tells a podium
// from a named-only entry) and, for everything the pipeline decided, `public.archive_event_status` (the member-readable
// door onto the owner-only ledger): state, due time, saved tick box, taken-down, retrying and a safe reason code. Nothing is
// remembered per device any more. Still derived here: the "scheduled" line before the pipeline has a row, and "not in the
// schedule" for an event past its due time that the pipeline never took.
//
// DARK. `archiveModeOf` answers 'off' unless the snapshot says the key is ENFORCED. While the key is unenforced the
// database answers `allowed: true` for everyone (a Community organisation included), so `allowed` alone cannot tell dark from
// live: this module therefore needs `enforced === true` on the entry, and treats a snapshot without it as off. Nothing in
// the app is shown, and nothing is asked of the database, until that holds.
export const ARCHIVE_KEY = 'results_archive_optional';
export const ARCHIVE_DELAY_HOURS = 24;

// 'off' | 'compulsory' (Community: the podium is published automatically) | 'choice' (Per-event and Annual: the tick box).
export function archiveModeOf(snapshot) {
  const entry = snapshot?.keys?.[ARCHIVE_KEY];
  if (!entry || entry.enforced !== true) return 'off';
  return entry.allowed === false ? 'compulsory' : 'choice';
}

export function archiveDueAt(event) {
  if (!event?.ended_at) return null;
  const ended = new Date(event.ended_at);
  if (Number.isNaN(ended.getTime())) return null;
  return new Date(ended.getTime() + ARCHIVE_DELAY_HOURS * 3600 * 1000);
}

// The result row the database holds for an event (or null). A named-only entry carries `listing: 'named_only'`
// (app.archive_stub_payload); anything else is a podium.
export function isNamedOnly(payload) {
  return payload?.listing === 'named_only';
}

// The ledger states and the stub/failure reasons the database may send (public.archive_event_status). Anything else is
// read as "no row" / "no reason", so a future value cannot put raw text on the screen.
const LEDGER_STATES = ['none', 'pending', 'published', 'stubbed', 'skipped', 'failed', 'removed'];
const STUB_REASONS = ['no_snapshot', 'invalid_snapshot', 'stale_snapshot'];
const OVERDUE_GRACE_MS = 3600 * 1000;
const REASONS = [...STUB_REASONS, 'processing_error'];

// One answer row of archive_event_status, trusted only for its whitelisted shape. null when it is not a row.
export function normalizeArchiveStatus(row) {
  if (!row || typeof row !== 'object') return null;
  const due = row.due_at ? new Date(row.due_at) : null;
  return {
    state: LEDGER_STATES.includes(row.state) ? row.state : 'none',
    dueAt: due && !Number.isNaN(due.getTime()) ? due : null,
    published: row.published === true,
    listingChoice:
      row.listing_choice === 'list' || row.listing_choice === 'named_only'
        ? row.listing_choice
        : null,
    removed: row.removed === true,
    retrying: row.retrying === true,
    reason: REASONS.includes(row.reason) ? row.reason : null,
  };
}

// kind:
//   off                    nothing to show (dark, or no event to speak of)
//   test                   a test event is never archived
//   open                   not finished yet
//   scheduled              finished, due not reached, the podium will be published
//   scheduled_named_only   finished, due not reached, only the name will be listed
//   overdue                due time passed and nothing is published, no failure recorded (the schedule is late)
//   unscheduled            due time passed and the pipeline will not publish it (no row, or already settled with no result)
//   retrying               the last automatic attempt failed; it will be tried again
//   failed                 the automatic attempts gave up
//   published              a podium is public
//   listed_named_only      only the name is public (`reason`: why, when the pipeline had to fall back to a stub)
//   taken_down             the result was taken down and stays down
// `status` is the normalized archive_event_status row (the saved tick box is its listingChoice; Community is always the
// podium). Without one the panel cannot say what the pipeline decided: off.
export function archiveStateOf({ mode, event, result = null, status = null, now = Date.now() }) {
  if (mode !== 'compulsory' && mode !== 'choice') return { kind: 'off', dueAt: null };
  if (event?.is_test) return { kind: 'test', dueAt: null };
  if (!status) return { kind: 'off', dueAt: null };
  const dueAt = status.dueAt ?? archiveDueAt(event);
  if (result) {
    return isNamedOnly(result.payload)
      ? { kind: 'listed_named_only', dueAt, reason: status.reason }
      : { kind: 'published', dueAt, reason: null };
  }
  if (status.removed) return { kind: 'taken_down', dueAt };
  if (!event?.ended_at || !dueAt) return { kind: 'open', dueAt: null };
  if (status.state === 'failed') return { kind: 'failed', dueAt };
  if (status.retrying) return { kind: 'retrying', dueAt };
  if (now >= dueAt.getTime()) {
    // Late only while the pipeline still holds the event (pending) or has not had a tick since it fell due. A row the
    // pipeline never made (an event from before its floor) or one it already settled with no result is not "running
    // late": nothing will publish it, so say so and offer the manual publish.
    const holding = status.state === 'pending';
    const justDue = status.state === 'none' && now - dueAt.getTime() < OVERDUE_GRACE_MS;
    return { kind: holding || justDue ? 'overdue' : 'unscheduled', dueAt };
  }
  const podium = mode === 'compulsory' || status.listingChoice === 'list';
  return { kind: podium ? 'scheduled' : 'scheduled_named_only', dueAt };
}

const BRUNEI_TZ = 'Asia/Brunei';

// "2 Nov 2026, 18:30 (Brunei time)": the zone the 5-day window is counted in, so the organiser reads one clock.
export function describeArchiveTime(date) {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: BRUNEI_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${text.replace(' at ', ', ')} (Brunei time)`;
}

// Sentences shown with the Finish confirmation, so the organiser learns the consequence at the moment it starts (spec 2.6).
export function finishArchiveNote(mode) {
  if (mode === 'compulsory') {
    return (
      'About 24 hours after you finish, the podium is published to the public archive automatically, ' +
      'provided you have opened the report or standings after finishing (that is when it is prepared); otherwise only ' +
      'the event name is listed. You can check your results first, or publish sooner yourself.'
    );
  }
  if (mode === 'choice') {
    return (
      'About 24 hours after you finish, the public archive lists this event by name, date and place. ' +
      'The podium is included only if you tick "List the podium" on the event.'
    );
  }
  return null;
}

// The line under the success message after an event is finished.
export function finishedArchiveNote(mode, event) {
  const dueAt = archiveDueAt(event);
  if (!dueAt || (mode !== 'compulsory' && mode !== 'choice')) return null;
  const when = describeArchiveTime(dueAt);
  return mode === 'compulsory'
    ? `The podium goes to the public archive at about ${when} if you open the report or standings first; otherwise only the name is listed.`
    : `The archive lists this event at about ${when}.`;
}

export const LISTING_LABEL = 'List the podium in the public archive';

// What ticking and not ticking do (owner decision 10: unticked by default, and say what is lost).
export function listingHelpText(listed) {
  if (listed) {
    return 'The podium (first place and the others on it, with names and cafes) is published about 24 hours after you finish, provided you have opened the report or standings after finishing.';
  }
  return (
    'Unticked: the archive still lists the event by name, date and place, but with no results. ' +
    "On a Per-event plan the event's screens close when the plan window ends, so the archive is the only place its podium " +
    'would stay public. You can still publish the results yourself at any time.'
  );
}

export const UNPUBLISH_CONFIRM_TEXT =
  'Take this result off the public archive? Community results are listed as a condition of the plan. ' +
  'Taking it down is recorded and counted (counts only, no names) and it will not be published again automatically. ' +
  'You can publish it yourself later.';

const STUB_REASON_TEXT = {
  no_snapshot:
    ' The podium was not prepared because the report or standings were not opened after the event finished.',
  invalid_snapshot: ' The prepared podium could not be used.',
  stale_snapshot: ' Scores changed after the podium was prepared, so it was not published.',
};

export function statusText(state) {
  switch (state.kind) {
    case 'scheduled':
      return (
        `The podium will be published to the public archive at about ${describeArchiveTime(state.dueAt)}, provided you have opened ` +
        'the report or standings since the event finished; otherwise only the name is listed. Check your results first, or publish now.'
      );
    case 'scheduled_named_only':
      return `At about ${describeArchiveTime(state.dueAt)} the archive will list this event by name, date and place only, with no results.`;
    case 'overdue':
      return (
        `Nothing is published yet. It was due at about ${describeArchiveTime(state.dueAt)}, so the automatic publish is running late. ` +
        'You can publish it now.'
      );
    case 'unscheduled':
      return 'This event is not in the automatic public archive schedule, so nothing is published. You can publish the results yourself.';
    case 'retrying':
      return 'The automatic publish hit a problem and will be tried again shortly. You can also publish it now.';
    case 'failed':
      return 'The automatic publish did not work. Nothing is published. You can publish it now.';
    case 'published':
      return 'The podium is published on the public archive.';
    case 'listed_named_only':
      return (
        'The public archive lists this event by name only, with no results.' +
        `${STUB_REASON_TEXT[state.reason] ?? ''} You can publish the results yourself.`
      );
    case 'taken_down':
      return 'Taken down. It will not be published again automatically. You can publish it yourself.';
    case 'open':
      return 'Not finished yet.';
    case 'test':
      return 'Test data is never published to the archive.';
    default:
      return null;
  }
}

const LISTING_ERRORS = {
  archive_listing_closed:
    "This event's archive entry has already been decided, so the tick box can no longer change it. You can publish the results yourself.",
  archive_event_is_test: 'Test data is never published to the archive.',
  entitlement_required: 'Your plan does not include this choice.',
};

export function describeListingError(error) {
  return LISTING_ERRORS[error?.hint] ?? "Couldn't save that choice. Please try again.";
}
