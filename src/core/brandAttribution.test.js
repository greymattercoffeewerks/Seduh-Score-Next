// The attribution contract (BRANDING-SPEC 4.5): on EVERY branded audience surface, in EVERY state, whatever the
// organiser set, "Powered by Seduh Score" is present exactly once and visible; on an unbranded surface the screen
// is exactly what it was before branding existed. These tests mount the real surfaces (the projector band and
// display, the splash, the phone shell) and run the whole matrix over them, so a surface that forgets the credit,
// shows it twice, hides it in a state, or lets branding change an unbranded screen, fails here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStageDisplay } from './stageDisplay.js';
import { renderStageBand } from './stageBand.js';
import { mountSplashScreen } from './splashScreen.js';
import { mountViewerShell, renderChrome } from './viewer-shell.js';
import { createStageBody } from './stageBody.js';
import { POWERED_BY_TEXT } from './poweredBy.js';
import { normaliseBrand } from './brandSlot.js';

const normaliseBrandName = (brand) => normaliseBrand(brand)?.displayName ?? '';

const LOGO = 'https://x.supabase.co/storage/v1/object/public/branding/o/abc.webp';

// Every kind of brand an organiser (or a bug, or an attacker) could produce. `branded` says whether the surface
// should treat it as branded (an identity survives cleaning) or fall back to the ordinary Seduh Score screen.
const BRANDS = [
  { label: 'name only', brand: { displayName: 'Brew Lab' }, branded: true },
  { label: 'name and logo', brand: { displayName: 'Brew Lab', logoUrl: LOGO }, branded: true },
  { label: 'logo only', brand: { logoUrl: LOGO }, branded: true },
  {
    label: 'everything',
    brand: { displayName: 'Brew Lab', logoUrl: LOGO, logoAlt: 'A cup', accentHex: '#e91e63' },
    branded: true,
  },
  { label: 'longest name', brand: { displayName: 'W'.repeat(60) }, branded: true },
  { label: 'hostile name', brand: { displayName: '<img src=x onerror=alert(1)>' }, branded: true },
  { label: 'text-direction controls', brand: { displayName: '‮Brew‬ Lab' }, branded: true },
  {
    label: 'accent that fails contrast',
    brand: { displayName: 'x', accentHex: '#000000' },
    branded: true,
  },
  {
    label: 'accent that is white',
    brand: { displayName: 'x', accentHex: '#ffffff' },
    branded: true,
  },
  { label: 'invalid accent', brand: { displayName: 'x', accentHex: 'red' }, branded: true },
  {
    label: 'script logo address',
    brand: { displayName: 'x', logoUrl: 'javascript:alert(1)' },
    branded: true,
  },
  {
    label: 'huge alt text',
    brand: { displayName: 'x', logoUrl: LOGO, logoAlt: 'a'.repeat(5000) },
    branded: true,
  },
  { label: 'name too long', brand: { displayName: 'x'.repeat(61) }, branded: false },
  { label: 'a name that draws nothing', brand: { displayName: '​⁠​' }, branded: false },
  { label: 'accent only', brand: { accentHex: '#e91e63' }, branded: false },
  { label: 'script logo only', brand: { logoUrl: 'javascript:alert(1)' }, branded: false },
  { label: 'empty object', brand: {}, branded: false },
  { label: 'not an object', brand: 'Brew Lab', branded: false },
  { label: 'null', brand: null, branded: false },
  { label: 'undefined', brand: undefined, branded: false },
];
const BRANDED = BRANDS.filter((b) => b.branded);
const UNBRANDED = BRANDS.filter((b) => !b.branded);

// The matrix cannot be trimmed silently: every loop below runs over these, so a smaller list must fail loudly.
describe('the brand matrix', () => {
  it('keeps its size, so no kind of brand is quietly dropped', () => {
    expect(BRANDED).toHaveLength(12);
    expect(UNBRANDED).toHaveLength(8);
    // and every entry means what it says: the cleaner agrees on which are branded.
    for (const { label, brand, branded } of BRANDS) {
      expect(normaliseBrand(brand) !== null, label).toBe(branded);
    }
  });
});

