import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assembleBtcLivePayload,
  buildBtcLivePayload,
  publishBtcLive,
  enqueueBtcLive,
  BTC_LIVE_OPERATION,
} from './liveSession.js';
import { btcOutboxHandlers } from './outboxHandlers.js';
import { listPendingOperations, flushOutbox, onOperationDropped } from '../../core/outbox.js';
import { _clearAllForTests } from '../../core/db.js';

// ---------- fixtures for the pure assembler ----------

const teams = [
  { id: 't1', name: 'Alpha' },
  { id: 't2', name: 'Beta' },
  { id: 't3', name: 'Gamma' },
  { id: 't4', name: 'Delta' },
];
const judges = [
  { id: 'j1', name: 'Jo' },
  { id: 'j2', name: 'Kim' },
  { id: 'j3', name: 'Lee' },
];

const match = (id, over = {}) => ({
  id,
  event_id: 'ev1',
  round: 'preliminary',
  team1_id: 't1',
  team2_id: 't2',
  status: 'confirmed',
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:30:00.000Z',
  tiebreak_winner_team_id: null,
  tiebreak_reason: null,
  ...over,
});

// 8 tokens to 7, the win bonus (+5) to team 1: 13 to 7, exactly as btc_match_scores computes it.
const score = (matchId, over = {}) => ({
  match_id: matchId,
  status: 'confirmed',
  round: 'preliminary',
  team1_id: 't1',
  team2_id: 't2',
  team1_tokens: 8,
  team2_tokens: 7,
  team1_total: 13,
  team2_total: 7,
  ...over,
});

const totalsRow = (matchId, over = {}) => ({
  match_id: matchId,
  fastest_team_id: null,
  team1_signature_beverage: false,
  team2_signature_beverage: false,
  ...over,
});

const standing = (teamId, teamName, position, played, wins, totalPoints) => ({
  item: { teamId, teamName, played, wins, totalPoints },
  position,
});

const slot = (round, label, team1, team2, matchId, seeds = [null, null]) => ({
  id: `s-${label}`,
  event_id: 'ev1',
  round,
  slot_label: label,
  seed_1: seeds[0],
  seed_2: seeds[1],
  team1_id: team1,
  team2_id: team2,
  match_id: matchId,
});

const entry = (slotRow, matchRow = null) => ({ slot: slotRow, match: matchRow });

const event = { id: 'ev1', org_id: 'org1', name: 'Grey Matter BTC 2026', is_test: false };

function assemble(over = {}) {
  return assembleBtcLivePayload({
    event,
    teams,
    judges,
    matches: [],
    matchJudges: [],
    scores: [],
    totals: [],
    standings: [],
    bracketEntries: [],
    ...over,
  });
}

