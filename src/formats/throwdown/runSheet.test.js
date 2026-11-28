import { describe, it, expect } from 'vitest';
import {
  currentPhaseLabel,
  deriveThrowdownPhases,
  deriveThrowdownWarnings,
  throwdownLinks,
} from './runSheet.js';
import { deriveNextStep, normalisePhases } from '../../core/runSheet.js';
import { normaliseWarnings } from '../../core/eventWarnings.js';
import {
  bracketOf,
  dashboardData,
  entriesOf,
  entry,
  match,
  undecided,
} from './dashboardFixtures.js';

const L = throwdownLinks('ev1');
const phasesOf = (data) => deriveThrowdownPhases(data);
const phase = (phases, id) => phases.find((p) => p.id === id);
const ids = (phases) => phases.map((p) => p.id);

// four competitors, semi-finals undecided
const semis = (matches, opts = {}) => {
  const entries = opts.entries ?? entriesOf(4);
  return dashboardData({ entries, bracket: bracketOf(entries, [{ matches }]), ...opts.data });
};

describe('throwdownLinks', () => {
  it('names the places and encodes the id', () => {
    expect(L).toEqual({
      home: '#/events/ev1',
      matches: '#/events/ev1/throwdown/matches',
      results: '#/events/ev1/throwdown/results',
    });
    expect(throwdownLinks('a b/c').matches).toBe('#/events/a%20b%2Fc/throwdown/matches');
  });
});

describe('before the draw', () => {
  it('is blocked under 2 active competitors and says how to fix it', () => {
    const entries = [entry(1)];
    const phases = phasesOf(dashboardData({ entries, bracket: bracketOf(entries, []) }));
    const setup = phase(phases, 'setup');
    expect(setup.status).toBe('blocked');
    expect(setup.blockedReason).toBe('Add at least 2 competitors.');
    expect(setup.count).toBe('1 competitor · 3 judges · 3rd place on');
    expect(phase(phases, 'draw').status).toBe('waiting');
    expect(deriveNextStep(phases).action.label).toBe('Add competitors');
  });

  it('does not count a withdrawn competitor as active', () => {
    const entries = [entry(1), entry(2), entry(3, { withdrawn: true })];
    const data = dashboardData({ entries, bracket: bracketOf(entries, []) });
    expect(phase(phasesOf(data), 'setup').count).toBe('2 competitors · 3 judges · 3rd place on');
    expect(phase(phasesOf(data), 'setup').status).not.toBe('blocked');
    expect(deriveThrowdownWarnings(data)).toEqual([]);
  });

  it('is ready with 2 or more: the draw is the one primary next step', () => {
    const entries = entriesOf(4);
    const phases = phasesOf(
      dashboardData({ entries, bracket: bracketOf(entries, []), settings: { judge_count: 1 } }),
    );
    expect(phase(phases, 'setup').status).toBe('in_progress');
    expect(phase(phases, 'setup').count).toBe('4 competitors · 1 judge · 3rd place on');
    expect(deriveNextStep(phases).action).toEqual({ label: 'Draw and start', href: L.matches });
    expect(ids(phases)).toEqual(['setup', 'draw', 'third-place', 'results']);
  });

  it('never names a round that does not exist', () => {
    const entries = entriesOf(8);
    const phases = phasesOf(dashboardData({ entries, bracket: bracketOf(entries, []) }));
    expect(ids(phases).some((id) => id.startsWith('round-') || id === 'rounds-to-come')).toBe(
      false,
    );
  });

  it('warns with an error under 2 active and a note on an odd count, once', () => {
    const one = [entry(1)];
    expect(
      deriveThrowdownWarnings(dashboardData({ entries: one, bracket: bracketOf(one, []) })),
    ).toEqual([
      expect.objectContaining({ id: 'too-few-competitors', severity: 'error', href: L.matches }),
    ]);
    const five = entriesOf(5);
    expect(
      deriveThrowdownWarnings(dashboardData({ entries: five, bracket: bracketOf(five, []) })),
    ).toEqual([
      expect.objectContaining({
        id: 'odd-count',
        severity: 'info',
        text: 'Round 1 will have a bye.',
      }),
    ]);
  });

  it('says nothing about odd counts or too few once the draw exists', () => {
    const entries = entriesOf(3);
    const bracket = bracketOf(entries, [
      { matches: [match(['e1', null], { result: 'bye' }), match(['e2', 'e3'])] },
    ]);
    expect(deriveThrowdownWarnings(dashboardData({ entries, bracket }))).toEqual([]);
  });
});

