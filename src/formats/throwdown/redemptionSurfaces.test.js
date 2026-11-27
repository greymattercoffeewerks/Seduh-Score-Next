// @vitest-environment jsdom
// TD.3 definition of done: a redemption round (a POOL of 2 to 4 brewers in one match) renders on EVERY surface without a
// hole ("undefined", "null", "TBD") and without a pair-shaped assumption, and an event without the module leaves no trace
// of it on any of them. The defect class (spec section 4): the legacy build assumed every round is pair-shaped, so groups
// rendered `undefined`/`TBD` in five places. This file renders one event through each surface the format has.
import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { bracketRows, payloadFor, namesUpTo } from './projectorFixtures.js';
import { createThrowdownViewerBody } from './viewerBody.js';
import { throwdownPages } from './projectorScreens.js';
import { buildResultsView } from './resultsScreen.js';
import { buildRedemptionView } from './redemptionScreen.js';
import { matchLogCsv } from './recordsExport.js';
import { deriveThrowdownPhases } from './runSheet.js';
import { buildThrowdownPayload, publishBlocker } from './resultsPublishing.js';
import { redemptionRounds, hasRedemptionRound } from './redemption.js';

// 12 players. Round 1: P1 beats P2, P3 beats P4 ... (six matches, slot 1 wins). Redemption: the six losers in two groups.
const names = namesUpTo(12);
const round1 = {
  phase: 'main',
  matches: Array.from({ length: 6 }, (_, i) => ({
    a: `P${i * 2 + 1}`,
    b: `P${i * 2 + 2}`,
    result: [2, 1],
    at: `2026-11-27T10:0${i}:00Z`,
  })),
};
const redemption = {
  phase: 'redemption',
  kind: 'pool',
  matches: [
    { sides: ['P2', 'P4', 'P6'], result: [2, 1, 0], at: '2026-11-27T11:00:00Z' },
    { sides: ['P8', 'P10', 'P12'] },
  ],
};
const description = { names, rounds: [round1, redemption] };

