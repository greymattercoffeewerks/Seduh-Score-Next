import { describe, it, expect, vi } from 'vitest';
import * as exportModule from '../../core/export.js';
import {
  ordinalLabel,
  describeOutcome,
  buildReportTables,
  sanitizeFilename,
  mountReportScreen,
} from './reportScreen.js';

function fakeClient({ tables = {} } = {}) {
  const queues = {};
  for (const [table, response] of Object.entries(tables)) {
    queues[table] = Array.isArray(response) ? [...response] : [response];
  }
  const calls = [];

  return {
    calls,
    from(table) {
      const queue = queues[table] ?? [{ data: null, error: null }];
      const resolve = () => (queue.length > 1 ? queue.shift() : queue[0]);
      const builder = {
        select: (...args) => {
          calls.push(['select', table, ...args]);
          return builder;
        },
        eq: (...args) => {
          calls.push(['eq', table, ...args]);
          return builder;
        },
        in: (...args) => {
          calls.push(['in', table, ...args]);
          return builder;
        },
        order: (...args) => {
          calls.push(['order', table, ...args]);
          return builder;
        },
        single: () => Promise.resolve(resolve()),
        maybeSingle: () => Promise.resolve(resolve()),
        then: (onResolve, onReject) => Promise.resolve(resolve()).then(onResolve, onReject),
      };
      return builder;
    },
  };
}

describe('ordinalLabel', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [111, '111th'],
    [113, '113th'],
  ])('labels %i as %s', (n, expected) => {
    expect(ordinalLabel(n)).toBe(expected);
  });
});

describe('describeOutcome', () => {
  it('says "Advanced" for an entry with no final position — their result continues in the next stage', () => {
    expect(describeOutcome({ finalPosition: null, positionNote: null })).toBe('Advanced');
  });

  it('shows the ordinal label for an entry with a final position and no note', () => {
    expect(describeOutcome({ finalPosition: 1, positionNote: null })).toBe('1st');
  });

  it('appends the position note in parentheses when one exists (a coin toss)', () => {
    expect(
      describeOutcome({ finalPosition: 2, positionNote: 'coin toss, witnessed by organiser' }),
    ).toBe('2nd (coin toss, witnessed by organiser)');
  });

  it('mentions arriving via a tiebreak for an entry that advanced without an ordinal yet', () => {
    expect(
      describeOutcome({ finalPosition: null, source: 'tiebreak_won', positionNote: null }),
    ).toBe('Advanced (advanced via tiebreak)');
  });

  it('mentions arriving via a coin toss when the entry has a final position too — arrival and outcome are separate facts, both shown', () => {
    expect(describeOutcome({ finalPosition: 1, source: 'coin_toss', positionNote: null })).toBe(
      '1st (advanced via coin toss)',
    );
  });

  it('says nothing extra for the unremarkable default sources (seed, a clean advance)', () => {
    expect(describeOutcome({ finalPosition: null, source: 'seed', positionNote: null })).toBe(
      'Advanced',
    );
    expect(describeOutcome({ finalPosition: 3, source: 'advanced', positionNote: null })).toBe(
      '3rd',
    );
  });

  it('shows both arrival and this-stage outcome notes together when both are real facts about the same row', () => {
    expect(
      describeOutcome({
        finalPosition: 1,
        source: 'tiebreak_won',
        positionNote: 'coin toss, witnessed by organiser',
      }),
    ).toBe('1st (advanced via tiebreak; coin toss, witnessed by organiser)');
  });
});

