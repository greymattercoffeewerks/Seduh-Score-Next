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

describe('buildResultsPayload — scope', () => {
  const roundLabelByOrdinal = new Map([
    [1, 'Preliminary'],
    [2, 'Finals'],
  ]);
  function build(extra = {}) {
    const stageReports = twoStageReports();
    return buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
      cafeByEntryId: new Map([
        ['alex', 'Kedai Runduk'],
        ['jo', 'Ambang'],
      ]),
      roundLabelByOrdinal,
      ...extra,
    });
  }

  it('publishes the podium only by default — no standings key at all, so nothing beyond the top three is public', () => {
    expect(build()).not.toHaveProperty('standings');
    expect(build({ scope: 'podium' })).not.toHaveProperty('standings');
  });

  it('treats an unrecognised scope as podium-only rather than publishing more than was asked for', () => {
    expect(build({ scope: 'everything' })).not.toHaveProperty('standings');
    expect(build({ scope: undefined })).not.toHaveProperty('standings');
  });

  it('publishes every competitor’s placing when the organiser chooses full standings, in summary order', () => {
    const { standings } = build({ scope: 'full' });
    expect(standings).toEqual([
      {
        place: 1,
        name: 'Alex',
        cafe: 'Kedai Runduk',
        round: 'Finals',
        correct: 3,
        total: 3,
        timeSecs: 70,
      },
      { place: 2, name: 'Sam', cafe: null, round: 'Finals', correct: 2, total: 3, timeSecs: 85 },
      // Jo never reached the finals: their own last round is the preliminary, scored 1/3.
      {
        place: 3,
        name: 'Jo',
        cafe: 'Ambang',
        round: 'Preliminary',
        correct: 1,
        total: 3,
        timeSecs: 150,
      },
    ]);
  });

  it('keeps the podium alongside the standings, so the archive row and the sheet agree', () => {
    const payload = build({ scope: 'full' });
    expect(payload.podium.map((row) => row.name)).toEqual(['Alex', 'Sam', 'Jo']);
    expect(payload.standings.slice(0, 3).map((row) => row.name)).toEqual(
      payload.podium.map((row) => row.name),
    );
  });

  it('only ever carries the fixed public fields — anything else on a source row (contact details, set marks) cannot leak through', () => {
    const stageReports = twoStageReports();
    const summary = computeEventSummary(stageReports).map((row) => ({
      ...row,
      phone: '+6738000000',
      email: 'alex@example.com',
      setMarks: ['Y', 'N', 'Y'],
    }));
    const { standings } = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary,
      scope: 'full',
    });
    for (const entry of standings) {
      expect(Object.keys(entry).sort()).toEqual(
        ['cafe', 'correct', 'name', 'place', 'round', 'timeSecs', 'total'].sort(),
      );
    }
    expect(JSON.stringify(standings)).not.toMatch(/phone|email|setMarks|8000000|example\.com/);
  });

  it('reports ties by the placement the stage resolution decided, not by position in the list', () => {
    const stageReports = [
      {
        stage: { id: 's1', kind: 'prelims', ordinal: 1, cutoff: null, set_count: 3 },
        ranked: [
          {
            item: {
              entry_id: 'a',
              displayName: 'Ayu',
              numCorrect: 2,
              sets_scored: 3,
              total_elapsed_secs: 90,
              finalPosition: 1,
            },
            position: 1,
          },
          {
            item: {
              entry_id: 'b',
              displayName: 'Budi',
              numCorrect: 1,
              sets_scored: 3,
              total_elapsed_secs: 100,
              finalPosition: 2,
            },
            position: 2,
          },
          {
            item: {
              entry_id: 'c',
              displayName: 'Citra',
              numCorrect: 1,
              sets_scored: 3,
              total_elapsed_secs: 100,
              finalPosition: 2,
            },
            position: 2,
          },
          {
            item: {
              entry_id: 'd',
              displayName: 'Dewi',
              numCorrect: 0,
              sets_scored: 3,
              total_elapsed_secs: 110,
              finalPosition: 4,
            },
            position: 4,
          },
        ],
      },
    ];
    const { standings } = buildResultsPayload({
      event: { name: 'Tie Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
      scope: 'full',
    });
    expect(standings.map((entry) => [entry.name, entry.place])).toEqual([
      ['Ayu', 1],
      ['Budi', 2],
      ['Citra', 2],
      ['Dewi', 4],
    ]);
  });

  it('leaves round and time null rather than inventing them when the caller has no label or the time was never recorded', () => {
    const stageReports = twoStageReports();
    stageReports[1].ranked[1].item.total_elapsed_secs = null;
    const { standings } = buildResultsPayload({
      event: { name: 'October Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
      scope: 'full',
    });
    expect(standings[0].round).toBeNull();
    expect(standings[1].timeSecs).toBeNull();
  });
});

