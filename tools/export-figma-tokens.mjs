// Exports the Petrol design tokens as a design-tokens JSON (W3C DTCG: $type / $value) that Tokens Studio, and
// from it Figma variables, can import. The CSS in src/ui/tokens/ stays the source of truth: this only reads it.
//
//   node tools/export-figma-tokens.mjs          write docs/design-system/figma/petrol-tokens.json
//   node tools/export-figma-tokens.mjs --check  fail when the committed file is stale (a test runs this too)
//
// Three sets: `core` (neutral ramp, hues, spacing, radius, type, motion), and `paper` and `stage`, the two surface
// modes of the semantic colour tokens. paper and stage define the same names and alias into `core`, so one Figma
// variable collection with two modes carries both.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(ROOT, 'src/ui/tokens');
export const OUT = join(ROOT, 'docs/design-system/figma/petrol-tokens.json');

// Declarations of the block whose selector is exactly `selector` (comments removed first).
export function declarations(css, selector) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (block[1].trim() !== selector) continue;
    for (const d of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      out[d[1]] = d[2].trim().replace(/\s+/g, ' ');
  }
  return out;
}

const ref = (v) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? m[1] : null;
};
const px = (v) => {
  const m = /^(-?[\d.]+)(rem|px)?$/.exec(v);
  if (!m) return null;
  const n = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
  return `${Number(n.toFixed(2))}px`;
};

// Where a custom property goes: [set, path, $type, converted value]. null means "not exported".
function place(name, value) {
  const n = name.slice(2);
  let m;
  if ((m = /^clr-(.+)-(\d+)$/.exec(n))) return ['core', ['color', m[1], m[2]], 'color'];
  if (n === 'clr-white' || n === 'clr-black') return ['core', ['color', n.slice(4)], 'color'];
  if ((m = /^color-(.+)$/.exec(n))) return ['semantic', ['color', m[1]], 'color'];
  if ((m = /^space-(\d+)$/.exec(n))) return ['core', ['space', m[1]], 'dimension', px(value)];
  if ((m = /^(radius|bevel|cut)-(.+)$/.exec(n)))
    return ['core', [m[1], m[2]], 'dimension', px(value)];
  if (/^border-(hairline|strong)$/.test(n))
    return ['core', ['border', n.slice(7)], 'dimension', px(value)];
  if (/^max-width-/.test(n)) return ['core', ['size', n], 'dimension', px(value)];
  if (n === 'tap-target-min' || /^focus-ring-/.test(n))
    return ['core', ['size', n], 'dimension', px(value)];
  if (n === 'opacity-disabled') return ['core', ['opacity', 'disabled'], 'number', Number(value)];
  if ((m = /^font-(display|body|mono)$/.exec(n)))
    return ['core', ['font', 'family', m[1]], 'fontFamily', families(value)];
  if ((m = /^text-(.+)$/.exec(n))) return ['core', ['font', 'size', m[1]], 'dimension', px(value)];
  if ((m = /^font-weight-(.+)$/.exec(n)))
    return ['core', ['font', 'weight', m[1]], 'fontWeight', Number(value)];
  if ((m = /^leading-(.+)$/.exec(n)))
    return ['core', ['font', 'leading', m[1]], 'number', Number(value)];
  if ((m = /^tracking-(.+)$/.exec(n)))
    return ['core', ['font', 'tracking', m[1]], 'dimension', value];
  if ((m = /^dur-(.+)$/.exec(n))) return ['core', ['motion', 'duration', m[1]], 'duration', value];
  if (n === 'ease-out') return ['core', ['motion', 'easing', 'out'], 'cubicBezier', bezier(value)];
  return null;
}

const families = (v) => v.split(/\s*,\s*/).map((s) => s.replace(/^'|'$/g, ''));
const bezier = (v) => v.match(/-?[\d.]+/g).map(Number);

const put = (root, path, token) => {
  let o = root;
  for (const k of path.slice(0, -1)) o = o[k] ??= {};
  o[path.at(-1)] = token;
};

export function buildTokens(files) {
  const rootDecl = {};
  for (const css of [files.colors, files.spacing, files.typography, files.motion])
    Object.assign(rootDecl, declarations(css, ':root'));
  const stageDecl = declarations(files.colors, "[data-surface='stage']");

  // Every exported custom property -> its token path, so `var(--x)` becomes `{path}`.
  const paths = {};
  for (const [name, value] of Object.entries(rootDecl)) {
    const p = place(name, value);
    if (p) paths[name] = p[1].join('.');
  }
  const token = (name, raw) => {
    const p = place(name, raw);
    if (!p) return null;
    const [, path, type, converted] = p;
    const r = ref(raw);
    let $value;
    if (r) {
      if (!paths[r])
        throw new Error(`${name}: ${raw} points at ${r}, which is not an exported token`);
      $value = `{${paths[r]}}`;
    } else if (converted === null) throw new Error(`cannot convert ${name}: ${raw}`);
    else $value = converted === undefined ? raw : converted;
    return [p[0], path, { $type: type, $value }];
  };

  const core = {};
  const paper = {};
  const stage = {};
  for (const [name, raw] of Object.entries(rootDecl)) {
    const t = token(name, raw);
    if (t) put(t[0] === 'semantic' ? paper : core, t[1], t[2]);
  }
  for (const [name, raw] of Object.entries(stageDecl)) {
    const t = token(name, raw);
    if (t) put(stage, t[1], t[2]);
  }
  // A semantic token the stage mode does not override has the same value in both modes.
  const fill = (src, dst) => {
    for (const [k, v] of Object.entries(src)) {
      if (v.$value === undefined) fill(v, (dst[k] ??= {}));
      else dst[k] ??= v;
    }
  };
  fill(paper, stage);

  return {
    core,
    paper,
    stage,
    $themes: [
      {
        id: 'petrol-paper',
        name: 'Paper',
        selectedTokenSets: { core: 'source', paper: 'enabled' },
      },
      {
        id: 'petrol-stage',
        name: 'Stage',
        selectedTokenSets: { core: 'source', stage: 'enabled' },
      },
    ],
    $metadata: { tokenSetOrder: ['core', 'paper', 'stage'] },
  };
}

export function render() {
  const read = (f) => readFileSync(join(TOKENS, f), 'utf8');
  const tokens = buildTokens({
    colors: read('colors.css'),
    spacing: read('spacing.css'),
    typography: read('typography.css'),
    motion: read('motion.css'),
  });
  return `${JSON.stringify(tokens, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = render();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) {
      console.error(
        'docs/design-system/figma/petrol-tokens.json is stale. Run: npm run tokens:figma',
      );
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
