import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/events.js', () => ({ findEvent: vi.fn() }));
vi.mock('../../core/registry.js', () => ({ listEntriesByIds: vi.fn() }));
vi.mock('./setup.js', () => ({ listStagesForEvent: vi.fn() }));
vi.mock('./analytics.js', () => ({
  isEventComplete: vi.fn(),
  computeStageReport: vi.fn(),
  computeEventSummary: vi.fn(),
}));
vi.mock('./resultsPublishing.js', () => ({
  buildResultsPayload: vi.fn(),
  podiumRowsOf: vi.fn(),
}));

import { findEvent } from '../../core/events.js';
import { listEntriesByIds } from '../../core/registry.js';
import { listStagesForEvent } from './setup.js';
import { isEventComplete, computeStageReport, computeEventSummary } from './analytics.js';
import { buildResultsPayload, podiumRowsOf } from './resultsPublishing.js';
import { buildArchiveSnapshot, stageArchiveSnapshot } from './archiveSnapshot.js';

const event = { id: 'ev1', org_id: 'org1', name: 'E', is_test: false };

beforeEach(() => {
  vi.resetAllMocks();
  findEvent.mockResolvedValue(event);
  isEventComplete.mockResolvedValue(true);
  listStagesForEvent.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
  computeStageReport.mockImplementation(async (id) => ({ id }));
  computeEventSummary.mockReturnValue([{ entryId: 'a' }, { entryId: 'b' }]);
  podiumRowsOf.mockImplementation((summary) => summary);
  listEntriesByIds.mockResolvedValue([{ id: 'a', cafe: 'Cafe A' }]);
  buildResultsPayload.mockReturnValue({ podium: [{ name: 'A' }] });
});

describe('buildArchiveSnapshot', () => {
  it('builds the SAME payload the manual publish builds, podium scope, with only the podium cafes looked up', async () => {
    const payload = await buildArchiveSnapshot({ eventId: 'ev1' }, {});
    expect(payload).toEqual({ podium: [{ name: 'A' }] });
    expect(listEntriesByIds).toHaveBeenCalledWith(['a', 'b'], {});
    const args = buildResultsPayload.mock.calls[0][0];
    expect(args.scope).toBe('podium');
    expect(args.cafeByEntryId.get('a')).toBe('Cafe A');
    expect(args.cafeByEntryId.has('b')).toBe(false);
    expect(args.stageReports).toEqual([{ id: 's1' }, { id: 's2' }]);
  });

  it('stages nothing when the podium is wider than the eight rows the archive accepts', async () => {
    buildResultsPayload.mockReturnValue({
      podium: Array.from({ length: 9 }, () => ({ name: 'x' })),
    });
    expect(await buildArchiveSnapshot({ eventId: 'ev1' }, {})).toBeNull();
  });

  it('stages nothing for a test event', async () => {
    findEvent.mockResolvedValue({ ...event, is_test: true });
    expect(await buildArchiveSnapshot({ eventId: 'ev1' }, {})).toBeNull();
    expect(computeStageReport).not.toHaveBeenCalled();
  });

  it('stages nothing before the terminal stage is complete, or when nobody is ranked', async () => {
    isEventComplete.mockResolvedValue(false);
    expect(await buildArchiveSnapshot({ eventId: 'ev1' }, {})).toBeNull();
    isEventComplete.mockResolvedValue(true);
    computeEventSummary.mockReturnValue([]);
    expect(await buildArchiveSnapshot({ eventId: 'ev1' }, {})).toBeNull();
  });
});

describe('stageArchiveSnapshot', () => {
  it('never throws: the archive is fail-open and must not break the organiser own work', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // a missing event makes reading its organisation throw inside the wrapper; it must be logged, not escape
    await expect(stageArchiveSnapshot(null, {})).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
