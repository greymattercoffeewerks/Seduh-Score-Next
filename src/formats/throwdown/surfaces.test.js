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
  it('says results in words: who wins, the count, Walkover, and what is still being decided', () => {
    const root = document.createElement('div');
    body.renderBody(root, live);
    const text = root.textContent;
    expect(text).toContain('Ana wins · 2 to 1');
    expect(text).toContain('Citra wins · Walkover');
    expect(text).toContain('Being decided');
    expect(text).toContain('Now playing');
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
  it('asks for the bracket while live and the champion screen once there is one', () => {
    expect(selectThrowdownScreen(live).key).toBe('bracket');
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
    expect(host.querySelectorAll('.td-stage-round')).toHaveLength(1);
    expect(host.querySelector('.td-stage-now').textContent).toContain('Eka');
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
