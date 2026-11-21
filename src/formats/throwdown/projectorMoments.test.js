// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStageDisplay } from '../../core/stageDisplay.js';
import { detectThrowdownMoments, roundSetTitle, MAX_PAIRINGS } from './projectorMoments.js';
import { selectThrowdownScreen, throwdownBand } from './projectorScreens.js';
import { payloadFor, roundOf, namesUpTo } from './projectorFixtures.js';

afterEach(() => vi.useRealTimers());

const T = (minute) => `2026-11-27T10:${String(minute).padStart(2, '0')}:00Z`;

// Mount a moment the way the player does and read what the room reads.
function show(moment) {
  const host = document.createElement('div');
  const handle = moment.screen.mount(host, moment.payload);
  const read = (selector) => host.querySelector(selector)?.textContent ?? null;
  const all = (selector) => [...host.querySelectorAll(selector)].map((n) => n.textContent);
  return { host, handle, read, all };
}

// 8 competitors, quarter-finals: `decided` of the 4 matches decided (first seat wins 2 to 1).
function quarterFinals(decided, extra = {}) {
  return payloadFor({
    names: namesUpTo(8),
    rounds: [
      {
        phase: 'main',
        matches: [0, 1, 2, 3].map((i) => ({
          a: `P${i * 2 + 1}`,
          b: `P${i * 2 + 2}`,
          ...(i < decided ? { result: [2, 1], at: T(i + 1) } : {}),
        })),
      },
    ],
    ...extra,
  });
}

describe('detecting a new result', () => {
  it('says nothing without an earlier snapshot', () => {
    expect(detectThrowdownMoments(null, quarterFinals(2))).toEqual([]);
    expect(detectThrowdownMoments(undefined, quarterFinals(2))).toEqual([]);
  });

  it('says nothing when a republish repeats what was shown', () => {
    const snapshot = quarterFinals(2);
    expect(detectThrowdownMoments(snapshot, structuredClone(snapshot))).toEqual([]);
  });

  it('announces each result that is new, oldest first', () => {
    const moments = detectThrowdownMoments(quarterFinals(1), quarterFinals(3));
    expect(moments.map((m) => m.payload.moment.result.number)).toEqual([2, 3]);
    expect(moments.every((m) => m.screen.key === 'result' && m.screen.minDwellMs === 8000)).toBe(
      true,
    );
  });

  it('is not fooled by the recent list sliding: an old result falling off is not news', () => {
    expect(detectThrowdownMoments(quarterFinals(3), quarterFinals(4))).toHaveLength(1);
  });
});

