// Brew Planner — a standalone, free tool (no auth, no Supabase, no router). A short wizard
// collects the heats, coffees, machines and timing; the last step is a cheat sheet to work
// from on the day. Lives under src/tools/ for the same reason the Timer does: it is a
// general-purpose gift to the community, not part of any format. See src/tools/CLAUDE.md.
import { brandMark, el, withFocusPreservation } from '../../core/dom.js';
import {
  CAMBRO_MAX_FILL,
  FILTERS_PER_BATCH,
  EXAMPLE_CONFIG,
  batchYieldMl,
  formatClock,
  planBrews,
  validateConfig,
} from './planner.js';
import {
  MAX_COFFEES,
  STEPS,
  VIEWS,
  cloneConfig,
  createInitialState,
  loadState,
  minutesToTimeValue,
  nextId,
  parseCuppers,
  saveState,
  timeValueToMinutes,
} from './plannerState.js';

const APP_TITLE = 'Seduh Brew Planner';
const VIEW_LABELS = {
  check: 'Check',
  runsheet: 'Run-sheet',
  timeline: 'Timeline',
  heats: 'Heats',
  supplies: 'Water, filters and Cambros',
};
const LANE_MINUTE_WIDTH = 6; // px per minute on the timeline

function grams(value) {
  return `${Math.round(value).toLocaleString('en-US')} g`;
}

function litres(value) {
  return `${value.toFixed(1)} L`;
}

function numberField({ label, hint, field, value, min, max, step = 1, onCommit, width }) {
  const input = el('input', {
    className: 'bp-input bp-mono',
    attrs: {
      type: 'number',
      inputmode: 'decimal',
      min: String(min),
      ...(max != null ? { max: String(max) } : {}),
      step: String(step),
      value: Number.isFinite(value) ? String(value) : '',
      'data-field': field,
    },
  });
  input.addEventListener('change', () =>
    onCommit(input.value === '' ? Number.NaN : Number(input.value)),
  );
  return fieldShell(label, hint, input, width);
}

function textField({ label, hint, field, value, onCommit, placeholder, mono }) {
  const input = el('input', {
    className: `bp-input${mono ? ' bp-mono' : ''}`,
    attrs: { type: 'text', value, 'data-field': field, ...(placeholder ? { placeholder } : {}) },
  });
  input.addEventListener('change', () => onCommit(input.value));
  return fieldShell(label, hint, input);
}

function fieldShell(label, hint, input, width) {
  const children = [el('span', { className: 'bp-field-label', text: label }), input];
  if (hint) children.push(el('span', { className: 'bp-field-hint', text: hint }));
  const shell = el('label', { className: 'bp-field' }, children);
  if (width) shell.style.maxWidth = width;
  return shell;
}

const stageName = (stage, index) => stage.name || `Stage ${index + 1}`;
const machineName = (machine, index) => machine.name || `Machine ${index + 1}`;

function button(text, { kind = 'outline', onClick, attrs = {} }) {
  const node = el('button', {
    className: `bp-btn bp-btn-${kind}`,
    text,
    attrs: { type: 'button', 'data-focus-key': `btn-${text}`, ...attrs },
  });
  node.addEventListener('click', onClick);
  return node;
}

function section(title, hint, children) {
  return el('section', { className: 'bp-panel' }, [
    el('div', { className: 'bp-panel-head' }, [
      el('h2', { text: title }),
      ...(hint ? [el('p', { className: 'bp-hint', text: hint })] : []),
    ]),
    ...children,
  ]);
}

function pill(text, tone) {
  return el('span', { className: `bp-pill bp-pill-${tone}`, text });
}

function table(headers, rows, { numeric = [], label, wide = false } = {}) {
  const head = el(
    'tr',
    {},
    headers.map((h, i) =>
      el('th', {
        className: numeric.includes(i) ? 'bp-num' : '',
        text: h,
        attrs: { scope: 'col' },
      }),
    ),
  );
  const body = rows.map((cells) =>
    el(
      'tr',
      {},
      cells.map((cell, i) => {
        const td = el('td', { className: numeric.includes(i) ? 'bp-num bp-mono' : '' });
        if (cell instanceof Node) td.append(cell);
        else td.textContent = cell;
        return td;
      }),
    ),
  );
  return tableWrap(head, body, { label, wide });
}

// The wrapper scrolls sideways on narrow screens, so it is a labelled, focusable region and
// a keyboard user can reach columns that are off-screen.
function tableWrap(head, body, { label, wide }) {
  return el(
    'div',
    {
      className: 'bp-table-wrap',
      attrs: { role: 'region', tabindex: '0', ...(label ? { 'aria-label': label } : {}) },
    },
    [
      el('table', { className: `bp-table${wide ? ' bp-table-wide' : ''}` }, [
        el('thead', {}, [head]),
        el('tbody', {}, body),
      ]),
    ],
  );
}

