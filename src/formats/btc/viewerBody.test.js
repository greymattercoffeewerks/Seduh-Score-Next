import { describe, it, expect, afterEach } from 'vitest';
import { createBtcViewerBody, PHONE_TOP_PLACES } from './viewerBody.js';
import { hasBtcPublicContent, finalScoreLine } from './words.js';
import { preliminaryPayload, knockoutPayload } from './demoLivePayload.js';

const FULL_RESULTS = {
  qf1: { tokensA: 40 },
  qf2: { tokensA: 40 },
  qf3: { tokensA: 40 },
  qf4: { tokensA: 40 },
  sf1: { tokensA: 35 },
  sf2: { tokensA: 35 },
  final: { tokensA: 33 },
  third: { tokensA: 33 },
};

// What core/viewer-shell.js does around renderBody: call the previous cleanup, clear the node, render again.
function shell() {
  const container = document.createElement('div');
  document.body.append(container);
  const body = createBtcViewerBody();
  let cleanup = null;
  return {
    container,
    body,
    render(payload) {
      cleanup?.();
      container.replaceChildren();
      cleanup = body.renderBody(container, payload, {
        isTest: false,
        format: 'btc',
        eventId: 'ev1',
      });
    },
    cleanupNow() {
      cleanup?.();
      cleanup = null;
    },
    unmount() {
      cleanup?.();
      container.remove();
    },
  };
}

let current;
afterEach(() => {
  current?.unmount();
  current = null;
});

function mounted(payload) {
  current = shell();
  current.render(payload);
  return current;
}

const text = (host, selector) => host.querySelector(selector)?.textContent ?? null;
const all = (host, selector) => [...host.querySelectorAll(selector)].map((n) => n.textContent);
// A heading that carries its own context has the title in a span; the others are plain text.
const headings = (host) =>
  [...host.querySelectorAll('h2')].map(
    (h) => h.querySelector('.btc-phone-title')?.textContent ?? h.textContent,
  );
// The rows a reader can see (the rest are `hidden` until asked for).
const teamsInTable = (host) => all(host, '.btc-phone-table tbody tr:not([hidden]) th');

describe('hasContent', () => {
  it('is the neutral payload predicate the projector shares: nothing before there is a match, a bracket or standings', () => {
    expect(hasBtcPublicContent(null)).toBe(false);
    expect(hasBtcPublicContent({ phase: 'setup', standings: [{ position: 1 }] })).toBe(false);
    expect(hasBtcPublicContent(preliminaryPayload())).toBe(true);
    expect(hasBtcPublicContent(knockoutPayload())).toBe(true);
    expect(createBtcViewerBody().hasContent).toBe(hasBtcPublicContent);
  });
});

