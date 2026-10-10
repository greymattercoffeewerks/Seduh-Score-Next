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
  fetchSeedingOrder,
  isMissingSeedingView,
  seedingTieGroups,
  blockingGroups,
  validateSeedingOrder,
  recordSeedingTiebreak,
  seedingRefusal,
  describeSeedingError,
  isCutoffTieRefusal,
  CUTOFF_TIE_MESSAGE,
} from './seeding.js';
import { renderSeedingTies } from './seedingCard.js';
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
    // The seed order (btc_seeding_order) and the form that orders one group of level teams. Only read
    // before the bracket exists. The screen still loads where the view does not exist yet (its migration
    // has not landed: nothing to show), and a read that FAILS is shown as such (seedingReadFailed) with a
    // way to try again, never as "no ties". An earlier successful read is kept when a later one fails.
    seedingRows: [],
    seedingReadFailed: false,
    // Said once to a screen reader through the live region below, then cleared.
    announcement: '',
    seedingGroupKey: null,
    lastClosedSeedingKey: null,
    draftSeedingOrder: [],
    draftSeedingReason: '',
    seedingError: null,
    // null | 'heading' | 'toast' | 'create-form' | 'create-button' | 'tiebreak-form' |
    // 'tiebreak-error' | 'tiebreak-button' | 'seeding-form' | 'seeding-error' | 'seeding-button' —
    // see setupScreen.js's own comment on this pendingFocus shape.
    pendingFocus: null,
  };
  let toastTimer;
  const announcer = el('div', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  root.appendChild(announcer);

  function teamName(id) {
    if (!id) return 'TBD';
    return state.teams.find((t) => t.id === id)?.name ?? 'Unknown team';
  }

  // `focus: false` leaves keyboard focus where it is (a message about a control the person is still on: it is
  // also said through the live region, and focus is not dropped to the page when the toast goes). A long message
  // stays up long enough to read.
  function showToast(message, { focus = true } = {}) {
    state.toastMessage = message;
    if (focus) state.pendingFocus = 'toast';
    else state.announcement = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        state.toastMessage = null;
        render();
      },
      Math.max(1500, message.length * 60),
    );
  }

  // { rows, failed }. A view that does not exist yet is not a failure (the front end can ship before its
  // migration reaches the cloud project: the 2026-09-05 incident); anything else is.
  async function readSeeding() {
    try {
      return { rows: await fetchSeedingOrder(eventId, client), failed: false };
    } catch (err) {
      if (isMissingSeedingView(err)) return { rows: [], failed: false };
      console.warn('btc: the seed order could not be read', err);
      return { rows: null, failed: true };
    }
  }

  // Takes a read into the screen: a failed read keeps what was held. An open form whose group is gone (the
  // teams stopped being level, or the group changed) is closed rather than left to disagree with the table.
  function applySeedingRead(read) {
    if (read.failed) {
      state.seedingReadFailed = true;
      return;
    }
    state.seedingRows = read.rows;
    state.seedingReadFailed = false;
    if (state.seedingGroupKey) {
      // The key is only "points-wins": who is in the group can change under the same numbers (one team
      // leaves and another joins, or the group grows), and a draft of different members must not outlive it.
      const group = seedingTieGroups(state.seedingRows).find(
        (g) => g.key === state.seedingGroupKey,
      );
      const draft = state.draftSeedingOrder;
      const sameMembers =
        group &&
        group.teams.length === draft.length &&
        group.teams.every((team) => draft.includes(team.teamId));
      if (!sameMembers) resetSeedingDraft();
    }
  }

  const OPEN_ORDER_MESSAGE =
    'Save or cancel the order you have open before generating the bracket.';

  // The client-side gate on Generate: the groups level across the cut-off must be ordered. Not applied while
  // the order could not be read (what is held may be out of date): the database decides then.
  function cutoffBlocked() {
    return (
      !state.seedingReadFailed && blockingGroups(seedingTieGroups(state.seedingRows)).length > 0
    );
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
    const [scores, seeding] = await Promise.all([
      fetchBracketScores(bracketMatchIds(entries), client),
      entries.length === 0 ? readSeeding() : { rows: [], failed: false },
    ]);
    return { event, teams, judges, entries, scores, seeding };
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
      state.seedingRows = persisted.seeding.rows ?? [];
      state.seedingReadFailed = persisted.seeding.failed;
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
    if (state.generating || state.busy) return;
    // The card above says why: teams level across the cut-off must be ordered first. Say it here too, in
    // words, rather than let the database refuse with a message the organiser cannot act on.
    // An unsaved order is not thrown away by generating: say so and leave focus on the button.
    if (state.seedingGroupKey) {
      showToast(OPEN_ORDER_MESSAGE, { focus: false });
      render();
      return;
    }
    if (cutoffBlocked()) {
      showToast(CUTOFF_TIE_MESSAGE, { focus: false });
      render();
      return;
    }
    state.generating = true;
    render();
    try {
      await generateBracket(state.event.org_id, eventId, client);
      // The bracket exists from here on, whether or not the re-read below succeeds.
      requestLivePublish(false);
      state.entries = await fetchBracket(eventId, client);
      resetSeedingDraft();
      showToast('Bracket generated.');
    } catch (err) {
      // The refusal may mean the order held here is out of date (another device re-confirmed a match):
      // re-read it, so the card shows what is true, and a form open on a group that no longer exists closes.
      applySeedingRead(await readSeeding());
      showToast(isCutoffTieRefusal(err) ? CUTOFF_TIE_MESSAGE : describeError(err));
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

  // ---- ordering teams that are level in the standings (seeding.js) ----

  function seedingGroup(key) {
    return seedingTieGroups(state.seedingRows).find((group) => group.key === key) ?? null;
  }

  function focusByKey(container, key) {
    const node = container.querySelector(`[data-focus-key="${key}"]`);
    if (!node) return false;
    node.focus();
    return true;
  }

  function resetSeedingDraft() {
    if (state.seedingGroupKey) state.lastClosedSeedingKey = state.seedingGroupKey;
    state.seedingGroupKey = null;
    state.draftSeedingOrder = [];
    state.draftSeedingReason = '';
    state.seedingError = null;
  }

  function openSeedingForm(group) {
    if (state.busy || state.generating) return;
    // Opening another group would silently drop the draft in this one: the card marks those buttons inert,
    // and this keeps the rule even if one is pressed anyway.
    if (state.seedingGroupKey && state.seedingGroupKey !== group.key) {
      showToast('Save or cancel the order you have open first.', { focus: false });
      render();
      return;
    }
    state.seedingGroupKey = group.key;
    // A group's teams are already in seed order, which for a group ordered earlier is the order recorded.
    state.draftSeedingOrder = group.teams.map((team) => team.teamId);
    state.draftSeedingReason = group.reason ?? '';
    state.seedingError = null;
    state.pendingFocus = 'seeding-form';
    render();
  }

  function closeSeedingForm() {
    if (state.busy) return;
    resetSeedingDraft();
    state.pendingFocus = 'seeding-button';
    render();
  }

  function moveSeedingTeam(teamId, delta) {
    if (state.busy || state.generating) return;
    const order = [...state.draftSeedingOrder];
    const from = order.indexOf(teamId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    state.draftSeedingOrder = order;
    state.seedingError = null;
    // Focus follows the pressed team, so nothing else says what changed: say it.
    const first = seedingGroup(state.seedingGroupKey)?.firstSeed;
    if (first != null) {
      const seedOf = (id) => first + order.indexOf(id);
      state.announcement = `${teamName(order[to])} is now seed ${seedOf(order[to])}, ${teamName(order[from])} is now seed ${seedOf(order[from])}.`;
    }
    render();
  }

  async function handleRecordSeeding(domEvent, group) {
    domEvent.preventDefault();
    if (state.busy || state.generating) return;
    // Everything the save needs is captured NOW; nothing below reads the draft after an await.
    const orderedTeamIds = [...state.draftSeedingOrder];
    const reason = state.draftSeedingReason;
    const hadBlocking = blockingGroups(seedingTieGroups(state.seedingRows)).length > 0;
    const invalid = validateSeedingOrder({
      orderedTeamIds,
      groupTeamIds: group.teams.map((team) => team.teamId),
      reason,
    });
    if (invalid) {
      state.seedingError = invalid;
      state.pendingFocus = 'seeding-error';
      render();
      return;
    }
    state.busy = true;
    state.seedingError = null;
    state.announcement = 'Saving the order…';
    render();
    try {
      await raceTimeout(
        recordSeedingTiebreak(state.event.org_id, eventId, orderedTeamIds, reason, client),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
    } catch (err) {
      if (err.timedOut) {
        // The save may or may not have landed: say so, and leave the draft to try again (a re-record
        // replaces, so trying again is safe).
        state.seedingError = {
          field: 'form',
          message: 'Could not confirm the save. Check your connection, then try again.',
        };
        state.pendingFocus = 'seeding-error';
        // Look at what is actually saved before the form is handed back, so a late save cannot be
        // mistaken for none (and a second save made on top of it).
        applySeedingRead(await readSeeding());
        state.busy = false;
        render();
        return;
      }
      const refusal = seedingRefusal(err);
      if (refusal?.reload) {
        // The screen is out of date (the teams may no longer be level, or the bracket may exist): refresh
        // it, close the form and say why in the toast, which is always rendered.
        try {
          state.entries = await fetchBracket(eventId, client);
        } catch {
          // The refusal text already tells the person what happened; the next action reloads.
        }
        applySeedingRead(
          state.entries.length === 0 ? await readSeeding() : { rows: [], failed: false },
        );
        resetSeedingDraft();
        showToast(refusal.message);
      } else {
        state.seedingError = { field: 'form', message: describeSeedingError(err) };
        state.pendingFocus = 'seeding-error';
      }
      state.busy = false;
      render();
      return;
    }
    // The order IS saved from here on. Re-read the seed order; if that read fails, say the save worked.
    const read = await readSeeding();
    applySeedingRead(read);
    resetSeedingDraft();
    const allOrdered =
      !read.failed && blockingGroups(seedingTieGroups(state.seedingRows)).length === 0;
    showToast(
      read.failed
        ? 'Order saved, but the page could not refresh. Reload to see the standings.'
        : hadBlocking && allOrdered
          ? 'Order saved. Every team level across the cut-off is ordered: you can generate the bracket.'
          : 'Order saved.',
    );
    state.pendingFocus = 'seeding-button';
    state.busy = false;
    render();
  }

  async function retrySeeding() {
    if (state.busy || state.generating) return;
    state.busy = true;
    render();
    applySeedingRead(await readSeeding());
    state.busy = false;
    const found = seedingTieGroups(state.seedingRows).length;
    showToast(
      state.seedingReadFailed
        ? 'Still could not check. Try again.'
        : found > 0
          ? `Checked: ${found} ${found === 1 ? 'group' : 'groups'} of level teams.`
          : 'Checked: no teams are level.',
      { focus: false },
    );
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
    setBusyDisabled(generateButton, state.generating || state.busy);
    if (state.seedingGroupKey) {
      // Marked, not disabled (focus stays); pressing it says why in words (handleGenerateBracket).
      generateButton.setAttribute('aria-disabled', 'true');
      generateButton.setAttribute('aria-describedby', 'btc-generate-open-order');
    } else if (cutoffBlocked()) {
      generateButton.setAttribute('aria-disabled', 'true');
      generateButton.setAttribute('aria-describedby', 'btc-seeding-blocking');
    }
    generateButton.addEventListener('click', () => handleGenerateBracket());

    return el(
      'div',
      { className: 'card' },
      [
        el('h2', { text: 'Bracket' }),
        el('p', {
          className: 'stage-meta',
          text: 'Every preliminary match must be confirmed and at least 8 teams must have a result before the bracket can be generated. If teams are level across the 8th and 9th places they must be put in order first.',
        }),
        state.seedingGroupKey
          ? el('p', {
              id: 'btc-generate-open-order',
              className: 'stage-meta',
              text: OPEN_ORDER_MESSAGE,
            })
          : null,
        generateButton,
      ].filter(Boolean),
    );
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
      // Everything but the live region, which stays attached (a node that is removed and put back would reach
      // a screen reader with its text already in it).
      for (const node of [...root.childNodes]) if (node !== announcer) node.remove();

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
        const seedingGroups = seedingTieGroups(state.seedingRows);
        const seedingCard = renderSeedingTies({
          groups: seedingGroups,
          form: state.seedingGroupKey
            ? {
                groupKey: state.seedingGroupKey,
                orderedTeamIds: state.draftSeedingOrder,
                reason: state.draftSeedingReason,
                error: state.seedingError,
              }
            : null,
          busy: state.busy || state.generating,
          teamName,
          readFailed: state.seedingReadFailed,
          handlers: {
            onOpen: openSeedingForm,
            onMove: moveSeedingTeam,
            onReasonInput: (value) => {
              state.draftSeedingReason = value;
            },
            onSubmit: handleRecordSeeding,
            onCancel: closeSeedingForm,
            onRetry: retrySeeding,
          },
        });
        if (seedingCard) container.appendChild(seedingCard);
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

      // One live region for the whole life of the screen (the same node, put back after every rebuild), its text
      // set once it is in the page: a node inserted with its text already in it is not reliably announced.
      root.appendChild(container);
      announcer.textContent = state.announcement;
      state.announcement = '';

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
      } else if (state.pendingFocus === 'seeding-form') {
        state.pendingFocus = null;
        if (focusByKey(container, `seeding-form-heading-${state.seedingGroupKey}`)) return true;
      } else if (state.pendingFocus === 'seeding-error') {
        state.pendingFocus = null;
        if (focusByKey(container, `seeding-error-${state.seedingGroupKey}`)) return true;
      } else if (state.pendingFocus === 'seeding-button') {
        state.pendingFocus = null;
        if (focusByKey(container, `seeding-open-${state.lastClosedSeedingKey}`)) return true;
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
