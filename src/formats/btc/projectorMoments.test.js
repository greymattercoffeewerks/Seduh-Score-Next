import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectBtcMoments, RESULT_HOLD_MS, RANK_HOLD_MS } from './projectorMoments.js';
import { preliminaryPayload, knockoutPayload } from './demoLivePayload.js';

afterEach(() => {
  vi.useRealTimers();
});

const text = (host, selector) => host.querySelector(selector)?.textContent ?? null;
const all = (host, selector) => [...host.querySelectorAll(selector)].map((n) => n.textContent);

function play(moment) {
  const host = document.createElement('div');
  const handle = moment.screen.mount(host, moment.payload);
  return { host, handle };
}

const result = (overrides = {}) => ({
  matchId: 'm1',
  round: 'preliminary',
  roundLabel: 'Preliminary',
  confirmedAt: '2026-10-09T10:00:00.000Z',
  level: false,
  tiebreak: null,
  teams: [
    {
      name: 'Alpha',
      tokens: 30,
      total: 35,
      bonuses: { win: true, fastest: false, signature: false },
      winner: true,
    },
    {
      name: 'Beta',
      tokens: 15,
      total: 15,
      bonuses: { win: false, fastest: false, signature: false },
      winner: false,
    },
  ],
  ...overrides,
});

const withResults = (base, ...results) => ({ ...base, recentResults: results });

const row = (position, teamName, played = 3, wins = 1, points = 50) => ({
  position,
  teamName,
  played,
  wins,
  points,
});

describe('detectBtcMoments: what counts as news', () => {
  it('announces nothing without an earlier snapshot (a freshly opened display), or without a next one', () => {
    const next = withResults(preliminaryPayload(), result());
    expect(detectBtcMoments(null, next)).toEqual([]);
    expect(detectBtcMoments(undefined, next)).toEqual([]);
    expect(detectBtcMoments(next, null)).toEqual([]);
  });

  it('announces nothing when the snapshot only repeats what was already shown', () => {
    const snapshot = withResults(preliminaryPayload(), result());
    expect(detectBtcMoments(snapshot, { ...snapshot })).toEqual([]);
    expect(detectBtcMoments(snapshot, withResults(preliminaryPayload(), result()))).toEqual([]);
  });

  it('announces a result the previous snapshot did not have', () => {
    const previous = withResults(preliminaryPayload(), result({ matchId: 'old' }));
    const next = withResults(
      preliminaryPayload(),
      result({ matchId: 'new' }),
      result({ matchId: 'old' }),
    );
    const moments = detectBtcMoments(previous, next);
    expect(moments[0].screen.key).toBe('result');
    expect(moments[0].payload.moment.result.matchId).toBe('new');
  });

  it('announces a match again when it was re-scored or decided by tie-break (same match, new confirmedAt)', () => {
    const previous = withResults(
      knockoutPayload(),
      result({ matchId: 'qf3', round: 'quarterfinal', level: true }),
    );
    const next = withResults(
      knockoutPayload(),
      result({
        matchId: 'qf3',
        round: 'quarterfinal',
        confirmedAt: '2026-10-09T10:30:00.000Z',
        level: true,
        tiebreak: { reason: 'Sudden-death cup' },
      }),
    );
    const moments = detectBtcMoments(previous, next);
    expect(moments).toHaveLength(1);
    expect(moments[0].screen.key).toBe('result');
  });

  it('plays several new results oldest first', () => {
    const previous = withResults(preliminaryPayload());
    const next = withResults(
      preliminaryPayload(),
      result({ matchId: 'b', confirmedAt: '2026-10-09T10:20:00.000Z' }),
      result({ matchId: 'a', confirmedAt: '2026-10-09T10:10:00.000Z' }),
    );
    const ids = detectBtcMoments(previous, next)
      .filter((m) => m.screen.key === 'result')
      .map((m) => m.payload.moment.result.matchId);
    expect(ids).toEqual(['a', 'b']);
  });

  it('ignores a result that does not have exactly two teams', () => {
    const previous = withResults(preliminaryPayload());
    const next = withResults(preliminaryPayload(), result({ teams: [result().teams[0]] }));
    expect(detectBtcMoments(previous, next)).toEqual([]);
  });

  it('carries the rest of the snapshot along with the moment, so the ring and band use the live facts', () => {
    const previous = withResults(preliminaryPayload());
    const nextBase = preliminaryPayload({ playedCount: 13 });
    const [moment] = detectBtcMoments(previous, withResults(nextBase, result()));
    expect(moment.payload.eventName).toBe(nextBase.eventName);
    expect(moment.payload.standings).toEqual(nextBase.standings);
  });
});

