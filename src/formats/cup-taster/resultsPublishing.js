// Builds the payload src/core/publicResults.js's publish_event_results RPC
// expects, from data reportScreen.js already has in memory by the time it
// shows the "Public results" card (Phase 4). Pure — no DB reads here, so the
// exact shape is independently testable without a network round trip, same
// split this codebase already holds analytics.js/standings.js to.
//
// Reuses analytics.js's own computeEventSummary() output directly rather than
// re-deriving placement — that module's own header comment already warns
// against a second, competing ranking rule; this file's only job is
// reshaping already-correct data into the public archive's own field names,
// never deciding who won.

// The placement the stage resolution decided for this competitor's own last round
// (computeEventSummary's `finalPosition`, which is what makes ties read 9th, 9th, 11th) — the one
// number both the podium and the full standings are labelled with, so a tie reads the same on every
// public surface. The report, and the Public results card on it, exist only once the terminal stage
// is complete, when every competitor's last round has one. If one ever did not, there is no decided
// placing to publish and this returns null (shown as "—") rather than a stage-local rank dressed up
// as an overall place: a public table should leave a gap before it guesses. (computeEventSummary
// falls back to the stage's own position for its internal sort; that guess is not published.)
function placeOf(row) {
  const lastRound = row.rounds[row.rounds.length - 1];
  return lastRound.finalPosition ?? null;
}

// The podium is the top three PLACES, not the top three rows: when third place is shared, everyone
// who shares it is on the podium, instead of a tie being cut by whichever row happened to sort first.
// A pure filter over the already-ordered summary — nothing is re-ranked. Exported because the caller
// needs the same rows to know whose café to look up.
export function podiumRowsOf(summary) {
  const topThree = summary.slice(0, 3);
  const boundaryPlace = topThree.length === 3 ? placeOf(topThree[2]) : null;
  if (boundaryPlace == null) return topThree;
  return summary.filter((row, index) => index < 3 || placeOf(row) === boundaryPlace);
}

// One competitor's row in the published full standings. Built from fixed fields only — never from
// a spread of the source row — so nothing that was not deliberately chosen (a phone number, an
// email, set-by-set marks) can reach a public table by accident.
function standingsEntry(row, cafeByEntryId, roundLabelByOrdinal) {
  const lastRound = row.rounds[row.rounds.length - 1];
  return {
    place: placeOf(row),
    name: row.displayName,
    cafe: cafeByEntryId.get(row.entryId) ?? null,
    round: roundLabelByOrdinal.get(lastRound.stageOrdinal) ?? null,
    correct: lastRound.numCorrect,
    total: lastRound.setsScored,
    timeSecs: lastRound.totalElapsedSecs ?? null,
  };
}

// `cafeByEntryId` is a caller-supplied lookup (built from the event_entries rows the screen
// fetches — just the podium's three for a podium-only publish, every competitor's for the full
// standings; no need to thread cafe through analytics.js's whole pipeline) — missing entries fall
// back to null, same "honest no data" convention this codebase already uses throughout
// (analytics.js's own avgCorrect/accuracy handling).
//
// `scope` is the organiser's own choice at publish time: 'podium' (the default, and what any
// unrecognised value means) publishes the top three only; 'full' also publishes every
// competitor's placing as `standings`, which the public results sheet prints. Whichever was
// chosen is recorded by the payload itself (`standings` present or not), so the page, the sheet
// and the organiser's own card always agree about what is public.
//
// The full standings leave out anyone who has no scores at all (they never competed — listing them
// would print a result for someone who did not take part) and anyone in `omitEntryIds`, which the
// caller fills with competitors who withdrew — except a podium finisher, who is always listed so the
// podium and the standings can never disagree about who placed. The podium and `competitors` are not
// affected; `notListed` says how many were left out, so the public sheet can account for the
// difference between the field entered and the rows printed.
export function buildResultsPayload({
  event,
  stageReports,
  summary,
  cafeByEntryId = new Map(),
  scope = 'podium',
  roundLabelByOrdinal = new Map(),
  omitEntryIds = new Set(),
}) {
  const competitors = stageReports[0]?.ranked.length ?? 0;
  const rounds = stageReports.length;

  const champion = summary[0] ?? null;
  const championLastRound = champion?.rounds[champion.rounds.length - 1] ?? null;

  // `summary` is already ordered by the event's real placement (computeEventSummary sorted it from
  // finalPosition, nothing is re-ranked here). `podiumRank` is that placement read back off the row —
  // display of an already-decided result, not a second competition-ranking computation, which is
  // why it is named and set as its own step. A row with no decided placing keeps its order in the list.
  const podiumRows = podiumRowsOf(summary);
  const podium = podiumRows.map((row, index) => {
    const lastRound = row.rounds[row.rounds.length - 1];
    const podiumRank = placeOf(row) ?? index + 1;
    return {
      rank: podiumRank,
      name: row.displayName,
      cafe: cafeByEntryId.get(row.entryId) ?? null,
      correct: lastRound.numCorrect,
      total: lastRound.setsScored,
    };
  });

  const payload = {
    // Threaded through so the public archive page (format-agnostic per
    // core/publicResults.js's own comment) can render the right label for
    // whichever format actually published this row, rather than assuming
    // Cup Taster forever — found in review (module-boundary-checker): the
    // page previously hardcoded "Cup Taster" with no way to render anything
    // else once a second format starts publishing too.
    format: event.format,
    eventName: event.name,
    city: event.city ?? null,
    venue: event.venue ?? null,
    eventDate: event.event_date ?? null,
    competitors,
    rounds,
    winningTimeSecs: championLastRound?.totalElapsedSecs ?? null,
    podium,
  };

  if (scope === 'full') {
    const podiumIds = new Set(podiumRows.map((row) => row.entryId));
    const listed = summary.filter(
      (row) =>
        row.totalSetsScored > 0 && (podiumIds.has(row.entryId) || !omitEntryIds.has(row.entryId)),
    );
    payload.standings = listed.map((row) =>
      standingsEntry(row, cafeByEntryId, roundLabelByOrdinal),
    );
    if (listed.length < summary.length) payload.notListed = summary.length - listed.length;
  }

  return payload;
}
