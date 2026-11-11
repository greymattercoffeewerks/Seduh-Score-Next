import { describe, it, expect } from 'vitest';
import {
  btcLinks,
  currentPhaseLabel,
  deriveBtcPhases,
  deriveBtcWarnings,
  setupState,
} from './runSheet.js';
import { deriveNextStep, normalisePhases } from '../../core/runSheet.js';

const EV = 'ev1';
const L = btcLinks(EV);

const team = (i, country = 'BN') => ({ id: `t${i}`, name: `Team ${i}`, country_code: country });
const judge = (i, country = null) => ({ id: `j${i}`, name: `Judge ${i}`, country_code: country });

const teams = (n, country = 'BN') => Array.from({ length: n }, (_, i) => team(i + 1, country));
const judges = (n) => Array.from({ length: n }, (_, i) => judge(i + 1));

let seq = 0;
function pm(prelimRound, status, a = 1, b = 2) {
  seq += 1;
  return {
    match: {
      id: `m${seq}`,
      round: 'preliminary',
      prelim_round: prelimRound,
      status,
      team1_id: `t${a}`,
      team2_id: `t${b}`,
    },
    judgeIds: ['j1', 'j2', 'j3'],
  };
}
const many = (count, round, status) => Array.from({ length: count }, () => pm(round, status));

const base = (over = {}) => ({
  eventId: EV,
  teams: teams(20),
  judges: judges(9),
  matches: [],
  bracket: [],
  bracketScores: [],
  seedingRows: [],
  withoutTimes: 0,
  queuedConfirms: 0,
  ...over,
});

const byId = (phases) => Object.fromEntries(phases.map((p) => [p.id, p]));
const ids = (phases) => phases.map((p) => p.id);

// A seed-order row as seeding.js's fetchSeedingOrder returns it.
const seedRow = (teamId, seed, points, wins, tied, resolved = false) => ({
  teamId,
  seed,
  totalPoints: points,
  wins,
  tiedCount: tied,
  tiebreakRank: null,
  reason: null,
  groupResolved: resolved,
});

// Eight seeds, with places 8 and 9 level on points and wins when `levelAtCut`.
function seedingRows({ levelAtCut, resolved = false }) {
  const rows = [];
  for (let seed = 1; seed <= 10; seed += 1) {
    const level = levelAtCut && (seed === 8 || seed === 9);
    rows.push(
      seedRow(
        `t${seed}`,
        seed,
        level ? 20 : 40 - seed,
        level ? 4 : 8 - (seed % 3),
        level ? 2 : 1,
        resolved && level,
      ),
    );
  }
  return rows;
}

const slot = (round, label, matchStatus, extra = {}) => ({
  slot: {
    round,
    slot_label: label,
    team1_id: 't1',
    team2_id: 't2',
    match_id: matchStatus ? `km-${label}` : null,
    ...extra,
  },
  match: matchStatus ? { id: `km-${label}`, status: matchStatus } : null,
});

function fullBracket(statuses) {
  return [
    ...[1, 2, 3, 4].map((i) => slot('quarterfinal', `qf${i}`, statuses.qf)),
    ...[1, 2].map((i) => slot('semifinal', `sf${i}`, statuses.sf)),
    slot('final', 'final', statuses.final),
    slot('third_place', 'third_place', statuses.third),
  ];
}

describe('deriveBtcPhases: shape', () => {
  it('is always the six phases in order, each readable by the kit', () => {
    const phases = deriveBtcPhases(base());
    expect(ids(phases)).toEqual(['setup', 'round1', 'round2', 'cut', 'knockout', 'podium']);
    expect(normalisePhases(phases)).toHaveLength(6);
  });
});

