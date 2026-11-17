import { describe, it, expect } from 'vitest';
import { describeEventBar } from './eventSections.js';

const ev = (format) => ({ id: 'e1', format, name: 'N' });

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
