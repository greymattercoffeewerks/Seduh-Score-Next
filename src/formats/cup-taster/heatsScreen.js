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
  hydrateEntries,
  seedFirstStageEntries,
  generateHeatsRandom,
  generateHeatsManual,
  listHeatsForStage,
} from './heats.js';
import { listEntries } from '../../core/registry.js';
import { findEvent } from '../../core/events.js';
import { findStageById, stageKindLabel } from './setup.js';
import { getSupabase } from '../../core/supabaseClient.js';
import { el } from '../../core/dom.js';
import { describeError } from '../../core/errors.js';

// Live-event finding #3 (2026-10-04): the Roster card sat above the heats, so on every visit an
// organiser scrolled past the whole roster, and then past every finished heat, to reach the one to
// run. Now: while no heats exist the roster is a plain open card (it is what you are about to
// generate heats from); once they do, the heats come first, an "Up next" card leads straight to
// the first heat that is not confirmed, and the roster is a closed fold-out below.

// Pure. Cuppers in a stage, in words ("1 cupper", "12 cuppers").
function cupperCount(n) {
  return `${n} cupper${n === 1 ? '' : 's'}`;
}

// The roster once heats exist: a closed <details> below the heats. The summary row is the tap target
// and carries an explicit +/- (see heatsScreen.css); the state is exposed natively.
export function renderRosterFold(hydratedEntries) {
  return el('details', { className: 'card roster-fold' }, [
    el('summary', {
      id: 'roster-summary',
      className: 'roster-fold-summary tap-target',
      text: `Roster — ${cupperCount(hydratedEntries.length)}`,
    }),
    renderRosterList(hydratedEntries),
  ]);
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

// `existingAssignments` (Map<entryId, {heatNumber, station}>), when given,
// is for resuming a partial generation (heatsScreen.js's own "incomplete"
// branch) — a cupper already committed to a heat renders as plain text, not
// an editable input, so readManualAssignmentForm below naturally never
// reads a value for them at all. Deliberately NOT a pre-filled-but-editable
// input: submitting a changed value for an already-placed cupper would hit
// ensureHeatEntries's "already exists with a different station" conflict
// (safe, never corrupts data) but is a needless dead end this design avoids
// by construction — the caller re-attaches each already-placed cupper's own
// real assignment before calling generateHeatsManual (see
// mountHeatGenerationScreen's buildManualForm), so buildHeatPlansFromAssignments'
// own "every stage entry must be assigned" check is still satisfied without
// asking the organiser to re-type what's already correct.
export function renderManualAssignmentForm(
  hydratedEntries,
  { existingAssignments = new Map(), disabled = false } = {},
) {
  const rows = hydratedEntries.map((entry) => {
    const existing = existingAssignments.get(entry.entry_id);
    if (existing) {
      return el('tr', {}, [
        el('td', { text: entry.displayName, attrs: { 'data-label': 'Cupper' } }),
        el('td', {
          text: `Heat ${existing.heatNumber} · Station ${existing.station} (already placed)`,
          attrs: { 'data-label': 'Assignment', colspan: '2' },
        }),
      ]);
    }
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
    text: disabled ? 'Saving…' : 'Save manual heats',
    attrs: disabled ? { type: 'submit', disabled: 'disabled' } : { type: 'submit' },
  });

  const form = el('form', { className: 'manual-assignment-form' }, [table, submitButton]);
  // Attached directly rather than left for a caller to re-derive via a
  // class/type selector (found in review, code-reviewer) — a selector stays
  // correct only by coincidence of there being exactly one matching button
  // today; a real reference can't silently pick up a second one this form
  // might grow later.
  form.submitButton = submitButton;
  return form;
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

// Where a not-yet-confirmed heat's next step lives: Scoring once the heat is `scoring`, Timing
// before that.
function heatHref(eventId, heat) {
  return `#/events/${eventId}/heats/${heat.id}/${heat.status === 'scoring' ? 'scoring' : 'timing'}`;
}

// A heat's name wherever it is shown. Tiebreak heats number from 1 again, so without the suffix a
// stage with a tiebreak shows two different "Heat 1"s.
function heatName(heat) {
  return `Heat ${heat.heat_number}${heat.kind === 'tiebreak' ? ' (tiebreak)' : ''}`;
}

// Pure. The heat to go to next: the first one that is not confirmed yet. Regular heats come in
// order, then tiebreak heats (their numbering restarts at 1, so heat_number alone would interleave
// them). null when every heat is confirmed.
export function findUpNextHeat(heatsWithEntries) {
  const open = heatsWithEntries.filter(({ heat }) => heat.status !== 'confirmed');
  open.sort(
    (a, b) =>
      Number(a.heat.kind === 'tiebreak') - Number(b.heat.kind === 'tiebreak') ||
      a.heat.heat_number - b.heat.heat_number,
  );
  return open[0] ?? null;
}

// The "Up next" card at the top of a fully generated stage: the first heat still to do, with one
// big button into it; or, when everything is confirmed, a link on to the standings.
export function renderUpNext(heatsWithEntries, eventId, stageId) {
  const next = findUpNextHeat(heatsWithEntries);
  const total = heatsWithEntries.length;
  const confirmed = heatsWithEntries.filter(({ heat }) => heat.status === 'confirmed').length;
  const progress = `${confirmed} of ${total} heat${total === 1 ? '' : 's'} confirmed`;
  const heading = el('h2', { id: 'up-next-heading', text: 'Up next', attrs: { tabindex: '-1' } });

  if (!next) {
    return el('div', { className: 'card up-next' }, [
      heading,
      el('p', {
        text: `All ${total} heat${total === 1 ? ' is' : 's are'} confirmed.`,
      }),
      el('a', {
        className: 'btn btn-primary tap-target',
        text: 'View standings',
        attrs: { href: `#/events/${eventId}/stages/${stageId}/standings` },
      }),
    ]);
  }

  const { heat, entries } = next;
  const name = heatName(heat);
  const scoring = heat.status === 'scoring';
  const state = scoring
    ? 'is waiting to be scored'
    : heat.status === 'timing'
      ? 'is being timed'
      : 'is next to be timed';
  const label = `${scoring ? 'Score' : 'Time'} ${name}`;
  return el('div', { className: 'card up-next' }, [
    heading,
    el('p', { text: `${name} ${state} · ${cupperCount(entries.length)} · ${progress}` }),
    el('a', {
      className: 'btn btn-primary tap-target',
      text: label,
      attrs: { href: heatHref(eventId, heat) },
    }),
  ]);
}

// `eventId`, when given, adds a next-action link per heat (Timing while
// `pending`/`timing`, Scoring while `scoring`) — the only way to actually
// reach a heat's own timing/scoring screen once it exists (2026-08-29
// follow-up closing a real gap found while wiring the app's router: this
// list previously had no forward path into the rest of the flow at all).
// Omitted (undefined) for callers that only want a read-only summary — the
// pre-existing standingsScreen.js preview usage, and this file's own
// pre-router tests, don't need live links into screens the router didn't
// exist to reach yet.
function heatActionLink(eventId, heat) {
  if (!eventId) return null;
  if (heat.status === 'confirmed') {
    return el('span', { className: 'heat-status-done', text: 'Confirmed' });
  }
  const toScoring = heat.status === 'scoring';
  const label = toScoring ? 'Score this heat' : 'Time this heat';
  return el('a', {
    className: 'btn btn-outline tap-target',
    text: label,
    attrs: {
      href: heatHref(eventId, heat),
      // Found in this pass (holistic accessibility review): this list
      // repeats the SAME visible link text ("Time this heat"/"Score this
      // heat") once per heat card, with nothing distinguishing them from
      // each other — a screen-reader user browsing by a links list (e.g.
      // VoiceOver/NVDA's rotor), rather than reading the page linearly
      // heading-by-heading, hits several links that read identically with
      // no way to tell which heat any given one belongs to. Every other
      // per-row control in this same screen group already disambiguates
      // this way (renderTimingRows' Stop/manual-toggle/Cancel/Save all
      // carry a per-row aria-label) — this was the one holdout. The label
      // CONTAINS the visible text verbatim (WCAG 2.5.3 Label in Name), not
      // just a differently-worded description.
      'aria-label': `${label} — ${heatName(heat)}`,
    },
  });
}

export function renderHeatsList(heatsWithEntries, hydratedById, eventId) {
  const cards = heatsWithEntries.map(({ heat, entries }) => {
    const items = entries.map((entry) =>
      el('li', {}, [
        el('span', { className: 'station-badge', text: entry.station }),
        el('span', { text: hydratedById.get(entry.entry_id)?.displayName ?? entry.entry_id }),
      ]),
    );
    const actionLink = heatActionLink(eventId, heat);
    return el(
      'div',
      { className: 'card heat-card' },
      [
        el('h3', { text: heatName(heat) }),
        el('ul', { className: 'heat-entries-list' }, items),
        actionLink,
      ].filter(Boolean),
    );
  });
  return el('div', { className: 'heats-list' }, [
    el('h2', { id: 'heats-heading', text: 'Generated heats', attrs: { tabindex: '-1' } }),
    ...cards,
  ]);
}

// Where focus goes once heats have been generated: the Up next card when it exists (it leads to the
// next step), else the heats heading (generation stopped short — there is no Up next). A selector
// list resolves to the first match in document order.
export const FIRST_HEATS_TARGET = '#up-next-heading, #heats-heading';

export async function mountHeatGenerationScreen(
  root,
  { eventId, stageId, client = getSupabase(), signal } = {},
) {
  let focusAfterRender = null;
  let pendingError = null;
  // Guards this screen's 3 write actions (seed roster / generate random /
  // submit manual assignment) against a rapid double-click before a
  // re-render lands — matches standingsScreen.js's own established
  // actionInFlight name/shape (ROADMAP.md gap, closed 2026-09-11). Matters
  // more here than on most screens: generateHeatsRandom's own comment above
  // already documents that a second click on a stale "no heats yet" view
  // can silently double-place a cupper (createHeats has no batch-level
  // atomicity, and ensureHeatEntries only checks for a conflict WITHIN one
  // heat) — this closes the narrow but real window between a click and the
  // re-render that would otherwise remove the button.
  let actionInFlight = false;

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
  // `restoreButton`, when given, is called on the catch path only — found
  // in review (code-reviewer, 2026-09-11): the three write buttons below
  // now mutate themselves directly (disabled + "…ing" text) the instant
  // they're clicked, since nothing re-renders between a click and the write
  // settling (see each button's own comment). But if render() ITSELF then
  // throws here — a real, reachable case (a dropped connection right after
  // the write already succeeded/failed) — `root.innerHTML` is never
  // cleared (the throw happens before that line), so the directly-mutated
  // button stays attached and stuck disabled forever, with no on-screen way
  // to retry short of a reload — worse than before this task, when the
  // (never-actually-applied) disabled state left the button clickable on
  // this exact failure path. Restoring it here closes that regression.
  async function renderOrShowError(feedback, restoreButton) {
    try {
      await render();
    } catch (err) {
      restoreButton?.();
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
    const hydrated = hydrateEntries(stageEntries, roster);
    const heats = await listHeatsForStage(stageId, client);
    return { event, stage, hydrated, heats };
  }

  async function render() {
    const data = await loadState();
    // A discarded-but-still-in-flight render (loadState() still resolving
    // after the router already navigated elsewhere) must never write to
    // `root` again — router.js aborts `signal` the instant a newer
    // navigation starts. See ROADMAP.md's "A real DOM-write race between
    // the router..." entry.
    if (signal?.aborted) return;
    root.innerHTML = '';

    const container = el('section', { className: 'screen-container heats-screen' });

    // D9: is_test must render unmistakably on every surface an organiser or
    // audience member can see, not only the audience-facing live surfaces
    // T5.3/T5.4 own — this is the first real screen in the project, so it's
    // the first place that discipline actually has to hold.
    if (data.event.is_test) {
      container.appendChild(
        el('div', { className: 'is-test-banner', text: 'Test Data — Not a Live Event' }),
      );
    }

    container.appendChild(
      el('h1', { text: `Heat generation — ${stageKindLabel(data.stage.kind)}` }),
    );
    container.appendChild(
      el('p', {
        className: 'stage-meta',
        text: `${cupperCount(data.hydrated.length)} in this stage`,
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
        text: actionInFlight ? 'Seeding…' : 'Seed roster into this stage',
        attrs: actionInFlight ? { disabled: 'disabled' } : {},
      });
      seedButton.addEventListener('click', async () => {
        if (actionInFlight) return;
        actionInFlight = true;
        // Mutated directly, not left to the eventual re-render below — this
        // button's own `attrs: actionInFlight ? ... : {}` is only evaluated
        // while `render()` is BUILDING it, which already happened before
        // this handler ever runs; nothing re-renders again until after the
        // await settles, so without this direct mutation the flag would
        // silently gate a second click's WORK (still correct) but never
        // actually show as disabled on screen — the exact "stays clickable
        // while the write is in flight" gap this task closes.
        seedButton.disabled = true;
        seedButton.textContent = 'Seeding…';
        try {
          await seedFirstStageEntries(eventId, client);
          focusAfterRender = '#roster-heading';
        } catch (err) {
          pendingError = describeError(err);
        }
        actionInFlight = false;
        // Re-render unconditionally, success or failure: a failed attempt
        // must never leave a stale view on screen that doesn't reflect what
        // actually landed in the database (see the random/manual handlers
        // below for why this matters more than it looks here). The restore
        // callback only fires if render() ITSELF then throws — see
        // renderOrShowError's own comment.
        await renderOrShowError(feedback, () => {
          seedButton.disabled = false;
          seedButton.textContent = 'Seed roster into this stage';
        });
      });
      container.appendChild(
        el('div', { className: 'card' }, [
          el('p', { text: 'No cuppers are entered into this stage yet.' }),
          seedButton,
        ]),
      );
    } else {
      const heatsExist = data.heats.length > 0;
      // Before any heats exist the roster is the thing you are about to generate heats from, so it
      // stays an open card up top (and "Seed roster" refocuses its heading). Once heats exist it
      // moves to a closed fold-out below them — see renderRosterFold.
      if (!heatsExist) {
        container.appendChild(
          el('div', { className: 'card' }, [
            el('h2', { id: 'roster-heading', text: 'Roster', attrs: { tabindex: '-1' } }),
            renderRosterList(data.hydrated),
          ]),
        );
      }

      const placedEntryIds = new Set(
        data.heats.flatMap(({ entries }) => entries.map((entry) => entry.entry_id)),
      );
      const generationComplete =
        heatsExist && data.hydrated.every((entry) => placedEntryIds.has(entry.entry_id));

      // Shared by both the zero-heats and the incomplete-generation branches
      // below — `existingAssignments` (Map<entryId, {heatNumber, station}>)
      // is empty in the zero-heats case (nothing placed yet) and non-empty
      // when resuming a partial failure. generateHeatsManual/
      // buildHeatPlansFromAssignments are unedited — already idempotent and
      // conflict-checked (see heats.js's own comments), so resuming is safe
      // by construction: an already-placed cupper's real assignment is
      // re-attached here rather than left to the organiser to re-type
      // (renderManualAssignmentForm shows it as plain text, not an editable
      // field, so readManualAssignmentForm never returns a value for them at
      // all), and buildHeatPlansFromAssignments's own "every stage entry
      // must be assigned exactly once" check still passes.
      function buildManualForm(existingAssignments) {
        const manualForm = renderManualAssignmentForm(data.hydrated, {
          existingAssignments,
          disabled: actionInFlight,
        });
        manualForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (actionInFlight) return;
          actionInFlight = true;
          // See seedButton's own comment above — mutated directly for
          // immediate visual feedback, since nothing re-renders (and thus
          // nothing re-evaluates the `disabled` prop above) until after the
          // await settles.
          const { submitButton } = manualForm;
          submitButton.disabled = true;
          submitButton.textContent = 'Saving…';
          const assignments = [
            ...readManualAssignmentForm(manualForm),
            ...[...existingAssignments].map(([entryId, assignment]) => ({
              entryId,
              ...assignment,
            })),
          ];
          try {
            await generateHeatsManual(stageId, assignments, {}, client);
            focusAfterRender = FIRST_HEATS_TARGET;
          } catch (err) {
            pendingError = describeError(err);
          }
          actionInFlight = false;
          await renderOrShowError(feedback, () => {
            submitButton.disabled = false;
            submitButton.textContent = 'Save manual heats';
          });
        });
        return manualForm;
      }

      if (!heatsExist) {
        const randomButton = el('button', {
          className: 'btn btn-primary tap-target',
          text: actionInFlight ? 'Generating…' : 'Generate heats (random)',
          attrs: actionInFlight ? { disabled: 'disabled' } : {},
        });
        randomButton.addEventListener('click', async () => {
          // The primary guard against the exact double-click corruption risk
          // this button's own module comment above describes — actionInFlight
          // closes the window between this click and the re-render that
          // would otherwise remove/disable the button. Mutated directly too
          // (see seedButton's own comment above) so the disabling is actually
          // visible during the await, not just enforced silently.
          if (actionInFlight) return;
          actionInFlight = true;
          randomButton.disabled = true;
          randomButton.textContent = 'Generating…';
          try {
            await generateHeatsRandom(stageId, {}, client);
            focusAfterRender = FIRST_HEATS_TARGET;
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
            // to the "incomplete" branch (which offers no generate button,
            // only the safe manual-resume form below) as soon as the real
            // failure state is known closes that gap.
            pendingError = describeError(err);
          }
          actionInFlight = false;
          await renderOrShowError(feedback, () => {
            randomButton.disabled = false;
            randomButton.textContent = 'Generate heats (random)';
          });
        });

        const manualForm = buildManualForm(new Map());

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
        // heats.length > 0). No "try again" (random) action — that path
        // stays permanently unsafe here, see generateHeatsRandom's own
        // comment above. The manual form below IS a safe repair path
        // (2026-08-29 follow-up, closing a known ROADMAP.md gap): each
        // already-placed cupper's real heat/station is shown as fixed text,
        // not re-typed, so the organiser only fills in the ones still
        // missing — buildManualForm re-attaches the already-placed rows
        // before submitting, so buildHeatPlansFromAssignments' own
        // completeness check is satisfied without asking for anything that
        // isn't genuinely new.
        const hydratedById = new Map(data.hydrated.map((entry) => [entry.entry_id, entry]));
        const missing = data.hydrated.length - placedEntryIds.size;
        const existingAssignments = new Map(
          data.heats.flatMap(({ heat, entries }) =>
            entries.map((entry) => [
              entry.entry_id,
              { heatNumber: heat.heat_number, station: entry.station },
            ]),
          ),
        );
        container.appendChild(
          el('div', { className: 'card' }, [
            el('h2', { text: 'Heat generation incomplete' }),
            el('p', {
              text: `${placedEntryIds.size} of ${cupperCount(data.hydrated.length)} were assigned a heat before generation stopped — ${missing} still need one. Assign the rest below to finish, or continue in Studio.`,
            }),
          ]),
        );
        container.appendChild(renderHeatsList(data.heats, hydratedById, eventId));
        container.appendChild(
          el('div', { className: 'card' }, [
            // Repeats the count from the card above rather than relying on
            // it — found in review (ui-accessibility-reviewer): the
            // "Heat generation incomplete" card explaining WHY this form has
            // fewer inputs than "N cuppers in this stage" sits before the
            // Generated heats list, structurally disconnected from this
            // form by an intervening card. A screen-reader user navigating
            // by heading, or a sighted user scanning straight to this card,
            // had no link back to that context.
            el('h2', { text: `Finish assigning the rest (${missing} remaining)` }),
            buildManualForm(existingAssignments),
          ]),
        );
      } else {
        const hydratedById = new Map(data.hydrated.map((entry) => [entry.entry_id, entry]));
        container.appendChild(renderUpNext(data.heats, eventId, stageId));
        container.appendChild(renderHeatsList(data.heats, hydratedById, eventId));
      }

      if (heatsExist) container.appendChild(renderRosterFold(data.hydrated));
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

  return {
    unmount() {
      // No live state, no listeners beyond the DOM subtree itself (removed
      // wholesale by the caller), no timers — nothing to tear down. Found
      // missing during the app-shell/router wiring pass — every other
      // screen already returns this exact shape (see setupScreen.js/
      // rosterScreen.js/reportScreen.js's own identical comment); a router
      // that uniformly calls `.unmount()` after every navigation needs it
      // here too, not as a special case.
    },
  };
}
