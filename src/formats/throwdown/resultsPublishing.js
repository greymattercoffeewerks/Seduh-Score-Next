// Builds the payload core/publicResults.js's publish_event_results stores for a Throwdown event, from the bracket that
// every other Throwdown surface already uses (bracket.js, via loadThrowdown). Pure: no reads, no clock, so the exact
// shape is testable without a network. Cup Taster's resultsPublishing.js is the worked example.
//
// WHY THE SHAPE. The Seduh ID archive feed (app.seduh_feed_slots_internal) reads only `podium` and `standings`, and for
// each element only its trimmed `name` and `cafe`, matched against this event's event_entries. A Throwdown payload with
// the same two arrays is therefore enough for the feed to create identities exactly as it does for Cup Taster. The
// top-level keys are the ones the feed and the archive whitelist already know (format, eventName, city, venue,
// eventDate, competitors, rounds, podium, standings, notListed), plus `matches` (full scope only): the matches that were
// actually played, as names, cafés and a winner flag, which the Seduh ID profile reads for the knockout record
// (T-ID2.TD). The feed and the archive whitelist ignore `matches`; the public sheet draws nothing for it. There is no score or time:
// a knockout has neither, so those keys are left out rather than sent as null (the public sheet draws no column for
// them).
//
// DERIVED, NEVER STORED. Every place below is computed from the bracket at publish time; nothing here is a column.
// A published row is a snapshot the organiser chose to make (public_results), not a second live source of truth.
//
// PLACES. A knockout places people by the round they lost in, and shares the place within a round (competition
// ranking, so a tie leaves a gap: 1, 2, 3, 4, 5, 5, 5, 5, 9...):
//   1 champion, 2 runner-up;
//   3rd place match played: its winner is 3rd and its loser 4th;
//   no 3rd place match (switched off, or skipped because a semi-final was a bye or a loser had withdrawn): the two
//   semi-final losers SHARE 3rd (both on the podium), the usual knockout convention when no bronze match is played;
//   everyone else shares the place of the round they lost in (quarter-finals 5th, and so on). A competitor who had
//   a bye through a round is placed by the round they eventually lost in, never by the bye. A walkover loser lost
//   that round.
// A podium finisher who withdrew is still listed (the podium and the standings must never disagree); another
// withdrawn competitor is left out of the standings and counted in `notListed`, as Cup Taster does.

export const PUBLISH_SCOPES = Object.freeze(['podium', 'full']);
export const DEFAULT_PUBLISH_SCOPE = 'full';

// What the choice says is public, shown next to it (and read as part of its description).
export const PUBLISH_SCOPE_NOTICE = {
  podium: 'Only the podium’s names, cafés and places (1st, 2nd and 3rd) will be public.',
  full: 'Every competitor’s name, café and the round they reached will be public.',
};

// Why a bracket cannot be published yet, or null when it can. Only a finished event is published: a champion, and the
// 3rd place match (when the event has one) decided, so a podium is never published half-known.
export function publishBlocker(bracket) {
  if (!bracket?.started) return 'not_started';
  if (!bracket.champion) return 'no_champion';
  if (!bracket.complete) return 'third_place_pending';
  return null;
}

export const BLOCKER_WORDS = Object.freeze({
  not_started: 'The event has not started yet. Results can be published once there is a champion.',
  no_champion: 'The event is not finished yet. Results can be published once there is a champion.',
  third_place_pending: 'Finish the 3rd place match before publishing, so the podium is complete.',
});

const losersOf = (match) =>
  match.decided ? match.sides.filter((s) => s.entryId && s.winner === false) : [];
const winnersOf = (match) =>
  match.decided ? match.sides.filter((s) => s.entryId && s.winner === true) : [];

// The groups of entries that share a place, best first.
function tiersOf(bracket) {
  const main = bracket.rounds.filter((r) => r.phase === 'main');
  const third = bracket.rounds.find((r) => r.phase === 'third_place')?.matches[0] ?? null;
  const finalMatch = main[main.length - 1].matches[0];
  const ids = (sides) => sides.map((s) => s.entryId);

  const tiers = [ids(winnersOf(finalMatch)), ids(losersOf(finalMatch))];
  const semiRound = main.length >= 2 ? main[main.length - 2] : null;
  if (third?.decided) {
    tiers.push(ids(winnersOf(third)), ids(losersOf(third)));
  } else if (semiRound) {
    tiers.push(ids(semiRound.matches.flatMap(losersOf)));
  }
  // every earlier main round, latest first; the semi-final losers were placed above
  for (let i = main.length - 3; i >= 0; i -= 1) {
    tiers.push(ids(main[i].matches.flatMap(losersOf)));
  }
  return tiers.filter((t) => t.length > 0);
}

