import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  btcBand,
  selectBtcScreen,
  hasBtcProjectorContent,
  matchLine,
  renderSide,
  renderVs,
  STANDINGS_PAGE_SIZE,
  PAGE_DWELL_MS,
  KNOCKOUT_PLACES,
} from './projectorScreens.js';
import { preliminaryPayload, knockoutPayload } from './demoLivePayload.js';

afterEach(() => {
  vi.useRealTimers();
});

const text = (host, selector) => host.querySelector(selector)?.textContent ?? null;
const all = (host, selector) => [...host.querySelectorAll(selector)].map((n) => n.textContent);

function mountFor(payload) {
  const screen = selectBtcScreen(payload);
  const host = document.createElement('div');
  const handle = screen.mount(host, payload);
  return { screen, host, handle };
}

// A full knockout, every match decided by tokens (the first seat wins each), so there is a champion.
const FULL_RESULTS = {
  qf1: { tokensA: 40 },
  qf2: { tokensA: 40 },
  qf3: { tokensA: 40 },
  qf4: { tokensA: 40 },
  sf1: { tokensA: 35 },
  sf2: { tokensA: 35 },
  final: { tokensA: 33, fastest: undefined },
  third: { tokensA: 33 },
};

describe('btcBand', () => {
  it('names the event and the phase of the competition, and is always live', () => {
    expect(btcBand({ eventName: 'BTC 2026', phase: 'preliminary' })).toEqual({
      eventName: 'BTC 2026',
      sectionLabel: 'Preliminary round',
      live: true,
    });
    expect(btcBand({ phase: 'knockout' }).sectionLabel).toBe('Knockout');
    expect(btcBand({ phase: 'complete' }).sectionLabel).toBe('Final result');
  });

  it('has no section for setup or an unknown phase, and no event name when the payload has none', () => {
    expect(btcBand({ phase: 'setup' }).sectionLabel).toBeNull();
    expect(btcBand({ phase: 'nonsense' }).sectionLabel).toBeNull();
    expect(btcBand({ phase: 'preliminary' }).eventName).toBeNull();
    expect(btcBand(null)).toEqual({ eventName: null, sectionLabel: null, live: true });
  });
});

describe('selectBtcScreen and hasBtcProjectorContent', () => {
  it('shows nothing for no payload, and nothing before there is a match (setup)', () => {
    expect(selectBtcScreen(null)).toBeNull();
    expect(selectBtcScreen(undefined)).toBeNull();
    const setup = {
      phase: 'setup',
      standings: [{ position: 1, teamName: 'A', played: 0, wins: 0, points: 0 }],
    };
    expect(selectBtcScreen(setup)).toBeNull();
    expect(hasBtcProjectorContent(setup)).toBe(false);
  });

  it('shows the idle loop once there are matches, a bracket or standings', () => {
    expect(selectBtcScreen(preliminaryPayload({ playedCount: 0 })).key).toBe('idle');
    expect(selectBtcScreen(preliminaryPayload({ playedCount: 12 })).key).toBe('idle');
    expect(selectBtcScreen(knockoutPayload()).key).toBe('idle');
    expect(selectBtcScreen({ phase: 'preliminary', upNext: { teams: [] } }).key).toBe('idle');
    expect(selectBtcScreen({ phase: 'knockout', bracket: { rounds: [] } }).key).toBe('idle');
    expect(selectBtcScreen({ phase: 'preliminary', standings: [] })).toBeNull();
  });

  it('shows the champion once the final is decided, whatever else the payload carries', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    expect(selectBtcScreen(payload).key).toBe('champion');
    expect(
      selectBtcScreen({ ...payload, upNext: payload.upNext ?? preliminaryPayload().upNext }).key,
    ).toBe('champion');
  });

  it('does not show a champion while the final is undecided, or tied with nobody chosen', () => {
    expect(selectBtcScreen(knockoutPayload({ results: { qf1: { tokensA: 40 } } })).key).toBe(
      'idle',
    );
    const tied = knockoutPayload({
      results: { ...FULL_RESULTS, final: { tokensA: 30 } }, // level on tokens and no bonus: level on points
    });
    expect(tied.podium.places[0].state).toBe('tied');
    expect(selectBtcScreen(tied).key).toBe('idle');
  });

  it('the champion holds the screen and neither screen is urgent (BTC has no running clock to pre-empt for)', () => {
    const champion = selectBtcScreen(knockoutPayload({ results: FULL_RESULTS }));
    const idle = selectBtcScreen(preliminaryPayload());
    expect(champion.minDwellMs).toBe(60_000);
    expect(champion.urgent).toBe(false);
    expect(idle.urgent).toBe(false);
    expect(idle.minDwellMs).toBe(0);
  });

  it('hasBtcProjectorContent is exactly "there is a screen", so the shell and the display never disagree', () => {
    for (const payload of [
      null,
      {},
      { phase: 'setup' },
      preliminaryPayload(),
      knockoutPayload(),
      knockoutPayload({ results: FULL_RESULTS }),
    ]) {
      expect(hasBtcProjectorContent(payload)).toBe(selectBtcScreen(payload) !== null);
    }
  });
});