describe('the draw and rounds', () => {
  it('marks setup and the draw done once started, with the draw in words', () => {
    const data = semis(undecided(2), {
      data: { settings: { third_place: false }, draw: { mode: 'random', seed: 'abc' } },
    });
    const phases = phasesOf(data);
    expect(phase(phases, 'setup')).toMatchObject({
      status: 'done',
      count: '4 competitors · 3 judges · 3rd place off',
    });
    expect(phase(phases, 'draw')).toMatchObject({
      status: 'done',
      count: 'Random draw · seed abc',
    });
    const manual = phasesOf(
      semis(undecided(2), { data: { draw: { mode: 'manual', seed: null } } }),
    );
    expect(phase(manual, 'draw').count).toBe('Manual draw');
    expect(phase(phasesOf(semis(undecided(2))), 'draw').count).toBe('Drawn');
  });

  it('mid-round: progress counts decided and in-play, a level match and queued writes warn', () => {
    const data = semis(
      [match(['e1', 'e2'], { votes: [2, 2] }), match(['e3', 'e4'], { votes: [1, 0] })],
      {
        data: { settings: { judge_count: 4 }, queuedCount: 3 },
      },
    );
    const phases = phasesOf(data);
    expect(phase(phases, 'round-1')).toMatchObject({
      label: 'Semi-finals',
      status: 'in_progress',
      count: '0 of 2 decided',
      progress: { done: 0, active: 2, total: 2 },
      nextAction: { label: 'Open matches', href: L.matches },
    });
    const warnings = deriveThrowdownWarnings(data);
    expect(warnings.map((w) => w.id)).toEqual(['level-r1m1', 'queued']);
    expect(warnings[0].text).toBe(
      'Competitor 1 vs Competitor 2 is level at 2–2. An extra tap decides it.',
    );
    expect(warnings[1].text).toBe('3 taps or actions are saved on this device and not sent yet.');
    expect(warnings.every((w) => w.href === L.matches)).toBe(true);
  });

  it('a level match warns only once the votes reach the judge count', () => {
    const early = semis([match(['e1', 'e2'], { votes: [1, 1] }), match(['e3', 'e4'])]);
    expect(deriveThrowdownWarnings(early)).toEqual([]); // 2 of 3 judges in
    const ready = semis([match(['e1', 'e2'], { votes: [1, 1] }), match(['e3', 'e4'])], {
      data: { settings: { judge_count: 2 } },
    });
    expect(deriveThrowdownWarnings(ready).map((w) => w.id)).toEqual(['level-r1m1']);
    const ahead = semis([match(['e1', 'e2'], { votes: [2, 1] }), match(['e3', 'e4'])]);
    expect(deriveThrowdownWarnings(ahead)).toEqual([]); // 3 votes, one ahead
  });

  it('a decided match never warns about being level', () => {
    const data = semis([
      match(['e1', 'e2'], { result: 'votes', votes: [2, 1] }),
      match(['e3', 'e4']),
    ]);
    expect(deriveThrowdownWarnings(data)).toEqual([]);
  });

  it('queued: singular wording, silent for 0 and for an unreadable queue', () => {
    const one = deriveThrowdownWarnings(semis(undecided(2), { data: { queuedCount: 1 } }));
    expect(one.map((w) => w.text)).toEqual([
      '1 tap or action is saved on this device and not sent yet.',
    ]);
    expect(deriveThrowdownWarnings(semis(undecided(2), { data: { queuedCount: 0 } }))).toEqual([]);
    expect(deriveThrowdownWarnings(semis(undecided(2), { data: { queuedCount: null } }))).toEqual(
      [],
    );
  });

  it('a bye counts as decided', () => {
    const entries = entriesOf(3);
    const bracket = bracketOf(entries, [
      { matches: [match(['e1', null], { result: 'bye' }), match(['e2', 'e3'])] },
    ]);
    const round = phase(phasesOf(dashboardData({ entries, bracket })), 'round-1');
    expect(round).toMatchObject({
      count: '1 of 2 decided',
      progress: { done: 1, active: 0, total: 2 },
    });
  });

  it('a walkover counts as decided; an undecided match with a withdrawn competitor asks for one', () => {
    const entries = [
      entry(1),
      entry(2, { withdrawn: true }),
      entry(3),
      entry(4, { withdrawn: true }),
    ];
    const data = dashboardData({
      entries,
      bracket: bracketOf(entries, [
        {
          matches: [
            match(['e1', 'e2'], { result: 'walkover', walkoverWinner: 1 }),
            match(['e3', 'e4']),
          ],
        },
      ]),
    });
    expect(phase(phasesOf(data), 'round-1').count).toBe('1 of 2 decided');
    const warnings = deriveThrowdownWarnings(data);
    expect(warnings).toEqual([
      expect.objectContaining({
        id: 'withdrawn-r1m2',
        severity: 'warning',
        text: 'Competitor 3 vs Competitor 4: Competitor 4 withdrew. Record a walkover.',
      }),
    ]);
  });

  it('a finished round is done with no action', () => {
    const data = semis([
      match(['e1', 'e2'], { result: 'votes', votes: [2, 1] }),
      match(['e3', 'e4'], { result: 'votes', votes: [1, 2] }),
    ]);
    expect(phase(phasesOf(data), 'round-1')).toMatchObject({ status: 'done', nextAction: null });
  });
});