describe('the Result recorded screen', () => {
  const resultOf = (previous, next, index = 0) =>
    show(detectThrowdownMoments(previous, next)[index]);

  it('shows both competitors, who goes through, and the vote split of a tap round', () => {
    const screen = resultOf(quarterFinals(0), quarterFinals(1));
    expect(screen.read('.stage-kicker')).toBe('Result recorded · Quarter-finals · Match 1');
    expect(screen.all('.stage-side-name')).toEqual(['P1', 'P2']);
    expect(screen.all('.stage-side-label')).toEqual(['Goes through', 'Out']);
    expect(screen.all('.stage-points')).toEqual(['2', '1']);
    expect(screen.read('.stage-footer-start')).toBe('P1 beat P2 · 2 to 1');
    expect(screen.host.querySelector('.stage-footer-end').children.length).toBeGreaterThan(0);
    screen.handle.destroy();
  });

  it('says Walkover in a chip and carries no vote numbers', () => {
    const previous = payloadFor({
      names: namesUpTo(4),
      rounds: [
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P2' },
            { a: 'P3', b: 'P4' },
          ],
        },
      ],
    });
    const next = payloadFor({
      names: namesUpTo(4),
      rounds: [
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P2', result: 'walkover:2', at: T(1) },
            { a: 'P3', b: 'P4' },
          ],
        },
      ],
    });
    const screen = resultOf(previous, next);
    expect(screen.all('.stage-chip')).toEqual(['Walkover']);
    expect(screen.all('.stage-points')).toEqual([]);
    expect(screen.read('.stage-footer-start')).toBe('P2 beat P1 · Walkover');
  });

  it('names the winner only for a scoresheet round: no number, count or rule anywhere on screen', () => {
    const rounds = (result) => [
      {
        phase: 'main',
        matches: [{ a: 'Ana', b: 'Bima', ...(result ? { result, at: T(5) } : {}) }],
      },
    ];
    const base = {
      names: ['Ana', 'Bima'],
      scoresheet: { preset: 'latte_art_v1', cups: { final: 3 } },
    };
    const screen = resultOf(
      payloadFor({ ...base, rounds: rounds(null) }),
      payloadFor({ ...base, rounds: rounds('scores:2') }),
    );
    expect(screen.all('.stage-side-label')).toEqual(['Runner-up', 'Champion']);
    expect(screen.all('.stage-points')).toEqual([]);
    const text =
      screen.host.querySelector('.stage-main').textContent + screen.read('.stage-footer-start');
    expect(text).toContain('Bima beat Ana');
    expect(text).not.toMatch(/\d|judges|total|point/i);
  });

  const final = (result) => [
    roundOf(2, { decided: 2 }),
    {
      phase: 'main',
      matches: [{ a: 'P1', b: 'P3', ...(result ? { result: [3, 1], at: T(9) } : {}) }],
    },
  ];

  it('the Final says Champion and Runner-up', () => {
    const names = namesUpTo(4);
    const screen = resultOf(
      payloadFor({ names, rounds: final(false) }),
      payloadFor({ names, rounds: final(true) }),
    );
    expect(screen.all('.stage-side-label')).toEqual(['Champion', 'Runner-up']);
  });

  it('a semi-final loser plays for third place when that match exists, and is a semi-finalist when it does not', () => {
    const names = namesUpTo(4);
    const semis = (result) => ({
      phase: 'main',
      matches: [
        { a: 'P1', b: 'P2', ...(result ? { result: [2, 1], at: T(1) } : {}) },
        { a: 'P3', b: 'P4' },
      ],
    });
    // No 3rd place round in the payload yet: the semi-final loser is not told they play for third.
    const without = resultOf(
      payloadFor({ names, rounds: [semis(false)] }),
      payloadFor({ names, rounds: [semis(true)] }),
    );
    expect(without.all('.stage-side-label')).toEqual(['Goes through', 'Semi-finalist']);
    const withThird = (result) => [
      semis(result),
      { phase: 'third_place', matches: [{ a: 'P2', b: 'P4' }] },
    ];
    const next = payloadFor({ names, rounds: withThird(true) });
    const moments = detectThrowdownMoments(payloadFor({ names, rounds: withThird(false) }), next);
    expect(show(moments[0]).all('.stage-side-label')).toEqual([
      'Goes through',
      'Plays for third place',
    ]);
  });

  it('the 3rd place match says Third place and Fourth place', () => {
    const names = namesUpTo(4);
    const rounds = (result) => [
      roundOf(2, { decided: 2 }),
      { phase: 'main', matches: [{ a: 'P1', b: 'P3' }] },
      {
        phase: 'third_place',
        matches: [{ a: 'P2', b: 'P4', ...(result ? { result: [2, 1], at: T(8) } : {}) }],
      },
    ];
    const screen = resultOf(
      payloadFor({ names, rounds: rounds(false) }),
      payloadFor({ names, rounds: rounds(true) }),
    );
    expect(screen.all('.stage-side-label')).toEqual(['Third place', 'Fourth place']);
  });
});

