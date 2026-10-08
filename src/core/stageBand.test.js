import { describe, it, expect } from 'vitest';
import { renderStageBand } from './stageBand.js';

const text = (node, selector) => node.querySelector(selector)?.textContent ?? null;

describe('renderStageBand', () => {
  it('shows the lockup, the event name, the stage and a Live marker', () => {
    const band = renderStageBand({
      eventName: 'Grey Matter Cup Taster Competition 2026',
      sectionLabel: 'Preliminary',
    });
    expect(band.tagName).toBe('HEADER');
    expect(band.querySelector('.brand-lockup')).not.toBeNull();
    expect(text(band, '.brand-lockup-name')).toBe('Seduh Score');
    expect(text(band, '.stage-band-event')).toBe('Grey Matter Cup Taster Competition 2026');
    expect(text(band, '.stage-band-section')).toBe('Preliminary');
    expect(text(band, '.stage-band-live')).toBe('Live');
  });

  it('marks the Live blip decorative: the word beside it carries the meaning', () => {
    const band = renderStageBand({});
    expect(band.querySelector('.stage-band-live-dot').getAttribute('aria-hidden')).toBe('true');
  });

  it('degrades to the lockup and Live marker when a payload has no event name or stage (published before they existed)', () => {
    const band = renderStageBand({});
    expect(band.querySelector('.stage-band-event')).toBeNull();
    expect(band.querySelector('.stage-band-section')).toBeNull();
    expect(band.querySelector('.brand-lockup')).not.toBeNull();
    expect(text(band, '.stage-band-live')).toBe('Live');
  });

  it('treats an empty event name or stage like a missing one, not a blank box', () => {
    const band = renderStageBand({ eventName: '', sectionLabel: '' });
    expect(band.querySelector('.stage-band-event')).toBeNull();
    expect(band.querySelector('.stage-band-section')).toBeNull();
  });

  it('can be shown without the Live marker', () => {
    const band = renderStageBand({ eventName: 'x', live: false });
    expect(band.querySelector('.stage-band-live')).toBeNull();
  });

  it('renders the event name as text, never as markup', () => {
    const band = renderStageBand({ eventName: '<img src=x onerror=alert(1)>' });
    expect(band.querySelector('img')).toBeNull();
    expect(text(band, '.stage-band-event')).toBe('<img src=x onerror=alert(1)>');
  });

  it('is called with no argument at all without throwing', () => {
    expect(() => renderStageBand()).not.toThrow();
  });
});