describe('rounds to come', () => {
  const firstRound = (matchCount) => {
    const entries = entriesOf(matchCount * 2);
    return dashboardData({
      entries,
      bracket: bracketOf(entries, [{ matches: undecided(matchCount) }]),
      settings: { third_place: false },
    });
  };

  it.each([
    [2, 'Semi-finals', '1 more round'],
    [4, 'Quarter-finals', '2 more rounds'],
    [3, 'Round 1', '2 more rounds'],
    [5, 'Round 1', '3 more rounds'],
    [8, 'Round 1', '3 more rounds'],
    [16, 'Round 1', '4 more rounds'],
  ])('with %i matches in the latest round', (n, label, count) => {
    const toCome = phase(phasesOf(firstRound(n)), 'rounds-to-come');
    expect(toCome).toMatchObject({
      status: 'waiting',
      count,
      blockedReason: `Starts when the ${label} is decided.`,
      nextAction: null,
    });
    // it follows the last round that exists and names none after it
    const order = ids(phasesOf(firstRound(n)));
    expect(order.indexOf('rounds-to-come')).toBe(order.indexOf('round-1') + 1);
  });

  it('is absent once the Final exists', () => {
    const entries = entriesOf(4);
    const bracket = bracketOf(entries, [
      {
        matches: [
          match(['e1', 'e2'], { result: 'votes', votes: [2, 1] }),
          match(['e3', 'e4'], { result: 'votes', votes: [2, 1] }),
        ],
      },
      { matches: [match(['e1', 'e3'])] },
    ]);
    const phases = phasesOf(dashboardData({ entries, bracket }));
    expect(ids(phases)).not.toContain('rounds-to-come');
    expect(phase(phases, 'round-2').label).toBe('Final');
  });

  it('is absent when the first round is already the Final', () => {
    const entries = entriesOf(2);
    const bracket = bracketOf(entries, [{ matches: undecided(1) }]);
    expect(ids(phasesOf(dashboardData({ entries, bracket })))).not.toContain('rounds-to-come');
  });
});

