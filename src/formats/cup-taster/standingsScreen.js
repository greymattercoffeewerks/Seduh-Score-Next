// Standings and advancement screen (handoff §14 T4.6, §7.2, §7.3). Rebuild-
// then-refocus (§15.3) for every action, matching every other Cup Taster
// screen's own "full rebuild per action" pattern — this screen's actions
// (create a tiebreak heat, record a coin toss, commit advancement) are all
// low-frequency, organiser-driven, not per-second-tick or per-tap, so there's
// no reason to depart from the simplest pattern the other screens already
// use.
//
// State machine, one stage at a time:
//   not-ready          — some heat isn't confirmed yet; standings shown live,
//                         no action offered.
//   clean               — no border tie; "Advance"/"Declare champion" ready.
//   needs-tiebreak-heat — a border tie exists, no tiebreak heat created yet.
//   tiebreak-pending    — the tiebreak heat exists, not yet confirmed.
//   tiebreak-resolved   — the tiebreak heat is confirmed and broke the tie
//                         cleanly; "Advance"/"Declare champion" ready.
//   needs-coin-toss     — the tiebreak heat ALSO drew (§7.2); the organiser
//                         selects winners and records a note in one action.
//   complete            — this stage has already been committed.
//
// Each of `clean`/`tiebreak-resolved`/`needs-coin-toss` ends in the SAME
// single commit action (standings.js's commitStageResolution) — a coin toss
// selection is never persisted as its own intermediate step, only submitted
// together with the final advancement in one atomic write, the same "one
// atomic action" preference T4.5's Confirm established for this project.
import { findEvent } from '../../core/events.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { listHeatsForStage } from './heats.js';
import {
  fetchStandingsForStage,
  resolveAdvancement,
  createTiebreakHeatForTie,
  fetchTiebreakHeatOutcome,
  belowTheLine,
  commitStageResolution,
  findNextStage,
} from './standings.js';

function statusLabel(item, { advancingIds, tiedBorderIds }) {
  if (advancingIds.has(item.stageEntryId)) return 'advancing';
  if (tiedBorderIds.has(item.stageEntryId)) return 'tied';
  return null;
}