const HOLES = /undefined|\bnull\b|TBD|NaN|\[object/;
const textOf = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const pageText = (page) => {
  const host = document.createElement('div');
  host.append(...page.render());
  return textOf(host);
};

describe('a redemption pool through every surface', () => {
  const payload = payloadFor(description);
  const bracket = deriveBracket(bracketRows(description));

  it('the live payload marks a group as a pool, and a decided group carries its winner and counts', () => {
    const round = payload.rounds.find((r) => r.phase === 'redemption');
    expect(round.matches).toHaveLength(2);
    expect(round.matches.every((m) => m.pool === true)).toBe(true);
    expect(round.matches[0].sides.map((s) => [s.name, s.votes, s.winner])).toEqual([
      ['P2', 2, true],
      ['P4', 1, false],
      ['P6', 0, false],
    ]);
    expect(round.matches[1].sides.map((s) => s.name)).toEqual(['P8', 'P10', 'P12']);
    // the first undecided playable match is the second group
    expect(payload.upNext.pool).toBe(true);
    expect(payload.upNext.roundLabel).toBe('Redemption');
  });

  it('the phone lists each group, says who won and how the votes fell, and has no hole', () => {
    const root = document.createElement('div');
    createThrowdownViewerBody().renderBody(root, payload);
    const text = textOf(root);
    expect(text).toContain('Group 1: P2, P4, P6');
    expect(text).toContain('P2 wins · 2 to 1 to 0');
    expect(text).toContain('Group 2: P8, P10, P12');
    expect(text).toContain('Being decided');
    expect(text).not.toMatch(HOLES);
  });

  it('the projector draws the groups, not a duel, on every page, with no hole', () => {
    const rendered = throwdownPages(payload).map((page) => ({ page, text: pageText(page) }));
    for (const { text } of rendered) expect(text).not.toMatch(HOLES);
    const next = rendered.find((r) => r.page.kind === 'next');
    expect(next.text).toContain('Up next');
    expect(next.text).toContain('P8');
    expect(next.text).toContain('P10');
    expect(next.text).toContain('P12');
    expect(next.text).not.toMatch(/ vs /);
    const roundPage = rendered.find((r) => r.page.label.startsWith('Redemption'));
    expect(roundPage.text).toContain('the groups');
    expect(roundPage.text).toContain('Group 1');
    expect(roundPage.text).toContain('P2');
    expect(roundPage.text).toContain('P12');
    const latest = rendered.find((r) => r.page.kind === 'latest');
    expect(latest.text).toContain('P2 won Group 1');
    expect(latest.text).toContain('2 to 1 to 0');
  });

  it('the bracket marks the round a pool round and names each group', () => {
    const round = bracket.rounds.find((r) => r.phase === 'redemption');
    expect(round.kind).toBe('pool');
    expect(round.label).toBe('Redemption');
    expect(round.matches.map((m) => m.isPool)).toEqual([true, true]);
    expect(round.matches[0].winnerSlotId).toBe('r2m1s1');
    expect(round.matches[1].playable).toBe(true);
    expect(hasRedemptionRound(bracket)).toBe(true);
  });

  it('the Redemption page lists who is in, the groups, and the winner, with no hole', () => {
    const view = buildRedemptionView(
      { id: 'ev', name: 'Throwdown Night', is_test: false },
      { bracket, settings: { modules: { redemption: { group_size: 3, cap: 0, feed: [1] } } } },
    );
    const text = textOf(view);
    expect(text).toContain('Redemption round');
    expect(text).toContain('The brewers who lost in Round 1');
    expect(text).toContain('Who is in (6)');
    expect(text).toContain('Group 1');
    expect(text).toContain('Winner');
    expect(text).toContain('Being voted');
    expect(text).not.toMatch(HOLES);
    const model = redemptionRounds(bracket)[0];
    expect(model).toMatchObject({ groupCount: 2, status: 'voting', feedLabel: 'Round 1' });
    expect(model.entrants).toEqual(['P10', 'P12', 'P2', 'P4', 'P6', 'P8']);
  });

  it('the results page carries the group as a row, and the match log names every brewer', () => {
    const view = buildResultsView({ name: 'Night', is_test: false }, bracket, null, []);
    const text = textOf(view);
    expect(text).toContain('Group 1: P2, P4 and P6');
    expect(text).toContain('2 to 1 to 0');
    expect(text).not.toMatch(HOLES);
    const csv = matchLogCsv(bracket);
    expect(csv).toContain('Redemption');
    // a CSV row used to have two competitor columns: a group of three must not drop the third brewer. P6 lost Round 1 too,
    // so it is the group's THIRD brewer (Competitor C) that proves the column exists
    expect(csv).toContain('Competitor C');
    const header = csv
      .split('\n')
      .find((line) => line.includes('Competitor A'))
      .split(',');
    const groupRow = csv.split('\n').find((line) => line.startsWith('Redemption,1,'));
    expect(groupRow.split(',')[header.indexOf('Competitor C')]).toBe('P6');
    expect(groupRow.split(',')[header.indexOf('Votes C')]).toBe('0');
    expect(csv).not.toMatch(HOLES);
  });

  it('the run sheet makes the redemption round a phase of its own', () => {
    const phases = deriveThrowdownPhases({
      eventId: 'ev',
      settings: { judge_count: 3, third_place: true },
      draw: { mode: 'random', seed: 's' },
      entries: names.map((n) => ({ id: `e${n}`, display_name: n })),
      bracket,
    });
    const round = phases.find((p) => p.label === 'Redemption');
    expect(round).toMatchObject({ status: 'in_progress', count: '1 of 2 groups decided' });
    const toCome = phases.find((p) => p.id === 'rounds-to-come');
    expect(toCome.blockedReason).toContain('Redemption');
  });

  it('an unfinished event publishes nothing, redemption or not', () => {
    expect(publishBlocker(bracket)).toBe('no_champion');
    expect(() =>
      buildThrowdownPayload({ event: { name: 'x' }, bracket, entries: [], scope: 'full' }),
    ).toThrow();
  });
});

describe('with the module off, nothing of it appears anywhere', () => {
  const off = {
    names: namesUpTo(12),
    rounds: [round1, { phase: 'main', matches: [{ a: 'P1', b: 'P3' }] }],
  };
  const payload = payloadFor(off);
  const bracket = deriveBracket(bracketRows(off));

  it('no pool key, no redemption round, no redemption words in the payload', () => {
    expect(JSON.stringify(payload)).not.toMatch(/pool|redemption|group/i);
  });

  it('no surface says redemption or group', () => {
    const phone = document.createElement('div');
    createThrowdownViewerBody().renderBody(phone, payload);
    const projector = throwdownPages(payload).map(pageText);
    const results = textOf(buildResultsView({ name: 'Night', is_test: false }, bracket, null, []));
    const phases = deriveThrowdownPhases({
      eventId: 'ev',
      settings: { judge_count: 3, third_place: true },
      draw: null,
      entries: [],
      bracket,
    });
    for (const text of [textOf(phone), ...projector, results, JSON.stringify(phases)]) {
      expect(text).not.toMatch(/redemption|group/i);
    }
    expect(hasRedemptionRound(bracket)).toBe(false);
    expect(redemptionRounds(bracket)).toEqual([]);
  });

  it('the Redemption page of such an event says so in one sentence', () => {
    const view = buildRedemptionView(
      { id: 'ev', name: 'Night', is_test: false },
      { bracket, settings: { modules: {} } },
    );
    expect(textOf(view)).toContain('This event has no redemption round.');
  });
});