describe('the Round is set screen', () => {
  // quarter-finals decided, semi-finals now exist
  const semisPayload = () =>
    payloadFor({
      names: namesUpTo(8),
      rounds: [
        {
          phase: 'main',
          matches: [0, 1, 2, 3].map((i) => ({
            a: `P${i * 2 + 1}`,
            b: `P${i * 2 + 2}`,
            result: [2, 1],
            at: T(i + 1),
          })),
        },
        {
          phase: 'main',
          matches: [
            { a: 'P1', b: 'P3' },
            { a: 'P5', b: 'P7' },
          ],
        },
      ],
    });

  it('appears when a new round shows up, after the result that earned it, and names its pairings', () => {
    const previous = payloadFor({
      names: namesUpTo(8),
      rounds: [
        {
          phase: 'main',
          matches: [0, 1, 2, 3].map((i) => ({
            a: `P${i * 2 + 1}`,
            b: `P${i * 2 + 2}`,
            ...(i < 3 ? { result: [2, 1], at: T(i + 1) } : {}),
          })),
        },
      ],
    });
    const moments = detectThrowdownMoments(previous, semisPayload());
    expect(moments.map((m) => m.screen.key)).toEqual(['result', 'round-set']);
    const screen = show(moments[1]);
    expect(screen.read('.stage-title')).toBe('The semi-finals are set');
    expect(screen.all('.td-stage-pair')).toEqual(['P1 vs P3', 'P5 vs P7']);
    expect(screen.read('.stage-kicker')).toBe('Round is set · 2 matches');
    expect(screen.host.querySelector('.stage-reveal')).not.toBeNull();
  });

  it('says only the round that exists: a round that is not earned yet is never in a moment', () => {
    const screen = show(detectThrowdownMoments(quarterFinals(4), semisPayload())[0]);
    expect(screen.host.textContent).not.toMatch(/Final\b/);
  });

  it('announces Round 1 when the draw is made (setup becomes live)', () => {
    const setup = payloadFor({ names: namesUpTo(16), rounds: [] });
    const moments = detectThrowdownMoments(
      setup,
      payloadFor({ names: namesUpTo(16), rounds: [roundOf(8)] }),
    );
    expect(moments.map((m) => m.screen.key)).toEqual(['round-set']);
    const screen = show(moments[0]);
    expect(screen.read('.stage-title')).toBe('Round of 16 is set');
    expect(screen.all('.td-stage-pair')).toHaveLength(8);
  });

  it('reveals at most eight pairings and says how many more', () => {
    const setup = payloadFor({ names: namesUpTo(32), rounds: [] });
    const next = payloadFor({ names: namesUpTo(32), rounds: [roundOf(16)] });
    const screen = show(detectThrowdownMoments(setup, next)[0]);
    expect(screen.all('.td-stage-pair')).toHaveLength(MAX_PAIRINGS);
    expect(screen.read('.td-stage-pair-more')).toBe('+8 more matches');
  });

  it('shows a one-match round (the Final) as a VS card', () => {
    const names = namesUpTo(4);
    const semis = {
      phase: 'main',
      matches: [
        { a: 'P1', b: 'P2', result: [2, 1], at: T(1) },
        { a: 'P3', b: 'P4', result: [2, 1], at: T(2) },
      ],
    };
    const before = payloadFor({
      names,
      rounds: [{ ...semis, matches: [semis.matches[0], { a: 'P3', b: 'P4' }] }],
    });
    const after = payloadFor({
      names,
      rounds: [semis, { phase: 'main', matches: [{ a: 'P1', b: 'P3' }] }],
    });
    const moments = detectThrowdownMoments(before, after);
    const set = moments.find((m) => m.screen.key === 'round-set');
    const screen = show(set);
    expect(screen.read('.stage-title')).toBe('The final is set');
    expect(screen.all('.stage-side-name')).toEqual(['P1', 'P3']);
  });

  it('words: plural and singular, and a numbered round', () => {
    expect(roundSetTitle('Quarter-finals')).toBe('The quarter-finals are set');
    expect(roundSetTitle('Final')).toBe('The final is set');
    expect(roundSetTitle('Round of 32')).toBe('Round of 32 is set');
  });
});

describe('on a display', () => {
  function display() {
    return createStageDisplay({
      selectScreen: selectThrowdownScreen,
      bandFor: throwdownBand,
      detectMoments: detectThrowdownMoments,
    });
  }
  const kicker = (d) => d.el.querySelector('.stage-kicker')?.textContent ?? null;

  it('plays no moment for the first snapshot, whatever it holds', () => {
    vi.useFakeTimers();
    const d = display();
    d.update(quarterFinals(3));
    expect(d.currentKey()).toBe('loop');
    d.destroy();
  });

  it('plays a moment for a new result, then goes back to the loop, and does not replay it on a republish', () => {
    vi.useFakeTimers();
    const d = display();
    d.update(quarterFinals(1));
    const after = quarterFinals(2);
    d.update(after);
    expect(d.currentKey()).toMatch(/^result#/);
    expect(kicker(d)).toContain('Result recorded');
    const playing = d.currentKey();
    d.update(structuredClone(after));
    expect(d.currentKey()).toBe(playing);
    vi.advanceTimersByTime(8000);
    expect(d.currentKey()).toBe('loop');
    d.update(structuredClone(after));
    d.update(structuredClone(after));
    expect(d.currentKey()).toBe('loop');
    d.destroy();
  });

  it('does not restart the loop when the same snapshot is republished', () => {
    vi.useFakeTimers();
    const d = display();
    const payload = quarterFinals(1);
    d.update(payload);
    vi.advanceTimersByTime(10_000);
    const page = kicker(d);
    d.update(structuredClone(payload));
    expect(kicker(d)).toBe(page);
    d.destroy();
  });

  it('plays the result before the champion screen, which then holds', () => {
    vi.useFakeTimers();
    const names = namesUpTo(4);
    const rounds = (result) => [
      roundOf(2, { decided: 2 }),
      {
        phase: 'main',
        matches: [{ a: 'P1', b: 'P3', ...(result ? { result: [3, 1], at: T(9) } : {}) }],
      },
    ];
    const d = display();
    d.update(payloadFor({ names, rounds: rounds(false) }));
    d.update(payloadFor({ names, rounds: rounds(true) }));
    expect(d.currentKey()).toMatch(/^result#/);
    vi.advanceTimersByTime(8000);
    expect(d.currentKey()).toBe('champion');
    d.destroy();
  });
});

describe('a snapshot published before rounds had ids', () => {
  it('is not compared: nothing is announced from it', () => {
    const old = quarterFinals(1);
    old.rounds = old.rounds.map((round) => ({ ...round, id: undefined }));
    expect(detectThrowdownMoments(old, quarterFinals(3))).toEqual([]);
  });
});
