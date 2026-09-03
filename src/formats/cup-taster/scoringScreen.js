// Scoring surface (handoff §14 T4.5, §7.4). Rebuild-then-refocus (§15.3)
// for every action, matching heatsScreen.js's own "every action re-renders
// the whole subtree" pattern — a scoring grid is small (a handful of
// cuppers by a handful of sets), so a full rebuild per tap is not the
// per-second-tick problem timingScreen.js's countdown had to solve
// differently.
//
// Every set-toggle button gets a stable, predictable id
// (`score-{entryId}-{setId}`) specifically so a tap's own re-render can
// refocus that SAME cell afterward — unlike T4.3/T4.4's actions (a Stop
// tap, a manual-entry save), which have no single obvious post-rebuild
// focus target and fall back to the feedback region, a toggle tap has an
// exact, predictable one: the cell just tapped, so a judge working through
// the grid via keyboard/switch access never loses their place.
import { findHeatById, listHeatEntries, hydrateEntries } from './heats.js';
import { listEntriesByIds } from '../../core/registry.js';
import { findEvent } from '../../core/events.js';
import { listSetsForStage } from './setup.js';
import {
  toggleScore,
  computeTally,
  isEntryComplete,
  isHeatComplete,
  markCupperRemainingWrong,
  loadDraft,
  saveDraft,
  clearDraft,
  loadConfirmedResults,
  buildConfirmEntries,
  submitConfirmHeat,
  describeConfirmError,
} from './scoring.js';
import { cupTasterOutboxHandlers } from './outboxHandlers.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';

// `interactive: false` renders the read-only confirmed view — real buttons
// with no click handlers would still look and announce as actionable (tab
// stops, "button" role) even though nothing they do matters anymore;
// `disabled` is the honest way to say "this used to be editable."
//
// `locked` is a SEPARATE, narrower case: still-editable (`interactive:
// true`), just temporarily unavailable — while a Confirm attempt is in
// flight. Without this, a tap landing in that brief window would be saved
// to the local draft normally but then silently overwritten the moment a
// successful confirm switches this same screen to the server-authoritative
// read-only view, with no error or notice that the tap never counted
// (found in review — a narrow but real silent-loss window, distinct from
// the lost-update race `draft`'s own synchronous-mutation fix already
// closes). Listeners stay attached — a disabled button doesn't dispatch
// clicks regardless, and the next render naturally re-enables them once
// the attempt resolves.
export function renderScoringRows(
  hydratedEntries,
  setIds,
  draftResults,
  { onToggle, onMarkWrong, interactive = true, locked = false },
) {
  const rows = hydratedEntries.map((entry) => {
    const results = draftResults[entry.entry_id] ?? {};
    const tally = computeTally(results, setIds);
    const complete = isEntryComplete(results, setIds);

    const nameNode = el(
      'span',
      { className: 'timing-row-name-inner' },
      [
        entry.station ? el('span', { className: 'station-badge', text: entry.station }) : null,
        el('span', { className: 'timing-row-name-text', text: entry.displayName }),
      ].filter(Boolean),
    );

    const tallyNode = el('span', {
      className: 'scoring-tally',
      id: `tally-${entry.entry_id}`,
      text: `${tally.correct}/${tally.total}`,
      attrs: { 'data-complete': complete ? 'true' : 'false' },
    });

    const toggleButtons = setIds.map((setId, index) => {
      const value = results[setId] ?? null;
      const label = value === true ? '✓' : value === false ? '✗' : '—';
      const tone = value === true ? 'correct' : value === false ? 'wrong' : 'unscored';
      const button = el('button', {
        className: 'btn scoring-toggle tap-target',
        id: `score-${entry.entry_id}-${setId}`,
        text: `${index + 1} ${label}`,
        attrs: {
          'data-tone': tone,
          'aria-label': `${entry.displayName}, set ${index + 1}: ${
            value === true ? 'correct' : value === false ? 'wrong' : 'unscored'
          }`,
          ...(interactive ? {} : { disabled: 'disabled', 'data-readonly': 'true' }),
          ...(locked ? { disabled: 'disabled' } : {}),
        },
      });
      if (interactive) button.addEventListener('click', () => onToggle(entry.entry_id, setId));
      return button;
    });

    const markWrongButton =
      complete || !interactive
        ? null
        : el('button', {
            className: 'btn scoring-mark-wrong',
            text: 'Mark remaining wrong',
            attrs: {
              'aria-label': `Mark ${entry.displayName}'s remaining unscored sets wrong`,
              ...(locked ? { disabled: 'disabled' } : {}),
            },
          });
    markWrongButton?.addEventListener('click', () => onMarkWrong(entry.entry_id));

    return el(
      'li',
      { className: 'timing-row scoring-row' },
      [
        el('div', { className: 'timing-row-name' }, [nameNode, tallyNode]),
        el('div', { className: 'scoring-toggle-group' }, toggleButtons),
        markWrongButton,
      ].filter(Boolean),
    );
  });
  return el('ul', { className: 'timing-row-list' }, rows);
}

