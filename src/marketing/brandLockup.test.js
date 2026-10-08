// The Seduh Score lockup (mark + wordmark) is ONE shared primitive: built by brandLockup() in
// core/dom.js, styled only in src/ui/tokens/brand.css. These tests keep it that way — the wordmark was
// once set in two different typefaces and the mark hung below the letters on every page, because each
// surface carried its own copy of the rules. They live here, not in core/, because they reach across
// surfaces (this directory may import core/, never the other way round).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mountAppShell } from '../core/appShell.js';
import { renderChrome } from '../core/viewer-shell.js';
import { buildPublicHeader } from './publicHeader.js';
import { mountLandingScreen } from './landingScreen.js';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

// Every `selector { declarations }` in a stylesheet, including those nested in @media.
function blocks(source) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const text = stripComments(source);
  let match = re.exec(text);
  while (match) {
    out.push({ selector: match[1].trim(), body: match[2] });
    match = re.exec(text);
  }
  return out;
}
const only = (source, selector) => {
  const found = blocks(source).filter((block) => block.selector === selector);
  expect(found, `exactly one "${selector}" block`).toHaveLength(1);
  return found[0].body;
};

const brandCss = read('../ui/tokens/brand.css');

describe('brand.css — the one place the lockup is styled', () => {
  it('is part of the token entry point every page loads (as a live import, not a comment)', () => {
    expect(stripComments(read('../ui/tokens/index.css'))).toMatch(/^@import '\.\/brand\.css';/m);
  });

  it('declares each lockup selector exactly once — nothing later in the file can override it', () => {
    const selectors = blocks(brandCss)
      .map((block) => block.selector)
      .filter((selector) => selector.includes('brand-lockup'));
    expect(selectors.sort()).toEqual([
      '.brand-lockup',
      '.brand-lockup-mark',
      '.brand-lockup-mark svg',
      '.brand-lockup-name',
    ]);
  });

  it('sets the wordmark in the display face, bold and wide-tracked — the same on every surface', () => {
    const lockup = only(brandCss, '.brand-lockup');
    expect(lockup).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(lockup).toMatch(/font-weight:\s*var\(--font-weight-bold\)/);
    expect(lockup).toMatch(/letter-spacing:\s*var\(--tracking-wide\)/);
    expect(lockup).toMatch(/white-space:\s*nowrap/);
    expect(lockup).toMatch(/display:\s*inline-flex/);
    expect(lockup).toMatch(/gap:\s*[\d.]+em/);
  });

  it('stands the mark on the wordmark baseline (not centred on the line box, which left it hanging below the letters)', () => {
    expect(only(brandCss, '.brand-lockup')).toMatch(/align-items:\s*baseline/);
    expect(only(brandCss, '.brand-lockup-mark')).toMatch(/transform:\s*translateY\(0\.029em\)/);
  });

  it('sizes everything in em from one custom property, with a sensible fallback', () => {
    expect(only(brandCss, '.brand-lockup')).toMatch(
      /font-size:\s*var\(--brand-lockup-size,\s*1\.0625rem\)/,
    );
    const mark = only(brandCss, '.brand-lockup-mark');
    const width = parseFloat(/width:\s*([\d.]+)em/.exec(mark)[1]);
    const height = parseFloat(/height:\s*([\d.]+)em/.exec(mark)[1]);
    // the mark's viewBox is 56 x 48: the box keeps that ratio, so the ink is never squashed
    expect(Math.abs(width / height - 56 / 48)).toBeLessThan(0.01);
    expect(mark).toMatch(/flex:\s*none/);
    expect(mark).toMatch(/color:\s*var\(--color-accent\)/);
    expect(only(brandCss, '.brand-lockup-mark svg')).toMatch(/width:\s*100%/);
    expect(only(brandCss, '.brand-lockup-mark svg')).toMatch(/height:\s*100%/);
  });
});

