import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import {
  buildThrowdownPayload,
  publishBlocker,
  describePublishError,
  DEFAULT_PUBLISH_SCOPE,
  PUBLISH_SCOPE_NOTICE,
} from './resultsPublishing.js';

// A tiny fixture language: matches are [id, roundId, position, [entryA, entryB], winnerIndex | 'bye' | null].
// winnerIndex 0/1 decides by votes (one vote for that side); 'wo0'/'wo1' a walkover to that side; null undecided.
function build(roundDefs, matchDefs, entryRows) {
  const rounds = roundDefs.map(([id, position, phase = 'main']) => ({
    id,
    position,
    kind: 'pair',
    phase,
  }));
  const matches = [];
  const slots = [];
  const votes = [];
  for (const [id, roundId, position, pair, outcome] of matchDefs) {
    const extra = {};
    if (outcome === 'bye') extra.result_kind = 'bye';
    else if (typeof outcome === 'string' && outcome.startsWith('wo')) {
      extra.result_kind = 'walkover';
      extra.walkover_winner_position = Number(outcome.slice(2)) + 1;
    } else if (outcome === 0 || outcome === 1) extra.result_kind = 'votes';
    matches.push({ id, round_id: roundId, position, confirmed_at: null, ...extra });
    pair.forEach((entryId, i) => {
      slots.push({ id: `${id}-${i}`, match_id: id, position: i + 1, entry_id: entryId });
    });
    if (outcome === 0 || outcome === 1) votes.push({ match_id: id, slot_id: `${id}-${outcome}` });
  }
  const entries = entryRows.map((e) => (typeof e === 'string' ? { id: e, display_name: e } : e));
  return { bracket: deriveBracket({ rounds, matches, slots, votes, entries }), entries };
}

const event = {
  format: 'throwdown',
  name: 'Night',
  city: 'BSB',
  venue: 'Hall',
  event_date: '2026-11-27',
  is_test: false,
};
const named = (n, cafe = null, extra = {}) => ({ id: n, display_name: n, cafe, ...extra });

// 8 competitors, with a 3rd place match: A beats B in the final; C beats D for 3rd.
function eight({ thirdPlayed = true } = {}) {
  const r = [['r1', 1], ['r2', 2], ['r3', 3], ...(thirdPlayed ? [['r4', 4, 'third_place']] : [])];
  const m = [
    ['q1', 'r1', 1, ['A', 'H'], 0],
    ['q2', 'r1', 2, ['D', 'E'], 0],
    ['q3', 'r1', 3, ['C', 'F'], 0],
    ['q4', 'r1', 4, ['B', 'G'], 0],
    ['s1', 'r2', 1, ['A', 'D'], 0],
    ['s2', 'r2', 2, ['C', 'B'], 1],
    ['f', 'r3', 1, ['A', 'B'], 0],
    ...(thirdPlayed ? [['t', 'r4', 1, ['D', 'C'], 1]] : []),
  ];
  return build(
    r,
    m,
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => named(n, `${n} Cafe`)),
  );
}

describe('publishBlocker', () => {
  it('refuses an unstarted event, an event with no champion, and a pending 3rd place match', () => {
    expect(
      publishBlocker(deriveBracket({ rounds: [], matches: [], slots: [], votes: [], entries: [] })),
    ).toBe('not_started');
    const noChamp = build([['r1', 1]], [['f', 'r1', 1, ['A', 'B'], null]], ['A', 'B']);
    expect(publishBlocker(noChamp.bracket)).toBe('no_champion');
    const pending = build(
      [
        ['r1', 1],
        ['r2', 2],
        ['r3', 3, 'third_place'],
      ],
      [
        ['s1', 'r1', 1, ['A', 'B'], 0],
        ['s2', 'r1', 2, ['C', 'D'], 0],
        ['f', 'r2', 1, ['A', 'C'], 0],
        ['t', 'r3', 1, ['B', 'D'], null],
      ],
      ['A', 'B', 'C', 'D'],
    );
    expect(publishBlocker(pending.bracket)).toBe('third_place_pending');
    expect(() =>
      buildThrowdownPayload({ event, bracket: pending.bracket, entries: pending.entries }),
    ).toThrow(/not ready/);
    expect(publishBlocker(eight().bracket)).toBeNull();
  });
});