// jsdom applies the real stylesheets to anything attached to the document, so "is the credit hidden by a rule in any
// of the surface's sheets" can be asked of the cascade, not just of inline styles. (Media queries are not applied.)
const SHEETS = [
  'src/ui/tokens/index.css',
  'src/core/splashScreen.css',
  'src/core/viewer-shell.css',
  'src/core/stageDisplay.css',
  'src/core/stageVocabulary.css',
  'src/core/brandSlot.css',
];
beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = SHEETS.map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join(
    '\n',
  );
  document.head.append(style);
});
afterEach(() => {
  document.body.replaceChildren();
});

// Inline styling that hides, fades or zeroes something, in every spelling the tests can think of.
function hiddenInline(node) {
  const style = node.getAttribute?.('style') ?? '';
  const opacity = /opacity\s*:\s*([\d.]+)/.exec(style);
  return (
    /display\s*:\s*none|visibility\s*:\s*(hidden|collapse)|color\s*:\s*transparent|font-size\s*:\s*0(?![.\d])/.test(
      style,
    ) ||
    (opacity !== null && Number(opacity[1]) === 0)
  );
}

// Text a person can actually read: skips anything hidden by the `hidden` attribute, aria-hidden, or inline styling.
function isHiddenNode(node) {
  return (
    node.hasAttribute?.('hidden') ||
    node.getAttribute?.('aria-hidden') === 'true' ||
    hiddenInline(node)
  );
}

// The first ancestor (or the credit itself) a stylesheet rule hides, or null. Needs the root attached to the document.
function hiddenBySheet(root) {
  for (
    let node = root.querySelector('.powered-by');
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const computed = getComputedStyle(node);
    if (computed.display === 'none' || ['hidden', 'collapse'].includes(computed.visibility)) {
      return node.className || node.tagName;
    }
  }
  return null;
}
function visibleText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1 || isHiddenNode(node)) return '';
  return [...node.childNodes].map(visibleText).join('');
}
const countOf = (text, phrase) => text.split(phrase).length - 1;

// The contract, as assertions on a mounted surface's root.
function expectCredited(root, where) {
  // Attached, so the real stylesheets apply and the cascade can be asked about the credit.
  if (!root.isConnected) document.body.append(root);
  expect(hiddenBySheet(root), `${where}: a stylesheet rule hides the credit`).toBeNull();
  const credits = root.querySelectorAll('.powered-by');
  expect(credits, `${where}: one credit element`).toHaveLength(1);
  const credit = credits[0];
  expect(credit.textContent, `${where}: its words`).toBe(POWERED_BY_TEXT);
  // Not hidden by itself or by any ancestor up to the surface root.
  for (let node = credit; node && node !== root.parentNode; node = node.parentNode) {
    expect(isHiddenNode(node), `${where}: ${node.className || node.tagName} hides the credit`).toBe(
      false,
    );
  }
  // And exactly one visible occurrence of the words anywhere on the surface (the splash pill must not repeat it).
  expect(countOf(visibleText(root), POWERED_BY_TEXT), `${where}: visible occurrences`).toBe(1);
}
function expectUncredited(root, where) {
  expect(root.querySelectorAll('.powered-by'), `${where}: no extra credit`).toHaveLength(0);
}

// ---------- the projector band and display ----------