// Pure. `advancingIds`/`tiedBorderIds` are Sets of `stageEntryId`, letting
// the caller mark whichever rows are provisionally advancing or tied at the
// point this table is drawn — before, during, or after tiebreak/coin-toss
// resolution, the same renderer works, just with a different membership.
export function renderStandingsTable(
  ranked,
  { advancingIds = new Set(), tiedBorderIds = new Set() } = {},
) {
  const rows = ranked.map(({ item, position }) => {
    const label = statusLabel(item, { advancingIds, tiedBorderIds });
    return el('tr', { className: 'standings-row', attrs: label ? { 'data-status': label } : {} }, [
      el('td', {
        className: 'standings-position',
        text: String(position),
        attrs: { 'data-label': 'Pos' },
      }),
      el('td', {
        className: 'standings-name',
        text: item.displayName,
        attrs: { 'data-label': 'Cupper' },
      }),
      el('td', {
        className: 'standings-correct',
        text: String(item.numCorrect),
        attrs: { 'data-label': 'Correct' },
      }),
      el('td', {
        className: 'standings-time',
        text: item.total_elapsed_secs == null ? '—' : `${item.total_elapsed_secs}s`,
        attrs: { 'data-label': 'Time' },
      }),
      el('td', {
        className: 'standings-status',
        text: label ?? '',
        attrs: { 'data-label': 'Status' },
      }),
    ]);
  });

  return el('table', { className: 'standings-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Pos' }),
        el('th', { text: 'Cupper' }),
        el('th', { text: 'Correct' }),
        el('th', { text: 'Time' }),
        el('th', { text: 'Status' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

export async function mountStandingsScreen(
  root,
  { eventId, stageId, client = getSupabase() } = {},
) {
  let focusAfterRender = null;
  let pendingError = null;
  let pendingSuccess = null;
  let renderGeneration = 0;
  let actionInFlight = false;
  // Coin-toss selection is local, ephemeral UI state — never persisted until
  // the single commit action fires (see the module comment above). Reset on
  // every load so a re-render after an unrelated action (or a stale
  // selection from a previous stage's needs-coin-toss state) never leaks
  // into a fresh resolution.
  let coinTossWinnerIds = new Set();
  let coinTossNoteDraft = '';

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  async function renderOrShowError(feedback) {
    try {
      await render();
    } catch (err) {
      setFeedback(feedback, describeError(err), 'error');
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  // Assembles everything render() needs to decide which state the stage is
  // in, doing the minimum extra I/O for each: the tiebreak heat's own
  // outcome is only fetched once one exists and is confirmed.
  async function loadState() {
    const event = await findEvent(eventId, client);
    const { stage, ranked } = await fetchStandingsForStage(stageId, client);
    const heats = await listHeatsForStage(stageId, client);
    const normalHeats = heats.filter(({ heat }) => heat.kind === 'normal');
    const allNormalHeatsConfirmed =
      normalHeats.length > 0 && normalHeats.every(({ heat }) => heat.status === 'confirmed');

    const effectiveCutoff = stage.cutoff ?? 1;
    const stageLevel = resolveAdvancement(ranked, effectiveCutoff);

    const tiebreakHeatEntry = heats.find(({ heat }) => heat.kind === 'tiebreak');
    let tiebreakOutcome = null;
    if (tiebreakHeatEntry && tiebreakHeatEntry.heat.status === 'confirmed') {
      const slotsRemaining = effectiveCutoff - stageLevel.advancing.length;
      const tiebreakRanked = await fetchTiebreakHeatOutcome(tiebreakHeatEntry.heat, ranked, client);
      tiebreakOutcome = {
        ranked: tiebreakRanked,
        ...resolveAdvancement(tiebreakRanked, slotsRemaining),
      };
    }

    const nextStage = stage.status === 'complete' ? null : await findNextStage(stage, client);

    return {
      event,
      stage,
      ranked,
      effectiveCutoff,
      allNormalHeatsConfirmed,
      pendingHeatCount: normalHeats.filter(({ heat }) => heat.status !== 'confirmed').length,
      stageLevel,
      tiebreakHeat: tiebreakHeatEntry?.heat ?? null,
      tiebreakOutcome,
      nextStage,
    };
  }

  // Pure, from already-loaded `data` — the single source of truth for which
  // of the module comment's named states this render is in, and everything
  // the render/commit logic needs to act on it.
  function deriveState(data) {
    if (data.stage.status === 'complete') return { kind: 'complete' };
    if (!data.allNormalHeatsConfirmed) {
      return { kind: 'not-ready', pendingHeatCount: data.pendingHeatCount };
    }
    if (!data.stageLevel.tiebreakNeeded) {
      return { kind: 'clean', advancing: data.stageLevel.advancing };
    }
    if (!data.tiebreakHeat) {
      return { kind: 'needs-tiebreak-heat', tiedAtBorder: data.stageLevel.tiedAtBorder };
    }
    if (data.tiebreakHeat.status !== 'confirmed') {
      return { kind: 'tiebreak-pending', tiebreakHeat: data.tiebreakHeat };
    }
    if (!data.tiebreakOutcome.tiebreakNeeded) {
      return {
        kind: 'tiebreak-resolved',
        tiebreakRanked: data.tiebreakOutcome.ranked,
        tiebreakWinners: data.tiebreakOutcome.advancing,
      };
    }
    const slotsAfterTiebreakWinners =
      data.effectiveCutoff -
      data.stageLevel.advancing.length -
      data.tiebreakOutcome.advancing.length;
    return {
      kind: 'needs-coin-toss',
      tiebreakRanked: data.tiebreakOutcome.ranked,
      tiebreakWinners: data.tiebreakOutcome.advancing,
      stillTied: data.tiebreakOutcome.tiedAtBorder,
      slotsRemaining: slotsAfterTiebreakWinners,
    };
  }

  // Builds the exact plan commitStageResolution expects, for whichever
  // resolved state (`clean`, `tiebreak-resolved`, or a submitted
  // `needs-coin-toss` selection) the organiser is committing.
  function buildCommitPlan(data, resolved) {
    // `stage.cutoff == null` is the authoritative "is this the terminal
    // stage" signal (matching render()'s own check) — NOT `nextStage ===
    // null`. In a correctly-seeded event those always agree, but they're
    // different facts: a cutoff stage whose next stage is missing is a
    // stage-plan data problem, not evidence this is secretly terminal, and
    // silently treating it as terminal would commit a champion where an
    // "advance" was actually meant. Caught explicitly below instead.
    const isTerminal = data.stage.cutoff == null;
    if (!isTerminal && !data.nextStage) {
      throw new Error(
        `stage ${data.stage.id} has a cutoff but no next stage exists at ordinal ${data.stage.ordinal + 1} — the stage plan may be incomplete`,
      );
    }
    const advancingEntries = [
      ...data.stageLevel.advancing.map(({ item }) => ({
        entryId: item.entry_id,
        source: 'advanced',
      })),
      ...(resolved.tiebreakWinners ?? []).map(({ item }) => ({
        entryId: item.entry_id,
        source: 'tiebreak_won',
      })),
      ...(resolved.coinTossWinners ?? []).map(({ item }) => ({
        entryId: item.entry_id,
        source: 'coin_toss',
      })),
    ];

    // Derived directly from the tiebreak heat's own FULL ranking, not from
    // ad-hoc "loser" lists built up in the UI — found in review
    // (scoring-auditor): when the original border tie has 3+ members and
    // the tiebreak heat itself only partially resolves it (e.g. one clear
    // winner, a smaller sub-tie needing a coin toss, AND a cupper ranked
    // distinctly below that sub-tie), that last cupper is never a member of
    // ANY `tiedAtBorder` group at any level — core/advancement's own
    // break-without-visiting loop never even forms a group for them — so an
    // eliminated list built only from "the tiebreak's tiedAtBorder" or "the
    // coin toss's losers" silently omits them, leaving their
    // `ct_stage_entries` row with no `final_position` forever, on a stage
    // the UI reports as closed. Everyone the tiebreak heat covered
    // (`resolved.tiebreakRanked`) who isn't advancing IS eliminated, full
    // stop — this single derivation is correct regardless of how many
    // sub-groups the tiebreak heat's ranking produces. `viaCoinToss` (for
    // the position_note) is true only for the entries that were actually
    // IN the coin-toss-eligible group (`resolved.stillTied`), not for
    // anyone the tiebreak heat's own ranking already decided outright.
    const tiebreakAdvancedIds = new Set(
      [...(resolved.tiebreakWinners ?? []), ...(resolved.coinTossWinners ?? [])].map(
        ({ item }) => item.entry_id,
      ),
    );
    const coinTossEligibleIds = new Set(
      (resolved.stillTied ?? []).map(({ item }) => item.entry_id),
    );
    const eliminated = (resolved.tiebreakRanked ?? [])
      .filter(({ item }) => !tiebreakAdvancedIds.has(item.entry_id))
      .map(({ item }) => ({
        stageEntryId: item.stageEntryId,
        viaCoinToss: coinTossEligibleIds.has(item.entry_id),
      }));

    const belowCutoff = belowTheLine(
      data.ranked,
      data.stageLevel.advancing,
      data.stageLevel.tiedAtBorder,
    ).map(({ item, position }) => ({ stageEntryId: item.stageEntryId, position }));

    const winner = advancingEntries.length === 1 ? advancingEntries[0] : null;

    return {
      stage: data.stage,
      nextStage: data.nextStage,
      advancingEntries,
      championStageEntryId: isTerminal && winner ? findStageEntryId(data, winner.entryId) : null,
      eliminated,
      finalPosition: data.effectiveCutoff + 1,
      belowCutoff,
      coinTossNote: resolved.coinTossNote ?? null,
    };
  }

  function findStageEntryId(data, entryId) {
    const found = data.ranked.find(({ item }) => item.entry_id === entryId);
    return found?.item.stageEntryId ?? null;
  }

  // Returns whether the commit actually succeeded — `false` covers both a
  // real failure and the reentrancy guard bouncing a duplicate call; today's
  // callers only use this to gate focus movement, where both cases correctly
  // mean "don't move focus for this call" (found in review,
  // ui-accessibility-reviewer: `focusAfterRender` was being set
  // unconditionally by every caller, sending focus to the unchanged
  // "Standings" heading even on failure, instead of heatsScreen.js's own
  // established pattern of only claiming focus on the success path and
  // otherwise falling through to render()'s own error-region focus).
  async function commit(data, resolved) {
    if (actionInFlight) return false;
    actionInFlight = true;
    let succeeded = false;
    try {
      const plan = buildCommitPlan(data, resolved);
      await commitStageResolution(plan, client);
      pendingSuccess =
        data.stage.cutoff == null ? 'Champion declared.' : 'Advanced to the next stage.';
      succeeded = true;
    } catch (err) {
      pendingError = describeError(err);
    }
    actionInFlight = false;
    return succeeded;
  }

  async function render() {
    const myGeneration = ++renderGeneration;
    const data = await loadState();
    if (myGeneration !== renderGeneration) return;

    root.innerHTML = '';
    const container = el('section', { className: 'screen-container standings-screen' });

    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(
      el('h1', { text: `Standings — ${data.stage.kind} (Stage ${data.stage.ordinal})` }),
    );

    const feedback = el('div', {
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      setFeedback(feedback, pendingError, 'error');
      pendingError = null;
    } else if (pendingSuccess) {
      setFeedback(feedback, pendingSuccess, 'success');
      pendingSuccess = null;
    }

    const state = deriveState(data);
    // Derived from `stage.cutoff`, not `data.nextStage === null` — the next
    // stage is deliberately never fetched once this stage is already
    // `complete` (see loadState), which would otherwise make every closed
    // cutoff stage misreport itself as terminal here.
    const isTerminal = data.stage.cutoff == null;
    const advancingIds = new Set(data.stageLevel.advancing.map(({ item }) => item.stageEntryId));
    const tiedBorderIds = new Set(
      data.stageLevel.tiedAtBorder.map(({ item }) => item.stageEntryId),
    );

    container.appendChild(
      el('div', { className: 'card' }, [
        el('h2', { text: 'Standings', attrs: { tabindex: '-1' }, id: 'standings-heading' }),
        renderStandingsTable(data.ranked, { advancingIds, tiedBorderIds }),
      ]),
    );

    if (state.kind === 'complete') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: isTerminal
              ? 'Champion declared. This stage is closed.'
              : 'Advanced. This stage is closed.',
          }),
        ]),
      );
    } else if (state.kind === 'not-ready') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: `Waiting on ${state.pendingHeatCount} more heat${state.pendingHeatCount === 1 ? '' : 's'} to be confirmed before standings are final.`,
          }),
        ]),
      );
    } else if (state.kind === 'clean') {
      const button = el('button', {
        className: 'btn btn-primary tap-target',
        text: isTerminal ? 'Declare champion' : 'Advance to next stage',
        attrs: actionInFlight ? { disabled: 'disabled' } : {},
      });
      button.addEventListener('click', async () => {
        const succeeded = await commit(data, {});
        if (succeeded) focusAfterRender = '#standings-heading';
        await renderOrShowError(feedback);
      });
      container.appendChild(el('div', { className: 'card' }, [button]));
    } else if (state.kind === 'needs-tiebreak-heat') {
      const button = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Create tiebreak heat',
        attrs: actionInFlight ? { disabled: 'disabled' } : {},
      });
      button.addEventListener('click', async () => {
        if (actionInFlight) return;
        actionInFlight = true;
        try {
          await createTiebreakHeatForTie(stageId, state.tiedAtBorder, {}, client);
          focusAfterRender = '#standings-heading';
        } catch (err) {
          pendingError = describeError(err);
        }
        actionInFlight = false;
        await renderOrShowError(feedback);
      });
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: `${state.tiedAtBorder.length} cuppers are tied at the border and need a tiebreak heat.`,
          }),
          button,
        ]),
      );
    } else if (state.kind === 'tiebreak-pending') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: `Tiebreak heat ${state.tiebreakHeat.heat_number} is "${state.tiebreakHeat.status}" — run and confirm it via the timing and scoring screens before advancement can be recorded.`,
          }),
        ]),
      );
    } else if (state.kind === 'tiebreak-resolved') {
      const button = el('button', {
        className: 'btn btn-primary tap-target',
        text: isTerminal ? 'Declare champion' : 'Advance to next stage',
        attrs: actionInFlight ? { disabled: 'disabled' } : {},
      });
      button.addEventListener('click', async () => {
        const succeeded = await commit(data, {
          tiebreakRanked: state.tiebreakRanked,
          tiebreakWinners: state.tiebreakWinners,
        });
        if (succeeded) focusAfterRender = '#standings-heading';
        await renderOrShowError(feedback);
      });
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', { text: 'The tiebreak heat resolved the tie.' }),
          button,
        ]),
      );
    } else if (state.kind === 'needs-coin-toss') {
      container.appendChild(renderCoinTossCard(state, data, feedback));
    }

    container.appendChild(feedback);
    root.appendChild(container);

    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone) {
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  function renderCoinTossCard(state, data, feedback) {
    // Matches render()'s/buildCommitPlan's own `isTerminal` signal exactly —
    // found in review (code-reviewer + scoring-auditor, independently): this
    // line still used `data.nextStage === null` after every OTHER isTerminal
    // check in this file was fixed to use `stage.cutoff == null` instead,
    // reintroducing the same mislabeling risk (a cutoff stage with a missing
    // next-stage row) one function away from where it was closed.
    const isTerminal = data.stage.cutoff == null;
    const list = el(
      'ul',
      { className: 'coin-toss-list' },
      state.stillTied.map(({ item }) => {
        const checkbox = el('input', {
          id: `coin-toss-${item.entry_id}`,
          attrs: {
            type: 'checkbox',
            ...(coinTossWinnerIds.has(item.entry_id) ? { checked: 'checked' } : {}),
          },
        });
        // Deliberately NOT re-rendered here — this card's own selection/note
        // state is local and ephemeral (see the module comment above); a
        // full rebuild via render() would re-run loadState()'s whole DB read
        // just to reflect a checkbox toggle. Both the selection count and
        // the note are validated once, together, at submit time below,
        // rather than reactively gating the button.
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) coinTossWinnerIds.add(item.entry_id);
          else coinTossWinnerIds.delete(item.entry_id);
        });
        const label = el('label', {
          attrs: { for: `coin-toss-${item.entry_id}` },
          text: item.displayName,
        });
        return el('li', {}, [checkbox, label]);
      }),
    );

    const noteInput = el('input', {
      id: 'coin-toss-note',
      className: 'field-input coin-toss-note',
      attrs: {
        type: 'text',
        placeholder: 'e.g. coin toss, witnessed by …',
        value: coinTossNoteDraft,
      },
    });
    noteInput.addEventListener('input', () => {
      coinTossNoteDraft = noteInput.value;
    });

    const submitButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: isTerminal ? 'Record coin toss and declare champion' : 'Record coin toss and advance',
      attrs: actionInFlight ? { disabled: 'disabled' } : {},
    });
    submitButton.addEventListener('click', async () => {
      if (coinTossWinnerIds.size !== state.slotsRemaining) {
        pendingError = `Select exactly ${state.slotsRemaining} winner${state.slotsRemaining === 1 ? '' : 's'} before recording the coin toss.`;
        await renderOrShowError(feedback);
        return;
      }
      if (coinTossNoteDraft.trim() === '') {
        pendingError = 'A note is required to record a coin toss (e.g. who witnessed it).';
        await renderOrShowError(feedback);
        return;
      }
      const winners = state.stillTied.filter(({ item }) => coinTossWinnerIds.has(item.entry_id));
      const succeeded = await commit(data, {
        tiebreakRanked: state.tiebreakRanked,
        tiebreakWinners: state.tiebreakWinners,
        stillTied: state.stillTied,
        coinTossWinners: winners,
        coinTossNote: coinTossNoteDraft.trim(),
      });
      if (succeeded) {
        // Only cleared on success — a failed submit (network blip, RLS
        // denial) shouldn't force the organiser to re-select winners and
        // re-type the witness note from scratch.
        coinTossWinnerIds = new Set();
        coinTossNoteDraft = '';
        focusAfterRender = '#standings-heading';
      }
      await renderOrShowError(feedback);
    });

    return el('div', { className: 'card' }, [
      el('p', {
        text: `The tiebreak heat also drew. Select exactly ${state.slotsRemaining} winner${state.slotsRemaining === 1 ? '' : 's'} by coin toss and record who witnessed it.`,
      }),
      list,
      el('label', { attrs: { for: 'coin-toss-note' }, text: 'Note' }),
      noteInput,
      submitButton,
    ]);
  }

  await render();

  return {
    unmount() {
      renderGeneration++;
    },
  };
}