export async function mountScoringScreen(
  root,
  { eventId, heatId, client = getSupabase(), signal } = {},
) {
  let focusAfterRender = null;
  let pendingError = null;
  let pendingSuccess = null;
  let renderGeneration = 0;
  let confirmInFlight = false;
  // Local scoring state lives here — mutated SYNCHRONOUSLY (before any
  // await) by onToggle/onMarkWrong below — not reloaded from IndexedDB on
  // every render(). This is the fix for a real lost-update race found in
  // review: a full render() takes a full loadState() round trip (five
  // sequential reads), and a second tap landing on the still-live old DOM
  // before that resolves used to read the SAME stale draft snapshot the
  // first tap started from, so whichever tap's save landed last silently
  // discarded the other's change — with no error, since both writes
  // "succeeded" individually. Since JS click handlers run their synchronous
  // portion to completion before another dispatched click event can start
  // (the browser dispatches one event at a time), mutating `draft` here as
  // the very first statement — before the handler's own first `await` —
  // guarantees a second tap always reads the already-updated value, no
  // matter how slow the first tap's own save/render is still running.
  let draft = await loadDraft(heatId);

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

  async function loadState() {
    const event = await findEvent(eventId, client);
    const heat = await findHeatById(heatId, client);
    const sets = await listSetsForStage(heat.stage_id, client);
    const heatEntries = await listHeatEntries(heatId, client);
    const roster = await listEntriesByIds(
      heatEntries.map((entry) => entry.entry_id),
      client,
    );
    const hydrated = hydrateEntries(heatEntries, roster);
    // Once confirmed, the local draft has been cleared (the confirm
    // handler clears it on success) — the read-only view has to come from
    // the real, persisted ct_results rows instead, or a just-confirmed
    // heat would render as if nothing had ever been scored. Reassigns the
    // closure-level `draft`, same variable the toggle handlers mutate —
    // once confirmed there's nothing left to toggle, so there's no race to
    // protect against here.
    if (heat.status === 'confirmed') {
      draft = await loadConfirmedResults(heatEntries, client);
    }
    return { event, heat, sets, hydrated };
  }

  async function render() {
    const myGeneration = ++renderGeneration;
    const data = await loadState();
    if (myGeneration !== renderGeneration) return;
    // A discarded-but-still-in-flight render (this render's own loadState()
    // still resolving after the router already navigated elsewhere) must
    // never write to `root` again — router.js aborts `signal` the instant
    // a newer navigation starts. Distinct from the renderGeneration check
    // above: that one guards against a NEWER render() from THIS SAME
    // screen instance winning; this one guards against the whole screen
    // instance having been superseded by NAVIGATION. See ROADMAP.md's "A
    // real DOM-write race between the router..." entry.
    if (signal?.aborted) return;

    root.innerHTML = '';

    const container = el('section', { className: 'screen-container scoring-screen' });

    // D9: is_test must render unmistakably on every surface an organiser or
    // audience member can see.
    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(el('h1', { text: `Scoring — Heat ${data.heat.heat_number}` }));

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

    const setIds = data.sets.map((set) => set.id);
    const entryIds = data.hydrated.map((entry) => entry.entry_id);

    if (data.heat.status === 'confirmed') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('h2', {
            id: 'scoring-confirmed-heading',
            text: 'Heat confirmed',
            attrs: { tabindex: '-1' },
          }),
          el('p', { text: 'Every cupper has a final score. This heat is closed.' }),
          renderScoringRows(data.hydrated, setIds, draft, { interactive: false }),
        ]),
      );
    } else if (data.heat.status !== 'scoring') {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', {
            text: `This heat is status "${data.heat.status}" — not ready for scoring yet. Timing must finish first.`,
          }),
        ]),
      );
    } else {
      const rows = renderScoringRows(data.hydrated, setIds, draft, {
        locked: confirmInFlight,
        onToggle: async (entryId, setId) => {
          // Synchronous mutation — see the `draft` declaration's own
          // comment for why this must happen before any `await` below.
          const current = draft[entryId]?.[setId] ?? null;
          draft = {
            ...draft,
            [entryId]: { ...(draft[entryId] ?? {}), [setId]: toggleScore(current) },
          };
          await saveDraft(heatId, draft);
          focusAfterRender = `#score-${entryId}-${setId}`;
          await renderOrShowError(feedback);
        },
        onMarkWrong: async (entryId) => {
          draft = { ...draft, [entryId]: markCupperRemainingWrong(draft[entryId] ?? {}, setIds) };
          await saveDraft(heatId, draft);
          focusAfterRender = `#tally-${entryId}`;
          await renderOrShowError(feedback);
        },
      });
      container.appendChild(
        el('div', { className: 'card' }, [el('h2', { text: 'Cuppers' }), rows]),
      );

      const complete = isHeatComplete(entryIds, draft, setIds);
      const confirmButton = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Confirm heat',
        attrs: complete && !confirmInFlight ? {} : { disabled: 'disabled' },
      });
      confirmButton.addEventListener('click', async () => {
        // Guards against a rapid double-click enqueueing two confirm
        // operations for this same heat — the second would self-conflict
        // against the first's own update (a P0002 the first click, not the
        // organiser, caused) and, without this, both click handlers would
        // share one ambiguous flush result with no way to tell which
        // outcome was actually theirs. Disabling synchronously — before
        // any `await` — closes the window entirely, the same reasoning as
        // the `draft` mutation above.
        if (confirmInFlight) return;
        confirmInFlight = true;
        confirmButton.disabled = true;
        try {
          const entries = buildConfirmEntries(data.hydrated, draft, setIds);
          const result = await submitConfirmHeat(
            heatId,
            data.event.org_id,
            data.heat.updated_at,
            entries,
            client,
            cupTasterOutboxHandlers(client),
          );
          // Ground truth, not the flush's own bookkeeping: the outbox is a
          // single shared queue, so `result` can reflect an unrelated
          // operation (an earlier stuck one the outbox auto-cleared this
          // same pass) rather than this specific confirm attempt — re-read
          // the heat itself rather than risk telling the organiser their
          // own successful confirm failed, or the reverse. `.catch(() =>
          // null)` specifically: if THIS re-fetch fails (e.g. the
          // connection drops between the RPC ack and this read),
          // submitConfirmHeat may have already succeeded server-side —
          // never claim a definite failure from a read that simply didn't
          // land. The next render's own loadState() re-fetches fresh and
          // self-corrects to "Heat confirmed" on its own if it did.
          const freshHeat = await findHeatById(heatId, client).catch(() => null);
          if (freshHeat === null) {
            pendingError =
              'Could not confirm whether this went through — check the heat again in a moment before retrying.';
          } else if (freshHeat.status === 'confirmed') {
            await clearDraft(heatId);
            pendingSuccess = 'Heat confirmed.';
          } else if (result.error) {
            pendingError = describeConfirmError(result.error) ?? describeError(result.error);
          } else {
            pendingError =
              'This heat has not been confirmed yet — it may still be waiting to sync. Try again in a moment.';
          }
        } catch (err) {
          pendingError = describeConfirmError(err) ?? describeError(err);
        }
        confirmInFlight = false;
        await renderOrShowError(feedback);
      });
      container.appendChild(el('div', { className: 'card' }, [confirmButton]));
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

  await render();

  return {
    unmount() {
      renderGeneration++;
    },
  };
}
