import { describe, expect, it } from 'vitest';
import { buildResultsPayload } from './resultsPublishing.js';
import { computeEventSummary } from './analytics.js';

// Same two-stage fixture shape as analytics.test.js's own computeEventSummary
// suite (prelims cutoff 2, finals terminal) — Alex wins, Sam 2nd, Jo
// eliminated in prelims. Reused rather than hand-rolling a second one, so
// this test proves buildResultsPayload reshapes ALREADY-correct placement,
// not a fixture-specific coincidence.
function twoStageReports() {
  const prelims = {
    stage: { id: 's1', kind: 'prelims', ordinal: 1, cutoff: 2, set_count: 3 },
    ranked: [
      {
        item: {
          entry_id: 'alex',
          displayName: 'Alex',
          numCorrect: 3,
          sets_scored: 3,
          total_elapsed_secs: 90,
          finalPosition: null,
        },
        position: 1,
      },
      {
        item: {
          entry_id: 'sam',
          displayName: 'Sam',
          numCorrect: 2,
          sets_scored: 3,
          total_elapsed_secs: 100,
          finalPosition: null,
        },
        position: 2,
      },
      {
        item: {
          entry_id: 'jo',
          displayName: 'Jo',
          numCorrect: 1,
          sets_scored: 3,
          total_elapsed_secs: 150,
          finalPosition: 3,
        },
        position: 3,
      },
    ],
  };
  const finals = {
    stage: { id: 's2', kind: 'finals', ordinal: 2, cutoff: null, set_count: 3 },
    ranked: [
      {
        item: {
          entry_id: 'alex',
          displayName: 'Alex',
          numCorrect: 3,
          sets_scored: 3,
          total_elapsed_secs: 70,
          finalPosition: 1,
        },
        position: 1,
      },
      {
        item: {
          entry_id: 'sam',
          displayName: 'Sam',
          numCorrect: 2,
          sets_scored: 3,
          total_elapsed_secs: 85,
          finalPosition: 2,
        },
        position: 2,
      },
    ],
  };
  return [prelims, finals];
}

describe('buildResultsPayload', () => {
  it('carries the event’s own format/name/city/venue/date through unchanged', () => {
    const stageReports = twoStageReports();
    const payload = buildResultsPayload({
      event: {
        format: 'cup_taster',
        name: 'October Cup',
        city: 'Bandar Seri Begawan',
        venue: 'HQ',
        event_date: '2026-10-04',
      },
      stageReports,
      summary: computeEventSummary(stageReports),
    });
    expect(payload.format).toBe('cup_taster');
    expect(payload.eventName).toBe('October Cup');
    expect(payload.city).toBe('Bandar Seri Begawan');
    expect(payload.venue).toBe('HQ');
    expect(payload.eventDate).toBe('2026-10-04');
  });

  it('defaults city/venue/eventDate to null when the event has none', () => {
    const stageReports = twoStageReports();
    const payload = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
    });
    expect(payload.city).toBeNull();
    expect(payload.venue).toBeNull();
    expect(payload.eventDate).toBeNull();
  });

  it('competitors is the first stage’s own entrant count, rounds is the stage count', () => {
    const stageReports = twoStageReports();
    const payload = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
    });
    expect(payload.competitors).toBe(3); // prelims had Alex, Sam, Jo
    expect(payload.rounds).toBe(2); // prelims + finals
  });

  it('winningTimeSecs is the champion’s own LAST round time, not a sum across rounds', () => {
    const stageReports = twoStageReports();
    const payload = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
    });
    expect(payload.winningTimeSecs).toBe(70); // Alex's finals time, not 90+70
  });

  it('podium is the top 3 of summary, in order, each carrying their own LAST round correct/total', () => {
    const stageReports = twoStageReports();
    const payload = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
    });
    expect(payload.podium).toEqual([
      { rank: 1, name: 'Alex', cafe: null, correct: 3, total: 3 },
      { rank: 2, name: 'Sam', cafe: null, correct: 2, total: 3 },
      // Jo was eliminated in prelims and never reached finals — their OWN
      // last round is still prelims (1/3), and computeEventSummary places
      // them 3rd overall for the whole event, not omitted.
      { rank: 3, name: 'Jo', cafe: null, correct: 1, total: 3 },
    ]);
    expect(payload.podium).toHaveLength(3);
  });

  it('looks up cafe by entryId from the caller-supplied map, falling back to null when missing', () => {
    const stageReports = twoStageReports();
    const cafeByEntryId = new Map([['alex', 'Kedai Runduk']]);
    const payload = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
      cafeByEntryId,
    });
    expect(payload.podium[0].cafe).toBe('Kedai Runduk');
    expect(payload.podium[1].cafe).toBeNull(); // Sam has no entry in the map
  });

  it('never re-derives placement — podium order matches summary’s own order exactly, even if it disagreed with raw numCorrect', () => {
    // A hand-crafted case where the raw numbers alone would rank differently
    // than the real, tiebreak-resolved outcome: Sam has a HIGHER numCorrect
    // in finals than Alex, but Alex is still finalPosition 1 (won a tiebreak
    // or coin toss upstream) — computeEventSummary's own ordering (by
    // finalPosition, not raw score) must be what buildResultsPayload trusts.
    const stageReports = [
      {
        stage: { id: 's1', kind: 'finals', ordinal: 1, cutoff: null, set_count: 3 },
        ranked: [
          {
            item: {
              entry_id: 'alex',
              displayName: 'Alex',
              numCorrect: 2,
              sets_scored: 3,
              total_elapsed_secs: 70,
              finalPosition: 1,
            },
            position: 1,
          },
          {
            item: {
              entry_id: 'sam',
              displayName: 'Sam',
              numCorrect: 3,
              sets_scored: 3,
              total_elapsed_secs: 85,
              finalPosition: 2,
            },
            position: 1, // tied on the raw comparator, resolved by finalPosition
          },
        ],
      },
    ];
    const payload = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
    });
    expect(payload.podium[0].name).toBe('Alex');
    expect(payload.podium[1].name).toBe('Sam');
  });
});