describe('the cards', () => {
  it('a preliminary round: where it is up to, what is up next, the standings and the latest results, in that order', () => {
    const { container } = mounted(preliminaryPayload({ playedCount: 12 }));
    expect(headings(container)).toEqual([
      'Preliminary round',
      'Pour Decisions vs Steam Team',
      'Standings',
      'Recent results',
    ]);
    const first = container.querySelector('.card');
    expect(all(first, 'p')).toEqual(['BTC demo rehearsal', '12 of 28 matches played']);
    expect(all(container.querySelectorAll('.card')[1], 'p')).toEqual([
      'Judges: Judge 1 · Judge 2 · Judge 3',
      'Then: Preliminary · Crema Crew vs Drip Society',
    ]);
    // the heading carries its own context, so heading navigation lists something meaningful
    expect(container.querySelectorAll('.card')[1].querySelector('h2').textContent).toBe(
      'Up next · Preliminary Pour Decisions vs Steam Team',
    );
  });

  it('a knockout: the bracket comes before the preliminary table and the results, and says how far it has got', () => {
    const { container } = mounted(
      knockoutPayload({ results: { qf1: { tokensA: 40 }, qf2: { tokensA: 40 } } }),
    );
    expect(headings(container)).toEqual([
      'Knockout',
      expect.stringMatching(/ vs /),
      'Bracket',
      'Recent results',
      'Preliminary standings',
    ]);
    expect(text(container, '.card:first-child p:last-child')).toBe(
      '2 of 8 knockout matches played',
    );
  });

  it('says a table is the preliminary one only in the knockout, and does not promise places there', () => {
    const { container } = mounted(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    const standings = [...container.querySelectorAll('.card')].find(
      (c) => c.querySelector('h2')?.textContent === 'Preliminary standings',
    );
    expect(standings.textContent).not.toMatch(/qualify/);
  });

  it('shows nothing it has no data for: no up next, no bracket, no results', () => {
    const payload = preliminaryPayload({ playedCount: 28 });
    const { container } = mounted({ ...payload, upNext: null, thenNext: null, recentResults: [] });
    expect(headings(container)).toEqual(['Preliminary round', 'Standings']);
  });

  it('omits the judges line when there are none, and the "then" line when nothing follows', () => {
    const payload = preliminaryPayload({ playedCount: 12 });
    const { container } = mounted({
      ...payload,
      upNext: { ...payload.upNext, judges: [] },
      thenNext: null,
    });
    expect(all(container.querySelectorAll('.card')[1], 'p')).toEqual([]);
  });

  it('every string is shown as text, never markup', () => {
    const payload = preliminaryPayload({ playedCount: 12 });
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = mounted({
      ...payload,
      eventName: evil,
      standings: payload.standings.map((row, i) => (i === 0 ? { ...row, teamName: evil } : row)),
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(evil);
  });
});

describe('the standings', () => {
  const rows = (n, extra = {}) =>
    Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      teamName: `Team ${i + 1}`,
      played: 5,
      wins: 5 - Math.min(i, 5),
      points: 200 - i,
      ...extra,
    }));
  const withStandings = (standings, more = {}) => ({
    phase: 'preliminary',
    eventName: 'E',
    progress: { played: 5, total: 28 },
    standings,
    ...more,
  });

  it('shows the top five places, and offers the rest with the count of teams', () => {
    const { container } = mounted(withStandings(rows(8)));
    expect(teamsInTable(container)).toEqual(['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5']);
    // the rest are in the page, hidden
    expect(container.querySelectorAll('.btc-phone-table tbody tr')).toHaveLength(8);
    const toggle = container.querySelector('[data-btc-toggle]');
    expect(toggle.textContent).toBe('Show all 8 teams');
    expect(toggle.hasAttribute('aria-expanded')).toBe(false);
    expect(toggle.getAttribute('type')).toBe('button');
    expect(PHONE_TOP_PLACES).toBe(5);
  });

  it('has no toggle when there is nothing more to show', () => {
    const { container } = mounted(withStandings(rows(5)));
    expect(container.querySelector('[data-btc-toggle]')).toBeNull();
    expect(teamsInTable(container)).toHaveLength(5);
  });

  it('keeps a tie at the fifth place together', () => {
    const standings = [
      ...rows(4),
      ...['A', 'B', 'C'].map((name) => ({ ...rows(1)[0], position: 5, teamName: name })),
    ];
    const { container } = mounted(withStandings(standings));
    expect(teamsInTable(container)).toEqual([
      'Team 1',
      'Team 2',
      'Team 3',
      'Team 4',
      'A (tied)',
      'B (tied)',
      'C (tied)',
    ]);
    expect(container.querySelector('[data-btc-toggle]')).toBeNull();
  });

  it('"Show all" reveals every team, says what a tap will do next, and can be undone', () => {
    const { container } = mounted(withStandings(rows(8)));
    const toggle = container.querySelector('[data-btc-toggle]');
    toggle.click();
    expect(teamsInTable(container)).toHaveLength(8);
    expect(toggle.textContent).toBe('Show the top 5');
    toggle.click();
    expect(teamsInTable(container)).toHaveLength(5);
    expect(toggle.textContent).toBe('Show all 8 teams');
  });

  it('works in place: tapping it does not rebuild the column a screen reader is watching', () => {
    const { container } = mounted(withStandings(rows(8)));
    const column = container.querySelector('.btc-phone');
    const table = container.querySelector('.btc-phone-table');
    const toggle = container.querySelector('[data-btc-toggle]');
    const seen = [];
    const observer = new MutationObserver((records) => seen.push(...records));
    observer.observe(container, { childList: true, subtree: true });
    toggle.click();
    observer.disconnect();
    expect(container.querySelector('.btc-phone')).toBe(column);
    expect(container.querySelector('.btc-phone-table')).toBe(table);
    expect(
      seen.filter((r) => r.type === 'childList' && r.target.closest('.btc-phone-table')),
    ).toEqual([]);
    expect(container.querySelector('[data-btc-toggle]')).toBe(toggle);
  });

  it('keeps the choice, and keyboard focus on the toggle, through the rebuild the shell does on every live update', () => {
    const view = mounted(withStandings(rows(8)));
    const toggle = view.container.querySelector('[data-btc-toggle]');
    toggle.focus();
    toggle.click();
    expect(document.activeElement).toBe(toggle);
    view.render(withStandings(rows(8), { progress: { played: 6, total: 28 } }));
    expect(teamsInTable(view.container)).toHaveLength(8);
    expect(text(view.container, '.card:first-child p:last-child')).toBe('6 of 28 matches played');
    const rebuilt = view.container.querySelector('[data-btc-toggle]');
    expect(rebuilt).not.toBe(toggle);
    expect(rebuilt.textContent).toBe('Show the top 5');
    expect(document.activeElement).toBe(rebuilt);
  });

  it('a toggle that has nothing left to hide goes away, rather than lingering as a button that does nothing', () => {
    const view = mounted(withStandings(rows(8)));
    view.container.querySelector('[data-btc-toggle]').click();
    view.render(withStandings(rows(5)));
    expect(view.container.querySelector('[data-btc-toggle]')).toBeNull();
    expect(teamsInTable(view.container)).toHaveLength(5);
  });

  it('a focus that was on the toggle when the shell painted a holding card does not come back later', async () => {
    const view = mounted(withStandings(rows(8)));
    const toggle = view.container.querySelector('[data-btc-toggle]');
    toggle.focus();
    // the shell calls the cleanup, then paints a holding card (no renderBody)
    view.cleanupNow();
    view.container.replaceChildren();
    await Promise.resolve();
    document.activeElement.blur?.();
    view.render(withStandings(rows(8)));
    expect(document.activeElement).toBe(document.body);
  });

  it('does not pull focus back to the toggle when the viewer was somewhere else', () => {
    const view = mounted(withStandings(rows(8)));
    view.container.querySelector('[data-btc-toggle]').click();
    document.activeElement.blur();
    view.render(withStandings(rows(8)));
    expect(document.activeElement).toBe(document.body);
    expect(teamsInTable(view.container)).toHaveLength(8);
  });

  it('a new body (the next event) starts with the top five', () => {
    const first = mounted(withStandings(rows(8)));
    first.container.querySelector('[data-btc-toggle]').click();
    expect(teamsInTable(first.container)).toHaveLength(8);
    first.unmount();
    const second = shell();
    current = second;
    second.render(withStandings(rows(8)));
    expect(teamsInTable(second.container)).toHaveLength(5);
  });

  it('writes a tie in the row only for teams that have played, as a word', () => {
    const standings = [
      { position: 1, teamName: 'A', played: 3, wins: 3, points: 90 },
      { position: 2, teamName: 'B', played: 3, wins: 1, points: 40 },
      { position: 2, teamName: 'C', played: 3, wins: 1, points: 40 },
      { position: 4, teamName: 'D', played: 0, wins: 0, points: 0 },
      { position: 4, teamName: 'E', played: 0, wins: 0, points: 0 },
    ];
    const { container } = mounted(withStandings(standings));
    expect(teamsInTable(container)).toEqual(['A', 'B (tied)', 'C (tied)', 'D', 'E']);
  });

  it('names the table by its heading', () => {
    const { container } = mounted(withStandings(rows(6)));
    const table = container.querySelector('.btc-phone-table');
    const heading = container.querySelector(`#${table.getAttribute('aria-labelledby')}`);
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('Standings');
  });

  it('says "1 win", and has a header row and row headers for a screen reader', () => {
    const standings = [{ position: 1, teamName: 'A', played: 2, wins: 1, points: 20 }];
    const { container } = mounted(withStandings(standings));
    expect(all(container, '.btc-phone-table tbody td')).toEqual(['1', '1 win', '20']);
    expect(all(container, '.btc-phone-table thead th')).toEqual(['Pos', 'Team', 'Wins', 'Pts']);
    expect(container.querySelector('tbody th').getAttribute('scope')).toBe('row');
    expect(container.querySelectorAll('thead th[scope="col"]')).toHaveLength(4);
  });

  it('says the cut-off in a sentence, and that a tie across it is open', () => {
    const { container } = mounted(withStandings(rows(8)));
    expect(text(container, '.card:nth-of-type(2) .stage-meta:last-child')).toBe('Top 8 qualify');
    const tied = rows(9);
    tied[8] = { ...tied[8], position: 8 };
    tied[7] = { ...tied[7], position: 8 };
    const again = mounted(withStandings(tied));
    expect(again.container.textContent).toContain('Top 8 qualify · tie for 8th');
  });
});

