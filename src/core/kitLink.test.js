import { describe, it, expect } from 'vitest';
import { safeHref, kitId } from './kitLink.js';

describe('safeHref', () => {
  it('lets through in-app hash routes, root-relative paths and http(s) addresses', () => {
    expect(safeHref('#/events/e1/btc/setup')).toBe('#/events/e1/btc/setup');
    expect(safeHref(' /app/ ')).toBe('/app/');
    expect(safeHref('https://seduhscore.com/app/')).toBe('https://seduhscore.com/app/');
    expect(safeHref('http://localhost:5273/')).toBe('http://localhost:5273/');
  });

  it('refuses script, data and protocol-relative addresses and anything that is not text', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<b>',
      '//evil.example/x',
      '/\\evil.example/x',
      '/\t/evil.example/x',
      '/\n/evil.example/x',
      'vbscript:x',
      'events/e1',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe('kitId', () => {
  it('never gives the same id twice, so two cards of one kind keep their own labels', () => {
    expect(kitId('ok-x')).not.toBe(kitId('ok-x'));
    expect(kitId('ok-x')).toMatch(/^ok-x-\d+$/);
  });
});
