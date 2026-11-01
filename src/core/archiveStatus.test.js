import { describe, it, expect } from 'vitest';
import {
  archiveModeOf,
  archiveStateOf,
  archiveDueAt,
  describeArchiveTime,
  finishArchiveNote,
  finishedArchiveNote,
  listingHelpText,
  statusText,
  describeListingError,
} from './archiveStatus.js';

const snap = (entry) => ({ tier: 'community', keys: { results_archive_optional: entry } });
const ENDED = '2026-11-02T10:00:00Z';
const event = (over = {}) => ({ id: 'e1', name: 'Cup', is_test: false, ended_at: ENDED, ...over });
const T = (iso) => new Date(iso).getTime();

describe('archiveModeOf (dark by default)', () => {
  it('is off with no snapshot, no entry, or a key that is not enforced', () => {
    expect(archiveModeOf(null)).toBe('off');
    expect(archiveModeOf({ keys: {} })).toBe('off');
    // what the database answers TODAY: allowed for everyone, and no `enforced` field at all
    expect(archiveModeOf(snap({ allowed: true }))).toBe('off');
    expect(archiveModeOf(snap({ allowed: false }))).toBe('off');
    expect(archiveModeOf(snap({ allowed: true, enforced: false }))).toBe('off');
    expect(archiveModeOf(snap({ allowed: false, enforced: 'true' }))).toBe('off');
  });
  it('is compulsory when enforced and the plan lacks the key, choice when it has it', () => {
    expect(archiveModeOf(snap({ allowed: false, enforced: true }))).toBe('compulsory');
    expect(archiveModeOf(snap({ allowed: true, enforced: true }))).toBe('choice');
  });
});

describe('archiveStateOf', () => {
  const base = { mode: 'compulsory', event: event() };
  it('shows nothing while off, whatever the event', () => {
    expect(archiveStateOf({ ...base, mode: 'off' }).kind).toBe('off');
  });
  it('never archives a test event, even one with a result row', () => {
    expect(
      archiveStateOf({ ...base, event: event({ is_test: true }), result: { payload: {} } }).kind,
    ).toBe('test');
  });
  it('is open before the event ends', () => {
    expect(archiveStateOf({ ...base, event: event({ ended_at: null }) }).kind).toBe('open');
  });
  it('is scheduled 24 hours after ended_at, and overdue from that moment', () => {
    const due = T('2026-11-03T10:00:00Z');
    expect(archiveDueAt(event()).getTime()).toBe(due);
    expect(archiveStateOf({ ...base, now: due - 1 }).kind).toBe('scheduled');
    expect(archiveStateOf({ ...base, now: due }).kind).toBe('overdue');
  });
  it('Community is always the podium; a paid plan is named-only until the box is ticked', () => {
    const now = T('2026-11-02T12:00:00Z');
    expect(archiveStateOf({ ...base, now }).kind).toBe('scheduled');
    expect(archiveStateOf({ mode: 'choice', event: event(), now }).kind).toBe(
      'scheduled_named_only',
    );
    expect(archiveStateOf({ mode: 'choice', event: event(), listed: true, now }).kind).toBe(
      'scheduled',
    );
  });
  it('a result row wins over the clock; a stub is told apart from a podium', () => {
    const now = T('2026-12-01T00:00:00Z');
    const podium = { payload: { podium: [{ name: 'A' }] } };
    expect(archiveStateOf({ ...base, now, result: podium }).kind).toBe('published');
    expect(
      archiveStateOf({ ...base, now, result: { payload: { listing: 'named_only' } } }).kind,
    ).toBe('listed_named_only');
  });
  it('a result taken down in this session reads as taken down, not overdue', () => {
    expect(archiveStateOf({ ...base, now: T('2026-12-01T00:00:00Z'), takenDown: true }).kind).toBe(
      'taken_down',
    );
  });
});

describe('copy', () => {
  it('writes the due time in Brunei time (UTC+8)', () => {
    expect(describeArchiveTime(new Date('2026-11-03T10:00:00Z'))).toBe(
      '3 Nov 2026, 18:00 (Brunei time)',
    );
  });
  it('the Finish note differs by mode and is absent when dark', () => {
    expect(finishArchiveNote('off')).toBeNull();
    expect(finishArchiveNote('compulsory')).toContain('podium is published');
    expect(finishArchiveNote('choice')).toContain('List the podium');
    expect(finishedArchiveNote('off', event())).toBeNull();
    expect(finishedArchiveNote('compulsory', event())).toContain('3 Nov 2026');
  });
  it('unticked copy says what is lost (decision 10); ticked copy says what happens', () => {
    const unticked = listingHelpText(false);
    expect(unticked).toContain('by name, date and place');
    expect(unticked).toContain('no results');
    expect(unticked).toContain('only place');
    expect(listingHelpText(true)).toContain('podium');
  });
  it('every state with words has them, and overdue does not claim a retry it cannot see', () => {
    const due = new Date(ENDED);
    for (const kind of [
      'scheduled',
      'scheduled_named_only',
      'overdue',
      'published',
      'listed_named_only',
      'taken_down',
      'open',
      'test',
    ]) {
      expect(statusText({ kind, dueAt: due })).toBeTruthy();
    }
    expect(statusText({ kind: 'overdue', dueAt: due })).toContain('may still be on its way');
    expect(statusText({ kind: 'off' })).toBeNull();
  });
  it('maps the stable hints, and falls back to a generic line', () => {
    expect(describeListingError({ hint: 'archive_listing_closed' })).toContain(
      'already been decided',
    );
    expect(describeListingError({ hint: 'archive_event_is_test' })).toContain('Test data');
    expect(describeListingError({ hint: 'entitlement_required' })).toContain('plan');
    expect(describeListingError(new Error('boom'))).toContain("Couldn't save");
  });
});
