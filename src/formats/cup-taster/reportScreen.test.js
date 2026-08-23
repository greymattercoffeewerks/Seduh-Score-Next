import { describe, it, expect } from 'vitest';
import { ordinalLabel, describeOutcome, mountReportScreen } from './reportScreen.js';

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
});