describe('assembleBtcLivePayload', () => {
  describe('phase and progress', () => {
    it('is "setup" before any match or bracket exists, and carries the event name', () => {
      const payload = assemble();
      expect(payload.phase).toBe('setup');
      expect(payload.eventName).toBe('Grey Matter BTC 2026');
      expect(payload.progress).toEqual({ played: 0, total: 0 });
      expect(payload.upNext).toBeNull();
      expect(payload.thenNext).toBeNull();
      expect(payload.recentResults).toEqual([]);
      expect(payload.bracket).toBeNull();
      expect(payload.podium).toBeNull();
    });

    it('is "preliminary" once matches exist, counting only preliminary matches in progress', () => {
      const matches = [
        match('m1'),
        match('m2', { status: 'pending' }),
        match('qf', { round: 'quarterfinal' }),
      ];
      const payload = assemble({ matches });
      expect(payload.phase).toBe('preliminary');
      expect(payload.progress).toEqual({ played: 1, total: 2 });
    });

    it('is "knockout" while a bracket exists without a complete podium, and "complete" once decided', () => {
      const final = match('mf', { round: 'final' });
      const third = match('m3', { round: 'third_place', team1_id: 't3', team2_id: 't4' });
      const entries = [
        entry(slot('final', 'final', 't1', 't2', 'mf'), final),
        entry(slot('third_place', 'third', 't3', 't4', 'm3'), third),
      ];
      const pending = assemble({ matches: [], bracketEntries: entries });
      expect(pending.phase).toBe('knockout');

      const decided = assemble({
        matches: [final, third],
        bracketEntries: entries,
        scores: [
          score('mf', { round: 'final' }),
          score('m3', { round: 'third_place', team1_id: 't3', team2_id: 't4' }),
        ],
      });
      expect(decided.phase).toBe('complete');
    });
  });

  describe('standings', () => {
    it('lists every team ranked, with ties sharing a position, in the payload names', () => {
      const payload = assemble({
        standings: [
          standing('t1', 'Alpha', 1, 2, 2, 26),
          standing('t2', 'Beta', 2, 2, 1, 14),
          standing('t3', 'Gamma', 2, 2, 1, 14),
          standing('t4', 'Delta', 4, 0, 0, 0),
        ],
      });
      expect(payload.standings).toEqual([
        { position: 1, teamName: 'Alpha', played: 2, wins: 2, points: 26 },
        { position: 2, teamName: 'Beta', played: 2, wins: 1, points: 14 },
        { position: 2, teamName: 'Gamma', played: 2, wins: 1, points: 14 },
        { position: 4, teamName: 'Delta', played: 0, wins: 0, points: 0 },
      ]);
    });

    it('turns counts that arrive as strings (a bigint count) into numbers', () => {
      const payload = assemble({ standings: [standing('t1', 'Alpha', 1, '3', '2', '26')] });
      expect(payload.standings[0]).toEqual({
        position: 1,
        teamName: 'Alpha',
        played: 3,
        wins: 2,
        points: 26,
      });
    });
  });

  describe('up next', () => {
    const standings = [standing('t1', 'Alpha', 1, 0, 0, 0), standing('t2', 'Beta', 2, 0, 0, 0)];

    it("is the next two unconfirmed matches in play order, with judges and each team's standings place", () => {
      const matches = [
        match('mdone', { status: 'confirmed', created_at: '2026-10-01T09:00:00.000Z' }),
        match('m2', { status: 'pending', created_at: '2026-10-01T10:05:00.000Z' }),
        match('m1', {
          status: 'scoring',
          team1_id: 't2',
          team2_id: 't1',
          created_at: '2026-10-01T10:00:00.000Z',
        }),
        match('m3', { status: 'pending', created_at: '2026-10-01T10:10:00.000Z' }),
      ];
      const matchJudges = [
        { match_id: 'm1', judge_id: 'j1' },
        { match_id: 'm1', judge_id: 'j2' },
        { match_id: 'm1', judge_id: 'j3' },
      ];
      const payload = assemble({ matches, matchJudges, standings });
      expect(payload.upNext).toEqual({
        matchId: 'm1',
        round: 'preliminary',
        roundLabel: 'Preliminary',
        status: 'scoring',
        teams: [
          { name: 'Beta', place: 2, seed: null },
          { name: 'Alpha', place: 1, seed: null },
        ],
        judges: ['Jo', 'Kim', 'Lee'],
      });
      expect(payload.thenNext.matchId).toBe('m2');
      expect(payload.thenNext.judges).toEqual([]);
    });

    it('plays preliminary, quarterfinal, semifinal, THIRD PLACE, then the final, wherever each was created', () => {
      const matches = [
        match('final', {
          round: 'final',
          status: 'pending',
          created_at: '2026-10-01T10:01:00.000Z',
        }),
        match('third', {
          round: 'third_place',
          status: 'pending',
          created_at: '2026-10-01T10:02:00.000Z',
        }),
        match('sf', {
          round: 'semifinal',
          status: 'pending',
          created_at: '2026-10-01T10:03:00.000Z',
        }),
        match('qf', {
          round: 'quarterfinal',
          status: 'pending',
          created_at: '2026-10-01T10:04:00.000Z',
        }),
        match('pre', {
          round: 'preliminary',
          status: 'pending',
          created_at: '2026-10-01T10:05:00.000Z',
        }),
      ];
      const order = [];
      let remaining = [...matches];
      while (remaining.length > 0) {
        const payload = assemble({ matches: remaining, standings });
        order.push(payload.upNext.matchId);
        remaining = remaining.filter((m) => m.id !== payload.upNext.matchId);
      }
      expect(order).toEqual(['pre', 'qf', 'sf', 'third', 'final']);
    });

    it('orders matches created at the same instant by id, whatever order the rows arrive in (demo data)', () => {
      const same = '2026-10-01T10:00:00.000Z';
      const rows = ['q2', 'q0', 'q1'].map((id) =>
        match(id, { status: 'pending', created_at: same }),
      );
      const forward = assemble({ matches: rows, standings });
      const reversed = assemble({ matches: [...rows].reverse(), standings });
      expect([forward.upNext.matchId, forward.thenNext.matchId]).toEqual(['q0', 'q1']);
      expect([reversed.upNext.matchId, reversed.thenNext.matchId]).toEqual(['q0', 'q1']);
    });

    it('is null when every match is confirmed', () => {
      const payload = assemble({ matches: [match('m1')], scores: [score('m1')], standings });
      expect(payload.upNext).toBeNull();
      expect(payload.thenNext).toBeNull();
    });

    it('names an unknown team and judge rather than failing', () => {
      const payload = assemble({
        matches: [match('m1', { status: 'pending', team1_id: 'gone' })],
        matchJudges: [{ match_id: 'm1', judge_id: 'gone' }],
        standings,
      });
      expect(payload.upNext.teams[0]).toEqual({ name: 'Unknown team', place: null, seed: null });
      expect(payload.upNext.judges).toEqual(['Unknown judge']);
    });
  });

  describe('seeds', () => {
    // generate_btc_bracket gives teams tied on a place distinct seeds (a team-id tie-break), so the standings
    // place is not the seed: t1 and t2 are both 2nd here, and the bracket seeded them 2 and 3.
    const tied = [
      standing('t1', 'Alpha', 2, 3, 1, 40),
      standing('t2', 'Beta', 2, 3, 1, 40),
      standing('t3', 'Gamma', 1, 3, 3, 90),
      standing('t4', 'Delta', 4, 3, 0, 10),
    ];
    const qf = (id, over = {}) => match(id, { round: 'quarterfinal', status: 'pending', ...over });

    it('gives a knockout match each team’s seed from the bracket, which differs from the shared place', () => {
      const m = qf('mq1', { team1_id: 't1', team2_id: 't2' });
      const payload = assemble({
        matches: [m],
        standings: tied,
        bracketEntries: [entry(slot('quarterfinal', 'qf1', 't1', 't2', 'mq1', [2, 3]), m)],
      });
      expect(payload.upNext.teams).toEqual([
        { name: 'Alpha', place: 2, seed: 2 },
        { name: 'Beta', place: 2, seed: 3 },
      ]);
    });

    it('a team keeps its quarterfinal seed in the semifinal, which carries no seeds of its own', () => {
      const sf = qf('ms1', { round: 'semifinal', team1_id: 't3', team2_id: 't1' });
      const payload = assemble({
        matches: [sf],
        standings: tied,
        bracketEntries: [
          entry(slot('quarterfinal', 'qf1', 't3', 't4', 'mq1', [1, 8])),
          entry(slot('quarterfinal', 'qf2', 't1', 't2', 'mq2', [2, 3])),
          entry(slot('semifinal', 'sf1', 't3', 't1', 'ms1'), sf),
        ],
      });
      expect(payload.upNext.teams.map((t) => t.seed)).toEqual([1, 2]);
    });

    it('is null for a team the bracket did not seed, and before any bracket exists', () => {
      const m = qf('mq1', { team1_id: 't1', team2_id: 't2' });
      const noBracket = assemble({ matches: [m], standings: tied });
      expect(noBracket.upNext.teams.map((t) => t.seed)).toEqual([null, null]);
      const oneSeeded = assemble({
        matches: [m],
        standings: tied,
        bracketEntries: [entry(slot('quarterfinal', 'qf1', 't1', null, 'mq1', [2, null]), m)],
      });
      expect(oneSeeded.upNext.teams.map((t) => t.seed)).toEqual([2, null]);
    });

    it('takes seeds from the quarterfinal slots only: a later slot carrying one cannot override it', () => {
      const sf = qf('ms1', { round: 'semifinal', team1_id: 't3', team2_id: 't1' });
      const payload = assemble({
        matches: [sf],
        standings: tied,
        bracketEntries: [
          entry(slot('quarterfinal', 'qf1', 't3', 't4', 'mq1', [1, 8])),
          entry(slot('semifinal', 'sf1', 't3', 't1', 'ms1', [7, 7]), sf),
        ],
      });
      expect(payload.upNext.teams.map((t) => [t.name, t.seed])).toEqual([
        ['Gamma', 1],
        ['Alpha', null],
      ]);
    });

    it('reads a seed the database returns as text (numeric columns can) as a number', () => {
      const m = qf('mq1', { team1_id: 't1', team2_id: 't2' });
      const payload = assemble({
        matches: [m],
        standings: tied,
        bracketEntries: [entry(slot('quarterfinal', 'qf1', 't1', 't2', 'mq1', ['2', '3']), m)],
      });
      expect(payload.upNext.teams.map((t) => t.seed)).toEqual([2, 3]);
    });

    it('puts the seed on the match after next as well', () => {
      const m1 = qf('mq1', { team1_id: 't3', team2_id: 't4' });
      const m2 = qf('mq2', {
        team1_id: 't1',
        team2_id: 't2',
        created_at: '2026-10-01T10:05:00.000Z',
      });
      const payload = assemble({
        matches: [m1, m2],
        standings: tied,
        bracketEntries: [
          entry(slot('quarterfinal', 'qf1', 't3', 't4', 'mq1', [1, 8]), m1),
          entry(slot('quarterfinal', 'qf2', 't1', 't2', 'mq2', [2, 3]), m2),
        ],
      });
      expect(payload.thenNext.teams.map((t) => t.seed)).toEqual([2, 3]);
    });
  });

  describe('recent results', () => {
    it('is the three newest confirmed matches, newest first, by when they were last confirmed', () => {
      const matches = [
        match('a', { updated_at: '2026-10-01T10:00:00.000Z' }),
        match('b', { updated_at: '2026-10-01T10:40:00.000Z' }),
        match('c', { updated_at: '2026-10-01T10:20:00.000Z' }),
        match('d', { updated_at: '2026-10-01T10:30:00.000Z' }),
        match('e', { status: 'pending', updated_at: '2026-10-01T11:00:00.000Z' }),
      ];
      const scores = ['a', 'b', 'c', 'd', 'e'].map((id) => score(id));
      const payload = assemble({
        matches,
        scores,
        totals: scores.map((s) => totalsRow(s.match_id)),
      });
      expect(payload.recentResults.map((r) => r.matchId)).toEqual(['b', 'd', 'c']);
      expect(payload.recentResults[0].confirmedAt).toBe('2026-10-01T10:40:00.000Z');
    });

    it('breaks a result down: tokens, the win bonus, the fastest bonus, and the winner', () => {
      const matches = [match('m1')];
      // Team 2 was fastest: 7 tokens + 2 = 9.
      const payload = assemble({
        matches,
        scores: [score('m1', { team2_total: 9 })],
        totals: [totalsRow('m1', { fastest_team_id: 't2' })],
      });
      const [result] = payload.recentResults;
      expect(result).toMatchObject({
        matchId: 'm1',
        round: 'preliminary',
        roundLabel: 'Preliminary',
        level: false,
        tiebreak: null,
      });
      expect(result.teams).toEqual([
        {
          name: 'Alpha',
          tokens: 8,
          total: 13,
          bonuses: { win: true, fastest: false, signature: false },
          winner: true,
        },
        {
          name: 'Beta',
          tokens: 7,
          total: 9,
          bonuses: { win: false, fastest: true, signature: false },
          winner: false,
        },
      ]);
    });

    it('gives the win bonus to neither side when the tokens are level (it needs strictly more)', () => {
      const payload = assemble({
        matches: [match('m1', { round: 'quarterfinal' })],
        scores: [
          score('m1', {
            round: 'quarterfinal',
            team1_tokens: 30,
            team2_tokens: 30,
            team1_total: 30,
            team2_total: 30,
          }),
        ],
        totals: [totalsRow('m1')],
      });
      expect(payload.recentResults[0].teams.map((t) => t.bonuses.win)).toEqual([false, false]);
    });

    it('counts a signature beverage only outside the preliminary round, as the view does', () => {
      const prelim = assemble({
        matches: [match('m1')],
        scores: [score('m1')],
        totals: [totalsRow('m1', { team1_signature_beverage: true })],
      });
      expect(prelim.recentResults[0].teams[0].bonuses.signature).toBe(false);

      const knockout = assemble({
        matches: [match('m1', { round: 'quarterfinal' })],
        // 8 tokens + 5 for the win + 2 for the signature beverage.
        scores: [score('m1', { round: 'quarterfinal', team1_total: 15 })],
        totals: [totalsRow('m1', { team1_signature_beverage: true })],
      });
      expect(knockout.recentResults[0].teams[0].bonuses.signature).toBe(true);
      expect(knockout.recentResults[0].teams[1].bonuses.signature).toBe(false);
    });

    it('names team 2 the winner, with the win bonus, when it takes more tokens', () => {
      const payload = assemble({
        matches: [match('m1')],
        scores: [
          score('m1', { team1_tokens: 7, team2_tokens: 8, team1_total: 7, team2_total: 13 }),
        ],
        totals: [totalsRow('m1')],
      });
      const [result] = payload.recentResults;
      expect(result.teams.map((t) => t.winner)).toEqual([false, true]);
      expect(result.teams.map((t) => t.bonuses.win)).toEqual([false, true]);
      expect(result.level).toBe(false);
    });

    it('shows the total without a breakdown when the labels do not explain it', () => {
      // No totals row at all (a read that missed it): 13 cannot be explained as 8 + the win bonus.
      const missing = assemble({
        matches: [match('m1')],
        scores: [score('m1')],
        totals: [],
      });
      expect(missing.recentResults[0].teams.map((t) => [t.total, t.bonuses])).toEqual([
        [13, null],
        [7, null],
      ]);
      // A totals row that disagrees with the totals (the reads straddled a confirm).
      const stale = assemble({
        matches: [match('m1')],
        scores: [score('m1')],
        totals: [totalsRow('m1', { fastest_team_id: 't2' })],
      });
      // Team 1's labels do add up (8 + 5 = 13) but team 2's do not: the card shows neither breakdown.
      expect(stale.recentResults[0].teams.map((t) => t.bonuses)).toEqual([null, null]);
      expect(stale.recentResults[0].teams[1].total).toBe(7);
    });

    it('compares tokens and totals as numbers when they arrive as strings (10 beats 9)', () => {
      const payload = assemble({
        matches: [match('m1')],
        scores: [
          score('m1', {
            team1_tokens: '10',
            team2_tokens: '9',
            team1_total: '15',
            team2_total: '9',
          }),
        ],
        totals: [totalsRow('m1')],
      });
      const [result] = payload.recentResults;
      expect(result.teams.map((t) => t.winner)).toEqual([true, false]);
      expect(result.teams.map((t) => t.bonuses.win)).toEqual([true, false]);
      expect(result.teams.map((t) => t.tokens)).toEqual([10, 9]);
    });

    it('never defaults a winner when a total is missing or not a number', () => {
      const payload = assemble({
        matches: [match('m1')],
        scores: [score('m1', { team2_total: undefined })],
        totals: [totalsRow('m1')],
      });
      expect(payload.recentResults[0].teams.map((t) => t.winner)).toEqual([false, false]);
    });

    it('orders results the same way whatever order the rows arrive in, and equal times fall back to the id', () => {
      const rows = ['c', 'a', 'b'].map((id) =>
        match(id, { updated_at: '2026-10-01T10:00:00.000Z' }),
      );
      const scores = rows.map((m) => score(m.id));
      const totals = rows.map((m) => totalsRow(m.id));
      const forward = assemble({ matches: rows, scores, totals });
      const reversed = assemble({ matches: [...rows].reverse(), scores, totals });
      expect(forward.recentResults.map((r) => r.matchId)).toEqual(['a', 'b', 'c']);
      expect(reversed.recentResults.map((r) => r.matchId)).toEqual(['a', 'b', 'c']);
    });

    it('compares timestamps as instants: a fractional second is later than the whole second before it', () => {
      const whole = match('whole', { updated_at: '2026-10-01T10:00:00+00:00' });
      const fraction = match('fraction', { updated_at: '2026-10-01T10:00:00.5+00:00' });
      const payload = assemble({
        matches: [whole, fraction],
        scores: [score('whole'), score('fraction')],
        totals: [totalsRow('whole'), totalsRow('fraction')],
      });
      expect(payload.recentResults.map((r) => r.matchId)).toEqual(['fraction', 'whole']);
    });

    it('shows a level match as level with NO winner until the organiser decides', () => {
      const level = score('m1', { round: 'quarterfinal', team1_total: 20, team2_total: 20 });
      const payload = assemble({
        matches: [match('m1', { round: 'quarterfinal' })],
        scores: [level],
        totals: [totalsRow('m1')],
      });
      const [result] = payload.recentResults;
      expect(result.level).toBe(true);
      expect(result.teams.map((t) => t.winner)).toEqual([false, false]);
      expect(result.tiebreak).toBeNull();
    });

    it("shows the organiser's recorded winner and reason on a level match", () => {
      const level = score('m1', { round: 'quarterfinal', team1_total: 20, team2_total: 20 });
      const payload = assemble({
        matches: [
          match('m1', {
            round: 'quarterfinal',
            tiebreak_winner_team_id: 't2',
            tiebreak_reason: 'Sudden-death cup',
          }),
        ],
        scores: [level],
        totals: [totalsRow('m1')],
      });
      const [result] = payload.recentResults;
      expect(result.level).toBe(true);
      expect(result.teams.map((t) => t.winner)).toEqual([false, true]);
      expect(result.tiebreak).toEqual({ winnerName: 'Beta', reason: 'Sudden-death cup' });
    });

    it('ignores a stale recorded winner on a match that is no longer level (the database clears it on a re-confirm)', () => {
      const payload = assemble({
        matches: [
          match('m1', {
            round: 'quarterfinal',
            tiebreak_winner_team_id: 't2',
            tiebreak_reason: 'old decision',
          }),
        ],
        scores: [score('m1', { round: 'quarterfinal' })],
        totals: [totalsRow('m1')],
      });
      const [result] = payload.recentResults;
      expect(result.level).toBe(false);
      expect(result.tiebreak).toBeNull();
      expect(result.teams.map((t) => t.winner)).toEqual([true, false]);
    });

    it('treats totals that arrive as strings as numbers (bigint sums)', () => {
      const payload = assemble({
        matches: [match('m1')],
        scores: [
          score('m1', {
            team1_tokens: '8',
            team2_tokens: '7',
            team1_total: '13',
            team2_total: '7',
          }),
        ],
        totals: [totalsRow('m1')],
      });
      expect(payload.recentResults[0].teams.map((t) => t.total)).toEqual([13, 7]);
      expect(payload.recentResults[0].teams.map((t) => t.winner)).toEqual([true, false]);
    });

    it('leaves out a match whose score row is not confirmed', () => {
      const payload = assemble({
        matches: [match('m1')],
        scores: [score('m1', { status: 'scoring' })],
        totals: [totalsRow('m1')],
      });
      expect(payload.recentResults).toEqual([]);
    });
  });

  describe('bracket and podium', () => {
    const qf1Match = match('mq1', { round: 'quarterfinal' });
    const qf2Match = match('mq2', {
      round: 'quarterfinal',
      team1_id: 't3',
      team2_id: 't4',
      status: 'pending',
    });

    it('is null before it exists', () => {
      expect(assemble({ matches: [match('m1')] }).bracket).toBeNull();
      expect(assemble({ matches: [match('m1')] }).podium).toBeNull();
    });

    it("lists rounds in bracket order with TBD slots, a confirmed slot's totals and winner, and unplayed slots without", () => {
      const entries = [
        entry(slot('semifinal', 'sf1', 't1', null, null)),
        entry(slot('quarterfinal', 'qf2', 't3', 't4', 'mq2'), qf2Match),
        entry(slot('quarterfinal', 'qf1', 't1', 't2', 'mq1'), qf1Match),
      ];
      const payload = assemble({
        matches: [qf1Match, qf2Match],
        bracketEntries: entries,
        scores: [score('mq1', { round: 'quarterfinal', team1_total: 25, team2_total: 18 })],
      });
      expect(payload.bracket.rounds.map((r) => [r.round, r.label])).toEqual([
        ['quarterfinal', 'Quarter-finals'],
        ['semifinal', 'Semi-finals'],
      ]);
      const [qf, sf] = payload.bracket.rounds;
      expect(qf.slots.map((s) => s.label)).toEqual(['qf2', 'qf1']);
      expect(qf.slots[1]).toEqual({
        label: 'qf1',
        status: 'confirmed',
        teams: [
          { name: 'Alpha', total: 25, winner: true },
          { name: 'Beta', total: 18, winner: false },
        ],
        level: false,
        tiebreak: null,
      });
      expect(qf.slots[0]).toEqual({
        label: 'qf2',
        status: 'pending',
        teams: [
          { name: 'Gamma', total: null, winner: false },
          { name: 'Delta', total: null, winner: false },
        ],
        level: false,
        tiebreak: null,
      });
      expect(sf.slots[0].teams).toEqual([
        { name: 'Alpha', total: null, winner: false },
        { name: null, total: null, winner: false },
      ]);
      expect(sf.slots[0].status).toBeNull();
    });

    it('shows a decided level slot with its winner and reason, and a level slot with none as level', () => {
      const decided = match('mq1', {
        round: 'quarterfinal',
        tiebreak_winner_team_id: 't2',
        tiebreak_reason: 'Coin toss',
      });
      const open = match('mq2', {
        round: 'quarterfinal',
        team1_id: 't3',
        team2_id: 't4',
      });
      const payload = assemble({
        matches: [decided, open],
        bracketEntries: [
          entry(slot('quarterfinal', 'qf1', 't1', 't2', 'mq1'), decided),
          entry(slot('quarterfinal', 'qf2', 't3', 't4', 'mq2'), open),
        ],
        scores: [
          score('mq1', { round: 'quarterfinal', team1_total: 20, team2_total: 20 }),
          score('mq2', {
            round: 'quarterfinal',
            team1_id: 't3',
            team2_id: 't4',
            team1_total: 20,
            team2_total: 20,
          }),
        ],
      });
      const [first, second] = payload.bracket.rounds[0].slots;
      expect(first.level).toBe(true);
      expect(first.teams.map((t) => t.winner)).toEqual([false, true]);
      expect(first.tiebreak).toEqual({ winnerName: 'Beta', reason: 'Coin toss' });
      expect(second.level).toBe(true);
      expect(second.teams.map((t) => t.winner)).toEqual([false, false]);
      expect(second.tiebreak).toBeNull();
    });

    it('names team 2 the winner of a slot and the champion when it has the higher total', () => {
      const final = match('mf', { round: 'final' });
      const payload = assemble({
        matches: [final],
        bracketEntries: [entry(slot('final', 'final', 't1', 't2', 'mf'), final)],
        scores: [score('mf', { round: 'final', team1_total: 18, team2_total: 25 })],
      });
      const [first, second] = payload.bracket.rounds[0].slots[0].teams;
      expect([first.winner, second.winner]).toEqual([false, true]);
      expect(payload.podium.places[0]).toMatchObject({ state: 'decided', teamName: 'Beta' });
      expect(payload.podium.places[1]).toMatchObject({ state: 'decided', teamName: 'Alpha' });
    });

    it('ignores a stale recorded winner on a decisive slot and final (it is cleared by a re-confirm)', () => {
      const stale = {
        tiebreak_winner_team_id: 't2',
        tiebreak_reason: 'old decision',
      };
      const qf = match('mq1', { round: 'quarterfinal', ...stale });
      const final = match('mf', { round: 'final', ...stale });
      const payload = assemble({
        matches: [qf, final],
        bracketEntries: [
          entry(slot('quarterfinal', 'qf1', 't1', 't2', 'mq1'), qf),
          entry(slot('final', 'final', 't1', 't2', 'mf'), final),
        ],
        scores: [
          score('mq1', { round: 'quarterfinal', team1_total: 25, team2_total: 18 }),
          score('mf', { round: 'final', team1_total: 25, team2_total: 18 }),
        ],
      });
      const [qfSlot] = payload.bracket.rounds[0].slots;
      expect(qfSlot.tiebreak).toBeNull();
      expect(qfSlot.teams.map((t) => t.winner)).toEqual([true, false]);
      expect(payload.podium.places[0]).toMatchObject({
        teamName: 'Alpha',
        viaTiebreak: false,
      });
    });

    it('attaches a slot total to the right team even when the slot is seated the other way round', () => {
      const qf = match('mq1', { round: 'quarterfinal' }); // match: t1 vs t2
      const payload = assemble({
        matches: [qf],
        bracketEntries: [entry(slot('quarterfinal', 'qf1', 't2', 't1', 'mq1'), qf)], // slot: t2 vs t1
        scores: [score('mq1', { round: 'quarterfinal', team1_total: 25, team2_total: 18 })],
      });
      expect(payload.bracket.rounds[0].slots[0].teams).toEqual([
        { name: 'Beta', total: 18, winner: false },
        { name: 'Alpha', total: 25, winner: true },
      ]);
    });

    it('reads slot totals that arrive as strings as numbers', () => {
      const qf = match('mq1', { round: 'quarterfinal' });
      const payload = assemble({
        matches: [qf],
        bracketEntries: [entry(slot('quarterfinal', 'qf1', 't1', 't2', 'mq1'), qf)],
        scores: [score('mq1', { round: 'quarterfinal', team1_total: '25', team2_total: '9' })],
      });
      expect(payload.bracket.rounds[0].slots[0].teams.map((t) => t.total)).toEqual([25, 9]);
      expect(payload.bracket.rounds[0].slots[0].teams.map((t) => t.winner)).toEqual([true, false]);
    });

    it('builds the podium from the same rule the organiser sees, naming only decided places', () => {
      const final = match('mf', { round: 'final' });
      const third = match('m3', {
        round: 'third_place',
        team1_id: 't3',
        team2_id: 't4',
        status: 'pending',
      });
      const payload = assemble({
        matches: [final, third],
        bracketEntries: [
          entry(slot('final', 'final', 't1', 't2', 'mf'), final),
          entry(slot('third_place', 'third', 't3', 't4', 'm3'), third),
        ],
        scores: [score('mf', { round: 'final' })],
      });
      expect(payload.podium).toEqual({
        complete: false,
        places: [
          {
            key: 'champion',
            label: 'Champion',
            state: 'decided',
            teamName: 'Alpha',
            viaTiebreak: false,
          },
          {
            key: 'runnerUp',
            label: '1st runner-up',
            state: 'decided',
            teamName: 'Beta',
            viaTiebreak: false,
          },
          {
            key: 'third',
            label: '3rd place',
            state: 'pending',
            teamName: null,
            viaTiebreak: false,
          },
        ],
      });
    });

    it('says a level final with no decision is tied (never names a champion) and flags a tie-break champion', () => {
      const level = { team1_total: 30, team2_total: 30 };
      const tiedFinal = match('mf', { round: 'final' });
      const tied = assemble({
        matches: [tiedFinal],
        bracketEntries: [entry(slot('final', 'final', 't1', 't2', 'mf'), tiedFinal)],
        scores: [score('mf', { round: 'final', ...level })],
      });
      expect(tied.podium.places.map((p) => [p.state, p.teamName])).toEqual([
        ['tied', null],
        ['tied', null],
      ]);

      const wonFinal = match('mf', {
        round: 'final',
        tiebreak_winner_team_id: 't2',
        tiebreak_reason: 'Rematch',
      });
      const won = assemble({
        matches: [wonFinal],
        bracketEntries: [entry(slot('final', 'final', 't1', 't2', 'mf'), wonFinal)],
        scores: [score('mf', { round: 'final', ...level })],
      });
      expect(won.podium.places[0]).toMatchObject({
        state: 'decided',
        teamName: 'Beta',
        viaTiebreak: true,
      });
      expect(won.podium.places[1]).toMatchObject({ state: 'decided', teamName: 'Alpha' });
    });
  });
});

