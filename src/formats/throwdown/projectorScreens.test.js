// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  selectThrowdownScreen,
  hasThrowdownProjectorContent,
  throwdownPages,
  PAGE_DWELL_MS,
} from './projectorScreens.js';
import { payloadFor, roundOf, namesUpTo } from './projectorFixtures.js';
import { describeProjectorContract } from '../../core/stageProjectorTestKit.js';

afterEach(() => vi.useRealTimers());

const textOf = (page) => {
  const div = document.createElement('div');
  div.append(...page.render());
  return div.textContent;
};
const kinds = (payload) => throwdownPages(payload).map((p) => p.kind);
const pageOf = (payload, kind) => throwdownPages(payload).find((p) => p.kind === kind);
const nodeOf = (page) => {
  const div = document.createElement('div');
  div.append(...page.render());
  return div;
};

// 16 competitors, Round of 16 with `decided` matches decided.
const round16 = (decided, extra = {}) =>
  payloadFor({ names: namesUpTo(16), rounds: [roundOf(8, { decided })], ...extra });

// 16 competitors: Round of 16 done, quarter-finals started (first quarter-final decided if `qfDecided`).
function quarterFinals({ qfDecided = 0 } = {}) {
  const r1 = roundOf(8, { decided: 8 });
  // winners of R16 are the first seat of each match: P1, P3, ... P15
  const winners = Array.from({ length: 8 }, (_, i) => `P${i * 2 + 1}`);
  const qf = {
    phase: 'main',
    matches: Array.from({ length: 4 }, (_, i) => ({
      a: winners[i * 2],
      b: winners[i * 2 + 1],
      ...(i < qfDecided ? { result: [3, 0], at: `2026-11-27T11:0${i}:00Z` } : {}),
    })),
  };
  return payloadFor({ names: namesUpTo(16), rounds: [r1, qf] });
}

describe('before Round 1', () => {
  const setup = payloadFor({ names: namesUpTo(20), rounds: [] });

  it('loops Meet the competitors (names only, 16 to a page) and How it works', () => {
    expect(setup.phase).toBe('setup');
    expect(kinds(setup)).toEqual(['meet', 'meet', 'how']);
    const first = textOf(pageOf(setup, 'meet'));
    expect(first).toContain('Meet the competitors');
    expect(first).toContain('1 to 16 of 20');
    expect(nodeOf(pageOf(setup, 'meet')).querySelectorAll('.td-stage-roster-name')).toHaveLength(
      16,
    );
    expect(first).not.toContain('Secret Cafe');
  });

  it('omits the roster page when there are no names, and still explains how it works', () => {
    expect(kinds(payloadFor({ names: [], rounds: [] }))).toEqual(['how']);
  });

  it('shows a scoresheet card only when the module is on, and never says how many judges', () => {
    const off = textOf(pageOf(setup, 'how'));
    expect(off).not.toMatch(/scoresheet/i);
    const on = payloadFor({
      names: namesUpTo(4),
      rounds: [],
      scoresheet: { preset: 'latte_art_v1', cups: { final: 2 } },
    });
    const text = textOf(pageOf(on, 'how'));
    expect(text).toMatch(/scoresheet/i);
    expect(text).not.toMatch(/\d/);
    expect(off).not.toMatch(/\d/);
  });
});