describe('empty event', () => {
  it('says Setup is not started and points at adding teams', () => {
    const phases = byId(deriveBtcPhases(base({ teams: [], judges: [] })));
    expect(phases.setup.status).toBe('not_started');
    expect(phases.setup.nextAction).toEqual({ label: 'Add teams', href: L.setup });
    expect(phases.setup.count).toBe('0 teams · 0 judges');
    for (const id of ['round2', 'cut', 'knockout', 'podium']) {
      expect(phases[id].status).toBe('waiting');
    }
    expect(phases.round1.status).toBe('not_started');
  });

  it('the next step is Setup', () => {
    const next = deriveNextStep(deriveBtcPhases(base({ teams: [], judges: [] })));
    expect(next.kind).toBe('action');
    expect(next.phase.id).toBe('setup');
  });

  it('asks for judges when there are fewer than three, and for one more team when the count is odd', () => {
    const fewJudges = byId(deriveBtcPhases(base({ judges: judges(2) })));
    expect(fewJudges.setup.status).toBe('in_progress');
    expect(fewJudges.setup.nextAction.label).toBe('Add judges');
    const odd = byId(deriveBtcPhases(base({ teams: teams(19) })));
    expect(odd.setup.nextAction.label).toBe('Add a team');
    expect(odd.setup.blockedReason).toMatch(/odd number/);
  });
});

describe('Round 1 blocked by missing countries (Q3)', () => {
  const missing = (n) => [
    ...teams(20 - n),
    ...Array.from({ length: n }, (_, i) => team(100 + i, null)),
  ];

  it('blocks round 1 and names how many teams, linking to Setup', () => {
    const phases = byId(deriveBtcPhases(base({ teams: missing(2) })));
    expect(phases.round1.status).toBe('blocked');
    expect(phases.round1.blockedReason).toBe('2 teams have no country: set them in Setup.');
    expect(phases.round1.nextAction).toEqual({ label: 'Set countries', href: L.setup });
    expect(phases.setup.status).toBe('in_progress');
    expect(phases.setup.count).toBe('20 teams · 9 judges · 2 without a country');
    expect(phases.setup.nextAction.label).toBe('Set countries');
  });

  it('says "1 team has no country: set it"', () => {
    const phases = byId(deriveBtcPhases(base({ teams: missing(1) })));
    expect(phases.round1.blockedReason).toBe('1 team has no country: set it in Setup.');
  });

  it('the next step is the country fix, not the draw', () => {
    const next = deriveNextStep(deriveBtcPhases(base({ teams: missing(2) })));
    expect(next.action.href).toBe(L.setup);
  });

  it('does not block a round that was already drawn (older events)', () => {
    const phases = byId(
      deriveBtcPhases(base({ teams: missing(2), matches: many(10, 1, 'pending') })),
    );
    expect(phases.round1.status).toBe('in_progress');
  });

  it('a team whose country is set is not counted', () => {
    const phases = byId(deriveBtcPhases(base()));
    expect(phases.round1.status).toBe('not_started');
    expect(phases.round1.nextAction).toEqual({ label: 'Draw round 1', href: L.matches });
    expect(phases.setup.status).toBe('done');
  });
});

describe('mid round 1', () => {
  const matches = [...many(7, 1, 'confirmed'), ...many(1, 1, 'scoring'), ...many(2, 1, 'pending')];

  it('counts confirmed, shows scoring as the active part and offers Score next on the scoring match', () => {
    const phases = byId(deriveBtcPhases(base({ matches })));
    expect(phases.round1.status).toBe('in_progress');
    expect(phases.round1.count).toBe('7 of 10 confirmed');
    expect(phases.round1.progress).toEqual({ done: 7, active: 1, total: 10 });
    const scoring = matches.find((m) => m.match.status === 'scoring').match.id;
    expect(phases.round1.nextAction).toEqual({ label: 'Score next', href: L.scoring(scoring) });
  });

  it('counts an unnumbered preliminary match as round 1', () => {
    const phases = byId(
      deriveBtcPhases(base({ matches: [pm(null, 'confirmed'), pm(null, 'pending')] })),
    );
    expect(phases.round1.count).toBe('1 of 2 confirmed');
  });

  it('round 2 waits and says how many round-1 matches are open', () => {
    const phases = byId(deriveBtcPhases(base({ matches })));
    expect(phases.round2.status).toBe('waiting');
    expect(phases.round2.blockedReason).toBe(
      'Round 2 waits for round 1: 3 matches are not confirmed.',
    );
    expect(phases.cut.status).toBe('waiting');
  });

  it('ignores knockout matches when counting rounds', () => {
    const knockout = {
      match: { id: 'k', round: 'quarterfinal', prelim_round: null, status: 'pending' },
      judgeIds: [],
    };
    const phases = byId(deriveBtcPhases(base({ matches: [...many(2, 1, 'confirmed'), knockout] })));
    expect(phases.round1.count).toBe('2 of 2 confirmed');
  });
});