describe('results and the bracket', () => {
  it('says each result in a sentence: both totals, then who won', () => {
    const { container } = mounted(preliminaryPayload({ playedCount: 13 }));
    const recent = [...container.querySelectorAll('.card')].find(
      (c) => c.querySelector('h2')?.textContent === 'Recent results',
    );
    const items = [...recent.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('.btc-phone-line').textContent).toMatch(/^.+ \d+ – \d+ .+$/);
    expect(items[0].querySelector('.stage-meta').textContent).toMatch(/^Preliminary · .+ win$/);
  });

  it('says a decided tie-break with its typed reason, as text', () => {
    const { container } = mounted(
      knockoutPayload({
        results: {
          qf3: { tokensA: 30, tiebreak: { winner: 5, reason: '<b>Sudden-death</b> cup' } },
        },
      }),
    );
    expect(container.querySelector('b')).toBeNull();
    const notes = all(container, '.stage-meta').filter((t) => /Tie-break/.test(t));
    expect(notes).toContain('Roast Republic go through · Tie-break: <b>Sudden-death</b> cup');
    expect(notes.every((note) => note.includes('Roast Republic go through'))).toBe(true);
  });

  it('says a level knockout is waiting for the organiser, and picks nobody', () => {
    const { container } = mounted(knockoutPayload({ results: { qf3: { tokensA: 30 } } }));
    const waiting = all(container, '.stage-meta').filter((t) =>
      /Level on points: waiting for the organiser/.test(t),
    );
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).not.toMatch(/Roast Republic go through/);
  });

  it('lists the bracket by round, with what each match decided', () => {
    const { container } = mounted(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    expect(all(container, '.btc-phone-round')).toEqual([
      'Quarterfinals',
      'Semifinals',
      'Final',
      'Third place',
    ]);
    const lines = all(container, '.card:nth-of-type(3) .btc-phone-line');
    expect(lines[0]).toMatch(/^Bean Scene \d+ – \d+ Steam Team$/);
    expect(lines[1]).toBe('Drip Society vs Grind House');
    const metas = all(container, '.card:nth-of-type(3) li .stage-meta');
    expect(metas[0]).toBe('Bean Scene go through');
    expect(metas[1]).toBe('Not played yet');
    expect(metas.filter((m) => m === 'Waiting for earlier rounds').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(container.textContent).toContain('To be decided');
  });
});

describe('the champion', () => {
  it('comes first, with the final score and the decided podium places', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const { container } = mounted(payload);
    expect(text(container, '.btc-phone-champion-label')).toBe('Champion');
    expect(text(container, '.btc-phone-champion-name')).toBe(payload.podium.places[0].teamName);
    expect(text(container, '.btc-phone-champion .stage-meta')).toBe(finalScoreLine(payload));
    expect(text(container, '.btc-phone-champion .stage-meta')).toMatch(/^Final \d+ – \d+$/);
    // the heading carries both words, so heading navigation says who the champion is
    expect(text(container, '.btc-phone-champion h2')).toBe(
      `Champion ${payload.podium.places[0].teamName}`,
    );
    expect(container.querySelector('.btc-phone').firstElementChild.className).toBe(
      'btc-phone-champion',
    );
    expect(all(container, '.btc-phone-podium dt')).toEqual([
      'Champion',
      '1st runner-up',
      '3rd place',
    ]);
    expect(all(container, '.btc-phone-podium dd')).toEqual(
      payload.podium.places.map((place) => place.teamName),
    );
    expect(headings(container)).toContain('Final result');
  });

  it('says it was decided by tie-break', () => {
    const { container } = mounted(
      knockoutPayload({
        results: {
          ...FULL_RESULTS,
          final: { tokensA: 30, tiebreak: { winner: 0, reason: 'Coin' } },
        },
      }),
    );
    expect(text(container, '.btc-phone-champion .stage-meta')).toMatch(/, decided by tie-break$/);
  });

  it('lists only the podium places that are decided', () => {
    const { container } = mounted({
      ...knockoutPayload({ results: { ...FULL_RESULTS } }),
      podium: {
        complete: false,
        places: [
          {
            key: 'champion',
            label: 'Champion',
            state: 'decided',
            teamName: 'A',
            viaTiebreak: false,
          },
          { key: 'runnerUp', label: '1st runner-up', state: 'decided', teamName: 'B' },
          { key: 'third', label: '3rd place', state: 'pending', teamName: null },
        ],
      },
    });
    expect(all(container, '.btc-phone-podium dt')).toEqual(['Champion', '1st runner-up']);
  });

  it('is not shown while the final is tied or pending', () => {
    const { container } = mounted(
      knockoutPayload({ results: { ...FULL_RESULTS, final: { tokensA: 30 } } }),
    );
    expect(container.querySelector('.btc-phone-champion')).toBeNull();
  });
});