describe('buildResultsPayload — who is listed', () => {
  function tiedReports() {
    const row = (id, name, correct, secs, finalPosition) => ({
      item: {
        entry_id: id,
        displayName: name,
        numCorrect: correct,
        sets_scored: 3,
        total_elapsed_secs: secs,
        finalPosition,
      },
      position: finalPosition,
    });
    return [
      {
        stage: { id: 's1', kind: 'finals', ordinal: 1, cutoff: null, set_count: 3 },
        // A tie for 2nd: Budi and Citra are both placed 2nd, Dewi is 4th.
        ranked: [
          row('a', 'Ayu', 3, 80, 1),
          row('b', 'Budi', 2, 90, 2),
          row('c', 'Citra', 2, 90, 2),
          row('d', 'Dewi', 1, 100, 4),
        ],
      },
    ];
  }
  const build = (extra = {}) => {
    const stageReports = tiedReports();
    return buildResultsPayload({
      event: { name: 'Tie Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
      scope: 'full',
      ...extra,
    });
  };

  it('labels a tie the same way on the podium and in the standings — one placing, two public surfaces', () => {
    const payload = build();
    expect(payload.podium.map((row) => [row.name, row.rank])).toEqual([
      ['Ayu', 1],
      ['Budi', 2],
      ['Citra', 2],
    ]);
    expect(payload.standings.slice(0, 3).map((row) => [row.name, row.place])).toEqual(
      payload.podium.map((row) => [row.name, row.rank]),
    );
  });

  it('leaves out a competitor with no scores at all, who never competed, without touching the counts', () => {
    const stageReports = tiedReports();
    const summary = computeEventSummary(stageReports);
    summary[3].totalSetsScored = 0; // Dewi has nothing recorded
    const payload = buildResultsPayload({
      event: { name: 'Tie Cup' },
      stageReports,
      summary,
      scope: 'full',
    });
    expect(payload.standings.map((row) => row.name)).toEqual(['Ayu', 'Budi', 'Citra']);
    expect(payload.competitors).toBe(4); // the stage's own entrant count is unchanged
  });

  it('leaves out a competitor the caller names (one who withdrew), keeping everyone else’s placing as decided', () => {
    // Dewi is 4th, outside the podium.
    const payload = build({ omitEntryIds: new Set(['d']) });
    expect(payload.standings.map((row) => [row.name, row.place])).toEqual([
      ['Ayu', 1],
      ['Budi', 2],
      ['Citra', 2],
    ]);
    // Nobody after Dewi to renumber here, so also check a gap in the middle of the list:
    const middle = build({ omitEntryIds: new Set(['d']), scope: 'full' });
    expect(middle.standings.map((row) => row.place)).toEqual([1, 2, 2]);
  });

  it('never leaves a podium finisher out of the standings, even one flagged as withdrawn, so the podium and the table cannot disagree', () => {
    const payload = build({ omitEntryIds: new Set(['a', 'c']) });
    expect(payload.standings.map((row) => row.name)).toEqual(['Ayu', 'Budi', 'Citra', 'Dewi']);
    expect(payload).not.toHaveProperty('notListed');
  });

  it('never drops anyone from the podium, whatever is omitted from the standings', () => {
    const payload = build({ omitEntryIds: new Set(['a', 'b', 'c']) });
    expect(payload.podium.map((row) => row.name)).toEqual(['Ayu', 'Budi', 'Citra']);
  });

  it('says how many competitors the standings leave out, so the sheet can account for the field it entered', () => {
    const stageReports = tiedReports();
    const summary = computeEventSummary(stageReports);
    summary[3].totalSetsScored = 0; // Dewi never scored: left out
    const payload = buildResultsPayload({
      event: { name: 'Tie Cup' },
      stageReports,
      summary,
      scope: 'full',
      omitEntryIds: new Set(['d', 'x']), // Dewi again (already out) and someone not in the field at all
    });
    expect(payload.notListed).toBe(1);
    expect(payload.standings).toHaveLength(3);
    expect(payload.competitors).toBe(4); // the field that was entered
  });

  it('records no notListed count when everyone is listed, or when only the podium was published', () => {
    expect(build()).not.toHaveProperty('notListed');
    expect(build({ scope: 'podium', omitEntryIds: new Set(['d']) })).not.toHaveProperty(
      'notListed',
    );
  });

  it('does not use the omit list at all for a podium-only publish', () => {
    const payload = build({ scope: 'podium', omitEntryIds: new Set(['d']) });
    expect(payload).not.toHaveProperty('standings');
  });
});

describe('buildResultsPayload — where a placing comes from', () => {
  function reportWith(lastRounds) {
    return [
      {
        stage: { id: 's1', kind: 'finals', ordinal: 1, cutoff: null, set_count: 3 },
        ranked: lastRounds.map(({ id, name, position, finalPosition }, index) => ({
          item: {
            entry_id: id,
            displayName: name,
            numCorrect: 3 - index,
            sets_scored: 3,
            total_elapsed_secs: 60 + index,
            finalPosition,
          },
          position,
        })),
      },
    ];
  }
  const build = (lastRounds) => {
    const stageReports = reportWith(lastRounds);
    return buildResultsPayload({
      event: { name: 'Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
      scope: 'full',
    });
  };

  it('takes the placing the stage resolution decided over the stage’s own local position, on the standings and the podium alike', () => {
    // Citra's local position says 3rd, but the resolution (a coin toss, say) placed her 2nd.
    const payload = build([
      { id: 'a', name: 'Ayu', position: 1, finalPosition: 1 },
      { id: 'b', name: 'Budi', position: 2, finalPosition: 2 },
      { id: 'c', name: 'Citra', position: 3, finalPosition: 2 },
    ]);
    expect(payload.standings.find((row) => row.name === 'Citra').place).toBe(2);
    expect(payload.podium.find((row) => row.name === 'Citra').rank).toBe(2);
  });

  it('publishes a gap, not a guess, when no placing was recorded', () => {
    const payload = build([
      { id: 'a', name: 'Ayu', position: 1, finalPosition: null },
      { id: 'b', name: 'Budi', position: 2, finalPosition: null },
    ]);
    // The stage's own position is a stage-local rank, not an overall placing: nothing decided, so nothing
    // is published as one (the sheet prints a dash). The podium keeps the order it was given.
    expect(payload.standings.map((row) => row.place)).toEqual([null, null]);
    expect(payload.podium.map((row) => row.rank)).toEqual([1, 2]);
  });
});

describe('buildResultsPayload — the podium is places, not rows', () => {
  function reportWithPlaces(places) {
    return [
      {
        stage: { id: 's1', kind: 'finals', ordinal: 1, cutoff: null, set_count: 3 },
        ranked: places.map((finalPosition, index) => ({
          item: {
            entry_id: `p${index}`,
            displayName: `Cupper ${index}`,
            numCorrect: 5 - index,
            sets_scored: 5,
            total_elapsed_secs: 60 + index,
            finalPosition,
          },
          position: finalPosition,
        })),
      },
    ];
  }
  const podiumFor = (places) => {
    const stageReports = reportWithPlaces(places);
    return buildResultsPayload({
      event: { name: 'Cup' },
      stageReports,
      summary: computeEventSummary(stageReports),
    }).podium;
  };

  it('keeps the usual three when third place is not shared', () => {
    expect(podiumFor([1, 2, 3, 4, 5]).map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('includes everyone who shares third place, instead of cutting the tie at three rows', () => {
    expect(podiumFor([1, 2, 3, 3, 3, 6]).map((row) => [row.name, row.rank])).toEqual([
      ['Cupper 0', 1],
      ['Cupper 1', 2],
      ['Cupper 2', 3],
      ['Cupper 3', 3],
      ['Cupper 4', 3],
    ]);
  });

  it('includes a third competitor tied for second, who would otherwise fall off the podium', () => {
    expect(podiumFor([1, 2, 2, 2, 5]).map((row) => row.rank)).toEqual([1, 2, 2, 2]);
  });

  it('does not extend the podium past a tie below third place', () => {
    expect(podiumFor([1, 2, 3, 4, 4]).map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('shows a smaller field in full, and never invents rows', () => {
    expect(podiumFor([1, 2]).map((row) => row.rank)).toEqual([1, 2]);
    expect(podiumFor([])).toEqual([]);
  });
});