describe('small shared pieces', () => {
  it('matchLine names both teams', () => {
    expect(matchLine({ teams: [{ name: 'A' }, { name: 'B' }] })).toBe('A vs B');
  });

  it('renderSide: a label, the name, optional points and chips; a winner flag only when there is one', () => {
    const side = renderSide({
      label: 'Goes through',
      name: 'Bean Scene',
      winner: true,
      points: 48,
      chips: [{ text: '41 tokens' }, { text: 'Tie-break: coin', kind: 'tiebreak' }],
    });
    expect(side.getAttribute('data-winner')).toBe('true');
    expect(text(side, '.btc-stage-side-label')).toBe('Goes through');
    expect(text(side, '.btc-stage-side-name')).toBe('Bean Scene');
    expect(text(side, '.btc-stage-points')).toBe('48');
    expect(all(side, '.btc-stage-chip')).toEqual(['41 tokens', 'Tie-break: coin']);
    expect(side.querySelectorAll('.btc-stage-chip')[1].getAttribute('data-kind')).toBe('tiebreak');
    expect(renderSide({ name: 'X', winner: false }).getAttribute('data-winner')).toBe('false');
    const plain = renderSide({ name: 'X' });
    expect(plain.hasAttribute('data-winner')).toBe(false);
    expect(
      plain.querySelector('.btc-stage-side-label, .btc-stage-points, .btc-stage-chips'),
    ).toBeNull();
  });

  it('renderSide shows every string as text, never markup', () => {
    const side = renderSide({ label: '<b>l</b>', name: '<i>n</i>', chips: [{ text: '<u>c</u>' }] });
    expect(side.querySelector('b, i, u')).toBeNull();
    expect(side.textContent).toContain('<i>n</i>');
  });

  it('renderVs puts the two sides either side of a "VS" mark that is hidden from assistive technology', () => {
    const vs = renderVs(renderSide({ name: 'A' }), renderSide({ name: 'B' }));
    expect([...vs.children].map((c) => c.className)).toEqual([
      'btc-stage-side',
      'btc-stage-vs-mark',
      'btc-stage-side',
    ]);
    expect(vs.querySelector('.btc-stage-vs-mark').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('idle loop: the pages', () => {
  it('opens on the up-next page: the round, both teams, and who judges', () => {
    vi.useFakeTimers();
    const payload = preliminaryPayload({ playedCount: 12 });
    const { host, handle } = mountFor(payload);
    expect(text(host, '.stage-kicker')).toBe('Up next · Preliminary');
    expect(text(host, '.stage-title')).toBe('Preliminary');
    expect(all(host, '.btc-stage-side-name')).toEqual(['Pour Decisions', 'Steam Team']);
    // in the preliminary round a place is only "so far", so no seed is claimed
    expect(host.querySelector('.btc-stage-side-label')).toBeNull();
    expect(text(host, '.btc-stage-judges')).toBe('Judges: Judge 1 · Judge 2 · Judge 3');
    handle.destroy();
  });

  it('calls a knockout match by where each team stands in the table (not a seed: tied teams share a place)', () => {
    vi.useFakeTimers();
    const payload = knockoutPayload();
    const [a, b] = payload.upNext.teams;
    const { host, handle } = mountFor(payload);
    expect(text(host, '.stage-kicker')).toBe(`Up next · ${payload.upNext.roundLabel}`);
    expect([a.place, b.place]).toEqual([1, 8]);
    expect(text(host, '.stage-title')).toBe('1st meets 8th');
    expect(all(host, '.btc-stage-side-label')).toEqual(['1st in the table', '8th in the table']);
    expect(host.textContent).not.toMatch(/seed/i);
    handle.destroy();
  });

  it('falls back to the round name when a knockout team has no known place, and leaves out an empty judges line', () => {
    vi.useFakeTimers();
    const payload = {
      phase: 'knockout',
      upNext: {
        matchId: 'm',
        round: 'final',
        roundLabel: 'Final',
        teams: [
          { name: 'A', place: null },
          { name: 'B', place: 2 },
        ],
        judges: [],
      },
    };
    const { host, handle } = mountFor(payload);
    expect(text(host, '.stage-title')).toBe('Final');
    expect(host.querySelector('.btc-stage-judges')).toBeNull();
    expect(all(host, '.btc-stage-side-label')).toEqual(['2nd in the table']);
    handle.destroy();
  });

  it('then pages the standings, with the ranking words in the row, and loops back to the start', () => {
    vi.useFakeTimers();
    const payload = preliminaryPayload({ playedCount: 12 });
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-title')).toBe('Standings');
    expect(text(host, '.stage-kicker')).toBe('12 of 28 matches played');
    expect(text(host, '.stage-range')).toBe('8 teams');
    const rows = [...host.querySelectorAll('.stage-standing-row')];
    expect(rows).toHaveLength(8);
    const first = rows[0];
    expect(text(first, '.stage-standing-pos')).toBe('1');
    expect(text(first, '.stage-name-text')).toBe('Bean Scene');
    expect(all(first, '.stage-standing-cell')).toEqual(['7 wins', '259 pts']);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-title')).toBe('Preliminary'); // back to up next
    handle.destroy();
  });

  it('says "1 win", not "1 wins"', () => {
    vi.useFakeTimers();
    const payload = {
      phase: 'preliminary',
      standings: [
        { position: 1, teamName: 'A', played: 2, wins: 1, points: 20 },
        { position: 2, teamName: 'B', played: 2, wins: 0, points: 10 },
      ],
    };
    const { host, handle } = mountFor(payload);
    expect(all(host, '.stage-standing-cell')).toEqual(['1 win', '20 pts', '0 wins', '10 pts']);
    handle.destroy();
  });

  it('writes a tie in the row only for teams that have played (a field with no results is not news)', () => {
    vi.useFakeTimers();
    const payload = {
      phase: 'preliminary',
      standings: [
        { position: 1, teamName: 'A', played: 3, wins: 3, points: 90 },
        { position: 2, teamName: 'B', played: 3, wins: 1, points: 40 },
        { position: 2, teamName: 'C', played: 3, wins: 1, points: 40 },
        { position: 4, teamName: 'D', played: 0, wins: 0, points: 0 },
        { position: 4, teamName: 'E', played: 0, wins: 0, points: 0 },
      ],
    };
    const { host, handle } = mountFor(payload);
    const suffixes = [...host.querySelectorAll('.stage-standing-row')].map(
      (row) => row.querySelector('.stage-name-suffix')?.textContent ?? null,
    );
    expect(suffixes).toEqual([null, ' (tied)', ' (tied)', null, null]);
    handle.destroy();
  });

  it('pages a long standings table at eight rows a page, keeping a tie together, and says where each page sits', () => {
    vi.useFakeTimers();
    const standings = Array.from({ length: 17 }, (_, i) => ({
      position: i + 1,
      teamName: `Team ${i + 1}`,
      played: 5,
      wins: 17 - i,
      points: 200 - i,
    }));
    const { host, handle } = mountFor({ phase: 'preliminary', standings });
    const ranges = [];
    const counts = [];
    for (let page = 0; page < 3; page += 1) {
      ranges.push(text(host, '.stage-range'));
      counts.push(host.querySelectorAll('.stage-standing-row').length);
      vi.advanceTimersByTime(PAGE_DWELL_MS);
    }
    expect(STANDINGS_PAGE_SIZE).toBe(8);
    expect(ranges).toEqual(['1 to 8 of 17', '9 to 16 of 17', '17 of 17']);
    expect(counts).toEqual([8, 8, 1]);
    handle.destroy();
  });

  it('in the knockout the order is up next, the bracket, then the preliminary standings (no progress kicker)', () => {
    vi.useFakeTimers();
    const payload = knockoutPayload({ results: { qf1: { tokensA: 40 } } });
    const { host, handle } = mountFor(payload);
    expect(text(host, '.stage-kicker')).toMatch(/^Up next/);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-kicker')).toBe('Bracket');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-title')).toBe('Preliminary standings');
    expect(host.querySelector('.stage-kicker')).toBeNull();
    handle.destroy();
  });

  it('counts the pages in the footer, with what plays next while the up-next page is not the one showing', () => {
    vi.useFakeTimers();
    const payload = preliminaryPayload({ playedCount: 12 });
    const { host, handle } = mountFor(payload);
    expect(text(host, '.stage-footer-start')).toBe(
      `Then: ${payload.thenNext.roundLabel} · Crema Crew vs Drip Society`,
    );
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toBe(
      `Standings · top ${KNOCKOUT_PLACES} qualify · Next: Pour Decisions vs Steam Team`,
    );
    handle.destroy();
  });

  it('says just "Up next" in the footer when nothing follows, and names the page count on a long table', () => {
    vi.useFakeTimers();
    const payload = {
      phase: 'preliminary',
      upNext: {
        matchId: 'm',
        round: 'preliminary',
        roundLabel: 'Preliminary',
        teams: [
          { name: 'A', place: 1 },
          { name: 'B', place: 2 },
        ],
        judges: [],
      },
      standings: Array.from({ length: 12 }, (_, i) => ({
        position: i + 1,
        teamName: `T${i + 1}`,
        played: 1,
        wins: 0,
        points: 10,
      })),
    };
    const { host, handle } = mountFor(payload);
    expect(text(host, '.stage-footer-start')).toBe('Up next');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toBe(
      'Standings · page 1 of 2 · top 8 qualify · Next: A vs B',
    );
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toBe(
      'Standings · page 2 of 2 · top 8 qualify · Next: A vs B',
    );
    handle.destroy();
  });

  it('draws the page-change ring when there is more than one page, and none for a single page', () => {
    vi.useFakeTimers();
    const many = mountFor(preliminaryPayload({ playedCount: 12 }));
    expect(many.host.querySelector('.stage-footer-end .stage-ring')).not.toBeNull();
    many.handle.destroy();
    const one = mountFor({
      phase: 'preliminary',
      standings: [{ position: 1, teamName: 'A', played: 1, wins: 1, points: 10 }],
    });
    expect(one.host.querySelector('.stage-ring')).toBeNull();
    expect(text(one.host, '.stage-footer-start')).toBe('Standings · top 8 qualify');
    expect(vi.getTimerCount()).toBe(0);
    one.handle.destroy();
  });

  it('a republish with nothing changed does not send the room back to the first page', () => {
    vi.useFakeTimers();
    const payload = preliminaryPayload({ playedCount: 12 });
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-title')).toBe('Standings');
    handle.update({ ...payload, standings: [...payload.standings], recentResults: [] });
    expect(text(host, '.stage-title')).toBe('Standings');
    handle.destroy();
  });

  it.each([
    ['standings', (p) => ({ ...p, standings: p.standings.slice(0, 7) })],
    [
      'the up-next match',
      (p) => ({
        ...p,
        upNext: { ...p.upNext, matchId: 'other', teams: [...p.upNext.teams].reverse() },
      }),
    ],
    ['the match after it', (p) => ({ ...p, thenNext: null })],
    ['progress', (p) => ({ ...p, progress: { played: 13, total: 28 } })],
    ['the phase', (p) => ({ ...p, phase: 'knockout' })],
  ])('restarts from the first page when %s changes', (_label, change) => {
    vi.useFakeTimers();
    const payload = preliminaryPayload({ playedCount: 12 });
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-title')).toBe('Standings');
    handle.update(change(payload));
    expect(text(host, '.stage-kicker')).toMatch(/^Up next/);
    handle.destroy();
  });

  it('repaints when only the bracket changes', () => {
    vi.useFakeTimers();
    const payload = knockoutPayload();
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toContain('Bracket · 0 of 8 played');
    handle.update(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toContain('Bracket · 1 of 8 played');
    handle.destroy();
  });

  it('destroy() stops the page loop and the ring', () => {
    vi.useFakeTimers();
    const { handle } = mountFor(preliminaryPayload({ playedCount: 12 }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    handle.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows every team as text, never markup', () => {
    vi.useFakeTimers();
    const payload = {
      phase: 'preliminary',
      standings: [
        { position: 1, teamName: '<img src=x onerror=alert(1)>', played: 1, wins: 1, points: 9 },
      ],
    };
    const { host, handle } = mountFor(payload);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    handle.destroy();
  });
});

describe('idle loop: more of what the room is told', () => {
  const standingsFor = (rows) =>
    rows.map(([position, teamName, played = 3, wins = 1, points = 50]) => ({
      position,
      teamName,
      played,
      wins,
      points,
    }));

  it('says a tie across the cut-off is open, by its place', () => {
    vi.useFakeTimers();
    const standings = standingsFor([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
      [4, 'D'],
      [5, 'E'],
      [6, 'F'],
      [7, 'G'],
      [8, 'H'],
      [8, 'I'],
    ]);
    const { host, handle } = mountFor({ phase: 'preliminary', standings });
    expect(text(host, '.stage-footer-start')).toMatch(
      /^Standings · page 1 of 2 · top 8 qualify · tie for 8th$/,
    );
    handle.destroy();
  });

  it.each([
    [
      'teams below the cut-off tied with each other',
      [
        [9, 'I'],
        [9, 'J'],
      ],
    ],
    ['one team past the cut-off', [[9, 'I']]],
    [
      'a tie at the cut-off between teams that have not played',
      [
        [8, 'H', 0, 0, 0],
        [8, 'I', 0, 0, 0],
      ],
    ],
  ])('says nothing about a tie for %s', (_label, tail) => {
    vi.useFakeTimers();
    const head = [
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
      [4, 'D'],
      [5, 'E'],
      [6, 'F'],
      [7, 'G'],
    ];
    const standings = standingsFor([...head, ...(tail[0][0] === 8 ? [] : [[8, 'H']]), ...tail]);
    const { host, handle } = mountFor({ phase: 'preliminary', standings });
    expect(text(host, '.stage-footer-start')).not.toMatch(/tie for/);
    expect(text(host, '.stage-footer-start')).toMatch(/top 8 qualify/);
    handle.destroy();
  });

  it('keeps a tie that straddles a page together: all three at 7th open the second page', () => {
    vi.useFakeTimers();
    const standings = standingsFor([
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
      [4, 'D'],
      [5, 'E'],
      [6, 'F'],
      [7, 'G'],
      [7, 'H'],
      [7, 'I'],
      [10, 'J'],
    ]);
    const { host, handle } = mountFor({ phase: 'preliminary', standings });
    expect(text(host, '.stage-range')).toBe('1 to 6 of 10');
    expect(host.querySelectorAll('.stage-standing-row')).toHaveLength(6);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-range')).toBe('7 to 10 of 10');
    expect(
      [...host.querySelectorAll('.stage-standing-row')].map(
        (row) => row.querySelector('.stage-name-suffix')?.textContent ?? '',
      ),
    ).toEqual([' (tied)', ' (tied)', ' (tied)', '']);
    handle.destroy();
  });

  it('the standings after the preliminary round do not promise places (they are only the seeding record)', () => {
    vi.useFakeTimers();
    const { host, handle } = mountFor(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    vi.advanceTimersByTime(PAGE_DWELL_MS * 2);
    expect(text(host, '.stage-title')).toBe('Preliminary standings');
    expect(text(host, '.stage-footer-start')).toBe(
      'Standings · Next: ' +
        matchLine(knockoutPayload({ results: { qf1: { tokensA: 40 } } }).upNext),
    );
    handle.destroy();
  });

  it('repaints when only the bracket changes, and not when only the results list does', () => {
    vi.useFakeTimers();
    const payload = knockoutPayload({ results: { qf1: { tokensA: 40 } } });
    const other = knockoutPayload({ results: { qf1: { tokensA: 40 }, qf2: { tokensA: 40 } } });
    const { host, handle } = mountFor(payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toContain('Bracket · 1 of 8 played');
    handle.update({ ...payload, recentResults: [] });
    expect(text(host, '.stage-footer-start')).toContain('Bracket · 1 of 8 played');
    handle.update({ ...payload, bracket: other.bracket });
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(text(host, '.stage-footer-start')).toContain('Bracket · 2 of 8 played');
    handle.destroy();
  });
});

describe('idle loop: the bracket page', () => {
  const bracketHost = (payload) => {
    vi.useFakeTimers();
    const mounted = mountFor(payload);
    // the knockout loop is up next, then the bracket
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    return mounted;
  };
  const slotsOf = (host) =>
    [...host.querySelectorAll('.btc-stage-slot')].map((slot) =>
      [...slot.querySelectorAll('.btc-stage-slot-team')].map((team) => ({
        text: [team.firstChild.textContent, team.lastChild.textContent].join('|'),
        mark: team.querySelector('.btc-stage-slot-mark')?.textContent ?? null,
        markKind: team.querySelector('.btc-stage-slot-mark')?.getAttribute('data-kind') ?? null,
        winner: team.getAttribute('data-winner'),
        tbd: team.hasAttribute('data-tbd'),
      })),
    );

  it('has a column for each stage, the final and third place sharing the last, each slot labelled there', () => {
    const { host, handle } = bracketHost(knockoutPayload());
    expect(all(host, '.btc-stage-round-head')).toEqual([
      'Quarterfinals',
      'Semifinals',
      'Final and third place',
    ]);
    expect(
      host.querySelectorAll('.btc-stage-round')[0].querySelectorAll('.btc-stage-slot'),
    ).toHaveLength(4);
    expect(
      host.querySelectorAll('.btc-stage-round')[1].querySelectorAll('.btc-stage-slot'),
    ).toHaveLength(2);
    const last = host.querySelectorAll('.btc-stage-round')[2];
    expect([...last.querySelectorAll('.btc-stage-slot-label')].map((n) => n.textContent)).toEqual([
      'Final',
      'Third place',
    ]);
    expect(
      host.querySelectorAll('.btc-stage-round')[0].querySelector('.btc-stage-slot-label'),
    ).toBeNull();
    handle.destroy();
  });

  it('writes the totals of a played slot, marks who went through, and says "To be decided" for a seat not yet filled', () => {
    const { host, handle } = bracketHost(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    const slots = slotsOf(host);
    expect(slots[0][0]).toMatchObject({ winner: 'true', tbd: false });
    expect(slots[0][0].text).toMatch(/^Bean Scene\|\d+$/);
    expect(slots[0][1]).toMatchObject({ winner: 'false', tbd: false });
    // an unplayed quarterfinal has both teams and no totals
    expect(slots[1][0].text).toBe('Drip Society|');
    // a semifinal waiting on a result has a known team and a seat to be decided
    const sf1 = slots[4];
    expect(sf1[0].text).toBe(`${slots[0][0].text.split('|')[0]}|`);
    expect(sf1[1]).toMatchObject({ text: 'To be decided|', tbd: true });
    handle.destroy();
  });

  it('writes who went through in words beside the team, and nothing beside the other', () => {
    const { host, handle } = bracketHost(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    const slots = slotsOf(host);
    expect(slots[0].map((team) => team.mark)).toEqual(['Through', null]);
    expect(slots[0][0].markKind).toBe('through');
    expect(slots[1].map((team) => team.mark)).toEqual([null, null]);
    handle.destroy();
  });

  it('marks a slot the organiser decided in the winner’s own row, with the tie-break named', () => {
    const { host, handle } = bracketHost(
      knockoutPayload({
        results: { qf3: { tokensA: 30, tiebreak: { winner: 5, reason: 'Sudden-death cup' } } },
      }),
    );
    expect(host.querySelector('.btc-stage-slot-note')).toBeNull();
    const slots = slotsOf(host);
    expect(slots[2].map((team) => team.winner)).toEqual(['false', 'true']);
    expect(slots[2].map((team) => team.mark)).toEqual([null, 'Through · tie-break']);
    expect(slots[2][1].markKind).toBe('tiebreak');
    expect(slots[2][1].text).toMatch(/^Roast Republic\|30$/);
    handle.destroy();
  });

  it('says a slot is level, on both teams, until the organiser decides it, and counts them in the kicker', () => {
    const { host, handle } = bracketHost(
      knockoutPayload({ results: { qf3: { tokensA: 30 }, qf4: { tokensA: 30 } } }),
    );
    const slots = slotsOf(host);
    expect(slots[2].map((team) => team.mark)).toEqual(['Level', 'Level']);
    expect(slots[2].map((team) => team.winner)).toEqual(['false', 'false']);
    expect(slots[2][0].markKind).toBe('level');
    expect(text(host, '.stage-kicker')).toBe('Bracket · 2 level, awaiting the organiser');
    handle.destroy();
  });

  it('a level slot the organiser has decided is no longer level, and the kicker says plain "Bracket"', () => {
    const { host, handle } = bracketHost(
      knockoutPayload({
        results: { qf3: { tokensA: 30, tiebreak: { winner: 5, reason: 'Coin' } } },
      }),
    );
    expect(text(host, '.stage-kicker')).toBe('Bracket');
    expect(all(host, '.btc-stage-slot-mark[data-kind="level"]')).toEqual([]);
    handle.destroy();
  });

  it('words the winner of the final and of third place for what they won', () => {
    const results = {
      qf1: { tokensA: 40 },
      qf2: { tokensA: 40 },
      qf3: { tokensA: 40 },
      qf4: { tokensA: 40 },
      sf1: { tokensA: 35 },
      sf2: { tokensA: 35 },
      final: { tokensA: 33 },
      third: { tokensA: 33 },
    };
    vi.useFakeTimers();
    const payload = knockoutPayload({ results });
    // a decided final is the champion screen, so look at the bracket page through a payload that is not
    const { host, handle } = mountFor({ ...payload, podium: null });
    // nothing is up next any more, so the bracket is the first page
    const marks = all(host, '.btc-stage-slot-mark');
    expect(marks.filter((m) => m === 'Champion')).toHaveLength(1);
    expect(marks.filter((m) => m === 'Third')).toHaveLength(1);
    expect(marks.filter((m) => m === 'Through')).toHaveLength(6);
    handle.destroy();
  });

  it('marks which slots are played and which are not, for the stylesheet', () => {
    const { host, handle } = bracketHost(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    const played = [...host.querySelectorAll('.btc-stage-slot')].map((slot) =>
      slot.getAttribute('data-played'),
    );
    expect(played.slice(0, 3)).toEqual(['true', 'false', 'false']);
    handle.destroy();
  });

  it('says a team that is not seated yet, and one not decided, is not a winner', () => {
    const { host, handle } = bracketHost(knockoutPayload());
    const winners = [...host.querySelectorAll('.btc-stage-slot-team')].map((team) =>
      team.getAttribute('data-winner'),
    );
    expect(new Set(winners)).toEqual(new Set(['false']));
    handle.destroy();
  });

  it('says how many slots are played in the footer', () => {
    const { host, handle } = bracketHost(
      knockoutPayload({ results: { qf1: { tokensA: 40 }, qf2: { tokensA: 40 } } }),
    );
    expect(text(host, '.stage-footer-start')).toContain('Bracket · 2 of 8 played');
    handle.destroy();
  });
});

describe('champion screen', () => {
  const champion = (results = FULL_RESULTS) => mountFor(knockoutPayload({ results }));

  it('leaves out the score line when the final’s totals are not both there', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const final = payload.bracket.rounds.find((round) => round.round === 'final');
    final.slots[0].teams[1].total = null;
    const { host } = mountFor(payload);
    expect(text(host, '.stage-champion-name')).toBe(payload.podium.places[0].teamName);
    expect(host.querySelector('.stage-champion-score')).toBeNull();
  });

  it('shows the champion full screen, with the final score and the podium', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const { host } = mountFor(payload);
    const name = payload.podium.places[0].teamName;
    expect(text(host, '.stage-champion-label')).toBe('Champion');
    expect(text(host, '.stage-champion-name')).toBe(name);
    const score = text(host, '.stage-champion-score');
    const match = /^Final (\d+) – (\d+)$/.exec(score);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeGreaterThan(Number(match[2]));
    const podium = text(host, '.stage-podium');
    expect(podium).toContain(`1st runner-up ${payload.podium.places[1].teamName}`);
    expect(podium).toContain(`3rd place ${payload.podium.places[2].teamName}`);
    expect(podium).toContain('   ·   ');
    expect(text(host, '.stage-footer-start')).toBe('Congratulations to all 8 teams');
    expect(text(host, '.stage-footer-end')).toBe('Results stay on screen');
  });

  it('says how it was decided when the organiser had to', () => {
    const { host } = champion({
      ...FULL_RESULTS,
      final: { tokensA: 30, tiebreak: { winner: 0, reason: 'Sudden-death cup' } },
    });
    expect(text(host, '.stage-champion-score')).toMatch(/^Final 30 – 30, decided by tie-break$/);
  });

  it('names only the places that are decided: a final done and third place still to play shows the runner-up alone', () => {
    const { host } = champion({
      qf1: { tokensA: 40 },
      qf2: { tokensA: 40 },
      qf3: { tokensA: 40 },
      qf4: { tokensA: 40 },
      sf1: { tokensA: 35 },
      sf2: { tokensA: 35 },
      final: { tokensA: 33 },
    });
    const podium = text(host, '.stage-podium');
    expect(podium).toMatch(/^1st runner-up /);
    expect(podium).not.toContain('3rd place');
  });

  it('leaves out the score and podium lines when it has nothing to say, rather than inventing them', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const bare = {
      ...payload,
      bracket: null,
      podium: { complete: false, places: [payload.podium.places[0]] },
    };
    const { host } = mountFor(bare);
    expect(text(host, '.stage-champion-name')).toBe(payload.podium.places[0].teamName);
    expect(host.querySelector('.stage-champion-score')).toBeNull();
    expect(host.querySelector('.stage-podium')).toBeNull();
  });

  it('repaints in place when the payload changes, and has no timers of its own', () => {
    vi.useFakeTimers();
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const { host, handle } = mountFor(payload);
    const next = {
      ...payload,
      podium: {
        ...payload.podium,
        places: [
          { ...payload.podium.places[0], teamName: 'Someone Else' },
          ...payload.podium.places.slice(1),
        ],
      },
    };
    handle.update(next);
    expect(text(host, '.stage-champion-name')).toBe('Someone Else');
    expect(vi.getTimerCount()).toBe(0);
    handle.destroy();
  });

  it('says "all teams" when the payload carries no standings', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const { host } = mountFor({ ...payload, standings: [] });
    expect(text(host, '.stage-footer-start')).toBe('Congratulations to all teams');
  });
});
