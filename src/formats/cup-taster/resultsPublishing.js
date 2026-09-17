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
//
// `cafeByEntryId` is a caller-supplied lookup (built from event_entries rows
// the screen fetches for just the podium's entryIds — no need to thread cafe
// through analytics.js's whole pipeline for the sake of the top 3) — missing
// entries fall back to null, same "honest no data" convention this codebase
// already uses throughout (analytics.js's own avgCorrect/accuracy handling).
export function buildResultsPayload({ event, stageReports, summary, cafeByEntryId = new Map() }) {
  const competitors = stageReports[0]?.ranked.length ?? 0;
  const rounds = stageReports.length;

  const champion = summary[0] ?? null;
  const championLastRound = champion?.rounds[champion.rounds.length - 1] ?? null;

  const podium = summary.slice(0, 3).map((row, index) => {
    const lastRound = row.rounds[row.rounds.length - 1];
    // `podiumRank` is the row's own position in `summary` — an array
    // computeEventSummary() already sorted by the event's real placement
    // (finalPosition-derived, not re-ranked here). Display enumeration of an
    // already-correct order, not a second competition-ranking computation —
    // named and computed as its own step so it reads as exactly that.
    const podiumRank = index + 1;
    return {
      rank: podiumRank,
      name: row.displayName,
      cafe: cafeByEntryId.get(row.entryId) ?? null,
      correct: lastRound.numCorrect,
      total: lastRound.setsScored,
    };
  });

  return {
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
}