describe('round 1 done, round 2 not drawn', () => {
  it('offers to draw round 2', () => {
    const phases = byId(deriveBtcPhases(base({ matches: many(10, 1, 'confirmed') })));
    expect(phases.round1.status).toBe('done');
    expect(phases.round2.status).toBe('not_started');
    expect(phases.round2.nextAction).toEqual({ label: 'Draw round 2', href: L.matches });
  });
});

describe('mid round 2', () => {
  const matches = [
    ...many(10, 1, 'confirmed'),
    ...many(4, 2, 'confirmed'),
    ...many(6, 2, 'pending'),
  ];

  it('counts round 2 on its own and holds the cut back', () => {
    const phases = byId(deriveBtcPhases(base({ matches })));
    expect(phases.round1.status).toBe('done');
    expect(phases.round2.count).toBe('4 of 10 confirmed');
    expect(phases.round2.status).toBe('in_progress');
    expect(phases.cut.status).toBe('waiting');
    expect(phases.cut.blockedReason).toBe(
      'The cut waits for round 2: 6 matches are not confirmed.',
    );
  });

  it('the cut waits while round 2 is still undrawn', () => {
    const phases = byId(deriveBtcPhases(base({ matches: many(10, 1, 'confirmed') })));
    expect(phases.cut.blockedReason).toBe('The cut waits for round 2 to be drawn and confirmed.');
  });

  it('a round numbered above 2 still holds the cut back', () => {
    const phases = byId(
      deriveBtcPhases(
        base({
          matches: [...many(10, 1, 'confirmed'), ...many(10, 2, 'confirmed'), pm(3, 'pending')],
        }),
      ),
    );
    expect(phases.cut.status).toBe('waiting');
  });
});

describe('the cut', () => {
  const done = [...many(10, 1, 'confirmed'), ...many(10, 2, 'confirmed')];

  it('a tie at 8th and 9th is the next step: settle ties', () => {
    const phases = byId(
      deriveBtcPhases(base({ matches: done, seedingRows: seedingRows({ levelAtCut: true }) })),
    );
    expect(phases.cut.status).toBe('in_progress');
    expect(phases.cut.count).toBe('1 tie at the cut to settle');
    expect(phases.cut.nextAction.label).toBe('Settle ties');
    expect(deriveNextStep(Object.values(phases)).phase.id).toBe('cut');
  });

  it('once the tie is recorded, the next action is Lock the top 8', () => {
    const phases = byId(
      deriveBtcPhases(
        base({ matches: done, seedingRows: seedingRows({ levelAtCut: true, resolved: true }) }),
      ),
    );
    expect(phases.cut.count).toBe('Top 8 ready');
    expect(phases.cut.nextAction.label).toBe('Lock the top 8');
  });

  it('a tie that is not across the cut does not block it', () => {
    const rows = seedingRows({ levelAtCut: false });
    rows[2] = seedRow('t3', 3, 30, 5, 2);
    rows[3] = seedRow('t4', 4, 30, 5, 2);
    const phases = byId(deriveBtcPhases(base({ matches: done, seedingRows: rows })));
    expect(phases.cut.count).toBe('Top 8 ready');
  });

  it('says so when the tie check could not be read, without claiming no ties', () => {
    const phases = byId(deriveBtcPhases(base({ matches: done, seedingRows: null })));
    expect(phases.cut.count).toBe('Could not check ties');
    expect(phases.cut.status).toBe('in_progress');
  });

  it('is done once the bracket exists', () => {
    const phases = byId(
      deriveBtcPhases(
        base({
          matches: done,
          bracket: fullBracket({ qf: null, sf: null, final: null, third: null }),
        }),
      ),
    );
    expect(phases.cut.status).toBe('done');
    expect(phases.knockout.status).toBe('in_progress');
  });
});

