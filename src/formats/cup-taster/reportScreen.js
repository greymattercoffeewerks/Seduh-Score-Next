// Report and analytics screen (handoff §14 T4.7/T4.8, §6). Scoped with the
// user before writing code: the report only ever surfaces once the whole
// event is finished (see analytics.js's own module comment) — this screen
// has exactly two states, "not yet available" and "here is the final
// report," nothing in between. The two export actions (T4.8) don't change
// that: neither one mutates any displayed state or triggers a re-render —
// one downloads a file, the other opens the browser's own print dialog —
// so there's still no rebuild-then-refocus concern to manage here.
//
// Deliberately reuses `.standings-table` from standingsScreen.css for every
// table on this screen (standings-with-outcome, difficulty, distribution)
// rather than a new report-specific table class — round-1 review on T4.6
// flagged that screen's own 480px table-stacking CSS as a copy-paste from
// heatsScreen.css's `.assignment-table` instead of a shared rule (see
// ROADMAP.md's T4.6 follow-up note); reusing the existing class here avoids
// repeating that exact gap a third time rather than adding to it.
//
// T4.8's PDF export is the browser's own Print -> Save as PDF against this
// file's own `@media print` rules (reportScreen.css) — scoped with the user
// before writing code, matching core/export.js's own "no new dependency"
// framing. There is no generated-PDF code path here.
import { findEvent } from '../../core/events.js';
import { el, svgEl, withSrExpansion } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { formatDuration, formatDurationLong } from '../../core/duration.js';
import { buildCsvForTables, downloadCsv } from '../../core/export.js';
import { listStagesForEvent, stageKindLabel } from './setup.js';
import {
  isEventComplete,
  computeStageReport,
  computeEventSummary,
  computeAvgSecsPerSet,
} from './analytics.js';

