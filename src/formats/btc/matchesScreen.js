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
import { describeError } from '../../core/errors.js';
import { findEvent } from '../../core/events.js';
import { publishBtcLive } from './liveSession.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import { countryName } from '../../core/country.js';
import { judgeCountryConflicts } from './countryConflicts.js';
import { teamLabel } from './words.js';
import { validateMatchDraft, createMatch, listMatches, removeMatch } from './matches.js';
import { newSeed } from '../../core/seededShuffle.js';
import { DrawError } from './draw.js';
import { fetchPreliminaryStandings } from './standings.js';
import { createRound, describeRoundError, roundRefusal } from './rounds.js';
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
    drawnRounds: new Set(), // rounds with a draw record in the database (create_btc_round refuses these)
    avoid: true,
    draw: null,
    refusal: null,
    swapPick: null,
    drawStatus: '',
    drawError: null,
    draft: blankDraft(),
    formError: null,
    busy: false,
    toastMessage: null,
    pendingFocus: null, // null | 'heading' | 'toast' — see setupScreen.js's own comment
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
    const [event, teams, judges, matches, standings, drawnRounds] = await Promise.all([
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
        .select('prelim_round')
        .eq('event_id', eventId)
        .then(({ data, error }) => (error ? [] : (data ?? []).map((row) => row.prelim_round)))
        .catch(() => []),
    ]);
    return { event, teams, judges, matches, standings, drawnRounds: new Set(drawnRounds) };
  }

  async function attemptLoad() {
    state.loading = true;
    render();
    try {
      const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
      state.event = persisted.event;
      state.teams = persisted.teams;
      state.judges = persisted.judges;
      state.matches = persisted.matches;
      state.standings = persisted.standings;
      state.drawnRounds = persisted.drawnRounds;
      state.loadFailedMessage = null;
      state.round = defaultRound(state.matches);
      rebuildDraw();
      state.pendingFocus = 'heading';
    } catch (err) {
      state.loadFailedMessage = err.timedOut
        ? 'This is taking longer than expected — check your connection and try Retry.'
        : describeError(err);
    }
    state.loading = false;
    render();
  }

  // ---- the Draw panel. Who plays whom comes from drawPlan.js (draw.js underneath); this only keeps the panel's state.
  const panelReady = () => state.teams.length >= 2 && state.judges.length >= 3;
  // Rounds whose draw record is in the database although none of their matches are (removed by hand): the database
  // refuses them for good, so the panel says so up front (drawPlan.js roundStatus) instead of offering a Create that fails.
  const deadRounds = () =>
    new Set(
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
    state.seedTyped = null;
    if (!panelReady() || !roundStatus(state.round, state.matches, deadRounds()).available) {
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
      const typed = text.trim();
      changeDraw(
        typed ? `Drawn again with seed ${typed}.` : 'Drawn again with a new seed.',
        typed || newSeed(),
      );
    },
    newSeed: () => changeDraw('New seed. The matches below have been drawn again.', newSeed()),
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
  };

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
      requestLivePublish(false);
      toast = `Round ${draw.round} created: ${draw.pairs.length} matches.`;
      try {
        state.matches = await listMatches(eventId, ROUND, client);
        state.round = defaultRound(state.matches);
        rebuildDraw(newSeed());
      } catch {
        state.draw = null;
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
          const persisted = await raceTimeout(loadPersisted(), DEFAULT_LOAD_TIMEOUT_MS);
          Object.assign(state, {
            event: persisted.event,
            teams: persisted.teams,
            judges: persisted.judges,
            matches: persisted.matches,
            standings: persisted.standings,
            drawnRounds: persisted.drawnRounds,
          });
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
      rebuildDraw(); // the preview's rounds and repeat-opponent counts follow the matches
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
  // organiser's own judgment. This is that cleanup path. window.confirm
  // matches this codebase's own established danger-zone pattern
  // (src/community/guess-the-bean/setupScreen.js's Reset Data/End Session)
  // for a destructive action with no undo — removing a match cascades to
  // its btc_match_judges/btc_cup_votes/btc_match_bonuses rows too.
  async function handleRemoveMatch(match) {
    if (state.busy) return;
    const ok = window.confirm(
      `Remove the match ${teamName(match.team1_id)} vs ${teamName(match.team2_id)}? This can't be undone.`,
    );
    if (!ok) return;
    state.busy = true;
    render();
    try {
      await removeMatch(match.id, client);
      state.matches = state.matches.filter((m) => m.match.id !== match.id);
      rebuildDraw();
      requestLivePublish(false);
      showToast(`${teamName(match.team1_id)} vs ${teamName(match.team2_id)} removed.`);
    } catch (err) {
      // Toast, not an inline formError like handleCreateMatch's own catch —
      // deliberate, not an oversight (found worth calling out in review,
      // code-reviewer): there's no per-row inline-error slot to put a
      // failed-delete message next to the way the create form has one next
      // to its own fields, so the same toast path renderMatchList's success
      // case already uses is the right one for this handler's failure case
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
              className: 'btc-field-error',
              text: state.formError,
              attrs: { role: 'alert' },
            })
          : null,
        submitButton,
      ].filter(Boolean),
    );
    form.addEventListener('submit', handleCreateMatch);

    return el('div', { className: 'card btc-match-form-card' }, [
      el('h2', { text: 'Create a preliminary match' }),
      form,
    ]);
  }

  function renderMatchRow({ match, judgeIds }) {
    const judgeNames = judgeIds.map(judgeName).join(', ');
    const scoreLink = el('a', {
      className: 'btn btn-outline tap-target',
      text: 'Score',
      attrs: {
        href: `#/events/${eventId}/btc/matches/${match.id}/scoring`,
        'aria-label': `Score ${teamName(match.team1_id)} vs ${teamName(match.team2_id)}`,
      },
    });
    const removeButton = el('button', {
      className: 'btn btn-outline tap-target',
      text: 'Remove',
      attrs: {
        type: 'button',
        'aria-label': `Remove ${teamName(match.team1_id)} vs ${teamName(match.team2_id)}`,
        'data-focus-key': `remove-match-${match.id}`,
      },
    });
    setBusyDisabled(removeButton, state.busy);
    removeButton.addEventListener('click', () => handleRemoveMatch(match));
    return el('li', {}, [
      el('div', { className: 'btc-match-info' }, [
        el('span', {
          className: 'btc-match-teams',
          text: `${teamName(match.team1_id)} vs ${teamName(match.team2_id)}`,
        }),
        el('span', { className: 'stage-meta', text: `Judges: ${judgeNames}` }),
      ]),
      el('div', { className: 'btc-match-actions' }, [scoreLink, removeButton]),
    ]);
  }

  // Grouped by round; a match with no round number reads as round 1 (Build A). Each group is its own list.
  function renderMatchList() {
    if (state.matches.length === 0) {
      return el('p', { className: 'stage-meta', text: 'No preliminary matches created yet.' });
    }
    const rounds = [...new Set(state.matches.map((m) => roundOf(m.match)))].sort((a, b) => a - b);
    return el(
      'div',
      { className: 'btc-round-groups' },
      rounds.map((round) =>
        el('section', { className: 'btc-round-group' }, [
          el('h3', { text: `Round ${round}` }),
          el(
            'ul',
            { className: 'roster-list', attrs: { 'aria-label': `Round ${round} matches` } },
            state.matches.filter((m) => roundOf(m.match) === round).map(renderMatchRow),
          ),
        ]),
      ),
    );
  }

  function renderLoading() {
    root.appendChild(
      el('section', { className: 'screen-container btc-matches-screen' }, [
        el('h1', { text: 'BTC Preliminary Matches' }),
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
        el('h1', { text: 'BTC Preliminary Matches' }),
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

      container.appendChild(
        el('h1', { text: 'BTC Preliminary Matches', attrs: { tabindex: '-1' } }),
      );

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
            },
            teams: state.teams,
            judges: state.judges,
            busy: state.busy,
            statusOf: (round) => roundStatus(round, state.matches, deadRounds()),
            on: drawHandlers,
          }),
        );
        container.appendChild(renderCreateForm());
      }

      container.appendChild(
        el('div', { className: 'card' }, [el('h2', { text: 'Matches' }), renderMatchList()]),
      );

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
