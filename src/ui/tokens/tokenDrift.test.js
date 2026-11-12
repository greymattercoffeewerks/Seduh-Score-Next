import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Petrol V2 drift guard. The tokens in src/ui/tokens/ are the one vocabulary for colour, radius and motion; a
// hand-written value in a screen stylesheet is the "local patch" CONVENTIONS.md calls an anti-pattern (the audit
// found hand-picked hexes, one-off radii, 16 ad-hoc durations and per-page clip-path polygons). This fails when a
// stylesheet outside the token files writes any of:
//   colour     a hex, rgb()/rgba() or hsl()/hsla() literal
//   radius     a border-radius length that is not var(--radius-*), var(--bevel-*), 0, inherit
//   motion     a time or easing literal in transition/animation (use --dur-* and --ease-out); longhand
//              *-delay and --custom-property indirection are NOT checked (known gaps, see DESIGN.md)
//   clip-path  a polygon() (clip-path: inset(50%) visually-hidden patterns are fine)
// Scanned: every *.css under src/ except src/ui/tokens/, and the inline <style> blocks of every HTML page except
// design/
// (design-tool exports), src/ui/tokens/ and *.preview.html (dev-only preview harnesses, never served in the product).
//
// The ALLOWLIST pins file + kind + selector + literal, never a whole file, so new drift in an allowlisted file
// still fails, and an entry that stops matching anything fails too (so it cannot go stale and cover a future
// value). To extend it, see "Drift guard" in src/ui/tokens/DESIGN.md.
//
// The reader FAILS CLOSED like components.test.js: an unbalanced block throws instead of being skipped.

const REPO = process.cwd();
const TOKENS_DIR = 'src/ui/tokens/';
const SKIP_DIRS = [
  'node_modules',
  'dist',
  '.git',
  '.wrangler',
  'android',
  'supabase',
  'test-results',
  'brag-output',
];
const SKIP_HTML = (path) =>
  path.startsWith('design/') || path.startsWith(TOKENS_DIR) || path.endsWith('.preview.html');

function walk(dir, accept) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.includes(name) || name.startsWith('.')) continue;
      found.push(...walk(full, accept));
    } else if (accept(name)) found.push(full);
  }
  return found;
}
const rel = (file) => relative(REPO, file).split(sep).join('/');

// ---- reading ----

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const stripHtmlComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

// Every declaration in a stylesheet: { selector, prop, value }. `selector` is the chain of block preludes the
// declaration sits in (at-rules included), so a keyframe step reads "@keyframes spin > to".
function declarations(css) {
  const text = stripCssComments(css);
  const out = [];
  const stack = [];
  let buffer = '';
  let i = 0;
  const flush = () => {
    const decl = buffer.trim();
    buffer = '';
    const colon = decl.indexOf(':');
    if (!decl || colon < 1 || decl.startsWith('@')) return;
    out.push({
      selector: stack.map(collapse).join(' > '),
      prop: decl.slice(0, colon).trim().toLowerCase(),
      value: collapse(decl.slice(colon + 1)),
    });
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const quote = char;
      buffer += char;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') buffer += text[i++];
        buffer += text[i++] ?? '';
      }
      buffer += quote;
      i += 1;
    } else if (char === '(') {
      // a url(...) or var(...) argument may hold ; { } (data URIs), so read to the matching parenthesis
      let depth = 0;
      while (i < text.length) {
        if (text[i] === '(') depth += 1;
        if (text[i] === ')') depth -= 1;
        buffer += text[i];
        i += 1;
        if (depth === 0) break;
      }
      if (depth !== 0) throw new Error('unbalanced parenthesis in CSS');
    } else if (char === '{') {
      stack.push(buffer);
      buffer = '';
      i += 1;
    } else if (char === '}') {
      flush();
      if (stack.length === 0) throw new Error('unbalanced } in CSS');
      stack.pop();
      i += 1;
    } else if (char === ';') {
      flush();
      i += 1;
    } else {
      buffer += char;
      i += 1;
    }
  }
  flush();
  if (stack.length !== 0) throw new Error('unclosed block in CSS');
  return out;
}

