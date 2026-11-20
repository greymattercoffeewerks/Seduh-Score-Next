// Stylesheet guards for the 2026-11-17 owner-reported layout bugs (jsdom has no layout, so these pin the rules).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (...p) => readFileSync(join(process.cwd(), ...p), 'utf8');
const rule = (css, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
};

describe('BTC roster add form (desktop)', () => {
  const css = read('src', 'formats', 'btc', 'setupScreen.css');
  it('top-aligns its fields, so a hint under one input cannot lift its label above the others', () => {
    expect(css).toMatch(
      /\.btc-roster-form\s*\{[^}]*flex-direction:\s*row;[^}]*align-items:\s*flex-start/,
    );
    expect(css).not.toMatch(/\.btc-roster-form\s*\{[^}]*align-items:\s*flex-end/);
  });
  it('keeps the Add button in a field of its own with a spacer label', () => {
    expect(read('src', 'formats', 'btc', 'setupScreen.js')).toContain('btc-roster-submit');
    expect(rule(css, '.btc-roster-form .btc-roster-submit')).toMatch(/flex:\s*0 0 auto/);
    // the spacer label inside the wrapper is what lines Add up with the inputs
    expect(read('src', 'formats', 'btc', 'setupScreen.js')).toMatch(
      /btc-roster-submit'\s*\},\s*\[\s*el\('span',\s*\{\s*className:\s*'form-field-label'/,
    );
  });
});

describe('Cup Taster registration form (desktop)', () => {
  const css = read('src', 'formats', 'cup-taster', 'rosterScreen.css');
  it('gives the phone field a basis wide enough for the country select plus a number box', () => {
    const r = rule(css, '.roster-form-fields .form-field:has(.phone-row)');
    const basis = r.match(/flex:\s*\d+\s+\d+\s+([\d.]+)rem/);
    expect(basis).toBeTruthy();
    expect(Number(basis[1])).toBeGreaterThanOrEqual(19); // 12rem select + gap + a usable number box
  });
  it('lets every field shrink below its content so neighbours never paint over each other', () => {
    expect(rule(css, '.roster-form-fields .form-field')).toMatch(/min-width:\s*0/);
  });
});

describe('success feedback and status focus (shared)', () => {
  const css = read('src', 'ui', 'tokens', 'components.css');
  it('success is a left marker, not the sunken field fill or a full box', () => {
    const r = rule(css, ".screen-feedback[data-tone='success']");
    expect(r).not.toMatch(/surface-sunken/);
    expect(r).toMatch(/(^|[\s;{])border:\s*0\s*;/);
    expect(r).toMatch(/border-inline-start:[^;]*var\(--color-success\)/);
    expect(r).toMatch(/color:\s*var\(--color-text\)/);
  });
  it('a status region focused by script gets a hairline ring, not the heavy global one', () => {
    const r = rule(css, ".screen-feedback[tabindex='-1']:focus-visible");
    expect(r).toMatch(/outline-width:\s*var\(--border-hairline\)/);
  });
  it('the BTC confirm result has at least --space-4 above it', () => {
    const r = rule(
      read('src', 'formats', 'btc', 'scoringScreen.css'),
      ".btc-scoring-screen .screen-feedback[data-region='feedback']:not(:empty)",
    );
    expect(r).toMatch(/margin-top:\s*var\(--space-4\)/);
  });
});
