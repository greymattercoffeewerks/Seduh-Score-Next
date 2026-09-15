// Guess the Bean — session management (Phase 3, port of legacy's
// booth/setup/index.html: github.com/greymattercoffee/Seduh-Score, dev
// branch). Ported BEHAVIOR (create → manage → danger zone), restyled to
// Next's design tokens — not a literal copy. Two deliberate departures from
// legacy, both because this port's own account model is genuinely
// different, not because the legacy behavior was skipped:
//   1. Legacy shows ONE session at a time (a single localStorage slot per
//      browser, since booth operators shared one super_admin login). This
//      port's sessions are per-USER-ACCOUNT (Phase 1's own locked identity-
//      anchor decision), so a creator can genuinely have many sessions
//      across devices/time — a list + detail view fits that reality better
//      than a single-slot model would.
//   2. Legacy's danger zone deletes guesses/contacts via a plain client
//      write. This port's RLS locks that to service_role only (the spec's
//      own checklist) — Reset Data goes through the reset_guess_session_data
//      SECURITY DEFINER RPC instead (see that migration's own comment).
import qrcode from 'qrcode-generator';
import { getSupabase } from '../../core/supabaseClient.js';
import { el, labeledField, setBusyDisabled, withFocusPreservation } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';
import {
  createSession,
  listMySessions,
  updateSession,
  resetSessionData,
  endSession,
  buildParticipantUrl,
  buildDisplayUrl,
  fetchSessionExport,
} from './sessions.js';

export function validateCreateDraft(draft) {
  const errors = {};
  if (!draft.name.trim()) errors.name = 'Session name is required.';
  const beanCount = Number.parseInt(draft.beanCount, 10);
  if (!draft.beanCount.trim() || !Number.isInteger(beanCount) || beanCount <= 0) {
    errors.beanCount = 'Enter a bean count greater than 0.';
  }
  return errors;
}

// `fetchSessionExport()` preserves the guesses query's arrival order. Array
// sort is stable, so equal-distance entries keep that order: earliest arrival
// wins, matching the display's Phase 5 rule and making the contact shown here
// unambiguous.
export function findWinnerContact(rows, beanCount) {
  return (
    [...rows].sort((a, b) => Math.abs(a.guess - beanCount) - Math.abs(b.guess - beanCount))[0] ??
    null
  );
}

