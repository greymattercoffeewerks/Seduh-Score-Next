import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectProjectorMoments, RESULT_HOLD_MS, RANK_HOLD_MS } from './projectorMoments.js';

afterEach(() => {
  vi.useRealTimers();
});

const stage = { kind: 'prelims', ordinal: 1, setCount: 7 };
const standing = (position, displayName, extra = {}) => ({
  position,
  displayName,
  numCorrect: 5,
  totalElapsedSecs: 200 + position,
  tieStatus: null,
  ...extra,
});
const idleRow = (position, displayName) =>
  standing(position, displayName, { numCorrect: 0, totalElapsedSecs: null });
const result = (displayName, numCorrect, totalElapsedSecs) => ({
  displayName,
  numCorrect,
  totalElapsedSecs,
});
const heat = (heatNumber, results, extra = {}) => ({
  heatNumber,
  kind: 'normal',
  stageKind: 'prelims',
  results,
  ...extra,
});
const snapshot = (extra = {}) => ({
  eventName: 'Cup 2026',
  stage,
  standings: [],
  recentHeats: [],
  ...extra,
});

// Plays one moment the way the director would: mounts its screen on a host.
function mountMoment(moment) {
  const host = document.createElement('div');
  const handle = moment.screen.mount(host, moment.payload);
  return { host, handle };
}
const text = (host, selector) => host.querySelector(selector)?.textContent ?? null;
const all = (host, selector) => [...host.querySelectorAll(selector)].map((n) => n.textContent);

describe('detectProjectorMoments: when there is something to say', () => {
  const before = snapshot({ standings: [standing(1, 'Ayu'), standing(2, 'Bima')] });

  it('says nothing for the first snapshot (nothing is known to have happened)', () => {
    expect(detectProjectorMoments(null, snapshot({ recentHeats: [heat(1, [])] }))).toEqual([]);
    expect(detectProjectorMoments(undefined, snapshot())).toEqual([]);
  });

  it('says nothing when no new heat has been confirmed', () => {
    const same = snapshot({ recentHeats: [heat(1, [result('Ayu', 5, 200)])] });
    expect(detectProjectorMoments(same, { ...same })).toEqual([]);
  });

  it('a heat that is new in the recent results is a result moment carrying that heat and the snapshot', () => {
    const after = snapshot({
      standings: before.standings,
      recentHeats: [heat(3, [result('Ayu', 5, 200)])],
    });
    const moments = detectProjectorMoments(before, after);
    expect(moments).toHaveLength(1);
    expect(moments[0].screen.key).toBe('result');
    expect(moments[0].payload.moment.heat.heatNumber).toBe(3);
    expect(moments[0].payload.eventName).toBe('Cup 2026');
    expect(moments[0].payload.stage).toEqual(stage);
  });

  it('every moment holds for a set time', () => {
    const after = snapshot({
      standings: [standing(1, 'Cleo'), standing(2, 'Ayu'), standing(3, 'Bima')],
      recentHeats: [heat(3, [result('Cleo', 7, 190)])],
    });
    const [resultMoment, rankMoment] = detectProjectorMoments(before, after);
    expect(resultMoment.screen.minDwellMs).toBe(RESULT_HOLD_MS);
    expect(rankMoment.screen.minDwellMs).toBe(RANK_HOLD_MS);
  });

  it('a new result that moves the top of the table is followed by a rank-impact moment', () => {
    const after = snapshot({
      standings: [standing(1, 'Cleo'), standing(2, 'Ayu'), standing(3, 'Bima')],
      recentHeats: [heat(3, [result('Cleo', 7, 190)])],
    });
    const moments = detectProjectorMoments(before, after);
    expect(moments.map((m) => m.screen.key)).toEqual(['result', 'rank']);
    const { headline, afterHeat, rows } = moments[1].payload.moment;
    expect(headline).toBe('Cleo takes the lead');
    expect(afterHeat).toBe('Heat 3');
    expect(rows.map((r) => [r.displayName, r.change, r.places])).toEqual([
      ['Cleo', 'entered', 0],
      ['Ayu', 'down', 1],
      ['Bima', 'down', 1],
    ]);
  });

  it('two heats confirmed between snapshots give two results in running order, then one rank moment', () => {
    const after = snapshot({
      standings: [standing(1, 'Cleo'), standing(2, 'Ayu'), standing(3, 'Bima')],
      recentHeats: [heat(4, [result('Bima', 6, 195)]), heat(3, [result('Cleo', 7, 190)])],
    });
    const moments = detectProjectorMoments(before, after);
    expect(moments.map((m) => m.screen.key)).toEqual(['result', 'result', 'rank']);
    expect(moments.map((m) => m.payload.moment.heat?.heatNumber)).toEqual([3, 4, undefined]);
    expect(moments[2].payload.moment.afterHeat).toBe('Heat 4');
  });

  it('a tiebreak heat numbered 1 is new even though a regular Heat 1 was already shown', () => {
    const prior = snapshot({ recentHeats: [heat(1, [result('Ayu', 5, 200)])] });
    const after = snapshot({
      recentHeats: [
        heat(1, [result('Ayu', 5, 190)], { kind: 'tiebreak' }),
        heat(1, [result('Ayu', 5, 200)]),
      ],
    });
    const moments = detectProjectorMoments(prior, after);
    expect(moments).toHaveLength(1);
    expect(moments[0].payload.moment.heat.kind).toBe('tiebreak');
  });

  it('a heat from a payload published before heats carried a kind is the same heat, not a new one', () => {
    const old = snapshot({
      recentHeats: [{ heatNumber: 1, stageKind: 'prelims', results: [result('Ayu', 5, 200)] }],
    });
    const now = snapshot({ recentHeats: [heat(1, [result('Ayu', 5, 200)])] });
    expect(detectProjectorMoments(old, now)).toEqual([]);
  });

  it('says nothing across two different stages: their lists are about different cuppers', () => {
    const semis = snapshot({
      stage: { kind: 'semis', ordinal: 2, setCount: 5 },
      recentHeats: [heat(1, [result('Ayu', 5, 200)], { stageKind: 'semis' })],
    });
    expect(detectProjectorMoments(before, semis)).toEqual([]);
  });

  it('copes with payloads that have no recent heats, standings or stage at all', () => {
    expect(detectProjectorMoments({}, {})).toEqual([]);
    expect(detectProjectorMoments(snapshot(), { stage })).toEqual([]);
  });
});