describe('buildThrowdownPayload: podium', () => {
  it('orders champion, runner-up, 3rd place winner, with name and cafe as the feed reads them', () => {
    const { bracket, entries } = eight();
    const p = buildThrowdownPayload({ event, bracket, entries });
    expect(p.podium).toEqual([
      { rank: 1, name: 'A', cafe: 'A Cafe' },
      { rank: 2, name: 'B', cafe: 'B Cafe' },
      { rank: 3, name: 'C', cafe: 'C Cafe' },
    ]);
  });

  it('puts both semi-final losers on the podium as joint 3rd when no 3rd place match was played', () => {
    const { bracket, entries } = eight({ thirdPlayed: false });
    const p = buildThrowdownPayload({ event, bracket, entries, scope: 'full' });
    expect(p.podium.map((x) => [x.rank, x.name])).toEqual([
      [1, 'A'],
      [2, 'B'],
      [3, 'D'],
      [3, 'C'],
    ]);
    // the next place after a two-way tie for 3rd is 5th
    expect(p.standings.find((s) => s.name === 'E').place).toBe(5);
  });

  it('is a podium of two when only a final was played', () => {
    const { bracket, entries } = build([['r1', 1]], [['f', 'r1', 1, ['A', 'B'], 1]], ['A', 'B']);
    const p = buildThrowdownPayload({ event, bracket, entries });
    expect(p.podium).toEqual([
      { rank: 1, name: 'B', cafe: null },
      { rank: 2, name: 'A', cafe: null },
    ]);
  });
});

describe('buildThrowdownPayload: standings by round reached', () => {
  it('places by the round lost in, sharing a place within a round, and labels the round reached', () => {
    const { bracket, entries } = eight();
    const p = buildThrowdownPayload({ event, bracket, entries, scope: 'full' });
    expect(p.standings.map((s) => [s.place, s.name, s.round])).toEqual([
      [1, 'A', 'Final'],
      [2, 'B', 'Final'],
      [3, 'C', 'Semi-finals'],
      [4, 'D', 'Semi-finals'],
      // equal places keep bracket order (match 1's loser first)
      [5, 'H', 'Quarter-finals'],
      [5, 'E', 'Quarter-finals'],
      [5, 'F', 'Quarter-finals'],
      [5, 'G', 'Quarter-finals'],
    ]);
  });

  it('treats a walkover loser as having lost that round, and a bye as no loss at all', () => {
    // 3 competitors: A has a bye in round 1 (m2), B v C round 1 ends in a walkover to C, then the final.
    const { bracket, entries } = build(
      [
        ['r1', 1],
        ['r2', 2],
      ],
      [
        ['m1', 'r1', 1, ['B', 'C'], 'wo1'],
        ['m2', 'r1', 2, ['A', null], 'bye'],
        ['f', 'r2', 1, ['A', 'C'], 0],
      ],
      ['A', 'B', 'C'],
    );
    const p = buildThrowdownPayload({ event, bracket, entries, scope: 'full' });
    expect(p.standings.map((s) => [s.place, s.name, s.round])).toEqual([
      [1, 'A', 'Final'],
      [2, 'C', 'Final'],
      [3, 'B', 'Semi-finals'],
    ]);
    // the bye did not make A lose, nor does A appear below the final
    expect(p.podium.map((x) => x.name)).toEqual(['A', 'C', 'B']);
  });

  it('lists a withdrawn podium finisher, leaves other withdrawn competitors out, and counts them in notListed', () => {
    const withdrawn = new Set(['C', 'D', 'H']);
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) =>
      named(n, null, { withdrawn: withdrawn.has(n) }),
    );
    const base = eight();
    const p = buildThrowdownPayload({ event, bracket: base.bracket, entries: rows, scope: 'full' });
    const names = p.standings.map((s) => s.name);
    expect(names).toContain('C'); // 3rd: on the podium, so always listed
    expect(p.podium.map((x) => x.name)).toContain('C');
    expect(names).not.toContain('D'); // 4th and withdrawn
    expect(names).not.toContain('H'); // quarter-final loser and withdrawn
    expect(p.notListed).toBe(2);
    // leaving them out does not move anyone else's place
    expect(p.standings.find((s) => s.name === 'E').place).toBe(5);
  });
});