// The matches that were actually PLAYED, for the Seduh ID knockout record (owner decision 2026-11-20: a walkover is not
// counted, a 3rd place match is). A match counts when it is decided by votes or scores and has exactly two competitors in
// it, one the winner. No byes, walkovers, undecided matches, pools (more than two slots), redemption rounds (not built yet; decide
// their rule when they ship) or scores; names and cafés only, as
// everywhere else in this payload. Same name and café the standings use, so a reader can match them to the roster.
function playedMatches(bracket, entryById, listedIds) {
  const out = [];
  for (const round of bracket.rounds) {
    if (round.phase !== 'main' && round.phase !== 'third_place') continue;
    for (const m of round.matches) {
      if (!m.decided || (m.resultKind !== 'votes' && m.resultKind !== 'scores')) continue;
      const seated = m.sides.filter((s) => s.entryId);
      if (m.sides.length !== 2 || seated.length !== 2) continue;
      // a competitor the standings leave out (withdrawn, not on the podium) is named nowhere in the payload
      if (seated.some((x) => !listedIds.has(x.entryId))) continue;
      if (seated.filter((s) => s.winner === true).length !== 1) continue;
      out.push({
        round: round.label,
        sides: seated.map((s) => {
          const entry = entryById.get(s.entryId);
          return {
            name: entry?.display_name ?? s.name ?? null,
            cafe: entry?.cafe ?? null,
            winner: s.winner === true,
          };
        }),
      });
    }
  }
  return out;
}

// `entries`: the event_entries rows (id, display_name, cafe, withdrawn). scope: 'podium' (what any unrecognised value
// means) or 'full'. Throws when the bracket is not ready: callers check publishBlocker first.
export function buildThrowdownPayload({ event, bracket, entries, scope = 'podium' }) {
  const blocker = publishBlocker(bracket);
  if (blocker) throw new Error(`Throwdown results are not ready to publish: ${blocker}`);

  const entryById = new Map(entries.map((e) => [e.id, e]));
  const main = bracket.rounds.filter((r) => r.phase === 'main');

  // the round each competitor last stood in (a bye counts as standing in the next round only if they have a slot there)
  const reached = new Map();
  const sideName = new Map();
  for (const round of main) {
    for (const m of round.matches) {
      for (const s of m.sides) {
        if (!s.entryId) continue;
        reached.set(s.entryId, round.label);
        sideName.set(s.entryId, s.name);
      }
    }
  }

  const placed = [];
  let above = 0;
  for (const tier of tiersOf(bracket)) {
    for (const id of tier) {
      const entry = entryById.get(id);
      placed.push({
        id,
        place: above + 1,
        name: entry?.display_name ?? sideName.get(id) ?? null,
        cafe: entry?.cafe ?? null,
        withdrawn: entry?.withdrawn === true,
        round: reached.get(id) ?? null,
      });
    }
    above += tier.length;
  }

  // `rank` is the place read back off the bracket for the public payload, display of an already-decided result and not
  // a second ranking computation, so it is named and set as its own step (the no-derived-storage rule's own reading).
  const podium = placed
    .filter((p) => p.place <= 3)
    .map((p) => {
      const podiumRank = p.place;
      return { rank: podiumRank, name: p.name, cafe: p.cafe };
    });

  const payload = {
    format: event.format,
    eventName: event.name,
    city: event.city ?? null,
    venue: event.venue ?? null,
    eventDate: event.event_date ?? null,
    competitors: reached.size,
    rounds: main.length,
    podium,
  };

  if (scope === 'full') {
    const listed = placed.filter((p) => p.place <= 3 || !p.withdrawn);
    payload.standings = listed.map((p) => ({
      place: p.place,
      name: p.name,
      cafe: p.cafe,
      round: p.round,
    }));
    const notListed = entries.length - listed.length;
    if (notListed > 0) payload.notListed = notListed;
    // The knockout record on a Seduh ID profile is read from this list and nowhere else (T-ID2.TD).
    payload.matches = playedMatches(bracket, entryById, new Set(listed.map((p) => p.id)));
  }
  return payload;
}

// The refusal an organiser can meet, in words. A test event is refused by the database (a BEFORE trigger and the
// function itself, SQLSTATE P0001, "refusing to publish a test event"); the screen says so before it ever asks, and
// this is the same sentence if a request gets through anyway. Chosen by the database's own words and code, never
// shown raw.
export function describePublishError(err) {
  const text = `${err?.message ?? ''} ${err?.details ?? ''}`;
  if (/test event/i.test(text)) {
    return 'This is a test event, and test events are never published. Create a real event to publish results.';
  }
  if (/not found/i.test(text)) return 'That event could not be found for publishing.';
  return 'Something went wrong publishing that — check your connection and try again.';
}
