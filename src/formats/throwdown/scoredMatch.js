// What one scored match looks like to the console: the rows the database holds, joined with the sheets still waiting in
// the outbox, turned into the progress, the totals and the winner rule. Pure: it uses src/core/scoresheet.js for every
// number and keeps nothing. Nothing here is ever sent to a public surface (the live payload never reads it).
import {
  sheetsProgress,
  decideScored,
  grandTotals,
  judgeTotal,
  cupTotal,
} from '../../core/scoresheet.js';
import { scoredCups } from './roundRole.js';

// Everything the console needs about the module for this event, or null when the module is off (so nothing is drawn).
export function scoringContext(data) {
  const config = data?.settings?.modules?.scoresheet;
  if (!config) return null;
  const sheetsBySlot = new Map();
  for (const row of data.scoreSheets ?? []) {
    const bySeat = sheetsBySlot.get(row.slot_id) ?? new Map();
    const sheet = bySeat.get(row.judge_seat) ?? {};
    (sheet[row.cup] ??= {})[row.line_key] = row.points;
    bySeat.set(row.judge_seat, sheet);
    sheetsBySlot.set(row.slot_id, bySeat);
  }
  const picks = new Map((data.scoreDecisions ?? []).map((d) => [d.match_id, d.winner_position]));
  return { config, judgeCount: data.settings.judge_count, sheetsBySlot, picks };
}

// Cups per competitor for this match, or null when it is decided by taps.
export function cupsForMatch(ctx, match) {
  return ctx ? scoredCups(ctx.config, match.roundPhase, match.roundSize) : null;
}

// pending: Map("<slotId>:<seat>" -> sheet), the queued saves for this match (they replace the saved sheet).
export function scoredView(ctx, match, pending = new Map()) {
  const cups = cupsForMatch(ctx, match);
  if (cups === null) return null;
  const lines = ctx.config.lines;
  const filled = match.sides.filter((s) => s.entryId);
  const competitors = filled.map((side) => {
    const sheets = {};
    for (const [seat, sheet] of ctx.sheetsBySlot.get(side.slotId) ?? []) sheets[seat] = sheet;
    for (let seat = 1; seat <= ctx.judgeCount; seat += 1) {
      const queued = pending.get(`${side.slotId}:${seat}`);
      if (queued) sheets[seat] = queued;
    }
    return { key: side.position, slotId: side.slotId, name: side.name, sheets };
  });
  const progress = sheetsProgress(competitors, { judgeCount: ctx.judgeCount, lines, cups });
  const decision = progress.complete && competitors.length === 2 ? decideScored(competitors) : null;
  const pick = ctx.picks.get(match.id) ?? null;
  return {
    cups,
    lines,
    judgeCount: ctx.judgeCount,
    competitors,
    progress,
    decision,
    pick,
    totals: grandTotals(competitors),
  };
}

// The winner and the rule for a decided scored match (the audit view): the database's winner is the bracket's; the rule is
// recomputed from the sheets, or 'organiser' when a pick was recorded.
export function auditRule(view) {
  if (view.pick !== null) return 'organiser';
  return view.decision?.rule ?? null;
}

// One competitor's numbers for the audit: per judge seat, per cup, per line, with cup and judge totals.
export function auditRows(view) {
  return view.competitors.map((c) => ({
    name: c.name,
    total: view.totals.find((t) => t.key === c.key)?.total ?? 0,
    judges: Array.from({ length: view.judgeCount }, (_, i) => {
      const seat = i + 1;
      const sheet = c.sheets[seat];
      return {
        seat,
        sheet: sheet ?? null,
        total: sheet ? judgeTotal(sheet) : null,
        cupTotals: sheet
          ? Object.fromEntries(Object.entries(sheet).map(([cup, v]) => [cup, cupTotal(v)]))
          : {},
      };
    }),
  }));
}

// A draft the scorekeeper is typing: { "<cup>": { "<line>": "<text>" } } -> the sheet it means, or null for any blank
// or non-whole entry (only digits count; "2.0", "-1", " " are not points).
export function parseDraft(draft, { lines, cups }) {
  const sheet = {};
  let complete = true;
  for (let cup = 1; cup <= cups; cup += 1) {
    sheet[cup] = {};
    for (const line of lines) {
      const text = String(draft?.[cup]?.[line.key] ?? '').trim();
      if (/^\d{1,2}$/.test(text)) sheet[cup][line.key] = Number(text);
      else complete = false;
    }
  }
  return { sheet, complete };
}

export function draftFromSheet(sheet, { lines, cups }) {
  const draft = {};
  for (let cup = 1; cup <= cups; cup += 1) {
    draft[cup] = {};
    for (const line of lines) {
      const v = sheet?.[cup]?.[line.key];
      draft[cup][line.key] = v === undefined ? '' : String(v);
    }
  }
  return draft;
}