describe('detectProjectorMoments: the rank-impact moment', () => {
  const newHeat = [heat(3, [result('Cleo', 7, 190)])];

  function rankOf(previous, standings, recentHeats = newHeat) {
    const moments = detectProjectorMoments(
      snapshot({ standings: previous }),
      snapshot({ standings, recentHeats }),
    );
    return moments.find((m) => m.screen.key === 'rank')?.payload.moment ?? null;
  }

  it('the very first result: everyone who raced "enters", cuppers yet to race are left out', () => {
    const impact = rankOf(
      [idleRow(1, 'Ayu'), idleRow(1, 'Bima'), idleRow(1, 'Cleo')],
      [standing(1, 'Cleo'), idleRow(2, 'Ayu'), idleRow(2, 'Bima')],
    );
    expect(impact.rows.map((r) => [r.displayName, r.change])).toEqual([['Cleo', 'entered']]);
    expect(impact.headline).toBe('Cleo takes the lead');
  });

  it('a cupper with correct answers but no recorded time still counts as having raced', () => {
    const impact = rankOf(
      [idleRow(1, 'Ayu'), idleRow(1, 'Cleo')],
      [standing(1, 'Cleo', { numCorrect: 3, totalElapsedSecs: null }), idleRow(2, 'Ayu')],
    );
    expect(impact.rows.map((r) => [r.displayName, r.change])).toEqual([['Cleo', 'entered']]);
  });

  it('a cupper who has not raced is never reported as having moved down', () => {
    const impact = rankOf(
      [standing(1, 'Ayu'), idleRow(2, 'Bima'), idleRow(2, 'Cleo')],
      [standing(1, 'Ayu'), standing(2, 'Cleo', { numCorrect: 4 }), idleRow(3, 'Bima')],
    );
    expect(impact.rows.map((r) => r.displayName)).toEqual(['Ayu', 'Cleo']);
  });

  it('says the leader stays in front, when they do', () => {
    const impact = rankOf(
      [standing(1, 'Ayu'), standing(2, 'Bima')],
      [standing(1, 'Ayu'), standing(2, 'Cleo', { numCorrect: 4 }), standing(3, 'Bima')],
    );
    expect(impact.headline).toBe('Ayu stays in front');
  });

  it('says two cuppers share the lead, or how many', () => {
    const two = rankOf(
      [standing(1, 'Ayu'), standing(2, 'Bima')],
      [standing(1, 'Ayu'), standing(1, 'Cleo'), standing(3, 'Bima')],
    );
    expect(two.headline).toBe('Ayu and Cleo share the lead');
    const three = rankOf(
      [standing(1, 'Ayu'), standing(2, 'Bima')],
      [standing(1, 'Ayu'), standing(1, 'Cleo'), standing(1, 'Bima')],
    );
    expect(three.headline).toBe('3 cuppers share the lead');
  });

  it('a shared lead is not "staying in front" for the one who was already ahead', () => {
    const impact = rankOf(
      [standing(1, 'Ayu'), standing(1, 'Bima')],
      [standing(1, 'Ayu'), standing(2, 'Bima'), standing(3, 'Cleo')],
    );
    expect(impact.headline).toBe('Ayu takes the lead');
  });

  it('marks tied places, and shows only the top five places', () => {
    const impact = rankOf(
      [standing(1, 'A'), standing(2, 'B'), standing(3, 'C'), standing(4, 'D')],
      [
        standing(1, 'A'),
        standing(2, 'Cleo'),
        standing(2, 'B'),
        standing(4, 'C'),
        standing(5, 'D'),
        standing(6, 'E'),
        standing(7, 'F'),
      ],
    );
    expect(impact.rows.map((r) => r.displayName)).toEqual(['A', 'Cleo', 'B', 'C', 'D']);
    expect(impact.rows.find((r) => r.displayName === 'Cleo').tied).toBe(true);
    expect(impact.rows.find((r) => r.displayName === 'A').tied).toBe(false);
  });

  it('keeps every cupper tied at fifth place, up to eight rows', () => {
    const tied = ['E', 'F', 'G', 'H', 'I', 'J'].map((name) => standing(5, name));
    const impact = rankOf(
      [standing(1, 'A')],
      [standing(1, 'A'), standing(2, 'B'), standing(3, 'C'), standing(4, 'D'), ...tied],
    );
    expect(impact.rows).toHaveLength(8);
  });

  it('is left out when the result did not touch the top of the table', () => {
    const rows = [standing(1, 'A'), standing(2, 'B'), standing(3, 'C')];
    expect(
      rankOf(
        rows,
        rows.map((r) => ({ ...r })),
      ),
    ).toBeNull();
  });

  it('is left out when two cuppers share a name, rather than pinning a move on the wrong one', () => {
    const impact = rankOf(
      [standing(1, 'Ayu'), standing(2, 'Ayu')],
      [standing(1, 'Cleo'), standing(2, 'Ayu'), standing(3, 'Ayu')],
    );
    expect(impact).toBeNull();
  });

  it('is left out when nobody has a result in the standings yet', () => {
    expect(rankOf([idleRow(1, 'A')], [idleRow(1, 'A')])).toBeNull();
  });

  it('the result moment is still played when the rank moment is left out', () => {
    const moments = detectProjectorMoments(
      snapshot({ standings: [standing(1, 'Ayu'), standing(2, 'Ayu')] }),
      snapshot({ standings: [standing(1, 'Cleo'), standing(2, 'Ayu')], recentHeats: newHeat }),
    );
    expect(moments.map((m) => m.screen.key)).toEqual(['result']);
  });
});

