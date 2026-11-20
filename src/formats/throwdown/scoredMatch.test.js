import { describe, it, expect } from 'vitest';
import { deriveBracket } from './bracket.js';
import { presetLines } from '../../core/scoresheet.js';
import {
  scoringContext,
  scoredView,
  cupsForMatch,
  parseDraft,
  draftFromSheet,
  auditRule,
} from './scoredMatch.js';

const lines = presetLines('latte_art_v1');
const cfg = { preset: 'latte_art_v1', lines, cups: { final: 2, third_place: 1 } };
const entries = ['A', 'B'].map((n) => ({ id: `e${n}`, display_name: n }));
const rows = (extra = {}) => ({
  rounds: [{ id: 'r1', position: 1, kind: 'pair', phase: 'main' }],
  matches: [
    {
      id: 'm1',
      round_id: 'r1',
      position: 1,
      result_kind: null,
      confirmed_at: null,
      walkover_winner_position: null,
    },
  ],
  slots: [
    { id: 's1', match_id: 'm1', position: 1, entry_id: 'eA' },
    { id: 's2', match_id: 'm1', position: 2, entry_id: 'eB' },
  ],
  votes: [],
  entries,
  ...extra,
});
// one complete paper sheet (both cups), every line scored `points` or its max if lower
const full = (slot, seat, points) =>
  [1, 2].flatMap((cup) =>
    lines.map((l) => ({
      match_id: 'm1',
      slot_id: slot,
      judge_seat: seat,
      cup,
      line_key: l.key,
      points: Math.min(points, l.max),
    })),
  );
const data = (scoreSheets, extra = {}) => ({
  settings: { judge_count: 3, modules: { scoresheet: cfg } },
  scoreSheets,
  scoreDecisions: [],
  ...extra,
});
const matchOf = () => deriveBracket(rows()).rounds[0].matches[0];

describe('scoringContext', () => {
  it('is null when the module is off, so nothing is drawn', () => {
    expect(scoringContext({ settings: { judge_count: 3, modules: {} } })).toBeNull();
    expect(cupsForMatch(null, matchOf())).toBeNull();
  });
  it('knows the round role: the lone round is the Final with 2 cups', () => {
    expect(cupsForMatch(scoringContext(data([])), matchOf())).toBe(2);
  });
  it('leaves a round the setup does not name to taps', () => {
    const ctx = scoringContext({
      ...data([]),
      settings: { judge_count: 3, modules: { scoresheet: { ...cfg, cups: { third_place: 1 } } } },
    });
    expect(cupsForMatch(ctx, matchOf())).toBeNull();
  });
});

describe('scoredView', () => {
  it('counts sheets in, and the match cannot be decided until all are in', () => {
    const ctx = scoringContext(data([...full('s1', 1, 3), ...full('s2', 1, 2)]));
    const view = scoredView(ctx, matchOf());
    expect(view.progress).toMatchObject({ done: 2, total: 6, complete: false });
    expect(view.decision).toBeNull();
  });
  it('a queued sheet counts and replaces the saved one for that seat', () => {
    const ctx = scoringContext(data([...full('s1', 1, 3), ...full('s2', 1, 2)]));
    const zeros = draftFromSheet({}, { lines, cups: 2 });
    for (const cup of Object.values(zeros)) for (const k of Object.keys(cup)) cup[k] = '0';
    const queued = parseDraft(zeros, { lines, cups: 2 }).sheet;
    const view = scoredView(ctx, matchOf(), new Map([['s1:1', queued]]));
    expect(view.totals[0].bySeat[1]).toBe(0);
    expect(view.progress.done).toBe(2);
  });
  it('decides on total points once every sheet is in, and names the rule', () => {
    const all = [1, 2, 3].flatMap((seat) => [...full('s1', seat, 4), ...full('s2', seat, 3)]);
    const view = scoredView(scoringContext(data(all)), matchOf());
    expect(view.progress.complete).toBe(true);
    expect(view.decision).toMatchObject({ winner: 1, rule: 'total' });
    expect(auditRule(view)).toBe('total');
  });
  it('decides on more judges when the totals are level (rule b)', () => {
    const all = [
      ...[3, 3, 0].flatMap((v, i) => full('s1', i + 1, v)),
      ...[2, 2, 2].flatMap((v, i) => full('s2', i + 1, v)),
    ];
    const view = scoredView(scoringContext(data(all)), matchOf());
    expect(view.decision).toMatchObject({ winner: 1, rule: 'judges', totals: [72, 72] });
    expect(auditRule(view)).toBe('judges');
  });
  it('asks the organiser when level, and reports their recorded pick as the rule', () => {
    const all = [1, 2, 3].flatMap((seat) => [...full('s1', seat, 3), ...full('s2', seat, 3)]);
    const level = scoredView(scoringContext(data(all)), matchOf());
    expect(level.decision).toMatchObject({ winner: null, rule: 'organiser_needed' });
    const picked = scoredView(
      scoringContext(data(all, { scoreDecisions: [{ match_id: 'm1', winner_position: 2 }] })),
      matchOf(),
    );
    expect(auditRule(picked)).toBe('organiser');
  });
});

describe('parseDraft', () => {
  const draft = (v) => ({ 1: Object.fromEntries(lines.map((l) => [l.key, v])) });
  it('accepts whole digits only and is incomplete on blanks, decimals and signs', () => {
    expect(parseDraft(draft('3'), { lines, cups: 1 }).complete).toBe(true);
    for (const bad of ['', ' ', '2.0', '-1', '1e1', 'x', '100', '007']) {
      expect(parseDraft(draft(bad), { lines, cups: 1 }).complete).toBe(false);
    }
  });
});

describe('bracket winner for a scored match', () => {
  it('takes the database winner (td_match_results), not a tally of its empty vote rows', () => {
    const b = deriveBracket(
      rows({
        matches: [
          {
            id: 'm1',
            round_id: 'r1',
            position: 1,
            result_kind: 'scores',
            confirmed_at: 't',
            walkover_winner_position: null,
          },
        ],
        scoreWinners: new Map([['m1', 's2']]),
      }),
    );
    expect(b.rounds[0].matches[0].sides.map((s) => s.winner)).toEqual([false, true]);
    expect(b.champion).toBe('B');
    expect(b.rounds[0].matches[0].sides.map((s) => s.votes)).toEqual([null, null]);
  });
});
