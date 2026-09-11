import { describe, it, expect, vi } from 'vitest';
import * as exportModule from '../../core/export.js';
import { formatDuration } from '../../core/duration.js';
import {
  ordinalLabel,
  describeOutcome,
  buildReportTables,
  toCsvSafeDuration,
  renderStageStandingsTable,
  sanitizeFilename,
  mountReportScreen,
  computeAccuracyPct,
  accuracyTier,
  renderEventSummaryTable,
  buildEventSummaryTable,
  renderRoundBarChart,
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

describe('renderStageStandingsTable', () => {
  const stage = { set_count: 2 };
  const ranked = [
    {
      item: {
        entry_id: 'e1',
        displayName: 'Alex',
        numCorrect: 2,
        sets_scored: 2,
        total_elapsed_secs: 90,
        finalPosition: null,
      },
      position: 1,
    },
    {
      item: {
        entry_id: 'e2',
        displayName: 'Sam',
        numCorrect: 0,
        sets_scored: 0,
        total_elapsed_secs: null,
        finalPosition: null,
      },
      position: 2,
    },
  ];
  const setGrid = new Map([
    [
      'e1',
      [
        { setId: 'set1', position: 1, correct: true },
        { setId: 'set2', position: 2, correct: false },
      ],
    ],
  ]);

  it('shows the visible time as M:SS, not raw seconds', () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const timeCell = table.querySelectorAll('tbody tr')[0].querySelector('[data-label="Time"]');
    // The visible text is the cell's own first child node — its nested
    // .sr-only expansion (checked separately below) also contributes to a
    // bare .textContent read, so this is what actually proves the VISIBLE
    // format, not just that "1:30" appears somewhere in the cell.
    expect(timeCell.childNodes[0].textContent).toBe('1:30');
  });

  it('pairs the visible M:SS time with an unambiguous screen-reader expansion', () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const timeCell = table.querySelectorAll('tbody tr')[0].querySelector('[data-label="Time"]');
    expect(timeCell.querySelector('.sr-only').textContent).toBe('1 minute 30 seconds');
  });

  it('shows a plain em dash with no screen-reader expansion for a cupper with no recorded time', () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const timeCell = table.querySelectorAll('tbody tr')[1].querySelector('[data-label="Time"]');
    expect(timeCell.textContent).toBe('—');
    expect(timeCell.querySelector('.sr-only')).toBeNull();
  });

  it('shows accuracy as a whole percentage, and a plain em dash for a cupper with zero scored sets', () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('[data-label="Accuracy"]').textContent).toBe('100%');
    expect(rows[1].querySelector('[data-label="Accuracy"]').textContent).toBe('—');
  });

  it('shows avg time per set as M:SS, rounded to the nearest whole second', () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const avgCell = table
      .querySelectorAll('tbody tr')[0]
      .querySelector('[data-label="Avg time/set"]');
    // 90s / 2 sets = 45s exactly here; the rounding itself is proven in
    // computeAvgSecsPerSet's own unit tests below.
    expect(avgCell.childNodes[0].textContent).toBe('0:45');
  });

  it("renders one Set N column per the stage's own set_count, Y/N/— from the set grid, keyed by the row's own entry_id", () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('[data-label="Set 1"]').textContent).toBe('Y');
    expect(rows[0].querySelector('[data-label="Set 2"]').textContent).toBe('N');
    // Sam (e2) has no entry in setGrid at all — every set cell falls back
    // to the "not scored" em dash, not a crash or an empty cell.
    expect(rows[1].querySelector('[data-label="Set 1"]').textContent).toBe('—');
    expect(rows[1].querySelector('[data-label="Set 2"]').textContent).toBe('—');
  });

  it('looks up a set cell by its own .position, not by array index — found in review (test-auditor): every other fixture here happens to keep the grid array dense and position-ordered, which an accidental grid[position - 1] implementation would pass identically', () => {
    // e1's own grid entry is deliberately SPARSE (only set 2 present, not
    // set 1) and would misalign under an index-based lookup (grid[0] would
    // be read for "Set 1", landing on this one set2 entry instead of the
    // correct "no result for set 1" em dash).
    const sparseGrid = new Map([['e1', [{ setId: 'set2', position: 2, correct: true }]]]);
    const table = renderStageStandingsTable(ranked, stage, sparseGrid);
    const row = table.querySelectorAll('tbody tr')[0];
    expect(row.querySelector('[data-label="Set 1"]').textContent).toBe('—');
    expect(row.querySelector('[data-label="Set 2"]').textContent).toBe('Y');
  });

  it("marks a 100%-accuracy row with accuracy tier 1, and a 0%-accuracy row with tier 3, as a data attribute the CSS reads — not inline color, matching this project's text-carried-first convention", () => {
    const contrastRanked = [
      {
        item: {
          entry_id: 'e1',
          displayName: 'Alex',
          numCorrect: 2,
          sets_scored: 2,
          total_elapsed_secs: 90,
        },
        position: 1,
      },
      {
        item: {
          entry_id: 'e2',
          displayName: 'Sam',
          numCorrect: 0,
          sets_scored: 2,
          total_elapsed_secs: 90,
        },
        position: 2,
      },
    ];
    const table = renderStageStandingsTable(contrastRanked, stage, new Map());
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0].dataset.accuracyTier).toBe('1');
    expect(rows[1].dataset.accuracyTier).toBe('3');
  });

  it('gives no accuracy tier at all to a cupper with zero scored sets — not a misleading "worst tier"', () => {
    const table = renderStageStandingsTable(ranked, stage, setGrid);
    const rows = table.querySelectorAll('tbody tr');
    expect(rows[1].dataset.accuracyTier).toBeUndefined();
  });
});

