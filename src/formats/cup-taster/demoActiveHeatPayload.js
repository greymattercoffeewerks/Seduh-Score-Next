// Demo-only fixture builder — NOT part of the shipped module graph, same
// as every *.preview.html file. Shared by phoneSummary.preview.html and
// projectorSurface.preview.html (both their own "+ Active heat" button and
// their own window.__e2e test hook), extracted here on its 2nd verbatim
// use across those two files — found in review: kept as two separate
// copies, nothing (lint, tests) would catch the two harnesses' demo states
// silently diverging from each other over time.
//
// `standings` stays a caller-supplied argument rather than embedded here —
// each harness already owns its own local `standings` fixture, reused by
// several OTHER buttons too (standings-only, recent-results, TEST event);
// hardcoding a second copy in here would just trade one divergence risk
// for another.
export function buildActiveHeatPayload(startedAt, durationSecs, standings) {
  return {
    stage: { kind: 'prelims', setCount: 5 },
    standings,
    activeHeat: {
      heatNumber: 2,
      stageKind: 'prelims',
      status: 'timing',
      timingMode: 'app',
      startedAt,
      durationSecs,
      cuppers: [
        { displayName: 'Jordan Lee', station: 'A', totalElapsedSecs: null, maxed: false },
        { displayName: 'Priya Nair', station: 'B', totalElapsedSecs: 190, maxed: false },
        { displayName: 'Taylor Chen', station: 'C', totalElapsedSecs: 480, maxed: true },
      ],
    },
  };
}