describe('what the payload makes public', () => {
  // live_sessions is readable by anyone: a field added here is published to the room. This pins the exact set,
  // so a new field is a decision made on purpose, not a leak.
  it('contains only the documented fields, at every level', () => {
    const final = match('mf', {
      round: 'final',
      tiebreak_winner_team_id: 't2',
      tiebreak_reason: 'Rematch',
    });
    const payload = assemble({
      matches: [match('m1'), match('m2', { status: 'pending' }), final],
      matchJudges: [{ match_id: 'm2', judge_id: 'j1' }],
      scores: [score('m1'), score('mf', { round: 'final', team1_total: 30, team2_total: 30 })],
      totals: [totalsRow('m1'), totalsRow('mf')],
      standings: [standing('t1', 'Alpha', 1, 1, 1, 13)],
      bracketEntries: [entry(slot('final', 'final', 't1', 't2', 'mf'), final)],
    });
    const keys = (value) => Object.keys(value).sort();
    expect(keys(payload)).toEqual(
      [
        'bracket',
        'eventName',
        'phase',
        'podium',
        'progress',
        'recentResults',
        'standings',
        'thenNext',
        'upNext',
      ].sort(),
    );
    expect(keys(payload.progress)).toEqual(['played', 'total']);
    expect(keys(payload.standings[0])).toEqual([
      'played',
      'points',
      'position',
      'teamName',
      'wins',
    ]);
    expect(keys(payload.upNext)).toEqual([
      'judges',
      'matchId',
      'round',
      'roundLabel',
      'status',
      'teams',
    ]);
    expect(keys(payload.upNext.teams[0])).toEqual(['name', 'place', 'seed']);
    expect(keys(payload.recentResults[0])).toEqual(
      ['confirmedAt', 'level', 'matchId', 'round', 'roundLabel', 'teams', 'tiebreak'].sort(),
    );
    expect(keys(payload.recentResults[0].teams[0])).toEqual(
      ['bonuses', 'name', 'tokens', 'total', 'winner'].sort(),
    );
    expect(keys(payload.recentResults[0].teams[0].bonuses)).toEqual([
      'fastest',
      'signature',
      'win',
    ]);
    expect(keys(payload.bracket)).toEqual(['rounds']);
    expect(keys(payload.bracket.rounds[0])).toEqual(['label', 'round', 'slots']);
    expect(keys(payload.bracket.rounds[0].slots[0])).toEqual(
      ['label', 'level', 'status', 'teams', 'tiebreak'].sort(),
    );
    expect(keys(payload.bracket.rounds[0].slots[0].teams[0])).toEqual(['name', 'total', 'winner']);
    expect(keys(payload.bracket.rounds[0].slots[0].tiebreak)).toEqual(['reason', 'winnerName']);
    expect(keys(payload.podium)).toEqual(['complete', 'places']);
    expect(keys(payload.podium.places[0])).toEqual(
      ['key', 'label', 'state', 'teamName', 'viaTiebreak'].sort(),
    );
  });

  it('carries no identifier beyond match ids: no org, event, team or judge ids, no per-cup votes', () => {
    const payload = assemble({
      matches: [match('m1')],
      scores: [score('m1')],
      totals: [totalsRow('m1')],
      standings: [standing('t1', 'Alpha', 1, 1, 1, 13)],
    });
    const text = JSON.stringify(payload);
    for (const secret of ['org1', 'ev1', '"t1"', '"t2"', 'j1', 'cup_number', 'team1_id']) {
      expect(text).not.toContain(secret);
    }
  });
});

