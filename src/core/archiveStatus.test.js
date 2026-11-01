import { describe, it, expect } from 'vitest';
import {
  archiveModeOf,
  archiveStateOf,
  normalizeArchiveStatus,
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

describe('normalizeArchiveStatus (the whitelist on the client too)', () => {
  it('reads a database row into the fields the panel uses', () => {
    expect(
      normalizeArchiveStatus({
        event_id: 'e1',
        state: 'stubbed',
        due_at: '2026-11-03T10:00:00Z',
        published: true,
        listing_choice: 'list',
        removed: false,
        retrying: false,
        reason: 'stale_snapshot',
      }),
    ).toEqual({
      state: 'stubbed',
      dueAt: new Date('2026-11-03T10:00:00Z'),
      published: true,
      listingChoice: 'list',
      removed: false,
      retrying: false,
      reason: 'stale_snapshot',
    });
  });
  it('drops anything outside the contract rather than showing it', () => {
    const row = normalizeArchiveStatus({
      state: 'weird',
      due_at: 'not a date',
      listing_choice: 'maybe',
      reason: '40P01',
      removed: 'yes',
      retrying: 1,
    });
    expect(row).toEqual({
      state: 'none',
      dueAt: null,
      published: false,
      listingChoice: null,
      removed: false,
      retrying: false,
      reason: null,
    });
    expect(normalizeArchiveStatus(null)).toBeNull();
  });
});

describe('archiveStateOf', () => {
  const none = normalizeArchiveStatus({ state: 'none' });
  const withStatus = (over) => normalizeArchiveStatus({ state: 'none', ...over });
  const base = { mode: 'compulsory', event: event(), status: none };
  it('shows nothing while off, whatever the event', () => {
    expect(archiveStateOf({ ...base, mode: 'off' }).kind).toBe('off');
  });
  it('shows nothing without a ledger answer: it will not guess what the pipeline decided', () => {
    expect(archiveStateOf({ ...base, status: null }).kind).toBe('off');
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
  it("prefers the database's due time", () => {
    const status = withStatus({ due_at: '2026-11-10T00:00:00Z' });
    expect(archiveStateOf({ ...base, status, now: T('2026-11-05T00:00:00Z') }).kind).toBe(
      'scheduled',
    );
  });
  it('Community is always the podium; a paid plan is named-only until the saved choice is list', () => {
    const now = T('2026-11-02T12:00:00Z');
    expect(archiveStateOf({ ...base, now }).kind).toBe('scheduled');
    expect(archiveStateOf({ ...base, mode: 'choice', now }).kind).toBe('scheduled_named_only');
    expect(
      archiveStateOf({
        ...base,
        mode: 'choice',
        status: withStatus({ listing_choice: 'named_only' }),
        now,
      }).kind,
    ).toBe('scheduled_named_only');
    expect(
      archiveStateOf({
        ...base,
        mode: 'choice',
        status: withStatus({ listing_choice: 'list' }),
        now,
      }).kind,
    ).toBe('scheduled');
  });
  it('a result row wins over the clock; a stub is told apart from a podium and carries its reason', () => {
    const now = T('2026-12-01T00:00:00Z');
    const podium = { payload: { podium: [{ name: 'A' }] } };
    expect(archiveStateOf({ ...base, now, result: podium }).kind).toBe('published');
    const stub = archiveStateOf({
      ...base,
      now,
      status: withStatus({ state: 'stubbed', reason: 'no_snapshot' }),
      result: { payload: { listing: 'named_only' } },
    });
    expect(stub).toMatchObject({ kind: 'listed_named_only', reason: 'no_snapshot' });
  });
  it('removed reads as taken down, not overdue, whatever the clock says', () => {
    const status = withStatus({ state: 'removed', removed: true });
    expect(archiveStateOf({ ...base, status, now: T('2026-12-01T00:00:00Z') }).kind).toBe(
      'taken_down',
    );
  });
  it('failed and retrying are told apart from a late schedule', () => {
    const now = T('2026-12-01T00:00:00Z');
    expect(archiveStateOf({ ...base, status: withStatus({ state: 'failed' }), now }).kind).toBe(
      'failed',
    );
    expect(
      archiveStateOf({ ...base, status: withStatus({ state: 'pending', retrying: true }), now })
        .kind,
    ).toBe('retrying');
    expect(archiveStateOf({ ...base, status: withStatus({ state: 'pending' }), now }).kind).toBe(
      'overdue',
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
  it('every state with words has them, and overdue does not claim a retry', () => {
    const due = new Date(ENDED);
    for (const kind of [
      'scheduled',
      'scheduled_named_only',
      'overdue',
      'retrying',
      'failed',
      'published',
      'listed_named_only',
      'taken_down',
      'open',
      'test',
    ]) {
      expect(statusText({ kind, dueAt: due })).toBeTruthy();
    }
    expect(statusText({ kind: 'overdue', dueAt: due })).toContain('You can publish it now');
    expect(statusText({ kind: 'overdue', dueAt: due })).not.toMatch(/retry|tried again/);
    expect(statusText({ kind: 'retrying', dueAt: due })).toContain('tried again');
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