// Pure. 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 4 -> '4th', 11-13 -> '11th'/
// '12th'/'13th' (the standard English-ordinal exception), everything else
// keys off the last digit.
export function ordinalLabel(n) {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// `source` describes how an entry ARRIVED at this stage (T4.6's own
// advancement provenance — set when the PREVIOUS stage resolved); only
// worth mentioning for the two non-default cases, since 'seed' (roster
// seeding into the first stage) and 'advanced' (a clean, untied
// advancement) are the unremarkable majority and would just add noise to
// every row.
function describeArrival(source) {
  if (source === 'tiebreak_won') return 'advanced via tiebreak';
  if (source === 'coin_toss') return 'advanced via coin toss';
  return null;
}

// Pure. `null` finalPosition means "advanced to the next stage" (their
// result continues in that stage's own section, shown separately) — the
// only entries at ANY stage without a finalPosition, since the terminal
// stage's own commitStageResolution call always sets one for every entry
// (handoff §5.2's advancement provenance; see standings.js's own doc
// comment on commitStageResolution for why every non-advancing entry, and
// every terminal-stage entry, always gets one). `positionNote` (if any) is
// about how THIS stage's own run ended (a coin toss decided during THIS
// stage's resolution); `source`/`describeArrival` is about how they GOT
// INTO this stage in the first place (the previous stage's resolution) —
// two different events that can both be true of the same row, so both are
// shown when present, not conflated into one.
export function describeOutcome(item) {
  const arrival = describeArrival(item.source);
  if (item.finalPosition == null) {
    return arrival ? `Advanced (${arrival})` : 'Advanced';
  }
  const label = ordinalLabel(item.finalPosition);
  const notes = [arrival, item.positionNote].filter(Boolean).join('; ');
  return notes ? `${label} (${notes})` : label;
}

// An em dash needs no screen-reader expansion (already unambiguous); a real
// duration gets one, via withSrExpansion — see that helper's own comment
// (core/dom.js) for why. `label` is required, not defaulted — found in
// review (code-reviewer): both of this file's own call sites already pass
// one explicitly, so a `= 'Time'` default could never actually execute.
function renderTimeCell(secs, label) {
  if (secs == null) return el('td', { text: '—', attrs: { 'data-label': label } });
  return el(
    'td',
    { attrs: { 'data-label': label } },
    withSrExpansion(formatDuration(secs), formatDurationLong(secs)),
  );
}

// Pure. `numCorrect`/`setsScored` accuracy as a whole percentage — `null`
// (rendered '—') for a cupper with zero scored sets rather than a
// division-by-zero `NaN`, the same "honest no data" choice
// computeSetDifficulty's own `avgCorrect` already makes.
export function computeAccuracyPct(numCorrect, setsScored) {
  if (setsScored === 0) return null;
  return Math.round((numCorrect / setsScored) * 100);
}

function renderAccuracyCell(numCorrect, setsScored) {
  const pct = computeAccuracyPct(numCorrect, setsScored);
  return el('td', { text: pct == null ? '—' : `${pct}%`, attrs: { 'data-label': 'Accuracy' } });
}

// 2026-09-11, user-requested — a WCTC-style visual-scanning cue on top of
// the Accuracy cell's own text. Three tiers, not four — found live-testing
// against a real browser (not caught by unit tests, which only assert the
// NUMBER each tier maps to, never a rendered color): this project's own
// `--color-gold` (#8a6a1f) and `--color-warning` (#8a5e10) are nearly
// identical hex values, never designed to sit adjacent to each other as a
// sequence, so a 4-tier scheme using both made two of the four bands
// visually indistinguishable — worse than no visual cue at all, since it
// silently misrepresents "these two rows differ" while the color says
// they don't. Collapsed to the three colors this project's own token set
// actually keeps genuinely distinct from one another (success/warning/
// danger — confirmed via their real computed hex values, not assumed).
// Not tied to any specific set_count (this project's own set_count is
// organiser-configurable per stage — a percentage banding stays valid
// regardless of how many sets a stage has, unlike a raw correct-count
// one would). Purely additive: the Accuracy column's own text already
// carries the same information, matching this project's established
// "text-carried, not color/icon-alone" convention (e.g. standingsScreen.css's
// own `data-status` styling); `null` (no scored sets yet) gets no tier at
// all rather than a misleading "lowest" one.
export function accuracyTier(pct) {
  if (pct == null) return null;
  if (pct >= 100) return 1;
  if (pct >= 50) return 2;
  return 3;
}

// Pure. 'Y'/'N'/'—' for one cupper's own grid at a given set position —
// shared by the on-screen table (renderSetCell below) and the CSV export
// (buildStageTables) so a future tweak to this convention can't silently
// drift between them, the same risk buildStageTables' own module comment
// already calls out for every other column ("so the CSV a cupper opens
// says the same thing the organiser saw on screen"). Found duplicated
// verbatim in review (code-reviewer) before this extraction. '—' for a set
// with no result row (a heat that ended early, or this cupper never
// reached it) — distinct from 'N' (scored and wrong), same null-vs-false
// honesty computeCupperSetGrid's own data already carries.
function formatSetCellText(grid, position) {
  const cell = grid.find((c) => c.position === position);
  const correct = cell?.correct ?? null;
  return correct == null ? '—' : correct ? 'Y' : 'N';
}

function renderSetCell(grid, position, label) {
  return el('td', { text: formatSetCellText(grid, position), attrs: { 'data-label': label } });
}

// `stage` (for `set_count`, the Set 1..N column count) and `setGrid`
// (`computeCupperSetGrid`'s own Map, keyed by entry_id) are both required —
// every stage report this screen ever renders already computes both
// alongside `ranked`, so there's no meaningful "standings without a grid"
// caller to support as an optional param.
//
// This table's own "Pos" column is deliberately a different label from
// renderEventSummaryTable's own "Rank" column below, not an inconsistency
// — found worth documenting in review (code-reviewer), since the two
// tables sit directly above/below each other on this same screen. "Pos" is
// a cupper's position within THIS ONE stage's own field; "Rank" is their
// placement across the WHOLE event — genuinely different concepts that
// happen to both be "which number are they," not the same fact labeled two
// different ways.
export function renderStageStandingsTable(ranked, stage, setGrid) {
  const setColumnCount = stage.set_count;
  const rows = ranked.map(({ item, position }) => {
    const tier = accuracyTier(computeAccuracyPct(item.numCorrect, item.sets_scored));
    const grid = setGrid.get(item.entry_id) ?? [];
    const setCells = [];
    for (let setPosition = 1; setPosition <= setColumnCount; setPosition += 1) {
      setCells.push(renderSetCell(grid, setPosition, `Set ${setPosition}`));
    }
    return el(
      'tr',
      { className: 'standings-row', attrs: tier ? { 'data-accuracy-tier': String(tier) } : {} },
      [
        el('td', { text: String(position), attrs: { 'data-label': 'Pos' } }),
        el('td', { text: item.displayName, attrs: { 'data-label': 'Cupper' } }),
        el('td', { text: String(item.numCorrect), attrs: { 'data-label': 'Correct' } }),
        renderTimeCell(item.total_elapsed_secs, 'Time'),
        renderAccuracyCell(item.numCorrect, item.sets_scored),
        renderTimeCell(
          computeAvgSecsPerSet(item.total_elapsed_secs, item.sets_scored),
          'Avg time/set',
        ),
        ...setCells,
        el('td', { text: describeOutcome(item), attrs: { 'data-label': 'Outcome' } }),
      ],
    );
  });

  const setHeaders = [];
  for (let setPosition = 1; setPosition <= setColumnCount; setPosition += 1) {
    setHeaders.push(el('th', { text: `Set ${setPosition}`, attrs: { scope: 'col' } }));
  }

  // scope='col' on every header, matching heatsScreen.js's own
  // assignment-table convention (its own test asserts it) — found missing
  // here and on standingsScreen.js's near-identical table reviewing the
  // two together.
  return el('table', { className: 'standings-table report-standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Pos', attrs: { scope: 'col' } }),
        el('th', { text: 'Cupper', attrs: { scope: 'col' } }),
        el('th', { text: 'Correct', attrs: { scope: 'col' } }),
        el('th', { text: 'Time', attrs: { scope: 'col' } }),
        el('th', { text: 'Accuracy', attrs: { scope: 'col' } }),
        el('th', { text: 'Avg time/set', attrs: { scope: 'col' } }),
        ...setHeaders,
        el('th', { text: 'Outcome', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// Bar-fill next to the existing percentage text — found missing in
// production feedback ("no graphical info in the report"). `pct` is a
// number this function computes itself (never user input), so a plain
// numeric width in a style attribute carries no injection risk — same
// reasoning as any other computed inline style in this codebase. Hidden
// entirely (not rendered at 0% width) when there's no data at all, so a
// dataless row reads as "nothing to show" rather than a bar that's
// visually indistinguishable from a genuine 0%.
function renderDifficultyCell(avgCorrect) {
  if (avgCorrect == null) {
    return el('td', { text: 'No data', attrs: { 'data-label': 'Correct' } });
  }
  const pct = Math.round(avgCorrect * 100);
  return el('td', { attrs: { 'data-label': 'Correct' } }, [
    el('div', { className: 'difficulty-bar' }, [
      el('div', { className: 'difficulty-bar-fill', attrs: { style: `width: ${pct}%` } }),
    ]),
    el('span', { className: 'difficulty-bar-label', text: `${pct}%` }),
  ]);
}

function renderDifficultyTable(difficulty) {
  const rows = difficulty.map((set) =>
    el('tr', { className: 'standings-row' }, [
      el('td', {
        text: set.label ?? `Set ${set.position}`,
        attrs: { 'data-label': 'Set' },
      }),
      renderDifficultyCell(set.avgCorrect),
      el('td', { text: String(set.sampleSize), attrs: { 'data-label': 'Cuppers scored' } }),
    ]),
  );
  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Set', attrs: { scope: 'col' } }),
        el('th', { text: 'Correct', attrs: { scope: 'col' } }),
        el('th', { text: 'Cuppers scored', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// Column labeled "Correct answers", not "Correct" — found in review: the
// difficulty table's own "Correct" column one section above is a
// PERCENTAGE (avg correct across cuppers who faced that set), while this
// one is a raw COUNT (how many cuppers got exactly this many right). At the
// 480px stacked breakpoint, where each cell's `data-label` is the only
// column context left, "Correct: 3" right below "Correct: 83%" reads as the
// opposite of its actual meaning (a count misread as a percentage) rather
// than merely ambiguous.
function renderDistributionTable(distribution) {
  const rows = distribution.map((bucket) =>
    el('tr', { className: 'standings-row' }, [
      el('td', { text: String(bucket.correctCount), attrs: { 'data-label': 'Correct answers' } }),
      el('td', { text: String(bucket.numCuppers), attrs: { 'data-label': 'Cuppers' } }),
    ]),
  );
  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Correct answers', attrs: { scope: 'col' } }),
        el('th', { text: 'Cuppers', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// A bare "2:00" written unquoted into a CSV cell is exactly what Excel/
// Sheets auto-detect as a time-of-day and silently reformat/reinterpret on
// open (found in review, ui-accessibility-reviewer, scoping the M:SS
// change: core/export.js's own escapeCsvValue only quotes a value
// containing a comma/quote/newline — a colon alone never triggers
// quoting, and quoting alone wouldn't stop Excel's own auto-detection of
// the CELL VALUE after CSV parsing anyway). A leading apostrophe is the
// standard, purpose-built Excel/Sheets escape for "treat this as literal
// text, not a value to auto-format" — the same convention spreadsheet
// tooling has used for this exact class of problem for decades. Scoped to
// the CSV export only, not the on-screen table above, since HTML never
// auto-reformats text content the way a spreadsheet cell does.
export function toCsvSafeDuration(secs) {
  return secs == null ? '' : `'${formatDuration(secs)}`;
}

// Pure. One stage's report -> the three table specs core/export.js needs,
// mirroring the exact formatting each on-screen table above uses (the same
// M:SS time via formatDuration — see toCsvSafeDuration's own comment for
// why the CSV's own copy carries one extra leading character the on-screen
// table doesn't need, the same "No data"/percentage difficulty text, the
// same describeOutcome call) — so the CSV a cupper opens says the same
// thing the organiser saw on screen, not a second, independently-formatted
// view of the same numbers.
//
// `roundLabel` is the caller's own already-computed
// `stageRoundLabels(stageReports).get(stage.ordinal)` — see that function's
// own comment for the full account of why it exists and why this function
// was the tracked follow-up. Mirrors `renderStageSection`'s own `roundLabel`
// parameter exactly, so every heading that names a stage — on-screen or in
// the CSV — is guaranteed to agree.
function buildStageTables(stageReport, roundLabel) {
  const { stage, ranked, difficulty, distribution, setGrid } = stageReport;
  const setColumns = [];
  for (let setPosition = 1; setPosition <= stage.set_count; setPosition += 1) {
    setColumns.push({ key: `set${setPosition}`, label: `Set ${setPosition}` });
  }
  return [
    {
      title: `${roundLabel} — Standings`,
      columns: [
        { key: 'position', label: 'Pos' },
        { key: 'displayName', label: 'Cupper' },
        { key: 'numCorrect', label: 'Correct' },
        { key: 'time', label: 'Time' },
        { key: 'accuracy', label: 'Accuracy' },
        { key: 'avgTimePerSet', label: 'Avg time/set' },
        ...setColumns,
        { key: 'outcome', label: 'Outcome' },
      ],
      rows: ranked.map(({ item, position }) => {
        const accuracyPct = computeAccuracyPct(item.numCorrect, item.sets_scored);
        const grid = setGrid.get(item.entry_id) ?? [];
        const setValues = {};
        for (let setPosition = 1; setPosition <= stage.set_count; setPosition += 1) {
          setValues[`set${setPosition}`] = formatSetCellText(grid, setPosition);
        }
        return {
          position,
          displayName: item.displayName,
          numCorrect: item.numCorrect,
          time: toCsvSafeDuration(item.total_elapsed_secs),
          accuracy: accuracyPct == null ? '—' : `${accuracyPct}%`,
          avgTimePerSet: toCsvSafeDuration(
            computeAvgSecsPerSet(item.total_elapsed_secs, item.sets_scored),
          ),
          ...setValues,
          outcome: describeOutcome(item),
        };
      }),
    },
    {
      title: `Set difficulty — ${roundLabel}`,
      columns: [
        { key: 'set', label: 'Set' },
        { key: 'correct', label: 'Correct' },
        { key: 'sampleSize', label: 'Cuppers scored' },
      ],
      rows: difficulty.map((set) => ({
        set: set.label ?? `Set ${set.position}`,
        correct: set.avgCorrect == null ? 'No data' : `${Math.round(set.avgCorrect * 100)}%`,
        sampleSize: set.sampleSize,
      })),
    },
    {
      title: `Score distribution — ${roundLabel}`,
      columns: [
        { key: 'correctCount', label: 'Correct answers' },
        { key: 'numCuppers', label: 'Cuppers' },
      ],
      rows: distribution,
    },
  ];
}

// Pure. One label per stage — the stage kind on its own when it's the only
// stage of that kind in the event, or with a "(Round N)" suffix when the
// kind repeats. A stage plan may legitimately repeat a kind — setup.js's
// own validateStagePlan explicitly names "repeated prelims heats" as a
// valid sequence ("may repeat or be skipped, but never regress"). Found in
// review (ui-accessibility-reviewer, 2026-09-11): the per-stage <h2>/<h3>
// headings AND the cross-round summary's own column headers each used a
// plain `stageKindLabel(kind)`, so two same-kind stages produced
// identically-worded text ("Preliminary — Correct" twice, or two
// "Preliminary" <h2>s) — ambiguous for a sighted user scanning the page and
// for a screen reader user navigating by headings list alike, even though
// the underlying data already landed in the right place either way. An
// EARLIER fix attempt (same review round) added the stage's kind to the
// per-stage <h3> subheadings alone, on the reasoning that combining with
// the kind was enough — that reasoning covers telling "Set difficulty"
// apart from "Score distribution" within one stage, and telling one
// stage's headings apart from a DIFFERENT kind's, but does nothing when the
// SAME kind repeats, which is exactly the case this function exists for.
//
// Centralized here (not duplicated per call site) so every heading that
// names a stage can share one disambiguation decision and never drift out
// of sync with each other — used by `renderStageSection` for its <h2>/<h3>s,
// by `eventSummaryRoundColumns` for the cross-round summary's own column
// headers, and by `buildStageTables` (via `buildReportTables`, below) for
// the downloaded CSV's own per-stage table titles. Disambiguated only when
// a kind actually repeats within THIS event — the common single-occurrence
// case keeps the plain label unchanged.
//
// `buildStageTables` was originally left out of scope when this function
// was introduced (2026-09-11) — the on-screen headings were the user's own
// request at the time, and the identical CSV-title collision was spun off
// as a tracked follow-up rather than silently assumed covered. Closed in a
// later pass the same day: see `buildReportTables`'s own comment for how it
// wires this function's output into `buildStageTables`.
function stageRoundLabels(stageReports) {
  const kindCounts = new Map();
  for (const { stage } of stageReports) {
    kindCounts.set(stage.kind, (kindCounts.get(stage.kind) ?? 0) + 1);
  }
  const occurrenceSoFar = new Map();
  const labels = new Map();
  for (const { stage } of stageReports) {
    const baseLabel = stageKindLabel(stage.kind);
    let label = baseLabel;
    if (kindCounts.get(stage.kind) > 1) {
      const occurrence = (occurrenceSoFar.get(stage.kind) ?? 0) + 1;
      occurrenceSoFar.set(stage.kind, occurrence);
      label = `${baseLabel} (Round ${occurrence})`;
    }
    labels.set(stage.ordinal, label);
  }
  return labels;
}

// Pure. One "Correct"/"Time" column PAIR per stage, for the cross-round
// summary's own header row AND each row's own per-round cells — kept as one
// function so the two can never drift out of sync with each other (the same
// risk `formatSetCellText` closed for the per-stage Set-N columns).
function eventSummaryRoundColumns(stageReports) {
  const labels = stageRoundLabels(stageReports);
  return stageReports.map(({ stage }) => {
    const roundLabel = labels.get(stage.ordinal);
    return {
      stageOrdinal: stage.ordinal,
      correctLabel: `${roundLabel} — Correct`,
      timeLabel: `${roundLabel} — Time`,
    };
  });
}

// Pure. The cross-round summary table (Phase B, 2026-09-11, user-requested
// — see analytics.js's own computeEventSummary comment for the full design
// account, especially why row order is the REAL tournament placement, not
// a fresh ranking of these totals). One row per cupper who appeared in ANY
// stage; a stage they never reached renders as a plain em dash in both its
// Correct and Time columns, matching this screen's own established
// "honest no data" convention rather than a 0 that would misread as "they
// scored zero here." The "Rank" column below is deliberately a different
// label from renderStageStandingsTable's own "Pos" (see that function's
// own comment for why) — event-wide placement, not one stage's own.
export function renderEventSummaryTable(summaries, stageReports) {
  const roundColumns = eventSummaryRoundColumns(stageReports);

  const rows = summaries.map((summary, index) => {
    const roundCells = roundColumns.flatMap(({ stageOrdinal, correctLabel, timeLabel }) => {
      const round = summary.rounds.find((r) => r.stageOrdinal === stageOrdinal);
      return [
        el('td', {
          text: round ? String(round.numCorrect) : '—',
          attrs: { 'data-label': correctLabel },
        }),
        renderTimeCell(round?.totalElapsedSecs ?? null, timeLabel),
      ];
    });
    return el('tr', { className: 'standings-row' }, [
      el('td', { text: String(index + 1), attrs: { 'data-label': 'Rank' } }),
      el('td', { text: summary.displayName, attrs: { 'data-label': 'Cupper' } }),
      ...roundCells,
      el('td', { text: String(summary.totalScore), attrs: { 'data-label': 'Total score' } }),
      renderTimeCell(summary.totalElapsedSecs, 'Total time'),
      renderTimeCell(summary.avgSecsPerSet, 'Avg time/set'),
    ]);
  });

  const roundHeaders = roundColumns.flatMap(({ correctLabel, timeLabel }) => [
    el('th', { text: correctLabel, attrs: { scope: 'col' } }),
    el('th', { text: timeLabel, attrs: { scope: 'col' } }),
  ]);

  return el('table', { className: 'standings-table report-standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Rank', attrs: { scope: 'col' } }),
        el('th', { text: 'Cupper', attrs: { scope: 'col' } }),
        ...roundHeaders,
        el('th', { text: 'Total score', attrs: { scope: 'col' } }),
        el('th', { text: 'Total time', attrs: { scope: 'col' } }),
        el('th', { text: 'Avg time/set', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// Pure. The cross-round summary as one core/export.js table spec, mirroring
// renderEventSummaryTable's own column set and "no data -> em dash, not 0"
// choice exactly — same "the CSV says what the organiser saw on screen"
// principle buildStageTables' own comment states.
export function buildEventSummaryTable(summaries, stageReports) {
  const roundColumns = eventSummaryRoundColumns(stageReports);
  return {
    title: 'Overall — All Rounds',
    // 'position', not 'rank' — the eslint-rules/no-derived-storage rule
    // flags a computed value assigned to a property matching /rank/i on
    // sight, a blunt but deliberate name+shape heuristic (handoff §5.2)
    // that doesn't distinguish this genuinely-fine in-memory CSV row from
    // the DB-write shape it actually exists to catch. Renaming sidesteps
    // the false positive the same way this project's own convention
    // prefers over a suppression comment (no existing eslint-disable for
    // this rule anywhere in the codebase).
    columns: [
      { key: 'position', label: 'Rank' },
      { key: 'displayName', label: 'Cupper' },
      ...roundColumns.flatMap(({ stageOrdinal, correctLabel, timeLabel }) => [
        { key: `correct${stageOrdinal}`, label: correctLabel },
        { key: `time${stageOrdinal}`, label: timeLabel },
      ]),
      { key: 'totalScore', label: 'Total score' },
      { key: 'totalTime', label: 'Total time' },
      { key: 'avgTimePerSet', label: 'Avg time/set' },
    ],
    rows: summaries.map((summary, index) => {
      const roundValues = {};
      for (const { stageOrdinal } of roundColumns) {
        const round = summary.rounds.find((r) => r.stageOrdinal === stageOrdinal);
        roundValues[`correct${stageOrdinal}`] = round ? round.numCorrect : '—';
        roundValues[`time${stageOrdinal}`] = round
          ? toCsvSafeDuration(round.totalElapsedSecs)
          : '—';
      }
      return {
        position: index + 1,
        displayName: summary.displayName,
        ...roundValues,
        totalScore: summary.totalScore,
        totalTime: toCsvSafeDuration(summary.totalElapsedSecs),
        avgTimePerSet: toCsvSafeDuration(summary.avgSecsPerSet),
      };
    }),
  };
}

// Pure. Every stage's tables, in order, with the cross-round summary
// prepended first (once there's more than one stage — a single-stage
// event's own "across all rounds" table would just duplicate that one
// stage's already-shown standings, not add anything) — the whole report as
// one flat list of table specs, ready for core/export.js's
// buildCsvForTables.
//
// `stageRoundLabels(stageReports)` is computed once here and each stage's
// own precomputed label passed into `buildStageTables`, the same shape
// `renderStageSection` already gets its `roundLabel` in — so two same-kind
// stages produce distinguishable CSV table titles instead of two tables
// both titled e.g. "Preliminary — Standings" with no way to tell them apart
// once downloaded (see `stageRoundLabels`' own comment for the fuller
// account of this gap).
export function buildReportTables(stageReports) {
  const summaryTable =
    stageReports.length > 1
      ? [buildEventSummaryTable(computeEventSummary(stageReports), stageReports)]
      : [];
  const roundLabels = stageRoundLabels(stageReports);
  return [
    ...summaryTable,
    ...stageReports.flatMap((stageReport) =>
      buildStageTables(stageReport, roundLabels.get(stageReport.stage.ordinal)),
    ),
  ];
}

// Pure. Strips the character set Windows forbids in a filename
// (`\/:*?"<>|`) — an event named e.g. "Fall/Winter Cup" would otherwise
// silently break the download rather than just export under a slightly
// different name. NOT a complete Windows-filename-safety guarantee: it
// doesn't handle a trailing period/space or the reserved device names
// (`CON`, `PRN`, `COM1`, …) — low-probability inputs for a coffee-event
// name, not covered here.
export function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-');
}

// Phase C, 2026-09-11, user-requested — hand-rolled SVG bar charts, no
// charting library, matching this project's existing "no new dependency"
// stance for PDF export (see this file's own module comment). Eight
// categorical colors (reportScreen.css's own `--report-chart-color-N`
// custom properties), cycling by a cupper's own index in `summaries` — the
// same order `renderEventSummaryTable` already uses, so a cupper's bar
// color and legend position match their row position in the table that
// follows. Colors repeat past the 8th cupper in a single event; acceptable
// because color is never the only signal a bar's identity depends on (see
// `renderRoundBarChart`'s own comment for the other two).
const CHART_SERIES_COLOR_COUNT = 8;
function chartSeriesColor(index) {
  return `var(--report-chart-color-${(index % CHART_SERIES_COLOR_COUNT) + 1})`;
}

// Pure-ish (builds live DOM, but from already-computed data, same as every
// other render* function on this screen). One grouped bar chart — a round
// per x-axis group, one bar per cupper who competed in THAT round, at a
// FIXED horizontal slot matching their own index in `summaries` in every
// group (not a compacted "only the cuppers present" layout) — so the same
// cupper sits at the same x-position across every round's group, letting a
// reader track one cupper's bar across rounds by position alone, not just
// by color. `getValue(round)` reads the one field this chart is about
// (numCorrect for "Score by Round", totalElapsedSecs for "Time by Round")
// from a `summary.rounds[]` entry (analytics.js's own `computeEventSummary`
// shape); returns `null`/`undefined` for "no bar this round" — a cupper who
// never reached the round (no entry in `rounds[]`) and a cupper who reached
// it but has no data for this particular value (e.g. never timed) both
// collapse to the same "no bar," matching `renderEventSummaryTable`'s own
// em-dash convention for exactly the same two cases (see that function's
// own `round?.totalElapsedSecs ?? null` — this isn't a new inconsistency).
//
// A single, shared, whole-chart y-scale (not renormalized per round) is
// deliberate — the whole point of a "by round" chart is comparing
// magnitude ACROSS rounds, which a per-round-relative scale would actively
// misrepresent.
//
// `role="img"` + a descriptive `aria-label`, not `aria-hidden` — matching
// `core/dom.js`'s own `brandMark()` precedent for a decorative-but-real SVG
// rather than removing it from the accessibility tree entirely. Safe to
// summarize rather than fully expose per-bar, unlike (say) the standings
// table: the on-screen table this chart sits above already carries every
// exact value in fully accessible markup — this chart adds a visual trend
// read, not a second source of data a screen-reader user would otherwise
// miss. Never color-alone as this chart's only way to tell two cuppers'
// bars apart, per this project's established convention (see
// `accuracyTier`'s own comment for the precedent): each bar's own value is
// rendered as adjacent SVG text (not just implied by height), each cupper
// keeps one fixed x-slot across every round (a positional cue independent
// of color), and a text legend below maps every color to its cupper's
// name. A thin `stroke` on every bar (found in review,
// ui-accessibility-reviewer: several of the 8 hues cluster closer together
// than casual inspection suggests under simulated red-green colorblindness
// — not a WCAG violation given the three cues above, but a visible border
// keeps adjacent same-round bars separable at a glance even when their
// fills read as similar).
export function renderRoundBarChart({
  titleText,
  ariaSummary,
  summaries,
  stageReports,
  getValue,
  formatValue,
}) {
  const roundLabels = stageRoundLabels(stageReports);
  const rounds = stageReports.map(({ stage }) => ({
    ordinal: stage.ordinal,
    label: roundLabels.get(stage.ordinal),
  }));

  let maxValue = 0;
  const cellsByRound = rounds.map(({ ordinal }) =>
    summaries.map((summary) => {
      const round = summary.rounds.find((r) => r.stageOrdinal === ordinal);
      const value = round ? getValue(round) : null;
      if (value != null) maxValue = Math.max(maxValue, value);
      return value;
    }),
  );
  // Guards the division below for the degenerate case (every value in this
  // chart is null/zero) — shouldn't happen for a real complete event, but
  // keeps the geometry math from ever dividing by zero if it somehow did.
  if (maxValue === 0) maxValue = 1;

  const barWidth = 16;
  const barGap = 4;
  const groupGap = 24;
  const sidePadding = 12;
  const chartAreaHeight = 140;
  const valueLabelSpace = 16;
  const axisLabelSpace = 28;
  const svgHeight = valueLabelSpace + chartAreaHeight + axisLabelSpace;
  const groupWidth = summaries.length * barWidth + Math.max(0, summaries.length - 1) * barGap;
  const svgWidth =
    sidePadding * 2 + rounds.length * groupWidth + Math.max(0, rounds.length - 1) * groupGap;

  const bars = [];
  rounds.forEach((round, roundIndex) => {
    const groupX = sidePadding + roundIndex * (groupWidth + groupGap);
    cellsByRound[roundIndex].forEach((value, cupperIndex) => {
      if (value == null) return;
      const summary = summaries[cupperIndex];
      const barX = groupX + cupperIndex * (barWidth + barGap);
      const barHeight = Math.max((value / maxValue) * chartAreaHeight, 1);
      const barY = valueLabelSpace + (chartAreaHeight - barHeight);
      bars.push(
        svgEl('rect', {
          x: barX,
          y: barY,
          width: barWidth,
          height: barHeight,
          fill: chartSeriesColor(cupperIndex),
          stroke: 'var(--color-border-strong)',
          'stroke-width': '0.5',
          rx: 2,
          'data-entry': summary.entryId,
          'data-round': round.ordinal,
        }),
      );
      const valueLabel = svgEl('text', {
        x: barX + barWidth / 2,
        y: barY - 3,
        'text-anchor': 'middle',
        class: 'report-chart-value',
      });
      valueLabel.textContent = formatValue(value);
      bars.push(valueLabel);
    });

    const axisLabel = svgEl('text', {
      x: groupX + groupWidth / 2,
      y: valueLabelSpace + chartAreaHeight + 16,
      'text-anchor': 'middle',
      class: 'report-chart-axis-label',
    });
    axisLabel.textContent = round.label;
    bars.push(axisLabel);
  });

  const svg = svgEl('svg', {
    viewBox: `0 0 ${svgWidth} ${svgHeight}`,
    width: svgWidth,
    height: svgHeight,
    class: 'report-chart-svg',
    role: 'img',
    'aria-label': ariaSummary,
  });
  svg.append(...bars);

  const legend = el(
    'ul',
    { className: 'report-chart-legend' },
    summaries.map((summary, index) =>
      el('li', { className: 'report-chart-legend-item' }, [
        el('span', {
          className: 'report-chart-legend-swatch',
          attrs: { style: `background: ${chartSeriesColor(index)}` },
        }),
        el('span', { text: summary.displayName }),
      ]),
    ),
  );

  return el('div', { className: 'card report-stage-card' }, [
    el('h2', { text: titleText }),
    el(
      'div',
      {
        className: 'report-chart-wrap',
        // Found in review (ui-accessibility-reviewer): `overflow-x: auto`
        // on a plain, non-focusable <div> can never be reached by a
        // keyboard-only user — no default keydown scrolling on an
        // unfocusable element, and no way to Tab into it either. At a
        // narrow width with enough cuppers to overflow, that left the
        // chart's own trailing content genuinely unreachable for that
        // user, not just less convenient. `tabindex="0"` makes it a real
        // stop in the tab order; its own `aria-label` (not the chart's,
        // which stays on the `role="img"` child) is what a screen-reader
        // user hears landing on this wrapper specifically, distinct from
        // the image's own label a tab-step later.
        attrs: { tabindex: '0', 'aria-label': 'Scrollable chart area' },
      },
      [svg],
    ),
    legend,
  ]);
}

// Every heading includes the stage's own (possibly round-disambiguated —
// see stageRoundLabels' own comment) label — found in review: two complete
// stages (e.g. prelims and finals) each produce an identically-worded
// "Set difficulty"/"Score distribution" <h3> with nothing to tell them
// apart in a screen reader's flat headings list (NVDA's Elements List,
// VoiceOver's Rotor, JAWS's headings list — all common navigation modes,
// not just reading top-to-bottom, where the preceding <h2> alone would be
// enough context) — and, when the SAME kind repeats within one event, the
// <h2> itself collides too (see stageRoundLabels' own comment for the full
// account of that follow-up finding). `roundLabel` is the caller's own
// already-computed `stageRoundLabels(stageReports).get(stage.ordinal)` —
// computed once for the whole report rather than re-derived per stage, so
// every stage's heading is guaranteed to agree with every other heading
// that names it (the cross-round summary's own column headers included).
function renderStageSection(stageReport, roundLabel) {
  const { stage, ranked, difficulty, distribution, setGrid } = stageReport;
  return el('div', { className: 'card report-stage-card' }, [
    el('h2', { text: roundLabel }),
    renderStageStandingsTable(ranked, stage, setGrid),
    el('h3', { text: `Set difficulty — ${roundLabel}` }),
    renderDifficultyTable(difficulty),
    el('h3', { text: `Score distribution — ${roundLabel}` }),
    renderDistributionTable(distribution),
  ]);
}

export async function mountReportScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  async function loadState() {
    const event = await findEvent(eventId, client);
    const complete = await isEventComplete(eventId, client);
    if (!complete) return { event, complete };

    const stages = await listStagesForEvent(eventId, client);
    const stageReports = [];
    // Sequential, not Promise.all'd — each computeStageReport call is
    // several DB round trips on its own, but this is an organiser-only,
    // low-frequency screen bounded at 2-3 stages per event (§7.5's own two
    // valid stage sequences), the same reasoning heats.js's
    // listHeatsForStage gives for its own sequential per-heat loop. Worth
    // parallelizing only if this ever becomes a genuinely hot path.
    for (const stage of stages) {
      stageReports.push(await computeStageReport(stage.id, client));
    }
    return { event, complete, stageReports };
  }

  // A defined loading state, not a blank screen — this screen has no
  // actions and never re-renders after the initial mount, but that one
  // load can be several sequential DB round trips deep (see loadState's
  // own comment), which on the "unreliable venue wifi" this project
  // designs around could otherwise look like a broken page for a real
  // stretch of time.
  function renderLoading() {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container report-screen' });
    container.appendChild(
      el('div', {
        className: 'screen-feedback',
        text: 'Loading report…',
        attrs: { role: 'status', 'aria-live': 'polite' },
      }),
    );
    root.appendChild(container);
  }

  // Found in review (ui-accessibility-reviewer + code-reviewer,
  // independently converging): an earlier version only wrapped
  // `loadState()` in a try/catch, leaving a render-path failure (building
  // the DOM from already-loaded data) uncaught entirely, AND the error
  // branch wasn't a proper screen — no heading, focus never moved to the
  // error — unlike every sibling screen's own renderOrShowError pattern
  // (heatsScreen.js, standingsScreen.js), which always covers both. This
  // screen has no re-render to fall back into on failure (it renders once),
  // so getting the FIRST render's own error handling right matters more
  // here than on any other screen in this project.
  function renderError(message) {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container report-screen' });
    container.appendChild(el('h1', { text: 'Report' }));
    const feedback = el('div', {
      className: 'screen-feedback',
      text: message,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    container.appendChild(feedback);
    root.appendChild(container);
    feedback.scrollIntoView?.({ block: 'nearest' });
    feedback.focus();
  }

  // Two export actions (T4.8), both side effects with nothing to await and
  // no displayed state to update afterward — neither triggers a screen
  // re-render (see the module comment above for why that's fine here). Each
  // still gets its own try/catch and a local feedback region, though —
  // found in review (code-reviewer): unlike the Blob/URL/anchor plumbing
  // inside core/export.js's downloadCsv (unguarded there deliberately,
  // per this project's "no error handling for scenarios that can't happen"
  // principle — Blob/URL support is universal), buildReportTables/
  // buildCsvForTables re-derive formatted rows from live data at click
  // time, and window.print() can genuinely throw in some sandboxed/embedded
  // contexts — an uncaught error at a live event with no visible feedback
  // is exactly the failure mode every OTHER action in this project reports
  // through a feedback region, and these two actions had none. `.no-print`
  // hides this toolbar (feedback region included) from the printed/PDF
  // output (reportScreen.css) — it's a screen-only control, not part of the
  // report content.
  function renderExportActions(data) {
    const feedback = el('div', {
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });

    function showActionError(message) {
      feedback.textContent = message;
      feedback.dataset.tone = 'error';
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }

    const csvButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: 'Download CSV',
    });
    csvButton.addEventListener('click', () => {
      try {
        const tables = buildReportTables(data.stageReports);
        const csv = buildCsvForTables(tables);
        // D9: is_test must render unmistakably wherever this data can end
        // up, not only on-screen — a downloaded CSV forwarded or archived
        // without its original context (filename can be renamed, the app
        // it was exported from isn't visible from inside a spreadsheet) is
        // exactly the "demo data indistinguishable from a real event"
        // failure mode this project exists to close, applied to an export
        // path rather than a live surface. Marked both in the filename (for
        // a downloads-folder/email-attachment glance) and as the CSV's own
        // first line (for when the file itself is actually opened).
        const marked = data.event.is_test ? `TEST DATA — NOT A LIVE EVENT\r\n\r\n${csv}` : csv;
        const filenamePrefix = data.event.is_test ? 'TEST — ' : '';
        downloadCsv(`${filenamePrefix}${sanitizeFilename(data.event.name)} report.csv`, marked);
      } catch (err) {
        showActionError(describeError(err));
      }
    });

    const printButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Print / Save as PDF',
    });
    printButton.addEventListener('click', () => {
      try {
        window.print();
      } catch (err) {
        showActionError(describeError(err));
      }
    });

    return el('div', { className: 'card report-actions no-print' }, [
      csvButton,
      printButton,
      feedback,
    ]);
  }

  function renderReport(data) {
    root.innerHTML = '';
    const container = el('section', { className: 'screen-container report-screen' });

    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(el('h1', { text: `Report — ${data.event.name}` }));

    if (!data.complete) {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: 'The report is not available yet — it surfaces once the competition is fully complete (the champion has been declared).',
          }),
        ]),
      );
    } else {
      container.appendChild(renderExportActions(data));
      // Only once there's more than one stage — see buildReportTables' own
      // comment for why a single-stage event skips this (it would just
      // duplicate that one stage's already-shown standings).
      if (data.stageReports.length > 1) {
        const summaries = computeEventSummary(data.stageReports);
        container.appendChild(
          renderRoundBarChart({
            titleText: 'Score by Round',
            ariaSummary:
              'Bar chart: each cupper’s correct count per round. See the table below for exact values.',
            summaries,
            stageReports: data.stageReports,
            getValue: (round) => round.numCorrect,
            formatValue: (value) => String(value),
          }),
        );
        container.appendChild(
          renderRoundBarChart({
            titleText: 'Time by Round',
            ariaSummary:
              'Bar chart: each cupper’s total time per round. See the table below for exact values.',
            summaries,
            stageReports: data.stageReports,
            getValue: (round) => round.totalElapsedSecs,
            formatValue: (value) => formatDuration(value),
          }),
        );
        container.appendChild(
          el('div', { className: 'card report-stage-card' }, [
            el('h2', { text: 'Overall — All Rounds' }),
            renderEventSummaryTable(summaries, data.stageReports),
          ]),
        );
      }
      const roundLabels = stageRoundLabels(data.stageReports);
      for (const stageReport of data.stageReports) {
        container.appendChild(
          renderStageSection(stageReport, roundLabels.get(stageReport.stage.ordinal)),
        );
      }
    }

    root.appendChild(container);
  }

  async function render() {
    renderLoading();
    try {
      const data = await loadState();
      // A discarded-but-still-in-flight load (this render's own loadState()
      // still resolving after the router already navigated elsewhere) must
      // never write to `root` again — router.js aborts `signal` the
      // instant a newer navigation starts. See ROADMAP.md's "A real
      // DOM-write race between the router..." entry.
      if (signal?.aborted) return;
      renderReport(data);
    } catch (err) {
      if (signal?.aborted) return;
      renderError(describeError(err));
    }
  }

  await render();

  return {
    unmount() {
      // No live state, no listeners, no timers — nothing to tear down.
    },
  };
}
