// Heat generation screen (handoff §14 T4.2). Rebuild-then-refocus throughout
// (§15.3): every action re-renders the whole subtree from fresh state, and
// only once that rebuild has landed in the DOM does focus move — never
// before, the exact ordering bug that recurred six times in Kira-Kira.
//
// DOM built via createElement/textContent, never innerHTML with
// interpolated data — roster names come from user-entered registration data
// (core/registry), so nothing here should trust it as markup.
import {
  listStageEntries,
  hydrateStageEntries,
  seedFirstStageEntries,
  generateHeatsRandom,
  generateHeatsManual,
  listHeatsForStage,
} from './heats.js';
import { listEntries } from '../../core/registry.js';
import { findEvent } from '../../core/events.js';
import { findStageById } from './setup.js';
import { getSupabase } from '../../core/supabaseClient.js';

function el(tag, { className, text, attrs, id } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  if (text != null) node.textContent = text;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

export function renderRosterList(hydratedEntries) {
  const items = hydratedEntries.map((entry) =>
    el('li', {}, [
      el('span', { text: entry.displayName }),
      el('span', { className: 'stage-meta', text: entry.cafe ?? '' }),
    ]),
  );
  return el('ul', { className: 'roster-list' }, items);
}

export function renderManualAssignmentForm(hydratedEntries) {
  const rows = hydratedEntries.map((entry) => {
    const heatInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'number',
        min: '1',
        'data-entry-id': entry.entry_id,
        'data-field': 'heatNumber',
        'aria-label': `${entry.displayName}: heat number`,
        required: 'required',
      },
    });
    const stationInput = el('input', {
      className: 'field-input',
      attrs: {
        type: 'text',
        'data-entry-id': entry.entry_id,
        'data-field': 'station',
        'aria-label': `${entry.displayName}: station`,
        required: 'required',
      },
    });
    return el('tr', {}, [
      el('td', { text: entry.displayName, attrs: { 'data-label': 'Cupper' } }),
      el('td', { attrs: { 'data-label': 'Heat #' } }, [heatInput]),
      el('td', { attrs: { 'data-label': 'Station' } }, [stationInput]),
    ]);
  });

  const table = el('table', { className: 'assignment-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Cupper', attrs: { scope: 'col' } }),
        el('th', { text: 'Heat #', attrs: { scope: 'col' } }),
        el('th', { text: 'Station', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);

  const submitButton = el('button', {
    className: 'btn btn-primary tap-target',
    text: 'Save manual heats',
    attrs: { type: 'submit' },
  });

  return el('form', { className: 'manual-assignment-form' }, [table, submitButton]);
}

// Reads the form's own inputs back into `[{entryId, heatNumber, station}]`.
// `Number(input.value)` on an empty field is 0 (not NaN — only genuinely
// non-numeric text produces that), and 0 is already an invalid heat number,
// so no separate "empty" handling is needed here: whatever the input coerces
// to flows straight into buildHeatPlansFromAssignments's own validation (a
// positive integer), which is what rejects it, with one message, not two
// different paths disagreeing about what "invalid" means.
export function readManualAssignmentForm(form) {
  const inputs = [...form.querySelectorAll('[data-entry-id]')];
  const byEntry = new Map();
  for (const input of inputs) {
    const entryId = input.dataset.entryId;
    if (!byEntry.has(entryId)) byEntry.set(entryId, { entryId });
    const record = byEntry.get(entryId);
    if (input.dataset.field === 'heatNumber') record.heatNumber = Number(input.value);
    else if (input.dataset.field === 'station') record.station = input.value.trim();
  }
  return [...byEntry.values()];
}

export function renderHeatsList(heatsWithEntries, hydratedById) {
  const cards = heatsWithEntries.map(({ heat, entries }) => {
    const items = entries.map((entry) =>
      el('li', {}, [
        el('span', { className: 'station-badge', text: entry.station }),
        el('span', { text: hydratedById.get(entry.entry_id)?.displayName ?? entry.entry_id }),
      ]),
    );
    return el('div', { className: 'card heat-card' }, [
      el('h3', { text: `Heat ${heat.heat_number}` }),
      el('ul', { className: 'heat-entries-list' }, items),
    ]);
  });
  return el('div', { className: 'heats-list' }, [
    el('h2', { id: 'heats-heading', text: 'Generated heats', attrs: { tabindex: '-1' } }),
    ...cards,
  ]);
}

