// Realistic BTC live payloads for the venue-display preview page and for tests: an eight-team event (the
// load_btc_demo roster) run through the REAL assembler (liveSession.js's assembleBtcLivePayload), so a screen
// is always exercised on exactly the shape production publishes and the two can never drift apart. Demo-only,
// not part of the shipped module graph: imported by projectorSurface.preview.html and by tests, nothing else.
//
// Everything is deterministic. The preliminary round is a full round robin (28 matches) in a fixed order whose
// results favour the lower-numbered teams, with a few upsets; the knockout is whatever `knockout` says.
import { rank, chainComparators } from '../../core/ranking.js';
import { assembleBtcLivePayload } from './liveSession.js';

export const DEMO_TEAM_NAMES = [
  'Bean Scene',
  'Pour Decisions',
  'Crema Crew',
  'Drip Society',
  'Grind House',
  'Roast Republic',
  'Latte Lab',
  'Steam Team',
];
export const DEMO_JUDGE_NAMES = ['Judge 1', 'Judge 2', 'Judge 3', 'Judge 4', 'Judge 5'];

export const demoTeams = DEMO_TEAM_NAMES.map((name, i) => ({ id: `t${i + 1}`, name }));
const demoJudges = DEMO_JUDGE_NAMES.map((name, i) => ({ id: `j${i + 1}`, name }));
export const teamId = (index) => `t${index + 1}`;

const CUPS = { preliminary: 15 };
const cupsFor = (round) => CUPS[round] ?? 20;
const minutes = (n) => new Date(Date.UTC(2026, 9, 9, 10, n)).toISOString();

// A match with its scores, as the database views would return them: `fastest` and the signature flags are the
// only bonuses besides the +5 for strictly more tokens, exactly btc_match_scores' formula.
function playedMatch({ id, round, a, b, tokensA, fastest = null, signature = [false, false], n }) {
  const total = cupsFor(round) * 3;
  const tokens = [tokensA, total - tokensA];
  const teams = [teamId(a), teamId(b)];
  const totals = [0, 1].map(
    (i) =>
      tokens[i] +
      (tokens[i] > tokens[1 - i] ? 5 : 0) +
      (fastest === teams[i] ? 2 : 0) +
      (round !== 'preliminary' && signature[i] ? 2 : 0),
  );
  return {
    match: {
      id,
      event_id: 'ev1',
      round,
      team1_id: teams[0],
      team2_id: teams[1],
      status: 'confirmed',
      created_at: minutes(n),
      updated_at: minutes(n + 30),
      tiebreak_winner_team_id: null,
      tiebreak_reason: null,
    },
    score: {
      match_id: id,
      status: 'confirmed',
      round,
      team1_id: teams[0],
      team2_id: teams[1],
      team1_tokens: tokens[0],
      team2_tokens: tokens[1],
      team1_total: totals[0],
      team2_total: totals[1],
    },
    totalsRow: {
      match_id: id,
      fastest_team_id: fastest,
      team1_signature_beverage: Boolean(signature[0]),
      team2_signature_beverage: Boolean(signature[1]),
    },
  };
}

function pendingMatch({ id, round, a, b, n }) {
  return {
    match: {
      id,
      event_id: 'ev1',
      round,
      team1_id: teamId(a),
      team2_id: teamId(b),
      status: 'pending',
      created_at: minutes(n),
      updated_at: minutes(n),
      tiebreak_winner_team_id: null,
      tiebreak_reason: null,
    },
  };
}

// The 28 round-robin pairings in a fixed order, and the tokens team `a` (the lower number) takes: stronger
// teams usually win, a few do not.
function roundRobin() {
  const pairs = [];
  for (let a = 0; a < 8; a += 1) for (let b = a + 1; b < 8; b += 1) pairs.push([a, b]);
  return pairs.map(([a, b], i) => {
    const wobble = ((a * 5 + b * 11) % 7) - 3;
    const tokensA = Math.min(37, Math.max(8, Math.round(22.5 + (b - a) * 2.2 + wobble * 1.5)));
    return { id: `p${i + 1}`, a, b, tokensA, fastest: wobble > 0 ? teamId(a) : null, n: i };
  });
}

function standingsOf(played) {
  const stats = new Map(demoTeams.map((t) => [t.id, { played: 0, wins: 0, points: 0 }]));
  for (const { score } of played) {
    const sides = [
      [score.team1_id, score.team1_tokens > score.team2_tokens, score.team1_total],
      [score.team2_id, score.team2_tokens > score.team1_tokens, score.team2_total],
    ];
    for (const [id, won, total] of sides) {
      const row = stats.get(id);
      row.played += 1;
      row.wins += won ? 1 : 0;
      row.points += total;
    }
  }
  const items = demoTeams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    played: stats.get(team.id).played,
    wins: stats.get(team.id).wins,
    totalPoints: stats.get(team.id).points,
  }));
  return rank(
    items,
    chainComparators(
      (x, y) => y.totalPoints - x.totalPoints,
      (x, y) => y.wins - x.wins,
    ),
  );
}

