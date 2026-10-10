import { describe, it, expect } from 'vitest';
import {
  KNOCKOUT_PLACES,
  matchLine,
  winsText,
  qualifyingNote,
  winnerPhrase,
  levelPhrase,
  outcomeLine,
  slotOutcome,
  podiumPlace,
  finalScoreLine,
  scoreLine,
  renderScoreLine,
  btcBand,
  hasBtcPublicContent,
  upNextKicker,
  judgesLine,
  thenLine,
  matchesPlayedLine,
  standingsHeading,
  tiedSuffix,
  decidedPodiumPlaces,
  tiebreakText,
  withTiebreak,
  knockoutTags,
  knockoutMeeting,
} from './words.js';
import { knockoutPayload } from './demoLivePayload.js';

const team = (name, winner) => ({ name, winner });
const row = (position, played = 3) => ({ position, played });

describe('small phrases', () => {
  it('names a match by its two teams', () => {
    expect(matchLine({ teams: [{ name: 'A' }, { name: 'B' }] })).toBe('A vs B');
  });

  it('says "1 win" and "2 wins"', () => {
    expect(winsText(1)).toBe('1 win');
    expect(winsText(0)).toBe('0 wins');
    expect(winsText(2)).toBe('2 wins');
  });

  it('words a win for each round', () => {
    expect(winnerPhrase('preliminary', 'X')).toBe('X win');
    expect(winnerPhrase('quarterfinal', 'X')).toBe('X go through');
    expect(winnerPhrase('semifinal', 'X')).toBe('X go through');
    expect(winnerPhrase('final', 'X')).toBe('X are the champions');
    expect(winnerPhrase('third_place', 'X')).toBe('X take third place');
  });

  it('a level preliminary is only level; a level knockout waits for the organiser', () => {
    expect(levelPhrase('preliminary')).toBe('Level on points');
    expect(levelPhrase('quarterfinal')).toBe(
      'Level on points: waiting for the organiser’s decision',
    );
    expect(levelPhrase('final')).toBe('Level on points: waiting for the organiser’s decision');
  });
});