describe('mid knockout', () => {
  const done = [...many(10, 1, 'confirmed'), ...many(10, 2, 'confirmed')];

  it('shows the per-round count and offers Score next on an open match', () => {
    const bracket = [
      ...[1, 2, 3, 4].map((i) => slot('quarterfinal', `qf${i}`, 'confirmed')),
      slot('semifinal', 'sf1', 'confirmed'),
      slot('semifinal', 'sf2', 'scoring'),
      slot('final', 'final', null, { team1_id: null }),
      slot('third_place', 'third_place', null, { team1_id: null }),
    ];
    const phases = byId(deriveBtcPhases(base({ matches: done, bracket })));
    expect(phases.knockout.count).toBe('QF 4 of 4 · SF 1 of 2 · Final 0 of 1 · Third 0 of 1');
    expect(phases.knockout.status).toBe('in_progress');
    expect(phases.knockout.nextAction).toEqual({ label: 'Score next', href: L.scoring('km-sf2') });
    expect(phases.podium.status).toBe('waiting');
  });

  it('offers Assign judges when a slot has both teams and no match', () => {
    const bracket = fullBracket({ qf: 'confirmed', sf: 'confirmed', final: null, third: null });
    const phases = byId(deriveBtcPhases(base({ matches: done, bracket })));
    expect(phases.knockout.nextAction).toEqual({ label: 'Assign judges', href: L.bracket });
  });

  it('is waiting for the cut with no bracket', () => {
    const phases = byId(deriveBtcPhases(base({ matches: done })));
    expect(phases.knockout.status).toBe('waiting');
    expect(phases.knockout.blockedReason).toBe('The knockout waits for the cut.');
  });
});

describe('podium decided', () => {
  const done = [...many(10, 1, 'confirmed'), ...many(10, 2, 'confirmed')];
  const bracket = fullBracket({
    qf: 'confirmed',
    sf: 'confirmed',
    final: 'confirmed',
    third: 'confirmed',
  });
  const finalEntry = bracket.find((e) => e.slot.round === 'final');
  const thirdEntry = bracket.find((e) => e.slot.round === 'third_place');
  finalEntry.slot.team1_id = 't1';
  finalEntry.slot.team2_id = 't2';
  const score = (entry, t1, t2, a, b) => ({
    match_id: entry.slot.match_id,
    status: 'confirmed',
    team1_id: t1,
    team2_id: t2,
    team1_total: a,
    team2_total: b,
  });

  it('names champion, runner-up and third, and everything is done', () => {
    const scores = [score(finalEntry, 't1', 't2', 30, 20), score(thirdEntry, 't3', 't4', 25, 22)];
    const phases = deriveBtcPhases(base({ matches: done, bracket, bracketScores: scores }));
    const p = byId(phases);
    expect(p.knockout.status).toBe('done');
    expect(p.podium.status).toBe('done');
    expect(p.podium.count).toBe('Champion: Team 1 · 1st runner-up: Team 2 · 3rd place: Team 3');
    expect(deriveNextStep(phases).kind).toBe('complete');
    expect(currentPhaseLabel(phases)).toBe('Finished');
  });

  it('a level final with no recorded winner is not decided: record the winner', () => {
    const scores = [score(finalEntry, 't1', 't2', 25, 25), score(thirdEntry, 't3', 't4', 25, 22)];
    const p = byId(deriveBtcPhases(base({ matches: done, bracket, bracketScores: scores })));
    expect(p.podium.status).toBe('in_progress');
    expect(p.podium.nextAction.label).toBe('Record the winner');
  });

  it('says it could not check when the scores read failed, instead of claiming undecided', () => {
    const p = byId(deriveBtcPhases(base({ matches: done, bracket, bracketScores: null })));
    expect(p.podium.status).toBe('in_progress');
    expect(p.podium.count).toBe('Could not check the result');
  });

  it('only third place decided shows what is known', () => {
    const half = fullBracket({
      qf: 'confirmed',
      sf: 'confirmed',
      final: 'pending',
      third: 'confirmed',
    });
    const t = half.find((e) => e.slot.round === 'third_place');
    const p = byId(
      deriveBtcPhases(
        base({ matches: done, bracket: half, bracketScores: [score(t, 't3', 't4', 25, 22)] }),
      ),
    );
    expect(p.podium.status).toBe('in_progress');
    expect(p.podium.count).toBe('3rd place: Team 3');
  });
});