describe('detectBtcMoments: when the table has something to say', () => {
  const before = (...rows) => ({ phase: 'preliminary', standings: rows, recentResults: [] });
  const after = (rowsAfter, newResult = result()) => ({
    phase: 'preliminary',
    standings: rowsAfter,
    recentResults: [newResult],
  });
  const kinds = (previous, next) => detectBtcMoments(previous, next).map((m) => m.screen.key);

  it('follows a preliminary result with a rank screen when the top of the table moved', () => {
    const previous = before(row(1, 'Alpha'), row(2, 'Beta'));
    const next = after([row(1, 'Beta', 4, 2, 90), row(2, 'Alpha', 3, 1, 50)]);
    expect(kinds(previous, next)).toEqual(['result', 'rank']);
  });

  it('does not follow a knockout result with a rank screen, whatever the standings did', () => {
    const previous = before(row(1, 'Alpha'), row(2, 'Beta'));
    const next = after(
      [row(1, 'Beta', 4, 2, 90), row(2, 'Alpha', 3, 1, 50)],
      result({ round: 'quarterfinal', roundLabel: 'Quarterfinal' }),
    );
    expect(kinds(previous, next)).toEqual(['result']);
  });

  it('has no rank screen when nothing at the top moved', () => {
    const previous = before(row(1, 'Alpha', 3, 3, 100), row(2, 'Beta', 3, 2, 80));
    const next = after([row(1, 'Alpha', 4, 4, 140), row(2, 'Beta', 3, 2, 80)]);
    expect(kinds(previous, next)).toEqual(['result']);
  });

  it('gives the rank screen only to the newest of several new results (the table only shows the end state)', () => {
    const previous = before(row(1, 'Alpha'), row(2, 'Beta'));
    const next = {
      phase: 'preliminary',
      standings: [row(1, 'Beta', 4, 2, 90), row(2, 'Alpha', 3, 1, 50)],
      recentResults: [
        result({ matchId: 'b', confirmedAt: '2026-10-09T10:20:00.000Z' }),
        result({ matchId: 'a', confirmedAt: '2026-10-09T10:10:00.000Z' }),
      ],
    };
    const moments = detectBtcMoments(previous, next);
    expect(moments.map((m) => m.screen.key)).toEqual(['result', 'result', 'rank']);
    // the table moved on both results, so the screen is not pinned on one match
    expect(moments[2].payload.moment.afterMatch).toBe('2 new results');
  });

  it('treats a previous snapshot with no standings as an empty table: the first result puts its teams on it', () => {
    const missing = { phase: 'preliminary', recentResults: [] };
    const empty = { phase: 'preliminary', standings: [], recentResults: [] };
    const next = after([row(1, 'Alpha', 1, 1, 35), row(2, 'Beta', 1, 0, 15)]);
    expect(kinds(missing, next)).toEqual(['result', 'rank']);
    expect(kinds(missing, next)).toEqual(kinds(empty, next));
  });
});

