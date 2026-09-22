// BTC match scoring screen (Phase T-BTC.2, scoring sub-step). The scorer taps, per
// cup, each of the 3 judges' votes; on Confirm the whole match goes to the database
// as ONE outbox operation (see scoring.js's header for the write model).
//
// Unlike the roster/match screens this one updates the DOM IN PLACE after the first
// render rather than rebuilding it on every action. A scorer taps up to 60 cells in a
// row; a full rebuild per tap would collapse the page height and jump the scroll
// position back to the top mid-scoring. Full renders happen only for loading, a
// failed load, and the initial build.
//
// Confirming is a small state machine, because the outbox can outlive this screen:
//   idle -> (Confirm) -> confirmed          the ledger has the operation id
//                     -> pending            still queued / result unknown; editing locks
//                     -> dropped            the server refused it; back to editing, or
//                                           (a version conflict) stale, discard-only
// The operation id is written into the local draft BEFORE it is enqueued, so a reload
// can always ask the server's own ledger what became of that exact operation.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import { findMatchById, listJudgeIdsForMatch } from './matches.js';
import {
  JUDGES_PER_MATCH,
  blankDraft,
  buildConfirmParams,
  clearDraft,
  computeScores,
  cupsForRound,
  describeConfirmError,
  firstMissingVote,
  flushPending,
  isMatchComplete,
  isOperationQueued,
  loadConfirmedDraft,
  loadDraft,
  missingVoteCount,
  roundLabel,
  saveDraft,
  submitConfirmMatch,
  toggleVote,
  tokensForCup,
  wasOperationProcessed,
  withVote,
} from './scoring.js';

const STALE_MESSAGE =
  'This match was changed elsewhere after you started scoring it. Discard your edits to load the latest scores, then re-enter your changes.';
const SAVE_FAILED_MESSAGE =
  'Progress could not be saved on this device. Reloading this page would lose the votes entered so far.';
const DISCARDED_MESSAGE = 'Your edits were discarded and the latest scores were loaded.';
const NOT_APPLIED_MESSAGE =
  'Your last confirmation was not applied. Your votes are still here: review them and confirm again.';

