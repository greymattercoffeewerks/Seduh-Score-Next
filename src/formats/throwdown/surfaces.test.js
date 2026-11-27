// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createThrowdownViewerBody } from './viewerBody.js';
import {
  selectThrowdownScreen,
  throwdownBand,
  hasThrowdownProjectorContent,
} from './projectorScreens.js';
import { createThrowdownProjectorBody } from './projectorBody.js';
import { PROJECTOR_BODIES, PHONE_BODIES } from '../../liveSurfaces.js';

const side = (name, votes, winner) => ({ name, votes, winner });
const live = {
  eventName: 'Night',
  phase: 'live',
  competitors: 4,
  rounds: [
    {
      label: 'Semi-finals',
      phase: 'main',
      matches: [
        {
          id: 'm1',
          decided: true,
          resultKind: 'votes',
          sides: [side('Ana', 2, true), side('Bima', 1, false)],
        },
        {
          id: 'm2',
          decided: true,
          resultKind: 'walkover',
          sides: [side('Citra', null, true), side('Dani', null, false)],
        },
        {
          id: 'm3',
          decided: false,
          resultKind: null,
          sides: [side('Eka', null, null), side('Farid', null, null)],
        },
      ],
    },
  ],
  nowPlaying: [
    {
      id: 'm3',
      decided: false,
      resultKind: null,
      sides: [side('Eka', null, null), side('Farid', null, null)],
    },
  ],
  recent: [],
  champion: null,
};