describe('computeAccuracyPct', () => {
  it('rounds numCorrect/setsScored to a whole percentage', () => {
    expect(computeAccuracyPct(2, 3)).toBe(67);
  });

  it('returns null, not NaN, for zero scored sets', () => {
    expect(computeAccuracyPct(0, 0)).toBeNull();
  });
});

describe('accuracyTier', () => {
  it.each([
    [100, 1],
    [99, 2],
    [50, 2],
    [49, 3],
    [0, 3],
  ])('tiers %i%% as tier %i', (pct, expected) => {
    expect(accuracyTier(pct)).toBe(expected);
  });

  it('returns null (no tier) for null accuracy', () => {
    expect(accuracyTier(null)).toBeNull();
  });
});

describe('toCsvSafeDuration', () => {
  it('prefixes a real duration with a leading apostrophe, the standard Excel/Sheets "literal text, not a value" escape', () => {
    // Proves the actual bug this guards against: a bare "2:00" written
    // unquoted into a CSV cell is exactly what spreadsheet software
    // auto-detects as a time-of-day and silently reformats on open.
    expect(toCsvSafeDuration(120)).toBe("'2:00");
  });

  it('returns a bare empty string, not an apostrophe-prefixed one, for a null duration', () => {
    // No value to protect from mis-parsing — an apostrophe here would just
    // be a stray character in an otherwise-blank cell.
    expect(toCsvSafeDuration(null)).toBe('');
  });
});