describe('partial payloads and the bracket card', () => {
  it('never renders an empty card (no event name, an unknown phase, no progress)', () => {
    const { container } = mounted({
      phase: 'surprise',
      standings: [{ position: 1, teamName: 'A', played: 1, wins: 1, points: 10 }],
    });
    expect(container.querySelectorAll('.card:empty')).toHaveLength(0);
    expect(headings(container)).toEqual(['Preliminary standings']);
  });

  it('a knockout payload whose bracket has no rounds does not throw', () => {
    const payload = knockoutPayload();
    expect(() => mounted({ ...payload, bracket: {} })).not.toThrow();
    expect(headings(current.container)).not.toContain('Bracket');
  });

  it('says nothing about progress for a preliminary with no total, and has no standings card without standings', () => {
    const { container } = mounted({
      phase: 'preliminary',
      eventName: 'E',
      progress: { played: 0, total: 0 },
      standings: [],
      upNext: preliminaryPayload().upNext,
    });
    expect(container.textContent).not.toMatch(/0 of 0/);
    expect(headings(container)).toEqual(['Preliminary round', 'Pour Decisions vs Steam Team']);
  });

  it('leaves out a round of the bracket that has no slots', () => {
    const payload = knockoutPayload({ results: { qf1: { tokensA: 40 } } });
    const bracket = {
      rounds: payload.bracket.rounds.map((round) =>
        round.round === 'third_place' ? { ...round, slots: [] } : round,
      ),
    };
    const { container } = mounted({ ...payload, bracket });
    expect(all(container, '.btc-phone-round')).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
  });

  it('says exactly what each bracket slot is waiting for', () => {
    const { container } = mounted(knockoutPayload({ results: { qf1: { tokensA: 40 } } }));
    const metas = all(container, '.card:nth-of-type(3) li .stage-meta');
    expect(metas).toEqual([
      'Bean Scene go through',
      'Not played yet',
      'Not played yet',
      'Not played yet',
      'Waiting for earlier rounds',
      'Waiting for earlier rounds',
      'Waiting for earlier rounds',
      'Waiting for earlier rounds',
    ]);
  });

  it('a played slot with no totals reads as a plain pairing, not "A  –  B"', () => {
    const payload = knockoutPayload({ results: { qf1: { tokensA: 40 } } });
    payload.bracket.rounds[0].slots[0].teams[0].total = null;
    const { container } = mounted(payload);
    expect(all(container, '.btc-phone-list .btc-phone-line')[0]).toBe('Bean Scene vs Steam Team');
  });

  it('shows the podium card only when a place besides the champion is decided', () => {
    const payload = knockoutPayload({ results: FULL_RESULTS });
    const onlyChampion = {
      ...payload,
      podium: {
        complete: false,
        places: payload.podium.places.map((place, i) =>
          i === 0 ? place : { ...place, state: 'pending', teamName: null },
        ),
      },
    };
    const { container } = mounted(onlyChampion);
    expect(container.querySelector('.btc-phone-champion')).not.toBeNull();
    expect(container.querySelector('.btc-phone-podium')).toBeNull();
  });

  it('puts the typed tie-break reason in the Recent results card too, as text', () => {
    const { container } = mounted(
      knockoutPayload({
        results: {
          qf3: { tokensA: 30, tiebreak: { winner: 5, reason: '<b>Sudden-death</b> cup' } },
        },
      }),
    );
    const recent = [...container.querySelectorAll('.card')].find(
      (c) => c.querySelector('h2')?.textContent === 'Recent results',
    );
    expect(text(recent, 'li .stage-meta')).toBe(
      'Quarter-final · Roast Republic go through · Tie-break: <b>Sudden-death</b> cup',
    );
    expect(recent.querySelector('b')).toBeNull();
  });
});