// ---------- the read chain, against a fake client ----------

// Table rows by name; supports the select / eq / in / order / single chains the BTC readers use.
function fakeClient(db, { throwOnFrom = null, rpcResult = { data: null, error: null } } = {}) {
  const reads = [];
  const rpcCalls = [];
  function makeBuilder(table) {
    const filters = [];
    let orderBy = null;
    let columns = '*';
    const rows = () => {
      let out = (db[table] ?? []).filter((r) => filters.every(([test]) => test(r)));
      if (orderBy)
        out = [...out].sort((a, b) => String(a[orderBy]).localeCompare(String(b[orderBy])));
      return out.map((r) => ({ ...r }));
    };
    const builder = {
      select: (cols) => {
        columns = cols;
        return builder;
      },
      eq: (col, val) => {
        filters.push([(r) => r[col] === val, col, val]);
        return builder;
      },
      in: (col, vals) => {
        filters.push([(r) => vals.includes(r[col]), col, vals]);
        return builder;
      },
      order: (col) => {
        orderBy = col;
        return builder;
      },
      single: () => {
        reads.push({ table, columns, filters: filters.map(([, c, v]) => [c, v]) });
        const row = rows()[0];
        return Promise.resolve(
          row
            ? { data: row, error: null }
            : { data: null, error: { code: 'PGRST116', message: 'no rows' } },
        );
      },
      maybeSingle: () => {
        reads.push({ table, columns, filters: filters.map(([, c, v]) => [c, v]) });
        return Promise.resolve({ data: rows()[0] ?? null, error: null });
      },
      then: (resolve, reject) => {
        reads.push({ table, columns, filters: filters.map(([, c, v]) => [c, v]) });
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return {
    reads,
    rpcCalls,
    from: (table) => {
      if (throwOnFrom) throw throwOnFrom;
      return makeBuilder(table);
    },
    rpc: (name, args) => {
      rpcCalls.push([name, args]);
      return Promise.resolve(rpcResult);
    },
  };
}

function baseDb() {
  return {
    events: [{ id: 'ev1', org_id: 'org1', name: 'Grey Matter BTC 2026', is_test: true }],
    btc_teams: [
      { id: 't1', event_id: 'ev1', name: 'Alpha' },
      { id: 't2', event_id: 'ev1', name: 'Beta' },
      { id: 'tx', event_id: 'other', name: 'Not Ours' },
    ],
    btc_judges: [
      { id: 'j1', event_id: 'ev1', name: 'Jo' },
      { id: 'j2', event_id: 'ev1', name: 'Kim' },
      { id: 'j3', event_id: 'ev1', name: 'Lee' },
      { id: 'jx', event_id: 'other', name: 'Not Our Judge' },
    ],
    btc_matches: [
      match('m1'),
      match('m2', { status: 'pending', created_at: '2026-10-01T11:00:00.000Z' }),
      // another event's rows, which must never reach this event's payload
      {
        ...match('mx', { status: 'pending' }),
        event_id: 'other',
        team1_id: 'tx',
        team2_id: 'tx',
      },
    ],
    btc_match_judges: [
      { match_id: 'm1', judge_id: 'j1' },
      { match_id: 'm1', judge_id: 'j2' },
      { match_id: 'm1', judge_id: 'j3' },
      { match_id: 'm2', judge_id: 'j2' },
      { match_id: 'm2', judge_id: 'j3' },
      { match_id: 'm2', judge_id: 'j1' },
      { match_id: 'mx', judge_id: 'jx' },
    ],
    btc_match_scores: [
      { ...score('m1'), event_id: 'ev1' },
      { ...score('mx', { team1_id: 'tx', team2_id: 'tx' }), event_id: 'other' },
    ],
    btc_match_totals: [
      { ...totalsRow('m1'), event_id: 'ev1' },
      { ...totalsRow('mx'), event_id: 'other' },
    ],
    btc_standings: [
      { event_id: 'ev1', team_id: 't1', played: 1, wins: 1, total_points: 13 },
      { event_id: 'ev1', team_id: 't2', played: 1, wins: 0, total_points: 7 },
      { event_id: 'other', team_id: 'tx', played: 9, wins: 9, total_points: 999 },
    ],
    btc_bracket_slots: [
      {
        id: 's-other',
        event_id: 'other',
        round: 'final',
        slot_label: 'final',
        team1_id: 'tx',
        team2_id: 'tx',
        match_id: null,
      },
    ],
    live_sessions: [],
  };
}

describe('buildBtcLivePayload', () => {
  it("reads one event's rows only and assembles the payload", async () => {
    const client = fakeClient(baseDb());
    const payload = await buildBtcLivePayload('ev1', client);
    expect(payload.eventName).toBe('Grey Matter BTC 2026');
    expect(payload.phase).toBe('preliminary');
    expect(payload.standings.map((s) => [s.position, s.teamName, s.points])).toEqual([
      [1, 'Alpha', 13],
      [2, 'Beta', 7],
    ]);
    expect(payload.progress).toEqual({ played: 1, total: 2 });
    expect(payload.recentResults).toHaveLength(1);
    expect(payload.recentResults[0].teams.map((t) => t.name)).toEqual(['Alpha', 'Beta']);
    // the next match is this event's own, with its own judges
    expect(payload.upNext.matchId).toBe('m2');
    expect(payload.upNext.judges).toEqual(['Kim', 'Lee', 'Jo']);
    // nothing from another event leaked into the public payload
    const text = JSON.stringify(payload);
    for (const foreign of ['Not Ours', 'Not Our Judge', '999']) expect(text).not.toContain(foreign);
    expect(payload.bracket).toBeNull();
  });

  it('reads exactly the tables it needs, each scoped to the event or to its own match ids', async () => {
    const client = fakeClient(baseDb());
    await buildBtcLivePayload('ev1', client);
    expect([...new Set(client.reads.map((r) => r.table))].sort()).toEqual(
      [
        'btc_bracket_slots',
        'btc_judges',
        'btc_match_judges',
        'btc_match_scores',
        'btc_match_totals',
        'btc_matches',
        'btc_standings',
        'btc_teams',
        'events',
      ].sort(),
    );
    const scopeOf = (table) =>
      client.reads
        .filter((r) => r.table === table)
        .map((r) => r.filters.map(([col, val]) => [col, val]));
    for (const table of [
      'btc_teams',
      'btc_judges',
      'btc_matches',
      'btc_match_scores',
      'btc_match_totals',
      'btc_standings',
      'btc_bracket_slots',
    ]) {
      for (const filters of scopeOf(table)) {
        expect(filters, `${table} must be scoped to the event`).toContainEqual(['event_id', 'ev1']);
      }
    }
    expect(scopeOf('events')[0]).toContainEqual(['id', 'ev1']);
    // the judges of THIS event's matches only, nobody else's
    expect(scopeOf('btc_match_judges')).toEqual([[['match_id', ['m1', 'm2']]]]);
  });

  it('skips the match-judges read when there are no matches', async () => {
    const db = baseDb();
    db.btc_matches = [];
    db.btc_match_scores = [];
    const client = fakeClient(db);
    const payload = await buildBtcLivePayload('ev1', client);
    expect(payload.phase).toBe('setup');
    expect(client.reads.some((r) => r.table === 'btc_match_judges')).toBe(false);
  });

  it('rejects, without an unhandled rejection, when the client throws while a read is being built', async () => {
    const client = fakeClient(baseDb(), { throwOnFrom: new Error('network down') });
    await expect(buildBtcLivePayload('ev1', client)).rejects.toThrow('network down');
  });

  it('rejects with the read error, so the outbox can classify it', async () => {
    const client = fakeClient(baseDb());
    const realFrom = client.from;
    client.from = (table) => {
      const builder = realFrom(table);
      if (table !== 'btc_match_totals') return builder;
      return {
        ...builder,
        select: () => ({
          eq: () =>
            Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } }),
        }),
      };
    };
    await expect(buildBtcLivePayload('ev1', client)).rejects.toMatchObject({ code: '' });
  });
});