describe('the projector band', () => {
  const WORDS = [
    { label: 'full', words: { eventName: 'Cup 2026', sectionLabel: 'Final', live: true } },
    { label: 'no words', words: {} },
    { label: 'not live', words: { eventName: 'Cup 2026', live: false } },
  ];

  for (const { label, brand } of BRANDED) {
    for (const { label: wordsLabel, words } of WORDS) {
      it(`credits Seduh Score exactly once: ${label}, ${wordsLabel}`, () => {
        const band = renderStageBand({ ...words, brand });
        expectCredited(band, `${label}/${wordsLabel}`);
        // The brand took the slot where the Seduh Score lockup was; the credit carries the only lockup.
        expect(band.querySelectorAll('.brand-lockup')).toHaveLength(1);
        expect(band.querySelector('.stage-band-brand-custom')).not.toBeNull();
        expect(
          band.querySelector('.stage-band-right').contains(band.querySelector('.powered-by')),
        ).toBe(true);
      });
    }
  }

  for (const { label, brand } of UNBRANDED) {
    it(`is exactly the ordinary band when the brand is ${label}`, () => {
      const words = { eventName: 'Cup 2026', sectionLabel: 'Final' };
      const plain = renderStageBand(words);
      const band = renderStageBand({ ...words, brand });
      expect(band.outerHTML).toBe(plain.outerHTML);
      expectUncredited(band, label);
      expect(band.querySelector('.brand-lockup-name').textContent).toBe('Seduh Score');
    });
  }

  it('still shows exactly one Seduh Score lockup and one credit when a logo-only brand fails to load', () => {
    const band = renderStageBand({ eventName: 'Cup 2026', brand: { logoUrl: LOGO } });
    band.querySelector('.brand-slot-logo').dispatchEvent(new Event('error'));
    expect(band.querySelector('.brand-slot-logo')).toBeNull();
    expectCredited(band, 'logo failed');
    expect(band.querySelectorAll('.brand-lockup')).toHaveLength(1);
  });

  it('puts the credit after the Live marker, never before the stage label', () => {
    const band = renderStageBand({ sectionLabel: 'Final', brand: { displayName: 'x' } });
    const order = [...band.querySelector('.stage-band-right').children].map((c) => c.className);
    expect(order).toEqual(['stage-band-section', 'stage-band-live', 'powered-by powered-by-band']);
  });
});

describe('the projector display', () => {
  function screenFor() {
    return {
      key: 'a',
      mount(host) {
        const main = document.createElement('div');
        host.append(main);
        return { update() {}, destroy() {} };
      },
    };
  }
  const make = (options = {}) =>
    createStageDisplay({ selectScreen: () => screenFor(), bandFor: () => null, ...options });

  it('credits a branded display even when the format published no band words at all', () => {
    for (const { label, brand } of BRANDED) {
      const display = make({ brand });
      display.update({ n: 1 });
      expectCredited(display.el, label);
      display.destroy();
    }
  });

  it('shows no band, as before, when unbranded and the format has no band words', () => {
    for (const { label, brand } of UNBRANDED) {
      const display = make({ brand });
      display.update({ n: 1 });
      expect(display.el.querySelector('.stage-band'), label).toBeNull();
      display.destroy();
    }
  });

  it('picks up a brand that arrives after the display is on screen, and drops it again', () => {
    const display = make({ bandFor: () => ({ eventName: 'Cup 2026' }) });
    display.update({ n: 1 });
    const before = display.el.querySelector('.stage-band-host').outerHTML;
    expectUncredited(display.el, 'before');

    display.setBrand({ displayName: 'Brew Lab', logoUrl: LOGO, accentHex: '#e91e63' });
    expectCredited(display.el, 'after setBrand');
    expect(display.el.hasAttribute('data-brand')).toBe(true);
    expect(display.el.querySelector('.brand-slot-name').textContent).toBe('Brew Lab');

    display.setBrand(null);
    expect(display.el.querySelector('.stage-band-host').outerHTML).toBe(before);
    expect(display.el.hasAttribute('data-brand')).toBe(false);
    expect(display.el.style.length).toBe(0);
    display.destroy();
  });

  it('does not claim Live when a branded display has no band words from its format', () => {
    const display = make({ brand: { displayName: 'Brew Lab' } });
    display.update({ n: 1 });
    expect(display.el.querySelector('.stage-band-live')).toBeNull();
    expectCredited(display.el, 'no band words');
    display.destroy();
  });

  it('ignores a brand that arrives after the display was destroyed', () => {
    const display = make({ bandFor: () => ({ eventName: 'Cup 2026' }) });
    display.update({ n: 1 });
    display.destroy();
    const before = display.el.outerHTML;
    display.setBrand({ displayName: 'Brew Lab', accentHex: '#e91e63' });
    expect(display.el.outerHTML).toBe(before);
    expect(display.el.style.length).toBe(0);
  });

  it('does not rebuild the band when the same brand is set again', () => {
    const display = make({ bandFor: () => ({ eventName: 'Cup 2026' }) });
    display.update({ n: 1 });
    display.setBrand({ displayName: 'Brew Lab' });
    const band = display.el.querySelector('.stage-band');
    display.setBrand({ displayName: 'Brew Lab' });
    expect(display.el.querySelector('.stage-band')).toBe(band);
    display.destroy();
  });

  it('keeps the credit when the payload changes and when the band words change', () => {
    let words = { eventName: 'Cup 2026', sectionLabel: 'Prelims' };
    const display = make({ bandFor: () => words, brand: { displayName: 'Brew Lab' } });
    display.update({ n: 1 });
    words = { eventName: 'Cup 2026', sectionLabel: 'Final' };
    display.update({ n: 2 });
    expectCredited(display.el, 'after change');
    display.destroy();
  });

  it('lets the body carry a brand across a release: a display built later starts branded', () => {
    const body = createStageBody({
      selectScreen: () => screenFor(),
      bandFor: () => ({ eventName: 'E' }),
      hasContent: () => true,
    });
    const host = document.createElement('div');
    body.renderBody(host, { n: 1 });
    body.setBrand({ displayName: 'Brew Lab' });
    expectCredited(host, 'live display');
    body.release();
    const next = document.createElement('div');
    body.renderBody(next, { n: 2 });
    expectCredited(next, 'rebuilt display');
    body.destroy();
  });

  it('sets only the three accent properties on the display root', () => {
    const display = make({ brand: { displayName: 'x', accentHex: '#e91e63' } });
    const names = [...Array(display.el.style.length).keys()].map((i) => display.el.style.item(i));
    expect(names.sort()).toEqual([
      '--color-accent',
      '--color-accent-contrast',
      '--color-accent-hover',
    ]);
    display.destroy();
  });
});