describe('the live loop', () => {
  it('runs Up next, the round, Path to the final and Latest results, in that order', () => {
    expect(kinds(round16(3))).toEqual(['next', 'round', 'still', 'path', 'latest']);
  });

  it('leaves out a page with nothing to say: no results yet means no Latest results, nobody out no Still in', () => {
    expect(kinds(round16(0))).toEqual(['next', 'round', 'path']);
  });

  it('Up next: a VS card with its match number, and a footer naming the match after it', () => {
    const payload = round16(5);
    const page = pageOf(payload, 'next');
    const text = textOf(page);
    expect(text).toContain('Up next · Round of 16 · Match 6 of 8');
    expect(text).toContain('P11');
    expect(text).toContain('P12');
    expect(text).toContain('VS');
    expect(page.footer).toBe('Then: P13 vs P14');
  });

  it('Up next takes the first undecided match in bracket order, not the latest confirmed', () => {
    const payload = payloadFor({
      names: namesUpTo(8),
      rounds: [
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P2', result: [2, 1] },
            { a: 'P3', b: 'P4' },
            { a: 'P5', b: 'P6', result: [2, 1] },
            { a: 'P7', b: 'P8' },
          ],
        },
      ],
    });
    expect(payload.upNext.number).toBe(2);
    expect(payload.thenNext.number).toBe(4);
  });

  it('Up next says where each competitor came from', () => {
    const page = pageOf(quarterFinals(), 'next');
    const text = textOf(page);
    expect(text).toContain('Up next · Quarter-finals · Match 1 of 4');
    expect(text).toContain('Won R16 match 1');
    expect(text).toContain('Won R16 match 2');
  });

  it('a round with one match has no "Match n of m", and the 3rd place match names the semi-final each came from', () => {
    const r1 = roundOf(2, { decided: 2 }); // the semi-finals: P1 beat P2, P3 beat P4
    const four = payloadFor({
      names: namesUpTo(4),
      rounds: [
        r1,
        { phase: 'main', matches: [{ a: 'P1', b: 'P3', result: [2, 1] }] },
        { phase: 'third_place', matches: [{ a: 'P2', b: 'P4' }] },
      ],
    });
    expect(four.upNext.roundLabel).toBe('3rd place');
    expect(textOf(pageOf(four, 'next'))).toContain('Up next · 3rd place');
    expect(textOf(pageOf(four, 'next'))).not.toContain('Match 1 of 1');
    expect(textOf(pageOf(four, 'next'))).toContain('Lost semi-final match 1');
  });

  it('shows a Judging chip for a scoresheet match, and no number anywhere on it', () => {
    const payload = payloadFor({
      names: ['Ana', 'Bima'],
      rounds: [{ phase: 'main', matches: [{ a: 'Ana', b: 'Bima' }] }],
      scoresheet: { preset: 'latte_art_v1', cups: { final: 3 } },
    });
    const page = pageOf(payload, 'next');
    const text = textOf(page);
    expect(text).toContain('Judging');
    expect(text.replace('Up next · Final', '')).not.toMatch(/\d/);
    expect(page.footer).toBe('Up next');
  });

  it('the round page lists the round with every status in words', () => {
    const payload = payloadFor({
      names: namesUpTo(12),
      rounds: [
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P2', result: [2, 1] },
            { a: 'P3', b: 'P4', result: 'walkover:2' },
            { a: 'P5', result: 'bye' },
            { a: 'P7', b: 'P8' },
            { a: 'P9', b: 'P10' },
            { a: 'P11', b: 'P12' },
          ],
        },
      ],
    });
    const text = textOf(pageOf(payload, 'round'));
    expect(text).toContain('Round of 12');
    for (const word of ['Wins', '2 to 1', 'Walkover', 'Bye', 'Up next', 'Not played yet']) {
      expect(text).toContain(word);
    }
  });

  it('pages a big round 8 matches to a page, in order', () => {
    const payload = payloadFor({ names: namesUpTo(32), rounds: [roundOf(16, { decided: 2 })] });
    const rounds = throwdownPages(payload).filter((p) => p.kind === 'round');
    expect(rounds).toHaveLength(2);
    expect(rounds[0].label).toBe('Round of 32 · page 1 of 2');
    const first = nodeOf(rounds[0]);
    expect(first.querySelectorAll('.td-stage-match')).toHaveLength(8);
    expect(nodeOf(rounds[1]).querySelector('.td-stage-num').textContent).toBe('Match 9');
  });

  it('Still in counts who is left and tags the pair about to play', () => {
    const page = pageOf(round16(3), 'still');
    const text = textOf(page);
    expect(text).toContain('13 of 16 still in');
    const tagged = [...nodeOf(page).querySelectorAll('.td-stage-roster-name')].filter((n) =>
      n.textContent.includes('Up next'),
    );
    expect(tagged.map((n) => n.textContent.replace('Up next', ''))).toEqual(['P7', 'P8']);
  });

  it('Still in says "The final four" at the end, and has nothing to say before anyone is out', () => {
    const semis = payloadFor({
      names: namesUpTo(4),
      rounds: [roundOf(2, { decided: 2 }), { phase: 'main', matches: [{ a: 'P1', b: 'P3' }] }],
    });
    expect(semis.stillIn.names).toHaveLength(2);
    const fourPlayers = payloadFor({ names: namesUpTo(4), rounds: [roundOf(2, { decided: 1 })] });
    expect(fourPlayers.stillIn.names).toHaveLength(3);
    const finalFour = payloadFor({
      names: namesUpTo(8),
      rounds: [
        roundOf(4, { decided: 4 }),
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P3' },
            { a: 'P5', b: 'P7' },
          ],
        },
      ],
    });
    expect(textOf(pageOf(finalFour, 'still'))).toContain('The final four');
    expect(kinds(round16(0))).not.toContain('still');
  });

  it('Path to the final draws only rounds that exist, and says the next one is drawn later, never with slots or names', () => {
    const page = pageOf(round16(3), 'path');
    const node = nodeOf(page);
    expect(node.querySelectorAll('.td-stage-round')).toHaveLength(1);
    expect(node.textContent).toContain('Drawn when the Round of 16 is complete');
    // nothing is drawn for a round that has not been earned: only the 8 matches of the one that exists
    expect(node.querySelectorAll('.td-stage-match')).toHaveLength(8);
    expect(node.textContent).not.toMatch(/Quarter|Semi|Final/);
  });

  it('Path to the final collapses a big round to one line instead of drawing it', () => {
    const payload = payloadFor({
      names: namesUpTo(32),
      rounds: [roundOf(16, { decided: 16 }), roundOf(8, { from: 0 })],
    });
    const node = nodeOf(pageOf(payload, 'path'));
    expect(node.querySelector('.td-stage-collapsed').textContent).toBe('Round of 32 · complete');
    expect(node.querySelectorAll('.td-stage-round')).toHaveLength(1);
    expect(node.textContent).toContain('Drawn when the Round of 16 is complete');
  });

  it('Path to the final shows the last two main rounds, the Final and the 3rd place match', () => {
    const r1 = roundOf(8, { decided: 8 });
    const w = Array.from({ length: 8 }, (_, i) => `P${i * 2 + 1}`);
    const qf = {
      phase: 'main',
      matches: [0, 1, 2, 3].map((i) => ({ a: w[i * 2], b: w[i * 2 + 1], result: [3, 0] })),
    };
    const sf = {
      phase: 'main',
      matches: [
        { a: 'P1', b: 'P5', result: [2, 1] },
        { a: 'P9', b: 'P13', result: [2, 1] },
      ],
    };
    const fin = { phase: 'main', matches: [{ a: 'P1', b: 'P9' }] };
    const third = { phase: 'third_place', matches: [{ a: 'P5', b: 'P13' }] };
    const payload = payloadFor({ names: namesUpTo(16), rounds: [r1, qf, sf, fin, third] });
    const node = nodeOf(pageOf(payload, 'path'));
    const heads = [...node.querySelectorAll('.td-stage-round-title')].map((n) => n.textContent);
    expect(heads).toEqual(['Quarter-finals', 'Semi-finals', 'Final', '3rd place']);
    expect(node.textContent).not.toContain('Drawn when');
  });

  it('Latest results: the last three, winner first, with the split for a tap round and none for a scoresheet round', () => {
    const payload = payloadFor({
      names: namesUpTo(8),
      scoresheet: { preset: 'latte_art_v1', cups: { final: 1 } },
      rounds: [
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P2', result: [2, 1], at: '2026-11-27T10:01:00Z' },
            { a: 'P3', b: 'P4', result: [3, 0], at: '2026-11-27T10:02:00Z' },
            { a: 'P5', b: 'P6', result: 'walkover:2', at: '2026-11-27T10:03:00Z' },
            { a: 'P7', b: 'P8', result: [1, 2], at: '2026-11-27T10:04:00Z' },
          ],
        },
      ],
    });
    const rows = [
      ...nodeOf(pageOf(payload, 'latest')).querySelectorAll('.td-stage-latest-line'),
    ].map((n) => n.textContent);
    expect(rows).toEqual(['P8 beat P7 · 2 to 1', 'P6 beat P5 · Walkover', 'P3 beat P4 · 3 to 0']);
  });

  it('a scoresheet result says its winner and nothing else: no number on the page', () => {
    const payload = payloadFor({
      names: ['Ana', 'Bima'],
      scoresheet: { preset: 'latte_art_v1', cups: { final: 3 } },
      rounds: [{ phase: 'main', matches: [{ a: 'Ana', b: 'Bima', result: 'scores:2' }] }],
    });
    // decided Final: the champion screen takes over; the latest-results page (used by the loop if shown) is clean
    expect(payload.champion).toMatchObject({ name: 'Bima' });
    const text = textOf(pageOf({ ...payload, champion: null, phase: 'live' }, 'latest'));
    expect(text).toContain('Bima beat Ana');
    expect(text).not.toMatch(/\d|judges|total|point/i);
  });
});

