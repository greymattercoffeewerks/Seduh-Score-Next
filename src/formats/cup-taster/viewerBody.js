// Cup Taster viewer body (handoff §14 T5.4, listed in the module table as
// "Standings + heat status, mounted into viewer-shell"). This is the
// content `core/viewer-shell.js`'s own `renderBody` callback plugs in once
// a `live_sessions` row has real content — a standings table for the
// current stage, an active-heat panel (status + per-cupper chips), and a
// short list of recently completed heats. Shared by both T5.3 (projector)
// and T5.4 (phone) — T5.3 reuses this module unedited, per handoff. Ported
// from the shape v4.x's own `rAudienceLbHTML`/`rAudienceHeatHTML`
// established (that app's Cup Taster audience view was only ever an
// operator-device overlay, never a standalone live surface — the content
// SHAPE carries over, nothing about how it was delivered does).
//
// `live_sessions.payload`'s shape is this module's own contract — nothing
// else in this codebase builds this payload yet; that's real-data wiring,
// deliberately out of this task's scope (matching T5.1/T5.2's own
// logic/shell-only precedent):
//
// {
//   stage: null | { kind: 'prelims'|'semis'|'finals', ordinal, setCount },
//   standings: [{ position, displayName, numCorrect, totalElapsedSecs,
//                 tieStatus: null | 'tied' | 'advancing' }],
//   activeHeat: null | {
//     heatNumber, stageKind, status: 'timing'|'scoring',
//     timingMode: 'app'|'manual', startedAt: <ISO string>|null, durationSecs,
//     cuppers: [{ displayName, station, totalElapsedSecs, maxed }],
//   },
//   recentHeats: [{ heatNumber, stageKind, results: [{ displayName, numCorrect, totalElapsedSecs }] }],
// }
//
// camelCase throughout, deliberately — a JSON wire payload built for this
// viewer, not a raw DB row shape, so it isn't tied to any particular
// table's own column naming (standings.js's `numCorrect`/
// `total_elapsed_secs` split, for one, doesn't need to survive the trip).
// `totalElapsedSecs` everywhere a duration appears (the per-cupper active-
// heat/recent-heat fields included, not just the stage-standings one) —
// matches `standings.js`'s own `total_elapsed_secs` naming (this is just its
// camelCase wire-payload form). This module's own code only ever reads these
// fields via member access, which `no-raw-elapsed-write` doesn't flag; a
// bare `elapsedSecs` would only trip the rule in the TEST fixtures' object
// literals (`{ elapsedSecs: 240 }`) — the same situation eslint.config.js
// already exempts other test files for — so this naming choice is about
// matching the DB-shape precedent, not dodging lint. These values are
// always read-only display copies of an already-clamped
// `ct_heat_entries.elapsed_secs`, never a second write path for one.
import { el } from '../../core/dom.js';
import { chainComparators } from '../../core/ranking.js';