// ---------- the splash ----------

function splashClient(event) {
  return {
    rpc: () => Promise.resolve({ data: event ? [event] : [], error: null }),
    from: () => {
      throw new Error('the splash must not read tables');
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// The nodes the splash sets its accent colours on (never the shared root).
const SPLASH_ACCENT_NODES = ['.splash-glow-drift', '.splash-content', '.splash-badge-host'];
const EVENTS = [
  { label: 'no event yet', event: null },
  {
    label: 'a live event',
    event: { id: 'e1', name: 'Cup 2026', event_date: '2026-10-04', is_test: false },
  },
  {
    label: 'a test event',
    event: { id: 'e2', name: 'Rehearsal', event_date: null, is_test: true },
  },
];

describe('the splash', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  async function mountSplash(brand, event) {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = mountSplashScreen(root, { orgId: 'o1', client: splashClient(event), brand });
    await settle();
    return { root, handle };
  }

  for (const { label, brand } of BRANDED) {
    for (const { label: stateLabel, event } of EVENTS) {
      it(`credits Seduh Score exactly once and visibly: ${label}, ${stateLabel}`, async () => {
        const { root } = await mountSplash(brand, event);
        expectCredited(root, `${label}/${stateLabel}`);
        // The branded heading replaces the Seduh Score wordmark; there is still exactly one visible h1.
        const headings = [...root.querySelectorAll('h1')].filter((h) => !isHiddenNode(h));
        expect(headings).toHaveLength(1);
        // The name when there is one; otherwise the logo sits inside the heading.
        const named = headings[0].classList.contains('brand-slot-name');
        expect(named || headings[0].querySelector('.brand-slot-logo') !== null).toBe(true);
        expect(named).toBe(Boolean(normaliseBrandName(brand)));
      });
    }
  }

  it('keeps the credit visible on a test event, where the pill is hidden and the D9 banner speaks', async () => {
    const { root } = await mountSplash({ displayName: 'Brew Lab' }, EVENTS[2].event);
    expect(root.querySelector('.splash-badge-host').hidden).toBe(true);
    expect(root.querySelector('.is-test-banner')).not.toBeNull();
    expectCredited(root, 'test event');
    // The credit is not inside the pill, the banner, or the live region.
    const credit = root.querySelector('.powered-by');
    expect(credit.closest('.splash-badge-host')).toBeNull();
    expect(credit.closest('.splash-test-banner-host')).toBeNull();
    expect(credit.closest('[aria-live]')).toBeNull();
  });

  it('keeps the ordinary pill words when unbranded: the credit is part of the pill, as it always was', async () => {
    const live = await mountSplash(undefined, EVENTS[1].event);
    expect(live.root.querySelector('.splash-badge-live').textContent).toBe(
      'Live — Powered by Seduh Score',
    );
    const idle = await mountSplash(undefined, null);
    expect(idle.root.querySelector('.splash-badge-generic').textContent).toBe(
      'Powered by Seduh Score',
    );
    expect(idle.root.querySelector('.splash-badge-host').hidden).toBe(false);
  });

  it('never announces the brand as a status update: it sits inside the live region with announcements off', async () => {
    const { root, handle } = await mountSplash(undefined, EVENTS[1].event);
    handle.setBrand({ displayName: 'Brew Lab' });
    const brandEl = root.querySelector('.splash-brand');
    expect(brandEl.closest('[aria-live="polite"]')).not.toBeNull();
    expect(brandEl.getAttribute('aria-live')).toBe('off');
  });

  it('says only "Live" in the pill when branded, so the credit is never said twice', async () => {
    const { root } = await mountSplash({ displayName: 'Brew Lab' }, EVENTS[1].event);
    expect(root.querySelector('.splash-badge-live').textContent).toBe('Live');
  });

  for (const { label, brand } of UNBRANDED) {
    for (const { label: stateLabel, event } of EVENTS) {
      it(`is exactly the ordinary splash when the brand is ${label}: ${stateLabel}`, async () => {
        const plain = await mountSplash(undefined, event);
        const { root } = await mountSplash(brand, event);
        const pick = (r) =>
          ['.splash-content', '.splash-badge-host', '.splash-test-banner-host'].map(
            (s) => r.querySelector(s).outerHTML,
          );
        expect(pick(root)).toEqual(pick(plain.root));
        expect(root.querySelector('.powered-by')).toBeNull();
        expect(root.hasAttribute('data-brand')).toBe(false);
      });
    }
  }

  it('picks up a brand that arrives later and returns to the ordinary splash when it is cleared', async () => {
    for (const { event } of EVENTS) {
      const plain = await mountSplash(undefined, event);
      const { root, handle } = await mountSplash(undefined, event);
      handle.setBrand({ displayName: 'Brew Lab', logoUrl: LOGO, accentHex: '#e91e63' });
      expectCredited(root, 'after setBrand');
      // The accent is on the splash's own nodes, never on the shared root.
      for (const selector of SPLASH_ACCENT_NODES) {
        const node = root.querySelector(selector);
        expect(node.hasAttribute('data-brand'), selector).toBe(true);
        for (const name of ['--color-accent', '--color-accent-hover', '--color-accent-contrast']) {
          expect(node.style.getPropertyValue(name), `${selector} ${name}`).toMatch(
            /^#[0-9a-f]{6}$/,
          );
        }
      }
      expect(root.hasAttribute('data-brand')).toBe(false);
      expect(root.style.length).toBe(0);
      handle.setBrand(null);
      const pick = (r) =>
        ['.splash-content', '.splash-badge-host', '.splash-test-banner-host'].map(
          (s) => r.querySelector(s).outerHTML,
        );
      expect(pick(root)).toEqual(pick(plain.root));
      expect(root.querySelector('.powered-by')).toBeNull();
      for (const selector of SPLASH_ACCENT_NODES) {
        expect(root.querySelector(selector).hasAttribute('data-brand'), selector).toBe(false);
        for (const name of ['--color-accent', '--color-accent-hover', '--color-accent-contrast']) {
          expect(
            root.querySelector(selector).style.getPropertyValue(name),
            `${selector} ${name}`,
          ).toBe('');
        }
      }
    }
  });

  it('never touches the shared root, which outlives it: no colours, no marker, before or after unmount', async () => {
    const { root, handle } = await mountSplash(
      { displayName: 'Brew Lab', accentHex: '#e91e63' },
      null,
    );
    expect(root.style.length).toBe(0);
    expect(root.hasAttribute('data-brand')).toBe(false);
    handle.unmount();
    expect(root.querySelector('.powered-by')).toBeNull();
    expect(root.style.length).toBe(0);
    expect(root.hasAttribute('data-brand')).toBe(false);
  });

  it('does nothing when a brand arrives after the screen was unmounted (a slow door answer after navigating away)', async () => {
    const { root, handle } = await mountSplash(undefined, null);
    handle.unmount();
    const before = root.innerHTML;
    handle.setBrand({ displayName: 'Brew Lab', logoUrl: LOGO, accentHex: '#e91e63' });
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('.splash-credit-host')).toBeNull();
    expect(root.style.length).toBe(0);
  });

  it('has exactly the markup it always had when unbranded: no hidden brand node waiting in the live region', async () => {
    const { root } = await mountSplash(undefined, EVENTS[1].event);
    expect([...root.querySelector('.splash-content').children].map((c) => c.className)).toEqual([
      'splash-mark',
      'splash-wordmark',
      'splash-eventline',
      'splash-subline',
    ]);
    expect(root.querySelector('.splash-brand')).toBeNull();
    expect(root.querySelector('.splash-credit-host')).toBeNull();
  });
});

// ---------- the phone ----------

function phoneClient(row, channelStatus = 'SUBSCRIBED', readError = null) {
  const channel = {
    on: () => channel,
    subscribe: (cb) => {
      Promise.resolve().then(() => cb(channelStatus));
      return channel;
    },
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: readError ? null : row, error: readError }),
  };
  return {
    from: () => builder,
    rpc: () => Promise.resolve({ data: [], error: null }),
    channel: () => channel,
    removeChannel: () => {},
  };
}
const SESSION = {
  id: 's1',
  org_id: 'org1',
  event_id: 'ev1',
  format: 'cup_taster',
  active: true,
  is_test: false,
  payload: { standings: [1] },
};
const PHONE_STATES = [
  { label: 'a live session', row: SESSION },
  { label: 'a session that is not live', row: { ...SESSION, active: false } },
  { label: 'no session at all', row: null },
  { label: 'a test event', row: { ...SESSION, is_test: true } },
];