describe('no surface restyles the lockup itself', () => {
  const SURFACES = [
    ['../core/appShell.css', ['.app-shell-brand']],
    ['../core/viewer-shell.css', ['.viewer-chrome-name']],
    ['./publicHeader.css', ['.public-header-brand']],
    ['./landing.css', ['.petrol-brand']],
  ];
  const LOCKUPISH =
    /brand-lockup|app-shell-(mark|name)|viewer-chrome-(mark|name-text)|public-header-brand-mark|petrol-brand-mark/;
  // what a surface must never decide: the wordmark's face, weight, tracking, or the mark's geometry
  const FORBIDDEN = /(?:^|[;\s])(font[-\w]*|letter-spacing|gap|transform|width|height)\s*:/;

  it.each(SURFACES)('%s only sizes and wraps the lockup', (file, wrappers) => {
    const found = blocks(read(file));
    // any rule that reaches into the lockup or its old hook classes may recolour it (a hover state) and
    // nothing else — whatever shape the selector takes (descendant, pseudo-class, compound, in @media)
    for (const { selector, body } of found.filter((block) => LOCKUPISH.test(block.selector))) {
      const declarations = body
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => declaration.split(':')[0].trim());
      // (the phone/projector row's name hook may also truncate: that is layout, not look)
      const allowed = selector.includes('viewer-chrome-name-text')
        ? ['color', 'min-width', 'overflow', 'text-overflow', 'white-space']
        : ['color'];
      expect(
        declarations.filter((property) => !allowed.includes(property)),
        `"${selector}" may only set ${allowed.join(', ')}`,
      ).toEqual([]);
    }
    // and the wrapper around it sets a size, never a typeface or geometry
    for (const wrapper of wrappers) {
      const wrapperBlocks = found.filter((block) => block.selector === wrapper);
      expect(wrapperBlocks.length).toBeGreaterThan(0);
      for (const { body } of wrapperBlocks) expect(body).not.toMatch(FORBIDDEN);
      expect(wrapperBlocks.map((block) => block.body).join(';')).toMatch(/--brand-lockup-size:/);
    }
  });
});

describe('every surface that shows the mark and the wordmark builds one shared lockup', () => {
  afterEach(() => vi.unstubAllGlobals());

  const marks = (root) => root.querySelectorAll('svg[aria-label="Seduh"]');

  function expectOneLockup(root, container, hooks = []) {
    const lockups = root.querySelectorAll('.brand-lockup');
    expect(lockups).toHaveLength(1);
    const [lockup] = lockups;
    expect(container.contains(lockup)).toBe(true);
    expect(lockup.querySelector('.brand-lockup-name').textContent).toBe('Seduh Score');
    // the only mark on the surface is the one inside the lockup (no second, hand-placed copy)
    expect(marks(root)).toHaveLength(1);
    expect(lockup.contains(marks(root)[0])).toBe(true);
    // the hook classes other code (CSS, e2e) still relies on survive inside it
    for (const hook of hooks) expect(lockup.querySelector(hook)).not.toBeNull();
    expect(lockup.querySelector(hooks[1] ?? '.brand-lockup-name').textContent).toBe('Seduh Score');
  }

  it('the console header (a single home link)', () => {
    const root = document.createElement('div');
    const client = {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut() {},
      },
    };
    mountAppShell(root, { client });
    expectOneLockup(root, root.querySelector('a.app-shell-brand'), [
      '.app-shell-mark',
      '.app-shell-name',
    ]);
  });

  it('the public / marketing header (a single home link)', () => {
    const root = document.createElement('div');
    root.appendChild(buildPublicHeader({ active: 'tour' }));
    expectOneLockup(root, root.querySelector('a.public-header-brand'));
  });

  it('the landing page nav', () => {
    // jsdom has no matchMedia; "reduced motion" takes the simple synchronous path the landing
    // screen's own tests use.
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const root = document.createElement('div');
    mountLandingScreen(root);
    const brand = root.querySelector('.petrol-brand');
    expect(brand.querySelectorAll('.brand-lockup')).toHaveLength(1);
    expect(brand.querySelectorAll('svg[aria-label="Seduh"]')).toHaveLength(1);
    expect(brand.querySelector('.brand-lockup-name').textContent).toBe('Seduh Score');
  });

  it('the phone / projector chrome (inside its h1, with the truncation hook intact)', () => {
    const holder = document.createElement('div');
    holder.appendChild(renderChrome({ active: true }));
    expectOneLockup(holder, holder.querySelector('h1.viewer-chrome-name'), [
      '.viewer-chrome-mark',
      '.viewer-chrome-name-text',
    ]);
  });
});