export async function mountScoringScreen(
  root,
  { matchId, client = getSupabase(), signal, handlers } = {},
) {
  const state = {
    loading: true,
    loadFailedMessage: null,
    data: null, // { event, match, teams, judges, judgeIds }
    draft: blankDraft(),
    confirmInFlight: false,
    saveFailed: false,
    // 'pending' (confirmation saved, waiting to sync) | 'reload' (confirmed, but the
    // match could not be re-read) | null
    lockReason: null,
    staleMessage: null, // set when edits can only be discarded
    info: null, // a plain notice, e.g. NOT_APPLIED_MESSAGE
    syncNote: false, // a manual sync check found the confirmation still queued
  };
  // Live nodes updated in place after the initial build.
  let ui = null;

  function locked() {
    return state.confirmInFlight || state.lockReason !== null || state.staleMessage !== null;
  }

  function teamLabel(which) {
    const { match, teams } = state.data;
    const id = which === 'team1' ? match.team1_id : match.team2_id;
    return teams.find((team) => team.id === id)?.name ?? (which === 'team1' ? 'Team 1' : 'Team 2');
  }

  function judgeLabel(judgeId) {
    return state.data.judges.find((judge) => judge.id === judgeId)?.name ?? 'Judge';
  }

  // Which of the two teams a vote is for, or null.
  function sideOf(teamId) {
    const { match } = state.data;
    if (teamId === match.team1_id) return 'team1';
    if (teamId === match.team2_id) return 'team2';
    return null;
  }

  async function loadPersisted() {
    const match = await findMatchById(matchId, client);
    const [event, teams, judges, judgeIds] = await Promise.all([
      findEvent(match.event_id, client),
      listTeams(match.event_id, client),
      listJudges(match.event_id, client),
      listJudgeIdsForMatch(matchId, client),
    ]);
    const data = { event, match, teams, judges, judgeIds };
    const stored = await loadDraft(matchId);
    const fresh = async () =>
      match.status === 'confirmed'
        ? loadConfirmedDraft(match, client)
        : { ...blankDraft(), baseUpdatedAt: match.updated_at };
    const result = {
      data,
      draft: null,
      lockReason: null,
      staleMessage: null,
      info: null,
      saveFailed: false,
    };
    // Tidying the local draft must never turn a successful load into a Retry screen: the
    // resolution below does not depend on the write landing.
    const tryWrite = async (write) => {
      try {
        await write();
      } catch {
        result.saveFailed = true;
      }
    };

    if (stored?.confirmOpId) {
      // A confirmation was submitted from this draft. The server's ledger is the only
      // authority on what became of it. The queue is read BEFORE the ledger: the outbox
      // removes an operation only after its RPC has committed, so this order can never
      // see "gone from the queue" without also seeing the ledger row.
      const queued = await isOperationQueued(stored.confirmOpId);
      if (await wasOperationProcessed(stored.confirmOpId, client)) {
        await tryWrite(() => clearDraft(matchId));
        result.draft = await fresh();
      } else if (queued) {
        result.draft = stored;
        result.lockReason = 'pending';
      } else {
        result.draft = { ...stored, confirmOpId: null };
        result.info = NOT_APPLIED_MESSAGE;
        await tryWrite(() => saveDraft(matchId, result.draft));
      }
    } else if (stored) {
      result.draft = stored;
    } else {
      result.draft = await fresh();
    }

    // A draft built on an older version of the match would sail through the server's
    // version check if it were sent with the CURRENT version, so it is never sent.
    if (
      result.lockReason === null &&
      result.draft.baseUpdatedAt &&
      result.draft.baseUpdatedAt !== match.updated_at
    ) {
      result.staleMessage = STALE_MESSAGE;
    }
    return result;
  }

  async function attemptLoad(note = null) {
    state.loading = true;
    render();
    try {
      const loaded = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.data = loaded.data;
      state.draft = loaded.draft;
      state.lockReason = loaded.lockReason;
      state.staleMessage = loaded.staleMessage;
      state.info = loaded.info ?? note;
      state.syncNote = false;
      if (loaded.saveFailed) state.saveFailed = true;
      state.loadFailedMessage = null;
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
    if (state.data && !state.loadFailedMessage) ui?.heading.focus();
  }

  function persistDraft() {
    // Once a save has failed the notice stays for the session: a later success does
    // not prove the earlier votes are safe, and a quietly vanishing warning is worse
    // than one that lingers.
    saveDraft(matchId, state.draft).catch(() => setSaveFailed());
  }

  function setSaveFailed() {
    state.saveFailed = true;
    if (ui?.saveNotice) ui.saveNotice.textContent = SAVE_FAILED_MESSAGE;
  }

  function setFeedback(message, tone) {
    ui.feedback.textContent = message ?? '';
    if (tone) ui.feedback.dataset.tone = tone;
    else delete ui.feedback.dataset.tone;
    ui.gotoMissing.hidden = true;
  }

  // ---------- in-place updates ----------

  function updateVoteButton(button, cup, judgeId) {
    const side = sideOf(state.draft.votes[cup]?.[judgeId] ?? null);
    button.querySelector('.btc-vote-mark').textContent =
      side === 'team1' ? '1' : side === 'team2' ? '2' : '–';
    button.dataset.vote = side ?? 'none';
    button.setAttribute(
      'aria-label',
      `Cup ${cup}, ${judgeLabel(judgeId)}, ${side ? teamLabel(side) : 'no vote'}`,
    );
  }

  function updateCupTally(cup) {
    const { match, judgeIds } = state.data;
    const tally = tokensForCup(state.draft, cup, match, judgeIds, match.round);
    const { visible, spoken } = ui.cupTallies.get(cup);
    visible.textContent = `${tally.team1}–${tally.team2}`;
    spoken.textContent = `${teamLabel('team1')} ${tally.team1}, ${teamLabel('team2')} ${tally.team2}`;
  }

  function updateTotals() {
    const { match, judgeIds } = state.data;
    const scores = computeScores(state.draft, match, judgeIds, match.round);
    ui.totals.team1.textContent = `${scores.team1Total} points (${scores.team1Tokens} tokens)`;
    ui.totals.team2.textContent = `${scores.team2Total} points (${scores.team2Tokens} tokens)`;
  }

  function updateConfirm() {
    const { match, judgeIds } = state.data;
    const isComplete = isMatchComplete(state.draft, match, judgeIds, match.round);
    const missing = isComplete ? 0 : missingVoteCount(state.draft, match, judgeIds, match.round);
    ui.confirmButton.textContent = state.confirmInFlight
      ? 'Confirming…'
      : match.status === 'confirmed'
        ? 'Re-confirm match'
        : 'Confirm match';
    setBusyDisabled(ui.confirmButton, locked() || !isComplete);
    if (isComplete) {
      ui.confirmButton.removeAttribute('aria-describedby');
      ui.confirmHint.hidden = true;
    } else {
      ui.confirmButton.setAttribute('aria-describedby', ui.confirmHint.id);
      ui.confirmHint.textContent = `Confirm unlocks once every judge has voted on every cup. ${missing} vote${missing === 1 ? '' : 's'} still missing.`;
      ui.confirmHint.hidden = false;
    }
    ui.statusNote.textContent =
      match.status === 'confirmed'
        ? 'This match is confirmed. Changing scores and re-confirming replaces the recorded result.'
        : 'Not confirmed yet.';
  }

  // Keeps every input in step with `locked()` and with the draft: a change that arrives
  // while locked is reverted here rather than silently accepted.
  function updateControls() {
    const isLocked = locked();
    for (const button of ui.voteButtons) setBusyDisabled(button, isLocked);
    for (const control of ui.controls) control.disabled = isLocked;
    for (const radio of ui.radios) {
      radio.node.checked = (state.draft.fastest ?? 'none') === radio.value;
    }
    for (const box of ui.boxes) box.node.checked = state.draft.signature[box.which];
    for (const field of ui.timeFields) field.node.value = state.draft.times[field.which];
  }

  function updateNotice() {
    let message = null;
    if (state.lockReason === 'pending') {
      message =
        'Your confirmation is saved on this device and waiting to sync. Editing is locked until it goes through.';
      if (state.syncNote) message += ' Still not synced: check your connection and try again.';
    } else if (state.lockReason === 'reload') {
      message = 'This match was confirmed. Reload this page before editing it again.';
    } else if (state.staleMessage) {
      message = state.staleMessage;
    } else if (state.info) {
      message = state.info;
    }
    ui.notice.textContent = message ?? '';
    ui.checkSyncButton.hidden = state.lockReason !== 'pending';
    ui.discardButton.hidden = state.staleMessage === null;
  }

  function refreshAll() {
    const { match } = state.data;
    for (let cup = 1; cup <= cupsForRound(match.round); cup += 1) updateCupTally(cup);
    updateTotals();
    updateConfirm();
    updateControls();
    updateNotice();
  }

  // ---------- actions ----------

  function onVoteTap(cup, judgeId, button) {
    if (locked()) return;
    const { match } = state.data;
    const next = toggleVote(
      state.draft.votes[cup]?.[judgeId] ?? null,
      match.team1_id,
      match.team2_id,
    );
    state.draft = withVote(state.draft, cup, judgeId, next);
    // An earlier message ("first missing: cup 3", "Match confirmed.") is out of date now.
    if (ui.feedback.textContent) setFeedback(null);
    updateVoteButton(button, cup, judgeId);
    updateCupTally(cup);
    updateTotals();
    updateConfirm();
    persistDraft();
    // Sighted scorers see the button change; this is what a screen reader hears.
    const side = sideOf(next);
    ui.announce.textContent = `Cup ${cup}, ${judgeLabel(judgeId)}: ${side ? teamLabel(side) : 'no vote'}`;
  }

  function discardEdits() {
    clearDraft(matchId)
      .catch(() => {
        // The reload below re-resolves whatever draft is left; only tell the scorer.
        state.saveFailed = true;
      })
      .then(() => attemptLoad(DISCARDED_MESSAGE));
  }

  // What became of an operation this screen submitted: 'confirmed', 'pending' or
  // 'dropped' (with the reason). A read failure is "cannot tell", never "did not happen".
  // Queue first, ledger second (see loadPersisted for why the order matters). This does
  // NOT depend on the result of a flush this screen just ran: the shared outbox may have
  // been drained, and the operation dropped, by another caller (main.js's reconnect flush).
  async function resolveOperation(operationId, flushError) {
    const queued = await isOperationQueued(operationId).catch(() => null);
    const processed = await wasOperationProcessed(operationId, client).catch(() => null);
    if (processed === true) return { outcome: 'confirmed', error: null };
    if (processed === null || queued !== false) return { outcome: 'pending', error: null };
    // Not applied and no longer queued: the server refused it. A flush error may belong to
    // a different operation, so a moved match version is the primary evidence of a conflict.
    const fresh = await findMatchById(matchId, client).catch(() => null);
    const base = state.draft.baseUpdatedAt;
    const conflict = fresh && base && fresh.updated_at !== base;
    return { outcome: 'dropped', error: conflict ? { code: 'P0002' } : flushError };
  }

  async function finishConfirmed() {
    const fresh = await findMatchById(matchId, client).catch(() => null);
    try {
      await clearDraft(matchId);
    } catch {
      // Harmless to correctness (the next load resolves the operation id against the
      // ledger), but the scorer should know the draft was not tidied away.
      setSaveFailed();
    }
    state.confirmInFlight = false;
    state.lockReason = null;
    state.staleMessage = null;
    state.info = null;
    if (fresh) {
      state.data = { ...state.data, match: fresh };
      state.draft = { ...state.draft, confirmOpId: null, baseUpdatedAt: fresh.updated_at };
      setFeedback('Match confirmed.', 'success');
    } else {
      state.data = { ...state.data, match: { ...state.data.match, status: 'confirmed' } };
      state.draft = { ...state.draft, confirmOpId: null };
      state.lockReason = 'reload';
      setFeedback('Match confirmed.', 'success');
    }
  }

  function applyOutcome(outcome, error) {
    state.confirmInFlight = false;
    if (outcome === 'pending') {
      state.lockReason = 'pending';
      setFeedback(null);
      return;
    }
    // Dropped: the server refused it. A version conflict can only be resolved by
    // discarding; anything else can be fixed and re-confirmed.
    state.draft = { ...state.draft, confirmOpId: null };
    persistDraft();
    if (error?.code === 'P0002') {
      state.staleMessage = STALE_MESSAGE;
      setFeedback(null);
    } else if (error) {
      setFeedback(describeConfirmError(error) ?? describeError(error), 'error');
    } else {
      setFeedback(NOT_APPLIED_MESSAGE, 'error');
    }
  }

  // After a confirm attempt the scorer's focus button may be gone or scrolled away, and
  // the resolving controls (Discard, Check sync) live in the summary card at the top: go
  // to the notice when it holds the news, otherwise to the confirm feedback beside the
  // button.
  function focusResult() {
    if (state.staleMessage !== null || state.lockReason === 'pending') {
      ui.notice.scrollIntoView?.({ block: 'center' });
      ui.notice.focus();
    } else {
      ui.feedback.focus();
    }
  }

  async function handleConfirm() {
    if (locked()) return;
    const { match, judgeIds, event } = state.data;
    const missing = firstMissingVote(state.draft, match, judgeIds, match.round);
    if (missing || judgeIds.length !== JUDGES_PER_MATCH) {
      setFeedback(
        missing
          ? `Every judge must vote on every cup. First missing: cup ${missing.cup}, ${judgeLabel(missing.judgeId)}.`
          : `This match needs exactly ${JUDGES_PER_MATCH} judges.`,
        'error',
      );
      if (missing) {
        ui.gotoMissing.hidden = false;
        ui.gotoMissing.dataset.cup = String(missing.cup);
        ui.gotoMissing.dataset.judge = missing.judgeId;
      }
      ui.feedback.focus();
      return;
    }
    state.info = null;
    updateNotice();
    const operationId = crypto.randomUUID();
    const baseUpdatedAt = state.draft.baseUpdatedAt ?? match.updated_at;
    state.draft = { ...state.draft, baseUpdatedAt, confirmOpId: operationId };
    state.confirmInFlight = true;
    updateConfirm();
    updateControls();
    setFeedback(null);
    try {
      // Persisted BEFORE it is enqueued, so a crash between the two can still be
      // resolved on reload; if it cannot be saved, nothing is submitted.
      await saveDraft(matchId, state.draft);
    } catch {
      state.draft = { ...state.draft, confirmOpId: null };
      state.confirmInFlight = false;
      setSaveFailed();
      setFeedback('Could not save on this device, so nothing was submitted. Try again.', 'error');
      updateConfirm();
      updateControls();
      ui.feedback.focus();
      return;
    }
    let flushError = null;
    try {
      const params = buildConfirmParams(match, state.draft, judgeIds, match.round);
      const { result } = await submitConfirmMatch(
        match,
        event.org_id,
        baseUpdatedAt,
        params,
        client,
        handlers,
        operationId,
      );
      flushError = result?.error ?? null;
    } catch (err) {
      flushError = err;
    }
    if (signal?.aborted) return;
    const { outcome, error } = await resolveOperation(operationId, flushError);
    if (signal?.aborted) return;
    if (outcome === 'confirmed') await finishConfirmed();
    else applyOutcome(outcome, error);
    updateConfirm();
    updateControls();
    updateNotice();
    focusResult();
  }

  async function handleCheckSync() {
    const operationId = state.draft.confirmOpId;
    if (!operationId || state.confirmInFlight) return;
    state.confirmInFlight = true;
    setBusyDisabled(ui.checkSyncButton, true);
    let flushError = null;
    try {
      const result = await flushPending(client, handlers);
      flushError = result?.error ?? null;
    } catch (err) {
      flushError = err;
    }
    const { outcome, error } = await resolveOperation(operationId, flushError);
    if (signal?.aborted) return;
    state.lockReason = null;
    state.syncNote = false;
    if (outcome === 'confirmed') await finishConfirmed();
    else applyOutcome(outcome, error);
    state.syncNote = outcome === 'pending';
    setBusyDisabled(ui.checkSyncButton, false);
    updateConfirm();
    updateControls();
    updateNotice();
    // Still queued: stay on the button that was pressed; the notice announces the result.
    if (outcome === 'pending') ui.checkSyncButton.focus();
    else focusResult();
  }

  function goToMissingVote() {
    const { cup, judge } = ui.gotoMissing.dataset;
    const target = root.querySelector(`[data-focus-key="vote-${cup}-${judge}"]`);
    if (!target) return;
    target.scrollIntoView?.({ block: 'center' });
    target.focus();
  }

  // ---------- rendering ----------

  function buildCupRow(cup) {
    const { judgeIds } = state.data;
    const buttons = judgeIds.map((judgeId) => {
      const button = el(
        'button',
        {
          className: 'btc-vote tap-target',
          attrs: {
            type: 'button',
            'data-focus-key': `vote-${cup}-${judgeId}`,
            'aria-describedby': 'btc-vote-help',
          },
        },
        [
          el('span', { className: 'btc-vote-judge', text: judgeLabel(judgeId) }),
          el('span', { className: 'btc-vote-mark', attrs: { 'aria-hidden': 'true' } }),
        ],
      );
      updateVoteButton(button, cup, judgeId);
      button.addEventListener('click', () => onVoteTap(cup, judgeId, button));
      ui.voteButtons.push(button);
      return button;
    });
    const visible = el('span', { attrs: { 'aria-hidden': 'true' } });
    const spoken = el('span', { className: 'sr-only' });
    ui.cupTallies.set(cup, { visible, spoken });
    return el(
      'div',
      { className: 'btc-cup-row', attrs: { role: 'group', 'aria-label': `Cup ${cup}` } },
      [
        el('div', { className: 'btc-cup-head' }, [
          el('span', { className: 'btc-cup-number', text: `Cup ${cup}` }),
          el('span', { className: 'btc-cup-tally' }, [visible, spoken]),
        ]),
        el('div', { className: 'btc-cup-votes' }, buttons),
      ],
    );
  }

  function buildBonuses() {
    const { match } = state.data;
    const knockout = match.round !== 'preliminary';

    const fastestOptions = [
      ['none', 'Neither'],
      ['team1', teamLabel('team1')],
      ['team2', teamLabel('team2')],
    ].map(([value, label]) => {
      const radio = el('input', {
        attrs: { type: 'radio', name: 'btc-fastest', value, 'data-field': `fastest-${value}` },
      });
      radio.addEventListener('change', () => {
        if (!locked()) {
          state.draft = { ...state.draft, fastest: value === 'none' ? null : value };
          updateTotals();
          persistDraft();
        }
        updateControls();
      });
      ui.radios.push({ node: radio, value });
      ui.controls.push(radio);
      return el('label', { className: 'btc-choice' }, [radio, el('span', { text: label })]);
    });

    const children = [
      el('h2', { text: 'Bonuses and times' }),
      el('fieldset', { className: 'btc-fieldset' }, [
        el('legend', { text: 'Fastest team (+2)' }),
        el('div', { className: 'btc-choices' }, fastestOptions),
      ]),
    ];

    if (knockout) {
      const boxes = ['team1', 'team2'].map((which) => {
        const box = el('input', {
          attrs: { type: 'checkbox', 'data-field': `signature-${which}` },
        });
        box.addEventListener('change', () => {
          if (!locked()) {
            state.draft = {
              ...state.draft,
              signature: { ...state.draft.signature, [which]: box.checked },
            };
            updateTotals();
            persistDraft();
          }
          updateControls();
        });
        ui.boxes.push({ node: box, which });
        ui.controls.push(box);
        return el('label', { className: 'btc-choice' }, [
          box,
          el('span', { text: teamLabel(which) }),
        ]);
      });
      children.push(
        el('fieldset', { className: 'btc-fieldset' }, [
          el('legend', { text: 'Signature beverage (+2 each)' }),
          el('div', { className: 'btc-choices' }, boxes),
        ]),
      );
    }

    for (const which of ['team1', 'team2']) {
      const input = el('input', {
        className: 'field-input',
        attrs: {
          type: 'text',
          'aria-label': `${teamLabel(which)} finish time (optional)`,
          placeholder: 'e.g. 8:42',
          'data-field': `time-${which}`,
        },
      });
      input.addEventListener('input', () => {
        if (locked()) {
          updateControls();
          return;
        }
        state.draft = { ...state.draft, times: { ...state.draft.times, [which]: input.value } };
        persistDraft();
      });
      ui.timeFields.push({ node: input, which });
      ui.controls.push(input);
      children.push(
        el('div', { className: 'form-field' }, [
          el('span', {
            className: 'form-field-label',
            text: `${teamLabel(which)} finish time`,
            attrs: { 'aria-hidden': 'true' },
          }),
          input,
        ]),
      );
    }

    return el('div', { className: 'card' }, children);
  }

  function renderLoaded() {
    const { match, judgeIds, event } = state.data;
    ui = {
      cupTallies: new Map(),
      totals: {},
      voteButtons: [],
      controls: [],
      radios: [],
      boxes: [],
      timeFields: [],
    };

    const container = el('section', { className: 'screen-container btc-scoring-screen' });
    if (event?.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    ui.heading = el('h1', { text: 'Score match', attrs: { tabindex: '-1' } });
    container.appendChild(ui.heading);

    ui.statusNote = el('p', { className: 'stage-meta' });
    const summary = el('div', { className: 'card' }, [
      el('h2', { text: `${teamLabel('team1')} vs ${teamLabel('team2')}` }),
      el('p', {
        className: 'stage-meta',
        text: `${roundLabel(match.round)} · ${cupsForRound(match.round)} cups · judges: ${judgeIds.map(judgeLabel).join(', ')}`,
      }),
      ui.statusNote,
    ]);
    container.appendChild(summary);

    if (judgeIds.length !== JUDGES_PER_MATCH) {
      container.appendChild(
        el('p', {
          className: 'screen-feedback',
          text: `This match has ${judgeIds.length} judges assigned; it needs exactly ${JUDGES_PER_MATCH} before it can be scored.`,
          attrs: { role: 'status' },
        }),
      );
      root.appendChild(container);
      return;
    }

    // Live regions are rendered up front and only have their text changed: a region
    // that is created (or un-hidden) together with its content is often not announced.
    // They sit inside the summary card, in one stack, so that while they are all empty
    // they cost no layout space (see .btc-status-stack in the CSS).
    ui.saveNotice = el('div', {
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    ui.saveNotice.dataset.tone = 'error';
    if (state.saveFailed) ui.saveNotice.textContent = SAVE_FAILED_MESSAGE;

    ui.notice = el('div', {
      className: 'screen-feedback',
      attrs: {
        role: 'status',
        'aria-live': 'polite',
        'data-region': 'notice',
        tabindex: '-1',
      },
    });
    ui.checkSyncButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Check sync status',
      attrs: { type: 'button' },
    });
    ui.checkSyncButton.addEventListener('click', handleCheckSync);
    ui.discardButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Discard my edits and reload',
      attrs: { type: 'button' },
    });
    ui.discardButton.addEventListener('click', discardEdits);
    ui.announce = el('div', {
      className: 'sr-only',
      attrs: { role: 'status', 'aria-live': 'polite' },
    });
    summary.appendChild(
      el('div', { className: 'btc-status-stack' }, [
        ui.saveNotice,
        ui.notice,
        ui.checkSyncButton,
        ui.discardButton,
        ui.announce,
      ]),
    );

    const cupRows = [];
    for (let cup = 1; cup <= cupsForRound(match.round); cup += 1) cupRows.push(buildCupRow(cup));
    container.appendChild(
      el('div', { className: 'card' }, [
        el('h2', { text: 'Judge votes' }),
        el('p', {
          id: 'btc-vote-help',
          className: 'stage-meta',
          text: `Tap a judge to cycle their vote for that cup: – (none), then 1 (${teamLabel('team1')}), then 2 (${teamLabel('team2')}), then back to none.`,
        }),
        el('p', {
          className: 'btc-legend',
          attrs: { 'aria-hidden': 'true' },
          text: `1 ${teamLabel('team1')} · 2 ${teamLabel('team2')}`,
        }),
        el('div', { className: 'btc-cups' }, cupRows),
      ]),
    );

    container.appendChild(buildBonuses());

    ui.totals.team1 = el('strong');
    ui.totals.team2 = el('strong');
    container.appendChild(
      el('div', { className: 'card' }, [
        el('h2', { text: 'Totals (preview)' }),
        el('p', {}, [el('span', { text: `${teamLabel('team1')}: ` }), ui.totals.team1]),
        el('p', {}, [el('span', { text: `${teamLabel('team2')}: ` }), ui.totals.team2]),
        el('p', {
          className: 'stage-meta',
          text: 'A preview only. The database recalculates the official totals when the match is confirmed.',
        }),
      ]),
    );

    ui.confirmHint = el('p', { id: 'btc-confirm-hint', className: 'form-field-hint' });
    ui.confirmButton = el('button', {
      className: 'btn btn-primary tap-target',
      attrs: { type: 'button', 'data-focus-key': 'confirm-match' },
    });
    ui.confirmButton.addEventListener('click', handleConfirm);
    ui.feedback = el('div', {
      className: 'screen-feedback',
      attrs: {
        role: 'status',
        'aria-live': 'polite',
        'data-region': 'feedback',
        tabindex: '-1',
      },
    });
    ui.gotoMissing = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Go to first missing vote',
      attrs: { type: 'button' },
    });
    ui.gotoMissing.hidden = true;
    ui.gotoMissing.addEventListener('click', goToMissingVote);
    container.appendChild(
      el('div', { className: 'card' }, [
        ui.confirmButton,
        ui.confirmHint,
        ui.feedback,
        ui.gotoMissing,
      ]),
    );

    root.appendChild(container);
    refreshAll();
  }

  function renderLoading() {
    root.appendChild(
      el('section', { className: 'screen-container btc-scoring-screen' }, [
        el('h1', { text: 'Score match' }),
        el('div', {
          className: 'screen-feedback',
          text: 'Loading match…',
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
    const retry = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Retry',
      attrs: { type: 'button' },
    });
    retry.addEventListener('click', () => attemptLoad());
    root.appendChild(
      el('section', { className: 'screen-container btc-scoring-screen' }, [
        el('h1', { text: 'Score match' }),
        feedback,
        retry,
      ]),
    );
    feedback.focus();
  }

  function render() {
    if (signal?.aborted) return;
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      ui = null;
      if (state.loading) {
        renderLoading();
        return undefined;
      }
      if (state.loadFailedMessage) {
        renderLoadError();
        return true;
      }
      renderLoaded();
      return undefined;
    });
  }

  await attemptLoad();

  return {
    unmount() {
      // Nothing live to tear down (no timers or listeners outside the subtree). A
      // confirm still in flight is deliberately NOT cancelled: its operation id is
      // already saved in the draft, and the outbox keeps going, so the next visit
      // resolves it against the server's ledger.
    },
  };
}