describe('result screen', () => {
  function resultFor(results, extra = {}) {
    const moments = detectProjectorMoments(
      snapshot(),
      snapshot({ recentHeats: [heat(3, results)], ...extra }),
    );
    return mountMoment(moments[0]);
  }

  it('names the heat and puts each cupper in their place, best first, with their tally and time', () => {
    const { host } = resultFor([
      result('Bima', 5, 210),
      result('Ayu', 6, 230),
      result('Cleo', 5, 190),
    ]);
    expect(text(host, '.stage-kicker')).toBe('Result recorded');
    expect(text(host, '.stage-title')).toBe('Heat 3');
    expect(all(host, '.projector-station-name')).toEqual(['Ayu', 'Cleo', 'Bima']);
    expect(all(host, '.projector-station-label')).toEqual(['1st', '2nd', '3rd']);
    expect(all(host, '.projector-station-note')).toEqual([
      '6 of 7 correct · 3:50',
      '5 of 7 correct · 3:10',
      '5 of 7 correct · 3:30',
    ]);
  });

  it('writes "Joint" when two cuppers share a place', () => {
    const { host } = resultFor([
      result('Ayu', 5, 200),
      result('Bima', 5, 200),
      result('Cleo', 3, 250),
    ]);
    expect(all(host, '.projector-station-label')).toEqual(['Joint 1st', 'Joint 1st', '3rd']);
  });

  it('two untimed cuppers on the same tally tie rather than being ordered by accident', () => {
    const { host } = resultFor([result('Ayu', 5, null), result('Bima', 5, null)]);
    expect(all(host, '.projector-station-label')).toEqual(['Joint 1st', 'Joint 1st']);
    expect(all(host, '.projector-station-note')).toEqual([
      '5 of 7 correct · no time',
      '5 of 7 correct · no time',
    ]);
  });

  it('a cupper with no time ranks below one with a time on the same tally', () => {
    const { host } = resultFor([result('Ayu', 5, null), result('Bima', 5, 300)]);
    expect(all(host, '.projector-station-name')).toEqual(['Bima', 'Ayu']);
  });

  it('an untimed cupper ranks below a timed one on the same tally, whichever order they arrive in', () => {
    const one = resultFor([result('Ayu', 5, null), result('Bima', 5, 300)]);
    const other = resultFor([result('Bima', 5, 300), result('Ayu', 5, null)]);
    expect(all(one.host, '.projector-station-name')).toEqual(['Bima', 'Ayu']);
    expect(all(other.host, '.projector-station-name')).toEqual(['Bima', 'Ayu']);
  });

  it('leaves out "of N" when the stage has no set count', () => {
    const { host } = resultFor([result('Ayu', 4, 200)], { stage: { kind: 'prelims', ordinal: 1 } });
    expect(text(host, '.projector-station-note')).toBe('4 correct · 3:20');
  });

  it('names a tiebreak heat as one', () => {
    const moments = detectProjectorMoments(
      snapshot(),
      snapshot({ recentHeats: [heat(1, [result('Ayu', 5, 200)], { kind: 'tiebreak' })] }),
    );
    expect(text(mountMoment(moments[0]).host, '.stage-title')).toBe('Heat 1 (tiebreak)');
  });

  it('takes the compact layout for more than four cuppers, like the heat screen', () => {
    const four = resultFor(['a', 'b', 'c', 'd'].map((n, i) => result(n, 4, 200 + i)));
    expect(four.host.querySelector('.stage-main').classList.contains('projector-many')).toBe(false);
    const six = resultFor(['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => result(n, 4, 200 + i)));
    expect(six.host.querySelector('.stage-main').classList.contains('projector-many')).toBe(true);
  });

  it('says who is up next in the footer, when the organiser has a next heat', () => {
    const { host } = resultFor([result('Ayu', 5, 200)], {
      upNext: { heatNumber: 4, kind: 'normal', cuppers: [{ displayName: 'X', station: 'A' }] },
    });
    expect(text(host, '.stage-footer-start')).toBe('Up next: Heat 4');
  });

  it('draws the change-back ring, and destroy() stops it', () => {
    vi.useFakeTimers();
    const { host, handle } = resultFor([result('Ayu', 5, 200)]);
    expect(host.querySelector('.stage-footer-end svg')).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders names as text, never as markup', () => {
    const { host } = resultFor([result('<img src=x onerror=alert(1)>', 5, 200)]);
    expect(host.querySelector('img')).toBeNull();
    expect(text(host, '.projector-station-name')).toBe('<img src=x onerror=alert(1)>');
  });

  it('announces no heat that has no results: a "Result recorded" over an empty grid says nothing', () => {
    const moments = detectProjectorMoments(
      snapshot(),
      snapshot({ recentHeats: [heat(3, []), heat(4, undefined)] }),
    );
    expect(moments).toEqual([]);
  });
});

describe('rank-impact screen', () => {
  function rankScreen(previousStandings, standings, extra = {}) {
    const moments = detectProjectorMoments(
      snapshot({ standings: previousStandings }),
      snapshot({ standings, recentHeats: [heat(3, [result('Cleo', 7, 190)])], ...extra }),
    );
    return mountMoment(moments.find((m) => m.screen.key === 'rank'));
  }
  const previous = [standing(1, 'Ayu'), standing(2, 'Bima'), standing(3, 'Dara')];

  it('says what changed in words: the headline, then each place with New, Up, Down or Holds', () => {
    const { host } = rankScreen(
      previous,
      [standing(1, 'Cleo'), standing(2, 'Dara'), standing(3, 'Ayu'), standing(4, 'Bima')].map(
        (r) => r,
      ),
    );
    expect(text(host, '.stage-kicker')).toBe('Rank impact');
    expect(text(host, '.stage-title')).toBe('Cleo takes the lead');
    expect(all(host, '.stage-move-pos')).toEqual(['1', '2', '3', '4']);
    expect(all(host, '.stage-move-name-text')).toEqual(['Cleo', 'Dara', 'Ayu', 'Bima']);
    expect(all(host, '.stage-move-change')).toEqual(['New', 'Up 1', 'Down 2', 'Down 2']);
    expect(text(host, '.stage-footer-start')).toBe('Standings after Heat 3');
  });

  it('writes "Holds" for a place that did not move, and marks the kind of change on the row', () => {
    const { host } = rankScreen(previous, [
      standing(1, 'Ayu'),
      standing(2, 'Cleo'),
      standing(3, 'Bima'),
      standing(4, 'Dara'),
    ]);
    const rows = [...host.querySelectorAll('.stage-move')];
    expect(rows.map((r) => r.getAttribute('data-change'))).toEqual([
      'same',
      'entered',
      'down',
      'down',
    ]);
    expect(all(host, '.stage-move-change')[0]).toBe('Holds');
  });

  it('writes "(tied)" in its own element beside a shared place', () => {
    const { host } = rankScreen(previous, [
      standing(1, 'Cleo'),
      standing(2, 'Ayu'),
      standing(2, 'Bima'),
    ]);
    const suffixes = all(host, '.stage-move-name-suffix');
    expect(suffixes).toEqual([' (tied)', ' (tied)']);
  });

  it('draws the change-back ring, and destroy() stops it', () => {
    vi.useFakeTimers();
    const { host, handle } = rankScreen(previous, [standing(1, 'Cleo'), standing(2, 'Ayu')]);
    expect(host.querySelector('.stage-footer-end svg')).not.toBeNull();
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders names as text, never as markup', () => {
    const { host } = rankScreen(previous, [standing(1, '<b>Cleo</b>'), standing(2, 'Ayu')]);
    expect(host.querySelector('b')).toBeNull();
    expect(text(host, '.stage-title')).toBe('<b>Cleo</b> takes the lead');
  });
});

describe('detectProjectorMoments: comparing safely', () => {
  const standings = [standing(1, 'Ayu'), standing(2, 'Bima')];
  const withHeat = (extra = {}) =>
    snapshot({ standings, recentHeats: [heat(3, [result('Ayu', 5, 200)])], ...extra });

  it('says nothing across stages that differ only in their ordinal, or only in their kind', () => {
    const before = snapshot({ standings });
    expect(detectProjectorMoments(before, withHeat({ stage: { ...stage, ordinal: 2 } }))).toEqual(
      [],
    );
    expect(
      detectProjectorMoments(before, withHeat({ stage: { ...stage, kind: 'semis' } })),
    ).toEqual([]);
  });

  it('says nothing when neither snapshot says which stage it is about', () => {
    expect(
      detectProjectorMoments(snapshot({ stage: undefined }), withHeat({ stage: undefined })),
    ).toEqual([]);
  });

  it('says nothing when there is no later snapshot', () => {
    expect(detectProjectorMoments(snapshot(), null)).toEqual([]);
  });

  it('a snapshot with a new heat but no standings gives the result and no rank screen', () => {
    const next = { eventName: 'Cup', stage, recentHeats: [heat(3, [result('Ayu', 5, 200)])] };
    const moments = detectProjectorMoments(snapshot({ standings }), next);
    expect(moments.map((m) => m.screen.key)).toEqual(['result']);
  });

  it('a heat that was already announced is not announced again when its results are corrected', () => {
    const before = snapshot({ recentHeats: [heat(3, [result('Ayu', 5, 200)])] });
    const after = snapshot({ recentHeats: [heat(3, [result('Ayu', 6, 190)])] });
    expect(detectProjectorMoments(before, after)).toEqual([]);
  });

  it('the rank moment carries the snapshot it was found in (the band follows it)', () => {
    const moments = detectProjectorMoments(
      snapshot({ standings: [standing(1, 'Ayu')] }),
      snapshot({
        eventName: 'The next event name',
        standings: [standing(1, 'Cleo'), standing(2, 'Ayu')],
        recentHeats: [heat(3, [result('Cleo', 7, 190)])],
      }),
    );
    expect(moments.find((m) => m.screen.key === 'rank').payload.eventName).toBe(
      'The next event name',
    );
  });

  it('shows no rank screen when the only movement is below the rows it would show', () => {
    const above = [
      standing(1, 'A'),
      standing(2, 'B'),
      standing(3, 'C'),
      standing(4, 'D'),
      standing(5, 'E'),
    ];
    const before = snapshot({ standings: [...above, standing(6, 'F'), standing(7, 'G')] });
    const after = snapshot({
      standings: [...above, standing(6, 'G'), standing(7, 'F')],
      recentHeats: [heat(3, [result('G', 3, 250)])],
    });
    const moments = detectProjectorMoments(before, after);
    expect(moments.map((m) => m.screen.key)).toEqual(['result']);
  });

  it('announces a heat with no results as nothing, and a heat with results beside it normally', () => {
    const moments = detectProjectorMoments(
      snapshot(),
      snapshot({ recentHeats: [heat(3, []), heat(4, [result('Ayu', 5, 200)])] }),
    );
    expect(moments.map((m) => m.payload.moment.heat.heatNumber)).toEqual([4]);
  });
});

describe('detectProjectorMoments: tiebreak heats', () => {
  const before = snapshot({ standings: [standing(1, 'A'), standing(2, 'B')] });
  const tiebreak = heat(1, [result('B', 1, 100), result('A', 0, 120)], { kind: 'tiebreak' });

  it('announces a tiebreak result, but never says what it did to a table that ignores it', () => {
    const moments = detectProjectorMoments(
      before,
      snapshot({ standings: [standing(1, 'B'), standing(2, 'A')], recentHeats: [tiebreak] }),
    );
    expect(moments.map((m) => m.screen.key)).toEqual(['result']);
    expect(moments[0].payload.moment.heat.kind).toBe('tiebreak');
  });

  it('with a regular heat in the same comparison, the results play in running order and no rank screen contradicts the tiebreak', () => {
    const moments = detectProjectorMoments(
      before,
      snapshot({
        // the table says A and B are level: the tiebreak that decided them is not in it
        standings: [standing(1, 'A'), standing(1, 'B', { numCorrect: 5 })],
        recentHeats: [tiebreak, heat(2, [result('B', 5, 200)])],
      }),
    );
    expect(moments.map((m) => m.screen.key)).toEqual(['result', 'result']);
    expect(moments.map((m) => m.payload.moment.heat.kind)).toEqual(['normal', 'tiebreak']);
  });
});

describe('detectProjectorMoments: how the rank headline and rows read', () => {
  const rankOf = (previous, standings) =>
    detectProjectorMoments(
      snapshot({ standings: previous }),
      snapshot({ standings, recentHeats: [heat(3, [result('X', 5, 100)])] }),
    ).find((m) => m.screen.key === 'rank')?.payload.moment;

  it('says how many co-leaders there are instead of stringing two long names into one headline', () => {
    const long = 'Muhammad Alexander Wilkinson-Gultom Santoso';
    const impact = rankOf(
      [standing(1, 'Ayu')],
      [standing(1, long), standing(1, 'Another Long Name Here'), standing(3, 'Ayu')],
    );
    expect(impact.headline).toBe('2 cuppers share the lead');
  });

  it('names two co-leaders whose names fit', () => {
    const impact = rankOf(
      [standing(1, 'Ayu')],
      [standing(1, 'Cleo'), standing(1, 'Dara'), standing(3, 'Ayu')],
    );
    expect(impact.headline).toBe('Cleo and Dara share the lead');
  });

  it('says how many rows were left out when a tie for the last place is longer than the screen', () => {
    const tied = Array.from({ length: 10 }, (_, i) => standing(1, `Cupper ${i}`));
    const impact = rankOf([standing(1, 'Ayu')], tied);
    expect(impact.rows).toHaveLength(8);
    expect(impact.more).toBe(2);
    expect(impact.headline).toBe('10 cuppers share the lead');
  });

  it('says nothing is left out when every row fits', () => {
    const impact = rankOf([standing(1, 'Ayu')], [standing(1, 'Cleo'), standing(2, 'Ayu')]);
    expect(impact.more).toBe(0);
  });
});

describe('moment screens: the finer points', () => {
  function resultFor(results, extra = {}) {
    const moments = detectProjectorMoments(
      snapshot(),
      snapshot({ recentHeats: [heat(3, results)], ...extra }),
    );
    return mountMoment(moments[0]);
  }

  it('a heat of exactly five takes the compact layout, four does not', () => {
    const five = resultFor(['a', 'b', 'c', 'd', 'e'].map((n, i) => result(n, 4, 200 + i)));
    expect(five.host.querySelector('.stage-main').classList.contains('projector-many')).toBe(true);
  });

  it('says "Max time" for an entry that timed out, not the capped figure', () => {
    const { host } = resultFor([
      { ...result('Ayu', 3, 480), maxed: true },
      { ...result('Bima', 3, 300), maxed: false },
    ]);
    expect(all(host, '.projector-station-note')).toEqual([
      '3 of 7 correct · 5:00',
      '3 of 7 correct · Max time',
    ]);
  });

  it('the result ring counts down the result hold and the rank ring the rank hold', () => {
    const { host: resultHost } = resultFor([result('Ayu', 5, 200)]);
    expect(text(resultHost, '.stage-footer-end')).toBe('6');
    const moments = detectProjectorMoments(
      snapshot({ standings: [standing(1, 'Ayu')] }),
      snapshot({
        standings: [standing(1, 'Cleo'), standing(2, 'Ayu')],
        recentHeats: [heat(3, [result('Cleo', 7, 190)])],
      }),
    );
    const rankHost = mountMoment(moments.find((m) => m.screen.key === 'rank')).host;
    expect(text(rankHost, '.stage-footer-end')).toBe('8');
  });

  it('both screens opt their list into the one-time rise-in', () => {
    const { host } = resultFor([result('Ayu', 5, 200)]);
    expect(host.querySelector('.projector-results').classList.contains('stage-reveal')).toBe(true);
    expect(host.querySelectorAll('.stage-reveal-item')).toHaveLength(1);
    const moments = detectProjectorMoments(
      snapshot({ standings: [standing(1, 'Ayu')] }),
      snapshot({
        standings: [standing(1, 'Cleo'), standing(2, 'Ayu')],
        recentHeats: [heat(3, [result('Cleo', 7, 190)])],
      }),
    );
    const rankHost = mountMoment(moments.find((m) => m.screen.key === 'rank')).host;
    expect(rankHost.querySelector('.stage-moves').classList.contains('stage-reveal')).toBe(true);
  });

  it('writes "+N more" under a rank list that was cut short', () => {
    const tied = Array.from({ length: 10 }, (_, i) => standing(1, `Cupper ${i}`));
    const moments = detectProjectorMoments(
      snapshot({ standings: [standing(1, 'Ayu')] }),
      snapshot({ standings: tied, recentHeats: [heat(3, [result('Cupper 0', 5, 100)])] }),
    );
    const { host } = mountMoment(moments.find((m) => m.screen.key === 'rank'));
    expect(text(host, '.stage-move-more')).toBe('+2 more');
    expect(host.querySelectorAll('.stage-move')).toHaveLength(8);
  });
});
