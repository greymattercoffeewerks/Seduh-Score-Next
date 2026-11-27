// The bracket preview (pure): what a Throwdown event WILL look like, from counts alone. Nothing here reads the database,
// draws a name or decides a match; it mirrors the shape rules of app.td_advance (and, for redemption, the TD.3 migration's
// app.td_group_sizes) so an organiser sees the rounds, byes and 3rd place match before the event. It is a plan, not a
// promise: walkovers, withdrawals and, with redemption, the returners' cap by votes can change the night.
//
// Shape rules (from td_advance):
//   a main round of n brewers has floor(n/2) matches and, when n is odd, one bye (the LAST brewer in order);
//   the next main round is that round's winners in match order, so the bye winner is the last brewer again;
//   one winner left is the champion; the Final is a main round of one match;
//   the 3rd place match is made with the Final only when the setting is on and the round before it was exactly two
//   matches with no bye;
//   redemption (a module): after a ticked feeding round that leaves MORE THAN FOUR winners and had two or more losers,
//   the losers go into groups (as even as possible, never a group of one), each group returns one winner, capped when
//   the cap is above 0, and those returners are added AFTER the feeding round's own winners.
import { partition } from '../../core/partition.js';

export const MIN_ENTRANTS = 2;
// A redemption round follows a feeding round only while strictly more than this many winners are left.
export const MIN_WINNERS_FOR_REDEMPTION = 4;

// The redemption setup is { feed: [round numbers], groupSize: 2..4, cap: 0.. }; null or undefined means the module is off.
function redemptionOf(setup) {
  if (!setup) return null;
  const feed = [...new Set(setup.feed ?? [])].filter((n) => Number.isInteger(n) && n >= 1);
  if (feed.length === 0) return null;
  const groupSize = [2, 3, 4].includes(setup.groupSize) ? setup.groupSize : 2;
  const cap = Number.isInteger(setup.cap) && setup.cap > 0 ? setup.cap : 0;
  return { feed, groupSize, cap };
}

export function roundName(number, matches) {
  if (matches === 1) return 'Final';
  if (matches === 2) return 'Semi-finals';
  if (matches === 4) return 'Quarter-finals';
  return `Round ${number}`;
}

// previewShape({ entrants, thirdPlace, redemption }) => the plan.
// Returns { problem } when the count cannot make a bracket.
export function previewShape({ entrants, thirdPlace = true, redemption = null } = {}) {
  if (!Number.isInteger(entrants) || entrants < MIN_ENTRANTS) return { problem: 'too_few' };
  const red = redemptionOf(redemption);
  const rounds = [];
  const flags = [];
  let enter = entrants;
  let number = 1;
  let thirdPlaceMatch = false;
  let thirdPlaceReason = thirdPlace ? null : 'off';
  // The bye lane: which round last gave the bye to "the last brewer in order", and how many rounds without a bye since.
  let lastByeRound = null;
  let gap = 0;
  const usedFeeds = new Set();

  while (enter > 1) {
    const matches = Math.floor(enter / 2);
    const byes = enter % 2;
    const through = matches + byes;
    const row = { number, label: roundName(number, matches + byes), enter, matches, byes, through };

    // repeat byes: the bye winner is last in the next round, so a bye straight after a bye is certain; after a gap the
    // same seat only gets it back if it won the last match of each round in between (one in two per round).
    if (byes) {
      if (lastByeRound !== null) {
        row.byeAgain = { sinceRound: lastByeRound, certain: gap === 0, oneIn: 2 ** gap };
        flags.push({
          code: 'repeat_bye',
          round: number,
          sinceRound: lastByeRound,
          certain: gap === 0,
          oneIn: 2 ** gap,
        });
      }
      lastByeRound = number;
      gap = 0;
    } else if (lastByeRound !== null) {
      gap += 1;
    }

    let next = through;
    if (red && red.feed.includes(number)) {
      usedFeeds.add(number);
      if (through > MIN_WINNERS_FOR_REDEMPTION && matches >= 2) {
        const groups = partition(matches, { target: red.groupSize, min: 2 }).length;
        const back = red.cap > 0 ? Math.min(groups, red.cap) : groups;
        row.redemption = { pool: matches, groups, back };
        next = through + back;
        // returners are added after the feeding round's winners, so the lane's seat is no longer last
        lastByeRound = null;
        gap = 0;
      } else {
        flags.push({ code: 'redemption_unused', round: number, winners: through, losers: matches });
      }
    }

    if (through === 2 && matches === 2 && next === 2) {
      // the round before the Final
      if (thirdPlace && byes === 0) thirdPlaceMatch = true;
      else if (thirdPlace) thirdPlaceReason = 'bye';
    } else if (through === 2 && matches === 1 && byes === 1 && thirdPlace) {
      // 3 brewers left: a match and a bye, then the Final
      thirdPlaceReason = 'bye';
    }
    rounds.push(row);
    enter = next;
    number += 1;
  }

  // feeding rounds that never existed in this event
  if (red) {
    for (const n of red.feed) {
      if (!usedFeeds.has(n))
        flags.push({ code: 'redemption_unused', round: n, winners: null, losers: null });
    }
  }
  if (thirdPlace && !thirdPlaceMatch && thirdPlaceReason === null) thirdPlaceReason = 'bye';
  // a two-brewer event is only a Final: no semi-finals, so no 3rd place
  if (thirdPlace && !thirdPlaceMatch && rounds.length === 1) thirdPlaceReason = 'no_semifinals';
  if (thirdPlace && !thirdPlaceMatch) {
    flags.push({ code: 'third_place_skipped', reason: thirdPlaceReason });
  }

  const redemptionMatches = rounds.reduce((s, r) => s + (r.redemption?.groups ?? 0), 0);
  const matchesTotal =
    rounds.reduce((s, r) => s + r.matches, 0) + redemptionMatches + (thirdPlaceMatch ? 1 : 0);
  const byesTotal = rounds.reduce((s, r) => s + r.byes, 0);
  return {
    entrants,
    rounds,
    flags,
    totals: {
      rounds: rounds.length,
      matches: matchesTotal,
      byes: byesTotal,
      redemptionMatches,
      finalSize: 2,
    },
    thirdPlace: {
      setting: Boolean(thirdPlace),
      played: thirdPlaceMatch,
      reason: thirdPlaceMatch ? null : thirdPlaceReason,
    },
  };
}

// What changes between two plans, for the Compare view: only the facts that differ, as { key, from, to }.
export function comparePreviews(a, b) {
  if (a.problem || b.problem) return [];
  const diffs = [];
  const add = (key, from, to) => {
    if (from !== to) diffs.push({ key, from, to });
  };
  add('rounds', a.totals.rounds, b.totals.rounds);
  add('matches', a.totals.matches, b.totals.matches);
  add('byes', a.totals.byes, b.totals.byes);
  add('thirdPlace', a.thirdPlace.played, b.thirdPlace.played);
  const repeat = (p) => p.flags.filter((f) => f.code === 'repeat_bye').length;
  add('repeatByes', repeat(a), repeat(b));
  return diffs;
}