describe('sanitizeFilename', () => {
  it('replaces every character in the function\'s own stated unsafe set (\\/:*?"<>|), not just a sample of them', () => {
    expect(sanitizeFilename('a\\b/c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('leaves an already-safe name untouched', () => {
    expect(sanitizeFilename('Autumn Cup Tasters')).toBe('Autumn Cup Tasters');
  });
});

describe('buildReportTables', () => {
  it('builds standings, difficulty, and distribution table specs per stage, formatted the same as the on-screen tables', () => {
    const stageReports = [
      {
        stage: { kind: 'prelims' },
        ranked: [
          {
            item: {
              displayName: 'Alex',
              numCorrect: 3,
              total_elapsed_secs: 90,
              finalPosition: null,
              source: 'seed',
              positionNote: null,
            },
            position: 1,
          },
        ],
        difficulty: [{ setId: 'set1', position: 1, label: null, sampleSize: 4, avgCorrect: 0.75 }],
        distribution: [{ correctCount: 3, numCuppers: 1 }],
      },
    ];

    const tables = buildReportTables(stageReports);

    expect(tables).toHaveLength(3);
    expect(tables[0]).toEqual({
      title: 'prelims — Standings',
      columns: [
        { key: 'position', label: 'Pos' },
        { key: 'displayName', label: 'Cupper' },
        { key: 'numCorrect', label: 'Correct' },
        { key: 'time', label: 'Time' },
        { key: 'outcome', label: 'Outcome' },
      ],
      rows: [{ position: 1, displayName: 'Alex', numCorrect: 3, time: '90s', outcome: 'Advanced' }],
    });
    expect(tables[1].title).toBe('prelims — Set difficulty');
    expect(tables[1].rows).toEqual([{ set: 'Set 1', correct: '75%', sampleSize: 4 }]);
    expect(tables[2].title).toBe('prelims — Score distribution');
    expect(tables[2].rows).toEqual([{ correctCount: 3, numCuppers: 1 }]);
  });

  it('flattens every stage into one list, in order', () => {
    const emptyStage = (kind) => ({
      stage: { kind },
      ranked: [],
      difficulty: [],
      distribution: [],
    });
    const tables = buildReportTables([emptyStage('prelims'), emptyStage('finals')]);
    expect(tables.map((t) => t.title)).toEqual([
      'prelims — Standings',
      'prelims — Set difficulty',
      'prelims — Score distribution',
      'finals — Standings',
      'finals — Set difficulty',
      'finals — Score distribution',
    ]);
  });
});

const event = { id: 'ev1', org_id: 'org1', name: 'Autumn Cup Tasters', is_test: false };

describe('mountReportScreen', () => {
  it('shows "not available yet" when the terminal stage is not complete — no stage data fetched at all', async () => {
    const root = document.createElement('div');
    const stages = [
      { id: 's1', event_id: 'ev1', ordinal: 1, cutoff: 8, status: 'complete' },
      { id: 's2', event_id: 'ev1', ordinal: 2, cutoff: null, status: 'running' },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: { data: stages, error: null },
      },
    });

    await mountReportScreen(root, { eventId: 'ev1', client });
    expect(root.textContent).toContain('not available yet');
    // Only the ct_stages call isEventComplete makes — no per-stage report
    // computation (standings/difficulty/distribution) should ever fire.
    expect(client.calls.some(([, table]) => table === 'ct_standings')).toBe(false);
    expect(client.calls.some(([, table]) => table === 'ct_sets')).toBe(false);
  });

  it('renders every stage once the terminal stage is complete, in ordinal order', async () => {
    const root = document.createElement('div');
    const stages = [
      {
        id: 's1',
        event_id: 'ev1',
        ordinal: 1,
        kind: 'prelims',
        set_count: 1,
        cutoff: 1,
        status: 'complete',
      },
      {
        id: 's2',
        event_id: 'ev1',
        ordinal: 2,
        kind: 'finals',
        set_count: 1,
        cutoff: null,
        status: 'complete',
      },
    ];
    // isEventComplete's own read, plus listStagesForEvent's own read, plus
    // findStageById inside each computeStageReport call (via
    // fetchStandingsForStage) — four ct_stages reads total across this flow.
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stages, error: null }, // isEventComplete
          { data: stages, error: null }, // listStagesForEvent
          { data: stages[0], error: null }, // computeStageReport(s1) -> findStageById
          { data: stages[1], error: null }, // computeStageReport(s2) -> findStageById
        ],
        ct_stage_entries: { data: [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }], error: null },
        ct_standings: {
          data: [
            {
              entry_id: 'e1',
              stage_id: 's1',
              correct_count: 1,
              sets_scored: 1,
              total_elapsed_secs: 40,
            },
          ],
          error: null,
        },
        event_entries: { data: [{ id: 'e1', display_name: 'Alex' }], error: null },
        ct_sets: { data: [{ id: 'set1', stage_id: 's1', position: 1, label: null }], error: null },
        ct_heats: { data: [{ id: 'h1' }], error: null },
        ct_heat_entries: { data: [{ id: 'he1' }], error: null },
        ct_results: { data: [{ set_id: 'set1', correct: true }], error: null },
      },
    });

    await mountReportScreen(root, { eventId: 'ev1', client });

    const headings = [...root.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['prelims', 'finals']);
    expect(root.textContent).toContain('Alex');
    expect(root.textContent).toContain('Set difficulty');
    expect(root.textContent).toContain('Score distribution');
  });

  // Shared by the three export-button tests below — a single normal stage,
  // one entry, so the exact CSV content is small enough to assert on in
  // full rather than loosely.
  function exportFixtureTables(overrides = {}) {
    const stages = [
      {
        id: 's1',
        event_id: 'ev1',
        ordinal: 1,
        kind: 'finals',
        set_count: 1,
        cutoff: null,
        status: 'complete',
      },
    ];
    return {
      events: { data: { ...event, ...overrides }, error: null },
      ct_stages: [
        { data: stages, error: null }, // isEventComplete
        { data: stages, error: null }, // listStagesForEvent
        { data: stages[0], error: null }, // computeStageReport -> findStageById
      ],
      ct_stage_entries: { data: [{ id: 'se1', stage_id: 's1', entry_id: 'e1' }], error: null },
      ct_standings: {
        data: [
          {
            entry_id: 'e1',
            stage_id: 's1',
            correct_count: 1,
            sets_scored: 1,
            total_elapsed_secs: 40,
          },
        ],
        error: null,
      },
      event_entries: { data: [{ id: 'e1', display_name: 'Rivera, Alex' }], error: null },
      ct_sets: { data: [{ id: 'set1', stage_id: 's1', position: 1, label: null }], error: null },
      ct_heats: { data: [{ id: 'h1' }], error: null },
      ct_heat_entries: { data: [{ id: 'he1' }], error: null },
      ct_results: { data: [{ set_id: 'set1', correct: true }], error: null },
    };
  }

  it('offers export actions once the report is available, and exports the real report data end to end — including a comma-containing cupper name surviving CSV escaping, and the event name sanitized into the filename', async () => {
    const root = document.createElement('div');
    // Deliberately an unsafe filename character AND a comma-containing
    // roster name in the same test — found in review (test-auditor): the
    // escaping logic and the report-building logic were each tested in
    // isolation but never composed, and the sanitized-filename claim was
    // never proven wired into the actual download call (a fixture using an
    // already-safe name would pass identically whether or not
    // sanitizeFilename was actually called).
    const client = fakeClient({ tables: exportFixtureTables({ name: 'Fall/Winter Cup' }) });

    const downloadSpy = vi.spyOn(exportModule, 'downloadCsv').mockImplementation(() => {});
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    await mountReportScreen(root, { eventId: 'ev1', client });

    const buttons = [...root.querySelectorAll('.report-actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Download CSV', 'Print / Save as PDF']);
    // Distinct visual weight per T4.8 review (ui-accessibility-reviewer):
    // no bare, un-tokenized `.btn` — a real primary/secondary pairing.
    expect(buttons[0].className).toContain('btn-primary');
    expect(buttons[1].className).toContain('btn-outline');

    buttons[0].click();
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy.mock.calls[0][0]).toBe('Fall-Winter Cup report.csv');
    expect(downloadSpy.mock.calls[0][1]).toBe(
      'finals — Standings\r\n' +
        'Pos,Cupper,Correct,Time,Outcome\r\n' +
        '1,"Rivera, Alex",1,40s,Advanced\r\n' +
        '\r\n' +
        'finals — Set difficulty\r\n' +
        'Set,Correct,Cuppers scored\r\n' +
        'Set 1,100%,1\r\n' +
        '\r\n' +
        'finals — Score distribution\r\n' +
        'Correct answers,Cuppers\r\n' +
        '0,0\r\n' +
        '1,1',
    );

    buttons[1].click();
    expect(printSpy).toHaveBeenCalledTimes(1);

    downloadSpy.mockRestore();
    printSpy.mockRestore();
  });

  it("marks the export unmistakably as test data, both in the filename and as the CSV's own first line — a downloaded file can be forwarded or archived without its on-screen context", async () => {
    const root = document.createElement('div');
    const client = fakeClient({ tables: exportFixtureTables({ is_test: true }) });
    const downloadSpy = vi.spyOn(exportModule, 'downloadCsv').mockImplementation(() => {});

    await mountReportScreen(root, { eventId: 'ev1', client });
    root.querySelector('.report-actions button').click();

    expect(downloadSpy.mock.calls[0][0]).toBe('TEST — Autumn Cup Tasters report.csv');
    expect(downloadSpy.mock.calls[0][1].startsWith('TEST DATA — NOT A LIVE EVENT\r\n\r\n')).toBe(
      true,
    );

    downloadSpy.mockRestore();
  });

  it('shows a focused error message, not a silent failure, when the CSV download itself throws', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const client = fakeClient({ tables: exportFixtureTables() });
    const downloadSpy = vi.spyOn(exportModule, 'downloadCsv').mockImplementation(() => {
      throw new Error('download blocked');
    });

    await mountReportScreen(root, { eventId: 'ev1', client });
    root.querySelector('.report-actions button').click();

    const feedback = root.querySelector('.report-actions .screen-feedback');
    expect(feedback.textContent).toContain('download blocked');
    expect(feedback.dataset.tone).toBe('error');
    expect(document.activeElement).toBe(feedback);
    // The rest of the report is untouched by an export failure — this is a
    // narrow, local error, not a reason to blank the whole screen.
    expect(root.textContent).toContain('Rivera, Alex');

    downloadSpy.mockRestore();
    document.body.removeChild(root);
  });

  it('offers no export actions when the report is not available yet', async () => {
    const root = document.createElement('div');
    const stages = [{ id: 's1', event_id: 'ev1', ordinal: 1, cutoff: null, status: 'running' }];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: { data: stages, error: null },
      },
    });

    await mountReportScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('.report-actions')).toBeNull();
  });

  it('renders the is-test banner unmistakably when the event is marked test data', async () => {
    const root = document.createElement('div');
    const stages = [{ id: 's1', event_id: 'ev1', ordinal: 1, cutoff: null, status: 'running' }];
    const client = fakeClient({
      tables: {
        events: { data: { ...event, is_test: true }, error: null },
        ct_stages: { data: stages, error: null },
      },
    });

    await mountReportScreen(root, { eventId: 'ev1', client });
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
  });

  it('shows an error message rather than crashing when loading the report fails', async () => {
    const root = document.createElement('div');
    const client = {
      from() {
        throw new Error('connection lost');
      },
    };

    await mountReportScreen(root, { eventId: 'ev1', client });
    const feedback = root.querySelector('.screen-feedback');
    expect(feedback).not.toBeNull();
    expect(feedback.dataset.tone).toBe('error');
    expect(feedback.textContent).toContain('connection lost');
  });

  it('never writes to root again once its own signal is aborted mid-load — the router-navigation-race guard', async () => {
    // Models the real bug (ROADMAP.md's "A real DOM-write race between the
    // router..."): this screen's own load is still in flight when the
    // router (in production) decides a newer navigation has superseded it
    // and aborts this mount's signal — well before render()'s own
    // loadState() promise gets a chance to resolve.
    let resolveEvent;
    const stages = [{ id: 's1', event_id: 'ev1', ordinal: 1, cutoff: null, status: 'running' }];
    const client = {
      from(table) {
        if (table !== 'events') {
          const rowsFor = table === 'ct_stages' ? stages : [];
          const builder = {
            select: () => builder,
            eq: () => builder,
            order: () => builder,
            single: () => Promise.resolve({ data: rowsFor[0] ?? null, error: null }),
            then: (resolve) => Promise.resolve({ data: rowsFor, error: null }).then(resolve),
          };
          return builder;
        }
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                new Promise((resolve) => {
                  resolveEvent = () => resolve({ data: event, error: null });
                }),
            }),
          }),
        };
      },
    };
    const controller = new AbortController();
    const root = document.createElement('div');
    document.body.appendChild(root);

    const mountPromise = mountReportScreen(root, {
      eventId: 'ev1',
      client,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(resolveEvent).toBeDefined());
    expect(root.textContent).toContain('Loading');

    // Simulate another, now-current screen having already rendered onto
    // this SAME shared root — exactly what a router navigation away from
    // this still-loading screen would have done in production.
    root.innerHTML = '<div id="other-screen-marker">Screen B is showing now</div>';

    controller.abort();
    resolveEvent();
    await mountPromise;

    // render() must have bailed out entirely — root still shows the OTHER
    // screen's content, untouched, not this screen's own report.
    expect(root.querySelector('#other-screen-marker')).not.toBeNull();
    expect(root.textContent).not.toContain('not available yet');
  });
});
