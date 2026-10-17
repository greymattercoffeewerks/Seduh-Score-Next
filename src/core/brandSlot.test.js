import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_DISPLAY_NAME,
  applyBrandColors,
  normaliseBrand,
  renderBrandIdentity,
} from './brandSlot.js';
import { POWERED_BY_TEXT, renderPoweredBy, shouldShowPoweredBy } from './poweredBy.js';
import { brandCssVariables } from './brandColor.js';

// vitest runs from the repo root
const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

describe('the credit', () => {
  it('is always shown: shouldShowPoweredBy has no argument and no way to say no', () => {
    expect(shouldShowPoweredBy()).toBe(true);
    expect(shouldShowPoweredBy.length).toBe(0);
    for (const odd of [null, undefined, false, 0, '', {}, { whiteLabel: true }, 'off']) {
      expect(shouldShowPoweredBy(odd)).toBe(true);
    }
  });

  it('reads "Powered by Seduh Score" and carries the lockup', () => {
    const credit = renderPoweredBy();
    expect(credit.textContent).toBe(POWERED_BY_TEXT);
    expect(POWERED_BY_TEXT).toBe('Powered by Seduh Score');
    expect(credit.querySelector('.brand-lockup')).not.toBeNull();
    expect(credit.classList.contains('powered-by')).toBe(true);
  });

  it('is static text: not hidden, not decorative, not a live region', () => {
    const credit = renderPoweredBy('powered-by-band');
    expect(credit.hasAttribute('hidden')).toBe(false);
    expect(credit.getAttribute('aria-hidden')).toBeNull();
    expect(credit.getAttribute('aria-live')).toBeNull();
    expect(credit.getAttribute('role')).toBeNull();
    expect(credit.classList.contains('powered-by-band')).toBe(true);
  });
});