describe('the phone body', () => {
  const body = createThrowdownViewerBody();
  it('has content for a published event and none for an empty payload', () => {
    expect(body.hasContent(live)).toBe(true);
    expect(body.hasContent({})).toBe(false);
    expect(body.hasContent(null)).toBe(false);
  });
  it('says results in words: the Winner label, both counts, Walkover, and what is still being decided', () => {
    const root = document.createElement('div');
    body.renderBody(root, live);
    const text = root.textContent;
    expect(text).toContain('Winner');
    expect(text).toContain('Walkover');
    expect(text).toContain('Being decided');
    expect(text).toContain('Now playing');
  });
  it('Latest results come before Now playing and read as a scoreboard: winner first with their count, then the loser', () => {
    const root = document.createElement('div');
    const [m1, m2] = live.rounds[0].matches;
    body.renderBody(root, {
      ...live,
      // the sides are in bracket order: the loser is listed first, so the old line said "0 to 1"
      recent: [{ ...m1, sides: [side('Bima', 1, false), side('Ana', 2, true)] }, m2],
    });
    const heads = [...root.querySelectorAll('.td-phone-card > h2')].map((h) => h.textContent);
    expect(heads.indexOf('Latest results')).toBeGreaterThanOrEqual(0);
    expect(heads.indexOf('Latest results')).toBeLessThan(heads.indexOf('Now playing'));
    const latest = root.querySelector('.td-phone-card');
    const rows = latest.querySelectorAll('.result-row');
    expect(rows).toHaveLength(2);
    const [win, lose] = rows[0].querySelectorAll('.result-row-line');
    expect(win.querySelector('.result-row-text').textContent).toBe('Ana');
    expect(win.querySelector('.result-row-score').textContent).toBe('2');
    expect(lose.querySelector('.result-row-name').textContent).toBe('Bima');
    expect(lose.querySelector('.result-row-score').textContent).toBe('1');
    expect(rows[0].textContent).not.toContain('wins');
    expect(rows[1].querySelector('.result-row-win .result-row-score').textContent).toBe('Walkover');
    expect(rows[1].querySelectorAll('.result-row-score')).toHaveLength(1);
  });
  it('shows each round under a header that can be collapsed; the newest is open, and a choice survives a live update', () => {
    const rounds = [
      {
        id: 'r1',
        label: 'Round 1',
        roundLabel: 'Quarter-finals',
        phase: 'main',
        matches: live.rounds[0].matches.slice(0, 2),
      },
      {
        id: 'r2',
        label: 'Round 2',
        roundLabel: 'Semi-finals',
        phase: 'main',
        matches: live.rounds[0].matches.slice(2),
      },
    ];
    const mount = () => document.createElement('div');
    const first = mount();
    body.renderBody(first, { ...live, rounds });
    let sections = first.querySelectorAll('details.round');
    expect([...sections].map((d) => d.querySelector('.round-title').textContent)).toEqual([
      'Semi-finals',
      'Quarter-finals',
    ]);
    expect([...sections].map((d) => d.open)).toEqual([true, false]);
    expect(sections[0].querySelector('.eyebrow').textContent).toBe('Round 2 \u00b7 Now');
    expect(sections[1].querySelector('.eyebrow').textContent).toBe('Round 1 \u00b7 Done');
    expect(sections[1].querySelector('.round-count').textContent).toBe('2 of 2 decided');
    // the person opens Quarter-finals and closes Semi-finals; the shell then rebuilds the body from a new payload
    sections[1].open = true;
    sections[1].dispatchEvent(new Event('toggle'));
    sections[0].open = false;
    sections[0].dispatchEvent(new Event('toggle'));
    const second = mount();
    body.renderBody(second, { ...live, rounds });
    sections = second.querySelectorAll('details.round');
    expect([...sections].map((d) => d.open)).toEqual([false, true]);
  });
  it('does not take the default open round for a choice: when a newer round arrives, the older one closes', async () => {
    const r1 = {
      id: 'r1',
      label: 'Round 1',
      roundLabel: 'Quarter-finals',
      phase: 'main',
      matches: live.rounds[0].matches.slice(0, 2),
    };
    const r2 = {
      id: 'r2',
      label: 'Round 2',
      roundLabel: 'Semi-finals',
      phase: 'main',
      matches: live.rounds[0].matches.slice(2),
    };
    const fresh = createThrowdownViewerBody(); // its own memory of what a person opened
    const first = document.createElement('div');
    fresh.renderBody(first, { ...live, rounds: [r1] });
    await new Promise((resolve) => setTimeout(resolve, 20)); // the browser's own toggle event for the default
    const second = document.createElement('div');
    fresh.renderBody(second, { ...live, rounds: [r1, r2] });
    expect([...second.querySelectorAll('details.round')].map((d) => d.open)).toEqual([true, false]);
  });
  it('says "Bye" for a bye: the winner band with the word, no opponent row', () => {
    const root = document.createElement('div');
    body.renderBody(root, {
      ...live,
      recent: [{ id: 'b1', decided: true, resultKind: 'bye', sides: [side('Gita', null, true)] }],
    });
    const row = root.querySelector('.result-row');
    expect(row.querySelector('.result-row-text').textContent).toBe('Gita');
    expect(row.querySelector('.result-row-score').textContent).toBe('Bye');
    expect(row.querySelectorAll('.result-row-line')).toHaveLength(1);
  });
  it('sets names as text, never markup', () => {
    const root = document.createElement('div');
    body.renderBody(root, {
      ...live,
      nowPlaying: [
        {
          id: 'x',
          decided: false,
          sides: [side('<img src=x onerror=alert(1)>', null, null), side('B', null, null)],
        },
      ],
    });
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x');
  });
  it('shows the champion card with the podium', () => {
    const root = document.createElement('div');
    body.renderBody(root, {
      ...live,
      champion: { name: 'Ana', runnerUp: 'Bima', thirdPlace: 'Dani' },
    });
    expect(root.querySelector('.td-phone-champion').textContent).toContain('Ana');
    expect(root.textContent).toContain('Runner-up: Bima');
    expect(root.textContent).toContain('3rd place: Dani');
  });
});

