// What the organiser is told about the public archive (T-ARC.4), format-agnostic and pure. UX only: the database
// decides everything (the archive tick, set_archive_listing, the soft unpublish record); this module turns what a member
// CAN read into words and decides nothing the database would not also do.
//
// What a member can read, and what not (the honest limit of this build):
//   - `events.ended_at` and the event's own `public_results` row (members read their organisation's rows);
//   - the entitlement snapshot's `results_archive_optional` entry.
// The ledger (app.archive_events) is owner-only, so "failed", "retrying", "removed" and the saved tick box are NOT readable:
// an event past its due time with no result is simply "overdue", and the tick box shows the last choice saved on this
// device. A member-readable status door would remove both limits; it is logged as a T-ARC.4 finding, not built here.
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

// kind:
//   off                    nothing to show (dark, or no event to speak of)
//   test                   a test event is never archived
//   open                   not finished yet
//   scheduled              finished, due not reached, the podium will be published
//   scheduled_named_only   finished, due not reached, only the name will be listed
//   overdue                due time passed and nothing is published (retrying, taken down earlier, or the schedule is late)
//   published              a podium is public
//   listed_named_only      only the name is public
//   taken_down             the organiser took it down in this session
// `listed` is the tick box (Per-event / Annual only; Community is always the podium).
export function archiveStateOf({
  mode,
  event,
  result = null,
  listed = false,
  takenDown = false,
  now = Date.now(),
}) {
  if (mode !== 'compulsory' && mode !== 'choice') return { kind: 'off', dueAt: null };
  if (event?.is_test) return { kind: 'test', dueAt: null };
  const dueAt = archiveDueAt(event);
  if (result) {
    return { kind: isNamedOnly(result.payload) ? 'listed_named_only' : 'published', dueAt };
  }
  if (takenDown) return { kind: 'taken_down', dueAt };
  if (!event?.ended_at || !dueAt) return { kind: 'open', dueAt: null };
  if (now >= dueAt.getTime()) return { kind: 'overdue', dueAt };
  const podium = mode === 'compulsory' || listed;
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
      'About 24 hours after you finish, the podium is published to the public archive automatically. ' +
      'You can check your results first, or publish sooner yourself.'
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
    ? `The podium goes to the public archive at about ${when}.`
    : `The archive lists this event at about ${when}.`;
}

export const LISTING_LABEL = 'List the podium in the public archive';

// What ticking and not ticking do (owner decision 10: unticked by default, and say what is lost).
export function listingHelpText(listed) {
  if (listed) {
    return 'The podium (first place and the others on it, with names and cafes) is published about 24 hours after you finish.';
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

export function statusText(state) {
  switch (state.kind) {
    case 'scheduled':
      return `The podium will be published to the public archive at about ${describeArchiveTime(state.dueAt)}. Check your results first, or publish now.`;
    case 'scheduled_named_only':
      return `At about ${describeArchiveTime(state.dueAt)} the archive will list this event by name, date and place only, with no results.`;
    case 'overdue':
      return (
        `Nothing is published yet. It was due at about ${describeArchiveTime(state.dueAt)}. ` +
        'If you took it down yourself it stays down. Otherwise it may still be on its way: you can publish it now.'
      );
    case 'published':
      return 'The podium is published on the public archive.';
    case 'listed_named_only':
      return 'The public archive lists this event by name only, with no results. You can publish the results yourself.';
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