describe('headlines (the rank screen)', () => {
  const headline = (previousRows, nextRows) => {
    const previous = { phase: 'preliminary', standings: previousRows, recentResults: [] };
    const next = { phase: 'preliminary', standings: nextRows, recentResults: [result()] };
    const rank = detectBtcMoments(previous, next).find((m) => m.screen.key === 'rank');
    return rank ? rank.payload.moment.headline : null;
  };

  it('leads with a new sole leader', () => {
    expect(
      headline([row(1, 'Alpha'), row(2, 'Beta')], [row(1, 'Beta', 4, 3, 99), row(2, 'Alpha')]),
    ).toBe('Beta take the lead');
  });

  it('names co-leaders, falling back to a count when the names would not fit one line', () => {
    expect(
      headline(
        [row(1, 'Alpha'), row(2, 'Beta')],
        [row(1, 'Alpha', 4, 2, 60), row(1, 'Beta', 4, 2, 60)],
      ),
    ).toBe('Alpha and Beta share the lead');
    const long = 'L'.repeat(40);
    expect(
      headline(
        [row(1, 'Alpha'), row(2, long)],
        [row(1, 'Alpha', 4, 2, 60), row(1, long, 4, 2, 60)],
      ),
    ).toBe('2 teams share the lead');
    expect(
      headline(
        [row(1, 'A'), row(2, 'B'), row(3, 'C')],
        [row(1, 'A', 4, 2, 60), row(1, 'B', 4, 2, 60), row(1, 'C', 4, 2, 60)],
      ),
    ).toBe('3 teams share the lead');
  });

  it('the first result of the event puts its winner in front', () => {
    expect(
      headline(
        [row(1, 'A', 0, 0, 0), row(1, 'B', 0, 0, 0)],
        [row(1, 'A', 1, 1, 30), row(2, 'B', 1, 0, 10)],
      ),
    ).toBe('A take the lead');
  });

  it('never calls teams that have not played "leaders", even when the table puts them first', () => {
    const named = headline(
      [row(1, 'A', 1, 1, 30), row(2, 'B', 0, 0, 0)],
      [row(1, 'A', 0, 0, 0), row(1, 'B', 0, 0, 0)],
    );
    expect(named ?? '').not.toMatch(/lead/);
  });

  it('with the lead unchanged, names the biggest climber', () => {
    expect(
      headline(
        [row(1, 'Alpha', 5, 5, 200), row(2, 'Beta'), row(3, 'Gamma'), row(4, 'Delta')],
        [row(1, 'Alpha', 6, 6, 240), row(2, 'Delta', 4, 2, 80), row(3, 'Beta'), row(4, 'Gamma')],
      ),
    ).toBe('Delta climb to 2nd');
  });

  it('with the lead unchanged and nobody climbing, names a team joining the table', () => {
    expect(
      headline(
        [row(1, 'Alpha', 5, 5, 200), row(2, 'Beta', 5, 3, 120), row(3, 'Gamma', 0, 0, 0)],
        [row(1, 'Alpha', 6, 6, 240), row(2, 'Beta', 5, 3, 120), row(3, 'Gamma', 1, 0, 15)],
      ),
    ).toBe('Gamma join the table in 3rd');
  });
});