describe('normaliseBrand', () => {
  it('keeps a clean name, an https logo and a strict accent', () => {
    expect(
      normaliseBrand({
        displayName: 'Brew Lab',
        logoUrl: 'https://x.supabase.co/storage/v1/object/public/branding/o/abc.webp',
        logoAlt: 'The Brew Lab cup',
        accentHex: '#E91E63',
      }),
    ).toEqual({
      displayName: 'Brew Lab',
      logoUrl: 'https://x.supabase.co/storage/v1/object/public/branding/o/abc.webp',
      logoAlt: 'The Brew Lab cup',
      accentHex: '#e91e63',
    });
  });

  it('is null when there is no identity to show: nothing, or only an accent colour', () => {
    for (const none of [
      null,
      undefined,
      0,
      '',
      'Brew Lab',
      [],
      [{ displayName: 'x' }],
      {},
      { displayName: '' },
      { displayName: '   ' },
      { accentHex: '#e91e63' },
      { logoUrl: 'javascript:alert(1)' },
    ]) {
      expect(normaliseBrand(none)).toBeNull();
    }
  });

  it('refuses a name over the limit rather than cutting it, and accepts one at the limit', () => {
    expect(normaliseBrand({ displayName: 'x'.repeat(MAX_DISPLAY_NAME + 1) })).toBeNull();
    expect(normaliseBrand({ displayName: 'x'.repeat(MAX_DISPLAY_NAME) }).displayName).toHaveLength(
      MAX_DISPLAY_NAME,
    );
  });

  it('cleans a name: one line, no invisible text-direction controls, markup kept as plain text', () => {
    expect(normaliseBrand({ displayName: '  Brew\n\tLab  ' }).displayName).toBe('Brew Lab');
    expect(normaliseBrand({ displayName: 'Brew ‮Lab‬' }).displayName).toBe('Brew Lab');
    expect(normaliseBrand({ displayName: '<img src=x onerror=alert(1)>' }).displayName).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('drops every logo address that is not a plain https image address, but keeps the name', () => {
    const bad = [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://x.test/abc',
      'file:///etc/passwd',
      '//evil.test/logo.png',
      '/relative/logo.png',
      'logo.png',
      'http://evil.test/logo.png',
      'ftp://evil.test/logo.png',
      'https://user:pass@evil.test/logo.png',
      'https://x.test/logo.svg',
      'https://x.test/LOGO.SVG?v=2#x',
      'https://x.test/anim.gif',
      'https://' + 'a'.repeat(3000) + '.test/x.png',
      '',
      null,
      42,
      {},
    ];
    for (const logoUrl of bad) {
      const brand = normaliseBrand({ displayName: 'Brew Lab', logoUrl });
      expect(brand.logoUrl, String(logoUrl).slice(0, 40)).toBeNull();
      expect(brand.displayName).toBe('Brew Lab');
    }
  });

  it('accepts plain http only for this machine, for the local development stack', () => {
    expect(
      normaliseBrand({ displayName: 'x', logoUrl: 'http://127.0.0.1:54421/storage/v1/o/a.png' })
        .logoUrl,
    ).toBe('http://127.0.0.1:54421/storage/v1/o/a.png');
    expect(
      normaliseBrand({ displayName: 'x', logoUrl: 'http://localhost:54421/a.png' }).logoUrl,
    ).toBe('http://localhost:54421/a.png');
    expect(
      normaliseBrand({ displayName: 'x', logoUrl: 'http://127.0.0.1.evil.test/a.png' }).logoUrl,
    ).toBeNull();
  });

  it('drops an accent that is not a strict #rrggbb', () => {
    for (const accentHex of ['red', '#fff', ' #e91e63', '#e91e63 ', '#gggggg', null, 7, {}]) {
      expect(normaliseBrand({ displayName: 'x', accentHex }).accentHex).toBeNull();
    }
  });

  it('is idempotent, so a caller may pass raw door output or an already-cleaned brand', () => {
    const once = normaliseBrand({ displayName: ' Brew  Lab ', accentHex: '#E91E63' });
    expect(normaliseBrand(once)).toEqual(once);
  });

  it('reads only own properties: a field merely inherited from a prototype is ignored', () => {
    const input = Object.freeze({ displayName: 'Brew Lab' });
    expect(() => normaliseBrand(input)).not.toThrow();
    expect(normaliseBrand(Object.create({ displayName: 'Inherited' }))).toBeNull();
    const mixed = Object.create({ displayName: 'Inherited', accentHex: '#e91e63' });
    mixed.displayName = 'Own';
    expect(normaliseBrand(mixed)).toEqual({
      displayName: 'Own',
      logoUrl: null,
      logoAlt: '',
      accentHex: null,
    });
  });

  it('refuses a name made only of characters that draw nothing', () => {
    const invisible = [
      '​​​', // zero-width space
      '⁠⁠', // word joiner
      'ㅤ', // Hangul filler
      'ᅟᅠ', // Hangul choseong and jungseong fillers
      '­­', // soft hyphens
      '؜', // Arabic letter mark
      '⠀', // blank Braille
      '‍‌', // joiners
      ' ​ \t\n ',
      '‮‬',
    ];
    for (const displayName of invisible) {
      expect(normaliseBrand({ displayName }), JSON.stringify(displayName)).toBeNull();
    }
    // ...but a real name with invisible characters around it keeps its visible part.
    expect(normaliseBrand({ displayName: '​Brew​ Lab⁠' }).displayName).toBe('Brew Lab');
    // and an invisible name does not hide a usable logo.
    expect(normaliseBrand({ displayName: '​', logoUrl: 'https://x.test/a.png' }).displayName).toBe(
      '',
    );
  });

  it('keeps the joiners that are spelling inside a name (Persian, emoji) and drops them at the ends', () => {
    expect(normaliseBrand({ displayName: 'می‌خواهم' }).displayName).toBe('می‌خواهم');
    expect(normaliseBrand({ displayName: '‍‌Brew‌' }).displayName).toBe('Brew');
    const family = '👨‍👩‍👧';
    expect(normaliseBrand({ displayName: `${family} Cafe` }).displayName).toBe(`${family} Cafe`);
  });

  it('counts characters, not UTF-16 units: sixty emoji fit, sixty-one do not', () => {
    expect(normaliseBrand({ displayName: '☕'.repeat(60) }).displayName).toHaveLength(60);
    expect(normaliseBrand({ displayName: '🍵'.repeat(60) })).not.toBeNull();
    expect(normaliseBrand({ displayName: '🍵'.repeat(61) })).toBeNull();
  });
});

describe('renderBrandIdentity', () => {
  const brand = (extra = {}) =>
    normaliseBrand({ displayName: 'Brew Lab', logoUrl: 'https://x.test/a.png', ...extra });

  it('sets the name as text, never as markup', () => {
    const node = renderBrandIdentity(
      normaliseBrand({ displayName: '<img src=x onerror=alert(1)>' }),
    );
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('lets the browser pick the name direction, so a right-to-left name is cut at its end, not its start', () => {
    const node = renderBrandIdentity(normaliseBrand({ displayName: 'مقهى ليب' }));
    expect(node.querySelector('.brand-slot-name').getAttribute('dir')).toBe('auto');
  });

  it('shows the logo beside the name as decorative, unless the organiser wrote a different description', () => {
    expect(renderBrandIdentity(brand()).querySelector('img').getAttribute('alt')).toBe('');
    expect(
      renderBrandIdentity(brand({ logoAlt: 'Brew Lab' }))
        .querySelector('img')
        .getAttribute('alt'),
    ).toBe('');
    expect(
      renderBrandIdentity(brand({ logoAlt: 'A steaming cup' }))
        .querySelector('img')
        .getAttribute('alt'),
    ).toBe('A steaming cup');
  });

  it('gives a logo with no name a label, because the logo then carries the identity', () => {
    const only = normaliseBrand({ logoUrl: 'https://x.test/a.png' });
    expect(renderBrandIdentity(only).querySelector('img').getAttribute('alt')).toBe('Logo');
    const described = normaliseBrand({ logoUrl: 'https://x.test/a.png', logoAlt: 'Brew Lab' });
    expect(renderBrandIdentity(described).querySelector('img').getAttribute('alt')).toBe(
      'Brew Lab',
    );
  });

  it('loads the logo without leaking where the page is, and never as a draggable', () => {
    const img = renderBrandIdentity(brand()).querySelector('img');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.getAttribute('src')).toBe('https://x.test/a.png');
  });

  it('removes a logo that fails to load and keeps the name, so a missing image never breaks a screen', () => {
    const node = renderBrandIdentity(brand());
    const img = node.querySelector('img');
    img.dispatchEvent(new Event('error'));
    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('.brand-slot-name').textContent).toBe('Brew Lab');
  });

  it('falls back to the Seduh Score lockup when a logo-only brand fails to load, never an empty slot', () => {
    const only = normaliseBrand({ logoUrl: 'https://x.test/a.png' });
    const node = renderBrandIdentity(only);
    node.querySelector('img').dispatchEvent(new Event('error'));
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('Seduh Score');
    expect(node.querySelector('.brand-lockup')).not.toBeNull();
  });

  it('leaves the slot empty of lockups when the surface already carries one (lockupFallback: false)', () => {
    const only = normaliseBrand({ logoUrl: 'https://x.test/a.png' });
    const node = renderBrandIdentity(only, { lockupFallback: false });
    node.querySelector('img').dispatchEvent(new Event('error'));
    expect(node.querySelector('.brand-lockup')).toBeNull();
    expect(node.textContent).toBe('');
  });

  it('can make the name the surface heading', () => {
    expect(renderBrandIdentity(brand(), { nameTag: 'h1' }).querySelector('h1')).not.toBeNull();
    expect(renderBrandIdentity(brand()).querySelector('h1')).toBeNull();
  });
});

describe('applyBrandColors', () => {
  const ACCENT = ['--color-accent', '--color-accent-hover', '--color-accent-contrast'];

  it('sets exactly the three accent properties and a data-brand marker, for the surface mode given', () => {
    const root = document.createElement('div');
    applyBrandColors(root, normaliseBrand({ displayName: 'x', accentHex: '#e91e63' }), 'stage');
    expect(root.hasAttribute('data-brand')).toBe(true);
    for (const name of ACCENT) expect(root.style.getPropertyValue(name)).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.length).toBe(3);
  });

  it('derives for the mode it is given: the same colour comes out differently on stage and paper', () => {
    const brand = normaliseBrand({ displayName: 'x', accentHex: '#2dd4c0' });
    const stage = document.createElement('div');
    const paper = document.createElement('div');
    applyBrandColors(stage, brand, 'stage');
    applyBrandColors(paper, brand, 'paper');
    expect(stage.style.getPropertyValue('--color-accent')).toBe('#2dd4c0');
    expect(paper.style.getPropertyValue('--color-accent')).not.toBe('#2dd4c0');
  });

  it('clears the three properties and the marker when there is no brand or no accent, and touches nothing else', () => {
    const root = document.createElement('div');
    root.style.setProperty('--color-test', 'hotpink');
    root.style.setProperty('--color-canvas', 'black');
    applyBrandColors(root, normaliseBrand({ displayName: 'x', accentHex: '#e91e63' }), 'stage');
    applyBrandColors(root, null, 'stage');
    expect(root.hasAttribute('data-brand')).toBe(false);
    for (const name of ACCENT) expect(root.style.getPropertyValue(name)).toBe('');
    expect(root.style.getPropertyValue('--color-test')).toBe('hotpink');
    expect(root.style.getPropertyValue('--color-canvas')).toBe('black');
    applyBrandColors(root, normaliseBrand({ displayName: 'x' }), 'stage');
    expect(root.hasAttribute('data-brand')).toBe(false);
  });

  it('sets only the three accent names even if the colour engine ever returned more', async () => {
    const root = document.createElement('div');
    applyBrandColors(root, normaliseBrand({ displayName: 'x', accentHex: '#e91e63' }), 'stage');
    const names = [...Array(root.style.length).keys()].map((i) => root.style.item(i)).sort();
    expect(names).toEqual(ACCENT.slice().sort());
    // The key set is fixed in this module, not taken from the other one.
    expect(read('src/core/brandSlot.js')).toMatch(
      /for \(const name of ACCENT_PROPERTIES\)\s*\{\s*if \(Object\.hasOwn\(vars, name\)\)/,
    );
  });

  it('keeps its own list of the three names equal to what the colour engine returns, so neither can drift silently', () => {
    for (const mode of ['stage', 'paper']) {
      expect(Object.keys(brandCssVariables('#e91e63', mode)).sort()).toEqual(ACCENT.slice().sort());
    }
  });

  it('never sets the TEST colour, a status colour, a surface or a border, whatever the accent is', () => {
    for (const accentHex of ['#000000', '#ffffff', '#ff0000', '#808080', '#e91e63', '#2dd4c0']) {
      for (const mode of ['stage', 'paper']) {
        const root = document.createElement('div');
        applyBrandColors(root, normaliseBrand({ displayName: 'x', accentHex }), mode);
        const names = [...Array(root.style.length).keys()].map((i) => root.style.item(i));
        expect(names.sort()).toEqual([...ACCENT].sort());
      }
    }
  });

  it('ignores an unknown mode rather than guessing one', () => {
    const root = document.createElement('div');
    applyBrandColors(root, normaliseBrand({ displayName: 'x', accentHex: '#e91e63' }), 'toString');
    expect(root.hasAttribute('data-brand')).toBe(false);
    expect(root.style.length).toBe(0);
  });
});

describe('the stylesheet cannot hide, shrink or fade the credit', () => {
  // Comments removed first, so prose before a rule is never mistaken for part of its selector.
  const css = read('src/core/brandSlot.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // Every rule block whose selector list mentions a credit class.
  const creditBlocks = [...css.matchAll(/([^{}]*\.powered-by[^{}]*)\{([^}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: selector.trim(), body }),
  );

  it('finds the credit rules', () => {
    expect(creditBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it('never hides it or lowers its opacity, in any rule that names it', () => {
    for (const { selector, body } of creditBlocks) {
      expect(body, selector).not.toMatch(/display\s*:\s*none/);
      expect(body, selector).not.toMatch(/visibility\s*:\s*hidden/);
      expect(body, selector).not.toMatch(/opacity\s*:/);
      expect(body, selector).not.toMatch(/clip(-path)?\s*:/);
      expect(body, selector).not.toMatch(/text-indent\s*:\s*-/);
      expect(body, selector).not.toMatch(/(left|top|right|bottom)\s*:\s*-\d/);
    }
  });

  it('keeps a readable size and colour: 12px at the floor, and the secondary text colour', () => {
    const base = creditBlocks.find(({ selector }) => selector === '.powered-by');
    expect(base.body).toMatch(/font-size:\s*max\(var\(--text-2xs\),\s*0\.62em\)/);
    expect(base.body).toMatch(/color:\s*var\(--color-text-secondary\)/);
    // The floor token really is 12px.
    expect(read('src/ui/tokens/typography.css')).toMatch(/--text-2xs:\s*0\.75rem/);
    // Every other size rule that names the credit is also floored at --text-2xs.
    for (const { selector, body } of creditBlocks) {
      const size = body.match(/font-size:\s*([^;]+);/);
      if (size) expect(size[1], selector).toMatch(/--text-2xs/);
    }
  });

  it('does not let a surface rule the credit sits in cover it: the splash credit is above the content', () => {
    const host = css.match(/\.splash-credit-host\s*\{([^}]*)\}/)[1];
    expect(host).toMatch(/z-index:\s*1/);
    expect(host).toMatch(/top:\s*var\(--space-5\)/);
  });

  it('bounds the splash name to two lines and keeps the content between the credit and the bottom band', () => {
    const name = css.match(/\.splash-brand-identity \.brand-slot-name\s*\{([^}]*)\}/)[1];
    expect(name).toMatch(/-webkit-line-clamp:\s*2/);
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/font-size:\s*clamp\(.*vmin/);
    const content = css.match(/\.splash-content\[data-brand\]\s*\{([^}]*)\}/)[1];
    // A viewport length: the splash root has no definite height, so a percentage would be ignored.
    expect(content).toMatch(/max-height:\s*calc\(100d?vh\s*-\s*2\s*\*\s*var\(--space-9\)\)/);
    expect(content).not.toMatch(/max-height:\s*calc\(100%/);
    expect(content).toMatch(/overflow:\s*hidden/);
  });

  it('pins the credit mark to the same non-brand token as its words, and scales the splash credit without a cap', () => {
    const mark = creditBlocks.find(({ selector }) => selector === '.powered-by .brand-lockup-mark');
    expect(mark.body).toMatch(/color:\s*var\(--color-text-secondary\)/);
    const splash = creditBlocks.find(({ selector }) => selector === '.powered-by-splash');
    expect(splash.body).toMatch(/font-size:\s*max\(var\(--text-2xs\),\s*[\d.]+vmin\)/);
  });

  it('colours the credit with a token a brand can never override (a brand only sets three accent properties)', () => {
    expect(read('src/core/brandColor.js')).not.toMatch(/--color-text-secondary/);
    expect(read('src/core/brandSlot.js')).not.toMatch(/--color-text-secondary/);
  });

  it('is linked from the app entry, after the sheets it builds on', () => {
    const html = read('app/index.html');
    const at = (name) => html.indexOf(`/src/core/${name}`);
    expect(at('brandSlot.css')).toBeGreaterThan(-1);
    for (const base of ['splashScreen.css', 'viewer-shell.css', 'stageDisplay.css']) {
      expect(at('brandSlot.css'), base).toBeGreaterThan(at(base));
    }
  });
});