// The text of every inline <style> block.
function styleBlocks(html) {
  return [...stripHtmlComments(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
    (m) => m[1],
  );
}

// ---- the four rules ----

const withoutUrls = (value) => value.replace(/url\((?:[^()'"]|"[^"]*"|'[^']*')*\)/gi, 'url()');
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\((?:[^()]|\([^()]*\))*\)/gi;
const TIME = /(?<![\w.-])-?\d*\.?\d+m?s\b/gi;
const EASING =
  /\bcubic-bezier\(|\bsteps\(|\b(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b/gi;
const MOTION_PROPS = new Set([
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  'animation-duration',
  'animation-timing-function',
]);

// The offending literals a single declaration writes, as [kind, literal] pairs.
function violationsOf({ prop: rawProp, value }) {
  const prop = rawProp.replace(/^-(?:webkit|moz|ms|o)-/, '');
  const v = withoutUrls(value);
  const found = [];
  for (const m of v.matchAll(COLOUR)) found.push(['colour', collapse(m[0].toLowerCase())]);
  if (/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(prop)) {
    // a var(--radius-*) / var(--bevel-*) is the token; whatever else is left must be 0 or inherit
    const rest = v
      .replace(/var\(\s*--(?:radius|bevel)-[\w-]+\s*\)/g, ' ')
      .replace(/\b(?:inherit|0)\b/g, ' ')
      .replace(/\//g, ' ')
      .trim();
    if (rest) found.push(['radius', rest]);
  }
  if (MOTION_PROPS.has(prop)) {
    // var(--dur-*) / var(--ease-out) are the tokens; anything else timed or eased is a literal
    const rest = v.replace(/var\(\s*--[\w-]+\s*\)/g, ' ');
    for (const m of rest.matchAll(TIME)) found.push(['motion', m[0].toLowerCase()]);
    for (const m of rest.matchAll(EASING)) found.push(['motion', m[0].toLowerCase()]);
  }
  if (/^(-webkit-)?clip-path$/.test(prop) && /\bpolygon\(/i.test(v))
    found.push(['clip-path', 'polygon()']);
  return found;
}

// ---- the allowlist ----
//
// { file, kind, selector, literal, reason, count? }. `selector` is the full chain `declarations()` reports; `literal`
// is the exact value the rule flags. `count` (default 1) is how many declarations the entry covers, and it is
// exact: one more copy of the value in that rule fails as new drift, one fewer fails as a stale entry. Reasons
// mirror the named exceptions in src/ui/tokens/DESIGN.md ("Motion exceptions", "Colours").

// `literals` may repeat a value to cover it more than once; one entry is produced per distinct literal.
const allow = (file, kind, selector, literals, reason) =>
  [...new Set(literals)].map((literal) => ({
    file,
    kind,
    selector,
    literal,
    reason,
    count: literals.filter((l) => l === literal).length,
  }));

const NO_PREF = '@media (prefers-reduced-motion: no-preference) > ';
const GTB = 'Guess the Bean float/bob/spin ambient loop (DESIGN.md motion exceptions)';
const GTB_CELEBRATION =
  'Guess the Bean celebration: pop, confetti, burst (DESIGN.md motion exceptions)';
const SPLASH_INTRO = 'splash intro choreography (DESIGN.md motion exceptions)';
const SPLASH_LOOP = 'splash glow ambient loop (DESIGN.md motion exceptions)';
const ENTRY = 'src/community/guess-the-bean/entryScreen.css';
const SPLASH = 'src/core/splashScreen.css';
const SPLASH_INTRO_SELECTOR = `${NO_PREF}.splash-wordmark, .splash-eventline, .splash-subline, .splash-badge-host`;

const ALLOWLIST = [
  // ---- motion ----
  ...allow(
    'src/core/stageDisplay.css',
    'motion',
    `${NO_PREF}.stage-band-live-dot`,
    ['4s', 'ease'],
    "the live blip's 4s breathe (DESIGN.md motion exceptions)",
  ),
  ...allow(SPLASH, 'motion', `${NO_PREF}.splash-glow`, ['11s'], SPLASH_LOOP),
  ...allow(SPLASH, 'motion', `${NO_PREF}.splash-glow-drift`, ['48s', 'ease'], SPLASH_LOOP),
  ...allow(SPLASH, 'motion', '@keyframes splash-glow-breathe > 0%', ['ease'], SPLASH_LOOP),
  ...allow(SPLASH, 'motion', '@keyframes splash-glow-breathe > 36%', ['linear'], SPLASH_LOOP),
  ...allow(SPLASH, 'motion', '@keyframes splash-glow-breathe > 45%', ['ease'], SPLASH_LOOP),
  ...allow(SPLASH, 'motion', '@keyframes splash-glow-breathe > 91%', ['ease'], SPLASH_LOOP),
  ...allow(SPLASH, 'motion', SPLASH_INTRO_SELECTOR, ['0.8s', 'ease'], SPLASH_INTRO),
  ...allow(ENTRY, 'motion', `${NO_PREF}.gtb-hero-jar`, ['3.2s', 'ease'], GTB),
  ...allow(ENTRY, 'motion', `${NO_PREF}.gtb-hero-bean-1`, ['4s', 'ease'], GTB),
  ...allow(ENTRY, 'motion', `${NO_PREF}.gtb-hero-bean-2`, ['4s', '1.3s', 'ease'], GTB),
  ...allow(ENTRY, 'motion', `${NO_PREF}.gtb-hero-bean-3`, ['4s', '2.4s', 'ease'], GTB),
  ...allow(ENTRY, 'motion', `${NO_PREF}.gtb-burst-piece`, ['0.9s', 'ease'], GTB_CELEBRATION),
  ...allow(
    ENTRY,
    'motion',
    `${NO_PREF}.gtb-spinner`,
    ['0.8s', 'linear'],
    'continuous loading-spinner rotation: a loop, linear by nature (unconfirmed by DESIGN.md; see CHANGELOG)',
  ),
  ...allow(
    'src/community/guess-the-bean/displayScreen.css',
    'motion',
    '.gtb-display-confetti.is-on .gtb-display-confetti-piece',
    ['1.5s', 'ease'],
    GTB_CELEBRATION,
  ),
  ...allow(
    'src/community/guess-the-bean/displayScreen.css',
    'motion',
    '.gtb-display-countdown strong',
    ['0.72s'],
    'display countdown pulse in the Guess the Bean celebration family (unconfirmed by DESIGN.md; see CHANGELOG)',
  ),
  ...allow(
    'src/community/guess-the-bean/displayScreen.css',
    'motion',
    '@media (prefers-reduced-motion: reduce) > *, *::before, *::after',
    ['0.01ms', '0.01ms'],
    'the reduced-motion reset: durations forced to ~0 so animations end instantly (same idiom as base.css)',
  ),
  ...allow(
    'src/marketing/landing.css',
    'motion',
    `${NO_PREF}.petrol-hero-photo`,
    ['1.1s', 'ease'],
    'the 1.1s landing hero fade (DESIGN.md motion exceptions)',
  ),
  ...allow(
    'src/marketing/landing.css',
    'motion',
    `${NO_PREF}.petrol-track`,
    ['32s', 'linear'],
    'landing marquee: a constant-speed ambient loop (DESIGN.md motion exceptions)',
  ),
  ...allow(
    'src/tools/random-selector/randomSelector.css',
    'motion',
    `${NO_PREF}.selector-flap.is-flipping`,
    ['0.28s', 'steps('],
    'stepped Random Selector split-flap (DESIGN.md motion exceptions)',
  ),
  ...allow(
    'src/tools/timer/timer.css',
    'motion',
    `${NO_PREF}.timer-display[data-urgent='true']`,
    ['1s', 'step-start'],
    'stepped timer blink (DESIGN.md motion exceptions)',
  ),
];

const keyOf = (v) => `${v.file} | ${v.kind} | ${v.selector} | ${v.literal}`;

function scan() {
  const htmlFiles = walk('.', (name) => name.endsWith('.html'))
    .map(rel)
    .filter((path) => !SKIP_HTML(path));
  const sources = [
    ...walk('src', (name) => name.endsWith('.css'))
      .map(rel)
      .filter((path) => !path.startsWith(TOKENS_DIR))
      .map((file) => ({ file, css: readFileSync(file, 'utf8') })),
    ...htmlFiles.flatMap((file) =>
      styleBlocks(readFileSync(file, 'utf8')).map((css) => ({ file, css })),
    ),
  ];
  const violations = [];
  for (const { file, css } of sources) {
    for (const decl of declarations(css)) {
      for (const [kind, literal] of violationsOf(decl)) {
        violations.push({ file, kind, selector: decl.selector, prop: decl.prop, literal });
      }
    }
  }
  return { sources, htmlFiles, violations };
}

const { sources, htmlFiles, violations } = scan();

describe('Petrol token drift guard', () => {
  it('scans the stylesheets (a vacuous scan would pass anything)', () => {
    expect(sources.filter((s) => s.file.endsWith('.css')).length).toBeGreaterThan(30);
    expect(htmlFiles).toContain('app/index.html');
    expect(htmlFiles).toContain('bts/index.html');
    expect(htmlFiles.length).toBeGreaterThan(8);
    expect(sources.some((s) => s.file.startsWith(TOKENS_DIR))).toBe(false);
    // Behind the Seduh links the tokens since 2026-11-09, so its stylesheet is in scope like any other page's.
    expect(sources.some((s) => s.file === 'src/marketing/bts.css')).toBe(true);
  });

  it('no stylesheet hand-writes a raw colour, off-token radius, motion literal or clip-path polygon', () => {
    const budget = new Map();
    for (const entry of ALLOWLIST)
      budget.set(keyOf(entry), (entry.count ?? 1) + (budget.get(keyOf(entry)) ?? 0));
    const unlisted = [];
    for (const v of violations) {
      const left = budget.get(keyOf(v)) ?? 0;
      if (left > 0) budget.set(keyOf(v), left - 1);
      else unlisted.push(`${v.file}  [${v.kind}]  ${v.selector} { ${v.prop}: … ${v.literal} … }`);
    }
    expect(
      unlisted,
      'Use a token (colors.css, spacing.css, motion.css), or add an ALLOWLIST entry with a reason (see DESIGN.md "Drift guard")',
    ).toEqual([]);
  });

  it('every ALLOWLIST entry has a reason, a known kind, and matches exactly as many declarations as it says', () => {
    const seen = new Map();
    for (const v of violations) seen.set(keyOf(v), (seen.get(keyOf(v)) ?? 0) + 1);
    const budget = new Map();
    for (const entry of ALLOWLIST) {
      expect(['colour', 'radius', 'motion', 'clip-path']).toContain(entry.kind);
      expect(entry.reason?.length, `${keyOf(entry)} needs a reason`).toBeGreaterThan(10);
      budget.set(keyOf(entry), (entry.count ?? 1) + (budget.get(keyOf(entry)) ?? 0));
    }
    for (const [key, count] of budget)
      expect(seen.get(key) ?? 0, `stale or changed ALLOWLIST entry: ${key}`).toBe(count);
  });
});

// ---- public pages: shared primitives, not hand-built shapes ----
//
// The public pages (landing, pricing, tour, trust, results, community hub, header, footer) once built their own tags,
// cards, toggles and buttons, so a Petrol change to the shared layer restyled the console and left them behind (a
// "BASIC FREE" tag stayed square). They now use the primitives in tokens/base.css (.tag, .panel, .icon-frame,
// .menu-toggle, .action, .status-live-dot, .btn-bevel). This is a HEURISTIC, not a CSS parser; it reads each public
// stylesheet rule by rule and fails on two shapes:
//   no-corner         a rule that paints a box (a `border` shorthand with a line style, or a `background` that is
//                     not none/transparent) and sets no border-radius. The corner may come from the markup instead:
//                     a class the page's JS always writes in the same string as a shared shape class
//                     (`pricing-card panel`) is shaped by it. A radius in a sibling CSS rule does not count.
//   local-primitive   a rule that paints and whose last class is named like a shared primitive (-tag, -badge, -chip,
//                     -pill, -dot, -toggle, -mark): that is a page-local copy of .tag / .status-live-dot /
//                     .menu-toggle / .icon-frame. Use the shared class and set --tag-edge / --frame-edge to recolour.
// Rules for hover/focus/active states, pseudo-elements and `border: 0|none` are not boxes of their own and are skipped.
// The SQUARE allowlist pins file + selector chain + kind, with a reason, and is exact in both directions (an entry
// that stops matching fails). Full-bleed bands, the header bar, the ticker and edge-to-edge rows stay square on
// purpose (DESIGN.md, "Public pages"): a rounded corner on something that touches both screen edges reads as a bug.

const PUBLIC_CSS = (file) =>
  file.startsWith('src/marketing/') || file === 'src/community/communityHub.css';
const PAINTS_BORDER = /^border$/;
const SHAPE_CLASSES = new Set(['tag', 'panel', 'icon-frame', 'menu-toggle', 'action', 'btn-bevel']);
const SHARED_NAME = /(?:^|-)(?:tag|badge|chip|pill|dot|toggle|mark)$/;

function paintedBoxes(css) {
  const rules = new Map();
  for (const d of declarations(css)) {
    if (!rules.has(d.selector)) rules.set(d.selector, []);
    rules.get(d.selector).push(d);
  }
  const found = [];
  for (const [selector, decls] of rules) {
    const last = selector.split('>').pop().trim();
    if (selector.includes('@keyframes') || /::|:hover|:focus|:active|:disabled|:checked/.test(last))
      continue;
    if (selector.includes('@media print')) continue;
    const paints = decls.some(({ prop, value }) => {
      if (PAINTS_BORDER.test(prop))
        return /\b(solid|dashed|dotted|double)\b/.test(value) && !/^(0|none)\b/.test(value);
      if (prop === 'background' || prop === 'background-color')
        return !/^(none|transparent|inherit|initial|unset)\b/.test(value);
      return false;
    });
    if (!paints) continue;
    // a real corner: a token radius or bevel (an explicit 0 is a square, not a corner)
    const hasRadius = decls.some(
      ({ prop, value }) =>
        /^border(-.*)?-radius$/.test(prop) && /var\(--(?:radius|bevel)-/.test(value),
    );
    // a grouped selector (.a, .b-tag) is checked per member
    for (const member of last.split(',')) {
      const lastClass =
        /\.([\w-]+)(?![\w-]*\()[^.\s]*$/.exec(member.trim().replace(/\[[^\]]*\]/g, ''))?.[1] ?? '';
      if (SHARED_NAME.test(lastClass)) found.push({ selector, kind: 'local-primitive', lastClass });
      else if (!hasRadius) found.push({ selector, kind: 'no-corner', lastClass });
    }
  }
  return found;
}

const SQUARE = (file, kind, selectors, reason) =>
  selectors.map((selector) => ({ file, kind, selector, reason }));
const BAND =
  'full-bleed page band or bar: touches both screen edges, stays square (DESIGN.md "Public pages")';
const ROW =
  'edge-to-edge row or divider inside a band, not a free-standing box (DESIGN.md "Public pages")';
const PAGE_ROOT = 'the page root fills the viewport: a background, not a box';
const DECOR = 'decorative or atmospheric fill, not a UI element (DESIGN.md "Public pages")';

const LANDING = 'src/marketing/landing.css';
const SQUARE_ALLOWLIST = [
  ...SQUARE(LANDING, 'no-corner', ['.petrol-page'], PAGE_ROOT),
  ...SQUARE('src/marketing/pricing.css', 'no-corner', ['.pricing-page'], PAGE_ROOT),
  ...SQUARE('src/marketing/results.css', 'no-corner', ['.results-page'], PAGE_ROOT),
  ...SQUARE('src/marketing/tour.css', 'no-corner', ['.tour-page'], PAGE_ROOT),
  ...SQUARE('src/marketing/bts.css', 'no-corner', ['.bts'], PAGE_ROOT),
  ...SQUARE('src/marketing/trust.css', 'no-corner', ['.trust-page'], PAGE_ROOT),
  ...SQUARE('src/community/communityHub.css', 'no-corner', ['.community-hub'], PAGE_ROOT),
  ...SQUARE(
    LANDING,
    'no-corner',
    [
      '.petrol-nav',
      '.petrol-nav-mobile-panel',
      '.petrol-ticker',
      '.petrol-band',
      '.petrol-live-bar',
      '.petrol-cta-copy',
      '@media (max-width: 640px) > .petrol-story-copy',
    ],
    BAND,
  ),
  ...SQUARE(LANDING, 'no-corner', ['.petrol-format-row-dimmed:nth-of-type(even)'], ROW),
  ...SQUARE(LANDING, 'no-corner', ['.petrol-hero-scrim', '.petrol-cta-accent'], DECOR),
  ...SQUARE(
    'src/marketing/publicHeader.css',
    'no-corner',
    ['.public-header', '.public-header-mobile-panel'],
    BAND,
  ),
  ...SQUARE(
    'src/marketing/publicHeader.css',
    'no-corner',
    ['.public-footer-flag-icon'],
    'a flag glyph, 18x12: a fixed-proportion image, not a UI box',
  ),
  ...SQUARE(
    'src/marketing/results.css',
    'no-corner',
    ['.results-sheet-paper'],
    'the printable results sheet is a sheet of paper, not a UI box (it is designed for print)',
  ),
];

const squareKey = (v) => `${v.file} | ${v.kind} | ${v.selector}`;

// Every class that some public-page script writes in the same string as a shared shape class.
function classesShapedByMarkup() {
  const shaped = new Set();
  const files = [
    ...walk('src/marketing', (name) => name.endsWith('.js') && !name.endsWith('.test.js')),
    'src/community/communityHub.js',
  ];
  for (const file of files) {
    const js = readFileSync(file, 'utf8');
    for (const m of js.matchAll(/className:\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const tokens = m[2].split(/\s+|\$\{[^}]*\}/).filter(Boolean);
      if (!tokens.some((t) => SHAPE_CLASSES.has(t))) continue;
      for (const t of tokens) shaped.add(t);
    }
  }
  return shaped;
}

function scanPublicShapes() {
  const out = [];
  const shaped = classesShapedByMarkup();
  for (const { file, css } of sources) {
    if (!PUBLIC_CSS(file)) continue;
    for (const { lastClass, ...box } of paintedBoxes(css)) {
      if (box.kind === 'no-corner' && shaped.has(lastClass)) continue;
      out.push({ file, ...box });
    }
  }
  return out;
}

describe('public pages build on the shared primitives', () => {
  const found = scanPublicShapes();
  it('scans the public stylesheets', () => {
    expect(new Set(found.map((f) => f.file)).size).toBeGreaterThan(5);
    expect(sources.filter((x) => PUBLIC_CSS(x.file)).length).toBeGreaterThan(5);
  });
  it('no public rule paints a square box or re-implements a shared primitive, except the allowlist', () => {
    const budget = new Set(SQUARE_ALLOWLIST.map(squareKey));
    const unlisted = found.filter((v) => !budget.has(squareKey(v)));
    expect(
      unlisted.map((v) => `${v.file}  [${v.kind}]  ${v.selector}`),
      'Give it a token radius, or use the shared .tag/.panel/.icon-frame/.menu-toggle/.action/.status-live-dot, or add a SQUARE_ALLOWLIST entry with a reason',
    ).toEqual([]);
  });
  it('every SQUARE_ALLOWLIST entry has a reason and still matches', () => {
    const seen = new Set(found.map(squareKey));
    for (const entry of SQUARE_ALLOWLIST) {
      expect(['no-corner', 'local-primitive']).toContain(entry.kind);
      expect(entry.reason.length, `${squareKey(entry)} needs a reason`).toBeGreaterThan(10);
      expect(seen.has(squareKey(entry)), `stale SQUARE_ALLOWLIST entry: ${squareKey(entry)}`).toBe(
        true,
      );
    }
  });
});

describe('drift rules (the reader and the four checks, on synthetic CSS)', () => {
  const flag = (css) => declarations(css).flatMap(violationsOf);
  it('flags raw colours but not tokens, url() payloads or ids', () => {
    expect(
      flag('.a{color:#fff;background:rgba(0,0,0,.5);border:1px solid hsl(10 20% 30%)}').length,
    ).toBe(3);
    expect(
      flag(
        '.a{color:var(--clr-white)} #id{x:y} .b{background:url("data:image/svg+xml;utf8,<svg fill=\'#fff\'/>")}',
      ),
    ).toEqual([]);
    expect(flag(':root{--c:#abcdef}')).toEqual([['colour', '#abcdef']]);
    expect(flag('.a{color:rgba( 1,2 , 3,.5 )}')).toEqual([['colour', 'rgba( 1,2 , 3,.5 )']]);
  });
  it('flags radius lengths but allows the tokens, 0 and inherit', () => {
    expect(flag('.a{border-radius:4px}')).toEqual([['radius', '4px']]);
    expect(flag('.a{border-radius:50%}')).toEqual([['radius', '50%']]);
    expect(flag('.a{border-top-left-radius:var(--radius-sm,2px)}').length).toBe(1);
    expect(flag('.a{border-radius:var(--radius-md) var(--bevel-lg) 0 inherit}')).toEqual([]);
  });
  it('flags duration and easing literals but not the motion tokens or none', () => {
    expect(flag('.a{transition:opacity 0.2s ease}')).toEqual([
      ['motion', '0.2s'],
      ['motion', 'ease'],
    ]);
    expect(flag('.a{animation:spin 1s linear infinite}').length).toBe(2);
    expect(
      flag('.a{transition-duration:200ms;animation-timing-function:cubic-bezier(.1,.2,.3,.4)}')
        .length,
    ).toBe(2);
    expect(
      flag('.a{transition:opacity var(--dur-fast) var(--ease-out);animation:none;transition:none}'),
    ).toEqual([]);
  });
  it('flags vendor-prefixed props and literal var() fallbacks', () => {
    expect(flag('.a{-webkit-transition:opacity .2s}')).toEqual([['motion', '.2s']]);
    expect(flag('.a{-webkit-border-radius:4px}')).toEqual([['radius', '4px']]);
    expect(flag('.a{transition:opacity var(--dur-fast,200ms)}')).toEqual([['motion', '200ms']]);
  });
  it('flags clip-path polygons but not inset()', () => {
    expect(flag('.a{clip-path:polygon(0 0,100% 0,100% 100%)}')).toEqual([
      ['clip-path', 'polygon()'],
    ]);
    expect(flag('.sr{clip:rect(0,0,0,0);clip-path:inset(50%)}')).toEqual([]);
  });
  it('public shapes: flags a square painted box and a local copy of a primitive, not a shaped or stateful rule', () => {
    const kinds = (css) => paintedBoxes(css).map((b) => `${b.kind}:${b.lastClass}`);
    expect(kinds('.x-card{border:1px solid var(--c);background:var(--s)}')).toEqual([
      'no-corner:x-card',
    ]);
    expect(kinds('.x-tag{border:1px solid var(--c)}')).toEqual(['local-primitive:x-tag']);
    expect(kinds('.x-live-dot{background:var(--a);border-radius:var(--radius-sm)}')).toEqual([
      'local-primitive:x-live-dot',
    ]);
    expect(kinds('.x-card{border:1px solid var(--c);border-radius:var(--radius-md)}')).toEqual([]);
    expect(kinds('.x-card:hover{background:var(--s)} .x::before{background:red}')).toEqual([]);
    expect(kinds('.x{border:0;background:none;border-bottom:1px solid var(--c)}')).toEqual([]);
    expect(kinds('@media print{.x{background:var(--c)}}')).toEqual([]);
  });
  it('reads inline <style> blocks and ignores commented-out ones', () => {
    expect(
      styleBlocks(
        '<style>.a{color:red}</style><!-- <style>.b{}</style> --><STYLE media=x>.c{}</STYLE>',
      ),
    ).toEqual(['.a{color:red}', '.c{}']);
  });
  it('reads nested at-rules and keyframe steps, and fails closed on a broken block', () => {
    const [d] = declarations('@media (min-width:600px){@keyframes k{50%{border-radius:3px}}}');
    expect(d.selector).toBe('@media (min-width:600px) > @keyframes k > 50%');
    expect(() => declarations('.a{color:red')).toThrow();
    expect(() => declarations('.a{color:red}}')).toThrow();
  });
});

// ---- the feedback ladder (Petrol Kaizen P4) ----
//
// The app talks back through the parts in src/core/feedback.js and src/ui/tokens/feedback.css: a browser pop-up
// ignores the stage mode, the Petrol type and the test-event strip, and a second field-error or empty class is the
// "each surface writes its own" drift this phase removed (3 error classes and 6 empty classes became .form-field-error
// and .empty). Three rules, none with an allowlist, so a new exception is a deliberate edit of this file:
//   1. no window.confirm( / confirm( call in src/ JavaScript
//   2. no CSS class or className ending -field-error or -empty, except the core names form-field-error and empty
//   3. a rule for a disabled control fades with var(--opacity-disabled), never a number

const stripJsComments = (js) =>
  js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const CONFIRM_CALL = /(?<![\w$])(?:window\.|globalThis\.)?confirm\s*\(/g;
const LOCAL_FEEDBACK_CLASS = /(?<![\w:-])((?:[a-z][a-z0-9]*-)*(?:field-error|empty))(?![\w-])/g;
const CORE_FEEDBACK_CLASSES = new Set(['form-field-error', 'empty']);
const DISABLED_SELECTOR = /:disabled|\[aria-disabled|\[disabled/;

const jsSources = walk('src', (name) => name.endsWith('.js') && !name.endsWith('.test.js'))
  .map(rel)
  .map((file) => ({ file, js: stripJsComments(readFileSync(file, 'utf8')) }));

const confirmCalls = (js) => [...js.matchAll(CONFIRM_CALL)].map((m) => m[0]);
// Local feedback classes named in a stylesheet's selectors (declarations() already drops comments).
const feedbackClassesInCss = (css) => {
  const text = stripCssComments(css).replace(/\{[^{}]*\}/g, (block) =>
    block.replace(/[^{}]+/g, ''),
  ); // selectors only
  return [...text.matchAll(LOCAL_FEEDBACK_CLASS)]
    .map((m) => m[1])
    .filter((name) => !CORE_FEEDBACK_CLASSES.has(name));
};
const feedbackClassesInJs = (js) =>
  [...js.matchAll(/className\s*:\s*(['"`])([^'"`]*)\1/g)].flatMap((m) =>
    [...m[2].matchAll(LOCAL_FEEDBACK_CLASS)]
      .map((c) => c[1])
      .filter((name) => !CORE_FEEDBACK_CLASSES.has(name)),
  );
const rawDisabledOpacity = (css) =>
  declarations(css)
    .filter((d) => d.prop === 'opacity' && DISABLED_SELECTOR.test(d.selector))
    .filter((d) => !/^(?:1|var\(\s*--opacity-disabled\s*\))$/.test(d.value)) // 1 resets a fade, it is not one
    .map((d) => `${d.selector} { opacity: ${d.value} }`);

describe('feedback ladder drift guard', () => {
  it('scans the JavaScript (a vacuous scan would pass anything)', () => {
    expect(jsSources.length).toBeGreaterThan(100);
    expect(jsSources.some((s) => s.file === 'src/core/feedback.js')).toBe(true);
  });

  it('no src/ JavaScript calls window.confirm: use confirmInPlace or confirmDialog from core/feedback.js', () => {
    const found = jsSources.filter((s) => confirmCalls(s.js).length > 0).map((s) => s.file);
    expect(found).toEqual([]);
  });

  it('no stylesheet or className makes a new *-field-error or *-empty class: use .form-field-error and .empty', () => {
    const found = [
      ...sources.flatMap((s) => feedbackClassesInCss(s.css).map((c) => `${s.file}  .${c}`)),
      ...jsSources.flatMap((s) => feedbackClassesInJs(s.js).map((c) => `${s.file}  '${c}'`)),
    ];
    expect(found).toEqual([]);
  });

  it('a disabled control fades with var(--opacity-disabled), not a number', () => {
    const found = sources.flatMap((s) => rawDisabledOpacity(s.css).map((d) => `${s.file}  ${d}`));
    expect(found).toEqual([]);
  });

  it('the matchers: they catch the shapes they claim to and let the core names through', () => {
    expect(confirmCalls("if (!window.confirm('Sure?')) return;")).toHaveLength(1);
    expect(confirmCalls('const ok = confirm(msg);')).toHaveLength(1);
    expect(
      confirmCalls('await confirmInPlace(btn, {}); submitConfirm(); window.confirmed = 1;'),
    ).toEqual([]);
    expect(confirmCalls(stripJsComments('// not window.confirm(\nconst x = 1;'))).toEqual([]);
    expect(feedbackClassesInCss('.adm-field-error{color:red} .x-empty .y:empty{}')).toEqual([
      'adm-field-error',
      'x-empty',
    ]);
    expect(feedbackClassesInCss('.form-field-error{x:y} .empty{x:y} .ok-empty-note{x:y}')).toEqual(
      [],
    );
    expect(feedbackClassesInJs("el('p', { className: 'btc-field-error btc-demo-error' })")).toEqual(
      ['btc-field-error'],
    );
    expect(feedbackClassesInJs("el('p', { className: 'form-field-error' })")).toEqual([]);
    // a bare name is flagged too (only the core names pass), and a pseudo-class is not a class
    expect(feedbackClassesInCss('.field-error{x:y} .screen-feedback:empty{x:y}')).toEqual([
      'field-error',
    ]);
    expect(feedbackClassesInJs("el('p', { className: 'field-error' })")).toEqual(['field-error']);
    expect(
      rawDisabledOpacity('.a:disabled{opacity:.6} .b[aria-disabled="true"]{opacity:0.42}'),
    ).toHaveLength(2);
    expect(
      rawDisabledOpacity('.a:disabled{opacity:var(--opacity-disabled)} .b{opacity:.6}'),
    ).toEqual([]);
  });
});

// ---- the vocabulary (Petrol Kaizen P5) ----
//
// A state is drawn by the core .status (core/vocabulary.js statusMark), and a view switch is a tablist built by
// core/tablist.js. Two rules:
//   1. no stylesheet selector or className makes a badge / status / chip / pill class, unless it is listed in
//      LEFT_AS_IS with its reason (a decorative or interactive element that is not a state mark). A new one fails:
//      use .status, or add an entry here on purpose. An entry that no longer matches anything fails too.
//   2. no src/ JavaScript or HTML page writes role="tab" except core/tablist.js, which owns the roving tabindex and
//      the arrow keys (a hand-rolled tab with neither is the bug this replaces).

const STATE_MARK_NAME = /(?:^|-)(?:badge|status|chip|chips|pill)(?:-|$)/;
// The vocabulary's own names (src/ui/tokens) and the long-standing shared live blip.
const VOCABULARY_NAMES = new Set(['status', 'status--light', 'status-live-dot']);

const GUARD_SKIP = (file) => file.endsWith('.preview.js');
const classNamesInCss = (css) => {
  const selectors = stripCssComments(css).replace(/\{[^{}]*\}/g, (block) =>
    block.replace(/[^{}]+/g, ''),
  );
  return [...selectors.matchAll(/\.([a-z][\w-]*)/gi)].map((m) => m[1]);
};
const classNamesInJs = (js) =>
  [...js.matchAll(/className\s*:\s*(['"`])([^'"`]*)\1/g)].flatMap((m) =>
    m[2].split(/\s+/).filter((token) => /^[a-z][\w-]*$/i.test(token)),
  );
const stateMarkNames = (names) =>
  [...new Set(names)].filter((n) => STATE_MARK_NAME.test(n) && !VOCABULARY_NAMES.has(n)).sort();

const LEFT = (reason, ...names) => names.map((name) => ({ name, reason }));
const LEFT_AS_IS = [
  ...LEFT(
    'a layout hook on a core .status mark (viewer chrome, admin console), not a second look',
    'viewer-badge',
    'adm-badge',
  ),
  ...LEFT(
    'a sentence or a line of words about a state (a polite status message, a table column, a hero status line), not a mark',
    'adm-key-status',
    'app-shell-auth-status',
    'archive-status',
    'audience-links-status',
    'btc-demo-status',
    'btc-draw-status',
    'btc-status-stack',
    'community-tool-status',
    'event-live-status',
    'gtb-status',
    'gtb-status-emoji',
    'homepage-listing-status',
    'ok-live-status',
    'ok-records-status',
    'ok-signoff-status',
    'petrol-format-status',
    'results-sheet-status',
    'results-sheet-status-title',
    'rs-board-status',
    'rs-status-dot',
    'standings-status',
    'tour-hero-status',
    'tour-planned-status',
    'tour-status-mark',
  ),
  ...LEFT(
    'an interactive control or a filter/toggle chip (a button that does something), not a state label',
    'app-shell-sync-chip',
    'app-shell-sync-chip-live',
    'app-shell-sync-chip-pending',
    'app-shell-sync-chip-stuck',
    'bp-chip',
    'bp-chips',
    'bts-chip',
    'bts-chips',
  ),
  ...LEFT(
    'a name or label chip whose state is already in its words (a check mark or "max" in the label), a candidate for .status in a later pass',
    'btc-stage-chip',
    'btc-stage-chips',
    'td-stage-chip',
    'viewer-heat-chip',
    'viewer-heat-chips',
    'gtb-session-row-status',
  ),
  ...LEFT(
    'decorative: a credit pill, a station letter or a count pill that is not a state',
    'splash-badge',
    'splash-badge-generic',
    'splash-badge-host',
    'splash-badge-live',
    'station-badge',
    'gtb-display-pill',
    'gtb-guess-pill',
  ),
];

const TAB_ROLE = /\brole\s*[=:]\s*["']tab["']|["']role["']\s*[,:]\s*["']tab["']/;
const roleTabIn = (text) => TAB_ROLE.test(text);

describe('vocabulary drift guard', () => {
  // The token stylesheets are scanned too (components.css is where a new kit badge would be written).
  const tokenSheets = walk(TOKENS_DIR, (name) => name.endsWith('.css'))
    .map(rel)
    .map((file) => ({ file, css: readFileSync(file, 'utf8') }));
  const cssNames = [...sources, ...tokenSheets]
    .filter((s) => !GUARD_SKIP(s.file))
    .flatMap((s) => classNamesInCss(s.css).map((name) => ({ name, file: s.file })));
  const jsNames = jsSources
    .filter((s) => !GUARD_SKIP(s.file))
    .flatMap((s) => classNamesInJs(s.js).map((name) => ({ name, file: s.file })));
  const found = new Map();
  for (const { name, file } of [...cssNames, ...jsNames]) {
    if (stateMarkNames([name]).length) found.set(name, [...(found.get(name) ?? []), file]);
  }
  const listed = new Set(LEFT_AS_IS.map((e) => e.name));

  it('no new badge / status / chip / pill class: draw a state with .status (core/vocabulary.js statusMark)', () => {
    const unlisted = [...found.keys()].filter((name) => !listed.has(name)).sort();
    expect(unlisted).toEqual([]);
  });

  it('every LEFT_AS_IS entry still names a class that exists (no stale cover), with a reason', () => {
    const stale = LEFT_AS_IS.filter((e) => !found.has(e.name)).map((e) => e.name);
    expect(stale).toEqual([]);
    expect(LEFT_AS_IS.every((e) => e.reason.length > 10)).toBe(true);
  });

  it('role="tab" is written only by core/tablist.js', () => {
    const htmlPages = htmlFiles.map((file) => ({ file, js: readFileSync(file, 'utf8') }));
    const offenders = [...jsSources, ...htmlPages]
      .filter((s) => s.file !== 'src/core/tablist.js' && roleTabIn(s.js))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
    expect(roleTabIn(jsSources.find((s) => s.file === 'src/core/tablist.js').js)).toBe(true);
  });

  it('the matchers: they catch the shapes they claim to and leave the vocabulary alone', () => {
    expect(
      stateMarkNames(classNamesInCss('.x-badge{a:b} .y .status{a:b} .status--light{a:b}')),
    ).toEqual(['x-badge']);
    expect(
      stateMarkNames(['viewer-heat-chip', 'tag', 'bp-pills', 'adm-badge--on', 'statuses']),
    ).toEqual(['adm-badge--on', 'viewer-heat-chip']);
    expect(
      stateMarkNames(classNamesInJs("el('span', { className: 'foo-status bar status' })")),
    ).toEqual(['foo-status']);
    expect(roleTabIn("el('button', { attrs: { role: 'tab' } })")).toBe(true);
    expect(roleTabIn('<button role="tab">')).toBe(true);
    expect(roleTabIn("setAttribute('role', 'tab')")).toBe(true);
    expect(roleTabIn("attrs: { role: 'tablist' } role: 'tabpanel'")).toBe(false);
  });
});
