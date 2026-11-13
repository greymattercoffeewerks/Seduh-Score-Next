// BTC preliminary match creation screen (Phase T-BTC.2). Pick 2 teams +
// exactly 3 judges, create a match, see the round's match list grow.
// Scoped to the 'preliminary' round only — quarterfinal/semifinal/final
// matches are created from bracket slots once bracket generation (a later
// T-BTC.2 step) exists, a different flow with different inputs (seeded
// teams, not a free team picker), not this screen reused with a round
// dropdown.
//
// Built on the same accessibility-hardened shape setupScreen.js converged
// on after review (core/dom.js's setBusyDisabled/withFocusPreservation,
// data-field/data-focus-key on every interactive control, a pendingFocus
// state machine for the two cases nothing was already focused — a
// successful load, and a toast confirmation) — see that screen's own
// CLAUDE.md history entry for the three review rounds that shape came from.
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { confirmInPlace } from '../../core/feedback.js';
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { publishBtcLive } from './liveSession.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import { countryName } from '../../core/country.js';
import { judgeCountryConflicts } from './countryConflicts.js';
import { teamLabel, teamLabelNode } from './words.js';
import { renderGroupedMatchList } from '../../core/groupedMatchList.js';
import { canRemoveMatch, matchScoreText, matchStatusView, missingTime } from './matchList.js';
import { renderDrawSummary, showDrawSummary } from './drawSummary.js';
import { validateMatchDraft, createMatch, listMatches, removeMatch } from './matches.js';
import { newSeed } from '../../core/seededShuffle.js';
import { DrawError } from './draw.js';
import { fetchPreliminaryStandings } from './standings.js';
import { createRound, describeRoundError, redrawRound, roundRefusal } from './rounds.js';
import {
  defaultRound,
  drawIssues,
  generateDraw,
  recordMode,
  recordSeed,
  roundMatchesFor,
  roundOf,
  roundStatus,
  setJudge,
  setTick,
  swapTeams,
} from './drawPlan.js';
import { renderDrawPanel } from './drawPanel.js';

const ROUND = 'preliminary';

function blankDraft() {
  return { team1Id: '', team2Id: '', judgeIds: [], prelimRound: 1 };
}