describe('buildThrowdownPayload: keys and scope', () => {
  it('carries only the keys the feed and the archive whitelist know, and no score or time', () => {
    const { bracket, entries } = eight();
    const p = buildThrowdownPayload({ event, bracket, entries, scope: 'full' });
    const allowed = [
      'format',
      'eventName',
      'city',
      'venue',
      'eventDate',
      'competitors',
      'rounds',
      'podium',
      'standings',
      'notListed',
      'matches',
    ];
    expect(Object.keys(p).every((k) => allowed.includes(k))).toBe(true);
    expect(p).toMatchObject({
      format: 'throwdown',
      eventName: 'Night',
      city: 'BSB',
      venue: 'Hall',
      eventDate: '2026-11-27',
      competitors: 8,
      rounds: 3,
    });
    for (const row of [...p.podium, ...p.standings]) {
      expect(Object.keys(row).some((k) => ['correct', 'total', 'timeSecs'].includes(k))).toBe(
        false,
      );
      expect(Object.keys(row).some((k) => ['phone', 'email', 'id', 'entryId'].includes(k))).toBe(
        false,
      );
    }
  });

  it('publishes the podium alone by default and the standings only when asked', () => {
    const { bracket, entries } = eight();
    expect(buildThrowdownPayload({ event, bracket, entries }).standings).toBeUndefined();
    expect(
      buildThrowdownPayload({ event, bracket, entries, scope: 'nonsense' }).standings,
    ).toBeUndefined();
    expect(
      buildThrowdownPayload({ event, bracket, entries, scope: 'full' }).standings,
    ).toHaveLength(8);
    expect(DEFAULT_PUBLISH_SCOPE).toBe('full');
    expect(Object.keys(PUBLISH_SCOPE_NOTICE).sort()).toEqual(['full', 'podium']);
  });

  it('counts entries that never played in notListed (the full scope only)', () => {
    const { bracket, entries } = eight();
    const extra = [...entries, named('Z', null)];
    const full = buildThrowdownPayload({ event, bracket, entries: extra, scope: 'full' });
    expect(full.notListed).toBe(1);
    expect(full.competitors).toBe(8);
    expect(buildThrowdownPayload({ event, bracket, entries: extra }).notListed).toBeUndefined();
  });
});

describe('buildThrowdownPayload: matches (the knockout record)', () => {
  it('lists every played match, the 3rd place match included, as names and cafes with a winner flag and nothing else', () => {
    const { bracket, entries } = eight();
    const p = buildThrowdownPayload({ event, bracket, entries, scope: 'full' });
    expect(p.matches).toHaveLength(8);
    expect(p.matches.at(-1)).toEqual({
      round: '3rd place',
      sides: [
        { name: 'D', cafe: 'D Cafe', winner: false },
        { name: 'C', cafe: 'C Cafe', winner: true },
      ],
    });
    for (const m of p.matches) {
      expect(m.sides.filter((s) => s.winner)).toHaveLength(1);
      expect(Object.keys(m).sort()).toEqual(['round', 'sides']);
      for (const s of m.sides) expect(Object.keys(s).sort()).toEqual(['cafe', 'name', 'winner']);
    }
  });

  it('leaves out a walkover and a bye, which were not played', () => {
    const { bracket, entries } = build(
      [
        ['r1', 1],
        ['r2', 2],
      ],
      [
        ['m1', 'r1', 1, ['B', 'C'], 'wo1'],
        ['m2', 'r1', 2, ['A', null], 'bye'],
        ['f', 'r2', 1, ['A', 'C'], 0],
      ],
      ['A', 'B', 'C'],
    );
    const p = buildThrowdownPayload({ event, bracket, entries, scope: 'full' });
    expect(p.matches).toHaveLength(1);
    expect(p.matches[0].round).toBe('Final');
  });

  it('never names a withdrawn competitor the standings leave out, in any match', () => {
    const { bracket, entries } = eight();
    // H lost a round-one match and withdrew: not a podium finisher, so listed nowhere (counted in notListed)
    const other = entries.map((e) => (e.id === 'H' ? { ...e, withdrawn: true } : e));
    const q = buildThrowdownPayload({ event, bracket, entries: other, scope: 'full' });
    expect(q.standings.map((s) => s.name)).not.toContain('H');
    // the matches H played are gone, nobody else's are
    expect(q.matches.every((m) => m.sides.every((s) => s.name !== 'H'))).toBe(true);
    expect(q.matches.length).toBe(7);
  });

  it('is only in the full scope: a podium-only publish carries no matches', () => {
    const { bracket, entries } = eight();
    expect(
      buildThrowdownPayload({ event, bracket, entries, scope: 'podium' }).matches,
    ).toBeUndefined();
  });
});

describe('describePublishError', () => {
  it('says plainly that a test event is refused, chosen by the database’s own words', () => {
    expect(
      describePublishError({
        message: 'publish_event_results: refusing to publish a test event (x)',
      }),
    ).toMatch(/test event/i);
    expect(describePublishError({ message: 'publish_event_results: event x not found' })).toMatch(
      /could not be found/,
    );
    expect(describePublishError({ message: 'boom' })).toMatch(/try again/);
  });
});