describe('renderEventSummaryTable / buildEventSummaryTable', () => {
  // Same shape computeEventSummary itself produces — matches its own
  // tests' fixture in analytics.test.js rather than inventing a
  // differently-shaped one here.
  const summaries = [
    {
      entryId: 'alex',
      displayName: 'Alex',
      rounds: [
        { stageOrdinal: 1, numCorrect: 3, totalElapsedSecs: 90 },
        { stageOrdinal: 2, numCorrect: 3, totalElapsedSecs: 70 },
      ],
      totalScore: 6,
      totalElapsedSecs: 160,
      avgSecsPerSet: 27,
    },
    {
      // Eliminated after stage 1 — never reached stage 2 at all.
      entryId: 'jo',
      displayName: 'Jo',
      rounds: [{ stageOrdinal: 1, numCorrect: 1, totalElapsedSecs: 150 }],
      totalScore: 1,
      totalElapsedSecs: 150,
      avgSecsPerSet: 50,
    },
  ];
  const stageReports = [
    { stage: { kind: 'prelims', ordinal: 1 } },
    { stage: { kind: 'finals', ordinal: 2 } },
  ];

  it('renders Rank/Cupper, one Correct+Time column pair per stage, and the three total columns, in row order as given (the real placement order, not re-sorted here)', () => {
    const table = renderEventSummaryTable(summaries, stageReports);
    const headerLabels = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headerLabels).toEqual([
      'Rank',
      'Cupper',
      'Preliminary — Correct',
      'Preliminary — Time',
      'Finals — Correct',
      'Finals — Time',
      'Total score',
      'Total time',
      'Avg time/set',
    ]);

    const rows = table.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('[data-label="Rank"]').textContent).toBe('1');
    expect(rows[0].querySelector('[data-label="Cupper"]').textContent).toBe('Alex');
    expect(rows[0].querySelector('[data-label="Total score"]').textContent).toBe('6');
    expect(rows[1].querySelector('[data-label="Rank"]').textContent).toBe('2');
    expect(rows[1].querySelector('[data-label="Cupper"]').textContent).toBe('Jo');
  });

  it("renders a plain em dash (not '0' or a crash) in both the Correct and Time columns for a stage a cupper never reached — and, in the SAME assertion pass, a cupper who DID reach that stage shows their real values there, not also an em dash", () => {
    // Found in review (test-auditor): the original version of this test
    // only checked Jo's own missing-round cells, which a version of the
    // code that always rendered em dash (for every cupper, every round)
    // would have passed identically. Alex's row for the SAME "Finals"
    // columns is what actually proves the em dash is conditional on the
    // round genuinely being absent, not unconditional.
    const table = renderEventSummaryTable(summaries, stageReports);
    const rows = table.querySelectorAll('tbody tr');
    const [alexRow, joRow] = rows;
    expect(alexRow.querySelector('[data-label="Finals — Correct"]').textContent).toBe('3');
    expect(alexRow.querySelector('[data-label="Finals — Time"]').childNodes[0].textContent).toBe(
      '1:10',
    );
    expect(joRow.querySelector('[data-label="Finals — Correct"]').textContent).toBe('—');
    expect(joRow.querySelector('[data-label="Finals — Time"]').textContent).toBe('—');
  });

  it('the CSV table mirrors the on-screen column order and Y/N-style em-dash convention exactly, per position not entryId', () => {
    const table = buildEventSummaryTable(summaries, stageReports);
    expect(table.title).toBe('Overall — All Rounds');
    expect(table.columns.map((c) => c.label)).toEqual([
      'Rank',
      'Cupper',
      'Preliminary — Correct',
      'Preliminary — Time',
      'Finals — Correct',
      'Finals — Time',
      'Total score',
      'Total time',
      'Avg time/set',
    ]);
    expect(table.rows[0]).toMatchObject({
      position: 1,
      displayName: 'Alex',
      correct1: 3,
      correct2: 3,
      totalScore: 6,
    });
    expect(table.rows[1]).toMatchObject({
      position: 2,
      displayName: 'Jo',
      correct1: 1,
      correct2: '—',
      time2: '—',
    });
  });

  it('disambiguates two same-kind stages with a "(Round N)" suffix — found in review (ui-accessibility-reviewer): setup.js\'s own validateStagePlan explicitly allows a repeated kind (e.g. two prelims stages), and a plain stageKindLabel(kind) label would produce two IDENTICAL column headers ("Preliminary — Correct" twice), ambiguous for a sighted user and a screen reader alike, even though the underlying per-round data lands in the correct cells either way', () => {
    const repeatedKindReports = [
      { stage: { kind: 'prelims', ordinal: 1 } },
      { stage: { kind: 'prelims', ordinal: 2 } },
      { stage: { kind: 'finals', ordinal: 3 } },
    ];
    const table = renderEventSummaryTable([], repeatedKindReports);
    const headerLabels = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headerLabels).toEqual([
      'Rank',
      'Cupper',
      'Preliminary (Round 1) — Correct',
      'Preliminary (Round 1) — Time',
      'Preliminary (Round 2) — Correct',
      'Preliminary (Round 2) — Time',
      'Finals — Correct', // the only occurrence of its kind — stays plain
      'Finals — Time',
      'Total score',
      'Total time',
      'Avg time/set',
    ]);
  });

  it('keeps the plain, undecorated label when a kind occurs only once — the common case should not carry a "(Round 1)" suffix nobody needs', () => {
    const table = buildEventSummaryTable([], stageReports);
    expect(table.columns.map((c) => c.label)).toContain('Preliminary — Correct');
    expect(table.columns.map((c) => c.label)).not.toContain('Preliminary (Round 1) — Correct');
  });
});

