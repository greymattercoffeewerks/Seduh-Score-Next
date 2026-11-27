// The redemption module (TD.3), pure: its setup, the group arithmetic and the page model. Nothing here decides a winner or
// draws a group: the database does both (migration 20261201100000), and `deriveBracket` turns its rows into rounds,
// groups (pool matches) and winners. This file only names things and does the sums a screen needs.
//
// The module in one paragraph (owner decisions 2026-11-03 and 2026-11-27): after a main round the organiser chose as a
// FEEDING round, the competitors who lost in it are drawn at random into groups of 2 to 4 (default 3). Each group is voted
// like a match: the brewer with strictly the most votes wins, and when the judges are all in and the top is shared, one
// tie-break vote goes to a brewer in the tie. The group winners rejoin the main round's winners. The cap limits how many
// group winners return (0 = all), most votes first. Several redemption rounds can run in one event (one after each
// feeding round ticked) and a brewer can be revived more than once.
//
// A redemption round follows a feeding round only while MORE THAN FOUR winners remain (so the brewers who come back
// rejoin at the quarter-finals at the latest) and only when at least two brewers lost in it.

import { partition } from '../../core/partition.js';

export const GROUP_SIZES = Object.freeze([2, 3, 4]);
// Owner, 2026-11-27: build redemption for 1 v 1 first. The setup offers groups of two only; the database and these helpers
// still know sizes 2 to 4 (tested), so larger groups come later without a migration.
export const DEFAULT_GROUP_SIZE = 2;
export const MAX_FEED_ROUND = 4;
export const MAX_CAP = 99;
// A redemption round follows a main round only when strictly more than this many winners are left in it.
export const MIN_WINNERS_FOR_REDEMPTION = 4;

// How many brewers sit in each group: ceil(pool / size) groups, as even as possible, never a group of one. With groups of 2
// and an odd pool, one group is a three. The same arithmetic as app.td_group_sizes; both are checked against the same
// cases (redemption.test.js and pgTAP 095).
export function groupSizes(pool, groupSize) {
  if (!Number.isInteger(pool) || pool < 2 || !GROUP_SIZES.includes(groupSize)) return [];
  // the same arithmetic as core's heat sizing (fewest groups that hit the target, sizes within 1, never below 2)
  return partition(pool, { target: groupSize, min: 2 });
}

// ---------- setup ----------

// The setup form's state from what is saved (settings.modules.redemption), or a fresh one with the module off.
export function redemptionForm(saved) {
  return {
    on: Boolean(saved),
    groupSize: GROUP_SIZES.includes(saved?.group_size) ? saved.group_size : DEFAULT_GROUP_SIZE,
    cap: Number.isInteger(saved?.cap) && saved.cap >= 0 ? saved.cap : 0,
    feed: Array.isArray(saved?.feed) ? [...saved.feed] : [1],
  };
}

// What the setup stores for this form: nothing at all when the module is off (so it leaves no trace anywhere), else
// exactly { group_size, cap, feed } with the feed sorted and distinct (the database stores the same shape).
export function redemptionModuleFromForm(form) {
  if (!form?.on) return {};
  const feed = [...new Set(form.feed)].sort((a, b) => a - b);
  return { redemption: { group_size: form.groupSize, cap: form.cap, feed } };
}

// A problem with the form, as a stable code, or null: the organiser must choose at least one feeding round, a group size
// of 2 to 4 and a whole cap of 0 or more.
export function redemptionProblem(form) {
  if (!form?.on) return null;
  if (!GROUP_SIZES.includes(form.groupSize)) return 'group_size';
  if (!Number.isInteger(form.cap) || form.cap < 0 || form.cap > MAX_CAP) return 'cap';
  const feed = form.feed ?? [];
  if (feed.length === 0 || feed.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_FEED_ROUND)) {
    return 'feed';
  }
  return null;
}

export const PROBLEM_WORDS = Object.freeze({
  group_size: 'Choose groups of 2, 3 or 4.',
  cap: 'The cap is a whole number, 0 or more (0 means no limit).',
  feed: 'Choose at least one round to feed the redemption round.',
});

