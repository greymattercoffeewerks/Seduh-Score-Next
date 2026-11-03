// Throwdown's organiser screen: one hub for the whole event, because a knockout has no separate stages to move between.
// Before the draw it shows the competitors, the setup and the draw (random or manual); after it, the bracket, the
// matches being played (judges' taps, confirm, walkover) and the champion banner. Setup is locked once Round 1
// exists (the database refuses a change too); a module that is not on leaves no trace here.
//
// Every write goes through formats/throwdown/data.js (the shared outbox), so a tap made on a bad connection is kept
// and replayed; the counts shown are the server's plus the taps still waiting (pendingVoteDeltas).
import { getSupabase } from '../../core/supabaseClient.js';
import { el, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { findEvent } from '../../core/events.js';
import { createEntry, setEntryWithdrawn } from '../../core/registry.js';
import { droppedErrorFor } from '../../core/outbox.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { newSeed } from '../../core/seededShuffle.js';
import {
  loadThrowdown,
  saveSettings,
  startEvent,
  castVote,
  undoVote,
  confirmMatch,
  recordWalkover,
  pendingVoteDeltas,
} from './data.js';
import { tallyVotes, leadOf, canConfirm } from './votes.js';
import {
  randomPairs,
  normalisePairs,
  drawProblems,
  previewRoundOne,
  emptyBoard,
  assignSlot,
} from './seeding.js';
import { MODULES, enabledModules } from './modules.js';
import { publishThrowdownLive } from './liveSession.js';
import { describeThrowdownError, resultLine, matchTitle } from './words.js';

export async function mountThrowdownEventScreen(
  root,
  { eventId, client = getSupabase(), signal, handlers } = {},
) {
  const state = {
    loading: true,
    loadError: null,
    event: null,
    data: null,
    form: null, // setup form values
    draw: null, // { seed, pairs } (random) or { slotCount, pairs } (manual)
    pending: new Map(), // matchId -> { deltas, queued }
    walkover: null, // { matchId, slotId } waiting for the second tap
    feedback: null,
    busy: false,
  };

  const activeEntries = () => state.data.entries.filter((e) => !e.withdrawn);
  const nameOf = (id) => state.data.entries.find((e) => e.id === id)?.display_name ?? '';

  async function refresh() {
    try {
      const [event, data] = await raceTimeout(
        Promise.all([findEvent(eventId, client), loadThrowdown(eventId, client)]),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
      if (signal?.aborted) return;
      state.event = event;
      state.data = data;
      state.loadError = null;
      state.form ??= {
        judgeCount: data.settings.judge_count,
        thirdPlace: data.settings.third_place,
        seedingMode: data.settings.seeding_mode,
      };
      state.pending = new Map();
      for (const match of data.bracket.playableMatches) {
        state.pending.set(match.id, await pendingVoteDeltas(match.id));
      }
    } catch (err) {
      state.loadError = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeThrowdownError(err);
    }
    state.loading = false;
    render();
  }

  // Runs a write, reports a refusal in words, reloads. Never lets two writes overlap.
  async function act(work, { publish = false } = {}) {
    if (state.busy || signal?.aborted) return;
    state.busy = true;
    state.feedback = null;
    render();
    try {
      const outcome = await work();
      const dropped = outcome ? droppedErrorFor(outcome.result, outcome.operationId) : null;
      if (dropped) state.feedback = { tone: 'error', text: describeThrowdownError(dropped) };
      else if (publish)
        await publishThrowdownLive({ event: state.event, takeOver: true }, handlers);
    } catch (err) {
      state.feedback = { tone: 'error', text: describeThrowdownError(err) };
    }
    state.busy = false;
    await refresh();
  }

  // ---------- pieces ----------

  function feedbackNode() {
    return el('div', {
      className: 'screen-feedback',
      text: state.feedback?.text ?? '',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
  }

  function button(
    label,
    onClick,
    { className = 'btn btn-outline tap-target', key, disabled = false } = {},
  ) {
    const b = el('button', {
      className,
      text: label,
      attrs: { type: 'button', 'data-focus-key': key ?? label },
    });
    if (disabled || state.busy) setBusyDisabled(b, true);
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      onClick();
    });
    return b;
  }

  function competitorsCard() {
    const locked = state.data.bracket.started;
    const nameInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'text',
        'aria-label': 'Competitor name',
        autocomplete: 'off',
        'data-focus-key': 'td-new-name',
      },
    });
    const cafeInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'text',
        'aria-label': 'Café or team (optional)',
        autocomplete: 'off',
        'data-focus-key': 'td-new-cafe',
      },
    });
    const form = el('form', { className: 'td-add', attrs: { 'aria-label': 'Add a competitor' } }, [
      nameInput,
      cafeInput,
      el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Add competitor',
        attrs: { type: 'submit' },
      }),
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const displayName = nameInput.value.trim();
      if (!displayName) {
        state.feedback = { tone: 'error', text: 'Enter the competitor’s name.' };
        render();
        return;
      }
      act(async () => {
        await createEntry(eventId, { displayName, cafe: cafeInput.value.trim() || null }, client);
      });
    });
    const rows = state.data.entries.map((entry) =>
      el('li', { className: 'td-roster-row' }, [
        el('span', {
          className: 'td-roster-name',
          text: entry.display_name + (entry.withdrawn ? ' (withdrawn)' : ''),
        }),
        button(
          entry.withdrawn ? 'Restore' : 'Withdraw',
          () => act(() => setEntryWithdrawn(entry.id, !entry.withdrawn, client)),
          {
            key: `td-withdraw-${entry.id}`,
          },
        ),
      ]),
    );
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': 'td-competitors-h' } },
      [
        el('h2', { id: 'td-competitors-h', text: `Competitors (${activeEntries().length})` }),
        rows.length
          ? el('ul', { className: 'td-roster' }, rows)
          : el('p', { text: 'No competitors yet.' }),
        locked
          ? el('p', {
              className: 'td-note',
              text: 'The draw has started. Withdrawing a competitor does not change the bracket: record a walkover on their match.',
            })
          : form,
      ],
    );
  }

  function setupCard() {
    const f = state.form;
    const judges = el('input', {
      className: 'field-input',
      attrs: {
        type: 'number',
        min: '1',
        max: '15',
        inputmode: 'numeric',
        value: String(f.judgeCount),
        'aria-label': 'Number of judges',
        'data-focus-key': 'td-judges',
      },
    });
    judges.addEventListener('change', () => {
      f.judgeCount = Number(judges.value);
    });
    const third = el('input', { attrs: { type: 'checkbox', 'data-focus-key': 'td-third' } });
    third.checked = f.thirdPlace;
    third.addEventListener('change', () => {
      f.thirdPlace = third.checked;
    });
    const mode = (value, label) => {
      const input = el('input', {
        attrs: { type: 'radio', name: 'td-seeding', value, 'data-focus-key': `td-mode-${value}` },
      });
      input.checked = f.seedingMode === value;
      input.addEventListener('change', () => {
        f.seedingMode = value;
        state.draw = null;
        render();
      });
      return el('label', { className: 'td-choice' }, [input, document.createTextNode(` ${label}`)]);
    };
    const blocks = [
      el('label', { className: 'td-choice' }, [document.createTextNode('Judges '), judges]),
      el('label', { className: 'td-choice' }, [
        third,
        document.createTextNode(' Play a 3rd place match'),
      ]),
      el('fieldset', { className: 'td-choice-group' }, [
        el('legend', { text: 'Draw' }),
        mode('random', 'Random draw'),
        mode('manual', 'Manual draw (draw-a-number events)'),
      ]),
    ];
    // a module that is not available leaves no trace: nothing is rendered for an empty registry
    if (MODULES.length > 0)
      blocks.push(el('p', { className: 'td-note', text: 'Optional modules are chosen here.' }));
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': 'td-setup-h' } },
      [
        el('h2', { id: 'td-setup-h', text: 'Setup' }),
        ...blocks,
        el('p', { className: 'td-note', text: 'Setup is locked as soon as Round 1 starts.' }),
      ],
    );
  }

  function pairsTable(pairs) {
    return el(
      'ol',
      { className: 'td-preview' },
      previewRoundOne(pairs).map((m) =>
        el('li', {
          text: m.bye ? `${nameOf(m.a)} — bye` : `${nameOf(m.a)} vs ${nameOf(m.b)}`,
        }),
      ),
    );
  }

  function startDraw(mode, pairs, seed) {
    const settings = {
      judgeCount: state.form.judgeCount,
      thirdPlace: state.form.thirdPlace,
      seedingMode: mode,
      modules: enabledModules({}),
    };
    return act(
      async () => {
        await saveSettings(state.event.org_id, eventId, settings, client);
        return startEvent(
          {
            orgId: state.event.org_id,
            eventId,
            mode,
            seed,
            slotCount: pairs.length * 2,
            pairs,
          },
          handlers,
        );
      },
      { publish: true },
    );
  }

  function drawCard() {
    const active = activeEntries();
    const mode = state.form.seedingMode;
    const body = [];
    const problemsFor = (pairs) =>
      drawProblems({ mode, pairs, activeEntryIds: active.map((e) => e.id) });
    const problemText = (code) => describeThrowdownError({ hint: code });
    if (mode === 'random') {
      if (active.length < 2) body.push(el('p', { text: 'Add at least two competitors to draw.' }));
      else {
        body.push(
          button(
            state.draw ? 'Draw again' : 'Draw the bracket',
            () => {
              const seed = newSeed();
              state.draw = {
                seed,
                pairs: randomPairs(
                  active.map((e) => e.id),
                  seed,
                ),
              };
              render();
            },
            { className: 'btn btn-outline tap-target', key: 'td-draw' },
          ),
        );
      }
      if (state.draw?.pairs) {
        body.push(
          el('p', {
            className: 'td-note',
            text: `Draw code ${state.draw.seed} (the same code always gives this draw).`,
          }),
          pairsTable(state.draw.pairs),
          button('Start Round 1', () => startDraw('random', state.draw.pairs, state.draw.seed), {
            className: 'btn btn-primary tap-target',
            key: 'td-start',
            disabled: problemsFor(state.draw.pairs).length > 0,
          }),
        );
      }
    } else {
      state.draw ??= { slotCount: Math.max(2, active.length + (active.length % 2)), pairs: null };
      state.draw.pairs ??= emptyBoard(state.draw.slotCount);
      const count = el('input', {
        className: 'field-input',
        attrs: {
          type: 'number',
          min: '2',
          max: '64',
          inputmode: 'numeric',
          value: String(state.draw.slotCount),
          'aria-label': 'Number of slots',
          'data-focus-key': 'td-slots',
        },
      });
      count.addEventListener('change', () => {
        const n = Math.min(64, Math.max(2, Number(count.value) || 2));
        const board = emptyBoard(n);
        state.draw.pairs.forEach((p, i) => {
          if (board[i]) board[i] = [...p];
        });
        state.draw = { slotCount: n, pairs: board };
        render();
      });
      body.push(
        el('label', { className: 'td-choice' }, [document.createTextNode('Slots '), count]),
      );
      const rows = state.draw.pairs.map((pair, i) =>
        el(
          'li',
          { className: 'td-slot-row' },
          [0, 1].map((side) => {
            const select = el(
              'select',
              {
                className: 'field-input',
                attrs: {
                  'aria-label': `Match ${i + 1}, slot ${side + 1}`,
                  'data-focus-key': `td-slot-${i}-${side}`,
                },
              },
              [
                el('option', { text: '— empty —', attrs: { value: '' } }),
                ...active.map((e) =>
                  el('option', { text: e.display_name, attrs: { value: e.id } }),
                ),
              ],
            );
            select.value = pair[side] ?? '';
            select.addEventListener('change', () => {
              state.draw.pairs = assignSlot(state.draw.pairs, i, side, select.value || null);
              render();
            });
            return select;
          }),
        ),
      );
      body.push(el('ol', { className: 'td-board' }, rows));
      const problems = problemsFor(state.draw.pairs);
      body.push(pairsTable(normalisePairs(state.draw.pairs)));
      if (problems.length)
        body.push(el('p', { className: 'td-note', text: problems.map(problemText).join(' ') }));
      body.push(
        button('Start Round 1', () => startDraw('manual', normalisePairs(state.draw.pairs), null), {
          className: 'btn btn-primary tap-target',
          key: 'td-start',
          disabled: problems.length > 0,
        }),
      );
    }
    return el('section', { className: 'card td-card', attrs: { 'aria-labelledby': 'td-draw-h' } }, [
      el('h2', { id: 'td-draw-h', text: 'Draw' }),
      ...body,
    ]);
  }

  function championBanner() {
    const b = state.data.bracket;
    if (!b.champion) return null;
    return el(
      'section',
      { className: 'td-champion', attrs: { role: 'status', 'aria-label': 'Champion' } },
      [
        el('p', { className: 'td-champion-label', text: 'Champion' }),
        el('p', { className: 'td-champion-name', text: b.champion }),
        b.runnerUp ? el('p', { text: `Runner-up: ${b.runnerUp}` }) : null,
        b.thirdPlace ? el('p', { text: `3rd place: ${b.thirdPlace}` }) : null,
      ].filter(Boolean),
    );
  }

  // The count shown for a side: the database's plus taps still waiting to sync.
  function displayedTallies(match) {
    const pending = state.pending.get(match.id) ?? { deltas: new Map(), queued: 0 };
    const slots = match.sides.map((s) => ({
      id: s.slotId,
      position: s.position,
      entryId: s.entryId,
    }));
    const votes = match.sides.flatMap((s) =>
      Array.from({ length: Math.max(0, s.votes + (pending.deltas.get(s.slotId) ?? 0)) }, () => ({
        slotId: s.slotId,
      })),
    );
    return { tallies: tallyVotes(slots, votes), queued: pending.queued };
  }

  function voteCard(match) {
    const { tallies, queued } = displayedTallies(match);
    const lead = leadOf(tallies);
    const judges = state.data.settings.judge_count;
    const sides = match.sides.map((side, i) => {
      const count = tallies.find((t) => t.slotId === side.slotId)?.votes ?? 0;
      return el('div', { className: 'td-side' }, [
        button(
          `Vote ${side.name}`,
          () =>
            act(() =>
              castVote(
                { orgId: state.event.org_id, matchId: match.id, slotId: side.slotId },
                handlers,
              ),
            ),
          {
            className: 'btn btn-primary tap-target td-vote',
            key: `td-vote-${match.id}-${i}`,
          },
        ),
        el('p', {
          className: 'td-count',
          text: `${count} ${count === 1 ? 'vote' : 'votes'}`,
          attrs: { 'aria-live': 'polite' },
        }),
        button(
          'Undo',
          () =>
            act(() =>
              undoVote(
                { orgId: state.event.org_id, matchId: match.id, slotId: side.slotId },
                handlers,
              ),
            ),
          {
            key: `td-undo-${match.id}-${i}`,
            disabled: count === 0,
          },
        ),
      ]);
    });
    const status =
      lead.total === 0
        ? `Waiting for votes (${judges} ${judges === 1 ? 'judge' : 'judges'}).`
        : lead.level
          ? 'The votes are level. Take another vote before confirming.'
          : `${lead.total} of ${judges} votes in.`;
    const winnerName = lead.leaderSlotId
      ? match.sides.find((s) => s.slotId === lead.leaderSlotId)?.name
      : null;
    const walkoverRow =
      state.walkover?.matchId === match.id
        ? el('div', { className: 'td-walkover' }, [
            el('p', {
              text: `${match.sides.find((s) => s.slotId === state.walkover.slotId)?.name} advances by walkover?`,
            }),
            button(
              'Confirm walkover',
              () =>
                act(
                  () =>
                    recordWalkover(
                      {
                        orgId: state.event.org_id,
                        matchId: match.id,
                        winnerSlotId: state.walkover.slotId,
                      },
                      handlers,
                    ),
                  { publish: true },
                ),
              {
                className: 'btn btn-primary tap-target',
                key: `td-walkover-ok-${match.id}`,
              },
            ),
            button(
              'Cancel',
              () => {
                state.walkover = null;
                render();
              },
              { key: `td-walkover-cancel-${match.id}` },
            ),
          ])
        : el('details', { className: 'td-walkover' }, [
            el('summary', { text: 'Walkover (a competitor does not show)' }),
            ...match.sides.map((side, i) =>
              button(
                `${side.name} advances`,
                () => {
                  state.walkover = { matchId: match.id, slotId: side.slotId };
                  render();
                },
                { key: `td-walkover-${match.id}-${i}` },
              ),
            ),
          ]);
    return el(
      'article',
      { className: 'card td-match', attrs: { 'aria-label': matchTitle(match) } },
      [
        el('h3', { text: matchTitle(match) }),
        el('div', { className: 'td-sides' }, sides),
        el('p', {
          className: 'td-note',
          text: status + (queued ? ` ${queued} waiting to sync.` : ''),
        }),
        button(
          winnerName ? `Confirm: ${winnerName} wins` : 'Confirm result',
          () =>
            act(() => confirmMatch({ orgId: state.event.org_id, matchId: match.id }, handlers), {
              publish: true,
            }),
          {
            className: 'btn btn-primary tap-target',
            key: `td-confirm-${match.id}`,
            disabled: !canConfirm(tallies),
          },
        ),
        walkoverRow,
      ],
    );
  }

  function bracketCard() {
    const rounds = state.data.bracket.rounds.map((round) =>
      el('section', { className: 'td-round', attrs: { 'aria-label': round.label } }, [
        el('h3', { text: round.label }),
        el(
          'ul',
          { className: 'td-round-list' },
          round.matches.map((m) => {
            const result = resultLine(m);
            return el('li', { className: 'td-round-match' }, [
              el('span', { text: matchTitle(m) }),
              m.decided
                ? el('span', {
                    className: 'td-result',
                    text: `${m.sides.find((s) => s.winner)?.name ?? ''} — ${result}`,
                  })
                : el('span', {
                    className: 'td-result',
                    text: m.playable ? 'Being decided' : 'Waiting',
                  }),
            ]);
          }),
        ),
      ]),
    );
    return el(
      'section',
      { className: 'card td-card', attrs: { 'aria-labelledby': 'td-bracket-h' } },
      [el('h2', { id: 'td-bracket-h', text: 'Bracket' }), ...rounds],
    );
  }

  // ---------- render ----------

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      const container = el('section', { className: 'screen-container td-screen' });
      if (state.loading) {
        container.appendChild(el('h1', { text: 'Event' }));
        container.appendChild(
          el('div', {
            className: 'screen-feedback',
            text: 'Loading event…',
            attrs: { role: 'status', 'aria-live': 'polite' },
          }),
        );
        root.appendChild(container);
        return false;
      }
      if (state.loadError) {
        container.appendChild(el('h1', { text: 'Event' }));
        const fb = el('div', {
          className: 'screen-feedback',
          text: state.loadError,
          attrs: { role: 'status', 'aria-live': 'polite' },
        });
        fb.dataset.tone = 'error';
        container.append(
          fb,
          button(
            'Retry',
            () => {
              state.loading = true;
              render();
              refresh();
            },
            { key: 'td-retry' },
          ),
        );
        root.appendChild(container);
        return false;
      }
      if (state.event.is_test) {
        container.appendChild(
          el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
        );
      }
      container.appendChild(
        el('h1', { id: 'td-heading', text: state.event.name, attrs: { tabindex: '-1' } }),
      );
      const fb = feedbackNode();
      if (state.feedback?.tone) fb.dataset.tone = state.feedback.tone;
      container.appendChild(fb);
      const banner = championBanner();
      if (banner) container.appendChild(banner);
      if (!state.data.bracket.started) {
        container.append(competitorsCard(), setupCard(), drawCard());
      } else {
        const playable = state.data.bracket.playableMatches;
        container.appendChild(
          el('section', { className: 'td-now', attrs: { 'aria-labelledby': 'td-now-h' } }, [
            el('h2', {
              id: 'td-now-h',
              text: playable.length
                ? 'Now playing'
                : state.data.bracket.complete
                  ? 'Finished'
                  : 'Waiting for results',
            }),
            ...playable.map(voteCard),
          ]),
        );
        container.append(bracketCard(), competitorsCard());
      }
      root.appendChild(container);
      return false;
    });
  }

  render();
  await refresh();

  return {
    unmount() {
      // No timers or listeners outside the nodes the router removes.
    },
  };
}
