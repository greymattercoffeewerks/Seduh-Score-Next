import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { renderEventBar } from './eventBar.js';

const sections = [
  { key: 'home', label: 'Event home', href: '#/events/e1' },
  { key: 'setup', label: 'Setup', href: '#/events/e1/setup' },
  { key: 'roster', label: 'Roster', href: '#/events/e1/roster' },
];
const base = { eventsHref: '#/events', eventName: 'Cup A', eventHref: '#/events/e1', sections };

describe('renderEventBar', () => {
  it('links Events and the event name, and ends the trail with the current screen as plain text', () => {
    const bar = renderEventBar({ ...base, currentLabel: 'Roster', currentKey: 'roster' });
    const trail = bar.querySelector('nav[aria-label="Breadcrumb"]');
    const links = [...trail.querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['Events', '#/events'],
      ['Cup A', '#/events/e1'],
    ]);
    const here = trail.querySelector('[aria-current="page"]');
    expect(here.textContent).toBe('Roster');
    expect(here.tagName).toBe('SPAN');
  });

  it('on the event home the name is the plain current item, not a link to itself', () => {
    const bar = renderEventBar({ ...base, currentKey: 'home' });
    const trail = bar.querySelector('nav[aria-label="Breadcrumb"]');
    expect([...trail.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Events']);
    expect(trail.querySelector('[aria-current="page"]').textContent).toBe('Cup A');
  });

  it('lists every section as a link and marks exactly the current one aria-current', () => {
    const bar = renderEventBar({ ...base, currentLabel: 'Roster', currentKey: 'roster' });
    const links = [...bar.querySelectorAll('nav[aria-label="Event sections"] a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(sections.map((s) => s.href));
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Roster']);
  });

  it('marks no section current for a screen that is not one of them (a leaf like Timing)', () => {
    const bar = renderEventBar({ ...base, currentLabel: 'Timing', currentKey: null });
    expect(bar.querySelectorAll('.event-bar-section[aria-current]')).toHaveLength(0);
  });

  it('sets names as text, never markup', () => {
    const bar = renderEventBar({
      ...base,
      eventName: '<img src=x onerror=alert(1)>',
      currentLabel: 'Roster',
    });
    expect(bar.querySelector('img')).toBeNull();
  });

  it('draws no section nav when the format supplies none', () => {
    const bar = renderEventBar({ ...base, sections: [], currentLabel: 'X' });
    expect(bar.querySelector('nav[aria-label="Event sections"]')).toBeNull();
  });
});

describe('event bar stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'core', 'appShell.css'), 'utf8');
  it('collapses while empty and wraps instead of scrolling', () => {
    expect(css).toMatch(/\.app-shell-event-bar:empty\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.event-bar\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