describe('the champion', () => {
  it('names the champion with the runner-up and 3rd place in the podium line and holds for 60 seconds', () => {
    const payload = {
      eventName: 'Night',
      phase: 'complete',
      competitors: 12,
      rounds: [],
      champion: { name: 'Ana', runnerUp: 'Bima', thirdPlace: 'Citra' },
    };
    const screen = selectThrowdownScreen(payload);
    expect(screen.minDwellMs).toBe(60_000);
    const host = document.createElement('div');
    screen.mount(host, payload);
    expect(host.querySelector('.stage-champion-name').textContent).toBe('Ana');
    expect(host.querySelector('.stage-podium').textContent).toContain('Runner-up Bima');
    expect(host.querySelector('.stage-podium').textContent).toContain('3rd place Citra');
    expect(host.querySelector('.stage-footer-start').textContent).toBe(
      'Congratulations to all 12 competitors',
    );
  });
});

describe('the loop screen', () => {
  it('rotates every 10 seconds and does not restart on a republish with nothing changed', () => {
    vi.useFakeTimers();
    const payload = round16(3);
    const host = document.createElement('div');
    const handle = selectThrowdownScreen(payload).mount(host, payload);
    expect(host.querySelector('.stage-kicker').textContent).toContain('Up next');
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    const second = host.querySelector('.stage-kicker').textContent;
    expect(second).toContain('Round of 16');
    handle.update(structuredClone(payload));
    expect(host.querySelector('.stage-kicker').textContent).toBe(second);
    handle.destroy();
  });

  it('puts "Up next: A vs B" in the footer of the other pages', () => {
    vi.useFakeTimers();
    const payload = round16(3);
    const host = document.createElement('div');
    const handle = selectThrowdownScreen(payload).mount(host, payload);
    vi.advanceTimersByTime(PAGE_DWELL_MS);
    expect(host.querySelector('.stage-footer-start').textContent).toContain('Up next: P7 vs P8');
    handle.destroy();
  });

  it('has content for a payload with a name or rounds, and for nothing else', () => {
    expect(hasThrowdownProjectorContent({})).toBe(false);
    expect(hasThrowdownProjectorContent(null)).toBe(false);
    expect(selectThrowdownScreen(null)).toBeNull();
  });
});

const longName = 'Muhammad Abdul-Rahman bin Haji Mohd Yusof al-Brunei the Third';
describeProjectorContract('Throwdown projector', {
  selectScreen: selectThrowdownScreen,
  hasContent: hasThrowdownProjectorContent,
  samples: {
    setup: payloadFor({ names: namesUpTo(20), rounds: [] }),
    'round of 16 under way': round16(3),
    'quarter-finals': quarterFinals({ qfDecided: 1 }),
    champion: { eventName: 'Night', phase: 'complete', competitors: 4, champion: { name: 'Ana' } },
  },
  worstCases: [
    {
      label: 'the longest names on the fullest page',
      payload: payloadFor({
        names: [longName, ...namesUpTo(31).slice(1)].concat(['P32']),
        rounds: [
          {
            phase: 'main',
            matches: Array.from({ length: 16 }, (_, i) => ({
              a: i === 0 ? longName : `P${i * 2 + 1}`,
              b: `P${i * 2 + 2}`,
              ...(i < 5 ? { result: [3, 2] } : {}),
            })),
          },
        ],
      }),
      mustShow: [longName, 'Round of 32', 'Meet'].slice(0, 2),
    },
  ],
});
