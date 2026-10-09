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
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { publishBtcLive } from './liveSession.js';
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
  bracketMatchIds,
  fetchBracketScores,
} from './bracket.js';
import { derivePodium } from './podium.js';
import {
  TIEBREAK_REASON_MAX,
  tieState,
  validateTiebreak,
  recordTiebreak,
  tiebreakRefusal,
  describeTiebreakError,
} from './tiebreak.js';

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

export async function mountBracketScreen(
  root,
  { eventId, client = getSupabase(), signal, handlers } = {},
) {
  let state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    teams: [],
    judges: [],
    entries: [], // [{slot, match}], sorted into bracket display order
    // btc_match_scores rows for every bracket match (the podium and each slot's tie state
    // read these). Only a CONFIRM changes them, and confirming happens on the scoring screen,
    // so this screen remounts (and reloads them) before they can differ — hence no refresh
    // after generate/create-match, which cannot produce a confirmed result. Recording a
    // tie-break does move seats and the match row, so that handler reloads both.
    scores: [],
    generating: false,
    creatingSlotId: null,
    lastClosedSlotId: null,
    draftJudgeIds: [],
    formError: null,
    busy: false,
    toastMessage: null,
    // The tie-break form (one slot at a time, like the create-match form). tiebreakError is
    // { field: 'winner' | 'reason' | 'form', message } so the message can be tied to the control
    // it is about.
    tiebreakSlotId: null,
    lastClosedTiebreakSlotId: null,
    draftTiebreakWinner: null,
    draftTiebreakReason: '',
    tiebreakError: null,
    // null | 'heading' | 'toast' | 'create-form' | 'create-button' | 'tiebreak-form' |
    // 'tiebreak-error' | 'tiebreak-button' — see setupScreen.js's own comment on this
    // pendingFocus shape.
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
    // Needs the match ids, so it cannot join the Promise.all above. Deliberately NOT
    // degraded on failure: a podium that silently showed "Not decided yet" because its read
    // failed would be a lie, so a failed read fails the load and Retry covers it.
    const scores = await fetchBracketScores(bracketMatchIds(entries), client);
    return { event, teams, judges, entries, scores };
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
      state.scores = persisted.scores;
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

  // The audience display follows every change the room should see (liveSession.js). Best-effort: a failed or
  // offline publish stays queued and changes nothing about the action that triggered it. A programming error
  // (no handler map, an event without is_test) rejects, so it is logged here rather than left unhandled.
  function requestLivePublish(takeOver) {
    publishBtcLive({ event: state.event, takeOver }, handlers).catch((error) => {
      console.error('btc: live-view publish was refused', error);
    });
  }

  async function handleGenerateBracket() {
    if (state.generating) return;
    state.generating = true;
    render();
    try {
      await generateBracket(state.event.org_id, eventId, client);
      // The bracket exists from here on, whether or not the re-read below succeeds.
      requestLivePublish(false);
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
      requestLivePublish(false);
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

  function resetTiebreakDraft() {
    state.lastClosedTiebreakSlotId = state.tiebreakSlotId;
    state.tiebreakSlotId = null;
    state.draftTiebreakWinner = null;
    state.draftTiebreakReason = '';
    state.tiebreakError = null;
  }

  // While a save is in flight every tie-break control is inert: the handlers below all stop on
  // state.busy, because setBusyDisabled only marks controls aria-disabled and they would still fire.
  function openTiebreakForm(entry) {
    if (state.busy) return;
    state.tiebreakSlotId = entry.slot.id;
    // Changing an existing decision starts from it.
    state.draftTiebreakWinner = entry.match?.tiebreak_winner_team_id ?? null;
    state.draftTiebreakReason = entry.match?.tiebreak_reason ?? '';
    state.tiebreakError = null;
    state.pendingFocus = 'tiebreak-form';
    render();
  }

  function closeTiebreakForm() {
    if (state.busy) return;
    resetTiebreakDraft();
    state.pendingFocus = 'tiebreak-button';
    render();
  }

  async function reloadBracket() {
    const entries = await fetchBracket(eventId, client);
    state.scores = await fetchBracketScores(bracketMatchIds(entries), client);
    state.entries = entries;
  }

  async function handleRecordTiebreak(domEvent, entry) {
    domEvent.preventDefault();
    if (state.busy) return;
    const { slot, match } = entry;
    // Everything the save needs is captured NOW. Nothing below reads the draft after an await,
    // so what the person sees confirmed is exactly what was sent.
    const winnerTeamId = state.draftTiebreakWinner;
    const reason = state.draftTiebreakReason;
    const invalid = validateTiebreak({
      winnerTeamId,
      reason,
      teamIds: [slot.team1_id, slot.team2_id],
    });
    if (invalid) {
      state.tiebreakError = invalid;
      state.pendingFocus = 'tiebreak-error';
      render();
      return;
    }
    state.busy = true;
    state.tiebreakError = null;
    render();
    try {
      await recordTiebreak(state.event.org_id, match.id, winnerTeamId, reason, client);
    } catch (err) {
      const refusal = tiebreakRefusal(err);
      if (refusal?.reload) {
        // The screen is out of date (the match may no longer be tied, so this form may no longer
        // exist): refresh it, close the form and say why in the toast, which is always rendered.
        try {
          await reloadBracket();
        } catch {
          // The refusal text already tells the person what happened; the next action reloads.
        }
        resetTiebreakDraft();
        showToast(refusal.message);
      } else {
        state.tiebreakError = { field: 'form', message: describeTiebreakError(err) };
        state.pendingFocus = 'tiebreak-error';
      }
      state.busy = false;
      render();
      return;
    }
    // The decision IS saved from here on: tell the room (it is news, so this takes the display over).
    requestLivePublish(true);
    // Seats and the match row changed, so re-read both rather
    // than patching locally; if that read fails, say the save worked rather than that it failed.
    let refreshed = true;
    try {
      await reloadBracket();
    } catch {
      refreshed = false;
    }
    resetTiebreakDraft();
    showToast(
      refreshed
        ? `${teamName(winnerTeamId)} goes through.`
        : `${teamName(winnerTeamId)} goes through — saved, but the page could not refresh. Reload to see the bracket.`,
    );
    // Focus the slot's button and let the live-region toast speak: a focused toast would be
    // removed by its own timer and drop focus to the page.
    state.pendingFocus = 'tiebreak-button';
    state.busy = false;
    render();
  }

  function renderTiebreakForm(entry) {
    const { slot } = entry;
    const error = state.tiebreakError;
    const errorId = `btc-tiebreak-error-${slot.id}`;
    const hintId = `btc-tiebreak-hint-${slot.id}`;
    const radioName = `tiebreak-winner-${slot.id}`;
    const matchName = `${teamName(slot.team1_id)} vs ${teamName(slot.team2_id)}`;

    const options = [slot.team1_id, slot.team2_id].map((teamId) => {
      const radio = el('input', {
        attrs: {
          type: 'radio',
          name: radioName,
          value: teamId,
          'data-field': `tiebreak-winner-${slot.id}-${teamId}`,
        },
      });
      radio.checked = state.draftTiebreakWinner === teamId;
      setBusyDisabled(radio, state.busy);
      // No re-render: the browser already shows the choice, and a re-render here would only
      // risk moving focus. Ignored while saving so the confirmed team cannot change under it.
      radio.addEventListener('change', () => {
        if (state.busy) {
          // The browser has already moved the selection; rebuild the group from state.
          render();
          return;
        }
        state.draftTiebreakWinner = teamId;
      });
      return el('label', { className: 'btc-judge-checkbox-label' }, [
        radio,
        el('span', { text: teamName(teamId) }),
      ]);
    });

    const describedBy = [error?.field === 'reason' ? errorId : null, hintId]
      .filter(Boolean)
      .join(' ');
    const reasonInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'text',
        maxlength: String(TIEBREAK_REASON_MAX),
        'aria-label': 'Reason for the tie-break (required)',
        placeholder: "e.g. head judge's casting vote",
        'data-field': `tiebreak-reason-${slot.id}`,
        autocomplete: 'off',
        'aria-describedby': describedBy,
        ...(error?.field === 'reason' ? { 'aria-invalid': 'true' } : {}),
      },
    });
    reasonInput.value = state.draftTiebreakReason;
    setBusyDisabled(reasonInput, state.busy);
    reasonInput.addEventListener('input', () => {
      if (state.busy) {
        reasonInput.value = state.draftTiebreakReason;
        return;
      }
      state.draftTiebreakReason = reasonInput.value;
    });

    const submitButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.busy ? 'Saving…' : 'Record tie-break',
      attrs: {
        type: 'submit',
        'data-focus-key': `tiebreak-submit-${slot.id}`,
        ...(error?.field === 'form' ? { 'aria-describedby': errorId } : {}),
      },
    });
    setBusyDisabled(submitButton, state.busy);

    const cancelButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Cancel',
      attrs: { type: 'button', 'data-focus-key': `tiebreak-cancel-${slot.id}` },
    });
    setBusyDisabled(cancelButton, state.busy);
    cancelButton.addEventListener('click', () => closeTiebreakForm());

    // The message comes first, before the controls it may be about, so it is read (and focused)
    // before the person has to find the problem. It is tied to the control it concerns.
    const errorNode = error
      ? el('p', {
          id: errorId,
          className: 'btc-field-error',
          text: error.message,
          attrs: { role: 'alert', tabindex: '-1', 'data-focus-key': `tiebreak-error-${slot.id}` },
        })
      : null;

    const fieldset = el(
      'fieldset',
      {
        className: 'btc-judge-fieldset',
        attrs: {
          ...(error?.field === 'winner'
            ? { 'aria-describedby': errorId, 'aria-invalid': 'true' }
            : {}),
        },
      },
      [
        el('legend', {
          text: `Which team goes through — ${matchName}? (required)`,
          attrs: { tabindex: '-1', 'data-focus-key': `tiebreak-form-heading-${slot.id}` },
        }),
        el('div', { className: 'btc-judge-checkboxes' }, options),
      ],
    );

    const form = el(
      'form',
      { className: 'btc-bracket-create-form btc-tiebreak-form' },
      [
        errorNode,
        fieldset,
        labeledField('Reason (required)', reasonInput),
        el('p', {
          id: hintId,
          className: 'stage-meta btc-tiebreak-hint',
          text: "This reason may be shown on the public results page and the live display. Keep it factual: no personal details, and don't repeat scores.",
        }),
        el('div', { className: 'btc-bracket-form-actions' }, [submitButton, cancelButton]),
      ].filter(Boolean),
    );
    form.addEventListener('submit', (domEvent) => handleRecordTiebreak(domEvent, entry));
    return form;
  }

  // A confirmed knockout match that is level on totals: say so in words (always, including while
  // the form is open, so the organiser can still see the result they are deciding), show any
  // recorded decision with its reason, and offer the one action that resolves it.
  function renderTiebreak(entry, tie, score) {
    const { slot, match } = entry;
    // Plain words, no dashes: "30–30" is read as "30 30" by some screen readers.
    const each = `${score.team1_total} each`;
    const note =
      tie === 'decided'
        ? `Level at ${each}. Tie-break: ${teamName(match.tiebreak_winner_team_id)} goes through. Reason: ${match.tiebreak_reason}`
        : `Tied at ${each}. Nobody advances until you record which team goes through.`;
    const children = [el('p', { className: 'stage-meta btc-tiebreak-note', text: note })];

    if (state.tiebreakSlotId === slot.id) {
      children.push(renderTiebreakForm(entry));
    } else {
      const button = el('button', {
        className: tie === 'decided' ? 'btn btn-outline tap-target' : 'btn btn-primary tap-target',
        text: tie === 'decided' ? 'Change tie-break' : 'Record tie-break',
        attrs: {
          type: 'button',
          'aria-label': `${tie === 'decided' ? 'Change' : 'Record'} tie-break for ${teamName(slot.team1_id)} vs ${teamName(slot.team2_id)}`,
          'data-focus-key': `tiebreak-open-${slot.id}`,
        },
      });
      setBusyDisabled(button, state.busy || state.generating);
      button.addEventListener('click', () => openTiebreakForm(entry));
      children.push(button);
    }
    return el('div', { className: 'btc-tiebreak', attrs: { 'data-tie': tie } }, children);
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
      const score = state.scores.find((row) => row.match_id === match.id);
      const tie = tieState(match, score);
      if (tie) children.push(renderTiebreak(entry, tie, score));
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

  // Champion / runner-up / 3rd, derived from the final and third-place matches' confirmed
  // totals (podium.js). Meaning is carried by the text, never by colour alone: a tied or
  // not-yet-played place says so in words.
  function renderPodium() {
    const podium = derivePodium({
      entries: state.entries,
      scores: state.scores,
      teams: state.teams,
    });
    if (podium.places.length === 0) return null;
    const placeText = (place) => {
      if (place.state === 'decided') return place.teamName;
      if (place.state === 'tied') return 'Tied — not decided';
      return 'Not decided yet';
    };
    // A description list: each place's name (dt) is paired with its team (dd), so a screen
    // reader announces "Champion: Beta" rather than two unrelated chunks.
    return el('div', { className: 'card btc-podium' }, [
      el('h2', { text: 'Podium' }),
      el(
        'dl',
        { className: 'btc-podium-list' },
        podium.places.map((place) =>
          el('div', { className: 'btc-podium-place', attrs: { 'data-state': place.state } }, [
            el('dt', { className: 'stage-meta', text: place.label }),
            el(
              'dd',
              { className: 'btc-podium-team' },
              [
                el('span', { text: placeText(place) }),
                place.viaTiebreak
                  ? el('span', {
                      className: 'stage-meta btc-podium-note',
                      text: 'Decided by tie-break',
                    })
                  : null,
              ].filter(Boolean),
            ),
          ]),
        ),
      ),
    ]);
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
        const podiumCard = renderPodium();
        if (podiumCard) container.appendChild(podiumCard);
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
      } else if (state.pendingFocus === 'tiebreak-form') {
        state.pendingFocus = null;
        const heading = container.querySelector(
          `[data-focus-key="tiebreak-form-heading-${state.tiebreakSlotId}"]`,
        );
        if (heading) {
          heading.focus();
          return true;
        }
      } else if (state.pendingFocus === 'tiebreak-error') {
        state.pendingFocus = null;
        const errorNode = container.querySelector(
          `[data-focus-key="tiebreak-error-${state.tiebreakSlotId}"]`,
        );
        if (errorNode) {
          errorNode.focus();
          return true;
        }
      } else if (state.pendingFocus === 'tiebreak-button') {
        state.pendingFocus = null;
        const openButton = container.querySelector(
          `[data-focus-key="tiebreak-open-${state.lastClosedTiebreakSlotId}"]`,
        );
        if (openButton) {
          openButton.focus();
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