describe('qualifyingNote', () => {
  const standings = (positions, played = 3) => positions.map((p) => row(p, played));

  it('says the top eight qualify', () => {
    expect(KNOCKOUT_PLACES).toBe(8);
    expect(qualifyingNote(standings([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe('top 8 qualify');
    expect(qualifyingNote(standings([1, 2]))).toBe('top 8 qualify');
  });

  it('says a tie across the cut-off is open, by its place', () => {
    expect(qualifyingNote(standings([1, 2, 3, 4, 5, 6, 7, 8, 8]))).toBe(
      'top 8 qualify · tie for 8th',
    );
    expect(qualifyingNote(standings([1, 2, 3, 4, 5, 6, 7, 7, 7]))).toBe(
      'top 8 qualify · tie for 7th',
    );
  });

  it('says nothing about a tie when only one of the two teams has played', () => {
    const head = standings([1, 2, 3, 4, 5, 6, 7]);
    expect(qualifyingNote([...head, row(8, 3), row(8, 0)])).toBe('top 8 qualify');
    expect(qualifyingNote([...head, row(8, 0), row(8, 3)])).toBe('top 8 qualify');
  });

  it('says nothing about a tie among teams that have not played', () => {
    expect(qualifyingNote(standings([1, 2, 3, 4, 5, 6, 7, 8, 8], 0))).toBe('top 8 qualify');
  });
});

describe('outcomeLine (a result)', () => {
  it('names the winner by the round', () => {
    expect(outcomeLine({ round: 'preliminary', teams: [team('A', true), team('B', false)] })).toBe(
      'A win',
    );
    expect(outcomeLine({ round: 'final', teams: [team('A', false), team('B', true)] })).toBe(
      'B are the champions',
    );
  });

  it('with no winner, says it is level', () => {
    expect(outcomeLine({ round: 'preliminary', teams: [team('A', false), team('B', false)] })).toBe(
      'Level on points',
    );
    expect(outcomeLine({ round: 'semifinal', teams: [team('A', false), team('B', false)] })).toBe(
      'Level on points: waiting for the organiser’s decision',
    );
  });
});

describe('slotOutcome (a bracket slot)', () => {
  const slot = (overrides) => ({
    status: 'confirmed',
    teams: [team('A', true), team('B', false)],
    level: false,
    tiebreak: null,
    ...overrides,
  });

  it('is null until the match is confirmed', () => {
    expect(slotOutcome(slot({ status: 'pending' }), 'quarterfinal')).toBeNull();
    expect(slotOutcome(slot({ status: null }), 'quarterfinal')).toBeNull();
  });

  it('names who went through', () => {
    expect(slotOutcome(slot(), 'quarterfinal')).toBe('A go through');
    expect(slotOutcome(slot(), 'third_place')).toBe('A take third place');
  });

  it('adds the organiser’s tie-break with its typed reason', () => {
    expect(
      slotOutcome(
        slot({ tiebreak: { winnerName: 'A', reason: 'Sudden-death cup' } }),
        'quarterfinal',
      ),
    ).toBe('A go through · Tie-break: Sudden-death cup');
  });

  it('a level slot without a recorded winner is waiting; one that is not level has nothing to say', () => {
    const level = slot({ teams: [team('A', false), team('B', false)], level: true });
    expect(slotOutcome(level, 'semifinal')).toBe(
      'Level on points: waiting for the organiser’s decision',
    );
    expect(
      slotOutcome(slot({ teams: [team('A', false), team('B', false)] }), 'semifinal'),
    ).toBeNull();
  });
});

describe('podiumPlace and finalScoreLine', () => {
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

  it('finds a podium place by key, or nothing', () => {
    const payload = knockoutPayload({ results });
    expect(podiumPlace(payload, 'champion').label).toBe('Champion');
    expect(podiumPlace(payload, 'nonsense')).toBeUndefined();
    expect(podiumPlace({}, 'champion')).toBeUndefined();
  });

  it('writes the final with the winner’s total first, whichever seat won', () => {
    const a = finalScoreLine(knockoutPayload({ results }));
    const b = finalScoreLine(knockoutPayload({ results: { ...results, final: { tokensA: 12 } } }));
    expect(a.visible).toMatch(/^Final \d+ – \d+$/);
    expect(a.spoken).toMatch(/^Final \d+ to \d+$/);
    const [hi, lo] = a.visible.match(/\d+/g).map(Number);
    expect(hi).toBeGreaterThan(lo);
    // the second team wins on tokens: its total still comes first
    const [hi2, lo2] = b.visible.match(/\d+/g).map(Number);
    expect(hi2).toBeGreaterThan(lo2);
  });

  it('does not reorder the payload it is given', () => {
    const payload = knockoutPayload({ results: { ...results, final: { tokensA: 12 } } });
    const before = JSON.parse(JSON.stringify(payload));
    finalScoreLine(payload);
    expect(payload).toEqual(before);
  });

  it('says how it was decided when the organiser had to', () => {
    const payload = knockoutPayload({
      results: { ...results, final: { tokensA: 30, tiebreak: { winner: 0, reason: 'Coin' } } },
    });
    expect(finalScoreLine(payload)).toEqual({
      visible: 'Final 30 – 30, decided by tie-break',
      spoken: 'Final 30 to 30, decided by tie-break',
    });
  });

  it('is null without a confirmed final or without both totals', () => {
    expect(finalScoreLine(knockoutPayload())).toBeNull();
    expect(finalScoreLine({})).toBeNull();
    const payload = knockoutPayload({ results });
    payload.bracket.rounds.find((r) => r.round === 'final').slots[0].teams[1].total = null;
    expect(finalScoreLine(payload)).toBeNull();
  });
});

describe('scoreLine', () => {
  it('keeps the visible dash while exposing “to” as the accessible name', () => {
    const score = scoreLine({
      prefix: 'Bean Scene ',
      first: 47,
      second: 20,
      suffix: ' Steam Team',
    });
    const rendered = renderScoreLine(score);
    expect(rendered.textContent).toBe('Bean Scene 47 – 20 Steam Team');
    expect(rendered.getAttribute('aria-label')).toBe('Bean Scene 47 to 20 Steam Team');
    expect(rendered.getAttribute('role')).toBe('img');
  });
});

describe('phrases both surfaces use', () => {
  it('the band names the event and the part of the competition, and is always live', () => {
    expect(btcBand({ eventName: 'E', phase: 'preliminary' })).toEqual({
      eventName: 'E',
      sectionLabel: 'Preliminary round',
      live: true,
    });
    expect(btcBand({ phase: 'knockout' }).sectionLabel).toBe('Knockout');
    expect(btcBand({ phase: 'complete' }).sectionLabel).toBe('Final result');
    expect(btcBand({ phase: 'setup' }).sectionLabel).toBeNull();
    expect(btcBand(null)).toEqual({ eventName: null, sectionLabel: null, live: true });
  });

  it('"has something to show" is false for nothing and for setup; true for a match, a bracket, standings or a champion', () => {
    expect(hasBtcPublicContent(null)).toBe(false);
    expect(hasBtcPublicContent({ phase: 'setup', upNext: {}, standings: [row(1)] })).toBe(false);
    expect(hasBtcPublicContent({ phase: 'preliminary' })).toBe(false);
    expect(hasBtcPublicContent({ phase: 'preliminary', upNext: {} })).toBe(true);
    expect(hasBtcPublicContent({ phase: 'knockout', bracket: { rounds: [] } })).toBe(true);
    expect(hasBtcPublicContent({ phase: 'preliminary', standings: [row(1)] })).toBe(true);
    expect(hasBtcPublicContent({ phase: 'preliminary', standings: [] })).toBe(false);
    const podium = (state) => ({ places: [{ key: 'champion', state }] });
    expect(hasBtcPublicContent({ phase: 'setup', podium: podium('decided') })).toBe(true);
    expect(hasBtcPublicContent({ phase: 'setup', podium: podium('tied') })).toBe(false);
  });

  it('writes the up-next, judges, then and progress lines', () => {
    expect(upNextKicker('Final')).toBe('Up next · Final');
    expect(judgesLine(['J1', 'J2'])).toBe('Judges: J1 · J2');
    expect(judgesLine([])).toBeNull();
    expect(judgesLine(undefined)).toBeNull();
    expect(thenLine({ roundLabel: 'Final', teams: [{ name: 'A' }, { name: 'B' }] })).toBe(
      'Then: Final · A vs B',
    );
    expect(matchesPlayedLine({ played: 3, total: 28 })).toBe('3 of 28 matches played');
    expect(matchesPlayedLine({ played: 0, total: 0 })).toBeNull();
    expect(matchesPlayedLine(undefined)).toBeNull();
    expect(standingsHeading('preliminary')).toBe('Standings');
    expect(standingsHeading('knockout')).toBe('Preliminary standings');
  });

  it('writes " (tied)" only for a shared place of a team with results', () => {
    const shared = new Set([2]);
    expect(tiedSuffix({ position: 2, played: 3 }, shared)).toBe(' (tied)');
    expect(tiedSuffix({ position: 2, played: 0 }, shared)).toBe('');
    expect(tiedSuffix({ position: 1, played: 3 }, shared)).toBe('');
  });

  it('lists only the decided podium places, runner-up then third', () => {
    const payload = {
      podium: {
        places: [
          { key: 'champion', state: 'decided', teamName: 'A' },
          { key: 'third', state: 'decided', teamName: 'C' },
          { key: 'runnerUp', state: 'tied', teamName: null },
        ],
      },
    };
    expect(decidedPodiumPlaces(payload).map((p) => p.key)).toEqual(['third']);
    expect(decidedPodiumPlaces({})).toEqual([]);
  });

  it('writes a tie-break with its reason, or leaves the phrase alone without one', () => {
    expect(tiebreakText({ reason: 'Coin' })).toBe('Tie-break: Coin');
    expect(withTiebreak('A go through', { reason: 'Coin' })).toBe('A go through · Tie-break: Coin');
    expect(withTiebreak('A go through', null)).toBe('A go through');
  });
});

describe('who a knockout team is', () => {
  const m = (a, b, round = 'quarterfinal') => ({ round, teams: [a, b] });

  it('introduces both teams by seed when both have one, even when places are shared', () => {
    expect(knockoutTags(m({ seed: 2, place: 2 }, { seed: 3, place: 2 }))).toEqual([
      'Seed 2',
      'Seed 3',
    ]);
  });

  it('falls back to the table place for both when seeds are missing, never mixing a seed with a place', () => {
    expect(knockoutTags(m({ seed: null, place: 2 }, { seed: null, place: 11 }))).toEqual([
      '2nd in the table',
      '11th in the table',
    ]);
    expect(knockoutTags(m({ seed: 2, place: 2 }, { seed: null, place: 8 }))).toEqual([
      '2nd in the table',
      '8th in the table',
    ]);
    expect(knockoutTags(m({ seed: null, place: null }, { seed: 4, place: 4 }))).toEqual([
      null,
      '4th in the table',
    ]);
  });

  it('has no tags in the preliminary round, where a place is only so far', () => {
    expect(knockoutTags(m({ seed: 1, place: 1 }, { seed: 2, place: 2 }, 'preliminary'))).toEqual([
      null,
      null,
    ]);
    expect(
      knockoutMeeting(m({ seed: 1, place: 1 }, { seed: 2, place: 2 }, 'preliminary')),
    ).toBeNull();
  });

  it('a meeting is "Seed 1 meets seed 8", or by place without seeds, or nothing', () => {
    expect(knockoutMeeting(m({ seed: 1, place: 1 }, { seed: 8, place: 8 }))).toBe(
      'Seed 1 meets seed 8',
    );
    expect(knockoutMeeting(m({ seed: 2, place: 2 }, { seed: 3, place: 2 }))).toBe(
      'Seed 2 meets seed 3',
    );
    expect(knockoutMeeting(m({ seed: null, place: 1 }, { seed: null, place: 8 }))).toBe(
      '1st meets 8th',
    );
    // one side has a seed and the other does not: the places are the common ground
    expect(knockoutMeeting(m({ seed: 1, place: 1 }, { seed: null, place: 8 }))).toBe(
      '1st meets 8th',
    );
    // either side with nothing known: no meeting
    expect(knockoutMeeting(m({ seed: null, place: null }, { seed: 4, place: 4 }))).toBeNull();
    expect(knockoutMeeting(m({ seed: null, place: 1 }, { seed: null, place: null }))).toBeNull();
    expect(knockoutMeeting(m({ seed: 1, place: 1 }, { seed: null, place: null }))).toBeNull();
  });
});
