// The state and actions behind the "Teams level in the standings" card (seedingCard.js), moved out of the bracket
// screen when the cut moved to Standings (Organiser UX S4). It owns: the seed order as last read, the finish times,
// whether the last read failed, and the one open order form (a draft and its error). The screen owns everything
// else (render, focus, the toast, the live region, the refresh note) and hands this module small callbacks, so the
// behaviour the card had on the bracket screen is kept exactly. The data and the rules are seeding.js's; this never
// ranks anyone (the database's `btc_seeding_order` is the order).
import { DEFAULT_LOAD_TIMEOUT_MS, raceTimeout } from '../../core/timeout.js';
import {
  fetchSeedingOrder,
  fetchPrelimTimes,
  isMissingSeedingView,
  seedingTieGroups,
  blockingGroups,
  validateSeedingOrder,
  recordSeedingTiebreak,
  seedingRefusal,
  describeSeedingError,
} from './seeding.js';

/**
 * @param {object} ctx
 * @param {string} ctx.eventId
 * @param {object} ctx.client
 * @param {() => string} ctx.getOrgId
 * @param {(teamId: string) => string} ctx.teamName
 * @param {() => void} ctx.render rebuild the screen
 * @param {(message: string, options?: { focus?: boolean }) => void} ctx.showToast
 * @param {(message: string) => void} ctx.announce said once through the screen's live region
 * @param {(key: string) => void} ctx.setPendingFocus 'seeding-form' | 'seeding-error' | 'seeding-button'
 * @param {(message: string) => void} ctx.setRefreshNote
 * @param {() => void} ctx.clearRefreshNote
 * @param {() => boolean} ctx.isOtherBusy another action of the screen (Lock) is running
 * @param {() => Promise<boolean>} ctx.refreshBracketExists re-reads the bracket; true when one exists
 */