// Distinguishes this module's own descriptive thrown errors (plain `Error`s
// with a human-readable message, e.g. "heat 2 already exists with a
// different configuration") from whatever a raw Supabase/Postgrest failure
// looks like (carries a `.code`) — only the former is safe to show a user
// verbatim. This is the first UI surface in the project consuming these
// throws directly; later screens should follow the same split rather than
// piping `err.message` straight into a feedback panel.
export function describeError(err) {
  if (err instanceof Error && !err.code) return err.message;
  return 'Something went wrong saving that — try again.';
}

export async function mountHeatGenerationScreen(
  root,
  { eventId, stageId, client = getSupabase() } = {},
) {
  let focusAfterRender = null;
  let pendingError = null;

  function setFeedback(feedback, message, tone) {
    feedback.textContent = message ?? '';
    if (tone) feedback.dataset.tone = tone;
    else delete feedback.dataset.tone;
  }

  // A re-render triggered after a failed action can itself fail (loadState()
  // re-runs from scratch, and whatever just broke may still be broken) — if
  // that second failure were left unguarded, it would surface as an
  // unhandled promise rejection instead of a message the user can see.
  // Falls back to showing the error on whatever DOM is currently live: if
  // loadState() throws before render() reaches `root.innerHTML = ''`, the
  // previous successful render's DOM (including its `feedback` element,
  // captured by the caller's closure) is still attached and still usable.
  async function renderOrShowError(feedback) {
    try {
      await render();
    } catch (err) {
      setFeedback(feedback, describeError(err), 'error');
      // render()'s own post-attach scroll/focus step never ran (it failed
      // before getting there) — `feedback` is already live in the DOM here
      // (see the comment above), so it's safe to do directly.
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  async function loadState() {
    const event = await findEvent(eventId, client);
    const stage = await findStageById(stageId, client);
    const stageEntries = await listStageEntries(stageId, client);
    const roster = await listEntries(eventId, client);
    const hydrated = hydrateStageEntries(stageEntries, roster);
    const heats = await listHeatsForStage(stageId, client);
    return { event, stage, hydrated, heats };
  }

  async function render() {
    const data = await loadState();
    root.innerHTML = '';

    const container = el('section', { className: 'heats-screen' });

    // D9: is_test must render unmistakably on every surface an organiser or
    // audience member can see, not only the audience-facing live surfaces
    // T5.3/T5.4 own — this is the first real screen in the project, so it's
    // the first place that discipline actually has to hold.
    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(el('h1', { text: `Heat generation — ${data.stage.kind}` }));
    container.appendChild(
      el('p', {
        className: 'stage-meta',
        text: `${data.hydrated.length} cupper(s) in this stage`,
      }),
    );

    const feedback = el('div', {
      className: 'screen-feedback',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1' },
    });
    if (pendingError) {
      setFeedback(feedback, pendingError, 'error');
      pendingError = null;
    }

    if (data.hydrated.length === 0) {
      const seedButton = el('button', {
        className: 'btn btn-primary tap-target',
        text: 'Seed roster into this stage',
      });
      seedButton.addEventListener('click', async () => {
        try {
          await seedFirstStageEntries(eventId, client);
          focusAfterRender = '#roster-heading';
        } catch (err) {
          pendingError = describeError(err);
        }
        // Re-render unconditionally, success or failure: a failed attempt
        // must never leave a stale view on screen that doesn't reflect what
        // actually landed in the database (see the random/manual handlers
        // below for why this matters more than it looks here).
        await renderOrShowError(feedback);
      });
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', { text: 'No cuppers are entered into this stage yet.' }),
          seedButton,
        ]),
      );
    } else {
      container.appendChild(
        el('div', { className: 'card' }, [
          el('h2', { id: 'roster-heading', text: 'Roster', attrs: { tabindex: '-1' } }),
          renderRosterList(data.hydrated),
        ]),
      );

      const placedEntryIds = new Set(
        data.heats.flatMap(({ entries }) => entries.map((entry) => entry.entry_id)),
      );
      const generationComplete =
        data.heats.length > 0 && data.hydrated.every((entry) => placedEntryIds.has(entry.entry_id));

      if (data.heats.length === 0) {
        const randomButton = el('button', {
          className: 'btn btn-primary tap-target',
          text: 'Generate heats (random)',
        });
        randomButton.addEventListener('click', async () => {
          try {
            await generateHeatsRandom(stageId, {}, client);
            focusAfterRender = '#heats-heading';
          } catch (err) {
            // Re-render even on failure — critical here specifically:
            // generateHeatsRandom can fail *after* committing some heats
            // (createHeats has no batch-level atomicity), and this button
            // stays visible until a re-render reflects the real DB state. A
            // second click on a stale "no heats yet" view would reshuffle
            // the *entire* roster fresh, and ensureHeatEntries only checks
            // for a station conflict within the SAME heat — a cupper
            // already committed to heat 1 could silently end up placed in
            // heat 2 as well on the retry, with nothing to catch it. Moving
            // to the "incomplete" branch (which offers no generate button)
            // as soon as the real failure state is known closes that gap.
            pendingError = describeError(err);
          }
          await renderOrShowError(feedback);
        });

        const manualForm = renderManualAssignmentForm(data.hydrated);
        manualForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const assignments = readManualAssignmentForm(manualForm);
          try {
            await generateHeatsManual(stageId, assignments, {}, client);
            focusAfterRender = '#heats-heading';
          } catch (err) {
            pendingError = describeError(err);
          }
          await renderOrShowError(feedback);
        });

        container.appendChild(
          el('div', { className: 'card' }, [el('h2', { text: 'Generate heats' }), randomButton]),
        );
        container.appendChild(
          el('div', { className: 'card' }, [el('h2', { text: 'Or assign manually' }), manualForm]),
        );
      } else if (!generationComplete) {
        // A prior generation attempt failed partway — some heats/entries
        // exist, but not every stage entry has one. Never show this as
        // "done" (the render gate below would if it only checked
        // heats.length > 0). Deliberately offers no "try again" action:
        // generateHeatsRandom reshuffles the *entire* roster fresh on every
        // call, and ensureHeatEntries's conflict check only compares an
        // entry against rows already in that SAME heat — it does not check
        // whether that cupper already landed in a different heat from the
        // failed attempt, so a same-session retry could silently place one
        // cupper into two heats instead of throwing. Resuming/repairing
        // this safely is out of this task's scope — surfacing the true
        // state honestly, with no path back into generation from here, is
        // the fix that belongs here.
        const hydratedById = new Map(data.hydrated.map((entry) => [entry.entry_id, entry]));
        const missing = data.hydrated.length - placedEntryIds.size;
        container.appendChild(
          el('div', { className: 'card' }, [
            el('h2', { text: 'Heat generation incomplete' }),
            el('p', {
              text: `${placedEntryIds.size} of ${data.hydrated.length} cupper(s) were assigned a heat before generation stopped — ${missing} still need one. This needs manual attention before scoring can begin.`,
            }),
          ]),
        );
        container.appendChild(renderHeatsList(data.heats, hydratedById));
      } else {
        const hydratedById = new Map(data.hydrated.map((entry) => [entry.entry_id, entry]));
        container.appendChild(renderHeatsList(data.heats, hydratedById));
      }
    }

    container.appendChild(feedback);
    root.appendChild(container);

    // Rebuild-then-refocus (§15.3): `container` is fully built and attached
    // to `root` above — only past this point does the target element
    // actually exist to focus. Focusing any earlier would target a node
    // from the previous render, already removed by `root.innerHTML = ''`.
    if (focusAfterRender) {
      const target = root.querySelector(focusAfterRender);
      target?.focus();
      focusAfterRender = null;
    } else if (feedback.dataset.tone === 'error') {
      // Same ordering requirement as above, applied to the error path: the
      // feedback region only exists in the live DOM once attached, so the
      // scroll/focus call belongs here, not inside setFeedback (which runs
      // before attachment, both here and for the pendingError case at the
      // top of this function). The region is appended last in document
      // order (after a potentially long roster/manual-assignment table) —
      // without this, a sighted user not using a screen reader gets no
      // visual cue that anything happened; the aria-live announcement alone
      // only reaches assistive tech. scrollIntoView is optional-chained
      // since jsdom in tests doesn't implement it.
      feedback.scrollIntoView?.({ block: 'nearest' });
      feedback.focus();
    }
  }

  await render();
}
