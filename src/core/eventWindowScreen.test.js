// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountEventWindowLockedScreen } from './eventWindowScreen.js';
import { WINDOW_LOCKED_HEADING } from './eventWindow.js';

describe('mountEventWindowLockedScreen', () => {
  const state = { kind: 'locked', endsAt: new Date('2026-11-12T16:00:00Z') };

  it('explains the locked state in words, with one heading and two ways out', () => {
    const outlet = document.createElement('div');
    mountEventWindowLockedScreen(outlet, { state });
    expect(outlet.querySelectorAll('h1')).toHaveLength(1);
    expect(outlet.querySelector('h1').textContent).toBe(WINDOW_LOCKED_HEADING);
    expect(outlet.querySelector('h1').getAttribute('tabindex')).toBe('-1');
    expect(outlet.textContent).toMatch(/ended at the end of 12 November 2026/);
    const links = [...outlet.querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Contact us', '/contact/'],
      ['Back to events', '#/events'],
    ]);
    for (const a of outlet.querySelectorAll('a')) expect(a.className).toMatch(/tap-target/);
  });

  it('replaces whatever was in the outlet and sets text, never markup', () => {
    const outlet = document.createElement('div');
    outlet.innerHTML = '<p id="old">old</p>';
    mountEventWindowLockedScreen(outlet, { state: { kind: 'locked', endsAt: null } });
    expect(outlet.querySelector('#old')).toBeNull();
    expect(outlet.querySelector('script')).toBeNull();
  });
});