function assemble({ matches, standings, bracketEntries = [], judgesByMatch = {} }) {
  const played = matches.filter((m) => m.score);
  return assembleBtcLivePayload({
    event: { id: 'ev1', org_id: 'org1', name: 'BTC demo rehearsal', is_test: true },
    teams: demoTeams,
    judges: demoJudges,
    matches: matches.map((m) => m.match),
    matchJudges: Object.entries(judgesByMatch).flatMap(([matchId, ids]) =>
      ids.map((judgeId) => ({ match_id: matchId, judge_id: judgeId })),
    ),
    scores: played.map((m) => m.score),
    totals: played.map((m) => m.totalsRow),
    standings,
    bracketEntries,
  });
}

// The preliminary round with the first `playedCount` of the 28 matches confirmed and the rest created and
// waiting. The next two unplayed matches are up next and then next, judged by judges 1 to 3.
export function preliminaryPayload({ playedCount = 12 } = {}) {
  const plan = roundRobin();
  const matches = plan.map((p, i) =>
    i < playedCount
      ? playedMatch({ id: p.id, round: 'preliminary', ...p })
      : pendingMatch({ id: p.id, round: 'preliminary', a: p.a, b: p.b, n: p.n }),
  );
  const judgesByMatch = Object.fromEntries(plan.map((p) => [p.id, ['j1', 'j2', 'j3']]));
  return assemble({
    matches,
    standings: standingsOf(matches.filter((m) => m.score)),
    judgesByMatch,
  });
}

// The knockout. Seeds 1v8, 4v5, 3v6 and 2v7 meet in the quarterfinals; `results` maps a slot to what happened
// (tokens for the first team, who was fastest, whether the organiser decided a tie). Slots not in `results`
// are created but not played, or not yet seated.
export const KNOCKOUT_SEEDS = {
  qf1: [0, 7],
  qf2: [3, 4],
  qf3: [2, 5],
  qf4: [1, 6],
};

export function knockoutPayload({ results = {} } = {}) {
  const plan = roundRobin();
  const preliminaryMatches = plan.map((p) => playedMatch({ id: p.id, round: 'preliminary', ...p }));
  const standings = standingsOf(preliminaryMatches);

  const entries = [];
  const matches = [...preliminaryMatches];
  let n = 100;
  const seatOf = (slot, side) => {
    if (slot in KNOCKOUT_SEEDS) return KNOCKOUT_SEEDS[slot][side];
    return null;
  };
  const build = (slot, round, a, b) => {
    const spec = results[slot];
    let matchRow = null;
    if (a !== null && b !== null) {
      n += 1;
      if (spec) {
        const played = playedMatch({
          id: slot,
          round,
          a,
          b,
          tokensA: spec.tokensA,
          fastest: spec.fastest === undefined ? null : teamId(spec.fastest),
          signature: spec.signature ?? [false, false],
          n,
        });
        if (spec.tiebreak) {
          played.match.tiebreak_winner_team_id = teamId(spec.tiebreak.winner);
          played.match.tiebreak_reason = spec.tiebreak.reason;
          // Recording a tie-break touches the match row, so its updated_at moves (record_btc_tiebreak).
          played.match.updated_at = minutes(n + 45);
        }
        matches.push(played);
        matchRow = played.match;
      } else {
        const pending = pendingMatch({ id: slot, round, a, b, n });
        matches.push(pending);
        matchRow = pending.match;
      }
    }
    entries.push({
      slot: {
        id: `s-${slot}`,
        event_id: 'ev1',
        round,
        slot_label: slot,
        team1_id: a === null ? null : teamId(a),
        team2_id: b === null ? null : teamId(b),
        match_id: matchRow ? slot : null,
      },
      match: matchRow ? { ...matchRow } : null,
    });
    return matchRow;
  };
  const winnerOf = (slot) => {
    const row = matches.find((m) => m.match.id === slot && m.score);
    if (!row) return null;
    const { score, match } = row;
    const t1 = Number(score.team1_total);
    const t2 = Number(score.team2_total);
    const winner =
      t1 !== t2 ? (t1 > t2 ? score.team1_id : score.team2_id) : match.tiebreak_winner_team_id;
    return winner ? Number(winner.slice(1)) - 1 : null;
  };
  const loserOf = (slot) => {
    const winner = winnerOf(slot);
    const row = matches.find((m) => m.match.id === slot);
    if (winner === null || !row) return null;
    const ids = [row.match.team1_id, row.match.team2_id].map((id) => Number(id.slice(1)) - 1);
    return ids.find((id) => id !== winner) ?? null;
  };

  for (const slot of ['qf1', 'qf2', 'qf3', 'qf4']) {
    build(slot, 'quarterfinal', seatOf(slot, 0), seatOf(slot, 1));
  }
  build('sf1', 'semifinal', winnerOf('qf1'), winnerOf('qf2'));
  build('sf2', 'semifinal', winnerOf('qf3'), winnerOf('qf4'));
  build('final', 'final', winnerOf('sf1'), winnerOf('sf2'));
  build('third', 'third_place', loserOf('sf1'), loserOf('sf2'));

  return assemble({
    matches,
    standings,
    bracketEntries: entries,
    judgesByMatch: Object.fromEntries(
      matches.filter((m) => !m.score).map((m) => [m.match.id, ['j1', 'j3', 'j4']]),
    ),
  });
}