describe('the phone', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  async function mountPhone(brand, row) {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: (body) => {
        body.textContent = 'standings';
      },
      showChrome: true,
      client: phoneClient(row),
      brand,
    });
    return { root, handle };
  }

  for (const { label, brand } of BRANDED) {
    for (const { label: stateLabel, row } of PHONE_STATES) {
      it(`credits Seduh Score exactly once and visibly: ${label}, ${stateLabel}`, async () => {
        const { root, handle } = await mountPhone(brand, row);
        expectCredited(root, `${label}/${stateLabel}`);
        expect(root.querySelectorAll('footer.viewer-footer')).toHaveLength(1);
        // One heading, and it names the organiser rather than Seduh Score.
        expect(root.querySelectorAll('h1')).toHaveLength(1);
        handle.unmount();
      });
    }
  }

  it('keeps exactly two children in the chrome, branded or not, so the badge swap still works', () => {
    for (const brand of [null, { displayName: 'Brew Lab', logoUrl: LOGO }]) {
      const chrome = renderChrome({ active: true }, false, brand);
      expect(chrome.children).toHaveLength(2);
      expect(chrome.children[0].tagName).toBe('H1');
      expect(chrome.lastElementChild.classList.contains('viewer-badge')).toBe(true);
    }
  });

  for (const { label, brand } of UNBRANDED) {
    it(`is exactly the ordinary phone when the brand is ${label}`, async () => {
      const plain = await mountPhone(undefined, SESSION);
      const { root, handle } = await mountPhone(brand, SESSION);
      expect(root.innerHTML).toBe(plain.root.innerHTML);
      expectUncredited(root, label);
      expect(root.querySelector('footer')).toBeNull();
      handle.unmount();
      plain.handle.unmount();
    });
  }

  it('changes the heading in place, never replacing it, so a screen reader keeps its place', async () => {
    const { root, handle } = await mountPhone(undefined, SESSION);
    const heading = root.querySelector('h1');
    heading.focus?.();
    handle.setBrand({ displayName: 'Brew Lab', logoUrl: LOGO });
    expect(root.querySelector('h1')).toBe(heading);
    expect(heading.textContent).toBe('Brew Lab');
    handle.setBrand(null);
    expect(root.querySelector('h1')).toBe(heading);
    expect(heading.textContent).toBe('Seduh Score');
    handle.unmount();
  });

  it('returns to the ordinary phone, byte for byte, when a late brand is cleared', async () => {
    for (const { row } of PHONE_STATES) {
      const plain = await mountPhone(undefined, row);
      const { root, handle } = await mountPhone(undefined, row);
      handle.setBrand({ displayName: 'Brew Lab', logoUrl: LOGO, accentHex: '#e91e63' });
      expectCredited(root, 'after setBrand');
      // The accent is on the shell's own container, never on the shared root.
      expect(root.querySelector('.viewer-shell').hasAttribute('data-brand')).toBe(true);
      expect(root.hasAttribute('data-brand')).toBe(false);
      handle.setBrand(null);
      expect(root.innerHTML).toBe(plain.root.innerHTML);
      expect(root.hasAttribute('data-brand')).toBe(false);
      expect(root.style.length).toBe(0);
      handle.unmount();
      plain.handle.unmount();
    }
  });

  it('uses the paper-mode accent colours on the phone', async () => {
    const { root, handle } = await mountPhone({ displayName: 'x', accentHex: '#2dd4c0' }, SESSION);
    // Seduh teal is fine on the dark stage but too light for paper, so the phone must get a darker one.
    const accent = root.querySelector('.viewer-shell').style.getPropertyValue('--color-accent');
    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(accent).not.toBe('#2dd4c0');
    handle.unmount();
  });

  it('never sets colours on the shared root, which outlives it: the next audience screen cannot inherit them', async () => {
    const { root, handle } = await mountPhone({ displayName: 'x', accentHex: '#e91e63' }, SESSION);
    expect(root.style.length).toBe(0);
    expect(root.hasAttribute('data-brand')).toBe(false);
    handle.unmount();
    expect(root.style.length).toBe(0);
    expect(root.hasAttribute('data-brand')).toBe(false);
  });

  it('does nothing when a brand arrives after the shell was unmounted (a slow door answer after navigating away)', async () => {
    const { root, handle } = await mountPhone(undefined, SESSION);
    handle.unmount();
    const before = root.innerHTML;
    handle.setBrand({ displayName: 'Brew Lab', logoUrl: LOGO, accentHex: '#e91e63' });
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('footer')).toBeNull();
    expect(root.style.length).toBe(0);
  });

  it('does not build the brand logo again on every live update (only the badge is taken from a rebuilt chrome)', async () => {
    let change = null;
    const client = phoneClient(SESSION);
    const channel = client.channel();
    channel.on = (_event, _filter, handler) => {
      change = handler;
      return channel;
    };
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: (body) => {
        body.textContent = 'standings';
      },
      showChrome: true,
      client,
      brand: { displayName: 'Brew Lab', logoUrl: LOGO },
    });
    expect(root.querySelectorAll('img')).toHaveLength(1);
    const made = [];
    const createElement = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
      made.push(tag);
      return createElement(tag, ...rest);
    });
    for (let i = 0; i < 3; i += 1) {
      change();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    spy.mockRestore();
    expect(made.filter((tag) => tag === 'img')).toHaveLength(0);
    expect(root.querySelectorAll('img')).toHaveLength(1);
    handle.unmount();
  });

  it('adds nothing to the projector shell while a display is live: its own band carries the brand', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: vi.fn(),
      showChrome: false,
      client: phoneClient(SESSION),
      brand: { displayName: 'Brew Lab', accentHex: '#e91e63' },
    });
    handle.setBrand({ displayName: 'Other' });
    expect(root.querySelector('.powered-by')).toBeNull();
    expect(root.querySelector('footer')).toBeNull();
    expect(root.hasAttribute('data-brand')).toBe(false);
    handle.unmount();
  });
});