// ---------- the intent handler and the triggers, through the real outbox ----------

describe('publishing', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  const testEvent = { id: 'ev1', org_id: 'org1', is_test: true };
  const realEvent = { id: 'ev1', org_id: 'org1', is_test: false };
  // Stands in for main.js's composed map: BTC's handler is in it, like every real call site.
  const handlersFor = (client) => btcOutboxHandlers(client);
  const pendingTypes = async () => (await listPendingOperations()).map((op) => op.type);

  it("sends the payload as the btc format with the event's own is_test and a snapshot clock", async () => {
    const client = fakeClient(baseDb());
    const before = Date.now();
    await publishBtcLive({ event: testEvent, takeOver: true }, handlersFor(client));
    expect(client.rpcCalls).toHaveLength(1);
    const [name, args] = client.rpcCalls[0];
    expect(name).toBe('publish_session');
    expect(args).toMatchObject({
      p_org_id: 'org1',
      p_event_id: 'ev1',
      p_format: 'btc',
      p_is_test: true,
    });
    expect(args.p_payload.eventName).toBe('Grey Matter BTC 2026');
    expect(Date.parse(args.p_snapshot_at)).toBeGreaterThanOrEqual(before);
    expect(await pendingTypes()).toEqual([]);
  });

  it("flushes with the caller's composed handler map, not only its own", async () => {
    const client = fakeClient(baseDb());
    const composed = { [BTC_LIVE_OPERATION]: vi.fn(async () => {}) };
    await publishBtcLive({ event: testEvent, takeOver: true }, composed);
    expect(composed[BTC_LIVE_OPERATION]).toHaveBeenCalledTimes(1);
    expect(composed[BTC_LIVE_OPERATION].mock.calls[0][0]).toMatchObject({
      eventId: 'ev1',
      format: 'btc',
    });
    expect(client.rpcCalls).toHaveLength(0); // the default handler was not used
  });

  it('carries is_test false through for a real event (D9 in both directions)', async () => {
    const client = fakeClient(baseDb());
    await publishBtcLive({ event: realEvent, takeOver: true }, handlersFor(client));
    expect(client.rpcCalls[0][1].p_is_test).toBe(false);
  });

  it('takes the display over without even asking who is live when the activity is real running (takeOver)', async () => {
    const db = baseDb();
    db.live_sessions = [{ org_id: 'org1', event_id: 'someone-else', active: true }];
    const client = fakeClient(db);
    await publishBtcLive({ event: testEvent, takeOver: true }, handlersFor(client));
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.reads.some((r) => r.table === 'live_sessions')).toBe(false);
  });

  it('a schedule edit does NOT take the display from another live event, and is not left queued', async () => {
    const db = baseDb();
    db.live_sessions = [{ org_id: 'org1', event_id: 'someone-else', active: true }];
    const client = fakeClient(db);
    await publishBtcLive({ event: testEvent, takeOver: false }, handlersFor(client));
    expect(client.rpcCalls).toHaveLength(0);
    expect(await pendingTypes()).toEqual([]);
  });

  it('a schedule edit does NOT start a live display when none exists', async () => {
    const client = fakeClient(baseDb());
    await publishBtcLive({ event: testEvent, takeOver: false }, handlersFor(client));
    expect(client.rpcCalls).toHaveLength(0);
  });

  it('a schedule edit refreshes the display when this event is already the live one', async () => {
    const db = baseDb();
    db.live_sessions = [{ org_id: 'org1', event_id: 'ev1', active: true }];
    const client = fakeClient(db);
    await publishBtcLive({ event: testEvent, takeOver: false }, handlersFor(client));
    expect(client.rpcCalls).toHaveLength(1);
  });

  it.each([undefined, 'yes', 1, false])(
    'only a literal takeOver:true takes the display over (%s is a schedule edit)',
    async (takeOver) => {
      const db = baseDb();
      db.live_sessions = [{ org_id: 'org1', event_id: 'someone-else', active: true }];
      const client = fakeClient(db);
      await publishBtcLive({ event: testEvent, takeOver }, handlersFor(client));
      expect(client.rpcCalls).toHaveLength(0);
    },
  );

  it('offline: the intent is queued, the call does not throw, and the next flush publishes it', async () => {
    const offline = fakeClient(baseDb(), {
      throwOnFrom: Object.assign(new Error('x'), { code: '' }),
    });
    await expect(
      publishBtcLive({ event: testEvent, takeOver: true }, handlersFor(offline)),
    ).resolves.toBeUndefined();
    expect(await pendingTypes()).toEqual([BTC_LIVE_OPERATION]);
    const [op] = await listPendingOperations();
    expect(op.payload).toEqual({
      orgId: 'org1',
      eventId: 'ev1',
      format: 'btc',
      isTest: true,
      onlyIfLive: false,
    });

    const online = fakeClient(baseDb());
    await flushOutbox(handlersFor(online));
    expect(online.rpcCalls).toHaveLength(1);
    expect(await pendingTypes()).toEqual([]);
  });

  it('offline schedule edit: queued as a conditional publish and retried (not silently dropped), then decided when it flushes', async () => {
    const offline = fakeClient(baseDb(), {
      throwOnFrom: Object.assign(new Error('x'), { code: '' }),
    });
    await publishBtcLive({ event: testEvent, takeOver: false }, handlersFor(offline));
    const [op] = await listPendingOperations();
    expect(op.payload.onlyIfLive).toBe(true);

    // back online with ANOTHER event live: the edit publishes nothing, and is not left queued
    const elsewhere = baseDb();
    elsewhere.live_sessions = [{ org_id: 'org1', event_id: 'someone-else', active: true }];
    const otherClient = fakeClient(elsewhere);
    await flushOutbox(handlersFor(otherClient));
    expect(otherClient.rpcCalls).toHaveLength(0);
    expect(await pendingTypes()).toEqual([]);

    // the same edit queued again, back online with THIS event live: it publishes
    await publishBtcLive({ event: testEvent, takeOver: false }, handlersFor(offline));
    const here = baseDb();
    here.live_sessions = [{ org_id: 'org1', event_id: 'ev1', active: true }];
    const hereClient = fakeClient(here);
    await flushOutbox(handlersFor(hereClient));
    expect(hereClient.rpcCalls).toHaveLength(1);
  });

  it('a test event deleted while its publish was queued completes as a no-op; a real one is reported, not skipped', async () => {
    const db = baseDb();
    db.events = [];
    const gone = fakeClient(db);
    const goneDrops = [];
    const stopGone = onOperationDropped((drop) => goneDrops.push(drop));
    await publishBtcLive({ event: testEvent, takeOver: true }, handlersFor(gone));
    stopGone();
    expect(gone.rpcCalls).toHaveLength(0);
    expect(await pendingTypes()).toEqual([]);
    expect(goneDrops).toEqual([]); // nothing was lost, so nothing is reported

    const real = fakeClient(db);
    const dropped = [];
    const stop = onOperationDropped((drop) => dropped.push(drop));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await publishBtcLive({ event: realEvent, takeOver: true }, handlersFor(real));
    stop();
    warn.mockRestore();
    expect(real.rpcCalls).toHaveLength(0);
    // permanent: dropped from the queue and REPORTED by the outbox (not skipped silently), never retried forever
    expect(await pendingTypes()).toEqual([]);
    expect(dropped.map((d) => d.operation.type)).toEqual([BTC_LIVE_OPERATION]);
  });

  it('a publish the server cannot take right now stays queued for the next flush', async () => {
    const client = fakeClient(baseDb(), {
      rpcResult: { data: null, error: { code: '', message: 'Failed to fetch' }, status: 503 },
    });
    await publishBtcLive({ event: testEvent, takeOver: true }, handlersFor(client));
    expect(await pendingTypes()).toEqual([BTC_LIVE_OPERATION]);
  });

  it('refuses an event without an explicit boolean is_test, and queues nothing', async () => {
    const client = fakeClient(baseDb());
    await expect(
      publishBtcLive({ event: { id: 'ev1', org_id: 'org1' }, takeOver: true }, handlersFor(client)),
    ).rejects.toThrow(TypeError);
    await expect(
      publishBtcLive({ event: null, takeOver: true }, handlersFor(client)),
    ).rejects.toThrow(TypeError);
    expect(await pendingTypes()).toEqual([]);
  });

  it('refuses to run without the composed handler map (a BTC-only fallback would stop the shared queue), and queues nothing', async () => {
    await expect(publishBtcLive({ event: testEvent, takeOver: true })).rejects.toThrow(TypeError);
    expect(await pendingTypes()).toEqual([]);
  });

  it("does not throw to the caller when the intent cannot even be saved (the organiser's action stands), and says so", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    try {
      await expect(
        publishBtcLive({ event: testEvent, takeOver: true }, handlersFor(fakeClient(baseDb()))),
      ).resolves.toBeUndefined();
      expect(error).toHaveBeenCalled();
    } finally {
      put.mockRestore();
      error.mockRestore();
    }
  });
});

describe('enqueueBtcLive', () => {
  beforeEach(async () => {
    await _clearAllForTests();
  });

  it('persists the intent without flushing it, so a caller can queue it behind its own write', async () => {
    await enqueueBtcLive({ event: { id: 'ev1', org_id: 'org1', is_test: false }, takeOver: true });
    const pending = await listPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      type: BTC_LIVE_OPERATION,
      payload: { orgId: 'org1', eventId: 'ev1', format: 'btc', isTest: false, onlyIfLive: false },
    });
  });

  it('refuses an event without a boolean is_test, and queues nothing', async () => {
    await expect(
      enqueueBtcLive({ event: { id: 'ev1', org_id: 'org1' }, takeOver: true }),
    ).rejects.toThrow(TypeError);
    expect(await listPendingOperations()).toEqual([]);
  });
});
