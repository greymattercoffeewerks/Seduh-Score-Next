// The "Draw a round" panel (Build B part 2; spec 4.3): builds the DOM from state and calls back on every action. It
// holds no state and decides nothing about who plays whom; drawPlan.js (and draw.js under it) do, matchesScreen.js owns
// the state and the one call that writes. Built like the rest of this screen: data-field / data-focus-key on every
// control so a rebuild keeps focus, role="alert" + aria-describedby for the error, a card list (not a table) at 360px.
import { el, labeledField, setBusyDisabled } from '../../core/dom.js';
import { teamLabel } from './words.js';
import { drawIssues } from './drawPlan.js';

const ERROR_ID = 'btc-draw-error';
const HELP_ID = 'btc-draw-create-help';

function radio({ name, field, value, checked, label, busy, onChange }) {
  const input = el('input', { attrs: { type: 'radio', name, value, 'data-field': field } });
  input.checked = checked;
  setBusyDisabled(input, busy);
  input.addEventListener('change', () => {
    if (input.checked) onChange(value);
  });
  return el('label', { className: 'btc-draw-choice' }, [input, el('span', { text: label })]);
}

// ctx: { state, teams, judges, statusOf(round), busy, on: { round, mode, seed, newSeed, avoid, swap, judge, tick, create } }
// state: { round, round2Mode, seedInput, avoid, draw, refusal, swapPick, status, error }
export function renderDrawPanel(ctx) {
  const { state, teams, judges, busy, on } = ctx;
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (id) => (teamById.has(id) ? teamLabel(teamById.get(id)) : 'Unknown team');
  const status = ctx.statusOf(state.round);

  const roundGroup = el('fieldset', { className: 'btc-draw-group' }, [
    el('legend', { text: 'Round' }),
    el('div', { className: 'btc-draw-choices' }, [
      radio({
        name: 'btc-draw-round',
        field: 'draw-round-1',
        value: 1,
        checked: state.round === 1,
        label: 'Round 1 (random)',
        busy,
        onChange: on.round,
      }),
      radio({
        name: 'btc-draw-round',
        field: 'draw-round-2',
        value: 2,
        checked: state.round === 2,
        label: 'Round 2',
        busy,
        onChange: on.round,
      }),
    ]),
  ]);

  // A refused create is shown whatever the panel looks like afterwards (a reload can leave no preview at all).
  const errorNode = state.error
    ? el('p', {
        id: ERROR_ID,
        className: 'btc-field-error',
        text: state.error,
        // role=alert only the first time it is drawn: every action rebuilds the page, and a rebuilt alert node is
        // announced again, so a later swap or tick would repeat the same error
        attrs: state.errorFresh ? { role: 'alert' } : {},
      })
    : null;
  const nodes = [roundGroup];

  if (state.round === 2) {
    nodes.push(
      el('fieldset', { className: 'btc-draw-group' }, [
        el('legend', { text: 'How to draw round 2' }),
        el('div', { className: 'btc-draw-choices' }, [
          radio({
            name: 'btc-draw-mode',
            field: 'draw-mode-random',
            value: 'random',
            checked: state.round2Mode === 'random',
            label: 'Random',
            busy,
            onChange: on.mode,
          }),
          radio({
            name: 'btc-draw-mode',
            field: 'draw-mode-by-results',
            value: 'by_results',
            checked: state.round2Mode === 'by_results',
            label: 'By round 1 results: strongest against weakest',
            busy,
            onChange: on.mode,
          }),
        ]),
      ]),
    );
    const avoid = el('input', { attrs: { type: 'checkbox', 'data-field': 'draw-avoid' } });
    avoid.checked = state.avoid;
    setBusyDisabled(avoid, busy);
    avoid.addEventListener('change', () => on.avoid(avoid.checked));
    nodes.push(
      el('label', { className: 'btc-draw-choice' }, [
        avoid,
        el('span', { text: 'Avoid repeat opponents' }),
      ]),
    );
  }

  if (!status.available) {
    nodes.push(
      el('p', { className: 'btc-draw-warning', text: status.reason, attrs: { role: 'status' } }),
    );
    if (errorNode) nodes.push(errorNode);
    return wrap(nodes);
  }

  // ---- seed
  const seedInput = el('input', {
    className: 'field-input',
    attrs: {
      type: 'text',
      'aria-label': 'Seed',
      'data-field': 'draw-seed',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    },
  });
  seedInput.value = state.seedInput;
  seedInput.addEventListener('input', () => on.typing(seedInput.value));
  setBusyDisabled(seedInput, busy);
  const useSeed = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'Use this seed',
    attrs: { type: 'button', 'data-focus-key': 'draw-use-seed' },
  });
  const newSeed = el('button', {
    className: 'btn btn-outline tap-target',
    text: 'New seed',
    attrs: { type: 'button', 'data-focus-key': 'draw-new-seed' },
  });
  setBusyDisabled(useSeed, busy);
  setBusyDisabled(newSeed, busy);
  newSeed.addEventListener('click', () => on.newSeed());
  // a row, not a <form>: typing then pressing New seed must not rebuild the page between the two taps, so nothing
  // commits on blur; Enter and "Use this seed" do
  const seedForm = el('div', { className: 'btc-draw-seed' }, [
    labeledField('Seed', seedInput),
    el('div', { className: 'btc-match-actions' }, [useSeed, newSeed]),
  ]);
  useSeed.addEventListener('click', () => on.seed(seedInput.value));
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      on.seed(seedInput.value);
    }
  });
  nodes.push(seedForm);
  const draw = state.draw;
  nodes.push(
    el('p', {
      className: 'stage-meta',
      text: draw?.manual
        ? 'Changed by hand: no seed is recorded for this draw. Using a seed or a new seed draws it again and drops your changes.'
        : 'The same seed and the same teams always give the same draw. Type a seed to repeat an earlier draw.',
    }),
  );

  // a live region that is always present, so what an action did is announced
  nodes.push(
    el('p', {
      className: 'stage-meta btc-draw-status',
      text: state.status ?? '',
      attrs: { role: 'status', 'aria-live': 'polite' },
    }),
  );

  if (state.refusal) {
    nodes.push(
      el('p', { className: 'btc-draw-warning', text: state.refusal, attrs: { role: 'status' } }),
    );
    if (errorNode) nodes.push(errorNode);
    return wrap(nodes);
  }
  if (!draw) {
    if (errorNode) nodes.push(errorNode);
    return wrap(nodes);
  }

  // ---- warnings
  const issues = drawIssues(draw, { teams, judges });
  const blockedConflicts = issues.byMatch.filter(
    (m, i) => m.conflicts.length > 0 && !draw.ticks[i],
  );
  const warnings = [];
  for (const w of draw.warnings) {
    warnings.push(
      el('p', {
        className: 'btc-draw-warning',
        text: w.code === 'same_country' ? `For information: ${w.message}` : w.message,
      }),
    );
  }
  if (blockedConflicts.length > 0) {
    warnings.push(
      el('p', {
        className: 'btc-draw-warning',
        text: `${blockedConflicts.length} ${blockedConflicts.length === 1 ? 'match has' : 'matches have'} a judge from a team's own country. Change the judge, or accept it for that match.`,
      }),
    );
  }
  nodes.push(el('div', { className: 'btc-draw-warnings', attrs: { role: 'status' } }, warnings));

  // ---- preview: one card per match
  if (state.swapPick) {
    const picked = draw.pairs[state.swapPick.match];
    const id = state.swapPick.slot === 1 ? picked.team1Id : picked.team2Id;
    nodes.push(
      el('p', {
        className: 'stage-meta',
        text: `Swapping ${nameOf(id)}: choose the team to swap with, or choose it again to cancel.`,
        attrs: { role: 'status' },
      }),
    );
  }
  const cards = draw.pairs.map((pair, m) => {
    const issue = issues.byMatch[m];
    const teamRow = (slot, teamId) => {
      const picked = state.swapPick?.match === m && state.swapPick?.slot === slot;
      const swap = el('button', {
        className: 'btn btn-outline tap-target',
        text: picked ? 'Cancel swap' : 'Swap',
        attrs: {
          type: 'button',
          'aria-label': `${picked ? 'Cancel swap of' : 'Swap'} ${nameOf(teamId)}`,
          'data-focus-key': `swap-${m}-${slot}`,
        },
      });
      setBusyDisabled(swap, busy);
      swap.addEventListener('click', () => on.swap(m, slot));
      return el('div', { className: 'btc-draw-team' }, [
        el('span', { className: 'btc-match-teams', text: nameOf(teamId) }),
        swap,
      ]);
    };
    const selects = [0, 1, 2].map((k) => {
      const select = el('select', {
        className: 'field-input',
        attrs: { 'aria-label': `Match ${m + 1}, judge ${k + 1}`, 'data-field': `judge-${m}-${k}` },
      });
      for (const judge of judges) {
        const option = el('option', { text: teamLabel(judge), attrs: { value: judge.id } });
        if (judge.id === draw.judgeIds[m][k]) option.selected = true;
        select.appendChild(option);
      }
      setBusyDisabled(select, busy);
      select.addEventListener('change', () => on.judge(m, k, select.value));
      return select;
    });
    const noteId = `btc-draw-note-${m}`;
    const notes = [];
    for (const c of issue.conflicts) {
      notes.push(el('p', { className: 'btc-draw-warning', text: c.message }));
    }
    if (issue.duplicate) {
      notes.push(el('p', { className: 'btc-field-error', text: 'Choose three different judges.' }));
    }
    if (notes.length > 0)
      for (const select of selects) select.setAttribute('aria-describedby', noteId);
    let tickRow = null;
    if (issue.conflicts.length > 0) {
      const tick = el('input', { attrs: { type: 'checkbox', 'data-field': `tick-${m}` } });
      tick.checked = Boolean(draw.ticks[m]);
      setBusyDisabled(tick, busy);
      tick.addEventListener('change', () => on.tick(m, tick.checked));
      tickRow = el('label', { className: 'btc-draw-choice' }, [
        tick,
        el('span', { text: 'Allow this conflict' }),
      ]);
    }
    const card = el(
      'li',
      {
        className: 'btc-draw-match',
        attrs: { 'data-state': issue.blocked ? 'danger' : 'ok' },
      },
      [
        el('h3', { className: 'btc-draw-match-title', text: `Match ${m + 1}` }),
        teamRow(1, pair.team1Id),
        el('span', { className: 'btc-match-vs', text: 'vs', attrs: { 'aria-hidden': 'true' } }),
        teamRow(2, pair.team2Id),
        el('div', { className: 'btc-draw-judges' }, selects),
        el('div', { id: noteId, className: 'btc-draw-warnings' }, notes),
        tickRow,
      ].filter(Boolean),
    );
    return card;
  });
  nodes.push(
    el('ol', { className: 'btc-draw-list', attrs: { 'aria-label': 'Draw preview' } }, cards),
  );

  // ---- create
  const n = draw.pairs.length;
  const create = el('button', {
    className: 'btn btn-primary tap-target',
    text: busy ? 'Creating…' : `Create ${n} ${n === 1 ? 'match' : 'matches'}`,
    attrs: {
      type: 'button',
      'data-focus-key': 'draw-create',
      ...(state.error || !issues.valid
        ? {
            'aria-describedby': [state.error ? ERROR_ID : null, issues.valid ? null : HELP_ID]
              .filter(Boolean)
              .join(' '),
          }
        : {}),
    },
  });
  // aria-disabled, not `disabled`: a disabled button leaves the tab order, so the reason (aria-describedby) could
  // never be read. The click is refused instead; matchesScreen re-checks the same rule before it writes.
  setBusyDisabled(create, busy);
  // blocked by the draw itself (not busy): aria-disabled only, aria-busy would say something is updating
  if (!issues.valid) create.setAttribute('aria-disabled', 'true');
  create.addEventListener('click', () => {
    if (issues.valid) on.create();
  });
  if (!issues.valid) {
    nodes.push(
      el('p', {
        id: HELP_ID,
        className: 'stage-meta',
        text: 'Create is available once every match has three different judges and any judge from a team’s own country is changed or accepted.',
      }),
    );
  }
  if (errorNode) nodes.push(errorNode);
  nodes.push(create);
  return wrap(nodes);
}

function wrap(nodes) {
  return el('div', { className: 'card btc-draw-panel' }, [
    el('h2', { text: 'Draw a round' }),
    ...nodes,
  ]);
}
