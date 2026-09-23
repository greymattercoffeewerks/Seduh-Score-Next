// BTC bracket screen (Phase T-BTC.2, sub-step 6). Organiser-facing: generate the
// top-8 bracket from preliminary standings, then create each round's matches as their
// two teams become known. Scoring a bracket match itself is scoringScreen.js's job
// (unchanged by this screen) — advancement into the next slot happens automatically,
// server-side, inside confirm_btc_match once that scoring confirm lands, so there is
// nothing for THIS screen to do after a match is created except show its status.
//
// Same loading/error/retry/toast/focus shape every other BTC screen uses (see
// matchesScreen.js's own header for the fuller account of where that shape came from
// across setupScreen.js's three review rounds).
import { getSupabase } from '../../core/supabaseClient.js';
import { el, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import {
  BRACKET_ROUND_ORDER,
  BRACKET_ROUND_LABELS,
  validateBracketMatchJudges,
  generateBracket,
  createBracketMatch,
  fetchBracket,
} from './bracket.js';

// btc_matches.status is pending | scoring | confirmed (supabase/migrations/
// 20260918090000_btc_tables.sql) — pending and scoring must stay distinct here: a
// scored-in-progress match (a judge already has partial votes entered via
// scoringScreen.js) is materially different from one nobody has touched yet.
function matchStatusLabel(match) {
  if (!match) return null;
  if (match.status === 'confirmed') return 'Confirmed';
  if (match.status === 'scoring') return 'Scoring in progress';
  return 'Match scheduled — not yet scored';
}

export async function mountBracketScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  let state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    teams: [],
    judges: [],
    entries: [], // [{slot, match}], sorted into bracket display order
    generating: false,
    creatingSlotId: null,
    lastClosedSlotId: null,
    draftJudgeIds: [],
    formError: null,
    busy: false,
    toastMessage: null,
    // null | 'heading' | 'toast' | 'create-form' | 'create-button' — see
    // setupScreen.js's own comment on this pendingFocus shape.
    pendingFocus: null,
  };
  let toastTimer;

  function teamName(id) {
    if (!id) return 'TBD';
    return state.teams.find((t) => t.id === id)?.name ?? 'Unknown team';
  }

  function showToast(message) {
    state.toastMessage = message;
    state.pendingFocus = 'toast';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.toastMessage = null;
      render();
    }, 1500);
  }

  async function loadPersisted() {
    const [event, teams, judges, entries] = await Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      listJudges(eventId, client),
      fetchBracket(eventId, client),
    ]);
    return { event, teams, judges, entries };
  }

  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.event = persisted.event;
      state.teams = persisted.teams;
      state.judges = persisted.judges;
      state.entries = persisted.entries;
      state.loadFailedMessage = null;
      state.pendingFocus = 'heading';
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  async function handleGenerateBracket() {
    if (state.generating) return;
    state.generating = true;
    render();
    try {
      await generateBracket(state.event.org_id, eventId, client);
      state.entries = await fetchBracket(eventId, client);
      showToast('Bracket generated.');
    } catch (err) {
      showToast(describeError(err));
    }
    state.generating = false;
    render();
  }

  function openCreateForm(slotId) {
    state.creatingSlotId = slotId;
    state.draftJudgeIds = [];
    state.formError = null;
    state.pendingFocus = 'create-form';
    render();
  }

  function closeCreateForm() {
    state.lastClosedSlotId = state.creatingSlotId;
    state.creatingSlotId = null;
    state.draftJudgeIds = [];
    state.formError = null;
    state.pendingFocus = 'create-button';
    render();
  }

  // Same cap-at-3-and-always-re-render shape as matchesScreen.js's own
  // toggleDraftJudge — see that screen's comment for why the re-render is needed even
  // on a rejected 4th check (the browser already flipped the checkbox before this
  // handler runs; the re-render is what snaps it back).
  function toggleDraftJudge(judgeId, checked) {
    if (checked && state.draftJudgeIds.length >= 3 && !state.draftJudgeIds.includes(judgeId)) {
      render();
      return;
    }
    state.draftJudgeIds = checked
      ? [...state.draftJudgeIds, judgeId]
      : state.draftJudgeIds.filter((id) => id !== judgeId);
    render();
  }

  async function handleCreateBracketMatch(domEvent, entry) {
    domEvent.preventDefault();
    if (state.busy) return;
    const validationMessage = validateBracketMatchJudges(state.draftJudgeIds);
    if (validationMessage) {
      state.formError = validationMessage;
      render();
      return;
    }
    state.busy = true;
    state.formError = null;
    render();
    try {
      const match = await createBracketMatch(
        state.event.org_id,
        entry.slot.id,
        state.draftJudgeIds,
        client,
      );
      state.entries = state.entries.map((e) =>
        e.slot.id === entry.slot.id
          ? {
              slot: { ...e.slot, match_id: match.id },
              match: { id: match.id, status: match.status },
            }
          : e,
      );
      const label = `${teamName(entry.slot.team1_id)} vs ${teamName(entry.slot.team2_id)}`;
      state.creatingSlotId = null;
      state.draftJudgeIds = [];
      showToast(`${label} match created.`);
    } catch (err) {
      state.formError = describeError(err);
    }
    state.busy = false;
    render();
  }

  function renderSlotCard(entry) {
    const { slot, match } = entry;
    const teamsLine = el('span', {
      className: 'btc-match-teams',
      text: `${teamName(slot.team1_id)} vs ${teamName(slot.team2_id)}`,
    });
    const children = [teamsLine];

    const statusLabel = matchStatusLabel(match);
    if (statusLabel) {
      children.push(el('span', { className: 'stage-meta', text: statusLabel }));
      children.push(
        el('a', {
          className: 'btn btn-outline tap-target',
          text: 'Score',
          attrs: {
            href: `#/events/${eventId}/btc/matches/${match.id}/scoring`,
            'aria-label': `Score ${teamName(slot.team1_id)} vs ${teamName(slot.team2_id)}`,
          },
        }),
      );
    } else if (slot.team1_id && slot.team2_id) {
      if (state.creatingSlotId === slot.id) {
        children.push(renderCreateForm(entry));
      } else {
        const createButton = el('button', {
          className: 'btn btn-primary tap-target',
          text: 'Create match',
          attrs: {
            type: 'button',
            'aria-label': `Create match for ${teamName(slot.team1_id)} vs ${teamName(slot.team2_id)}`,
            'data-focus-key': `create-slot-${slot.id}`,
          },
        });
        setBusyDisabled(createButton, state.busy || state.generating);
        createButton.addEventListener('click', () => openCreateForm(slot.id));
        children.push(createButton);
      }
    } else {
      children.push(
        el('span', { className: 'stage-meta', text: 'Waiting on an earlier round to finish' }),
      );
    }

    return el('li', { className: 'btc-bracket-slot' }, children);
  }

  function renderCreateForm(entry) {
    const errorId = `btc-bracket-form-error-${entry.slot.id}`;

    const judgeCheckboxes = state.judges.map((judge) => {
      const checkbox = el('input', {
        attrs: { type: 'checkbox', 'data-field': `bracket-judge-${judge.id}` },
      });
      checkbox.checked = state.draftJudgeIds.includes(judge.id);
      setBusyDisabled(checkbox, state.busy);
      checkbox.addEventListener('change', () => toggleDraftJudge(judge.id, checkbox.checked));
      return el('label', { className: 'btc-judge-checkbox-label' }, [
        checkbox,
        el('span', { text: judge.name }),
      ]);
    });

    const submitButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.busy ? 'Creating…' : 'Create match',
      attrs: {
        type: 'submit',
        'data-focus-key': `create-slot-submit-${entry.slot.id}`,
        ...(state.formError ? { 'aria-describedby': errorId } : {}),
      },
    });
    setBusyDisabled(submitButton, state.busy);

    const cancelButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: { type: 'button', 'data-focus-key': `create-slot-cancel-${entry.slot.id}` },
    });
    setBusyDisabled(cancelButton, state.busy);
    cancelButton.addEventListener('click', () => closeCreateForm());

    const form = el(
      'form',
      { className: 'btc-bracket-create-form' },
      [
        el('fieldset', { className: 'btc-judge-fieldset' }, [
          el('legend', {
            text: 'Judges (select exactly 3)',
            attrs: { tabindex: '-1', 'data-focus-key': `create-form-heading-${entry.slot.id}` },
          }),
          el('div', { className: 'btc-judge-checkboxes' }, judgeCheckboxes),
          el('p', {
            className: 'stage-meta',
            text: `${state.draftJudgeIds.length} of 3 selected`,
            attrs: { role: 'status', 'aria-live': 'polite' },
          }),
        ]),
        state.formError
          ? el('p', {
              id: errorId,
              className: 'btc-field-error',
              text: state.formError,
              attrs: { role: 'alert' },
            })
          : null,
        el('div', { className: 'btc-bracket-form-actions' }, [submitButton, cancelButton]),
      ].filter(Boolean),
    );
    form.addEventListener('submit', (domEvent) => handleCreateBracketMatch(domEvent, entry));

    return form;
  }

  function renderBracket() {
    const byRound = new Map(BRACKET_ROUND_ORDER.map((round) => [round, []]));
    for (const entry of state.entries) {
      byRound.get(entry.slot.round)?.push(entry);
    }

    const sections = BRACKET_ROUND_ORDER.filter((round) => byRound.get(round).length > 0).map(
      (round) =>
        el('div', { className: 'card btc-bracket-round' }, [
          el('h2', { text: BRACKET_ROUND_LABELS[round] }),
          el(
            'ul',
            {
              className: 'btc-bracket-slot-list',
              attrs: { 'aria-label': BRACKET_ROUND_LABELS[round] },
            },
            byRound.get(round).map(renderSlotCard),
          ),
        ]),
    );

    return el('div', { className: 'btc-bracket-rounds' }, sections);
  }

  function renderGenerateCard() {
    const generateButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.generating ? 'Generating…' : 'Generate bracket',
      attrs: { type: 'button', 'data-focus-key': 'generate-bracket' },
    });
    setBusyDisabled(generateButton, state.generating);
    generateButton.addEventListener('click', () => handleGenerateBracket());

    return el('div', { className: 'card' }, [
      el('h2', { text: 'Bracket' }),
      el('p', {
        className: 'stage-meta',
        text: 'Every preliminary match must be confirmed and at least 8 teams must have a result before the bracket can be generated. An unresolved tie for the 8th qualifying spot blocks generation until it is resolved.',
      }),
      generateButton,
    ]);
  }

  function renderLoading() {
    root.appendChild(
      el('section', { className: 'screen-container btc-bracket-screen' }, [
        el('h1', { text: 'Bracket' }),
        el('div', {
          className: 'screen-feedback',
          text: 'Loading bracket…',
          attrs: { role: 'status', 'aria-live': 'polite' },
        }),
      ]),
    );
  }

  function renderLoadError() {
    const feedback = el('div', {
      className: 'screen-feedback',
      text: state.loadFailedMessage,
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    feedback.dataset.tone = 'error';
    const retryButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retryButton.addEventListener('click', () => attemptLoad());
    root.appendChild(
      el('section', { className: 'screen-container btc-bracket-screen' }, [
        el('h1', { text: 'Bracket' }),
        feedback,
        retryButton,
      ]),
    );
    feedback.focus();
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';

      if (state.loading) {
        renderLoading();
        return undefined;
      }
      if (state.loadFailedMessage) {
        renderLoadError();
        return true;
      }

      const container = el('section', { className: 'screen-container btc-bracket-screen' });

      if (state.event?.is_test) {
        container.appendChild(
          el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
        );
      }

      container.appendChild(el('h1', { text: 'Bracket', attrs: { tabindex: '-1' } }));

      if (state.entries.length === 0) {
        container.appendChild(renderGenerateCard());
      } else {
        container.appendChild(renderBracket());
      }

      let toastNode = null;
      if (state.toastMessage) {
        toastNode = el('div', {
          className: 'screen-feedback',
          text: state.toastMessage,
          attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
        });
        container.appendChild(toastNode);
      }

      root.appendChild(container);

      if (state.pendingFocus === 'heading') {
        state.pendingFocus = null;
        const heading = container.querySelector('h1');
        if (heading) {
          heading.focus();
          return true;
        }
      } else if (state.pendingFocus === 'toast') {
        state.pendingFocus = null;
        if (toastNode) {
          toastNode.focus();
          return true;
        }
      } else if (state.pendingFocus === 'create-form') {
        state.pendingFocus = null;
        const formHeading = container.querySelector(
          `[data-focus-key="create-form-heading-${state.creatingSlotId}"]`,
        );
        if (formHeading) {
          formHeading.focus();
          return true;
        }
      } else if (state.pendingFocus === 'create-button') {
        state.pendingFocus = null;
        const createButton = container.querySelector(
          `[data-focus-key="create-slot-${state.lastClosedSlotId}"]`,
        );
        if (createButton) {
          createButton.focus();
          return true;
        }
      }
      return undefined;
    });
  }

  await attemptLoad();

  return {
    unmount() {
      clearTimeout(toastTimer);
    },
  };
}