describe('the projector shell, between displays', () => {
  // While no display is live the shell shows a holding card and has no band of its own to put the brand in, so it
  // draws one. A branded venue screen must never be without the credit, whatever the feed is doing.
  const HOLDING = [
    { label: 'no session at all', row: null },
    { label: 'a session with nothing to show yet', row: { ...SESSION, payload: null } },
    { label: 'a lost connection', row: SESSION, readError: { message: 'offline' } },
  ];

  async function mountProjector(brand, row, readError) {
    const root = document.createElement('div');
    root.className = 'stage-surface';
    document.body.append(root);
    const handle = await mountViewerShell(root, {
      orgId: 'org1',
      renderBody: (body) => {
        body.textContent = 'standings';
      },
      hasContent: (payload) => payload?.standings?.length > 0,
      showChrome: false,
      client: phoneClient(row, 'SUBSCRIBED', readError),
      brand,
    });
    await settle();
    return { root, handle };
  }

  for (const { label, brand } of BRANDED) {
    for (const { label: stateLabel, row, readError } of HOLDING) {
      it(`credits Seduh Score exactly once and visibly: ${label}, ${stateLabel}`, async () => {
        const { root, handle } = await mountProjector(brand, row, readError);
        expectCredited(root, `${label}/${stateLabel}`);
        expect(root.querySelector('.viewer-holding-card')).not.toBeNull();
        expect(root.querySelectorAll('.stage-band')).toHaveLength(1);
        expect(root.querySelector('.stage-band-brand-custom')).not.toBeNull();
        handle.unmount();
      });
    }
  }

  it('shows no band beside a live display: its own band carries the brand', async () => {
    const { root, handle } = await mountProjector({ displayName: 'Brew Lab' }, SESSION);
    expect(root.querySelector('.stage-band')).toBeNull();
    expect(root.querySelector('.powered-by')).toBeNull();
    expect(root.querySelector('.viewer-holding-card')).toBeNull();
    handle.unmount();
  });

  it('draws the band for a brand that arrives late, and takes it away when cleared', async () => {
    const { root, handle } = await mountProjector(undefined, null);
    expect(root.querySelector('.stage-band')).toBeNull();
    handle.setBrand({ displayName: 'Brew Lab' });
    expectCredited(root, 'late brand');
    handle.setBrand(null);
    expect(root.querySelector('.stage-band')).toBeNull();
    expectUncredited(root, 'cleared');
    handle.unmount();
  });

  it('does not touch a late brand after unmount', async () => {
    const { root, handle } = await mountProjector(undefined, null);
    handle.unmount();
    handle.setBrand({ displayName: 'Brew Lab' });
    expect(root.querySelector('.stage-band')).toBeNull();
  });

  for (const { label, brand } of UNBRANDED) {
    it(`is exactly the ordinary projector shell when the brand is ${label}`, async () => {
      const plain = await mountProjector(undefined, null);
      const { root, handle } = await mountProjector(brand, null);
      expect(root.innerHTML).toBe(plain.root.innerHTML);
      handle.unmount();
      plain.handle.unmount();
    });
  }
});
