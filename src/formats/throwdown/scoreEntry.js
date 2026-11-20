// The console's card for a match decided by scoresheets: "Sheets in: n of m", a judge seat x competitor grid, the paper
// sheet a scorekeeper types in, and the confirm step with the winner rule. Scores stay on this screen: nothing here is
// published (the live payload never reads sheets).
//
// The card is built by a factory so the screen keeps its own state, busy handling and outbox wiring (eventScreen.js).
// A sheet is saved only when COMPLETE (every line of every cup a whole number 0..max); saving again replaces it until
// the match is confirmed.
import { el } from '../../core/dom.js';
import { cupTotal, cupMax, validateSheet } from '../../core/scoresheet.js';
import { saveScoreSheet, confirmScoredMatch } from './data.js';
import { scoredView, parseDraft, draftFromSheet } from './scoredMatch.js';
import { matchTitle, ruleWords } from './words.js';

export function createScoreEntry({
  state,
  button,
  act,
  tapAct,
  handlers,
  render,
  scoringContext,
  walkoverRow,
}) {
  const open = (match) => (state.sheetOpen?.matchId === match.id ? state.sheetOpen : null);

  function sheetForm(match, view, seat, side) {
    const o = open(match);
    const { lines, cups } = view;
    const max = cupMax(lines);
    const totals = [];
    const inputs = [];
    const refreshTotals = () => {
      const { sheet, complete } = parseDraft(o.draft, view);
      totals.forEach((node, i) => {
        const cup = i + 1;
        node.textContent = `Cup ${cup} total: ${cupTotal(sheet[cup])} of ${max}`;
      });
      if (complete && validateSheet(sheet, view).ok) formError.textContent = '';
    };
    // Save stays pressable: a sheet that is not complete says exactly what is missing, next to the button
    const formError = el('p', { className: 'td-sheet-error', attrs: { role: 'alert' } });
    const sections = Array.from({ length: cups }, (_, i) => {
      const cup = i + 1;
      const total = el('p', {
        className: 'td-cup-total',
      });
      totals.push(total);
      const rows = lines.map((line) => {
        const id = `td-sheet-${match.id}-${cup}-${line.key}`;
        const input = el('input', {
          className: 'field-input td-points',
          attrs: {
            id,
            'aria-label': `Cup ${cup}, ${line.label}, 0 to ${line.max}`,
            type: 'text',
            inputmode: 'numeric',
            pattern: '[0-9]*',
            autocomplete: 'off',
            maxlength: '2',
            value: o.draft[cup][line.key],
            'data-focus-key': id,
          },
        });
        const hint = el('span', { className: 'td-points-max', text: `0 to ${line.max}` });
        const problem = el('span', { className: 'td-points-problem', attrs: { role: 'status' } });
        input.addEventListener('input', () => {
          o.draft[cup][line.key] = input.value;
          const text = input.value.trim();
          const bad = text !== '' && (!/^\d{1,2}$/.test(text) || Number(text) > line.max);
          input.setAttribute('aria-invalid', bad ? 'true' : 'false');
          problem.textContent = bad ? `Enter a whole number from 0 to ${line.max}.` : '';
          refreshTotals();
        });
        inputs.push({ input, line });
        return el('div', { className: 'td-sheet-line' }, [
          el('label', { className: 'td-sheet-label', attrs: { for: id }, text: line.label }),
          hint,
          input,
          problem,
        ]);
      });
      return el('fieldset', { className: 'td-sheet-cup' }, [
        el('legend', { text: `Cup ${cup}` }),
        ...rows,
        total,
      ]);
    });
    const save = button(
      'Save sheet',
      () => {
        if (state.deciding) return;
        const { sheet, complete } = parseDraft(o.draft, view);
        const overMax = complete && !validateSheet(sheet, view).ok;
        if (!complete || overMax) {
          const bad = inputs.filter(({ input, line }) => {
            const text = input.value.trim();
            return !/^\d{1,2}$/.test(text) || Number(text) > line.max;
          });
          for (const { input } of bad) input.setAttribute('aria-invalid', 'true');
          formError.textContent = `${bad.length} ${bad.length === 1 ? 'line is' : 'lines are'} blank or out of range. Every line needs a whole number inside its range before the sheet can be saved.`;
          bad[0]?.input.focus();
          return;
        }
        const slotId = side.slotId;
        state.sheetOpen = null;
        state.picks.delete(match.id);
        state.focusTarget = `td-grid-${match.id}-${seat}-${side.key}`;
        tapAct(
          () =>
            saveScoreSheet(
              { orgId: state.event.org_id, matchId: match.id, slotId, seat, sheet },
              handlers,
            ),
          `Judge ${seat} sheet for ${side.name} saved.`,
        );
        render();
      },
      {
        className: 'btn btn-primary tap-target',
        key: `td-sheet-save-${match.id}`,
        ignoreBusy: true,
      },
    );
    const cancel = button(
      'Close without saving',
      () => {
        state.sheetOpen = null;
        state.focusTarget = `td-grid-${match.id}-${seat}-${side.key}`;
        render();
      },
      { key: `td-sheet-cancel-${match.id}` },
    );
    // totals and the Save state follow the draft from the first paint
    queueMicrotask(refreshTotals);
    return el(
      'form',
      {
        className: 'td-sheet',
        attrs: { 'aria-label': `Judge ${seat} sheet for ${side.name}`, novalidate: '' },
      },
      [
        el('h4', {
          id: `td-sheet-h-${match.id}`,
          attrs: { tabindex: '-1' },
          text: `Judge ${seat}: ${side.name}`,
        }),
        el('p', {
          className: 'td-note',
          text: `Copy each line from the paper sheet. Check each cup total against the judge’s red total box.`,
        }),
        ...sections,
        formError,
        el('div', { className: 'td-sheet-actions' }, [save, cancel]),
      ],
    );
  }

  function grid(match, view, decisionQueued) {
    const items = Array.from({ length: view.judgeCount }, (_, i) => {
      const seat = i + 1;
      const buttons = view.competitors.map((c) => {
        const missing = view.progress.missing.some((m) => m.key === c.key && m.seat === seat);
        const queued = state.pending.get(match.id)?.sheets.has(`${c.slotId}:${seat}`);
        const status = missing ? 'missing' : queued ? 'in, waiting to sync' : 'in';
        const gridButton = button(
          `${c.name}: ${status}`,
          () => {
            state.sheetOpen = {
              matchId: match.id,
              slotId: c.slotId,
              seat,
              draft: draftFromSheet(c.sheets[seat], view),
            };
            state.focusTarget = `td-sheet-h-${match.id}`;
            render();
          },
          {
            className: `btn ${missing ? 'btn-outline' : 'btn-primary'} tap-target td-grid-btn`,
            key: `td-grid-${match.id}-${seat}-${c.key}`,
            disabled: decisionQueued || state.deciding,
            ignoreBusy: true,
          },
        );
        gridButton.id = `td-grid-${match.id}-${seat}-${c.key}`;
        return gridButton;
      });
      return el('li', { className: 'td-grid-row' }, [
        el('span', { className: 'td-grid-seat', text: `Judge ${seat}` }),
        ...buttons,
      ]);
    });
    return el(
      'ul',
      { className: 'td-grid', attrs: { 'aria-label': 'Scoresheets by judge' } },
      items,
    );
  }

  function confirmArea(match, view, decisionQueued) {
    const out = [];
    const nameOf = (position) => view.competitors.find((c) => c.key === position)?.name;
    if (!view.progress.complete) {
      out.push(
        el('p', {
          className: 'td-note',
          text: 'Enter every judge’s sheet for both competitors to confirm.',
        }),
      );
      out.push(
        button('Confirm result', () => {}, {
          className: 'btn btn-primary tap-target',
          key: `td-confirm-${match.id}`,
          disabled: true,
        }),
      );
      return out;
    }
    const d = view.decision;
    const [a, b] = view.competitors;
    out.push(
      el('p', {
        className: 'td-note',
        text: `Totals: ${a.name} ${d.totals[0]}, ${b.name} ${d.totals[1]}.`,
      }),
    );
    let pickPosition = null;
    if (d.winner !== null) {
      out.push(
        el('p', {
          className: 'td-note',
          text: `${nameOf(d.winner)} wins on ${ruleWords(d.rule)}.`,
        }),
      );
    } else {
      pickPosition = state.picks.get(match.id) ?? null;
      out.push(
        el('p', {
          className: 'td-note',
          text: 'The sheets are level on points and on judges. You choose the winner; it is recorded as your decision.',
        }),
      );
      out.push(
        el('fieldset', { className: 'td-choice-group' }, [
          el('legend', { text: 'Winner (your decision)' }),
          ...view.competitors.map((c) => {
            const input = el('input', {
              attrs: {
                type: 'radio',
                name: `td-pick-${match.id}`,
                value: String(c.key),
                'data-focus-key': `td-pick-${match.id}-${c.key}`,
              },
            });
            input.checked = pickPosition === c.key;
            input.disabled = decisionQueued;
            input.addEventListener('change', () => {
              state.picks.set(match.id, c.key);
              render();
            });
            return el('label', { className: 'td-choice' }, [
              input,
              document.createTextNode(` ${c.name}`),
            ]);
          }),
        ]),
      );
    }
    const winnerPosition = d.winner ?? pickPosition;
    const confirmBtn = button(
      winnerPosition !== null ? `Confirm: ${nameOf(winnerPosition)} wins` : 'Confirm result',
      () =>
        act(
          () =>
            confirmScoredMatch(
              {
                orgId: state.event.org_id,
                matchId: match.id,
                expectedWinnerPosition: d.winner,
                organiserPick: d.winner === null ? pickPosition : null,
              },
              handlers,
            ),
          { publish: true },
        ),
      {
        className: 'btn btn-primary tap-target',
        key: `td-confirm-${match.id}`,
        disabled: decisionQueued || winnerPosition === null,
      },
    );
    out.push(confirmBtn);
    return out;
  }

  // The card for one playable scored match. `view` is scoredView(...) for it.
  function scoredCard(match) {
    const ctx = scoringContext();
    const pendingEntry = state.pending.get(match.id);
    const decisionQueued = pendingEntry?.decisionQueued ?? false;
    const view = scoredView(ctx, match, pendingEntry?.sheets);
    const o = open(match);
    const side = o ? view.competitors.find((c) => c.slotId === o.slotId) : null;
    const queuedSheets = pendingEntry?.sheets.size ?? 0;
    const status = decisionQueued
      ? 'The result is waiting to sync. Sheets are closed for this match.'
      : `Sheets in: ${view.progress.done} of ${view.progress.total}`;
    return el(
      'article',
      { className: 'card td-match td-scored', attrs: { 'aria-label': matchTitle(match) } },
      [
        el('h3', { text: matchTitle(match) }),
        el('p', {
          className: 'td-note',
          text: `Decided by scoresheets: ${view.cups} ${view.cups === 1 ? 'cup' : 'cups'} each.`,
        }),
        el('p', {
          className: 'td-sheets-count',
          text:
            status + (queuedSheets && !decisionQueued ? ` ${queuedSheets} waiting to sync.` : ''),
        }),
        o && side ? sheetForm(match, view, o.seat, side) : grid(match, view, decisionQueued),
        ...(o ? [] : confirmArea(match, view, decisionQueued)),
        ...(o ? [] : [walkoverRow(match, decisionQueued)]),
      ],
    );
  }

  return { scoredCard };
}