// The `hasContent` predicate viewer-shell.js's inversion-of-control
// contract calls for — whether THIS payload counts as real content is a
// Cup-Taster-specific question core/ can't answer on its own (see
// viewer-shell.js's own module comment). Standings alone or an active heat
// alone both count; an empty stage descriptor with neither does not.
export function hasViewableContent(payload) {
  return Boolean(payload?.standings?.length > 0 || payload?.activeHeat);
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function formatElapsed(secs) {
  return secs == null ? '—' : `${secs}s`;
}

function renderStandingsTable(stage, standings) {
  if (standings.length === 0) {
    return el('p', { className: 'stage-meta', text: 'No scores yet.' });
  }

  const rows = standings.map((row) => {
    // Text-carried, not color-alone (matches the cupper-chip convention
    // above): standingsScreen.css's `.standings-row[data-status]` already
    // styles these two states by color, but that alone isn't a signal for
    // anyone who can't distinguish it, so the label carries the word too.
    const statusSuffix =
      row.tieStatus === 'tied' ? ' (tied)' : row.tieStatus === 'advancing' ? ' (advancing)' : '';
    return el(
      'tr',
      { className: 'standings-row', attrs: row.tieStatus ? { 'data-status': row.tieStatus } : {} },
      [
        el('td', { text: String(row.position), attrs: { 'data-label': 'Pos' } }),
        el('td', { text: row.displayName + statusSuffix, attrs: { 'data-label': 'Cupper' } }),
        el('td', {
          // `stage` can be absent (see mountViewerBody) — fall back to a
          // bare count rather than crashing or showing "N/undefined".
          text:
            stage?.setCount != null
              ? `${row.numCorrect}/${stage.setCount}`
              : String(row.numCorrect),
          attrs: { 'data-label': 'Correct' },
        }),
        el('td', { text: formatElapsed(row.totalElapsedSecs), attrs: { 'data-label': 'Time' } }),
      ],
    );
  });

  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Pos' }),
        el('th', { text: 'Cupper' }),
        el('th', { text: 'Correct' }),
        el('th', { text: 'Time' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

// `maxed` must be checked before `totalElapsedSecs` — a maxed cupper's
// totalElapsedSecs is set to the duration cap (a real number, not null; see
// core/timeclamp.js's clampElapsed()), so checking `done` first would
// misreport every maxed cupper as done.
function cupperStatus(cupper) {
  if (cupper.maxed) return 'maxed';
  if (cupper.totalElapsedSecs != null) return 'done';
  return 'running';
}

// All three states are text-carried, not color-alone — including "running",
// the unstyled default, which previously had no non-color signal at all.
function cupperChip(cupper) {
  const status = cupperStatus(cupper);
  const label = cupper.station ? `${cupper.displayName} · ${cupper.station}` : cupper.displayName;
  const suffix = status === 'done' ? ' ✓ (done)' : status === 'maxed' ? ' (max)' : ' (timing)';
  return el('li', {
    className: 'viewer-heat-chip',
    attrs: { 'data-status': status },
    text: label + suffix,
  });
}

// §8.2's own defined no-clock state: a manual heat with no `started_at` has
// no timer to show at all — cupper names/station/finished-or-not only,
// never a blank or zeroed countdown standing in for one. Exported for
// direct testing since the AC names this state specifically.
export function isNoClockHeat(activeHeat) {
  return activeHeat.timingMode === 'manual' && !activeHeat.startedAt;
}

function renderActiveHeat(activeHeat) {
  const noClock = isNoClockHeat(activeHeat);
  // A no-clock heat's own heading must not say "Timing…" — that reads as a
  // running clock right above the "not yet started" message contradicting
  // it, which is exactly the "zeroed timer instead of a defined no-clock
  // state" failure this AC exists to prevent.
  const statusLabel = noClock
    ? 'Not started'
    : activeHeat.status === 'timing'
      ? 'Timing…'
      : 'Scoring…';
  const heading = `${capitalize(activeHeat.stageKind)} · Heat ${activeHeat.heatNumber} — ${statusLabel}`;

  const children = [el('h3', { text: heading })];
  if (noClock) {
    children.push(el('p', { className: 'stage-meta', text: 'Manual heat — not yet started.' }));
  }
  children.push(el('ul', { className: 'viewer-heat-chips' }, activeHeat.cuppers.map(cupperChip)));

  return el('div', { className: 'card viewer-active-heat' }, children);
}

// Reuses core/ranking.js's own combinator rather than a hand-rolled `||`
// chain — matches the module-boundary rule this project enforces
// (formats/* must not reimplement a core/ primitive).
const byMostCorrect = (a, b) => b.numCorrect - a.numCorrect;
const byFastestTime = (a, b) => (a.totalElapsedSecs ?? Infinity) - (b.totalElapsedSecs ?? Infinity);
const compareRecentHeatResults = chainComparators(byMostCorrect, byFastestTime);

function renderRecentHeat(heat) {
  const sorted = [...heat.results].sort(compareRecentHeatResults);
  const rows = sorted.map((r) =>
    el('li', { text: `${r.displayName} — ${r.numCorrect} (${formatElapsed(r.totalElapsedSecs)})` }),
  );
  return el('div', { className: 'viewer-recent-heat' }, [
    el('p', {
      className: 'stage-meta',
      text: `${capitalize(heat.stageKind)} · Heat ${heat.heatNumber}`,
    }),
    el('ul', { className: 'viewer-recent-heat-list' }, rows),
  ]);
}

function renderRecentHeats(recentHeats) {
  if (!recentHeats || recentHeats.length === 0) return null;
  return el('div', { className: 'viewer-recent-heats' }, [
    el('h3', { text: 'Recent results' }),
    ...recentHeats.map(renderRecentHeat),
  ]);
}

// The renderBody callback viewer-shell.js's mountViewerShell calls once
// hasViewableContent(payload) is true. Pure DOM construction, no I/O — the
// payload is everything this function needs. viewer-shell.js also passes a
// third `{ isTest }` argument; deliberately not declared/consumed here — the
// shell's own role="alert" banner already renders is_test unmistakably
// (D9), so this module doesn't need a second treatment of it.
export function mountViewerBody(container, payload) {
  const sections = [];
  // Standings can arrive without a `stage` descriptor (see the payload-shape
  // comment above) — render the table on its own rather than silently
  // dropping real standings data, which would leave the shell's "Live"
  // chrome over a blank body.
  if (payload.stage || (payload.standings?.length ?? 0) > 0) {
    const heading = payload.stage
      ? el('h2', { text: `${capitalize(payload.stage.kind)} standings` })
      : null;
    sections.push(
      ...(heading ? [heading] : []),
      renderStandingsTable(payload.stage ?? null, payload.standings ?? []),
    );
  }
  if (payload.activeHeat) {
    sections.push(renderActiveHeat(payload.activeHeat));
  }
  const recent = renderRecentHeats(payload.recentHeats);
  if (recent) sections.push(recent);

  container.append(...sections);
}