describe('up next in the knockout', () => {
  it('says who meets whom by seed, under the match', () => {
    const { container } = mounted(knockoutPayload());
    const upNext = container.querySelectorAll('.card')[1];
    expect(all(upNext, 'p')[0]).toBe('Seed 1 meets seed 8');
  });

  it('without seeds (published before they existed) says where each team stands in the table', () => {
    const payload = knockoutPayload();
    payload.upNext.teams = payload.upNext.teams.map((team) => ({ ...team, seed: null }));
    const { container } = mounted(payload);
    const upNext = container.querySelectorAll('.card')[1];
    expect(all(upNext, 'p')[0]).toBe('1st meets 8th');
    expect(upNext.textContent).not.toMatch(/seed/i);
  });

  it('says nothing of seeds in the preliminary round, where a place is only so far', () => {
    const { container } = mounted(preliminaryPayload({ playedCount: 12 }));
    expect(container.querySelectorAll('.card')[1].textContent).not.toMatch(/seed|meets/i);
  });

  it('says nothing when neither a seed nor a place is known', () => {
    const payload = knockoutPayload();
    payload.upNext.teams = payload.upNext.teams.map((team) => ({
      ...team,
      seed: null,
      place: null,
    }));
    const { container } = mounted(payload);
    expect(container.querySelectorAll('.card')[1].textContent).not.toMatch(/meets/);
  });
});