describe('result screen', () => {
  const mountResult = (res) => {
    vi.useFakeTimers();
    const previous = withResults(preliminaryPayload());
    const next = withResults(preliminaryPayload(), res);
    const moment = detectBtcMoments(previous, next).find((m) => m.screen.key === 'result');
    return play(moment);
  };

  it('holds for as long as the room needs to read it', () => {
    const moments = detectBtcMoments(
      withResults(preliminaryPayload()),
      withResults(preliminaryPayload(), result()),
    );
    expect(moments[0].screen.minDwellMs).toBe(RESULT_HOLD_MS);
    expect(RESULT_HOLD_MS).toBeGreaterThanOrEqual(6_000);
  });

  it('shows a preliminary result: who won, both totals, and what each total is made of', () => {
    const { host, handle } = mountResult(result());
    expect(text(host, '.stage-kicker')).toBe('Result recorded · Preliminary');
    expect(all(host, '.btc-stage-side-label')).toEqual(['Winner', 'Lost']);
    expect(all(host, '.btc-stage-side-name')).toEqual(['Alpha', 'Beta']);
    expect(all(host, '.btc-stage-points')).toEqual(['35', '15']);
    expect(all(host, '.btc-stage-side:first-child .btc-stage-chip')).toEqual([
      '30 tokens',
      '+5 won the match',
    ]);
    expect(all(host, '.btc-stage-side:last-child .btc-stage-chip')).toEqual(['15 tokens']);
    expect(text(host, '.stage-footer-start')).toBe('Alpha win');
    expect(host.querySelector('.btc-stage-note')).toBeNull();
    handle.destroy();
  });

  it('names each bonus that was earned', () => {
    const { host, handle } = mountResult(
      result({
        round: 'quarterfinal',
        roundLabel: 'Quarterfinal',
        teams: [
          {
            name: 'Alpha',
            tokens: 30,
            total: 39,
            bonuses: { win: true, fastest: true, signature: true },
            winner: true,
          },
          {
            name: 'Beta',
            tokens: 15,
            total: 15,
            bonuses: { win: false, fastest: false, signature: false },
            winner: false,
          },
        ],
      }),
    );
    expect(all(host, '.btc-stage-side:first-child .btc-stage-chip')).toEqual([
      '30 tokens',
      '+5 won the match',
      '+2 fastest',
      '+2 signature beverage',
    ]);
    handle.destroy();
  });

  it('puts no breakdown on a result whose bonuses do not add up (bonuses are null)', () => {
    const { host, handle } = mountResult(
      result({
        teams: [
          { name: 'Alpha', tokens: 30, total: 99, bonuses: null, winner: true },
          { name: 'Beta', tokens: 15, total: 15, bonuses: null, winner: false },
        ],
      }),
    );
    expect(all(host, '.btc-stage-side:first-child .btc-stage-chip')).toEqual(['30 tokens']);
    handle.destroy();
  });

  it.each([
    ['quarterfinal', ['Goes through', 'Out'], 'Alpha go through'],
    ['semifinal', ['Goes through', 'Plays for third place'], 'Alpha go through'],
    ['final', ['Champion', 'Runner-up'], 'Alpha are the champions'],
    ['third_place', ['Third place', 'Fourth place'], 'Alpha take third place'],
  ])('a %s result is worded for what it decided', (round, labels, footer) => {
    const { host, handle } = mountResult(result({ round, roundLabel: round }));
    expect(all(host, '.btc-stage-side-label')).toEqual(labels);
    expect(text(host, '.stage-footer-start')).toBe(footer);
    handle.destroy();
  });

  it('shows the organiser’s tie-break on the winner, with the typed reason as text', () => {
    const level = [
      { name: 'Alpha', tokens: 20, total: 20, bonuses: null, winner: true },
      { name: 'Beta', tokens: 20, total: 20, bonuses: null, winner: false },
    ];
    const { host, handle } = mountResult(
      result({
        round: 'quarterfinal',
        roundLabel: 'Quarterfinal',
        level: true,
        tiebreak: { reason: '<b>Sudden-death</b> cup' },
        teams: level,
      }),
    );
    const chips = [...host.querySelectorAll('.btc-stage-chip')];
    const tie = chips.filter((c) => c.getAttribute('data-kind') === 'tiebreak');
    expect(tie).toHaveLength(1);
    expect(tie[0].textContent).toBe('Tie-break: <b>Sudden-death</b> cup');
    expect(tie[0].closest('.btc-stage-side').getAttribute('data-winner')).toBe('true');
    expect(host.querySelector('b')).toBeNull();
    expect(text(host, '.stage-kicker')).toBe('Result recorded · Quarterfinal');
    handle.destroy();
  });

  it('a level knockout the organiser has not decided yet says so, and picks no winner', () => {
    const { host, handle } = mountResult(
      result({
        round: 'quarterfinal',
        roundLabel: 'Quarterfinal',
        level: true,
        tiebreak: null,
        teams: [
          { name: 'Alpha', tokens: 20, total: 20, bonuses: null, winner: false },
          { name: 'Beta', tokens: 20, total: 20, bonuses: null, winner: false },
        ],
      }),
    );
    expect(text(host, '.stage-kicker')).toBe('Result recorded · Quarterfinal · level on points');
    expect(all(host, '.btc-stage-side-label')).toEqual(['Level', 'Level']);
    expect(host.querySelectorAll('[data-winner]')).toHaveLength(0);
    expect(text(host, '.btc-stage-note')).toBe('The organiser decides who goes through.');
    expect(text(host, '.stage-footer-start')).toMatch(/waiting for the organiser/);
    handle.destroy();
  });

  it('draws the countdown ring for the hold, and destroy() stops it', () => {
    const { host, handle } = mountResult(result());
    expect(host.querySelector('.stage-footer-end .stage-ring')).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows team names as text, never markup', () => {
    const { host, handle } = mountResult(
      result({
        teams: [
          {
            name: '<img src=x onerror=alert(1)>',
            tokens: 30,
            total: 35,
            bonuses: null,
            winner: true,
          },
          { name: 'Beta', tokens: 15, total: 15, bonuses: null, winner: false },
        ],
      }),
    );
    expect(host.querySelector('img')).toBeNull();
    handle.destroy();
  });
});