export async function mountMatchesScreen(
  root,
  { eventId, client = getSupabase(), signal, handlers } = {},
) {
  let state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    teams: [],
    judges: [],
    matches: [],
    standings: null, // round 1 table for "by results"; null when it could not be read
    // The Draw panel (drawPlan.js): panel state only, nothing here is stored per event (the draw record holds what was used).
    round: 1,
    round2Mode: 'random',
    seedInput: newSeed(),
    seedTyped: null, // text typed in the seed box and not yet used
    scoredRounds: new Set(), // rounds the database refused to redraw because something in them is scored
    listStale: false, // a write succeeded but the matches could not be re-read
    drawnRounds: new Set(), // rounds with a draw record in the database (create_btc_round refuses these)
    drawRecords: new Map(), // round -> { mode, seed } from those records, for the summary card
    scores: null, // match id -> btc_match_scores row; null when they could not be read (then Remove is not offered)
    panelOpen: false, // the organiser asked for the full Draw panel although rounds are drawn
    roundOverrides: new Map(), // round -> collapsed, the organiser's own choice (a finished round starts collapsed)
    handOpen: false, // the "Add a match by hand" section
    avoid: true,
    draw: null,
    refusal: null,
    swapPick: null,
    drawStatus: '',
    drawError: null,
    drawErrorFresh: false, // the error has not been announced yet (drawPanel.js)
    draft: blankDraft(),
    formError: null,
    busy: false,
    toastMessage: null,
    pendingFocus: null, // null | 'heading' | 'toast' | 'draw-panel' | 'draw-open' — see setupScreen.js's own comment
  };
  let toastTimer;

  // "Country · Name" (words.js's teamLabel), or just the name for a team with no country.
  function teamName(id) {
    const team = state.teams.find((t) => t.id === id);
    return team ? teamLabel(team) : 'Unknown team';
  }
  function judgeName(id) {
    const judge = state.judges.find((j) => j.id === id);
    return judge ? teamLabel(judge) : 'Unknown judge';
  }

  // The audience display follows every change the room should see (liveSession.js). Best-effort: a failed or
  // offline publish stays queued and changes nothing about the action that triggered it. A programming error
  // (no handler map, an event without is_test) rejects, so it is logged here rather than left unhandled.
  function requestLivePublish(takeOver) {
    publishBtcLive({ event: state.event, takeOver }, handlers).catch((error) => {
      console.error('btc: live-view publish was refused', error);
    });
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
    const [event, teams, judges, matches, standings, drawRows, scoreRows] = await Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      listJudges(eventId, client),
      listMatches(eventId, ROUND, client),
      // Only round 2 "by results" needs it, so a failed read must not break the screen: that mode says so instead.
      fetchPreliminaryStandings(eventId, client)
        .then((ranked) => ranked.map((row) => row.item)) // rank() wraps each row as { item, position }
        .catch(() => null),
      // The draw record outlives its matches (Remove deletes only the match), so a round can be refused by the
      // database with nothing on screen. A failed read just means that case is learned from the refusal instead.
      client
        .from('btc_round_draws')
        .select('prelim_round, mode, seed')
        .eq('event_id', eventId)
        .then(({ data, error }) => (error ? [] : (data ?? [])))
        .catch(() => []),
      // Who has scores, and the confirmed totals the rows show. Advisory: a failed read must not break the screen, but
      // then "no scores" is unproven, so Remove is not offered (matchList.js canRemoveMatch).
      client
        .from('btc_match_scores')
        .select('match_id, status, team1_tokens, team2_tokens, team1_total, team2_total')
        .eq('event_id', eventId)
        .then(({ data, error }) => (error ? null : (data ?? [])))
        .catch(() => null),
    ]);
    return {
      event,
      teams,
      judges,
      matches,
      standings,
      drawnRounds: new Set(drawRows.map((row) => row.prelim_round)),
      drawRecords: new Map(
        drawRows.map((row) => [row.prelim_round, { mode: row.mode, seed: row.seed }]),
      ),
      scores: scoreRows === null ? null : new Map(scoreRows.map((row) => [row.match_id, row])),
    };
  }

  function applyPersisted(persisted) {
    Object.assign(state, {
      event: persisted.event,
      teams: persisted.teams,
      judges: persisted.judges,
      matches: persisted.matches,
      standings: persisted.standings,
      drawnRounds: persisted.drawnRounds,
      drawRecords: persisted.drawRecords,
      scores: persisted.scores,
      listStale: false,
    });
  }

  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      applyPersisted(await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS));
      state.loadFailedMessage = null;
      state.round = defaultRound(state.matches);
      rebuildDraw();
      state.pendingFocus = 'heading';
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'Still loading. Check the connection, then press Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  // ---- the Draw panel. Who plays whom comes from drawPlan.js (draw.js underneath); this only keeps the panel's state.
  const panelReady = () => state.teams.length >= 2 && state.judges.length >= 3;
  // Rounds whose draw record is in the database although none of their matches are (removed by hand): the database
  // refuses them for good, so the panel says so up front (drawPlan.js roundStatus) instead of offering a Create that fails.
  // (not while the list is known to be stale after a write: then "no matches on screen" proves nothing)
  const deadRounds = () =>
    state.listStale
      ? new Set()
      : new Set(
          [...state.drawnRounds].filter((r) => !state.matches.some((m) => roundOf(m.match) === r)),
        );
  const drawCtx = () => ({ teams: state.teams, judges: state.judges, matches: state.matches });

  // Runs the draw for the chosen round with `seed` (the typed or new seed). A refusal (an odd team count, no results)
  // becomes words and no preview; anything else is a bug and is thrown.
  function rebuildDraw(seed = state.seedInput) {
    state.draw = null;
    state.refusal = null;
    state.swapPick = null;
    state.drawError = null;
    if (
      !panelReady() ||
      !roundStatus(state.round, state.matches, deadRounds(), state.scoredRounds).available
    ) {
      return;
    }
    try {
      state.draw = generateDraw({
        round: state.round,
        round2Mode: state.round2Mode,
        seed,
        avoid: state.avoid,
        ...drawCtx(),
        standings: state.standings,
      });
      state.seedInput = state.draw.seed;
    } catch (err) {
      if (!(err instanceof DrawError)) throw err;
      state.refusal = err.message;
    }
  }

  function changeDraw(statusText, seed) {
    if (state.busy) return;
    rebuildDraw(seed);
    state.drawStatus = statusText;
    render();
  }

  const drawHandlers = {
    // Each of these checks `busy` BEFORE it sets state: the controls are only aria-disabled while a create is in
    // flight (core/dom.js setBusyDisabled), so a change event can still arrive and must not move the panel's state.
    round: (round) => {
      if (state.busy) return;
      state.round = Number(round);
      changeDraw(`Round ${state.round} selected.`, state.seedInput);
    },
    mode: (mode) => {
      if (state.busy) return;
      state.round2Mode = mode;
      changeDraw(
        mode === 'by_results' ? 'Drawing by results.' : 'Drawing at random.',
        state.seedInput,
      );
    },
    avoid: (value) => {
      if (state.busy) return;
      state.avoid = value;
      changeDraw(
        value ? 'Avoiding repeat opponents.' : 'Repeat opponents allowed.',
        state.seedInput,
      );
    },
    // typed but not yet used: kept so another action's redraw does not wipe the box (no render here)
    typing: (text) => {
      state.seedTyped = text;
    },
    seed: (text) => {
      if (state.busy) return;
      state.seedTyped = null;
      const typed = text.trim();
      changeDraw(
        typed ? `Drawn again with seed ${typed}.` : 'Drawn again with a new seed.',
        typed || newSeed(),
      );
    },
    newSeed: () => {
      if (state.busy) return;
      state.seedTyped = null;
      changeDraw('New seed. The matches below have been drawn again.', newSeed());
    },
    swap: (match, slot) => {
      if (state.busy || !state.draw) return;
      const picked = state.swapPick;
      if (!picked) {
        state.swapPick = { match, slot };
        state.drawStatus = 'Choose the team to swap with.';
        render();
        return;
      }
      state.swapPick = null;
      if (picked.match === match && picked.slot === slot) {
        state.drawStatus = 'Swap cancelled.';
      } else {
        const idAt = (at) => state.draw.pairs[at.match][at.slot === 1 ? 'team1Id' : 'team2Id'];
        const names = `${teamName(idAt(picked))} and ${teamName(idAt({ match, slot }))}`;
        state.draw = swapTeams(state.draw, picked, { match, slot }, drawCtx());
        state.drawStatus = `Swapped ${names}. This draw is now changed by hand, so no seed is recorded.`;
      }
      render();
    },
    judge: (match, slot, judgeId) => {
      if (state.busy || !state.draw) return;
      state.draw = setJudge(state.draw, match, slot, judgeId);
      state.drawStatus = '';
      render();
    },
    tick: (match, ticked) => {
      if (state.busy || !state.draw) return;
      state.draw = setTick(state.draw, match, ticked);
      state.drawStatus = ticked
        ? `Match ${match + 1}: conflict accepted.`
        : `Match ${match + 1}: conflict no longer accepted.`;
      render();
    },
    create: () => handleCreateRound(),
    redraw: (round, trigger) => handleRedrawRound(round, trigger),
  };

  // Re-reads everything the draw depends on; a failed read keeps what is on screen.
  async function reloadPersisted() {
    try {
      applyPersisted(await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS));
    } catch {
      // keep what is on screen
    }
  }

  // Clears a round (its matches and its draw record) so it can be drawn again. Destructive, so it asks first, the way
  // Remove does; the database refuses unless nothing in the round is scored.
  async function handleRedrawRound(round, trigger) {
    if (state.busy) return;
    const count = state.matches.filter((m) => roundOf(m.match) === round).length;
    const ok = await confirmInPlace(trigger, {
      title: `Redraw round ${round}?`,
      body:
        count > 0
          ? `This removes its ${count} ${count === 1 ? 'match' : 'matches'} and the draw record. You can draw the round again afterwards; these matches cannot be brought back.`
          : 'This clears the leftover draw record. You can draw the round again afterwards.',
      confirmLabel: 'Redraw round',
      tone: 'danger',
      isTest: Boolean(state.event?.is_test),
    });
    if (!ok) return;
    state.busy = true;
    state.drawError = null;
    render();
    let toast = null;
    try {
      await raceTimeout(
        redrawRound({ orgId: state.event.org_id, eventId, prelimRound: round }, client),
        DEFAULT_LOAD_TIMEOUT_MS * 2,
      );
      await reloadPersisted();
      // the server cleared it, so the screen does too even when the re-read failed (it would keep the old matches)
      state.matches = state.matches.filter((m) => roundOf(m.match) !== round);
      state.drawnRounds = new Set([...state.drawnRounds].filter((r) => r !== round));
      state.drawRecords = new Map([...state.drawRecords].filter(([r]) => r !== round));
      state.panelOpen = true; // a cleared round is drawn again from the full panel
      state.scoredRounds = new Set([...state.scoredRounds].filter((r) => r !== round));
      requestLivePublish(false);
      state.round = round;
      state.seedTyped = null;
      rebuildDraw(newSeed());
      state.drawStatus = '';
      toast = `Round ${round} cleared. Draw it again below.`;
    } catch (err) {
      if (signal?.aborted) return;
      state.drawError = err?.timedOut
        ? 'This is taking too long to confirm. Check the matches list before trying again.'
        : describeRoundError(err);
      state.drawErrorFresh = true;
      // the database knows about scores the screen cannot see (votes, bonuses, times): remember, so Redraw stops being offered
      if (err?.hint === 'btc_redraw_scored')
        state.scoredRounds = new Set([...state.scoredRounds, round]);
      if (roundRefusal(err)?.reload || err?.timedOut) {
        await reloadPersisted();
        // a redraw that timed out may still have landed: the display must follow
        if (err?.timedOut && !state.matches.some((m) => roundOf(m.match) === round)) {
          requestLivePublish(false);
        }
        state.round = round; // stay on the round the organiser was looking at
        const error = state.drawError;
        rebuildDraw(newSeed());
        state.drawError = error;
      }
    }
    state.busy = false;
    if (toast) showToast(toast);
    render();
  }

  async function handleCreateRound() {
    const draw = state.draw;
    if (state.busy || !draw) return;
    if (!drawIssues(draw, drawCtx()).valid) return;
    state.busy = true;
    state.drawError = null;
    render();
    let toast = null;
    try {
      // Bounded like the page's own loads: a call that never answers must not leave "Creating…" for good. The call
      // is not cancelled, so a timeout reloads the page's state and the organiser sees whether the round landed.
      await raceTimeout(
        createRound(
          {
            orgId: state.event.org_id,
            eventId,
            prelimRound: draw.round,
            mode: recordMode(draw),
            seed: recordSeed(draw),
            matches: roundMatchesFor(draw),
            avoidRematches: draw.avoid,
          },
          client,
        ),
        DEFAULT_LOAD_TIMEOUT_MS * 2,
      );
      // the round is written from here on: whatever happens next must not read as a failed create
      // its draw record now exists: a later Remove of every match must not make the round look drawable again
      state.drawnRounds = new Set([...state.drawnRounds, draw.round]);
      state.drawRecords = new Map([
        ...state.drawRecords,
        [draw.round, { mode: recordMode(draw), seed: recordSeed(draw) }],
      ]);
      state.panelOpen = false; // the new round shows as the summary card
      requestLivePublish(false);
      toast = `Round ${draw.round} created: ${draw.pairs.length} matches.`;
      state.seedTyped = null;
      try {
        state.matches = await listMatches(eventId, ROUND, client);
        state.listStale = false;
        state.round = defaultRound(state.matches);
        rebuildDraw(newSeed());
      } catch {
        state.draw = null;
        state.listStale = true;
        state.refusal = `Round ${draw.round} was created, but the list could not be refreshed. Reload the page to see it.`;
      }
    } catch (err) {
      if (signal?.aborted) return;
      const message = err?.timedOut
        ? 'This is taking too long to confirm. Check the matches list before trying again: if the round is there, it was created.'
        : describeRoundError(err);
      if (roundRefusal(err)?.reload || err?.timedOut) {
        // the page is out of date (round already drawn, event gone): refresh it, then say why
        try {
          applyPersisted(await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS));
        } catch {
          // keep what is on screen; the message below still says what happened
        }
        // the refusal itself proves this round has a draw record, whether or not the read above saw it
        if (err?.hint === 'btc_round_exists') {
          state.drawnRounds = new Set([...state.drawnRounds, draw.round]);
        }
        state.round = defaultRound(state.matches);
        rebuildDraw(newSeed());
        state.drawStatus = '';
      }
      state.drawError = message;
      state.drawErrorFresh = true;
      // a create that timed out may still have landed: if the reload shows the round, the display must follow
      if (err?.timedOut && state.matches.some((m) => roundOf(m.match) === draw.round)) {
        requestLivePublish(false);
      }
    }
    state.busy = false;
    if (toast) showToast(toast);
    render();
  }

  // Caps selection at 3 and re-renders either way — checking a 4th box
  // needs the re-render to snap that checkbox's own native `checked` back
  // to false (the browser already flipped it before this handler runs), and
  // every real toggle needs one too so the "X of 3 selected" live region
  // stays in sync. Found missing entirely in review (ui-accessibility-
  // reviewer): previously nothing here capped selection or announced the
  // running count, so an organiser (sighted or not) had no feedback until
  // submitting produced the validation error after the fact.
  function toggleDraftJudge(judgeId, checked) {
    if (checked && state.draft.judgeIds.length >= 3 && !state.draft.judgeIds.includes(judgeId)) {
      render();
      return;
    }
    state.draft.judgeIds = checked
      ? [...state.draft.judgeIds, judgeId]
      : state.draft.judgeIds.filter((id) => id !== judgeId);
    render();
  }

  async function handleCreateMatch(domEvent) {
    domEvent.preventDefault();
    if (state.busy) return;
    const validationMessage = validateMatchDraft(state.draft);
    if (validationMessage) {
      state.formError = validationMessage;
      render();
      return;
    }
    state.busy = true;
    state.formError = null;
    render();
    try {
      const match = await createMatch(eventId, { round: ROUND, ...state.draft }, client);
      state.matches = [...state.matches, { match, judgeIds: state.draft.judgeIds }];
      if (roundStatus(state.round, state.matches).drawn) state.round = defaultRound(state.matches);
      rebuildDraw(); // the preview's rounds and repeat-opponent counts follow the matches
      state.drawStatus = 'The matches changed, so the draw was made again.';
      requestLivePublish(false);
      const t1 = teamName(state.draft.team1Id);
      const t2 = teamName(state.draft.team2Id);
      state.draft = { ...blankDraft(), prelimRound: state.draft.prelimRound };
      showToast(`${t1} vs ${t2} created.`);
    } catch (err) {
      state.formError = describeError(err);
    }
    state.busy = false;
    render();
  }

  // createMatch has no idempotency key (see the RPC's own comment) — a
  // dropped response after a real write can leave a duplicate match behind
  // with no way to tell it apart from a legitimate rematch except the
  // organiser's own judgment. This is that cleanup path. It asks in place
  // (core/feedback.js) first; removing a match cascades to
  // its btc_match_judges/btc_cup_votes/btc_match_bonuses rows too.
  async function handleRemoveMatch(match, trigger) {
    if (state.busy) return;
    const ok = await confirmInPlace(trigger, {
      title: `Remove the match ${teamName(match.team1_id)} vs ${teamName(match.team2_id)}?`,
      body: 'Its judges are removed with it. Create the match again to get it back.',
      confirmLabel: 'Remove match',
      tone: 'danger',
      isTest: Boolean(state.event?.is_test),
    });
    if (!ok) return;
    state.busy = true;
    render();
    try {
      await removeMatch(match.id, client);
      state.matches = state.matches.filter((m) => m.match.id !== match.id);
      state.round = defaultRound(state.matches);
      rebuildDraw();
      state.drawStatus = 'The matches changed, so the draw was made again.';
      requestLivePublish(false);
      showToast(`${teamName(match.team1_id)} vs ${teamName(match.team2_id)} removed.`);
    } catch (err) {
      // Toast, not an inline formError like handleCreateMatch's own catch —
      // deliberate, not an oversight (found worth calling out in review,
      // code-reviewer): there's no per-row inline-error slot to put a
      // failed-delete message next to the way the create form has one next
      // to its own fields, so the same toast handleRemoveMatch's own success
      // branch uses is the right one for this handler's failure case
      // too.
      showToast(describeError(err));
    }
    state.busy = false;
    render();
  }

  function renderCreateForm() {
    const errorId = 'btc-match-form-error';

    const teamSelect = (fieldKey, label) => {
      const select = el('select', {
        className: 'field-input',
        attrs: { 'aria-label': label, 'data-field': fieldKey },
      });
      select.appendChild(el('option', { text: 'Select a team…', attrs: { value: '' } }));
      for (const team of state.teams) {
        const option = el('option', { text: teamLabel(team), attrs: { value: team.id } });
        if (team.id === state.draft[fieldKey]) option.selected = true;
        select.appendChild(option);
      }
      setBusyDisabled(select, state.busy);
      // Re-renders: the judge-country warning depends on which teams are chosen.
      select.addEventListener('change', () => {
        state.draft[fieldKey] = select.value;
        render();
      });
      return select;
    };

    const roundSelect = el('select', {
      className: 'field-input',
      attrs: { 'aria-label': 'Round', 'data-field': 'prelimRound' },
    });
    for (const r of [1, 2]) {
      const option = el('option', { text: `Round ${r}`, attrs: { value: String(r) } });
      if (r === state.draft.prelimRound) option.selected = true;
      roundSelect.appendChild(option);
    }
    setBusyDisabled(roundSelect, state.busy);
    roundSelect.addEventListener('change', () => {
      state.draft.prelimRound = Number(roundSelect.value);
      render();
    });

    const team1Select = teamSelect('team1Id', 'Team 1');
    const team2Select = teamSelect('team2Id', 'Team 2');

    const judgeCheckboxes = state.judges.map((judge) => {
      const checkbox = el('input', {
        attrs: { type: 'checkbox', 'data-field': `judge-${judge.id}` },
      });
      checkbox.checked = state.draft.judgeIds.includes(judge.id);
      setBusyDisabled(checkbox, state.busy);
      checkbox.addEventListener('change', () => toggleDraftJudge(judge.id, checkbox.checked));
      const label = el('label', { className: 'btc-judge-checkbox-label' }, [
        checkbox,
        el('span', { text: teamLabel(judge) }),
      ]);
      return label;
    });

    // A judge from the same country as a chosen team: a warning in words, never a refusal (a committee may need an
    // exception), so Create match stays enabled. Judges and teams with no country never appear here.
    const conflicts = judgeCountryConflicts({
      judges: state.judges,
      teams: state.teams,
      team1Id: state.draft.team1Id,
      team2Id: state.draft.team2Id,
      judgeIds: state.draft.judgeIds,
    });
    const conflictLines = conflicts.map(({ judgeId, teamId }) => {
      const judge = state.judges.find((j) => j.id === judgeId);
      const team = state.teams.find((t) => t.id === teamId);
      return el('p', {
        className: 'btc-country-warning',
        text: `Judge ${judge.name} is from ${countryName(judge.country_code)}, the same country as ${team.name}.`,
      });
    });
    const conflictId = 'btc-judge-country-warning';

    // A form-level error (not one specific field — it can name either team
    // or the judge count) is associated to the control the organiser will
    // reach next, same reasoning setupScreen.js's per-field aria-describedby
    // uses, just aimed at Submit since there's no single input to point at.
    const submitButton = el('button', {
      className: 'btn btn-primary tap-target',
      text: state.busy ? 'Creating…' : 'Create match',
      attrs: {
        type: 'submit',
        'data-focus-key': 'match-submit',
        ...(state.formError ? { 'aria-describedby': errorId } : {}),
      },
    });
    setBusyDisabled(submitButton, state.busy);

    const form = el(
      'form',
      { className: 'btc-match-form' },
      [
        labeledField('Round', roundSelect),
        el('div', { className: 'btc-match-form-teams' }, [
          labeledField('Team 1', team1Select),
          el('span', { className: 'btc-match-vs', text: 'vs', attrs: { 'aria-hidden': 'true' } }),
          labeledField('Team 2', team2Select),
        ]),
        el(
          'fieldset',
          {
            className: 'btc-judge-fieldset',
            attrs: conflictLines.length ? { 'aria-describedby': conflictId } : {},
          },
          [
            el('legend', { text: 'Judges (select exactly 3)' }),
            el('div', { className: 'btc-judge-checkboxes' }, judgeCheckboxes),
            el('p', {
              className: 'stage-meta',
              text: `${state.draft.judgeIds.length} of 3 selected`,
              attrs: { role: 'status', 'aria-live': 'polite' },
            }),
            el(
              'div',
              { id: conflictId, className: 'btc-country-warnings', attrs: { role: 'status' } },
              conflictLines,
            ),
          ],
        ),
        state.formError
          ? el('p', {
              id: errorId,
              className: 'form-field-error',
              text: state.formError,
              attrs: { role: 'alert' },
            })
          : null,
        submitButton,
      ].filter(Boolean),
    );
    form.addEventListener('submit', handleCreateMatch);

    return el('div', { className: 'card btc-match-form-card' }, [
      el('h2', { text: 'New match' }),
      form,
    ]);
  }

  // One row of the grouped list (core/groupedMatchList.js): what BTC says about a match. Score or View is the one
  // action; Remove only before scoring starts (Q7, matchList.js canRemoveMatch).
  function matchRowView({ match, judgeIds }, indexInRound) {
    const team1 = state.teams.find((t) => t.id === match.team1_id);
    const team2 = state.teams.find((t) => t.id === match.team2_id);
    const names = `${teamName(match.team1_id)} vs ${teamName(match.team2_id)}`;
    const score = state.scores?.get(match.id);
    const confirmed = match.status === 'confirmed';
    const action = el('a', {
      className: 'btn btn-outline tap-target',
      text: confirmed ? 'View' : 'Score',
      attrs: {
        href: `#/events/${eventId}/btc/matches/${match.id}/scoring`,
        'aria-label': `${confirmed ? 'View' : 'Score'} ${names}`,
      },
    });
    const actions = [action];
    if (canRemoveMatch(match, score, state.scores !== null)) {
      const removeButton = el('button', {
        className: 'btn btn-outline tap-target',
        text: 'Remove',
        attrs: {
          type: 'button',
          'aria-label': `Remove ${names}`,
          'data-focus-key': `remove-match-${match.id}`,
        },
      });
      setBusyDisabled(removeButton, state.busy);
      removeButton.addEventListener('click', () => handleRemoveMatch(match, removeButton));
      actions.push(removeButton);
    }
    const meta = [`Judges: ${judgeIds.map(judgeName).join(', ')}`];
    if (missingTime(match)) meta.push('No finish time');
    return {
      number: indexInRound + 1,
      sides: [
        team1 ? teamLabelNode(team1) : 'Unknown team',
        team2 ? teamLabelNode(team2) : 'Unknown team',
      ],
      score: matchScoreText(match, score),
      meta: meta.join(' · '),
      status: matchStatusView(match),
      actions,
    };
  }

  // Grouped by round (core/groupedMatchList.js); a match with no round number reads as round 1 (Build A). A finished
  // round starts collapsed to its header; the organiser's own open/close choice is kept in state.roundOverrides.
  function renderMatchList() {
    const indexInRound = new Map();
    const seen = new Map();
    for (const m of state.matches) {
      const r = roundOf(m.match);
      const n = seen.get(r) ?? 0;
      indexInRound.set(m.match.id, n);
      seen.set(r, n + 1);
    }
    return renderGroupedMatchList({
      items: state.matches,
      groupKey: (m) => roundOf(m.match),
      groupLabel: (round) => `Round ${round}`,
      rowView: (m) => matchRowView(m, indexInRound.get(m.match.id)),
      overrides: state.roundOverrides,
      onToggle: (round, collapsed) => {
        state.roundOverrides = new Map([...state.roundOverrides, [round, collapsed]]);
        render();
      },
      emptyText: 'No matches yet. Draw round 1 to create them.',
      idPrefix: 'btc-round',
    });
  }

  // The hand-entry form, kept as the correction path (a collapsed section below the rounds).
  function renderHandSection() {
    const details = el('details', { className: 'card btc-hand-section' }, [
      el('summary', {
        className: 'btc-hand-summary',
        text: 'Add a match by hand (for corrections)',
      }),
      renderCreateForm(),
    ]);
    details.open = state.handOpen;
    details.addEventListener('toggle', () => {
      state.handOpen = details.open;
    });
    return details;
  }

  function renderLoading() {
    root.appendChild(
      el('section', { className: 'screen-container btc-matches-screen' }, [
        el('h1', { text: 'Matches' }),
        el('div', {
          className: 'screen-feedback',
          text: 'Loading matches…',
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
      el('section', { className: 'screen-container btc-matches-screen' }, [
        el('h1', { text: 'Matches' }),
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
        return;
      }
      if (state.loadFailedMessage) {
        renderLoadError();
        return true;
      }

      const container = el('section', { className: 'screen-container btc-matches-screen' });

      if (state.event?.is_test) {
        container.appendChild(
          el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
        );
      }

      container.appendChild(el('h1', { text: 'Matches', attrs: { tabindex: '-1' } }));

      if (state.teams.length < 2) {
        container.appendChild(
          el('p', {
            className: 'stage-meta',
            text: 'Add at least 2 teams in Setup before creating a match.',
          }),
        );
      } else if (state.judges.length < 3) {
        container.appendChild(
          el('p', {
            className: 'stage-meta',
            text: 'Add at least 3 judges in Setup before creating a match.',
          }),
        );
      } else {
        const summaryArgs = {
          matches: state.matches,
          deadRounds: deadRounds(),
          scoredRounds: state.scoredRounds,
        };
        if (showDrawSummary({ ...summaryArgs, panelOpen: state.panelOpen })) {
          container.appendChild(
            renderDrawSummary({
              matches: state.matches,
              records: state.drawRecords,
              busy: state.busy,
              onOpen: () => {
                state.panelOpen = true;
                state.pendingFocus = 'draw-panel';
                render();
              },
            }),
          );
        } else {
          // the panel was opened from the summary: a way back to the summary while nothing is waiting to be drawn
          if (showDrawSummary({ ...summaryArgs, panelOpen: false })) {
            const close = el('button', {
              className: 'btn btn-outline tap-target',
              text: 'Close the draw panel',
              attrs: { type: 'button', 'data-focus-key': 'draw-close' },
            });
            setBusyDisabled(close, state.busy);
            close.addEventListener('click', () => {
              if (state.busy) return;
              state.panelOpen = false;
              state.pendingFocus = 'draw-open';
              render();
            });
            container.appendChild(close);
          }
          container.appendChild(
            renderDrawPanel({
              state: {
                round: state.round,
                round2Mode: state.round2Mode,
                seedInput: state.seedTyped ?? state.seedInput,
                avoid: state.avoid,
                draw: state.draw,
                refusal: state.refusal,
                swapPick: state.swapPick,
                status: state.drawStatus,
                error: state.drawError,
                errorFresh: state.drawErrorFresh,
              },
              teams: state.teams,
              judges: state.judges,
              busy: state.busy,
              statusOf: (round) =>
                roundStatus(round, state.matches, deadRounds(), state.scoredRounds),
              on: drawHandlers,
            }),
          );
        }
      }

      container.appendChild(
        el('div', { className: 'card' }, [el('h2', { text: 'Matches' }), renderMatchList()]),
      );
      if (state.teams.length >= 2 && state.judges.length >= 3) {
        container.appendChild(renderHandSection());
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
      state.drawErrorFresh = false; // announced by this render, if there was one

      if (state.pendingFocus === 'heading') {
        state.pendingFocus = null;
        const heading = container.querySelector('h1');
        if (heading) {
          heading.focus();
          return true;
        }
      } else if (state.pendingFocus === 'draw-panel' || state.pendingFocus === 'draw-open') {
        const target =
          state.pendingFocus === 'draw-panel'
            ? container.querySelector('[data-field="draw-round-1"]')
            : container.querySelector('[data-focus-key="draw-open"]');
        state.pendingFocus = null;
        if (target) {
          target.focus();
          return true;
        }
      } else if (state.pendingFocus === 'toast') {
        state.pendingFocus = null;
        if (toastNode) {
          toastNode.focus();
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
