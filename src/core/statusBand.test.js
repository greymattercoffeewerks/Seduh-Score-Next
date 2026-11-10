import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bandKind,
  describeBand,
  renderStatusBand,
  BETA_BAND_TITLE,
  BETA_BAND_NOTE,
  TEST_BAND_TEXT,
} from './statusBand.js';

// Event rows as two different formats would hand them over: the band reads only the two flags.
const btcEvent = { id: 'e1', format: 'btc', name: 'ABTC rehearsal', is_test: false };
const cupTasterEvent = { id: 'e2', format: 'cup_taster', name: 'Cup Taster night', is_test: false };

describe('bandKind / describeBand', () => {
  it('gives no band to a plain real event, whatever the format', () => {
    expect(bandKind(btcEvent)).toBeNull();
    expect(bandKind(cupTasterEvent)).toBeNull();
    expect(describeBand(btcEvent)).toBeNull();
    expect(renderStatusBand(cupTasterEvent)).toBeNull();
  });

  it('shows nothing for a missing event, a missing flag or a non-true flag (is_shadow is not in the database yet)', () => {
    expect(bandKind(null)).toBeNull();
    expect(bandKind(undefined)).toBeNull();
    expect(bandKind({ is_shadow: undefined })).toBeNull();
    expect(bandKind({ is_shadow: null })).toBeNull();
    expect(bandKind({ is_shadow: 'true' })).toBeNull();
    expect(bandKind({ is_shadow: 1 })).toBeNull();
    expect(bandKind({ is_test: 'true' })).toBeNull();
  });

  it('gives the beta band to a shadow run of either format, with the one-constant wording', () => {
    for (const event of [
      { ...btcEvent, is_shadow: true },
      { ...cupTasterEvent, is_shadow: true },
    ]) {
      expect(describeBand(event)).toEqual({
        kind: 'beta',
        title: 'Seduh Score ABTC Beta Test',
        note: "Shadow run. The committee's paper scores are the official result.",
      });
    }
    expect(BETA_BAND_TITLE).toBe('Seduh Score ABTC Beta Test');
    expect(BETA_BAND_NOTE).toBe(
      "Shadow run. The committee's paper scores are the official result.",
    );
  });

  it('is never both: a test event that is also flagged shadow gets the TEST band only', () => {
    const both = { ...btcEvent, is_test: true, is_shadow: true };
    expect(bandKind(both)).toBe('test');
    const node = renderStatusBand(both);
    expect(node.classList.contains('is-test-banner')).toBe(true);
    expect(node.textContent).not.toContain(BETA_BAND_TITLE);
  });
});

describe('renderStatusBand', () => {
  it('draws the TEST band exactly as every screen drew it before (same class, same words)', () => {
    const node = renderStatusBand({ ...btcEvent, is_test: true });
    expect(node.tagName).toBe('DIV');
    expect(node.className).toBe('is-test-banner');
    expect(node.textContent).toBe(TEST_BAND_TEXT);
    expect(TEST_BAND_TEXT).toBe('Test Data — Not a Live Event');
  });

  it('draws the beta band: the title, the note, a decorative hazard stripe, and no TEST class', () => {
    const node = renderStatusBand({ ...cupTasterEvent, is_shadow: true });
    expect(node.classList.contains('ok-beta-band')).toBe(true);
    expect(node.classList.contains('is-test-banner')).toBe(false);
    expect(node.getAttribute('role')).toBe('note');
    expect(node.querySelector('.ok-beta-band-title').textContent).toBe(BETA_BAND_TITLE);
    expect(node.querySelector('.ok-beta-band-note').textContent).toBe(BETA_BAND_NOTE);
    expect(node.querySelector('.ok-beta-band-hazard').getAttribute('aria-hidden')).toBe('true');
  });

  it('never carries the violet: the beta band rules in the stylesheet do not mention the test colour', () => {
    const css = readFileSync('src/ui/tokens/components.css', 'utf8');
    const rules = css.match(/\.ok-beta-band[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/color-test|clr-test/);
    }
    // The amber edge and the graphite fill are the intended ones.
    const band = rules.find((rule) => rule.startsWith('.ok-beta-band {'));
    expect(band).toMatch(/border-bottom: 4px solid var\(--clr-warning-300\)/);
    expect(band).toMatch(/background: var\(--clr-petrol-950\)/);
  });
});