describe('renderRoundBarChart', () => {
  // Same fixture shape as the renderEventSummaryTable describe block above
  // (matches computeEventSummary's own real output — Alex reached both
  // rounds, Jo was eliminated after prelims and never reached finals).
  const summaries = [
    {
      entryId: 'alex',
      displayName: 'Alex',
      rounds: [
        { stageOrdinal: 1, numCorrect: 3, totalElapsedSecs: 90 },
        { stageOrdinal: 2, numCorrect: 2, totalElapsedSecs: 70 },
      ],
    },
    {
      entryId: 'jo',
      displayName: 'Jo',
      rounds: [{ stageOrdinal: 1, numCorrect: 1, totalElapsedSecs: 150 }],
    },
  ];
  const stageReports = [
    { stage: { kind: 'prelims', ordinal: 1 } },
    { stage: { kind: 'finals', ordinal: 2 } },
  ];

  function scoreChart() {
    return renderRoundBarChart({
      titleText: 'Score by Round',
      ariaSummary: 'Bar chart: score by round.',
      summaries,
      stageReports,
      getValue: (round) => round.numCorrect,
      // A non-identity formatter, deliberately — found in review
      // (test-auditor): `String(value)` here would produce the exact same
      // text a buggy implementation that ignored `formatValue` entirely and
      // fell back to `String(round.numCorrect)` directly would also
      // produce, so a test built on that fixture couldn't prove
      // `formatValue` is actually being called rather than silently
      // bypassed. A `#`-prefixed formatter can only appear if the callback
      // genuinely ran.
      formatValue: (value) => `#${value}`,
    });
  }

  it('renders one card with an <h2> title, an aria-labelled <svg role="img">, and a legend entry per cupper', () => {
    const card = scoreChart();
    expect(card.querySelector('h2').textContent).toBe('Score by Round');

    const svg = card.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Bar chart: score by round.');

    const legendNames = [...card.querySelectorAll('.report-chart-legend-item')].map(
      (li) => li.textContent,
    );
    expect(legendNames).toEqual(['Alex', 'Jo']);
  });

  it("renders exactly one bar per cupper who actually reached a round, and OMITS a bar entirely (not a zero-height one) for a round a cupper never reached — found in review-style thinking: a bar that's just very short would be indistinguishable from a real score of 0", () => {
    const card = scoreChart();
    const round1Bars = card.querySelectorAll('rect[data-round="1"]');
    const round2Bars = card.querySelectorAll('rect[data-round="2"]');
    expect(round1Bars.length).toBe(2); // Alex + Jo both competed in prelims
    expect(round2Bars.length).toBe(1); // only Alex reached finals
    expect(round2Bars[0].getAttribute('data-entry')).toBe('alex');
    expect(card.querySelectorAll('rect[data-entry="jo"][data-round="2"]').length).toBe(0);
  });

  it("labels each bar with its own real value, and a taller bar for a strictly larger value in the SAME round — proves the bar's height actually tracks the data, not just its presence", () => {
    const card = scoreChart();
    const valueTexts = [...card.querySelectorAll('.report-chart-value')].map((t) => t.textContent);
    expect(valueTexts).toEqual(['#3', '#1', '#2']); // round1: Alex(3), Jo(1); round2: Alex(2)

    const alexRound1 = card.querySelector('rect[data-entry="alex"][data-round="1"]');
    const joRound1 = card.querySelector('rect[data-entry="jo"][data-round="1"]');
    expect(Number(alexRound1.getAttribute('height'))).toBeGreaterThan(
      Number(joRound1.getAttribute('height')),
    );
  });

  it("formats the Time chart's own values through the caller's formatValue (M:SS), independently of the Score chart's plain-number formatting", () => {
    const timeCard = renderRoundBarChart({
      titleText: 'Time by Round',
      ariaSummary: 'Bar chart: time by round.',
      summaries,
      stageReports,
      getValue: (round) => round.totalElapsedSecs,
      formatValue: (value) => formatDuration(value),
    });
    const valueTexts = [...timeCard.querySelectorAll('.report-chart-value')].map(
      (t) => t.textContent,
    );
    expect(valueTexts).toEqual(['1:30', '2:30', '1:10']); // Alex 90s, Jo 150s, Alex 70s
  });

  it('gives the SAME cupper the SAME bar color in both the Score and Time charts, and different cuppers different colors', () => {
    const scoreCard = scoreChart();
    const timeCard = renderRoundBarChart({
      titleText: 'Time by Round',
      ariaSummary: 'Bar chart: time by round.',
      summaries,
      stageReports,
      getValue: (round) => round.totalElapsedSecs,
      formatValue: (value) => formatDuration(value),
    });
    const alexScoreFill = scoreCard
      .querySelector('rect[data-entry="alex"][data-round="1"]')
      .getAttribute('fill');
    const alexTimeFill = timeCard
      .querySelector('rect[data-entry="alex"][data-round="1"]')
      .getAttribute('fill');
    const joScoreFill = scoreCard
      .querySelector('rect[data-entry="jo"][data-round="1"]')
      .getAttribute('fill');
    expect(alexScoreFill).toBe(alexTimeFill);
    expect(alexScoreFill).not.toBe(joScoreFill);
  });

  it('axis labels reuse the SAME round labels as the per-stage <h2>/<h3> headings and the summary table\'s own column headers — disambiguated with "(Round N)" when a kind repeats, plain otherwise', () => {
    const repeatedKindReports = [
      { stage: { kind: 'prelims', ordinal: 1 } },
      { stage: { kind: 'prelims', ordinal: 2 } },
      { stage: { kind: 'finals', ordinal: 3 } },
    ];
    const card = renderRoundBarChart({
      titleText: 'Score by Round',
      ariaSummary: 'Bar chart: score by round.',
      summaries: [],
      stageReports: repeatedKindReports,
      getValue: (round) => round.numCorrect,
      formatValue: (value) => String(value),
    });
    const axisLabels = [...card.querySelectorAll('.report-chart-axis-label')].map(
      (t) => t.textContent,
    );
    expect(axisLabels).toEqual(['Preliminary (Round 1)', 'Preliminary (Round 2)', 'Finals']);
  });

  it("builds the legend from `summaries` itself, not a hardcoded or otherwise-static list — found in review (test-auditor): the describe block's one shared fixture meant a hardcoded ['Alex', 'Jo'] legend would have passed the earlier legend test identically", () => {
    const otherSummaries = [
      { entryId: 'zara', displayName: 'Zara', rounds: [] },
      { entryId: 'ben', displayName: 'Ben', rounds: [] },
    ];
    const card = renderRoundBarChart({
      titleText: 'Score by Round',
      ariaSummary: 'Bar chart: score by round.',
      summaries: otherSummaries,
      stageReports,
      getValue: (round) => round.numCorrect,
      formatValue: (value) => String(value),
    });
    const legendNames = [...card.querySelectorAll('.report-chart-legend-item')].map(
      (li) => li.textContent,
    );
    expect(legendNames).toEqual(['Zara', 'Ben']);
  });

  it("keeps a cupper at their OWN fixed x-slot across rounds rather than compacting each round to only the cuppers present that round — found in review (test-auditor): the shared fixture (Alex present both rounds, Jo eliminated after round 1) can't distinguish a fixed slot from a compacted layout, since Jo simply drops off the trailing end either way. The case that DOES distinguish them is the reverse — a cupper absent from round 1 but present only in round 2, at a summaries index AFTER an empty slot", () => {
    const summariesWithLateJoin = [
      {
        entryId: 'alex',
        displayName: 'Alex',
        rounds: [
          { stageOrdinal: 1, numCorrect: 3, totalElapsedSecs: 90 },
          { stageOrdinal: 2, numCorrect: 2, totalElapsedSecs: 70 },
        ],
      },
      {
        // Present in round 1 only — occupies slot 1. Its only purpose here
        // is to give us a KNOWN, real slot-to-slot spacing to derive from,
        // rather than hardcoding this chart's own internal pixel constants
        // into the test.
        entryId: 'jo',
        displayName: 'Jo',
        rounds: [{ stageOrdinal: 1, numCorrect: 1, totalElapsedSecs: 150 }],
      },
      {
        // The reverse of Jo: ABSENT from round 1, present only in round 2.
        // Under a fixed per-cupper slot, Casey (summaries index 2) sits at
        // slot 2 in round 2's group — TWO slot-widths right of Alex — with
        // slot 1 (Jo's own reserved slot) left empty that round. Under a
        // wrong "compacted, only cuppers present" implementation, Casey
        // would instead be drawn as round 2's 2nd present cupper — the SAME
        // x position Jo's own slot 1 would use — only ONE slot-width right
        // of Alex.
        entryId: 'casey',
        displayName: 'Casey',
        rounds: [{ stageOrdinal: 2, numCorrect: 2, totalElapsedSecs: 60 }],
      },
    ];
    const card = renderRoundBarChart({
      titleText: 'Score by Round',
      ariaSummary: 'Bar chart: score by round.',
      summaries: summariesWithLateJoin,
      stageReports,
      getValue: (round) => round.numCorrect,
      formatValue: (value) => String(value),
    });

    const alexRound1X = Number(
      card.querySelector('rect[data-entry="alex"][data-round="1"]').getAttribute('x'),
    );
    const joRound1X = Number(
      card.querySelector('rect[data-entry="jo"][data-round="1"]').getAttribute('x'),
    );
    const slotWidth = joRound1X - alexRound1X;

    const alexRound2X = Number(
      card.querySelector('rect[data-entry="alex"][data-round="2"]').getAttribute('x'),
    );
    const caseyRound2X = Number(
      card.querySelector('rect[data-entry="casey"][data-round="2"]').getAttribute('x'),
    );
    expect(caseyRound2X - alexRound2X).toBe(2 * slotWidth);
  });

  it('renders a real 0 as a visible 1px-minimum bar, never an omitted one — found in review (ui-accessibility-reviewer): nothing previously tested this invariant, so a one-character regression (e.g. swapping the `value == null` guard for a falsy check) could silently start treating a real 0 the same as "didn\'t compete" with nothing to catch it', () => {
    const summariesWithZero = [
      {
        entryId: 'alex',
        displayName: 'Alex',
        rounds: [{ stageOrdinal: 1, numCorrect: 0, totalElapsedSecs: 0 }],
      },
    ];
    const card = renderRoundBarChart({
      titleText: 'Score by Round',
      ariaSummary: 'Bar chart: score by round.',
      summaries: summariesWithZero,
      stageReports,
      getValue: (round) => round.numCorrect,
      formatValue: (value) => String(value),
    });
    const bar = card.querySelector('rect[data-entry="alex"][data-round="1"]');
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('height')).toBe('1');
  });
});