describe('rank-impact screen', () => {
  function mountRank(previousRows, nextRows) {
    vi.useFakeTimers();
    const previous = { phase: 'preliminary', standings: previousRows, recentResults: [] };
    const next = { phase: 'preliminary', standings: nextRows, recentResults: [result()] };
    const moment = detectBtcMoments(previous, next).find((m) => m.screen.key === 'rank');
    return { moment, ...play(moment) };
  }

  it('holds for as long as the room needs to read it', () => {
    const { moment, handle } = mountRank(
      [row(1, 'Alpha'), row(2, 'Beta')],
      [row(1, 'Beta', 4, 3, 99), row(2, 'Alpha')],
    );
    expect(moment.screen.minDwellMs).toBe(RANK_HOLD_MS);
    handle.destroy();
  });

  it('says what the result did, then lists the top of the table with each team’s movement in words', () => {
    const { host, handle } = mountRank(
      [row(1, 'Alpha'), row(2, 'Beta'), row(3, 'Gamma')],
      [row(1, 'Beta', 4, 3, 99), row(2, 'Alpha'), row(3, 'Gamma')],
    );
    expect(text(host, '.stage-kicker')).toBe('Rank impact · Alpha vs Beta');
    const title = host.querySelector('.stage-title');
    expect(title.textContent).toBe('Beta take the lead');
    expect(title.classList.contains('stage-move-title')).toBe(true);
    const rows = [...host.querySelectorAll('.stage-move')];
    expect(rows.map((r) => r.querySelector('.stage-move-name-text').textContent)).toEqual([
      'Beta',
      'Alpha',
      'Gamma',
    ]);
    expect(rows.map((r) => r.querySelector('.stage-move-change').textContent)).toEqual([
      'Up 1',
      'Down 1',
      'Holds',
    ]);
    expect(host.textContent).toContain('Beta');
    expect(text(host, '.stage-footer-start')).toBe('Standings after Alpha vs Beta');
    handle.destroy();
  });

  it('shows the top five places at most, and says how many more there are', () => {
    const rowsBefore = Array.from({ length: 8 }, (_, i) => row(i + 1, `T${i + 1}`));
    const rowsAfter = [row(1, 'T2'), row(2, 'T1'), ...rowsBefore.slice(2)];
    const { host, handle } = mountRank(rowsBefore, rowsAfter);
    expect(host.querySelectorAll('.stage-move').length).toBeLessThanOrEqual(5);
    handle.destroy();
  });

  it('draws the countdown ring and stops it on destroy()', () => {
    const { host, handle } = mountRank(
      [row(1, 'Alpha'), row(2, 'Beta')],
      [row(1, 'Beta', 4, 3, 99), row(2, 'Alpha')],
    );
    expect(host.querySelector('.stage-footer-end .stage-ring')).not.toBeNull();
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('with the real assembler (the shapes production publishes)', () => {
  it('a preliminary match confirmed between two snapshots is announced, with its real facts', () => {
    const previous = preliminaryPayload({ playedCount: 12 });
    const next = preliminaryPayload({ playedCount: 13 });
    const moments = detectBtcMoments(previous, next);
    expect(moments[0].screen.key).toBe('result');
    const res = moments[0].payload.moment.result;
    expect(res.round).toBe('preliminary');
    expect(res.teams).toHaveLength(2);
    const { host, handle } = (() => {
      vi.useFakeTimers();
      return play(moments[0]);
    })();
    expect(text(host, '.stage-kicker')).toBe('Result recorded · Preliminary');
    expect(host.querySelectorAll('.btc-stage-side')).toHaveLength(2);
    handle.destroy();
  });

  it('a knockout result with a tie-break the organiser then records is announced a second time, with the tie-break', () => {
    const level = knockoutPayload({ results: { qf3: { tokensA: 30 } } });
    const decided = knockoutPayload({
      results: { qf3: { tokensA: 30, tiebreak: { winner: 5, reason: 'Sudden-death cup' } } },
    });
    const moments = detectBtcMoments(level, decided);
    const again = moments.find((m) => m.payload.moment.result?.matchId === 'qf3');
    expect(again).toBeDefined();
    expect(again.payload.moment.result.tiebreak.reason).toBe('Sudden-death cup');
    expect(moments.map((m) => m.screen.key)).not.toContain('rank');
  });

  it('opening the display on a payload that already has results announces nothing', () => {
    expect(detectBtcMoments(null, preliminaryPayload({ playedCount: 20 }))).toEqual([]);
  });
});

describe('detectBtcMoments: which result the rank screen follows', () => {
  const fixtureRows = (leader) => [
    row(1, leader, 4, 3, 99),
    row(2, leader === 'Beta' ? 'Alpha' : 'Beta'),
    row(3, 'Gamma'),
  ];
  const prelim = (matchId, at, a, b) =>
    result({
      matchId,
      confirmedAt: at,
      teams: [
        { name: a, tokens: 30, total: 35, bonuses: null, winner: true },
        { name: b, tokens: 15, total: 15, bonuses: null, winner: false },
      ],
    });

  it('names a single new result by its own teams, and gives no rank screen when the newest is a knockout result', () => {
    const previous = { phase: 'preliminary', standings: fixtureRows('Alpha'), recentResults: [] };
    const older = prelim('a', '2026-10-09T10:10:00.000Z', 'Beta', 'Gamma');
    const newest = prelim('b', '2026-10-09T10:20:00.000Z', 'Delta', 'Epsilon');
    const one = detectBtcMoments(previous, {
      phase: 'preliminary',
      standings: fixtureRows('Beta'),
      recentResults: [newest],
    });
    expect(one.find((m) => m.screen.key === 'rank').payload.moment.afterMatch).toBe(
      'Delta vs Epsilon',
    );
    const knockoutNewest = { ...newest, round: 'quarterfinal', roundLabel: 'Quarter-final' };
    const mixed = detectBtcMoments(previous, {
      phase: 'preliminary',
      standings: fixtureRows('Beta'),
      recentResults: [knockoutNewest, older],
    });
    expect(mixed.map((m) => m.screen.key)).toEqual(['result', 'result']);
  });

  it('says how many results arrived together when the table moved on several (it is not pinned on one)', () => {
    const previous = { phase: 'preliminary', standings: fixtureRows('Alpha'), recentResults: [] };
    const next = {
      phase: 'preliminary',
      standings: fixtureRows('Beta'),
      recentResults: [
        prelim('c', '2026-10-09T10:30:00.000Z', 'Gamma', 'Delta'),
        prelim('b', '2026-10-09T10:20:00.000Z', 'Beta', 'Gamma'),
        prelim('a', '2026-10-09T10:10:00.000Z', 'Alpha', 'Beta'),
      ],
    };
    const rank = detectBtcMoments(previous, next).find((m) => m.screen.key === 'rank');
    expect(rank.payload.moment.afterMatch).toBe('3 new results');
    vi.useFakeTimers();
    const { host, handle } = play(rank);
    expect(text(host, '.stage-kicker')).toBe('Rank impact · 3 new results');
    expect(text(host, '.stage-footer-start')).toBe('Standings after 3 new results');
    handle.destroy();
  });
});

describe('headlines: precedence and ordering', () => {
  const headline = (previousRows, nextRows) => {
    const previous = { phase: 'preliminary', standings: previousRows, recentResults: [] };
    const next = { phase: 'preliminary', standings: nextRows, recentResults: [result()] };
    const rank = detectBtcMoments(previous, next).find((m) => m.screen.key === 'rank');
    return rank ? rank.payload.moment.headline : null;
  };
  const table = (...names) => names.map((name, i) => row(i + 1, name, 4, 4 - i, 100 - i * 10));

  it('names the biggest climb, not the first climber in the table', () => {
    expect(
      headline(table('A', 'B', 'C', 'D', 'E'), [
        row(1, 'A', 5, 5, 140),
        row(2, 'B', 5, 4, 120),
        row(3, 'E', 5, 3, 105),
        row(4, 'C', 5, 2, 80),
        row(5, 'D', 5, 1, 60),
      ]),
    ).toBe('E climb to 3rd');
  });

  it('with equal climbs, names the team in the higher place', () => {
    expect(
      headline(table('A', 'B', 'C', 'D', 'E'), [
        row(1, 'A', 5, 5, 140),
        row(2, 'C', 5, 4, 120),
        row(3, 'B', 5, 3, 105),
        row(4, 'E', 5, 2, 80),
        row(5, 'D', 5, 1, 60),
      ]),
    ).toBe('C climb to 2nd');
  });

  it('prefers a climb to a newcomer when both happened', () => {
    expect(
      headline(
        [
          row(1, 'A', 5, 5, 200),
          row(2, 'B', 5, 3, 120),
          row(3, 'C', 5, 2, 90),
          row(4, 'N', 0, 0, 0),
        ],
        [
          row(1, 'A', 6, 6, 240),
          row(2, 'C', 6, 3, 130),
          row(3, 'B', 5, 3, 120),
          row(4, 'N', 1, 0, 15),
        ],
      ),
    ).toBe('C climb to 2nd');
  });

  it('says a climb into a shared place is joint', () => {
    expect(
      headline(
        [row(1, 'A', 5, 5, 200), row(2, 'B', 5, 3, 120), row(3, 'C', 5, 2, 90)],
        [row(1, 'A', 6, 6, 240), row(2, 'C', 6, 3, 120), row(2, 'B', 5, 3, 120)],
      ),
    ).toBe('C climb to joint 2nd');
  });

  it('co-leaders who were already co-leaders are not news: the climb is named instead', () => {
    expect(
      headline(
        [
          row(1, 'A', 5, 4, 150),
          row(1, 'B', 5, 4, 150),
          row(3, 'C', 5, 2, 90),
          row(4, 'D', 5, 1, 60),
        ],
        [
          row(1, 'A', 6, 5, 190),
          row(1, 'B', 6, 5, 190),
          row(3, 'D', 6, 2, 100),
          row(4, 'C', 5, 2, 90),
        ],
      ),
    ).toBe('D climb to 3rd');
  });

  it('a co-leader line is as long as 40 characters allows: 40 is named, 41 is counted', () => {
    const shared = (a, b) =>
      headline([row(1, 'X'), row(2, 'Y')], [row(1, a, 4, 2, 60), row(1, b, 4, 2, 60)]);
    expect(shared('A'.repeat(20), 'B'.repeat(20))).toBe(
      `${'A'.repeat(20)} and ${'B'.repeat(20)} share the lead`,
    );
    expect(shared('A'.repeat(20), 'B'.repeat(21))).toBe('2 teams share the lead');
  });

  it('has no rank screen when the lead is unchanged, nobody climbed and nobody joined', () => {
    expect(
      headline(
        [row(1, 'A', 5, 5, 200), row(1, 'B', 5, 5, 200)],
        [row(1, 'A', 6, 6, 240), row(1, 'B', 6, 6, 240)],
      ),
    ).toBeNull();
  });

  it('a team that has not played is never called a leader, even when the table puts it first', () => {
    expect(
      headline(
        [row(1, 'A', 1, 1, 30), row(2, 'B', 0, 0, 0)],
        [row(1, 'A', 0, 0, 0), row(1, 'B', 0, 0, 0)],
      ),
    ).toBeNull();
  });
});

describe('rank screen: how much of the table is shown', () => {
  it('shows the top five places, with the movement in the rows', () => {
    vi.useFakeTimers();
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const before = names.map((name, i) => row(i + 1, name, 5, 8 - i, 200 - i * 10));
    const after = [...names].reverse().map((name, i) => row(i + 1, name, 6, 8 - i, 240 - i * 10));
    const moment = detectBtcMoments(
      { phase: 'preliminary', standings: before, recentResults: [] },
      { phase: 'preliminary', standings: after, recentResults: [result()] },
    ).find((m) => m.screen.key === 'rank');
    const { host, handle } = play(moment);
    expect(all(host, '.stage-move .stage-move-name-text')).toEqual(['H', 'G', 'F', 'E', 'D']);
    expect(host.querySelector('.stage-move-more')).toBeNull();
    handle.destroy();
  });

  it('keeps a tie at the fifth place together, up to eight rows, and counts the rest', () => {
    vi.useFakeTimers();
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const before = names.map((name, i) => row(i + 1, name, 5, 10 - i, 200 - i * 10));
    const after = [
      row(1, 'B', 6, 9, 240),
      row(2, 'A', 6, 8, 230),
      row(3, 'C', 6, 7, 220),
      row(4, 'D', 6, 6, 210),
      ...['E', 'F', 'G', 'H', 'I', 'J'].map((name) => row(5, name, 6, 1, 100)),
    ];
    const moment = detectBtcMoments(
      { phase: 'preliminary', standings: before, recentResults: [] },
      { phase: 'preliminary', standings: after, recentResults: [result()] },
    ).find((m) => m.screen.key === 'rank');
    const { host, handle } = play(moment);
    expect(host.querySelectorAll('.stage-move')).toHaveLength(8);
    expect(text(host, '.stage-move-more')).toBe('+2 more');
    handle.destroy();
  });
});

describe('result screen: wording for what a result decided', () => {
  const mountResult = (res) => {
    vi.useFakeTimers();
    const previous = withResults(preliminaryPayload());
    const next = withResults(preliminaryPayload(), res);
    return play(detectBtcMoments(previous, next).find((m) => m.screen.key === 'result'));
  };
  const level = (round, roundLabel) =>
    result({
      round,
      roundLabel,
      level: true,
      teams: [
        { name: 'Alpha', tokens: 20, total: 20, bonuses: null, winner: false },
        { name: 'Beta', tokens: 20, total: 20, bonuses: null, winner: false },
      ],
    });

  it.each([
    ['quarterfinal', 'Quarter-final', 'The organiser decides who goes through.'],
    ['semifinal', 'Semi-final', 'The organiser decides who goes through.'],
    ['final', 'Final', 'The organiser decides who takes the title.'],
    ['third_place', 'Third place', 'The organiser decides who takes third place.'],
  ])('a level %s says what the organiser is deciding', (round, label, note) => {
    const { host, handle } = mountResult(level(round, label));
    expect(text(host, '.btc-stage-note')).toBe(note);
    expect(text(host, '.stage-footer-start')).toBe(
      'Level on points: waiting for the organiser’s decision',
    );
    handle.destroy();
  });

  it('a level preliminary match has nobody to decide it, and says only that it is level', () => {
    const { host, handle } = mountResult(level('preliminary', 'Preliminary'));
    expect(host.querySelector('.btc-stage-note')).toBeNull();
    expect(text(host, '.stage-footer-start')).toBe('Level on points');
    expect(text(host, '.stage-kicker')).toBe('Result recorded · Preliminary · level on points');
    handle.destroy();
  });

  it('writes "1 token", not "1 tokens"', () => {
    const { host, handle } = mountResult(
      result({
        teams: [
          { name: 'Alpha', tokens: 44, total: 49, bonuses: null, winner: true },
          { name: 'Beta', tokens: 1, total: 1, bonuses: null, winner: false },
        ],
      }),
    );
    expect(all(host, '.btc-stage-side:last-child .btc-stage-chip')).toEqual(['1 token']);
    handle.destroy();
  });
});

describe('with the real assembler: what a result is made of', () => {
  it('shows the breakdown chips of a result the assembler produced', () => {
    vi.useFakeTimers();
    const previous = preliminaryPayload({ playedCount: 12 });
    const next = preliminaryPayload({ playedCount: 13 });
    const moment = detectBtcMoments(previous, next).find((m) => m.screen.key === 'result');
    const { host, handle } = play(moment);
    const chips = all(host, '.btc-stage-chip');
    expect(chips).toContain('+5 won the match');
    expect(chips.some((chip) => /^\d+ tokens?$/.test(chip))).toBe(true);
    handle.destroy();
  });
});