// "after Round 1", "after Rounds 1 and 2", "after Rounds 1, 2 and 3".
export function feedWords(feed) {
  const list = [...new Set(feed ?? [])].sort((a, b) => a - b);
  if (list.length === 0) return '';
  if (list.length === 1) return `after Round ${list[0]}`;
  return `after Rounds ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// One line saying what the saved setup does, for the console and the run sheet.
export function redemptionSummary(saved) {
  if (!saved) return null;
  const cap =
    saved.cap > 0 ? `at most ${saved.cap} come back` : 'everyone who wins a group comes back';
  return `Redemption ${feedWords(saved.feed)}: groups of ${saved.group_size}, ${cap}.`;
}

// ---------- the page model ----------

const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function groupOf(match) {
  const brewers = match.sides
    .filter((s) => s.entryId)
    .map((s) => ({
      entryId: s.entryId,
      name: s.name,
      votes: typeof s.votes === 'number' ? s.votes : null,
      winner: s.winner,
    }));
  return {
    id: match.id,
    number: match.position,
    brewers,
    decided: match.decided,
    resultKind: match.resultKind,
    winner: brewers.find((b) => b.winner)?.name ?? null,
    playable: match.playable,
  };
}

// The redemption rounds of a derived bracket (bracket.js), oldest first, each as
//   { id, label, position, feedLabel, entrants: [name], groups: [group], groupCount, decided, status, returning: [name] }
// `feedLabel` names the main round whose losers these are; `status` is 'drawn' (no vote yet), 'voting' or 'done'.
// `returning` lists the group winners once every group is decided (before any cap: the database applies the cap when it
// builds the next round, and the next round's own slots say who actually came back).
export function redemptionRounds(bracket) {
  const rounds = bracket?.rounds ?? [];
  return rounds
    .filter((r) => r.phase === 'redemption')
    .map((round) => {
      const groups = round.matches.map(groupOf);
      const before = rounds
        .filter((r) => r.position < round.position && r.phase === 'main')
        .sort((a, b) => b.position - a.position)[0];
      const decided = groups.length > 0 && groups.every((g) => g.decided);
      const started = groups.some((g) => g.decided || g.brewers.some((b) => (b.votes ?? 0) > 0));
      return {
        id: round.id,
        label: round.label,
        position: round.position,
        feedLabel: before?.label ?? null,
        drawSeed: round.drawSeed ?? null,
        entrants: groups
          .flatMap((g) => g.brewers.map((b) => b.name))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
        groups,
        groupCount: groups.length,
        decided,
        status: decided ? 'done' : started ? 'voting' : 'drawn',
        returning: decided ? groups.map((g) => g.winner).filter(Boolean) : [],
      };
    });
}

// A line for a round, in words: who is in it and how far it has got.
export function redemptionRoundWords(model) {
  const entrants = countOf(model.entrants.length, 'brewer', 'brewers');
  const groups = countOf(model.groupCount, 'group', 'groups');
  if (model.status === 'done') {
    return `${entrants} in ${groups}. Every group is decided: ${countOf(model.returning.length, 'winner goes', 'winners go')} back into the bracket.`;
  }
  const open = model.groups.filter((g) => !g.decided).length;
  return model.status === 'drawn'
    ? `${entrants} drawn into ${groups}. No votes yet.`
    : `${entrants} in ${groups}. ${countOf(open, 'group is', 'groups are')} still to decide.`;
}

// How many times each competitor has been brought back, from the decided redemption rounds: the history the page shows
// ("revived 2 times"). It never blocks anything (a brewer can be revived more than once).
export function revivedCounts(bracket) {
  const counts = new Map();
  for (const round of bracket?.rounds ?? []) {
    if (round.phase !== 'redemption') continue;
    for (const match of round.matches) {
      const winner = match.sides.find((s) => s.winner);
      if (winner?.entryId) counts.set(winner.entryId, (counts.get(winner.entryId) ?? 0) + 1);
    }
  }
  return counts;
}

// Whether the module was switched on: from the saved setup. A switched-off module leaves no redemption rounds, no page and
// no link anywhere, so every surface asks this (or whether a redemption round exists) before it draws anything.
export const redemptionOn = (settings) => Boolean(settings?.modules?.redemption);
export const hasRedemptionRound = (bracket) =>
  (bracket?.rounds ?? []).some((r) => r.phase === 'redemption');