export async function mountSetupScreen(root, { client = getSupabase(), signal } = {}) {
  let state = {
    view: 'loading',
    sessions: [],
    activeSessionId: null,
    creating: false,
    createDraft: { name: '', beanCount: '' },
    createErrors: {},
    busy: false,
    toastMessage: null,
    winnerContact: null,
    winnerError: null,
  };
  let userId = null;
  let toastTimer;
  let lastFocusedView = null;

  function activeSession() {
    return state.sessions.find((s) => s.id === state.activeSessionId) ?? null;
  }

  function showToast(message) {
    state.toastMessage = message;
    clearTimeout(toastTimer);
    render();
    toastTimer = setTimeout(() => {
      state.toastMessage = null;
      render();
    }, 1500);
  }

  async function loadSessions() {
    state.view = 'loading';
    render();
    try {
      state.sessions = await listMySessions(client);
    } catch (err) {
      // A toast, not a permanent banner — found in review (code-reviewer):
      // a permanent `state.error` banner was never cleared by any later
      // action (create/toggle/navigate), so one failed initial load kept
      // showing a stale error message underneath every view, forever, even
      // after later actions succeeded.
      state.view = 'list';
      showToast(describeError(err));
      return;
    }
    state.view = state.sessions.length === 0 ? 'create' : 'list';
    render();
  }

  async function handleCreateSubmit(event) {
    event.preventDefault();
    const errors = validateCreateDraft(state.createDraft);
    if (Object.keys(errors).length) {
      state.createErrors = errors;
      render();
      return;
    }
    if (state.creating) return;
    state.creating = true;
    render();

    let session;
    try {
      session = await createSession(
        {
          creatorId: userId,
          name: state.createDraft.name.trim(),
          beanCount: Number.parseInt(state.createDraft.beanCount, 10),
        },
        client,
      );
    } catch (err) {
      state.creating = false;
      state.createErrors = { create: describeError(err) };
      render();
      return;
    }

    state.creating = false;
    state.createDraft = { name: '', beanCount: '' };
    state.createErrors = {};
    state.sessions = [session, ...state.sessions];
    state.activeSessionId = session.id;
    state.view = 'detail';
    render();
  }

  async function handleToggle(field, value) {
    // The checkbox/select this guards are native, stateful controls —
    // unlike a <button>, the browser flips their `checked`/`value` as part
    // of default handling BEFORE this listener runs, and aria-disabled
    // (setBusyDisabled, unlike a real `disabled`) does not suppress that.
    // A second toggle/keyboard change during an in-flight request would
    // otherwise leave the control showing the wrong value, silently, until
    // the FIRST request resolves and render() happens to correct it. This
    // re-render snaps it back to the real (server-confirmed) value right
    // away instead of leaving that gap open. Found in review
    // (code-reviewer).
    if (state.busy) {
      render();
      return;
    }
    const session = activeSession();
    state.busy = true;
    render();
    try {
      const updated = await updateSession(session.id, { [field]: value }, client);
      state.sessions = state.sessions.map((s) => (s.id === updated.id ? updated : s));
    } catch (err) {
      showToast(describeError(err));
    }
    state.busy = false;
    render();
  }

  async function handleReveal() {
    // Explicit re-check, same reason handleToggle re-checks state.busy:
    // the Reveal button is only aria-disabled once already revealed (never
    // native `disabled`, so it stays focusable), and aria-disabled doesn't
    // itself block a click. Without this, clicking an already-revealed
    // session's Reveal button would re-run the update and pop a second
    // "Revealed." toast for no reason.
    if (activeSession()?.revealed) return;
    await handleToggle('revealed', true);
    if (!state.toastMessage) showToast('Revealed.');
  }

  async function handleExport() {
    // Same busy re-check every other danger-zone/toggle handler already
    // has. Previously relied entirely on the native `disabled` attribute
    // for double-click protection (the only handler here that did) — that
    // stopped being a real guard once the export button switched to
    // aria-disabled (setBusyDisabled), which doesn't block clicks, so this
    // needs its own explicit state.busy guard like its siblings.
    if (state.busy) return;
    const session = activeSession();
    state.busy = true;
    render();
    let rows;
    try {
      rows = await fetchSessionExport(session.id, client);
    } catch (err) {
      state.busy = false;
      showToast(describeError(err));
      return;
    }
    const exportObj = {
      exportedAt: new Date().toISOString(),
      session: { id: session.id, name: session.name, beanCount: session.bean_count },
      guesses: rows,
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guess-the-bean-export-${session.id}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    state.busy = false;
    showToast('Data exported.');
  }

  async function handleFindWinner() {
    // Same explicit re-check every other danger-zone/toggle handler here
    // needs: the button is only aria-disabled pre-reveal, and aria-disabled
    // doesn't itself block a click. Without this, clicking the button on a
    // still-open session would compute a "winner" from an in-progress game.
    if (state.busy || !activeSession()?.revealed) return;
    const session = activeSession();
    state.busy = true;
    state.winnerError = null;
    render();
    try {
      const rows = await fetchSessionExport(session.id, client);
      state.winnerContact = findWinnerContact(rows, session.bean_count);
    } catch (err) {
      state.winnerError = describeError(err);
    }
    state.busy = false;
    render();
  }

  async function handleResetData() {
    // Same busy re-check handleToggle already has, needed for the same
    // reason: render() fully replaces the DOM, so a click already queued
    // against the PREVIOUS (now-detached) button node still fires its
    // listener regardless of that stale node's own disabled state. Without
    // this, a fast double-click can pop a second confirm() and re-run the
    // RPC concurrently with the first. Found in review (code-reviewer).
    if (state.busy) return;
    const session = activeSession();
    const ok = window.confirm(
      `This will permanently delete all guesses for "${session.name}". Session settings are preserved. Are you sure?`,
    );
    if (!ok) return;
    state.busy = true;
    render();
    try {
      await resetSessionData(session.id, client);
      state.sessions = state.sessions.map((s) =>
        s.id === session.id ? { ...s, revealed: false } : s,
      );
      state.winnerContact = null;
      state.winnerError = null;
      showToast('Session data cleared. Ready for the next run.');
    } catch (err) {
      showToast(describeError(err));
    }
    state.busy = false;
    render();
  }

  async function handleEndSession() {
    // Same busy re-check as handleResetData above.
    if (state.busy) return;
    const session = activeSession();
    const ok = window.confirm(
      `This will delete all guesses and end "${session.name}". This can't be undone. Are you sure?`,
    );
    if (!ok) return;
    state.busy = true;
    render();
    try {
      await endSession(session.id, client);
      state.sessions = state.sessions.filter((s) => s.id !== session.id);
      state.activeSessionId = null;
      state.view = state.sessions.length === 0 ? 'create' : 'list';
    } catch (err) {
      showToast(describeError(err));
    }
    state.busy = false;
    render();
  }

  function renderCreateForm() {
    const nameInput = el('input', {
      className: 'gtb-input',
      attrs: {
        type: 'text',
        placeholder: 'e.g. Grey Matter Pop-up',
        'aria-label': 'Session name',
        'data-field': 'name',
      },
    });
    nameInput.value = state.createDraft.name;
    setBusyDisabled(nameInput, state.creating);
    nameInput.addEventListener('input', () => {
      state.createDraft.name = nameInput.value;
    });

    const beanInput = el('input', {
      className: 'gtb-input',
      attrs: {
        type: 'number',
        min: '1',
        placeholder: 'e.g. 428',
        inputmode: 'numeric',
        'aria-label': 'Real bean count',
        'data-field': 'beanCount',
      },
    });
    beanInput.value = state.createDraft.beanCount;
    setBusyDisabled(beanInput, state.creating);
    beanInput.addEventListener('input', () => {
      state.createDraft.beanCount = beanInput.value;
    });

    const fields = [
      labeledField(
        'Session name',
        nameInput,
        state.createErrors.name
          ? [el('p', { className: 'gtb-field-error', text: state.createErrors.name })]
          : [],
      ),
      labeledField(
        'Real bean count',
        beanInput,
        state.createErrors.beanCount
          ? [el('p', { className: 'gtb-field-error', text: state.createErrors.beanCount })]
          : [],
      ),
    ];

    const submitButton = el('button', {
      className: 'gtb-btn gtb-btn-primary tap-target',
      text: state.creating ? 'Creating…' : 'Create session',
      attrs: { type: 'submit', 'data-focus-key': 'create-submit' },
    });
    setBusyDisabled(submitButton, state.creating);

    const form = el('form', { className: 'gtb-setup-form' }, [
      ...fields,
      ...(state.createErrors.create
        ? [el('p', { className: 'gtb-field-error', text: state.createErrors.create })]
        : []),
      submitButton,
    ]);
    form.addEventListener('submit', handleCreateSubmit);

    return el('section', { className: 'gtb-screen' }, [
      el('h1', { text: 'Create a session' }),
      el('div', { className: 'gtb-card' }, [form]),
    ]);
  }

  function renderList() {
    const rows = state.sessions.map((s) => {
      const row = el('button', {
        className: 'gtb-session-row tap-target',
        attrs: { type: 'button' },
      });
      row.appendChild(el('span', { className: 'gtb-session-row-name', text: s.name }));
      row.appendChild(
        el('span', {
          className: 'gtb-session-row-status',
          text: s.revealed ? 'Revealed' : s.guess_enabled ? 'Open' : 'Closed',
        }),
      );
      row.addEventListener('click', () => {
        state.activeSessionId = s.id;
        state.view = 'detail';
        render();
      });
      return row;
    });

    const newButton = el('button', {
      className: 'gtb-btn gtb-btn-primary tap-target',
      text: '+ New session',
      attrs: { type: 'button' },
    });
    newButton.addEventListener('click', () => {
      state.view = 'create';
      render();
    });

    return el('section', { className: 'gtb-screen' }, [
      el('h1', { text: 'Your sessions' }),
      el('div', { className: 'gtb-session-list' }, rows),
      newButton,
    ]);
  }

  function urlRow(label, url) {
    const code = el('code', { className: 'gtb-url-code', text: url });
    const copyButton = el('button', {
      className: 'gtb-btn gtb-btn-outline tap-target',
      text: 'Copy',
      attrs: { type: 'button' },
    });
    copyButton.addEventListener('click', () => {
      navigator.clipboard?.writeText(url).then(() => showToast('Copied to clipboard.'));
    });
    return el('div', { className: 'gtb-field' }, [
      el('span', { className: 'form-field-label', text: label }),
      el('div', { className: 'gtb-url-row' }, [code, copyButton]),
    ]);
  }

  function renderDetail() {
    const session = activeSession();
    if (!session) {
      state.view = 'list';
      return renderList();
    }
    const participantUrl = buildParticipantUrl(session.id);
    const displayUrl = buildDisplayUrl(session.id);

    const guessToggle = el('input', {
      attrs: { type: 'checkbox', id: 'gtb-guess-enabled-toggle' },
    });
    guessToggle.checked = session.guess_enabled;
    setBusyDisabled(guessToggle, state.busy);
    guessToggle.addEventListener('change', () =>
      handleToggle('guess_enabled', guessToggle.checked),
    );

    const orientationSelect = el('select', {
      className: 'gtb-input',
      attrs: { id: 'gtb-orientation', 'aria-label': 'Orientation' },
    });
    for (const value of ['landscape', 'portrait']) {
      const option = el('option', { text: value, attrs: { value } });
      if (session.orientation === value) option.selected = true;
      orientationSelect.appendChild(option);
    }
    setBusyDisabled(orientationSelect, state.busy);
    orientationSelect.addEventListener('change', () =>
      handleToggle('orientation', orientationSelect.value),
    );

    const revealButton = el('button', {
      className: 'gtb-btn gtb-btn-primary tap-target',
      text: session.revealed ? 'Revealed' : 'Reveal',
      attrs: { type: 'button', 'data-focus-key': 'reveal' },
    });
    setBusyDisabled(revealButton, state.busy || session.revealed);
    revealButton.addEventListener('click', handleReveal);

    // aria-hidden: this SVG carries no accessible name of its own, and the
    // participant URL it encodes is already present as visible, selectable,
    // copy-buttoned text right above it (urlRow, rendered first) — nothing
    // here is information a screen-reader user would otherwise miss. Found
    // in review (ui-accessibility-reviewer).
    const qrContainer = el('div', { className: 'gtb-qr', attrs: { 'aria-hidden': 'true' } });
    const qr = qrcode(0, 'M');
    qr.addData(participantUrl);
    qr.make();
    // The one deliberate innerHTML use in this module — safe because the
    // content is entirely library-generated SVG markup from a session UUID
    // we control, never user-authored text (core/dom.js's own innerHTML
    // restriction is about untrusted DISPLAY NAMES, not this).
    qrContainer.innerHTML = qr.createSvgTag(4);

    const exportButton = el('button', {
      className: 'gtb-btn gtb-btn-outline tap-target',
      text: 'Export data',
      attrs: { type: 'button', 'data-focus-key': 'export' },
    });
    setBusyDisabled(exportButton, state.busy);
    exportButton.addEventListener('click', handleExport);

    const winnerButton = el('button', {
      className: 'gtb-btn gtb-btn-primary tap-target',
      text: state.busy ? 'Finding winner…' : 'Show winner contact',
      attrs: { type: 'button', 'data-focus-key': 'winner' },
    });
    setBusyDisabled(winnerButton, state.busy || !session.revealed);
    winnerButton.addEventListener('click', handleFindWinner);

    const winnerChildren = [
      el('h2', { className: 'gtb-winner-heading', text: 'Winner contact' }),
      el('p', {
        className: 'gtb-winner-help',
        text: session.revealed
          ? 'Find the closest guess and the contact details supplied by that player.'
          : 'Available after you reveal the result.',
      }),
      winnerButton,
    ];
    if (state.winnerContact) {
      const winner = state.winnerContact;
      winnerChildren.push(
        el(
          'div',
          { className: 'gtb-winner-result', attrs: { role: 'status', 'aria-live': 'polite' } },
          [
            el('strong', { text: winner.name }),
            el('span', { text: `Guess: ${winner.guess}` }),
            el('span', {
              text: winner.phone
                ? `Phone / WhatsApp: ${winner.phone}`
                : `Instagram: ${winner.instagram}`,
            }),
          ],
        ),
      );
    } else if (state.winnerError) {
      winnerChildren.push(
        el('p', {
          className: 'gtb-field-error',
          text: state.winnerError,
          attrs: { role: 'alert' },
        }),
      );
    }

    const resetButton = el('button', {
      className: 'gtb-btn gtb-btn-danger tap-target',
      text: 'Reset data',
      attrs: { type: 'button', 'data-focus-key': 'reset' },
    });
    setBusyDisabled(resetButton, state.busy);
    resetButton.addEventListener('click', handleResetData);

    const endButton = el('button', {
      className: 'gtb-btn gtb-btn-danger-solid tap-target',
      text: 'End session',
      attrs: { type: 'button', 'data-focus-key': 'end' },
    });
    setBusyDisabled(endButton, state.busy);
    endButton.addEventListener('click', handleEndSession);

    const backButton = el('button', {
      className: 'gtb-btn gtb-btn-outline tap-target',
      text: '← All sessions',
      attrs: { type: 'button' },
    });
    backButton.addEventListener('click', () => {
      state.view = 'list';
      render();
    });

    return el('section', { className: 'gtb-screen' }, [
      backButton,
      el('h1', { text: session.name }),
      el('div', { className: 'gtb-card' }, [
        el('label', { className: 'gtb-toggle-row' }, [
          guessToggle,
          el('span', { text: 'Guessing open' }),
        ]),
        labeledField('Orientation', orientationSelect),
        revealButton,
      ]),
      el('div', { className: 'gtb-card' }, [
        urlRow('Participant URL (for QR)', participantUrl),
        urlRow('Display URL (for TV / stage)', displayUrl),
        qrContainer,
      ]),
      el('div', { className: 'gtb-card gtb-winner-card' }, winnerChildren),
      el('div', { className: 'gtb-card gtb-danger-zone' }, [
        el('p', { className: 'gtb-danger-label', text: '⚠ Danger zone' }),
        exportButton,
        resetButton,
        endButton,
      ]),
    ]);
  }

  function render() {
    if (signal?.aborted) return;
    // Wrapping the whole rebuild in withFocusPreservation closes the
    // broader gap the heading-refocus logic below never covered: THAT
    // logic only fires when the view itself changes (create/list/detail).
    // Every other render() — toggling guess_enabled, changing orientation,
    // a busy-state flip around Reveal/Export/Reset/End — still did a full
    // root.innerHTML='' teardown, unconditionally dropping focus to
    // <body> since the focused node itself is destroyed. Found in review
    // (ui-accessibility-reviewer, Phase 3 follow-up).
    withFocusPreservation(root, () => {
      root.innerHTML = '';
      let content;
      if (state.view === 'loading') {
        content = el('section', { className: 'gtb-screen' }, [el('p', { text: 'Loading…' })]);
      } else if (state.view === 'create') {
        content = renderCreateForm();
      } else if (state.view === 'detail') {
        content = renderDetail();
      } else {
        content = renderList();
      }
      root.appendChild(content);

      if (state.toastMessage) {
        root.appendChild(
          el('div', {
            className: 'gtb-toast',
            text: state.toastMessage,
            attrs: { role: 'status', 'aria-live': 'polite' },
          }),
        );
      }

      // Move focus to the new view's own heading whenever the VIEW itself
      // changes (create/list/detail) — but not on every render() call,
      // which fires for every toggle/busy-state change too and would
      // otherwise yank focus away from whatever the user is actively
      // interacting with. Found in review (ui-accessibility-reviewer):
      // clicking a session row or "← All sessions" silently dropped focus
      // to <body> with no orientation cue that a whole new view had
      // replaced the old one.
      if (state.view !== lastFocusedView) {
        lastFocusedView = state.view;
        const heading = root.querySelector('h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
          return true;
        }
      }
    });
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  userId = user?.id ?? null;
  await loadSessions();

  return {
    unmount() {
      clearTimeout(toastTimer);
    },
  };
}
