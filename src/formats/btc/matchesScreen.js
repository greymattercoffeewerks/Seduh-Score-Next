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
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../../core/timeout.js';
import { listTeams } from './teams.js';
import { listJudges } from './judges.js';
import { validateMatchDraft, createMatch, listMatches, removeMatch } from './matches.js';

const ROUND = 'preliminary';

function blankDraft() {
  return { team1Id: '', team2Id: '', judgeIds: [] };
}

export async function mountMatchesScreen(root, { eventId, client = getSupabase(), signal } = {}) {
  let state = {
    loading: true,
    loadFailedMessage: null,
    event: null,
    teams: [],
    judges: [],
    matches: [],
    draft: blankDraft(),
    formError: null,
    busy: false,
    toastMessage: null,
    pendingFocus: null, // null | 'heading' | 'toast' — see setupScreen.js's own comment
  };
  let toastTimer;

  function teamName(id) {
    return state.teams.find((t) => t.id === id)?.name ?? 'Unknown team';
  }
  function judgeName(id) {
    return state.judges.find((j) => j.id === id)?.name ?? 'Unknown judge';
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
    const [event, teams, judges, matches] = await Promise.all([
      findEvent(eventId, client),
      listTeams(eventId, client),
      listJudges(eventId, client),
      listMatches(eventId, ROUND, client),
    ]);
    return { event, teams, judges, matches };
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
      const t1 = teamName(state.draft.team1Id);
      const t2 = teamName(state.draft.team2Id);
      state.draft = blankDraft();
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
        const option = el('option', { text: team.name, attrs: { value: team.id } });
        if (team.id === state.draft[fieldKey]) option.selected = true;
        select.appendChild(option);
      }
      setBusyDisabled(select, state.busy);
      select.addEventListener('change', () => {
        state.draft[fieldKey] = select.value;
      });
      return select;
    };

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
        el('span', { text: judge.name }),
      ]);
      return label;
    });

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
        el('div', { className: 'btc-match-form-teams' }, [
          labeledField('Team 1', team1Select),
          el('span', { className: 'btc-match-vs', text: 'vs', attrs: { 'aria-hidden': 'true' } }),
          labeledField('Team 2', team2Select),
        ]),
        el('fieldset', { className: 'btc-judge-fieldset' }, [
          el('legend', { text: 'Judges (select exactly 3)' }),
          el('div', { className: 'btc-judge-checkboxes' }, judgeCheckboxes),
          el('p', {
            className: 'stage-meta',
            text: `${state.draft.judgeIds.length} of 3 selected`,
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
        submitButton,
      ].filter(Boolean),
    );
    form.addEventListener('submit', handleCreateMatch);

    return el('div', { className: 'card btc-match-form-card' }, [
      el('h2', { text: 'Create a preliminary match' }),
      form,
    ]);
  }

  function renderMatchList() {
    if (state.matches.length === 0) {
      return el('p', { className: 'stage-meta', text: 'No preliminary matches created yet.' });
    }
    const items = state.matches.map(({ match, judgeIds }) => {
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
    });
    return el(
      'ul',
      { className: 'roster-list', attrs: { 'aria-label': 'Preliminary matches' } },
      items,
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