describe('3rd place and results', () => {
  const semisDecided = [
    match(['e1', 'e2'], { result: 'votes', votes: [2, 1] }),
    match(['e3', 'e4'], { result: 'votes', votes: [2, 1] }),
  ];
  const withFinal = (final, third, settings) => {
    const entries = entriesOf(4);
    const rounds = [{ matches: semisDecided }, { matches: [final] }];
    if (third) rounds.push({ phase: 'third_place', matches: [third] });
    return dashboardData({ entries, bracket: bracketOf(entries, rounds), settings });
  };

  it('waits while there is no Final, and says why', () => {
    const third = phase(phasesOf(semis(semisDecided)), 'third-place');
    expect(third).toMatchObject({
      status: 'waiting',
      blockedReason: 'Created with the Final, when both semi-final losers can play.',
    });
  });

  it('is done and not played when the Final exists without one', () => {
    const third = phase(phasesOf(withFinal(match(['e1', 'e3']))), 'third-place');
    expect(third).toMatchObject({
      status: 'done',
      count: 'Not played: a semi-final bye or a withdrawn loser.',
    });
  });

  it('is a round of its own once it exists', () => {
    const phases = phasesOf(withFinal(match(['e1', 'e3']), match(['e2', 'e4'], { votes: [1, 0] })));
    expect(phase(phases, 'third-place')).toMatchObject({
      label: '3rd place',
      status: 'in_progress',
      count: '0 of 1 decided',
      progress: { done: 0, active: 1, total: 1 },
    });
    // the main rounds are the only rounds-numbered phases: the 3rd place match is not one
    expect(ids(phases).filter((id) => id.startsWith('round-'))).toEqual(['round-1', 'round-2']);
  });

  it('is absent when the event has no 3rd place', () => {
    const phases = phasesOf(withFinal(match(['e1', 'e3']), null, { third_place: false }));
    expect(ids(phases)).not.toContain('third-place');
  });

  it('results wait for a champion and the 3rd place match', () => {
    const finalDone = match(['e1', 'e3'], { result: 'votes', votes: [3, 0] });
    const phases = phasesOf(withFinal(finalDone, match(['e2', 'e4'])));
    expect(phase(phases, 'results')).toMatchObject({ status: 'not_started', nextAction: null });
    const noThird = phasesOf(withFinal(finalDone, null, { third_place: false }));
    expect(phase(noThird, 'results').status).toBe('done');
  });

  it('a complete event names the champion and opens the results', () => {
    const data = withFinal(
      match(['e1', 'e3'], { result: 'votes', votes: [3, 0] }),
      match(['e2', 'e4'], { result: 'votes', votes: [2, 1] }),
    );
    const phases = phasesOf(data);
    expect(phase(phases, 'results')).toMatchObject({
      status: 'done',
      count: 'Champion: Competitor 1',
      nextAction: { label: 'Open results', href: L.results },
    });
    expect(phases.every((p) => p.status === 'done')).toBe(true);
    expect(deriveNextStep(phases)).toEqual({ kind: 'complete' });
    expect(currentPhaseLabel(phases)).toBe('Finished');
  });
});

describe('currentPhaseLabel', () => {
  it('prefers the phase in progress or blocked, else the first not done', () => {
    expect(
      currentPhaseLabel([
        { label: 'A', status: 'done' },
        { label: 'B', status: 'in_progress' },
        { label: 'C', status: 'blocked' },
      ]),
    ).toBe('B');
    expect(currentPhaseLabel([{ label: 'A', status: 'blocked' }])).toBe('A');
    expect(
      currentPhaseLabel([
        { label: 'A', status: 'done' },
        { label: 'B', status: 'waiting' },
      ]),
    ).toBe('B');
    expect(currentPhaseLabel([])).toBe('Finished');
  });
});

describe('the core kit accepts everything this returns', () => {
  const entries = entriesOf(4);
  const cases = {
    empty: dashboardData({ entries: [], bracket: bracketOf([], []) }),
    ready: dashboardData({ entries, bracket: bracketOf(entries, []) }),
    mid: semis([match(['e1', 'e2'], { votes: [2, 2] }), match(['e3', 'e4'])], {
      data: { settings: { judge_count: 4 }, queuedCount: 2 },
    }),
  };
  it.each(Object.entries(cases))(
    '%s: nothing is dropped or reworded by normalising',
    (_name, data) => {
      const phases = phasesOf(data);
      expect(normalisePhases(phases)).toHaveLength(phases.length);
      const warnings = deriveThrowdownWarnings(data);
      expect(normaliseWarnings(warnings)).toHaveLength(warnings.length);
      expect(new Set(warnings.map((w) => w.id)).size).toBe(warnings.length);
      for (const w of warnings) expect(w.href).toBeTruthy();
    },
  );
});