export function mountBrewPlanner(root, { storage } = {}) {
  const state = loadState(storage) ?? createInitialState();
  const persist = () => saveState(state, storage);
  let focusProblems = false; // move focus to the problem list after the next render
  let attempted = false; // whether Next was pressed on a step with problems

  function coffeeName(id) {
    return state.config.coffees.find((c) => c.id === id)?.name ?? 'Coffee';
  }
  function coffeeSlot(id) {
    return (
      Math.max(
        0,
        state.config.coffees.findIndex((c) => c.id === id),
      ) % MAX_COFFEES
    );
  }
  // A letter per coffee, so a block or tag is told apart by text and not only by pattern.
  function coffeeLetter(id) {
    return String.fromCharCode(65 + coffeeSlot(id));
  }

  function coffeeTag(id) {
    return el('span', {
      className: `bp-tag bp-coffee-${coffeeSlot(id)}`,
      text: `${coffeeLetter(id)} · ${coffeeName(id)}`,
    });
  }

  // ---------- wizard steps ----------

  function stepHeats() {
    const { config } = state;
    const stageCards = config.stages.map((stage, index) =>
      el('div', { className: 'bp-card' }, [
        el('div', { className: 'bp-card-head' }, [
          el('h3', { text: stage.name || `Stage ${index + 1}` }),
          config.stages.length > 1
            ? button('Remove', {
                onClick: () => {
                  config.stages.splice(index, 1);
                  persist();
                  render();
                },
                attrs: { 'aria-label': `Remove ${stage.name || `stage ${index + 1}`}` },
              })
            : el('span'),
        ]),
        el('div', { className: 'bp-grid' }, [
          textField({
            label: 'Stage name',
            hint: 'One heat reads "Prelim 1"',
            field: `stage-${index}-name`,
            value: stage.name,
            onCommit: (value) => {
              stage.name = value.trim();
              persist();
              render();
            },
          }),
          textField({
            label: 'Short code',
            hint: 'Used on the run-sheet, like P',
            field: `stage-${index}-code`,
            value: stage.code,
            mono: true,
            onCommit: (value) => {
              stage.code = value.trim().slice(0, 4).toUpperCase();
              persist();
              render();
            },
          }),
          textField({
            label: 'Cuppers in each heat',
            hint: 'Comma separated, like 4, 4, 3',
            field: `stage-${index}-heats`,
            value: stage.heats.join(', '),
            mono: true,
            onCommit: (value) => {
              stage.heats = parseCuppers(value);
              persist();
              render();
            },
          }),
          numberField({
            label: 'Sets per cupper',
            hint: 'Three cups each',
            field: `stage-${index}-sets`,
            value: stage.sets,
            min: 1,
            onCommit: (value) => {
              stage.sets = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Heat length (min)',
            field: `stage-${index}-length`,
            value: stage.heatMins,
            min: 1,
            step: 0.5,
            onCommit: (value) => {
              stage.heatMins = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Changeover between heats (min)',
            hint: 'Wipe, dump, walk, sort',
            field: `stage-${index}-changeover`,
            value: stage.changeoverMins,
            min: 0,
            step: 0.5,
            onCommit: (value) => {
              stage.changeoverMins = value;
              persist();
              render();
            },
          }),
        ]),
      ]),
    );
    return [
      section('Heats', 'How many cuppers taste together, and how many sets each of them gets.', [
        el('div', { className: 'bp-grid' }, [
          numberField({
            label: 'Cup volume (ml)',
            hint: 'Poured into every cup',
            field: 'cup-ml',
            value: config.cupMl,
            min: 1,
            step: 5,
            onCommit: (value) => {
              config.cupMl = value;
              persist();
              render();
            },
          }),
        ]),
        ...stageCards,
        el('div', { className: 'bp-row' }, [
          button('Add a stage', {
            onClick: () => {
              config.stages.push({
                id: nextId(
                  's',
                  config.stages.map((s) => s.id),
                ),
                name: 'Stage',
                code: 'S',
                heats: [4],
                sets: 5,
                heatMins: 8,
                changeoverMins: 5,
                mix: {},
              });
              persist();
              render();
            },
          }),
          button('Load the Cup Taster 2026 example', {
            onClick: () => {
              state.config = cloneConfig(EXAMPLE_CONFIG);
              state.done = {};
              persist();
              render();
            },
          }),
        ]),
      ]),
    ];
  }

  function stepCoffees() {
    const { config } = state;
    const coffeeRows = config.coffees.map((coffee, index) =>
      el('div', { className: 'bp-card' }, [
        el('div', { className: 'bp-grid' }, [
          textField({
            label: `Coffee ${index + 1}`,
            field: `coffee-${index}-name`,
            value: coffee.name,
            onCommit: (value) => {
              coffee.name = value.trim();
              persist();
              render();
            },
          }),
          numberField({
            label: 'Beans on hand (g)',
            field: `coffee-${index}-grams`,
            value: coffee.grams,
            min: 0,
            step: 50,
            onCommit: (value) => {
              coffee.grams = value;
              persist();
              render();
            },
          }),
        ]),
        config.coffees.length > 1
          ? button('Remove', {
              onClick: () => {
                config.coffees.splice(index, 1);
                config.stages.forEach((stage) => delete stage.mix[coffee.id]);
                persist();
                render();
              },
              attrs: { 'aria-label': `Remove ${coffee.name || `coffee ${index + 1}`}` },
            })
          : el('span'),
      ]),
    );
    const mixCards = config.stages.map((stage, stageIndex) => {
      const assigned = Object.values(stage.mix).reduce((sum, sets) => sum + (sets || 0), 0);
      const remaining = stage.sets - assigned;
      return el('div', { className: 'bp-card' }, [
        el('div', { className: 'bp-card-head' }, [
          el('h3', { text: stage.name || `Stage ${stageIndex + 1}` }),
          remaining === 0
            ? pill(`All ${stage.sets} sets covered`, 'ok')
            : pill(
                remaining > 0 ? `${remaining} sets still to assign` : `${-remaining} sets too many`,
                'bad',
              ),
        ]),
        el(
          'div',
          { className: 'bp-grid' },
          config.coffees.map((coffee, coffeeIndex) =>
            numberField({
              label: `${coffee.name || `Coffee ${coffeeIndex + 1}`}, sets`,
              field: `mix-${stageIndex}-${coffeeIndex}`,
              value: stage.mix[coffee.id] || 0,
              min: 0,
              max: stage.sets,
              onCommit: (value) => {
                stage.mix[coffee.id] = Number.isFinite(value) ? value : 0;
                persist();
                render();
              },
            }),
          ),
        ),
      ]);
    });
    return [
      section(
        'Coffees',
        'What you have, in grams. Coffees you brew as separate pools each round up separately.',
        [
          ...coffeeRows,
          config.coffees.length < MAX_COFFEES
            ? button('Add a coffee', {
                onClick: () => {
                  config.coffees.push({
                    id: nextId(
                      'c',
                      config.coffees.map((c) => c.id),
                    ),
                    name: '',
                    grams: 1000,
                  });
                  persist();
                  render();
                },
              })
            : el('span'),
        ],
      ),
      section(
        'Which coffee on which sets',
        "Split each stage's sets across your coffees. Every heat in the stage gets the same split.",
        mixCards,
      ),
    ];
  }

  function stepMachines() {
    const { config } = state;
    const machineRows = config.machines.map((machine, index) =>
      el('div', { className: 'bp-card' }, [
        el('div', { className: 'bp-grid' }, [
          textField({
            label: `Machine ${index + 1}`,
            field: `machine-${index}-name`,
            value: machine.name,
            onCommit: (value) => {
              machine.name = value.trim();
              persist();
              render();
            },
          }),
          numberField({
            label: 'Brew time (min)',
            hint: 'Start button to full carafe',
            field: `machine-${index}-brew`,
            value: machine.brewMins,
            min: 1,
            step: 0.5,
            onCommit: (value) => {
              machine.brewMins = value;
              persist();
              render();
            },
          }),
        ]),
        config.machines.length > 1
          ? button('Remove', {
              onClick: () => {
                config.machines.splice(index, 1);
                persist();
                render();
              },
              attrs: { 'aria-label': `Remove ${machine.name || `machine ${index + 1}`}` },
            })
          : el('span'),
      ]),
    );
    const yieldMl = batchYieldMl(config.doseGrams, config.ratio);
    return [
      section('Machines', 'Every machine you can run at the same time.', [
        ...machineRows,
        button('Add a machine', {
          onClick: () => {
            config.machines.push({ name: `Machine ${config.machines.length + 1}`, brewMins: 6 });
            persist();
            render();
          },
        }),
      ]),
      section('Batch', 'One dose per batch, one batch per fill of the machine.', [
        el('div', { className: 'bp-grid' }, [
          numberField({
            label: 'Coffee per batch (g)',
            field: 'dose',
            value: config.doseGrams,
            min: 1,
            onCommit: (value) => {
              config.doseGrams = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Ratio, water to coffee (1 : x)',
            hint: 'Golden Cup is 16',
            field: 'ratio',
            value: config.ratio,
            min: 3,
            step: 0.5,
            onCommit: (value) => {
              config.ratio = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Reset between batches (min)',
            hint: 'Filter, rinse, refill, dose',
            field: 'reset',
            value: config.resetMins,
            min: 0,
            step: 0.5,
            onCommit: (value) => {
              config.resetMins = value;
              persist();
              render();
            },
          }),
        ]),
        Number.isFinite(yieldMl) && yieldMl > 0
          ? el('p', {
              className: 'bp-hint',
              text: `${grams(config.doseGrams)} takes ${Math.round(config.doseGrams * config.ratio)} ml of water and gives about ${Math.round(yieldMl)} ml of coffee. Two grams of water stay in each gram of grounds; that is a working figure, so check it at dial-in.`,
            })
          : el('span'),
      ]),
    ];
  }

  function stepTiming() {
    const { config } = state;
    return [
      section('Timing', 'When the first heat starts, and the gaps between stages.', [
        el('div', { className: 'bp-grid' }, [
          fieldShell(
            'First heat starts',
            null,
            (() => {
              const input = el('input', {
                className: 'bp-input bp-mono',
                attrs: {
                  type: 'time',
                  value: minutesToTimeValue(config.startMin),
                  'data-field': 'start',
                },
              });
              input.addEventListener('change', () => {
                config.startMin = timeValueToMinutes(input.value);
                persist();
                render();
              });
              return input;
            })(),
          ),
          numberField({
            label: 'Tabulation gap between stages (min)',
            hint: 'Last heat ends to next stage starts',
            field: 'tabulation',
            value: config.tabulationMins,
            min: 0,
            onCommit: (value) => {
              config.tabulationMins = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Extra break before the last stage (min)',
            hint: 'For prayer time, if it falls there',
            field: 'break',
            value: config.breakBeforeLastMins,
            min: 0,
            step: 5,
            onCommit: (value) => {
              config.breakBeforeLastMins = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Pour and sort lead (min)',
            hint: 'Coffee pooled this long before a heat',
            field: 'lead',
            value: config.pourLeadMins,
            min: 0,
            onCommit: (value) => {
              config.pourLeadMins = value;
              persist();
              render();
            },
          }),
          numberField({
            label: 'Longest hold you accept (min)',
            hint: 'Brew end to the start of pouring',
            field: 'hold-limit',
            value: config.holdLimitMins,
            min: 1,
            step: 5,
            onCommit: (value) => {
              config.holdLimitMins = value;
              persist();
              render();
            },
          }),
        ]),
      ]),
    ];
  }

  // ---------- cheat sheet ----------

  function checkView(plan) {
    const { config } = state;
    const holdOk = plan.maxHoldMins <= config.holdLimitMins;
    const stats = el('div', { className: 'bp-stats' }, [
      stat(
        'Fire up the machines',
        formatClock(plan.firstBrewMin),
        `${Math.round(config.startMin - plan.firstBrewMin)} min before the first heat`,
      ),
      stat(
        'Longest hold',
        `${Math.round(plan.maxHoldMins)} min`,
        holdOk
          ? `Within your ${config.holdLimitMins} min limit`
          : `Over your ${config.holdLimitMins} min limit`,
        holdOk ? 'ok' : 'warn',
      ),
      stat(
        'Grinder',
        `${(Math.round(plan.cadenceMins * 10) / 10).toString()} min`,
        `Between ${config.doseGrams} g doses with every machine running`,
      ),
      stat(
        'Brewing ends',
        formatClock(plan.lastBrewEndMin),
        `${plan.batches.length} batches in all`,
      ),
    ]);
    const bars = el(
      'div',
      { className: 'bp-beans' },
      config.coffees.map((coffee) => {
        const need = plan.needByCoffee[coffee.id] || 0;
        const short = need > coffee.grams;
        const scale = Math.max(need, coffee.grams) || 1;
        const uses = plan.heats
          .flatMap((heat) =>
            heat.lots
              .filter((lot) => lot.coffeeId === coffee.id)
              .map((lot) => `${heat.code} ${lot.batches}`),
          )
          .join(', ');
        const fill = el('div', { className: `bp-bar-fill bp-coffee-${coffeeSlot(coffee.id)}` });
        fill.style.width = `${(need / scale) * 100}%`;
        const marker = el('div', { className: 'bp-bar-marker' });
        marker.style.left = `calc(${(coffee.grams / scale) * 100}% - 1px)`;
        return el('div', { className: 'bp-bean' }, [
          el('div', { className: 'bp-row bp-between' }, [
            el('strong', { text: coffee.name }),
            short
              ? pill(`Short by ${grams(need - coffee.grams)}`, 'bad')
              : pill(`Covered, ${grams(coffee.grams - need)} spare`, 'ok'),
          ]),
          el(
            'div',
            {
              className: 'bp-bar',
              attrs: {
                role: 'img',
                'aria-label': `${coffee.name}: needs ${grams(need)} of ${grams(coffee.grams)} on hand`,
              },
            },
            [fill, marker],
          ),
          el('p', {
            className: 'bp-hint',
            text: `Needs ${grams(need)}, you have ${grams(coffee.grams)} (black marker).${uses ? ` Batches: ${uses}.` : ' Not used.'}`,
          }),
        ]);
      }),
    );
    return [
      section(
        'Does it work?',
        `${plan.batches.length} batches, ${grams(plan.totalGrams)} of coffee, about ${litres(plan.waterLitres)} of water.`,
        [stats, bars],
      ),
    ];
  }

  function stat(label, value, detail, tone = '') {
    return el('div', { className: `bp-stat${tone ? ` bp-stat-${tone}` : ''}` }, [
      el('div', { className: 'bp-stat-label', text: label }),
      el('div', { className: 'bp-stat-value bp-mono', text: value }),
      el('div', { className: 'bp-hint', text: detail }),
    ]);
  }

  function timelineView(plan) {
    const { config } = state;
    const lastHeat = plan.heats[plan.heats.length - 1];
    const from = Math.floor((plan.firstBrewMin - 6) / 30) * 30;
    const to = Math.ceil((lastHeat.startMin + lastHeat.lengthMins + 5) / 30) * 30;
    const trackWidth = (to - from) * LANE_MINUTE_WIDTH;

    function lane(label, { header = false } = {}) {
      const track = el('div', { className: 'bp-track' });
      track.style.width = `${trackWidth}px`;
      if (!header) {
        track.style.backgroundImage =
          'linear-gradient(to right, var(--color-border) 1px, transparent 1px)';
        track.style.backgroundSize = `${30 * LANE_MINUTE_WIDTH}px 100%`;
      }
      return {
        track,
        row: el('div', { className: `bp-lane${header ? ' bp-lane-head' : ''}` }, [
          el('div', { className: 'bp-lane-label', text: label }),
          track,
        ]),
      };
    }
    const rows = [];
    const clock = lane('Clock', { header: true });
    for (let t = from; t <= to; t += 30) {
      const tick = el('span', {
        className: 'bp-tick bp-mono',
        text: formatClock(t).replace(' ', ''),
      });
      tick.style.left = `${(t - from) * LANE_MINUTE_WIDTH}px`;
      clock.track.append(tick);
    }
    rows.push(clock.row);
    const stage = lane('Stage');
    plan.heats.forEach((heat) => {
      const pour = el('div', {
        className: 'bp-block bp-block-pour',
        attrs: { title: `${heat.label}: pour and sort window` },
      });
      pour.style.left = `${(heat.poolByMin - from) * LANE_MINUTE_WIDTH}px`;
      pour.style.width = `${config.pourLeadMins * LANE_MINUTE_WIDTH}px`;
      const block = el('div', {
        className: 'bp-block bp-block-stage',
        text: heat.code,
        attrs: { title: `${heat.label} at ${formatClock(heat.startMin)}` },
      });
      block.style.left = `${(heat.startMin - from) * LANE_MINUTE_WIDTH}px`;
      block.style.width = `${heat.lengthMins * LANE_MINUTE_WIDTH}px`;
      stage.track.append(pour, block);
    });
    rows.push(stage.row);
    const tracks = config.machines.map((machine) => {
      const built = lane(machine.name);
      rows.push(built.row);
      return built.track;
    });
    plan.batches.forEach((batch) => {
      const machine = config.machines[batch.machineIndex];
      const block = el('div', {
        className: `bp-block bp-coffee-${coffeeSlot(batch.coffeeId)}${state.done[batch.key] ? ' bp-block-done' : ''}`,
        text: `${state.done[batch.key] ? '✓ ' : ''}${coffeeLetter(batch.coffeeId)} · ${batch.heatCode}`,
        attrs: {
          title: `${machine.name}, ${formatClock(batch.startMin)} to ${formatClock(batch.endMin)}: ${coffeeName(batch.coffeeId)} for ${plan.heats[batch.heatIndex].label}`,
        },
      });
      block.style.left = `${(batch.startMin - from) * LANE_MINUTE_WIDTH}px`;
      block.style.width = `${machine.brewMins * LANE_MINUTE_WIDTH}px`;
      tracks[batch.machineIndex].append(block);
    });
    const lanes = el('div', { className: 'bp-lanes' }, rows);
    lanes.style.width = `calc(var(--bp-lane-label) + ${trackWidth}px)`;
    return [
      section(
        'Machines against the stage',
        'Each block is one brew, labelled with its coffee letter and the heat it feeds. The Run-sheet tab lists the same brews as text.',
        [
          el('div', { className: 'bp-legend' }, [
            ...config.coffees.map((coffee) => coffeeTag(coffee.id)),
            el('span', { className: 'bp-tag bp-tag-stage', text: 'Heat on stage' }),
            el('span', { className: 'bp-tag bp-tag-pour', text: 'Pour and sort window' }),
          ]),
          el(
            'div',
            {
              className: 'bp-scroll',
              attrs: {
                tabindex: '0',
                role: 'region',
                'aria-label': 'Timeline of brews by machine',
              },
            },
            [lanes],
          ),
        ],
      ),
    ];
  }

  function heatsView(plan) {
    const rows = plan.heats.map((heat) => [
      `${heat.code}  ${heat.label}`,
      formatClock(heat.startMin),
      String(heat.cuppers),
      String(heat.cups),
      el(
        'div',
        { className: 'bp-lots' },
        heat.lots.map((lot) =>
          el('div', {}, [
            coffeeTag(lot.coffeeId),
            el('span', { className: 'bp-hint', text: ` ${lot.sets} sets, ${lot.batches} batches` }),
          ]),
        ),
      ),
      formatClock(heat.poolByMin),
      `${Math.round(heat.maxHoldMins)} min`,
    ]);
    return [
      section(
        'Heats',
        'Pool every batch for a heat in one Cambro and pour from it, so every cupper in the heat gets identical coffee.',
        [
          table(
            [
              'Heat',
              'Table time',
              'Cuppers',
              'Cups',
              'Coffee and batches',
              'Pooled by',
              'Longest hold',
            ],
            rows,
            { numeric: [1, 2, 3, 5, 6] },
          ),
        ],
      ),
    ];
  }

  function runsheetView(plan) {
    const { config } = state;
    const machineFilter = state.machineFilter ?? 'all';
    const heatFilter = state.heatFilter ?? 'all';
    const total = plan.batches.length;
    const doneCount = plan.batches.filter((b) => state.done[b.key]).length;

    const progressText = el('span', { text: `${doneCount} of ${total} batches done` });
    const progressFill = el('i');
    progressFill.style.width = `${(doneCount / total) * 100}%`;
    const progress = el('div', { className: 'bp-progress' }, [
      progressText,
      el('span', { className: 'bp-meter', attrs: { 'aria-hidden': 'true' } }, [progressFill]),
      button('Clear ticks', {
        onClick: () => {
          state.done = {};
          persist();
          render();
        },
      }),
    ]);

    function filterRow(label, options, current, onPick) {
      return el(
        'div',
        { className: 'bp-chips', attrs: { role: 'group', 'aria-label': label } },
        options.map(([value, text]) => {
          const chip = el('button', {
            className: 'bp-chip',
            text,
            attrs: {
              type: 'button',
              'aria-pressed': String(String(current) === String(value)),
              'data-focus-key': `chip-${label}-${value}`,
            },
          });
          chip.addEventListener('click', () => onPick(value));
          return chip;
        }),
      );
    }
    const machineChips = filterRow(
      'Filter by machine',
      [['all', 'All machines'], ...config.machines.map((m, i) => [i, m.name])],
      machineFilter,
      (value) => {
        state.machineFilter = value;
        persist();
        render();
      },
    );
    const heatChips = filterRow(
      'Filter by heat',
      [['all', 'All heats'], ...plan.heats.map((h) => [h.code, h.code])],
      heatFilter,
      (value) => {
        state.heatFilter = value;
        persist();
        render();
      },
    );

    const body = plan.batches
      .filter(
        (b) =>
          (machineFilter === 'all' || b.machineIndex === machineFilter) &&
          (heatFilter === 'all' || b.heatCode === heatFilter),
      )
      .map((batch) => {
        const checkbox = el('input', {
          className: 'bp-check',
          attrs: {
            type: 'checkbox',
            'data-focus-key': `tick-${batch.key}`,
            'aria-label': `Batch ${batch.number} of ${batch.heatCode} on ${config.machines[batch.machineIndex].name} done`,
          },
        });
        checkbox.checked = Boolean(state.done[batch.key]);
        const row = el('tr', { className: checkbox.checked ? 'bp-row-done' : '' }, [
          el('td', {}, [el('label', { className: 'bp-tick' }, [checkbox])]),
          el('td', { className: 'bp-num bp-mono', text: formatClock(batch.startMin) }),
          el('td', { text: config.machines[batch.machineIndex].name }),
          el('td', {}, [coffeeTag(batch.coffeeId)]),
          el('td', { className: 'bp-num bp-mono', text: `${config.doseGrams} g` }),
          el('td', { className: 'bp-num bp-mono', text: formatClock(batch.endMin) }),
          el('td', { text: `${batch.heatCode} · batch ${batch.number}` }),
          el('td', { className: 'bp-num bp-mono', text: formatClock(batch.pourByMin) }),
          el('td', {
            className: `bp-num bp-mono${batch.holdMins > config.holdLimitMins ? ' bp-over' : ''}`,
            text: `${Math.round(batch.holdMins)} min${batch.holdMins > config.holdLimitMins ? ' (over)' : ''}`,
          }),
        ]);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) state.done[batch.key] = true;
          else delete state.done[batch.key];
          persist();
          row.classList.toggle('bp-row-done', checkbox.checked);
          const now = plan.batches.filter((b) => state.done[b.key]).length;
          progressText.textContent = `${now} of ${total} batches done`;
          progressFill.style.width = `${(now / total) * 100}%`;
        });
        return row;
      });

    const head = el(
      'tr',
      {},
      ['Done', 'Brew start', 'Machine', 'Coffee', 'Dose', 'Ready', 'Feeds', 'Pour at', 'Hold'].map(
        (h, i) =>
          el('th', {
            className: [1, 4, 5, 7, 8].includes(i) ? 'bp-num' : '',
            text: h,
            attrs: { scope: 'col' },
          }),
      ),
    );
    return [
      section('Run-sheet', 'Tick each batch when it is off the machine.', [
        progress,
        machineChips,
        heatChips,
        tableWrap(head, body, { label: 'Run-sheet, scrollable', wide: true }),
      ]),
    ];
  }

  function suppliesView(plan) {
    const { config } = state;
    const byStage = config.stages.map((stage, index) => {
      const batches = plan.filtersByStage[stage.id] / FILTERS_PER_BATCH;
      return [
        stageName(stage, index),
        String(batches),
        litres((batches * plan.waterMlPerBatch) / 1000),
      ];
    });
    const poolRows = plan.cambros.pools.map((pool) => [
      pool.heatCode,
      coffeeTag(pool.coffeeId),
      litres(pool.brewedLitres),
      ...plan.cambros.sizes.map((size) =>
        String(size.perPool[`${pool.heatCode}|${pool.coffeeId}`]),
      ),
      `${formatClock(pool.fromMin)} to ${formatClock(pool.untilMin)}`,
    ]);
    const sizeRows = plan.cambros.sizes.map((size) => [
      size.label,
      litres(size.litres),
      litres(size.usableLitres),
      String(size.concurrent),
    ]);
    const filterRows = config.stages.map((stage, index) => [
      stageName(stage, index),
      String(plan.filtersByStage[stage.id]),
    ]);
    const machineFilterRows = config.machines.map((machine, index) => [
      machineName(machine, index),
      String(plan.filtersByMachine[index]),
    ]);
    return [
      section(
        'Water',
        `Brewing needs about ${litres(plan.waterLitres)}. Rinsing filters, preheating and the odd-cup treatments are not counted, so carry more than this.`,
        [
          table(['Stage', 'Batches', 'Water'], byStage, {
            numeric: [1, 2],
            label: 'Water by stage',
          }),
          el('p', {
            className: 'bp-hint',
            text: `Each batch is ${Math.round(plan.waterMlPerBatch)} ml, so every machine needs a refill before every batch, about one every ${Math.round(plan.cadenceMins * 10) / 10} minutes across all of them.`,
          }),
        ],
      ),
      section(
        'Paper filters',
        `You need ${plan.filters} paper filters, one per batch. Carry a few spare for misfires.`,
        [
          table(['Stage', 'Filters'], filterRows, {
            numeric: [1],
            label: 'Paper filters by stage',
          }),
          table(['Machine', 'Filters'], machineFilterRows, {
            numeric: [1],
            label: 'Paper filters by machine',
          }),
        ],
      ),
      section(
        'Cambros',
        'Pick one size and use the count beside it. The count is how many you need at once.',
        [
          el('p', {
            className: 'bp-hint',
            text: `The largest pool is ${litres(plan.cambros.largestLitres)}. Each size is counted at ${Math.round(CAMBRO_MAX_FILL * 100)}% full so it can't brim over, and a pool bigger than that is split across several Cambros of the same coffee. Cambro labels are nominal, so check the real usable volume of yours.`,
          }),
          table(['Size', 'Nominal', 'Usable', 'At once'], sizeRows, {
            numeric: [1, 2, 3],
            label: 'Cambro sizes',
          }),
          table(
            [
              'Heat',
              'Coffee',
              'Brewed',
              ...plan.cambros.sizes.map((size) => size.label),
              'In a Cambro',
            ],
            poolRows,
            { numeric: [2, 3, 4, 5], label: 'Cambro pools, scrollable', wide: true },
          ),
        ],
      ),
    ];
  }

  function cheatSheet() {
    const problems = validateConfig(state.config);
    if (problems.length) {
      return [
        section('Something in the setup needs fixing', null, [
          el(
            'ul',
            { className: 'bp-problems' },
            problems.map((problem) => el('li', { text: problem.message })),
          ),
          button('Back to the setup', { kind: 'primary', onClick: () => go(0) }),
        ]),
      ];
    }
    const plan = planBrews(state.config);
    const tabs = el(
      'div',
      { className: 'bp-tabs', attrs: { role: 'group', 'aria-label': 'Cheat sheet sections' } },
      VIEWS.map((view) => {
        const tab = el('button', {
          className: 'bp-tab',
          text: VIEW_LABELS[view],
          attrs: {
            type: 'button',
            'aria-pressed': String(state.view === view),
            'data-focus-key': `view-${view}`,
          },
        });
        tab.addEventListener('click', () => {
          state.view = view;
          persist();
          render();
        });
        return tab;
      }),
    );
    const views = {
      check: checkView,
      runsheet: runsheetView,
      timeline: timelineView,
      heats: heatsView,
      supplies: suppliesView,
    };
    return [
      tabs,
      ...views[state.view](plan),
      el('div', { className: 'bp-row' }, [button('Edit the setup', { onClick: () => go(0) })]),
    ];
  }

  // ---------- frame ----------

  function go(step) {
    state.step = step;
    attempted = false;
    persist();
    render();
    window.scrollTo?.(0, 0);
  }

  function stepProblems(step) {
    return validateConfig(state.config).filter((problem) => problem.step === step);
  }

  function stepper() {
    return el(
      'ol',
      { className: 'bp-stepper', attrs: { 'aria-label': 'Steps' } },
      STEPS.map((name, index) => {
        const item = el('li', {});
        const link = el(
          'button',
          {
            className: 'bp-step',
            attrs: {
              type: 'button',
              'data-focus-key': `step-${index}`,
              ...(index === state.step ? { 'aria-current': 'step' } : {}),
            },
          },
          [
            el('span', { className: 'bp-step-no bp-mono', text: String(index + 1) }),
            el('span', { className: 'bp-step-name', text: name }),
          ],
        );
        link.addEventListener('click', () => go(index));
        item.append(link);
        return item;
      }),
    );
  }

  function navigation() {
    const problems = stepProblems(state.step);
    const children = [];
    if (attempted && problems.length) {
      children.push(
        el(
          'ul',
          { className: 'bp-problems', attrs: { role: 'alert', tabindex: '-1' } },
          problems.map((problem) => el('li', { text: problem.message })),
        ),
      );
    }
    const row = el('div', { className: 'bp-row bp-between' }, [
      state.step > 0 ? button('Back', { onClick: () => go(state.step - 1) }) : el('span'),
      state.step < STEPS.length - 1
        ? button(state.step === STEPS.length - 2 ? 'Build my cheat sheet' : 'Next', {
            kind: 'primary',
            onClick: () => {
              if (stepProblems(state.step).length) {
                attempted = true;
                focusProblems = true;
                render();
                return;
              }
              go(state.step + 1);
            },
          })
        : el('span'),
    ]);
    children.push(row);
    return el('div', { className: 'bp-nav' }, children);
  }

  function render() {
    withFocusPreservation(root, () => {
      const brandMarkNode = brandMark();
      brandMarkNode.classList.add('bp-brand-mark');
      const builders = [stepHeats, stepCoffees, stepMachines, stepTiming];
      const body = state.step < 4 ? builders[state.step]() : cheatSheet();
      root.replaceChildren(
        el('main', { className: 'bp' }, [
          el('header', { className: 'bp-header' }, [
            el(
              'a',
              { className: 'bp-brand', attrs: { href: '/', 'aria-label': 'Seduh Score home' } },
              [brandMarkNode],
            ),
            el('h1', { text: APP_TITLE }),
            el('p', {
              className: 'bp-intro',
              text: 'Plan batch brews for triangulation heats: how much coffee, which machine, and when to start, so every heat is poured on time.',
            }),
          ]),
          stepper(),
          ...body,
          state.step < 4 ? navigation() : el('span'),
        ]),
      );
      document.title =
        state.step === 4
          ? `${VIEW_LABELS[state.view]} — ${APP_TITLE}`
          : `${STEPS[state.step]} — ${APP_TITLE}`;
      if (focusProblems) {
        focusProblems = false;
        root.querySelector('.bp-problems')?.focus();
        return true;
      }
      return false;
    });
  }

  render();
}