describe('the projector', () => {
  it('asks for the page loop while live and the champion screen once there is one', () => {
    expect(selectThrowdownScreen(live).key).toBe('loop');
    expect(selectThrowdownScreen({ ...live, champion: { name: 'Ana' } }).key).toBe('champion');
    expect(selectThrowdownScreen({})).toBeNull();
    expect(hasThrowdownProjectorContent({})).toBe(false);
  });
  it('names the section in the band', () => {
    expect(throwdownBand(live)).toMatchObject({
      eventName: 'Night',
      sectionLabel: 'Live bracket',
      live: true,
    });
    expect(throwdownBand({ ...live, phase: 'complete' }).sectionLabel).toBe('Final result');
  });
  it('draws only the rounds in the payload, with counts only on decided votes', () => {
    const host = document.createElement('div');
    const handle = selectThrowdownScreen(live).mount(host, live);
    // the first page of a live loop is the round under way (no Up next card in an older payload)
    expect(host.querySelector('.td-stage-list').textContent).toContain('Eka');
    const votes = [...host.querySelectorAll('.td-stage-votes')].map((n) => n.textContent);
    expect(votes).toEqual(['2', '1']);
    expect(host.textContent).toContain('Walkover');
    handle.destroy();
  });
  it('mounts the champion screen with the name and podium', () => {
    const host = document.createElement('div');
    const payload = {
      ...live,
      phase: 'complete',
      champion: { name: 'Ana', runnerUp: 'Bima', thirdPlace: null },
    };
    selectThrowdownScreen(payload).mount(host, payload);
    expect(host.querySelector('.stage-champion-name').textContent).toBe('Ana');
    expect(host.textContent).toContain('Runner-up Bima');
  });
  it('builds a stage body that passes the brand option through', () => {
    const body = createThrowdownProjectorBody({ brand: null });
    expect(body.hasContent(live)).toBe(true);
    body.destroy();
  });
});

describe('registration', () => {
  it('registers Throwdown for the projector and the phone', () => {
    expect(Object.keys(PROJECTOR_BODIES)).toContain('throwdown');
    expect(Object.keys(PHONE_BODIES)).toContain('throwdown');
    expect(PHONE_BODIES.throwdown().hasContent(live)).toBe(true);
  });
});

describe('a match decided by scoresheets, on the phone and the projector', () => {
  const judging = {
    id: 'j1',
    decided: false,
    resultKind: null,
    judging: true,
    sides: [side('Ana', null, null), side('Bima', null, null)],
  };
  const done = {
    id: 'j1',
    decided: true,
    resultKind: 'scores',
    sides: [side('Ana', null, false), side('Bima', null, true)],
  };
  const payload = (match) => ({
    ...live,
    rounds: [{ label: 'Final', phase: 'main', matches: [match] }],
    nowPlaying: match.decided ? [] : [match],
    recent: match.decided ? [match] : [],
  });
  const render = (p) => {
    const phone = document.createElement('div');
    createThrowdownViewerBody().renderBody(phone, p);
    const stage = document.createElement('div');
    selectThrowdownScreen(p).mount(stage, p);
    // what the room reads: the screen's main area and footer words (the ring's countdown is not content)
    const read = [...stage.querySelectorAll('.stage-main, .stage-footer-start')]
      .map((n) => n.textContent)
      .join(' ');
    // the phone's match blocks and scoreboards (a round header's "2 of 4 decided" is a count of matches, not a score)
    const matches = [...phone.querySelectorAll('.result-row, .match-block')]
      .map((n) => n.textContent)
      .join(' ');
    return { phone: phone.textContent, matches, stage: read };
  };

  it('says "Judges scoring" while it runs, and names no number', () => {
    const { phone, matches, stage } = render(payload(judging));
    expect(phone).toContain('Judges scoring');
    expect(stage).toContain('Judging');
    expect(matches + stage).not.toMatch(/\d/);
  });
  it('names the winner only once decided: no score, count or rule', () => {
    const { matches, stage } = render(payload(done));
    expect(matches).toContain('WinnerBima');
    expect(matches).toContain('Ana');
    expect(stage).toContain('Wins');
    expect(matches + stage).not.toMatch(/\d|judges|total|point/i);
  });
  it('never says "Judges scoring" for a match that is not judged (module off)', () => {
    const plain = { ...judging, judging: undefined };
    const { phone, stage } = render(payload(plain));
    expect(phone + stage).not.toContain('Judges scoring');
    expect(stage).not.toContain('Judging');
  });
});
