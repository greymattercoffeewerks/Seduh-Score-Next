import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { describeEventBar } from './eventSections.js';

const ev = (format) => ({ id: 'e1', format, name: 'N' });

describe('route patterns', () => {
  it('every pattern the bar knows is a real route in main.js (a renamed route would silently drop the bar)', () => {
    const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
    const routes = new Set([...main.matchAll(/pattern:\s*'([^']+)'/g)].map((m) => m[1]));
    const patterns = [
      '/events/:eventId',
      '/events/:eventId/setup',
      '/events/:eventId/roster',
      '/events/:eventId/report',
      '/events/:eventId/stages/:stageId/heats',
      '/events/:eventId/stages/:stageId/standings',
      '/events/:eventId/heats/:heatId/timing',
      '/events/:eventId/heats/:heatId/scoring',
      '/events/:eventId/btc/setup',
      '/events/:eventId/btc/matches',
      '/events/:eventId/btc/standings',
      '/events/:eventId/btc/bracket',
      '/events/:eventId/btc/sign-off',
      '/events/:eventId/btc/matches/:matchId/scoring',
      '/events/:eventId/throwdown/matches',
      '/events/:eventId/throwdown/results',
    ];
    for (const p of patterns) expect(routes.has(p), p).toBe(true);
  });
});

describe('describeEventBar', () => {
  it('Cup Taster: Setup, Roster and Report are sections; the one for the route is current', () => {
    const bar = describeEventBar(ev('cup_taster'), '/events/:eventId/roster');
    expect(bar.sections.map((s) => s.label)).toEqual(['Event home', 'Setup', 'Roster', 'Report']);
    expect(bar.currentKey).toBe('roster');
    expect(bar.currentLabel).toBe('Roster');
    expect(bar.sections.find((s) => s.key === 'roster').href).toBe('#/events/e1/roster');
  });

  it('the event home is current with no trailing label', () => {
    const bar = describeEventBar(ev('btc'), '/events/:eventId');
    expect(bar.currentKey).toBe('home');
    expect(bar.currentLabel).toBeNull();
  });

  it('BTC offers every work screen; match scoring is a leaf with no current section', () => {
    const bracket = describeEventBar(ev('btc'), '/events/:eventId/btc/bracket');
    expect(bracket.sections.map((s) => s.label)).toEqual([
      'Event home',
      'Setup',
      'Matches',
      'Standings',
      'Bracket',
      'Sign-off',
    ]);
    const leaf = describeEventBar(ev('btc'), '/events/:eventId/btc/matches/:matchId/scoring');
    expect(leaf.currentKey).toBeNull();
    expect(leaf.currentLabel).toBe('Score match');
  });

  it('Throwdown: Event home, Matches and Results; the console route marks Matches current', () => {
    const matches = describeEventBar(ev('throwdown'), '/events/:eventId/throwdown/matches');
    expect(matches.sections.map((s) => [s.label, s.href])).toEqual([
      ['Event home', '#/events/e1'],
      ['Matches', '#/events/e1/throwdown/matches'],
      ['Results', '#/events/e1/throwdown/results'],
    ]);
    expect(matches.currentKey).toBe('matches');
    expect(matches.currentLabel).toBe('Matches');
    const home = describeEventBar(ev('throwdown'), '/events/:eventId');
    expect(home.currentKey).toBe('home');
    expect(home.currentLabel).toBeNull();
    expect(describeEventBar(ev('throwdown'), '/events/:eventId/throwdown/results').currentKey).toBe(
      'results',
    );
  });

  it('a heat screen is a leaf of Cup Taster', () => {
    const bar = describeEventBar(ev('cup_taster'), '/events/:eventId/heats/:heatId/timing');
    expect(bar.currentLabel).toBe('Timing');
    expect(bar.currentKey).toBeNull();
  });

  it('is null for an unknown format, or a route that is not that format own', () => {
    expect(describeEventBar(ev('guess_the_bean'), '/events/:eventId')).toBeNull();
    expect(describeEventBar(ev('cup_taster'), '/events/:eventId/btc/matches')).toBeNull();
    expect(describeEventBar(null, '/events/:eventId')).toBeNull();
  });
});