export function createSeedingController(ctx) {
  const state = {
    rows: [],
    // each team's typed preliminary finish times for the tie card; null = could not be read
    times: [],
    readFailed: false,
    groupKey: null,
    lastClosedKey: null,
    draftOrder: [],
    draftReason: '',
    error: null,
    busy: false,
  };

  const groups = () => seedingTieGroups(state.rows);
  const groupByKey = (key) => groups().find((group) => group.key === key) ?? null;

  // { rows, times, failed }. `times` is null when the finish times could not be read: that never fails the seed
  // order, the card just says so. A view that does not exist yet is not a failure (the front end can ship before its
  // migration reaches the cloud project: the 2026-09-05 incident); anything else is.
  async function read() {
    try {
      const rows = await fetchSeedingOrder(ctx.eventId, ctx.client);
      let times = null;
      if (rows.some((row) => row.tiedCount > 1)) {
        try {
          times = await fetchPrelimTimes(ctx.eventId, ctx.client);
        } catch (err) {
          console.warn('btc: the preliminary finish times could not be read', err);
        }
      } else {
        times = [];
      }
      return { rows, times, failed: false };
    } catch (err) {
      if (isMissingSeedingView(err)) return { rows: [], times: [], failed: false };
      console.warn('btc: the seed order could not be read', err);
      return { rows: null, times: null, failed: true };
    }
  }

  function reset() {
    if (state.groupKey) state.lastClosedKey = state.groupKey;
    state.groupKey = null;
    state.draftOrder = [];
    state.draftReason = '';
    state.error = null;
  }

  // Takes a read into the state: a failed read keeps what was held. An open form whose group is gone (the teams
  // stopped being level, or the group changed) is closed rather than left to disagree with the table.
  function apply(result) {
    if (result.failed) {
      state.readFailed = true;
      return;
    }
    ctx.clearRefreshNote();
    state.rows = result.rows;
    state.times = result.times;
    state.readFailed = false;
    if (state.groupKey) {
      // The key is only "points-<n>": who is in the group can change under the same numbers, and a draft of
      // different members must not outlive it.
      const group = groupByKey(state.groupKey);
      const draft = state.draftOrder;
      const sameMembers =
        group &&
        group.teams.length === draft.length &&
        group.teams.every((team) => draft.includes(team.teamId));
      if (!sameMembers) reset();
    }
  }

  // The first read of a page load (already made by the screen): null `times` stays null.
  function load(result) {
    state.rows = result.rows ?? [];
    state.times = result.times === undefined ? [] : result.times;
    state.readFailed = result.failed;
  }

  function openForm(group) {
    if (state.busy || ctx.isOtherBusy()) return;
    // Opening another group would silently drop the draft in this one: the card marks those buttons inert, and
    // this keeps the rule even if one is pressed anyway.
    if (state.groupKey && state.groupKey !== group.key) {
      ctx.showToast('Save or cancel the order you have open first.', { focus: false });
      ctx.render();
      return;
    }
    state.groupKey = group.key;
    // A group's teams are already in seed order, which for a group ordered earlier is the order recorded.
    state.draftOrder = group.teams.map((team) => team.teamId);
    state.draftReason = group.reason ?? '';
    state.error = null;
    ctx.setPendingFocus('seeding-form');
    ctx.render();
  }

  function closeForm() {
    if (state.busy) return;
    reset();
    ctx.setPendingFocus('seeding-button');
    ctx.render();
  }

  function moveTeam(teamId, delta) {
    if (state.busy || ctx.isOtherBusy()) return;
    const order = [...state.draftOrder];
    const from = order.indexOf(teamId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    state.draftOrder = order;
    state.error = null;
    // Focus follows the pressed team, so nothing else says what changed: say it.
    const first = groupByKey(state.groupKey)?.firstSeed;
    if (first != null) {
      const seedOf = (id) => first + order.indexOf(id);
      ctx.announce(
        `${ctx.teamName(order[to])} is now seed ${seedOf(order[to])}, ${ctx.teamName(order[from])} is now seed ${seedOf(order[from])}.`,
      );
    }
    ctx.render();
  }

  async function record(domEvent, group) {
    domEvent.preventDefault();
    if (state.busy || ctx.isOtherBusy()) return;
    // Everything the save needs is captured NOW; nothing below reads the draft after an await.
    const orderedTeamIds = [...state.draftOrder];
    const reason = state.draftReason;
    const hadBlocking = blockingGroups(groups()).length > 0;
    const invalid = validateSeedingOrder({
      orderedTeamIds,
      groupTeamIds: group.teams.map((team) => team.teamId),
      reason,
    });
    if (invalid) {
      state.error = invalid;
      ctx.setPendingFocus('seeding-error');
      ctx.render();
      return;
    }
    state.busy = true;
    state.error = null;
    ctx.announce('Saving the order…');
    ctx.render();
    try {
      await raceTimeout(
        recordSeedingTiebreak(ctx.getOrgId(), ctx.eventId, orderedTeamIds, reason, ctx.client),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
    } catch (err) {
      if (err.timedOut) {
        // The save may or may not have landed: say so, and leave the draft to try again (a re-record replaces,
        // so trying again is safe).
        state.error = {
          field: 'form',
          message: 'Could not confirm the save. Check your connection, then try again.',
        };
        ctx.setPendingFocus('seeding-error');
        // Look at what is actually saved before the form is handed back, so a late save cannot be mistaken for
        // none (and a second save made on top of it).
        apply(await read());
        state.busy = false;
        ctx.render();
        return;
      }
      const refusal = seedingRefusal(err);
      if (refusal?.reload) {
        // The screen is out of date (the teams may no longer be level, or the bracket may exist): refresh it,
        // close the form and say why in the toast, which is always rendered.
        try {
          await ctx.refreshBracketExists();
        } catch {
          // The refusal text already tells the person what happened; the next action reloads.
        }
        // The seed order stays readable once the bracket exists (the table shows it), so it is read either way.
        apply(await read());
        reset();
        ctx.showToast(refusal.message);
      } else {
        state.error = { field: 'form', message: describeSeedingError(err) };
        ctx.setPendingFocus('seeding-error');
      }
      state.busy = false;
      ctx.render();
      return;
    }
    // The order IS saved from here on. Re-read the seed order; if that read fails, say the save worked.
    const result = await read();
    apply(result);
    reset();
    const allOrdered = !result.failed && blockingGroups(groups()).length === 0;
    if (result.failed) {
      ctx.setRefreshNote(
        'Order saved, but the page could not refresh. Reload to see the standings.',
      );
    } else {
      ctx.showToast(
        hadBlocking && allOrdered
          ? 'Order saved. Every team level across the cut line is ordered: you can lock the top 8.'
          : 'Order saved.',
      );
      ctx.setPendingFocus('seeding-button');
    }
    state.busy = false;
    ctx.render();
  }

  async function retry() {
    if (state.busy || ctx.isOtherBusy()) return;
    state.busy = true;
    ctx.render();
    apply(await read());
    state.busy = false;
    const found = groups().length;
    ctx.showToast(
      state.readFailed
        ? 'Still could not check. Try again.'
        : found > 0
          ? `Checked: ${found} ${found === 1 ? 'group' : 'groups'} of level teams.`
          : 'Checked: no teams are level.',
      { focus: false },
    );
    ctx.render();
  }

  // The props seedingCard.js's `renderSeedingTies` takes.
  function cardProps() {
    return {
      groups: groups(),
      form: state.groupKey
        ? {
            groupKey: state.groupKey,
            orderedTeamIds: state.draftOrder,
            reason: state.draftReason,
            error: state.error,
          }
        : null,
      busy: state.busy || ctx.isOtherBusy(),
      teamName: ctx.teamName,
      readFailed: state.readFailed,
      times: state.times,
      handlers: {
        onOpen: openForm,
        onMove: moveTeam,
        onReasonInput: (value) => {
          state.draftReason = value;
        },
        onSubmit: record,
        onCancel: closeForm,
        onRetry: retry,
      },
    };
  }

  return { state, groups, read, apply, load, reset, cardProps };
}
