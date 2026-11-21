import { describe, it, expect } from 'vitest';
import { createChampionScreen, CHAMPION_MIN_DWELL_MS } from './stageChampionScreen.js';

const paint = (p) => ({
  name: p.name,
  scoreLine: p.score ?? null,
  podiumLine: p.podium ?? null,
  footerStart: 'Congratulations to all 8 competitors',
  footerEnd: 'Results stay on screen',
});

describe('createChampionScreen', () => {
  it('holds for 60 seconds by default and is not urgent', () => {
    const screen = createChampionScreen({ paint });
    expect(screen).toMatchObject({ key: 'champion', urgent: false, minDwellMs: 60_000 });
    expect(CHAMPION_MIN_DWELL_MS).toBe(60_000);
    expect(createChampionScreen({ paint, minDwellMs: 5000 }).minDwellMs).toBe(5000);
  });

  it('draws the label, the name, the optional lines and the footer, all as text', () => {
    const host = document.createElement('div');
    createChampionScreen({ paint }).mount(host, { name: '<b>Ana</b>', podium: 'Runner-up Ben' });
    expect(host.querySelector('.stage-champion-label').textContent).toBe('Champion');
    expect(host.querySelector('.stage-champion-name').textContent).toBe('<b>Ana</b>');
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('.stage-podium').textContent).toBe('Runner-up Ben');
    expect(host.querySelector('.stage-champion-score')).toBeNull();
    expect(host.querySelector('.stage-footer-start').textContent).toBe(
      'Congratulations to all 8 competitors',
    );
    expect(host.querySelector('.stage-footer-end').textContent).toBe('Results stay on screen');
  });

  it('updates in place on a new snapshot', () => {
    const host = document.createElement('div');
    const handle = createChampionScreen({ paint }).mount(host, { name: 'Ana' });
    handle.update({ name: 'Ben', podium: 'Runner-up Ana' });
    expect(host.querySelector('.stage-champion-name').textContent).toBe('Ben');
    expect(host.querySelectorAll('.stage-champion-name')).toHaveLength(1);
  });
});
