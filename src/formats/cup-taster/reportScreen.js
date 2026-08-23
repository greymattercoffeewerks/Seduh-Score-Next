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
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { buildCsvForTables, downloadCsv } from '../../core/export.js';
import { listStagesForEvent } from './setup.js';
import { isEventComplete, computeStageReport } from './analytics.js';

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

function renderStageStandingsTable(ranked) {
  const rows = ranked.map(({ item, position }) =>
    el('tr', { className: 'standings-row' }, [
      el('td', { text: String(position), attrs: { 'data-label': 'Pos' } }),
      el('td', { text: item.displayName, attrs: { 'data-label': 'Cupper' } }),
      el('td', { text: String(item.numCorrect), attrs: { 'data-label': 'Correct' } }),
      el('td', {
        text: item.total_elapsed_secs == null ? '—' : `${item.total_elapsed_secs}s`,
        attrs: { 'data-label': 'Time' },
      }),
      el('td', { text: describeOutcome(item), attrs: { 'data-label': 'Outcome' } }),
    ]),
  );
  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Pos' }),
        el('th', { text: 'Cupper' }),
        el('th', { text: 'Correct' }),
        el('th', { text: 'Time' }),
        el('th', { text: 'Outcome' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

function renderDifficultyTable(difficulty) {
  const rows = difficulty.map((set) =>
    el('tr', { className: 'standings-row' }, [
      el('td', {
        text: set.label ?? `Set ${set.position}`,
        attrs: { 'data-label': 'Set' },
      }),
      el('td', {
        text: set.avgCorrect == null ? 'No data' : `${Math.round(set.avgCorrect * 100)}%`,
        attrs: { 'data-label': 'Correct' },
      }),
      el('td', { text: String(set.sampleSize), attrs: { 'data-label': 'Cuppers scored' } }),
    ]),
  );
  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Set' }),
        el('th', { text: 'Correct' }),
        el('th', { text: 'Cuppers scored' }),
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
      el('tr', {}, [el('th', { text: 'Correct answers' }), el('th', { text: 'Cuppers' })]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// Pure. One stage's report -> the three table specs core/export.js needs,
// mirroring the exact formatting each on-screen table above uses (the same
// "Xs" time suffix, the same "No data"/percentage difficulty text, the same
// describeOutcome call) — so the CSV a cupper opens says the same thing the
// organiser saw on screen, not a second, independently-formatted view of
// the same numbers.
function buildStageTables(stageReport) {
  const { stage, ranked, difficulty, distribution } = stageReport;
  return [
    {
      title: `${stage.kind} — Standings`,
      columns: [
        { key: 'position', label: 'Pos' },
        { key: 'displayName', label: 'Cupper' },
        { key: 'numCorrect', label: 'Correct' },
        { key: 'time', label: 'Time' },
        { key: 'outcome', label: 'Outcome' },
      ],
      rows: ranked.map(({ item, position }) => ({
        position,
        displayName: item.displayName,
        numCorrect: item.numCorrect,
        time: item.total_elapsed_secs == null ? '' : `${item.total_elapsed_secs}s`,
        outcome: describeOutcome(item),
      })),
    },
    {
      title: `${stage.kind} — Set difficulty`,
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
      title: `${stage.kind} — Score distribution`,
      columns: [
        { key: 'correctCount', label: 'Correct answers' },
        { key: 'numCuppers', label: 'Cuppers' },
      ],
      rows: distribution,
    },
  ];
}

// Pure. Every stage's tables, in order — the whole report as one flat list
// of table specs, ready for core/export.js's buildCsvForTables.
export function buildReportTables(stageReports) {
  return stageReports.flatMap(buildStageTables);
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

// Every heading includes the stage's own kind — found in review: two
// complete stages (e.g. prelims and finals) each produce an identically-
// worded "Set difficulty"/"Score distribution" <h3> with nothing to tell
// them apart in a screen reader's flat headings list (NVDA's Elements List,
// VoiceOver's Rotor, JAWS's headings list — all common navigation modes,
// not just reading top-to-bottom, where the preceding <h2> alone would be
// enough context).
function renderStageSection(stageReport) {
  const { stage, ranked, difficulty, distribution } = stageReport;
  return el('div', { className: 'card report-stage-card' }, [
    el('h2', { text: stage.kind }),
    renderStageStandingsTable(ranked),
    el('h3', { text: `Set difficulty — ${stage.kind}` }),
    renderDifficultyTable(difficulty),
    el('h3', { text: `Score distribution — ${stage.kind}` }),
    renderDistributionTable(distribution),
  ]);
}

export async function mountReportScreen(root, { eventId, client = getSupabase() } = {}) {
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
      for (const stageReport of data.stageReports) {
        container.appendChild(renderStageSection(stageReport));
      }
    }

    root.appendChild(container);
  }

  async function render() {
    renderLoading();
    try {
      const data = await loadState();
      renderReport(data);
    } catch (err) {
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