describe('currentPhaseLabel', () => {
  it('names the phase under way', () => {
    const phases = deriveBtcPhases(base({ matches: many(3, 1, 'pending') }));
    expect(currentPhaseLabel(phases)).toBe('Round 1');
  });
});

describe('setupState', () => {
  it('needs an even number of teams, three judges and every country', () => {
    expect(setupState({ teams: teams(20), judges: judges(3) }).done).toBe(true);
    expect(setupState({ teams: teams(20), judges: judges(2) }).done).toBe(false);
    expect(setupState({ teams: teams(0), judges: judges(3) }).done).toBe(false);
  });
});

describe('deriveBtcWarnings', () => {
  it('is empty when nothing is wrong', () => {
    expect(deriveBtcWarnings(base())).toEqual([]);
  });

  it('warns about matches without times, singular and plural, linking to Matches', () => {
    const one = deriveBtcWarnings(base({ withoutTimes: 1 }));
    expect(one[0].text).toMatch(/^1 preliminary match has no finish times/);
    expect(one[0].href).toBe(L.matches);
    expect(deriveBtcWarnings(base({ withoutTimes: 3 }))[0].text).toMatch(
      /^3 preliminary matches have/,
    );
  });

  it('says so when the times could not be checked, rather than claiming none are missing', () => {
    const [w] = deriveBtcWarnings(base({ withoutTimes: null }));
    expect(w.severity).toBe('info');
    expect(w.id).toBe('times-unchecked');
  });

  it('counts matches with a judge from a team’s own country, across rounds', () => {
    const t = [team(1, 'BN'), team(2, 'MY')];
    const j = [judge(1, 'BN'), judge(2, 'SG'), judge(3, 'SG')];
    const clash = pm(1, 'pending');
    const clean = pm(2, 'pending');
    clean.judgeIds = ['j2', 'j3', 'j2'];
    const warnings = deriveBtcWarnings(base({ teams: t, judges: j, matches: [clash, clean] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].text).toBe('1 match has a judge from the same country as a team.');
  });

  it('a judge or team without a country never warns', () => {
    const warnings = deriveBtcWarnings(
      base({
        teams: [team(1, null), team(2, 'MY')],
        judges: [judge(1, 'SG'), judge(2), judge(3)],
        matches: [pm(1, 'pending')],
      }),
    );
    expect(warnings.find((w) => w.id === 'judge-country')).toBeUndefined();
  });

  it('warns about confirms queued on this device, with no link', () => {
    const [w] = deriveBtcWarnings(base({ queuedConfirms: 2 }));
    expect(w.text).toMatch(/^2 confirms are saved on this device/);
    expect(w.href).toBeNull();
  });

  it('has no stuck-in-scoring warning (Q4)', () => {
    const warnings = deriveBtcWarnings(base({ matches: many(3, 1, 'scoring') }));
    expect(warnings).toEqual([]);
  });
});