describe('buildReportTables', () => {
  it('builds standings, difficulty, and distribution table specs per stage, formatted the same as the on-screen tables', () => {
    const stageReports = [
      {
        stage: { kind: 'prelims', set_count: 1 },
        ranked: [
          {
            item: {
              entry_id: 'e1',
              displayName: 'Alex',
              numCorrect: 3,
              sets_scored: 4,
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
        setGrid: new Map([['e1', [{ setId: 'set1', position: 1, correct: true }]]]),
      },
    ];

    const tables = buildReportTables(stageReports);

    expect(tables).toHaveLength(3);
    expect(tables[0]).toEqual({
      title: 'Preliminary — Standings',
      columns: [
        { key: 'position', label: 'Pos' },
        { key: 'displayName', label: 'Cupper' },
        { key: 'numCorrect', label: 'Correct' },
        { key: 'time', label: 'Time' },
        { key: 'accuracy', label: 'Accuracy' },
        { key: 'avgTimePerSet', label: 'Avg time/set' },
        { key: 'set1', label: 'Set 1' },
        { key: 'outcome', label: 'Outcome' },
      ],
      rows: [
        {
          position: 1,
          displayName: 'Alex',
          numCorrect: 3,
          time: "'1:30",
          accuracy: '75%',
          avgTimePerSet: "'0:23",
          set1: 'Y',
          outcome: 'Advanced',
        },
      ],
    });
    expect(tables[1].title).toBe('Set difficulty — Preliminary');
    expect(tables[1].rows).toEqual([{ set: 'Set 1', correct: '75%', sampleSize: 4 }]);
    expect(tables[2].title).toBe('Score distribution — Preliminary');
    expect(tables[2].rows).toEqual([{ correctCount: 3, numCuppers: 1 }]);
  });

  it('flattens every stage into one list, in order', () => {
    const emptyStage = (kind, ordinal) => ({
      stage: { kind, ordinal },
      ranked: [],
      difficulty: [],
      distribution: [],
    });
    const tables = buildReportTables([emptyStage('prelims', 1), emptyStage('finals', 2)]);
    expect(tables.map((t) => t.title)).toEqual([
      'Overall — All Rounds',
      'Preliminary — Standings',
      'Set difficulty — Preliminary',
      'Score distribution — Preliminary',
      'Finals — Standings',
      'Set difficulty — Finals',
      'Score distribution — Finals',
    ]);
  });

  it("skips the cross-round summary entirely for a single-stage report — it would only duplicate that one stage's own standings", () => {
    const emptyStage = (kind) => ({
      stage: { kind },
      ranked: [],
      difficulty: [],
      distribution: [],
    });
    const tables = buildReportTables([emptyStage('finals')]);
    expect(tables.map((t) => t.title)).toEqual([
      'Finals — Standings',
      'Set difficulty — Finals',
      'Score distribution — Finals',
    ]);
  });

  it("disambiguates two same-kind stages' own CSV table titles with a \"(Round N)\" suffix, leaving a genuinely single-occurrence kind plain in the SAME event — the same class of bug already fixed for the on-screen <h2>/<h3> headings and the cross-round summary's own column headers (see stageRoundLabels' own comment, reportScreen.js): setup.js's own validateStagePlan explicitly allows a repeated kind (e.g. two prelims stages), and a plain stageKindLabel(kind) title would produce two downloaded CSV tables both titled \"Preliminary — Standings\" with no way to tell them apart once opened in a spreadsheet — arguably worse than the on-screen collision since there's no surrounding page for positional context", () => {
    const emptyStage = (kind, ordinal) => ({
      stage: { kind, ordinal },
      ranked: [],
      difficulty: [],
      distribution: [],
    });
    const tables = buildReportTables([
      emptyStage('prelims', 1),
      emptyStage('prelims', 2),
      emptyStage('finals', 3),
    ]);
    expect(tables.map((t) => t.title)).toEqual([
      'Overall — All Rounds',
      'Preliminary (Round 1) — Standings',
      'Set difficulty — Preliminary (Round 1)',
      'Score distribution — Preliminary (Round 1)',
      'Preliminary (Round 2) — Standings',
      'Set difficulty — Preliminary (Round 2)',
      'Score distribution — Preliminary (Round 2)',
      'Finals — Standings', // the only occurrence of its kind — stays plain
      'Set difficulty — Finals',
      'Score distribution — Finals',
    ]);
  });

  it('counts occurrences per kind, not globally — two repeating kinds interleaved with each other still each start their own count at "(Round 1)"', () => {
    // Found in review (test-auditor): the previous fixture only ever
    // repeated ONE kind, so it couldn't tell correct per-kind counting
    // apart from a plausible bug where a single shared counter increments
    // for ANY stage belonging to ANY repeating kind (which would emit
    // "(Round 1)"/"(Round 2)"/"(Round 3)"/"(Round 4)" in encounter order
    // instead of the correct "Round 1"/"Round 1"/"Round 2"/"Round 2" pairs
    // below). Interleaving two repeating kinds is what actually rules that
    // bug out — a shared counter and a per-kind counter only disagree once
    // there's more than one repeating kind in the same event.
    const emptyStage = (kind, ordinal) => ({
      stage: { kind, ordinal },
      ranked: [],
      difficulty: [],
      distribution: [],
    });
    const tables = buildReportTables([
      emptyStage('prelims', 1),
      emptyStage('semis', 2),
      emptyStage('prelims', 3),
      emptyStage('semis', 4),
    ]);
    expect(tables.map((t) => t.title)).toEqual([
      'Overall — All Rounds',
      'Preliminary (Round 1) — Standings',
      'Set difficulty — Preliminary (Round 1)',
      'Score distribution — Preliminary (Round 1)',
      'Semi-Finals (Round 1) — Standings',
      'Set difficulty — Semi-Finals (Round 1)',
      'Score distribution — Semi-Finals (Round 1)',
      'Preliminary (Round 2) — Standings',
      'Set difficulty — Preliminary (Round 2)',
      'Score distribution — Preliminary (Round 2)',
      'Semi-Finals (Round 2) — Standings',
      'Set difficulty — Semi-Finals (Round 2)',
      'Score distribution — Semi-Finals (Round 2)',
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
    expect(headings).toEqual([
      'Score by Round',
      'Time by Round',
      'Overall — All Rounds',
      'Preliminary',
      'Finals',
    ]);
    expect(root.textContent).toContain('Alex');
    // Plain, undecorated labels — each kind occurs only once here, so
    // neither the <h2> nor the <h3>s should carry a "(Round N)" suffix
    // nobody needs (see the disambiguation test below for the repeated-kind
    // case this would otherwise collide on).
    const subheadings = [...root.querySelectorAll('h3')].map((h) => h.textContent);
    expect(subheadings).toEqual([
      'Set difficulty — Preliminary',
      'Score distribution — Preliminary',
      'Set difficulty — Finals',
      'Score distribution — Finals',
    ]);

    // Every column header on every table on this screen (standings,
    // difficulty, distribution — three per stage) uses scope='col',
    // matching heatsScreen.js's own established convention (its own test
    // asserts it) — found missing on this screen and on
    // standingsScreen.js's near-identical table reviewing the two together.
    const headers = root.querySelectorAll('.standings-table thead th');
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) expect(header.getAttribute('scope')).toBe('col');

    // Found missing in production feedback ("no graphical info in the
    // report") — the set-difficulty "Correct" cell now carries a bar-fill
    // alongside its existing percentage text, not just the bare number.
    const bar = root.querySelector('.difficulty-bar');
    expect(bar).not.toBeNull();
    const fill = bar.querySelector('.difficulty-bar-fill');
    expect(fill.getAttribute('style')).toMatch(/^width: \d+%$/);
    // The label text still matches the fill's own percentage exactly —
    // not two independently-computed numbers that could drift apart.
    const [, fillPct] = fill.getAttribute('style').match(/width: (\d+)%/);
    const label = bar.parentElement.querySelector('.difficulty-bar-label');
    expect(label.textContent).toBe(`${fillPct}%`);
  });

  it("disambiguates same-kind stages' own <h2>/<h3> headings with a \"(Round N)\" suffix, leaves a genuinely single-occurrence kind plain in the SAME event, and agrees with the cross-round summary's own column numbering for the SAME stages — found in review (ui-accessibility-reviewer, 2026-09-11), the same class of bug already fixed for the cross-round summary's own column headers (see stageRoundLabels' own comment, reportScreen.js): setup.js's own validateStagePlan explicitly allows a repeated kind (e.g. two prelims stages), and a plain stageKindLabel(kind) label produced two IDENTICAL <h2>s (\"Preliminary\" twice) plus two identical <h3> pairs, ambiguous for a sighted user scanning the page and for a screen reader user navigating by headings list alike. A three-stage fixture (prelims/prelims/finals), not just two same-kind stages, proves the repeat-detection is scoped per kind (would fail if it were gated on \"more than one stage in the event\" instead) — found in review (test-auditor): a two-stage-only fixture couldn't distinguish that from a correct implementation. The same test also asserts the on-screen summary table's own column headers, not just the headings — found in review (test-auditor): renderStageSection and eventSummaryRoundColumns both call the shared stageRoundLabels, but nothing previously proved the two call sites actually stay in agreement for one real event rather than merely each being individually correct in isolation.", async () => {
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
        kind: 'prelims',
        set_count: 1,
        cutoff: null,
        status: 'complete',
      },
      {
        id: 's3',
        event_id: 'ev1',
        ordinal: 3,
        kind: 'finals',
        set_count: 1,
        cutoff: null,
        status: 'complete',
      },
    ];
    const client = fakeClient({
      tables: {
        events: { data: event, error: null },
        ct_stages: [
          { data: stages, error: null }, // isEventComplete
          { data: stages, error: null }, // listStagesForEvent
          { data: stages[0], error: null }, // computeStageReport(s1) -> findStageById
          { data: stages[1], error: null }, // computeStageReport(s2) -> findStageById
          { data: stages[2], error: null }, // computeStageReport(s3) -> findStageById
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
    expect(headings).toEqual([
      'Score by Round',
      'Time by Round',
      'Overall — All Rounds',
      'Preliminary (Round 1)',
      'Preliminary (Round 2)',
      'Finals',
    ]);

    const subheadings = [...root.querySelectorAll('h3')].map((h) => h.textContent);
    expect(subheadings).toEqual([
      'Set difficulty — Preliminary (Round 1)',
      'Score distribution — Preliminary (Round 1)',
      'Set difficulty — Preliminary (Round 2)',
      'Score distribution — Preliminary (Round 2)',
      'Set difficulty — Finals',
      'Score distribution — Finals',
    ]);

    // Same event, same stages — the "Overall — All Rounds" summary table's
    // own column headers must name each round with the exact same label the
    // <h2>/<h3>s above just used, not an independently-drifted numbering.
    // `.report-standings-table` also matches each per-stage standings table
    // (renderStageStandingsTable shares the same class), so this takes the
    // FIRST match specifically — the summary table renders before any
    // per-stage section, per renderReport's own append order above.
    const summaryTable = root.querySelector('.report-standings-table');
    const summaryHeaders = [...summaryTable.querySelectorAll('thead th')].map(
      (th) => th.textContent,
    );
    expect(summaryHeaders).toEqual([
      'Rank',
      'Cupper',
      'Preliminary (Round 1) — Correct',
      'Preliminary (Round 1) — Time',
      'Preliminary (Round 2) — Correct',
      'Preliminary (Round 2) — Time',
      'Finals — Correct',
      'Finals — Time',
      'Total score',
      'Total time',
      'Avg time/set',
    ]);
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
      ct_heat_entries: { data: [{ id: 'he1', entry_id: 'e1' }], error: null },
      ct_results: { data: [{ heat_entry_id: 'he1', set_id: 'set1', correct: true }], error: null },
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
      'Finals — Standings\r\n' +
        'Pos,Cupper,Correct,Time,Accuracy,Avg time/set,Set 1,Outcome\r\n' +
        // Leading apostrophe: Excel/Sheets' own escape for "literal text,
        // don't auto-format as a time" — see toCsvSafeDuration's own
        // comment (reportScreen.js) for why a bare "0:40" would otherwise
        // get silently reinterpreted as a clock time on open.
        '1,"Rivera, Alex",1,\'0:40,100%,\'0:40,Y,Advanced\r\n' +
        '\r\n' +
        'Set difficulty — Finals\r\n' +
        'Set,Correct,Cuppers scored\r\n' +
        'Set 1,100%,1\r\n' +
        '\r\n' +
        'Score distribution — Finals\r\n' +
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
